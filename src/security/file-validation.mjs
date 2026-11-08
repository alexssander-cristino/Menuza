// Validação de anexos administrativos.
// Normaliza nomes de arquivos e verifica documentos recebidos antes de aceitá-los,
// reduzindo riscos de nomes malformados e formatos não permitidos.
const MAX_DOCUMENT_BYTES = 1_300_000;

function decodeBase64(value) {
  if (typeof value !== 'string' || !value || value.length > Math.ceil(MAX_DOCUMENT_BYTES * 4 / 3) + 8 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('Conteúdo do arquivo inválido.');
  }
  const bytes = Buffer.from(value, 'base64');
  if (!bytes.length || bytes.length > MAX_DOCUMENT_BYTES ||
      bytes.toString('base64') !== value) throw new Error('O arquivo deve ter até 1,3 MB e estar em Base64 válido.');
  return bytes;
}

function validatePdf(bytes) {
  const header = bytes.subarray(0, 8).toString('ascii');
  if (!/^%PDF-1\.[0-7]$|^%PDF-2\.0$/.test(header)) throw new Error('O arquivo não é um PDF válido.');
  const tail = bytes.subarray(Math.max(0, bytes.length - 2048)).toString('latin1');
  if (!/%%EOF\s*$/.test(tail)) throw new Error('O PDF está incompleto ou corrompido.');
  const source = bytes.toString('latin1');
  const activeFeatures = /\/(?:JavaScript|JS|Launch|EmbeddedFile|OpenAction|AA|RichMedia|XFA|SubmitForm|ImportData|GoToR)\b/i;
  if (activeFeatures.test(source)) throw new Error('PDF com ações, scripts ou conteúdo incorporado não é permitido.');
  return { bytes, mimeType: 'application/pdf' };
}

function validateXml(bytes) {
  let xml;
  try { xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '').trim(); }
  catch { throw new Error('O XML precisa estar codificado em UTF-8 válido.'); }
  if (!xml || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(xml)) throw new Error('O XML contém caracteres inválidos.');
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(xml)) throw new Error('XML com DTD, entidades externas ou folha de estilo não é permitido.');
  if (!/^(?:<\?xml\s[^?]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<[A-Za-z_][\w:.-]*(?:\s|>|\/)/.test(xml)) {
    throw new Error('O arquivo não contém uma estrutura XML reconhecível.');
  }
  if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i.test(xml)) throw new Error('O XML contém entidades não permitidas.');
  return { bytes, mimeType: 'application/xml' };
}

export function validateFiscalDocument({ documentType, mimeType, contentBase64 }) {
  const bytes = decodeBase64(contentBase64);
  const declared = String(mimeType || '').toLowerCase().split(';')[0].trim();
  if (documentType === 'pdf') {
    if (declared !== 'application/pdf') throw new Error('O tipo informado não corresponde a um PDF.');
    return validatePdf(bytes);
  }
  if (documentType === 'xml') {
    if (!['application/xml', 'text/xml'].includes(declared)) throw new Error('O tipo informado não corresponde a um XML.');
    return validateXml(bytes);
  }
  throw new Error('Tipo de documento não permitido. Envie somente PDF ou XML.');
}

export function sanitizeUploadFileName(value) {
  const cleaned = String(value || '').normalize('NFKC')
    .replace(/[\\/\u0000-\u001f\u007f<>:"|?*]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120);
  return cleaned || 'documento';
}
