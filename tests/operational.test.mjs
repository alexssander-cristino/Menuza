import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('P1: worker heartbeat e recuperação automática de trabalhos 3D interrompidos', async () => {
  const api = await read('api/[...path].mjs');
  const health = await read('api/health.mjs');
  assert.match(api, /CREATE TABLE IF NOT EXISTS worker_heartbeats/);
  assert.match(api, /INSERT INTO worker_heartbeats\(worker_name,last_seen_at,metadata\)/);
  assert.match(api, /updated_at<NOW\(\)-INTERVAL '20 minutes'/);
  assert.match(api, /attempt_count=attempt_count\+1/);
  assert.match(health, /ageSeconds\) <= 180/);
  assert.match(health, /searchParams\.get\('worker'\) === '1'/);
});

test('P1: relatório apresenta custo direto conhecido e margem estimada sem assumir custo zero como custo real', async () => {
  const api = await read('api/[...path].mjs');
  const ui = await read('public/app.js');
  assert.match(api, /ADD COLUMN IF NOT EXISTS cost_cents INTEGER NOT NULL DEFAULT 0/);
  assert.match(api, /known_cost_cents/);\n  assert.match(api, /known_revenue_cents/);
  assert.match(api, /products_with_cost/);
  assert.match(api, /coveragePercent/);
  assert.match(ui, /product-cost-price-input/);
  assert.match(ui, /beverage-cost-input/);
  assert.match(ui, /Margem de contribuição estimada/);
  assert.match(ui, /Itens sem custo cadastrado não entram no custo conhecido/);
});

test('P1: falhas do agente de impressão ficam em fila local recuperável por ID', async () => {
  const ui = await read('public/app.js');
  assert.match(ui, /menuza-print-retry-ids/);
  assert.match(ui, /function retryFailedPrints\(/);
  assert.match(ui, /data-action="retry-failed-prints"/);
  assert.match(ui, /sendOrderToLocalPrinter\(order,true\)/);
});

test('P1: workflows automatizam backup com restauração isolada e monitoramento', async () => {
  const backup = await read('.github/workflows/postgres-backup.yml');
  const monitor = await read('.github/workflows/operational-monitoring.yml');
  assert.match(backup, /pg_dump/);
  assert.match(backup, /pg_restore --dbname/);
  assert.match(backup, /retention-days: 30/);
  assert.match(monitor, /MENUZA_HEALTH_URL/);
  assert.match(monitor, /worker=1/);
});
