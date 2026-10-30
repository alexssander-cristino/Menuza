import handler from '../[...path].mjs';

// Encaminha as rotas /api/customer/* ao handler central sem depender de rewrites.
export default async function customerRoutes(req, res) {
  return handler(req, res);
}
