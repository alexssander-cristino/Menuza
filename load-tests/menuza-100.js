import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const TARGET_PATH = __ENV.TARGET_PATH || '/';
const TARGET_URL = `${BASE_URL}${TARGET_PATH.startsWith('/') ? '' : '/'}${TARGET_PATH}`;

export const options = {
  stages: [
    { duration: '1m', target: 25 },
    { duration: '1m', target: 50 },
    { duration: '1m', target: 100 },
    { duration: '5m', target: 100 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1500', 'p(99)<3000'],
    checks: ['rate>0.99'],
  },
  discardResponseBodies: true,
};

export default function () {
  const response = http.get(TARGET_URL, {
    headers: { Accept: 'text/html,application/json' },
    tags: { endpoint: TARGET_PATH, test: 'menuza-100-vus' },
    timeout: '30s',
  });

  check(response, {
    'retorna HTTP 2xx ou 3xx': (r) => r.status >= 200 && r.status < 400,
  });

  sleep(1);
}
