import test from 'node:test';
// Testes de integração do visualizador 3D: validam montagem, dimensões e geometria dos alimentos.
import assert from 'node:assert/strict';
import { inferIngredientVisual, INGREDIENTS, SIZE_OPTIONS } from '../src/catalog.mjs';
import { buildFoodLayout, buildFoodGeometry } from '../public/food-models.js';

const ing = (ids, qty = {}) => ids.map(id => ({ ...INGREDIENTS.find(item => item.id === id), quantity: qty[id] || 1 }));
const burger = { id: 'burger-casa', type: 'burger', widthCm: 12, depthCm: 12, heightCm: 10 };
const pizza = { id: 'pizza-calabresa', type: 'pizza', widthCm: 30, depthCm: 30, heightCm: 2 };
const plate = { id: 'batatas', type: 'plate', widthCm: 20, depthCm: 20, heightCm: 4 };
const BURGER = ['pao-brioche', 'carne', 'queijo-cheddar', 'alface', 'tomate-burger', 'molho-especial'];
const PIZZA = ['molho-tomate', 'mussarela', 'calabresa'];
const keys = layout => new Map(layout.parts.map(p => [p.kind + '#' + p.key, p]));

test('hambúrguer: adicionar bacon só cria a peça nova e mantém as camadas de baixo intactas', () => {
  const a = buildFoodLayout(burger, ing(BURGER), { key: 'classico' }), b = buildFoodLayout(burger, ing([...BURGER, 'bacon-burger']), { key: 'classico' });
  const ka = keys(a), kb = keys(b);
  const added = [...kb.keys()].filter(k => !ka.has(k)), removed = [...ka.keys()].filter(k => !kb.has(k));
  assert.equal(added.length, 1);
  assert.ok(added[0].startsWith('bacon#'));
  assert.deepEqual(removed, []);
  const baconIndex = b.parts.findIndex(p => p.kind === 'bacon'), below = b.parts.slice(0, baconIndex);
  assert.ok(below.length >= 5);
  for (const p of below) assert.equal(ka.get(p.kind + '#' + p.key)?.y, p.y, `${p.kind} não deveria se mover`);
  const top = b.parts.find(p => p.kind === 'bun-top'), topBefore = a.parts.find(p => p.kind === 'bun-top');
  assert.ok(top.y > topBefore.y, 'o pão superior sobe para abrir espaço ao bacon');
});

test('hambúrguer: remover ingrediente retira a peça e as camadas acima descem', () => {
  const full = buildFoodLayout(burger, ing(BURGER), { key: 'classico' }), noTomato = buildFoodLayout(burger, ing(BURGER.filter(id => id !== 'tomate-burger')), { key: 'classico' });
  assert.ok(full.parts.some(p => p.kind === 'tomato'));
  assert.ok(!noTomato.parts.some(p => p.kind === 'tomato'));
  assert.ok(noTomato.parts.find(p => p.kind === 'bun-top').y < full.parts.find(p => p.kind === 'bun-top').y);
});

test('hambúrguer: peças nunca se sobrepõem de forma incoerente (ordem de empilhamento crescente)', () => {
  const l = buildFoodLayout(burger, ing([...BURGER, 'bacon-burger', 'ovo', 'cebola-burger', 'picles', 'queijo-extra']), { key: 'duplo' });
  const ys = l.parts.filter(p => !p.base).map(p => p.y);
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] >= ys[i - 1] - .0016, 'as camadas sobem na ordem de montagem');
  assert.equal(l.parts.filter(p => p.kind === 'patty').length, 2);
  assert.ok(l.parts.filter(p => p.kind === 'cheese').length >= 2);
});

test('hambúrguer: quantidade maior de um ingrediente produz peça e altura proporcionais', () => {
  const one = buildFoodLayout(burger, ing(BURGER), { key: 'classico' }), three = buildFoodLayout(burger, ing(BURGER, { alface: 3 }), { key: 'classico' });
  assert.ok(three.hint.maxY > one.hint.maxY);
  assert.notEqual(one.parts.find(p => p.kind === 'lettuce').key, three.parts.find(p => p.kind === 'lettuce').key);
});

test('pizza: trocar a massa reconstrói somente a crosta; coberturas permanecem em cache quando não há dependência', () => {
  const size = SIZE_OPTIONS.pizza[1], a = buildFoodLayout(pizza, ing(PIZZA), size, { crustKey: 'tradicional' }), b = buildFoodLayout(pizza, ing(PIZZA), size, { crustKey: 'recheada' });
  assert.notEqual(a.parts.find(p => p.kind === 'dough').key, b.parts.find(p => p.kind === 'dough').key);
  assert.deepEqual(a.parts.filter(p => p.kind === 'topping:calabresa').length, 1);
});

test('pizza: adicionar uma cobertura de prioridade menor não reconstrói as anteriores', () => {
  const size = SIZE_OPTIONS.pizza[1], a = buildFoodLayout(pizza, ing(PIZZA), size), b = buildFoodLayout(pizza, ing([...PIZZA, 'oregano']), size);
  const ka = new Set(a.parts.map(p => p.key)), added = b.parts.filter(p => !ka.has(p.key));
  assert.deepEqual(added.map(p => p.kind), ['topping:oregano']);
});

test('pizza: sem molho ou sem queijo o modelo remove só aquela camada', () => {
  const size = SIZE_OPTIONS.pizza[1];
  assert.ok(!buildFoodLayout(pizza, ing(['mussarela', 'calabresa']), size).parts.some(p => p.kind === 'sauce'));
  assert.ok(!buildFoodLayout(pizza, ing(['molho-tomate', 'calabresa']), size).parts.some(p => p.kind === 'cheese'));
});

test('pizza: o diâmetro escolhido define a escala real e a quantidade de ingredientes escala com a área', () => {
  const small = buildFoodGeometry(pizza, ing(PIZZA), SIZE_OPTIONS.pizza[0], { detail: .5 }), big = buildFoodGeometry(pizza, ing(PIZZA), SIZE_OPTIONS.pizza[3], { detail: .5 });
  assert.equal(small.bounds[0], .2);
  assert.equal(big.bounds[0], .4);
  assert.ok(big.extent[3] - big.extent[0] > (small.extent[3] - small.extent[0]) * 1.8);
});

test('hot dog: o pão aumenta de largura e altura conforme a quantidade de recheio', () => {
  const hotdog = { id: 'hotdog-volume', type: 'plate', widthCm: 20, depthCm: 8, heightCm: 5 };
  const light = buildFoodLayout(hotdog, [
    { id: 'salsicha', name: 'Salsicha', quantity: 1 },
    { id: 'bacon', name: 'Bacon', quantity: 1 }
  ], { key: 'hotdog' }).parts.find(part => part.kind === 'hotdog-bun').build();
  const loaded = buildFoodLayout(hotdog, [
    { id: 'salsicha', name: 'Salsicha', quantity: 1 },
    { id: 'bacon', name: 'Bacon', quantity: 4 },
    { id: 'queijo', name: 'Queijo', quantity: 3 },
    { id: 'batata-palha', name: 'Batata palha', quantity: 3 },
    { id: 'milho', name: 'Milho', quantity: 2 }
  ], { key: 'hotdog' }).parts.find(part => part.kind === 'hotdog-bun').build();
  assert.ok(loaded.box[5] - loaded.box[2] > light.box[5] - light.box[2], 'o pão deve ficar mais largo');
  assert.ok(loaded.box[4] - loaded.box[1] > light.box[4] - light.box[1], 'o pão deve ficar mais alto');
});

test('hot dog: pão oval único, salsicha longa e molhos separados', () => {
  const hotdog = { id: 'hotdog-classico', type: 'plate', widthCm: 20, depthCm: 8, heightCm: 5 };
  const layout = buildFoodLayout(hotdog, [
    { id: 'salsicha', name: 'Salsicha', quantity: 1 },
    { id: 'ketchup', name: 'Ketchup', quantity: 1 },
    { id: 'mostarda', name: 'Mostarda', quantity: 1 },
    { id: 'maionese', name: 'Maionese', quantity: 1 }
  ], { key: 'hotdog' });
  const kinds = layout.parts.map(part => part.kind);
  assert.ok(kinds.includes('hotdog-bun'), 'o pão deve ser uma peça única, oval e abaulada');
  assert.ok(!kinds.includes('hotdog-bun-wall-left') && !kinds.includes('hotdog-bun-wall-right'), 'não deve haver laterais artificiais separadas');
  assert.ok(kinds.includes('hotdog-sausage'), 'a salsicha deve existir');
  assert.ok(kinds.includes('hotdog-ketchup') && kinds.includes('hotdog-mustard') && kinds.includes('hotdog-mayo'), 'cada molho selecionado deve ter sua própria faixa');
  const sausage = layout.parts.find(part => part.kind === 'hotdog-sausage');
  const geometry = sausage.build();
  assert.ok(geometry.box[3] - geometry.box[0] > (geometry.box[5] - geometry.box[2]) * 5, 'a salsicha deve ser longa e fina');
});

test('geometria: sem NaN, normais unitárias e índices válidos em todos os produtos', () => {
  const cases = [
    [burger, ing([...BURGER, 'bacon-burger', 'ovo']), { key: 'duplo' }, {}],
    [pizza, ing([...PIZZA, 'cebola', 'tomate', 'champignon', 'azeitona', 'milho', 'requeijao', 'frango', 'bacon', 'oregano']), SIZE_OPTIONS.pizza[2], { crustKey: 'fina' }],
    [plate, [], { key: 'unico' }, {}]
  ];
  for (const [product, ingredients, size, options] of cases) {
    const g = buildFoodGeometry(product, ingredients, size, { ...options, detail: .55 }).geometry, n = g.positions.length / 3;
    for (const array of [g.positions, g.normals, g.colors, g.materials]) for (const v of array) assert.ok(Number.isFinite(v), `${product.type}: valor inválido`);
    for (let i = 0; i < g.normals.length; i += 3) assert.ok(Math.abs(Math.hypot(g.normals[i], g.normals[i + 1], g.normals[i + 2]) - 1) < 1e-3, `${product.type}: normal não unitária`);
    for (const i of g.indices) assert.ok(i < n);
    assert.equal(g.indices.length % 3, 0);
  }
});

test('geometria: dimensões cadastradas do hambúrguer clássico são respeitadas', () => {
  const g = buildFoodGeometry(burger, ing(BURGER), { key: 'classico' }, { detail: .55 });
  assert.ok(Math.abs(g.extent[4] - .1) < .004, `altura ${g.extent[4]}`);
  assert.ok(g.extent[3] - g.extent[0] < .2);
});

test('geometria é determinística: o mesmo pedido gera o mesmo modelo', () => {
  const a = buildFoodGeometry(pizza, ing(PIZZA), SIZE_OPTIONS.pizza[1], { detail: .5 }), b = buildFoodGeometry(pizza, ing(PIZZA), SIZE_OPTIONS.pizza[1], { detail: .5 });
  assert.equal(a.geometry.positions.length, b.geometry.positions.length);
  assert.deepEqual(a.geometry.positions.slice(0, 300), b.geometry.positions.slice(0, 300));
});


test('pizza: ingredientes personalizados usam o campo visual e preenchem a base no modelo 3D', () => {
  const custom = [
    { id: 'base-da-casa-01', name: 'Molho especial da casa', type: 'pizza', visual: 'sauce', quantity: 1 },
    { id: 'queijo-da-casa-02', name: 'Queijo artesanal', type: 'pizza', visual: 'cheese', quantity: 1 },
    { id: 'cobertura-da-casa-03', name: 'Calabresa premium', type: 'pizza', visual: 'pepperoni', quantity: 1 }
  ];
  const layout = buildFoodLayout(pizza, custom, SIZE_OPTIONS.pizza[1]);
  const kinds = layout.parts.map(part => part.kind);
  assert.ok(kinds.includes('dough'), 'a massa deve existir mesmo sem ingrediente adicional');
  assert.ok(kinds.includes('sauce'), 'o molho personalizado deve preencher a massa');
  assert.ok(kinds.includes('topping:queijo-generico'), 'o queijo personalizado deve gerar uma cobertura própria');
  assert.ok(kinds.includes('topping:calabresa'), 'a cobertura personalizada deve aparecer');
});


test('ingredientes cadastrados no painel recebem visuais específicos para cada queijo', () => {
  const custom = (name, groupName = 'Queijos') => inferIngredientVisual({ id: 'ing-custom', name, type: 'pizza', groupName });
  assert.equal(custom('Queijo artesanal'), 'cheese');
  assert.equal(custom('Mussarela'), 'mozzarella');
  assert.equal(custom('Cheddar inglês'), 'cheddar');
  assert.equal(custom('Parmesão ralado'), 'parmesan');
  assert.equal(custom('Gorgonzola'), 'gorgonzola');
  assert.equal(custom('Provolone'), 'provolone');
  assert.equal(custom('Catupiry cremoso'), 'catupiry');
  assert.equal(custom('Requeijão tradicional'), 'cheese');
  assert.equal(custom('Leite condensado'), 'condensed-milk');
  assert.equal(custom('Creme de leite'), 'cream');
  assert.equal(inferIngredientVisual({ id: 'burger-cheese', name: 'Gorgonzola', type: 'burger', groupName: 'Queijos' }), 'gorgonzola');
  assert.equal(inferIngredientVisual({ id: 'burger-catupiry', name: 'Catupiry', type: 'burger', groupName: 'Queijos' }), 'cheese');
  assert.equal(inferIngredientVisual({ id: 'burger-cheese', name: 'Parmesão', type: 'burger', groupName: 'Queijos' }), 'parmesan');
  assert.equal(inferIngredientVisual({ id: 'ing-101', name: 'Molho especial da casa', type: 'pizza', groupName: 'Molhos' }), 'sauce');
  assert.equal(inferIngredientVisual({ id: 'ing-103', name: 'Calabresa premium', type: 'pizza', groupName: 'Carnes' }), 'pepperoni');
  assert.equal(inferIngredientVisual({ id: 'ing-104', name: 'Orégano fresco', type: 'pizza', groupName: 'Temperos' }), 'herb');
  assert.equal(inferIngredientVisual({ id: 'ing-201', name: 'Blend bovino', type: 'burger', groupName: 'Carnes' }), 'patty');
  assert.equal(inferIngredientVisual({ id: 'ing-202', name: 'Alface americana', type: 'burger', groupName: 'Vegetais' }), 'lettuce');
});

test('pizza: somente cheddar e catupiry usam creme de bisnaga; outros queijos mantêm peças', () => {
  const cases = [
    ['Queijo artesanal', 'cheese'],
    ['Cheddar inglês', 'cheddar'],
    ['Catupiry cremoso', 'catupiry'],
    ['Parmesão ralado', 'parmesan'],
    ['Gorgonzola', 'gorgonzola'],
    ['Provolone', 'provolone']
  ];
  for (const [name, visual] of cases) {
    const item = { id: 'custom-' + visual, name, type: 'pizza', visual, quantity: 1 };
    const layout = buildFoodLayout(pizza, [item], SIZE_OPTIONS.pizza[1]);
    const expectedKind = visual === 'catupiry' ? 'topping:catupiry' : 'topping:queijo-' + ({ cheese: 'generico', cheddar: 'cheddar', parmesan: 'parmesao', gorgonzola: 'gorgonzola', provolone: 'provolone' }[visual]);
    assert.ok(layout.parts.some(part => part.kind === expectedKind), name + ' deve gerar sua cobertura (' + expectedKind + ')');
    assert.equal(layout.parts.some(part => part.kind === 'cheese'), false, name + ' não deve usar a camada de mussarela');
    const geometry = buildFoodGeometry(pizza, [item], SIZE_OPTIONS.pizza[1], { detail: .45 }).geometry;
    assert.ok(geometry.positions.length > 0, name + ' deve produzir geometria');
    assert.ok(geometry.positions.every(Number.isFinite), name + ' não pode produzir coordenadas inválidas');
  }
});


test('hambúrguer: o tipo do queijo personalizado preserva sua camada original sobre a carne', () => {
  for (const [name, visual, expected] of [
    ['Mussarela', 'mozzarella', 'mozzarella'],
    ['Cheddar', 'cheddar', 'cheddar'],
    ['Parmesão', 'parmesan', 'parmesan'],
    ['Gorgonzola', 'gorgonzola', 'gorgonzola'],
    ['Provolone', 'provolone', 'provolone'],
    ['Queijo artesanal', 'cheese', 'generic']
  ]) {
    const item = { id: 'burger-' + visual, name, type: 'burger', visual, quantity: 1 };
    const layout = buildFoodLayout(burger, [...ing(['carne']), item], { key: 'classico' });
    const cheese = layout.parts.find(part => part.kind === 'cheese');
    assert.ok(cheese, name + ' deve gerar uma camada de queijo');
    assert.ok(cheese.key.includes(expected), name + ' deve preservar o tipo do queijo');
  }
});

test('pizza: cheddar e catupiry usam coberturas contínuas em bisnaga e não alteram os lanches', () => {
  const cheddar = buildFoodLayout(pizza, [{ id: 'custom-cheddar', name: 'Cheddar', type: 'pizza', visual: 'cheddar' }], SIZE_OPTIONS.pizza[1]);
  const catupiry = buildFoodLayout(pizza, [{ id: 'custom-catupiry', name: 'Catupiry', type: 'pizza', visual: 'catupiry' }], SIZE_OPTIONS.pizza[1]);
  assert.ok(cheddar.parts.some(part => part.kind === 'topping:queijo-cheddar'));
  assert.ok(catupiry.parts.some(part => part.kind === 'topping:catupiry'));
  const requeijao = buildFoodLayout(pizza, [{ id: 'custom-requeijao', name: 'Requeijão', type: 'pizza', visual: 'cheese' }], SIZE_OPTIONS.pizza[1]);
  assert.ok(requeijao.parts.some(part => part.kind === 'topping:queijo-generico'), 'requeijão genérico deve usar pedaços');
  const burgerLayout = buildFoodLayout(burger, [...ing(['carne']), { id: 'burger-cheddar', name: 'Cheddar', type: 'burger', visual: 'cheddar' }], { key: 'classico' });
  assert.ok(burgerLayout.parts.some(part => part.kind === 'cheese'));
});

test('pizza: todos os ingredientes de cobertura continuam presentes e geram geometria', () => {
  const ids = ['calabresa', 'bacon', 'frango', 'cebola', 'tomate', 'milho', 'azeitona', 'champignon', 'requeijao', 'oregano', 'queijo-generico', 'queijo-cheddar', 'catupiry', 'queijo-parmesao', 'queijo-gorgonzola', 'queijo-provolone'];
  const ingredients = ids.map(id => ({ id, name: id, type: 'pizza', quantity: 1 }));
  const layout = buildFoodLayout(pizza, ingredients, SIZE_OPTIONS.pizza[1]);
  for (const id of ids) assert.ok(layout.parts.some(part => part.kind === 'topping:' + id), id + ' deve continuar visível no modelo');
  const geometry = buildFoodGeometry(pizza, ingredients, SIZE_OPTIONS.pizza[1], { detail: .35 }).geometry;
  assert.ok(geometry.positions.length > 0);
  assert.ok(geometry.positions.every(Number.isFinite));
});


test('hot dog: molho de tomate não pode virar fatias de tomate', () => {
  const hotdog = { id: 'hotdog-molho-tomate', type: 'plate', widthCm: 20, depthCm: 8, heightCm: 5 };
  const layout = buildFoodLayout(hotdog, [
    { id: 'molho-tomate-casa', name: 'Molho de tomate', quantity: 1 }
  ], { key: 'hotdog' });
  assert.ok(layout.parts.some(part => part.kind === 'hotdog-tomato-sauce-0'));
  assert.ok(!layout.parts.some(part => part.kind === 'hotdog-tomato'));
});

test('hot dog: bacon e calabresa têm peças visuais separadas', () => {
  const hotdog = { id: 'hotdog-carnes', type: 'plate', widthCm: 20, depthCm: 8, heightCm: 5 };
  const layout = buildFoodLayout(hotdog, [
    { id: 'bacon-01', name: 'Bacon', quantity: 2 },
    { id: 'calabresa-01', name: 'Calabresa', quantity: 1 }
  ], { key: 'hotdog' });
  assert.ok(layout.parts.some(part => part.kind === 'hotdog-bacon'));
  assert.ok(layout.parts.some(part => part.kind === 'hotdog-calabresa'));
});

test('hot dog: pimenta do reino não pode ser confundida com tomate', () => {
  const hotdog = { id: 'hotdog-tempero', type: 'plate', widthCm: 20, depthCm: 8, heightCm: 5 };
  const layout = buildFoodLayout(hotdog, [
    { id: 'pimenta-reino', name: 'Pimenta do reino', quantity: 1 }
  ], { key: 'hotdog' });
  assert.ok(!layout.parts.some(part => part.kind === 'hotdog-tomato'));
});


test('hot dog: ingredientes de cadastro livre não herdam visual de batata nem viram creme branco', () => {
  assert.equal(inferIngredientVisual({ id: 'abacaxi-custom', name: 'Abacaxi', type: 'plate', groupName: 'Adicionais' }), 'custom');
  assert.equal(inferIngredientVisual({ id: 'molho-ketchup', name: 'Ketchup', type: 'plate', groupName: 'Molhos' }), 'ketchup');
  const hotdog = { id: 'hotdog-custom', type: 'plate', widthCm: 20, depthCm: 8, heightCm: 5 };
  const layout = buildFoodLayout(hotdog, [
    { id: 'abacaxi-custom', name: 'Abacaxi', visual_key: 'custom', quantity: 1 }
  ], { key: 'hotdog' });
  assert.ok(layout.parts.some(part => part.kind === 'hotdog-custom-0'));
  const custom = layout.parts.find(part => part.kind === 'hotdog-custom-0').build();
  assert.ok(custom.positions.length > 0);
});


test('hambúrguer: nome do ingrediente prevalece sobre visual genérico de queijo', () => {
  const cases = [
    [{ id: 'alface-crocante', name: 'Alface crocante', type: 'burger', visual: 'cheese', groupName: 'Vegetais' }, 'alface'],
    [{ id: 'tomate-fresco', name: 'Tomate fresco', type: 'burger', visual: 'cheese', groupName: 'Vegetais' }, 'tomate-burger'],
    [{ id: 'bacon-defumado', name: 'Bacon defumado', type: 'burger', visual: 'cheese', groupName: 'Favoritos' }, 'bacon-burger'],
    [{ id: 'molho-especial-casa', name: 'Molho especial da casa', type: 'burger', visual: 'cheese', groupName: 'Molhos' }, 'molho-especial'],
    [{ id: 'queijo-cheddar-caseiro', name: 'Queijo cheddar', type: 'burger', visual: 'lettuce', groupName: 'Queijos' }, 'queijo-cheddar']
  ];
  for (const [ingredient, expected] of cases) {
    const layout = buildFoodLayout(burger, [ingredient], { key: 'classico' });
    assert.ok(layout.parts.some(part => part.kind === (expected === 'queijo-cheddar' ? 'cheese' : expected === 'alface' ? 'lettuce' : expected === 'tomate-burger' ? 'tomato' : expected === 'bacon-burger' ? 'bacon' : 'sauce')), ingredient.name + ' deve gerar ' + expected);
  }
});

test('hambúrguer: ingrediente personalizado desconhecido não vira queijo', () => {
  const layout = buildFoodLayout(burger, [
    { id: 'abacaxi-da-casa', name: 'Abacaxi grelhado', type: 'burger', visual: 'cheese', groupName: 'Adicionais', quantity: 2 }
  ], { key: 'classico' });
  assert.ok(layout.parts.some(part => part.kind.startsWith('custom:burger-custom-')));
  assert.equal(layout.parts.filter(part => part.kind === 'cheese').length, 0);
});


test('materiais 3D mantêm rugosidade e microtextura específicas por alimento', () => {
  const assertMaterial = (part, label, minRoughness, minBump) => {
    assert.ok(part, label + ' deve continuar presente');
    const geometry = part.build();
    assert.ok(geometry.materials.length > 0, label + ' deve possuir material por vértice');
    assert.equal(geometry.materials.length % 4, 0, label + ' deve manter os quatro canais de material');
    const roughness = [], bump = [];
    for (let i = 0; i < geometry.materials.length; i += 4) {
      roughness.push(geometry.materials[i]);
      bump.push(geometry.materials[i + 2]);
    }
    assert.ok(roughness.every(value => Number.isFinite(value) && value >= 0 && value <= 1), label + ' deve ter roughness válido');
    assert.ok(bump.every(value => Number.isFinite(value) && value >= 0), label + ' deve ter bump válido');
    assert.ok(roughness.reduce((sum, value) => sum + value, 0) / roughness.length >= minRoughness,
      label + ' não deve parecer uma superfície plástica');
    assert.ok(bump.reduce((max, value) => Math.max(max, value), 0) >= minBump, label + ' deve conservar microtextura perceptível');
  };

  const burgerLayout = buildFoodLayout(burger, ing(BURGER), { key: 'classico' }, { detail: .45 });
  assertMaterial(burgerLayout.parts.find(part => part.kind === 'bun-top'), 'pão do hambúrguer', .45, .5);
  assertMaterial(burgerLayout.parts.find(part => part.kind === 'patty'), 'carne grelhada', .55, .5);
  assertMaterial(burgerLayout.parts.find(part => part.kind === 'cheese'), 'queijo derretido', .35, .25);

  const pizzaLayout = buildFoodLayout(pizza, ing(PIZZA), SIZE_OPTIONS.pizza[1], { detail: .45 });
  assertMaterial(pizzaLayout.parts.find(part => part.kind === 'dough'), 'massa assada', .55, .5);
  assertMaterial(pizzaLayout.parts.find(part => part.kind === 'cheese'), 'mussarela gratinada', .4, .3);
  assertMaterial(pizzaLayout.parts.find(part => part.kind === 'sauce'), 'molho de tomate', .35, .25);

  const hotdog = { id: 'hotdog-material', type: 'plate', widthCm: 20, depthCm: 8, heightCm: 5 };
  const hotdogLayout = buildFoodLayout(hotdog, [
    { id: 'salsicha', name: 'Salsicha', quantity: 1 }
  ], { key: 'hotdog' }, { detail: .45 });
  assertMaterial(hotdogLayout.parts.find(part => part.kind === 'hotdog-bun'), 'pão do hot dog', .5, .5);
  assertMaterial(hotdogLayout.parts.find(part => part.kind === 'hotdog-sausage'), 'salsicha preparada', .45, .35);
});


test('fotorealismo: mussarela possui relevo real de bolhas, não apenas variação de cor', () => {
  const layout = buildFoodLayout(pizza, ing(PIZZA), SIZE_OPTIONS.pizza[1], { detail: .75 });
  const cheese = layout.parts.find(part => part.kind === 'cheese');
  assert.ok(cheese, 'camada de mussarela presente');
  const g = cheese.build();
  const ys = [];
  for (let i = 1; i < g.positions.length; i += 3) ys.push(g.positions[i]);
  const min = Math.min(...ys), max = Math.max(...ys);
  assert.ok(max - min > .0012, 'bolhas e depressões devem alterar a geometria em escala visível');
  const materials = g.materials;
  const roughness = new Set();
  for (let i = 0; i < materials.length; i += 4) roughness.add(Math.round(materials[i] * 100));
  assert.ok(roughness.size > 4, 'a superfície do queijo deve variar a resposta de roughness');
});

test('fotorealismo: frango desfiado é formado por múltiplos fios estreitos e sobrepostos', () => {
  const custom = [{ id: 'frango', name: 'Frango', type: 'pizza', visual: 'chicken', quantity: 1 }];
  const layout = buildFoodLayout(pizza, custom, SIZE_OPTIONS.pizza[1]);
  const part = layout.parts.find(item => item.kind === 'topping:frango');
  assert.ok(part, 'frango deve continuar no layout');
  const g = part.build();
  assert.ok(g.positions.length / 3 > 1500, 'fibras individuais precisam gerar geometria suficiente');
  assert.ok(g.materials.length > 0 && g.materials.every(Number.isFinite));
});

test('fotorealismo: bacon tem faixas de gordura e tostado não uniformes', () => {
  const custom = [{ id: 'bacon', name: 'Bacon', type: 'pizza', visual: 'bacon', quantity: 2 }];
  const layout = buildFoodLayout(pizza, custom, SIZE_OPTIONS.pizza[1]);
  const part = layout.parts.find(item => item.kind === 'topping:bacon');
  assert.ok(part);
  const g = part.build();
  const colors = new Set();
  for (let i = 0; i < g.colors.length; i += 3) colors.add(g.colors.slice(i, i + 3).map(v => Math.round(v * 100)).join(':'));
  assert.ok(colors.size > 20, 'bacon precisa de variação cromática localizada');
});

test('acompanhamentos: batatas deixam de usar o montador de hot dog', () => {
  const layout = buildFoodLayout(plate, [], { key: 'unico' }, { detail: .4 });
  assert.equal(layout.type, 'plate');
  assert.ok(layout.parts.some(part => part.kind === 'fries'));
  assert.ok(!layout.parts.some(part => part.kind.startsWith('hotdog-')));
});

test('acompanhamentos: anéis, nuggets e frango frito recebem geometrias próprias', () => {
  const cases = [
    [{ id: 'porcao-onion-rings', name: 'Anéis de cebola' }, 'onion-rings'],
    [{ id: 'porcao-nuggets', name: 'Nuggets crocantes' }, 'nuggets'],
    [{ id: 'porcao-frango-frito', name: 'Frango frito' }, 'fried-chicken']
  ];
  for (const [product, kind] of cases) {
    const layout = buildFoodLayout({ ...plate, ...product }, [], { key: 'unico' }, { detail: .35 });
    const part = layout.parts.find(item => item.kind === kind);
    assert.equal(layout.type, 'plate');
    assert.ok(part, `${product.name} deve usar a peça ${kind}`);
    const geometry = part.build();
    assert.ok(geometry.positions.length > 300, `${product.name} deve ter geometria volumétrica`);
    assert.ok(geometry.positions.every(Number.isFinite));
  }
});

test('acompanhamentos: adicionais aparecem e podem ser removidos sem alterar a base', () => {
  const base = buildFoodLayout(plate, [], { key: 'unico' }, { detail: .35 });
  const withExtras = buildFoodLayout(plate, [
    { id: 'ketchup-extra', name: 'Ketchup', quantity: 1 },
    { id: 'queijo-cheddar-extra', name: 'Queijo cheddar', quantity: 1 }
  ], { key: 'unico' }, { detail: .35 });
  const withoutKetchup = buildFoodLayout(plate, [
    { id: 'queijo-cheddar-extra', name: 'Queijo cheddar', quantity: 1 }
  ], { key: 'unico' }, { detail: .35 });
  assert.ok(withExtras.parts.some(part => part.kind === 'plate-dip'));
  assert.ok(withExtras.parts.some(part => part.kind === 'plate-cheese'));
  assert.ok(!withoutKetchup.parts.some(part => part.kind === 'plate-dip'));
  assert.deepEqual(base.parts.slice(0, 3).map(part => part.kind), withoutKetchup.parts.slice(0, 3).map(part => part.kind));
});
