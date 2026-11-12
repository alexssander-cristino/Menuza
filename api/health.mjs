// Verificação operacional da API, do PostgreSQL e do worker TripoSR.
// ?worker=1 permite que um monitor externo alerte quando o worker configurado para de responder.
import { query } from '../src/db/postgres.mjs';

export default async function handler(request, response) {
  if (request.method !== 'GET') { response.setHeader('Allow', 'GET'); return response.status(405).json({ ok: false, error: 'Método não permitido.' }); }
  try {
    const result = await query('SELECT NOW() AS database_time');
    const configured = Boolean(process.env.TRIPOSR_WORKER_TOKEN);
    let worker = { configured, healthy: !configured, lastSeenAt: null, ageSeconds: null };
    if (configured) {
      const exists = await query("SELECT to_regclass('public.worker_heartbeats') IS NOT NULL AS available");
      if (exists.rows[0]?.available) {
        const heartbeat = await query("SELECT last_seen_at AS \"lastSeenAt\", EXTRACT(EPOCH FROM (NOW()-last_seen_at))::int AS \"ageSeconds\" FROM worker_heartbeats WHERE worker_name='triposr'");
        const row = heartbeat.rows[0];
        worker = { configured: true, healthy: Boolean(row && Number(row.ageSeconds) <= 180), lastSeenAt: row?.lastSeenAt || null, ageSeconds: row?.ageSeconds ?? null };
      }
    }
    const workerCheck = new URL(request.url || '/', 'http://' + (request.headers?.host || 'localhost')).searchParams.get('worker') === '1';
    const ok = !workerCheck || !configured || worker.healthy;
    return response.status(ok ? 200 : 503).json({ ok, service: 'menuza-api', database: 'connected', databaseTime: result.rows[0].database_time, worker });
  } catch (error) {
    console.error('[Menuza health] PostgreSQL/worker check failed:', error?.message || error);
    return response.status(503).json({ ok: false, service: 'menuza-api', database: 'unavailable' });
  }
}
