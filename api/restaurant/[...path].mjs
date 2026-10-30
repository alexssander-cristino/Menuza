import handler from '../[...path].mjs';

// Encaminha as rotas /api/restaurant/* ao handler central sem depender de rewrites.
export default async function restaurantRoutes(req, res) {
  return handler(req, res);
}
