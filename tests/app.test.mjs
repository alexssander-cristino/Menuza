import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculateItemPrice, makeSeed, INGREDIENTS } from '../src/catalog.mjs';
import { buildFoodGeometry } from '../public/food-scene.js';

test('pizza calcula tamanho e adicionais sem confiar em preço do cliente', () => {
  const pizza = { type: 'pizza', baseCents: 4990 };
  const priced = calculateItemPrice({
    product: pizza, sizeKey: 'grande', crustKey: 'tradicional', quantity: 1,
    ingredients: [{ id: 'molho-tomate' }, { id: 'mussarela' }, { id: 'calabresa' }, { id: 'bacon' }]
  });
  assert.equal(priced.unitPriceCents, 7070);
  const removedCalabresa = calculateItemPrice({
    product: pizza, sizeKey: 'grande', crustKey: 'tradicional',
    ingredients: [{ id: 'molho-tomate' }, { id: 'mussarela' }, { id: 'bacon' }]
  });
  assert.equal(removedCalabresa.unitPriceCents, 6580);
  assert.equal(removedCalabresa.ingredients.some(item => item.id === 'calabresa'), false);
  assert.equal(removedCalabresa.ingredients.some(item => item.id === 'bacon'), true);
});

test('hambúrguer valida tamanho, porções e composição', () => {
  const burger = { type: 'burger', baseCents: 3290 };
  const priced = calculateItemPrice({
    product: burger, sizeKey: 'duplo', ingredients: [{ id: 'pao-brioche' }, { id: 'carne' }, { id: 'queijo-cheddar' }, { id: 'bacon-burger', quantity: 2 }]
  });
  assert.equal(priced.unitPriceCents, 5290);
  assert.throws(() => calculateItemPrice({ product: burger, sizeKey: 'duplo', ingredients: [{ id: 'bacon-burger', quantity: 4 }] }), /1 a 3/);
  assert.throws(() => calculateItemPrice({ product: burger, sizeKey: 'duplo', ingredients: [{ id: 'calabresa' }] }), /não está disponível/);
});

test('o catálogo de demonstração tem tenants, categorias, produtos e recursos AR vazios', () => {
  const seed = makeSeed('2026-01-01T00:00:00.000Z');
  assert.equal(seed.restaurant.id, 'rest-bela-mesa');
  assert.ok(seed.categories.length >= 3);
  assert.ok(seed.products.some(product => product.type === 'pizza'));
  assert.ok(seed.products.some(product => product.type === 'burger'));
  assert.ok(seed.products.every(product => product.modelUrl === null));
});

test('API persiste composição, valida no servidor, protege painel e recupera após reinício', async t => {
  const projectDir = fileURLToPath(new URL('..', import.meta.url));
  const tempDir = await mkdtemp(join(tmpdir(), 'mesa-studio-'));
  const databaseFile = join(tempDir, 'test.sqlite');
  const port = 17000 + Math.floor(Math.random() * 20000);
  const base = 'http://localhost:' + port;
  const startServer = () => {
    const child = spawn(process.execPath, ['server.mjs'], {
      cwd: projectDir,
      env: { ...process.env, PORT: String(port), DATA_FILE: databaseFile, ADMIN_PASSWORD: 'test-pass', APP_SECRET: 'test-secret-for-api-suite' },
      stdio: 'ignore'
    });
    return child;
  };
  const stopServer = child => new Promise(resolve => {
    if (!child || child.exitCode !== null) return resolve();
    child.once('exit', resolve);
    child.kill('SIGTERM');
    setTimeout(resolve, 1000).unref();
  });
  let child = startServer();
  t.after(async () => { await stopServer(child); await rm(tempDir, { recursive: true, force: true }); });
  let ready = false; let lastError = "";
  for (let attempt = 0; attempt < 100; attempt++) {
    try { ready = (await fetch(base + '/api/health')).ok; if (ready) break; } catch (e) { lastError = e.message; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(ready, true, 'server became ready: ' + lastError + ' exit=' + child.exitCode + ' url=' + base);
  const sameOrigin = { Origin: base };
  const registration = await fetch(base + '/api/customer/register', { method: 'POST', headers: { 'content-type': 'application/json', ...sameOrigin }, body: JSON.stringify({ name: 'Joana Silva', email: 'joana@example.test', phone: '11999999999', password: 'senha-teste-123' }) });
  assert.equal(registration.status, 201);
  const customerCookie = registration.headers.get('set-cookie').split(';')[0];
  const catalogResponse = await fetch(base + '/api/catalog', { headers: { cookie: customerCookie } });
  const catalog = await catalogResponse.json();
  assert.equal(catalog.products.length, 6);
  assert.equal((await fetch(base + '/api/admin/orders')).status, 401);

  const orderPayload = {
    customerName: 'Joana Silva', phone: '11999999999', fulfillment: 'pickup', note: 'Sem pressa',
    idempotencyKey: 'integration-test-key-001',
    items: [{
      productId: 'pizza-calabresa', quantity: 1, sizeKey: 'grande', crustKey: 'tradicional',
      ingredients: [{ id: 'molho-tomate' }, { id: 'mussarela' }, { id: 'calabresa' }, { id: 'bacon' }],
      unitPriceCents: 1
    }]
  };
  const orderResponse = await fetch(base + '/api/orders', { method: 'POST', headers: { 'content-type': 'application/json', ...sameOrigin, cookie: customerCookie }, body: JSON.stringify(orderPayload) });
  assert.equal(orderResponse.status, 201);
  const created = (await orderResponse.json()).order;
  assert.equal(created.totalCents, 7070);
  assert.equal(created.items[0].ingredients.length, 4);
  assert.equal(created.items[0].snapshot.size.diameterCm, 35);

  const loginResponse = await fetch(base + '/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json', ...sameOrigin }, body: JSON.stringify({ password: 'test-pass' }) });
  assert.equal(loginResponse.status, 200);
  const cookie = loginResponse.headers.get('set-cookie').split(';')[0];
  const adminOrders = await fetch(base + '/api/admin/orders', { headers: { cookie } });

  const couponResponse = await fetch(base + '/api/admin/coupons', { method: 'POST', headers: { 'content-type': 'application/json', ...sameOrigin, cookie }, body: JSON.stringify({ code: 'SAVE10', discountType: 'percent', discountValue: 10, minimumSubtotalCents: 5000, maxUses: 1, active: true }) });
  assert.equal(couponResponse.status, 201);
  const couponItems = orderPayload.items;
  const couponValidation = await fetch(base + '/api/coupons/validate', { method: 'POST', headers: { 'content-type': 'application/json', ...sameOrigin, cookie: customerCookie }, body: JSON.stringify({ code: ' SAVE 10 ', items: couponItems }) });
  assert.equal(couponValidation.status, 200);
  const validatedCoupon = await couponValidation.json();
  assert.equal(validatedCoupon.code, 'SAVE10');
  assert.equal(validatedCoupon.subtotalCents, 7070);
  assert.equal(validatedCoupon.discountCents, 707);
  const discountedOrderResponse = await fetch(base + '/api/orders', { method: 'POST', headers: { 'content-type': 'application/json', ...sameOrigin, cookie: customerCookie }, body: JSON.stringify({ ...orderPayload, idempotencyKey: 'integration-coupon-key-002', couponCode: 'SAVE10' }) });
  assert.equal(discountedOrderResponse.status, 201);
  const discountedOrder = (await discountedOrderResponse.json()).order;
  assert.equal(discountedOrder.totalCents, 6363);
  assert.equal(discountedOrder.discountCents, 707);
  assert.equal(discountedOrder.couponCode, 'SAVE10');
  const repeatedDiscountedOrderResponse = await fetch(base + '/api/orders', { method: 'POST', headers: { 'content-type': 'application/json', ...sameOrigin, cookie: customerCookie }, body: JSON.stringify({ ...orderPayload, idempotencyKey: 'integration-coupon-key-002', couponCode: 'SAVE10' }) });
  assert.equal(repeatedDiscountedOrderResponse.status, 201);
  assert.equal((await repeatedDiscountedOrderResponse.json()).order.id, discountedOrder.id);
  const exhaustedCoupon = await fetch(base + '/api/coupons/validate', { method: 'POST', headers: { 'content-type': 'application/json', ...sameOrigin, cookie: customerCookie }, body: JSON.stringify({ code: 'SAVE10', items: couponItems }) });
  assert.equal(exhaustedCoupon.status, 422);
  assert.match((await exhaustedCoupon.json()).error, /limite de utilizações/);
  assert.equal(adminOrders.status, 200);
  assert.equal((await adminOrders.json()).orders[0].items[0].ingredients[3].name, 'Bacon crocante');
  const newProductResponse = await fetch(base + '/api/admin/products', { method: 'POST', headers: { 'content-type': 'application/json', ...sameOrigin, cookie }, body: JSON.stringify({ name: 'Pão de alho da casa', categoryId: 'acompanhamentos', type: 'plate', baseCents: 2500, description: 'Alho assado e ervas.' }) });
  assert.equal(newProductResponse.status, 201);
  const newProduct = (await newProductResponse.json()).product;
  assert.equal(newProduct.name, 'Pão de alho da casa');
  const priceUpdate = await fetch(base + '/api/admin/products/pizza-calabresa', { method: 'PATCH', headers: { 'content-type': 'application/json', ...sameOrigin, cookie }, body: JSON.stringify({ baseCents: 5400 }) });
  assert.equal((await priceUpdate.json()).product.baseCents, 5400);
  const toppingUpdate = await fetch(base + '/api/admin/ingredients/bacon', { method: 'PATCH', headers: { 'content-type': 'application/json', ...sameOrigin, cookie }, body: JSON.stringify({ cents: 620 }) });
  assert.equal((await toppingUpdate.json()).ingredient.cents, 620);
  const changedCatalog = await (await fetch(base + '/api/catalog', { headers: { cookie: customerCookie } })).json();
  assert.equal(changedCatalog.products.find(product => product.id === 'pizza-calabresa').baseCents, 5400);
  assert.equal(changedCatalog.ingredients.find(ingredient => ingredient.id === 'bacon').cents, 620);
  const stableSnapshot = (await (await fetch(base + '/api/tracking/' + created.trackingToken, { headers: { cookie: customerCookie } })).json()).order;
  assert.equal(stableSnapshot.totalCents, 7070);
  assert.equal(stableSnapshot.items[0].ingredients.find(ingredient => ingredient.id === 'bacon').unitPriceCents, 590);

  const repeated = await fetch(base + '/api/orders', { method: 'POST', headers: { 'content-type': 'application/json', ...sameOrigin, cookie: customerCookie }, body: JSON.stringify({ ...orderPayload, customerName: 'Alterado', items: orderPayload.items }) });
  const repeatedBody = await repeated.json(); assert.equal(repeatedBody.order?.id, created.id, JSON.stringify(repeatedBody));

  const liveResponse = await fetch(base + '/api/admin/events', { headers: { cookie } });
  assert.equal(liveResponse.status, 200);
  const liveReader = liveResponse.body.getReader();
  await liveReader.read();
  const updateResponse = await fetch(base + '/api/admin/orders/' + encodeURIComponent(created.id), { method: 'PATCH', headers: { 'content-type': 'application/json', ...sameOrigin, cookie }, body: JSON.stringify({ status: 'confirmed' }) });
  assert.equal((await updateResponse.json()).order.status, 'confirmed');
  const eventChunk = await liveReader.read();
  assert.match(new TextDecoder().decode(eventChunk.value), /order-updated/);
  await liveReader.cancel();
  assert.equal((await (await fetch(base + '/api/tracking/' + created.trackingToken)).json()).order.history.length, 2);

  await stopServer(child);
  child = startServer();
  let restarted = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { restarted = (await fetch(base + '/api/health')).ok; if (restarted) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(restarted, true, 'server restarted with same database');
  const recovered = await fetch(base + '/api/tracking/' + created.trackingToken, { headers: { cookie: customerCookie } });
  assert.equal(recovered.status, 200);
  assert.equal((await recovered.json()).order.status, 'confirmed');
});










test('modelo 3D de pizza respeita o tamanho e a quantidade de ingredientes', () => {
  const pizza = { id:'pizza-calabresa', type:'pizza', widthCm:30, depthCm:30, heightCm:2 };
  const toppings = [{ id:'molho-tomate', quantity:1 }, { id:'mussarela', quantity:1 }, { id:'calabresa', quantity:1 }]
    .map(entry => ({ ...INGREDIENTS.find(item => item.id === entry.id), quantity:entry.quantity }));
  const small = buildFoodGeometry(pizza, toppings, { key:'individual', diameterCm:20 });
  const large = buildFoodGeometry(pizza, toppings, { key:'familia', diameterCm:40 });
  const doubleTopping = buildFoodGeometry(pizza, toppings.map(item => item.id === 'calabresa' ? { ...item, quantity:2 } : item), { key:'individual', diameterCm:20 });
  assert.equal(small.bounds[0], .2);
  assert.equal(small.bounds[2], .2);
  assert.equal(large.bounds[0], .4);
  assert.ok(doubleTopping.geometry.positions.length > small.geometry.positions.length);
});

test('modelo 3D do hambúrguer muda a composição conforme os adicionais e tamanho', () => {
  const burger = { id:'burger-casa', type:'burger', widthCm:12, depthCm:12, heightCm:10 };
  const base = ['pao-brioche','carne','queijo-cheddar','alface','tomate-burger','molho-especial']
    .map(id => ({ ...INGREDIENTS.find(item => item.id === id), quantity:1 }));
  const classic = buildFoodGeometry(burger, base, { key:'classico' });
  const double = buildFoodGeometry(burger, base, { key:'duplo' });
  const withBacon = buildFoodGeometry(burger, [...base,{...INGREDIENTS.find(item=>item.id==='bacon-burger'),quantity:2}], { key:'duplo' });
  assert.equal(classic.bounds[1], .1);
  assert.ok(double.geometry.positions.length > classic.geometry.positions.length);
  assert.ok(withBacon.geometry.positions.length > double.geometry.positions.length);
});
