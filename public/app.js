import { FoodScene } from './food-scene.js?v=4';
import { pizzaArt as pizzaArtSvg, burgerArt as burgerArtSvg, plateArt as plateArtSvg } from './food-art.js?v=1';

// Mantém o bloqueio de interface durante o Retry-After, inclusive ao voltar pelo histórico.
(() => {
  const key = 'menuza-rate-limit-until';
  const checkLock = () => {
    if (location.pathname === '/429.html') return;
    try {
      const until = Number(localStorage.getItem(key)) || 0;
      if (until > Date.now()) location.replace('/429.html?wait=' + Math.ceil((until - Date.now()) / 1000));
      else if (until) localStorage.removeItem(key);
    } catch {}
  };
  checkLock();
  window.addEventListener('pageshow', checkLock);
})();

const app = {
  catalog: null, category: 'all', search: '', vegetarianOnly: false, sort: 'featured',
  builder: null, cart: [], cartOpen: false, checkoutOpen: false, checkoutKey: '',
  rotate: 0, zoom: 1, viewMode: 'art', arSupported: null, admin: { authenticated: false, tab: 'orders', eventSource: null, refreshTimer: null },
  trackingTimer: null, toastTimer: null, customerOrders: [], customerOrdersLoading: false, customer: null, customerMode: 'login'
};
const root = document;
const storedCart = (() => { try { return JSON.parse(localStorage.getItem('bela-cart') || '[]'); } catch { return []; } })();
app.cart = Array.isArray(storedCart) ? storedCart : [];
const money = cents => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((Number(cents) || 0) / 100);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[char]);
function setCart() { localStorage.setItem('bela-cart', JSON.stringify(app.cart)); updateCartCount(); }
const ORDER_TOKENS_KEY = 'menuza-customer-order-tokens';
function savedOrderTokens() { try { const value = JSON.parse(localStorage.getItem(ORDER_TOKENS_KEY) || '[]'); return Array.isArray(value) ? [...new Set(value.filter(token => typeof token === 'string' && /^[A-Za-z0-9_-]{32,80}$/.test(token)))].slice(0, 30) : []; } catch { return []; } }
function rememberOrderToken(token) { if (!token || typeof token !== 'string') return; localStorage.setItem(ORDER_TOKENS_KEY, JSON.stringify([token, ...savedOrderTokens().filter(item => item !== token)].slice(0, 30))); }
function toast(message) {
  const node = root.getElementById('toast'); node.textContent = message; node.classList.add('show');
  clearTimeout(app.toastTimer); app.toastTimer = setTimeout(() => node.classList.remove('show'), 2900);
}
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }, credentials: 'same-origin' });
  let data = {}; try { data = await response.json(); } catch {}
  if (response.status === 429) {
    const retryAfter = Math.max(1, Number(response.headers.get('Retry-After')) || 900);
    try {
      const key = 'menuza-rate-limit-until';
      const until = Math.max(Number(localStorage.getItem(key)) || 0, Date.now() + retryAfter * 1000);
      localStorage.setItem(key, String(until));
      location.replace('/429.html?wait=' + retryAfter);
    } catch {
      location.replace('/429.html?wait=' + retryAfter);
    }
    throw new Error('Muitas solicitações. Aguarde antes de tentar novamente.');
  }
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a solicitação.');
  return data;
}
function defaultIngredients(product, catalog) {
  const available = catalog.ingredients.filter(item => item.type === product.type && item.active !== 0);
  const selected = available.filter(item => item.included).map(item => ({ id: item.id, quantity: 1 }));
  const presets = { 'pizza-da-horta':['tomate','champignon','oregano'], 'pizza-calabresa':['calabresa','cebola'], 'pizza-quatro-queijos':['requeijao'], 'burger-defumado':['bacon-burger','cebola-burger','picles'] };
  for (const id of presets[product.id] || []) if (available.some(item => item.id === id) && !selected.some(item => item.id === id)) selected.push({ id, quantity: 1 });
  return selected;
}
const pizzaArt = (ingredients, seed) => pizzaArtSvg(ingredients, seed, id => app.catalog?.ingredients.find(item => item.id === id));
const burgerArt = (ingredients, seed, opts) => burgerArtSvg(ingredients, seed, opts);
const plateArt = seed => plateArtSvg(seed);
function productSvg(product, ingredients, opts = {}) {
  if (product.type === 'pizza') return pizzaArt(ingredients || defaultIngredients(product, app.catalog), product.id);
  if (product.type === 'burger') return burgerArt(ingredients || defaultIngredients(product, app.catalog), product.id, opts);
  return plateArt(product.id);
}
function cardMarkup(product) {
  const category = app.catalog.categories.find(c => c.id === product.categoryId)?.name || 'Especialidade';
  return '<article class="product-card" data-product-card="'+esc(product.id)+'"><div class="product-image">'+productSvg(product,defaultIngredients(product,app.catalog))+'<span class="product-label">'+(product.featured?'Mais pedido':esc(category))+'</span></div><div class="product-card-body"><div class="product-card-top"><h3>'+esc(product.name)+'</h3><span class="product-price">'+money(product.baseCents)+'</span></div><p>'+esc(product.description)+'</p><div class="card-bottom"><span class="prep-time"><span>◷</span> '+Number(product.prepMinutes||25)+' min</span><button class="add-button" data-action="build" data-product="'+esc(product.id)+'">Personalizar <span>↗</span></button></div></div></article>';
}
function visibleProducts() {
  let list = app.catalog.products.filter(product => {
    const matchesCategory = app.category === 'all' || product.categoryId === app.category;
    const query = app.search.toLowerCase();
    const matchesSearch = !query || (product.name+' '+product.description).toLowerCase().includes(query);
    const vegetarian = product.type === 'pizza' || product.id === 'batatas';
    return matchesCategory && matchesSearch && (!app.vegetarianOnly || vegetarian);
  });
  if (app.sort==='price') list=list.slice().sort((a,b)=>a.baseCents-b.baseCents);
  if (app.sort==='name') list=list.slice().sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
  if (app.sort==='featured') list=list.slice().sort((a,b)=>b.featured-a.featured);
  return list;
}
function renderCatalog() {
  if (!app.catalog) return;
  root.getElementById('heroArtwork').innerHTML=pizzaArt([{id:'molho-tomate'},{id:'mussarela'},{id:'calabresa'},{id:'bacon'},{id:'cebola'},{id:'oregano'}],'hero');
  root.getElementById('categoryList').innerHTML='<button class="category-chip '+(app.category==='all'?'active':'')+'" role="tab" aria-selected="'+(app.category==='all')+'" data-category="all">Tudo</button>'+app.catalog.categories.map(c=>'<button class="category-chip '+(app.category===c.id?'active':'')+'" role="tab" aria-selected="'+(app.category===c.id)+'" data-category="'+esc(c.id)+'">'+esc(c.name)+'</button>').join('');
  root.getElementById('featuredGrid').innerHTML=app.catalog.products.filter(p=>p.featured).slice(0,4).map(cardMarkup).join('');
  const products=visibleProducts();
  root.getElementById('menuGrid').innerHTML=products.length?products.map(cardMarkup).join(''):'<div class="no-results"><h3>Nenhum sabor encontrado por aqui.</h3><p>Tente outra busca ou escolha uma categoria diferente.</p></div>';
  root.getElementById('resultCount').textContent=products.length+' '+(products.length===1?'sabor disponível':'sabores disponíveis');
}
function updateCartCount() { root.getElementById('cartCount').textContent=app.cart.reduce((sum,item)=>sum+item.quantity,0); }
function selectedEntries(builder=app.builder) {
  if (!builder)return [];
  return builder.ingredients.map(entry=>{const ingredient=app.catalog.ingredients.find(i=>i.id===entry.id);return ingredient?{...ingredient,quantity:entry.quantity}:null}).filter(Boolean);
}
function builderPrice(builder=app.builder) {
  if(!builder)return 0;
  const product=app.catalog.products.find(item=>item.id===builder.productId);if(!product)return 0;
  const size=app.catalog.sizes[product.type].find(s=>s.key===builder.sizeKey);
  const crust=product.type==='pizza'?app.catalog.crusts.find(c=>c.key===builder.crustKey):{priceCents:0};
  const extras=selectedEntries(builder).reduce((total,item)=>total+item.cents*item.quantity,0);
  return Math.max(0,product.baseCents+(size?.deltaCents||0)+(crust?.priceCents||0)+extras);
}
function groupedIngredients(type) {
  const map=new Map();
  for(const item of app.catalog.ingredients.filter(i=>i.type===type&&i.active!==0)){if(!map.has(item.groupName))map.set(item.groupName,[]);map.get(item.groupName).push(item)}
  return Array.from(map.entries());
}
function openBuilder(productId,cartItem=null) {
  const product=app.catalog.products.find(p=>p.id===productId);if(!product)return;
  const initial=cartItem?cartItem.ingredients.map(i=>({id:i.id,quantity:i.quantity})):defaultIngredients(product,app.catalog);
  app.builder={productId,ingredients:initial,sizeKey:cartItem?.sizeKey||(product.type==='pizza'?'media':product.type==='burger'?'classico':'unico'),crustKey:cartItem?.crustKey||'tradicional',editId:cartItem?.cartId||null};
  app.rotate=0;app.zoom=1;renderBuilder();
}
function arStatusText() {
  if (app.arSupported === null) return 'Verificando compatibilidade com realidade aumentada…';
  return app.arSupported ? 'Realidade aumentada disponível neste aparelho. A câmera só abre após o seu toque.' : 'AR indisponível neste navegador ou aparelho — você continua com a prévia 3D.';
}
async function detectAR() {
  if (app.arSupported !== null) return;
  try { app.arSupported = Boolean(navigator.xr && await navigator.xr.isSessionSupported('immersive-ar')); } catch { app.arSupported = false; }
  const node = root.getElementById('arStatus');
  if (node) node.textContent = arStatusText();
}
function renderBuilder() {
  const builderRoot = root.getElementById('builderRoot');
  const previousContent = builderRoot.querySelector('.builder-content');
  const previousScrollTop = previousContent ? previousContent.scrollTop : 0;
  const previousPageScroll = window.scrollY || 0;
  if (!app.builder) {
    root.body.classList.remove('builder-open');
    app.scene?.dispose();
    app.scene = null;
    builderRoot.innerHTML = '';
    return;
  }
  root.body.classList.add('builder-open');
  const builder = app.builder;
  const product = app.catalog.products.find(p => p.id === builder.productId);
  const isPizza = product.type === 'pizza';
  const selected = new Set(builder.ingredients.map(i => i.id));
  const layered = builder.ingredients.map(i => ({ ...app.catalog.ingredients.find(g => g.id === i.id), quantity: i.quantity, pop: i.id === builder.lastAdded })).filter(i => i.id);
  const selectedSize = app.catalog.sizes[product.type].find(item => item.key === builder.sizeKey);
  const sceneCanvas = app.scene?.canvas || null;
  const diameter = selectedSize?.diameterCm || 0;
  const sizeScale = isPizza && diameter ? (0.72 + 0.28 * (diameter / 40)).toFixed(3) : (builder.sizeKey === 'duplo' ? '1' : '0.94');
  const artMode = app.viewMode !== '3d';
  const autoOn = app.scene ? app.scene.autoRotate : !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const sceneOptions = { crustKey: isPizza ? builder.crustKey : undefined };
  const visual = '<div class="food-stage ' + (artMode ? 'view-art' : 'view-3d') + '"><div class="view-toggle" role="group" aria-label="Tipo de visualização"><button type="button" data-action="view-art" aria-pressed="' + artMode + '">Ilustração</button><button type="button" data-action="view-3d" aria-pressed="' + !artMode + '">3D</button></div><div class="food-art-view" style="--size-scale:' + sizeScale + '" aria-hidden="' + !artMode + '">' + productSvg(product, layered, { double: builder.sizeKey === 'duplo' }) + '</div><canvas id="foodCanvas" class="food-canvas" role="img" aria-label="Modelo 3D de ' + esc(product.name) + '"></canvas><div class="drag-hint" aria-hidden="true"><span>↔</span> Arraste para girar</div><div class="food-status" id="foodStatus" role="status" aria-live="polite" hidden></div><div class="ar-hud" id="arHud" aria-live="polite"></div></div>';
  const sizeHtml = app.catalog.sizes[product.type].map(size => '<button type="button" class="option-pill ' + (builder.sizeKey === size.key ? 'active' : '') + '" data-size="' + size.key + '" aria-pressed="' + (builder.sizeKey === size.key) + '">' + esc(size.label) + '<small>' + esc(size.diameterCm ? size.diameterCm + ' cm' : (size.key === 'duplo' ? '2 carnes' : money(product.baseCents + size.deltaCents))) + '</small></button>').join('');
  const crustHtml = isPizza ? '<div class="step-row"><b>02</b> Massa e borda</div><div class="option-pills">' + app.catalog.crusts.map(c => '<button class="option-pill ' + (builder.crustKey === c.key ? 'active' : '') + '" type="button" data-crust="' + c.key + '" aria-pressed="' + (builder.crustKey === c.key) + '">' + esc(c.label) + (c.priceCents ? '<small>+' + money(c.priceCents) + '</small>' : '') + '</button>').join('') + '</div>' : '';
  let ingredientHtml = '';
  for (const [group, items] of groupedIngredients(product.type)) {
    ingredientHtml += '<div class="step-row"><b>•</b> ' + esc(group) + '</div><div class="ingredient-list">' + items.map(item => {
      const active = selected.has(item.id), entry = builder.ingredients.find(i => i.id === item.id), price = item.cents ? '+ ' + money(item.cents) : 'incluído';
      return '<div class="ingredient-item"><button class="ingredient-option ' + (active ? 'selected' : '') + '" type="button" aria-pressed="' + active + '" data-ingredient="' + esc(item.id) + '"><span class="ingredient-check">✓</span><span class="ingredient-name">' + esc(item.name) + '<small>' + esc(group) + '</small></span><span class="ingredient-cost">' + (active && item.cents && entry?.quantity > 1 ? money(item.cents * entry.quantity) : price) + '</span></button>' + (active && !item.included ? '<div class="ingredient-stepper" aria-label="Quantidade de ' + esc(item.name) + '"><button type="button" data-ingredient-qty="' + esc(item.id) + '" data-delta="-1" aria-label="Diminuir ' + esc(item.name) + '">−</button><span>' + entry.quantity + '×</span><button type="button" data-ingredient-qty="' + esc(item.id) + '" data-delta="1" aria-label="Aumentar ' + esc(item.name) + '">+</button></div>' : '') + '</div>';
    }).join('') + '</div>';
  }
  builderRoot.innerHTML = '<div class="modal-backdrop" data-action="builder-backdrop"><section class="builder-modal" role="dialog" aria-modal="true" aria-label="Personalizar ' + esc(product.name) + '"><div class="builder-visual"><span class="visual-kicker">SUA MONTAGEM EM TEMPO REAL</span>' + visual + '<div class="visual-caption">' + (artMode ? 'Ilustração gerada pelas suas escolhas · alterne para 3D para girar' : 'Gire 360° arrastando · role ou use + e − para o zoom · duplo clique volta à vista inicial') + '</div><div class="visual-controls"><button type="button" data-action="rotate-left" aria-label="Girar para a esquerda">↶</button><button type="button" class="control-label" data-action="reset-view">VISTA</button><button type="button" class="control-label" data-action="toggle-auto" aria-pressed="' + autoOn + '" title="Ligar ou pausar a rotação automática">AUTO</button><button type="button" data-action="rotate-right" aria-label="Girar para a direita">↷</button><button type="button" data-action="zoom-out" aria-label="Diminuir zoom">−</button><button type="button" data-action="zoom-in" aria-label="Aumentar zoom">＋</button></div></div><div class="builder-content"><div class="modal-topline"><span>MONTE AO SEU GOSTO</span><button class="icon-button" data-action="close-builder" aria-label="Fechar">×</button></div><h2 class="builder-title">' + esc(product.name) + '</h2><p class="builder-description">' + esc(product.description) + ' Marque ou remova ingredientes e veja o prato e o preço mudarem na hora.</p><div class="step-row"><b>01</b> Escolha o tamanho</div><div class="option-pills">' + sizeHtml + '</div>' + crustHtml + ingredientHtml + '<p class="price-note">O valor final é confirmado pelo servidor a partir das opções disponíveis.</p><div class="ar-row"><button type="button" class="button button-outline ar-button" data-action="view-ar" data-product="' + esc(product.id) + '"><span class="ar-icon" aria-hidden="true">◈</span> Ver na minha mesa</button><small class="ar-status" id="arStatus" aria-live="polite">' + arStatusText() + '</small></div><div class="builder-footer"><div class="builder-total"><small>Seu prato</small><b>' + money(builderPrice()) + '</b></div><button class="button button-dark" data-action="add-to-cart">' + (builder.editId ? 'Salvar alterações' : 'Adicionar à sacola') + ' <span>↗</span></button></div></div></section></div>';
  const nextContent = builderRoot.querySelector('.builder-content');
  if (nextContent) {
    nextContent.scrollTop = previousScrollTop;
    requestAnimationFrame(() => {
      const currentContent = builderRoot.querySelector('.builder-content');
      if (currentContent && app.builder) currentContent.scrollTop = previousScrollTop;
      if (app.builder && Math.abs((window.scrollY || 0) - previousPageScroll) > 1) window.scrollTo(0, previousPageScroll);
    });
  }
  const freshCanvas = root.getElementById('foodCanvas');
  if (app.scene && sceneCanvas) {
    freshCanvas.replaceWith(sceneCanvas);
    app.scene.canvas = sceneCanvas;
    app.scene.hud = root.getElementById('arHud');
    app.scene.update(product, layered, selectedSize, sceneOptions);
  } else {
    try {
      app.scene = new FoodScene(freshCanvas, product, layered, selectedSize, root.getElementById('arHud'), sceneOptions);
    } catch (error) {
      app.scene = null;
      freshCanvas.remove();
      const stage = builderRoot.querySelector('.food-stage');
      stage.insertAdjacentHTML('afterbegin', '<div class="food-fallback">' + productSvg(product, layered) + '</div>');
      toast(error.message || 'O modelo 3D não pôde ser iniciado neste navegador.');
    }
  }
  syncSceneUi(artMode);
  detectAR();
}
function setStageState(state, message) {
  const stage = root.querySelector('.food-stage');
  if (!stage) return;
  stage.dataset.state = state;
  const box = stage.querySelector('#foodStatus');
  if (!box) return;
  if (state === 'loading') { box.hidden = false; box.innerHTML = '<span class="spinner" aria-hidden="true"></span> Preparando o modelo 3D…'; }
  else if (state === 'lost') { box.hidden = false; box.textContent = 'O navegador pausou o 3D. Use a aba Ilustração ou recarregue a página.'; }
  else if (state === 'error') { box.hidden = false; box.textContent = (message || 'Não foi possível montar o modelo 3D.') + ' A ilustração continua disponível.'; }
  else { box.hidden = true; box.textContent = ''; }
}
function syncSceneUi(artMode) {
  const scene = app.scene;
  if (!scene) return;
  if (!scene.uiBound) {
    scene.uiBound = true;
    scene.canvas.addEventListener('foodscene', event => setStageState(event.detail.state, event.detail.message));
    scene.canvas.addEventListener('foodscene-auto', event => { const button = root.querySelector('[data-action="toggle-auto"]'); if (button) button.setAttribute('aria-pressed', String(event.detail.on)); });
  }
  scene.setActive(!artMode);
  setStageState(scene.state);
}
function addBuilderToCart() {
  const builder=app.builder;if(!builder)return;
  const product=app.catalog.products.find(p=>p.id===builder.productId);
  const entry={cartId:builder.editId||randomId(),productId:product.id,name:product.name,type:product.type,quantity:builder.editId?(app.cart.find(i=>i.cartId===builder.editId)?.quantity||1):1,sizeKey:builder.sizeKey,crustKey:product.type==='pizza'?builder.crustKey:'',ingredients:builder.ingredients.map(i=>({id:i.id,quantity:i.quantity})),notes:'',preview:productSvg(product,builder.ingredients.map(i=>({...app.catalog.ingredients.find(g=>g.id===i.id),quantity:i.quantity})).filter(i=>i.id))};
  const index=app.cart.findIndex(item=>item.cartId===entry.cartId);if(index>=0)app.cart[index]=entry;else app.cart.push(entry);
  setCart();app.builder=null;renderBuilder();toast(builder.editId?'Alterações salvas na sacola.':'Adicionado à sacola.');openCart();
}
function randomId(){return crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random().toString(36).slice(2)}
function cartItemPrice(item){
  const product=app.catalog.products.find(p=>p.id===item.productId);if(!product)return 0;
  const size=app.catalog.sizes[product.type].find(s=>s.key===item.sizeKey);
  const crust=product.type==='pizza'?app.catalog.crusts.find(c=>c.key===item.crustKey):{priceCents:0};
  const extras=item.ingredients.reduce((sum,entry)=>sum+(app.catalog.ingredients.find(i=>i.id===entry.id)?.cents||0)*entry.quantity,0);
  return product.baseCents+(size?.deltaCents||0)+(crust?.priceCents||0)+extras;
}
function renderCart(){
  const total=app.cart.reduce((sum,item)=>sum+cartItemPrice(item)*item.quantity,0);
  const items=app.cart.map(item=>{
    const product=app.catalog.products.find(p=>p.id===item.productId),names=new Map(app.catalog.ingredients.map(i=>[i.id,i.name]));
    const components=item.ingredients.map(i=>names.get(i.id)).filter(Boolean).join(', '),size=app.catalog.sizes[product.type].find(s=>s.key===item.sizeKey)?.label||'';
    return '<article class="cart-item"><div class="cart-thumb">'+item.preview+'</div><div><h3>'+esc(item.name)+'</h3><p>'+esc(size)+(item.crustKey&&item.crustKey!=='tradicional'?' · '+esc(app.catalog.crusts.find(c=>c.key===item.crustKey)?.label||''):'')+'<br>'+esc(components||'Composição da casa')+'</p><div class="cart-item-actions"><div class="qty-control"><button data-action="qty" data-id="'+esc(item.cartId)+'" data-delta="-1" aria-label="Diminuir">−</button><span>'+item.quantity+'</span><button data-action="qty" data-id="'+esc(item.cartId)+'" data-delta="1" aria-label="Aumentar">+</button></div><button class="tiny-link" data-action="edit-cart-item" data-id="'+esc(item.cartId)+'">Editar</button><button class="tiny-link" data-action="remove-cart-item" data-id="'+esc(item.cartId)+'">Remover</button></div></div><span class="cart-item-price">'+money(cartItemPrice(item)*item.quantity)+'</span></article>';
  }).join('');
  root.getElementById('cartRoot').innerHTML='<div class="drawer-backdrop" data-action="cart-backdrop"><aside class="cart-drawer" role="dialog" aria-modal="true" aria-label="Sacola"><div class="drawer-head"><div><div class="eyebrow">SEU PEDIDO</div><h2>Sacola <span style="font:11px var(--font);color:#839086">('+app.cart.reduce((s,i)=>s+i.quantity,0)+')</span></h2></div><button class="icon-button" data-action="close-cart" aria-label="Fechar">×</button></div>'+(app.cart.length?'<div class="cart-items">'+items+'</div><div class="cart-summary"><div class="summary-line"><span>Subtotal</span><span>'+money(total)+'</span></div><div class="summary-line"><span>Taxas</span><span>Calculadas conforme a modalidade</span></div><div class="summary-line summary-total"><span>Total estimado</span><span>'+money(total)+'</span></div><button class="button button-dark" data-action="checkout">Continuar para checkout <span>↗</span></button><p class="cart-disclaimer">O valor definitivo é conferido pelo servidor ao confirmar o pedido.</p></div>':'<div class="cart-empty"><div class="empty-icon">◌</div><h3>Sua mesa está vazia.</h3><p>Escolha algo que dê vontade de sentar e ficar mais um pouco.</p><button class="button button-dark" data-action="close-cart">Ver o cardápio</button></div>')+'</aside></div>';
}
function openCart(){app.cartOpen=true;renderCart()}
function checkoutForm(){
  const subtotal=app.cart.reduce((sum,item)=>sum+cartItemPrice(item)*item.quantity,0);
  root.getElementById('checkoutRoot').innerHTML='<div class="modal-backdrop" data-action="checkout-backdrop"><form class="checkout-modal" id="checkoutForm" role="dialog" aria-modal="true"><label class="hp-field" aria-hidden="true">Não preencha este campo<input name="website" tabindex="-1" autocomplete="off"></label><div class="modal-topline"><span>QUASE NA MESA</span><button type="button" class="icon-button" data-action="close-checkout" aria-label="Fechar">×</button></div><h2>Para onde vai o pedido?</h2><p>Seu pedido será enviado à cozinha quando você confirmar.</p><label class="form-field"><span>Seu nome</span><input required minlength="2" name="customerName" autocomplete="name" placeholder="Como podemos chamar você?"></label><label class="form-field"><span>Telefone</span><input required name="phone" autocomplete="tel" placeholder="(11) 99999-9999"></label><div class="form-field"><span>Como prefere receber?</span><div class="fulfillment-options"><button class="fulfillment-option active" type="button" data-fulfillment="pickup">Retirar</button><button class="fulfillment-option" type="button" data-fulfillment="table">Na mesa</button><button class="fulfillment-option" type="button" data-fulfillment="delivery">Entrega</button></div><input type="hidden" name="fulfillment" value="pickup"></div><label class="form-field hidden" id="tableField"><span>Número da mesa</span><input name="tableLabel" placeholder="Ex.: mesa 08"></label><label class="form-field hidden" id="addressField"><span>Endereço de entrega</span><textarea name="deliveryAddress" placeholder="Rua, número, bairro e complemento"></textarea></label><label class="form-field"><span>Observação para a cozinha (opcional)</span><textarea name="note" maxlength="500" placeholder="Algum detalhe importante?"></textarea></label><div class="payment-note">Pagamento: combinar diretamente com o restaurante. Esta demo não processa nem aprova pagamentos.</div><div class="checkout-total"><span>Total estimado</span><span>'+money(subtotal)+'</span></div><p class="error-text" id="checkoutError" aria-live="polite"></p><button class="button button-dark" type="submit" style="width:100%">Confirmar pedido <span>↗</span></button></form></div>';
  root.getElementById('checkoutForm').addEventListener('submit',submitCheckout);
}
async function submitCheckout(event){
  event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type=submit]'),error=root.getElementById('checkoutError');
  button.disabled=true;button.textContent='Enviando para a cozinha…';error.textContent='';
  const data=new FormData(form),payload={website:data.get('website'),customerName:data.get('customerName'),phone:data.get('phone'),fulfillment:data.get('fulfillment'),tableLabel:data.get('tableLabel'),deliveryAddress:data.get('deliveryAddress'),note:data.get('note'),idempotencyKey:app.checkoutKey,items:app.cart.map(item=>({productId:item.productId,quantity:item.quantity,sizeKey:item.sizeKey,crustKey:item.crustKey,ingredients:item.ingredients,notes:item.notes}))};
  try{const result=await api('/api/orders',{method:'POST',body:JSON.stringify(payload)});app.cart=[];setCart();rememberOrderToken(result.order.trackingToken);app.checkoutOpen=false;app.cartOpen=false;app.checkoutKey='';root.getElementById('checkoutRoot').innerHTML='';root.getElementById('cartRoot').innerHTML='';location.hash='pedido/'+result.order.trackingToken;toast('Pedido registrado pela cozinha.')}
  catch(e){error.textContent=e.message;button.disabled=false;button.innerHTML='Confirmar pedido <span>↗</span>'}
}
function openCheckout(){
  if(!app.cart.length)return toast('Adicione um prato antes de continuar.');
  app.checkoutKey=app.checkoutKey||randomId();app.checkoutOpen=true;app.cartOpen=false;root.getElementById('cartRoot').innerHTML='';checkoutForm();
}
async function launchAR(productId) {
  const product = app.catalog.products.find(p => p.id === productId);
  if (!product) return;
  if (app.scene && app.scene.product.id === productId) {
    try {
      if (await app.scene.supportsAR()) {
        await app.scene.enterAR();
        return;
      }
    } catch (error) {
      toast(error.message || 'Não foi possível iniciar a câmera AR neste aparelho.');
      return;
    }
  }
  if (product.modelUrl) {
    const url = new URL(product.modelUrl, location.href);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') return toast('O modelo AR precisa estar em uma origem HTTPS segura.');
    if (/Android/i.test(navigator.userAgent) && /\.glb($|[?#])/i.test(url.href)) {
      const intent = 'intent://arvr.google.com/scene-viewer/1.0?file=' + encodeURIComponent(url.href) + '&mode=ar_preferred#Intent;scheme=https;package=com.google.android.googlequicksearchbox;action=android.intent.action.VIEW;S.browser_fallback_url=' + encodeURIComponent(location.href) + ';end;';
      location.href = intent;
      return;
    }
    if (/iPhone|iPad|iPod/i.test(navigator.userAgent) && /\.usdz($|[?#])/i.test(url.href)) {
      const anchor = root.createElement('a');
      anchor.setAttribute('rel', 'ar');
      anchor.href = url.href;
      anchor.setAttribute('type', 'model/vnd.usdz+zip');
      anchor.style.display = 'none';
      const img = root.createElement('img');
      img.alt = 'Abrir modelo do prato em realidade aumentada';
      anchor.appendChild(img);
      root.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      return;
    }
  }
  if (app.builder) { app.viewMode = '3d'; renderBuilder(); }
  toast('A realidade aumentada não está disponível neste navegador. Mostrando a prévia 3D interativa.');
}
function showTracking(token){
  root.getElementById('homeView').classList.add('hidden');root.getElementById('adminView').classList.add('hidden');root.getElementById('trackingView').classList.remove('hidden');
  clearInterval(app.trackingTimer);loadTracking(token);app.trackingTimer=setInterval(()=>loadTracking(token),5000);
}
async function loadTracking(token){
  const target=root.getElementById('trackingView');
  try{
    const {order}=await api('/api/tracking/'+encodeURIComponent(token));
    const flow=order.fulfillment==='delivery'?['Recebido','Confirmado','Em preparação','Pronto','Saiu para entrega','Concluído']:['Recebido','Confirmado','Em preparação','Pronto','Concluído'];
    const current=order.history.length?order.history[order.history.length-1].status:order.status,isCancelled=current==='cancelled';
    const labels={received:'Recebido',confirmed:'Confirmado',preparing:'Em preparação',ready:'Pronto',delivering:'Saiu para entrega',completed:'Concluído',cancelled:'Cancelado'};
    const currentStep=current==='delivering'?4:({received:0,confirmed:1,preparing:2,ready:3,completed:flow.length-1}[current]??0);
    const timeline=flow.map((label,index)=>'<div class="timeline-item '+(!isCancelled&&index<currentStep?'done':!isCancelled&&index===currentStep?'current':'')+'"><div class="timeline-dot"></div><span>'+label+'</span></div>').join('');
    const rows=order.items.map(item=>{const snapshot=item.snapshot,art=snapshot.type==='pizza'?pizzaArt(snapshot.ingredients,item.productId):snapshot.type==='burger'?burgerArt(snapshot.ingredients):plateArt();return '<div class="tracking-order-item"><div class="tracking-art">'+art+'</div><span>'+item.quantity+'× '+esc(item.name)+'<small>'+esc(item.snapshot.size.label)+' · '+esc(item.ingredients.map(i=>i.name).join(', ')||'composição da casa')+'</small></span><b>'+money(item.unitPriceCents*item.quantity)+'</b></div>'}).join('');
    target.innerHTML='<section class="tracking-shell"><a class="tracking-back" href="#" data-action="back-home">← Voltar ao cardápio</a><div class="tracking-head"><div class="checkmark">'+(isCancelled?'×':'✓')+'</div><div class="eyebrow" style="justify-content:center">PEDIDO ENVIADO À COZINHA</div><h1>'+(isCancelled?'Pedido cancelado.':'Estamos cuidando de tudo.')+'</h1><p>Este acompanhamento reflete as atualizações feitas pelo restaurante.<br>O número do pedido é <b>'+esc(order.id)+'</b>.</p></div><div class="tracking-card"><div class="tracking-meta"><div><small>STATUS AGORA</small><b>'+esc(labels[current]||current)+'</b></div><div class="status-pill">'+(order.fulfillment==='delivery'?'Entrega':order.fulfillment==='table'?'Mesa '+esc(order.tableLabel):'Retirada')+'</div></div>'+(isCancelled?'<div class="ready-banner" style="background:#f5e8e2;color:#9e4e3d">O restaurante cancelou este pedido. Entre em contato com a equipe para mais informações.</div>':'<div class="status-timeline">'+timeline+'</div>')+'<div class="tracking-items"><h3>Na sua sacola</h3>'+rows+'<div class="tracking-order-item" style="border-top:1px solid #e5e8df;margin-top:5px;padding-top:13px"><b>Total</b><b>'+money(order.totalCents)+'</b></div></div>'+(current==='ready'?'<div class="ready-banner">Seu pedido está pronto. Bom apetite!</div>':current==='completed'?'<div class="ready-banner">Pedido concluído. Esperamos que tenha gostado!</div>':'')+'<p class="tracking-note">Pagamento combinado diretamente com o restaurante. A animação e o status de preparo acompanham somente atualizações reais da equipe.</p></div></section>';
  }catch(e){target.innerHTML='<section class="tracking-shell"><a class="tracking-back" href="#" data-action="back-home">← Voltar ao cardápio</a><div class="tracking-head"><h1>Não encontramos esse pedido.</h1><p>'+esc(e.message)+'</p></div></section>'}
}
function showHome(){clearInterval(app.trackingTimer);root.getElementById('trackingView').classList.add('hidden');root.getElementById('adminView').classList.add('hidden');root.getElementById('homeView').classList.remove('hidden')}
function onRoute(){const hash=location.hash.replace(/^#/,'');if(hash.startsWith('pedido/'))return showTracking(hash.slice(7));if(hash==='admin')return showAdmin();if(hash==='conta')return showCustomerAccount();showHome()}
async function showCustomerAccount(){clearInterval(app.trackingTimer);root.getElementById('homeView').classList.add('hidden');root.getElementById('adminView').classList.add('hidden');const target=root.getElementById('trackingView');target.classList.remove('hidden');target.innerHTML='<section class="customer-orders-shell"><a class="tracking-back" href="#" data-action="back-home">← Voltar ao cardápio</a><div class="customer-orders-heading"><div class="eyebrow">SUA EXPERIÊNCIA MENUZA</div><h1>Sua <em>conta.</em></h1><p>Entre para consultar seus pedidos com privacidade. Cada conta acessa apenas os pedidos vinculados a ela.</p></div><div class="customer-account-content"><div class="loading-line">Verificando sua conta…</div></div></section>';try{const result=await api('/api/customer/me');app.customer=result.customer;await renderCustomerDashboard()}catch{app.customer=null;renderCustomerAuth()}}
function renderCustomerAuth(errorText=''){const content=root.querySelector('.customer-account-content');if(!content)return;const register=app.customerMode==='register';content.innerHTML='<div class="customer-auth-card"><div class="customer-auth-switch"><button type="button" data-action="customer-mode" data-mode="login" class="'+(!register?'active':'')+'">Entrar</button><button type="button" data-action="customer-mode" data-mode="register" class="'+(register?'active':'')+'">Criar conta</button></div><form id="customerAuthForm" class="customer-auth-form"><label class="hp-field" aria-hidden="true">Não preencha este campo<input name="website" tabindex="-1" autocomplete="off"></label><h2>'+(register?'Crie sua conta':'Que bom ter você de volta')+'</h2><p>'+(register?'Cadastre seus dados para manter seus pedidos reunidos.':'Entre com seu e-mail e senha para acessar seus pedidos.')+'</p>'+(register?'<label class="form-field"><span>Nome completo</span><input name="name" required minlength="2" maxlength="100" autocomplete="name" placeholder="Seu nome"></label>':'')+'<label class="form-field"><span>E-mail</span><input type="email" name="email" required maxlength="254" autocomplete="email" placeholder="voce@exemplo.com"></label>'+(register?'<label class="form-field"><span>Telefone (opcional)</span><input name="phone" autocomplete="tel" maxlength="30" placeholder="(00) 00000-0000"></label>':'')+'<label class="form-field"><span>Senha</span><input type="password" name="password" required minlength="'+(register?'8':'1')+'" maxlength="128" autocomplete="'+(register?'new-password':'current-password')+'" placeholder="'+(register?'Mínimo de 8 caracteres':'Sua senha')+'"></label><p class="error-text" id="customerAuthError" role="alert">'+esc(errorText)+'</p><button class="button button-dark" type="submit" style="width:100%">'+(register?'Criar minha conta':'Entrar na minha conta')+' <span>↗</span></button></form><p class="customer-auth-privacy">Sua sessão é protegida por cookie HttpOnly. Seus pedidos são consultados no servidor usando o identificador da sua conta.</p></div>';root.getElementById('customerAuthForm').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type=submit]'),data=new FormData(form),payload=Object.fromEntries(data.entries());button.disabled=true;button.textContent='Aguarde…';try{const result=await api(register?'/api/customer/register':'/api/customer/login',{method:'POST',body:JSON.stringify(payload)});app.customer=result.customer;toast(register?'Conta criada com sucesso.':'Login realizado.');await renderCustomerDashboard()}catch(error){const node=root.getElementById('customerAuthError');if(node)node.textContent=error.message;button.disabled=false;button.textContent=register?'Criar minha conta ↗':'Entrar na minha conta ↗'}})}
async function renderCustomerDashboard(){const content=root.querySelector('.customer-account-content');if(!content||!app.customer)return;content.innerHTML='<div class="customer-profile-card"><div><div class="eyebrow">CONTA DO CLIENTE</div><h2>'+esc(app.customer.name)+'</h2><p>'+esc(app.customer.email)+'</p></div><button class="button button-outline button-small" data-action="customer-logout">Sair</button></div><div class="customer-orders-section-head"><div><div class="eyebrow">HISTÓRICO PESSOAL</div><h2>Seus pedidos</h2></div><a class="text-link" href="#menu">Fazer novo pedido ↗</a></div><div class="customer-orders-list"><div class="loading-line">Carregando seus pedidos…</div></div><div class="customer-orders-footnote">Por segurança, o servidor retorna apenas pedidos vinculados à sua conta. Pedidos feitos antes de criar uma conta ou sem estar conectado não são associados automaticamente.</div>';try{const result=await api('/api/customer/orders');renderCustomerOrders(result.orders)}catch(error){const list=content.querySelector('.customer-orders-list');if(list)list.innerHTML='<div class="customer-orders-empty"><h2>Não foi possível carregar seus pedidos</h2><p>'+esc(error.message)+'</p></div>'}}
function renderCustomerOrders(orders){const list=root.querySelector('.customer-orders-list');if(!list)return;const labels={received:'Recebido',confirmed:'Confirmado',preparing:'Em preparo',ready:'Pronto',delivering:'Saiu para entrega',completed:'Concluído',cancelled:'Cancelado'};if(!orders.length){list.innerHTML='<div class="customer-orders-empty"><span class="customer-empty-mark">▱</span><h2>Ainda não há pedidos na sua conta</h2><p>Faça seu próximo pedido enquanto estiver conectado e ele ficará salvo no seu histórico pessoal.</p><a class="button button-dark" href="#menu" data-action="back-home">Explorar cardápio <span>↗</span></a></div>';return}list.innerHTML=orders.map(order=>{const status=order.history?.length?order.history[order.history.length-1].status:order.status;const fulfillment=order.fulfillment==='delivery'?'Entrega':order.fulfillment==='table'?'Mesa '+esc(order.tableLabel||''): 'Retirada';const date=order.createdAt?new Date(order.createdAt).toLocaleString('pt-BR',{dateStyle:'medium',timeStyle:'short'}):'Data não disponível';const items=(order.items||[]).map(item=>`${item.quantity}× ${esc(item.name)}`).join(' · ');return '<article class="customer-order-card"><div class="customer-order-card-top"><div><span class="customer-order-number">PEDIDO '+esc(order.id)+'</span><span class="customer-order-date">'+esc(date)+'</span></div><span class="customer-status status-'+esc(status)+'">'+esc(labels[status]||status)+'</span></div><div class="customer-order-items">'+items+'</div><div class="customer-order-card-bottom"><span>'+fulfillment+'</span><strong>'+money(order.totalCents)+'</strong></div><a class="customer-order-link" href="#pedido/'+encodeURIComponent(order.trackingToken)+'">Acompanhar pedido <span>↗</span></a></article>'}).join('')}
async function logoutCustomer(){try{await api('/api/customer/logout',{method:'POST'})}catch{}app.customer=null;app.customerMode='login';toast('Você saiu da sua conta.');renderCustomerAuth()}

async function showAdmin(){
  clearInterval(app.trackingTimer);root.getElementById('homeView').classList.add('hidden');root.getElementById('trackingView').classList.add('hidden');const node=root.getElementById('adminView');node.classList.remove('hidden');
  try{await api('/api/admin/me');app.admin.authenticated=true;renderAdmin();refreshAdmin();connectAdminEvents()}catch{app.admin.authenticated=false;renderAdminLogin()}
}
function renderAdminLogin(errorText=''){
  root.getElementById('adminView').innerHTML='<div class="admin-shell"><a class="tracking-back" href="#" data-action="back-home">← Voltar ao cardápio</a><form class="admin-login" id="adminLogin"><label class="hp-field" aria-hidden="true">Não preencha este campo<input name="website" tabindex="-1" autocomplete="off"></label><div class="eyebrow">ÁREA RESTRITA</div><h1>Bom trabalho começa<br>com uma boa visão.</h1><p>Entre no painel da Bela Mesa para acompanhar pedidos e atualizar o cardápio.</p><label class="form-field"><span>Senha do restaurante</span><input type="password" name="password" required autocomplete="current-password"></label><p class="error-text">'+esc(errorText)+'</p><button class="button button-dark" type="submit" style="width:100%">Entrar no painel <span>↗</span></button></form></div>';
  root.getElementById('adminLogin').addEventListener('submit',async event=>{event.preventDefault();const formData=new FormData(event.currentTarget),password=formData.get('password'),website=formData.get('website');try{await api('/api/admin/login',{method:'POST',body:JSON.stringify({password,website})});app.admin.authenticated=true;renderAdmin();refreshAdmin();connectAdminEvents()}catch(e){renderAdminLogin(e.message)}});
}
function renderAdmin(){
  const tabs=[['orders','Pedidos'],['catalog','Cardápio'],['ingredients','Adicionais'],['settings','Configurações']];
  root.getElementById('adminView').innerHTML='<div class="admin-shell"><div class="admin-top"><div><div class="eyebrow">BELA MESA · OPERAÇÃO</div><h1>Painel da cozinha</h1><p>Pedidos e cardápio em um só lugar.</p></div><div class="admin-top-actions"><a href="#" class="button button-outline button-small" data-action="back-home">Ver cardápio</a><button class="button button-dark button-small" data-action="admin-logout">Sair da conta</button></div></div><div class="admin-tabs">'+tabs.map(t=>'<button class="admin-tab '+(app.admin.tab===t[0]?'active':'')+'" data-admin-tab="'+t[0]+'">'+t[1]+'</button>').join('')+'</div><div id="adminBody"><div class="loading-line">Carregando dados da cozinha…</div></div></div>';
  if(app.admin.tab==='orders')renderOrdersAdmin();else if(app.admin.tab==='catalog')renderCatalogAdmin();else if(app.admin.tab==='ingredients')renderIngredientsAdmin();else renderSettingsAdmin();
}
async function refreshAdmin(){
  if(!app.admin.authenticated||app.admin.tab!=='orders')return;
  try{const [metrics,result]=await Promise.all([api('/api/admin/dashboard'),api('/api/admin/orders')]);if(app.admin.authenticated&&app.admin.tab==='orders')renderOrdersAdmin(metrics,result.orders)}
  catch(e){if(e.message.includes('Entre no painel'))renderAdminLogin(e.message)}
}
function statusSelect(order){
  const labels={received:'Recebido',confirmed:'Confirmado',preparing:'Em preparo',ready:'Pronto',delivering:'Em entrega',completed:'Concluído',cancelled:'Cancelado'};
  const options={received:[['confirmed','Confirmar'],['cancelled','Cancelar']],confirmed:[['preparing','Iniciar preparo'],['cancelled','Cancelar']],preparing:[['ready','Marcar como pronto'],['cancelled','Cancelar']],ready:order.fulfillment==='delivery'?[['delivering','Saiu para entrega']]:[['completed','Concluir pedido']],delivering:[['completed','Concluir pedido']],completed:[],cancelled:[]}[order.status]||[];
  return options.length?'<select class="order-status-select" data-order-status="'+esc(order.id)+'"><option value="">'+labels[order.status]+'</option>'+options.map(([value,label])=>'<option value="'+value+'">'+label+'</option>').join('')+'</select>':'<span class="status-pill">'+labels[order.status]+'</span>';
}
function renderOrdersAdmin(metrics,orders){
  const target=root.getElementById('adminBody');if(!target)return;if(!metrics||!orders){target.innerHTML='<div class="loading-line">Atualizando pedidos…</div>';return}
  const cards=orders.map(order=>{
    const lines=order.items.map(item=>'<div><strong>'+item.quantity+'× '+esc(item.name)+'</strong> · '+esc(item.snapshot.size.label)+'<br><span>'+esc(item.ingredients.map(i=>i.name).join(', ')||'composição da casa')+'</span></div>').join('');
    const fulfillment=order.fulfillment==='table'?'Mesa '+esc(order.tableLabel):order.fulfillment==='delivery'?'Entrega · '+esc(order.deliveryAddress):'Retirada';
    return '<article class="order-card"><div class="order-card-head"><div><div class="order-number">'+esc(order.id)+' · '+esc(order.customerName)+'</div><div class="order-time">'+new Date(order.createdAt).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})+' · '+esc(order.phone)+'</div></div>'+statusSelect(order)+'</div><div class="order-customer">'+fulfillment+'</div><div class="order-lines">'+lines+(order.note?'<div style="margin-top:6px"><em>Obs.: '+esc(order.note)+'</em></div>':'')+'</div><div class="order-card-footer"><span class="order-fulfillment">Pagamento no restaurante</span><b>'+money(order.totalCents)+'</b></div></article>';
  }).join('');
  target.innerHTML='<div class="metrics-grid"><div class="metric-card"><span>Pedidos recebidos</span><b>'+metrics.counts.received+'</b><small>Aguardando confirmação</small></div><div class="metric-card"><span>Em preparo</span><b>'+metrics.counts.preparing+'</b><small>Na cozinha agora</small></div><div class="metric-card"><span>Prontos</span><b>'+metrics.counts.ready+'</b><small>Aguardando retirada ou entrega</small></div><div class="metric-card"><span>Faturamento de hoje</span><b>'+money(metrics.revenueCents)+'</b><small>Pedidos não cancelados</small></div></div><div class="admin-content-grid"><section class="admin-panel"><div class="admin-panel-head"><h2>Pedidos recentes</h2><small>Atualização ao vivo · '+orders.length+' pedidos</small></div><div class="orders-list">'+(cards||'<div class="admin-empty">Ainda não chegou nenhum pedido. Quando chegar, ele aparece aqui.</div>')+'</div></section><aside><section class="admin-panel"><div class="admin-panel-head"><h2>Mais pedidos</h2></div><ul class="popular-list">'+(metrics.popular.length?metrics.popular.map(p=>'<li><span>'+esc(p.name)+'</span><small>'+p.quantity+' itens</small></li>').join(''):'<li><span>Sem dados ainda</span></li>')+'</ul></section><section class="admin-panel"><div class="admin-panel-head"><h2>Turno de hoje</h2></div><p style="font-size:9px;line-height:1.7;color:#758278;margin:0">Valores atualizados após o registro. Pagamentos e taxas de entrega são combinados fora desta demonstração.</p></section></aside></div>';
}
async function renderCatalogAdmin(){
  const target=root.getElementById('adminBody');target.innerHTML='<div class="loading-line">Carregando cardápio…</div>';
  try{
    const catalog=await api('/api/admin/catalog');
    target.innerHTML='<section class="admin-panel"><div class="admin-panel-head"><div><h2>Produtos</h2><small>Preço-base, descrição e disponibilidade</small></div></div><form id="newProductForm" class="admin-form-grid"><label class="form-field"><span>Nome do produto</span><input name="name" required minlength="2" placeholder="Ex.: Pizza de abobrinha"></label><label class="form-field"><span>Categoria</span><select name="categoryId">'+catalog.categories.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>').join('')+'</select></label><label class="form-field"><span>Tipo</span><select name="type"><option value="pizza">Pizza</option><option value="burger">Hambúrguer</option><option value="plate">Porção</option></select></label><label class="form-field"><span>Preço-base (R$)</span><input name="price" type="number" min="5" step="0.01" required placeholder="49,90"></label><label class="form-field wide"><span>Descrição</span><input name="description" maxlength="300" placeholder="Ingredientes e detalhes do prato"></label><div class="wide"><p class="error-text" id="newProductError"></p><button class="button button-dark button-small" type="submit">Cadastrar produto +</button></div></form></section><section class="admin-panel"><div class="catalog-list">'+catalog.products.map(p=>'<div class="catalog-row" data-product-admin="'+esc(p.id)+'"><div><b>'+esc(p.name)+'</b><small>'+esc(catalog.categories.find(c=>c.id===p.categoryId)?.name||'')+' · '+esc(p.description.slice(0,70))+'</small></div><label><span class="sr-only">Preço em reais</span><input type="number" class="product-price-input" min="5" step="0.01" value="'+(p.baseCents/100).toFixed(2)+'"></label><label><input type="checkbox" class="product-active-input" '+(p.active?'checked':'')+'> Ativo</label><button class="tiny-link" data-action="save-product" data-id="'+esc(p.id)+'">Salvar</button></div>').join('')+'</div></section>';
    root.getElementById('newProductForm').addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(event.currentTarget),price=Math.round(Number(data.get('price'))*100);try{await api('/api/admin/products',{method:'POST',body:JSON.stringify({name:data.get('name'),categoryId:data.get('categoryId'),type:data.get('type'),baseCents:price,description:data.get('description')})});toast('Produto cadastrado.');renderCatalogAdmin()}catch(e){root.getElementById('newProductError').textContent=e.message}});
  }catch(e){target.innerHTML='<p class="error-text">'+esc(e.message)+'</p>'}
}
async function renderSettingsAdmin(){
  const target=root.getElementById('adminBody');
  if(!target)return;
  target.innerHTML='<div class="loading-line">Carregando configurações…</div>';
  try{
    const {restaurant}=await api('/api/admin/settings');
    target.innerHTML='<section class="admin-panel settings-panel"><div class="admin-panel-head"><div><h2>Identidade do restaurante</h2><small>Essas informações são usadas na experiência do cardápio.</small></div></div><form id="restaurantSettingsForm" class="admin-form-grid"><label class="form-field wide"><span>Nome do restaurante</span><input name="name" required minlength="2" maxlength="80" value="'+esc(restaurant.name)+'" placeholder="Nome que aparece no cardápio"></label><label class="form-field"><span>Tempo médio de preparo (minutos)</span><input name="prepMinutes" type="number" min="5" max="240" step="5" required value="'+Number(restaurant.prepMinutes)+'"></label><div class="wide settings-note">Use um tempo realista para orientar seus clientes. Você pode ajustar esse valor sempre que a operação mudar.</div><div class="wide settings-actions"><p class="error-text" id="settingsError" role="alert"></p><button class="button button-dark button-small" type="submit">Salvar configurações</button></div></form></section><section class="admin-panel settings-info"><div class="admin-panel-head"><h2>Conta e segurança</h2></div><p>O painel usa sessão protegida por cookie HttpOnly. Para trocar a senha de acesso, altere a variável <code>ADMIN_PASSWORD</code> no ambiente em que o servidor é executado e reinicie a aplicação.</p><p><strong>Importante:</strong> mantenha <code>APP_SECRET</code> e <code>ADMIN_PASSWORD</code> configuradas no ambiente de produção.</p></section>';
    root.getElementById('restaurantSettingsForm').addEventListener('submit',async event=>{
      event.preventDefault();
      const form=event.currentTarget;
      const data=new FormData(form);
      const button=form.querySelector('button[type="submit"]');
      const error=root.getElementById('settingsError');
      button.disabled=true;error.textContent='';
      try{
        const result=await api('/api/admin/settings',{method:'PATCH',body:JSON.stringify({name:data.get('name'),prepMinutes:Number(data.get('prepMinutes'))})});
        if(app.catalog?.restaurant){app.catalog.restaurant.name=result.restaurant.name;app.catalog.restaurant.prepMinutes=result.restaurant.prepMinutes}
        applyRestaurantBranding(result.restaurant.name);
        toast('Configurações salvas.');
      }catch(e){error.textContent=e.message}
      finally{button.disabled=false}
    });
  }catch(e){target.innerHTML='<p class="error-text">'+esc(e.message)+'</p>'}
}
function applyRestaurantBranding(name){
  const clean=String(name||'').trim();
  if(!clean)return;
  const announcement=root.querySelector('.announcement');
  if(announcement){const label=announcement.querySelector('span:not(.live-dot):not(.announcement-divider):not(.announcement-right)');if(label)label.textContent='Restaurante: '+clean}
  const footer=root.querySelector('.footer-bottom');
  if(footer&&footer.firstElementChild)footer.firstElementChild.textContent='© Menuza · Cardápio digital de '+clean;
}
async function renderIngredientsAdmin(){
  const target=root.getElementById('adminBody');target.innerHTML='<div class="loading-line">Carregando adicionais…</div>';
  try{
    const catalog=await api('/api/admin/catalog');
    target.innerHTML=['pizza','burger'].map(type=>'<section class="admin-panel"><div class="admin-panel-head"><h2>'+(type==='pizza'?'Ingredientes de pizza':'Adicionais de hambúrguer')+'</h2><small>Preço por porção</small></div><div class="ingredient-admin-grid">'+catalog.ingredients.filter(i=>i.type===type).map(i=>'<div class="ingredient-admin-row" data-ingredient-admin="'+esc(i.id)+'"><span>'+esc(i.name)+(i.included?' · incluso':'')+'</span><input type="number" min="0" step="0.01" aria-label="Preço adicional" value="'+(i.cents/100).toFixed(2)+'"><label><input type="checkbox" aria-label="Disponível" '+(i.active?'checked':'')+'></label><button class="tiny-link" data-action="save-ingredient" data-id="'+esc(i.id)+'">Salvar</button></div>').join('')+'</div></section>').join('');
  }catch(e){target.innerHTML='<p class="error-text">'+esc(e.message)+'</p>'}
}
function connectAdminEvents(){
  if(app.admin.eventSource)app.admin.eventSource.close();
  app.admin.eventSource=new EventSource('/api/admin/events');
  app.admin.eventSource.addEventListener('update',()=>{if(app.admin.tab==='orders')refreshAdmin();else if(app.admin.tab==='catalog')renderCatalogAdmin();else if(app.admin.tab==='ingredients')renderIngredientsAdmin();else renderSettingsAdmin()});
  clearInterval(app.admin.refreshTimer);app.admin.refreshTimer=setInterval(refreshAdmin,20000);
}
async function logoutAdmin(){
  try{await api('/api/admin/logout',{method:'POST'})}catch{}
  app.admin.authenticated=false;if(app.admin.eventSource)app.admin.eventSource.close();clearInterval(app.admin.refreshTimer);location.hash='';showHome();toast('Sessão encerrada.');
}
function renderCheckoutMode(form,mode){
  form.querySelector('[name=fulfillment]').value=mode;form.querySelectorAll('.fulfillment-option').forEach(button=>button.classList.toggle('active',button.dataset.fulfillment===mode));
  root.getElementById('tableField').classList.toggle('hidden',mode!=='table');root.getElementById('addressField').classList.toggle('hidden',mode!=='delivery');
}
async function saveProduct(id){
  const row=root.querySelector('[data-product-admin="'+CSS.escape(id)+'"]');if(!row)return;
  const cents=Math.round(Number(row.querySelector('.product-price-input').value)*100),active=row.querySelector('.product-active-input').checked;
  try{await api('/api/admin/products/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({baseCents:cents,active})});toast('Produto atualizado.')}catch(e){toast(e.message)}
}
async function saveIngredient(id){
  const row=root.querySelector('[data-ingredient-admin="'+CSS.escape(id)+'"]');if(!row)return;
  const inputs=row.querySelectorAll('input'),cents=Math.round(Number(inputs[0].value)*100),active=inputs[1].checked;
  try{await api('/api/admin/ingredients/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({cents,active})});toast('Adicional atualizado.')}catch(e){toast(e.message)}
}
function handleClick(event){
  const target=event.target.closest('[data-action],[data-category],[data-size],[data-crust],[data-ingredient],[data-ingredient-qty],[data-fulfillment],[data-admin-tab]');if(!target)return;
  if(target.dataset.category){app.category=target.dataset.category;renderCatalog();return}
  if(target.dataset.size&&app.builder){app.builder.sizeKey=target.dataset.size;renderBuilder();return}
  if(target.dataset.crust&&app.builder){app.builder.crustKey=target.dataset.crust;renderBuilder();return}
  if(target.dataset.ingredientQty&&app.builder){
    const entry=app.builder.ingredients.find(i=>i.id===target.dataset.ingredientQty);
    if(entry){entry.quantity=Math.max(1,Math.min(3,entry.quantity+Number(target.dataset.delta)));app.builder.lastAdded=entry.id;renderBuilder()}
    return;
  }
  if(target.dataset.ingredient&&app.builder){
    const id=target.dataset.ingredient,index=app.builder.ingredients.findIndex(i=>i.id===id);
    if(index>=0)app.builder.ingredients.splice(index,1);else if(app.builder.ingredients.length<12){app.builder.ingredients.push({id,quantity:1});app.builder.lastAdded=id}else return toast('O limite é de 12 componentes.');
    renderBuilder();return
  }
  if(target.dataset.fulfillment){renderCheckoutMode(root.getElementById('checkoutForm'),target.dataset.fulfillment);return}
  if(target.dataset.adminTab){app.admin.tab=target.dataset.adminTab;renderAdmin();return}
  const action=target.dataset.action;
  if(action==='start-builder'||action==='build'){openBuilder(target.dataset.product);return}
  if(action==='cart'){openCart();return}
  if(action==='close-builder'){app.builder=null;renderBuilder();return}
  if(action==='builder-backdrop'&&event.target===target){app.builder=null;renderBuilder();return}
  if(action==='add-to-cart'){addBuilderToCart();return}
  if(app.builder&&['rotate-left','rotate-right','zoom-in','zoom-out'].includes(action)&&app.viewMode!=='3d'){app.viewMode='3d';renderBuilder();}
  if(action==='view-art'&&app.builder){app.viewMode='art';renderBuilder();return}
  if(action==='view-3d'&&app.builder){app.viewMode='3d';renderBuilder();return}
  if(action==='rotate-left'&&app.builder){app.scene?.rotateBy(-18);return}
  if(action==='rotate-right'&&app.builder){app.scene?.rotateBy(18);return}
  if(action==='reset-view'&&app.builder){app.scene?.resetView();return}
  if(action==='toggle-auto'&&app.builder){app.scene?.toggleAuto();return}
  if(action==='zoom-in'&&app.builder){app.scene?.zoomBy(1.15);return}
  if(action==='zoom-out'&&app.builder){app.scene?.zoomBy(1/1.15);return}
  if(action==='view-ar'){launchAR(target.dataset.product);return}if(action==='exit-ar'){app.scene?.exitAR();return}
  if(action==='close-cart'||(action==='cart-backdrop'&&event.target===target)){app.cartOpen=false;root.getElementById('cartRoot').innerHTML='';return}
  if(action==='qty'){const item=app.cart.find(i=>i.cartId===target.dataset.id);if(item){item.quantity=Math.max(1,Math.min(10,item.quantity+Number(target.dataset.delta)));setCart();renderCart()}return}
  if(action==='remove-cart-item'){app.cart=app.cart.filter(i=>i.cartId!==target.dataset.id);setCart();renderCart();return}
  if(action==='edit-cart-item'){const item=app.cart.find(i=>i.cartId===target.dataset.id);app.cartOpen=false;root.getElementById('cartRoot').innerHTML='';if(item)openBuilder(item.productId,item);return}
  if(action==='checkout'){openCheckout();return}
  if(action==='close-checkout'||(action==='checkout-backdrop'&&event.target===target)){app.checkoutOpen=false;root.getElementById('checkoutRoot').innerHTML='';return}
  if(action==='back-home'){location.hash='';showHome();return}
  if(action==='admin'){location.hash='admin';return}
   if(action==='my-orders'){location.hash='conta';return}
  if(action==='customer-mode'){app.customerMode=target.dataset.mode;renderCustomerAuth();return}
  if(action==='customer-logout'){logoutCustomer();return}
  if(action==='admin-logout'){logoutAdmin();return}
  if(action==='save-product'){saveProduct(target.dataset.id);return}
  if(action==='save-ingredient'){saveIngredient(target.dataset.id);return}
}
function syncFilters(){
  root.getElementById('searchInput').addEventListener('input',event=>{app.search=event.target.value;renderCatalog()});
  root.getElementById('sortSelect').addEventListener('change',event=>{app.sort=event.target.value;renderCatalog()});
  root.getElementById('vegetarianFilter').addEventListener('click',event=>{app.vegetarianOnly=!app.vegetarianOnly;event.currentTarget.setAttribute('aria-pressed',String(app.vegetarianOnly));renderCatalog()});
  root.querySelector('[data-scroll="#menu"]').addEventListener('click',()=>root.getElementById('menu').scrollIntoView({behavior:'smooth'}));
  root.getElementById('searchInput').addEventListener('keydown',event=>{if(event.key==='Enter')root.getElementById('menu').scrollIntoView({behavior:'smooth'})});
}
async function start(){
  root.body.addEventListener('click',handleClick);
  root.addEventListener('change',async event=>{
    const select=event.target.closest('[data-order-status]');
    if(select&&select.value){select.disabled=true;try{await api('/api/admin/orders/'+encodeURIComponent(select.dataset.orderStatus),{method:'PATCH',body:JSON.stringify({status:select.value})});toast('Status do pedido atualizado.');refreshAdmin()}catch(e){toast(e.message);select.disabled=false;select.value=''}}
  });
  root.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();root.getElementById('searchInput').focus()}if(event.key==='Escape'){if(app.builder){app.builder=null;renderBuilder()}else if(app.cartOpen){app.cartOpen=false;root.getElementById('cartRoot').innerHTML=''}}});
  syncFilters();updateCartCount();
  try{app.catalog=await api('/api/catalog');applyRestaurantBranding(app.catalog.restaurant?.name);renderCatalog()}
  catch(e){root.getElementById('menuGrid').innerHTML='<div class="no-results"><h3>Estamos ajustando a mesa.</h3><p>'+esc(e.message)+' Atualize a página em instantes.</p></div>';root.getElementById('resultCount').textContent='Cardápio indisponível'}
  window.addEventListener('hashchange',onRoute);onRoute();
}
start();



