import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculateItemPrice, SIZE_OPTIONS } from '../src/catalog.mjs';
import { buildFoodLayout } from '../public/food-models.js';

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

test('bebidas recebem modelos 3D próprios para lata, garrafa e copo', () => {
  const cases = [
    [{ id: 'refrigerante-cola-lata', name: 'Refrigerante cola lata 350 ml', type: 'drink' }, 'drink-can', false],
    [{ id: 'agua-500ml', name: 'Água sem gás 500 ml', type: 'drink' }, 'drink-bottle', false],
    [{ id: 'suco-laranja', name: 'Suco de laranja natural', type: 'drink' }, 'drink-glass', true]
  ];
  for (const [product, vessel, hasVisibleLiquid] of cases) {
    const layout = buildFoodLayout(product, [], SIZE_OPTIONS.drink[0], { detail: 0.4 });
    assert.equal(layout.type, 'drink');
    assert.ok(layout.parts.some(part => part.kind === vessel), product.name + ' deve ter seu recipiente');
    assert.equal(layout.parts.some(part => part.kind === 'drink-liquid'), hasVisibleLiquid,
      product.name + ' deve expor o líquido apenas quando o recipiente permitir');
    for (const part of layout.parts) {
      const geometry = part.build();
      assert.ok(geometry.positions.length > 0, product.name + ' deve gerar geometria em ' + part.kind);
      assert.ok(geometry.positions.every(Number.isFinite));
      assert.ok(geometry.materials.every(Number.isFinite));
    }
  }
});

test('arquivos JavaScript do fluxo de bebidas passam pela verificação de sintaxe', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  for (const file of ['public/app.js', 'api/[...path].mjs', 'src/catalog.mjs']) {
    execFileSync(process.execPath, ['--check', resolve(root, file)], { stdio: 'pipe' });
  }
});
