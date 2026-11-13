// Backup independente do PostgreSQL de produção (Neon).
// Usa pg_dump em formato custom, valida o arquivo com pg_restore e aplica retenção local.
// O teste real de restauração em PostgreSQL isolado é executado pelo workflow postgres-backup.yml.
import { spawnSync } from 'node:child_process';
import { mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const databaseUrl = String(process.env.DATABASE_URL_DIRECT || '').trim();
const backupDir = resolve(process.env.BACKUP_DIR || resolve(ROOT, 'backups'));
const keep = Number(process.env.BACKUP_KEEP || '14');

if (!databaseUrl) throw new Error('Configure DATABASE_URL_DIRECT com a conexão direta do PostgreSQL Neon.');
if (!Number.isInteger(keep) || keep < 1 || keep > 365) throw new Error('BACKUP_KEEP precisa ser um inteiro entre 1 e 365.');

await mkdir(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').replace(/\.(\d{3})Z$/, '-$1');
const backupPath = resolve(backupDir, 'menuza-postgres-' + stamp + '.dump');

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw new Error('Não foi possível executar ' + command + '. Instale o PostgreSQL Client.');
  if (result.status !== 0) throw new Error(command + ' falhou: ' + String(result.stderr || result.stdout || 'erro desconhecido').trim().slice(0, 1200));
  return result.stdout || '';
}

try {
  run('pg_dump', [databaseUrl, '--format=custom', '--no-owner', '--no-acl', '--file=' + backupPath]);
  run('pg_restore', ['--list', backupPath]);
  const details = await stat(backupPath);
  if (!details.size) throw new Error('O arquivo de backup PostgreSQL ficou vazio.');

  const pattern = /^menuza-postgres-\d{8}-\d{6}-\d{3}\.dump$/;
  const entries = (await readdir(backupDir, { withFileTypes: true }))
    .filter(entry => entry.isFile() && pattern.test(entry.name))
    .sort((a, b) => b.name.localeCompare(a.name));
  for (const entry of entries.slice(keep)) await unlink(resolve(backupDir, entry.name));

  process.stdout.write(JSON.stringify({
    ok: true,
    backup: backupPath,
    bytes: details.size,
    format: 'postgres-custom',
    validated: 'pg_restore --list',
    retained: Math.min(entries.length, keep)
  }) + '\n');
} catch (error) {
  await unlink(backupPath).catch(() => {});
  throw error;
}
