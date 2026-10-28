import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHmac, timingSafeEqual, scryptSync } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { calculateItemPrice, CRUST_OPTIONS, INGREDIENTS, SIZE_OPTIONS, STATUS, STATUS_FLOW, makeSeed, slugify } from './src/catalog.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(ROOT, 'public');
const DATA_FILE = resolve(process.env.DATA_FILE || resolve(ROOT, 'data', 'mesa.sqlite'));
const PORT = Number(process.env.PORT || 4173);
const IS_PROD = process.env.NODE_ENV === 'production';
if (IS_PROD && (!process.env.APP_SECRET || !process.env.ADMIN_PASSWORD)) {
  throw new Error('Em produção, configure APP_SECRET e ADMIN_PASSWORD antes de iniciar.');
}
const SECRET = process.env.APP_SECRET || randomBytes(32).toString('hex');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'mesa-demo';
const RESTAURANT_ID = 'rest-bela-mesa';
const MAX_BODY = 64 * 1024;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const loginAttempts = new Map();
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json' };

await mkdir(dirname(DATA_FILE), { recursive: true });
const db = new DatabaseSync(DATA_FILE);
db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
db.exec(await readFile(resolve(ROOT, 'migrations/001_initial.sql'), 'utf8'));
db.exec(`CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, phone TEXT NOT NULL DEFAULT '', password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, created_at TEXT NOT NULL);`);
try { db.exec('ALTER TABLE orders ADD COLUMN customer_id TEXT'); } catch (error) { if (!String(error.message).includes('duplicate column name')) throw error; }
db.exec('CREATE INDEX IF NOT EXISTS idx_orders_customer_created ON orders(customer_id, created_at)');
if (!db.prepare('SELECT id FROM restaurants LIMIT 1').get()) seedDatabase();

function seedDatabase() {
  const seed = makeSeed();
  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO restaurants (id,name,slug,currency,prep_minutes,created_at) VALUES (?,?,?,?,?,?)').run(seed.restaurant.id, seed.restaurant.name, seed.restaurant.slug, seed.restaurant.currency, seed.restaurant.prepMinutes, seed.restaurant.createdAt);
    const categoryInsert = db.prepare('INSERT INTO categories (id,restaurant_id,name,slug,sort_order) VALUES (?,?,?,?,?)');
    for (const c of seed.categories) categoryInsert.run(c.id, c.restaurantId, c.name, c.slug, c.sort);
    const productInsert = db.prepare('INSERT INTO products (id,restaurant_id,category_id,name,description,type,base_price_cents,active,featured,prep_minutes,model_url,width_cm,depth_cm,height_cm,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    for (const p of seed.products) productInsert.run(p.id, p.restaurantId, p.categoryId, p.name, p.description, p.type, p.baseCents, p.active, p.featured, p.prep, p.modelUrl, p.width, p.depth, p.height, p.createdAt, p.updatedAt);
    const ingredientInsert = db.prepare('INSERT INTO ingredients (id,restaurant_id,name,type,group_name,addon_cents,included_by_default,active,sort_order) VALUES (?,?,?,?,?,?,?,?,?)');
    for (const i of seed.ingredients) ingredientInsert.run(i.id, i.restaurantId, i.name, i.type, i.groupName, i.addonCents, i.includedByDefault, i.active, i.sortOrder);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

const statement = sql => db.prepare(sql);
function catalogFor(restaurantId = RESTAURANT_ID, admin = false) {
  const activeFilter = admin ? '' : ' AND p.active=1';
  const products = statement('SELECT p.id,p.category_id AS categoryId,p.name,p.description,p.type,p.base_price_cents AS baseCents,p.active,p.featured,p.prep_minutes AS prepMinutes,p.model_url AS modelUrl,p.width_cm AS widthCm,p.depth_cm AS depthCm,p.height_cm AS heightCm,p.updated_at AS updatedAt FROM products p WHERE p.restaurant_id=?' + activeFilter + ' ORDER BY p.featured DESC,p.category_id,p.name').all(restaurantId);
  const categories = statement('SELECT id,name,slug,sort_order AS sortOrder FROM categories WHERE restaurant_id=? ORDER BY sort_order').all(restaurantId);
  const ingredientRows = statement('SELECT id,name,type,group_name AS groupName,addon_cents AS cents,included_by_default AS included,active,sort_order AS sortOrder FROM ingredients WHERE restaurant_id=?' + (admin ? '' : ' AND active=1') + ' ORDER BY sort_order').all(restaurantId);
  const ingredients = ingredientRows.map(row => ({ ...row, included: row.included === 1, visual: INGREDIENTS.find(i => i.id === row.id)?.visual || 'herb' }));
  return { restaurant: statement('SELECT id,name,slug,currency,prep_minutes AS prepMinutes FROM restaurants WHERE id=?').get(restaurantId), categories, products, ingredients, sizes: SIZE_OPTIONS, crusts: CRUST_OPTIONS };
}
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', SECRET).update(body).digest('base64url');
  return body + '.' + signature;
}
function readSession(request, cookieName = 'mesa_session') {
  const cookie = request.headers.cookie || '';
  const match = cookie.match(new RegExp('(?:^|; )' + cookieName + '=([^;]+)'));
  if (!match) return null;
  const [body, signature] = decodeURIComponent(match[1]).split('.');
  if (!body || !signature) return null;
  const expected = createHmac('sha256', SECRET).update(body).digest();
  let given;
  try { given = Buffer.from(signature, 'base64url'); } catch { return null; }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const session = JSON.parse(Buffer.from(body, 'base64url').toString());
    return session.exp > Date.now() ? session : null;
  } catch { return null; }
}
function requireAdmin(request) {
  const session = readSession(request);
  if (!session || session.role !== 'admin' || session.restaurantId !== RESTAURANT_ID) throw Object.assign(new Error('Entre no painel para continuar.'), { status: 401 });
  return session;
}
function optionalCustomer(request) {
  const session = readSession(request, 'menuza_customer_session');
  if (!session || session.role !== 'customer' || !session.customerId) return null;
  const customer = statement('SELECT id,name,email,phone FROM customers WHERE id=?').get(session.customerId);
  return customer ? { ...session, customer } : null;
}
function requireCustomer(request) { const session = optionalCustomer(request); if (!session) throw Object.assign(new Error('Entre na sua conta para continuar.'), { status: 401 }); return session; }
function normalizeEmail(value) { return cleanText(value, 254).toLowerCase(); }
function hashCustomerPassword(password, salt) { return scryptSync(password, salt, 64); }
function verifyCustomerPassword(password, customer) { const expected = Buffer.from(customer.password_hash, 'hex'); const actual = hashCustomerPassword(password, customer.password_salt); return expected.length === actual.length && timingSafeEqual(expected, actual); }
function createCustomer(payload) {
  const name = cleanText(payload.name, 100), email = normalizeEmail(payload.email), phone = cleanText(payload.phone, 30), password = typeof payload.password === 'string' ? payload.password : '';
  if (name.length < 2) throw Object.assign(new Error('Informe seu nome completo.'), { status: 422 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Object.assign(new Error('Informe um e-mail válido.'), { status: 422 });
  if (password.length < 8 || password.length > 128) throw Object.assign(new Error('A senha precisa ter entre 8 e 128 caracteres.'), { status: 422 });
  if (statement('SELECT id FROM customers WHERE email=?').get(email)) throw Object.assign(new Error('Já existe uma conta com esse e-mail. Entre ou use outro e-mail.'), { status: 409 });
  const id = 'cus_' + randomBytes(18).toString('hex'), salt = randomBytes(16).toString('hex');
  statement('INSERT INTO customers (id,name,email,phone,password_hash,password_salt,created_at) VALUES (?,?,?,?,?,?,?)').run(id,name,email,phone,hashCustomerPassword(password,salt).toString('hex'),salt,new Date().toISOString());
  return statement('SELECT id,name,email,phone FROM customers WHERE id=?').get(id);
}
function customerSessionCookie(token, maxAge = 604800) { return 'menuza_customer_session=' + encodeURIComponent(token) + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + maxAge + (IS_PROD ? '; Secure' : ''); }
function issueCustomerSession(customer) { return sign({ role: 'customer', customerId: customer.id, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 }); }
function listCustomerOrders(customerId) { return statement('SELECT id FROM orders WHERE customer_id=? AND restaurant_id=? ORDER BY created_at DESC LIMIT 100').all(customerId, RESTAURANT_ID).map(row => orderById(row.id));
}
function verifyPassword(candidate) {
  const a = createHmac('sha256', SECRET).update(String(candidate)).digest();
  const b = createHmac('sha256', SECRET).update(ADMIN_PASSWORD).digest();
  return timingSafeEqual(a, b);
}
function securityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cross-Origin-Resource-Policy': 'same-origin',
    ...(IS_PROD ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {})
  };
}
function send(response, status, data, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...securityHeaders(), ...headers });
  response.end(JSON.stringify(data));
}
function loginRateLimit(request) {
  const key = request.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const current = loginAttempts.get(key);
  if (!current || now - current.startedAt >= LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { startedAt: now, count: 0 });
    return { allowed: true, key };
  }
  if (current.count >= LOGIN_MAX_ATTEMPTS) {
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((LOGIN_WINDOW_MS - (now - current.startedAt)) / 1000)) };
  }
  return { allowed: true, key };
}
function recordLoginFailure(key) {
  const current = loginAttempts.get(key);
  if (current) current.count += 1;
}
function clearLoginFailures(key) {
  loginAttempts.delete(key);
}

function fail(response, error) {
  const status = error.status || (error instanceof SyntaxError ? 400 : 500);
  if (status >= 500) console.error(error);
  send(response, status, { error: status >= 500 ? 'O servidor não conseguiu concluir a solicitação.' : error.message });
}
async function bodyOf(request) {
  let raw = '';
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_BODY) throw Object.assign(new Error('A solicitação é grande demais.'), { status: 413 });
    raw += chunk.toString('utf8');
  }
  if (!raw) return {};
  return JSON.parse(raw);
}
function assertSameOrigin(request) {
  if (!['POST','PATCH','PUT','DELETE'].includes(request.method)) return;
  const origin = request.headers.origin;
  const fetchSite = request.headers['sec-fetch-site'];
  if (!origin) {
    if (fetchSite === 'same-origin') return;
    throw Object.assign(new Error('Origem da solicitação não permitida.'), { status: 403 });
  }
  const expected = 'http://' + request.headers.host;
  const expectedSecure = 'https://' + request.headers.host;
  if (origin !== expected && origin !== expectedSecure) throw Object.assign(new Error('Origem da solicitação não permitida.'), { status: 403 });
}
function orderById(id, restaurantId = RESTAURANT_ID) {
  const order = statement('SELECT id,restaurant_id AS restaurantId,customer_name AS customerName,phone,fulfillment,table_label AS tableLabel,delivery_address AS deliveryAddress,note,status,total_cents AS totalCents,tracking_token AS trackingToken,created_at AS createdAt,updated_at AS updatedAt FROM orders WHERE id=? AND restaurant_id=?').get(id, restaurantId);
  if (!order) return null;
  const items = statement('SELECT product_id AS productId,product_name_snapshot AS name,quantity,size_key AS sizeKey,crust_key AS crustKey,ingredients_json AS ingredientsJson,notes,unit_price_cents AS unitPriceCents,snapshot_json AS snapshotJson FROM order_items WHERE order_id=?').all(id).map(item => ({
    productId: item.productId, name: item.name, quantity: item.quantity, sizeKey: item.sizeKey, crustKey: item.crustKey,
    ingredients: JSON.parse(item.ingredientsJson), notes: item.notes, unitPriceCents: item.unitPriceCents, snapshot: JSON.parse(item.snapshotJson)
  }));
  const history = statement('SELECT status,changed_at AS changedAt,changed_by AS changedBy FROM order_status_history WHERE order_id=? ORDER BY id').all(id);
  return { ...order, items, history };
}
function emit(restaurantId, event) {
  const clients = streams.get(restaurantId);
  if (!clients) return;
  const frame = 'event: update\ndata: ' + JSON.stringify(event) + '\n\n';
  for (const client of [...clients]) {
    try { client.write(frame); } catch { clients.delete(client); }
  }
}
const streams = new Map();
function addStream(restaurantId, response) {
  if (!streams.has(restaurantId)) streams.set(restaurantId, new Set());
  const set = streams.get(restaurantId);
  set.add(response);
  response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  response.write('retry: 4000\n\n');
  const heartbeat = setInterval(() => { try { response.write(': ping\n\n'); } catch { clearInterval(heartbeat); set.delete(response); } }, 25000);
  response.on('close', () => { clearInterval(heartbeat); set.delete(response); });
}
function cleanText(value, max = 240) { return String(value ?? '').trim().slice(0, max); }
function createOrder(payload, customerId = null) {
  const customerName = cleanText(payload.customerName, 100);
  const phone = cleanText(payload.phone, 30);
  const fulfillment = payload.fulfillment;
  const itemsInput = payload.items;
  if (customerName.length < 2) throw Object.assign(new Error('Informe seu nome.'), { status: 422 });
  if (phone.replace(/\D/g, '').length < 8) throw Object.assign(new Error('Informe um telefone válido.'), { status: 422 });
  if (!['table','pickup','delivery'].includes(fulfillment)) throw Object.assign(new Error('Escolha como deseja receber o pedido.'), { status: 422 });
  const tableLabel = fulfillment === 'table' ? cleanText(payload.tableLabel, 30) : '';
  const deliveryAddress = fulfillment === 'delivery' ? cleanText(payload.deliveryAddress, 300) : '';
  if (fulfillment === 'table' && !tableLabel) throw Object.assign(new Error('Informe a mesa.'), { status: 422 });
  if (fulfillment === 'delivery' && deliveryAddress.length < 8) throw Object.assign(new Error('Informe o endereço de entrega.'), { status: 422 });
  if (!Array.isArray(itemsInput) || itemsInput.length < 1 || itemsInput.length > 20) throw Object.assign(new Error('O carrinho está vazio ou tem itens demais.'), { status: 422 });
  const idempotencyKey = cleanText(payload.idempotencyKey, 80);
  if (idempotencyKey.length < 12) throw Object.assign(new Error('A chave do pedido expirou. Atualize o carrinho e tente novamente.'), { status: 422 });
  const existing = statement('SELECT id FROM orders WHERE restaurant_id=? AND idempotency_key=?').get(RESTAURANT_ID, idempotencyKey);
  if (existing) return orderById(existing.id);
  const catalog = catalogFor(RESTAURANT_ID);
  let totalCents = 0;
  const pricedItems = itemsInput.map(entry => {
    const product = catalog.products.find(p => p.id === entry.productId && p.active === 1);
    if (!product) throw Object.assign(new Error('Um dos produtos não está disponível.'), { status: 409 });
    const priced = calculateItemPrice({ product, sizeKey: entry.sizeKey, crustKey: entry.crustKey, ingredients: entry.ingredients, quantity: entry.quantity, catalog: catalog.ingredients });
    const notes = cleanText(entry.notes, 300);
    totalCents += priced.linePriceCents;
    return { product, quantity: entry.quantity, notes, priced };
  });
  const orderId = 'BM-' + new Date().toISOString().slice(2,10).replace(/-/g,'') + '-' + randomBytes(3).toString('hex').toUpperCase();
  const trackingToken = randomBytes(24).toString('base64url');
  const now = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    const race = statement('SELECT id FROM orders WHERE restaurant_id=? AND idempotency_key=?').get(RESTAURANT_ID, idempotencyKey);
    if (race) { db.exec('ROLLBACK'); return orderById(race.id); }
    statement('INSERT INTO orders (id,restaurant_id,customer_name,phone,fulfillment,table_label,delivery_address,note,status,total_cents,tracking_token,idempotency_key,created_at,updated_at,customer_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(orderId, RESTAURANT_ID, customerName, phone, fulfillment, tableLabel, deliveryAddress, cleanText(payload.note,500), 'received', totalCents, trackingToken, idempotencyKey, now, now, customerId);
    const insertItem = statement('INSERT INTO order_items (id,order_id,product_id,product_name_snapshot,quantity,size_key,crust_key,ingredients_json,notes,unit_price_cents,snapshot_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
    for (const item of pricedItems) {
      const snapshot = { productId: item.product.id, type: item.product.type, name: item.product.name, size: item.priced.size, crust: item.priced.crust, ingredients: item.priced.ingredients, unitPriceCents: item.priced.unitPriceCents, widthCm: item.product.widthCm, heightCm: item.product.heightCm };
      insertItem.run(randomBytes(12).toString('hex'), orderId, item.product.id, item.product.name, item.quantity, item.priced.size.key, item.priced.crust?.key || '', JSON.stringify(item.priced.ingredients), item.notes, item.priced.unitPriceCents, JSON.stringify(snapshot));
    }
    statement('INSERT INTO order_status_history (order_id,status,changed_at,changed_by) VALUES (?,?,?,?)').run(orderId, 'received', now, 'cliente');
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  const created = orderById(orderId);
  emit(RESTAURANT_ID, { type: 'order-created', orderId });
  return created;
}
function dashboard() {
  const counts = statement('SELECT status,COUNT(*) AS count FROM orders WHERE restaurant_id=? GROUP BY status').all(RESTAURANT_ID);
  const today = new Date().toISOString().slice(0,10) + '%';
  const revenue = statement("SELECT COALESCE(SUM(total_cents),0) AS total FROM orders WHERE restaurant_id=? AND status NOT IN ('cancelled') AND created_at LIKE ?").get(RESTAURANT_ID,today).total;
  const popular = statement('SELECT oi.product_name_snapshot AS name,SUM(oi.quantity) AS quantity FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.restaurant_id=? AND o.status<>\'cancelled\' GROUP BY oi.product_id ORDER BY quantity DESC LIMIT 4').all(RESTAURANT_ID);
  return { counts: Object.fromEntries(Object.keys(STATUS).map(key => [key, counts.find(row => row.status === key)?.count || 0])), revenueCents: revenue, popular };
}
function listOrders() {
  return statement("SELECT id,customer_name AS customerName,phone,fulfillment,table_label AS tableLabel,delivery_address AS deliveryAddress,note,status,total_cents AS totalCents,created_at AS createdAt FROM orders WHERE restaurant_id=? ORDER BY CASE status WHEN 'received' THEN 0 WHEN 'confirmed' THEN 1 WHEN 'preparing' THEN 2 WHEN 'ready' THEN 3 ELSE 4 END,created_at DESC LIMIT 100").all(RESTAURANT_ID).map(order => ({ ...order, items: orderById(order.id).items }));
}
function patchProduct(productId, patch) {
  const product = statement('SELECT * FROM products WHERE id=? AND restaurant_id=?').get(productId, RESTAURANT_ID);
  if (!product) throw Object.assign(new Error('Produto não encontrado.'), { status: 404 });
  const name = patch.name === undefined ? product.name : cleanText(patch.name, 80);
  const description = patch.description === undefined ? product.description : cleanText(patch.description, 300);
  const price = patch.baseCents === undefined ? product.base_price_cents : Number(patch.baseCents);
  const active = patch.active === undefined ? product.active : (patch.active ? 1 : 0);
  if (name.length < 2 || !Number.isInteger(price) || price < 500 || price > 1000000) throw Object.assign(new Error('Confira o nome e o preço do produto.'), { status: 422 });
  statement('UPDATE products SET name=?,description=?,base_price_cents=?,active=?,updated_at=? WHERE id=? AND restaurant_id=?').run(name, description, price, active, new Date().toISOString(), productId, RESTAURANT_ID);
  emit(RESTAURANT_ID, { type: 'catalog-updated' });
  return catalogFor(RESTAURANT_ID, true).products.find(p => p.id === productId);
}
function patchRestaurantSettings(patch) {
  const current = statement('SELECT name,prep_minutes AS prepMinutes FROM restaurants WHERE id=?').get(RESTAURANT_ID);
  if (!current) throw Object.assign(new Error('Restaurante não encontrado.'), { status: 404 });
  const name = patch.name === undefined ? current.name : cleanText(patch.name, 80);
  const prepMinutes = patch.prepMinutes === undefined ? current.prepMinutes : Number(patch.prepMinutes);
  if (name.length < 2) throw Object.assign(new Error('O nome do restaurante precisa ter pelo menos 2 caracteres.'), { status: 422 });
  if (!Number.isInteger(prepMinutes) || prepMinutes < 5 || prepMinutes > 240) throw Object.assign(new Error('O tempo médio deve ficar entre 5 e 240 minutos.'), { status: 422 });
  statement('UPDATE restaurants SET name=?,prep_minutes=? WHERE id=?').run(name, prepMinutes, RESTAURANT_ID);
  emit(RESTAURANT_ID, { type: 'settings-updated' });
  return statement('SELECT id,name,slug,currency,prep_minutes AS prepMinutes FROM restaurants WHERE id=?').get(RESTAURANT_ID);
}
function patchIngredient(ingredientId, patch) {
  const current = statement('SELECT * FROM ingredients WHERE id=? AND restaurant_id=?').get(ingredientId, RESTAURANT_ID);
  if (!current) throw Object.assign(new Error('Ingrediente não encontrado.'), { status: 404 });
  const cents = patch.cents === undefined ? current.addon_cents : Number(patch.cents);
  const active = patch.active === undefined ? current.active : (patch.active ? 1 : 0);
  if (!Number.isInteger(cents) || cents < 0 || cents > 100000) throw Object.assign(new Error('O preço do adicional deve ser válido.'), { status: 422 });
  statement('UPDATE ingredients SET addon_cents=?,active=? WHERE id=? AND restaurant_id=?').run(cents, active, ingredientId, RESTAURANT_ID);
  emit(RESTAURANT_ID, { type: 'catalog-updated' });
  return catalogFor(RESTAURANT_ID, true).ingredients.find(i => i.id === ingredientId);
}
function createProduct(payload) {
  const name = cleanText(payload.name, 80);
  const description = cleanText(payload.description, 300);
  const type = payload.type;
  const categoryId = cleanText(payload.categoryId, 50);
  const baseCents = Number(payload.baseCents);
  if (name.length < 2 || !['pizza','burger','plate'].includes(type) || !Number.isInteger(baseCents) || baseCents < 500 || baseCents > 1000000) throw Object.assign(new Error('Preencha nome, tipo e preço-base válidos.'), { status: 422 });
  const category = statement('SELECT id FROM categories WHERE id=? AND restaurant_id=?').get(categoryId, RESTAURANT_ID);
  if (!category) throw Object.assign(new Error('Escolha uma categoria válida.'), { status: 422 });
  const now = new Date().toISOString();
  const id = slugify(name) + '-' + randomBytes(3).toString('hex');
  statement('INSERT INTO products (id,restaurant_id,category_id,name,description,type,base_price_cents,active,featured,prep_minutes,width_cm,depth_cm,height_cm,created_at,updated_at) VALUES (?,?,?,?,?,?,?,1,0,25,?,?,?, ?,?)')
    .run(id, RESTAURANT_ID, categoryId, name, description, type, baseCents, type === 'pizza' ? 30 : 12, type === 'pizza' ? 30 : 12, type === 'pizza' ? 2 : 10, now, now);
  emit(RESTAURANT_ID, { type: 'catalog-updated' });
  return catalogFor(RESTAURANT_ID, true).products.find(p => p.id === id);
}
function updateStatus(orderId, nextStatus) {
  if (!STATUS_FLOW.includes(nextStatus)) throw Object.assign(new Error('Estado de pedido inválido.'), { status: 422 });
  const order = statement('SELECT * FROM orders WHERE id=? AND restaurant_id=?').get(orderId, RESTAURANT_ID);
  if (!order) throw Object.assign(new Error('Pedido não encontrado.'), { status: 404 });
  if (order.status === nextStatus) return orderById(orderId);
  const transitions = { received: ['confirmed','cancelled'], confirmed: ['preparing','cancelled'], preparing: ['ready','cancelled'], ready: order.fulfillment === 'delivery' ? ['delivering'] : ['completed'], delivering: ['completed'], completed: [], cancelled: [] };
  if (!transitions[order.status]?.includes(nextStatus)) throw Object.assign(new Error('Essa mudança de status não está disponível.'), { status: 409 });
  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    statement('UPDATE orders SET status=?,updated_at=? WHERE id=? AND restaurant_id=?').run(nextStatus, now, orderId, RESTAURANT_ID);
    statement('INSERT INTO order_status_history (order_id,status,changed_at,changed_by) VALUES (?,?,?,?)').run(orderId, nextStatus, now, 'restaurante');
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  const updated = orderById(orderId);
  emit(RESTAURANT_ID, { type: 'order-updated', orderId });
  return updated;
}
async function serveStatic(pathname, response) {
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  const target = resolve(PUBLIC, relative);
  if (!target.startsWith(PUBLIC + sep) && target !== resolve(PUBLIC, 'index.html')) return send(response, 403, { error: 'Acesso negado.' });
  try {
    const data = await readFile(target);
    response.writeHead(200, { 'Content-Type': MIME[extname(target)] || 'application/octet-stream', 'Cache-Control': extname(target) === '.html' ? 'no-cache' : 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" });
    response.end(data);
  } catch { send(response, 404, { error: 'Arquivo não encontrado.' }); }
}
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://' + (request.headers.host || 'localhost'));
    const path = url.pathname;
    assertSameOrigin(request);
    if (path.startsWith('/api/')) {
      if (request.method === 'GET' && path === '/api/health') return send(response, 200, { ok: true, database: 'sqlite', demo: !IS_PROD });
      if (request.method === 'GET' && path === '/api/catalog') return send(response, 200, catalogFor());
      if (request.method === 'POST' && path === '/api/admin/login') {
        const limit = loginRateLimit(request);
        if (!limit.allowed) return send(response, 429, { error: 'Muitas tentativas. Aguarde antes de tentar novamente.' }, { 'Retry-After': String(limit.retryAfter) });
        const body = await bodyOf(request);
        if (typeof body.password !== 'string' || body.password.length > 1024 || !verifyPassword(body.password)) {
          recordLoginFailure(limit.key);
          return send(response, 401, { error: 'Não foi possível entrar. Confira os dados e tente novamente.' });
        }
        clearLoginFailures(limit.key);
        const token = sign({ role: 'admin', restaurantId: RESTAURANT_ID, exp: Date.now() + 8 * 60 * 60 * 1000 });
        return send(response, 200, { ok: true }, { 'Set-Cookie': 'mesa_session=' + encodeURIComponent(token) + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800' + (IS_PROD ? '; Secure' : '') });
      }
      if (request.method === 'POST' && path === '/api/admin/logout') {
        requireAdmin(request);
        return send(response, 200, { ok: true }, { 'Set-Cookie': 'mesa_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' + (IS_PROD ? '; Secure' : '') });
      }
      if (request.method === 'POST' && path === '/api/customer/register') {
        const limit = loginRateLimit(request); if (!limit.allowed) return send(response,429,{error:'Muitas tentativas. Aguarde antes de tentar novamente.'},{'Retry-After':String(limit.retryAfter)});
        const customer = createCustomer(await bodyOf(request)); clearLoginFailures(limit.key);
        return send(response,201,{customer},{'Set-Cookie':customerSessionCookie(issueCustomerSession(customer))});
      }
      if (request.method === 'POST' && path === '/api/customer/login') {
        const limit = loginRateLimit(request); if (!limit.allowed) return send(response,429,{error:'Muitas tentativas. Aguarde antes de tentar novamente.'},{'Retry-After':String(limit.retryAfter)});
        const body = await bodyOf(request), email = normalizeEmail(body.email), customer = statement('SELECT * FROM customers WHERE email=?').get(email);
        if (!customer || typeof body.password !== 'string' || body.password.length > 128 || !verifyCustomerPassword(body.password,customer)) { recordLoginFailure(limit.key); return send(response,401,{error:'E-mail ou senha inválidos.'}); }
        clearLoginFailures(limit.key); const safe = {id:customer.id,name:customer.name,email:customer.email,phone:customer.phone};
        return send(response,200,{customer:safe},{'Set-Cookie':customerSessionCookie(issueCustomerSession(safe))});
      }
      if (request.method === 'POST' && path === '/api/customer/logout') { requireCustomer(request); return send(response,200,{ok:true},{'Set-Cookie':customerSessionCookie('',0)}); }
      if (request.method === 'GET' && path === '/api/customer/me') return send(response,200,{customer:requireCustomer(request).customer});
      if (request.method === 'GET' && path === '/api/customer/orders') return send(response,200,{orders:listCustomerOrders(requireCustomer(request).customer.id)});
      if (request.method === 'GET' && path === '/api/admin/me') { const admin = requireAdmin(request); return send(response, 200, { authenticated: true, restaurantId: admin.restaurantId }); }
      if (request.method === 'GET' && path === '/api/admin/events') { const admin = requireAdmin(request); return addStream(admin.restaurantId, response); }
      if (path.startsWith('/api/admin/')) requireAdmin(request);
      if (request.method === 'GET' && path === '/api/admin/dashboard') return send(response, 200, dashboard());
      if (request.method === 'GET' && path === '/api/admin/orders') return send(response, 200, { orders: listOrders() });
      if (request.method === 'GET' && path === '/api/admin/catalog') return send(response, 200, catalogFor(RESTAURANT_ID, true));
      if (request.method === 'GET' && path === '/api/admin/settings') {
        return send(response, 200, { restaurant: statement('SELECT id,name,slug,currency,prep_minutes AS prepMinutes FROM restaurants WHERE id=?').get(RESTAURANT_ID) });
      }
      if (request.method === 'PATCH' && path === '/api/admin/settings') {
        return send(response, 200, { restaurant: patchRestaurantSettings(await bodyOf(request)) });
      }
      if (request.method === 'PATCH' && path.startsWith('/api/admin/orders/')) {
        const id = path.slice('/api/admin/orders/'.length);
        const body = await bodyOf(request);
        return send(response, 200, { order: updateStatus(id, body.status) });
      }
      if (request.method === 'PATCH' && path.startsWith('/api/admin/products/')) {
        const id = path.slice('/api/admin/products/'.length);
        return send(response, 200, { product: patchProduct(id, await bodyOf(request)) });
      }
      if (request.method === 'POST' && path === '/api/admin/products') return send(response, 201, { product: createProduct(await bodyOf(request)) });
      if (request.method === 'PATCH' && path.startsWith('/api/admin/ingredients/')) {
        const id = path.slice('/api/admin/ingredients/'.length);
        return send(response, 200, { ingredient: patchIngredient(id, await bodyOf(request)) });
      }
      if (request.method === 'POST' && path === '/api/orders') {
        const customerSession = optionalCustomer(request);
        const order = createOrder(await bodyOf(request), customerSession?.customerId || null);
        return send(response, 201, { order, trackingUrl: '/#pedido/' + order.trackingToken });
      }
      if (request.method === 'GET' && path.startsWith('/api/tracking/')) {
        const token = path.slice('/api/tracking/'.length);
        const row = statement('SELECT id,customer_id AS customerId FROM orders WHERE tracking_token=? AND restaurant_id=?').get(token, RESTAURANT_ID);
        if (!row) return send(response, 404, { error: 'Pedido não encontrado.' });
        const customerSession = optionalCustomer(request);
        if (row.customerId && (!customerSession || customerSession.customerId !== row.customerId)) return send(response, 404, { error: 'Pedido não encontrado.' });
        return send(response, 200, { order: orderById(row.id) });
      }
      return send(response, 404, { error: 'Rota da API não encontrada.' });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return send(response, 405, { error: 'Método não permitido.' });
    return await serveStatic(path, response);
  } catch (error) { return fail(response, error); }
});
server.listen(PORT, '0.0.0.0', () => {
  console.log('Mesa Studio disponível em http://localhost:' + PORT);
  if (!process.env.ADMIN_PASSWORD) console.log('Acesso de demonstração ao painel: senha mesa-demo (configure ADMIN_PASSWORD para alterar).');
});
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => { server.close(() => { db.close(); process.exit(0); }); server.closeAllConnections(); });
