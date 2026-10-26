PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS restaurants (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
  currency TEXT NOT NULL DEFAULT 'BRL', prep_minutes INTEGER NOT NULL DEFAULT 30,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL, slug TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(restaurant_id, slug)
);
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES categories(id), name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL CHECK(type IN ('pizza','burger','plate')), base_price_cents INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1, featured INTEGER NOT NULL DEFAULT 0, prep_minutes INTEGER NOT NULL DEFAULT 25,
  model_url TEXT, width_cm REAL, depth_cm REAL, height_cm REAL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ingredients (
  id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('pizza','burger','plate')), group_name TEXT NOT NULL,
  addon_cents INTEGER NOT NULL DEFAULT 0, included_by_default INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL REFERENCES restaurants(id), customer_name TEXT NOT NULL,
  phone TEXT NOT NULL, fulfillment TEXT NOT NULL CHECK(fulfillment IN ('table','pickup','delivery')),
  table_label TEXT, delivery_address TEXT, note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'received',
  total_cents INTEGER NOT NULL, tracking_token TEXT NOT NULL UNIQUE, idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(restaurant_id, idempotency_key)
);
CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL, product_name_snapshot TEXT NOT NULL, quantity INTEGER NOT NULL,
  size_key TEXT NOT NULL DEFAULT '', crust_key TEXT NOT NULL DEFAULT '', ingredients_json TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '', unit_price_cents INTEGER NOT NULL, snapshot_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS order_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL, changed_at TEXT NOT NULL, changed_by TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_restaurant ON products(restaurant_id, active, category_id);
CREATE INDEX IF NOT EXISTS idx_orders_restaurant_status ON orders(restaurant_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
