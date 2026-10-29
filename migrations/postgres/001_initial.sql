-- PostgreSQL schema for Menuza production migration.
-- Keep integer flags (0/1) initially to preserve the current API and business logic.
-- Apply to a NEW PostgreSQL database; this file does not migrate existing SQLite data.
BEGIN;

CREATE TABLE IF NOT EXISTS restaurants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  currency TEXT NOT NULL DEFAULT 'BRL',
  prep_minutes INTEGER NOT NULL DEFAULT 30,
  created_at TEXT NOT NULL,
  logo_url TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (restaurant_id, slug)
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES categories(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL CHECK (type IN ('pizza', 'burger', 'plate')),
  base_price_cents INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  available INTEGER NOT NULL DEFAULT 1,
  featured INTEGER NOT NULL DEFAULT 0,
  prep_minutes INTEGER NOT NULL DEFAULT 25,
  model_url TEXT,
  width_cm DOUBLE PRECISION,
  depth_cm DOUBLE PRECISION,
  height_cm DOUBLE PRECISION,
  ingredient_ids_json TEXT NOT NULL DEFAULT '[]',
  default_ingredient_ids_json TEXT NOT NULL DEFAULT '[]',
  ingredients_configured INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ingredients (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('pizza', 'burger', 'plate')),
  group_name TEXT NOT NULL,
  addon_cents INTEGER NOT NULL DEFAULT 0,
  included_by_default INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL REFERENCES restaurants(id),
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  fulfillment TEXT NOT NULL CHECK (fulfillment IN ('table', 'pickup', 'delivery')),
  table_label TEXT,
  delivery_address TEXT,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'received',
  total_cents INTEGER NOT NULL,
  tracking_token TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL,
  coupon_code TEXT NOT NULL DEFAULT '',
  discount_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (restaurant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  product_name_snapshot TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  size_key TEXT NOT NULL DEFAULT '',
  crust_key TEXT NOT NULL DEFAULT '',
  ingredients_json TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  unit_price_cents INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS order_status_history (
  id BIGSERIAL PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  changed_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS combos (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL,
  items_json TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS coupons (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
  discount_value INTEGER NOT NULL,
  minimum_subtotal_cents INTEGER NOT NULL DEFAULT 0,
  starts_at TEXT,
  expires_at TEXT,
  max_uses INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE (restaurant_id, code)
);

CREATE TABLE IF NOT EXISTS restaurant_tables (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  table_number INTEGER NOT NULL,
  seats INTEGER NOT NULL DEFAULT 4,
  status TEXT NOT NULL DEFAULT 'free' CHECK (status IN ('free', 'occupied', 'cleaning')),
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  qr_token TEXT,
  UNIQUE (restaurant_id, table_number)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurant_tables_qr_token
  ON restaurant_tables(qr_token) WHERE qr_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS security_rate_buckets (
  bucket_key TEXT PRIMARY KEY,
  timestamps_json TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS privacy_requests (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  request_type TEXT NOT NULL CHECK (request_type IN ('access', 'correction', 'deletion', 'question', 'support')),
  details TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'closed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_restaurant
  ON products (restaurant_id, active, category_id);
CREATE INDEX IF NOT EXISTS idx_orders_restaurant_status
  ON orders (restaurant_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer_created
  ON orders (customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_privacy_requests_status_created
  ON privacy_requests (status, created_at);
CREATE INDEX IF NOT EXISTS idx_security_rate_buckets_updated
  ON security_rate_buckets (updated_at);

COMMIT;
