-- Data de nascimento informada no cadastro do cliente.
-- A idade é calculada pela aplicação e não armazenada como valor fixo.
BEGIN;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS birth_date DATE;
COMMIT;
