import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectImageBuffer } from '../src/storage/image-validation.mjs';

const validPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64');

test('accepts a structurally valid PNG and returns bounded dimensions', () => {
  assert.deepEqual(inspectImageBuffer(validPng), { format: 'png', width: 1, height: 1 });
});

test('rejects HTML renamed as a PNG', () => {
  assert.throws(() => inspectImageBuffer(Buffer.from('<html><script>alert(1)</script></html>')), /não reconhecido/i);
});

test('rejects corrupted PNG checksums', () => {
  const corrupted = Buffer.from(validPng);
  corrupted[corrupted.length - 8] ^= 0xff;
  assert.throws(() => inspectImageBuffer(corrupted), /integridade/i);
});

test('rejects PNG polyglots with data appended after IEND', () => {
  assert.throws(() => inspectImageBuffer(Buffer.concat([validPng, Buffer.from('<script>alert(1)</script>')])), /Final do arquivo PNG inválido/i);
});

test('rejects empty and oversized image buffers', () => {
  assert.throws(() => inspectImageBuffer(Buffer.alloc(0)), /até 8 MB/i);
  assert.throws(() => inspectImageBuffer(Buffer.alloc(8 * 1024 * 1024 + 1)), /até 8 MB/i);
});
