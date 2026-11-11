import handler from './[...path].mjs';

export default async function dispatch(req, res) {
  if (!req || !res) {
    throw new Error('Vercel dispatch recebeu uma requisição ou resposta inválida.');
  }

  // Normaliza os objetos do adaptador Node antes de encaminhar ao roteador.
  // Algumas versões do runtime podem entregar headers/query ainda não inicializados.
  if (!req.headers || typeof req.headers !== 'object') req.headers = {};
  if (!req.query || typeof req.query !== 'object') req.query = {};

  const original = req.query.path;
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathFromUrl = requestUrl.searchParams.get('path');
  const route = original ?? pathFromUrl;

  req.query.path = Array.isArray(route)
    ? route.filter(Boolean).join('/')
    : String(route || '').replace(/^\/+|\/+$/g, '');

  // Resolve a configuração pública diretamente no dispatcher para manter
  // o mesmo comportamento no Vercel Dev e em produção.
  if ((req.method || 'GET') === 'GET' && req.query.path === 'public/integrations') {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).json({
      sentryDsn: process.env.SENTRY_DSN || '',
      turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || '',
      gaMeasurementId: process.env.GA_MEASUREMENT_ID || ''
    });
  }

  return handler(req, res);
}
