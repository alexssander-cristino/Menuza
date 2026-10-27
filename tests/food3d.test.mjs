import test from 'node:test';
import assert from 'node:assert/strict';
import { INGREDIENTS, SIZE_OPTIONS } from '../src/catalog.mjs';
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
