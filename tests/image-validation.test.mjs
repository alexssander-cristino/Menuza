import test from 'node:test';
// Testes de segurança de imagens: verificam formatos aceitos, assinaturas binárias e rejeição de arquivos inválidos.
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


function webpChunk(type, data) {
  const header = Buffer.alloc(8);
  header.write(type, 0, 4, 'ascii');
  header.writeUInt32LE(data.length, 4);
  return Buffer.concat([header, data, data.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}
function webpFile(chunks) {
  const body = Buffer.concat([Buffer.from('WEBP'), ...chunks]);
  const header = Buffer.alloc(8);
  header.write('RIFF', 0, 4, 'ascii');
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}
function validIccProfile() {
  const profile = Buffer.alloc(128);
  profile.writeUInt32BE(profile.length, 0);
  profile.write('acsp', 36, 4, 'ascii');
  return profile;
}
function extendedWebp(flags = 0x20, includeProfile = true) {
  const extended = Buffer.alloc(10);
  extended[0] = flags;
  const chunks = [webpChunk('VP8X', extended)];
  if (includeProfile) chunks.push(webpChunk('ICCP', validIccProfile()));
  chunks.push(webpChunk('VP8L', Buffer.from([0x2f, 0, 0, 0, 0])));
  return webpFile(chunks);
}

test('accepts WebP with a standard embedded ICC color profile from browser canvas', () => {
  assert.deepEqual(inspectImageBuffer(extendedWebp()), { format: 'webp', width: 1, height: 1 });
});

test('continues rejecting WebP EXIF, XMP and animation flags', () => {
  assert.throws(() => inspectImageBuffer(extendedWebp(0x08, false)), /EXIF\/XMP/i);
  assert.throws(() => inspectImageBuffer(extendedWebp(0x04, false)), /EXIF\/XMP/i);
  assert.throws(() => inspectImageBuffer(extendedWebp(0x02, false)), /EXIF\/XMP/i);
});

test('rejects malformed ICC profiles and profiles without the WebP ICC flag', () => {
  const malformed = Buffer.alloc(128);
  assert.throws(() => inspectImageBuffer(webpFile([
    webpChunk('VP8X', Buffer.from([0x20,0,0,0,0,0,0,0,0,0])),
    webpChunk('ICCP', malformed),
    webpChunk('VP8L', Buffer.from([0x2f,0,0,0,0]))
  ])), /Perfil de cor ICC/i);
  assert.throws(() => inspectImageBuffer(webpFile([
    webpChunk('VP8X', Buffer.alloc(10)),
    webpChunk('ICCP', validIccProfile()),
    webpChunk('VP8L', Buffer.from([0x2f,0,0,0,0]))
  ])), /Perfil de cor ICC/i);
});

test('rejects WebP that declares an ICC profile but omits its chunk', () => {
  assert.throws(() => inspectImageBuffer(extendedWebp(0x20, false)), /ICC/i);
});
