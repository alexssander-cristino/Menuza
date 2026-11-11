import test from 'node:test';
// Testes das malhas 3D procedurais: conferem presença de peças, integridade das coordenadas e comportamento por ingrediente.
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

  assert.ok(layout.parts.some(part => part.kind === 'chocolate-cream'),
    'o chocolate deve gerar uma camada cremosa contínua');
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

test('leite condensado usa fios cremosos próprios e não vira chocolate', () => {
  const layout = buildFoodLayout(pizza, [
    { id: 'ingrediente-leite-condensado', name: 'Leite condensado', visual: 'condensed-milk', quantity: 1 }
  ], { diameterCm: 35 }, { detail: 0.45 });

  const drizzle = layout.parts.find(part => part.kind === 'topping:leite-condensado');
  assert.ok(drizzle, 'leite condensado deve manter uma peça de cobertura própria');
  assert.ok(!layout.parts.some(part => part.kind.startsWith('chocolate-cream')),
    'leite condensado não deve gerar a cobertura de chocolate');
  const geometry = drizzle.build();
  assert.ok(geometry.positions.length > 0);
  assert.ok(geometry.positions.every(Number.isFinite));
  assert.ok(geometry.materials.every(Number.isFinite));
});

test('frutas da pizza usam fatias e lascas individuais com malhas válidas', () => {
  for (const [id, name, minVertices] of [
    ['morango', 'Morango', 700],
    ['banana', 'Banana', 300],
    ['coco', 'Coco ralado', 1000]
  ]) {
    const layout = buildFoodLayout(pizza, [{ id, name, quantity: 1 }], { diameterCm: 35 }, { detail: 0.45 });
    const part = layout.parts.find(item => item.kind === 'topping:' + id);
    assert.ok(part, name + ' deve permanecer na composição');
    const geometry = part.build();
    assert.ok(geometry.positions.length / 3 >= minVertices, name + ' deve ter malha detalhada');
    assert.ok(geometry.positions.every(Number.isFinite), name + ' não pode gerar vértices inválidos');
    assert.ok(geometry.materials.every(Number.isFinite), name + ' não pode gerar materiais inválidos');
  }
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


test('canela em pó usa partículas finas e reconhece cadastro personalizado mesmo com visual de erva', () => {
  const layout = buildFoodLayout(pizza, [
    { id: 'ingrediente-tempero-91', name: 'Canela', visual_key: 'herb', groupName: 'Ervas', quantity: 1 }
  ], { diameterCm: 35 }, { detail: 0.45 });

  assertToppingBuilds(layout, 'topping:canela-em-po');
  assert.ok(!layout.parts.some(part => part.kind === 'topping:oregano' || part.kind === 'topping:manjericao'),
    'canela em pó não pode virar orégano ou folhas de manjericão');
  const powder = layout.parts.find(part => part.kind === 'topping:canela-em-po').build();
  assert.ok(powder.box[4] - powder.box[1] < 0.004,
    'a cobertura de canela deve ser muito baixa, como pó fino, sem pedaços ou folhas');
});


test('pizza de três sabores divide as coberturas em três fatias proporcionais', () => {
  const flavors = [
    { id: 'calabresa', ingredients: [{ id: 'calabresa', name: 'Calabresa', quantity: 1 }] },
    { id: 'banana', ingredients: [{ id: 'banana', name: 'Banana', quantity: 1 }] },
    { id: 'bacon', ingredients: [{ id: 'bacon', name: 'Bacon', quantity: 1 }] }
  ];
  const layout = buildFoodLayout(pizza, [], { diameterCm: 35 }, { detail: 0.45, flavors });

  for (let index = 0; index < 3; index++) {
    const part = layout.parts.find(item => item.kind === ['topping:calabresa:0', 'topping:banana:1', 'topping:bacon:2'][index]);
    assert.ok(part, 'cada sabor deve gerar sua própria cobertura na fatia correspondente');
    const geometry = part.build();
    assert.ok(geometry.positions.length > 0);
    assert.ok(geometry.positions.every(Number.isFinite));
  }
  assert.equal(layout.parts.filter(part => /^topping:/.test(part.kind)).length, 3,
    'somente as três coberturas dos sabores escolhidos devem ser montadas');
});

test('a divisão das fatias acompanha o diâmetro configurado da pizza', () => {
  const flavors = [
    { id: 'calabresa', ingredients: [{ id: 'calabresa', name: 'Calabresa', quantity: 1 }] },
    { id: 'banana', ingredients: [{ id: 'banana', name: 'Banana', quantity: 1 }] },
    { id: 'bacon', ingredients: [{ id: 'bacon', name: 'Bacon', quantity: 1 }] }
  ];
  const small = buildFoodLayout(pizza, [], { diameterCm: 25 }, { detail: 0.35, flavors });
  const large = buildFoodLayout(pizza, [], { diameterCm: 40 }, { detail: 0.35, flavors });
  assert.ok(large.bounds[0] > small.bounds[0], 'o modelo deve respeitar o diâmetro grande selecionado');
  assert.deepEqual(
    large.parts.filter(part => /^topping:/.test(part.kind)).map(part => part.kind),
    small.parts.filter(part => /^topping:/.test(part.kind)).map(part => part.kind),
    'a quantidade de sabores e a divisão das fatias devem permanecer consistentes entre tamanhos'
  );
});


test('chocolate de um sabor doce fica restrito à fatia, sem cobrir o sabor salgado', () => {
  const flavors = [
    { id: 'pizza-calabresa', ingredients: [{ id: 'calabresa', name: 'Calabresa', quantity: 1 }] },
    { id: 'pizza-chocolate', ingredients: [{ id: 'chocolate', name: 'Chocolate', quantity: 1 }] }
  ];
  const layout = buildFoodLayout(pizza, [], { diameterCm: 35 }, { detail: 0.45, flavors });
  const creams = layout.parts.filter(part => part.kind.startsWith('chocolate-cream'));
  assert.equal(creams.length, 1, 'deve existir uma única cobertura de chocolate na fatia doce');
  assert.equal(creams[0].kind, 'chocolate-cream:1', 'o chocolate deve pertencer à segunda fatia');
  const geometry = creams[0].build();
  assert.ok(geometry.positions.length > 0);
  assert.ok(geometry.positions.every(Number.isFinite));
  assert.ok(layout.parts.some(part => part.kind === 'topping:calabresa:0'),
    'a cobertura salgada deve continuar independente na primeira fatia');
});


test('nenhuma cobertura ultrapassa os limites angulares da fatia do sabor', () => {
  const flavors = [
    { id: 'pizza-calabresa', ingredients: [{ id: 'calabresa', name: 'Calabresa', quantity: 2 }] },
    { id: 'pizza-catupiry', ingredients: [{ id: 'catupiry', name: 'Catupiry', quantity: 2 }] },
    { id: 'pizza-banana', ingredients: [{ id: 'banana', name: 'Banana', quantity: 2 }] }
  ];
  const layout = buildFoodLayout(pizza, [], { diameterCm: 35 }, { detail: 0.45, flavors });
  const sectors = flavors.map((_, index) => ({
    start: -Math.PI + index * Math.PI * 2 / flavors.length,
    end: -Math.PI + (index + 1) * Math.PI * 2 / flavors.length
  }));

  for (let index = 0; index < flavors.length; index++) {
    const expectedKind = ['topping:calabresa:0', 'topping:catupiry:1', 'topping:banana:2'][index];
    const part = layout.parts.find(item => item.kind === expectedKind);
    assert.ok(part, expectedKind + ' deve existir');
    const geometry = part.build();
    assert.ok(geometry.indices.length > 0, expectedKind + ' deve manter faces após o recorte');

    const sector = sectors[index];
    for (let vertex = 0; vertex < geometry.positions.length; vertex += 3) {
      const x = geometry.positions[vertex], z = geometry.positions[vertex + 2];
      if (Math.hypot(x, z) < 1e-7) continue;
      const angle = Math.atan2(z, x);
      const span = ((angle - sector.start) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      assert.ok(span <= (sector.end - sector.start) + 1e-5,
        expectedKind + ' não pode ultrapassar a divisória da fatia');
    }
  }
});


test('cada sabor cria sua própria base e uma divisória radial dinâmica', () => {
  const flavors = [
    { id: 'pizza-a', ingredients: [
      { id: 'molho-tomate', name: 'Molho de tomate', quantity: 1 },
      { id: 'mussarela', name: 'Mussarela', quantity: 1 },
      { id: 'calabresa', name: 'Calabresa', quantity: 1 }
    ] },
    { id: 'pizza-b', ingredients: [
      { id: 'molho-tomate', name: 'Molho de tomate', quantity: 1 },
      { id: 'mussarela', name: 'Mussarela', quantity: 1 },
      { id: 'banana', name: 'Banana', quantity: 1 }
    ] },
    { id: 'pizza-c', ingredients: [
      { id: 'chocolate', name: 'Chocolate', quantity: 1 }
    ] }
  ];
  const layout = buildFoodLayout(pizza, [], { diameterCm: 35 }, { detail: 0.35, flavors });
  assert.equal(layout.parts.filter(part => part.kind.startsWith('flavor-divider:')).length, 3,
    'três sabores devem criar três divisórias radiais');
  assert.ok(layout.parts.some(part => part.kind === 'sauce:0'));
  assert.ok(layout.parts.some(part => part.kind === 'sauce:1'));
  assert.ok(layout.parts.some(part => part.kind === 'cheese:0'));
  assert.ok(layout.parts.some(part => part.kind === 'cheese:1'));
  assert.ok(!layout.parts.some(part => part.kind === 'sauce:2' || part.kind === 'cheese:2'),
    'a fatia sem molho e mussarela não pode herdar a base dos outros sabores');
  for (const part of layout.parts.filter(item => item.kind.startsWith('flavor-divider:'))) {
    const geometry = part.build();
    assert.ok(geometry.positions.length > 0, 'cada divisória deve gerar geometria visível');
    assert.ok(geometry.positions.every(Number.isFinite));
  }
});

test('categoria Hot Dog encaminha produtos plate para o modelo de cachorro-quente', () => {
  const layout = buildFoodLayout(
    { id: 'hotdog-categoria', type: 'plate', categoryName: 'Hot Dog', widthCm: 20, depthCm: 10 },
    [],
    { key: 'unico', label: 'Unidade' },
    { detail: 0.35 }
  );
  assert.equal(layout.type, 'hotdog',
    'a categoria Hot Dog deve prevalecer sobre o tipo técnico genérico plate');
  assert.ok(layout.parts.some(part => String(part.kind).startsWith('hotdog-')),
    'o modelo deve conter peças próprias de hot dog, não o prato padrão');
});


test('pão de hot dog aumenta em comprimento, largura e altura conforme o volume real dos recheios', () => {
  const product = { id: 'hotdog-volume-test', type: 'plate', categoryName: 'Hot Dog', widthCm: 20, depthCm: 10 };
  const build = ingredients => buildFoodLayout(product, ingredients, { key: 'unico' }, { detail: 0.45 });
  const dimensions = layout => {
    const bun = layout.parts.find(part => part.kind === 'hotdog-bun');
    assert.ok(bun, 'o pão deve existir como malha independente');
    const geometry = bun.build();
    assert.ok(geometry.positions.length > 0);
    assert.ok(geometry.positions.every(Number.isFinite));
    assert.ok(geometry.box.every(Number.isFinite));
    return [
      geometry.box[3] - geometry.box[0],
      geometry.box[5] - geometry.box[2],
      geometry.box[4] - geometry.box[1]
    ];
  };

  const few = build([
    { id: 'salsicha', name: 'Salsicha', quantity: 1 }
  ]);
  const medium = build([
    { id: 'salsicha', name: 'Salsicha', quantity: 1 },
    { id: 'milho', name: 'Milho', quantity: 1 },
    { id: 'queijo', name: 'Queijo mussarela', quantity: 1 },
    { id: 'ketchup', name: 'Ketchup', quantity: 1 },
    { id: 'batata-palha', name: 'Batata palha', quantity: 1 }
  ]);
  const many = build([
    { id: 'salsicha', name: 'Salsicha', quantity: 2 },
    { id: 'milho', name: 'Milho', quantity: 3 },
    { id: 'ervilha', name: 'Ervilha', quantity: 2 },
    { id: 'queijo', name: 'Queijo mussarela', quantity: 2 },
    { id: 'bacon', name: 'Bacon', quantity: 2 },
    { id: 'batata-palha', name: 'Batata palha', quantity: 3 },
    { id: 'molho', name: 'Molho especial', quantity: 2 },
    { id: 'frango', name: 'Frango desfiado', quantity: 1 }
  ]);

  const small = dimensions(few), middle = dimensions(medium), large = dimensions(many);
  for (let axis = 0; axis < 3; axis++) {
    assert.ok(middle[axis] > small[axis], 'a composição média deve ampliar cada dimensão do pão');
    assert.ok(large[axis] > middle[axis], 'a composição grande deve ampliar progressivamente cada dimensão do pão');
  }
  assert.ok(many.bounds[0] > few.bounds[0], 'o enquadramento deve acompanhar o pão maior');
});

test('remover recheios reduz novamente o pão sem alterar a escala própria da salsicha', () => {
  const product = { id: 'hotdog-removal-test', type: 'plate', categoryName: 'Hot Dog', widthCm: 20, depthCm: 10 };
  const layout = ingredients => buildFoodLayout(product, ingredients, { key: 'unico' }, { detail: 0.45 });
  const many = layout([
    { id: 'salsicha', name: 'Salsicha', quantity: 1 },
    { id: 'bacon', name: 'Bacon', quantity: 3 },
    { id: 'queijo', name: 'Queijo', quantity: 3 },
    { id: 'batata', name: 'Batata palha', quantity: 3 },
    { id: 'milho', name: 'Milho', quantity: 3 },
    { id: 'molho', name: 'Ketchup', quantity: 2 }
  ]);
  const few = layout([{ id: 'salsicha', name: 'Salsicha', quantity: 1 }]);
  const box = result => {
    const geometry = result.parts.find(part => part.kind === 'hotdog-bun').build();
    return geometry.box;
  };
  const largeBox = box(many), smallBox = box(few);
  assert.ok((largeBox[3] - largeBox[0]) > (smallBox[3] - smallBox[0]));
  assert.ok((largeBox[5] - largeBox[2]) > (smallBox[5] - smallBox[2]));
  assert.ok((largeBox[4] - largeBox[1]) > (smallBox[4] - smallBox[1]));

  const sausage = result => result.parts.find(part => part.kind === 'hotdog-sausage').build().box;
  assert.deepEqual(sausage(many), sausage(few), 'a expansão do pão não deve escalar a salsicha junto');
});


test('quatro salsichas permanecem dentro da largura do pão expandido', () => {
  const product = { id: 'hotdog-four-sausages', type: 'plate', categoryName: 'Hot Dog', widthCm: 20, depthCm: 10 };
  const layout = buildFoodLayout(product, [
    { id: 'salsicha', name: 'Salsicha', quantity: 4 },
    { id: 'bacon', name: 'Bacon', quantity: 2 },
    { id: 'queijo', name: 'Queijo', quantity: 2 }
  ], { key: 'unico' }, { detail: 0.45 });
  const bun = layout.parts.find(part => part.kind === 'hotdog-bun').build().box;
  const sausages = layout.parts.filter(part => part.kind.startsWith('hotdog-sausage'));
  assert.equal(sausages.length, 4);
  for (const part of sausages) {
    const box = part.build().box;
    assert.ok(box[2] + (part.z || 0) >= bun[2] - .0005, 'a salsicha não deve ultrapassar a lateral esquerda do pão');
    assert.ok(box[5] + (part.z || 0) <= bun[5] + .0005, 'a salsicha não deve ultrapassar a lateral direita do pão');
  }
});
