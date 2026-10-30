import { Pool } from '@neondatabase/serverless';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load the root .env.local before API modules capture configuration values.
// Resolve relative to this file instead of process.cwd(): Vercel Dev may run
// functions with a working directory different from the repository root.
// Never load local secrets in production or Preview deployments.
const isProductionDeployment =
  process.env.NODE_ENV === 'production' ||
  process.env.VERCEL_ENV === 'production' ||
  process.env.VERCEL_ENV === 'preview';

if (!isProductionDeployment && typeof process.loadEnvFile === 'function') {
  const projectRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
  try {
    process.loadEnvFile(resolve(projectRoot, '.env.local'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL não configurada. Verifique o .env.local na raiz do projeto ou as variáveis do ambiente Neon.');
}

export const pool = new Pool({
  connectionString,
  max: 5,
  idleTimeoutMillis: 5_000,
  connectionTimeoutMillis: 10_000
});

export async function query(text, values = []) {
  return pool.query(text, values);
}

export async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}
