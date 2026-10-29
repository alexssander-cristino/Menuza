import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const migration = join(root, 'scripts', 'migrate-sqlite-to-postgres.mjs');

test('schema PostgreSQL inclui tabelas e constraints essenciais do Menuza', async () => {
  const sql = await readFile(join(root, 'migrations', 'postgres', '001_initial.sql'), 'utf8');
  for (const table of [
    'restaurants', 'categories', 'products', 'ingredients', 'customers', 'orders',
    'order_items', 'order_status_history', 'combos', 'coupons', 'restaurant_tables',
    'security_rate_buckets', 'privacy_requests'
  ]) {
    assert.match(sql, new RegExp('CREATE TABLE IF NOT EXISTS ' + table + '\\b'), 'missing table: ' + table);
  }
  assert.match(sql, /UNIQUE\s*\(restaurant_id,\s*idempotency_key\)/i, 'checkout idempotency must be protected by the database');
  assert.match(sql, /UNIQUE\s*\(restaurant_id,\s*table_number\)/i, 'table numbers must be unique within a restaurant');
  assert.match(sql, /ON DELETE CASCADE/i, 'dependent rows must have explicit deletion behavior');
  assert.match(sql, /tracking_token TEXT NOT NULL UNIQUE/i, 'order tracking tokens must remain unique');
});

test('script de migração exige confirmação explícita antes de tocar no banco', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'menuza-pg-migration-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const child = spawn(process.execPath, [migration], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: 'postgresql://invalid:invalid@127.0.0.1:1/unused', CONFIRM_SQLITE_TO_POSTGRES_MIGRATION: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  assert.notEqual(exitCode, 0);
  assert.match(stderr, /CONFIRM_SQLITE_TO_POSTGRES_MIGRATION=yes/);
  assert.doesNotMatch(stderr, /ECONNREFUSED|password authentication failed/i);
});
