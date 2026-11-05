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
  const basil = layout.parts.find(part => part.kind === 'topping:manjericao').build();
  assert.ok(basil.box[3] - basil.box[0] > 0.06 || basil.box[5] - basil.box[2] > 0.06,
    'as folhas de manjericão devem ter pelo menos 6 cm de comprimento visível');
  assert.ok(basil.box[4] > 0.009, 'as folhas devem ficar acima da superfície do queijo, não embutidas nela');
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

test('ingredientes com a palavra conserva não são confundidos com ervas/orégano', () => {
  const layout = buildFoodLayout(pizza, [
    { id: 'conserva-pimenta', name: 'Conserva de pimenta', groupName: 'Conservas', quantity: 1 }
  ], { diameterCm: 35 }, { detail: 0.45 });

  assert.ok(!layout.parts.some(part => part.kind === 'topping:oregano'),
    'conserva não pode ser classificada como erva por coincidência de substring');
  assert.ok(layout.parts.some(part => part.kind.startsWith('topping:')),
    'o ingrediente cadastrado deve continuar gerando uma cobertura 3D');
});

test('chocolate não herda a representação de erva do cadastro', () => {
  const layout = buildFoodLayout(pizza, [
    { id: 'ingrediente-82', name: 'Chocolate', visual_key: 'herb', groupName: 'Ervas', quantity: 1 }
  ], { diameterCm: 35 }, { detail: 0.45 });

  assertToppingBuilds(layout, 'topping:chocolate');
  assert.ok(!layout.parts.some(part => part.kind === 'topping:oregano'),
    'o nome Chocolate deve prevalecer sobre visual_key e grupo herdados');
});

test('chocolate é uma camada cremosa contínua, não cobertura em pedaços', () => {
  const layout = buildFoodLayout(pizza, [
    { id: 'chocolate', name: 'Chocolate cremoso', quantity: 1 }
  ], { diameterCm: 35 }, { detail: 0.45 });

  const cream = layout.parts.find(part => part.kind === 'chocolate-cream');
  assert.ok(cream, 'chocolate deve gerar uma camada cremosa contínua');
  assert.ok(!layout.parts.some(part => part.kind === 'topping:chocolate'),
    'chocolate não deve ser montado como pedaços isolados');
  const geometry = cream.build();
  assert.ok(geometry.positions.length > 0);
  assert.ok(geometry.positions.every(Number.isFinite));
});

test('chocolates cadastrados com IDs diferentes aparecem juntos em uma única cobertura', () => {
  const layout = buildFoodLayout(pizza, [
    { id: 'ingrediente-ao-leite-18', name: 'Chocolate ao leite', visual_key: 'herb', groupName: 'Ervas', quantity: 1 },
    { id: 'ingrediente-branco-29', name: 'Chocolate branco', visual_key: 'oregano', groupName: 'Temperos', quantity: 1 },
    { id: 'ganache-30', name: 'Ganache de chocolate', visual_key: 'basil', quantity: 1 }
  ], { diameterCm: 35 }, { detail: 0.45 });

  const creams = layout.parts.filter(part => part.kind === 'chocolate-cream');
  assert.equal(creams.length, 1, 'todos os chocolates devem compartilhar uma única camada');
  assert.ok(!layout.parts.some(part => /^topping:(chocolate|white-chocolate)$/.test(part.kind)),
    'nenhum chocolate pode virar pedaço isolado');
  assert.ok(!layout.parts.some(part => part.kind === 'topping:oregano' || part.kind === 'topping:manjericao'),
    'visual_key e grupo incorretos não podem transformar chocolate em erva');
  const geometry = creams[0].build();
  assert.ok(geometry.positions.length > 0);
  assert.ok(geometry.positions.every(Number.isFinite));
});

test('mussarela gera uma cobertura contínua com tom quente, sem branco puro', () => {
  const layout = buildFoodLayout(pizza, [
    { id: 'molho-tomate', name: 'Molho de tomate', quantity: 1 },
    { id: 'mussarela', name: 'Mussarela', quantity: 1 }
  ], { diameterCm: 35 }, { detail: 0.45 });

  const cheese = layout.parts.find(part => part.kind === 'cheese');
  assert.ok(cheese, 'a base de mussarela deve existir');
  const geometry = cheese.build();
  assert.ok(geometry.positions.length > 0);
  assert.ok(geometry.colors.length > 0);
  const count = geometry.colors.length / 3;
  const avg = [0, 1, 2].map(channel => {
    let total = 0;
    for (let i = channel; i < geometry.colors.length; i += 3) total += geometry.colors[i];
    return total / count;
  });
  assert.ok(avg[0] > avg[2], 'mussarela deve ter um tom creme quente, não branco azulado');
  assert.ok(avg[0] < 0.95 && avg[1] < 0.90, 'mussarela não pode ficar próxima do branco puro');
});
