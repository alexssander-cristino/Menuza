-- Persist whether a product requires an adult customer.
-- The application calculates age from customers.birth_date at request time.
BEGIN;
ALTER TABLE products ADD COLUMN IF NOT EXISTS age_restricted INTEGER NOT NULL DEFAULT 0;
COMMIT;
