import { randomBytes, createHmac, timingSafeEqual, scryptSync } from 'node:crypto';
import { query, withTransaction } from '../src/db/postgres.mjs';
import { calculateItemPrice, CRUST_OPTIONS, inferIngredientVisual, SIZE_OPTIONS, STATUS, STATUS_FLOW, slugify } from '../src/catalog.mjs';
import { verifyTotp } from '../src/auth-totp.mjs';

const RESTAURANT_ID = 'rest-bela-mesa';
const IS_PROD = process.env.NODE_ENV === 'production';
const SECRET = process.env.APP_SECRET || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_TOTP_SECRET = String(process.env.ADMIN_TOTP_SECRET || '').replace(/\s+/g, '').toUpperCase();
const ADMIN_COOKIE = IS_PROD ? '__Host-menuza_session' : 'mesa_session';
const CUSTOMER_COOKIE = 'menuza_customer_session';
const SESSION_MS = 2 * 60 * 60 * 1000;
const MAX_BODY = 64 * 1024;

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const clean = (value, max = 240) => String(value ?? '').trim().slice(0, max);
const normalizeEmail = value => clean(value, 254).toLowerCase();
const normalizeCoupon = value => clean(value, 32).toUpperCase().replace(/\s+/g, '');
const json = (res, status, body, headers = {}) => {
  for (const [key, value] of Object.entries({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    ...(IS_PROD ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}),
    ...headers
  })) res.setHeader(key, value);
  return res.status(status).json(body);
};
async function bodyOf(req, limit = MAX_BODY) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = '';
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > limit) throw fail('A solicitação é grande demais.', 413);
    raw += chunk.toString('utf8');
  }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw fail('JSON inválido.', 400); }
}
function sign(payload) {
  if (SECRET.length < 32) throw fail('APP_SECRET precisa ter pelo menos 32 caracteres.', 503);
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}
function session(req, cookieName) {
  const raw = String(req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(cookieName + '='));
  if (!raw) return null;
  try {
    const [body, signature] = decodeURIComponent(raw.slice(cookieName.length + 1)).split('.');
    if (!body || !signature || SECRET.length < 32) return null;
    const expected = createHmac('sha256', SECRET).update(body).digest();
    const given = Buffer.from(signature, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return parsed.exp > Date.now() ? parsed : null;
  } catch { return null; }
}
function cookie(name, value, maxAge) {
  return name + '=' + encodeURIComponent(value) + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + maxAge + (IS_PROD ? '; Secure' : '');
}
function requireAdmin(req) {
  const value = session(req, ADMIN_COOKIE);
  if (!value || value.role !== 'admin' || value.restaurantId !== RESTAURANT_ID) throw fail('Entre no painel para continuar.', 401);
  return value;
}
async function customer(req) {
  const value = session(req, CUSTOMER_COOKIE);
  if (!value || value.role !== 'customer' || !value.customerId) return null;
  const result = await query('SELECT id,name,email,phone FROM customers WHERE id=$1', [value.customerId]);
  return result.rows[0] ? { ...value, customer: result.rows[0] } : null;
}
async function requireCustomer(req) {
  const value = await customer(req);
  if (!value) throw fail('Entre na sua conta para continuar.', 401);
  return value;
}
function passwordHash(password, salt) { return scryptSync(password, salt, 64).toString('hex'); }
function verifyPassword(password, row) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const actual = Buffer.from(passwordHash(password, row.password_salt), 'hex');
  const expected = Buffer.from(row.password_hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function hasHoneypot(body) {
  return ['website', 'companyWebsite', 'faxNumber'].some(key => typeof body[key] === 'string' && body[key].trim());
}
function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length < 512) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}
async function limit(req, key, maximum, windowMs) {
  const now = Date.now();
  const bucket = createHmac('sha256', SECRET || 'menuza-local-rate-limit').update(key + ':' + clientIp(req)).digest('hex');
  const row = await query('SELECT timestamps_json FROM security_rate_buckets WHERE bucket_key=$1', [bucket]);
  let times = [];
  try { times = JSON.parse(row.rows[0]?.timestamps_json || '[]').filter(v => Number.isSafeInteger(v) && v > now - windowMs && v <= now); } catch {}
  if (times.length >= maximum) return Math.max(1, Math.ceil((times[0] + windowMs - now) / 1000));
  times.push(now);
  await query(`INSERT INTO security_rate_buckets (bucket_key,timestamps_json,updated_at) VALUES ($1,$2,$3)
    ON CONFLICT (bucket_key) DO UPDATE SET timestamps_json=EXCLUDED.timestamps_json,updated_at=EXCLUDED.updated_at`, [bucket, JSON.stringify(times), now]);
  return 0;
}
async function catalogFor(admin = false) {
  await query("ALTER TABLE products ADD COLUMN IF NOT EXISTS ingredient_ids_json TEXT NOT NULL DEFAULT '[]'");
  await query("ALTER TABLE products ADD COLUMN IF NOT EXISTS default_ingredient_ids_json TEXT NOT NULL DEFAULT '[]'");
  await query('ALTER TABLE products ADD COLUMN IF NOT EXISTS ingredients_configured INTEGER NOT NULL DEFAULT 0');
  await query("ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT NOT NULL DEFAULT ''");
  const active = admin ? '' : ' AND active=1';
  const [restaurant, categories, products, ingredients, comboRows] = await Promise.all([
    query('SELECT id,name,slug,currency,prep_minutes AS "prepMinutes",logo_url AS "logoUrl" FROM restaurants WHERE id=$1', [RESTAURANT_ID]),
    query('SELECT id,name,slug,sort_order AS "sortOrder" FROM categories WHERE restaurant_id=$1 ORDER BY sort_order', [RESTAURANT_ID]),
    query('SELECT id,category_id AS "categoryId",name,description,type,base_price_cents AS "baseCents",active,available,featured,prep_minutes AS "prepMinutes",model_url AS "modelUrl",width_cm AS "widthCm",depth_cm AS "depthCm",height_cm AS "heightCm",ingredient_ids_json AS "ingredientIdsJson",default_ingredient_ids_json AS "defaultIngredientIdsJson",ingredients_configured AS "ingredientsConfigured",image_url AS "imageUrl",updated_at AS "updatedAt" FROM products WHERE restaurant_id=$1'+active+' ORDER BY featured DESC,category_id,name', [RESTAURANT_ID]),
    query('SELECT id,name,type,group_name AS "groupName",addon_cents AS cents,included_by_default AS included,active,sort_order AS "sortOrder" FROM ingredients WHERE restaurant_id=$1'+active+' ORDER BY sort_order', [RESTAURANT_ID]),
    query('SELECT id,name,description,price_cents AS "priceCents",items_json AS "itemsJson",active,created_at AS "createdAt",updated_at AS "updatedAt" FROM combos WHERE restaurant_id=$1'+active+' ORDER BY created_at DESC', [RESTAURANT_ID])
  ]);
  const productRows = products.rows.map(product => {
    let ingredientIds = [], defaultIngredientIds = [];
    try { ingredientIds = JSON.parse(product.ingredientIdsJson || '[]'); } catch {}
    try { defaultIngredientIds = JSON.parse(product.defaultIngredientIdsJson || '[]'); } catch {}
    return {
      ...product,
      ingredientIds: Array.isArray(ingredientIds) ? ingredientIds.filter(id => typeof id === 'string').slice(0, 40) : [],
      defaultIngredientIds: Array.isArray(defaultIngredientIds) ? defaultIngredientIds.filter(id => typeof id === 'string').slice(0, 40) : [],
      ingredientsConfigured: Number(product.ingredientsConfigured) === 1
    };
  });
  const ingredientsOut = ingredients.rows.map(i => ({ ...i, included: Number(i.included) === 1 || i.included === true, visual: inferIngredientVisual(i) }));
  const combos = comboRows.rows.map(row => {
    let entries = [];
    try { entries = JSON.parse(row.itemsJson); } catch {}
    return { id: row.id, name: row.name, description: row.description, priceCents: row.priceCents, active: Number(row.active), createdAt: row.createdAt, updatedAt: row.updatedAt,
      items: entries.map(entry => { const p = productRows.find(x => x.id === entry.productId); return p ? { productId: p.id, name: p.name, quantity: entry.quantity, baseCents: p.baseCents } : null; }).filter(Boolean) };
  });
  return { restaurant: restaurant.rows[0] || null, categories: categories.rows, products: productRows, ingredients: ingredientsOut, combos, sizes: SIZE_OPTIONS, crusts: CRUST_OPTIONS };
}
async function validateProductIngredientIds(value, type) {
  if (!Array.isArray(value) || value.length > 40 || value.some(id => typeof id !== 'string' || !id.trim()) || new Set(value).size !== value.length) {
    throw fail('Selecione ingredientes válidos para o produto.', 422);
  }
  if (!value.length) return [];
  const result = await query('SELECT id FROM ingredients WHERE restaurant_id=$1 AND type=$2 AND active=1 AND id=ANY($3::text[])', [RESTAURANT_ID, type, value]);
  if (result.rows.length !== value.length) throw fail('Um dos ingredientes selecionados não está ativo ou não pertence a esse tipo de produto.', 422);
  return value;
}
async function orderById(id) {
  const result = await query(`SELECT o.id,o.restaurant_id AS "restaurantId",o.customer_name AS "customerName",o.phone,o.fulfillment,o.table_label AS "tableLabel",o.delivery_address AS "deliveryAddress",o.note,o.status,o.total_cents AS "totalCents",o.coupon_code AS "couponCode",o.discount_cents AS "discountCents",o.tracking_token AS "trackingToken",o.created_at AS "createdAt",o.updated_at AS "updatedAt",r.prep_minutes AS "prepMinutes"
    FROM orders o JOIN restaurants r ON r.id=o.restaurant_id WHERE o.id=$1 AND o.restaurant_id=$2`, [id, RESTAURANT_ID]);
  const order = result.rows[0];
  if (!order) return null;
  const [items, history] = await Promise.all([
    query('SELECT product_id AS "productId",product_name_snapshot AS name,quantity,size_key AS "sizeKey",crust_key AS "crustKey",ingredients_json AS "ingredientsJson",notes,unit_price_cents AS "unitPriceCents",snapshot_json AS "snapshotJson" FROM order_items WHERE order_id=$1 ORDER BY id', [id]),
    query('SELECT status,changed_at AS "changedAt",changed_by AS "changedBy" FROM order_status_history WHERE order_id=$1 ORDER BY id', [id])
  ]);
  return { ...order, items: items.rows.map(i => ({ productId:i.productId,name:i.name,quantity:i.quantity,sizeKey:i.sizeKey,crustKey:i.crustKey,ingredients:JSON.parse(i.ingredientsJson),notes:i.notes,unitPriceCents:i.unitPriceCents,snapshot:JSON.parse(i.snapshotJson) })), history: history.rows };
}
async function coupons(code) {
  return (await query('SELECT * FROM coupons WHERE restaurant_id=$1 AND code=$2', [RESTAURANT_ID, normalizeCoupon(code)])).rows[0] || null;
}
function couponDiscount(c, subtotal) {
  const now = Date.now();
  if (!c || Number(c.active) !== 1) throw fail('Cupom inválido ou inativo.', 422);
  if (c.starts_at && now < Date.parse(c.starts_at)) throw fail('Esse cupom ainda não está válido.', 422);
  if (c.expires_at && now > Date.parse(c.expires_at)) throw fail('Esse cupom expirou.', 422);
  if (c.max_uses !== null && Number(c.used_count) >= Number(c.max_uses)) throw fail('Esse cupom atingiu o limite de utilizações.', 422);
  if (subtotal < Number(c.minimum_subtotal_cents)) throw fail('O pedido mínimo para esse cupom não foi atingido.', 422);
  return Math.min(subtotal, c.discount_type === 'percent' ? Math.round(subtotal * Number(c.discount_value) / 100) : Number(c.discount_value));
}
async function priceItems(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 20) throw fail('O carrinho está vazio ou tem itens demais.', 422);
  const cat = await catalogFor(false);
  let subtotal = 0;
  const priced = [];
  for (const entry of input) {
    if (entry && typeof entry.comboId === 'string') {
      const row = (await query('SELECT id,name,description,price_cents AS "priceCents",items_json AS "itemsJson",active FROM combos WHERE id=$1 AND restaurant_id=$2', [entry.comboId, RESTAURANT_ID])).rows[0];
      const quantity = Number(entry.quantity);
      if (!row || Number(row.active) !== 1) throw fail('Um dos combos está indisponível.', 409);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) throw fail('A quantidade do combo é inválida.', 422);
      let comboItems = []; try { comboItems = JSON.parse(row.itemsJson); } catch {}
      if (comboItems.length < 2) throw fail('Este combo precisa ser revisado pelo restaurante.', 409);
      const chosen = comboItems.map(i => ({ ...i, product: cat.products.find(p => p.id === i.productId && Number(p.active) === 1 && Number(p.available) === 1) }));
      if (chosen.some(i => !i.product)) throw fail('Um produto de um combo está indisponível. Atualize o cardápio.', 409);
      const p = { id:row.id,name:row.name,description:row.description,type:'plate',widthCm:null,heightCm:null };
      const unit = Number(row.priceCents);
      subtotal += unit * quantity;
      priced.push({ product:p, quantity, notes:clean(entry.notes,300), combo:true, priced:{ unitPriceCents:unit,linePriceCents:unit*quantity,size:{key:'combo',label:'Combo'},crust:null,ingredients:[],comboItems:chosen.map(i=>({productId:i.product.id,name:i.product.name,quantity:i.quantity})) } });
      continue;
    }
    const product = cat.products.find(p => p.id === entry?.productId && Number(p.active) === 1 && Number(p.available) === 1);
    if (!product) throw fail('Um dos produtos está indisponível ou esgotado no momento.', 409);
    let pricedItem;
    const productIngredientIds = new Set([...(product.ingredientIds || []), ...(product.defaultIngredientIds || [])]);
    const productIngredientCatalog = product.ingredientsConfigured
      ? cat.ingredients.filter(ingredient => productIngredientIds.has(ingredient.id)).map(ingredient => ({
          ...ingredient,
          included: (product.defaultIngredientIds || []).includes(ingredient.id)
        }))
      : cat.ingredients;
    try { pricedItem = calculateItemPrice({ product, sizeKey:entry.sizeKey, crustKey:entry.crustKey, ingredients:entry.ingredients, quantity:Number(entry.quantity), catalog:productIngredientCatalog }); }
    catch (error) { throw fail(error.message,422); }
    subtotal += pricedItem.linePriceCents;
    priced.push({ product, quantity:Number(entry.quantity), notes:clean(entry.notes,300), priced:pricedItem });
  }
  return { subtotal, priced };
}
async function createOrder(body, customerId) {
  const customerName=clean(body.customerName,100), phone=clean(body.phone,30), fulfillment=body.fulfillment;
  if (customerName.length<2) throw fail('Informe seu nome.',422);
  if (phone.replace(/\D/g,'').length<8) throw fail('Informe um telefone válido.',422);
  if (!['table','pickup','delivery'].includes(fulfillment)) throw fail('Escolha como deseja receber o pedido.',422);
  const tableLabel=fulfillment==='table'?clean(body.tableLabel,30):'';
  const deliveryAddress=fulfillment==='delivery'?clean(body.deliveryAddress,300):'';
  if (fulfillment==='table'&&!/^\d{1,3}$/.test(tableLabel)) throw fail('Selecione uma mesa válida do salão.',422);
  if (fulfillment==='delivery'&&deliveryAddress.length<8) throw fail('Informe o endereço de entrega.',422);
  const key=clean(body.idempotencyKey,80);
  if (key.length<12) throw fail('A chave do pedido expirou. Atualize o carrinho e tente novamente.',422);
  const {subtotal,priced}=await priceItems(body.items);
  const code=normalizeCoupon(body.couponCode);
  let discount=0, coupon=null;
  if (code) { coupon=await coupons(code); discount=couponDiscount(coupon,subtotal); }
  const total=Math.max(0,subtotal-discount);
  const id='BM-'+new Date().toISOString().slice(2,10).replace(/-/g,'')+'-'+randomBytes(3).toString('hex').toUpperCase();
  const token=randomBytes(24).toString('base64url'), now=new Date().toISOString();
  await withTransaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[RESTAURANT_ID+':'+key]);
    const duplicate=await client.query('SELECT id,customer_id AS "customerId" FROM orders WHERE restaurant_id=$1 AND idempotency_key=$2 FOR UPDATE',[RESTAURANT_ID,key]);
    if (duplicate.rows[0]) {
      if ((duplicate.rows[0].customerId||null)!==(customerId||null)) throw fail('Esta chave de pedido já foi utilizada.',409);
      return;
    }
    let table=null;
    if (fulfillment==='table') {
      const tr=await client.query('SELECT id,table_number AS number,status,qr_token AS "qrToken" FROM restaurant_tables WHERE restaurant_id=$1 AND table_number=$2 FOR UPDATE',[RESTAURANT_ID,Number(tableLabel)]);
      table=tr.rows[0];
      if (!table) throw fail('Essa mesa não está disponível. Atualize a lista e escolha outra.',409);
      if (body.tableQrToken && table.qrToken!==body.tableQrToken) throw fail('O QR Code não corresponde a esta mesa. Escaneie novamente.',403);
      if (!body.tableQrToken && table.status!=='free') throw fail('Essa mesa não está mais livre. Atualize a lista e escolha outra.',409);
      if (table.status==='cleaning') throw fail('Esta mesa está aguardando limpeza.',409);
    }
    await client.query(`INSERT INTO orders (id,restaurant_id,customer_name,phone,fulfillment,table_label,delivery_address,note,status,total_cents,tracking_token,idempotency_key,created_at,updated_at,customer_id,coupon_code,discount_cents)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'received',$9,$10,$11,$12,$12,$13,$14,$15)`,
      [id,RESTAURANT_ID,customerName,phone,fulfillment,tableLabel,deliveryAddress,clean(body.note,500),total,token,key,now,customerId||null,code,discount]);
    if (coupon) {
      const used=await client.query(`UPDATE coupons SET used_count=used_count+1 WHERE id=$1 AND restaurant_id=$2 AND active=1 AND (max_uses IS NULL OR used_count<max_uses)`,[coupon.id,RESTAURANT_ID]);
      if (!used.rowCount) throw fail('Esse cupom atingiu o limite de utilizações.',422);
    }
    for (const item of priced) {
      const snapshot={productId:item.product.id,type:item.combo?'combo':item.product.type,name:item.product.name,size:item.priced.size,crust:item.priced.crust,ingredients:item.priced.ingredients,comboItems:item.priced.comboItems||[],unitPriceCents:item.priced.unitPriceCents,widthCm:item.product.widthCm,heightCm:item.product.heightCm};
      await client.query(`INSERT INTO order_items (id,order_id,product_id,product_name_snapshot,quantity,size_key,crust_key,ingredients_json,notes,unit_price_cents,snapshot_json)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [randomBytes(12).toString('hex'),id,item.product.id,item.product.name,item.quantity,item.priced.size.key,item.priced.crust?.key||'',JSON.stringify(item.priced.ingredients),item.notes,item.priced.unitPriceCents,JSON.stringify(snapshot)]);
    }
    await client.query('INSERT INTO order_status_history (order_id,status,changed_at,changed_by) VALUES ($1,$2,$3,$4)',[id,'received',now,'cliente']);
    if (table?.status==='free') await client.query(`UPDATE restaurant_tables SET status='occupied',updated_at=$1 WHERE id=$2 AND status='free'`,[now,table.id]);
  });
  const duplicate=(await query('SELECT id FROM orders WHERE restaurant_id=$1 AND idempotency_key=$2',[RESTAURANT_ID,key])).rows[0];
  const order=await orderById(duplicate?.id||id);
  return order;
}
async function updateOrderStatus(id, next) {
  if (!STATUS_FLOW.includes(next)) throw fail('Estado de pedido inválido.',422);
  await withTransaction(async client => {
    const found=await client.query('SELECT * FROM orders WHERE id=$1 AND restaurant_id=$2 FOR UPDATE',[id,RESTAURANT_ID]);
    const order=found.rows[0];
    if (!order) throw fail('Pedido não encontrado.',404);
    if (order.status===next) return;
    const transitions={received:['confirmed','cancelled'],confirmed:['preparing','cancelled'],preparing:['ready','cancelled'],ready:order.fulfillment==='delivery'?['delivering']:['completed'],delivering:['completed'],completed:[],cancelled:[]};
    if (!transitions[order.status]?.includes(next)) throw fail('Essa mudança de status não está disponível.',409);
    const now=new Date().toISOString();
    await client.query('UPDATE orders SET status=$1,updated_at=$2 WHERE id=$3',[next,now,id]);
    await client.query('INSERT INTO order_status_history (order_id,status,changed_at,changed_by) VALUES ($1,$2,$3,$4)',[id,next,now,'restaurante']);
    if (order.fulfillment==='table'&&['completed','cancelled'].includes(next)&&order.table_label) await client.query(`UPDATE restaurant_tables SET status='cleaning',updated_at=$1 WHERE restaurant_id=$2 AND table_number=$3`,[now,RESTAURANT_ID,Number(order.table_label)]);
  });
  return await orderById(id);
}
async function saveCoupon(body,id=null) {
  const code=normalizeCoupon(body.code), type=body.discountType, value=Number(body.discountValue), minimum=Number(body.minimumSubtotalCents??0);
  const maxUses=body.maxUses===''||body.maxUses==null?null:Number(body.maxUses);
  const starts=body.startsAt?new Date(body.startsAt):null, expires=body.expiresAt?new Date(body.expiresAt):null;
  if (!/^[A-Z0-9_-]{3,32}$/.test(code)) throw fail('Use um código de 3 a 32 caracteres: letras, números, hífen ou sublinhado.',422);
  if (!['percent','fixed'].includes(type)||!Number.isInteger(value)||value<1||(type==='percent'&&value>100)||(type==='fixed'&&value>1000000)) throw fail('Confira o tipo e o valor do desconto.',422);
  if (!Number.isInteger(minimum)||minimum<0||minimum>10000000||(maxUses!==null&&(!Number.isInteger(maxUses)||maxUses<1))) throw fail('Confira o pedido mínimo e o limite de usos.',422);
  if (starts&&!Number.isFinite(starts.getTime())||expires&&!Number.isFinite(expires.getTime())||(starts&&expires&&expires<starts)) throw fail('Confira as datas do cupom.',422);
  const exists=await query('SELECT id FROM coupons WHERE restaurant_id=$1 AND code=$2 AND ($3::text IS NULL OR id<>$3)',[RESTAURANT_ID,code,id]);
  if (exists.rowCount) throw fail('Já existe um cupom com esse código.',409);
  const now=new Date().toISOString();
  let result;
  if (id) result=await query(`UPDATE coupons SET code=$1,discount_type=$2,discount_value=$3,minimum_subtotal_cents=$4,starts_at=$5,expires_at=$6,max_uses=$7,active=$8 WHERE id=$9 AND restaurant_id=$10 RETURNING *`,[code,type,value,minimum,starts?.toISOString()||null,expires?.toISOString()||null,maxUses,body.active===undefined?1:(body.active?1:0),id,RESTAURANT_ID]);
  else result=await query(`INSERT INTO coupons (id,restaurant_id,code,discount_type,discount_value,minimum_subtotal_cents,starts_at,expires_at,max_uses,active,created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,['cpn_'+randomBytes(12).toString('hex'),RESTAURANT_ID,code,type,value,minimum,starts?.toISOString()||null,expires?.toISOString()||null,maxUses,body.active===undefined?1:(body.active?1:0),now]);
  if (!result.rows[0]) throw fail('Cupom não encontrado.',404);
  return couponPublic(result.rows[0]);
}
function couponPublic(row) { return {id:row.id,code:row.code,discountType:row.discount_type,discountValue:Number(row.discount_value),minimumSubtotalCents:Number(row.minimum_subtotal_cents),startsAt:row.starts_at,expiresAt:row.expires_at,maxUses:row.max_uses===null?null:Number(row.max_uses),usedCount:Number(row.used_count),active:Number(row.active)===1,createdAt:row.created_at}; }
async function saveCombo(body,id=null) {
  const name=clean(body.name,80), description=clean(body.description,240), price=Number(body.priceCents), entries=Array.isArray(body.items)?body.items:[];
  if (name.length<2||!Number.isInteger(price)||price<100||price>1000000) throw fail('Informe nome e preço válido para o combo.',422);
  if (entries.length<2||entries.length>6) throw fail('Um combo precisa ter de 2 a 6 produtos.',422);
  const items=[];
  for (const e of entries) {
    const productId=clean(e?.productId,100), quantity=Number(e?.quantity??1);
    const product=(await query('SELECT id,base_price_cents AS price FROM products WHERE id=$1 AND restaurant_id=$2 AND active=1 AND available=1',[productId,RESTAURANT_ID])).rows[0];
    if (!product||!Number.isInteger(quantity)||quantity<1||quantity>5) throw fail('Selecione produtos ativos e quantidades válidas.',422);
    items.push({productId,quantity,price:Number(product.price)});
  }
  if (price>=items.reduce((sum,e)=>sum+e.price*e.quantity,0)) throw fail('O preço promocional deve ser menor que a soma dos preços-base dos produtos.',422);
  const now=new Date().toISOString(), jsonItems=JSON.stringify(items.map(({productId,quantity})=>({productId,quantity})));
  const result=id
    ? await query('UPDATE combos SET name=$1,description=$2,price_cents=$3,items_json=$4,active=$5,updated_at=$6 WHERE id=$7 AND restaurant_id=$8 RETURNING id',[name,description,price,jsonItems,body.active===undefined?1:(body.active?1:0),now,id,RESTAURANT_ID])
    : await query('INSERT INTO combos (id,restaurant_id,name,description,price_cents,items_json,active,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,1,$7,$7) RETURNING id',['cmb_'+randomBytes(12).toString('hex'),RESTAURANT_ID,name,description,price,jsonItems,now]);
  if (!result.rowCount) throw fail('Combo não encontrado.',404);
  return (await catalogFor(true)).combos.find(c=>c.id===result.rows[0].id);
}


async function ensureFiscalSchema(){
  await query(`CREATE TABLE IF NOT EXISTS fiscal_profiles (
    restaurant_id TEXT PRIMARY KEY, cnpj TEXT NOT NULL DEFAULT '', legal_name TEXT NOT NULL DEFAULT '',
    trade_name TEXT NOT NULL DEFAULT '', state_registration TEXT NOT NULL DEFAULT '',
    municipal_registration TEXT NOT NULL DEFAULT '', tax_regime TEXT NOT NULL DEFAULT 'simples_nacional',
    company_size TEXT NOT NULL DEFAULT 'ME', legal_nature TEXT NOT NULL DEFAULT '',
    opening_date DATE, simples_start_date DATE, capital_cents BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await query(`CREATE TABLE IF NOT EXISTS fiscal_expenses (
    id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL, expense_date DATE NOT NULL,
    description TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'outros',
    supplier_name TEXT NOT NULL DEFAULT '', supplier_cnpj TEXT NOT NULL DEFAULT '',
    document_number TEXT NOT NULL DEFAULT '', amount_cents BIGINT NOT NULL CHECK(amount_cents>0),
    payment_method TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await query(`CREATE TABLE IF NOT EXISTS fiscal_documents (
    id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL, direction TEXT NOT NULL CHECK(direction IN ('received','issued')),
    document_type TEXT NOT NULL, document_number TEXT NOT NULL DEFAULT '', issuer_name TEXT NOT NULL DEFAULT '',
    issuer_cnpj TEXT NOT NULL DEFAULT '', document_date DATE, amount_cents BIGINT NOT NULL DEFAULT 0,
    file_name TEXT NOT NULL, mime_type TEXT NOT NULL, content_base64 TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await query(`INSERT INTO fiscal_profiles
    (restaurant_id,cnpj,legal_name,trade_name,tax_regime,company_size,legal_nature,opening_date,simples_start_date,capital_cents)
    VALUES ($1,$2,$3,$4,'simples_nacional','ME',$5,$6,$6,3000000)
    ON CONFLICT (restaurant_id) DO NOTHING`,
    [RESTAURANT_ID,'60908509000169','Galileu Pizzas e Lanches LTDA','Galileu Pizzas e Lanches','Sociedade Empresária Limitada','2025-05-20']);
}
function fiscalMonth(value){
  const month=String(value||'').trim();
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw fail('Informe uma competência válida (AAAA-MM).',422);
  return {month,start:month+'-01',end:new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),1).toISOString().slice(0,10)};
}
async function fiscalReport(monthValue){
  const {month,start,end,startUtc,endUtc}=fiscalMonth(monthValue);
  const [sales,byFulfillment,expenses,documents,orderRows]=await Promise.all([
    query(`SELECT COUNT(*) FILTER (WHERE status<>'cancelled')::int AS orders,
      COUNT(*) FILTER (WHERE status='cancelled')::int AS cancelled,
      COALESCE(SUM(total_cents + COALESCE(discount_cents,0)) FILTER (WHERE status<>'cancelled'),0)::bigint AS gross_cents,
      COALESCE(SUM(discount_cents) FILTER (WHERE status<>'cancelled'),0)::bigint AS discounts_cents
      FROM orders WHERE restaurant_id=$1 AND created_at >= $2 AND created_at < $3`,[RESTAURANT_ID,startUtc,endUtc]),
    query(`SELECT fulfillment,COUNT(*)::int AS orders,COALESCE(SUM(total_cents),0)::bigint AS total_cents
      FROM orders WHERE restaurant_id=$1 AND status<>'cancelled' AND created_at >= $2 AND created_at < $3
      GROUP BY fulfillment ORDER BY fulfillment`,[RESTAURANT_ID,startUtc,endUtc]),
    query('SELECT COALESCE(SUM(amount_cents),0)::bigint AS total_cents,COUNT(*)::int AS count FROM fiscal_expenses WHERE restaurant_id=$1 AND expense_date >= $2::date AND expense_date < $3::date',[RESTAURANT_ID,startUtc,endUtc]),
    query('SELECT direction,COUNT(*)::int AS count FROM fiscal_documents WHERE restaurant_id=$1 AND document_date >= $2::date AND document_date < $3::date GROUP BY direction',[RESTAURANT_ID,startUtc,endUtc]),
    query(`SELECT id,TO_CHAR(created_at AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD HH24:MI:SS') AS date,
      customer_name AS customer,fulfillment,status,total_cents::bigint AS net_cents,
      COALESCE(discount_cents,0)::bigint AS discount_cents,
      (total_cents+COALESCE(discount_cents,0))::bigint AS gross_cents
      FROM orders WHERE restaurant_id=$1 AND created_at >= $2 AND created_at < $3
      ORDER BY created_at,id LIMIT 10000`,[RESTAURANT_ID,start,end])
  ]);
  const s=sales.rows[0], gross=Number(s.gross_cents||0), discounts=Number(s.discounts_cents||0);
  return {month,period:{start,end},sales:{orders:Number(s.orders),cancelled:Number(s.cancelled),grossCents:gross,discountsCents:discounts,netCents:gross-discounts,records:orderRows.rows.map(r=>({id:r.id,date:r.date,customer:r.customer,fulfillment:r.fulfillment,status:r.status,grossCents:Number(r.gross_cents),discountCents:Number(r.discount_cents),netCents:Number(r.net_cents)}))},byFulfillment:byFulfillment.rows.map(r=>({type:r.fulfillment,orders:Number(r.orders),totalCents:Number(r.total_cents)})),expenses:{count:Number(expenses.rows[0].count),totalCents:Number(expenses.rows[0].total_cents)},documents:{received:Number(documents.rows.find(r=>r.direction==='received')?.count||0),issued:Number(documents.rows.find(r=>r.direction==='issued')?.count||0)},notice:'Resumo gerencial baseado nos pedidos registrados no Menuza. Pedidos não significam necessariamente recebimentos conciliados; a base atual não registra forma de pagamento. Não substitui escrituração contábil, apuração tributária ou documento fiscal autorizado.'};
}

export default async function handler(req,res) {
  const path='/api/'+(Array.isArray(req.query?.path)?req.query.path.join('/'):String(req.query?.path||'')).replace(/^\/+|\/+$/g,'');
  const method=req.method||'GET';
  const allowed=new Set(['GET','POST','PATCH','PUT','DELETE','OPTIONS']);
  if (!allowed.has(method)) return json(res,405,{error:'Método não permitido.'},{Allow:'GET, POST, PATCH, PUT, DELETE, OPTIONS'});
  if (method==='OPTIONS') return json(res,204,{});
  try {
    if (['POST','PATCH','PUT','DELETE'].includes(method)) {
      const origin=req.headers.origin, host=req.headers.host;
      if (origin&&host&&origin!=='https://'+host&&origin!=='http://'+host) throw fail('Origem da solicitação não permitida.',403);
    }
    const globalRetry=await limit(req,'api-global',240,60000);
    if(globalRetry) return json(res,429,{error:'Muitas solicitações. Aguarde um pouco e tente novamente.'},{'Retry-After':String(globalRetry)});
    if(method==='POST'&&path==='/api/orders') {
      const orderRetry=await limit(req,'orders-create',60,600000);
      if(orderRetry) return json(res,429,{error:'Muitos pedidos foram enviados deste endereço. Aguarde antes de tentar novamente.'},{'Retry-After':String(orderRetry)});
    }
    const parts=path.split('/').filter(Boolean), id=decodeURIComponent(parts.at(-1)||'');
    if (method==='GET'&&path==='/api/restaurant/branding') return json(res,200,{restaurant:(await query('SELECT name,logo_url AS "logoUrl" FROM restaurants WHERE id=$1',[RESTAURANT_ID])).rows[0]||null});
    if (method==='GET'&&path==='/api/catalog') { await requireCustomer(req); return json(res,200,await catalogFor(false)); }
    if (method==='GET'&&path.startsWith('/api/tables/qr/')) {
      const token=path.slice('/api/tables/qr/'.length);
      if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) throw fail('QR Code de mesa inválido.',404);
      const table=(await query('SELECT table_number AS number,seats,status FROM restaurant_tables WHERE restaurant_id=$1 AND qr_token=$2',[RESTAURANT_ID,token])).rows[0];
      if (!table) throw fail('QR Code de mesa não encontrado.',404);
      return json(res,200,{table});
    }
    if (method==='GET'&&path==='/api/tables/available') { await requireCustomer(req); return json(res,200,{tables:(await query("SELECT id,table_number AS number,seats FROM restaurant_tables WHERE restaurant_id=$1 AND status='free' ORDER BY table_number",[RESTAURANT_ID])).rows}); }
    if (method==='POST'&&path==='/api/admin/login') {
      const body=await bodyOf(req), retry=await limit(req,'admin-login',15,900000);
      if (retry) return json(res,429,{error:'Muitas tentativas. Aguarde antes de tentar novamente.'},{'Retry-After':String(retry)});
      const candidate=typeof body.password==='string'?createHmac('sha256',SECRET||'invalid').update(body.password).digest():Buffer.alloc(32);
      const expected=createHmac('sha256',SECRET||'invalid').update(ADMIN_PASSWORD).digest();
      if (!ADMIN_PASSWORD||!SECRET||!timingSafeEqual(candidate,expected)||(ADMIN_TOTP_SECRET&&!verifyTotp(ADMIN_TOTP_SECRET,body.otp))) return json(res,401,{error:'Não foi possível entrar. Confira os dados e tente novamente.'});
      const token=sign({role:'admin',restaurantId:RESTAURANT_ID,iat:Date.now(),exp:Date.now()+SESSION_MS});
      return json(res,200,{ok:true},{'Set-Cookie':cookie(ADMIN_COOKIE,token,Math.floor(SESSION_MS/1000))});
    }
    if (method==='POST'&&path==='/api/admin/logout') return json(res,200,{ok:true},{'Set-Cookie':cookie(ADMIN_COOKIE,'',0)});
    if (method==='POST'&&path==='/api/customer/register') {
      const body=await bodyOf(req), email=normalizeEmail(body.email);
      const retry=await limit(req,'customer-register:'+email,5,3600000);
      if (retry||hasHoneypot(body)) return json(res,429,{error:'Muitas solicitações. Tente novamente mais tarde.'},{'Retry-After':String(retry||900)});
      const name=clean(body.name,100), phone=clean(body.phone,30), password=typeof body.password==='string'?body.password:'';
      if(name.length<2||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<8||password.length>128) throw fail('Confira nome, e-mail e senha (mínimo de 8 caracteres).',422);
      const salt=randomBytes(16).toString('hex'), id='cus_'+randomBytes(18).toString('hex');
      try { await query('INSERT INTO customers (id,name,email,phone,password_hash,password_salt,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',[id,name,email,phone,passwordHash(password,salt),salt,new Date().toISOString()]); }
      catch(e) { if(e.code==='23505') throw fail('Já existe uma conta com esse e-mail. Entre ou use outro e-mail.',409); throw e; }
      const safe={id,name,email,phone}, token=sign({role:'customer',customerId:id,exp:Date.now()+604800000});
      return json(res,201,{customer:safe},{'Set-Cookie':cookie(CUSTOMER_COOKIE,token,604800)});
    }
    if (method==='POST'&&path==='/api/customer/login') {
      const body=await bodyOf(req), email=normalizeEmail(body.email), retry=await limit(req,'customer-login:'+email,15,900000);
      if(retry) return json(res,429,{error:'Muitas tentativas. Aguarde antes de tentar novamente.'},{'Retry-After':String(retry)});
      const row=(await query('SELECT * FROM customers WHERE email=$1',[email])).rows[0];
      if(!row||!verifyPassword(body.password,row)) return json(res,401,{error:'E-mail ou senha inválidos.'});
      const safe={id:row.id,name:row.name,email:row.email,phone:row.phone}, token=sign({role:'customer',customerId:row.id,exp:Date.now()+604800000});
      return json(res,200,{customer:safe},{'Set-Cookie':cookie(CUSTOMER_COOKIE,token,604800)});
    }
    if (method==='POST'&&path==='/api/customer/logout') { await requireCustomer(req); return json(res,200,{ok:true},{'Set-Cookie':cookie(CUSTOMER_COOKIE,'',0)}); }
    if (method==='GET'&&path==='/api/customer/me') return json(res,200,{customer:(await requireCustomer(req)).customer});
    if (method==='GET'&&path==='/api/customer/orders') {
      const c=await requireCustomer(req), rows=await query('SELECT id FROM orders WHERE customer_id=$1 AND restaurant_id=$2 ORDER BY created_at DESC LIMIT 100',[c.customerId,RESTAURANT_ID]);
      return json(res,200,{orders:await Promise.all(rows.rows.map(r=>orderById(r.id)))});
    }
    if (method==='DELETE'&&path==='/api/customer/account') {
      const c=await requireCustomer(req), body=await bodyOf(req), row=(await query('SELECT * FROM customers WHERE id=$1',[c.customerId])).rows[0];
      if(!row||!verifyPassword(body.password,row)) return json(res,401,{error:'Senha incorreta. A conta não foi excluída.'});
      await withTransaction(async client=>{await client.query('UPDATE orders SET customer_id=NULL WHERE customer_id=$1',[c.customerId]);await client.query('DELETE FROM customers WHERE id=$1',[c.customerId]);});
      return json(res,200,{ok:true,message:'Conta excluída. Registros de pedidos mantidos por obrigações legais ou operacionais foram desvinculados da conta.'},{'Set-Cookie':cookie(CUSTOMER_COOKIE,'',0)});
    }
    if (method==='POST'&&path==='/api/privacy-requests') {
      const b=await bodyOf(req), name=clean(b.name,100), email=normalizeEmail(b.email), phone=clean(b.phone,30), details=clean(b.details,2000), type=['access','correction','deletion','question','support'].includes(b.requestType)?b.requestType:'';
      if(hasHoneypot(b)) return json(res,429,{error:'Muitas solicitações.'},{'Retry-After':'900'});
      if(name.length<2||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!type||details.length<10) throw fail('Informe nome, e-mail válido, tipo de solicitação e detalhes com pelo menos 10 caracteres.',422);
      const retry=await limit(req,'privacy-request:'+email,5,3600000); if(retry) return json(res,429,{error:'Muitas solicitações.'},{'Retry-After':String(retry)});
      const id='pr_'+randomBytes(12).toString('hex'), now=new Date().toISOString();
      await query('INSERT INTO privacy_requests (id,name,email,phone,request_type,details,status,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)',[id,name,email,phone,type,details,'open',now]);
      return json(res,201,{ok:true,id,message:'Solicitação registrada. Guarde este código para referência: '+id});
    }
    if (path.startsWith('/api/admin/')) requireAdmin(req);
    if (method==='GET'&&path==='/api/admin/me') return json(res,200,{authenticated:true,restaurantId:RESTAURANT_ID});
    if (method==='GET'&&path==='/api/admin/security') return json(res,200,{twoFactorEnabled:Boolean(ADMIN_TOTP_SECRET)});
    if (method==='GET'&&path==='/api/admin/events') {
      res.setHeader('Content-Type','text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control','no-cache, no-transform');
      res.setHeader('Connection','keep-alive');
      res.setHeader('X-Accel-Buffering','no');
      res.write('retry: 4000\\n\\nevent: update\\ndata: {"type":"connected"}\\n\\n');
      return await new Promise(resolve => {
        const heartbeat=setInterval(()=>{try{res.write(': ping\\n\\n');}catch{}},3000);
        const finish=()=>{clearInterval(heartbeat);try{res.end();}catch{}resolve();};
        const timeout=setTimeout(finish,10000);
        req.on('close',()=>{clearTimeout(timeout);finish();});
      });
    }
    if (method==='GET'&&path==='/api/admin/privacy-requests') return json(res,200,{requests:(await query("SELECT id,name,email,phone,request_type AS \"requestType\",details,status,created_at AS \"createdAt\",updated_at AS \"updatedAt\" FROM privacy_requests ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,created_at DESC LIMIT 200")).rows});
    if (method==='PATCH'&&path.startsWith('/api/admin/privacy-requests/')) {
      const b=await bodyOf(req); if(!['open','in_progress','closed'].includes(b.status)) throw fail('Status inválido.',422);
      const result=await query('UPDATE privacy_requests SET status=$1,updated_at=$2 WHERE id=$3',[b.status,new Date().toISOString(),id]); if(!result.rowCount) throw fail('Solicitação não encontrada.',404); return json(res,200,{ok:true});
    }
    if (method==='GET'&&path==='/api/admin/categories') {
      await query(`INSERT INTO restaurants (id,name,slug,currency,prep_minutes,created_at,logo_url) VALUES ($1,$2,$3,'BRL',30,$4,'') ON CONFLICT (id) DO NOTHING`,[RESTAURANT_ID,'Bela Mesa','bela-mesa',new Date().toISOString()]);
      const categories=(await query(`SELECT c.id,c.name,c.slug,c.sort_order AS "sortOrder",COUNT(p.id)::int AS "productCount"
        FROM categories c LEFT JOIN products p ON p.category_id=c.id AND p.restaurant_id=c.restaurant_id
        WHERE c.restaurant_id=$1 GROUP BY c.id ORDER BY c.sort_order,c.name`,[RESTAURANT_ID])).rows;
      return json(res,200,{categories});
    }
    if (method==='POST'&&path==='/api/admin/categories') {
      const b=await bodyOf(req),name=clean(b.name,60),slug=slugify(name);
      if(name.length<2||name.length>60||!slug) throw fail('Informe um nome de categoria entre 2 e 60 caracteres.',422);
      if((await query('SELECT id FROM categories WHERE restaurant_id=$1 AND (slug=$2 OR LOWER(name)=LOWER($3))',[RESTAURANT_ID,slug,name])).rowCount) throw fail('Já existe uma categoria com esse nome.',409);
      const id='cat_'+randomBytes(10).toString('hex');
      const order=Number((await query('SELECT COALESCE(MAX(sort_order),-1)+1 AS next FROM categories WHERE restaurant_id=$1',[RESTAURANT_ID])).rows[0]?.next||0);
      await query('INSERT INTO categories (id,restaurant_id,name,slug,sort_order) VALUES ($1,$2,$3,$4,$5)',[id,RESTAURANT_ID,name,slug,order]);
      return json(res,201,{category:{id,name,slug,sortOrder:order,productCount:0}});
    }
    if (method==='PATCH'&&path.startsWith('/api/admin/categories/')) {
      const b=await bodyOf(req),name=clean(b.name,60),slug=slugify(name);
      if(!id||name.length<2||name.length>60||!slug) throw fail('Informe um nome de categoria entre 2 e 60 caracteres.',422);
      const current=(await query('SELECT id FROM categories WHERE id=$1 AND restaurant_id=$2',[id,RESTAURANT_ID])).rows[0];
      if(!current) throw fail('Categoria não encontrada.',404);
      if((await query('SELECT id FROM categories WHERE restaurant_id=$1 AND id<>$2 AND (slug=$3 OR LOWER(name)=LOWER($4))',[RESTAURANT_ID,id,slug,name])).rowCount) throw fail('Já existe uma categoria com esse nome.',409);
      const result=await query('UPDATE categories SET name=$1,slug=$2 WHERE id=$3 AND restaurant_id=$4 RETURNING id,name,slug,sort_order AS "sortOrder"',[name,slug,id,RESTAURANT_ID]);
      return json(res,200,{category:result.rows[0]});
    }
    if (method==='DELETE'&&path.startsWith('/api/admin/categories/')) {
      const category=(await query('SELECT id,name FROM categories WHERE id=$1 AND restaurant_id=$2',[id,RESTAURANT_ID])).rows[0];
      if(!category) throw fail('Categoria não encontrada.',404);
      const used=(await query('SELECT COUNT(*)::int AS count FROM products WHERE category_id=$1 AND restaurant_id=$2',[id,RESTAURANT_ID])).rows[0];
      if(Number(used?.count)>0) throw fail('Esta categoria tem produtos vinculados. Transfira os produtos para outra categoria antes de excluir.',409);
      await query('DELETE FROM categories WHERE id=$1 AND restaurant_id=$2',[id,RESTAURANT_ID]);
      return json(res,200,{ok:true});
    }
    if (method==='GET'&&path==='/api/admin/catalog') return json(res,200,await catalogFor(true));
    if (method==='GET'&&path==='/api/admin/settings') {
      // A migração do esquema pode ter sido aplicada antes da migração dos dados.
      // Garante o registro-base para que a tela de configurações não receba restaurant undefined.
      await query(`INSERT INTO restaurants (id,name,slug,currency,prep_minutes,created_at,logo_url)
        VALUES ($1,$2,$3,'BRL',30,$4,'')
        ON CONFLICT (id) DO NOTHING`, [RESTAURANT_ID,'Bela Mesa','bela-mesa',new Date().toISOString()]);
      const restaurant=(await query('SELECT id,name,slug,currency,prep_minutes AS "prepMinutes",logo_url AS "logoUrl" FROM restaurants WHERE id=$1',[RESTAURANT_ID])).rows[0];
      if (!restaurant) throw fail('Não foi possível carregar as configurações do restaurante.',503);
      return json(res,200,{restaurant});
    }
    if (method==='PATCH'&&path==='/api/admin/settings') {
      await query(`INSERT INTO restaurants (id,name,slug,currency,prep_minutes,created_at,logo_url)
        VALUES ($1,$2,$3,'BRL',30,$4,'')
        ON CONFLICT (id) DO NOTHING`, [RESTAURANT_ID,'Bela Mesa','bela-mesa',new Date().toISOString()]);
      const b=await bodyOf(req,1500000), current=(await query('SELECT name,prep_minutes AS "prepMinutes",logo_url AS "logoUrl" FROM restaurants WHERE id=$1',[RESTAURANT_ID])).rows[0];
      if (!current) throw fail('Não foi possível carregar as configurações do restaurante.',503);
      const name=b.name===undefined?current.name:clean(b.name,80), prep=b.prepMinutes===undefined?Number(current.prepMinutes):Number(b.prepMinutes), logo=b.logoUrl===undefined?current.logoUrl:clean(b.logoUrl,1400000);
      if(name.length<2||!Number.isInteger(prep)||prep<5||prep>240) throw fail('Confira o nome e o tempo médio de preparo.',422);
      if(logo&&!/^https:\/\/[^\s<>"']+$/i.test(logo)&&!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(logo)) throw fail('Envie uma imagem PNG, JPG ou WebP válida.',422);
      if(logo.startsWith('data:')&&logo.length>1400000) throw fail('A logo ficou grande demais.',413);
      await query('UPDATE restaurants SET name=$1,prep_minutes=$2,logo_url=$3 WHERE id=$4',[name,prep,logo,RESTAURANT_ID]);
      return json(res,200,{restaurant:(await query('SELECT id,name,slug,currency,prep_minutes AS "prepMinutes",logo_url AS "logoUrl" FROM restaurants WHERE id=$1',[RESTAURANT_ID])).rows[0]});
    }

    if(path.startsWith('/api/admin/fiscal/')) await ensureFiscalSchema();
    if(method==='GET'&&path==='/api/admin/fiscal/profile'){
      const profile=(await query(`SELECT cnpj,"legal_name" AS "legalName","trade_name" AS "tradeName",
        state_registration AS "stateRegistration",municipal_registration AS "municipalRegistration",
        tax_regime AS "taxRegime",company_size AS "companySize",legal_nature AS "legalNature",
        opening_date::text AS "openingDate",simples_start_date::text AS "simplesStartDate",
        capital_cents::bigint AS "capitalCents" FROM fiscal_profiles WHERE restaurant_id=$1`,[RESTAURANT_ID])).rows[0];
      return json(res,200,{profile});
    }
    if(method==='PATCH'&&path==='/api/admin/fiscal/profile'){
      const b=await bodyOf(req),current=(await query('SELECT * FROM fiscal_profiles WHERE restaurant_id=$1',[RESTAURANT_ID])).rows[0];
      const cnpj=clean(b.cnpj??current.cnpj,14).replace(/\D/g,'');
      const legalName=clean(b.legalName??current.legal_name,160),tradeName=clean(b.tradeName??current.trade_name,160);
      const stateRegistration=clean(b.stateRegistration??current.state_registration,40),municipalRegistration=clean(b.municipalRegistration??current.municipal_registration,40);
      const legalNature=clean(b.legalNature??current.legal_nature,120),taxRegime=clean(b.taxRegime??current.tax_regime,40);
      const openingDate=clean(b.openingDate??current.opening_date,10),simplesStartDate=clean(b.simplesStartDate??current.simples_start_date,10);
      const capitalCents=Number(b.capitalCents??current.capital_cents);
      if(!/^\d{14}$/.test(cnpj)||legalName.length<2||tradeName.length<2||!['simples_nacional','lucro_presumido','lucro_real','mei','outro'].includes(taxRegime)||!Number.isInteger(capitalCents)||capitalCents<0||capitalCents>999999999999)throw fail('Confira CNPJ, razão social, regime tributário e capital social.',422);
      for(const date of [openingDate,simplesStartDate])if(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date))throw fail('Informe as datas no formato válido.',422);
      await query(`UPDATE fiscal_profiles SET cnpj=$1,legal_name=$2,trade_name=$3,state_registration=$4,municipal_registration=$5,
        legal_nature=$6,tax_regime=$7,opening_date=$8::date,simples_start_date=$9::date,capital_cents=$10,updated_at=NOW()
        WHERE restaurant_id=$11`,[cnpj,legalName,tradeName,stateRegistration,municipalRegistration,legalNature,taxRegime,openingDate||null,simplesStartDate||null,capitalCents,RESTAURANT_ID]);
      return json(res,200,{ok:true});
    }
    if(method==='GET'&&path==='/api/admin/fiscal/report'){
      return json(res,200,{report:await fiscalReport(req.query?.month)});
    }
    if(method==='GET'&&path==='/api/admin/fiscal/expenses'){
      const {start,end}=fiscalMonth(req.query?.month);
      const rows=await query(`SELECT id,expense_date::text AS date,description,category,supplier_name AS "supplierName",
        supplier_cnpj AS "supplierCnpj",document_number AS "documentNumber",amount_cents::bigint AS "amountCents",
        payment_method AS "paymentMethod",notes FROM fiscal_expenses WHERE restaurant_id=$1 AND expense_date >= $2::date AND expense_date < $3::date ORDER BY expense_date DESC,created_at DESC`,[RESTAURANT_ID,start,end]);
      return json(res,200,{expenses:rows.rows});
    }
    if(method==='POST'&&path==='/api/admin/fiscal/expenses'){
      const b=await bodyOf(req),date=clean(b.date,10),description=clean(b.description,180),category=clean(b.category,40)||'outros';
      const amountCents=Number(b.amountCents),supplierName=clean(b.supplierName,160),supplierCnpj=clean(b.supplierCnpj,14).replace(/\D/g,'');
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||description.length<2||!Number.isInteger(amountCents)||amountCents<1||amountCents>999999999)throw fail('Informe data, descrição e valor válido para a despesa.',422);
      if(supplierCnpj&&!/^\d{14}$/.test(supplierCnpj))throw fail('O CNPJ do fornecedor deve conter 14 números.',422);
      const id='fex_'+randomBytes(12).toString('hex');
      await query(`INSERT INTO fiscal_expenses(id,restaurant_id,expense_date,description,category,supplier_name,supplier_cnpj,document_number,amount_cents,payment_method,notes)
        VALUES($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11)`,[id,RESTAURANT_ID,date,description,category,supplierName,supplierCnpj,clean(b.documentNumber,60),amountCents,clean(b.paymentMethod,40),clean(b.notes,500)]);
      return json(res,201,{ok:true,id});
    }
    if(method==='DELETE'&&path.startsWith('/api/admin/fiscal/expenses/')){
      const result=await query('DELETE FROM fiscal_expenses WHERE id=$1 AND restaurant_id=$2',[id,RESTAURANT_ID]);
      if(!result.rowCount)throw fail('Despesa não encontrada.',404);
      return json(res,200,{ok:true});
    }
    if(method==='GET'&&path==='/api/admin/fiscal/documents'){
      const {start,end}=fiscalMonth(req.query?.month);
      const rows=await query(`SELECT id,direction,document_type AS "documentType",document_number AS "documentNumber",
        issuer_name AS "issuerName",issuer_cnpj AS "issuerCnpj",document_date::text AS date,
        amount_cents::bigint AS "amountCents",file_name AS "fileName",mime_type AS "mimeType",notes
        FROM fiscal_documents WHERE restaurant_id=$1 AND (document_date IS NULL OR (document_date >= $2::date AND document_date < $3::date))
        ORDER BY document_date DESC NULLS LAST,created_at DESC`,[RESTAURANT_ID,start,end]);
      return json(res,200,{documents:rows.rows});
    }
    if(method==='POST'&&path==='/api/admin/fiscal/documents'){
      const b=await bodyOf(req,2200000),direction=clean(b.direction,10),documentType=clean(b.documentType,20);
      const fileName=clean(b.fileName,180),mimeType=clean(b.mimeType,100),contentBase64=String(b.contentBase64||'');
      const date=clean(b.date,10),amountCents=Number(b.amountCents||0),issuerCnpj=clean(b.issuerCnpj,14).replace(/\D/g,'');
      if(!['received','issued'].includes(direction)||!['xml','pdf','other'].includes(documentType)||!fileName||!['application/xml','text/xml','application/pdf','application/octet-stream'].includes(mimeType)||!contentBase64||contentBase64.length>1800000||!/^[A-Za-z0-9+/]+={0,2}$/.test(contentBase64))throw fail('Arquivo inválido. Envie XML ou PDF de até 1,3 MB.',422);
      if(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date))throw fail('Data do documento inválida.',422);
      if(!Number.isInteger(amountCents)||amountCents<0||amountCents>999999999)throw fail('Valor do documento inválido.',422);
      if(issuerCnpj&&!/^\d{14}$/.test(issuerCnpj))throw fail('CNPJ do emitente inválido.',422);
      const id='fdoc_'+randomBytes(12).toString('hex');
      await query(`INSERT INTO fiscal_documents(id,restaurant_id,direction,document_type,document_number,issuer_name,issuer_cnpj,document_date,amount_cents,file_name,mime_type,content_base64,notes)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8::date,$9,$10,$11,$12,$13)`,[id,RESTAURANT_ID,direction,documentType,clean(b.documentNumber,60),clean(b.issuerName,160),issuerCnpj,date||null,amountCents,fileName,mimeType,contentBase64,clean(b.notes,500)]);
      return json(res,201,{ok:true,id});
    }
    if(method==='GET'&&path.startsWith('/api/admin/fiscal/documents/')){
      const row=(await query('SELECT file_name AS "fileName",mime_type AS "mimeType",content_base64 AS "contentBase64" FROM fiscal_documents WHERE id=$1 AND restaurant_id=$2',[id,RESTAURANT_ID])).rows[0];
      if(!row)throw fail('Documento não encontrado.',404);
      return json(res,200,row);
    }
    if (method==='GET'&&path==='/api/admin/orders') {
      const rows=await query("SELECT id,customer_name AS \"customerName\",phone,fulfillment,table_label AS \"tableLabel\",delivery_address AS \"deliveryAddress\",note,status,total_cents AS \"totalCents\",coupon_code AS \"couponCode\",discount_cents AS \"discountCents\",created_at AS \"createdAt\" FROM orders WHERE restaurant_id=$1 ORDER BY CASE status WHEN 'received' THEN 0 WHEN 'confirmed' THEN 1 WHEN 'preparing' THEN 2 WHEN 'ready' THEN 3 ELSE 4 END,created_at DESC LIMIT 100",[RESTAURANT_ID]);
      return json(res,200,{orders:await Promise.all(rows.rows.map(async o=>({...o,items:(await orderById(o.id))?.items||[]})))});
    }
    if (method==='GET'&&path==='/api/admin/dashboard') {
      const [counts,revenue,stats,popular,restaurant]=await Promise.all([
        query('SELECT status,COUNT(*)::int AS count FROM orders WHERE restaurant_id=$1 GROUP BY status',[RESTAURANT_ID]),
        query("SELECT COALESCE(SUM(total_cents),0)::int AS total FROM orders WHERE restaurant_id=$1 AND status<>'cancelled' AND created_at::date=(NOW() AT TIME ZONE 'America/Sao_Paulo')::date",[RESTAURANT_ID]),
        query("SELECT COUNT(*) FILTER (WHERE created_at::date=(NOW() AT TIME ZONE 'America/Sao_Paulo')::date)::int AS \"ordersToday\",COALESCE(ROUND(AVG(total_cents) FILTER (WHERE status<>'cancelled' AND created_at::date=(NOW() AT TIME ZONE 'America/Sao_Paulo')::date)),0)::int AS \"averageTicketCents\" FROM orders WHERE restaurant_id=$1",[RESTAURANT_ID]),
        query("SELECT oi.product_name_snapshot AS name,SUM(oi.quantity)::int AS quantity FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.restaurant_id=$1 AND o.status<>'cancelled' GROUP BY oi.product_id,oi.product_name_snapshot ORDER BY quantity DESC LIMIT 4",[RESTAURANT_ID]),
        query('SELECT prep_minutes AS "prepMinutes" FROM restaurants WHERE id=$1',[RESTAURANT_ID])
      ]);
      return json(res,200,{counts:Object.fromEntries(Object.keys(STATUS).map(k=>[k,Number(counts.rows.find(x=>x.status===k)?.count||0)])),revenueCents:Number(revenue.rows[0].total),ordersToday:Number(stats.rows[0].ordersToday),averageTicketCents:Number(stats.rows[0].averageTicketCents),prepMinutes:Number(restaurant.rows[0]?.prepMinutes||30),popular:popular.rows});
    }
    if (method==='GET'&&path==='/api/admin/analytics') {
      const days=[7,30,90].includes(Number(req.query?.days))?Number(req.query.days):7, since=new Date(Date.now()-days*86400000).toISOString();
      const [summary,daily,fulfillment,popular]=await Promise.all([
        query("SELECT COUNT(*)::int AS orders,COALESCE(SUM(total_cents) FILTER (WHERE status<>'cancelled'),0)::int AS \"revenueCents\",COALESCE(ROUND(AVG(total_cents) FILTER (WHERE status<>'cancelled')),0)::int AS \"averageTicketCents\",COUNT(*) FILTER (WHERE status='cancelled')::int AS cancelled FROM orders WHERE restaurant_id=$1 AND created_at >= $2",[RESTAURANT_ID,since]),
        query("SELECT created_at::date::text AS date,COUNT(*)::int AS orders,COALESCE(SUM(total_cents) FILTER (WHERE status<>'cancelled'),0)::int AS \"revenueCents\" FROM orders WHERE restaurant_id=$1 AND created_at >= $2 GROUP BY created_at::date ORDER BY date",[RESTAURANT_ID,since]),
        query("SELECT fulfillment AS type,COUNT(*)::int AS orders FROM orders WHERE restaurant_id=$1 AND created_at >= $2 AND status<>'cancelled' GROUP BY fulfillment ORDER BY orders DESC",[RESTAURANT_ID,since]),
        query("SELECT oi.product_name_snapshot AS name,SUM(oi.quantity)::int AS quantity,COALESCE(SUM(oi.unit_price_cents*oi.quantity),0)::int AS \"revenueCents\" FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.restaurant_id=$1 AND o.created_at >= $2 AND o.status<>'cancelled' GROUP BY oi.product_name_snapshot ORDER BY quantity DESC LIMIT 8",[RESTAURANT_ID,since])
      ]);
      return json(res,200,{days,summary:summary.rows[0],daily:daily.rows,fulfillment:fulfillment.rows,popular:popular.rows});
    }
    if (method==='GET'&&path==='/api/admin/coupons') return json(res,200,{coupons:(await query('SELECT * FROM coupons WHERE restaurant_id=$1 ORDER BY created_at DESC',[RESTAURANT_ID])).rows.map(couponPublic)});
    if (method==='POST'&&path==='/api/admin/coupons') return json(res,201,{coupon:await saveCoupon(await bodyOf(req))});
    if (method==='PATCH'&&path.startsWith('/api/admin/coupons/')) return json(res,200,{coupon:await saveCoupon(await bodyOf(req),id)});
    if (method==='POST'&&path==='/api/coupons/validate') {
      await requireCustomer(req); const b=await bodyOf(req); if(hasHoneypot(b)) throw fail('Solicitação inválida.',422);
      const {subtotal}=await priceItems(b.items), code=normalizeCoupon(b.code), discount=couponDiscount(await coupons(code),subtotal);
      return json(res,200,{code,subtotalCents:subtotal,discountCents:discount,totalCents:subtotal-discount});
    }
    if (method==='GET'&&path==='/api/admin/combos') { const c=await catalogFor(true); return json(res,200,{combos:c.combos,products:c.products}); }
    if (method==='POST'&&path==='/api/admin/combos') return json(res,201,{combo:await saveCombo(await bodyOf(req))});
    if (method==='PATCH'&&path.startsWith('/api/admin/combos/')) return json(res,200,{combo:await saveCombo(await bodyOf(req),id)});
    if (method==='GET'&&path==='/api/admin/tables') {
      const tables=(await query('SELECT id,table_number AS number,seats,status,note,qr_token AS "qrToken",updated_at AS "updatedAt" FROM restaurant_tables WHERE restaurant_id=$1 ORDER BY table_number',[RESTAURANT_ID])).rows;
      const counts={free:0,occupied:0,cleaning:0}; for(const t of tables) counts[t.status]=(counts[t.status]||0)+1;
      return json(res,200,{tables,counts});
    }
    if (method==='PATCH'&&path.startsWith('/api/admin/tables/')) {
      const b=await bodyOf(req); if(!['free','occupied','cleaning'].includes(b.status)) throw fail('Selecione um status válido para a mesa.',422);
      const table=(await query('SELECT id,table_number AS number FROM restaurant_tables WHERE id=$1 AND restaurant_id=$2',[id,RESTAURANT_ID])).rows[0]; if(!table) throw fail('Mesa não encontrada.',404);
      if(b.status==='free') { const active=(await query("SELECT id FROM orders WHERE restaurant_id=$1 AND fulfillment='table' AND table_label=$2 AND status IN ('received','confirmed','preparing','ready') LIMIT 1",[RESTAURANT_ID,String(table.number)])); if(active.rowCount) throw fail('Esta mesa possui um pedido em andamento. Finalize ou cancele o pedido antes de liberá-la.',409); }
      const values=b.note===undefined?[b.status,new Date().toISOString(),id,RESTAURANT_ID]:[b.status,clean(b.note,160),new Date().toISOString(),id,RESTAURANT_ID];
      const updated=b.note===undefined?await query('UPDATE restaurant_tables SET status=$1,updated_at=$2 WHERE id=$3 AND restaurant_id=$4 RETURNING id,table_number AS number,seats,status,note,qr_token AS "qrToken",updated_at AS "updatedAt"',values):await query('UPDATE restaurant_tables SET status=$1,note=$2,updated_at=$3 WHERE id=$4 AND restaurant_id=$5 RETURNING id,table_number AS number,seats,status,note,qr_token AS "qrToken",updated_at AS "updatedAt"',values);
      return json(res,200,{table:updated.rows[0]});
    }
    if (method==='POST'&&path==='/api/admin/products') {
      const b=await bodyOf(req,400000), name=clean(b.name,80), description=clean(b.description,300), type=b.type, categoryId=clean(b.categoryId,50), price=Number(b.baseCents);
      const imageUrl=b.imageUrl===undefined?'':String(b.imageUrl);
      if(imageUrl.length>245000||(imageUrl!==''&&!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(imageUrl))) throw fail('Foto inválida ou muito grande. Escolha outra imagem.',422);
      if(name.length<2||!['pizza','burger','plate'].includes(type)||!Number.isInteger(price)||price<500||price>1000000) throw fail('Preencha nome, tipo e preço-base válidos.',422);
      const cat=(await query('SELECT id FROM categories WHERE id=$1 AND restaurant_id=$2',[categoryId,RESTAURANT_ID])).rows[0]; if(!cat) throw fail('Escolha uma categoria válida.',422);
      const now=new Date().toISOString(), productId=slugify(name)+'-'+randomBytes(3).toString('hex');
      const ingredientIds=await validateProductIngredientIds(b.ingredientIds===undefined?[]:b.ingredientIds,type);
      const defaultIngredientIds=await validateProductIngredientIds(b.defaultIngredientIds===undefined?[]:b.defaultIngredientIds,type);
      await query(`INSERT INTO products (id,restaurant_id,category_id,name,description,type,base_price_cents,active,available,featured,prep_minutes,width_cm,depth_cm,height_cm,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,1,1,0,25,$8,$9,$10,$11,$11)`,[productId,RESTAURANT_ID,categoryId,name,description,type,price,type==='pizza'?30:12,type==='pizza'?30:12,type==='pizza'?2:10,now]);
      await query('UPDATE products SET ingredient_ids_json=$1,default_ingredient_ids_json=$2,ingredients_configured=$3,image_url=$4 WHERE id=$5 AND restaurant_id=$6',[JSON.stringify(ingredientIds),JSON.stringify(defaultIngredientIds),b.ingredientIds!==undefined||b.defaultIngredientIds!==undefined?1:0,imageUrl,productId,RESTAURANT_ID]);
      return json(res,201,{product:(await catalogFor(true)).products.find(p=>p.id===productId)});
    }
    if (method==='PATCH'&&path.startsWith('/api/admin/products/')) {
      const b=await bodyOf(req,400000), old=(await query('SELECT * FROM products WHERE id=$1 AND restaurant_id=$2',[id,RESTAURANT_ID])).rows[0]; if(!old) throw fail('Produto não encontrado.',404);
      const imageUrl=b.imageUrl===undefined?null:String(b.imageUrl);
      if(imageUrl!==null&&(imageUrl.length>245000||(imageUrl!==''&&!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(imageUrl)))) throw fail('Foto inválida ou muito grande. Escolha outra imagem.',422);
      const name=b.name===undefined?old.name:clean(b.name,80), description=b.description===undefined?old.description:clean(b.description,300), price=b.baseCents===undefined?Number(old.base_price_cents):Number(b.baseCents), active=b.active===undefined?Number(old.active):(b.active?1:0), available=b.available===undefined?Number(old.available):(b.available?1:0);
      const ingredientIds=b.ingredientIds===undefined?null:await validateProductIngredientIds(b.ingredientIds,old.type);
      const defaultIngredientIds=b.defaultIngredientIds===undefined?null:await validateProductIngredientIds(b.defaultIngredientIds,old.type);
      if(name.length<2||!Number.isInteger(price)||price<500||price>1000000) throw fail('Confira o nome e o preço do produto.',422);
      await query('UPDATE products SET name=$1,description=$2,base_price_cents=$3,active=$4,available=$5,ingredient_ids_json=COALESCE($6,ingredient_ids_json),default_ingredient_ids_json=COALESCE($7,default_ingredient_ids_json),ingredients_configured=CASE WHEN $8 THEN 1 ELSE ingredients_configured END,image_url=COALESCE($9,image_url),updated_at=$10 WHERE id=$11 AND restaurant_id=$12',[name,description,price,active,available,ingredientIds===null?null:JSON.stringify(ingredientIds),defaultIngredientIds===null?null:JSON.stringify(defaultIngredientIds),ingredientIds!==null||defaultIngredientIds!==null,imageUrl,new Date().toISOString(),id,RESTAURANT_ID]);
      return json(res,200,{product:(await catalogFor(true)).products.find(p=>p.id===id)});
    }
    if (method==='POST'&&path==='/api/admin/ingredients') {
      const b=await bodyOf(req), name=clean(b.name,80), type=clean(b.type,20), groupName=clean(b.groupName,50)||'Adicionais', price=Number(b.cents);
      if(name.length<2||!['pizza','burger','plate'].includes(type)||!Number.isInteger(price)||price<0||price>999999) throw fail('Informe nome, tipo e preço válido para o adicional.',422);
      const duplicate=(await query('SELECT id FROM ingredients WHERE restaurant_id=$1 AND type=$2 AND lower(name)=lower($3) LIMIT 1',[RESTAURANT_ID,type,name])).rows[0];
      if(duplicate) throw fail('Já existe um ingrediente ou adicional com esse nome para esse tipo.',409);
      const id=slugify(name)+'-'+randomBytes(3).toString('hex');
      const orderResult=await query('SELECT COALESCE(MAX(sort_order),-1)+1 AS next_order FROM ingredients WHERE restaurant_id=$1',[RESTAURANT_ID]);
      await query('INSERT INTO ingredients (id,restaurant_id,name,type,group_name,addon_cents,included_by_default,active,sort_order) VALUES ($1,$2,$3,$4,$5,$6,0,1,$7)',[id,RESTAURANT_ID,name,type,groupName,price,Number(orderResult.rows[0]?.next_order)||0]);
      return json(res,201,{ingredient:(await catalogFor(true)).ingredients.find(i=>i.id===id)});
    }
    if (method==='PATCH'&&path.startsWith('/api/admin/ingredients/')) {
      const b=await bodyOf(req), old=(await query('SELECT * FROM ingredients WHERE id=$1 AND restaurant_id=$2',[id,RESTAURANT_ID])).rows[0]; if(!old) throw fail('Ingrediente não encontrado.',404);
      const cents=b.cents===undefined?Number(old.addon_cents):Number(b.cents), active=b.active===undefined?Number(old.active):(b.active?1:0);
      if(!Number.isInteger(cents)||cents<0||cents>100000) throw fail('O preço do adicional deve ser válido.',422);
      await query('UPDATE ingredients SET addon_cents=$1,active=$2 WHERE id=$3 AND restaurant_id=$4',[cents,active,id,RESTAURANT_ID]);
      return json(res,200,{ingredient:(await catalogFor(true)).ingredients.find(i=>i.id===id)});
    }
    if (method==='PATCH'&&path.startsWith('/api/admin/orders/')) return json(res,200,{order:await updateOrderStatus(id,(await bodyOf(req)).status)});
    if (method==='POST'&&path==='/api/orders') {
      const b=await bodyOf(req); if(hasHoneypot(b)) throw fail('Solicitação inválida.',422);
      const c=await requireCustomer(req), order=await createOrder(b,c.customerId);
      return json(res,201,{order,trackingUrl:'/#pedido/'+order.trackingToken});
    }
    if (method==='GET'&&path.startsWith('/api/tracking/')) {
      const token=path.slice('/api/tracking/'.length), found=(await query('SELECT id,customer_id AS "customerId" FROM orders WHERE tracking_token=$1 AND restaurant_id=$2',[token,RESTAURANT_ID])).rows[0];
      if(!found) throw fail('Pedido não encontrado.',404);
      const c=await customer(req); if(found.customerId&&(!c||c.customerId!==found.customerId)) throw fail('Pedido não encontrado.',404);
      return json(res,200,{order:await orderById(found.id)});
    }
    throw fail('Rota da API não encontrada.',404);
  } catch(error) {
    const status=Number.isInteger(error?.status)?error.status:500;
    if(status>=500) console.error('[Menuza API]',error?.message||error);
    return json(res,status,{error:status>=500?'Não foi possível concluir a solicitação agora.':error.message||'Solicitação inválida.'});
  }
}
