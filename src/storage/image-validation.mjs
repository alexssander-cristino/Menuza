const MAX_BYTES = 8 * 1024 * 1024;
const MAX_DIMENSION = 8000;
const MAX_PIXELS = 24_000_000;

function dimensions(width, height, format) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) {
    throw new Error('Imagem inválida ou com dimensões acima do limite permitido.');
  }
  return { format, width, height };
}

function crc32(buffer, start, end) {
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) {
    crc ^= buffer[i];
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function inspectPng(buffer) {
  const signature = Buffer.from([137,80,78,71,13,10,26,10]);
  if (buffer.length < 45 || !buffer.subarray(0,8).equals(signature)) return null;
  let offset = 8, chunks = 0, hasIdat = false, hasIend = false, result;
  const forbidden = new Set(['acTL','fcTL','fdAT','tEXt','zTXt','iTXt']);
  while (offset + 12 <= buffer.length && chunks++ < 4096) {
    const length = buffer.readUInt32BE(offset);
    if (length > MAX_BYTES || offset + 12 + length > buffer.length) throw new Error('Arquivo PNG corrompido.');
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8, crcOffset = dataStart + length;
    const expectedCrc = buffer.readUInt32BE(crcOffset);
    if (crc32(buffer, offset + 4, crcOffset) !== expectedCrc) throw new Error('Arquivo PNG com verificação de integridade inválida.');
    if (chunks === 1) {
      if (type !== 'IHDR' || length !== 13) throw new Error('Cabeçalho PNG inválido.');
      result = dimensions(buffer.readUInt32BE(dataStart), buffer.readUInt32BE(dataStart + 4), 'png');
    }
    if (forbidden.has(type)) throw new Error('PNG animado ou com metadados ativos não é permitido.');
    if (type === 'IDAT') hasIdat = true;
    if (type === 'IEND') {
      if (length !== 0 || !hasIdat || crcOffset + 4 !== buffer.length) throw new Error('Final do arquivo PNG inválido.');
      hasIend = true;
      break;
    }
    // Rejeita chunks críticos desconhecidos, que podem alterar a interpretação do arquivo.
    if (type !== 'IHDR' && type !== 'PLTE' && type !== 'IDAT' && type !== 'IEND' && type[0] === type[0].toUpperCase()) {
      throw new Error('PNG contém uma estrutura não suportada.');
    }
    offset = crcOffset + 4;
  }
  if (!result || !hasIend) throw new Error('Arquivo PNG incompleto ou inválido.');
  return result;
}

function inspectJpeg(buffer) {
  if (buffer.length < 16 || buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer.at(-2) !== 0xff || buffer.at(-1) !== 0xd9) return null;
  const sof = new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf]);
  let offset = 2, result = null, segments = 0;
  while (offset < buffer.length - 2 && segments++ < 2048) {
    if (buffer[offset] !== 0xff) throw new Error('Estrutura JPEG inválida.');
    while (buffer[offset] === 0xff) offset++;
    const marker = buffer[offset++];
    if (marker === 0xda) break;
    if (marker === 0xd9 || marker === 0x00 || marker === 0xd8) throw new Error('Estrutura JPEG inválida.');
    if (offset + 2 > buffer.length) throw new Error('JPEG incompleto.');
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) throw new Error('Segmento JPEG inválido.');
    if (sof.has(marker)) {
      if (length < 8) throw new Error('Dimensões JPEG inválidas.');
      result = dimensions(buffer.readUInt16BE(offset + 3), buffer.readUInt16BE(offset + 5), 'jpeg');
    }
    // APP1/APP13 e COM são rejeitados para evitar payloads e metadados desnecessários.
    if ((marker >= 0xe1 && marker <= 0xef) || marker === 0xfe) throw new Error('JPEG com metadados incorporados não é permitido. Reenvie a imagem exportada pelo editor.');
    offset += length;
  }
  if (!result || !buffer.includes(Buffer.from([0xff,0xda])) || buffer.length < 4) throw new Error('JPEG sem quadro de imagem válido.');
  return result;
}

function inspectWebp(buffer) {
  if (buffer.length < 25 || buffer.toString('ascii',0,4) !== 'RIFF' || buffer.toString('ascii',8,12) !== 'WEBP') return null;
  if (buffer.readUInt32LE(4) + 8 !== buffer.length) throw new Error('Tamanho do arquivo WebP inválido.');
  let offset = 12, chunks = 0, result = null, imageChunk = false;
  while (offset + 8 <= buffer.length && chunks++ < 128) {
    const type = buffer.toString('ascii',offset,offset+4);
    const length = buffer.readUInt32LE(offset+4);
    const start = offset + 8, end = start + length + (length & 1);
    if (end > buffer.length) throw new Error('Estrutura WebP inválida.');
    if (['EXIF','XMP ','ICCP','ANIM','ANMF'].includes(type)) throw new Error('WebP com metadados ou animação não é permitido.');
    if (type === 'VP8X') {
      if (length !== 10) throw new Error('Cabeçalho WebP inválido.');
      const flags = buffer[start];
      if (flags & 0x2c) throw new Error('WebP com metadados incorporados não é permitido.');
      result = dimensions(1 + buffer[start+4] + (buffer[start+5]<<8) + (buffer[start+6]<<16),
        1 + buffer[start+7] + (buffer[start+8]<<8) + (buffer[start+9]<<16), 'webp');
    } else if (type === 'VP8 ') {
      if (length < 10 || buffer[start+3] !== 0x9d || buffer[start+4] !== 0x01 || buffer[start+5] !== 0x2a) throw new Error('Quadro WebP inválido.');
      result = dimensions(buffer.readUInt16LE(start+6)&0x3fff,buffer.readUInt16LE(start+8)&0x3fff,'webp');
      imageChunk = true;
    } else if (type === 'VP8L') {
      if (length < 5 || buffer[start] !== 0x2f) throw new Error('Quadro WebP inválido.');
      const bits = buffer.readUInt32LE(start+1);
      result = dimensions((bits&0x3fff)+1,((bits>>>14)&0x3fff)+1,'webp');
      imageChunk = true;
    }
    offset = end;
  }
  if (!result || !imageChunk || offset !== buffer.length) throw new Error('WebP incompleto ou sem imagem válida.');
  return result;
}

export function inspectImageBuffer(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input || []);
  if (!buffer.length || buffer.length > MAX_BYTES) throw new Error('A imagem precisa ter até 8 MB.');
  const result = inspectPng(buffer) || inspectJpeg(buffer) || inspectWebp(buffer);
  if (!result) throw new Error('Arquivo não reconhecido. Envie uma imagem PNG, JPG ou WebP real.');
  return result;
}
