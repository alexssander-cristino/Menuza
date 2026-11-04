import { inspectImageBuffer } from './image-validation.mjs';
import { createHash, createHmac, randomBytes } from 'node:crypto';

const DEFAULT_BUCKET = 'menuza-modelos-3d';
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function storageConfig() {
  const endpoint = String(process.env.AWS_ENDPOINT_URL_S3 || '').replace(/\/+$/, '');
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID || '';
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || '';
  const region = process.env.AWS_REGION || 'us-east-2';
  const bucket = process.env.MENUZA_STORAGE_BUCKET || DEFAULT_BUCKET;
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error('Neon Object Storage não está configurado. Confira AWS_ENDPOINT_URL_S3, AWS_ACCESS_KEY_ID e AWS_SECRET_ACCESS_KEY.');
  }
  return { endpoint, accessKeyId, secretAccessKey, region, bucket };
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key, value, encoding) {
  return createHmac('sha256', key).update(value).digest(encoding);
}

function encodedKey(key) {
  return String(key).split('/').map(part => encodeURIComponent(part)).join('/');
}

async function signedS3Request(method, key, body = Buffer.alloc(0), contentType = '') {
  const config = storageConfig();
  const url = new URL(config.endpoint + '/' + config.bucket + '/' + encodedKey(key));
  const now = new Date();
  const date = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = date.slice(0, 8);
  const payloadHash = sha256(body);
  const headers = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': date
  };
  if (contentType) headers['content-type'] = contentType;
  const headerNames = Object.keys(headers).sort();
  const canonicalHeaders = headerNames.map(name => name + ':' + String(headers[name]).trim() + '\n').join('');
  const signedHeaders = headerNames.join(';');
  const canonicalRequest = [
    method,
    url.pathname,
    url.searchParams.toString(),
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');
  const scope = day + '/' + config.region + '/s3/aws4_request';
  const stringToSign = ['AWS4-HMAC-SHA256', date, scope, sha256(canonicalRequest)].join('\n');
  const dateKey = hmac('AWS4' + config.secretAccessKey, day);
  const regionKey = hmac(dateKey, config.region);
  const serviceKey = hmac(regionKey, 's3');
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = hmac(signingKey, stringToSign, 'hex');
  const requestHeaders = {
    ...headers,
    Authorization: 'AWS4-HMAC-SHA256 Credential=' + config.accessKeyId + '/' + scope + ', SignedHeaders=' + signedHeaders + ', Signature=' + signature
  };
  const response = await fetch(url, {
    method,
    headers: requestHeaders,
    body: method === 'PUT' ? body : undefined,
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    throw new Error('Falha no Neon Object Storage (' + response.status + '): ' + detail);
  }
  return { url: config.endpoint + '/' + config.bucket + '/' + encodedKey(key), response };
}

export function isImageDataUrl(value) {
  return typeof value === 'string' && /^data:image\/(?:webp|jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
}

export function isStoredImageUrl(value) {
  return typeof value === 'string' && /^https:\/\/[^\s<>"']+$/i.test(value);
}

export async function storeImageDataUrl(dataUrl, prefix = 'products') {
  if (dataUrl === '' || dataUrl == null) return '';
  if (!isImageDataUrl(dataUrl)) {
    if (isStoredImageUrl(dataUrl)) return dataUrl;
    throw Object.assign(new Error('Imagem inválida. Envie uma imagem WebP, JPG ou PNG.'), { status: 422 });
  }
  const match = dataUrl.match(/^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) throw Object.assign(new Error('Formato de imagem inválido.'), { status: 422 });
  const contentType = match[1];
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw Object.assign(new Error('Arquivo de imagem inválido ou acima de 8 MB.'), { status: 413 });
  if (bytes.toString('base64').replace(/=+$/, '') !== match[2].replace(/=+$/, '')) throw Object.assign(new Error('Arquivo de imagem inválido.'), { status: 422 });
  let inspected;
  try { inspected = inspectImageBuffer(bytes); }
  catch (error) { throw Object.assign(new Error(error.message || 'Imagem inválida.'), { status: 422 }); }
  const expectedFormat = contentType === 'image/jpeg' ? 'jpeg' : contentType === 'image/png' ? 'png' : 'webp';
  if (inspected.format !== expectedFormat) throw new Error('O conteúdo do arquivo não corresponde ao formato informado.');
  const extension = contentType === 'image/jpeg' ? 'jpg' : contentType === 'image/png' ? 'png' : 'webp';
  const safePrefix = String(prefix || 'products').split('/').filter(part => /^[a-zA-Z0-9_-]{1,80}$/.test(part)).join('/');
  const key = (safePrefix || 'products') + '/' + randomBytes(16).toString('hex') + '.' + extension;
  try {
    const uploaded = await signedS3Request('PUT', key, bytes, contentType);
    return uploaded.url;
  } catch (error) {
    throw Object.assign(new Error('Não foi possível enviar a imagem ao armazenamento. ' + (error.message || 'Tente novamente.')), { status: 502 });
  }
}

export async function storeImageList(images, prefix = 'products') {
  if (!Array.isArray(images)) throw new Error('Lista de imagens inválida.');
  return Promise.all(images.map(image => storeImageDataUrl(image, prefix)));
}

export async function imageReferenceToDataUrl(reference) {
  if (isImageDataUrl(reference)) return reference;
  if (!isStoredImageUrl(reference)) throw new Error('Imagem do produto inválida para geração 3D.');
  const config = storageConfig();
  const imageUrl = new URL(reference);
  const expectedPrefix = '/' + config.bucket + '/';
  if (imageUrl.origin !== new URL(config.endpoint).origin || !imageUrl.pathname.startsWith(expectedPrefix)) {
    throw new Error('A foto usada na geração 3D precisa estar armazenada no bucket do Menuza.');
  }
  const response = await fetch(imageUrl, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error('Não foi possível baixar a foto do produto para gerar o modelo 3D.');
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_IMAGE_BYTES) throw new Error('A foto do produto excede o limite para geração 3D.');
  const contentType = String(response.headers.get('content-type') || '').split(';')[0].toLowerCase();
  if (!['image/webp', 'image/jpeg', 'image/png'].includes(contentType)) throw new Error('A foto armazenada não está em um formato de imagem compatível.');
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of response.body || []) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_IMAGE_BYTES) throw new Error('A foto do produto excede o limite para geração 3D.');
    chunks.push(Buffer.from(chunk));
  }
  const bytes = Buffer.concat(chunks, totalBytes);
  if (!bytes.length) throw new Error('A foto armazenada está vazia.');
  const inspected = inspectImageBuffer(bytes);
  const expectedFormat = contentType === 'image/jpeg' ? 'jpeg' : contentType === 'image/png' ? 'png' : 'webp';
  if (inspected.format !== expectedFormat) throw new Error('A foto armazenada não corresponde ao tipo de imagem declarado.');
  return 'data:' + contentType + ';base64,' + bytes.toString('base64');
}

export async function migrateImageReferences(images, prefix = 'products') {
  const list = Array.isArray(images) ? images : [];
  return Promise.all(list.map(image => isImageDataUrl(image) ? storeImageDataUrl(image, prefix) : image));
}
