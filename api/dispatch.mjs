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

  return handler(req, res);
}
