import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFoodLayout } from '../public/food-models.js';

const pizza = { id: 'pizza-teste', type: 'pizza', widthCm: 35, heightCm: 2 };

function assertToppingBuilds(layout, kind) {
  const topping = layout.parts.find(part => part.kind === kind);
  assert.ok(topping, `cobertura ${kind} deve existir`);
  const geometry = topping.build();
  assert.ok(geometry.positions.length > 0, `cobertura ${kind} deve gerar geometria`);
  assert.ok(geometry.positions.every(Number.isFinite), `cobertura ${kind} não pode gerar coordenadas inválidas`);
}

test('manjericão possui uma cobertura 3D própria e reconhece o nome em português', () => {
  const layout = buildFoodLayout(pizza, [
    { id: 'manjericao', name: 'Manjericão', quantity: 1 }
  ], { diameterCm: 35 }, { detail: 0.45 });

  assertToppingBuilds(layout, 'topping:manjericao');
  assert.ok(!layout.parts.some(part => part.kind === 'topping:oregano'));
});

test('manjericão é reconhecido mesmo quando o identificador do ingrediente é personalizado', () => {
  const layout = buildFoodLayout(pizza, [
    { id: 'fresh-basil', name: 'Manjericão fresco', quantity: 2 }
  ], { diameterCm: 35 }, { detail: 0.45 });

  assert.ok(layout.parts.some(part => part.kind === 'topping:manjericao'));
});

test('calabresa continua sendo montada como uma cobertura única com quantidade configurável', () => {
  const layout = buildFoodLayout(pizza, [
    { id: 'calabresa', name: 'Calabresa', quantity: 3 }
  ], { diameterCm: 35 }, { detail: 0.45 });

  assertToppingBuilds(layout, 'topping:calabresa');
});
