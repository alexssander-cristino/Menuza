-- Allow beverage products while preserving the existing product types.
BEGIN;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_type_check;
ALTER TABLE products
  ADD CONSTRAINT products_type_check
  CHECK (type IN ('pizza', 'burger', 'plate', 'drink'));
COMMIT;
