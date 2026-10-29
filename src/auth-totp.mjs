import { createHmac, timingSafeEqual } from 'node:crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function decodeBase32(value) {
  const input = String(value || '').replace(/\s+/g, '').replace(/=+$/g, '').toUpperCase();
  if (!input || !/^[A-Z2-7]+$/.test(input)) return null;
  let bits = 0;
  let buffer = 0;
  const bytes = [];
  for (const character of input) {
    buffer = (buffer << 5) | BASE32.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return bytes.length ? Buffer.from(bytes) : null;
}

function codeAt(secret, counter) {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secret).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

/** Verify RFC 6238 TOTP using a 30-second step and at most one step of clock drift. */
export function verifyTotp(secretText, candidate, now = Date.now()) {
  if (typeof candidate !== 'string' || !/^\d{6}$/.test(candidate) || !Number.isFinite(now)) return false;
  const secret = decodeBase32(secretText);
  if (!secret || secret.length < 10) return false;
  const counter = Math.floor(now / 30_000);
  const candidateBytes = Buffer.from(candidate);
  for (const drift of [-1, 0, 1]) {
    const expected = Buffer.from(codeAt(secret, counter + drift));
    if (expected.length === candidateBytes.length && timingSafeEqual(expected, candidateBytes)) return true;
  }
  return false;
}
