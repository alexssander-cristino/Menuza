import { Pool } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Vercel Dev nem sempre propaga as variáveis do .env.local para as funções.
// Resolve o arquivo a partir deste módulo (src/db), não do process.cwd(),
// e carrega antes que a API capture DATABASE_URL, ADMIN_PASSWORD e APP_SECRET.
const isLocalRuntime = process.env.NODE_ENV !== 'production'
  && process.env.VERCEL_ENV !== 'production'
  && process.env.VERCEL_ENV !== 'preview';

if (isLocalRuntime) {
  const localEnvPath = fileURLToPath(new URL('../../.env.local', import.meta.url));
  try {
    const contents = readFileSync(localEnvPath, 'utf8').replace(/^\uFEFF/, '');
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match) continue;

      const [, key] = match;
      let value = match[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1).replace(/\\n/g, '\n').replace(/\\r/g, '\r');
      } else {
        value = value.replace(/\s+#.*$/, '').trim();
      }

      // Variáveis já definidas no terminal/Vercel têm prioridade. Valores
      // vazios são tratados como ausentes para não bloquear o .env.local.
      if (process.env[key] === undefined || process.env[key] === '') {
        process.env[key] = value;
      }
    }
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
