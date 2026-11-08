import { query, withTransaction } from '../src/db/postgres.mjs';
import { consumeRateLimit } from '../src/security/rate-limit.mjs';
import { inferIngredientVisual, SIZE_OPTIONS } from '../src/catalog.mjs';
// Endpoint público do cardápio na Vercel.
// Consulta os dados ativos no Postgres, normaliza imagens e opções de produtos,
// calcula promoções vigentes e devolve o formato esperado pelo cardápio do cliente.
import { isImageDataUrl, isStoredImageUrl, migrateImageReferences, storeImageDataUrl } from '../src/storage/neon.mjs';

const RESTAURANT_ID = 'rest-bela-mesa';

// Garante que as tabelas de tamanhos e bordas existam antes de montar o catálogo.
async function ensurePizzaConfigSchema() {
  await query(`CREATE TABLE IF NOT EXISTS pizza_sizes (
    id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL, key TEXT NOT NULL,
    label TEXT NOT NULL, diameter_cm INTEGER NOT NULL DEFAULT 0,
    max_flavors INTEGER NOT NULL DEFAULT 1, price_cents INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0,
    UNIQUE(restaurant_id,key)
  )`);
  await query('ALTER TABLE pizza_sizes ADD COLUMN IF NOT EXISTS price_cents INTEGER NOT NULL DEFAULT 0');
  await query(`CREATE TABLE IF NOT EXISTS pizza_crusts (
    id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL, key TEXT NOT NULL,
    label TEXT NOT NULL, price_cents INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0,
    UNIQUE(restaurant_id,key)
  )`);
  // O catálogo público nunca cria opções padrão; exibe exclusivamente os cadastros do restaurante.
}

function saoPauloWeekday() {
  const day = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' }).format(new Date());
  return ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 })[day] || 1;
}

// Retorna o preço promocional somente quando a promoção está ativa no dia atual e reduz o preço base.
function promotionPrice(product, promotion) {
  if (!promotion || Number(promotion.active) !== 1) return null;
  let weekdays = [];
  try { weekdays = JSON.parse(promotion.weekdays_json || '[]'); } catch {}
  if (!Array.isArray(weekdays) || !weekdays.includes(saoPauloWeekday())) return null;
  const base = Number(product.baseCents);
  const price = promotion.discount_type === 'percent'
    ? Math.round(base * (100 - Number(promotion.discount_percent)) / 100)
    : Number(promotion.promotional_price_cents);
  return Number.isInteger(price) && price >= 0 && price < base ? price : null;
}

// Rota somente de leitura: limita consultas públicas, carrega os dados e responde com cache curto.
export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'Método não permitido.' });
  }

  try {
    const retry=await consumeRateLimit({req:request,key:'public-catalog',maximum:120,windowMs:60000,secret:process.env.APP_SECRET||'menuza-public-catalog-rate-limit',query,withTransaction});
    if(retry){response.setHeader('Retry-After',String(retry));response.setHeader('Cache-Control','no-store');return response.status(429).json({error:'Muitas consultas ao cardápio. Aguarde um pouco e tente novamente.'});}
    await ensurePizzaConfigSchema();
    // Keep the public endpoint compatible with databases upgraded by the admin API.
    await query(`CREATE TABLE IF NOT EXISTS product_promotions (
      id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL, product_id TEXT NOT NULL,
      discount_type TEXT NOT NULL CHECK(discount_type IN ('fixed','percent')),
      promotional_price_cents INTEGER, discount_percent INTEGER,
      weekdays_json TEXT NOT NULL DEFAULT '[1,2,3,4,5,6,7]',
      active INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(restaurant_id,product_id)
    )`);
    await query("ALTER TABLE products ADD COLUMN IF NOT EXISTS ingredient_ids_json TEXT NOT NULL DEFAULT '[]'");
    await query("ALTER TABLE products ADD COLUMN IF NOT EXISTS default_ingredient_ids_json TEXT NOT NULL DEFAULT '[]'");
    await query("ALTER TABLE products ADD COLUMN IF NOT EXISTS ingredient_quantities_json TEXT NOT NULL DEFAULT '{}'");
    await query('ALTER TABLE products ADD COLUMN IF NOT EXISTS ingredients_configured INTEGER NOT NULL DEFAULT 0');
    await query("ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT NOT NULL DEFAULT ''");
    await query("ALTER TABLE products ADD COLUMN IF NOT EXISTS product_images_json TEXT NOT NULL DEFAULT '[]'");
    await query("ALTER TABLE products ADD COLUMN IF NOT EXISTS model_3d_url TEXT NOT NULL DEFAULT ''");
    await query("ALTER TABLE products ADD COLUMN IF NOT EXISTS model_3d_status TEXT NOT NULL DEFAULT 'not_requested'");

    const [restaurantResult, categoryResult, productResult, ingredientResult, comboResult, promotionResult, sizeResult, crustResult] = await Promise.all([
      query('SELECT id, name, slug, currency, prep_minutes AS "prepMinutes", logo_url AS "logoUrl" FROM restaurants WHERE id = $1', [RESTAURANT_ID]),
      query('SELECT id, name, slug, sort_order AS "sortOrder" FROM categories WHERE restaurant_id = $1 ORDER BY sort_order', [RESTAURANT_ID]),
      query('SELECT p.id, p.category_id AS "categoryId", p.name, p.description, p.type, p.base_price_cents AS "baseCents", p.active, p.available, p.featured, p.prep_minutes AS "prepMinutes", p.model_url AS "modelUrl", p.width_cm AS "widthCm", p.depth_cm AS "depthCm", p.height_cm AS "heightCm", p.ingredient_ids_json AS "ingredientIdsJson", p.default_ingredient_ids_json AS "defaultIngredientIdsJson", p.ingredient_quantities_json AS "ingredientQuantitiesJson", p.ingredients_configured AS "ingredientsConfigured", p.size_prices_json AS "sizePricesJson", p.image_url AS "imageUrl", p.product_images_json AS "productImagesJson", p.model_3d_url AS "model3dUrl", p.model_3d_status AS "model3dStatus", p.updated_at AS "updatedAt" FROM products p WHERE p.restaurant_id = $1 AND p.active = 1 ORDER BY p.featured DESC, p.category_id, p.name', [RESTAURANT_ID]),
      query('SELECT id, name, type, group_name AS "groupName", addon_cents AS cents, included_by_default AS included, active, sort_order AS "sortOrder" FROM ingredients WHERE restaurant_id = $1 AND active = 1 ORDER BY sort_order', [RESTAURANT_ID]),
      query('SELECT id, name, description, price_cents AS "priceCents", items_json AS "itemsJson", active, created_at AS "createdAt", updated_at AS "updatedAt" FROM combos WHERE restaurant_id = $1 AND active = 1 ORDER BY created_at DESC', [RESTAURANT_ID]),
      query('SELECT * FROM product_promotions WHERE restaurant_id = $1 AND active = 1', [RESTAURANT_ID]),
      query('SELECT key,label,diameter_cm AS "diameterCm",max_flavors AS "maxFlavors",price_cents AS "priceCents",active FROM pizza_sizes WHERE restaurant_id=$1 AND active=1 ORDER BY sort_order',[RESTAURANT_ID]),
      query('SELECT key,label,price_cents AS "priceCents",active FROM pizza_crusts WHERE restaurant_id=$1 AND active=1 ORDER BY sort_order',[RESTAURANT_ID])
    ]);

    const products = await Promise.all(productResult.rows.map(async product => {
      let ingredientIds = [];
      let defaultIngredientIds = [];
      let ingredientQuantities = {};
      let images = [];
      let sizePrices = {};
      try { sizePrices = JSON.parse(product.sizePricesJson || '{}'); } catch {}
      try { ingredientIds = JSON.parse(product.ingredientIdsJson || '[]'); } catch {}
      try { defaultIngredientIds = JSON.parse(product.defaultIngredientIdsJson || '[]'); } catch {}
      try { ingredientQuantities = JSON.parse(product.ingredientQuantitiesJson || '{}'); } catch {}
      try { images = JSON.parse(product.productImagesJson || '[]'); } catch {}
      if (!Array.isArray(images) || !images.length) images = product.imageUrl ? [product.imageUrl] : [];
      images = images.filter(value => isImageDataUrl(value) || isStoredImageUrl(value)).slice(0, 8);
      const storedImages = await migrateImageReferences(images, 'products/' + product.id);
      const imageUrl = storedImages[0] || '';
      if (imageUrl !== product.imageUrl || JSON.stringify(storedImages) !== JSON.stringify(images)) await query('UPDATE products SET image_url=$1,product_images_json=$2 WHERE id=$3 AND restaurant_id=$4',[imageUrl,JSON.stringify(storedImages),product.id,RESTAURANT_ID]);
      const promotion = promotionResult.rows.find(item => item.product_id === product.id) || null;
      const promotionalPriceCents = promotionPrice(product, promotion);
      return {
        ...product,
        sizePrices: sizePrices && typeof sizePrices === 'object' && !Array.isArray(sizePrices) ? sizePrices : {},
        imageUrl,
        productImagesJson: JSON.stringify(storedImages),
        images: storedImages,
        ingredientIds: Array.isArray(ingredientIds) ? ingredientIds.filter(id => typeof id === 'string').slice(0, 40) : [],
        defaultIngredientIds: Array.isArray(defaultIngredientIds) ? defaultIngredientIds.filter(id => typeof id === 'string').slice(0, 40) : [],
        ingredientQuantities: ingredientQuantities && typeof ingredientQuantities === 'object' && !Array.isArray(ingredientQuantities) ? ingredientQuantities : {},
        ingredientsConfigured: Number(product.ingredientsConfigured) === 1,
        promotion: promotion ? {
          id: promotion.id,
          discountType: promotion.discount_type,
          promotionalPriceCents: promotion.promotional_price_cents == null ? null : Number(promotion.promotional_price_cents),
          discountPercent: promotion.discount_percent == null ? null : Number(promotion.discount_percent),
          weekdays: (() => { try { return JSON.parse(promotion.weekdays_json || '[]'); } catch { return []; } })(),
          active: Number(promotion.active) === 1,
          promotionActive: promotionalPriceCents !== null
        } : null,
        promotionalPriceCents
      };
    }));

    const restaurant = restaurantResult.rows[0] || null;
    if (restaurant && isImageDataUrl(restaurant.logoUrl)) {
      restaurant.logoUrl = await storeImageDataUrl(restaurant.logoUrl, 'restaurants/logos');
      await query('UPDATE restaurants SET logo_url=$1 WHERE id=$2',[restaurant.logoUrl,RESTAURANT_ID]);
    }

    // Os preços cadastrados no painel ficam em products.size_prices_json.
    // A tabela de tamanhos pode ter price_cents zerado em cadastros antigos;
    // nesse caso, recuperar o preço global salvo nos produtos, sem usar valores padrão.
    const pizzaProducts = products.filter(product => product.type === 'pizza');
    const configuredPrice = (key) => {
      const values = pizzaProducts.map(product => Number(product.sizePrices?.[key])).filter(value => Number.isInteger(value) && value >= 500);
      if (!values.length) return 0;
      return values.every(value => value === values[0]) ? values[0] : 0;
    };
    const publicPizzaSizes = sizeResult.rows.map(size => {
      const storedPrice = Number(size.priceCents);
      const priceCents = Number.isInteger(storedPrice) && storedPrice >= 500 ? storedPrice : configuredPrice(size.key);
      return { ...size, priceCents, deltaCents: 0 };
    });

    const ingredients = ingredientResult.rows.map(row => ({
      ...row,
      included: row.included === 1 || row.included === true,
      visual: inferIngredientVisual(row)
    }));

    const combos = comboResult.rows.map(row => {
      let itemIds = [];
      try { itemIds = JSON.parse(row.itemsJson); } catch {}
      const items = itemIds.map(entry => {
        const product = products.find(item => item.id === entry.productId);
        return product ? {
          productId: product.id,
          name: product.name,
          quantity: entry.quantity,
          baseCents: product.baseCents
        } : null;
      }).filter(Boolean);
      return {
        id: row.id,
        name: row.name,
        description: row.description,
        priceCents: row.priceCents,
        active: row.active,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        items
      };
    });

    response.setHeader('Cache-Control','public, s-maxage=15, stale-while-revalidate=30');
    return response.status(200).json({
      restaurant,
      categories: categoryResult.rows,
      products,
      ingredients,
      combos,
      sizes: { ...SIZE_OPTIONS, pizza: publicPizzaSizes },
      crusts: crustResult.rows.map(crust => ({ ...crust, priceCents: Number(crust.priceCents) || 0 }))
    });
  } catch (error) {
    console.error('[Menuza catalog] Failed to load catalog:', error?.message || error);
    return response.status(503).json({ error: 'Cardápio temporariamente indisponível.' });
  }
}
