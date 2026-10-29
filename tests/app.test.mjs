import test from 'node:test';
import { formatOrderStatusTime } from '../public/order-status-time.js';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculateItemPrice, makeSeed, INGREDIENTS } from '../src/catalog.mjs';
import { restaurantLocalDatePrefix } from '../src/time.mjs';
import { buildFoodGeometry } from '../public/food-scene.js';

test('dashboard usa a data local do restaurante em vez do dia UTC do servidor', () => {
  assert.equal(restaurantLocalDatePrefix(new Date('2026-10-28T02:00:00.000Z')), '2026-10-27');
  assert.equal(restaurantLocalDatePrefix(new Date('2026-10-28T04:00:00.000Z')), '2026-10-28');
});

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

test('timeline do pedido mostra o horário real de cada mudança de status', () => {
  const history = [
    { status: 'received', changedAt: '2026-10-28T12:05:00.000Z' },
    { status: 'preparing', changedAt: '2026-10-28T12:12:00.000Z' },
    { status: 'ready', changedAt: '2026-10-28T12:25:00.000Z' }
  ];
  assert.match(formatOrderStatusTime(history, 'received'), /09:05/);
  assert.match(formatOrderStatusTime(history, 'preparing'), /09:12/);
  assert.equal(formatOrderStatusTime(history, 'confirmed'), '');
  assert.equal(formatOrderStatusTime([{ status: 'ready', changedAt: 'invalid' }], 'ready'), '');
});

test('checkout mantém a chave idempotente após recarregar e invalida quando o carrinho muda', async () => {
  const client = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.ok(client.includes("sessionStorage.getItem('menuza-checkout-key')"), 'checkout key is restored from the current browser session');
  assert.ok(client.includes("sessionStorage.setItem('menuza-checkout-key',JSON.stringify({key:app.checkoutKey,fingerprint}))"), 'checkout key is stored with the cart fingerprint');
  assert.ok(client.includes("savedCheckout.fingerprint !== serializedCart"), 'a changed cart invalidates the previous checkout key');
  assert.ok(client.includes("sessionStorage.removeItem('menuza-checkout-key')"), 'successful or invalidated checkout clears persisted idempotency data');
});

test('visitante sem sessão é direcionado ao login antes de acessar o cardápio', async () => {
  const client = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.ok(client.includes("if(!app.customer){history.replaceState(null,'',location.pathname+location.search+'#conta');return showCustomerAccount()}return openMenu()"), 'route changes must not bypass the login gate');
  assert.ok(client.includes("const firstRoute='conta'"), 'new visitors open customer login by default');
  assert.ok(client.includes("if(initialHash==='admin')"), 'stale admin URLs are redirected to customer login on initial visit');
  assert.ok(client.includes("if(hash==='admin')return showAdmin()"), 'restaurant login remains independently accessible');
  assert.ok(client.includes("if(hash==='conta')return showCustomerAccount()"), 'customer login and account remain accessible');
  assert.ok(client.includes("'/api/customer/me'"), 'session is validated by the server cookie, not a client-side flag');
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
  const legalPages = [
    ['/politica-de-privacidade.html', 'Política de privacidade'],
    ['/termos-de-uso.html', 'Termos de uso'],
    ['/politica-de-cookies.html', 'Política de cookies'],
    ['/contato.html', 'Contato e suporte'],
    ['/acessibilidade.html', 'Declaração de acessibilidade']
  ];
  for (const [path, title] of legalPages) {
    const legalResponse = await fetch(base + path);
    assert.equal(legalResponse.status, 200, path + ' is served publicly');
    assert.match(await legalResponse.text(), new RegExp(title, 'i'));
  }
  const privacySubmission = await fetch(base + '/api/privacy-requests', { method: 'POST', headers: { 'content-type': 'application/json', Origin: base }, body: JSON.stringify({ name: 'Joana Silva', email: 'joana@example.test', requestType: 'access', details: 'Solicito acesso aos dados associados ao meu cadastro.' }) });
  assert.equal(privacySubmission.status, 201);
  const privacyTicket = await privacySubmission.json();
  assert.match(privacyTicket.id, /^pr_/);
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
  assert.equal(created.prepMinutes, catalog.restaurant.prepMinutes, 'tracking response includes the restaurant preparation estimate');
  assert.equal(created.items[0].ingredients.length, 4);
  assert.equal(created.items[0].snapshot.size.diameterCm, 35);

  const loginResponse = await fetch(base + '/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json', ...sameOrigin }, body: JSON.stringify({ password: 'test-pass' }) });
  assert.equal(loginResponse.status, 200);
  const cookie = loginResponse.headers.get('set-cookie').split(';')[0];
  const privacyListResponse = await fetch(base + '/api/admin/privacy-requests', { headers: { cookie } });
  assert.equal(privacyListResponse.status, 200);
  const privacyList = await privacyListResponse.json();
  assert.equal(privacyList.requests.length, 1);
  assert.equal(privacyList.requests[0].id, privacyTicket.id);
  const privacyStatusResponse = await fetch(base + '/api/admin/privacy-requests/' + privacyTicket.id, { method: 'PATCH', headers: { 'content-type': 'application/json', ...sameOrigin, cookie }, body: JSON.stringify({ status: 'in_progress' }) });
  assert.equal(privacyStatusResponse.status, 200);
  const adminOrders = await fetch(base + '/api/admin/orders', { headers: { cookie } });
  const tablesUnauthenticated = await fetch(base + '/api/admin/tables');
  assert.equal(tablesUnauthenticated.status, 401, 'table API requires an admin session');
  const dashboardResponse = await fetch(base + '/api/admin/dashboard', { headers: { cookie } });
  assert.equal(dashboardResponse.status, 200);
  const dashboardMetrics = await dashboardResponse.json();
  assert.ok(dashboardMetrics.ordersToday >= 1, 'dashboard counts orders created today');
  assert.ok(dashboardMetrics.averageTicketCents > 0, 'dashboard calculates the average ticket excluding cancelled orders');
  assert.ok(Number.isInteger(dashboardMetrics.prepMinutes) && dashboardMetrics.prepMinutes > 0, 'dashboard exposes the configured preparation estimate for kitchen queue timers');
  const tableListResponse = await fetch(base + '/api/admin/tables', { headers: { cookie } });
  assert.equal(tableListResponse.status, 200);
  const tableList = await tableListResponse.json();
  assert.equal(tableList.tables.length, 12, 'restaurant initializes twelve persistent tables');
  assert.equal(tableList.counts.free, 12);
  const tableStatusResponse = await fetch(base + '/api/admin/tables/table-1', { method: 'PATCH', headers: { 'content-type': 'application/json', ...sameOrigin, cookie }, body: JSON.stringify({ status: 'occupied' }) });
  assert.equal(tableStatusResponse.status, 200);
  assert.equal((await tableStatusResponse.json()).table.status, 'occupied');
  const invalidTableStatus = await fetch(base + '/api/admin/tables/table-1', { method: 'PATCH', headers: { 'content-type': 'application/json', ...sameOrigin, cookie }, body: JSON.stringify({ status: 'broken' }) });
  assert.equal(invalidTableStatus.status, 422);
  const tableCountsAfterUpdate = await (await fetch(base + '/api/admin/tables', { headers: { cookie } })).json();
  assert.equal(tableCountsAfterUpdate.counts.occupied, 1);
  assert.equal(tableCountsAfterUpdate.counts.free, 11);
  assert.equal((await fetch(base + '/api/tables/available')).status, 401, 'free table list requires a customer session');
  const availableTablesResponse = await fetch(base + '/api/tables/available', { headers: { cookie: customerCookie } });
  assert.equal(availableTablesResponse.status, 200);
  const availableTables = (await availableTablesResponse.json()).tables;
  assert.ok(availableTables.some(table => table.number === 2), 'checkout only receives free tables');
  assert.ok(!availableTables.some(table => table.number === 1), 'occupied tables are not offered at checkout');
  const dineInResponse = await fetch(base + '/api/orders', { method: 'POST', headers: { 'content-type': 'application/json', ...sameOrigin, cookie: customerCookie }, body: JSON.stringify({ ...orderPayload, fulfillment: 'table', tableLabel: '2', idempotencyKey: 'integration-table-order-002' }) });
  assert.equal(dineInResponse.status, 201, 'checkout can submit a table order for a free table');
  const dineInOrder = (await dineInResponse.json()).order;
  assert.equal(dineInOrder.fulfillment, 'table');
  assert.equal(dineInOrder.tableLabel, '2');
  const tablesAfterCheckout = await (await fetch(base + '/api/admin/tables', { headers: { cookie } })).json();
  assert.equal(tablesAfterCheckout.tables.find(table => table.number === 2).status, 'occupied', 'successful table checkout reserves the selected table');
  assert.equal(tablesAfterCheckout.counts.occupied, 2);
  assert.equal(tablesAfterCheckout.counts.free, 10);
  const prematureTableRelease = await fetch(base + '/api/admin/tables/table-2', { method: 'PATCH', headers: { 'content-type': 'application/json', ...sameOrigin, cookie }, body: JSON.stringify({ status: 'free' }) });
  assert.equal(prematureTableRelease.status, 409, 'a table with an active dine-in order cannot be released for another customer');
  assert.match((await prematureTableRelease.json()).error, /pedido em andamento/);
  const duplicateTableBooking = await fetch(base + '/api/orders', { method: 'POST', headers: { 'content-type': 'application/json', ...sameOrigin, cookie: customerCookie }, body: JSON.stringify({ ...orderPayload, fulfillment: 'table', tableLabel: '2', idempotencyKey: 'integration-table-order-003' }) });
  assert.equal(duplicateTableBooking.status, 409, 'checkout cannot reserve a table already occupied');

  // Mesas utilizadas precisam ir para limpeza ao concluir ou cancelar o pedido.
  const finishedTableOrderResponse = await fetch(base + '/api/orders', { method: 'POST', headers: { 'content-type': 'application/json', ...sameOrigin, cookie: customerCookie }, body: JSON.stringify({ ...orderPayload, fulfillment: 'table', tableLabel: '3', idempotencyKey: 'integration-table-finish-003' }) });
  assert.equal(finishedTableOrderResponse.status, 201);
  const finishedTableOrder = (await finishedTableOrderResponse.json()).order;
  for (const status of ['confirmed', 'preparing', 'ready', 'completed']) {
    const response = await fetch(base + '/api/admin/orders/' + encodeURIComponent(finishedTableOrder.id), { method: 'PATCH', headers: { 'content-type': 'application/json', ...sameOrigin, cookie }, body: JSON.stringify({ status }) });
    assert.equal(response.status, 200, 'table order transition to ' + status);
  }
  const tablesAfterCompletion = await (await fetch(base + '/api/admin/tables', { headers: { cookie } })).json();
  assert.equal(tablesAfterCompletion.tables.find(table => table.number === 3).status, 'cleaning', 'completed dine-in order moves its table to cleaning');
  const cancelledTableOrderResponse = await fetch(base + '/api/orders', { method: 'POST', headers: { 'content-type': 'application/json', ...sameOrigin, cookie: customerCookie }, body: JSON.stringify({ ...orderPayload, fulfillment: 'table', tableLabel: '4', idempotencyKey: 'integration-table-cancel-004' }) });
  assert.equal(cancelledTableOrderResponse.status, 201);
  const cancelledTableOrder = (await cancelledTableOrderResponse.json()).order;
  const cancelledTableResponse = await fetch(base + '/api/admin/orders/' + encodeURIComponent(cancelledTableOrder.id), { method: 'PATCH', headers: { 'content-type': 'application/json', ...sameOrigin, cookie }, body: JSON.stringify({ status: 'cancelled' }) });
  assert.equal(cancelledTableResponse.status, 200);
  const tablesAfterCancellation = await (await fetch(base + '/api/admin/tables', { headers: { cookie } })).json();
  assert.equal(tablesAfterCancellation.tables.find(table => table.number === 4).status, 'cleaning', 'cancelled dine-in order also moves its table to cleaning');

  const couponResponse = await fetch(base + '/api/admin/coupons', { method: 'POST', headers: { 'content-type': 'application/json', ...sameOrigin, cookie }, body: JSON.stringify({ code: 'SAVE10', discountType: 'percent', discountValue: 10, minimumSubtotalCents: 5000, maxUses: 2, active: true }) });
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
  const stillAvailable = await fetch(base + '/api/coupons/validate', { method: 'POST', headers: { 'content-type': 'application/json', ...sameOrigin, cookie: customerCookie }, body: JSON.stringify({ code: 'SAVE10', items: couponItems }) });
  assert.equal(stillAvailable.status, 200, 'repeating an idempotent order must not consume another coupon use');
  const secondDiscountedOrderResponse = await fetch(base + '/api/orders', { method: 'POST', headers: { 'content-type': 'application/json', ...sameOrigin, cookie: customerCookie }, body: JSON.stringify({ ...orderPayload, idempotencyKey: 'integration-coupon-key-003', couponCode: 'SAVE10' }) });
  assert.equal(secondDiscountedOrderResponse.status, 201);
  assert.equal((await secondDiscountedOrderResponse.json()).order.totalCents, 6363);
  const exhaustedCoupon = await fetch(base + '/api/coupons/validate', { method: 'POST', headers: { 'content-type': 'application/json', ...sameOrigin, cookie: customerCookie }, body: JSON.stringify({ code: 'SAVE10', items: couponItems }) });
  assert.equal(exhaustedCoupon.status, 422);
  assert.match((await exhaustedCoupon.json()).error, /limite de utilizações/);

  const oneUseCoupon = await fetch(base + '/api/admin/coupons', { method: 'POST', headers: { 'content-type': 'application/json', ...sameOrigin, cookie }, body: JSON.stringify({ code: 'ONEUSE', discountType: 'fixed', discountValue: 500, maxUses: 1, active: true }) });
  assert.equal(oneUseCoupon.status, 201);
  const competingOrders = await Promise.all([
    fetch(base + '/api/orders', { method: 'POST', headers: { 'content-type': 'application/json', ...sameOrigin, cookie: customerCookie }, body: JSON.stringify({ ...orderPayload, idempotencyKey: 'integration-oneuse-race-001', couponCode: 'ONEUSE' }) }),
    fetch(base + '/api/orders', { method: 'POST', headers: { 'content-type': 'application/json', ...sameOrigin, cookie: customerCookie }, body: JSON.stringify({ ...orderPayload, idempotencyKey: 'integration-oneuse-race-002', couponCode: 'ONEUSE' }) })
  ]);
  assert.deepEqual(competingOrders.map(response => response.status).sort(), [201, 422], 'a one-use coupon must not be redeemed by two distinct orders');
  const oneUseExhausted = await fetch(base + '/api/coupons/validate', { method: 'POST', headers: { 'content-type': 'application/json', ...sameOrigin, cookie: customerCookie }, body: JSON.stringify({ code: 'ONEUSE', items: couponItems }) });
  assert.equal(oneUseExhausted.status, 422, 'the winning checkout consumes exactly one coupon use');
  assert.equal(adminOrders.status, 200);
  assert.equal((await adminOrders.json()).orders[0].items[0].ingredients[3].name, 'Bacon crocante');
  const newProductResponse = await fetch(base + '/api/admin/products', { method: 'POST', headers: { 'content-type': 'application/json', ...sameOrigin, cookie }, body: JSON.stringify({ name: 'Pão de alho da casa', categoryId: 'acompanhamentos', type: 'plate', baseCents: 2500, description: 'Alho assado e ervas.' }) });
  assert.equal(newProductResponse.status, 201);
  const newProduct = (await newProductResponse.json()).product;
  assert.equal(newProduct.name, 'Pão de alho da casa');
  const soldOutUpdate = await fetch(base + '/api/admin/products/pizza-calabresa', { method: 'PATCH', headers: { 'content-type': 'application/json', ...sameOrigin, cookie }, body: JSON.stringify({ available: false }) });
  assert.equal((await soldOutUpdate.json()).product.available, 0);
  const catalogWithSoldOut = await (await fetch(base + '/api/catalog', { headers: { cookie: customerCookie } })).json();
  assert.equal(catalogWithSoldOut.products.find(product => product.id === 'pizza-calabresa').available, 0, 'sold-out product remains visible in the customer catalog');
  const soldOutOrder = await fetch(base + '/api/orders', { method: 'POST', headers: { 'content-type': 'application/json', ...sameOrigin, cookie: customerCookie }, body: JSON.stringify({ ...orderPayload, idempotencyKey: 'integration-sold-out-rejected' }) });
  assert.equal(soldOutOrder.status, 409, 'server rejects checkout for a sold-out product');
  const restockUpdate = await fetch(base + '/api/admin/products/pizza-calabresa', { method: 'PATCH', headers: { 'content-type': 'application/json', ...sameOrigin, cookie }, body: JSON.stringify({ available: true }) });
  assert.equal((await restockUpdate.json()).product.available, 1);

  const priceUpdate = await fetch(base + '/api/admin/products/pizza-calabresa', { method: 'PATCH', headers: { 'content-type': 'application/json', ...sameOrigin, cookie }, body: JSON.stringify({ baseCents: 5400 }) });
  assert.equal((await priceUpdate.json()).product.baseCents, 5400);
  const toppingUpdate = await fetch(base + '/api/admin/ingredients/bacon', { method: 'PATCH', headers: { 'content-type': 'application/json', ...sameOrigin, cookie }, body: JSON.stringify({ cents: 620 }) });
  assert.equal((await toppingUpdate.json()).ingredient.cents, 620);
  const changedCatalog = await (await fetch(base + '/api/catalog', { headers: { cookie: customerCookie } })).json();
  assert.equal(changedCatalog.products.find(product => product.id === 'pizza-calabresa').baseCents, 5400);
  assert.equal(changedCatalog.ingredients.find(ingredient => ingredient.id === 'bacon').cents, 620);

  // A changed cart must use a fresh idempotency key and create a fresh order,
  // with the latest server-side product and ingredient prices.
  const changedCartResponse = await fetch(base + '/api/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...sameOrigin, cookie: customerCookie },
    body: JSON.stringify({ ...orderPayload, idempotencyKey: 'integration-test-key-after-cart-change' })
  });
  assert.equal(changedCartResponse.status, 201);
  const changedCartOrder = (await changedCartResponse.json()).order;
  assert.notEqual(changedCartOrder.id, created.id, 'a new idempotency key must create a distinct order');
  assert.equal(changedCartOrder.totalCents, 7510, 'new order must use current server-side prices');

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
  assert.equal((await (await fetch(base + '/api/tracking/' + created.trackingToken, { headers: { cookie: customerCookie } })).json()).order.history.length, 2);

  const settingsUpdate = await fetch(base + '/api/admin/settings', { method: 'PATCH', headers: { 'content-type': 'application/json', ...sameOrigin, cookie }, body: JSON.stringify({ prepMinutes: 45 }) });
  assert.equal(settingsUpdate.status, 200);
  const refreshedTracking = await (await fetch(base + '/api/tracking/' + created.trackingToken, { headers: { cookie: customerCookie } })).json();
  assert.equal(refreshedTracking.order.prepMinutes, 45, 'tracking estimate follows the restaurant preparation setting');

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
  const wrongPasswordDelete = await fetch(base + '/api/customer/account', { method: 'DELETE', headers: { 'content-type': 'application/json', ...sameOrigin, cookie: customerCookie }, body: JSON.stringify({ password: 'wrong-password' }) });
  assert.equal(wrongPasswordDelete.status, 401, 'account deletion requires password confirmation');
  const accountDelete = await fetch(base + '/api/customer/account', { method: 'DELETE', headers: { 'content-type': 'application/json', ...sameOrigin, cookie: customerCookie }, body: JSON.stringify({ password: 'senha-teste-123' }) });
  assert.equal(accountDelete.status, 200);
  const deletedAccountCheck = await fetch(base + '/api/customer/me', { headers: { cookie: customerCookie } });
  assert.equal(deletedAccountCheck.status, 401, 'deleted account session is no longer accepted');
  const orderStillExists = await fetch(base + '/api/admin/orders', { headers: { cookie } });
  assert.equal(orderStillExists.status, 200, 'order history remains available to the restaurant after account deletion');
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

test('login do cliente aparece antes de terminar a verificação da sessão', async () => {
  const client = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const accountView = client.slice(client.indexOf('async function showCustomerAccount()'), client.indexOf('function renderCustomerAuth('));
  assert.ok(accountView.includes("renderCustomerAuth();try{const result=await api('/api/customer/me')"), 'customer login must render before the session request resolves');
  assert.ok(accountView.includes("if(app.customer)await renderCustomerDashboard()"), 'a valid session must still open the customer dashboard');
});


test('biblioteca QR Code não acessa this no escopo do módulo ES', async () => {
  const qr = await readFile(new URL('../public/qrcode.js', import.meta.url), 'utf8');
  assert.ok(qr.includes('if (_getAndroid() && _getAndroid() <= 2.1)'), 'Android compatibility check must use the detector function');
  assert.ok(!qr.includes('if (this._android && this._android <= 2.1)'), 'top-level this is undefined in ES modules');
});
