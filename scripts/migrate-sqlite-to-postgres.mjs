import { DatabaseSync } from 'node:sqlite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from '@neondatabase/serverless';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = resolve(process.env.DATA_FILE || resolve(ROOT, 'data', 'mesa.sqlite'));
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('Configure DATABASE_URL com a conexão do PostgreSQL de destino.');
if (!process.env.CONFIRM_SQLITE_TO_POSTGRES_MIGRATION || process.env.CONFIRM_SQLITE_TO_POSTGRES_MIGRATION !== 'yes') {
  throw new Error('Migração bloqueada por segurança. Faça backup e defina CONFIRM_SQLITE_TO_POSTGRES_MIGRATION=yes.');
}

const source = new DatabaseSync(sourcePath, { readOnly: true });
const pool = new Pool({
  connectionString,
  ssl: process.env.PGSSL === 'disable' ? false : (process.env.PGSSL === 'require' ? { rejectUnauthorized: false } : undefined),
  max: 2,
  connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 10000
});

// Respecta as chaves estrangeiras e as tabelas que existem na versão SQLite de origem.
const tableOrder = [
  'restaurants', 'categories', 'products', 'ingredients', 'customers', 'orders',
  'order_items', 'order_status_history', 'combos', 'coupons', 'restaurant_tables',
  'security_rate_buckets', 'privacy_requests'
];
const client = await pool.connect();
let totalRows = 0;
const counts = {};
try {
  const integrity = source.prepare('PRAGMA integrity_check').all();
  if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') {
    throw new Error('O banco SQLite falhou no integrity_check. Nenhum dado foi migrado.');
  }
  const tables = new Set(source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(row => row.name));
  // Avoid silently mixing old/partial data with an existing target database.
  for (const table of tableOrder) {
    if (!tables.has(table)) continue;
    const destinationExists = await client.query(
      "SELECT to_regclass($1) AS relation",
      [table]
    );
    if (!destinationExists.rows[0]?.relation) {
      throw new Error(`Tabela ${table} não existe no destino. Aplique migrations/postgres/001_initial.sql primeiro.`);
    }
    const destinationCount = await client.query(`SELECT COUNT(*)::int AS count FROM "${table}"`);
    if (Number(destinationCount.rows[0].count) !== 0) {
      throw new Error(`Destino não está vazio: ${table} contém ${destinationCount.rows[0].count} registros. Use um banco de destino vazio para evitar mistura de dados.`);
    }
  }

  await client.query('BEGIN');
  for (const table of tableOrder) {
    if (!tables.has(table)) continue;
    const columns = source.prepare(`PRAGMA table_info("${table}")`).all().map(column => column.name);
    if (!columns.length) continue;
    const rows = source.prepare(`SELECT * FROM "${table}"`).all();
    counts[table] = { source: rows.length, inserted: 0, skipped: 0 };
    for (const row of rows) {
      const placeholders = columns.map((_, index) => '$' + (index + 1)).join(', ');
      const names = columns.map(name => '"' + name.replace(/"/g, '""') + '"').join(', ');
      const values = columns.map(name => row[name]);
      const result = await client.query(
        `INSERT INTO "${table}" (${names}) VALUES (${placeholders})`,
        values
      );
      if (result.rowCount) counts[table].inserted++;
      else throw new Error(`Não foi possível inserir registro em ${table}; transação será revertida.`);
    }
    totalRows += rows.length;
  }

  // Preserve numeric IDs for order history and make the BIGSERIAL sequence continue after them.
  if (tables.has('order_status_history')) {
    await client.query(`SELECT setval(pg_get_serial_sequence('order_status_history','id'), GREATEST(COALESCE((SELECT MAX(id) FROM order_status_history), 1), 1), EXISTS(SELECT 1 FROM order_status_history))`);
  }

  // Check destination counts before committing; skipped rows are allowed only when already present.
  for (const table of tableOrder) {
    if (!tables.has(table)) continue;
    const sourceCount = source.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get().count;
    const destination = await client.query(`SELECT COUNT(*)::int AS count FROM "${table}"`);
    if (Number(destination.rows[0].count) < Number(sourceCount)) {
      throw new Error(`Validação falhou em ${table}: SQLite=${sourceCount}, PostgreSQL=${destination.rows[0].count}. Transação revertida.`);
    }
  }
  await client.query('COMMIT');
  process.stdout.write(JSON.stringify({ ok: true, source: sourcePath, rowsRead: totalRows, tables: counts }, null, 2) + '\n');
} catch (error) {
  try { await client.query('ROLLBACK'); } catch {}
  throw error;
} finally {
  client.release();
  source.close();
  await pool.end();
}
