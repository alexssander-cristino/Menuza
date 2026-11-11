import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateItemPrice } from '../src/catalog.mjs';

const catalog = [
  { id: 'mussarela', name: 'Mussarela', type: 'pizza', cents: 250, included: true, active: 1 },
  { id: 'bacon', name: 'Bacon', type: 'pizza', cents: 350, included: false, active: 1 }
];

const product = {
  id: 'pizza-teste',
  name: 'Pizza teste',
  type: 'pizza',
  baseCents: 3000,
  sizePrices: { individual: 3900, media: 5200, grande: 6500, familia: 7900 },
  ingredientsConfigured: true,
  defaultIngredientIds: ['mussarela'],
  ingredientIds: ['bacon']
};

test('uses the exact price configured for the selected size', () => {
  const result = calculateItemPrice({
    product,
    sizeKey: 'grande',
    crustKey: 'tradicional',
    ingredients: [],
    catalog
  });
  assert.equal(result.unitPriceCents, 6500);
  assert.equal(result.size.priceCents, 6500);
});

test('keeps required recipe ingredients even when the client omits them', () => {
  const result = calculateItemPrice({
    product,
    sizeKey: 'media',
    crustKey: 'tradicional',
    ingredients: [{ id: 'bacon', quantity: 2 }],
    catalog
  });
  assert.deepEqual(result.ingredients.map(item => item.id), ['bacon', 'mussarela']);
  assert.equal(result.ingredients.find(item => item.id === 'mussarela').included, true);
  assert.equal(result.unitPriceCents, 5900);
});

test('does not allow the required recipe ingredient quantity to be changed', () => {
  assert.throws(() => calculateItemPrice({
    product,
    sizeKey: 'media',
    crustKey: 'tradicional',
    ingredients: [{ id: 'mussarela', quantity: 2 }],
    catalog
  }), /quantidade desse componente não pode ser alterada/i);
});
