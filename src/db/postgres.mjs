import { Pool } from '@neondatabase/serverless';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL não configurada. Defina a variável de ambiente do Neon.');
}

// Pool compartilhado por instância serverless. Use a connection string pooled do Neon.
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
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original failure.
    }
    throw error;
  } finally {
    client.release();
  }
}
