// =============================================================================
// Wizer Signage — k6 smoke / light load test
// =============================================================================
// Safe, low-volume checks against the hot read paths. Run against a LOCAL or
// STAGING instance — never hammer production without a planned maintenance
// window (see docs/performance-testing.md).
//
//   k6 run -e BASE_URL=http://localhost:3001/api scripts/load-test/smoke.js
//
// Authenticated paths run only when a token is supplied:
//   k6 run -e BASE_URL=https://staging.example.com/api -e TOKEN=eyJ... \
//          -e DEVICE_TOKEN=... scripts/load-test/smoke.js
// =============================================================================

import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:3001/api';
const TOKEN = __ENV.TOKEN || ''; // dashboard JWT (optional)
const DEVICE_TOKEN = __ENV.DEVICE_TOKEN || ''; // device token (optional)

export const options = {
  // Gentle ramp — tune up deliberately once a baseline is established.
  stages: [
    { duration: '30s', target: 10 },
    { duration: '1m', target: 10 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'], // <1% errors
    http_req_duration: ['p(95)<800'], // p95 < 800ms
  },
};

function authHeaders() {
  return TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};
}
function deviceHeaders() {
  return DEVICE_TOKEN ? { 'X-Device-Token': DEVICE_TOKEN } : {};
}

export default function () {
  // 1) Liveness + readiness (public, lightweight).
  check(http.get(`${BASE}/health`), { 'health 200': (r) => r.status === 200 });
  check(http.get(`${BASE}/health/ready`), {
    'ready 200/503': (r) => r.status === 200 || r.status === 503,
  });

  // 2) Authenticated dashboard read (monitoring overview) — only if a token is set.
  if (TOKEN) {
    const r = http.get(`${BASE}/monitoring/overview`, { headers: authHeaders() });
    check(r, { 'overview ok': (res) => res.status === 200 || res.status === 403 });
  }

  // 3) Device manifest + sync-plan + heartbeat — only if a device token is set.
  if (DEVICE_TOKEN) {
    check(http.get(`${BASE}/device/manifest`, { headers: deviceHeaders() }), {
      'manifest ok': (r) => r.status === 200,
    });
    check(http.get(`${BASE}/device/sync-plan`, { headers: deviceHeaders() }), {
      'sync-plan ok': (r) => r.status === 200,
    });
  }

  sleep(1);
}
