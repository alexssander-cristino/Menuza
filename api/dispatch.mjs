import handler from './[...path].mjs';

export default async function dispatch(req, res) {
  // Vercel's filesystem router exposes this file as a concrete function route.
  // The rewrite in vercel.json passes the original endpoint in the `path` query.
  if (!req.query || typeof req.query !== 'object') req.query = {};
  const original = req.query.path;
  req.query.path = Array.isArray(original)
    ? original.filter(Boolean).join('/')
    : String(original || '').replace(/^\/+|\/+$/g, '');
  return handler(req, res);
}
