import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const TARGET_VUS = Number(__ENV.VUS || 100);
const THINK_TIME_SECONDS = Number(__ENV.THINK_TIME_SECONDS || 90);
const ENABLE_ORDER_WRITES = __ENV.ENABLE_ORDER_WRITES === 'true';
const ALLOW_TEST_ORDER_WRITES = __ENV.ALLOW_TEST_ORDER_WRITES === 'true';

if (!Number.isInteger(TARGET_VUS) || TARGET_VUS < 1 || TARGET_VUS > 100) {
  throw new Error('VUS deve ser um número inteiro entre 1 e 100.');
}
if (!Number.isFinite(THINK_TIME_SECONDS) || THINK_TIME_SECONDS < 10) {
  throw new Error('THINK_TIME_SECONDS deve ser de pelo menos 10 segundos.');
}
if (ENABLE_ORDER_WRITES && (!ALLOW_TEST_ORDER_WRITES || TARGET_VUS > 8)) {
  throw new Error('Pedidos de teste exigem ALLOW_TEST_ORDER_WRITES=true e no máximo 8 VUs.');
}
if (ENABLE_ORDER_WRITES && /menuza-five\.vercel\.app|menuza-rf8ix80r5/i.test(BASE_URL)) {
  throw new Error('O teste com criação de pedidos está bloqueado para a produção.');
}

let orderFixture = null;
if (ENABLE_ORDER_WRITES) {
  if (!__ENV.ORDER_PAYLOAD_JSON) {
    throw new Error('Defina ORDER_PAYLOAD_JSON com um pedido de teste válido do ambiente de homologação.');
  }
  try {
    orderFixture = JSON.parse(__ENV.ORDER_PAYLOAD_JSON);
  } catch {
    throw new Error('ORDER_PAYLOAD_JSON precisa conter JSON válido.');
  }
  if (!orderFixture || !Array.isArray(orderFixture.items) || !orderFixture.items.length) {
    throw new Error('ORDER_PAYLOAD_JSON precisa conter ao menos um item em items.');
  }
}

export const options = {
  stages: [
    { duration: '1m', target: 10 },
    { duration: '1m', target: 25 },
    { duration: '2m', target: TARGET_VUS },
    { duration: '2m', target: TARGET_VUS },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1500', 'p(99)<3000'],
    checks: ['rate>0.99'],
  },
};

function getJson(path, label) {
  const response = http.get(`${BASE_URL}${path}`, {
    headers: { Accept: 'application/json' },
    tags: { endpoint: path, flow: 'customer-browse' },
    timeout: '20s',
  });
  check(response, {
    [`${label}: HTTP 200`]: (r) => r.status === 200,
  });
  return response;
}

export default function () {
  const catalog = getJson('/api/catalog', 'cardápio');
  check(catalog, {
    'cardápio contém produtos': (r) => {
      try {
        const body = r.json();
        return Array.isArray(body.products);
      } catch {
        return false;
      }
    },
  });

  getJson('/api/opening-hours', 'horários');
  getJson('/api/dispatch?path=delivery/options', 'entrega');

  if (ENABLE_ORDER_WRITES && orderFixture) {
    const payload = {
      ...orderFixture,
      idempotencyKey: `k6-${__VU}-${__ITER}-${Date.now()}`,
    };
    const response = http.post(`${BASE_URL}/api/orders`, JSON.stringify(payload), {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      tags: { endpoint: '/api/orders', flow: 'customer-checkout' },
      timeout: '30s',
    });
    check(response, {
      'pedido de teste criado': (r) => r.status === 201,
    });
  }

  sleep(THINK_TIME_SECONDS);
}
