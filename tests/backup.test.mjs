import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = fileURLToPath(new URL('..', import.meta.url));
const scriptPath = join(projectDir, 'scripts', 'backup-menuza.mjs');

test('backup de produção exige a conexão direta do PostgreSQL Neon', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'menuza-pg-backup-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const child = spawn(process.execPath, [scriptPath], {
    cwd: projectDir,
    env: { ...process.env, DATABASE_URL_DIRECT: '', BACKUP_DIR: join(temp, 'backups') },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  assert.notEqual(exitCode, 0);
  assert.match(stderr, /DATABASE_URL_DIRECT/);
});

test('backup PostgreSQL usa pg_dump custom e valida o dump antes da retenção', async () => {
  const script = await readFile(scriptPath, 'utf8');
  const workflow = await readFile(join(projectDir, '.github', 'workflows', 'postgres-backup.yml'), 'utf8');
  assert.match(script, /pg_dump/);
  assert.match(script, /--format=custom/);
  assert.match(script, /pg_restore.*--list/);
  assert.match(script, /DATABASE_URL_DIRECT/);
  assert.match(workflow, /pg_dump/);
  assert.match(workflow, /pg_restore.*--list/);
  assert.match(workflow, /pg_restore --dbname/);
  assert.match(workflow, /retention-days: 30/);
});
