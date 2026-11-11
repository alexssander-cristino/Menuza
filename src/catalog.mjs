// Regras compartilhadas do domínio: status, tamanhos, bordas e ingredientes usados por API e interface.
export const STATUS = Object.freeze({ received: 'Recebido', confirmed: 'Confirmado', preparing: 'Em preparação', ready: 'Pronto', delivering: 'Saiu para entrega', completed: 'Concluído', cancelled: 'Cancelado' });
export const STATUS_FLOW = Object.freeze(['received', 'confirmed', 'preparing', 'ready', 'delivering', 'completed', 'cancelled']);
export const SIZE_OPTIONS = Object.freeze({
  pizza: [{ key: 'individual', label: 'Individual', deltaCents: -1300, diameterCm: 20 }, { key: 'media', label: 'Média', deltaCents: 0, diameterCm: 30 }, { key: 'grande', label: 'Grande', deltaCents: 1000, diameterCm: 35 }, { key: 'familia', label: 'Família', deltaCents: 3000, diameterCm: 40 }],
  burger: [{ key: 'classico', label: 'Clássico', deltaCents: 0 }, { key: 'duplo', label: 'Duplo', deltaCents: 900 }],
  plate: [{ key: 'unico', label: 'Hot Dog', deltaCents: 0 }],
  drink: [{ key: 'unico', label: 'Unidade', deltaCents: 0 }]
});
export const CRUST_OPTIONS = Object.freeze([{ key: 'tradicional', label: 'Tradicional', priceCents: 0 }, { key: 'fina', label: 'Massa fina', priceCents: 0 }, { key: 'recheada', label: 'Borda de requeijão', priceCents: 850 }]);

// O sabor especial usa o nome exato cadastrado pelo restaurante.
// Identifica produtos configurados como pizza montável pelo cliente.
export function isBuildYourOwnPizza(product) {
  const name = String(product?.name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('pt-BR');
  return product?.type === 'pizza' && name === 'monte a sua';
}
// Determina a peça 3D de ingredientes cadastrados livremente no painel.
 // A informação é calculada no servidor para que o painel e o cardápio público
 // recebam exatamente o mesmo visual, sem depender de IDs pré-definidos.
// Relaciona o cadastro do ingrediente a uma categoria visual para as ilustrações/modelos 3D.
export function inferIngredientVisual(ingredient) {
  const type = String(ingredient?.type || '').toLowerCase();
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const text = normalize([ingredient?.id, ingredient?.name, ingredient?.groupName, ingredient?.group].filter(Boolean).join(' '));
  const has = (...words) => words.some(word => text.includes(word));
  if (type === 'pizza' && has('barbecue')) return 'barbecue';
  if (type === 'pizza' && has('maionese')) return 'mayonnaise';
  if (type === 'pizza' && has('mostarda')) return 'mustard';
  if (type === 'pizza' && has('tare', 'tarê', 'molho de pimenta')) return 'hot-sauce';
  if (type === 'pizza' || type === 'burger') {
    if (has('molho', 'sauce', 'passata', 'tomatinho')) return 'sauce';
    if (type === 'pizza' && has('catupiry')) return 'catupiry';
    if (type === 'burger' && has('catupiry')) return 'cheese';
    if (type === 'pizza') {
      if (has('abacaxi', 'pineapple')) return 'pineapple';
      if (has('banana')) return 'banana';
      if (has('morango', 'strawberry')) return 'strawberry';
      if (has('creme de leite', 'leite condensado')) return 'cream';
      if (has('chocolate branco')) return 'white-chocolate';
      if (has('confete')) return 'sprinkles';
      if (has('pacoquinha', 'paçoquinha')) return 'peanut';
      if (has('chocolate', 'kit kat', 'canela')) return 'chocolate';
      if (has('coco')) return 'coconut';
      if (has('alho')) return 'garlic';
      if (has('brocolis')) return 'greens';
      if (has('ervilha')) return 'peas';
      if (has('batata palha', 'doritos')) return 'crisps';
      if (has('atum')) return 'tuna';
      if (has('palmito')) return 'palm';
      if (has('salsicha')) return 'sausage';
      if (has('barbecue')) return 'barbecue';
      if (has('maionese')) return 'mayonnaise';
      if (has('mostarda')) return 'mustard';
      if (has('tare', 'tarê', 'molho de pimenta')) return 'hot-sauce';
      if (has('molho')) return 'sauce';
      if (has('costela', 'file', 'filé', 'coxao mole', 'frango')) return 'chicken';
    }
    if (has('cheddar')) return 'cheddar';
    if (has('requeijao', 'cream cheese', 'creme de queijo')) return 'cheese';
    if (has('parmesao', 'parmesan', 'grana padano', 'pecorino')) return 'parmesan';
    if (has('gorgonzola', 'queijo azul', 'blue cheese', 'roquefort')) return 'gorgonzola';
    if (has('provolone')) return 'provolone';
    if (has('mussarela', 'mozzarella', 'muçarela', 'mozzarela', 'bufala', 'búfala')) return 'mozzarella';
    if (has('queijo', 'cheese', 'laticinio', 'laticinio')) return 'cheese';
    if (type === 'burger') {
      if (has('pao', 'brioche', 'bun')) return 'bun';
      if (has('carne', 'hamburguer', 'burger', 'patty', 'bovina')) return 'patty';
      if (has('alface', 'rucula', 'lettuce', 'folha')) return 'lettuce';
      if (has('tomate', 'tomato')) return 'tomato';
      if (has('bacon', 'panceta')) return 'bacon';
      if (has('ovo', 'egg')) return 'egg';
      if (has('cebola', 'onion')) return 'onion';
      if (has('picles', 'pepino', 'pickle')) return 'pickle';
    } else {
      if (has('calabresa', 'pepperoni', 'salame')) return 'pepperoni';
      if (has('bacon', 'panceta', 'linguica', 'lombo')) return 'bacon';
      if (has('frango', 'chicken', 'costela', 'file', 'filé', 'coxao mole')) return 'chicken';
      if (has('cebola', 'onion')) return 'onion';
      if (has('alho', 'garlic')) return 'garlic';
      if (has('tomate', 'tomato', 'pimentao')) return 'tomato';
      if (has('milho', 'corn')) return 'corn';
      if (has('azeitona', 'oliva', 'olive')) return 'olive';
      if (has('champignon', 'cogumelo', 'shimeji', 'shitake', 'fungo')) return 'mushroom';
      if (has('oregano', 'manjericao', 'salsinha', 'cebolinha', 'rucula', 'erva', 'herb')) return 'herb';
    }
  }
  if (type === 'plate') {
    if (has('queijo', 'cheese', 'cheddar', 'mussarela', 'mozzarella', 'parmesao', 'gorgonzola', 'provolone', 'catupiry', 'requeijao')) return 'cheese';
    if (has('ketchup', 'catchup')) return 'ketchup';
    if (has('mostarda', 'mustard')) return 'mustard';
    if (has('maionese', 'mayonnaise', 'mayo', 'aioli')) return 'mayonnaise';
    if (has('barbecue', 'bbq')) return 'barbecue';
    if (has('molho', 'sauce', 'creme')) return 'sauce';
    if (has('salsicha', 'vina', 'viena', 'sausage')) return 'sausage';
    if (has('calabresa', 'linguica', 'pepperoni')) return 'pepperoni';
    if (has('bacon', 'panceta')) return 'bacon';
    if (has('frango', 'chicken', 'carne', 'costela', 'proteina', 'patty')) return 'chicken';
    if (has('ovo', 'egg')) return 'egg';
    if (has('alface', 'rucula', 'repolho', 'salada', 'lettuce')) return 'lettuce';
    if (has('tomate', 'tomato')) return 'tomato';
    if (has('pimentao', 'bell pepper')) return 'pepper';
    if (has('cebola', 'onion')) return 'onion';
    if (has('picles', 'pepino', 'pickle')) return 'pickle';
    if (has('milho', 'corn')) return 'corn';
    if (has('ervilha', 'peas')) return 'peas';
    if (has('batata', 'frita', 'rustica', 'potato', 'fries')) return 'potato';
    return 'custom';
  }
  return 'cheese';
}

export const INGREDIENTS = Object.freeze([
  { id: 'molho-tomate', name: 'Molho da casa', type: 'pizza', group: 'Base', cents: 0, included: true, visual: 'sauce' },
  { id: 'mussarela', name: 'Mussarela', type: 'pizza', group: 'Queijos', cents: 0, included: true, visual: 'cheese' },
  { id: 'cheddar-pizza', name: 'Cheddar', type: 'pizza', group: 'Queijos', cents: 450, included: false, visual: 'cheddar' },
  { id: 'catupiry-pizza', name: 'Catupiry', type: 'pizza', group: 'Queijos', cents: 450, included: false, visual: 'catupiry' },
  { id: 'calabresa', name: 'Calabresa artesanal', type: 'pizza', group: 'Favoritos', cents: 490, included: false, visual: 'pepperoni' },
  { id: 'bacon', name: 'Bacon crocante', type: 'pizza', group: 'Favoritos', cents: 590, included: false, visual: 'bacon' },
  { id: 'frango', name: 'Frango desfiado', type: 'pizza', group: 'Favoritos', cents: 550, included: false, visual: 'chicken' },
  { id: 'cebola', name: 'Cebola roxa', type: 'pizza', group: 'Vegetais', cents: 190, included: false, visual: 'onion' },
  { id: 'tomate', name: 'Tomate fresco', type: 'pizza', group: 'Vegetais', cents: 220, included: false, visual: 'tomato' },
  { id: 'milho', name: 'Milho tostado', type: 'pizza', group: 'Vegetais', cents: 190, included: false, visual: 'corn' },
  { id: 'azeitona', name: 'Azeitona', type: 'pizza', group: 'Vegetais', cents: 220, included: false, visual: 'olive' },
  { id: 'champignon', name: 'Cogumelos', type: 'pizza', group: 'Vegetais', cents: 390, included: false, visual: 'mushroom' },
  { id: 'requeijao', name: 'Requeijão cremoso', type: 'pizza', group: 'Finalização', cents: 450, included: false, visual: 'cream' },
  { id: 'oregano', name: 'Orégano fresco', type: 'pizza', group: 'Finalização', cents: 0, included: false, visual: 'herb' },
  { id: 'pao-brioche', name: 'Pão brioche', type: 'burger', group: 'Base', cents: 0, included: true, visual: 'bun' },
  { id: 'carne', name: 'Blend 160 g', type: 'burger', group: 'Base', cents: 0, included: true, visual: 'patty' },
  { id: 'queijo-cheddar', name: 'Cheddar inglês', type: 'burger', group: 'Queijos', cents: 0, included: true, visual: 'cheddar' },
  { id: 'alface', name: 'Alface crocante', type: 'burger', group: 'Vegetais', cents: 0, included: true, visual: 'lettuce' },
  { id: 'tomate-burger', name: 'Tomate', type: 'burger', group: 'Vegetais', cents: 0, included: true, visual: 'tomato' },
  { id: 'molho-especial', name: 'Molho da casa', type: 'burger', group: 'Molhos', cents: 0, included: true, visual: 'sauce' },
  { id: 'bacon-burger', name: 'Bacon defumado', type: 'burger', group: 'Favoritos', cents: 550, included: false, visual: 'bacon' },
  { id: 'ovo', name: 'Ovo caipira', type: 'burger', group: 'Favoritos', cents: 390, included: false, visual: 'egg' },
  { id: 'cebola-burger', name: 'Cebola caramelizada', type: 'burger', group: 'Complementos', cents: 290, included: false, visual: 'onion' },
  { id: 'picles', name: 'Picles agridoce', type: 'burger', group: 'Complementos', cents: 240, included: false, visual: 'pickle' },
  { id: 'queijo-extra', name: 'Queijo extra', type: 'burger', group: 'Queijos', cents: 350, included: false, visual: 'cheddar' }
]);
// Converte nomes em identificadores amigáveis para URLs e categorias.
export function slugify(value) {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
// Cria o conjunto inicial de dados do restaurante demonstrativo.
export function makeSeed(now = new Date().toISOString()) {
  const restaurantId = 'rest-bela-mesa';
  const categories = [{ id: 'pizzas', name: 'Pizzas', slug: 'pizzas', sort: 1 }, { id: 'hamburgueres', name: 'Hambúrgueres', slug: 'hamburgueres', sort: 2 }, { id: 'acompanhamentos', name: 'Para acompanhar', slug: 'acompanhamentos', sort: 3 }];
  const products = [
    { id: 'pizza-da-horta', categoryId: 'pizzas', name: 'Da Horta', description: 'Mussarela cremosa, tomate assado, cogumelos e ervas da estação.', type: 'pizza', baseCents: 4990, featured: 1, prep: 22, width: 30, height: 2 },
    { id: 'pizza-calabresa', categoryId: 'pizzas', name: 'Calabresa & Mel', description: 'Calabresa artesanal, cebola roxa e um toque de mel picante.', type: 'pizza', baseCents: 4990, featured: 1, prep: 24, width: 30, height: 2 },
    { id: 'pizza-quatro-queijos', categoryId: 'pizzas', name: 'Quatro queijos', description: 'Mussarela, gorgonzola suave, parmesão e requeijão cremoso.', type: 'pizza', baseCents: 5590, featured: 0, prep: 23, width: 30, height: 2 },
    { id: 'burger-casa', categoryId: 'hamburgueres', name: 'Bela da Casa', description: 'Brioche tostado, blend da casa, cheddar inglês e molho especial.', type: 'burger', baseCents: 3290, featured: 1, prep: 18, width: 12, height: 10 },
    { id: 'burger-defumado', categoryId: 'hamburgueres', name: 'Defumado', description: 'Blend artesanal, bacon crocante, cebola caramelizada e picles.', type: 'burger', baseCents: 3690, featured: 1, prep: 19, width: 13, height: 11 },
    { id: 'batatas', categoryId: 'acompanhamentos', name: 'Batatas rústicas', description: 'Douradas no forno, alecrim e aioli de alho assado.', type: 'plate', baseCents: 2190, featured: 0, prep: 14, width: 20, height: 4 }
  ];
  return {
    restaurant: { id: restaurantId, name: 'Bela Mesa', slug: 'bela-mesa', currency: 'BRL', prepMinutes: 30, createdAt: now },
    categories: categories.map(c => ({ ...c, restaurantId })),
    products: products.map(p => ({ ...p, restaurantId, active: 1, createdAt: now, updatedAt: now, modelUrl: null, depth: p.width })),
    ingredients: INGREDIENTS.map((i, idx) => ({ ...i, restaurantId, groupName: i.group, addonCents: i.cents, includedByDefault: i.included ? 1 : 0, active: 1, sortOrder: idx }))
  };
}
// Calcula o preço final de um item a partir do produto e das escolhas feitas pelo cliente.
export function calculateItemPrice({ product, sizeKey, crustKey, ingredients, quantity = 1, catalog = INGREDIENTS, sizes = SIZE_OPTIONS, crusts = CRUST_OPTIONS }) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) throw new Error('A quantidade deve ficar entre 1 e 10.');
  const type = product.type;
  const size = type === 'plate'
    ? { key: 'unico', label: 'Hot Dog', deltaCents: 0 }
    : (sizes[type] || []).find(option => option.key === sizeKey);
  if (!size) throw new Error('Tamanho inválido.');
  const crust = type === 'pizza' ? crusts.find(option => option.key === crustKey) : { priceCents: 0, key: '' };
  if (!crust) throw new Error('Massa ou borda inválida.');
  if (!Array.isArray(ingredients) || ingredients.length > 12) throw new Error('Selecione até 12 componentes.');
  const requiredIds = new Set(Array.isArray(product.requiredIngredientIds) ? product.requiredIngredientIds : (product.ingredientsConfigured ? (product.defaultIngredientIds || []) : catalog.filter(item => item.type === type && (item.active === undefined || Number(item.active) === 1) && Boolean(item.included ?? Number(item.includedByDefault) === 1)).map(item => item.id)));
  const supplied = Array.isArray(ingredients) ? ingredients.slice() : ingredients;
  if (!Array.isArray(supplied)) throw new Error('Selecione os ingredientes do produto.');
  for (const id of requiredIds) if (!supplied.some(entry => entry?.id === id)) supplied.push({ id, quantity: 1 });
  if (isBuildYourOwnPizza(product)) { const defaults = new Set(product.defaultIngredientIds || []); const missingDefaults = [...defaults].some(id => !supplied.some(entry => entry?.id === id)); const addonCount = supplied.filter(entry => !defaults.has(entry?.id)).length; if (missingDefaults || addonCount > 3) throw new Error('A pizza Monte a sua mantém os ingredientes padrão e permite escolher até 3 adicionais.'); }
  if (supplied.length > 12) throw new Error('A receita obrigatória excede o limite de componentes.');
  const seen = new Set();
  let extras = 0;
  const canonical = supplied.map(entry => {
    if (!entry || typeof entry.id !== 'string' || seen.has(entry.id)) throw new Error('A composição contém componentes inválidos ou duplicados.');
    seen.add(entry.id);
    const item = catalog.find(i => i.id === entry.id && i.type === type && (i.active === undefined || Number(i.active) === 1));
    if (!item) throw new Error('Um dos componentes não está disponível para este produto.');
    const included = requiredIds.has(item.id) || Boolean(item.included ?? Number(item.includedByDefault) === 1);
    const cents = included ? 0 : Number(item.cents ?? item.addonCents ?? 0);
    const count = entry.quantity ?? 1;
    if (!Number.isInteger(count) || count < 1 || count > (['burger','plate'].includes(type) ? 20 : 3)) throw new Error(['burger','plate'].includes(type) ? 'Cada ingrediente pode ter de 1 a 20 unidades.' : 'Cada componente pode ter de 1 a 3 porções.');
    if (!['burger','plate'].includes(type) && (included || requiredIds.has(item.id)) && count !== 1) throw new Error('A quantidade desse componente não pode ser alterada.');
    extras += cents * count;
    return { id: item.id, name: item.name, quantity: count, unitPriceCents: cents, included, visual: item.visual || item.visual_key || 'herb' };
  });
  const configuredSizePrice = Number(product.sizePrices?.[size.key]);
  const officialPizzaSizePrice = type === 'pizza' ? Number(size.priceCents) : 0;
  const baseSizePrice = type === 'pizza' && Number.isSafeInteger(officialPizzaSizePrice) && officialPizzaSizePrice >= 500
    ? officialPizzaSizePrice
    : Number.isSafeInteger(configuredSizePrice) && configuredSizePrice > 0
      ? configuredSizePrice
      : Number(product.baseCents ?? product.base_price_cents) + Number(size.deltaCents || 0);
  const unitPriceCents = baseSizePrice + crust.priceCents + extras;
  if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0) throw new Error('O preço calculado é inválido.');
  return { size: { key: size.key, label: size.label, diameterCm: size.diameterCm || null, priceCents: baseSizePrice }, crust: type === 'pizza' ? { key: crust.key, priceCents: crust.priceCents } : null, ingredients: canonical, unitPriceCents, linePriceCents: unitPriceCents * quantity };
}
