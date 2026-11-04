-- Registra a resposta e a justificativa de retenção no atendimento de solicitações LGPD.
-- Seguro para reaplicação em ambientes existentes.
BEGIN;

ALTER TABLE privacy_requests
  ADD COLUMN IF NOT EXISTS response_note TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS retention_reason TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS closed_at TEXT;

COMMIT;
