import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const projectDir = fileURLToPath(new URL('..', import.meta.url));
const scriptPath = join(projectDir, 'scripts', 'backup-menuza.mjs');

test('backup SQLite cria snapshot íntegro e aplica retenção sem tocar em arquivos não gerenciados', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'menuza-backup-'));
  const databasePath = join(temp, 'source.sqlite');
  const backupDir = join(temp, 'backups');
  await import('node:fs/promises').then(({ mkdir }) => mkdir(backupDir));
  const db = new DatabaseSync(databasePath);
  db.exec('CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT NOT NULL); INSERT INTO sample(value) VALUES (\'preservado\');');
  db.close();

  // Arquivos antigos simulam backups anteriores; só nomes gerenciados pelo script entram na retenção.
  for (const name of ['menuza-20000101-000000-000.sqlite', 'menuza-20010101-000000-000.sqlite']) {
    const old = new DatabaseSync(join(backupDir, name));
    old.exec('CREATE TABLE old_backup (id INTEGER);');
    old.close();
  }
  await import('node:fs/promises').then(({ writeFile }) => writeFile(join(backupDir, 'nao-apagar.txt'), 'keep'));
  t.after(() => rm(temp, { recursive: true, force: true }));

  const child = spawn(process.execPath, [scriptPath], {
    cwd: projectDir,
    env: { ...process.env, DATA_FILE: databasePath, BACKUP_DIR: backupDir, BACKUP_KEEP: '2' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '', stderr = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  assert.equal(exitCode, 0, stderr);
  const result = JSON.parse(stdout.trim());
  assert.equal(result.ok, true);
  assert.equal(result.integrity, 'ok');
  assert.ok(result.bytes > 0);
  assert.match(result.backup.split(/[\\/]/).pop(), /^menuza-\d{8}-\d{6}-\d{3}\.sqlite$/);
  const snapshot = new DatabaseSync(result.backup);
  try {
    assert.equal(snapshot.prepare('SELECT value FROM sample WHERE id=1').get().value, 'preservado');
    assert.equal(snapshot.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  } finally {
    snapshot.close();
  }
  const names = await readdir(backupDir);
  assert.equal(names.filter(name => /^menuza-\d{8}-\d{6}-\d{3}\.sqlite$/.test(name)).length, 2);
  assert.ok(names.includes('nao-apagar.txt'));
});

test('backup falha claramente quando o banco de origem não existe', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'menuza-backup-missing-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const child = spawn(process.execPath, [scriptPath], {
    cwd: projectDir,
    env: { ...process.env, DATA_FILE: join(temp, 'missing.sqlite'), BACKUP_DIR: join(temp, 'backups') },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  assert.notEqual(exitCode, 0);
  assert.match(stderr, /Banco não encontrado/);
});
