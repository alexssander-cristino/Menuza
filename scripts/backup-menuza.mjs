import { DatabaseSync } from 'node:sqlite';
import { mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = resolve(process.env.DATA_FILE || resolve(ROOT, 'data', 'mesa.sqlite'));
const backupDir = resolve(process.env.BACKUP_DIR || resolve(ROOT, 'backups'));
const keepRaw = process.env.BACKUP_KEEP || '14';
const keep = Number(keepRaw);

if (!Number.isInteger(keep) || keep < 1 || keep > 365) {
  throw new Error('BACKUP_KEEP precisa ser um inteiro entre 1 e 365.');
}
if (!existsSync(sourcePath)) {
  throw new Error('Banco não encontrado em ' + sourcePath + '. Inicie o Menuza ou informe DATA_FILE.');
}
if (resolve(sourcePath) === resolve(backupDir) || resolve(backupDir).startsWith(resolve(sourcePath) + '/')) {
  throw new Error('BACKUP_DIR não pode ser o próprio arquivo do banco nem um caminho dentro dele.');
}

await mkdir(backupDir, { recursive: true });
const source = new DatabaseSync(sourcePath);
let backupPath = '';
try {
  const integrity = source.prepare('PRAGMA integrity_check').all();
  if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') {
    throw new Error('O banco de origem falhou no integrity_check; backup cancelado.');
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').replace(/Z$/, '');
  backupPath = resolve(backupDir, 'menuza-' + stamp + '.sqlite');
  // VACUUM INTO cria um snapshot consistente, incluindo alterações ainda no WAL.
  const escapedPath = backupPath.replace(/'/g, "''");
  source.exec("VACUUM INTO '" + escapedPath + "'");
} finally {
  source.close();
}

const snapshot = new DatabaseSync(backupPath);
try {
  const integrity = snapshot.prepare('PRAGMA integrity_check').all();
  if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') {
    throw new Error('O arquivo de backup foi criado, mas falhou na verificação de integridade.');
  }
} finally {
  snapshot.close();
}

const backupPattern = /^menuza-\d{8}-\d{6}-\d{3}\.sqlite$/;
const entries = (await readdir(backupDir, { withFileTypes: true }))
  .filter(entry => entry.isFile() && backupPattern.test(entry.name))
  .sort((a, b) => b.name.localeCompare(a.name));
for (const entry of entries.slice(keep)) {
  await unlink(resolve(backupDir, entry.name));
}
const details = await stat(backupPath);
process.stdout.write(JSON.stringify({
  ok: true,
  backup: backupPath,
  bytes: details.size,
  integrity: 'ok',
  retained: Math.min(entries.length, keep),
  source: basename(sourcePath)
}) + '\n');
