import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const PORT = Number(process.env.PRINT_AGENT_PORT || 17891);
const TYPE = String(process.env.PRINTER_TYPE || 'windows').toLowerCase();
const PRINTER_NAME = String(process.env.PRINTER_NAME || '').trim();
const PRINTER_HOST = String(process.env.PRINTER_HOST || '').trim();
const PRINTER_PORT = Number(process.env.PRINTER_PORT || 9100);
const EPSON_MODEL = String(process.env.EPSON_MODEL || 'auto').toLowerCase();
const EPSON_CUT = String(process.env.EPSON_CUT || 'true').toLowerCase() !== 'false';
const ALLOWED_ORIGINS = new Set((process.env.ALLOWED_ORIGINS || 'https://menuza-five.vercel.app,https://menuza-alexssander1.vercel.app,https://menuza-git-main-alexssander1.vercel.app,http://localhost:4173,http://127.0.0.1:4173').split(',').map(v => v.trim()).filter(Boolean));
const STATE_DIR = path.join(os.homedir(), '.menuza-print-agent');
const STATE_FILE = path.join(STATE_DIR, 'printed-orders.json');
const EPSON_PROFILES = {
  auto: { columns: 42, label: 'Epson ESC/POS padrão' },
  'tm-t20': { columns: 42, label: 'Epson TM-T20 / TM-T20II / TM-T20III' },
  'tm-t88': { columns: 48, label: 'Epson TM-T88' },
  'tm-m30': { columns: 42, label: 'Epson TM-m30' },
  'tm-u220': { columns: 32, label: 'Epson TM-U220 (matricial)' }
};
let printed = new Set();

await fs.mkdir(STATE_DIR, { recursive: true });
try { printed = new Set(JSON.parse(await fs.readFile(STATE_FILE, 'utf8')).ids || []); } catch {}
const saveState = async () => {
  const ids = [...printed].slice(-2000);
  await fs.writeFile(STATE_FILE, JSON.stringify({ ids }, null, 2), 'utf8');
  printed = new Set(ids);
};
const clean = value => String(value ?? '').replace(/[\\r\\n\\t]+/g, ' ').replace(/\\s{2,}/g, ' ').trim();
const ascii = value => clean(value).normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/[^\\x20-\\x7E]/g, '?');
const profile = () => EPSON_PROFILES[EPSON_MODEL] || EPSON_PROFILES.auto;

function wrap(value, width) {
  const words = ascii(value).split(/\\s+/).filter(Boolean);
  const result = [];
  let line = '';
  for (const word of words) {
    if (word.length > width) {
      if (line) result.push(line);
      line = '';
      for (let i = 0; i < word.length; i += width) result.push(word.slice(i, i + width));
      continue;
    }
    if (!line) line = word;
    else if ((line + ' ' + word).length <= width) line += ' ' + word;
    else { result.push(line); line = word; }
  }
  if (line) result.push(line);
  return result;
}

function ticketLines(order, width) {
  const line = '-'.repeat(width);
  const rows = [
    { text: 'MENUZA', align: 'center', bold: true, double: true },
    { text: 'COMANDA DE COZINHA', align: 'center', bold: true },
    { text: line },
    { text: 'PEDIDO: ' + ascii(order.id), bold: true },
    { text: 'DATA: ' + ascii(order.createdAt ? new Date(order.createdAt).toLocaleString('pt-BR') : '') },
    ...wrap('CLIENTE: ' + (order.customerName || 'Nao informado'), width).map(text => ({ text })),
    ...wrap('TIPO: ' + (order.fulfillment === 'table' ? 'MESA ' + (order.tableLabel || '') : order.fulfillment === 'delivery' ? 'ENTREGA' : 'RETIRADA'), width).map(text => ({ text }))
  ];
  if (order.phone) rows.push(...wrap('TELEFONE: ' + order.phone, width).map(text => ({ text })));
  rows.push({ text: line }, { text: 'ITENS', bold: true });
  for (const item of order.items || []) {
    rows.push(...wrap((item.quantity || 1) + 'x ' + item.name, width).map(text => ({ text, bold: true })));
    const size = item.snapshot?.size?.label || item.sizeLabel;
    if (size) rows.push(...wrap('  Tamanho: ' + size, width).map(text => ({ text })));
    const ingredients = (item.ingredients || []).map(i => i.name).filter(Boolean);
    if (ingredients.length) rows.push(...wrap('  Adicionais: ' + ingredients.join(', '), width).map(text => ({ text })));
    if (item.notes) rows.push(...wrap('  OBS: ' + item.notes, width).map(text => ({ text, bold: true })));
  }
  if (order.note) rows.push({ text: line }, ...wrap('OBSERVACAO: ' + order.note, width).map(text => ({ text, bold: true })));
  if (order.fulfillment === 'delivery' && order.deliveryAddress) rows.push(...wrap('ENDERECO: ' + order.deliveryAddress, width).map(text => ({ text })));
  const total = (Number(order.totalCents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  rows.push({ text: line }, { text: 'TOTAL: ' + ascii(total), bold: true, double: true }, { text: line }, { text: '' }, { text: '' });
  return rows;
}

function epsonEscPos(order) {
  const { columns } = profile();
  const chunks = [Buffer.from([0x1b, 0x40])]; // Initialize printer
  for (const row of ticketLines(order, columns)) {
    if (row.align === 'center') chunks.push(Buffer.from([0x1b, 0x61, 0x01]));
    else chunks.push(Buffer.from([0x1b, 0x61, 0x00]));
    chunks.push(Buffer.from([0x1b, 0x45, row.bold ? 1 : 0]));
    chunks.push(Buffer.from([0x1d, 0x21, row.double ? 0x11 : 0x00]));
    chunks.push(Buffer.from(ascii(row.text) + '\\n', 'ascii'));
  }
  chunks.push(Buffer.from([0x1b, 0x45, 0, 0x1d, 0x21, 0, 0x1b, 0x61, 0]));
  if (EPSON_CUT) chunks.push(Buffer.from([0x1d, 0x56, 0x00])); // Full cut
  return Buffer.concat(chunks);
}

async function printWindows(order) {
  const file = path.join(os.tmpdir(), 'menuza-' + Date.now() + '.txt');
  const text = ticketLines(order, profile().columns).map(row => row.text).join('\\r\\n');
  await fs.writeFile(file, '\\uFEFF' + text, 'utf8');
  try {
    // Pass values through the child environment; avoids PowerShell -Command argument parsing issues.
    const script = '$content = Get-Content -LiteralPath $env:MENUZA_PRINT_FILE -Raw; if ($env:MENUZA_PRINTER_NAME) { $content | Out-Printer -Name $env:MENUZA_PRINTER_NAME } else { $content | Out-Printer }';
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      timeout: 30000,
      windowsHide: true,
      env: { ...process.env, MENUZA_PRINT_FILE: file, MENUZA_PRINTER_NAME: PRINTER_NAME }
    });
  } finally { await fs.rm(file, { force: true }); }
}

async function printNetwork(order) {
  if (!PRINTER_HOST) throw new Error('Configure PRINTER_HOST no arquivo .env do agente.');
  const data = epsonEscPos(order);
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: PRINTER_HOST, port: PRINTER_PORT, timeout: 8000 });
    socket.once('connect', () => socket.end(data));
    socket.once('close', resolve);
    socket.once('error', reject);
    socket.once('timeout', () => socket.destroy(new Error('Tempo esgotado ao conectar à impressora.')));
  });
}

async function printOrder(order) {
  if (TYPE === 'network' || TYPE === 'ethernet' || TYPE === 'wifi' || TYPE === 'epson-network') return printNetwork(order);
  if (TYPE === 'windows' || TYPE === 'usb' || TYPE === 'epson' || TYPE === 'epson-usb') return printWindows(order);
  throw new Error('PRINTER_TYPE deve ser windows/epson-usb ou network/epson-network.');
}
function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}
const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  if (req.method === 'OPTIONS') {
    if (!ALLOWED_ORIGINS.has(origin)) { res.writeHead(403); return res.end(); }
    res.writeHead(204, { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json(res, 403, { error: 'Origem não autorizada.' });
  res.setHeader('Access-Control-Allow-Origin', origin || 'null');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'GET' && req.url === '/health') return json(res, 200, {
    ok: true, printerType: TYPE, printerProfile: profile().label,
    configured: TYPE.includes('network') || TYPE === 'network' || TYPE === 'wifi' || TYPE === 'ethernet' ? Boolean(PRINTER_HOST) : true
  });
  if (req.method !== 'POST' || req.url !== '/print') return json(res, 404, { error: 'Rota não encontrada.' });
  let raw = '';
  req.on('data', chunk => { raw += chunk; if (raw.length > 250000) req.destroy(); });
  req.on('end', async () => {
    try {
      const body = JSON.parse(raw || '{}'), order = body.order;
      if (!order || !order.id || !Array.isArray(order.items) || order.items.length > 100) throw new Error('Dados da comanda inválidos.');
      if (order.status !== 'received') return json(res, 200, { ok: true, duplicate: true, skipped: true });
      const id = String(order.id);
      if (printed.has(id)) return json(res, 200, { ok: true, duplicate: true });
      await printOrder(order);
      printed.add(id);
      await saveState();
      return json(res, 200, { ok: true, printed: true, orderId: id });
    } catch (error) { return json(res, 500, { error: error.message || 'Falha ao imprimir comanda.' }); }
  });
});
server.listen(PORT, '127.0.0.1', () => console.log('[Menuza Print Agent] ativo em http://127.0.0.1:' + PORT + ' | tipo: ' + TYPE + ' | modelo: ' + profile().label));
