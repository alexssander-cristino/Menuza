import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('integração: consentimento de ofertas aparece no painel e controla cupons; pontos são creditados ao concluir pedido', async t => {
  const projectDir = fileURLToPath(new URL('..', import.meta.url));
  const tempDir = await mkdtemp(join(tmpdir(), 'menuza-customer-growth-'));
  const databaseFile = join(tempDir, 'integration.sqlite');
  const port = 20000 + Math.floor(Math.random() * 20000);
  const base = 'http://127.0.0.1:' + port;
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: projectDir,
    env: { ...process.env, PORT: String(port), DATA_FILE: databaseFile, ADMIN_PASSWORD: 'integration-pass', APP_SECRET: 'integration-secret-at-least-32-characters-long' },
    stdio: 'ignore'
  });
  const stop = () => new Promise(resolve => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', resolve);
    child.kill('SIGTERM');
    setTimeout(resolve, 1500).unref();
  });
  t.after(async () => { await stop(); await rm(tempDir, { recursive: true, force: true }); });

  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    try { ready = (await fetch(base + '/api/health')).ok; if (ready) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(ready, true, 'isolated local server starts');

  const headers = { 'content-type': 'application/json', Origin: base };
  const register = async (email, marketingConsent) => {
    const response = await fetch(base + '/api/customer/register', {
      method: 'POST', headers,
      body: JSON.stringify({ name: 'Cliente Teste', email, phone: '47999990000', birthDate: '1995-04-10', password: 'senha-integration-123', marketingConsent })
    });
    assert.equal(response.status, 201);
    return { body: await response.json(), cookie: response.headers.get('set-cookie').split(';')[0] };
  };

  const optedIn = await register('consentiu@example.test', true);
  const optedOut = await register('nao-consentiu@example.test', false);
  assert.equal(optedIn.body.customer.marketingConsent, true);
  assert.equal(optedOut.body.customer.marketingConsent, false);

  const login = await fetch(base + '/api/admin/login', { method: 'POST', headers, body: JSON.stringify({ password: 'integration-pass' }) });
  assert.equal(login.status, 200);
  const adminCookie = login.headers.get('set-cookie').split(';')[0];
  const adminHeaders = { cookie: adminCookie };
  const panelResponse = await fetch(base + '/api/admin/customers/retention', { headers: adminHeaders });
  assert.equal(panelResponse.status, 200);
  let customers = (await panelResponse.json()).customers;
  assert.equal(customers.length, 2, 'the restaurant panel lists active and inactive registered customers');
  assert.equal(customers.find(customer => customer.email === 'consentiu@example.test').marketingConsent, true);
  assert.equal(customers.find(customer => customer.email === 'nao-consentiu@example.test').marketingConsent, false);

  const deniedCoupon = await fetch(base + '/api/admin/customers/' + optedOut.body.customer.id + '/coupon', {
    method: 'POST', headers: { ...headers, ...adminHeaders }, body: JSON.stringify({ discountPercent: 10 })
  });
  assert.equal(deniedCoupon.status, 403, 'the restaurant cannot create a promotional coupon without consent');

  const allowedCoupon = await fetch(base + '/api/admin/customers/' + optedIn.body.customer.id + '/coupon', {
    method: 'POST', headers: { ...headers, ...adminHeaders }, body: JSON.stringify({ discountPercent: 10 })
  });
  assert.equal(allowedCoupon.status, 201, 'a promotional coupon can be created with explicit consent');

  const revoke = await fetch(base + '/api/customer/marketing-consent', {
    method: 'PATCH', headers: { ...headers, cookie: optedIn.cookie }, body: JSON.stringify({ enabled: false })
  });
  assert.equal(revoke.status, 200);
  assert.equal((await revoke.json()).marketingConsent, false);
  customers = (await (await fetch(base + '/api/admin/customers/retention', { headers: adminHeaders })).json()).customers;
  assert.equal(customers.find(customer => customer.email === 'consentiu@example.test').marketingConsent, false, 'the panel reflects consent withdrawal');
  const deniedAfterRevoke = await fetch(base + '/api/admin/customers/' + optedIn.body.customer.id + '/coupon', {
    method: 'POST', headers: { ...headers, ...adminHeaders }, body: JSON.stringify({ discountPercent: 10 })
  });
  assert.equal(deniedAfterRevoke.status, 403, 'withdrawn consent blocks future promotional coupons');

  const orderPayload = {
    customerName: 'Cliente Teste', phone: '47999990000', fulfillment: 'pickup', note: '',
    idempotencyKey: 'loyalty-integration-order-001',
    items: [{ productId: 'pizza-calabresa', quantity: 1, sizeKey: 'grande', crustKey: 'tradicional',
      ingredients: [{ id: 'molho-tomate' }, { id: 'mussarela' }, { id: 'calabresa' }, { id: 'bacon' }] }]
  };
  const orderResponse = await fetch(base + '/api/orders', {
    method: 'POST', headers: { ...headers, cookie: optedIn.cookie }, body: JSON.stringify(orderPayload)
  });
  assert.equal(orderResponse.status, 201);
  const order = (await orderResponse.json()).order;
  for (const status of ['confirmed', 'preparing', 'ready', 'completed']) {
    const response = await fetch(base + '/api/admin/orders/' + encodeURIComponent(order.id), {
      method: 'PATCH', headers: { ...headers, ...adminHeaders }, body: JSON.stringify({ status })
    });
    assert.equal(response.status, 200, 'order transition to ' + status);
  }
  const pointsResponse = await fetch(base + '/api/customer/loyalty', { headers: { cookie: optedIn.cookie } });
  assert.equal(pointsResponse.status, 200);
  const points = await pointsResponse.json();
  assert.equal(points.points, 70, 'completed order credits one point per real spent');
  assert.equal(points.rewardPoints, 1000, 'the reward threshold remains 1,000 points');

  const repeatedCompletion = await fetch(base + '/api/admin/orders/' + encodeURIComponent(order.id), {
    method: 'PATCH', headers: { ...headers, ...adminHeaders }, body: JSON.stringify({ status: 'completed' })
  });
  assert.equal(repeatedCompletion.status, 200);
  const pointsAfterRepeat = await (await fetch(base + '/api/customer/loyalty', { headers: { cookie: optedIn.cookie } })).json();
  assert.equal(pointsAfterRepeat.points, 70, 'repeating completion never credits the same order twice');

  const insufficientRedemption = await fetch(base + '/api/customer/loyalty/redeem', {
    method: 'POST', headers: { ...headers, cookie: optedIn.cookie }, body: JSON.stringify({})
  });
  assert.equal(insufficientRedemption.status, 422, 'redemption is blocked below 1,000 points');
});
