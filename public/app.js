import { FoodScene } from './food-scene.js?v=7';
import { formatOrderStatusTime } from './order-status-time.js?v=1';
import QRCode from './qrcode.js?v=1';
import { pizzaArt as pizzaArtSvg, burgerArt as burgerArtSvg, plateArt as plateArtSvg } from './food-art.js?v=1';

const MENUZA_APP_BUILD = '62';
try {
  if (localStorage.getItem('menuza-app-build') !== MENUZA_APP_BUILD) {
    // Remove somente o bloqueio local antigo; o servidor continua protegendo o login.
    localStorage.removeItem('menuza-rate-limit-until');
    localStorage.setItem('menuza-app-build', MENUZA_APP_BUILD);
  }
} catch {}

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
  catalog: null, category: 'all', search: '', vegetarianOnly: false, favoritesOnly: false, favorites: (() => { try { const value=JSON.parse(localStorage.getItem('menuza-favorites')||'[]'); return Array.isArray(value)?value.filter(id=>typeof id==='string').slice(0,200):[]; } catch { return []; } })(), recentProducts: (() => { try { const value=JSON.parse(localStorage.getItem('menuza-recent-products')||'[]'); return Array.isArray(value)?value.filter(id=>typeof id==='string').slice(0,8):[]; } catch { return []; } })(), sort: 'featured',
  builder: null, cart: [], cartOpen: false, checkoutOpen: false, checkoutKey: '', checkoutCoupon: null,
  rotate: 0, zoom: 1, viewMode: 'art', arSupported: null, admin: { authenticated: false, tab: 'orders', eventSource: null, refreshTimer: null, orderQuery: '', orderStatus: 'all', orderFulfillment: 'all' },
  trackingTimer: null, toastTimer: null, customerOrders: [], customerOrdersLoading: false, customer: null, customerMode: 'login', tableQr: null
};
const root = document;
const storedCart = (() => { try { return JSON.parse(localStorage.getItem('bela-cart') || '[]'); } catch { return []; } })();
app.cart = Array.isArray(storedCart) ? storedCart : [];
const money = cents => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((Number(cents) || 0) / 100);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[char]);
function setCart() {
  const serializedCart = JSON.stringify(app.cart);
  // Uma chave idempotente só pode ser reutilizada para o mesmo carrinho.
  // Isso evita que um carrinho alterado receba por engano o pedido anterior.
  try {
    const savedCheckout = JSON.parse(sessionStorage.getItem('menuza-checkout-key') || 'null');
    if (savedCheckout && savedCheckout.fingerprint !== serializedCart) {
      sessionStorage.removeItem('menuza-checkout-key');
      app.checkoutKey = '';
    }
  } catch { app.checkoutKey = ''; }
  try { localStorage.setItem('bela-cart', serializedCart); }
  catch { toast('A sacola não pôde ser salva neste aparelho. Confira o espaço disponível no navegador.'); }
  updateCartCount();
}
function normalizeSearch(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();
}
function normalizeCartForCatalog(value, catalog) {
  if (!Array.isArray(value) || !catalog) return [];
  const products = new Map(catalog.products.map(product => [product.id, product]));
  const combos = new Map((catalog.combos || []).map(combo => [combo.id, combo]));
  const sizes = catalog.sizes || {};
  const ingredients = new Map(catalog.ingredients.map(item => [item.id, item]));
  return value.filter(item => {
    if (!item || typeof item !== 'object') return false;
    if (typeof item.comboId === 'string') return combos.has(item.comboId) && Number(combos.get(item.comboId).active) !== 0 && Number.isInteger(item.quantity) && item.quantity >= 1 && item.quantity <= 10;
    if (typeof item.productId !== 'string') return false;
    const product = products.get(item.productId);
    if (!product || Number(product.active) === 0) return false;
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 10) return false;
    if (!(sizes[product.type] || []).some(option => option.key === item.sizeKey)) return false;
    if (!Array.isArray(item.ingredients) || item.ingredients.length > 12) return false;
    if (product.type === 'pizza' && !catalog.crusts.some(option => option.key === item.crustKey)) return false;
    const seen = new Set();
    return item.ingredients.every(entry => {
      const ingredient = ingredients.get(entry?.id);
      if (!ingredient || ingredient.type !== product.type || Number(ingredient.active) === 0 ||
          !Number.isInteger(entry.quantity) || entry.quantity < 1 || entry.quantity > 3 || seen.has(entry.id)) return false;
      seen.add(entry.id);
      return !(ingredient.included && entry.quantity !== 1);
    });
  }).slice(0, 50).map(item => {
    if (typeof item.comboId === 'string') {
      const combo = combos.get(item.comboId);
      return { cartId: typeof item.cartId === 'string' && item.cartId.length <= 100 ? item.cartId : randomId(), comboId: combo.id, name: combo.name, type: 'combo', quantity: item.quantity, ingredients: [], sizeKey: 'combo', crustKey: '', notes: '' };
    }
    const product = products.get(item.productId);
    return {
      cartId: typeof item.cartId === 'string' && item.cartId.length <= 100 ? item.cartId : randomId(),
      productId: product.id, name: product.name, type: product.type,
      quantity: item.quantity, sizeKey: item.sizeKey,
      crustKey: product.type === 'pizza' ? item.crustKey : '',
      ingredients: item.ingredients.map(entry => ({ id: entry.id, quantity: entry.quantity })),
      notes: typeof item.notes === 'string' ? item.notes.slice(0, 500) : ''
    };
  });
}
const ORDER_TOKENS_KEY = 'menuza-customer-order-tokens';
function savedOrderTokens() { try { const value = JSON.parse(localStorage.getItem(ORDER_TOKENS_KEY) || '[]'); return Array.isArray(value) ? [...new Set(value.filter(token => typeof token === 'string' && /^[A-Za-z0-9_-]{32,80}$/.test(token)))].slice(0, 30) : []; } catch { return []; } }
function rememberOrderToken(token) { if (!token || typeof token !== 'string') return; try { localStorage.setItem(ORDER_TOKENS_KEY, JSON.stringify([token, ...savedOrderTokens().filter(item => item !== token)].slice(0, 30))); } catch {} }
async function shareMenu(productId=null){
  const product=productId?app.catalog?.products.find(item=>item.id===productId):null;
  if(productId&&!product){toast('Não encontrei esse prato no cardápio.');return}
  const url=location.origin+location.pathname+'#menu';
  const title=product?'Menuza · '+product.name:'Menuza · Cardápio interativo';
  const text=product?'Confira '+product.name+' no nosso cardápio interativo.':'Confira nosso cardápio interativo no Menuza.';
  try{
    if(navigator.share){await navigator.share({title,text,url});return}
    if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(url);toast('Link do '+(product?'prato':'cardápio')+' copiado.');return}
    const field=document.createElement('textarea');field.value=url;field.setAttribute('readonly','');field.style.position='fixed';field.style.opacity='0';document.body.appendChild(field);field.select();const copied=document.execCommand('copy');field.remove();if(!copied)throw new Error('copy-failed');toast('Link do '+(product?'prato':'cardápio')+' copiado.');
  }catch(error){if(error?.name==='AbortError')return;toast('Não foi possível compartilhar. Copie o endereço do navegador.')}
}
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
  if (!response.ok) { const error = new Error(data.error || 'Não foi possível concluir a solicitação.'); error.status = response.status; throw error; }
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
function comboCardMarkup(combo) {
  const itemText=(combo.items||[]).map(item=>(item.quantity>1?item.quantity+'× ':'')+item.name).join(' · ');
  const regularTotal=(combo.items||[]).reduce((sum,item)=>sum+(Number(item.baseCents)||0)*(Number(item.quantity)||1),0);
  const saved=Math.max(0,regularTotal-Number(combo.priceCents||0));
  return '<article class="product-card combo-card"><div class="product-image combo-art" aria-hidden="true"><span class="combo-mark">COMBO</span><span class="combo-dish">＋</span><span class="combo-savings">Economize '+money(saved)+'</span></div><div class="product-card-body"><div class="product-card-top"><h3>'+esc(combo.name)+'</h3><span class="product-price">'+money(combo.priceCents)+'</span></div><p>'+esc(combo.description||itemText)+'</p><small class="combo-items-list">'+esc(itemText)+'</small><div class="card-bottom"><span class="prep-time">Preço promocional</span><button class="add-button" data-action="add-combo" data-id="'+esc(combo.id)+'">Adicionar combo <span>↗</span></button></div></div></article>';
}
function cardMarkup(product) {
  const category = app.catalog.categories.find(c => c.id === product.categoryId)?.name || 'Especialidade';
  const favorite = app.favorites.includes(product.id);
  return '<article class="product-card '+(product.available===0?'product-sold-out':'')+'" data-product-card="'+esc(product.id)+'"><div class="product-image">'+productSvg(product,defaultIngredients(product,app.catalog))+'<span class="product-label">'+(product.featured?'Mais pedido':esc(category))+'</span>'+(product.available===0?'<span class="sold-out-label">Esgotado</span>':'')+'<button class="favorite-toggle '+(favorite?'is-favorite':'')+'" type="button" data-action="toggle-favorite" data-product="'+esc(product.id)+'" aria-pressed="'+favorite+'" aria-label="'+(favorite?'Remover dos favoritos':'Adicionar aos favoritos')+'" title="'+(favorite?'Remover dos favoritos':'Adicionar aos favoritos')+'">'+(favorite?'♥':'♡')+'</button><button class="share-product-button" type="button" data-action="share-product" data-product="'+esc(product.id)+'" aria-label="Compartilhar '+esc(product.name)+'" title="Compartilhar prato"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.7 10.7 6.6-4.4M8.7 13.3l6.6 4.4"/></svg></button></div><div class="product-card-body"><div class="product-card-top"><h3>'+esc(product.name)+'</h3><span class="product-price">'+money(product.baseCents)+'</span></div><p>'+esc(product.description)+'</p><div class="card-bottom"><span class="prep-time"><span>◷</span> '+Number(product.prepMinutes||25)+' min</span><button class="add-button" data-action="build" data-product="'+esc(product.id)+'" '+(product.available===0?'disabled aria-disabled="true"':'')+'>'+(product.available===0?'Indisponível':'Personalizar <span>↗</span>')+'</button></div></div></article>';
}
function visibleProducts() {
  let list = app.catalog.products.filter(product => {
    const matchesCategory = app.category === 'all' || product.categoryId === app.category;
    const query = normalizeSearch(app.search);
    const matchesSearch = !query || normalizeSearch(product.name+' '+product.description+' '+(product.categoryName||'')).includes(query);
    const vegetarian = product.type === 'pizza' || product.id === 'batatas';
    const matchesFavorites = !app.favoritesOnly || app.favorites.includes(product.id);
    return Number(product.active) !== 0 && matchesCategory && matchesSearch && (!app.vegetarianOnly || vegetarian) && matchesFavorites;
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
  renderRecentProducts();
  const products=visibleProducts();
  const comboCards=(app.category==='all'&&!app.search&&!app.favoritesOnly&&!app.vegetarianOnly?(app.catalog.combos||[]).filter(combo=>Number(combo.active)!==0).map(comboCardMarkup).join(''):'');
  root.getElementById('menuGrid').innerHTML=(comboCards+products.map(cardMarkup).join(''))||'<div class="no-results"><h3>Nenhum sabor encontrado por aqui.</h3><p>Tente outra busca ou escolha uma categoria diferente.</p></div>';
  const visibleComboCount=comboCards?(app.catalog.combos||[]).filter(combo=>Number(combo.active)!==0).length:0;
  const visibleCount=products.length+visibleComboCount;
  root.getElementById('resultCount').textContent=visibleCount+' '+(visibleCount===1?'item disponível':'itens disponíveis')+(app.favoritesOnly?' nos favoritos':'');
  const favoritesToggle=root.getElementById('favoritesFilter');
  if(favoritesToggle){favoritesToggle.setAttribute('aria-pressed',String(app.favoritesOnly));favoritesToggle.classList.toggle('active',app.favoritesOnly);favoritesToggle.textContent=app.favoritesOnly?'♥ Mostrando favoritos':'♡ Meus favoritos';}
}
function renderRecentProducts(){
  const section=root.getElementById('recentProductsSection');
  const grid=root.getElementById('recentProductsGrid');
  if(!section||!grid||!app.catalog)return;
  const recent=app.recentProducts.map(id=>app.catalog.products.find(product=>product.id===id)).filter(product=>product&&Number(product.active)!==0);
  section.hidden=recent.length===0;
  grid.innerHTML=recent.map(cardMarkup).join('');
  const clear=root.getElementById('clearRecentProducts');
  if(clear)clear.hidden=recent.length===0;
}
function rememberRecentProduct(productId){
  if(!app.catalog?.products.some(product=>product.id===productId))return;
  app.recentProducts=[productId,...app.recentProducts.filter(id=>id!==productId)].slice(0,8);
  try{localStorage.setItem('menuza-recent-products',JSON.stringify(app.recentProducts))}catch{}
  renderRecentProducts();
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
  const product=app.catalog.products.find(p=>p.id===productId);if(!product)return;if(product.available===0)return toast('Esse produto está esgotado no momento.');
  rememberRecentProduct(productId);
  const initial=cartItem?cartItem.ingredients.map(i=>({id:i.id,quantity:i.quantity})):defaultIngredients(product,app.catalog);
  app.builder={productId,ingredients:initial,sizeKey:cartItem?.sizeKey||(product.type==='pizza'?'media':product.type==='burger'?'classico':'unico'),crustKey:cartItem?.crustKey||'tradicional',editId:cartItem?.cartId||null};
  app.rotate=0;app.zoom=1;renderBuilder();
}
function arStatusText(product = app.catalog?.products.find(item => item.id === app.builder?.productId)) {
  if (app.arSupported === null) return 'Verificando compatibilidade com realidade aumentada…';
  if (app.arSupported) return 'RA por câmera disponível via WebXR. A câmera só abre após o seu toque.';
  const modelUrl = String(product?.modelUrl || '');
  const appleDevice = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const nativeModelAvailable = (appleDevice && /\.usdz($|[?#])/i.test(modelUrl)) ||
    (/Android/i.test(navigator.userAgent) && /\.glb($|[?#])/i.test(modelUrl));
  if (nativeModelAvailable) return 'Este prato pode abrir no visualizador de RA do aparelho.';
  return 'RA por câmera não disponível neste navegador para este prato — você ainda pode usar a prévia 3D.';
}
async function detectAR() {
  if (app.arSupported !== null) return;
  try {
    app.arSupported = app.scene
      ? await app.scene.supportsAR()
      : Boolean(globalThis.isSecureContext && navigator.xr && await navigator.xr.isSessionSupported('immersive-ar'));
  } catch { app.arSupported = false; }
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
function invalidateCheckoutKey(){ app.checkoutKey=''; }
function addBuilderToCart() {
  const builder=app.builder;if(!builder)return;
  const product=app.catalog.products.find(p=>p.id===builder.productId);if(!product||product.available===0)return toast('Esse produto está esgotado no momento.');
  const entry={cartId:builder.editId||randomId(),productId:product.id,name:product.name,type:product.type,quantity:builder.editId?(app.cart.find(i=>i.cartId===builder.editId)?.quantity||1):1,sizeKey:builder.sizeKey,crustKey:product.type==='pizza'?builder.crustKey:'',ingredients:builder.ingredients.map(i=>({id:i.id,quantity:i.quantity})),notes:''};
  const index=app.cart.findIndex(item=>item.cartId===entry.cartId);if(index>=0)app.cart[index]=entry;else app.cart.push(entry);
  invalidateCheckoutKey();setCart();app.builder=null;renderBuilder();toast(builder.editId?'Alterações salvas na sacola.':'Adicionado à sacola.');openCart();
}
function randomId(){return crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random().toString(36).slice(2)}
function cartItemPrice(item){
  if(item.comboId){return Number(app.catalog.combos?.find(combo=>combo.id===item.comboId)?.priceCents)||0;}
  const product=app.catalog.products.find(p=>p.id===item.productId);if(!product)return 0;
  const size=app.catalog.sizes[product.type].find(s=>s.key===item.sizeKey);
  const crust=product.type==='pizza'?app.catalog.crusts.find(c=>c.key===item.crustKey):{priceCents:0};
  const extras=item.ingredients.reduce((sum,entry)=>sum+(app.catalog.ingredients.find(i=>i.id===entry.id)?.cents||0)*entry.quantity,0);
  return product.baseCents+(size?.deltaCents||0)+(crust?.priceCents||0)+extras;
}
function renderCart(){
  const total=app.cart.reduce((sum,item)=>sum+cartItemPrice(item)*item.quantity,0);
  const items=app.cart.map(item=>{
    if(item.comboId){const combo=app.catalog.combos?.find(entry=>entry.id===item.comboId);const contents=(combo?.items||[]).map(entry=>(entry.quantity>1?entry.quantity+'× ':'')+entry.name).join(', ');return '<article class="cart-item combo-cart-item"><div class="cart-thumb combo-thumb">＋</div><div><h3>'+esc(combo?.name||item.name)+'</h3><p>Combo promocional<br>'+esc(contents)+'</p><div class="cart-item-actions"><div class="qty-control"><button data-action="qty" data-id="'+esc(item.cartId)+'" data-delta="-1" aria-label="Diminuir">−</button><span>'+item.quantity+'</span><button data-action="qty" data-id="'+esc(item.cartId)+'" data-delta="1" aria-label="Aumentar">+</button></div><button class="tiny-link" data-action="remove-cart-item" data-id="'+esc(item.cartId)+'">Remover</button></div></div><span class="cart-item-price">'+money(cartItemPrice(item)*item.quantity)+'</span></article>';}
    const product=app.catalog.products.find(p=>p.id===item.productId),names=new Map(app.catalog.ingredients.map(i=>[i.id,i.name]));
    const components=item.ingredients.map(i=>names.get(i.id)).filter(Boolean).join(', '),size=app.catalog.sizes[product.type].find(s=>s.key===item.sizeKey)?.label||'';
    return '<article class="cart-item"><div class="cart-thumb">'+productSvg(product,item.ingredients.map(entry=>({...app.catalog.ingredients.find(ingredient=>ingredient.id===entry.id),quantity:entry.quantity})).filter(entry=>entry.id))+'</div><div><h3>'+esc(item.name)+'</h3><p>'+esc(size)+(item.crustKey&&item.crustKey!=='tradicional'?' · '+esc(app.catalog.crusts.find(c=>c.key===item.crustKey)?.label||''):'')+'<br>'+esc(components||'Composição da casa')+'</p><div class="cart-item-actions"><div class="qty-control"><button data-action="qty" data-id="'+esc(item.cartId)+'" data-delta="-1" aria-label="Diminuir">−</button><span>'+item.quantity+'</span><button data-action="qty" data-id="'+esc(item.cartId)+'" data-delta="1" aria-label="Aumentar">+</button></div><button class="tiny-link" data-action="edit-cart-item" data-id="'+esc(item.cartId)+'">Editar</button><button class="tiny-link" data-action="remove-cart-item" data-id="'+esc(item.cartId)+'">Remover</button></div></div><span class="cart-item-price">'+money(cartItemPrice(item)*item.quantity)+'</span></article>';
  }).join('');
  root.getElementById('cartRoot').innerHTML='<div class="drawer-backdrop" data-action="cart-backdrop"><aside class="cart-drawer" role="dialog" aria-modal="true" aria-label="Sacola"><div class="drawer-head"><div><div class="eyebrow">SEU PEDIDO</div><h2>Sacola <span style="font:11px var(--font);color:#839086">('+app.cart.reduce((s,i)=>s+i.quantity,0)+')</span></h2></div><button class="icon-button" data-action="close-cart" aria-label="Fechar">×</button></div>'+(app.cart.length?'<div class="cart-items">'+items+'</div><div class="cart-summary"><div class="summary-line"><span>Subtotal</span><span>'+money(total)+'</span></div><div class="summary-line"><span>Taxas</span><span>Calculadas conforme a modalidade</span></div><div class="summary-line summary-total"><span>Total estimado</span><span>'+money(total)+'</span></div><button class="button button-dark" data-action="checkout">Continuar para checkout <span>↗</span></button><p class="cart-disclaimer">O valor definitivo é conferido pelo servidor ao confirmar o pedido.</p></div>':'<div class="cart-empty"><div class="empty-icon">◌</div><h3>Sua mesa está vazia.</h3><p>Escolha algo que dê vontade de sentar e ficar mais um pouco.</p><button class="button button-dark" data-action="close-cart">Ver o cardápio</button></div>')+'</aside></div>';
}
function openCart(){app.cartOpen=true;renderCart()}
function checkoutForm(){
  const subtotal=app.cart.reduce((sum,item)=>sum+cartItemPrice(item)*item.quantity,0);
  app.checkoutCoupon=null;
  root.getElementById('checkoutRoot').innerHTML='<div class="modal-backdrop" data-action="checkout-backdrop"><form class="checkout-modal" id="checkoutForm" role="dialog" aria-modal="true"><label class="hp-field" aria-hidden="true">Não preencha este campo<input name="contact_check" tabindex="-1" autocomplete="off"></label><div class="modal-topline"><span>QUASE NA MESA</span><button type="button" class="icon-button" data-action="close-checkout" aria-label="Fechar">×</button></div><h2>Para onde vai o pedido?</h2><p>Seu pedido será enviado à cozinha quando você confirmar.</p><label class="form-field"><span>Seu nome</span><input required minlength="2" name="customerName" autocomplete="name" placeholder="Como podemos chamar você?"></label><label class="form-field"><span>Telefone</span><input required name="phone" autocomplete="tel" placeholder="(11) 99999-9999"></label><div class="form-field"><span>Como prefere receber?</span><div class="fulfillment-options"><button class="fulfillment-option active" type="button" data-fulfillment="pickup">Retirar</button><button class="fulfillment-option" type="button" data-fulfillment="table">Na mesa</button><button class="fulfillment-option" type="button" data-fulfillment="delivery">Entrega</button></div><input type="hidden" name="fulfillment" value="pickup"></div><label class="form-field hidden" id="tableField"><span>Escolha uma mesa livre</span><select name="tableLabel" aria-describedby="tableAvailabilityHint" disabled><option value="">Carregando mesas…</option></select><small id="tableAvailabilityHint" class="table-availability-hint">Somente mesas livres podem ser selecionadas.</small></label><label class="form-field hidden" id="addressField"><span>Endereço de entrega</span><textarea name="deliveryAddress" placeholder="Rua, número, bairro e complemento"></textarea></label><label class="form-field"><span>Observação para a cozinha (opcional)</span><textarea name="note" maxlength="500" placeholder="Algum detalhe importante?"></textarea></label><div class="coupon-checkout"><label class="form-field"><span>Cupom de desconto</span><div class="coupon-input-row"><input id="checkoutCouponCode" maxlength="32" placeholder="Digite seu cupom" autocomplete="off"><button class="button button-outline button-small" type="button" data-action="apply-coupon">Aplicar</button></div></label><p id="checkoutCouponMessage" class="coupon-message" aria-live="polite"></p></div><div class="payment-note">Pagamento: combinar diretamente com o restaurante. Esta demo não processa nem aprova pagamentos.</div><div class="checkout-safety-note"><strong>Tem alergia ou restrição alimentar?</strong> Confirme ingredientes e risco de contaminação cruzada diretamente com o restaurante antes de concluir o pedido.</div><label class="checkout-legal-consent"><input type="checkbox" name="termsAccepted" required><span>Confirmo que revisei os itens e li os <a href="/termos-de-uso.html" target="_blank" rel="noopener noreferrer">Termos de uso</a> e a <a href="/politica-de-privacidade.html" target="_blank" rel="noopener noreferrer">Política de privacidade</a>.</span></label><div class="checkout-total"><span>Subtotal</span><span id="checkoutSubtotal">'+money(subtotal)+'</span></div><div class="checkout-total coupon-discount-row" id="checkoutDiscountRow" hidden><span>Desconto</span><span id="checkoutDiscount">−'+money(0)+'</span></div><div class="checkout-total checkout-grand-total"><strong>Total estimado</strong><strong id="checkoutTotal">'+money(subtotal)+'</strong></div><p class="error-text" id="checkoutError" aria-live="polite"></p><button class="button button-dark" type="submit" style="width:100%">Confirmar pedido <span>↗</span></button></form></div>';
  const checkoutFormNode=root.getElementById('checkoutForm');
  checkoutFormNode.addEventListener('submit',submitCheckout);
  if(app.tableQr)renderCheckoutMode(checkoutFormNode,'table');
  const couponInput = root.getElementById('checkoutCouponCode');
  couponInput?.addEventListener('input', () => {
    app.couponValidationVersion = (app.couponValidationVersion || 0) + 1;
    const enteredCode = couponInput.value.toUpperCase().replace(/\s+/g, '');
    if (app.checkoutCoupon && enteredCode !== app.checkoutCoupon.code) {
      app.checkoutCoupon = null;
      updateCheckoutTotals();
    }
    const message = root.getElementById('checkoutCouponMessage');
    if (message && enteredCode !== app.checkoutCoupon?.code) {
      message.textContent = enteredCode ? 'Aplique o cupom para validar o desconto.' : '';
      message.className = 'coupon-message';
    }
  });
}
async function submitCheckout(event){
  event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type=submit]'),error=root.getElementById('checkoutError');
  const data=new FormData(form),payload={contact_check:data.get('contact_check'),customerName:data.get('customerName'),phone:data.get('phone'),fulfillment:data.get('fulfillment'),tableLabel:data.get('tableLabel')||(app.tableQr?String(app.tableQr.number):''),tableQrToken:app.tableQr?.token||'',deliveryAddress:data.get('deliveryAddress'),note:data.get('note'),couponCode:app.checkoutCoupon?.code||'',idempotencyKey:app.checkoutKey,items:app.cart.map(item=>item.comboId?({comboId:item.comboId,quantity:item.quantity,notes:item.notes}):({productId:item.productId,quantity:item.quantity,sizeKey:item.sizeKey,crustKey:item.crustKey,ingredients:item.ingredients,notes:item.notes}))};
  if(payload.fulfillment==='table'&&!payload.tableLabel){error.textContent='Selecione uma mesa livre antes de confirmar.';form.querySelector('[name=tableLabel]')?.focus();return}
  button.disabled=true;button.textContent='Enviando para a cozinha…';error.textContent='';
  try{const result=await api('/api/orders',{method:'POST',body:JSON.stringify(payload)});app.cart=[];setCart();app.checkoutCoupon=null;rememberOrderToken(result.order.trackingToken);app.checkoutOpen=false;app.cartOpen=false;clearCheckoutKey();root.getElementById('checkoutRoot').innerHTML='';root.getElementById('cartRoot').innerHTML='';location.hash='pedido/'+result.order.trackingToken;toast('Pedido registrado pela cozinha.')}
  catch(e){error.textContent=e.message;if(payload.fulfillment==='table'){const select=form.querySelector('[name=tableLabel]');if(select)loadAvailableTables(select)}button.disabled=false;button.innerHTML='Confirmar pedido <span>↗</span>'}
}
async function applyCheckoutCoupon(){
  const input=root.getElementById('checkoutCouponCode'),message=root.getElementById('checkoutCouponMessage');
  if(!input||!message)return;
  const code=input.value.trim().toUpperCase().replace(/\s+/g,'');
  if(!code){
    app.couponValidationVersion=(app.couponValidationVersion||0)+1;
    app.checkoutCoupon=null;
    message.textContent='Digite um código de cupom.';
    message.className='coupon-message is-error';
    const button=root.querySelector('[data-action="apply-coupon"]');
    const submitButton=root.querySelector('#checkoutForm [type="submit"]');
    if(button){button.disabled=false;button.textContent='Aplicar'}
    if(submitButton)submitButton.disabled=false;
    updateCheckoutTotals();
    return;
  }
  const version=app.couponValidationVersion=(app.couponValidationVersion||0)+1;
  const button=root.querySelector('[data-action="apply-coupon"]');
  const submitButton=root.querySelector('#checkoutForm [type="submit"]');
  if(button){button.disabled=true;button.textContent='Validando…'}
  if(submitButton)submitButton.disabled=true;
  try{
    const result=await api('/api/coupons/validate',{method:'POST',body:JSON.stringify({code,items:app.cart.map(item=>({productId:item.productId,quantity:item.quantity,sizeKey:item.sizeKey,crustKey:item.crustKey,ingredients:item.ingredients,notes:item.notes}))})});
    const currentCode=input.value.toUpperCase().replace(/\s+/g,'');
    if(version!==app.couponValidationVersion||currentCode!==code)return;
    app.checkoutCoupon={code:result.code,discountCents:result.discountCents,subtotalCents:result.subtotalCents};
    message.textContent='Cupom aplicado! Você economiza '+money(result.discountCents)+'.';message.className='coupon-message is-success';updateCheckoutTotals();
  }catch(e){
    if(version!==app.couponValidationVersion||input.value.toUpperCase().replace(/\s+/g,'')!==code)return;
    app.checkoutCoupon=null;message.textContent=e.message;message.className='coupon-message is-error';updateCheckoutTotals();
  }finally{
    // Uma validação antiga não pode reabilitar os controles enquanto uma nova
    // validação do cupom ainda está em andamento.
    if(version===app.couponValidationVersion){
      if(button){button.disabled=false;button.textContent='Aplicar'}
      if(submitButton)submitButton.disabled=false;
    }
  }
}
function updateCheckoutTotals(){
  const subtotal=app.cart.reduce((sum,item)=>sum+cartItemPrice(item)*item.quantity,0);
  const discount=app.checkoutCoupon&&app.checkoutCoupon.subtotalCents===subtotal?Math.min(subtotal,app.checkoutCoupon.discountCents):0;
  if(app.checkoutCoupon&&app.checkoutCoupon.subtotalCents!==subtotal)app.checkoutCoupon=null;
  const sub=root.getElementById('checkoutSubtotal'),disc=root.getElementById('checkoutDiscount'),row=root.getElementById('checkoutDiscountRow'),total=root.getElementById('checkoutTotal');
  if(sub)sub.textContent=money(subtotal);if(disc)disc.textContent='−'+money(discount);if(row)row.hidden=!discount;if(total)total.textContent=money(subtotal-discount);
}
function ensureCheckoutKey(){
  const fingerprint=JSON.stringify(app.cart);
  try{
    const saved=JSON.parse(sessionStorage.getItem('menuza-checkout-key')||'null');
    if(saved&&saved.fingerprint===fingerprint&&typeof saved.key==='string'&&saved.key.length>=12){
      app.checkoutKey=saved.key;
      return;
    }
    app.checkoutKey=randomId();
    sessionStorage.setItem('menuza-checkout-key',JSON.stringify({key:app.checkoutKey,fingerprint}));
  }catch{app.checkoutKey=app.checkoutKey||randomId()}
}
function clearCheckoutKey(){
  app.checkoutKey='';
  try{sessionStorage.removeItem('menuza-checkout-key')}catch{}
}
function openCheckout(){
  if(!app.cart.length)return toast('Adicione um prato antes de continuar.');
  ensureCheckoutKey();app.checkoutOpen=true;app.cartOpen=false;root.getElementById('cartRoot').innerHTML='';checkoutForm();
}
async function launchAR(productId) {
  const product = app.catalog.products.find(p => p.id === productId);
  if (!product) return;

  // Primeiro tenta a RA WebXR, que usa o modelo procedural atual e não depende de
  // um arquivo GLB/USDZ separado. Se a sessão falhar, tenta a alternativa nativa.
  if (app.scene && app.scene.product.id === productId) {
    try {
      if (await app.scene.supportsAR()) {
        await app.scene.enterAR();
        return;
      }
    } catch (error) {
      console.warn('[Menuza AR] WebXR indisponível; tentando alternativa nativa.', error);
    }
  }

  if (product.modelUrl) {
    const url = new URL(product.modelUrl, location.href);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
      toast('O modelo de RA precisa estar em uma origem HTTPS segura.');
      return;
    }

    const appleDevice = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    if (/Android/i.test(navigator.userAgent) && /\.glb($|[?#])/i.test(url.href)) {
      const intent = 'intent://arvr.google.com/scene-viewer/1.0?file=' + encodeURIComponent(url.href) + '&mode=ar_preferred#Intent;scheme=https;package=com.google.android.googlequicksearchbox;action=android.intent.action.VIEW;S.browser_fallback_url=' + encodeURIComponent(location.href) + ';end;';
      location.href = intent;
      return;
    }

    if (appleDevice && /\.usdz($|[?#])/i.test(url.href)) {
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

  if (app.builder) {
    app.viewMode = '3d';
    renderBuilder();
  }
  toast('A RA por câmera não é compatível com este navegador/aparelho ou não há modelo nativo configurado para este prato. A prévia 3D continua disponível.');
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
    const prepMinutes=Number(order.prepMinutes);const estimatedAt=Date.parse(order.createdAt)+prepMinutes*60000;const prepEstimate=!isCancelled&&['received','confirmed','preparing'].includes(current)&&Number.isFinite(estimatedAt)&&prepMinutes>0?(Date.now()>estimatedAt?'O preparo está levando mais tempo que o previsto. A estimativa inicial era por volta de '+new Date(estimatedAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})+'. Acompanhe as atualizações nesta página.':'Previsão inicial: cerca de '+prepMinutes+' min de preparo, por volta de '+new Date(estimatedAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})+'. É uma estimativa e pode variar.'):'';const flowStatuses=order.fulfillment==='delivery'?['received','confirmed','preparing','ready','delivering','completed']:['received','confirmed','preparing','ready','completed'];const timeline=flow.map((label,index)=>{const changedAt=formatOrderStatusTime(order.history,flowStatuses[index]);return '<div class="timeline-item '+(!isCancelled&&index<currentStep?'done':!isCancelled&&index===currentStep?'current':'')+'"><div class="timeline-dot"></div><span>'+label+'</span>'+(changedAt?'<small class="timeline-time">'+esc(changedAt)+'</small>':'')+'</div>'}).join('');
    const rows=order.items.map(item=>{const snapshot=item.snapshot,art=snapshot.type==='pizza'?pizzaArt(snapshot.ingredients,item.productId):snapshot.type==='burger'?burgerArt(snapshot.ingredients):plateArt();return '<div class="tracking-order-item"><div class="tracking-art">'+art+'</div><span>'+item.quantity+'× '+esc(item.name)+'<small>'+esc(item.snapshot.size.label)+' · '+esc(item.ingredients.map(i=>i.name).join(', ')||'composição da casa')+'</small></span><b>'+money(item.unitPriceCents*item.quantity)+'</b></div>'}).join('');
    target.innerHTML='<section class="tracking-shell"><a class="tracking-back" href="#" data-action="back-home">← Voltar ao cardápio</a><div class="tracking-head"><div class="checkmark">'+(isCancelled?'×':'✓')+'</div><div class="eyebrow" style="justify-content:center">PEDIDO ENVIADO À COZINHA</div><h1>'+(isCancelled?'Pedido cancelado.':'Estamos cuidando de tudo.')+'</h1><p>Este acompanhamento reflete as atualizações feitas pelo restaurante.<br>O número do pedido é <b>'+esc(order.id)+'</b>.</p></div><div class="tracking-card"><div class="tracking-meta"><div><small>STATUS AGORA</small><b>'+esc(labels[current]||current)+'</b></div><div class="status-pill">'+(order.fulfillment==='delivery'?'Entrega':order.fulfillment==='table'?'Mesa '+esc(order.tableLabel):'Retirada')+'</div></div>'+(isCancelled?'<div class="ready-banner" style="background:#f5e8e2;color:#9e4e3d">O restaurante cancelou este pedido. Entre em contato com a equipe para mais informações.</div>':'<div class="status-timeline" style="grid-template-columns:repeat('+flow.length+',minmax(0,1fr))">'+timeline+'</div>')+(prepEstimate?'<div class="ready-banner tracking-estimate">'+esc(prepEstimate)+'</div>':'')+'<div class="tracking-items"><h3>Na sua sacola</h3>'+rows+'<div class="tracking-order-item" style="border-top:1px solid #e5e8df;margin-top:5px;padding-top:13px"><b>Total</b><b>'+money(order.totalCents)+'</b></div></div>'+(current==='ready'?'<div class="ready-banner">Seu pedido está pronto. Bom apetite!</div>':current==='completed'?'<div class="ready-banner">Pedido concluído. Esperamos que tenha gostado!</div>':'')+'<p class="tracking-note">Pagamento combinado diretamente com o restaurante. A animação e o status de preparo acompanham somente atualizações reais da equipe.</p></div></section>';
  }catch(e){target.innerHTML='<section class="tracking-shell"><a class="tracking-back" href="#" data-action="back-home">← Voltar ao cardápio</a><div class="tracking-head"><h1>Não encontramos esse pedido.</h1><p>'+esc(e.message)+'</p></div></section>'}
}
function showHome(){clearInterval(app.trackingTimer);root.getElementById('trackingView').classList.add('hidden');root.getElementById('adminView').classList.add('hidden');root.getElementById('homeView').classList.remove('hidden')}
function onRoute(){const hash=location.hash.replace(/^#/,'');if(hash==='admin')return showAdmin();if(hash==='conta')return showCustomerAccount();if(hash.startsWith('pedido/'))return showTracking(hash.slice(7));if(!app.customer){history.replaceState(null,'',location.pathname+location.search+'#conta');return showCustomerAccount()}return openMenu()}
async function showCustomerAccount(){clearInterval(app.trackingTimer);root.getElementById('homeView').classList.add('hidden');root.getElementById('adminView').classList.add('hidden');const target=root.getElementById('trackingView');target.classList.remove('hidden');target.innerHTML='<section class="customer-orders-shell"><a class="tracking-back" href="#" data-action="back-home">← Voltar ao cardápio</a><div class="customer-orders-heading"><div class="eyebrow">SUA EXPERIÊNCIA MENUZA</div><h1>Sua <em>conta.</em></h1><p>Entre para consultar seus pedidos com privacidade. Cada conta acessa apenas os pedidos vinculados a ela.</p></div><div class="customer-account-content"></div></section>';app.customerMode=app.customerMode||'login';renderCustomerAuth();try{const result=await api('/api/customer/me');app.customer=result.customer;if(app.customer)await renderCustomerDashboard()}catch{app.customer=null}}
function renderCustomerAuth(errorText=''){const content=root.querySelector('.customer-account-content');if(!content)return;const register=app.customerMode==='register';content.innerHTML='<div class="customer-auth-card"><div class="customer-auth-switch"><button type="button" data-action="customer-mode" data-mode="login" class="'+(!register?'active':'')+'">Entrar</button><button type="button" data-action="customer-mode" data-mode="register" class="'+(register?'active':'')+'">Criar conta</button></div><form id="customerAuthForm" class="customer-auth-form"><label class="hp-field" aria-hidden="true">Não preencha este campo<input name="contact_check" tabindex="-1" autocomplete="off"></label><h2>'+(register?'Crie sua conta':'Que bom ter você de volta')+'</h2><p>'+(register?'Cadastre seus dados para manter seus pedidos reunidos.':'Entre com seu e-mail e senha para acessar seus pedidos.')+'</p>'+(register?'<label class="form-field"><span>Nome completo</span><input name="name" required minlength="2" maxlength="100" autocomplete="name" placeholder="Seu nome"></label>':'')+'<label class="form-field"><span>E-mail</span><input type="email" name="email" required maxlength="254" autocomplete="email" placeholder="voce@exemplo.com"></label>'+(register?'<label class="form-field"><span>Telefone (opcional)</span><input name="phone" autocomplete="tel" maxlength="30" placeholder="(00) 00000-0000"></label>':'')+'<label class="form-field"><span>Senha</span><input type="password" name="password" required minlength="'+(register?'8':'1')+'" maxlength="128" autocomplete="'+(register?'new-password':'current-password')+'" placeholder="'+(register?'Mínimo de 8 caracteres':'Sua senha')+'"></label>'+(register?'<label class="checkout-legal-consent customer-legal-consent"><input type="checkbox" name="termsAccepted" required><span>Li e aceito os <a href="/termos-de-uso.html" target="_blank" rel="noopener noreferrer">Termos de uso</a> e li a <a href="/politica-de-privacidade.html" target="_blank" rel="noopener noreferrer">Política de privacidade</a> e a <a href="/politica-de-cookies.html" target="_blank" rel="noopener noreferrer">Política de cookies</a>.</span></label>':'')+'<p class="error-text" id="customerAuthError" role="alert">'+esc(errorText)+'</p><button class="button button-dark" type="submit" style="width:100%">'+(register?'Criar minha conta':'Entrar na minha conta')+' <span>↗</span></button></form><p class="customer-auth-privacy">Sua sessão é protegida por cookie HttpOnly. Seus pedidos são consultados no servidor usando o identificador da sua conta. <a href="/termos-de-uso.html">Termos de uso</a> · <a href="/politica-de-privacidade.html">Privacidade</a> · <a href="/politica-de-cookies.html">Cookies</a>.</p></div>';root.querySelector('#customerAuthForm input[name="name"], #customerAuthForm input[name="email"]')?.focus({preventScroll:true});root.getElementById('customerAuthForm').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type=submit]'),data=new FormData(form),payload=Object.fromEntries(data.entries());button.disabled=true;button.textContent='Aguarde…';try{const result=await api(register?'/api/customer/register':'/api/customer/login',{method:'POST',body:JSON.stringify(payload)});app.customer=result.customer;toast(register?'Conta criada com sucesso.':'Login realizado.');await renderCustomerDashboard();location.hash='menu'}catch(error){const node=root.getElementById('customerAuthError');if(node)node.textContent=error.message;button.disabled=false;button.textContent=register?'Criar minha conta ↗':'Entrar na minha conta ↗'}})}
async function renderCustomerDashboard(){const content=root.querySelector('.customer-account-content');if(!content||!app.customer)return;content.innerHTML='<div class="customer-profile-card"><div><div class="eyebrow">CONTA DO CLIENTE</div><h2>'+esc(app.customer.name)+'</h2><p>'+esc(app.customer.email)+'</p></div><button class="button button-outline button-small" data-action="customer-logout">Sair</button></div><div class="customer-orders-section-head"><div><div class="eyebrow">HISTÓRICO PESSOAL</div><h2>Seus pedidos</h2></div><a class="text-link" href="#menu">Fazer novo pedido ↗</a></div><div class="customer-orders-list"><div class="loading-line">Carregando seus pedidos…</div></div><div class="customer-orders-footnote">Por segurança, o servidor retorna apenas pedidos vinculados à sua conta. Pedidos feitos antes de criar uma conta ou sem estar conectado não são associados automaticamente.</div><section class="account-data-panel"><h3>Privacidade e seus dados</h3><p>Você pode solicitar uma cópia, correção ou exclusão de dados pelo <a href="/contato.html#solicitacao-dados">canal de privacidade</a>. A exclusão da conta exige confirmação de senha. Registros de pedidos podem precisar ser mantidos por obrigações legais, prevenção a fraude ou defesa de direitos.</p><form id="deleteCustomerAccountForm" class="account-delete-form"><label class="form-field"><span>Confirme sua senha para excluir a conta</span><input type="password" name="password" required minlength="1" maxlength="128" autocomplete="current-password"></label><label class="delete-account-confirm"><input type="checkbox" name="confirmDelete" required><span>Entendo que a conta será excluída e que essa ação não pode ser desfeita.</span></label><p class="error-text" id="deleteAccountError" role="alert"></p><button type="submit" class="button button-outline button-small">Excluir minha conta</button></form></section>';try{const result=await api('/api/customer/orders');app.customerOrders=result.orders;renderCustomerOrders(result.orders)}catch(error){if(error?.status===401){app.customer=null;app.customerMode='login';renderCustomerAuth('Sua sessão expirou. Entre novamente para continuar.');return}const list=content.querySelector('.customer-orders-list');if(list)list.innerHTML='<div class="customer-orders-empty"><h2>Não foi possível carregar seus pedidos</h2><p>'+esc(error.message)+'</p></div>'}}
function renderCustomerOrders(orders){const list=root.querySelector('.customer-orders-list');if(!list)return;const labels={received:'Recebido',confirmed:'Confirmado',preparing:'Em preparo',ready:'Pronto',delivering:'Saiu para entrega',completed:'Concluído',cancelled:'Cancelado'};if(!orders.length){list.innerHTML='<div class="customer-orders-empty"><span class="customer-empty-mark">▱</span><h2>Ainda não há pedidos na sua conta</h2><p>Faça seu próximo pedido enquanto estiver conectado e ele ficará salvo no seu histórico pessoal.</p><a class="button button-dark" href="#menu" data-action="back-home">Explorar cardápio <span>↗</span></a></div>';return}list.innerHTML=orders.map(order=>{const status=order.history?.length?order.history[order.history.length-1].status:order.status;const fulfillment=order.fulfillment==='delivery'?'Entrega':order.fulfillment==='table'?'Mesa '+esc(order.tableLabel||''): 'Retirada';const date=order.createdAt?new Date(order.createdAt).toLocaleString('pt-BR',{dateStyle:'medium',timeStyle:'short'}):'Data não disponível';const items=(order.items||[]).map(item=>`${item.quantity}× ${esc(item.name)}`).join(' · ');const discount=Number(order.discountCents)>0?'<div class="customer-order-discount">Cupom '+esc(order.couponCode)+' · você economizou '+money(order.discountCents)+'</div>':'';return '<article class="customer-order-card"><div class="customer-order-card-top"><div><span class="customer-order-number">PEDIDO '+esc(order.id)+'</span><span class="customer-order-date">'+esc(date)+'</span></div><span class="customer-status status-'+esc(status)+'">'+esc(labels[status]||status)+'</span></div><div class="customer-order-items">'+items+'</div><div class="customer-order-card-bottom"><span>'+fulfillment+'</span><strong>'+money(order.totalCents)+'</strong></div><div class="customer-order-actions"><a class="customer-order-link" href="#pedido/'+encodeURIComponent(order.trackingToken)+'">Acompanhar pedido <span>↗</span></a><button class="button button-outline button-small" type="button" data-action="repeat-order" data-order-id="'+esc(order.id)+'">Repetir pedido ↻</button></div></article>'}).join('')}
async function logoutCustomer(){try{await api('/api/customer/logout',{method:'POST'})}catch{}app.customer=null;app.customerMode='login';app.catalog=null;app.cart=[];setCart();toast('Você saiu da sua conta.');location.hash='';showCustomerAccount()}

async function showAdmin(){
  clearInterval(app.trackingTimer);root.getElementById('homeView').classList.add('hidden');root.getElementById('trackingView').classList.add('hidden');const node=root.getElementById('adminView');node.classList.remove('hidden');
  try{await api('/api/admin/me');app.admin.authenticated=true;renderAdmin();refreshAdmin();connectAdminEvents()}catch{app.admin.authenticated=false;renderAdminLogin()}
}
function renderAdminLogin(errorText=''){
  root.getElementById('adminView').innerHTML='<div class="admin-shell"><a class="tracking-back" href="#" data-action="back-home">← Voltar ao cardápio</a><form class="admin-login" id="adminLogin"><label class="hp-field" aria-hidden="true">Não preencha este campo<input name="contact_check" tabindex="-1" autocomplete="off"></label><div class="eyebrow">ÁREA RESTRITA</div><h1>Bom trabalho começa<br>com uma boa visão.</h1><p>Entre no painel da Bela Mesa para acompanhar pedidos e atualizar o cardápio.</p><label class="form-field"><span>Senha do restaurante</span><input type="password" name="password" required autocomplete="current-password"></label><label class="form-field"><span>Código autenticador (se 2FA estiver ativado)</span><input type="text" name="otp" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" autocomplete="one-time-code" placeholder="000000"></label><p class="error-text">'+esc(errorText)+'</p><button class="button button-dark" type="submit" style="width:100%">Entrar no painel <span>↗</span></button><p class="admin-legal-links"><a href="/termos-de-uso.html">Termos de uso</a><a href="/politica-de-privacidade.html">Política de privacidade</a><a href="/politica-de-cookies.html">Política de cookies</a></p></form></div>';
  root.getElementById('adminLogin').addEventListener('submit',async event=>{event.preventDefault();const formData=new FormData(event.currentTarget),password=formData.get('password'),otp=String(formData.get('otp')||'').trim();try{await api('/api/admin/login',{method:'POST',body:JSON.stringify({password,otp})});app.admin.authenticated=true;renderAdmin();refreshAdmin();connectAdminEvents()}catch(e){renderAdminLogin(e.message)}});
}
function renderAdmin(){
  const tabs=[['orders','Pedidos'],['analytics','Vendas'],['combos','Combos'],['tables','Mesas 3D'],['catalog','Cardápio'],['ingredients','Adicionais'],['coupons','Cupons'],['privacy','Solicitações de dados'],['settings','Configurações']];
  root.getElementById('adminView').innerHTML='<div class="admin-shell"><div class="admin-top"><div><div class="eyebrow">BELA MESA · OPERAÇÃO</div><h1>Painel da cozinha</h1><p>Pedidos e cardápio em um só lugar.</p></div><div class="admin-top-actions"><a href="#" class="button button-outline button-small" data-action="back-home">Ver cardápio</a><button class="button button-dark button-small" data-action="admin-logout">Sair da conta</button></div></div><div class="admin-tabs">'+tabs.map(t=>'<button class="admin-tab '+(app.admin.tab===t[0]?'active':'')+'" data-admin-tab="'+t[0]+'">'+t[1]+'</button>').join('')+'</div><div id="adminBody"><div class="loading-line">Carregando dados da cozinha…</div></div></div>';
  if(app.admin.tab==='orders')renderOrdersAdmin();else if(app.admin.tab==='analytics')renderAnalyticsAdmin();else if(app.admin.tab==='combos')renderCombosAdmin();else if(app.admin.tab==='tables')renderTablesAdmin();else if(app.admin.tab==='catalog')renderCatalogAdmin();else if(app.admin.tab==='ingredients')renderIngredientsAdmin();else if(app.admin.tab==='coupons')renderCouponsAdmin();else if(app.admin.tab==='privacy')renderPrivacyRequestsAdmin();else renderSettingsAdmin();
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
function applyOrderFilters(){
  const cards=[...root.querySelectorAll('[data-order-card]')];if(!cards.length)return;
  const query=String(app.admin.orderQuery||'').trim().toLocaleLowerCase('pt-BR');let visible=0;
  for(const card of cards){const show=(!query||card.dataset.search.includes(query))&&(app.admin.orderStatus==='all'||card.dataset.status===app.admin.orderStatus)&&(app.admin.orderFulfillment==='all'||card.dataset.fulfillment===app.admin.orderFulfillment);card.hidden=!show;if(show)visible++}
  const count=root.getElementById('ordersVisibleCount');if(count)count.textContent=String(visible);
  const empty=root.getElementById('ordersFilterEmpty');if(empty)empty.hidden=visible!==0;
}
function csvCell(value){
  let text=String(value??'');
  if(/^[=+\-@\t\r]/.test(text))text="'"+text;
  return '"'+text.replace(/"/g,'""')+'"';
}
function exportVisibleOrders(){
  const orders=app.admin.orders||[];
  const query=String(app.admin.orderQuery||'').trim().toLocaleLowerCase('pt-BR');
  const rows=orders.filter(order=>{
    const searchable=[order.id,order.customerName,order.phone,order.deliveryAddress,order.tableLabel,order.note,...(order.items||[]).map(i=>i.name),...(order.items||[]).flatMap(i=>(i.ingredients||[]).map(g=>g.name))].filter(Boolean).join(' ').toLocaleLowerCase('pt-BR');
    return (!query||searchable.includes(query))&&(app.admin.orderStatus==='all'||order.status===app.admin.orderStatus)&&(app.admin.orderFulfillment==='all'||order.fulfillment===app.admin.orderFulfillment);
  });
  if(!rows.length)return toast('Não há pedidos para exportar com os filtros atuais.');
  const statusLabels={received:'Recebido',confirmed:'Confirmado',preparing:'Em preparo',ready:'Pronto',delivering:'Em entrega',completed:'Concluído',cancelled:'Cancelado'};
  const fulfillmentLabels={delivery:'Entrega',table:'Mesa',pickup:'Retirada'};
  const header=['Pedido','Data','Cliente','Telefone','Tipo','Mesa','Endereço','Status','Itens','Observações','Total (R$)'];
  const csv=[header,...rows.map(order=>[
    order.id,order.createdAt?new Date(order.createdAt).toLocaleString('pt-BR'):'',order.customerName,order.phone,
    fulfillmentLabels[order.fulfillment]||order.fulfillment,order.tableLabel||'',order.deliveryAddress||'',
    statusLabels[order.status]||order.status,
    (order.items||[]).map(item=>item.quantity+'x '+item.name+(item.ingredients?.length?' ('+item.ingredients.map(i=>i.name).join(', ')+')':'')).join(' | '),
    order.note||'',(Number(order.totalCents||0)/100).toFixed(2).replace('.',',')
  ])].map(row=>row.map(csvCell).join(';')).join('\r\n');
  const blob=new Blob(['\\uFEFF',csv],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download='menuza-pedidos-'+new Date().toISOString().slice(0,10)+'.csv';
  document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
  toast(rows.length+' pedido(s) exportado(s).');
}
function updateOrderElapsedTimes(){
  const now=Date.now();
  for(const node of root.querySelectorAll('[data-order-elapsed]')){
    const createdAt=Number(node.dataset.createdAt),limit=Math.max(1,Number(node.dataset.prepMinutes)||30);
    if(!Number.isFinite(createdAt)||createdAt<=0){node.textContent='Tempo indisponível';continue}
    const minutes=Math.max(0,Math.floor((now-createdAt)/60000));
    node.textContent=minutes<1?'Recebido agora':'Há '+minutes+' min na fila';
    const overdue=minutes>limit;
    node.classList.toggle('is-overdue',overdue);
    node.setAttribute('aria-label',overdue?'Atenção: pedido há '+minutes+' minutos, acima do tempo estimado de '+limit+' minutos':'Pedido há '+minutes+' minutos');
  }
}
function renderOrdersAdmin(metrics,orders){
  app.admin.orders=orders;
  const target=root.getElementById('adminBody');if(!target)return;if(!metrics||!orders){target.innerHTML='<div class="loading-line">Atualizando pedidos…</div>';return}
  const cards=orders.map(order=>{
    const lines=order.items.map(item=>'<div><strong>'+item.quantity+'× '+esc(item.name)+'</strong> · '+esc(item.snapshot.size.label)+'<br><span>'+esc(item.ingredients.map(i=>i.name).join(', ')||'composição da casa')+'</span></div>').join('');
    const fulfillment=order.fulfillment==='table'?'Mesa '+esc(order.tableLabel):order.fulfillment==='delivery'?'Entrega · '+esc(order.deliveryAddress):'Retirada';
    const discountNote=Number(order.discountCents)>0?'<div class="order-discount-note">Cupom '+esc(order.couponCode)+' · desconto de '+money(order.discountCents)+'</div>':'';
    let whatsappPhone=String(order.phone||'').replace(/\D/g,'');if(whatsappPhone.length===10||whatsappPhone.length===11)whatsappPhone='55'+whatsappPhone;
    const whatsappMessage=encodeURIComponent('Olá, '+(order.customerName||'')+'! Aqui é do restaurante sobre o pedido '+order.id+'.');
    const whatsappAction=whatsappPhone.length>=12&&whatsappPhone.length<=15?'<a class="button button-outline button-small order-whatsapp-link" href="https://wa.me/'+whatsappPhone+'?text='+whatsappMessage+'" target="_blank" rel="noopener noreferrer">WhatsApp ↗</a>':'';
    const searchable=[order.id,order.customerName,order.phone,order.deliveryAddress,order.tableLabel,order.note,...order.items.map(i=>i.name),...order.items.flatMap(i=>i.ingredients.map(g=>g.name))].filter(Boolean).join(' ').toLocaleLowerCase('pt-BR');
    const elapsed=['received','confirmed','preparing'].includes(order.status)?'<span class="order-elapsed" data-order-elapsed data-created-at="'+Date.parse(order.createdAt)+'" data-prep-minutes="'+Number(metrics.prepMinutes||30)+'" aria-live="off"></span>':'';
    return '<article class="order-card" data-order-card data-search="'+esc(searchable)+'" data-status="'+esc(order.status)+'" data-fulfillment="'+esc(order.fulfillment)+'"><div class="order-card-head"><div><div class="order-number">'+esc(order.id)+' · '+esc(order.customerName)+'</div><div class="order-time">'+new Date(order.createdAt).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})+' · '+esc(order.phone)+'</div>'+elapsed+'</div>'+statusSelect(order)+'</div><div class="order-customer">'+fulfillment+'</div><div class="order-lines">'+lines+(order.note?'<div style="margin-top:6px"><em>Obs.: '+esc(order.note)+'</em></div>':'')+'</div><div class="order-card-footer"><span class="order-fulfillment">Pagamento no restaurante</span><div class="order-card-footer-actions">'+whatsappAction+'<b>'+money(order.totalCents)+'</b></div></div></article>';
  }).join('');
  target.innerHTML='<div class="metrics-grid"><div class="metric-card"><span>Pedidos recebidos</span><b>'+metrics.counts.received+'</b><small>Aguardando confirmação</small></div><div class="metric-card"><span>Em preparo</span><b>'+metrics.counts.preparing+'</b><small>Na cozinha agora</small></div><div class="metric-card"><span>Prontos</span><b>'+metrics.counts.ready+'</b><small>Aguardando retirada ou entrega</small></div><div class="metric-card"><span>Faturamento de hoje</span><b>'+money(metrics.revenueCents)+'</b><small>Pedidos não cancelados</small></div></div><div class="admin-content-grid"><section class="admin-panel"><div class="admin-panel-head"><div><h2>Pedidos recentes</h2><small>Atualização ao vivo · <span id="ordersVisibleCount">'+orders.length+'</span> de '+orders.length+'</small></div><button class="button button-outline button-small" type="button" data-action="export-orders">Exportar CSV ↓</button></div><div class="orders-filter-bar"><label class="orders-search"><span aria-hidden="true">⌕</span><input id="ordersSearch" type="search" placeholder="Buscar pedido, cliente, telefone ou item" value="'+esc(app.admin.orderQuery)+'" autocomplete="off"></label><label class="orders-filter-field"><span>Status</span><select id="ordersStatusFilter"><option value="all">Todos os status</option><option value="received">Recebido</option><option value="confirmed">Confirmado</option><option value="preparing">Em preparo</option><option value="ready">Pronto</option><option value="delivering">Em entrega</option><option value="completed">Concluído</option><option value="cancelled">Cancelado</option></select></label><label class="orders-filter-field"><span>Tipo</span><select id="ordersFulfillmentFilter"><option value="all">Todos os tipos</option><option value="delivery">Entrega</option><option value="table">Mesa</option><option value="pickup">Retirada</option></select></label><button class="button button-outline button-small" type="button" data-action="clear-order-filters">Limpar filtros</button></div><div class="orders-list">'+(cards||'<div class="admin-empty">Ainda não chegou nenhum pedido. Quando chegar, ele aparece aqui.</div>')+'<div class="admin-empty orders-filter-empty" id="ordersFilterEmpty" hidden>Nenhum pedido corresponde aos filtros. Tente outra busca.</div></div></section><aside><section class="admin-panel"><div class="admin-panel-head"><h2>Mais pedidos</h2></div><ul class="popular-list">'+(metrics.popular.length?metrics.popular.map(p=>'<li><span>'+esc(p.name)+'</span><small>'+p.quantity+' itens</small></li>').join(''):'<li><span>Sem dados ainda</span></li>')+'</ul></section><section class="admin-panel"><div class="admin-panel-head"><h2>Turno de hoje</h2></div><div class="metrics-grid"><div class="metric-card"><span>Pedidos hoje</span><b>'+metrics.ordersToday+'</b><small>Todos os status</small></div><div class="metric-card"><span>Ticket médio</span><b>'+money(metrics.averageTicketCents)+'</b><small>Exclui pedidos cancelados</small></div></div><p style="font-size:9px;line-height:1.7;color:#758278;margin:12px 0 0">Valores atualizados após o registro. Pagamentos e taxas de entrega são combinados fora desta demonstração.</p></section></aside></div>';
  updateOrderElapsedTimes();
  const statusFilter=root.getElementById('ordersStatusFilter'),fulfillmentFilter=root.getElementById('ordersFulfillmentFilter');
  if(statusFilter)statusFilter.value=app.admin.orderStatus;
  if(fulfillmentFilter)fulfillmentFilter.value=app.admin.orderFulfillment;
  applyOrderFilters();
}
async function renderCatalogAdmin(){
  const target=root.getElementById('adminBody');target.innerHTML='<div class="loading-line">Carregando cardápio…</div>';
  try{
    const catalog=await api('/api/admin/catalog');
    target.innerHTML='<section class="admin-panel"><div class="admin-panel-head"><div><h2>Produtos</h2><small>Preço-base, descrição e disponibilidade</small></div></div><form id="newProductForm" class="admin-form-grid"><label class="form-field"><span>Nome do produto</span><input name="name" required minlength="2" placeholder="Ex.: Pizza de abobrinha"></label><label class="form-field"><span>Categoria</span><select name="categoryId">'+catalog.categories.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>').join('')+'</select></label><label class="form-field"><span>Tipo</span><select name="type"><option value="pizza">Pizza</option><option value="burger">Hambúrguer</option><option value="plate">Porção</option></select></label><label class="form-field"><span>Preço-base (R$)</span><input name="price" type="number" min="5" step="0.01" required placeholder="49,90"></label><label class="form-field wide"><span>Descrição</span><input name="description" maxlength="300" placeholder="Ingredientes e detalhes do prato"></label><div class="wide"><p class="error-text" id="newProductError"></p><button class="button button-dark button-small" type="submit">Cadastrar produto +</button></div></form></section><section class="admin-panel"><div class="catalog-list">'+catalog.products.map(p=>'<div class="catalog-row" data-product-admin="'+esc(p.id)+'"><div><b>'+esc(p.name)+'</b><small>'+esc(catalog.categories.find(c=>c.id===p.categoryId)?.name||'')+' · '+esc(p.description.slice(0,70))+'</small></div><label><span class="sr-only">Preço em reais</span><input type="number" class="product-price-input" min="5" step="0.01" value="'+(p.baseCents/100).toFixed(2)+'"></label><label><input type="checkbox" class="product-active-input" '+(p.active?'checked':'')+'> Ativo</label><label><input type="checkbox" class="product-available-input" '+(p.available!==0?'checked':'')+'> Disponível</label><button class="tiny-link" data-action="save-product" data-id="'+esc(p.id)+'">Salvar</button></div>').join('')+'</div></section>';
    root.getElementById('newProductForm').addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(event.currentTarget),price=Math.round(Number(data.get('price'))*100);try{await api('/api/admin/products',{method:'POST',body:JSON.stringify({name:data.get('name'),categoryId:data.get('categoryId'),type:data.get('type'),baseCents:price,description:data.get('description')})});toast('Produto cadastrado.');renderCatalogAdmin()}catch(e){root.getElementById('newProductError').textContent=e.message}});
  }catch(e){target.innerHTML='<p class="error-text">'+esc(e.message)+'</p>'}
}
async function renderAnalyticsAdmin(days=7){
  const target=root.getElementById('adminBody');if(!target)return;
  target.innerHTML='<div class="loading-line">Calculando indicadores de vendas…</div>';
  try{
    const data=await api('/api/admin/analytics?days='+days);
    const moneyValue=value=>money(Number(value)||0);
    const maxRevenue=Math.max(1,...data.daily.map(row=>Number(row.revenueCents)||0));
    const dayLabels=data.daily.map(row=>({date:row.date,label:new Date(row.date+'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'}),revenue:Number(row.revenueCents)||0,orders:Number(row.orders)||0}));
    const bars=dayLabels.map(row=>'<div class="analytics-bar-column" title="'+esc(row.date)+' · '+row.orders+' pedido(s) · '+moneyValue(row.revenue)+'"><span>'+moneyValue(row.revenue)+'</span><div class="analytics-bar-track"><i style="height:'+Math.max(3,Math.round(row.revenue/maxRevenue*100))+'%"></i></div><small>'+esc(row.label)+'</small></div>').join('');
    const fulfillmentLabels={table:'Mesa',pickup:'Retirada',delivery:'Entrega'};
    target.innerHTML='<section class="admin-panel"><div class="admin-panel-head"><div><h2>Visão geral das vendas</h2><small>Pedidos registrados no período selecionado; valores cancelados não entram no faturamento.</small></div><label class="analytics-period"><span>Período</span><select id="analyticsDays"><option value="7">7 dias</option><option value="30">30 dias</option><option value="90">90 dias</option></select></label></div><div class="metrics-grid analytics-metrics"><div class="metric-card"><span>Faturamento</span><b>'+moneyValue(data.summary.revenueCents)+'</b><small>Pedidos não cancelados</small></div><div class="metric-card"><span>Pedidos</span><b>'+Number(data.summary.orders||0)+'</b><small>No período</small></div><div class="metric-card"><span>Ticket médio</span><b>'+moneyValue(data.summary.averageTicketCents)+'</b><small>Exclui cancelamentos</small></div><div class="metric-card"><span>Cancelados</span><b>'+Number(data.summary.cancelled||0)+'</b><small>Pedidos cancelados</small></div></div></section><div class="admin-content-grid analytics-layout"><section class="admin-panel"><div class="admin-panel-head"><div><h2>Faturamento por dia</h2><small>Valores em reais</small></div></div><div class="analytics-chart">'+(bars||'<p class="admin-empty">Ainda não há vendas nesse período.</p>')+'</div></section><aside><section class="admin-panel"><div class="admin-panel-head"><h2>Produtos mais vendidos</h2></div><ol class="analytics-popular">'+(data.popular.length?data.popular.map((row,index)=>'<li><span class="analytics-rank">'+(index+1)+'</span><span class="analytics-product-name">'+esc(row.name)+'</span><b>'+Number(row.quantity||0)+' un.</b></li>').join(''):'<li class="admin-empty">Sem vendas no período.</li>')+'</ol></section><section class="admin-panel"><div class="admin-panel-head"><h2>Pedidos por modalidade</h2></div><ul class="popular-list">'+(data.fulfillment.length?data.fulfillment.map(row=>'<li><span>'+esc(fulfillmentLabels[row.type]||row.type)+'</span><small>'+Number(row.orders||0)+' pedido(s)</small></li>').join(''):'<li><span>Sem pedidos no período.</span></li>')+'</ul></section></aside></div>';
    root.getElementById('analyticsDays').value=String(days);
    root.getElementById('analyticsDays').addEventListener('change',event=>renderAnalyticsAdmin(Number(event.target.value)));
  }catch(error){target.innerHTML='<section class="admin-panel"><p class="error-text" role="alert">'+esc(error.message||'Não foi possível carregar os indicadores.')+'</p><button class="button button-outline button-small" type="button" data-action="refresh-analytics">Tentar novamente</button></section>'}
}
async function renderCombosAdmin(){
  const target=root.getElementById('adminBody');if(!target)return;
  target.innerHTML='<div class="loading-line">Carregando combos…</div>';
  try{
    const result=await api('/api/admin/combos');
    const products=result.products.filter(product=>Number(product.active)!==0&&Number(product.available)!==0);
    target.innerHTML='<section class="admin-panel"><div class="admin-panel-head"><div><h2>Criar combo promocional</h2><small>Escolha de 2 a 6 produtos. O preço do combo deve ser inferior à soma dos preços-base.</small></div></div><form id="newComboForm" class="admin-form-grid"><label class="form-field"><span>Nome do combo</span><input name="name" required minlength="2" maxlength="80" placeholder="Ex.: Noite de pizza"></label><label class="form-field"><span>Preço promocional (R$)</span><input name="price" type="number" min="1" step="0.01" required placeholder="59,90"></label><label class="form-field wide"><span>Descrição (opcional)</span><input name="description" maxlength="240" placeholder="Uma descrição curta para o cardápio"></label><label class="form-field wide"><span>Produtos do combo</span><select name="products" multiple size="6" required aria-describedby="comboProductsHint">'+products.map(product=>'<option value="'+esc(product.id)+'">'+esc(product.name)+' · '+money(product.baseCents)+'</option>').join('')+'</select><small id="comboProductsHint">No computador use Ctrl para selecionar vários produtos; no celular selecione os itens desejados.</small></label><div class="wide"><p class="error-text" id="newComboError" role="alert"></p><button class="button button-dark button-small" type="submit">Criar combo +</button></div></form></section><section class="admin-panel"><div class="admin-panel-head"><div><h2>Combos cadastrados</h2><small>'+result.combos.length+' combo(s)</small></div></div><div class="combo-admin-list">'+(result.combos.map(combo=>'<article class="combo-admin-row" data-combo-row="'+esc(combo.id)+'"><div><b>'+esc(combo.name)+'</b><small>'+esc(combo.items.map(item=>(item.quantity>1?item.quantity+'× ':'')+item.name).join(' · '))+'</small><small>Preço: '+money(combo.priceCents)+(combo.active?' · Ativo':' · Inativo')+'</small></div><label><input type="checkbox" class="combo-active-input" '+(combo.active?'checked':'')+'> Ativo</label><button class="button button-outline button-small" data-action="save-combo-status" data-id="'+esc(combo.id)+'">Salvar status</button></article>').join('')||'<div class="admin-empty">Nenhum combo criado ainda.</div>')+'</div></section>';
    root.getElementById('newComboForm').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,data=new FormData(form),selected=[...form.elements.products.selectedOptions].map(option=>({productId:option.value,quantity:1})),error=root.getElementById('newComboError');if(selected.length<2||selected.length>6){error.textContent='Selecione de 2 a 6 produtos.';return}try{await api('/api/admin/combos',{method:'POST',body:JSON.stringify({name:data.get('name'),description:data.get('description'),priceCents:Math.round(Number(data.get('price'))*100),items:selected})});if(app.catalog)app.catalog=null;toast('Combo criado e publicado no cardápio.');renderCombosAdmin()}catch(e){error.textContent=e.message}});
  }catch(error){target.innerHTML='<section class="admin-panel"><p class="error-text" role="alert">'+esc(error.message)+'</p></section>'}
}
async function saveComboStatus(id){
  const row=root.querySelector('[data-combo-row="'+CSS.escape(id)+'"]');if(!row)return;
  try{
    const catalog=await api('/api/admin/combos'),combo=catalog.combos.find(item=>item.id===id);if(!combo)return;
    await api('/api/admin/combos/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({name:combo.name,description:combo.description,priceCents:combo.priceCents,items:combo.items.map(item=>({productId:item.productId,quantity:item.quantity})),active:row.querySelector('.combo-active-input').checked})});
    if(app.catalog)app.catalog=null;toast('Status do combo atualizado.');renderCombosAdmin();
  }catch(error){toast(error.message||'Não foi possível atualizar o combo.')}
}
function addComboToCart(id){
  const combo=app.catalog?.combos?.find(item=>item.id===id&&Number(item.active)!==0);if(!combo)return toast('Esse combo não está mais disponível.');
  app.cart.push({cartId:randomId(),comboId:combo.id,name:combo.name,type:'combo',quantity:1,ingredients:[],sizeKey:'combo',crustKey:'',notes:''});
  invalidateCheckoutKey();setCart();toast('Combo adicionado à sacola.');openCart();
}
async function renderCouponsAdmin(){
  const target=root.getElementById('adminBody');if(!target)return;
  target.innerHTML='<div class="loading-line">Carregando cupons…</div>';
  try{
    const result=await api('/api/admin/coupons');
      target.innerHTML='<section class="admin-panel"><div class="admin-panel-head"><div><h2 id="couponFormTitle">Criar cupom</h2><small>Configure descontos e regras de utilização.</small></div></div><form id="newCouponForm" class="admin-form-grid coupon-form"><input type="hidden" name="couponId" value=""><label class="form-field"><span>Código</span><input name="code" required minlength="3" maxlength="32" pattern="[A-Za-z0-9_-]+" placeholder="EX: BEMVINDO10"></label><label class="form-field"><span>Tipo de desconto</span><select name="discountType"><option value="percent">Porcentagem (%)</option><option value="fixed">Valor fixo (R$)</option></select></label><label class="form-field"><span>Valor do desconto</span><input name="discountValue" type="number" min="1" max="100" step="1" required value="10"></label><label class="form-field"><span>Pedido mínimo (R$)</span><input name="minimum" type="number" min="0" step="0.01" value="0" required></label><label class="form-field"><span>Início (opcional)</span><input name="startsAt" type="datetime-local"></label><label class="form-field"><span>Validade final (opcional)</span><input name="expiresAt" type="datetime-local"></label><label class="form-field"><span>Limite de usos (opcional)</span><input name="maxUses" type="number" min="1" step="1" placeholder="Ilimitado"></label><div class="wide"><p class="error-text" id="newCouponError" role="alert"></p><button class="button button-dark button-small" id="couponSubmitButton" type="submit">Criar cupom +</button> <button class="button button-outline button-small" id="couponCancelEdit" type="button" hidden>Cancelar edição</button></div></form></section><section class="admin-panel"><div class="admin-panel-head"><div><h2>Cupons cadastrados</h2><small>'+result.coupons.length+' cupom(ns)</small></div><button class="button button-outline button-small" type="button" data-action="export-coupons">Exportar CSV ↓</button></div><label class="coupon-search"><span>⌕</span><input id="couponSearch" type="search" placeholder="Buscar cupom pelo código" autocomplete="off"></label><div class="coupon-list">'+(result.coupons.map(c=>'<article class="coupon-row" data-coupon-row="'+esc(c.id)+'" data-type="'+esc(c.discountType)+'" data-value="'+c.discountValue+'" data-minimum="'+c.minimumSubtotalCents+'" data-starts="'+esc(c.startsAt||'')+'" data-expires="'+esc(c.expiresAt||'')+'" data-max-uses="'+(c.maxUses===null?'':c.maxUses)+'"><div class="coupon-row-top"><div><b>'+esc(c.code)+'</b><small>'+(c.discountType==='percent'?c.discountValue+'% de desconto':money(c.discountValue)+' de desconto')+' · Pedido mínimo '+money(c.minimumSubtotalCents)+'</small><small>Usos: '+c.usedCount+(c.maxUses===null?' / ilimitado':' / '+c.maxUses)+(c.expiresAt?' · Até '+new Date(c.expiresAt).toLocaleDateString('pt-BR'):'')+'</small></div><label class="coupon-active"><input class="coupon-active-input" type="checkbox" '+(c.active?'checked':'')+'> Ativo</label></div><div class="coupon-row-actions"><button class="button button-outline button-small" type="button" data-action="copy-coupon" data-code="'+esc(c.code)+'">Copiar código</button><button class="button button-outline button-small" type="button" data-action="edit-coupon" data-id="'+esc(c.id)+'">Editar</button><button class="button button-outline button-small" type="button" data-action="toggle-coupon" data-id="'+esc(c.id)+'">Salvar status</button></div></article>').join('')||'<div class="admin-empty">Nenhum cupom cadastrado ainda.</div>')+'</div></section>';
    const couponSearch=root.getElementById('couponSearch');
    couponSearch?.addEventListener('input',()=>{const term=couponSearch.value.trim().toLocaleLowerCase('pt-BR');root.querySelectorAll('[data-coupon-row]').forEach(row=>{row.hidden=!row.querySelector('b')?.textContent.toLocaleLowerCase('pt-BR').includes(term)})});
    const form=root.getElementById('newCouponForm');
    form.querySelector('[name=discountType]').addEventListener('change',()=>{const input=form.querySelector('[name=discountValue]');const percent=form.elements.discountType.value==='percent';input.max=percent?'100':'10000';input.step='1';});
    root.getElementById('couponCancelEdit').addEventListener('click',cancelCouponEdit);
    form.addEventListener('submit',async event=>{
      event.preventDefault();const data=new FormData(form),error=root.getElementById('newCouponError');
      const starts=data.get('startsAt'),expires=data.get('expiresAt');
      const payload={code:data.get('code'),discountType:data.get('discountType'),discountValue:data.get('discountType')==='fixed'?Math.round(Number(data.get('discountValue'))*100):Number(data.get('discountValue')),minimumSubtotalCents:Math.round(Number(data.get('minimum')||0)*100),startsAt:starts?new Date(starts).toISOString():null,expiresAt:expires?new Date(expires).toISOString():null,maxUses:data.get('maxUses')?Number(data.get('maxUses')):null,active:true};
      try{const couponId=data.get('couponId');await api(couponId?'/api/admin/coupons/'+encodeURIComponent(couponId):'/api/admin/coupons',{method:couponId?'PATCH':'POST',body:JSON.stringify({...payload,active:couponId?root.querySelector('[data-coupon-row="'+CSS.escape(couponId)+'"] .coupon-active-input').checked:true})});toast(couponId?'Cupom atualizado.':'Cupom criado.');renderCouponsAdmin()}catch(e){error.textContent=e.message}
    });
  }catch(e){target.innerHTML='<p class="error-text">'+esc(e.message)+'</p>'}
}
async function copyCouponCode(code){
  if(!code)return;
  try{await navigator.clipboard.writeText(code);toast('Código '+code+' copiado.');}
  catch{const field=root.createElement('textarea');field.value=code;field.setAttribute('readonly','');field.style.position='fixed';field.style.opacity='0';root.body.appendChild(field);field.select();const copied=root.execCommand('copy');field.remove();toast(copied?'Código '+code+' copiado.':'Não foi possível copiar automaticamente.');}
}
function exportCouponsCsv(){
  const rows=[...root.querySelectorAll('[data-coupon-row]')].filter(row=>!row.hidden).map(row=>{const text=row.querySelectorAll('small');const code=row.querySelector('b')?.textContent||'';const active=row.querySelector('.coupon-active-input')?.checked?'Ativo':'Inativo';return [code,row.dataset.type==='percent'?'Percentual':'Valor fixo',row.dataset.type==='percent'?row.dataset.value:(Number(row.dataset.value)/100).toFixed(2).replace('.',','),(Number(row.dataset.minimum||0)/100).toFixed(2).replace('.',','),row.dataset.starts||'',row.dataset.expires||'',row.dataset.maxUses||'Ilimitado',text[1]?.textContent.match(/Usos: ([^·]+)/)?.[1]?.trim()||'0',active]});
  const quote=value=>'"'+String(value??'').replace(/"/g,'""')+'"';
  const csv='Código;Tipo;Desconto;Pedido mínimo (R$);Início;Validade;Limite de usos;Utilizações;Status\r\n'+rows.map(row=>row.map(quote).join(';')).join('\r\n');
  const url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8;'}));const link=root.createElement('a');link.href=url;link.download='menuza-cupons.csv';root.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);toast('Lista de cupons exportada.');
}
function editCoupon(id){
  const row=root.querySelector('[data-coupon-row="'+CSS.escape(id)+'"]'),form=root.getElementById('newCouponForm');
  if(!row||!form)return;
  form.elements.couponId.value=id;
  form.elements.code.value=row.querySelector('b').textContent;
  form.elements.discountType.value=row.dataset.type;
  form.elements.discountValue.value=row.dataset.type==='fixed'?(Number(row.dataset.value)/100):Number(row.dataset.value);
  form.elements.discountValue.max=row.dataset.type==='percent'?'100':'10000';
  form.elements.minimum.value=(Number(row.dataset.minimum||0)/100).toFixed(2);
  form.elements.startsAt.value=row.dataset.starts?new Date(row.dataset.starts).toISOString().slice(0,16):'';
  form.elements.expiresAt.value=row.dataset.expires?new Date(row.dataset.expires).toISOString().slice(0,16):'';
  form.elements.maxUses.value=row.dataset.maxUses||'';
  root.getElementById('couponFormTitle').textContent='Editar cupom '+row.querySelector('b').textContent;
  root.getElementById('couponSubmitButton').textContent='Salvar alterações';
  root.getElementById('couponCancelEdit').hidden=false;
  form.scrollIntoView({behavior:'smooth',block:'start'});
}
function cancelCouponEdit(){
  const form=root.getElementById('newCouponForm');if(!form)return;
  form.reset();form.elements.couponId.value='';
  root.getElementById('couponFormTitle').textContent='Criar cupom';
  root.getElementById('couponSubmitButton').textContent='Criar cupom +';
  root.getElementById('couponCancelEdit').hidden=true;
  const error=root.getElementById('newCouponError');if(error)error.textContent='';
}
async function toggleCoupon(id){
  const row=root.querySelector('[data-coupon-row="'+CSS.escape(id)+'"]');if(!row)return;
  try{await api('/api/admin/coupons/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({code:row.querySelector('b').textContent,discountType:row.dataset.type,discountValue:Number(row.dataset.value),minimumSubtotalCents:Number(row.dataset.minimum||0),startsAt:row.dataset.starts||null,expiresAt:row.dataset.expires||null,maxUses:row.dataset.maxUses?Number(row.dataset.maxUses):null,active:row.querySelector('.coupon-active-input').checked})});toast('Status do cupom atualizado.');renderCouponsAdmin()}catch(e){toast(e.message)}
}
async function renderPrivacyRequestsAdmin(){
 const target=root.getElementById('adminBody');if(!target)return;
 target.innerHTML='<div class="loading-line">Carregando solicitações…</div>';
 try{
  const result=await api('/api/admin/privacy-requests');
  const labels={access:'Acesso aos dados',correction:'Correção',deletion:'Exclusão de dados',question:'Dúvida sobre privacidade',support:'Suporte geral'};
  target.innerHTML='<section class="admin-panel"><div class="admin-panel-head"><div><h2>Solicitações de clientes</h2><small>Pedidos de acesso, correção, exclusão e atendimento. Trate os dados com confidencialidade.</small></div><span class="settings-status">'+result.requests.filter(item=>item.status!=='closed').length+' pendentes</span></div>'+(result.requests.length?'<div class="privacy-request-list">'+result.requests.map(item=>'<article class="privacy-request-card"><div class="privacy-request-head"><div><span class="eyebrow">'+esc(labels[item.requestType]||item.requestType)+'</span><h3>'+esc(item.name)+'</h3><p><a href="mailto:'+encodeURIComponent(item.email)+'">'+esc(item.email)+'</a>'+(item.phone?' · '+esc(item.phone):'')+'</p></div><label class="privacy-request-status"><span>Status</span><select data-privacy-request-status="'+esc(item.id)+'"><option value="open" '+(item.status==='open'?'selected':'')+'>Aberta</option><option value="in_progress" '+(item.status==='in_progress'?'selected':'')+'>Em andamento</option><option value="closed" '+(item.status==='closed'?'selected':'')+'>Concluída</option></select></label></div><p class="privacy-request-details">'+esc(item.details)+'</p><small>Protocolo '+esc(item.id)+' · Recebida em '+esc(new Date(item.createdAt).toLocaleString('pt-BR'))+'</small></article>').join('')+'</div>':'<div class="customer-orders-empty"><h3>Nenhuma solicitação recebida</h3><p>As solicitações enviadas pelo formulário público aparecerão aqui.</p></div>')+'</section>';
  target.querySelectorAll('[data-privacy-request-status]').forEach(select=>select.addEventListener('change',async()=>{select.disabled=true;try{await api('/api/admin/privacy-requests/'+encodeURIComponent(select.dataset.privacyRequestStatus),{method:'PATCH',body:JSON.stringify({status:select.value})});toast('Status da solicitação atualizado.')}catch(error){toast(error.message);select.disabled=false}}));
 }catch(error){target.innerHTML='<section class="admin-panel"><p class="error-text" role="alert">'+esc(error.message)+'</p></section>'}
}
function tableQrUrl(number,token){const url=new URL(location.pathname,location.origin);url.searchParams.set('mesa',String(number));url.searchParams.set('t',token);url.hash='menu';return url.href}
function openTableQr(number,token){
  if(!/^\d{1,3}$/.test(String(number))||!/^[A-Za-z0-9_-]{32,64}$/.test(String(token)))return toast('Não foi possível abrir o QR Code desta mesa. Atualize o mapa.');
  const url=tableQrUrl(number,token),target=root.getElementById('tableQrModalRoot');if(!target)return;
  target.innerHTML='<div class="table-qr-backdrop" data-action="close-table-qr"><section class="table-qr-dialog" role="dialog" aria-modal="true" aria-labelledby="tableQrTitle"><button class="icon-button table-qr-close" type="button" data-action="close-table-qr" aria-label="Fechar">×</button><div class="eyebrow">CARDÁPIO NA MESA</div><h2 id="tableQrTitle">QR Code · Mesa '+esc(number)+'</h2><p>O cliente escaneia este código para abrir o cardápio já vinculado à mesa '+esc(number)+'.</p><div class="table-qr-code" id="tableQrCode" aria-label="QR Code da mesa '+esc(number)+'"></div><label class="table-qr-url"><span>Link exclusivo desta mesa</span><input id="tableQrUrl" readonly value="'+esc(url)+'"></label><div class="table-qr-actions"><button class="button button-outline" type="button" data-action="copy-table-qr">Copiar link</button><button class="button button-outline" type="button" data-action="download-table-qr" data-table-number="'+esc(number)+'">Baixar PNG</button><button class="button button-dark" type="button" data-action="print-table-qr" data-table-number="'+esc(number)+'">Imprimir</button></div><p class="table-qr-footnote">Imprima em tamanho legível e teste o código com a câmera de um celular antes de fixá-lo na mesa.</p></section></div>';
  try{new QRCode(root.getElementById('tableQrCode'),{text:url,width:280,height:280,colorDark:'#1b1530',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.H})}
  catch(error){root.getElementById('tableQrCode').innerHTML='<p class="error-text">Não foi possível gerar o QR Code neste navegador. Tente novamente.</p>';toast('Falha ao gerar o QR Code.')}
}
function closeTableQr(){const target=root.getElementById('tableQrModalRoot');if(target)target.innerHTML=''}
function downloadTableQr(number){
  const canvas=root.querySelector('#tableQrCode canvas');const image=root.querySelector('#tableQrCode img');let dataUrl='';
  try{if(canvas)dataUrl=canvas.toDataURL('image/png');else if(image?.src?.startsWith('data:image/'))dataUrl=image.src}catch{}
  if(!dataUrl)return toast('O QR Code ainda não está pronto para baixar.');
  const link=root.createElement('a');link.href=dataUrl;link.download='menuza-mesa-'+String(number).padStart(2,'0')+'-qrcode.png';root.body.appendChild(link);link.click();link.remove();
}
async function renderTablesAdmin(){
  const target=root.getElementById('adminBody');
  if(!target)return;
  target.innerHTML='<div class="loading-line">Carregando salão 3D…</div>';
  try{
    const result=await api('/api/admin/tables'),tables=result.tables||[],counts=result.counts||{};
    const labels={free:'Livre',occupied:'Ocupada',cleaning:'Precisa de limpeza'};
    const icons={free:'✓',occupied:'●',cleaning:'✦'};
    const cards=tables.map(table=>{
      const seats=Math.max(1,Math.min(8,Number(table.seats)||4));
      const shape=seats<=2?'round':seats>=6?'rectangle':'square';
      const chairPositions = {
        2: ['n','s'],
        3: ['n','e','s'],
        4: ['n','e','s','w'],
        5: ['n','n2','e','s','w'],
        6: ['n','n2','s','s2','e','w'],
        7: ['n','n2','s','s2','e','w','w2'],
        8: ['n','n2','s','s2','e','e2','w','w2']
      };
      const chairs = (chairPositions[seats] || chairPositions[4])
        .map(position => '<span class="table-chair chair-'+position+'" aria-hidden="true"></span>').join('');
      return '<article class="table-unit status-'+esc(table.status)+' table-shape-'+shape+'">'+
      '<button class="table-object" type="button" data-table-status="select" data-table-id="'+esc(table.id)+'" aria-label="Mesa '+table.number+', '+labels[table.status]+', '+seats+' lugares">'+
      chairs+
      '<span class="table-top"><span class="table-setting table-setting-a"><i></i><b></b></span><span class="table-setting table-setting-b"><i></i><b></b></span><span class="table-top-number">'+String(table.number).padStart(2,'0')+'</span><span class="table-top-status">'+icons[table.status]+'</span></span>'+
      '<span class="table-leg table-leg-a"></span><span class="table-leg table-leg-b"></span><span class="table-leg table-leg-c"></span><span class="table-leg table-leg-d"></span></button>'+
      '<div class="table-unit-meta"><strong>Mesa '+table.number+'</strong><span>'+seats+' '+(seats===1?'lugar':'lugares')+'</span></div>'+
      '<div class="table-status-label">'+labels[table.status]+'</div><div class="table-status-actions">'+
      '<button type="button" data-table-status="free" data-table-id="'+esc(table.id)+'" '+(table.status==='free'?'aria-pressed="true"':'')+'>Livre</button>'+
      '<button type="button" data-table-status="occupied" data-table-id="'+esc(table.id)+'" '+(table.status==='occupied'?'aria-pressed="true"':'')+'>Ocupada</button>'+
      '<button type="button" data-table-status="cleaning" data-table-id="'+esc(table.id)+'" '+(table.status==='cleaning'?'aria-pressed="true"':'')+'>Limpeza</button></div>'+
      '<button class="button button-outline button-small table-qr-button" type="button" data-action="show-table-qr" data-table-number="'+esc(table.number)+'" data-table-token="'+esc(table.qrToken)+'">QR Code da mesa</button></article>';
    }).join('');
    target.innerHTML='<section class="table-manager"><div class="table-manager-heading"><div><div class="eyebrow">MAPA DO SALÃO</div><h2>Gerenciamento de mesas</h2><p>Visualize o salão e atualize a situação de cada mesa.</p></div><div class="table-live"><span></span> Dados salvos no sistema</div></div>'+
      '<div class="table-stats"><div class="table-stat table-stat-free"><span>Livres</span><b>'+(counts.free||0)+'</b></div><div class="table-stat table-stat-occupied"><span>Ocupadas</span><b>'+(counts.occupied||0)+'</b></div><div class="table-stat table-stat-cleaning"><span>Precisam de limpeza</span><b>'+(counts.cleaning||0)+'</b></div></div>'+
      '<div class="table-map-shell"><div class="table-map-top"><span>PLANTA DO SALÃO</span><span>'+tables.length+' mesas · selecione o status para atualizar</span></div><div class="table-map"><div class="table-map-wall table-map-wall-back"></div><div class="table-map-wall table-map-wall-side"></div><div class="table-map-counter"><span>ATENDIMENTO</span><i></i><i></i><i></i></div><div class="table-map-entry"><span>ENTRADA</span><i></i></div><div class="table-map-plant table-map-plant-a"><i></i></div><div class="table-map-plant table-map-plant-b"><i></i></div><div class="table-map-grid">'+cards+'</div></div></div>'+
      '<div class="table-manager-foot"><span>As alterações ficam salvas no banco de dados. Cada mesa tem um QR Code exclusivo.</span><button class="button button-outline button-small" type="button" data-action="refresh-tables">Atualizar mapa</button></div></section><div id="tableQrModalRoot"></div>';
  }catch(error){target.innerHTML='<section class="admin-panel"><p class="error-text" role="alert">'+esc(error.message)+'</p></section>'}
}

const ACCESSIBILITY_STORAGE_KEY='menuza-accessibility-v1';
const ACCESSIBILITY_DEFAULTS={fontScale:1,theme:'light',palette:'violet',contrast:false,readableFont:false,spacing:'normal',underlineLinks:false,reduceMotion:false};
function getAccessibilityPreferences(){
  try{
    const saved=JSON.parse(localStorage.getItem(ACCESSIBILITY_STORAGE_KEY)||'{}');
    const value={...ACCESSIBILITY_DEFAULTS,...(saved&&typeof saved==='object'?saved:{})};
    value.fontScale=[0.9,1,1.1,1.2,1.3,1.4].includes(Number(value.fontScale))?Number(value.fontScale):1;
    value.theme=['light','dark'].includes(value.theme)?value.theme:'light';
    value.palette=['violet','ocean','green','amber','rose'].includes(value.palette)?value.palette:'violet';
    value.spacing=['normal','comfortable','wide'].includes(value.spacing)?value.spacing:'normal';
    for(const key of ['contrast','readableFont','underlineLinks','reduceMotion'])value[key]=value[key]===true;
    return value;
  }catch{return {...ACCESSIBILITY_DEFAULTS}}
}
function applyAccessibilityPreferences(preferences=getAccessibilityPreferences()){
  const html=root.documentElement;
  html.dataset.mzTheme=preferences.theme;
  html.dataset.mzPalette=preferences.palette;
  html.dataset.mzContrast=preferences.contrast?'high':'normal';
  html.dataset.mzFont=preferences.readableFont?'readable':'default';
  html.dataset.mzSpacing=preferences.spacing;
  html.dataset.mzLinks=preferences.underlineLinks?'underlined':'default';
  html.dataset.mzMotion=preferences.reduceMotion?'reduced':'default';
  html.style.setProperty('--mz-access-font-scale',String(preferences.fontScale));
}
function saveAccessibilityPreferences(preferences){
  try{localStorage.setItem(ACCESSIBILITY_STORAGE_KEY,JSON.stringify(preferences));applyAccessibilityPreferences(preferences);return true}
  catch{applyAccessibilityPreferences(preferences);return false}
}
applyAccessibilityPreferences();

async function renderSettingsAdmin(){
  const target=root.getElementById('adminBody');
  if(!target)return;
  target.innerHTML='<div class="loading-line">Carregando configurações…</div>';
  try{
    const {restaurant}=await api('/api/admin/settings');
    const initialName=String(restaurant.name||'').trim();
    const initialPrep=Number(restaurant.prepMinutes)||30;
    const initialLogoUrl=String(restaurant.logoUrl||'').trim();
    target.innerHTML=`
      <div class="settings-intro">
        <div><div class="eyebrow">PERSONALIZE SUA EXPERIÊNCIA</div><h2>Seu restaurante, do seu jeito.</h2><p>Atualize as informações que seus clientes veem no cardápio.</p></div>
        <span class="settings-status" id="settingsStatus"><span></span> Tudo salvo</span>
      </div>
      <div class="settings-layout">
        <section class="admin-panel settings-panel">
          <div class="admin-panel-head"><div><h2>Informações do restaurante</h2><small>Esses dados aparecem para seus clientes.</small></div><span class="settings-section-icon" aria-hidden="true">✳</span></div>
          <form id="restaurantSettingsForm" class="settings-form">
            <label class="form-field"><span>Nome do restaurante</span><input name="name" required minlength="2" maxlength="80" value="${esc(initialName)}" placeholder="Ex.: Bela Mesa" autocomplete="organization"><small class="field-hint">Escolha um nome curto e fácil de reconhecer.</small></label>
            <label class="form-field"><span>URL da logo do restaurante</span><input name="logoUrl" type="url" maxlength="500" value="${esc(initialLogoUrl)}" placeholder="https://seusite.com/logo.png" inputmode="url"><small class="field-hint">Cole o link HTTPS direto de uma imagem PNG, JPG ou WebP. Deixe vazio para usar as iniciais.</small></label>
            <label class="form-field"><span>Tempo médio de preparo</span><div class="settings-number-wrap"><input name="prepMinutes" type="number" min="5" max="240" step="5" required value="${initialPrep}"><span>minutos</span></div><small class="field-hint">Use uma estimativa realista. Você pode alterar quando precisar.</small></label>
            <div class="settings-note"><span aria-hidden="true">i</span><p>O tempo informado é uma estimativa para orientar o cliente, não uma promessa de horário exato.</p></div>
            <div class="settings-actions"><p class="error-text" id="settingsError" role="alert"></p><button class="button button-dark button-small" type="submit">Salvar alterações <span aria-hidden="true">↗</span></button></div>
          </form>
        </section>
        <aside class="settings-side">
          <section class="settings-preview-card">
            <div class="settings-preview-top"><span>PRÉVIA DO CARDÁPIO</span><span class="preview-live-dot">AO VIVO</span></div>
            <div class="settings-preview-art" aria-hidden="true"><div class="preview-plate"><span>✳</span></div><i class="preview-spark spark-one"></i><i class="preview-spark spark-two"></i></div>
            <div class="settings-preview-copy"><span class="eyebrow">BEM-VINDO AO</span><h3 id="settingsPreviewName">${esc(initialName||'Seu restaurante')}</h3><p>Feito para deixar sua experiência mais saborosa.</p><div class="settings-preview-meta"><span><span aria-hidden="true">◷</span> <b id="settingsPreviewPrep">${initialPrep} min</b> de preparo</span><span class="preview-open-pill"><i></i> Cardápio</span></div></div>
          </section>
          <section class="admin-panel settings-security-card"><div class="settings-security-icon" aria-hidden="true">⌑</div><div><h3>Acesso protegido</h3><p>Seu painel usa uma sessão protegida por cookie HttpOnly. Mantenha as credenciais administrativas configuradas no ambiente de produção.</p></div></section>
        </aside>
      </div>
      <section class="admin-panel accessibility-settings-panel" aria-labelledby="accessibilitySettingsTitle">
        <div class="admin-panel-head"><div><h2 id="accessibilitySettingsTitle">Acessibilidade e aparência</h2><small>Personalize a leitura e a navegação em todo o Menuza. As escolhas ficam salvas neste dispositivo.</small></div><span class="settings-section-icon" aria-hidden="true">Aa</span></div>
        <div class="accessibility-settings-grid">
          <div class="accessibility-setting-group">
            <label for="accessibilityFontScale">Tamanho da fonte</label>
            <div class="accessibility-range-row"><input id="accessibilityFontScale" type="range" min="0.9" max="1.4" step="0.1" value="1" aria-describedby="accessibilityFontScaleValue"><output id="accessibilityFontScaleValue" for="accessibilityFontScale">100%</output></div>
            <p>Amplia os textos do sistema sem precisar usar o zoom do navegador.</p>
          </div>
          <div class="accessibility-setting-group">
            <label for="accessibilityTheme">Tema</label>
            <select id="accessibilityTheme"><option value="light">Claro</option><option value="dark">Escuro</option></select>
            <p>Escolha um tema mais confortável para o ambiente.</p>
          </div>
          <div class="accessibility-setting-group">
            <label for="accessibilityPalette">Cor de destaque</label>
            <select id="accessibilityPalette"><option value="violet">Roxo Menuza</option><option value="ocean">Azul oceano</option><option value="green">Verde</option><option value="amber">Âmbar</option><option value="rose">Rosa</option></select>
            <p>Altera a cor de destaque e os controles do sistema.</p>
          </div>
          <div class="accessibility-setting-group">
            <label for="accessibilitySpacing">Espaçamento</label>
            <select id="accessibilitySpacing"><option value="normal">Padrão</option><option value="comfortable">Confortável</option><option value="wide">Amplo</option></select>
            <p>Aumenta o espaço entre linhas e elementos para facilitar a leitura.</p>
          </div>
          <label class="accessibility-toggle"><input id="accessibilityContrast" type="checkbox"><span><strong>Alto contraste</strong><small>Reforça o contraste entre texto, fundo, bordas e controles.</small></span></label>
          <label class="accessibility-toggle"><input id="accessibilityReadableFont" type="checkbox"><span><strong>Fonte de alta legibilidade</strong><small>Usa uma família de fontes simples e bem distinguíveis.</small></span></label>
          <label class="accessibility-toggle"><input id="accessibilityUnderlineLinks" type="checkbox"><span><strong>Sublinhar links</strong><small>Ajuda a identificar links sem depender apenas da cor.</small></span></label>
          <label class="accessibility-toggle"><input id="accessibilityReduceMotion" type="checkbox"><span><strong>Reduzir animações</strong><small>Reduz movimentos e transições decorativas.</small></span></label>
        </div>
        <div class="accessibility-preview" aria-live="polite"><div><strong>Prévia de leitura</strong><p>Este é um exemplo de texto com as suas preferências de acessibilidade. Botões, links e campos também acompanham as configurações.</p><a href="#accessibilitySettingsTitle">Exemplo de link acessível</a></div><button type="button" class="button button-outline" id="accessibilityReset">Restaurar padrão</button></div>
        <p class="accessibility-save-status" id="accessibilitySaveStatus" role="status" aria-live="polite">Preferências aplicadas automaticamente neste dispositivo.</p>
      </section>`;
    const accessibility=getAccessibilityPreferences();
    const accessibilityControls={
      fontScale:root.getElementById('accessibilityFontScale'),
      theme:root.getElementById('accessibilityTheme'),
      palette:root.getElementById('accessibilityPalette'),
      spacing:root.getElementById('accessibilitySpacing'),
      contrast:root.getElementById('accessibilityContrast'),
      readableFont:root.getElementById('accessibilityReadableFont'),
      underlineLinks:root.getElementById('accessibilityUnderlineLinks'),
      reduceMotion:root.getElementById('accessibilityReduceMotion')
    };
    accessibilityControls.fontScale.value=String(accessibility.fontScale);
    accessibilityControls.theme.value=accessibility.theme;
    accessibilityControls.palette.value=accessibility.palette;
    accessibilityControls.spacing.value=accessibility.spacing;
    for(const key of ['contrast','readableFont','underlineLinks','reduceMotion'])accessibilityControls[key].checked=accessibility[key];
    const fontScaleValue=root.getElementById('accessibilityFontScaleValue');
    const accessibilityStatus=root.getElementById('accessibilitySaveStatus');
    const syncAccessibility=()=>{
      const next={
        fontScale:Number(accessibilityControls.fontScale.value),
        theme:accessibilityControls.theme.value,
        palette:accessibilityControls.palette.value,
        spacing:accessibilityControls.spacing.value,
        contrast:accessibilityControls.contrast.checked,
        readableFont:accessibilityControls.readableFont.checked,
        underlineLinks:accessibilityControls.underlineLinks.checked,
        reduceMotion:accessibilityControls.reduceMotion.checked
      };
      fontScaleValue.value=Math.round(next.fontScale*100)+'%';
      fontScaleValue.textContent=fontScaleValue.value;
      const saved=saveAccessibilityPreferences(next);
      accessibilityStatus.textContent=saved?'Preferências aplicadas e salvas neste dispositivo.':'Preferências aplicadas nesta sessão; o navegador não permitiu salvá-las.';
    };
    for(const control of Object.values(accessibilityControls))control.addEventListener('input',syncAccessibility);
    root.getElementById('accessibilityReset').addEventListener('click',()=>{
      for(const [key,control] of Object.entries(accessibilityControls)){
        if(key==='fontScale')control.value=String(ACCESSIBILITY_DEFAULTS.fontScale);
        else if(key==='theme'||key==='palette'||key==='spacing')control.value=ACCESSIBILITY_DEFAULTS[key];
        else control.checked=ACCESSIBILITY_DEFAULTS[key];
      }
      syncAccessibility();
    });
    const form=root.getElementById('restaurantSettingsForm');
    const nameInput=form.elements.name;
    const prepInput=form.elements.prepMinutes;
    const logoInput=form.elements.logoUrl;
    const status=root.getElementById('settingsStatus');
    const saveButton=form.querySelector('button[type="submit"]');
    const setDirty=()=>{
      root.getElementById('settingsPreviewName').textContent=nameInput.value.trim()||'Seu restaurante';
      root.getElementById('settingsPreviewPrep').textContent=(Number(prepInput.value)||0)+' min';
      const dirty=nameInput.value.trim()!==initialName||Number(prepInput.value)!==initialPrep||logoInput.value.trim()!==initialLogoUrl;
      status.classList.toggle('is-dirty',dirty);
      status.innerHTML=dirty?'<span></span> Alterações não salvas':'<span></span> Tudo salvo';
      saveButton.disabled=!dirty;
      root.getElementById('settingsError').textContent='';
    };
    form.addEventListener('input',setDirty);
    saveButton.disabled=true;
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      const data=new FormData(form);
      const name=String(data.get('name')||'').trim();
      const prepMinutes=Number(data.get('prepMinutes'));
      const logoUrl=String(data.get('logoUrl')||'').trim();
      const error=root.getElementById('settingsError');
      if(name.length<2||!Number.isFinite(prepMinutes)||prepMinutes<5||prepMinutes>240){error.textContent='Confira o nome e o tempo de preparo antes de salvar.';return}
      saveButton.disabled=true;saveButton.textContent='Salvando…';error.textContent='';
      try{
        const result=await api('/api/admin/settings',{method:'PATCH',body:JSON.stringify({name,prepMinutes,logoUrl})});
        if(app.catalog?.restaurant){app.catalog.restaurant.name=result.restaurant.name;app.catalog.restaurant.prepMinutes=result.restaurant.prepMinutes;app.catalog.restaurant.logoUrl=result.restaurant.logoUrl||''}
        applyRestaurantBranding(result.restaurant.name,result.restaurant.logoUrl);
        toast('Configurações salvas.');
        await renderSettingsAdmin();
      }catch(e){error.textContent=e.message;saveButton.disabled=false;saveButton.innerHTML='Tentar novamente <span aria-hidden="true">↗</span>'}
    });
  }catch(e){target.innerHTML='<p class="error-text">'+esc(e.message)+'</p>'}
}
function applyRestaurantBranding(name,logoUrl=''){
  const clean=String(name||'').trim();
  if(!clean)return;
  const initials=clean.split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0]).join('').toLocaleUpperCase('pt-BR');
  for(const brand of root.querySelectorAll('[data-restaurant-brand]')){
    const label=brand.querySelector('[data-restaurant-name]');
    if(label)label.textContent=clean;
    const image=brand.querySelector('[data-restaurant-logo]');
    const fallback=brand.querySelector('[data-restaurant-initials]');
    if(image){
      image.alt='Logo de '+clean;
      image.hidden=!logoUrl;
      image.onerror=()=>{image.hidden=true;if(fallback)fallback.hidden=false};
      image.onload=()=>{if(fallback)fallback.hidden=true};
      if(logoUrl){image.src=logoUrl}else{image.removeAttribute('src')}
    }
    if(fallback){fallback.textContent=initials;fallback.hidden=Boolean(logoUrl)}
    brand.setAttribute('aria-label',clean+' — início');
  }
  const footer=root.querySelector('.footer-bottom');
  if(footer&&footer.firstElementChild)footer.firstElementChild.textContent='© '+clean+' · Cardápio digital com Menuza';
  const announcement=root.querySelector('.announcement');
  if(announcement)announcement.setAttribute('aria-label','Menuza, sistema de cardápio digital');
}
async function renderIngredientsAdmin(){
  const target=root.getElementById('adminBody');target.innerHTML='<div class="loading-line">Carregando adicionais…</div>';
  try{
    const catalog=await api('/api/admin/catalog');
    target.innerHTML=['pizza','burger'].map(type=>{
      const items=catalog.ingredients.filter(i=>i.type===type);
      return '<section class="admin-panel ingredient-admin-panel"><div class="admin-panel-head"><h2>'+(type==='pizza'?'Ingredientes de pizza':'Adicionais de hambúrguer')+'</h2><small>'+items.length+' itens · preço por porção</small></div><label class="ingredient-admin-search"><span aria-hidden="true">⌕</span><input type="search" data-ingredient-search="'+type+'" placeholder="Buscar '+(type==='pizza'?'ingrediente':'adicional')+'..." aria-label="Buscar '+(type==='pizza'?'ingredientes':'adicionais')+'"></label><div class="ingredient-admin-grid">'+items.map(i=>'<div class="ingredient-admin-row" data-ingredient-admin="'+esc(i.id)+'" data-name="'+esc(normalizeSearch(i.name))+'"><span>'+esc(i.name)+(i.included?' · incluso':'')+'</span><input type="number" min="0" max="9999.99" step="0.01" inputmode="decimal" aria-label="Preço adicional de '+esc(i.name)+'" value="'+(i.cents/100).toFixed(2)+'"><label><input type="checkbox" aria-label="Disponível: '+esc(i.name)+'" '+(i.active?'checked':'')+'></label><button class="tiny-link" data-action="save-ingredient" data-id="'+esc(i.id)+'">Salvar</button></div>').join('')+'<p class="ingredient-search-empty" data-ingredient-empty="'+type+'" hidden>Nenhum item encontrado nessa busca.</p></div></section>';
    }).join('');
    target.querySelectorAll('[data-ingredient-search]').forEach(input=>input.addEventListener('input',()=>{
      const type=input.dataset.ingredientSearch,query=normalizeSearch(input.value);
      let visible=0;
      target.querySelectorAll('[data-ingredient-admin]').forEach(row=>{if(row.querySelector('button')?.dataset.id&&catalog.ingredients.find(item=>item.id===row.dataset.ingredientAdmin)?.type!==type)return;const match=!query||row.dataset.name.includes(query);row.hidden=!match;if(match)visible++});
      const empty=target.querySelector('[data-ingredient-empty="'+type+'"]');if(empty)empty.hidden=visible!==0;
    }));
  }catch(e){target.innerHTML='<p class="error-text">'+esc(e.message)+'</p>'}
}
function connectAdminEvents(){
  if(app.admin.eventSource)app.admin.eventSource.close();
  app.admin.eventSource=new EventSource('/api/admin/events');
  app.admin.eventSource.addEventListener('update',()=>{if(app.admin.tab==='orders')refreshAdmin();else if(app.admin.tab==='analytics')renderAnalyticsAdmin();else if(app.admin.tab==='combos')renderCombosAdmin();else if(app.admin.tab==='tables')renderTablesAdmin();else if(app.admin.tab==='catalog')renderCatalogAdmin();else if(app.admin.tab==='ingredients')renderIngredientsAdmin();else if(app.admin.tab==='coupons')renderCouponsAdmin();else if(app.admin.tab==='privacy')renderPrivacyRequestsAdmin();else renderSettingsAdmin()});
  clearInterval(app.admin.refreshTimer);app.admin.refreshTimer=setInterval(refreshAdmin,20000);
}
async function logoutAdmin(){
  try{await api('/api/admin/logout',{method:'POST'})}catch{}
  app.admin.authenticated=false;if(app.admin.eventSource)app.admin.eventSource.close();clearInterval(app.admin.refreshTimer);location.hash='';showHome();toast('Sessão encerrada.');
}
function renderCheckoutMode(form,mode){
  form.querySelector('[name=fulfillment]').value=mode;form.querySelectorAll('.fulfillment-option').forEach(button=>button.classList.toggle('active',button.dataset.fulfillment===mode));
  root.getElementById('tableField').classList.toggle('hidden',mode!=='table');root.getElementById('addressField').classList.toggle('hidden',mode!=='delivery');
  const tableSelect=form.querySelector('[name=tableLabel]');if(tableSelect){tableSelect.required=mode==='table';if(mode==='table')loadAvailableTables(tableSelect)}
}
async function loadAvailableTables(select){
  const hint=root.getElementById('tableAvailabilityHint');
  const current=select.value;select.disabled=true;select.innerHTML='<option value="">Buscando mesas livres…</option>';
  if(hint)hint.textContent='Consultando a disponibilidade do salão…';
  try{
    const result=await api('/api/tables/available');
    if(!select.isConnected)return;
    const tables=Array.isArray(result.tables)?result.tables:[];
    if(app.tableQr){
      if(app.tableQr.status==='cleaning'){select.innerHTML='<option value="">Mesa '+String(app.tableQr.number).padStart(2,'0')+' aguardando limpeza</option>';select.disabled=true;if(hint)hint.textContent='Esta mesa está aguardando limpeza. Peça ajuda à equipe ou escolha outra modalidade.';return}
      select.innerHTML='<option value="'+esc(app.tableQr.number)+'">Mesa '+String(app.tableQr.number).padStart(2,'0')+' · '+(app.tableQr.status==='occupied'?'mesa em uso':'sua mesa')+'</option>';
      select.value=String(app.tableQr.number);select.disabled=false;if(hint)hint.textContent='Pedido vinculado à mesa '+String(app.tableQr.number).padStart(2,'0')+'. Você pode continuar pedindo enquanto estiver à mesa.';return;
    }
    if(!tables.length){select.innerHTML='<option value="">Nenhuma mesa livre no momento</option>';select.disabled=true;if(hint)hint.textContent='Todas as mesas estão ocupadas ou aguardando limpeza. Peça ajuda à equipe.';return}
    select.innerHTML='<option value="">Selecione sua mesa</option>'+tables.map(table=>'<option value="'+esc(table.number)+'">Mesa '+String(table.number).padStart(2,'0')+' · '+table.seats+' lugares</option>').join('');
    if(tables.some(table=>String(table.number)===current))select.value=current;
    select.disabled=false;if(hint)hint.textContent=tables.length+' mesa'+(tables.length===1?' disponível':'s disponíveis')+' para escolher.';
  }catch(error){if(!select.isConnected)return;select.innerHTML='<option value="">Não foi possível carregar as mesas</option>';select.disabled=true;if(hint)hint.textContent=error.message||'Tente novamente em instantes.';const message=root.getElementById('checkoutError');if(message)message.textContent='Não foi possível consultar as mesas livres. '+(error.message||'')}
}
async function saveProduct(id){
  const row=root.querySelector('[data-product-admin="'+CSS.escape(id)+'"]');if(!row)return;
  const cents=Math.round(Number(row.querySelector('.product-price-input').value)*100),active=row.querySelector('.product-active-input').checked,available=row.querySelector('.product-available-input').checked;
  try{await api('/api/admin/products/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({baseCents:cents,active,available})});toast('Produto atualizado.')}catch(e){toast(e.message)}
}
async function saveIngredient(id){
  const row=root.querySelector('[data-ingredient-admin="'+CSS.escape(id)+'"]');if(!row)return;
  const priceInput=row.querySelector('input[type="number"]'),activeInput=row.querySelector('input[type="checkbox"]'),button=row.querySelector('[data-action="save-ingredient"]');
  const price=Number(String(priceInput.value).replace(',','.'));
  if(!Number.isFinite(price)||price<0||price>9999.99){priceInput.setAttribute('aria-invalid','true');priceInput.focus();toast('Informe um preço entre R$ 0,00 e R$ 9.999,99.');return}
  priceInput.removeAttribute('aria-invalid');
  const cents=Math.round(price*100),active=activeInput.checked,original=button.textContent;
  button.disabled=true;button.textContent='Salvando…';
  try{await api('/api/admin/ingredients/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({cents,active})});button.textContent='Salvo ✓';toast('Adicional atualizado.');setTimeout(()=>{if(button.isConnected){button.textContent=original;button.disabled=false}},1400)}
  catch(e){button.textContent='Tentar novamente';button.disabled=false;toast(e.message)}
}
async function repeatCustomerOrder(orderId){
  const order=app.customerOrders.find(item=>item.id===orderId);
  if(!order)return toast('Não encontrei esse pedido no seu histórico.');
  if(app.cart.length&&!window.confirm('Deseja substituir os itens atuais da sacola pelo pedido anterior?'))return;
  try{
    if(!app.catalog){app.catalog=await api('/api/catalog');applyRestaurantBranding(app.catalog.restaurant?.name,app.catalog.restaurant?.logoUrl);renderCatalog()}
    const available=new Map(app.catalog.products.filter(item=>Number(item.active)!==0).map(item=>[item.id,item]));
    const validIngredients=new Map(app.catalog.ingredients.filter(item=>Number(item.active)!==0).map(item=>[item.id,item]));
    const rebuilt=[];
    for(const old of order.items||[]){
      const product=available.get(old.productId);if(!product)continue;
      const options=app.catalog.sizes[product.type]||[];
      const sizeKey=options.some(option=>option.key===old.sizeKey)?old.sizeKey:(options.find(option=>option.key==='medium')||options[0])?.key;
      if(!sizeKey)continue;
      const crustKey=product.type==='pizza'?(app.catalog.crusts.some(item=>item.key===old.crustKey)?old.crustKey:(app.catalog.crusts.find(item=>item.key==='tradicional')||app.catalog.crusts[0])?.key):'';
      const ingredients=(old.ingredients||[]).filter(entry=>validIngredients.has(entry.id)&&validIngredients.get(entry.id).type===product.type).map(entry=>({id:entry.id,quantity:Math.max(1,Math.min(3,Number(entry.quantity)||1))})).slice(0,12);
      rebuilt.push({cartId:randomId(),productId:product.id,name:product.name,type:product.type,quantity:Math.max(1,Math.min(10,Number(old.quantity)||1)),sizeKey,crustKey,ingredients,notes:typeof old.notes==='string'?old.notes.slice(0,500):''});
    }
    if(!rebuilt.length)return toast('Os produtos desse pedido não estão mais disponíveis.');
    app.cart=rebuilt;invalidateCheckoutKey();setCart();showHome();renderCatalog();toast(rebuilt.length<(order.items||[]).length?'Pedido recuperado; alguns itens indisponíveis foram ignorados.':'Pedido anterior recuperado na sacola.');openCart();
  }catch(error){toast(error.message||'Não foi possível repetir esse pedido.');}
}
function handleClick(event){
  const target=event.target.closest('[data-action],[data-category],[data-size],[data-crust],[data-ingredient],[data-ingredient-qty],[data-fulfillment],[data-admin-tab],[data-table-status]');if(!target)return;
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
  if(target.dataset.tableStatus){
    if(target.dataset.tableStatus==='select'){
      const unit=target.closest('.table-unit');
      if(!unit)return;
      root.querySelectorAll('.table-unit.table-selected').forEach(node=>node.classList.remove('table-selected'));
      unit.classList.add('table-selected');
      unit.querySelector('.table-status-actions button')?.focus({preventScroll:true});
      toast('Mesa '+(unit.querySelector('.table-unit-meta strong')?.textContent.replace('Mesa ','')||'')+' selecionada. Escolha o status abaixo.');
      return;
    }
    const tableId=target.dataset.tableId,status=target.dataset.tableStatus;
    const unit=target.closest('.table-unit');
    if(unit)unit.querySelectorAll('.table-status-actions button').forEach(button=>button.disabled=true);
    target.disabled=true;
    api('/api/admin/tables/'+encodeURIComponent(tableId),{method:'PATCH',body:JSON.stringify({status})})
      .then(()=>{toast('Status da mesa atualizado.');renderTablesAdmin()})
      .catch(error=>{toast(error.message||'Não foi possível atualizar a mesa.');if(unit)unit.querySelectorAll('.table-status-actions button').forEach(button=>button.disabled=false);else target.disabled=false});
    return;
  }
  const action=target.dataset.action;
  if(action==='show-table-qr'){openTableQr(target.dataset.tableNumber,target.dataset.tableToken);return}
  if(action==='close-table-qr'){if(target.classList.contains('table-qr-backdrop')&&event.target!==target)return;closeTableQr();return}
  if(action==='copy-table-qr'){const input=root.getElementById('tableQrUrl');if(input){input.select();try{const ok=document.execCommand('copy');if(ok)toast('Link exclusivo da mesa copiado.');else toast('Selecione e copie o link manualmente.')}catch{toast('Selecione e copie o link manualmente.')}}return}
  if(action==='download-table-qr'){downloadTableQr(target.dataset.tableNumber);return}
  if(action==='print-table-qr'){window.print();return}
  if(action==='refresh-tables'){renderTablesAdmin();return}
   if(action==='refresh-analytics'){renderAnalyticsAdmin();return}
   if(action==='add-combo'){addComboToCart(target.dataset.id);return}
   if(action==='save-combo-status'){saveComboStatus(target.dataset.id);return}
  if(action==='share-menu'){shareMenu();return}
  if(action==='share-product'){shareMenu(target.dataset.product);return}
  if(action==='export-orders'){exportVisibleOrders();return}
  if(action==='export-coupons'){exportCouponsCsv();return}
  if(action==='copy-coupon'){copyCouponCode(target.dataset.code);return}
  if(action==='apply-coupon'){applyCheckoutCoupon();return}
  if(action==='toggle-coupon'){toggleCoupon(target.dataset.id);return}
  if(action==='edit-coupon'){editCoupon(target.dataset.id);return}
  if(action==='repeat-order'){repeatCustomerOrder(target.dataset.orderId);return}
   if(action==='clear-recent-products'){app.recentProducts=[];try{localStorage.removeItem('menuza-recent-products')}catch{}renderRecentProducts();toast('Histórico de pratos limpo.');return}
   if(action==='clear-catalog-filters'){app.category='all';app.search='';app.vegetarianOnly=false;app.favoritesOnly=false;app.sort='featured';const search=root.getElementById('searchInput'),sort=root.getElementById('sortSelect'),veg=root.getElementById('vegetarianFilter');if(search)search.value='';if(sort)sort.value='featured';if(veg)veg.setAttribute('aria-pressed','false');renderCatalog();toast('Filtros do cardápio limpos.');return}
  if(action==='toggle-favorite'){
    const id=target.dataset.product;
    if(!id||!app.catalog?.products.some(product=>product.id===id))return;
    if(app.favorites.includes(id)){app.favorites=app.favorites.filter(item=>item!==id);toast('Removido dos favoritos.')}else{app.favorites=[...app.favorites.filter(item=>item!==id),id].slice(-200);toast('Adicionado aos favoritos.')}
    try{localStorage.setItem('menuza-favorites',JSON.stringify(app.favorites))}catch{toast('Não foi possível salvar os favoritos neste navegador.')}
    renderCatalog();return;
  }
  if(action==='clear-order-filters'){app.admin.orderQuery='';app.admin.orderStatus='all';app.admin.orderFulfillment='all';const q=root.getElementById('ordersSearch'),st=root.getElementById('ordersStatusFilter'),ft=root.getElementById('ordersFulfillmentFilter');if(q)q.value='';if(st)st.value='all';if(ft)ft.value='all';applyOrderFilters();return}
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
  if(action==='qty'){const item=app.cart.find(i=>i.cartId===target.dataset.id);if(item){const next=Math.max(1,Math.min(10,item.quantity+Number(target.dataset.delta)));if(next!==item.quantity){item.quantity=next;invalidateCheckoutKey();setCart();renderCart()}}return}
  if(action==='remove-cart-item'){const next=app.cart.filter(i=>i.cartId!==target.dataset.id);if(next.length!==app.cart.length){app.cart=next;invalidateCheckoutKey();setCart();renderCart()}return}
  if(action==='edit-cart-item'){const item=app.cart.find(i=>i.cartId===target.dataset.id);app.cartOpen=false;root.getElementById('cartRoot').innerHTML='';if(item)openBuilder(item.productId,item);return}
  if(action==='checkout'){openCheckout();return}
  if(action==='close-checkout'||(action==='checkout-backdrop'&&event.target===target)){app.checkoutOpen=false;root.getElementById('checkoutRoot').innerHTML='';return}
  if(action==='back-home'){location.hash='menu';openMenu();return}
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
  root.getElementById('favoritesFilter')?.addEventListener('click',()=>{app.favoritesOnly=!app.favoritesOnly;renderCatalog()});
  root.querySelector('[data-scroll="#menu"]').addEventListener('click',()=>root.getElementById('menu').scrollIntoView({behavior:'smooth'}));
  root.getElementById('searchInput').addEventListener('keydown',event=>{if(event.key==='Enter')root.getElementById('menu').scrollIntoView({behavior:'smooth'})});
}
async function openMenu(){
  try{
    if(!app.catalog){
      app.catalog=await api('/api/catalog');
      app.cart=normalizeCartForCatalog(app.cart,app.catalog);
      setCart();
      applyRestaurantBranding(app.catalog.restaurant?.name);
      renderCatalog();
    }
    showHome();
  }catch(error){
    if(error?.status===401){
      app.customer=null;
      history.replaceState(null,'',location.pathname+location.search+'#conta');
      showCustomerAccount();
      return;
    }
    showHome();
    toast('Não foi possível carregar o cardápio. '+(error?.message||'Tente novamente.'));
  }
}

/* Spell UI-inspired tilt card interaction, implemented without React dependencies. */
function bindSpellCardInteractions(){
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  if(!window.matchMedia('(hover: hover) and (pointer: fine)').matches)return;
  root.addEventListener('pointermove',event=>{
    const card=event.target.closest('.product-card');
    if(!card)return;
    const rect=card.getBoundingClientRect();
    const px=Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width));
    const py=Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height));
    card.style.setProperty('--mz-card-tilt-x',((px-.5)*7).toFixed(2)+'deg');
    card.style.setProperty('--mz-card-tilt-y',((.5-py)*7).toFixed(2)+'deg');
    card.style.setProperty('--mz-spot-x',(px*100).toFixed(1)+'%');
    card.style.setProperty('--mz-spot-y',(py*100).toFixed(1)+'%');
    card.dataset.tiltActive='true';
  });
  root.addEventListener('pointerout',event=>{
    const card=event.target.closest('.product-card');
    if(!card||card.contains(event.relatedTarget))return;
    card.style.setProperty('--mz-card-tilt-x','0deg');
    card.style.setProperty('--mz-card-tilt-y','0deg');
    card.dataset.tiltActive='false';
  });
}


/* GetLayers-inspired subtle pointer parallax for the hero food scene. */
function bindGetLayersHeroMotion(){
  const scene=root.querySelector('.hero-art-wrap');
  if(!scene||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  if(!window.matchMedia('(hover: hover) and (pointer: fine)').matches)return;
  let frame=0;
  scene.addEventListener('pointermove',event=>{
    const rect=scene.getBoundingClientRect();
    const x=(event.clientX-rect.left)/rect.width-.5;
    const y=(event.clientY-rect.top)/rect.height-.5;
    if(frame)cancelAnimationFrame(frame);
    frame=requestAnimationFrame(()=>{
      scene.style.setProperty('--mz-scene-x',(x*-9).toFixed(2)+'px');
      scene.style.setProperty('--mz-scene-y',(y*-7).toFixed(2)+'px');
    });
  });
  scene.addEventListener('pointerleave',()=>{
    if(frame)cancelAnimationFrame(frame);
    scene.style.setProperty('--mz-scene-x','0px');
    scene.style.setProperty('--mz-scene-y','0px');
  });
}


/* SweetTape-inspired scroll storytelling: reveal, gentle depth and reading progress. */
function bindScrollStorytelling(){
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const progress=document.createElement('div');
  progress.className='mz-scroll-progress';
  progress.setAttribute('aria-hidden','true');
  document.body.appendChild(progress);

  const updateProgress=()=>{
    const doc=document.documentElement;
    const max=doc.scrollHeight-window.innerHeight;
    const amount=max>0?Math.min(1,Math.max(0,window.scrollY/max)):0;
    progress.style.transform='scaleX('+amount.toFixed(4)+')';
  };
  let scrollFrame=0;
  const onScroll=()=>{
    if(scrollFrame)return;
    scrollFrame=requestAnimationFrame(()=>{
      scrollFrame=0;
      updateProgress();
      if(!reduced){
        const hero=document.querySelector('.hero-art-wrap');
        if(hero&&window.scrollY<window.innerHeight*1.25){
          hero.style.setProperty('--mz-scroll-depth',(Math.min(34,window.scrollY*.075)).toFixed(1)+'px');
        }
      }
    });
  };
  window.addEventListener('scroll',onScroll,{passive:true});
  window.addEventListener('resize',updateProgress,{passive:true});
  updateProgress();

  const targets='.hero-copy,.hero-art-wrap,.ticker,.section-heading,.featured-grid .product-card,.menu-heading,.menu-grid .product-card,.craft-art,.craft-text,.site-footer';
  if(reduced||!('IntersectionObserver' in window)){
    document.querySelectorAll(targets).forEach(el=>el.classList.add('mz-scroll-visible'));
    return;
  }
  const observer=new IntersectionObserver(entries=>{
    entries.forEach(entry=>{
      if(!entry.isIntersecting)return;
      entry.target.classList.add('mz-scroll-visible');
      observer.unobserve(entry.target);
    });
  },{threshold:.12,rootMargin:'0px 0px -5% 0px'});
  const observeTargets=scope=>{
    if(scope.matches?.(targets))observer.observe(scope);
    scope.querySelectorAll?.(targets).forEach(el=>observer.observe(el));
  };
  observeTargets(document);
  const grids=[document.getElementById('featuredGrid'),document.getElementById('menuGrid')].filter(Boolean);
  if('MutationObserver' in window){
    const mutationObserver=new MutationObserver(records=>{
      records.forEach(record=>record.addedNodes.forEach(node=>{
        if(node.nodeType===1)observeTargets(node);
      }));
    });
    grids.forEach(grid=>mutationObserver.observe(grid,{childList:true,subtree:true}));
  }
}

async function start(){
 root.body.addEventListener('click',handleClick);
 root.addEventListener('submit',async event=>{
  if(event.target.id!=='deleteCustomerAccountForm')return;
  event.preventDefault();
  const form=event.target,button=form.querySelector('[type="submit"]'),errorNode=root.getElementById('deleteAccountError');
  if(!form.elements.confirmDelete.checked){if(errorNode)errorNode.textContent='Confirme que deseja excluir a conta.';return}
  if(!window.confirm('Excluir sua conta Menuza? Essa ação não pode ser desfeita.'))return;
  button.disabled=true;if(errorNode)errorNode.textContent='';
  try{
   await api('/api/customer/account',{method:'DELETE',body:JSON.stringify({password:form.elements.password.value})});
   app.customer=null;app.customerOrders=[];app.cart=[];setCart();
   for(const key of ['bela-cart','menuza-favorites','menuza-recent-products'])try{localStorage.removeItem(key)}catch{}
   location.hash='conta';showCustomerAccount();renderCustomerAuth();toast('Conta excluída com sucesso.');
  }catch(error){if(errorNode)errorNode.textContent=error.message;button.disabled=false}
 });
 
  root.addEventListener('input',event=>{if(event.target.id==='ordersSearch'){app.admin.orderQuery=event.target.value;applyOrderFilters()}});
  root.addEventListener('change',async event=>{
    if(event.target.id==='ordersStatusFilter'){app.admin.orderStatus=event.target.value;applyOrderFilters();return}
    if(event.target.id==='ordersFulfillmentFilter'){app.admin.orderFulfillment=event.target.value;applyOrderFilters();return}
    const select=event.target.closest('[data-order-status]');
    if(select&&select.value){select.disabled=true;try{await api('/api/admin/orders/'+encodeURIComponent(select.dataset.orderStatus),{method:'PATCH',body:JSON.stringify({status:select.value})});toast('Status do pedido atualizado.');refreshAdmin()}catch(e){toast(e.message);select.disabled=false;select.value=''}}
  });
  root.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();root.getElementById('searchInput')?.focus()}if(event.key==='Escape'){if(app.builder){app.builder=null;renderBuilder()}else if(app.cartOpen){app.cartOpen=false;root.getElementById('cartRoot').innerHTML=''}}});
  syncFilters();updateCartCount();bindSpellCardInteractions();bindGetLayersHeroMotion();bindScrollStorytelling();
  const query=new URLSearchParams(location.search),qrToken=query.get('t'),qrNumber=query.get('mesa');
  if(qrToken&&qrNumber){try{const verified=await api('/api/tables/qr/'+encodeURIComponent(qrToken));if(String(verified.table.number)===qrNumber)app.tableQr={token:qrToken,number:verified.table.number,seats:verified.table.seats,status:verified.table.status};else toast('O QR Code não corresponde à mesa informada.')}catch{toast('Não foi possível validar o QR Code desta mesa. Confira se o link está correto.')}}
  window.addEventListener('hashchange',onRoute);
  const initialHash=location.hash.replace(/^#/,'');
  try{const result=await api('/api/customer/me');app.customer=result.customer}
  catch{app.customer=null}
  try{const branding=await api('/api/restaurant/branding');applyRestaurantBranding(branding.restaurant?.name,branding.restaurant?.logoUrl)}catch{}
  if(initialHash==='conta'){onRoute();return}
  // Migra URLs antigas que ficaram salvas em #admin para o login do cliente.
  if(initialHash==='admin'){
    history.replaceState(null,'',location.pathname+location.search+'#conta');
    onRoute();
    return;
  }
  if(!app.customer){
    const firstRoute='conta';
    history.replaceState(null,'',location.pathname+location.search+'#'+firstRoute);
    onRoute();
    return;
  }
  if(initialHash.startsWith('pedido/')){onRoute();return}
  await openMenu();
}
setInterval(updateOrderElapsedTimes,30000);
start();



