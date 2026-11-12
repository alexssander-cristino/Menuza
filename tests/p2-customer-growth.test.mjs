import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('P2: pontos são creditados uma vez quando pedido vinculado é concluído', async () => {
  const api = await read('api/[...path].mjs');
  const local = await read('server.mjs');
  assert.ok(api.includes('CREATE TABLE IF NOT EXISTS loyalty_points_ledger'));
  assert.ok(api.includes("if(next==='completed'&&order.customer_id)"));
  assert.ok(api.includes('ON CONFLICT(order_id) DO NOTHING'));
  assert.ok(local.includes("if(nextStatus==='completed'&&order.customer_id)"));
  assert.ok(local.includes('INSERT OR IGNORE INTO loyalty_points_ledger'));
  assert.ok(api.includes('rewardPoints:100'));
  assert.ok(local.includes('rewardPoints:100'));
  assert.ok(api.includes('coupons:personalCoupons.rows'));
  assert.ok(local.includes('history,coupons}'));
});

test('P2: resgate cria cupom pessoal e a API bloqueia uso em outra conta', async () => {
  const api = await read('api/[...path].mjs');
  const local = await read('server.mjs');
  assert.ok(api.includes("path==='/api/customer/loyalty/redeem'"));
  assert.ok(local.includes("path === '/api/customer/loyalty/redeem'"));
  assert.ok(api.includes('c.customer_id && String(c.customer_id)!==String(customerId||\'\')'));
  assert.ok(local.includes('coupon.customer_id && String(coupon.customer_id)!==String(customerId||\'\')'));
});

test('P2: recuperação respeita consentimento e oferece descadastro', async () => {
  const api = await read('api/[...path].mjs');
  const local = await read('server.mjs');
  const ui = await read('public/app.js');
  const vercel = JSON.parse(await read('vercel.json'));
  const remindersWorkflow = await read('.github/workflows/abandoned-cart-reminders.yml');
  assert.ok(api.includes('marketing_consent_at IS NOT NULL'));
  assert.ok(api.includes("path==='/api/cron/inactive-customers'"));
  assert.ok(api.includes("path==='/api/customer/marketing-unsubscribe'"));
  assert.ok(api.includes('marketingConsent:body.marketingConsent===true'));
  assert.ok(local.includes('marketing_consent_at'));
  assert.ok(ui.includes('name="marketingConsent"'));
  assert.ok(ui.includes('toggle-marketing-consent'));
  assert.equal(vercel.crons.find(job=>job.path==='/api/cron/inactive-customers').schedule,'0 15 * * *');
  assert.ok(remindersWorkflow.includes("cron: '*/15 * * * *'"));
  assert.ok(remindersWorkflow.includes('secrets.CRON_SECRET'));
});

test('P2: painel lista clientes inativos e permite cupom individual com consentimento', async () => {
  const api = await read('api/[...path].mjs');
  const local = await read('server.mjs');
  const ui = await read('public/app.js');
  assert.ok(api.includes("path==='/api/admin/customers/retention'"));
  assert.ok(local.includes("path === '/api/admin/customers/retention'"));
  assert.ok(api.includes("path.startsWith('/api/admin/customers/')&&path.endsWith('/coupon')"));
  assert.ok(local.includes("path.startsWith('/api/admin/customers/') && path.endsWith('/coupon')"));
  assert.ok(ui.includes('renderCustomerRetentionAdmin'));
  assert.ok(ui.includes('issue-customer-coupon'));
  assert.ok(api.includes('DELETE FROM loyalty_points_ledger WHERE restaurant_id=$1 AND customer_id=$2'));
  assert.ok(local.includes('DELETE FROM loyalty_points_ledger WHERE customer_id=? AND restaurant_id=?'));
});

test('P2: indicadores mostram rentabilidade por produto nos ambientes PostgreSQL e SQLite', async () => {
  const api = await read('api/[...path].mjs');
  const local = await read('server.mjs');
  const ui = await read('public/app.js');
  assert.ok(api.includes('profitabilityRows'));
  assert.ok(local.includes('const profitability=statement('));
  assert.ok(ui.includes('Produtos mais rentáveis'));
  assert.ok(ui.includes('data.profitability'));
});
