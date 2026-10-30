import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculateItemPrice, SIZE_OPTIONS } from '../src/catalog.mjs';

test('bebidas usam uma unidade sem adicionais ou personalização', () => {
  assert.deepEqual(SIZE_OPTIONS.drink, [{ key: 'unico', label: 'Unidade', deltaCents: 0 }]);
  const priced = calculateItemPrice({
    product: { id: 'agua-500ml', type: 'drink', baseCents: 450 },
    sizeKey: 'unico',
    ingredients: [],
    quantity: 2,
    catalog: []
  });
  assert.equal(priced.unitPriceCents, 450);
  assert.equal(priced.linePriceCents, 900);
  assert.deepEqual(priced.ingredients, []);
  assert.equal(priced.crust, null);
});

test('arquivos JavaScript do fluxo de bebidas passam pela verificação de sintaxe', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  for (const file of ['public/app.js', 'api/[...path].mjs', 'src/catalog.mjs']) {
    execFileSync(process.execPath, ['--check', resolve(root, file)], { stdio: 'pipe' });
  }
});
