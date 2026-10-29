import { randomBytes } from 'node:crypto';
import { makeSeed } from '../src/catalog.mjs';
import { withTransaction } from '../src/db/postgres.mjs';

const now = new Date().toISOString();
const seed = makeSeed(now);

await withTransaction(async client => {
  await client.query(
    `INSERT INTO restaurants (id, name, slug, currency, prep_minutes, created_at, logo_url)
     VALUES ($1,$2,$3,$4,$5,$6,'')
     ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, slug=EXCLUDED.slug, currency=EXCLUDED.currency, prep_minutes=EXCLUDED.prep_minutes`,
    [seed.restaurant.id, seed.restaurant.name, seed.restaurant.slug, seed.restaurant.currency, seed.restaurant.prepMinutes, seed.restaurant.createdAt]
  );

  for (const category of seed.categories) {
    await client.query(
      `INSERT INTO categories (id, restaurant_id, name, slug, sort_order)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, slug=EXCLUDED.slug, sort_order=EXCLUDED.sort_order`,
      [category.id, category.restaurantId, category.name, category.slug, category.sort]
    );
  }

  for (const product of seed.products) {
    await client.query(
      `INSERT INTO products
       (id,restaurant_id,category_id,name,description,type,base_price_cents,active,available,featured,prep_minutes,model_url,width_cm,depth_cm,height_cm,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (id) DO NOTHING`,
      [product.id, product.restaurantId, product.categoryId, product.name, product.description, product.type, product.baseCents, product.active, product.featured, product.prep, product.modelUrl, product.width, product.depth, product.height, product.createdAt, product.updatedAt]
    );
  }

  for (const ingredient of seed.ingredients) {
    await client.query(
      `INSERT INTO ingredients (id,restaurant_id,name,type,group_name,addon_cents,included_by_default,active,sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8)
       ON CONFLICT (id) DO NOTHING`,
      [ingredient.id, ingredient.restaurantId, ingredient.name, ingredient.type, ingredient.groupName, ingredient.addonCents, ingredient.includedByDefault, ingredient.sortOrder]
    );
  }

  for (let number = 1; number <= 12; number++) {
    const token = randomBytes(24).toString('base64url');
    await client.query(
      `INSERT INTO restaurant_tables (id,restaurant_id,table_number,seats,status,note,updated_at,qr_token)
       VALUES ($1,$2,$3,$4,'free','',$5,$6)
       ON CONFLICT (restaurant_id, table_number) DO UPDATE SET
         qr_token=COALESCE(NULLIF(restaurant_tables.qr_token,''), EXCLUDED.qr_token)`,
      ['table-' + number, seed.restaurant.id, number, number <= 4 ? 2 : 4, now, token]
    );
  }
});

console.log('Menuza: schema já aplicado e dados iniciais verificados para', seed.restaurant.slug);
