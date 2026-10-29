import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { withTransaction, query } from '../src/db/postgres.mjs';

const file = resolve(process.env.DATA_FILE || 'data/mesa.sqlite');
if (!existsSync(file)) {
  console.error('Banco SQLite não encontrado:', file);
  console.error('Defina DATA_FILE com o caminho do banco atual antes de importar.');
  process.exitCode = 1;
} else {
  const sqlite = new DatabaseSync(file);
  const tables = [
    'restaurants', 'categories', 'products', 'ingredients', 'customers',
    'combos', 'coupons', 'restaurant_tables', 'orders', 'order_items',
    'order_status_history', 'security_rate_buckets', 'privacy_requests'
  ];
  try {
    await withTransaction(async client => {
      for (const table of tables) {
        const exists = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
        if (!exists) continue;
        const sourceColumns = sqlite.prepare('PRAGMA table_info("' + table + '")').all().map(column => column.name);
        const targetResult = await client.query(
          'SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1',
          [table]
        );
        const targetColumns = new Set(targetResult.rows.map(column => column.column_name));
        const columns = sourceColumns.filter(column => targetColumns.has(column) && /^[a-z_][a-z0-9_]*$/.test(column));
        if (!columns.length) continue;
        const rows = sqlite.prepare('SELECT * FROM "' + table + '"').all();
        for (const row of rows) {
          const values = columns.map(column => row[column]);
          const placeholders = columns.map((_, index) => '$' + (index + 1)).join(',');
          const names = columns.map(column => '"' + column + '"').join(',');
          await client.query(
            'INSERT INTO "' + table + '" (' + names + ') VALUES (' + placeholders + ') ON CONFLICT DO NOTHING',
            values
          );
        }
        console.log(table + ': ' + rows.length + ' registros lidos');
      }
      await client.query(`SELECT setval(pg_get_serial_sequence('order_status_history','id'), COALESCE((SELECT MAX(id) FROM order_status_history), 1), EXISTS(SELECT 1 FROM order_status_history))`);
    });
    console.log('Importação concluída. Registros existentes foram preservados; conflitos foram ignorados.');
  } finally {
    sqlite.close();
  }
}
