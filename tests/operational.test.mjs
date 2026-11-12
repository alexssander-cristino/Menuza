import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('P1: worker heartbeat e recuperação automática de trabalhos 3D interrompidos', async () => {
  const api = await read('api/[...path].mjs');
  const health = await read('api/health.mjs');
  assert.ok(api.includes('CREATE TABLE IF NOT EXISTS worker_heartbeats'));
  assert.ok(api.includes('INSERT INTO worker_heartbeats(worker_name,last_seen_at,metadata)'));
  assert.ok(api.includes("path==='/api/3d-worker/heartbeat'"));
  assert.ok(api.includes("updated_at<NOW()-INTERVAL '20 minutes'"));
  assert.ok(api.includes('attempt_count=attempt_count+1'));
  assert.ok(health.includes('Number(row.ageSeconds) <= 180'));
  assert.ok(health.includes("searchParams.get('worker') === '1'"));
});

test('P1: relatório apresenta custo direto conhecido e margem estimada sem assumir custo zero como custo real', async () => {
  const api = await read('api/[...path].mjs');
  const ui = await read('public/app.js');
  const local = await read('server.mjs');
  assert.ok(local.includes("'products','cost_cents','INTEGER NOT NULL DEFAULT 0'"));
  assert.ok(local.includes('knownRevenueCents'));
  assert.ok(api.includes('ADD COLUMN IF NOT EXISTS cost_cents INTEGER NOT NULL DEFAULT 0'));
  assert.ok(api.includes('known_cost_cents'));
  assert.ok(api.includes('known_revenue_cents'));
  assert.ok(api.includes('products_with_cost'));
  assert.ok(api.includes('coveragePercent'));
  assert.ok(ui.includes('product-cost-price-input'));
  assert.ok(ui.includes('beverage-cost-input'));
  assert.ok(ui.includes('Margem de contribuição estimada'));
  assert.ok(ui.includes('Itens sem custo cadastrado não entram no custo conhecido'));
});

test('P1: falhas do agente de impressão ficam em fila local recuperável por ID', async () => {
  const ui = await read('public/app.js');
  assert.ok(ui.includes('menuza-print-retry-ids'));
  assert.ok(ui.includes('function retryFailedPrints('));
  assert.ok(ui.includes('data-action="retry-failed-prints"'));
  assert.ok(ui.includes('sendOrderToLocalPrinter(order,true)'));
});

test('P1: workflows automatizam backup com restauração isolada e monitoramento', async () => {
  const backup = await read('.github/workflows/postgres-backup.yml');
  const monitor = await read('.github/workflows/operational-monitoring.yml');
  assert.ok(backup.includes('pg_dump'));
  assert.ok(backup.includes('pg_restore --dbname'));
  assert.ok(backup.includes('retention-days: 30'));
  assert.ok(monitor.includes('MENUZA_HEALTH_URL'));
  assert.ok(monitor.includes('worker=1'));
});
