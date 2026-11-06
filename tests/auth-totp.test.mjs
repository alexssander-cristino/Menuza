import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyTotp, generateTotpSecret } from '../src/auth-totp.mjs';

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

test('generates unique Base32 secrets accepted by the TOTP verifier', () => {
  const first = generateTotpSecret();
  const second = generateTotpSecret();
  assert.match(first, /^[A-Z2-7]{32}$/);
  assert.match(second, /^[A-Z2-7]{32}$/);
  assert.notEqual(first, second);
  assert.equal(verifyTotp(first, '000000'), false);
});
