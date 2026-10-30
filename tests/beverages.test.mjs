import test from 'node:test';
import assert from 'node:assert/strict';
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
