import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeUploadFileName, validateFiscalDocument } from '../src/security/file-validation.mjs';

const encoded = value => Buffer.from(value).toString('base64');

test('accepts a small UTF-8 XML document', () => {
  const result = validateFiscalDocument({ documentType: 'xml', mimeType: 'application/xml', contentBase64: encoded('<?xml version="1.0"?><nfeProc></nfeProc>') });
  assert.equal(result.mimeType, 'application/xml');
});

test('rejects XML with external entities and stylesheet instructions', () => {
  assert.throws(() => validateFiscalDocument({ documentType: 'xml', mimeType: 'application/xml', contentBase64: encoded('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>') }), /DTD|entidades externas/i);
  assert.throws(() => validateFiscalDocument({ documentType: 'xml', mimeType: 'application/xml', contentBase64: encoded('<?xml-stylesheet href="https://evil.test/xsl"?><x/>') }), /DTD|entidades externas/i);
});

test('accepts a PDF signature and rejects PDF active actions', () => {
  const valid = '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF';
  assert.equal(validateFiscalDocument({ documentType: 'pdf', mimeType: 'application/pdf', contentBase64: encoded(valid) }).mimeType, 'application/pdf');
  const active = '%PDF-1.4\n<< /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>\n%%EOF';
  assert.throws(() => validateFiscalDocument({ documentType: 'pdf', mimeType: 'application/pdf', contentBase64: encoded(active) }), /scripts|ações/i);
});

test('rejects mismatched MIME, unsupported files and invalid Base64', () => {
  assert.throws(() => validateFiscalDocument({ documentType: 'pdf', mimeType: 'text/xml', contentBase64: encoded('%PDF-1.4\n%%EOF') }), /não corresponde/i);
  assert.throws(() => validateFiscalDocument({ documentType: 'other', mimeType: 'application/octet-stream', contentBase64: encoded('MZ executable') }), /não permitido/i);
  assert.throws(() => validateFiscalDocument({ documentType: 'xml', mimeType: 'application/xml', contentBase64: 'not base64!' }), /Base64|inválido/i);
});

test('sanitizes file names before they are returned to the browser', () => {
  assert.equal(sanitizeUploadFileName('../../<script>.pdf'), '_ _script_.pdf');
});
