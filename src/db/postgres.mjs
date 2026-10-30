import { Pool } from '@neondatabase/serverless';
import { resolve } from 'node:path';

// Vercel Dev executa as funções localmente, mas nem toda configuração do
// ambiente é propagada para os módulos. Carrega o .env.local da raiz antes
// de ler DATABASE_URL, ADMIN_PASSWORD e APP_SECRET. Nunca faz isso em
// produção ou em deployments Preview.
const isLocalVercel = process.env.VERCEL === '1' && process.env.VERCEL_ENV === 'development';
if (isLocalVercel && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(resolve(process.cwd(), '.env.local'));
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
