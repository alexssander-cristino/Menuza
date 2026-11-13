import { randomBytes, createHash, createHmac, createCipheriv, createDecipheriv, timingSafeEqual, scryptSync } from 'node:crypto';
import { consumeRateLimit } from '../src/security/rate-limit.mjs';
import { query, withTransaction } from '../src/db/postgres.mjs';
import { calculateItemPrice, CRUST_OPTIONS, inferIngredientVisual, isBuildYourOwnPizza, SIZE_OPTIONS, STATUS, STATUS_FLOW, slugify } from '../src/catalog.mjs';
import { verifyTotp, generateTotpSecret } from '../src/auth-totp.mjs';
import { sanitizeUploadFileName, validateFiscalDocument } from '../src/security/file-validation.mjs';
// API da Vercel: roteador principal dos endpoints públicos, de clientes e administrativos.
// Este módulo usa Postgres/Neon; server.mjs mantém o backend SQLite usado no desenvolvimento local.
// As rotas autenticadas validam sessão e permissões antes de consultar ou alterar os dados.
import { imageReferenceToDataUrl, isImageDataUrl, isStoredImageUrl, migrateImageReferences, storeImageDataUrl, storeImageList } from '../src/storage/neon.mjs';

const RESTAURANT_ID = 'rest-bela-mesa';
const IS_PROD = process.env.NODE_ENV === 'production';
const SECRET = process.env.APP_SECRET || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_TOTP_SECRET = String(process.env.ADMIN_TOTP_SECRET || '').replace(/\s+/g, '').toUpperCase();
const ADMIN_COOKIE = IS_PROD ? '__Host-menuza_session' : 'mesa_session';
const CUSTOMER_COOKIE = 'menuza_customer_session';
const ADMIN_SESSION_MS = 30 * 60 * 1000;
const ADMIN_TOKEN_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BODY = 64 * 1024;

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const clean = (value, max = 240) => String(value ?? '').trim().slice(0, max);
const normalizeEmail = value => clean(value, 254).toLowerCase();
const normalizeCoupon = value => clean(value, 32).toUpperCase().replace(/\s+/g, '');
const publicBaseUrl = () => String(process.env.MENUZA_PUBLIC_URL||'https://menuza-five.vercel.app').replace(/\/+$/,'');
const json = (res, status, body, headers = {}) => {
  for (const [key, value] of Object.entries({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(self), xr-spatial-tracking=(self), microphone=(), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Origin-Agent-Cluster': '?1',
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
let authSessionsSchemaPromise;
let adminTwoFactorSchemaPromise;
let operationsSchemaPromise;
async function ensureOperationsSchema(){
  if(!operationsSchemaPromise)operationsSchemaPromise=(async()=>{
    await query("ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_cents INTEGER NOT NULL DEFAULT 0");
    await query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT ''");
    await query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'pending'");
    await query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ");
    await query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_by TEXT NOT NULL DEFAULT ''");
    await query(`CREATE TABLE IF NOT EXISTS admin_audit_log(id BIGSERIAL PRIMARY KEY,restaurant_id TEXT NOT NULL,actor_type TEXT NOT NULL DEFAULT 'admin',action TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL DEFAULT '',details JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await query('CREATE INDEX IF NOT EXISTS admin_audit_log_created_idx ON admin_audit_log(restaurant_id,created_at DESC)');
    await query('CREATE INDEX IF NOT EXISTS admin_audit_log_entity_idx ON admin_audit_log(restaurant_id,entity_type,entity_id,created_at DESC)');
    await query(`CREATE TABLE IF NOT EXISTS abandoned_cart_reminders(id TEXT PRIMARY KEY,restaurant_id TEXT NOT NULL,customer_id TEXT NOT NULL,email TEXT NOT NULL,cart_summary TEXT NOT NULL,subtotal_cents INTEGER NOT NULL DEFAULT 0,consent_at TIMESTAMPTZ NOT NULL,scheduled_at TIMESTAMPTZ NOT NULL,sent_at TIMESTAMPTZ,converted_at TIMESTAMPTZ,processing_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await query('CREATE INDEX IF NOT EXISTS abandoned_cart_due_idx ON abandoned_cart_reminders(restaurant_id,scheduled_at) WHERE sent_at IS NULL AND converted_at IS NULL');
    await query('ALTER TABLE customers ADD COLUMN IF NOT EXISTS marketing_consent_at TIMESTAMPTZ');
    await query('ALTER TABLE coupons ADD COLUMN IF NOT EXISTS customer_id TEXT');
    await query('CREATE INDEX IF NOT EXISTS coupons_customer_idx ON coupons(restaurant_id,customer_id) WHERE customer_id IS NOT NULL');
    await query(`CREATE TABLE IF NOT EXISTS loyalty_points_ledger(id TEXT PRIMARY KEY,restaurant_id TEXT NOT NULL,customer_id TEXT NOT NULL,points INTEGER NOT NULL,reason TEXT NOT NULL,order_id TEXT UNIQUE,coupon_id TEXT UNIQUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await query('CREATE INDEX IF NOT EXISTS loyalty_customer_created_idx ON loyalty_points_ledger(restaurant_id,customer_id,created_at DESC)');
    await query(`CREATE TABLE IF NOT EXISTS customer_recovery_campaigns(id TEXT PRIMARY KEY,restaurant_id TEXT NOT NULL,customer_id TEXT NOT NULL,coupon_id TEXT NOT NULL,email TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'sent',sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await query('CREATE INDEX IF NOT EXISTS customer_recovery_sent_idx ON customer_recovery_campaigns(restaurant_id,customer_id,sent_at DESC)');
  })().catch(error=>{operationsSchemaPromise=null;throw error});
  await operationsSchemaPromise;
}
async function recordAdminAudit(action,entityType,entityId='',details={}){
  await ensureOperationsSchema();
  await query('INSERT INTO admin_audit_log(restaurant_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5::jsonb)',[RESTAURANT_ID,clean(action,80),clean(entityType,60),clean(entityId,120),JSON.stringify(details&&typeof details==='object'?details:{})]);
}
// Autenticação em duas etapas: prepara o armazenamento seguro do segredo TOTP e dos códigos de recuperação.
async function ensureAdminTwoFactorSchema() {
  if (!adminTwoFactorSchemaPromise) adminTwoFactorSchemaPromise = query('CREATE TABLE IF NOT EXISTS admin_two_factor (restaurant_id TEXT PRIMARY KEY, secret_encrypted TEXT, pending_secret_encrypted TEXT, pending_expires_at TIMESTAMPTZ, recovery_codes_hashes JSONB NOT NULL DEFAULT \'[]\'::jsonb, enabled_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())').then(() => query('CREATE INDEX IF NOT EXISTS admin_two_factor_updated_idx ON admin_two_factor(updated_at)')).catch(error => { adminTwoFactorSchemaPromise = null; throw error; });
  await adminTwoFactorSchemaPromise;
}
function twoFactorEncryptionKey() { if (SECRET.length < 32) throw fail('APP_SECRET precisa ter pelo menos 32 caracteres.', 503); return createHash('sha256').update('menuza:admin-2fa:v1:').update(SECRET).digest(); }
function encryptTwoFactorSecret(secret) { const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',twoFactorEncryptionKey(),iv),encrypted=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]); return [iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),encrypted.toString('base64url')].join('.'); }
function decryptTwoFactorSecret(value) { try { const [ivText,tagText,encryptedText]=String(value||'').split('.'); if(!ivText||!tagText||!encryptedText)throw new Error('Formato inválido'); const decipher=createDecipheriv('aes-256-gcm',twoFactorEncryptionKey(),Buffer.from(ivText,'base64url')); decipher.setAuthTag(Buffer.from(tagText,'base64url')); return Buffer.concat([decipher.update(Buffer.from(encryptedText,'base64url')),decipher.final()]).toString('utf8'); } catch { throw fail('Não foi possível abrir a configuração 2FA. Confira se APP_SECRET permanece igual ao usado na ativação.',503); } }
function recoveryCodeHash(code) { return createHmac('sha256',SECRET).update('menuza-admin-2fa-recovery:').update(String(code||'').replace(/[^a-z0-9]/gi,'').toUpperCase()).digest('hex'); }
function recoveryCodeMatches(stored,candidate) { const a=Buffer.from(String(stored||''),'hex'),b=Buffer.from(recoveryCodeHash(candidate),'hex'); return a.length===b.length&&timingSafeEqual(a,b); }
async function getAdminTwoFactor() { await ensureAdminTwoFactorSchema(); return (await query('SELECT secret_encrypted AS "secretEncrypted",pending_secret_encrypted AS "pendingSecretEncrypted",pending_expires_at AS "pendingExpiresAt",recovery_codes_hashes AS "recoveryCodesHashes",enabled_at AS "enabledAt" FROM admin_two_factor WHERE restaurant_id=$1',[RESTAURANT_ID])).rows[0]||null; }
function validAdminPassword(password) { if(typeof password!=='string'||password.length>128||!ADMIN_PASSWORD||SECRET.length<32)return false; const candidate=createHmac('sha256',SECRET).update(password).digest(),expected=createHmac('sha256',SECRET).update(ADMIN_PASSWORD).digest(); return timingSafeEqual(candidate,expected); }
async function verifyAdminSecondFactor(body) {
  if(ADMIN_TOTP_SECRET)return verifyTotp(ADMIN_TOTP_SECRET,String(body.otp||''));
  const row=await getAdminTwoFactor(); if(!row?.enabledAt)return true; if(!row.secretEncrypted)throw fail('A configuração 2FA está inconsistente. Procure o suporte antes de tentar entrar.',503);
  if(verifyTotp(decryptTwoFactorSecret(row.secretEncrypted),String(body.otp||'')))return true;
  const recoveryCode=String(body.recoveryCode||'').trim(); if(!recoveryCode)return false;
  return withTransaction(async client=>{
    const locked=await client.query('SELECT recovery_codes_hashes FROM admin_two_factor WHERE restaurant_id=$1 FOR UPDATE',[RESTAURANT_ID]);
    const hashes=Array.isArray(locked.rows[0]?.recovery_codes_hashes)?locked.rows[0].recovery_codes_hashes:[];
    const index=hashes.findIndex(hash=>recoveryCodeMatches(hash,recoveryCode)); if(index<0)return false;
    hashes.splice(index,1); await client.query('UPDATE admin_two_factor SET recovery_codes_hashes=$1::jsonb,updated_at=NOW() WHERE restaurant_id=$2',[JSON.stringify(hashes),RESTAURANT_ID]); return true;
  });
}
function createRecoveryCodes() { return Array.from({length:10},()=>{const raw=randomBytes(6).toString('hex').toUpperCase();return raw.slice(0,6)+'-'+raw.slice(6)}); }
// Sessões persistentes: guarda hashes de tokens e permite revogar sessões no servidor.
async function ensureAuthSessionsSchema(){
  if(!authSessionsSchemaPromise)authSessionsSchemaPromise=(async()=>{
    await query(`CREATE TABLE IF NOT EXISTS auth_sessions(token_hash TEXT PRIMARY KEY,role TEXT NOT NULL CHECK(role IN ('admin','customer')),subject_id TEXT NOT NULL,restaurant_id TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL,revoked_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await query('CREATE INDEX IF NOT EXISTS auth_sessions_subject_idx ON auth_sessions(role,subject_id,expires_at)');
  })().catch(e=>{authSessionsSchemaPromise=null;throw e});
  await authSessionsSchemaPromise;
}
function rawCookieToken(req,name){
  const prefix=name+'=',raw=String(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(prefix));
  if(!raw)return '';try{return decodeURIComponent(raw.slice(prefix.length))}catch{return ''}
}
function tokenHash(token){return createHash('sha256').update(token).digest('hex')}
async function storeSession(token,role,subjectId,expiresAt){
  await ensureAuthSessionsSchema();
  await query('INSERT INTO auth_sessions(token_hash,role,subject_id,restaurant_id,expires_at) VALUES($1,$2,$3,$4,$5)',[tokenHash(token),role,subjectId,RESTAURANT_ID,new Date(expiresAt).toISOString()]);
}
async function revokeSession(req,name){
  const token=rawCookieToken(req,name);if(!token)return;
  await ensureAuthSessionsSchema();
  await query('UPDATE auth_sessions SET revoked_at=NOW() WHERE token_hash=$1 AND revoked_at IS NULL',[tokenHash(token)]);
}
async function session(req,name){
  const token=rawCookieToken(req,name);if(!token||SECRET.length<32)return null;
  try{
    const i=token.lastIndexOf('.');if(i<1)return null;
    const body=token.slice(0,i),signature=token.slice(i+1),expected=createHmac('sha256',SECRET).update(body).digest(),given=Buffer.from(signature,'base64url');
    if(given.length!==expected.length||!timingSafeEqual(given,expected))return null;
    const parsed=JSON.parse(Buffer.from(body,'base64url').toString('utf8'));if(!parsed.exp||parsed.exp<=Date.now())return null;
    await ensureAuthSessionsSchema();
    const result=await query('SELECT role,subject_id AS "subjectId",restaurant_id AS "restaurantId" FROM auth_sessions WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>NOW()',[tokenHash(token)]);
    const row=result.rows[0],subject=parsed.role==='admin'?parsed.restaurantId:parsed.customerId;
    if(!row||row.role!==parsed.role||row.restaurantId!==RESTAURANT_ID||!subject||row.subjectId!==subject)return null;
    return parsed;
  }catch{return null}
}
function cookie(name, value, maxAge) {
  return name + '=' + encodeURIComponent(value) + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + maxAge + (IS_PROD ? '; Secure' : '');
}
async function requireAdmin(req) {
  const value=await session(req,ADMIN_COOKIE);
  if(!value||value.role!=='admin'||value.restaurantId!==RESTAURANT_ID)throw fail('Entre no painel para continuar.',401);
  return value;
}
let customerSchemaPromise;
// Conta do cliente: garante as colunas e estruturas necessárias para cadastro e autenticação.
async function ensureCustomerSchema() {
  if (!customerSchemaPromise) customerSchemaPromise = Promise.all([query("ALTER TABLE customers ADD COLUMN IF NOT EXISTS birth_date DATE"),query("ALTER TABLE customers ADD COLUMN IF NOT EXISTS marketing_consent_at TIMESTAMPTZ")]).catch(error => { customerSchemaPromise = null; throw error; });
  await customerSchemaPromise;
}
function parseBirthDate(value) {
  const raw = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw fail('Informe uma data de nascimento válida.',422);
  const date = new Date(raw+'T00:00:00.000Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10)!==raw) throw fail('Informe uma data de nascimento válida.',422);
  const today=new Date(); let age=today.getUTCFullYear()-date.getUTCFullYear();
  const month=today.getUTCMonth()-date.getUTCMonth();
  if(month<0||(month===0&&today.getUTCDate()<date.getUTCDate())) age--;
  if(date.getTime()>Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate())||age>120) throw fail('Confira sua data de nascimento.',422);
  return {birthDate:raw,age,isAdult:age>=18};
}
async function customer(req) {
  const value = await session(req, CUSTOMER_COOKIE);
  if (!value || value.role !== 'customer' || !value.customerId) return null;
  await ensureCustomerSchema();
  const result = await query('SELECT id,name,email,phone,birth_date AS "birthDate",marketing_consent_at AS "marketingConsentAt" FROM customers WHERE id=$1', [value.customerId]);
  const row=result.rows[0];
  return row ? { ...value, customer: {...row,marketingConsent:Boolean(row.marketingConsentAt),isAdult:row.birthDate?parseBirthDate(String(row.birthDate).slice(0,10)).isAdult:null} } : null;
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
async function verifyTurnstile(token, req) {
  const secret = String(process.env.TURNSTILE_SECRET_KEY || '').trim();
  const siteKey = String(process.env.TURNSTILE_SITE_KEY || '').trim();
  if (!secret && !siteKey) return true;
  if (!secret || !siteKey) throw fail('A proteção antirrobô está configurada de forma incompleta. Confira as duas chaves do Turnstile.', 503);
  if (!token || typeof token !== 'string' || token.length > 4096) throw fail('Confirme a verificação de segurança e tente novamente.', 403);
  const form = new URLSearchParams({ secret, response: token });
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  if (ip) form.set('remoteip', ip);
  let result;
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form });
    result = await response.json();
  } catch { throw fail('Não foi possível validar a proteção antirrobô. Tente novamente.', 503); }
  if (!result?.success) throw fail('A verificação de segurança expirou ou é inválida. Tente novamente.', 403);
  return true;
}
function hasHoneypot(body) {
  return ['website', 'companyWebsite', 'faxNumber'].some(key => typeof body[key] === 'string' && body[key].trim());
}
async function limit(req,key,maximum,windowMs){return consumeRateLimit({req,key,maximum,windowMs,secret:SECRET,query,withTransaction})}
// Privacidade: mantém o schema dos pedidos de acesso, correção e exclusão de dados.
async function ensurePrivacyRequestFields() {
  await query("ALTER TABLE privacy_requests ADD COLUMN IF NOT EXISTS response_note TEXT NOT NULL DEFAULT ''");
  await query("ALTER TABLE privacy_requests ADD COLUMN IF NOT EXISTS retention_reason TEXT NOT NULL DEFAULT ''");
  await query("ALTER TABLE privacy_requests ADD COLUMN IF NOT EXISTS closed_at TEXT");
  await query(`CREATE TABLE IF NOT EXISTS privacy_request_events (
    id BIGSERIAL PRIMARY KEY,
    request_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    from_status TEXT NOT NULL DEFAULT '',
    to_status TEXT NOT NULL DEFAULT '',
    actor_type TEXT NOT NULL DEFAULT 'system',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await query("CREATE INDEX IF NOT EXISTS privacy_request_events_request_idx ON privacy_request_events (request_id, created_at)");
}
let pizzaConfigSchemaPromise;
// Configuração de pizzas: tamanhos e bordas são lidos do cadastro do restaurante.
async function ensurePizzaConfigSchema(){
 if(!pizzaConfigSchemaPromise)pizzaConfigSchemaPromise=(async()=>{
  await query(`CREATE TABLE IF NOT EXISTS pizza_sizes (id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL, key TEXT NOT NULL, label TEXT NOT NULL, diameter_cm INTEGER NOT NULL DEFAULT 0, max_flavors INTEGER NOT NULL DEFAULT 1, price_cents INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0, UNIQUE(restaurant_id,key))`);
  await query("ALTER TABLE pizza_sizes ADD COLUMN IF NOT EXISTS price_cents INTEGER NOT NULL DEFAULT 0");
  await query(`CREATE TABLE IF NOT EXISTS pizza_crusts (id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL, key TEXT NOT NULL, label TEXT NOT NULL, price_cents INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0, UNIQUE(restaurant_id,key))`);
  // Registros inativos eram opções removidas do cadastro; não devem permanecer duplicando o banco.
  await query('DELETE FROM pizza_sizes WHERE restaurant_id=$1 AND active=0',[RESTAURANT_ID]);
  await query('DELETE FROM pizza_crusts WHERE restaurant_id=$1 AND active=0',[RESTAURANT_ID]);
  // Não criar tamanhos ou bordas padrão: somente o que o restaurante cadastrar deve existir.
 })().catch(e=>{pizzaConfigSchemaPromise=null;throw e});await pizzaConfigSchemaPromise;
}
let beverageSchemaPromise;
async function ensureBeverageSchema() {
  if (!beverageSchemaPromise) {
    beverageSchemaPromise = withTransaction(async client => {
      // Serializa a migração entre instâncias serverless que recebam o primeiro
      // cadastro de bebida ao mesmo tempo.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ['menuza:products-type-check']);
      const current = await client.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='products'::regclass AND conname='products_type_check'");
      if (String(current.rows[0]?.definition || '').includes("'drink'")) return;
      await client.query('ALTER TABLE products DROP CONSTRAINT IF EXISTS products_type_check');
      await client.query("ALTER TABLE products ADD CONSTRAINT products_type_check CHECK (type IN ('pizza','burger','plate','drink'))");
    }).catch(error => {
      beverageSchemaPromise = null;
      throw error;
    });
  }
  await beverageSchemaPromise;
}
let promoDeliverySchemaPromise;
async function ensurePromoDeliverySchema() {
  if (!promoDeliverySchemaPromise) {
    promoDeliverySchemaPromise = withTransaction(async client => {
      // Evita que instâncias serverless concorrentes executem a mesma migração
      // simultaneamente durante um cold start.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['menuza:promo-delivery-schema']);
      await client.query("ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS address TEXT NOT NULL DEFAULT ''");
      await client.query("ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS promo_banner_image TEXT NOT NULL DEFAULT ''");
      await client.query("ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS promo_banner_title TEXT NOT NULL DEFAULT 'Ofertas especiais'");
      await client.query("ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS promo_banner_text TEXT NOT NULL DEFAULT 'Confira nossas promoções e aproveite'");
      await client.query("ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS promo_banner_active INTEGER NOT NULL DEFAULT 0");
      await client.query("ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION");
      await client.query("ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION");
      await client.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_fee_cents INTEGER NOT NULL DEFAULT 0");
      await client.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_zone_name TEXT NOT NULL DEFAULT ''");
      await client.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_distance_km DOUBLE PRECISION");
      await client.query(`CREATE TABLE IF NOT EXISTS product_promotions (
        id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL, product_id TEXT NOT NULL,
        discount_type TEXT NOT NULL CHECK(discount_type IN ('fixed','percent')),
        promotional_price_cents INTEGER, discount_percent INTEGER,
        weekdays_json TEXT NOT NULL DEFAULT '[1,2,3,4,5,6,7]',
        active INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(restaurant_id,product_id)
      )`);
      await client.query("ALTER TABLE product_promotions ADD COLUMN IF NOT EXISTS size_key TEXT NOT NULL DEFAULT ''");
      await client.query("ALTER TABLE product_promotions ADD COLUMN IF NOT EXISTS promotion_name TEXT NOT NULL DEFAULT ''");
      await client.query("ALTER TABLE product_promotions ADD COLUMN IF NOT EXISTS included_crust_key TEXT NOT NULL DEFAULT ''");
      await client.query("ALTER TABLE product_promotions ADD COLUMN IF NOT EXISTS banner_image TEXT NOT NULL DEFAULT ''");
      await client.query("ALTER TABLE product_promotions ADD COLUMN IF NOT EXISTS card_image TEXT NOT NULL DEFAULT ''");
      await client.query("ALTER TABLE product_promotions DROP CONSTRAINT IF EXISTS product_promotions_restaurant_id_product_id_key");
      await client.query("CREATE UNIQUE INDEX IF NOT EXISTS product_promotions_product_size_unique ON product_promotions(restaurant_id,product_id,size_key)");
      await client.query(`CREATE TABLE IF NOT EXISTS delivery_zones (
        id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL, name TEXT NOT NULL,
        fee_mode TEXT NOT NULL CHECK(fee_mode IN ('fixed','per_km')),
        fee_cents INTEGER NOT NULL DEFAULT 0, per_km_cents INTEGER NOT NULL DEFAULT 100, distance_km DOUBLE PRECISION NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(restaurant_id,name)
      )`);
      await client.query('ALTER TABLE delivery_zones ADD COLUMN IF NOT EXISTS distance_km DOUBLE PRECISION NOT NULL DEFAULT 0');
      await client.query(`INSERT INTO delivery_zones (id,restaurant_id,name,fee_mode,fee_cents,per_km_cents,active)
        VALUES ('zone-centro', $1, 'Centro', 'fixed', 800, 100, 1)
        ON CONFLICT (restaurant_id,name) DO NOTHING`, [RESTAURANT_ID]);
      await client.query(`INSERT INTO delivery_zones (id,restaurant_id,name,fee_mode,fee_cents,per_km_cents,active) VALUES ('zone-boavista',$1,'Boa Vista','fixed',800,100,1) ON CONFLICT (restaurant_id,name) DO NOTHING`,[RESTAURANT_ID]);
      await client.query(`INSERT INTO delivery_zones (id,restaurant_id,name,fee_mode,fee_cents,per_km_cents,active) VALUES ('zone-demais',$1,'Demais localidades','per_km',0,100,0) ON CONFLICT (restaurant_id,name) DO NOTHING`,[RESTAURANT_ID]);
      await client.query("UPDATE delivery_zones SET distance_km=1 WHERE restaurant_id=$1 AND id='zone-demais' AND distance_km=0",[RESTAURANT_ID]);
      await client.query(`INSERT INTO restaurants (id,name,slug,currency,prep_minutes,created_at,logo_url,address)
        VALUES ($1,'Galileu Pizzas e Lanches','galileu-pizzas-e-lanches','BRL',30,$2,'',
        'Rua Luiz Vendramin, 267 - Boa Vista, Pouso Redondo - SC, 89172-000')
        ON CONFLICT (id) DO UPDATE SET name='Galileu Pizzas e Lanches',
        address=CASE WHEN restaurants.address='' THEN EXCLUDED.address ELSE restaurants.address END`,
        [RESTAURANT_ID,new Date().toISOString()]);
    }).catch(error => { promoDeliverySchemaPromise = null; throw error; });
  }
  await promoDeliverySchemaPromise;
}
// Promoções: determina o dia da semana usando o fuso horário comercial do Brasil.
function saoPauloWeekday() {
  const day = new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',weekday:'short'}).format(new Date());
  return ({Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6,Sun:7})[day] || 1;
}
function promotionPrice(product, promotion, sizeKey='') {
  if (!promotion || Number(promotion.active)!==1) return null;
  let days=[]; try { days=JSON.parse(promotion.weekdays_json||'[]'); } catch {}
  // O campo pode conter números (formato atual) ou strings (cadastros antigos).
  // Normalizar evita que ["1","2"] seja tratado como se nenhum dia estivesse ativo.
  const today=saoPauloWeekday();
  if (!Array.isArray(days) || !days.some(day=>Number(day)===today)) return null;
  const base=product.type==='pizza'?(sizeKey?Number(product.sizePrices?.[sizeKey]):Number(product.baseCents)):Number(product.baseCents);
  if(!Number.isInteger(base)||base<1)return null;
  const price=promotion.discount_type==='percent'?Math.round(base*(100-Number(promotion.discount_percent))/100):Number(promotion.promotional_price_cents);
  return Number.isInteger(price) && price>=0 && price<base ? price : null;
}
async function deliveryConfig() {
  await ensurePromoDeliverySchema();
  const [restaurant,zones]=await Promise.all([
    query('SELECT address,latitude,longitude FROM restaurants WHERE id=$1',[RESTAURANT_ID]),
    query('SELECT id,name,fee_mode AS "feeMode",fee_cents AS "feeCents",per_km_cents AS "perKmCents",distance_km AS "distanceKm",active FROM delivery_zones WHERE restaurant_id=$1 ORDER BY name',[RESTAURANT_ID])
  ]);
  return { restaurant:restaurant.rows[0]||{}, zones:zones.rows.map(z=>({...z,feeCents:Number(z.feeCents),perKmCents:Number(z.perKmCents),distanceKm:Number(z.distanceKm),active:Number(z.active)===1})) };
}
function distanceKm(aLat,aLon,bLat,bLon) {
  const rad=v=>v*Math.PI/180, dLat=rad(bLat-aLat),dLon=rad(bLon-aLon);
  const a=Math.sin(dLat/2)**2+Math.cos(rad(aLat))*Math.cos(rad(bLat))*Math.sin(dLon/2)**2;
  return 6371*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
// Entrega: calcula distância e taxa conforme as zonas e regras cadastradas.
async function calculateDelivery(body) {
  if (body.fulfillment!=='delivery') return {feeCents:0,zoneName:'',distanceKm:null};
  const config=await deliveryConfig();
  const zone=config.zones.find(z=>z.id===clean(body.deliveryZoneId,100)&&z.active);
  if (!zone) throw fail('Selecione uma região de entrega válida.',422);
  if (zone.feeMode==='fixed') return {feeCents:zone.feeCents,zoneName:zone.name,distanceKm:null};
  const km=Number(zone.distanceKm);
  if (!Number.isFinite(km)||km<=0||km>100) throw fail('Configure a distância estimada desta região no painel do restaurante.',422);
  return {feeCents:Math.round(km*zone.perKmCents),zoneName:zone.name,distanceKm:Math.round(km*10)/10};
}
async function savePromotion(body,id=null) {
  const applyToAll=body.applyToAllPizzas===true||body.productId==='__all_pizzas__';
  const productId=applyToAll?'__all_pizzas__':clean(body.productId,100),type=body.discountType;
  let product=null,normalPrice=0,sizeKey='',crustKey='';
  if(applyToAll){
    sizeKey=clean(body.sizeKey,80);
    const size=(await query('SELECT key,price_cents AS "priceCents" FROM pizza_sizes WHERE restaurant_id=$1 AND key=$2 AND active=1',[RESTAURANT_ID,sizeKey])).rows[0];
    if(!size)throw fail('Selecione um tamanho de pizza ativo.',422);
    normalPrice=Number(size.priceCents);
    if(!Number.isInteger(normalPrice)||normalPrice<500){
      const candidates=(await query("SELECT size_prices_json AS prices FROM products WHERE restaurant_id=$1 AND type='pizza' AND active=1",[RESTAURANT_ID])).rows;
      const values=candidates.map(row=>{try{return Number(JSON.parse(row.prices||'{}')[sizeKey])}catch{return 0}}).filter(value=>Number.isInteger(value)&&value>=500);
      normalPrice=values.length&&values.every(value=>value===values[0])?values[0]:0;
    }
    if(!Number.isInteger(normalPrice)||normalPrice<500)throw fail('Configure o preço normal compartilhado deste tamanho antes de criar a promoção.',422);
  }else{
    product=(await query('SELECT id,type,base_price_cents AS "baseCents",size_prices_json AS "sizePricesJson" FROM products WHERE id=$1 AND restaurant_id=$2',[productId,RESTAURANT_ID])).rows[0];
    if(!product)throw fail('Produto não encontrado.',404);
    let sizePrices={};try{sizePrices=JSON.parse(product.sizePricesJson||'{}')}catch{}
    sizeKey=product.type==='pizza'?clean(body.sizeKey,80):'';
    if(product.type==='pizza'&&!sizeKey)throw fail('Selecione o tamanho da promoção.',422);
    if(product.type==='pizza'&&!(await query('SELECT key FROM pizza_sizes WHERE restaurant_id=$1 AND key=$2 AND active=1',[RESTAURANT_ID,sizeKey])).rows[0])throw fail('O tamanho selecionado não está ativo.',422);
    normalPrice=product.type==='pizza'?Number(sizePrices[sizeKey]):Number(product.baseCents);
    if(product.type==='pizza'&&(!Number.isInteger(normalPrice)||normalPrice<500)){
      const shared=(await query('SELECT price_cents AS "priceCents" FROM pizza_sizes WHERE restaurant_id=$1 AND key=$2 AND active=1',[RESTAURANT_ID,sizeKey])).rows[0];
      normalPrice=Number(shared?.priceCents)||0;
      if(normalPrice<500){
        const candidates=(await query("SELECT size_prices_json AS prices FROM products WHERE restaurant_id=$1 AND type='pizza' AND active=1",[RESTAURANT_ID])).rows;
        const values=candidates.map(row=>{try{return Number(JSON.parse(row.prices||'{}')[sizeKey])}catch{return 0}}).filter(value=>Number.isInteger(value)&&value>=500);
        normalPrice=values.length&&values.every(value=>value===values[0])?values[0]:0;
      }
    }
  }
  crustKey=(applyToAll||product?.type==='pizza')?clean(body.includedCrustKey,80):'';
  if(crustKey&&!(await query('SELECT key FROM pizza_crusts WHERE restaurant_id=$1 AND key=$2 AND active=1',[RESTAURANT_ID,crustKey])).rows[0])throw fail('A borda selecionada não está ativa.',422);
  const days=Array.isArray(body.weekdays)?[...new Set(body.weekdays.map(Number))]:[];
  if(!days.length||days.some(d=>!Number.isInteger(d)||d<1||d>7))throw fail('Selecione pelo menos um dia da semana.',422);
  let price=null,percent=null;
  if(type==='fixed'){price=Number(body.promotionalPriceCents);if(!Number.isInteger(price)||price<1||price>=normalPrice)throw fail('O preço promocional deve ser menor que o preço normal do tamanho.',422)}
  else if(type==='percent'){percent=Number(body.discountPercent);if(!Number.isInteger(percent)||percent<1||percent>90)throw fail('O desconto deve ficar entre 1% e 90%.',422)}
  else throw fail('Escolha um tipo de promoção válido.',422);
  const rawBannerImage=String(body.bannerImage||''),rawCardImage=String(body.cardImage||'');for(const [label,image] of [['banner',rawBannerImage],['card',rawCardImage]])if(image.length>1400000||image&&!isImageDataUrl(image)&&!isStoredImageUrl(image))throw fail('Envie uma imagem válida para o '+label+' da promoção.',422);const bannerImage=rawBannerImage.startsWith('data:')?await storeImageDataUrl(rawBannerImage,'restaurants/promotion-banners'):rawBannerImage,cardImage=rawCardImage.startsWith('data:')?await storeImageDataUrl(rawCardImage,'restaurants/promotion-cards'):rawCardImage;const now=new Date().toISOString(),promotionId=id||'prm_'+randomBytes(12).toString('hex');
  const result=await query(`INSERT INTO product_promotions
    (id,restaurant_id,product_id,promotion_name,banner_image,card_image,size_key,included_crust_key,discount_type,promotional_price_cents,discount_percent,weekdays_json,active,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)
    ON CONFLICT (restaurant_id,product_id,size_key) DO UPDATE SET promotion_name=EXCLUDED.promotion_name,banner_image=CASE WHEN EXCLUDED.banner_image<>'' THEN EXCLUDED.banner_image ELSE product_promotions.banner_image END,card_image=CASE WHEN EXCLUDED.card_image<>'' THEN EXCLUDED.card_image ELSE product_promotions.card_image END,included_crust_key=EXCLUDED.included_crust_key,discount_type=EXCLUDED.discount_type,
    promotional_price_cents=EXCLUDED.promotional_price_cents,discount_percent=EXCLUDED.discount_percent,
    weekdays_json=EXCLUDED.weekdays_json,active=EXCLUDED.active,updated_at=EXCLUDED.updated_at
    RETURNING *`,[promotionId,RESTAURANT_ID,productId,clean(body.promotionName,80),bannerImage,cardImage,sizeKey,crustKey,type,price,percent,JSON.stringify(days),body.active===false?0:1,now]);
  return result.rows[0];
}
async function saveDeliveryZone(body,id=null) {
  const name=clean(body.name,70),mode=body.feeMode,fee=Number(body.feeCents),rate=Number(body.perKmCents??100),distance=Number(body.distanceKm??0);
  if(name.length<2||!['fixed','per_km'].includes(mode)||!Number.isInteger(fee)||fee<0||fee>100000||!Number.isInteger(rate)||rate<1||rate>100000||!Number.isFinite(distance)||distance<0||distance>100||(mode==='per_km'&&distance<=0))
    throw fail('Confira o nome da região e os valores da taxa.',422);
  const zoneId=id||'zone_'+randomBytes(10).toString('hex'),now=new Date().toISOString();
  const result=await query(`INSERT INTO delivery_zones (id,restaurant_id,name,fee_mode,fee_cents,per_km_cents,distance_km,active,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
    ON CONFLICT (restaurant_id,name) DO UPDATE SET fee_mode=EXCLUDED.fee_mode,fee_cents=EXCLUDED.fee_cents,
    per_km_cents=EXCLUDED.per_km_cents,distance_km=EXCLUDED.distance_km,active=EXCLUDED.active,updated_at=EXCLUDED.updated_at
    RETURNING id,name,fee_mode AS "feeMode",fee_cents AS "feeCents",per_km_cents AS "perKmCents",distance_km AS "distanceKm",active`,
    [zoneId,RESTAURANT_ID,name,mode,fee,rate,distance,body.active===false?0:1,now]);
  return result.rows[0];
}
async function migrateRestaurantImageFields(restaurant) {
  if (!restaurant) return restaurant;
  if (isImageDataUrl(restaurant.logoUrl)) {
    restaurant.logoUrl = await storeImageDataUrl(restaurant.logoUrl, 'restaurants/logos');
    await query('UPDATE restaurants SET logo_url=$1 WHERE id=$2',[restaurant.logoUrl,RESTAURANT_ID]);
  }
  if (isImageDataUrl(restaurant.promoBannerImage)) {
    restaurant.promoBannerImage = await storeImageDataUrl(restaurant.promoBannerImage, 'restaurants/banners');
    await query('UPDATE restaurants SET promo_banner_image=$1 WHERE id=$2',[restaurant.promoBannerImage,RESTAURANT_ID]);
  }
  return restaurant;
}

async function validateSizePrices(type, value, fallbackCents) {
  // Hambúrguer e hot dog usam preço-base próprio; não exigem tabela de preços por tamanho.
  if (['drink', 'burger', 'plate'].includes(type)) return {};
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('Informe um preço para cada tamanho.',422);
  await ensurePizzaConfigSchema();
  const options=type==='pizza'?(await query('SELECT key,label FROM pizza_sizes WHERE restaurant_id=$1 AND active=1 ORDER BY sort_order',[RESTAURANT_ID])).rows:(SIZE_OPTIONS[type]||[]);
  const result={};
  for (const option of options) {
    const cents=Number(value[option.key]);
    if (!Number.isInteger(cents) || cents < 500 || cents > 1000000) throw fail('Informe um preço válido para o tamanho '+option.label+'.',422);
    result[option.key]=cents;
  }
  if (!options.length) throw fail('Este produto não possui tamanhos configuráveis.',422);
  return result;
}
const DEFAULT_OPENING_HOURS = { configured: false, days: {} };
let openingHoursSchemaPromise;
// Horários: prepara as regras semanais e exceções usadas para permitir ou bloquear pedidos.
async function ensureOpeningHoursSchema() {
  if (!openingHoursSchemaPromise) openingHoursSchemaPromise = query("ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS opening_hours_json TEXT NOT NULL DEFAULT '{\"configured\":false,\"days\":{}}'").catch(error => { openingHoursSchemaPromise = null; throw error; });
  await openingHoursSchemaPromise;
}
function normalizeOpeningHours(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !value.days || typeof value.days !== 'object' || Array.isArray(value.days)) throw fail('Informe os horários de funcionamento.',422);
  const days = {};
  for (let day=1; day<=7; day++) {
    const source=value.days[String(day)] || {};
    const enabled=Boolean(source.enabled);
    const periods=Array.isArray(source.periods)?source.periods:[];
    if (periods.length>4) throw fail('Cada dia permite até quatro períodos de funcionamento.',422);
    const normalized=(enabled?periods:[]).map(period=>{
      const open=String(period?.open||''),close=String(period?.close||'');
      if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(open)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(close)||open>=close) throw fail('Confira os horários: o encerramento deve ser depois da abertura.',422);
      return {open,close};
    }).sort((a,b)=>a.open.localeCompare(b.open));
    for(let i=1;i<normalized.length;i++) if(normalized[i].open<normalized[i-1].close) throw fail('Os períodos do mesmo dia não podem se sobrepor.',422);
    if(enabled&&!normalized.length) throw fail('Adicione ao menos um período para cada dia aberto.',422);
    days[String(day)]={enabled,periods:enabled?normalized:[]};
  }
  return {configured:true,days};
}
function openingHoursState(schedule) {
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());
  const values=Object.fromEntries(parts.filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));
  const day=({Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6,Sun:7})[values.weekday]||1;
  const now=values.hour+':'+values.minute;
  const today=schedule?.days?.[String(day)]||{enabled:false,periods:[]};
  const isOpen=!schedule?.configured||Boolean(today.enabled&&today.periods?.some(period=>now>=period.open&&now<period.close));
  const next=today.periods?.find(period=>now<period.open);
  const message=!schedule?.configured?'Horários ainda não configurados':isOpen?'Aberto agora':next?'Fechado agora · abre às '+next.open:'Fechado agora';
  return {configured:Boolean(schedule?.configured),isOpen,day,message,timezone:'America/Sao_Paulo'};
}
async function getOpeningHours() {
  await ensureOpeningHoursSchema();
  const row=(await query('SELECT opening_hours_json AS "openingHoursJson" FROM restaurants WHERE id=$1',[RESTAURANT_ID])).rows[0];
  let schedule=DEFAULT_OPENING_HOURS;
  try { const parsed=JSON.parse(row?.openingHoursJson||'{}'); if(parsed&&typeof parsed==='object')schedule={...DEFAULT_OPENING_HOURS,...parsed}; } catch {}
  return {schedule,status:openingHoursState(schedule)};
}
function assertRestaurantOpen(schedule) {
  const status=openingHoursState(schedule);
  if(!status.isOpen) throw fail('O restaurante está fechado neste momento. Confira os horários de funcionamento no cardápio.',403);
}
// Catálogo administrativo/público: transforma os registros do Postgres no contrato consumido pela interface.
let catalogSchemaPromise;
async function ensureCatalogSchema() {
  if (!catalogSchemaPromise) {
    catalogSchemaPromise = (async () => {
      await query("ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS google_review_url TEXT NOT NULL DEFAULT ''");
      await query("ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS google_review_url_initialized BOOLEAN NOT NULL DEFAULT FALSE");
      await query("UPDATE restaurants SET google_review_url=$1,google_review_url_initialized=TRUE WHERE id=$2 AND google_review_url_initialized=FALSE", ["https://share.google/dg8sziHxshXgV93g8", RESTAURANT_ID]);
      await query("UPDATE categories SET name='Hot Dogs',slug='hot-dogs' WHERE restaurant_id=$1 AND lower(unaccent(name)) IN ('porções','porcoes')", [RESTAURANT_ID]).catch(() => {});
      await query("ALTER TABLE products ADD COLUMN IF NOT EXISTS age_restricted INTEGER NOT NULL DEFAULT 0");
      await query("ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_cents INTEGER NOT NULL DEFAULT 0");
      await query("ALTER TABLE products ADD COLUMN IF NOT EXISTS ingredient_ids_json TEXT NOT NULL DEFAULT '[]'");
      await query("ALTER TABLE products ADD COLUMN IF NOT EXISTS default_ingredient_ids_json TEXT NOT NULL DEFAULT '[]'");
      await query("ALTER TABLE products ADD COLUMN IF NOT EXISTS ingredient_quantities_json TEXT NOT NULL DEFAULT '{}'");
      await query('ALTER TABLE products ADD COLUMN IF NOT EXISTS ingredients_configured INTEGER NOT NULL DEFAULT 0');
      await query("ALTER TABLE products ADD COLUMN IF NOT EXISTS size_prices_json TEXT NOT NULL DEFAULT '{}'");
      await query("ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT NOT NULL DEFAULT ''");
      await query("ALTER TABLE products ADD COLUMN IF NOT EXISTS product_images_json TEXT NOT NULL DEFAULT '[]'");
      await query("ALTER TABLE products ADD COLUMN IF NOT EXISTS model_3d_url TEXT NOT NULL DEFAULT ''");
      await query("ALTER TABLE products ADD COLUMN IF NOT EXISTS model_3d_status TEXT NOT NULL DEFAULT 'not_requested'");
      await query(`CREATE TABLE IF NOT EXISTS product_3d_jobs (
        id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL, product_id TEXT NOT NULL,
        image_data TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
        error_message TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    })().catch(error => {
      catalogSchemaPromise = null;
      throw error;
    });
  }
  await catalogSchemaPromise;
}
// Catálogo administrativo/público: transforma os registros do Postgres no contrato consumido pela interface.
async function catalogFor(admin = false) {
  // Executa migrações de inicialização uma vez por instância, fora do caminho
  // repetido de consultas. A ordem evita concorrência de ALTER TABLE na mesma tabela.
  await ensureOpeningHoursSchema();
  await ensurePizzaConfigSchema();
  await ensurePromoDeliverySchema();
  await ensureCatalogSchema();
  const active = admin ? '' : ' AND active=1';
  const [restaurant, categories, products, ingredients, comboRows] = await Promise.all([
    query('SELECT id,name,slug,currency,prep_minutes AS "prepMinutes",logo_url AS "logoUrl",google_review_url AS "googleReviewUrl" FROM restaurants WHERE id=$1', [RESTAURANT_ID]),
    query('SELECT id,name,slug,sort_order AS "sortOrder" FROM categories WHERE restaurant_id=$1 ORDER BY sort_order', [RESTAURANT_ID]),
    query('SELECT id,category_id AS "categoryId",name,description,type,base_price_cents AS "baseCents",cost_cents AS "costCents",active,available,featured,prep_minutes AS "prepMinutes",model_url AS "modelUrl",width_cm AS "widthCm",depth_cm AS "depthCm",height_cm AS "heightCm",ingredient_ids_json AS "ingredientIdsJson",default_ingredient_ids_json AS "defaultIngredientIdsJson",ingredient_quantities_json AS "ingredientQuantitiesJson",ingredients_configured AS "ingredientsConfigured",size_prices_json AS "sizePricesJson",image_url AS "imageUrl",product_images_json AS "productImagesJson",model_3d_url AS "model3dUrl",model_3d_status AS "model3dStatus",age_restricted AS "ageRestricted",updated_at AS "updatedAt" FROM products WHERE restaurant_id=$1'+active+' ORDER BY featured DESC,category_id,name', [RESTAURANT_ID]),
    query('SELECT id,name,type,group_name AS "groupName",addon_cents AS cents,included_by_default AS included,active,sort_order AS "sortOrder" FROM ingredients WHERE restaurant_id=$1'+active+' ORDER BY sort_order', [RESTAURANT_ID]),
    query('SELECT id,name,description,price_cents AS "priceCents",items_json AS "itemsJson",active,created_at AS "createdAt",updated_at AS "updatedAt" FROM combos WHERE restaurant_id=$1'+active+' ORDER BY created_at DESC', [RESTAURANT_ID])
  ]);
  const productRows = await Promise.all(products.rows.map(async product => {
    let ingredientIds = [], defaultIngredientIds = [], ingredientQuantities = {}, images = [], sizePrices = {};
    try { sizePrices = JSON.parse(product.sizePricesJson || '{}'); } catch {}
    try { ingredientIds = JSON.parse(product.ingredientIdsJson || '[]'); } catch {}
    try { defaultIngredientIds = JSON.parse(product.defaultIngredientIdsJson || '[]'); } catch {}
    try { ingredientQuantities = JSON.parse(product.ingredientQuantitiesJson || '{}'); } catch {}
    try { images = JSON.parse(product.productImagesJson || '[]'); } catch {}
    if (!Array.isArray(images) || !images.length) images = product.imageUrl ? [product.imageUrl] : [];
    images = images.filter(value => isImageDataUrl(value) || isStoredImageUrl(value)).slice(0, 8);
    const storedImages = await migrateImageReferences(images, 'products/' + product.id);
    const imageUrl = storedImages[0] || '';
    if (imageUrl !== product.imageUrl || JSON.stringify(storedImages) !== JSON.stringify(images)) {
      await query('UPDATE products SET image_url=$1,product_images_json=$2 WHERE id=$3 AND restaurant_id=$4',[imageUrl,JSON.stringify(storedImages),product.id,RESTAURANT_ID]);
    }
    return {
      ...product,
      imageUrl,
      productImagesJson: JSON.stringify(storedImages),
      images: storedImages,
      ingredientIds: Array.isArray(ingredientIds) ? ingredientIds.filter(id => typeof id === 'string').slice(0, 200) : [],
      defaultIngredientIds: Array.isArray(defaultIngredientIds) ? defaultIngredientIds.filter(id => typeof id === 'string').slice(0, 40) : [],
      ingredientQuantities: ingredientQuantities && typeof ingredientQuantities === 'object' && !Array.isArray(ingredientQuantities) ? ingredientQuantities : {},
      ingredientsConfigured: Number(product.ingredientsConfigured) === 1,
      sizePrices: sizePrices && typeof sizePrices === 'object' && !Array.isArray(sizePrices) ? sizePrices : {},
      ageRestricted: Number(product.ageRestricted) === 1
    };
  }));
  const restaurantRow = await migrateRestaurantImageFields(restaurant.rows[0] || null);
  const openingHours=await getOpeningHours();
  if(restaurantRow){restaurantRow.openingHours=openingHours.schedule;restaurantRow.openingStatus=openingHours.status;}
  const [sizeRows,crustRows]=await Promise.all([query("SELECT key,label,diameter_cm AS \"diameterCm\",max_flavors AS \"maxFlavors\",price_cents AS \"priceCents\",active FROM pizza_sizes WHERE restaurant_id=$1 AND active=1 ORDER BY CASE lower(label) WHEN 'broto' THEN 0 WHEN 'pequena' THEN 1 WHEN 'média' THEN 2 WHEN 'media' THEN 2 WHEN 'grande' THEN 3 WHEN 'família' THEN 4 WHEN 'familia' THEN 4 ELSE 5 END,sort_order",[RESTAURANT_ID]),query('SELECT key,label,price_cents AS "priceCents",active FROM pizza_crusts WHERE restaurant_id=$1 AND active=1 ORDER BY sort_order',[RESTAURANT_ID])]);
  // Os preços efetivamente cadastrados estão em size_prices_json dos produtos.
  // A tabela de tamanhos pode continuar com zero em instalações antigas; recuperar
  // o preço compartilhado salvo (os produtos deste restaurante usam os mesmos valores).
  const sharedPizzaPrices=Object.fromEntries(sizeRows.rows.map(size=>{
    const stored=Number(size.priceCents);
    if(Number.isInteger(stored)&&stored>=500)return [size.key,stored];
    const values=productRows.filter(product=>product.type==='pizza').map(product=>Number(product.sizePrices?.[size.key])).filter(value=>Number.isInteger(value)&&value>=500);
    return [size.key,values.length&&values.every(value=>value===values[0])?values[0]:0];
  }));
  if(Object.keys(sharedPizzaPrices).length){
    for(const product of productRows)if(product.type==='pizza'){
      product.sizePrices={...(product.sizePrices||{}),...Object.fromEntries(Object.entries(sharedPizzaPrices).filter(([,value])=>Number.isInteger(value)&&value>=500))};
      const validPrices=Object.values(sharedPizzaPrices).filter(value=>Number.isInteger(value)&&value>=500);
      if(validPrices.length)product.baseCents=Math.min(...validPrices);
    }
  }
  const promotionRows=(await query('SELECT * FROM product_promotions WHERE restaurant_id=$1',[RESTAURANT_ID])).rows;
  // Garante que imagens antigas ou ainda em data URL das promoções sejam migradas para o bucket,
  // mantendo banner e card independentes e disponíveis no catálogo público.
  for (const promotion of promotionRows) {
    const [bannerImage] = promotion.banner_image ? await migrateImageReferences([promotion.banner_image], 'restaurants/promotion-banners') : [''];
    const [cardImage] = promotion.card_image ? await migrateImageReferences([promotion.card_image], 'restaurants/promotion-cards') : [''];
    if (bannerImage !== (promotion.banner_image || '') || cardImage !== (promotion.card_image || '')) {
      await query('UPDATE product_promotions SET banner_image=$1,card_image=$2,updated_at=NOW() WHERE id=$3 AND restaurant_id=$4',[bannerImage,cardImage,promotion.id,RESTAURANT_ID]);
      promotion.banner_image=bannerImage;
      promotion.card_image=cardImage;
    }
  }
  for (const product of productRows) {
    const rows=product.type==='pizza'?[...promotionRows.filter(p=>p.product_id===product.id),...promotionRows.filter(p=>p.product_id==='__all_pizzas__')]:promotionRows.filter(p=>p.product_id===product.id);
    const mapped=rows.map(p=>{const price=promotionPrice(product,p,p.size_key||'');let weekdays=[];try{weekdays=JSON.parse(p.weekdays_json||'[]')}catch{}return {id:p.id,promotionName:p.promotion_name||'',bannerImage:p.banner_image||'',cardImage:p.card_image||'',applyToAllPizzas:p.product_id==='__all_pizzas__',sizeKey:p.size_key||'',includedCrustKey:p.included_crust_key||'',discountType:p.discount_type,promotionalPriceCents:p.promotional_price_cents?Number(p.promotional_price_cents):null,discountPercent:p.discount_percent?Number(p.discount_percent):null,weekdays,active:Number(p.active)===1,promotionActive:price!==null,calculatedPriceCents:price}});
    product.promotions=mapped;
    const activePizza=mapped.filter(p=>p.sizeKey&&p.promotionActive);
    const legacy=mapped.find(p=>!p.sizeKey);
    const legacyPrice=legacy?promotionPrice(product,rows.find(p=>p.id===legacy.id)):null;
    product.promotionalPriceBySize=Object.fromEntries(activePizza.map(p=>[p.sizeKey,p.calculatedPriceCents]));
    product.promotionalCrustBySize=Object.fromEntries(activePizza.filter(p=>p.includedCrustKey).map(p=>[p.sizeKey,p.includedCrustKey]));
    product.promotion=mapped.find(p=>p.promotionActive)||mapped[0]||null;
    const displayedSizePrices=Object.values(product.promotionalPriceBySize||{});product.promotionalPriceCents=product.type==='pizza'?(displayedSizePrices.length?Math.min(...displayedSizePrices):null):legacyPrice;
  }
  const ingredientsOut = ingredients.rows.map(i => ({ ...i, included: Number(i.included) === 1 || i.included === true, visual: inferIngredientVisual(i) }));
  const combos = comboRows.rows.map(row => {
    let entries = [];
    try { entries = JSON.parse(row.itemsJson); } catch {}
    return { id: row.id, name: row.name, description: row.description, priceCents: row.priceCents, active: Number(row.active), createdAt: row.createdAt, updatedAt: row.updatedAt,
      items: entries.map(entry => { const p = productRows.find(x => x.id === entry.productId); return p ? { productId: p.id, name: p.name, quantity: entry.quantity, baseCents: p.baseCents, ageRestricted: p.ageRestricted } : null; }).filter(Boolean) };
  });
  return { restaurant: restaurantRow, categories: categories.rows, products: productRows, promotions:promotionRows.map(p=>({id:p.id,productId:p.product_id,promotionName:p.promotion_name||'',bannerImage:p.banner_image||'',cardImage:p.card_image||'',sizeKey:p.size_key||'',includedCrustKey:p.included_crust_key||'',discountType:p.discount_type||'fixed',promotionalPriceCents:p.promotional_price_cents?Number(p.promotional_price_cents):null,discountPercent:p.discount_percent?Number(p.discount_percent):null,active:Number(p.active)===1,weekdays:(()=>{try{return JSON.parse(p.weekdays_json||'[]')}catch{return []}})()})), ingredients: ingredientsOut, combos, sizes:{...SIZE_OPTIONS,pizza:sizeRows.rows.map(x=>({...x,priceCents:Number(sharedPizzaPrices[x.key])||0,deltaCents:0}))}, crusts:crustRows.rows.map(x=>({...x,priceCents:Number(x.priceCents)})) };
}
async function validateIngredientQuantities(value, type, selectedIds = []) {
  if (!['burger','plate'].includes(type)) return {};
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw fail('Informe quantidades válidas para os ingredientes.',422);
  const allowed = new Set(selectedIds), result = {};
  for (const [id, raw] of Object.entries(value)) {
    if (!allowed.has(id)) continue;
    const quantity = Number(raw);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) throw fail('Cada ingrediente pode ter de 1 a 20 unidades.',422);
    result[id] = quantity;
  }
  return result;
}
async function validateProductIngredientIds(value, type) {
  if (!Array.isArray(value) || value.length > 200 || value.some(id => typeof id !== 'string' || !id.trim()) || new Set(value).size !== value.length) {
    throw fail('Selecione ingredientes válidos para o produto.', 422);
  }
  if (!value.length) return [];
  const result = await query('SELECT id FROM ingredients WHERE restaurant_id=$1 AND type=$2 AND active=1 AND id=ANY($3::text[])', [RESTAURANT_ID, type, value]);
  if (result.rows.length !== value.length) throw fail('Um dos ingredientes selecionados não está ativo ou não pertence a esse tipo de produto.', 422);
  return value;
}
async function orderById(id) {
  await ensureOperationsSchema();
  const result = await query(`SELECT o.id,o.restaurant_id AS "restaurantId",o.customer_name AS "customerName",o.phone,o.fulfillment,o.table_label AS "tableLabel",o.delivery_address AS "deliveryAddress",o.note,o.status,o.total_cents AS "totalCents",o.payment_method AS "paymentMethod",o.payment_status AS "paymentStatus",o.paid_at AS "paidAt",o.paid_by AS "paidBy",o.coupon_code AS "couponCode",o.discount_cents AS "discountCents",o.delivery_fee_cents AS "deliveryFeeCents",o.delivery_zone_name AS "deliveryZoneName",o.delivery_distance_km AS "deliveryDistanceKm",o.tracking_token AS "trackingToken",o.created_at AS "createdAt",o.updated_at AS "updatedAt",r.prep_minutes AS "prepMinutes"
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
function couponDiscount(c, subtotal, customerId=null) {
  const now = Date.now();
  if (!c || Number(c.active) !== 1) throw fail('Cupom inválido ou inativo.', 422);
  if (c.customer_id && String(c.customer_id)!==String(customerId||'')) throw fail('Este cupom foi emitido para outra conta.',422);
  if (c.starts_at && now < Date.parse(c.starts_at)) throw fail('Esse cupom ainda não está válido.', 422);
  if (c.expires_at && now > Date.parse(c.expires_at)) throw fail('Esse cupom expirou.', 422);
  if (c.max_uses !== null && Number(c.used_count) >= Number(c.max_uses)) throw fail('Esse cupom atingiu o limite de utilizações.', 422);
  if (subtotal < Number(c.minimum_subtotal_cents)) throw fail('O pedido mínimo para esse cupom não foi atingido.', 422);
  return Math.min(subtotal, c.discount_type === 'percent' ? Math.round(subtotal * Number(c.discount_value) / 100) : Number(c.discount_value));
}
// Precificação: valida tamanhos, ingredientes, quantidades, bordas e adicionais antes do checkout.
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
      const p = { id:row.id,name:row.name,description:row.description,type:'plate',widthCm:null,heightCm:null,ageRestricted:chosen.some(i=>i.product.ageRestricted) };
      const unit = Number(row.priceCents);
      subtotal += unit * quantity;
      priced.push({ product:p, quantity, notes:clean(entry.notes,300), combo:true, priced:{ unitPriceCents:unit,linePriceCents:unit*quantity,size:{key:'combo',label:'Combo'},crust:null,ingredients:[],comboItems:chosen.map(i=>({productId:i.product.id,name:i.product.name,quantity:i.quantity})) } });
      continue;
    }
    const product = cat.products.find(p => p.id === entry?.productId && Number(p.active) === 1 && Number(p.available) === 1);
    if (!product) throw fail('Um dos produtos está indisponível ou esgotado no momento.', 409);
    let pricedItem;
    let flavorProducts=[product];
    const requestedPromotion=entry.promotionId
      ? product.promotions?.find(p=>p.id===entry.promotionId&&p.promotionActive&&p.sizeKey===entry.sizeKey)
      : null;
    if(product.type==='pizza'){
      const ids=Array.isArray(entry.flavorProductIds)?[...new Set(entry.flavorProductIds)]:[product.id];
      const sizeOption=(cat.sizes.pizza||[]).find(x=>x.key===entry.sizeKey),limit=Number(sizeOption?.maxFlavors)||1;
      // Uma oferta válida pode ter como produto-base uma pizza diferente dos sabores escolhidos.
      if((!ids.includes(product.id)&&!requestedPromotion)||ids.length<1||ids.length>limit)throw fail('A quantidade de sabores não é permitida para este tamanho.',422);
      flavorProducts=ids.map(fid=>cat.products.find(p=>p.id===fid&&p.type==='pizza'&&Number(p.active)===1&&Number(p.available)===1));
      if(flavorProducts.some(p=>!p))throw fail('Um dos sabores selecionados está indisponível.',409);
    }
    const byoFlavor=flavorProducts.find(isBuildYourOwnPizza)||null;
    const productIngredientIds = new Set(byoFlavor
      ? [...(byoFlavor.ingredientIds || []), ...(byoFlavor.defaultIngredientIds || [])]
      : [...(product.ingredientIds || []), ...(product.defaultIngredientIds || [])]);
    const ingredientSource=byoFlavor||product;
    const productIngredientCatalog = ingredientSource.ingredientsConfigured
      ? cat.ingredients.filter(ingredient => productIngredientIds.has(ingredient.id)).map(ingredient => ({
          ...ingredient,
          included: (ingredientSource.defaultIngredientIds || []).includes(ingredient.id)
        }))
      : cat.ingredients;
    const sizePromo=product.type==='pizza'?(requestedPromotion||product.promotions?.find(p=>p.sizeKey===entry.sizeKey&&p.promotionActive&&p.applyToAllPizzas)||product.promotions?.find(p=>p.sizeKey===entry.sizeKey&&p.promotionActive)):null;
    let effectiveProduct=sizePromo?{...product,sizePrices:{...(product.sizePrices||{}),[entry.sizeKey]:sizePromo.calculatedPriceCents}}:
      product.promotionalPriceCents!==null&&product.promotionalPriceCents!==undefined&&product.type!=='pizza'?{...product,baseCents:product.promotionalPriceCents,sizePrices:Object.fromEntries(Object.entries(product.sizePrices||{}).map(([key,value])=>[key,Math.max(1,Math.round(Number(value)*Number(product.promotionalPriceCents)/Math.max(1,Number(product.baseCents))))]))}:product;
    if(byoFlavor)effectiveProduct={...effectiveProduct,name:byoFlavor.name,ingredientsConfigured:byoFlavor.ingredientsConfigured,ingredientIds:byoFlavor.ingredientIds,defaultIngredientIds:byoFlavor.defaultIngredientIds};
    if(product.type==='pizza'&&flavorProducts.length>1){const priceFor=p=>{const raw=Number(p.sizePrices?.[entry.sizeKey]);return Number.isInteger(raw)&&raw>0?raw:Number(p.baseCents)||0};const maxBase=Math.max(...flavorProducts.map(priceFor));const mixedPromoPrice=sizePromo?(sizePromo.discountType==='percent'?Math.round(maxBase*(100-Number(sizePromo.discountPercent))/100):Number(sizePromo.promotionalPriceCents)):maxBase;effectiveProduct.sizePrices={...(effectiveProduct.sizePrices||{}),[entry.sizeKey]:mixedPromoPrice};}
    const normalizedSizeKey = product.type === 'plate' ? 'unico' : entry.sizeKey;
    const includedCrustKey=sizePromo?.includedCrustKey||'';
    const pricedCrusts=includedCrustKey&&entry.crustKey===includedCrustKey?cat.crusts.map(c=>c.key===includedCrustKey?{...c,priceCents:0}:c):cat.crusts;
    try { pricedItem = calculateItemPrice({ product:effectiveProduct, sizeKey:normalizedSizeKey, crustKey:entry.crustKey, ingredients:entry.ingredients, quantity:Number(entry.quantity), catalog:productIngredientCatalog, sizes:cat.sizes, crusts:pricedCrusts }); }
    catch (error) { throw fail(error.message,422); }
    subtotal += pricedItem.linePriceCents;
    priced.push({ product, quantity:Number(entry.quantity), notes:clean(entry.notes,300), flavorProducts:flavorProducts.map(p=>({id:p.id,name:p.name})), priced:pricedItem });
  }
  return { subtotal, priced, requiresAdult: priced.some(item=>item.product.ageRestricted===true || Number(item.product.ageRestricted)===1) };
}
// Checkout: cria o pedido dentro de transação e associa o cliente autenticado.
async function createOrder(body, customer) {
  await ensureOperationsSchema();
  const openingHours=await getOpeningHours();
  assertRestaurantOpen(openingHours.schedule);
  const customerName=clean(body.customerName,100), phone=clean(body.phone,30), fulfillment=body.fulfillment;
  const paymentMethod=clean(body.paymentMethod,20).toLowerCase();
  if(!['pix','cash','card'].includes(paymentMethod))throw fail('Escolha uma forma de pagamento válida.',422);
  if (customerName.length<2) throw fail('Informe seu nome.',422);
  if (phone.replace(/\D/g,'').length<8) throw fail('Informe um telefone válido.',422);
  if (!['table','pickup','delivery'].includes(fulfillment)) throw fail('Escolha como deseja receber o pedido.',422);
  const tableLabel=fulfillment==='table'?clean(body.tableLabel,30):'';
  const deliveryAddress=fulfillment==='delivery'?clean(body.deliveryAddress,300):'';
  if (fulfillment==='table'&&!/^\d{1,3}$/.test(tableLabel)) throw fail('Selecione uma mesa válida do salão.',422);
  if (fulfillment==='delivery'&&deliveryAddress.length<8) throw fail('Informe o endereço de entrega.',422);
  const key=clean(body.idempotencyKey,80);
  if (key.length<12) throw fail('A chave do pedido expirou. Atualize o carrinho e tente novamente.',422);
  const {subtotal,priced,requiresAdult}=await priceItems(body.items);
  if(requiresAdult&&(!customer?.birthDate||customer.isAdult!==true)) throw fail(!customer?.birthDate?'Informe sua data de nascimento na conta para comprar este produto restrito.':'Este produto é permitido apenas para maiores de 18 anos.',403);
  const customerId=customer?.id||null;
  const code=normalizeCoupon(body.couponCode);
  let discount=0, coupon=null;
  if (code) { coupon=await coupons(code); discount=couponDiscount(coupon,subtotal,customerId); }
  const delivery=await calculateDelivery(body);
  const total=Math.max(0,subtotal-discount)+delivery.feeCents;
  const id='BM-'+new Date().toISOString().slice(2,10).replace(/-/g,'')+'-'+randomBytes(3).toString('hex').toUpperCase();
  const token=randomBytes(24).toString('base64url'), now=new Date().toISOString();
  await withTransaction(async client => {
    const lockedRestaurant=await client.query('SELECT opening_hours_json AS "openingHoursJson" FROM restaurants WHERE id=$1 FOR SHARE',[RESTAURANT_ID]);
    let lockedSchedule=DEFAULT_OPENING_HOURS;
    try { lockedSchedule=JSON.parse(lockedRestaurant.rows[0]?.openingHoursJson||'{}'); } catch {}
    assertRestaurantOpen(lockedSchedule);
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
    await client.query(`INSERT INTO orders (id,restaurant_id,customer_name,phone,fulfillment,table_label,delivery_address,note,status,total_cents,tracking_token,idempotency_key,created_at,updated_at,customer_id,coupon_code,discount_cents,payment_method,payment_status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'received',$9,$10,$11,$12,$12,$13,$14,$15,$16,'pending')`,
      [id,RESTAURANT_ID,customerName,phone,fulfillment,tableLabel,deliveryAddress,clean(body.note,500),total,token,key,now,customerId||null,code,discount,paymentMethod]);
    await client.query('UPDATE orders SET delivery_fee_cents=$1,delivery_zone_name=$2,delivery_distance_km=$3 WHERE id=$4',[delivery.feeCents,delivery.zoneName,delivery.distanceKm,id]);
    if (coupon) {
      const used=await client.query(`UPDATE coupons SET used_count=used_count+1 WHERE id=$1 AND restaurant_id=$2 AND active=1 AND (max_uses IS NULL OR used_count<max_uses)`,[coupon.id,RESTAURANT_ID]);
      if (!used.rowCount) throw fail('Esse cupom atingiu o limite de utilizações.',422);
    }
    for (const item of priced) {
      const snapshot={productId:item.product.id,type:item.combo?'combo':item.product.type,name:item.product.name,size:item.priced.size,crust:item.priced.crust,ingredients:item.priced.ingredients,flavors:item.flavorProducts||[],comboItems:item.priced.comboItems||[],unitPriceCents:item.priced.unitPriceCents,widthCm:item.product.widthCm,heightCm:item.product.heightCm};
      await client.query(`INSERT INTO order_items (id,order_id,product_id,product_name_snapshot,quantity,size_key,crust_key,ingredients_json,notes,unit_price_cents,snapshot_json)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [randomBytes(12).toString('hex'),id,item.product.id,item.product.name,item.quantity,item.priced.size.key,item.priced.crust?.key||'',JSON.stringify(item.priced.ingredients),item.notes,item.priced.unitPriceCents,JSON.stringify(snapshot)]);
    }
    await client.query('INSERT INTO order_status_history (order_id,status,changed_at,changed_by) VALUES ($1,$2,$3,$4)',[id,'received',now,'cliente']);
    await client.query('UPDATE abandoned_cart_reminders SET converted_at=$1 WHERE restaurant_id=$2 AND customer_id=$3 AND converted_at IS NULL',[now,RESTAURANT_ID,customerId||'']);
    if (table?.status==='free') await client.query(`UPDATE restaurant_tables SET status='occupied',updated_at=$1 WHERE id=$2 AND status='free'`,[now,table.id]);
  });
  const duplicate=(await query('SELECT id FROM orders WHERE restaurant_id=$1 AND idempotency_key=$2',[RESTAURANT_ID,key])).rows[0];
  const order=await orderById(duplicate?.id||id);
  return order;
}
// Atendimento: aplica somente transições de status permitidas e registra a atualização.
async function awardOrderLoyaltyPoints(client, order, now = new Date().toISOString()) {
  if (!order?.customer_id || order.payment_status !== 'paid' || !['ready','delivering','completed'].includes(order.status)) return false;
  const pointsBase=await client.query('SELECT COALESCE(SUM(unit_price_cents*quantity),0)::bigint AS subtotal FROM order_items WHERE order_id=$1',[order.id]);
  const points=Math.floor(Math.max(0,Number(pointsBase.rows[0]?.subtotal||0)-Number(order.discount_cents||0))/100);
  if(points<=0)return false;
  const inserted=await client.query(
    "INSERT INTO loyalty_points_ledger(id,restaurant_id,customer_id,points,reason,order_id,created_at) VALUES($1,$2,$3,$4,'order_completed',$5,$6) ON CONFLICT(order_id) DO NOTHING RETURNING id",
    ['lp_'+randomBytes(12).toString('hex'),RESTAURANT_ID,order.customer_id,points,order.id,now]
  );
  return Boolean(inserted.rows[0]);
}
async function updateOrderStatus(id, next) {
  await ensureOperationsSchema();
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
    await awardOrderLoyaltyPoints(client,{...order,id,status:next},now);
    await client.query('INSERT INTO admin_audit_log(restaurant_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5::jsonb)',[RESTAURANT_ID,'order.status_changed','order',id,JSON.stringify({from:order.status,to:next})]);
    if (order.fulfillment==='table'&&['completed','cancelled'].includes(next)&&order.table_label) await client.query(`UPDATE restaurant_tables SET status='cleaning',updated_at=$1 WHERE restaurant_id=$2 AND table_number=$3`,[now,RESTAURANT_ID,Number(order.table_label)]);
  });
  return await orderById(id);
}
async function cancelOrderByCustomer(id) {
  await withTransaction(async client => {
    const found=await client.query('SELECT * FROM orders WHERE id=$1 AND restaurant_id=$2 FOR UPDATE',[id,RESTAURANT_ID]);
    const order=found.rows[0];
    if(!order) throw fail('Pedido não encontrado.',404);
    if(order.status==='cancelled') return;
    if(!['received','confirmed'].includes(order.status)) throw fail('Este pedido não pode mais ser cancelado porque o preparo já pode ter começado.',409);
    const now=new Date().toISOString();
    await client.query('UPDATE orders SET status=$1,updated_at=$2 WHERE id=$3 AND restaurant_id=$4',['cancelled',now,id,RESTAURANT_ID]);
    await client.query('INSERT INTO order_status_history (order_id,status,changed_at,changed_by) VALUES ($1,$2,$3,$4)',[id,'cancelled',now,'cliente']);
    if(order.fulfillment==='table'&&order.table_label) await client.query("UPDATE restaurant_tables SET status='cleaning',updated_at=$1 WHERE restaurant_id=$2 AND table_number=$3",[now,RESTAURANT_ID,Number(order.table_label)]);
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
  await recordAdminAudit(id?'coupon.updated':'coupon.created','coupon',result.rows[0].id,{code});
  return couponPublic(result.rows[0]);
}
function couponPublic(row) { return {id:row.id,code:row.code,discountType:row.discount_type,discountValue:Number(row.discount_value),minimumSubtotalCents:Number(row.minimum_subtotal_cents),startsAt:row.starts_at,expiresAt:row.expires_at,maxUses:row.max_uses===null?null:Number(row.max_uses),usedCount:Number(row.used_count),active:Number(row.active)===1,customerId:row.customer_id||null,personalized:Boolean(row.customer_id),createdAt:row.created_at}; }
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
  const year=Number(month.slice(0,4)),monthIndex=Number(month.slice(5,7))-1;
  const start=month+'-01',end=new Date(Date.UTC(year,monthIndex+1,1)).toISOString().slice(0,10);
  const startUtc=new Date(Date.UTC(year,monthIndex,1,3)).toISOString();
  const endUtc=new Date(Date.UTC(year,monthIndex+1,1,3)).toISOString();
  return {month,start,end,startUtc,endUtc};
}
// Financeiro: consolida receitas e despesas para o relatório do período solicitado.
async function fiscalReport(monthValue){
  await ensureOperationsSchema();
  const {month,start,end,startUtc,endUtc}=fiscalMonth(monthValue);
  const [sales,byFulfillment,expenses,documents,orderRows,payments]=await Promise.all([
    query(`SELECT COUNT(*) FILTER (WHERE status='completed')::int AS orders,
      COUNT(*) FILTER (WHERE status='cancelled')::int AS cancelled,
      COALESCE(SUM(total_cents + COALESCE(discount_cents,0)) FILTER (WHERE status='completed'),0)::bigint AS gross_cents,
      COALESCE(SUM(discount_cents) FILTER (WHERE status='completed'),0)::bigint AS discounts_cents
      FROM orders WHERE restaurant_id=$1 AND created_at >= $2 AND created_at < $3`,[RESTAURANT_ID,startUtc,endUtc]),
    query(`SELECT fulfillment,COUNT(*)::int AS orders,COALESCE(SUM(total_cents),0)::bigint AS total_cents
      FROM orders WHERE restaurant_id=$1 AND status='completed' AND created_at >= $2 AND created_at < $3
      GROUP BY fulfillment ORDER BY fulfillment`,[RESTAURANT_ID,startUtc,endUtc]),
    query('SELECT COALESCE(SUM(amount_cents),0)::bigint AS total_cents,COUNT(*)::int AS count FROM fiscal_expenses WHERE restaurant_id=$1 AND expense_date >= $2::date AND expense_date < $3::date',[RESTAURANT_ID,start,end]),
    query('SELECT direction,COUNT(*)::int AS count FROM fiscal_documents WHERE restaurant_id=$1 AND document_date >= $2::date AND document_date < $3::date GROUP BY direction',[RESTAURANT_ID,start,end]),
    query(`SELECT id,created_at AS date,
      customer_name AS customer,fulfillment,status,total_cents::bigint AS net_cents,
      COALESCE(discount_cents,0)::bigint AS discount_cents,
      (total_cents+COALESCE(discount_cents,0))::bigint AS gross_cents
      FROM orders WHERE restaurant_id=$1 AND status='completed' AND created_at >= $2 AND created_at < $3
      ORDER BY created_at,id LIMIT 10000`,[RESTAURANT_ID,startUtc,endUtc]),
    query(`SELECT payment_method AS method,payment_status AS status,COUNT(*)::int AS orders,COALESCE(SUM(total_cents),0)::bigint AS total_cents FROM orders WHERE restaurant_id=$1 AND status<>'cancelled' AND created_at >= $2 AND created_at < $3 GROUP BY payment_method,payment_status ORDER BY payment_method,payment_status`,[RESTAURANT_ID,startUtc,endUtc])
  ]);
  const s=sales.rows[0], gross=Number(s.gross_cents||0), discounts=Number(s.discounts_cents||0);
  return {month,period:{start,end},sales:{orders:Number(s.orders),cancelled:Number(s.cancelled),grossCents:gross,discountsCents:discounts,netCents:gross-discounts,records:orderRows.rows.map(r=>({id:r.id,date:r.date,customer:r.customer,fulfillment:r.fulfillment,status:r.status,grossCents:Number(r.gross_cents),discountCents:Number(r.discount_cents),netCents:Number(r.net_cents)}))},byFulfillment:byFulfillment.rows.map(r=>({type:r.fulfillment,orders:Number(r.orders),totalCents:Number(r.total_cents)})),expenses:{count:Number(expenses.rows[0].count),totalCents:Number(expenses.rows[0].total_cents)},documents:{received:Number(documents.rows.find(r=>r.direction==='received')?.count||0),issued:Number(documents.rows.find(r=>r.direction==='issued')?.count||0)},payments:payments.rows.map(r=>({method:r.method||'not_informed',status:r.status,orders:Number(r.orders),totalCents:Number(r.total_cents)})),notice:'Resumo gerencial baseado nos pedidos registrados no Menuza. A conciliação depende da confirmação manual de recebimento no painel e não substitui extrato bancário, escrituração contábil, apuração tributária ou documento fiscal autorizado.'};
}

// Entrada da API: identifica método/rota, aplica limites de requisição e despacha para o endpoint correspondente.
export default async function handler(req, res) {
  if (!req || !res) throw new Error('Requisição ou resposta ausente no roteador da API.');
  if (!req.headers || typeof req.headers !== 'object') req.headers = {};
  if (!req.query || typeof req.query !== 'object') req.query = {};
  // Vercel preenche req.query.path em produção; no Vercel Dev, o catch-all
  // pode entregar apenas req.url. Use ambos para manter as rotas consistentes.
  const requestUrl = new URL(
    req.url || '/',
    `http://${req.headers.host || 'localhost'}`
  );
  const queryPath = req.query?.path;
  const routePath = Array.isArray(queryPath)
    ? queryPath.filter(Boolean).join('/')
    : typeof queryPath === 'string' && queryPath.trim()
      ? queryPath
      : requestUrl.pathname.replace(/^\/api\/?/, '');
  const normalizedRoute = String(routePath || '').replace(/^\/+|\/+$/g, '');
  const path = normalizedRoute.startsWith('api/')
    ? `/${normalizedRoute}`
    : `/api/${normalizedRoute}`;
  const method=req.method||'GET';
  const allowed=new Set(['GET','POST','PATCH','PUT','DELETE','OPTIONS']);
  if (!allowed.has(method)) return json(res,405,{error:'Método não permitido.'},{Allow:'GET, POST, PATCH, PUT, DELETE, OPTIONS'});
  if (method==='OPTIONS') return json(res,204,{});
  try {
    if (['POST','PATCH','PUT','DELETE'].includes(method)) {
      const origin=req.headers.origin, host=req.headers.host;
      if (origin&&host&&origin!=='https://'+host&&origin!=='http://'+host) throw fail('Origem da solicitação não permitida.',403);
    }
    if (method==='GET'&&path==='/api/public/integrations') {
      return json(res,200,{sentryDsn:process.env.SENTRY_DSN||'',turnstileSiteKey:process.env.TURNSTILE_SITE_KEY||'',gaMeasurementId:process.env.GA_MEASUREMENT_ID||''});
    }
    const globalRetry=await limit(req,'api-global',240,60000);
    if(globalRetry) return json(res,429,{error:'Muitas solicitações. Aguarde um pouco e tente novamente.'},{'Retry-After':String(globalRetry)});
    if(method==='POST'&&path==='/api/orders') {
      const orderRetry=await limit(req,'orders-create',60,600000);
      if(orderRetry) return json(res,429,{error:'Muitos pedidos foram enviados deste endereço. Aguarde antes de tentar novamente.'},{'Retry-After':String(orderRetry)});
    }
    const parts=path.split('/').filter(Boolean), id=decodeURIComponent(parts.at(-1)||'');
    if(path.startsWith('/api/admin/')&&!['/api/admin/login','/api/admin/logout','/api/admin/me'].includes(path)) await requireAdmin(req);
    if(path.startsWith('/api/admin/'))await ensureOperationsSchema();
    if(method==='GET'&&path==='/api/customer/marketing-unsubscribe'){
      const token=String(requestUrl.searchParams.get('token')||''),parts=token.split('.');
      if(parts.length!==2)throw fail('Link de descadastro inválido.',400);
      const expected=createHmac('sha256',SECRET).update('menuza-marketing-unsubscribe:').update(parts[0]).digest(),given=Buffer.from(parts[1],'base64url');
      if(given.length!==expected.length||!timingSafeEqual(given,expected))throw fail('Link de descadastro inválido.',400);
      let payload;try{payload=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'))}catch{throw fail('Link de descadastro inválido.',400)}
      if(payload.purpose!=='marketing-unsubscribe'||!payload.customerId)throw fail('Link de descadastro inválido.',400);
      await query('UPDATE customers SET marketing_consent_at=NULL WHERE id=$1',[payload.customerId]);
      return json(res,200,{ok:true,message:'Pronto. Você não receberá mais e-mails promocionais do Menuza.'});
    }
    if(method==='GET'&&path==='/api/admin/customers/retention'){
      const rows=await query(`SELECT c.id,c.name,c.email,c.phone,(c.marketing_consent_at IS NOT NULL) AS "marketingConsent",MAX(o.created_at::timestamptz) AS "lastOrderAt",COUNT(o.id)::int AS "orders",COALESCE(SUM(o.total_cents) FILTER (WHERE o.status<>'cancelled'),0)::bigint AS "revenueCents",MAX(rc.sent_at) AS "lastRecoveryAt",(GREATEST(COALESCE(MAX(o.created_at::timestamptz),'-infinity'::timestamptz),COALESCE(NULLIF(c.created_at,'')::timestamptz,'-infinity'::timestamptz))<NOW()-INTERVAL '30 days') AS inactive FROM customers c LEFT JOIN orders o ON o.customer_id=c.id AND o.restaurant_id=$1 AND o.status<>'cancelled' LEFT JOIN (SELECT customer_id,MAX(sent_at) AS sent_at FROM customer_recovery_campaigns WHERE restaurant_id=$1 GROUP BY customer_id) rc ON rc.customer_id=c.id GROUP BY c.id ORDER BY c.created_at DESC LIMIT 500`,[RESTAURANT_ID]);
      return json(res,200,{customers:rows.rows.map(row=>({...row,orders:Number(row.orders||0),revenueCents:Number(row.revenueCents||0),marketingConsent:Boolean(row.marketingConsent),inactive:Boolean(row.inactive)}))});
    }
    if(method==='POST'&&path.startsWith('/api/admin/customers/')&&path.endsWith('/coupon')){
      const customerId=decodeURIComponent(path.split('/')[4]||''),b=await bodyOf(req);
      const target=(await query('SELECT id,name,email,marketing_consent_at AS "marketingConsentAt" FROM customers WHERE id=$1',[customerId])).rows[0];
      if(!target)throw fail('Cliente não encontrado.',404);
      if(!target.marketingConsentAt)throw fail('O cliente não autorizou o recebimento de ofertas por e-mail.',403);
      const percent=Math.max(5,Math.min(30,Math.trunc(Number(b.discountPercent)||10))),code='VOLTE-'+randomBytes(4).toString('hex').toUpperCase(),now=new Date(),expires=new Date(now.getTime()+14*86400000),couponId='cpn_'+randomBytes(12).toString('hex');
      const inserted=await query("INSERT INTO coupons(id,restaurant_id,code,discount_type,discount_value,minimum_subtotal_cents,starts_at,expires_at,max_uses,active,created_at,customer_id) VALUES($1,$2,$3,'percent',$4,0,$5,$6,1,1,$5,$7) RETURNING *",[couponId,RESTAURANT_ID,code,percent,now.toISOString(),expires.toISOString(),customerId]);
      let sent=false;
      const apiKey=String(process.env.RESEND_API_KEY||''),from=String(process.env.RESEND_FROM_EMAIL||'');
      if(apiKey&&from){
        const payload=Buffer.from(JSON.stringify({purpose:'marketing-unsubscribe',customerId})).toString('base64url'),signature=createHmac('sha256',SECRET).update('menuza-marketing-unsubscribe:').update(payload).digest('base64url'),unsubscribe=publicBaseUrl()+'/api/customer/marketing-unsubscribe?token='+encodeURIComponent(payload+'.'+signature);
        const mail=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},signal:AbortSignal.timeout(8000),body:JSON.stringify({from,to:[target.email],subject:'Um presente para você voltar ao Menuza',text:'Olá, '+target.name+'! Preparamos um cupom exclusivo para você: '+code+'.\n\nGanhe '+percent+'% de desconto no próximo pedido. Válido até '+expires.toLocaleDateString('pt-BR')+'.\n\nUse o código no checkout. Este cupom é pessoal e pode ser usado uma vez.\n\nPara deixar de receber ofertas, acesse: '+unsubscribe})});
        if(mail.ok){sent=true;await query('INSERT INTO customer_recovery_campaigns(id,restaurant_id,customer_id,coupon_id,email,status,sent_at) VALUES($1,$2,$3,$4,$5,$6,NOW())',['rc_'+randomBytes(12).toString('hex'),RESTAURANT_ID,customerId,couponId,target.email,'sent']);}
        else {await query('UPDATE coupons SET active=0 WHERE id=$1',[couponId]);throw fail('O cupom foi preparado, mas o e-mail não pôde ser enviado. Confira a configuração do Resend.',502);}
      }
      await recordAdminAudit('customer.personal_coupon_created','customer',customerId,{couponCode:code,discountPercent:percent,sent});
      return json(res,201,{coupon:couponPublic(inserted.rows[0]),sent,message:sent?'Cupom enviado ao e-mail autorizado do cliente.':'Cupom criado. Configure o Resend para enviá-lo por e-mail.'});
    }
    if(method==='POST'&&path==='/api/customer/abandoned-cart'){
      await ensureOperationsSchema();
      const c=await customer(req);if(!c)throw fail('Entre na sua conta para ativar o lembrete.',401);
      const b=await bodyOf(req),consent=b.consent===true;
      if(!consent){await query('DELETE FROM abandoned_cart_reminders WHERE restaurant_id=$1 AND customer_id=$2 AND sent_at IS NULL AND converted_at IS NULL',[RESTAURANT_ID,c.customer.id]);return json(res,200,{ok:true,scheduled:false});}
      const entries=Array.isArray(b.items)?b.items.slice(0,20):[];
      if(!entries.length)throw fail('Seu carrinho está vazio.',422);
      const summary=entries.map(item=>{const name=clean(item?.name,90),quantity=Math.max(1,Math.min(20,Math.trunc(Number(item?.quantity)||1)));return name?quantity+'× '+name:''}).filter(Boolean).join('\n').slice(0,1200);
      const subtotal=Math.max(0,Math.min(10000000,Math.trunc(Number(b.subtotalCents)||0)));
      if(!summary||!subtotal)throw fail('Não foi possível registrar o resumo do carrinho.',422);
      await query('DELETE FROM abandoned_cart_reminders WHERE restaurant_id=$1 AND customer_id=$2 AND sent_at IS NULL AND converted_at IS NULL',[RESTAURANT_ID,c.customer.id]);
      await query('INSERT INTO abandoned_cart_reminders(id,restaurant_id,customer_id,email,cart_summary,subtotal_cents,consent_at,scheduled_at) VALUES($1,$2,$3,$4,$5,$6,NOW(),NOW()+INTERVAL \'45 minutes\')',[randomBytes(12).toString('hex'),RESTAURANT_ID,c.customer.id,c.customer.email,summary,subtotal]);
      return json(res,200,{ok:true,scheduled:true});
    }
    if(method==='GET'&&path==='/api/cron/inactive-customers'){
      await ensureOperationsSchema();
      const cronSecret=String(process.env.CRON_SECRET||'');
      if(!cronSecret||req.headers.authorization!=='Bearer '+cronSecret)throw fail('Não autorizado.',401);
      const apiKey=String(process.env.RESEND_API_KEY||''),from=String(process.env.RESEND_FROM_EMAIL||'');
      if(!apiKey||!from)return json(res,503,{error:'Configure RESEND_API_KEY e RESEND_FROM_EMAIL para ativar a recuperação de clientes.'});
      const candidates=await query(`SELECT c.id,c.name,c.email,
        GREATEST(
          COALESCE(MAX(NULLIF(o.created_at,'')::timestamptz),'-infinity'::timestamptz),
          COALESCE(NULLIF(c.created_at,'')::timestamptz,'-infinity'::timestamptz)
        ) AS "lastActivityAt"
        FROM customers c
        LEFT JOIN orders o ON o.customer_id=c.id AND o.restaurant_id=$1 AND o.status<>'cancelled'
        WHERE c.marketing_consent_at IS NOT NULL
        GROUP BY c.id,c.name,c.email,c.created_at
        HAVING GREATEST(
          COALESCE(MAX(NULLIF(o.created_at,'')::timestamptz),'-infinity'::timestamptz),
          COALESCE(NULLIF(c.created_at,'')::timestamptz,'-infinity'::timestamptz)
        )<NOW()-INTERVAL '30 days'
        AND NOT EXISTS(SELECT 1 FROM customer_recovery_campaigns rc WHERE rc.restaurant_id=$1 AND rc.customer_id=c.id AND rc.sent_at>NOW()-INTERVAL '45 days')
        AND NOT EXISTS(SELECT 1 FROM coupons cp WHERE cp.restaurant_id=$1 AND cp.customer_id=c.id AND cp.active=1 AND (cp.expires_at IS NULL OR NULLIF(cp.expires_at,'')::timestamptz>NOW()) AND (cp.max_uses IS NULL OR cp.used_count<cp.max_uses))
        ORDER BY "lastActivityAt" ASC LIMIT 3`,[RESTAURANT_ID]);
      let sent=0,failed=0;
      for(const target of candidates.rows){
        const now=new Date(),expires=new Date(now.getTime()+14*86400000),code='VOLTE-'+randomBytes(4).toString('hex').toUpperCase(),couponId='cpn_'+randomBytes(12).toString('hex');
        try{
          await query("INSERT INTO coupons(id,restaurant_id,code,discount_type,discount_value,minimum_subtotal_cents,starts_at,expires_at,max_uses,active,created_at,customer_id) VALUES($1,$2,$3,'percent',10,0,$4,$5,1,1,$4,$6)",[couponId,RESTAURANT_ID,code,now.toISOString(),expires.toISOString(),target.id]);
          const payload=Buffer.from(JSON.stringify({purpose:'marketing-unsubscribe',customerId:target.id})).toString('base64url'),signature=createHmac('sha256',SECRET).update('menuza-marketing-unsubscribe:').update(payload).digest('base64url'),unsubscribe=publicBaseUrl()+'/api/customer/marketing-unsubscribe?token='+encodeURIComponent(payload+'.'+signature);
          const mail=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},signal:AbortSignal.timeout(3000),body:JSON.stringify({from,to:[target.email],subject:'Sentimos sua falta! Tem 10% de desconto esperando por você',text:'Olá, '+target.name+'! Faz um tempinho desde seu último pedido. Preparamos um cupom pessoal de 10% para você: '+code+'.\n\nVálido até '+expires.toLocaleDateString('pt-BR')+'. Use no checkout do Menuza. O cupom vale para uma utilização e está vinculado à sua conta.\n\nNão quer mais receber ofertas? Descadastre-se aqui: '+unsubscribe})});
          if(!mail.ok)throw new Error('Resend retornou '+mail.status);
          await query('INSERT INTO customer_recovery_campaigns(id,restaurant_id,customer_id,coupon_id,email,status,sent_at) VALUES($1,$2,$3,$4,$5,$6,NOW())',['rc_'+randomBytes(12).toString('hex'),RESTAURANT_ID,target.id,couponId,target.email,'sent']);
          sent++;
        }catch(error){await query('UPDATE coupons SET active=0 WHERE id=$1',[couponId]).catch(()=>{});failed++;}
      }
      return json(res,200,{eligible:candidates.rowCount,sent,failed});
    }
    if(method==='GET'&&path==='/api/cron/abandoned-carts'){
      await ensureOperationsSchema();
      const cronSecret=String(process.env.CRON_SECRET||'');
      if(!cronSecret||req.headers.authorization!=='Bearer '+cronSecret)throw fail('Não autorizado.',401);
      const apiKey=String(process.env.RESEND_API_KEY||''),from=String(process.env.RESEND_FROM_EMAIL||'');
      if(!apiKey||!from)return json(res,503,{error:'Configure RESEND_API_KEY e RESEND_FROM_EMAIL para ativar os lembretes.'});
      const due=await withTransaction(async client=>{
        const rows=await client.query(`SELECT id,email,cart_summary AS "cartSummary",subtotal_cents AS "subtotalCents" FROM abandoned_cart_reminders WHERE restaurant_id=$1 AND sent_at IS NULL AND converted_at IS NULL AND scheduled_at<=NOW() AND (processing_at IS NULL OR processing_at<NOW()-INTERVAL '15 minutes') ORDER BY scheduled_at LIMIT 4 FOR UPDATE SKIP LOCKED`,[RESTAURANT_ID]);
        if(rows.rowCount)await client.query('UPDATE abandoned_cart_reminders SET processing_at=NOW() WHERE id=ANY($1::text[])',[rows.rows.map(row=>row.id)]);
        return rows.rows;
      });
      let sent=0,failed=0;
      for(const reminder of due){
        try{
          const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},signal:AbortSignal.timeout(2000),body:JSON.stringify({from,to:[reminder.email],subject:'Seu pedido ainda está esperando por você',text:'Olá! Você deixou alguns itens no carrinho do Menuza:\n\n'+reminder.cartSummary+'\n\nSubtotal estimado: R$ '+(Number(reminder.subtotalCents)/100).toFixed(2).replace('.',',')+'\n\nSe ainda quiser continuar, volte ao cardápio: '+publicBaseUrl()+'/#menu\n\nEste é um único lembrete solicitado por você. Se já concluiu seu pedido, pode ignorar esta mensagem.'})});
          if(!response.ok)throw new Error('Resend retornou '+response.status);
          await query('UPDATE abandoned_cart_reminders SET sent_at=NOW(),processing_at=NULL WHERE id=$1',[reminder.id]);sent++;
        }catch{await query('UPDATE abandoned_cart_reminders SET processing_at=NULL WHERE id=$1',[reminder.id]);failed++;}
      }
      return json(res,200,{processed:due.length,sent,failed});
    }
    if (method==='GET'&&path==='/api/restaurant/branding') { await ensurePromoDeliverySchema(); const restaurant=(await query('SELECT name,logo_url AS "logoUrl",promo_banner_image AS "promoBannerImage",promo_banner_title AS "promoBannerTitle",promo_banner_text AS "promoBannerText",promo_banner_active AS "promoBannerActive" FROM restaurants WHERE id=$1',[RESTAURANT_ID])).rows[0]||null; return json(res,200,{restaurant:await migrateRestaurantImageFields(restaurant)}); }
    if (method==='GET'&&path==='/api/admin/promotion-banner') { await requireAdmin(req); await ensurePromoDeliverySchema(); const row=(await query('SELECT promo_banner_image AS "image",promo_banner_title AS "title",promo_banner_text AS "text",promo_banner_active AS "active" FROM restaurants WHERE id=$1',[RESTAURANT_ID])).rows[0]||{}; return json(res,200,{banner:{...row,active:Number(row.active)===1}}); }
    if (method==='PATCH'&&path==='/api/admin/promotion-banner') { await requireAdmin(req); await ensurePromoDeliverySchema(); const b=await bodyOf(req,1500000),current=(await query('SELECT promo_banner_image AS image,promo_banner_title AS title,promo_banner_text AS text,promo_banner_active AS active FROM restaurants WHERE id=$1',[RESTAURANT_ID])).rows[0]||{}; const image=b.image===undefined?current.image:String(b.image||''); const title=clean(b.title??current.title,90),bannerText=clean(b.text??current.text,180),active=b.active===undefined?Number(current.active)===1:Boolean(b.active); if(image.length>1400000||image&&!isImageDataUrl(image)&&!isStoredImageUrl(image)) throw fail('Escolha uma imagem JPG, PNG ou WebP válida.',422); if(image.startsWith('data:')&&image.length>1400000) throw fail('A imagem do banner ficou grande demais. Use uma imagem menor.',413); if(active&&!image) throw fail('Envie uma foto para ativar o banner.',422); if(title.length<2) throw fail('Informe um título para o banner.',422); const storedImage=isImageDataUrl(image)?await storeImageDataUrl(image,'restaurants/banners'):image; await query('UPDATE restaurants SET promo_banner_image=$1,promo_banner_title=$2,promo_banner_text=$3,promo_banner_active=$4 WHERE id=$5',[storedImage,title,bannerText,active?1:0,RESTAURANT_ID]); return json(res,200,{banner:{image:storedImage,title,text:bannerText,active}}); }
    if (method==='GET'&&path==='/api/opening-hours') {
      const result=await getOpeningHours();
      return json(res,200,{openingHours:result.schedule,status:result.status});
    }
    if (method==='GET'&&path==='/api/catalog') { return json(res,200,await catalogFor(false),{'Cache-Control':'public, s-maxage=15, stale-while-revalidate=30'}); }
    if (method==='GET'&&path==='/api/admin/opening-hours') {
      await requireAdmin(req);
      const result=await getOpeningHours();
      return json(res,200,{openingHours:result.schedule,status:result.status});
    }
    if (method==='PATCH'&&path==='/api/admin/opening-hours') {
      await requireAdmin(req);
      await ensureOpeningHoursSchema();
      const schedule=normalizeOpeningHours(await bodyOf(req));
      await query('UPDATE restaurants SET opening_hours_json=$1 WHERE id=$2',[JSON.stringify(schedule),RESTAURANT_ID]);
      return json(res,200,{openingHours:schedule,status:openingHoursState(schedule)});
    }
    if (method==='GET'&&path==='/api/delivery/options') { await ensurePromoDeliverySchema(); const config=await deliveryConfig(); return json(res,200,{restaurant:config.restaurant,zones:config.zones.filter(z=>z.active)}); }
    if (method==='GET'&&path==='/api/admin/promotions') {
      await requireAdmin(req); await ensurePromoDeliverySchema(); const c=await catalogFor(true);
      const rows=(await query("SELECT id,product_id AS \"productId\",promotion_name AS \"promotionName\",banner_image AS \"bannerImage\",card_image AS \"cardImage\",size_key AS \"sizeKey\",included_crust_key AS \"includedCrustKey\",discount_type AS \"discountType\",promotional_price_cents AS \"promotionalPriceCents\",discount_percent AS \"discountPercent\",weekdays_json AS \"weekdaysJson\",active FROM product_promotions WHERE restaurant_id=$1 ORDER BY created_at DESC",[RESTAURANT_ID])).rows;
      return json(res,200,{products:c.products,sizes:c.sizes.pizza,crusts:c.crusts,promotions:rows.map(p=>({...p,productId:p.productId,sizeKey:p.sizeKey||'',includedCrustKey:p.includedCrustKey||'',promotionalPriceCents:p.promotionalPriceCents===null?null:Number(p.promotionalPriceCents),discountPercent:p.discountPercent===null?null:Number(p.discountPercent),weekdays:(()=>{try{return JSON.parse(p.weekdaysJson||'[]')}catch{return []}})(),active:Number(p.active)===1}))});
    }
    if (method==='POST'&&path==='/api/admin/promotions') { await requireAdmin(req); await ensurePromoDeliverySchema(); return json(res,201,{promotion:await savePromotion(await bodyOf(req,2100000))}); }
    if (method==='DELETE'&&path.startsWith('/api/admin/promotions/')) { await requireAdmin(req); await ensurePromoDeliverySchema(); const deleted=await query('DELETE FROM product_promotions WHERE id=$1 AND restaurant_id=$2 RETURNING id',[id,RESTAURANT_ID]); if(!deleted.rowCount) throw fail('Promoção não encontrada.',404); return json(res,200,{success:true,id:deleted.rows[0].id}); }
    if (method==='PATCH'&&path.startsWith('/api/admin/promotions/')) { await requireAdmin(req); await ensurePromoDeliverySchema(); const b=await bodyOf(req,2100000); const current=(await query('SELECT * FROM product_promotions WHERE id=$1 AND restaurant_id=$2',[id,RESTAURANT_ID])).rows[0]; if(!current) throw fail('Promoção não encontrada.',404); const imageOnlyKeys=Object.keys(b).filter(key=>['bannerImage','cardImage'].includes(key)); if(imageOnlyKeys.length===1&&Object.keys(b).length===1){const field=imageOnlyKeys[0],column=field==='bannerImage'?'banner_image':'card_image',folder=field==='bannerImage'?'restaurants/promotion-banners':'restaurants/promotion-cards';const raw=String(b[field]||'');if(raw.length>1400000||raw&&!isImageDataUrl(raw)&&!isStoredImageUrl(raw))throw fail('Envie uma imagem válida para a promoção.',422);const image=raw.startsWith('data:')?await storeImageDataUrl(raw,folder):raw;const saved=await query('UPDATE product_promotions SET '+column+'=$1,updated_at=NOW() WHERE id=$2 AND restaurant_id=$3 RETURNING id,banner_image AS "bannerImage",card_image AS "cardImage"',[image,id,RESTAURANT_ID]);return json(res,200,{promotion:saved.rows[0]});} const productId=current.product_id==='__all_pizzas__'?'__all_pizzas__':clean(b.productId||current.product_id,100); return json(res,200,{promotion:await savePromotion({...b,applyToAllPizzas:productId==='__all_pizzas__',productId,weekdays:b.weekdays||JSON.parse(current.weekdays_json),discountType:b.discountType||current.discount_type,sizeKey:b.sizeKey??current.size_key??'',includedCrustKey:b.includedCrustKey??current.included_crust_key??'',promotionName:b.promotionName??current.promotion_name??'',bannerImage:b.bannerImage??current.banner_image??'',cardImage:b.cardImage??current.card_image??'',promotionalPriceCents:b.promotionalPriceCents??current.promotional_price_cents,discountPercent:b.discountPercent??current.discount_percent,active:b.active===undefined?Number(current.active)===1:b.active},id)}); }
    if (method==='GET'&&path==='/api/admin/delivery') { await requireAdmin(req); await ensurePromoDeliverySchema(); const config=await deliveryConfig(); return json(res,200,config); }
    if (method==='POST'&&path==='/api/admin/delivery/zones') { await requireAdmin(req); await ensurePromoDeliverySchema(); return json(res,201,{zone:await saveDeliveryZone(await bodyOf(req))}); }
    if (method==='PATCH'&&path.startsWith('/api/admin/delivery/zones/')) { await requireAdmin(req); await ensurePromoDeliverySchema(); const b=await bodyOf(req); const current=(await query('SELECT * FROM delivery_zones WHERE id=$1 AND restaurant_id=$2',[id,RESTAURANT_ID])).rows[0]; if(!current) throw fail('Região não encontrada.',404); return json(res,200,{zone:await saveDeliveryZone({...b,name:b.name??current.name,feeMode:b.feeMode??current.fee_mode,feeCents:b.feeCents??Number(current.fee_cents),perKmCents:b.perKmCents??Number(current.per_km_cents),distanceKm:b.distanceKm??Number(current.distance_km||0),active:b.active===undefined?Number(current.active)===1:b.active},id)}); }
    if (method==='PATCH'&&path==='/api/admin/delivery/location') { await requireAdmin(req); await ensurePromoDeliverySchema(); const b=await bodyOf(req),lat=b.latitude===''||b.latitude==null?null:Number(b.latitude),lon=b.longitude===''||b.longitude==null?null:Number(b.longitude),address=clean(b.address,220); if(!address|| (lat!==null&&(!Number.isFinite(lat)||Math.abs(lat)>90)) || (lon!==null&&(!Number.isFinite(lon)||Math.abs(lon)>180)) || ((lat===null)!==(lon===null))) throw fail('Informe o endereço e, se usar cálculo por km, as duas coordenadas válidas.',422); await query('UPDATE restaurants SET address=$1,latitude=$2,longitude=$3 WHERE id=$4',[address,lat,lon,RESTAURANT_ID]); return json(res,200,{ok:true}); }

    if (method==='GET'&&path.startsWith('/api/tables/qr/')) {
      const token=path.slice('/api/tables/qr/'.length);
      if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) throw fail('QR Code de mesa inválido.',404);
      const table=(await query('SELECT table_number AS number,seats,status FROM restaurant_tables WHERE restaurant_id=$1 AND qr_token=$2',[RESTAURANT_ID,token])).rows[0];
      if (!table) throw fail('QR Code de mesa não encontrado.',404);
      return json(res,200,{table});
    }
    if (method==='GET'&&path==='/api/tables/available') { return json(res,200,{tables:(await query("SELECT id,table_number AS number,seats FROM restaurant_tables WHERE restaurant_id=$1 AND status='free' ORDER BY table_number",[RESTAURANT_ID])).rows}); }
    if (method==='POST'&&path==='/api/admin/login') {
      const body=await bodyOf(req); await verifyTurnstile(body.turnstileToken,req); const retry=await limit(req,'admin-login',15,900000);
      if (retry) return json(res,429,{error:'Muitas tentativas. Aguarde antes de tentar novamente.'},{'Retry-After':String(retry)});
      // Retorna falhas de configuração separadamente para que o painel local
      // não esconda problemas de ambiente como se fossem senha incorreta.
      if (!ADMIN_PASSWORD) return json(res,503,{error:'A senha administrativa (ADMIN_PASSWORD) não está configurada neste servidor.'});
      if (SECRET.length < 32) return json(res,503,{error:'A chave de sessão (APP_SECRET) está ausente ou tem menos de 32 caracteres.'});
      if (typeof body.password !== 'string' || body.password.length > 128) return json(res,401,{error:'Não foi possível entrar. Confira os dados e tente novamente.'});
      const candidate=createHmac('sha256',SECRET).update(body.password).digest();
      const expected=createHmac('sha256',SECRET).update(ADMIN_PASSWORD).digest();
      if (!timingSafeEqual(candidate,expected)) return json(res,401,{error:'Não foi possível entrar. Confira os dados e tente novamente.'});
      if (!(await verifyAdminSecondFactor(body))) return json(res,401,{error:'A verificação em duas etapas falhou. Informe o código atual ou um código de recuperação válido.'});
      const expiresAt=Date.now()+ADMIN_SESSION_MS,token=sign({role:'admin',restaurantId:RESTAURANT_ID,iat:Date.now(),exp:Date.now()+ADMIN_TOKEN_MS});
      await storeSession(token,'admin',RESTAURANT_ID,expiresAt);
      return json(res,200,{ok:true},{'Set-Cookie':cookie(ADMIN_COOKIE,token,Math.floor(ADMIN_TOKEN_MS/1000))});
    }
    if(method==='POST'&&path==='/api/admin/session/activity'){
      const current=await requireAdmin(req),token=rawCookieToken(req,ADMIN_COOKIE);
      const touched=await query("UPDATE auth_sessions SET expires_at=NOW()+INTERVAL '30 minutes' WHERE token_hash=$1 AND role='admin' AND subject_id=$2 AND restaurant_id=$3 AND revoked_at IS NULL AND expires_at>NOW()",[tokenHash(token),current.restaurantId,RESTAURANT_ID]);
      if(touched.rowCount!==1)throw fail('Sua sessão expirou. Entre novamente.',401);
      return json(res,200,{ok:true});
    }
    if (method==='POST'&&path==='/api/admin/logout') { await revokeSession(req,ADMIN_COOKIE); return json(res,200,{ok:true},{'Set-Cookie':cookie(ADMIN_COOKIE,'',0)}); }
    if (method==='POST'&&path==='/api/customer/register') {
      const body=await bodyOf(req); await verifyTurnstile(body.turnstileToken,req); const email=normalizeEmail(body.email);
      const retry=await limit(req,'customer-register:'+email,5,3600000);
      if (retry||hasHoneypot(body)) return json(res,429,{error:'Muitas solicitações. Tente novamente mais tarde.'},{'Retry-After':String(retry||900)});
      const name=clean(body.name,100), phone=clean(body.phone,30), password=typeof body.password==='string'?body.password:'';
      const birth=parseBirthDate(body.birthDate);
      if(name.length<2||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<8||password.length>128) throw fail('Confira nome, e-mail, data de nascimento e senha (mínimo de 8 caracteres).',422);
      await ensureCustomerSchema();
      const salt=randomBytes(16).toString('hex'), id='cus_'+randomBytes(18).toString('hex');
      try { await query('INSERT INTO customers (id,name,email,phone,birth_date,password_hash,password_salt,created_at,marketing_consent_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,name,email,phone,birth.birthDate,passwordHash(password,salt),salt,new Date().toISOString(),body.marketingConsent===true?new Date().toISOString():null]); }
      catch(e) { if(e.code==='23505') throw fail('Já existe uma conta com esse e-mail. Entre ou use outro e-mail.',409); throw e; }
      const safe={id,name,email,phone,birthDate:birth.birthDate,isAdult:birth.isAdult,marketingConsent:body.marketingConsent===true},expiresAt=Date.now()+604800000,token=sign({role:'customer',customerId:id,exp:expiresAt});
      await storeSession(token,'customer',id,expiresAt);
      return json(res,201,{customer:safe},{'Set-Cookie':cookie(CUSTOMER_COOKIE,token,604800)});
    }
    if (method==='POST'&&path==='/api/customer/login') {
      const body=await bodyOf(req); await verifyTurnstile(body.turnstileToken,req); const email=normalizeEmail(body.email), retry=await limit(req,'customer-login:'+email,15,900000);
      if(retry) return json(res,429,{error:'Muitas tentativas. Aguarde antes de tentar novamente.'},{'Retry-After':String(retry)});
      await ensureCustomerSchema();
      const row=(await query('SELECT * FROM customers WHERE email=$1',[email])).rows[0];
      if(!row||!verifyPassword(body.password,row)) return json(res,401,{error:'E-mail ou senha inválidos.'});
      const birthDate=row.birth_date?String(row.birth_date).slice(0,10):null;
      const birth=birthDate?parseBirthDate(birthDate):null;
      const safe={id:row.id,name:row.name,email:row.email,phone:row.phone,birthDate,marketingConsent:Boolean(row.marketing_consent_at),isAdult:birth?.isAdult??null},expiresAt=Date.now()+604800000,token=sign({role:'customer',customerId:row.id,exp:expiresAt});
      await storeSession(token,'customer',row.id,expiresAt);
      return json(res,200,{customer:safe},{'Set-Cookie':cookie(CUSTOMER_COOKIE,token,604800)});
    }
    if (method==='POST'&&path==='/api/customer/logout') { await requireCustomer(req); await revokeSession(req,CUSTOMER_COOKIE); return json(res,200,{ok:true},{'Set-Cookie':cookie(CUSTOMER_COOKIE,'',0)}); }
    if (method==='GET'&&path==='/api/customer/me') { const current=await customer(req); return json(res,200,{authenticated:Boolean(current),customer:current?.customer||null}); }
    if (method==='PATCH'&&path==='/api/customer/birth-date') {
      const current=await requireCustomer(req), b=await bodyOf(req), birth=parseBirthDate(b.birthDate);
      const saved=await query("UPDATE customers SET birth_date=$1 WHERE id=$2 AND birth_date IS NULL RETURNING id",[birth.birthDate,current.customerId]);
      if(!saved.rowCount&&String(current.customer.birthDate||'').slice(0,10)!==birth.birthDate) throw fail('A data de nascimento já foi registrada. Para corrigir um dado, use o canal de privacidade.',409);
      return json(res,200,{customer:{...current.customer,birthDate:birth.birthDate,isAdult:birth.isAdult}});
    }
    if(method==='PATCH'&&path==='/api/customer/marketing-consent'){
      const current=await requireCustomer(req),b=await bodyOf(req),enabled=b.enabled===true;
      await query('UPDATE customers SET marketing_consent_at=$1 WHERE id=$2',[enabled?new Date().toISOString():null,current.customerId]);
      return json(res,200,{marketingConsent:enabled});
    }
    if(method==='GET'&&path==='/api/customer/loyalty'){
      const current=await requireCustomer(req);await ensureOperationsSchema();
      // Recupera pedidos que já estavam prontos/concluídos e pagos antes da ativação automática da fidelidade.
      // A recuperação é complementar: falhas nela não podem impedir a leitura
      // do saldo que já existe no extrato do cliente.
      try {
        await query(`INSERT INTO loyalty_points_ledger(id,restaurant_id,customer_id,points,reason,order_id,created_at)
          SELECT 'lp_'||md5(o.id||':loyalty-backfill'),o.restaurant_id,o.customer_id,
            FLOOR(GREATEST(0,COALESCE(SUM(oi.unit_price_cents*oi.quantity),0)-COALESCE(o.discount_cents,0))/100)::int,
            'order_completed',o.id,COALESCE(NULLIF(o.updated_at,'')::timestamptz,NOW())
          FROM orders o
          JOIN order_items oi ON oi.order_id=o.id
          WHERE o.restaurant_id=$1 AND o.customer_id=$2 AND o.payment_status='paid'
            AND o.status IN ('ready','delivering','completed')
          GROUP BY o.id,o.restaurant_id,o.customer_id,o.discount_cents,o.updated_at
          HAVING FLOOR(GREATEST(0,COALESCE(SUM(oi.unit_price_cents*oi.quantity),0)-COALESCE(o.discount_cents,0))/100)>0
          ON CONFLICT(order_id) DO NOTHING`,[RESTAURANT_ID,current.customerId]);
      } catch (backfillError) {
        console.error('[loyalty] Falha na recuperação de pedidos antigos:',backfillError);
      }
      const balance=await query('SELECT COALESCE(SUM(points),0)::int AS points FROM loyalty_points_ledger WHERE restaurant_id=$1 AND customer_id=$2',[RESTAURANT_ID,current.customerId]);
      const history=await query('SELECT points,reason,created_at AS "createdAt" FROM loyalty_points_ledger WHERE restaurant_id=$1 AND customer_id=$2 ORDER BY created_at DESC LIMIT 20',[RESTAURANT_ID,current.customerId]);
      const personalCoupons=await query("SELECT code,discount_type AS \"discountType\",discount_value AS \"discountValue\",expires_at AS \"expiresAt\" FROM coupons WHERE restaurant_id=$1 AND customer_id=$2 AND active=1 AND (NULLIF(expires_at,'') IS NULL OR NULLIF(expires_at,'')::timestamptz>NOW()) AND (max_uses IS NULL OR used_count<max_uses) ORDER BY created_at DESC LIMIT 20",[RESTAURANT_ID,current.customerId]);
      return json(res,200,{points:Number(balance.rows[0]?.points||0),pointsPerReal:1,rewardPoints:1000,rewardDiscountCents:1000,history:history.rows,coupons:personalCoupons.rows});
    }
    if(method==='POST'&&path==='/api/customer/loyalty/redeem'){
      const current=await requireCustomer(req);await ensureOperationsSchema();
      const result=await withTransaction(async client=>{
        const locked=await client.query('SELECT id FROM customers WHERE id=$1 FOR UPDATE',[current.customerId]);
        if(!locked.rowCount)throw fail('Conta de cliente não encontrada.',404);
        const balance=await client.query('SELECT COALESCE(SUM(points),0)::int AS points FROM loyalty_points_ledger WHERE restaurant_id=$1 AND customer_id=$2',[RESTAURANT_ID,current.customerId]);
        if(Number(balance.rows[0]?.points||0)<1000)throw fail('Você precisa de 1.000 pontos para trocar por R$ 10,00.',422);
        const couponId='cpn_'+randomBytes(12).toString('hex'),code='PONTOS-'+randomBytes(4).toString('hex').toUpperCase(),now=new Date(),expires=new Date(now.getTime()+30*86400000);
        const inserted=await client.query("INSERT INTO coupons(id,restaurant_id,code,discount_type,discount_value,minimum_subtotal_cents,starts_at,expires_at,max_uses,active,created_at,customer_id) VALUES($1,$2,$3,'fixed',1000,0,$4,$5,1,1,$4,$6) RETURNING *",[couponId,RESTAURANT_ID,code,now.toISOString(),expires.toISOString(),current.customerId]);
        await client.query("INSERT INTO loyalty_points_ledger(id,restaurant_id,customer_id,points,reason,coupon_id,created_at) VALUES($1,$2,$3,-1000,'reward_redeemed',$4,$5)",['lp_'+randomBytes(12).toString('hex'),RESTAURANT_ID,current.customerId,couponId,now.toISOString()]);
        return inserted.rows[0];
      });
      return json(res,201,{coupon:couponPublic(result),message:'1.000 pontos trocados por R$ 10,00 de desconto. O cupom é exclusivo da sua conta.'});
    }
    if (method==='GET'&&path==='/api/customer/data-export') {
      const c=await requireCustomer(req);await ensureOperationsSchema();
      const rows=await query('SELECT id FROM orders WHERE customer_id=$1 AND restaurant_id=$2 ORDER BY created_at DESC',[c.customerId,RESTAURANT_ID]);
      const orders=await Promise.all(rows.rows.map(row=>orderById(row.id)));
      const loyalty=(await query('SELECT points,reason,created_at AS "createdAt" FROM loyalty_points_ledger WHERE restaurant_id=$1 AND customer_id=$2 ORDER BY created_at DESC',[RESTAURANT_ID,c.customerId])).rows;
      const personalCoupons=(await query('SELECT code,discount_type AS "discountType",discount_value AS "discountValue",expires_at AS "expiresAt",active,used_count AS "usedCount" FROM coupons WHERE restaurant_id=$1 AND customer_id=$2 ORDER BY created_at DESC',[RESTAURANT_ID,c.customerId])).rows;
      return json(res,200,{exportedAt:new Date().toISOString(),format:'menuza-customer-data-v1',customer:{id:c.customer.id,name:c.customer.name,email:c.customer.email,phone:c.customer.phone,birthDate:c.customer.birthDate,marketingConsent:c.customer.marketingConsent},loyalty,personalCoupons,orders});
    }
    if (method==='GET'&&path==='/api/customer/orders') {
      const c=await requireCustomer(req), rows=await query('SELECT id FROM orders WHERE customer_id=$1 AND restaurant_id=$2 ORDER BY created_at DESC LIMIT 100',[c.customerId,RESTAURANT_ID]);
      return json(res,200,{orders:await Promise.all(rows.rows.map(r=>orderById(r.id)))});
    }
    if (method==='DELETE'&&path==='/api/customer/account') {
      const c=await requireCustomer(req), body=await bodyOf(req);
      const retry=await limit(req,'customer-account-delete:'+c.customerId,5,3600000);
      if(retry) return json(res,429,{error:'Muitas tentativas de exclusão. Aguarde antes de tentar novamente.'},{'Retry-After':String(Math.ceil(retry/1000))});
      const row=(await query('SELECT * FROM customers WHERE id=$1',[c.customerId])).rows[0];
      if(!row||!verifyPassword(body.password,row)) return json(res,401,{error:'Senha incorreta. A conta não foi excluída.'});
      await ensureAuthSessionsSchema();await ensureOperationsSchema();
      await withTransaction(async client=>{
        await client.query('UPDATE auth_sessions SET revoked_at=NOW() WHERE role=$1 AND subject_id=$2 AND revoked_at IS NULL',['customer',c.customerId]);
        // Mantém somente o registro transacional que possa ter de ser conservado.
        // Remove os dados de contato/endereço e textos livres que identificam o titular.
        await client.query("UPDATE order_items SET notes='' WHERE order_id IN (SELECT id FROM orders WHERE restaurant_id=$1 AND customer_id=$2)",[RESTAURANT_ID,c.customerId]);
        await client.query("UPDATE orders SET customer_id=NULL, customer_name='Cliente removido', phone='', delivery_address=NULL, note='', tracking_token='deleted-'||id WHERE restaurant_id=$1 AND customer_id=$2",[RESTAURANT_ID,c.customerId]);
        await client.query('DELETE FROM loyalty_points_ledger WHERE restaurant_id=$1 AND customer_id=$2',[RESTAURANT_ID,c.customerId]);
        await client.query('DELETE FROM customer_recovery_campaigns WHERE restaurant_id=$1 AND customer_id=$2',[RESTAURANT_ID,c.customerId]);
        await client.query('UPDATE coupons SET customer_id=NULL,active=0 WHERE restaurant_id=$1 AND customer_id=$2',[RESTAURANT_ID,c.customerId]);
        await client.query('DELETE FROM customers WHERE id=$1',[c.customerId]);
      });
      return json(res,200,{ok:true,message:'Conta e dados pessoais excluídos. Apenas registros transacionais necessários podem permanecer, sem vínculo com sua conta e sem os dados pessoais removidos.'},{'Set-Cookie':cookie(CUSTOMER_COOKIE,'',0)});
    }
    if (method==='POST'&&path==='/api/privacy-requests') {
      await ensurePrivacyRequestFields();
      const b=await bodyOf(req), name=clean(b.name,100), email=normalizeEmail(b.email), phone=clean(b.phone,30), details=clean(b.details,2000), type=['access','correction','deletion','anonymization','portability','sharing_info','revocation','automated_decision','question','support'].includes(b.requestType)?b.requestType:'';
      if(hasHoneypot(b)) return json(res,429,{error:'Muitas solicitações.'},{'Retry-After':'900'});
      if(name.length<2||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!type||details.length<10) throw fail('Informe nome, e-mail válido, tipo de solicitação e detalhes com pelo menos 10 caracteres.',422);
      const retry=await limit(req,'privacy-request:'+email,5,3600000); if(retry) return json(res,429,{error:'Muitas solicitações.'},{'Retry-After':String(retry)});
      const id='pr_'+randomBytes(12).toString('hex'), now=new Date().toISOString();
      await withTransaction(async client=>{
        await client.query('INSERT INTO privacy_requests (id,name,email,phone,request_type,details,status,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)',[id,name,email,phone,type,details,'open',now]);
        await client.query('INSERT INTO privacy_request_events (request_id,event_type,from_status,to_status,actor_type,created_at) VALUES ($1,$2,$3,$4,$5,$6)',[id,'created','','open','requester',now]);
      });
      return json(res,201,{ok:true,id,message:'Solicitação registrada. Guarde este código para referência: '+id});
    }
    if (method==='GET'&&path==='/api/admin/me') {
      const current=await session(req,ADMIN_COOKIE);
      const authenticated=Boolean(current&&current.role==='admin'&&current.restaurantId===RESTAURANT_ID);
      return json(res,200,{authenticated,...(authenticated?{restaurantId:RESTAURANT_ID}:{})});
    }
    if (path.startsWith('/api/admin/')) await requireAdmin(req);
    if (method==='GET'&&path==='/api/admin/security') { const row=ADMIN_TOTP_SECRET?null:await getAdminTwoFactor(); return json(res,200,{twoFactorEnabled:Boolean(ADMIN_TOTP_SECRET||row?.enabledAt),managedByEnvironment:Boolean(ADMIN_TOTP_SECRET),recoveryCodesRemaining:Array.isArray(row?.recoveryCodesHashes)?row.recoveryCodesHashes.length:null}); }
    if (method==='POST'&&path==='/api/admin/security/environment-qr') {
      const retry=await limit(req,'admin-2fa-environment-qr',5,900000);
      if(retry)return json(res,429,{error:'Muitas solicitações de QR Code. Aguarde antes de tentar novamente.'},{'Retry-After':String(retry)});
      // requireAdmin(req), executado antes desta rota, já exige uma sessão administrativa autenticada.
      if(!ADMIN_TOTP_SECRET)return json(res,409,{error:'Não existe ADMIN_TOTP_SECRET configurado no ambiente.'});
      const label=encodeURIComponent('Menuza:Administrador'),issuer=encodeURIComponent('Menuza');
      const otpauthUri='otpauth://totp/'+label+'?secret='+ADMIN_TOTP_SECRET+'&issuer='+issuer+'&algorithm=SHA1&digits=6&period=30';
      return json(res,200,{ok:true,otpauthUri,managedByEnvironment:true});
    }
    if (method==='POST'&&path==='/api/admin/security/setup') {
      const retry=await limit(req,'admin-2fa-setup',5,900000); if(retry)return json(res,429,{error:'Muitas tentativas de configuração. Aguarde antes de tentar novamente.'},{'Retry-After':String(retry)});
      const body=await bodyOf(req); if(!validAdminPassword(body.password))return json(res,401,{error:'Confirme sua senha administrativa para iniciar a configuração.'});
      if(ADMIN_TOTP_SECRET)return json(res,409,{error:'O 2FA está sendo controlado por ADMIN_TOTP_SECRET no ambiente. Remova essa variável antes de migrar para a configuração pelo painel.'});
      const current=await getAdminTwoFactor(); if(current?.enabledAt)return json(res,409,{error:'A autenticação em duas etapas já está ativa.'});
      const secret=generateTotpSecret(),encrypted=encryptTwoFactorSecret(secret),expiresAt=new Date(Date.now()+600000);
      await query('INSERT INTO admin_two_factor(restaurant_id,pending_secret_encrypted,pending_expires_at,updated_at) VALUES($1,$2,$3,NOW()) ON CONFLICT(restaurant_id) DO UPDATE SET pending_secret_encrypted=EXCLUDED.pending_secret_encrypted,pending_expires_at=EXCLUDED.pending_expires_at,updated_at=NOW()',[RESTAURANT_ID,encrypted,expiresAt.toISOString()]);
      const label=encodeURIComponent('Menuza:Administrador'),issuer=encodeURIComponent('Menuza');
      return json(res,200,{ok:true,secret,expiresAt:expiresAt.toISOString(),otpauthUri:'otpauth://totp/'+label+'?secret='+secret+'&issuer='+issuer+'&algorithm=SHA1&digits=6&period=30'});
    }
    if (method==='POST'&&path==='/api/admin/security/confirm') {
      const retry=await limit(req,'admin-2fa-confirm',8,900000); if(retry)return json(res,429,{error:'Muitas tentativas de confirmação. Aguarde antes de tentar novamente.'},{'Retry-After':String(retry)});
      const body=await bodyOf(req),recoveryCodes=createRecoveryCodes(),hashes=recoveryCodes.map(recoveryCodeHash);
      await ensureAuthSessionsSchema();
      await withTransaction(async client=>{
        const locked=await client.query('SELECT pending_secret_encrypted,pending_expires_at FROM admin_two_factor WHERE restaurant_id=$1 FOR UPDATE',[RESTAURANT_ID]);
        const pending=locked.rows[0];
        if(!pending?.pending_secret_encrypted||!pending.pending_expires_at||new Date(pending.pending_expires_at).getTime()<=Date.now())throw fail('A configuração expirou. Gere uma nova chave para continuar.',410);
        if(!verifyTotp(decryptTwoFactorSecret(pending.pending_secret_encrypted),String(body.otp||'')))throw fail('Código inválido. Confira o autenticador e tente novamente.',401);
        await client.query('UPDATE admin_two_factor SET secret_encrypted=$1,pending_secret_encrypted=NULL,pending_expires_at=NULL,recovery_codes_hashes=$2::jsonb,enabled_at=NOW(),updated_at=NOW() WHERE restaurant_id=$3',[pending.pending_secret_encrypted,JSON.stringify(hashes),RESTAURANT_ID]);
        await client.query("UPDATE auth_sessions SET revoked_at=NOW() WHERE role='admin' AND subject_id=$1 AND revoked_at IS NULL",[RESTAURANT_ID]);
      });
      return json(res,200,{ok:true,twoFactorEnabled:true,recoveryCodes});
    }
    if (method==='POST'&&path==='/api/admin/security/disable') {
      const retry=await limit(req,'admin-2fa-disable',5,900000); if(retry)return json(res,429,{error:'Muitas tentativas. Aguarde antes de tentar novamente.'},{'Retry-After':String(retry)});
      const body=await bodyOf(req); if(!validAdminPassword(body.password))return json(res,401,{error:'Senha administrativa incorreta.'});
      if(ADMIN_TOTP_SECRET)return json(res,409,{error:'O 2FA está sendo controlado por ADMIN_TOTP_SECRET. Remova a variável no ambiente para gerenciar pelo painel.'});
      const current=await getAdminTwoFactor(); if(!current?.enabledAt)return json(res,409,{error:'A autenticação em duas etapas já está desativada.'});
      if(!(await verifyAdminSecondFactor(body)))return json(res,401,{error:'Código autenticador ou código de recuperação inválido.'});
      await ensureAuthSessionsSchema();
      await withTransaction(async client=>{await client.query("UPDATE admin_two_factor SET secret_encrypted=NULL,pending_secret_encrypted=NULL,pending_expires_at=NULL,recovery_codes_hashes='[]'::jsonb,enabled_at=NULL,updated_at=NOW() WHERE restaurant_id=$1",[RESTAURANT_ID]);await client.query("UPDATE auth_sessions SET revoked_at=NOW() WHERE role='admin' AND subject_id=$1 AND revoked_at IS NULL",[RESTAURANT_ID]);});
      return json(res,200,{ok:true,twoFactorEnabled:false});
    }
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
    if (method==='GET'&&path==='/api/admin/privacy-requests') {
      await ensurePrivacyRequestFields();
      return json(res,200,{requests:(await query("SELECT p.id,p.name,p.email,p.phone,p.request_type AS \"requestType\",p.details,p.status,p.response_note AS \"responseNote\",p.retention_reason AS \"retentionReason\",p.closed_at AS \"closedAt\",p.created_at AS \"createdAt\",p.updated_at AS \"updatedAt\",COALESCE((SELECT json_agg(json_build_object('eventType',e.event_type,'fromStatus',e.from_status,'toStatus',e.to_status,'actorType',e.actor_type,'createdAt',e.created_at) ORDER BY e.created_at,e.id) FROM privacy_request_events e WHERE e.request_id=p.id),'[]'::json) AS events FROM privacy_requests p ORDER BY CASE p.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,p.created_at DESC LIMIT 200")).rows});
    }
    if (method==='PATCH'&&path.startsWith('/api/admin/privacy-requests/')) {
      await ensurePrivacyRequestFields();
      const b=await bodyOf(req), responseNote=clean(b.responseNote,2000), retentionReason=clean(b.retentionReason,1000);
      if(!['open','in_progress','closed'].includes(b.status)) throw fail('Status inválido.',422);
      if(b.status==='closed'&&responseNote.length<10) throw fail('Registre uma resposta ou providência com pelo menos 10 caracteres antes de concluir.',422);
      const now=new Date().toISOString();
      await withTransaction(async client=>{
        const current=await client.query('SELECT status FROM privacy_requests WHERE id=$1 FOR UPDATE',[id]);
        if(!current.rowCount) throw fail('Solicitação não encontrada.',404);
        const previousStatus=current.rows[0].status;
        await client.query('UPDATE privacy_requests SET status=$1,response_note=$2,retention_reason=$3,closed_at=$4,updated_at=$5 WHERE id=$6',[b.status,responseNote,retentionReason,b.status==='closed'?now:null,now,id]);
        if(previousStatus!==b.status) await client.query('INSERT INTO privacy_request_events (request_id,event_type,from_status,to_status,actor_type,created_at) VALUES ($1,$2,$3,$4,$5,$6)',[id,'status_changed',previousStatus,b.status,'admin',now]);
        else await client.query('INSERT INTO privacy_request_events (request_id,event_type,from_status,to_status,actor_type,created_at) VALUES ($1,$2,$3,$4,$5,$6)',[id,'response_updated',previousStatus,b.status,'admin',now]);
      });
      return json(res,200,{ok:true});
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
    if(method==='GET'&&path==='/api/admin/pizza-config'){await requireAdmin(req);await ensurePizzaConfigSchema();const [sizes,crusts]=await Promise.all([query('SELECT key,label,diameter_cm AS "diameterCm",max_flavors AS "maxFlavors",price_cents AS "priceCents",active,sort_order AS "sortOrder" FROM pizza_sizes WHERE restaurant_id=$1 AND active=1 ORDER BY sort_order',[RESTAURANT_ID]),query('SELECT key,label,price_cents AS "priceCents",active,sort_order AS "sortOrder" FROM pizza_crusts WHERE restaurant_id=$1 AND active=1 ORDER BY sort_order',[RESTAURANT_ID])]);return json(res,200,{sizes:sizes.rows,crusts:crusts.rows});}
    if(method==='PATCH'&&path==='/api/admin/pizza-size-prices'){await requireAdmin(req);await ensurePizzaConfigSchema();const b=await bodyOf(req);if(!b.sizePrices||typeof b.sizePrices!=='object'||Array.isArray(b.sizePrices))throw fail('Informe os preços dos tamanhos.',422);const sizes=(await query('SELECT key,label FROM pizza_sizes WHERE restaurant_id=$1 AND active=1 ORDER BY sort_order',[RESTAURANT_ID])).rows;if(!sizes.length)throw fail('Cadastre os tamanhos das pizzas primeiro.',422);for(const size of sizes){const cents=Number(b.sizePrices[size.key]);if(!Number.isInteger(cents)||cents<500||cents>1000000)throw fail('Informe um preço válido para '+size.label+'.',422);}for(const size of sizes)await query('UPDATE pizza_sizes SET price_cents=$1 WHERE restaurant_id=$2 AND key=$3',[Number(b.sizePrices[size.key]),RESTAURANT_ID,size.key]);return json(res,200,await catalogFor(true));}
    if(method==='PUT'&&path==='/api/admin/pizza-config'){await requireAdmin(req);await ensurePizzaConfigSchema();const b=await bodyOf(req);if(!Array.isArray(b.sizes)||!b.sizes.length||b.sizes.length>12||!Array.isArray(b.crusts)||!b.crusts.length||b.crusts.length>20)throw fail('Cadastre ao menos um tamanho e uma borda.',422);const keys=new Set();for(const [i,x] of b.sizes.entries()){const key=slugify(x.key||x.label),label=clean(x.label,40),diameter=Number(x.diameterCm),max=Number(x.maxFlavors);if(!key||keys.has(key)||label.length<2||!Number.isInteger(diameter)||diameter<10||diameter>60||!Number.isInteger(max)||max<1||max>8)throw fail('Confira nome, diâmetro e limite de sabores dos tamanhos.',422);keys.add(key);await query('INSERT INTO pizza_sizes(id,restaurant_id,key,label,diameter_cm,max_flavors,active,sort_order) VALUES($1,$2,$3,$4,$5,$6,1,$7) ON CONFLICT(restaurant_id,key) DO UPDATE SET label=EXCLUDED.label,diameter_cm=EXCLUDED.diameter_cm,max_flavors=EXCLUDED.max_flavors,active=1,sort_order=EXCLUDED.sort_order',['sz_'+key,RESTAURANT_ID,key,label,diameter,max,i]);}const crustKeys=new Set();for(const [i,x] of b.crusts.entries()){const key=slugify(x.key||x.label),label=clean(x.label,50),price=Number(x.priceCents);if(!key||crustKeys.has(key)||label.length<2||!Number.isInteger(price)||price<0||price>1000000)throw fail('Confira os nomes e preços das bordas.',422);crustKeys.add(key);await query('INSERT INTO pizza_crusts(id,restaurant_id,key,label,price_cents,active,sort_order) VALUES($1,$2,$3,$4,$5,1,$6) ON CONFLICT(restaurant_id,key) DO UPDATE SET label=EXCLUDED.label,price_cents=EXCLUDED.price_cents,active=1,sort_order=EXCLUDED.sort_order',['cr_'+key,RESTAURANT_ID,key,label,price,i]);}await query('DELETE FROM pizza_sizes WHERE restaurant_id=$1 AND NOT(key=ANY($2::text[]))',[RESTAURANT_ID,[...keys]]);await query('DELETE FROM pizza_crusts WHERE restaurant_id=$1 AND NOT(key=ANY($2::text[]))',[RESTAURANT_ID,[...crustKeys]]);return json(res,200,await catalogFor(true));}
    if (method==='GET'&&path==='/api/admin/catalog') return json(res,200,await catalogFor(true));
    if (method==='GET'&&path==='/api/admin/settings') {
      // A migração do esquema pode ter sido aplicada antes da migração dos dados.
      // Garante o registro-base para que a tela de configurações não receba restaurant undefined.
      await query(`INSERT INTO restaurants (id,name,slug,currency,prep_minutes,created_at,logo_url)
        VALUES ($1,$2,$3,'BRL',30,$4,'')
        ON CONFLICT (id) DO NOTHING`, [RESTAURANT_ID,'Bela Mesa','bela-mesa',new Date().toISOString()]);
      await query("ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS google_review_url TEXT NOT NULL DEFAULT ''");
  await query("ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS google_review_url_initialized BOOLEAN NOT NULL DEFAULT FALSE");
  await query("UPDATE restaurants SET google_review_url=$1,google_review_url_initialized=TRUE WHERE id=$2 AND google_review_url_initialized=FALSE",["https://share.google/dg8sziHxshXgV93g8",RESTAURANT_ID]);
      const restaurant=await migrateRestaurantImageFields((await query('SELECT id,name,slug,currency,prep_minutes AS "prepMinutes",logo_url AS "logoUrl",google_review_url AS "googleReviewUrl" FROM restaurants WHERE id=$1',[RESTAURANT_ID])).rows[0]);
      if (!restaurant) throw fail('Não foi possível carregar as configurações do restaurante.',503);
      return json(res,200,{restaurant});
    }
    if (method==='PATCH'&&path==='/api/admin/settings') {
      await query(`INSERT INTO restaurants (id,name,slug,currency,prep_minutes,created_at,logo_url)
        VALUES ($1,$2,$3,'BRL',30,$4,'')
        ON CONFLICT (id) DO NOTHING`, [RESTAURANT_ID,'Bela Mesa','bela-mesa',new Date().toISOString()]);
      await query("ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS google_review_url TEXT NOT NULL DEFAULT ''");
  await query("ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS google_review_url_initialized BOOLEAN NOT NULL DEFAULT FALSE");
  await query("UPDATE restaurants SET google_review_url=$1,google_review_url_initialized=TRUE WHERE id=$2 AND google_review_url_initialized=FALSE",["https://share.google/dg8sziHxshXgV93g8",RESTAURANT_ID]);
      const b=await bodyOf(req,1500000), current=(await query('SELECT name,prep_minutes AS "prepMinutes",logo_url AS "logoUrl",google_review_url AS "googleReviewUrl" FROM restaurants WHERE id=$1',[RESTAURANT_ID])).rows[0];
      if (!current) throw fail('Não foi possível carregar as configurações do restaurante.',503);
      const name=b.name===undefined?current.name:clean(b.name,80), prep=b.prepMinutes===undefined?Number(current.prepMinutes):Number(b.prepMinutes), logo=b.logoUrl===undefined?current.logoUrl:clean(b.logoUrl,1400000), googleReviewUrl=clean(b.googleReviewUrl??current.googleReviewUrl??'',1000);
      if(name.length<2||!Number.isInteger(prep)||prep<5||prep>240) throw fail('Confira o nome e o tempo médio de preparo.',422);
      if(googleReviewUrl&&!/^https:\/\//i.test(googleReviewUrl)) throw fail('Informe um link seguro de avaliação começando com https://.',422);
      if(logo&&!/^https:\/\/[^\s<>"']+$/i.test(logo)&&!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(logo)) throw fail('Envie uma imagem PNG, JPG ou WebP válida.',422);
      if(logo.startsWith('data:')&&logo.length>1400000) throw fail('A logo ficou grande demais.',413);
      const storedLogo=isImageDataUrl(logo)?await storeImageDataUrl(logo,'restaurants/logos'):logo;
      await query('UPDATE restaurants SET name=$1,prep_minutes=$2,logo_url=$3,google_review_url=$4,google_review_url_initialized=TRUE WHERE id=$5',[name,prep,storedLogo,googleReviewUrl,RESTAURANT_ID]);
      return json(res,200,{restaurant:(await query('SELECT id,name,slug,currency,prep_minutes AS "prepMinutes",logo_url AS "logoUrl",google_review_url AS "googleReviewUrl" FROM restaurants WHERE id=$1',[RESTAURANT_ID])).rows[0]});
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
      const fileName=sanitizeUploadFileName(clean(b.fileName,180)),rawMimeType=clean(b.mimeType,100),rawContentBase64=String(b.contentBase64||'');
      const date=clean(b.date,10),amountCents=Number(b.amountCents||0),issuerCnpj=clean(b.issuerCnpj,14).replace(/\D/g,'');
      if(!['received','issued'].includes(direction)||!fileName)throw fail('Informe o tipo e o nome do documento.',422);
      let validatedFile;
      try { validatedFile=validateFiscalDocument({documentType,mimeType:rawMimeType,contentBase64:rawContentBase64}); }
      catch(error) { throw fail(error.message||'Arquivo inválido. Envie somente PDF ou XML de até 1,3 MB.',422); }
      const mimeType=validatedFile.mimeType,contentBase64=validatedFile.bytes.toString('base64');
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
    if(method==='GET'&&path==='/api/admin/daily-closing'){
      await requireAdmin(req);
      const date=String(requestUrl.searchParams.get('date')||'');
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date+'T12:00:00Z')))throw fail('Data do fechamento inválida.',422);
      const start=date+'T03:00:00.000Z',next=new Date(Date.parse(date+'T03:00:00.000Z')+86400000).toISOString();
      const rows=await query('SELECT id,customer_name AS "customerName",phone,fulfillment,table_label AS "tableLabel",delivery_address AS "deliveryAddress",note,status,total_cents AS "totalCents",payment_method AS "paymentMethod",payment_status AS "paymentStatus",paid_at AS "paidAt",coupon_code AS "couponCode",discount_cents AS "discountCents",created_at AS "createdAt" FROM orders WHERE restaurant_id=$1 AND created_at >= $2 AND created_at < $3 ORDER BY created_at ASC',[RESTAURANT_ID,start,next]);
      const orders=await Promise.all(rows.rows.map(async o=>{
        const itemRows=await query('SELECT product_id AS "productId",product_name_snapshot AS name,quantity,size_key AS "sizeKey",crust_key AS "crustKey",ingredients_json AS "ingredientsJson",notes,unit_price_cents AS "unitPriceCents",snapshot_json AS "snapshotJson" FROM order_items WHERE order_id=$1 ORDER BY id',[o.id]);
        const items=itemRows.rows.map(i=>{let ingredients=[],snapshot={};try{ingredients=JSON.parse(i.ingredientsJson||'[]')}catch{}try{snapshot=JSON.parse(i.snapshotJson||'{}')}catch{}return {productId:i.productId,name:i.name,quantity:i.quantity,sizeKey:i.sizeKey,crustKey:i.crustKey,ingredients,notes:i.notes,unitPriceCents:i.unitPriceCents,snapshot}});
        return {...o,items};
      }));
      return json(res,200,{orders});
    }
    if (method==='GET'&&path==='/api/admin/orders') {
      const rows=await query("SELECT id,customer_name AS \"customerName\",phone,fulfillment,table_label AS \"tableLabel\",delivery_address AS \"deliveryAddress\",note,status,total_cents AS \"totalCents\",payment_method AS \"paymentMethod\",payment_status AS \"paymentStatus\",paid_at AS \"paidAt\",coupon_code AS \"couponCode\",discount_cents AS \"discountCents\",created_at AS \"createdAt\" FROM orders WHERE restaurant_id=$1 ORDER BY CASE status WHEN 'received' THEN 0 WHEN 'confirmed' THEN 1 WHEN 'preparing' THEN 2 WHEN 'ready' THEN 3 ELSE 4 END,created_at DESC LIMIT 100",[RESTAURANT_ID]);
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
    if(method==='GET'&&path==='/api/admin/audit'){
      await requireAdmin(req);
      const rows=await query('SELECT id,action,entity_type AS "entityType",entity_id AS "entityId",details,created_at AS "createdAt" FROM admin_audit_log WHERE restaurant_id=$1 ORDER BY created_at DESC,id DESC LIMIT 200',[RESTAURANT_ID]);
      return json(res,200,{events:rows.rows});
    }
    if(method==='PATCH'&&path.startsWith('/api/admin/orders/')&&path.endsWith('/payment')){
      await requireAdmin(req);
      const orderId=decodeURIComponent(parts.at(-2)||'');
      const b=await bodyOf(req),paid=Boolean(b.paid),methodValue=clean(b.paymentMethod,20).toLowerCase();
      if(!['pix','cash','card'].includes(methodValue))throw fail('Forma de pagamento inválida.',422);
      const updated=await withTransaction(async client=>{
        const found=await client.query('SELECT id,status,payment_method,payment_status,customer_id,discount_cents FROM orders WHERE id=$1 AND restaurant_id=$2 FOR UPDATE',[orderId,RESTAURANT_ID]);
        const order=found.rows[0];if(!order)throw fail('Pedido não encontrado.',404);
        if(order.status==='cancelled'&&paid)throw fail('Não é possível marcar um pedido cancelado como pago.',409);
        const nextStatus=paid?'paid':'pending',now=paid?new Date().toISOString():null;
        await client.query('UPDATE orders SET payment_method=$1,payment_status=$2,paid_at=$3,paid_by=$4 WHERE id=$5 AND restaurant_id=$6',[methodValue,nextStatus,now,paid?'admin':'',orderId,RESTAURANT_ID]);
        await awardOrderLoyaltyPoints(client,{...order,id:orderId,payment_status:nextStatus},now||new Date().toISOString());
        await client.query('INSERT INTO admin_audit_log(restaurant_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5::jsonb)',[RESTAURANT_ID,'order.payment_updated','order',orderId,JSON.stringify({from:order.payment_status,to:nextStatus,paymentMethod:methodValue})]);
        return {id:orderId,paymentMethod:methodValue,paymentStatus:nextStatus,paidAt:now};
      });
      return json(res,200,{payment:updated});
    }
    if (method==='GET'&&path==='/api/admin/analytics') {
      const days=[7,30,90].includes(Number(req.query?.days))?Number(req.query.days):7, since=new Date(Date.now()-days*86400000).toISOString();
      const [summary,daily,fulfillment,popular,topCustomers,customerStats,contributionRows,profitabilityRows]=await Promise.all([
        query("SELECT COUNT(*)::int AS orders,COALESCE(SUM(total_cents) FILTER (WHERE status<>'cancelled'),0)::int AS \"revenueCents\",COALESCE(ROUND(AVG(total_cents) FILTER (WHERE status<>'cancelled')),0)::int AS \"averageTicketCents\",COUNT(*) FILTER (WHERE status='cancelled')::int AS cancelled FROM orders WHERE restaurant_id=$1 AND created_at >= $2",[RESTAURANT_ID,since]),
        query("SELECT created_at::date::text AS date,COUNT(*)::int AS orders,COALESCE(SUM(total_cents) FILTER (WHERE status<>'cancelled'),0)::int AS \"revenueCents\" FROM orders WHERE restaurant_id=$1 AND created_at >= $2 GROUP BY created_at::date ORDER BY date",[RESTAURANT_ID,since]),
        query("SELECT fulfillment AS type,COUNT(*)::int AS orders FROM orders WHERE restaurant_id=$1 AND created_at >= $2 AND status<>'cancelled' GROUP BY fulfillment ORDER BY orders DESC",[RESTAURANT_ID,since]),
        query("SELECT oi.product_name_snapshot AS name,SUM(oi.quantity)::int AS quantity,COALESCE(SUM(oi.unit_price_cents*oi.quantity),0)::int AS \"revenueCents\" FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.restaurant_id=$1 AND o.created_at >= $2 AND o.status<>'cancelled' GROUP BY oi.product_name_snapshot ORDER BY quantity DESC LIMIT 8",[RESTAURANT_ID,since]),
        query("SELECT o.customer_id AS id,MAX(o.customer_name) AS name,COUNT(*)::int AS orders,COALESCE(SUM(o.total_cents),0)::int AS \"revenueCents\" FROM orders o WHERE o.restaurant_id=$1 AND o.created_at >= $2 AND o.status<>'cancelled' AND o.customer_id IS NOT NULL GROUP BY o.customer_id HAVING COUNT(*)>1 ORDER BY orders DESC,\"revenueCents\" DESC LIMIT 8",[RESTAURANT_ID,since]),
        query("SELECT COUNT(*)::int AS \"identifiedCustomers\",COUNT(*) FILTER (WHERE order_count>1)::int AS \"returningCustomers\" FROM (SELECT customer_id,COUNT(*)::int AS order_count FROM orders WHERE restaurant_id=$1 AND created_at >= $2 AND status<>'cancelled' AND customer_id IS NOT NULL GROUP BY customer_id) customers",[RESTAURANT_ID,since]),
        query("SELECT COALESCE(SUM(oi.unit_price_cents*oi.quantity),0)::bigint AS revenue_cents,COALESCE(SUM(oi.unit_price_cents*oi.quantity) FILTER (WHERE p.cost_cents>0),0)::bigint AS known_revenue_cents,COALESCE(SUM(CASE WHEN p.cost_cents>0 THEN p.cost_cents*oi.quantity ELSE 0 END),0)::bigint AS known_cost_cents,COUNT(DISTINCT oi.product_id) FILTER (WHERE COALESCE(p.cost_cents,0)>0)::int AS products_with_cost,COUNT(DISTINCT oi.product_id)::int AS products_sold FROM order_items oi JOIN orders o ON o.id=oi.order_id LEFT JOIN products p ON p.id=oi.product_id AND p.restaurant_id=o.restaurant_id WHERE o.restaurant_id=$1 AND o.created_at >= $2 AND o.status<>'cancelled'",[RESTAURANT_ID,since]),
        query("SELECT oi.product_name_snapshot AS name,SUM(oi.quantity)::int AS quantity,COALESCE(SUM(oi.unit_price_cents*oi.quantity),0)::bigint AS revenue_cents,COALESCE(SUM(p.cost_cents*oi.quantity),0)::bigint AS cost_cents,COALESCE(SUM((oi.unit_price_cents-p.cost_cents)*oi.quantity),0)::bigint AS contribution_cents FROM order_items oi JOIN orders o ON o.id=oi.order_id JOIN products p ON p.id=oi.product_id AND p.restaurant_id=o.restaurant_id WHERE o.restaurant_id=$1 AND o.created_at >= $2 AND o.status<>'cancelled' AND p.cost_cents>0 GROUP BY oi.product_name_snapshot ORDER BY contribution_cents DESC LIMIT 8",[RESTAURANT_ID,since])
      ]);
      const contribution=contributionRows.rows[0];
      const revenueCents=Number(contribution.revenue_cents||0),knownRevenueCents=Number(contribution.known_revenue_cents||0),knownCostCents=Number(contribution.known_cost_cents||0);
      const marginCoverage=Number(contribution.products_sold||0)?Math.round(Number(contribution.products_with_cost||0)/Number(contribution.products_sold||1)*100):0;
      return json(res,200,{days,summary:summary.rows[0],daily:daily.rows,fulfillment:fulfillment.rows,popular:popular.rows,topCustomers:topCustomers.rows,profitability:profitabilityRows.rows.map(row=>({...row,revenueCents:Number(row.revenue_cents||0),costCents:Number(row.cost_cents||0),contributionCents:Number(row.contribution_cents||0)})),customerStats:customerStats.rows[0]||{identifiedCustomers:0,returningCustomers:0},contribution:{revenueCents,knownRevenueCents,knownCostCents,contributionCents:knownRevenueCents-knownCostCents,marginPercent:knownRevenueCents?Math.round((knownRevenueCents-knownCostCents)/knownRevenueCents*10000)/100:0,productsWithCost:Number(contribution.products_with_cost||0),productsSold:Number(contribution.products_sold||0),coveragePercent:marginCoverage,estimated:true}});
    }
    if (method==='GET'&&path==='/api/admin/coupons') return json(res,200,{coupons:(await query('SELECT * FROM coupons WHERE restaurant_id=$1 ORDER BY created_at DESC',[RESTAURANT_ID])).rows.map(couponPublic)});
    if (method==='POST'&&path==='/api/admin/coupons') return json(res,201,{coupon:await saveCoupon(await bodyOf(req))});
    if (method==='PATCH'&&path.startsWith('/api/admin/coupons/')) return json(res,200,{coupon:await saveCoupon(await bodyOf(req),id)});
    if (method==='POST'&&path==='/api/coupons/validate') {
      const current=await requireCustomer(req); const b=await bodyOf(req); if(hasHoneypot(b)) throw fail('Solicitação inválida.',422);
      const {subtotal}=await priceItems(b.items), code=normalizeCoupon(b.code), discount=couponDiscount(await coupons(code),subtotal,current.customer.id);
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
    if (path.startsWith('/api/3d-worker/')) {
      const workerToken=String(process.env.TRIPOSR_WORKER_TOKEN||'');
      const auth=String(req.headers.authorization||'');
      if(!workerToken||auth!=='Bearer '+workerToken) throw fail('Worker não autorizado.',401);
      if(method==='POST'&&path==='/api/3d-worker/heartbeat'){
        const b=await bodyOf(req,12000),jobId=clean(b.jobId,100);
        await query("INSERT INTO worker_heartbeats(worker_name,last_seen_at,metadata) VALUES('triposr',NOW(),$1::jsonb) ON CONFLICT(worker_name) DO UPDATE SET last_seen_at=NOW(),metadata=EXCLUDED.metadata",[JSON.stringify({runtime:'triposr',jobId:jobId||null})]);
        if(jobId)await query("UPDATE product_3d_jobs SET updated_at=NOW() WHERE id=$1 AND restaurant_id=$2 AND status='processing'",[jobId,RESTAURANT_ID]);
        return json(res,200,{ok:true});
      }
      if(method==='GET'&&path==='/api/3d-worker/next'){
      await query("CREATE TABLE IF NOT EXISTS product_3d_jobs (id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL, product_id TEXT NOT NULL, image_data TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', error_message TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
      await query("ALTER TABLE product_3d_jobs ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0");
      await query("CREATE TABLE IF NOT EXISTS worker_heartbeats (worker_name TEXT PRIMARY KEY, last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), metadata JSONB NOT NULL DEFAULT '{}'::jsonb)");
        await query("INSERT INTO worker_heartbeats(worker_name,last_seen_at,metadata) VALUES('triposr',NOW(),$1::jsonb) ON CONFLICT(worker_name) DO UPDATE SET last_seen_at=NOW(),metadata=EXCLUDED.metadata", [JSON.stringify({runtime:'triposr'})]);
        await query("UPDATE product_3d_jobs SET status=CASE WHEN attempt_count>=3 THEN 'failed' ELSE 'queued' END,error_message=CASE WHEN attempt_count>=3 THEN 'Worker interrompido repetidamente; limite de tentativas atingido.' ELSE error_message END,updated_at=NOW() WHERE restaurant_id=$1 AND status='processing' AND updated_at<NOW()-INTERVAL '20 minutes'",[RESTAURANT_ID]);
        await query("UPDATE products SET model_3d_status='failed' WHERE restaurant_id=$1 AND id IN (SELECT product_id FROM product_3d_jobs WHERE restaurant_id=$1 AND status='failed' AND error_message='Worker interrompido repetidamente; limite de tentativas atingido.')",[RESTAURANT_ID]);
        const job=await withTransaction(async client=>{
          const found=await client.query("SELECT id,product_id AS \"productId\",image_data AS \"imageData\" FROM product_3d_jobs WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1");
          if(!found.rows[0]) return null;
          await client.query("UPDATE product_3d_jobs SET status='processing',attempt_count=attempt_count+1,updated_at=NOW() WHERE id=$1",[found.rows[0].id]);
          await client.query("UPDATE products SET model_3d_status='processing' WHERE id=$1 AND restaurant_id=$2",[found.rows[0].productId,RESTAURANT_ID]);
          return found.rows[0];
        });
        return json(res,200,{job});
      }
      if(method==='POST'&&path.startsWith('/api/3d-worker/complete/')){
        const jobId=decodeURIComponent(path.split('/').pop()),b=await bodyOf(req,12000),modelUrl=clean(b.modelUrl,1000);
        if(!/^https:\/\//i.test(modelUrl)) throw fail('URL do modelo inválida.',422);
        const updated=await query("UPDATE product_3d_jobs SET status='completed',image_data='',error_message='',updated_at=NOW() WHERE id=$1 AND restaurant_id=$2 RETURNING product_id",[jobId,RESTAURANT_ID]);
        if(!updated.rows[0]) throw fail('Solicitação não encontrada.',404);
        await query("UPDATE products SET model_3d_url=$1,model_3d_status='completed',updated_at=$2 WHERE id=$3 AND restaurant_id=$4",[modelUrl,new Date().toISOString(),updated.rows[0].product_id,RESTAURANT_ID]);
        return json(res,200,{ok:true});
      }
      if(method==='POST'&&path.startsWith('/api/3d-worker/fail/')){
        const jobId=decodeURIComponent(path.split('/').pop()),b=await bodyOf(req,12000),message=clean(b.error,300)||'Falha na geração 3D.';
        const updated=await query("UPDATE product_3d_jobs SET status='failed',error_message=$1,image_data='',updated_at=NOW() WHERE id=$2 AND restaurant_id=$3 RETURNING product_id",[message,jobId,RESTAURANT_ID]);
        if(!updated.rows[0]) throw fail('Solicitação não encontrada.',404);
        await query("UPDATE products SET model_3d_status='failed',updated_at=$1 WHERE id=$2 AND restaurant_id=$3",[new Date().toISOString(),updated.rows[0].product_id,RESTAURANT_ID]);
        return json(res,200,{ok:true});
      }
      throw fail('Rota do worker não encontrada.',404);
    }
    if(method==='POST'&&path.startsWith('/api/admin/products/')&&path.endsWith('/3d')){
      await requireAdmin(req);
      await query("CREATE TABLE IF NOT EXISTS product_3d_jobs (id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL, product_id TEXT NOT NULL, image_data TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', error_message TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
      const productId=decodeURIComponent(path.split('/').slice(-2,-1)[0]);
      const product=(await query("SELECT id,image_url FROM products WHERE id=$1 AND restaurant_id=$2",[productId,RESTAURANT_ID])).rows[0];
      if(!product) throw fail('Produto não encontrado.',404);
      if(!isImageDataUrl(product.image_url)&&!isStoredImageUrl(product.image_url)) throw fail('Adicione uma foto WebP ao produto antes de gerar o modelo 3D.',422);
      const imageData=await imageReferenceToDataUrl(product.image_url);
      const current=await query("SELECT id FROM product_3d_jobs WHERE product_id=$1 AND restaurant_id=$2 AND status IN ('queued','processing') LIMIT 1",[productId,RESTAURANT_ID]);
      if(current.rows[0]) return json(res,200,{ok:true,jobId:current.rows[0].id,status:'queued',message:'A geração já está na fila.'});
      const jobId='3d_'+randomBytes(16).toString('hex');
      await query("INSERT INTO product_3d_jobs (id,restaurant_id,product_id,image_data,status) VALUES ($1,$2,$3,$4,'queued')",[jobId,RESTAURANT_ID,productId,imageData]);
      await query("UPDATE products SET model_3d_status='queued' WHERE id=$1 AND restaurant_id=$2",[productId,RESTAURANT_ID]);
      return json(res,202,{ok:true,jobId,status:'queued',message:'Solicitação adicionada à fila. O worker precisa estar ligado para processar.'});
    }
    if(method==='GET'&&path.startsWith('/api/admin/products/')&&path.endsWith('/3d')){
      await requireAdmin(req);
      const productId=decodeURIComponent(path.split('/').slice(-2,-1)[0]);
      const product=(await query("SELECT model_3d_url AS \"modelUrl\",model_3d_status AS status FROM products WHERE id=$1 AND restaurant_id=$2",[productId,RESTAURANT_ID])).rows[0];
      if(!product) throw fail('Produto não encontrado.',404);
      return json(res,200,{...product,workerConfigured:Boolean(process.env.TRIPOSR_WORKER_TOKEN)});
    }
    if (method==='POST'&&path==='/api/admin/products') {
      await query("ALTER TABLE products ADD COLUMN IF NOT EXISTS age_restricted INTEGER NOT NULL DEFAULT 0");
      await query("ALTER TABLE products ADD COLUMN IF NOT EXISTS size_prices_json TEXT NOT NULL DEFAULT '{}'");
      const b=await bodyOf(req,2100000), name=clean(b.name,80), description=clean(b.description,300), type=b.type, categoryId=clean(b.categoryId,50), price=Number(b.baseCents);
      const images=b.images===undefined?null:b.images;
      if(images!==null&&(!Array.isArray(images)||images.length>8||images.some(url=>typeof url!=='string'||url.length>245000||(!isImageDataUrl(url)&&!isStoredImageUrl(url)))||images.reduce((sum,url)=>sum+url.length,0)>1950000)) throw fail('Envie até 8 fotos WebP comprimidas, com tamanho total reduzido.',422);
      const imageUrl=images!==null?(images[0]||''):(b.imageUrl===undefined?'':String(b.imageUrl));
      if(imageUrl.length>245000||(imageUrl!==''&&!isImageDataUrl(imageUrl)&&!isStoredImageUrl(imageUrl))) throw fail('Foto inválida ou muito grande. Escolha outra imagem.',422);
      if(name.length<2||!['pizza','burger','plate','drink'].includes(type)||!Number.isInteger(price)||price<(type==='drink'?1:500)||price>1000000) throw fail('Preencha nome, tipo e preço-base válidos.',422);
      if(type==='drink'&&!imageUrl) throw fail('Cadastre uma foto para a bebida.',422);
      if(type==='drink') await ensureBeverageSchema();
      const cat=(await query('SELECT id FROM categories WHERE id=$1 AND restaurant_id=$2',[categoryId,RESTAURANT_ID])).rows[0]; if(!cat) throw fail('Escolha uma categoria válida.',422);
      const costCents=Number(b.costCents??0);if(!Number.isInteger(costCents)||costCents<0||costCents>1000000)throw fail('Informe um custo direto unitário válido.',422);
      const now=new Date().toISOString(), productId=slugify(name)+'-'+randomBytes(3).toString('hex');
      const storedImages=images!==null?await storeImageList(images,'products/'+productId):await storeImageList(imageUrl?[imageUrl]:[],'products/'+productId);
      const storedImageUrl=storedImages[0]||'';
      const ageRestricted=b.ageRestricted===true?1:0;
      const sizePrices=await validateSizePrices(type,b.sizePrices,price);
      const ingredientIds=await validateProductIngredientIds(b.ingredientIds===undefined?[]:b.ingredientIds,type);
      const defaultIngredientIds=await validateProductIngredientIds(b.defaultIngredientIds===undefined?[]:b.defaultIngredientIds,type);
      const ingredientQuantities=await validateIngredientQuantities(b.ingredientQuantities,type,[...ingredientIds,...defaultIngredientIds]);
      if(isBuildYourOwnPizza({name,type})){const availableIds=new Set([...defaultIngredientIds,...ingredientIds]);if(defaultIngredientIds.length>3||availableIds.size<3)throw fail('Na pizza Monte a sua, cadastre até 3 ingredientes padrão e disponibilize ingredientes suficientes para completar exatamente 3 no total.',422);}
      await query(`INSERT INTO products (id,restaurant_id,category_id,name,description,type,base_price_cents,active,available,featured,prep_minutes,width_cm,depth_cm,height_cm,created_at,updated_at,cost_cents) VALUES ($1,$2,$3,$4,$5,$6,$7,1,1,0,$8,$9,$10,$11,$12,$12,$13)`,[productId,RESTAURANT_ID,categoryId,name,description,type,price,type==='drink'?0:25,type==='pizza'?30:12,type==='pizza'?30:12,type==='pizza'?2:10,now,costCents]);
      await query('UPDATE products SET ingredient_ids_json=$1,default_ingredient_ids_json=$2,ingredient_quantities_json=$3,ingredients_configured=$4,image_url=$5,product_images_json=$6,age_restricted=$7,size_prices_json=$8 WHERE id=$9 AND restaurant_id=$10',[JSON.stringify(ingredientIds),JSON.stringify(defaultIngredientIds),JSON.stringify(ingredientQuantities),b.ingredientIds!==undefined||b.defaultIngredientIds!==undefined?1:0,storedImageUrl,JSON.stringify(storedImages),ageRestricted,JSON.stringify(sizePrices),productId,RESTAURANT_ID]);
      return json(res,201,{product:(await catalogFor(true)).products.find(p=>p.id===productId)});
    }
    if (method==='DELETE'&&path.startsWith('/api/admin/products/')&&!path.endsWith('/3d')) {
      const product=(await query('SELECT id,name FROM products WHERE id=$1 AND restaurant_id=$2',[id,RESTAURANT_ID])).rows[0];
      if(!product) throw fail('Produto não encontrado.',404);
      const jobsTable=await query("SELECT to_regclass('public.product_3d_jobs') AS table_name");
      if(jobsTable.rows[0]?.table_name) await query('DELETE FROM product_3d_jobs WHERE product_id=$1 AND restaurant_id=$2',[id,RESTAURANT_ID]);
      const deleted=await query('DELETE FROM products WHERE id=$1 AND restaurant_id=$2 RETURNING id,name',[id,RESTAURANT_ID]);
      if(!deleted.rows[0]) throw fail('Produto não encontrado.',404);
      return json(res,200,{ok:true,product:deleted.rows[0],message:'Produto excluído. O histórico de pedidos foi preservado.'});
    }
    if (method==='PATCH'&&path.startsWith('/api/admin/products/')) {
      await query("ALTER TABLE products ADD COLUMN IF NOT EXISTS age_restricted INTEGER NOT NULL DEFAULT 0");
      await query("ALTER TABLE products ADD COLUMN IF NOT EXISTS size_prices_json TEXT NOT NULL DEFAULT '{}'");
      await query("ALTER TABLE products ADD COLUMN IF NOT EXISTS ingredient_quantities_json TEXT NOT NULL DEFAULT '{}'");
      const b=await bodyOf(req,2100000), old=(await query('SELECT * FROM products WHERE id=$1 AND restaurant_id=$2',[id,RESTAURANT_ID])).rows[0]; if(!old) throw fail('Produto não encontrado.',404);
      const images=b.images===undefined?null:b.images;
      if(images!==null&&(!Array.isArray(images)||images.length>8||images.some(url=>typeof url!=='string'||url.length>245000||(!isImageDataUrl(url)&&!isStoredImageUrl(url)))||images.reduce((sum,url)=>sum+url.length,0)>1950000)) throw fail('Envie até 8 fotos WebP comprimidas, com tamanho total reduzido.',422);
      const imageUrl=images!==null?(images[0]||''):(b.imageUrl===undefined?null:String(b.imageUrl));
      if(imageUrl!==null&&(imageUrl.length>245000||(imageUrl!==''&&!isImageDataUrl(imageUrl)&&!isStoredImageUrl(imageUrl)))) throw fail('Foto inválida ou muito grande. Escolha outra imagem.',422);
      const storedImages=images===null?null:await storeImageList(images,'products/'+id);
      const storedImageUrl=images===null?(imageUrl===null?null:await storeImageDataUrl(imageUrl,'products/'+id)):(storedImages[0]||'');
      const name=b.name===undefined?old.name:clean(b.name,80), description=b.description===undefined?old.description:clean(b.description,300), price=b.baseCents===undefined?Number(old.base_price_cents):Number(b.baseCents), active=b.active===undefined?Number(old.active):(b.active?1:0), available=b.available===undefined?Number(old.available):(b.available?1:0);
      const ingredientIds=b.ingredientIds===undefined?null:await validateProductIngredientIds(b.ingredientIds,old.type);
      const defaultIngredientIds=b.defaultIngredientIds===undefined?null:await validateProductIngredientIds(b.defaultIngredientIds,old.type);
      const currentIngredientIds=ingredientIds??JSON.parse(old.ingredient_ids_json||'[]');
      const currentDefaultIds=defaultIngredientIds??JSON.parse(old.default_ingredient_ids_json||'[]');
      const ingredientQuantities=b.ingredientQuantities===undefined?null:await validateIngredientQuantities(b.ingredientQuantities,old.type,[...currentIngredientIds,...currentDefaultIds]);
      if(isBuildYourOwnPizza({name,type:old.type})){let currentDefaults=[],currentAllowed=[];try{currentDefaults=JSON.parse(old.default_ingredient_ids_json||'[]')}catch{}try{currentAllowed=JSON.parse(old.ingredient_ids_json||'[]')}catch{}const defaults=defaultIngredientIds??currentDefaults,allowed=ingredientIds??currentAllowed,availableIds=new Set([...defaults,...allowed]);if(defaults.length>3||availableIds.size<3)throw fail('Na pizza Monte a sua, cadastre até 3 ingredientes padrão e disponibilize ingredientes suficientes para completar exatamente 3 no total.',422);}
      const ageRestricted=b.ageRestricted===undefined?Number(old.age_restricted||0):(b.ageRestricted?1:0);
      const costCents=b.costCents===undefined?Number(old.cost_cents||0):Number(b.costCents);
      if(!Number.isInteger(costCents)||costCents<0||costCents>1000000)throw fail('Informe um custo direto unitário válido.',422);
      const sizePrices=b.sizePrices===undefined?null:await validateSizePrices(old.type,b.sizePrices,price);
      if(name.length<2||!Number.isInteger(price)||price<(old.type==='drink'?1:500)||price>1000000) throw fail('Confira o nome e o preço do produto.',422);
      if(b.categoryId!==undefined){const category=(await query('SELECT id FROM categories WHERE id=$1 AND restaurant_id=$2',[clean(b.categoryId,50),RESTAURANT_ID])).rows[0];if(!category)throw fail('Escolha uma categoria válida.',422);await query('UPDATE products SET category_id=$1 WHERE id=$2 AND restaurant_id=$3',[category.id,id,RESTAURANT_ID]);}
      await query('UPDATE products SET name=$1,description=$2,base_price_cents=$3,active=$4,available=$5,ingredient_ids_json=COALESCE($6,ingredient_ids_json),default_ingredient_ids_json=COALESCE($7,default_ingredient_ids_json),ingredient_quantities_json=COALESCE($8,ingredient_quantities_json),ingredients_configured=CASE WHEN $9 THEN 1 ELSE ingredients_configured END,image_url=COALESCE($10,image_url),product_images_json=COALESCE($14,product_images_json),age_restricted=$15,size_prices_json=COALESCE($16,size_prices_json),cost_cents=$17,updated_at=$11 WHERE id=$12 AND restaurant_id=$13',[name,description,price,active,available,ingredientIds===null?null:JSON.stringify(ingredientIds),defaultIngredientIds===null?null:JSON.stringify(defaultIngredientIds),ingredientQuantities===null?null:JSON.stringify(ingredientQuantities),ingredientIds!==null||defaultIngredientIds!==null,storedImageUrl,new Date().toISOString(),id,RESTAURANT_ID,storedImages===null?null:JSON.stringify(storedImages),ageRestricted,sizePrices===null?null:JSON.stringify(sizePrices),costCents]);
      return json(res,200,{product:(await catalogFor(true)).products.find(p=>p.id===id)});
    }
    if (method==='POST'&&path==='/api/admin/ingredients') {
      const b=await bodyOf(req),name=clean(b.name,80),types=[...new Set((Array.isArray(b.types)?b.types:[b.type]).map(value=>clean(value,20)))],groupName=clean(b.groupName,50)||'Adicionais',price=Number(b.cents);
      if(name.length<2||!types.length||types.some(type=>!['pizza','burger','plate'].includes(type))||!Number.isInteger(price)||price<0||price>999999) throw fail('Informe nome, tipos de alimento e preço válido para o ingrediente.',422);
      const existing=(await query('SELECT id,name,type FROM ingredients WHERE restaurant_id=$1',[RESTAURANT_ID])).rows;
      const normalizeIngredientName=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toLocaleLowerCase('pt-BR');
      const duplicate=existing.find(item=>types.includes(item.type)&&normalizeIngredientName(item.name)===normalizeIngredientName(name));
      if(duplicate) throw fail('Já existe "'+duplicate.name+'" cadastrado para '+({pizza:'pizza',burger:'hambúrguer',plate:'hot dog'}[duplicate.type])+'. Não é permitido repetir o ingrediente dentro do mesmo tipo.',409);
      const created=[];
      for(const type of types){
        const id=slugify(name)+'-'+randomBytes(4).toString('hex');
        const orderResult=await query('SELECT COALESCE(MAX(sort_order),-1)+1 AS next_order FROM ingredients WHERE restaurant_id=$1',[RESTAURANT_ID]);
        await query('INSERT INTO ingredients (id,restaurant_id,name,type,group_name,addon_cents,included_by_default,active,sort_order) VALUES ($1,$2,$3,$4,$5,$6,0,1,$7)',[id,RESTAURANT_ID,name,type,groupName,price,Number(orderResult.rows[0]?.next_order)||0]);
        created.push(id);
      }
      const updated=await catalogFor(true),createdIngredients=updated.ingredients.filter(item=>created.includes(item.id));
      return json(res,201,{ingredients:createdIngredients,ingredient:createdIngredients[0]||null});
    }
    if (method==='DELETE'&&path.startsWith('/api/admin/ingredients/')) {
      const found=(await query('SELECT id,name FROM ingredients WHERE id=$1 AND restaurant_id=$2',[id,RESTAURANT_ID])).rows[0];
      if(!found) throw fail('Ingrediente não encontrado.',404);
      await query('DELETE FROM ingredients WHERE id=$1 AND restaurant_id=$2',[id,RESTAURANT_ID]);
      return json(res,200,{ok:true,ingredient:found,message:'Ingrediente excluído. O histórico de pedidos foi preservado.'});
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
      const c=await customer(req), order=await createOrder(b,c?.customer||null);
      return json(res,201,{order,trackingUrl:'/#pedido/'+order.trackingToken});
    }
    if (method==='POST'&&path.startsWith('/api/tracking/')&&path.endsWith('/cancel')) {
      const token=path.slice('/api/tracking/'.length).replace(/\/cancel$/,'');
      if(!/^[A-Za-z0-9_-]{32,80}$/.test(token)) throw fail('Pedido não encontrado.',404);
      const found=(await query('SELECT id,customer_id AS "customerId" FROM orders WHERE tracking_token=$1 AND restaurant_id=$2',[token,RESTAURANT_ID])).rows[0];
      if(!found) throw fail('Pedido não encontrado.',404);
      const c=await customer(req);
      if(found.customerId&&(!c||c.customerId!==found.customerId)) throw fail('Pedido não encontrado.',404);
      const retry=await limit(req,'customer-order-cancel:'+found.id,3,3600000);
      if(retry) return json(res,429,{error:'Muitas tentativas de cancelamento. Aguarde antes de tentar novamente.'},{'Retry-After':String(retry)});
      return json(res,200,{order:await cancelOrderByCustomer(found.id)});
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
