import { query } from '../src/db/postgres.mjs';
import { CRUST_OPTIONS, inferIngredientVisual, SIZE_OPTIONS } from '../src/catalog.mjs';

const RESTAURANT_ID = 'rest-bela-mesa';

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'Método não permitido.' });
  }

  try {
    // Keep the public endpoint compatible with databases upgraded by the admin API.
    await query("ALTER TABLE products ADD COLUMN IF NOT EXISTS ingredient_ids_json TEXT NOT NULL DEFAULT '[]'");
    await query("ALTER TABLE products ADD COLUMN IF NOT EXISTS default_ingredient_ids_json TEXT NOT NULL DEFAULT '[]'");
    await query('ALTER TABLE products ADD COLUMN IF NOT EXISTS ingredients_configured INTEGER NOT NULL DEFAULT 0');
    await query("ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT NOT NULL DEFAULT ''");

    const [restaurantResult, categoryResult, productResult, ingredientResult, comboResult] = await Promise.all([
      query('SELECT id, name, slug, currency, prep_minutes AS "prepMinutes", logo_url AS "logoUrl" FROM restaurants WHERE id = $1', [RESTAURANT_ID]),
      query('SELECT id, name, slug, sort_order AS "sortOrder" FROM categories WHERE restaurant_id = $1 ORDER BY sort_order', [RESTAURANT_ID]),
      query('SELECT p.id, p.category_id AS "categoryId", p.name, p.description, p.type, p.base_price_cents AS "baseCents", p.active, p.available, p.featured, p.prep_minutes AS "prepMinutes", p.model_url AS "modelUrl", p.width_cm AS "widthCm", p.depth_cm AS "depthCm", p.height_cm AS "heightCm", p.ingredient_ids_json AS "ingredientIdsJson", p.default_ingredient_ids_json AS "defaultIngredientIdsJson", p.ingredients_configured AS "ingredientsConfigured", p.image_url AS "imageUrl", p.updated_at AS "updatedAt" FROM products p WHERE p.restaurant_id = $1 AND p.active = 1 ORDER BY p.featured DESC, p.category_id, p.name', [RESTAURANT_ID]),
      query('SELECT id, name, type, group_name AS "groupName", addon_cents AS cents, included_by_default AS included, active, sort_order AS "sortOrder" FROM ingredients WHERE restaurant_id = $1 AND active = 1 ORDER BY sort_order', [RESTAURANT_ID]),
      query('SELECT id, name, description, price_cents AS "priceCents", items_json AS "itemsJson", active, created_at AS "createdAt", updated_at AS "updatedAt" FROM combos WHERE restaurant_id = $1 AND active = 1 ORDER BY created_at DESC', [RESTAURANT_ID])
    ]);

    const products = productResult.rows.map(product => {
      let ingredientIds = [];
      let defaultIngredientIds = [];
      try { ingredientIds = JSON.parse(product.ingredientIdsJson || '[]'); } catch {}
      try { defaultIngredientIds = JSON.parse(product.defaultIngredientIdsJson || '[]'); } catch {}
      return {
        ...product,
        ingredientIds: Array.isArray(ingredientIds) ? ingredientIds.filter(id => typeof id === 'string').slice(0, 40) : [],
        defaultIngredientIds: Array.isArray(defaultIngredientIds) ? defaultIngredientIds.filter(id => typeof id === 'string').slice(0, 40) : [],
        ingredientsConfigured: Number(product.ingredientsConfigured) === 1
      };
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

    return response.status(200).json({
      restaurant: restaurantResult.rows[0] || null,
      categories: categoryResult.rows,
      products,
      ingredients,
      combos,
      sizes: SIZE_OPTIONS,
      crusts: CRUST_OPTIONS
    });
  } catch (error) {
    console.error('[Menuza catalog] Failed to load catalog:', error?.message || error);
    return response.status(503).json({ error: 'Cardápio temporariamente indisponível.' });
  }
}
