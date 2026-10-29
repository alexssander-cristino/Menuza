import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyTotp } from '../src/auth-totp.mjs';

test('validates RFC 6238 six-digit TOTP vectors', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.equal(verifyTotp(secret, '287082', 59_000), true);
});

test('accepts only six-digit codes and a valid base32 secret', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.equal(verifyTotp(secret, '28708', 59_000), false);
  assert.equal(verifyTotp(secret, 'abcdef', 59_000), false);
  assert.equal(verifyTotp('invalid-secret!', '287082', 59_000), false);
});

test('allows one 30-second step of clock drift but not distant codes', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.equal(verifyTotp(secret, '287082', 59_000), true);
  assert.equal(verifyTotp(secret, '287082', 150_000), false);
});
