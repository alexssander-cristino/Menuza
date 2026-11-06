import test from 'node:test';
import assert from 'node:assert/strict';
import { activeTimestamps, resolveClientIp, retryAfterSeconds } from '../src/security/rate-limit.mjs';
test('uses trusted proxy address and the rightmost forwarded address as fallback',()=>{
  assert.equal(resolveClientIp({'x-real-ip':'203.0.113.10','x-forwarded-for':'198.51.100.99, 203.0.113.10'}),'203.0.113.10');
  assert.equal(resolveClientIp({'x-forwarded-for':'198.51.100.99, 203.0.113.10'}),'203.0.113.10');
  assert.equal(resolveClientIp({},'127.0.0.1'),'127.0.0.1');
});
test('removes malformed, expired and future timestamps',()=>{
  assert.deepEqual(activeTimestamps(JSON.stringify([900,950,1001,'bad',-1]),1000,100),[950]);
  assert.deepEqual(activeTimestamps('invalid',1000,100),[]);
});
test('blocks only after reaching the configured threshold',()=>{
  assert.equal(retryAfterSeconds([900,950],1000,200,2),1);
  assert.equal(retryAfterSeconds([950],1000,200,2),0);
});
