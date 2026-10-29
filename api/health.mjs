import { query } from '../src/db/postgres.mjs';

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ ok: false, error: 'Método não permitido.' });
  }

  try {
    const result = await query('SELECT NOW() AS database_time');
    return response.status(200).json({
      ok: true,
      service: 'menuza-api',
      database: 'connected',
      databaseTime: result.rows[0].database_time
    });
  } catch (error) {
    console.error('[Menuza health] PostgreSQL connection failed:', error?.message || error);
    return response.status(503).json({
      ok: false,
      service: 'menuza-api',
      database: 'unavailable'
    });
  }
}
