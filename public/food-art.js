// Menuza — ilustrações de alimentos (SVG procedural com textura, luz e sombra de contato).
// Determinístico: o mesmo produto/composição sempre gera o mesmo prato.
const TAU = Math.PI * 2;
let uidCounter = 0;

function hashSeed(text) {
  let h = 2166136261;
  for (const ch of String(text)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rngFrom(seed) {
  let a = hashSeed(seed) || 1;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const f = n => Math.round(n * 10) / 10;

// Contorno orgânico fechado (curvas suaves entre pontos com raio variável)
function blobPath(cx, cy, r, jitter, rng, n = 26, squash = 1) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU, rr = r * (1 + (rng() - 0.5) * jitter);
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * squash]);
  }
  const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  let d = 'M' + f(mid(pts[n - 1], pts[0])[0]) + ' ' + f(mid(pts[n - 1], pts[0])[1]);
  for (let i = 0; i < n; i++) {
    const m = mid(pts[i], pts[(i + 1) % n]);
    d += 'Q' + f(pts[i][0]) + ' ' + f(pts[i][1]) + ' ' + f(m[0]) + ' ' + f(m[1]);
  }
  return d + 'Z';
}

function wrapPiece(inner, x, y, rot, scale, pop, delay) {
  return '<g transform="translate(' + f(x) + ' ' + f(y) + ') rotate(' + f(rot) + ') scale(' + f(scale) + ')"><g class="food-ingredient' + (pop ? ' ingredient-pop' : '') + '"' + (pop ? ' style="animation-delay:' + delay + 'ms"' : '') + '>' + inner + '</g></g>';
}

/* ───────────────────────────── PIZZA ───────────────────────────── */
const PIZZA_PIECES = { pepperoni: 7, bacon: 5, chicken: 6, onion: 7, tomato: 6, corn: 4, olive: 8, mushroom: 6, cream: 4, herb: 9 };

function pizzaTopping(type, rng) {
  switch (type) {
    case 'pepperoni': {
      const r = 15 + rng() * 4;
      let dots = '';
      for (let i = 0; i < 6; i++) dots += '<circle cx="' + f((rng() - .5) * r * 1.2) + '" cy="' + f((rng() - .5) * r * 1.2) + '" r="' + f(1 + rng() * 1.6) + '" fill="#e8a27a" opacity=".75"/>';
      return '<circle r="' + f(r) + '" fill="url(#PEP)" stroke="#7b261b" stroke-width="1.6"/><circle r="' + f(r - 3.5) + '" fill="none" stroke="#6f1f16" stroke-width="1.2" opacity=".35"/>' + dots + '<ellipse cx="' + f(-r * .3) + '" cy="' + f(-r * .38) + '" rx="' + f(r * .5) + '" ry="' + f(r * .22) + '" fill="#fff" opacity=".26" transform="rotate(-25)"/>';
    }
    case 'bacon':
      return '<path d="M-22 4q6-15 14-6t13-5q8-8 15 2t10-3l-3 11q-8 9-15 0t-12 4q-9 7-15-1t-7 8z" fill="#b34a36" stroke="#6f281c" stroke-width="1.6"/><path d="M-17 2q8-8 14-1t13-3t12 1" fill="none" stroke="#f1c9a0" stroke-width="3.2" stroke-linecap="round" opacity=".9"/><path d="M-14 9q8-4 14 1t12-1" fill="none" stroke="#7d2e22" stroke-width="1.6" opacity=".6"/>';
    case 'chicken': {
      let s = '';
      for (let i = 0; i < 3; i++) {
        const x = (i - 1) * 9 + (rng() - .5) * 4, y = (rng() - .5) * 9, w = 10 + rng() * 5, h = 5 + rng() * 3, a = rng() * 60 - 30;
        s += '<g transform="translate(' + f(x) + ' ' + f(y) + ') rotate(' + f(a) + ')"><ellipse rx="' + f(w) + '" ry="' + f(h) + '" fill="#e2bb80" stroke="#b78852" stroke-width="1.3"/><path d="M' + f(-w * .6) + ' 0q' + f(w * .6) + ' -3 ' + f(w * 1.2) + ' 1" stroke="#f6dfae" stroke-width="1.6" fill="none"/></g>';
      }
      return s;
    }
    case 'onion':
      return '<g transform="rotate(' + f(rng() * 180) + ')"><ellipse rx="17" ry="11" fill="none" stroke="#b66d8d" stroke-width="5" stroke-dasharray="' + f(34 + rng() * 22) + ' 9"/><ellipse rx="17" ry="11" fill="none" stroke="#f0d5de" stroke-width="1.4" opacity=".8" stroke-dasharray="26 14"/><ellipse rx="9" ry="5.5" fill="none" stroke="#c78ba5" stroke-width="3" stroke-dasharray="14 8"/></g>';
    case 'tomato':
      return '<circle r="14.5" fill="#d84a33" stroke="#a52f20" stroke-width="1.6"/><circle r="10.5" fill="#ef7a5a" opacity=".9"/><g fill="#f7c7a2" opacity=".9"><ellipse cx="-4" cy="-3" rx="3" ry="2.2"/><ellipse cx="4" cy="-3" rx="3" ry="2.2"/><ellipse cx="0" cy="4" rx="3" ry="2.2"/></g><ellipse cx="-5" cy="-8" rx="5" ry="2" fill="#fff" opacity=".22" transform="rotate(-25)"/>';
    case 'corn': {
      let s = '';
      for (let i = 0; i < 4; i++) s += '<ellipse cx="' + f((rng() - .5) * 16) + '" cy="' + f((rng() - .5) * 16) + '" rx="4.4" ry="3.2" fill="#efc546" stroke="#c99a25" stroke-width=".9" transform="rotate(' + f(rng() * 180) + ')"/><circle cx="' + f((rng() - .5) * 14) + '" cy="' + f((rng() - .5) * 14) + '" r="1" fill="#fff6c4"/>';
      return s;
    }
    case 'olive':
      return '<circle r="8.2" fill="#2b372a" stroke="#18211a" stroke-width="1.2"/><circle r="3.4" fill="#a8441f"/><ellipse cx="-3.4" cy="-4" rx="3" ry="1.4" fill="#fff" opacity=".3" transform="rotate(-30)"/>';
    case 'mushroom':
      return '<path d="M-17 4q1-18 17-18t17 18q-17 5-34 0z" fill="#e3d5b3" stroke="#a89468" stroke-width="1.5"/><path d="M-6 3q6 9 12 0v10q-6 5-12 0z" fill="#f0e7cf" stroke="#b09f78" stroke-width="1.2"/><path d="M-12 -4q10-8 22 0" fill="none" stroke="#fff" stroke-width="2" opacity=".35"/>';
    case 'cream':
      return '<ellipse cx="0" cy="3" rx="16" ry="11" fill="#e7cf98" opacity=".55"/><path d="M-15 0q4-13 15-11t15 11q-5 11-15 10t-15-10z" fill="#fbf0cf" stroke="#e6cf93" stroke-width="1.6"/><ellipse cx="-4" cy="-4" rx="6" ry="2.4" fill="#fff" opacity=".7"/>';
    case 'herb': {
      let s = '';
      for (let i = 0; i < 3; i++) s += '<path transform="rotate(' + (i * 70 + f(rng() * 30)) + ')" d="M0 0q8-12 17-5q-7 12-17 5z" fill="' + (i % 2 ? '#5f7d3f' : '#7a9a4c') + '"/>';
      return s;
    }
    default: return '';
  }
}

export function pizzaArt(ingredients = [], seed = 'pizza', lookup = () => null) {
  const id = 'pz' + (++uidCounter), rng = rngFrom('pizza:' + seed);
  const ids = new Set(ingredients.map(i => i.id));
  const hasSauce = ids.has('molho-tomate'), hasCheese = ids.has('mussarela');
  const cx = 250, cy = 250;

  /* base de massa */
  const crustBlob = blobPath(cx, cy, 205, 0.012, rng, 40);
  let blisters = '';
  for (let i = 0; i < 34; i++) {
    const a = rng() * TAU, rr = 186 + rng() * 17;
    blisters += '<ellipse cx="' + f(cx + Math.cos(a) * rr) + '" cy="' + f(cy + Math.sin(a) * rr) + '" rx="' + f(2 + rng() * 6) + '" ry="' + f(1.6 + rng() * 4) + '" fill="#6f3a17" opacity="' + f(.22 + rng() * .3) + '" transform="rotate(' + f(rng() * 180) + ' ' + f(cx + Math.cos(a) * rr) + ' ' + f(cy + Math.sin(a) * rr) + ')"/>';
  }
  let flour = '';
  for (let i = 0; i < 40; i++) {
    const a = rng() * TAU, rr = 184 + rng() * 18;
    flour += '<circle cx="' + f(cx + Math.cos(a) * rr) + '" cy="' + f(cy + Math.sin(a) * rr) + '" r="' + f(.8 + rng() * 1.8) + '" fill="#fff4d8" opacity="' + f(.35 + rng() * .4) + '"/>';
  }

  /* molho */
  const sauce = hasSauce
    ? '<path d="' + blobPath(cx, cy, 173, .03, rng, 30) + '" fill="url(#' + id + 'sauce)"/><path d="' + blobPath(cx, cy, 173, .03, rng, 30) + '" fill="none" stroke="#7d2a18" stroke-width="3" opacity=".35"/>'
    : '<circle cx="' + cx + '" cy="' + cy + '" r="173" fill="#e9c386"/>';

  /* queijo */
  let cheese = '';
  if (hasCheese) {
    cheese += '<path d="' + blobPath(cx, cy, 160, .07, rng, 34) + '" fill="url(#' + id + 'cheese)" stroke="#d9a83f" stroke-width="2"/>';
    for (let i = 0; i < 16; i++) {
      const a = rng() * TAU, rr = Math.sqrt(rng()) * 128, x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr, r0 = 24 + rng() * 34;
      cheese += '<path d="' + blobPath(x, y, r0, .25, rng, 12) + '" fill="' + (i % 3 ? '#fbe9a4' : '#eec760') + '" opacity="' + f(.35 + rng() * .35) + '"/>';
    }
    for (let i = 0; i < 12; i++) {
      const a = rng() * TAU, rr = Math.sqrt(rng()) * 145, x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr, r0 = 5 + rng() * 11;
      cheese += '<path d="' + blobPath(x, y, r0, .5, rng, 9) + '" fill="#c98730" opacity="' + f(.38 + rng() * .3) + '"/>';
    }
    for (let i = 0; i < 12; i++) {
      const a = rng() * TAU, rr = Math.sqrt(rng()) * 140, x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr, r0 = 4 + rng() * 6;
      cheese += '<circle cx="' + f(x) + '" cy="' + f(y) + '" r="' + f(r0) + '" fill="#fbe596" stroke="#d6a43d" stroke-width="1.2"/><circle cx="' + f(x - r0 * .3) + '" cy="' + f(y - r0 * .3) + '" r="' + f(r0 * .28) + '" fill="#fffbe0"/>';
    }
    if (hasSauce) for (let i = 0; i < 6; i++) {
      const a = rng() * TAU, rr = 112 + rng() * 40;
      cheese += '<path d="' + blobPath(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 5 + rng() * 9, .5, rng, 9) + '" fill="#b4452d" opacity=".85"/>';
    }
  }

  /* coberturas */
  const pieces = [];
  ingredients.forEach(item => {
    const src = lookup(item.id) || item;
    const visual = src.visual || item.visual || item.id;
    if (!PIZZA_PIECES[visual] || ['mussarela', 'molho-tomate'].includes(item.id)) return;
    const units = Math.max(1, Math.min(3, Number(item.quantity) || 1));
    const count = Math.min(14, PIZZA_PIECES[visual] * units);
    for (let n = 0; n < count; n++) pieces.push({ visual, pop: !!item.pop });
  });
  for (let i = pieces.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pieces[i], pieces[j]] = [pieces[j], pieces[i]]; }
  const used = pieces.slice(0, 44), total = used.length;
  const sizeK = total > 30 ? .8 : total > 18 ? .92 : 1.05;
  let toppings = '';
  used.forEach((piece, k) => {
    const rr = 142 * Math.sqrt((k + .6) / Math.max(total, 1)), a = k * 2.39996 + rng() * .5;
    const x = cx + Math.cos(a) * rr + (rng() - .5) * 10, y = cy + Math.sin(a) * rr + (rng() - .5) * 10;
    const inner = pizzaTopping(piece.visual, rng).replace('url(#PEP)', 'url(#' + id + 'pep)');
    toppings += wrapPiece(inner, x, y, rng() * 360, sizeK * (.9 + rng() * .22), piece.pop, k % 5 * 40);
  });

  const defs = '<defs>'
    + '<radialGradient id="' + id + 'crust" cx="36%" cy="28%" r="85%"><stop stop-color="#f6d79c"/><stop offset=".55" stop-color="#dba45c"/><stop offset="1" stop-color="#a8652f"/></radialGradient>'
    + '<radialGradient id="' + id + 'sauce" cx="45%" cy="40%"><stop stop-color="#d4623f"/><stop offset=".85" stop-color="#b8472c"/><stop offset="1" stop-color="#a03a26"/></radialGradient>'
    + '<radialGradient id="' + id + 'cheese" cx="36%" cy="30%" r="80%"><stop stop-color="#fff0b8"/><stop offset=".7" stop-color="#f4d77d"/><stop offset="1" stop-color="#e3b84f"/></radialGradient>'
    + '<radialGradient id="' + id + 'pep" cx="38%" cy="32%" r="75%"><stop stop-color="#cf5b3f"/><stop offset=".6" stop-color="#b13f2b"/><stop offset="1" stop-color="#8d2c20"/></radialGradient>'
    + '<filter id="' + id + 'rough" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency=".03" numOctaves="3" seed="4" result="t"/><feDisplacementMap in="SourceGraphic" in2="t" scale="9"/></filter>'
    + '<filter id="' + id + 'grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="7" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 .36  0 0 0 0 .2  0 0 0 0 .07  0 0 0 1.7 -.7"/></filter>'
    + '<filter id="' + id + 'ts" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="1.6" dy="3.2" stdDeviation="2.2" flood-color="#40170a" flood-opacity=".42"/></filter>'
    + '<filter id="' + id + 'blur"><feGaussianBlur stdDeviation="9"/></filter>'
    + '<clipPath id="' + id + 'cc"><path d="' + crustBlob + '"/></clipPath>'
    + '</defs>';

  return '<svg viewBox="0 0 500 500" role="img" aria-label="Pizza com os ingredientes selecionados" xmlns="http://www.w3.org/2000/svg">' + defs
    + '<ellipse cx="258" cy="278" rx="214" ry="204" fill="#1b1530" opacity=".20" filter="url(#' + id + 'blur)"/>'
    + '<g filter="url(#' + id + 'rough)"><path d="' + crustBlob + '" fill="url(#' + id + 'crust)" stroke="#9a5a2a" stroke-width="3"/></g>'
    + '<g clip-path="url(#' + id + 'cc)"><rect width="500" height="500" fill="#000" filter="url(#' + id + 'grain)" opacity=".55"/></g>'
    + '<circle cx="' + cx + '" cy="' + cy + '" r="190" fill="none" stroke="#fff1c4" stroke-width="5" opacity=".35" stroke-dasharray="210 980" stroke-dashoffset="-540" stroke-linecap="round"/>'
    + blisters + flour
    + '<circle cx="' + cx + '" cy="' + cy + '" r="178" fill="#8e5224" opacity=".30"/>'
    + sauce + cheese
    + '<g filter="url(#' + id + 'ts)">' + toppings + '</g>'
    + '</svg>';
}

/* ───────────────────────────── HAMBÚRGUER ───────────────────────────── */
function wavyEdge(x0, x1, y, amp, waves, rng, down = true) {
  let d = '';
  const w = (x1 - x0) / waves;
  for (let i = 0; i < waves; i++) {
    const x = x0 + i * w, a = amp * (.6 + rng() * .8) * (down ? 1 : -1);
    d += 'Q' + f(x + w / 2) + ' ' + f(y + a) + ' ' + f(x + w) + ' ' + f(y);
  }
  return d;
}

export function burgerArt(ingredients = [], seed = 'burger', opts = {}) {
  const id = 'bg' + (++uidCounter), rng = rngFrom('burger:' + seed);
  const get = key => ingredients.find(i => i.id === key);
  const has = key => !!get(key);
  const qty = key => Math.max(1, Math.min(3, Number(get(key)?.quantity) || 1));
  const cls = key => 'food-ingredient' + (get(key)?.pop ? ' ingredient-pop' : '');
  const L = 78, R = 422, W = R - L;
  let y = 372;               // base do empilhamento (cresce para cima)
  let out = '';

  const bunBottom = () => {
    out += '<g class="food-ingredient"><path d="M' + (L + 6) + ' ' + (y - 40) + 'h' + (W - 12) + 'q10 0 8 14q-6 34-' + 70 + ' 36h-' + (W - 96) + 'q-76-2-' + 82 + '-36q-2-14 8-14z" fill="url(#' + id + 'bun)" stroke="#935a2c" stroke-width="3"/><path d="M' + (L + 22) + ' ' + (y - 36) + 'h' + (W - 44) + '" stroke="#f4cf8b" stroke-width="3" opacity=".7"/></g>';
    y -= 38;
  };
  const sauceLayer = () => {
    out += '<g class="' + cls('molho-especial') + '"><path d="M' + (L + 14) + ' ' + y + 'h' + (W - 28) + 'q8 0 4 7q-6 7-16 4t-18 5t-22-3t-22 4t-24-4t-22 3t-24-3t-22 4t-20-4q-8-4-4-13z" fill="#d9894a" opacity=".95"/><path d="M' + (L + 30) + ' ' + (y + 2) + 'h' + (W - 90) + '" stroke="#f0b574" stroke-width="2.4" opacity=".8"/></g>';
    y -= 6;
  };
  const lettuce = () => {
    const top = y - 22;
    let d = 'M' + (L - 10) + ' ' + y + 'Q' + (L - 22) + ' ' + (y - 14) + ' ' + (L - 4) + ' ' + (top + 6);
    for (let i = 0; i < 9; i++) { const x = L - 4 + i * ((W + 8) / 9); d += 'q' + f((W + 8) / 18) + ' ' + f(-10 - rng() * 8) + ' ' + f((W + 8) / 9) + ' ' + f(rng() * 6 - 3); }
    d += 'L' + (R + 8) + ' ' + y;
    out += '<g class="' + cls('alface') + '"><path d="' + d + 'q-30 10-60 2t-60 6t-60-3t-60 5t-60-4t-60 3t-' + f(W - 360 + 18) + ' -2z" fill="url(#' + id + 'let)" stroke="#4f6d34" stroke-width="2.4"/><path d="M' + (L + 20) + ' ' + (y - 8) + 'q30-10 52 0t52 0t52 0t52 0t52 0t52 0" fill="none" stroke="#b3cf86" stroke-width="2.4" opacity=".7"/></g>';
    y -= 20;
  };
  const tomato = () => {
    out += '<g class="' + cls('tomate-burger') + '"><rect x="' + (L + 2) + '" y="' + (y - 17) + '" width="' + (W - 4) + '" height="17" rx="8" fill="#d6452f" stroke="#9e2b1d" stroke-width="2.4"/><rect x="' + (L + 14) + '" y="' + (y - 13) + '" width="' + (W - 28) + '" height="5" rx="2.5" fill="#f08a68" opacity=".8"/>' + [0, 1, 2, 3, 4, 5, 6].map(i => '<ellipse cx="' + (L + 40 + i * 44) + '" cy="' + (y - 6) + '" rx="6" ry="2.2" fill="#f9cfa8" opacity=".9"/>').join('') + '</g>';
    y -= 16;
  };
  const onion = () => {
    let s = '';
    for (let i = 0; i < 7; i++) s += '<ellipse cx="' + f(L + 34 + i * 46 + rng() * 8) + '" cy="' + f(y - 5) + '" rx="22" ry="5.2" fill="none" stroke="#7d4a2b" stroke-width="5.5" opacity=".95"/><ellipse cx="' + f(L + 34 + i * 46) + '" cy="' + f(y - 6.4) + '" rx="20" ry="3" fill="none" stroke="#c28b4e" stroke-width="1.6" opacity=".8"/>';
    out += '<g class="' + cls('cebola-burger') + '">' + s + '</g>';
    y -= 10;
  };
  const pickles = () => {
    let s = '';
    for (let i = 0; i < 6; i++) { const x = L + 48 + i * 58 + (rng() - .5) * 10; s += '<ellipse cx="' + f(x) + '" cy="' + f(y - 5) + '" rx="24" ry="5.6" fill="#789a42" stroke="#4e6b2a" stroke-width="1.8"/><ellipse cx="' + f(x) + '" cy="' + f(y - 6.4) + '" rx="19" ry="2.4" fill="#cfd796" opacity=".85"/>'; }
    out += '<g class="' + cls('picles') + '">' + s + '</g>';
    y -= 10;
  };
  const patty = () => {
    let marks = '', specks = '';
    for (let i = 0; i < 7; i++) marks += '<path d="M' + (L + 26 + i * 46) + ' ' + (y - 8) + 'l22 -22" stroke="#2a150f" stroke-width="5" stroke-linecap="round" opacity=".55"/>';
    for (let i = 0; i < 36; i++) specks += '<circle cx="' + f(L + 12 + rng() * (W - 24)) + '" cy="' + f(y - 36 + rng() * 32) + '" r="' + f(.9 + rng() * 1.6) + '" fill="' + (rng() > .5 ? '#8c5a3c' : '#2f1810') + '" opacity=".55"/>';
    out += '<g class="' + cls('carne') + '"><path d="M' + (L - 6) + ' ' + (y - 14) + 'q2-22 22-22h' + (W - 32) + 'q22 0 24 22q0 20-22 21h-' + (W - 32) + 'q-22-1-24-21z" fill="url(#' + id + 'meat)" stroke="#2c170f" stroke-width="2.6"/>' + marks + specks + '<path d="M' + (L + 18) + ' ' + (y - 31) + 'h' + (W - 44) + '" stroke="#b9805a" stroke-width="2.4" opacity=".6" stroke-linecap="round"/></g>';
    y -= 34;
  };
  const bacon = () => {
    for (let n = 0; n < qty('bacon-burger'); n++) {
      out += '<g class="' + cls('bacon-burger') + '"><path d="M' + (L - 4) + ' ' + (y - 4) + 'q22-14 44-2t44 0t44-2t44 2t44 0t44-2t44 2q8 6-2 11q-22 10-44 1t-44 0t-44 1t-44-1t-44 1t-44 0t-' + 28 + ' 0z" fill="#b3503a" stroke="#6b281b" stroke-width="2.2"/><path d="M' + (L + 14) + ' ' + (y - 5) + 'q22-8 44 0t44 0t44 0t44 0t44 0t44 0" fill="none" stroke="#f1c9a0" stroke-width="3.4" stroke-linecap="round" opacity=".9"/></g>';
      y -= 8;
    }
  };
  const egg = () => {
    out += '<g class="' + cls('ovo') + '"><path d="' + blobPath(250, y - 6, 138, .06, rng, 18, .1) + '" fill="#fffaf0" stroke="#d6c7a3" stroke-width="2"/><ellipse cx="250" cy="' + (y - 13) + '" rx="30" ry="9" fill="#f0a93c" stroke="#c97f1d" stroke-width="1.6"/><ellipse cx="241" cy="' + (y - 16) + '" rx="9" ry="3" fill="#fff" opacity=".5"/></g>';
    y -= 12;
  };
  const cheese = () => {
    const n = Math.min(3, (has('queijo-cheddar') ? qty('queijo-cheddar') : 0) + (has('queijo-extra') ? qty('queijo-extra') : 0)) || 1;
    for (let k = 0; k < n; k++) {
      const drips = [L + 26, L + 120, L + 214, L + 292].map((x, i) => 'M' + f(x) + ' ' + (y - 4) + 'q6 ' + (12 + i * 3 % 9) + ' 14 ' + (14 + i * 2) + 'q8 -4 8 -14z').join('');
      out += '<g class="' + cls('queijo-cheddar') + '"><path d="M' + (L - 14) + ' ' + (y - 12) + 'h' + (W + 28) + 'l-6 11q-20 8-40 0t-40 6t-40-5t-40 6t-40-4t-40 5t-40-3t-' + f(W - 266) + ' 0z" fill="url(#' + id + 'chz)" stroke="#b97a22" stroke-width="2.2"/><path d="' + drips + '" fill="#efae35" stroke="#b97a22" stroke-width="1.6"/><path d="M' + (L + 12) + ' ' + (y - 9) + 'h' + (W - 20) + '" stroke="#ffe08a" stroke-width="2.6" opacity=".8" stroke-linecap="round"/></g>';
      y -= 12;
    }
  };
  const domePath = yy => 'M' + (L - 4) + ' ' + yy + 'C' + (L - 12) + ' ' + (yy - 26) + ' ' + (L + 4) + ' ' + (yy - 66) + ' ' + (L + 52) + ' ' + (yy - 96) + 'C' + (L + 120) + ' ' + (yy - 134) + ' ' + (R - 120) + ' ' + (yy - 134) + ' ' + (R - 52) + ' ' + (yy - 96) + 'C' + (R - 4) + ' ' + (yy - 66) + ' ' + (R + 12) + ' ' + (yy - 26) + ' ' + (R + 4) + ' ' + yy + 'q0 13-16 13H' + (L + 12) + 'q-16 0-16-13z';
  const bunTop = () => {
    let seeds = '';
    for (let i = 0; i < 30; i++) {
      const t = .12 + rng() * .76, x = L + t * W, arch = Math.sin(t * Math.PI), sy = y - 24 - Math.pow(arch, .6) * 118 * (.22 + rng() * .62);
      seeds += '<ellipse cx="' + f(x) + '" cy="' + f(sy) + '" rx="5.4" ry="2.6" fill="#fbebc0" stroke="#d9b57a" stroke-width=".7" transform="rotate(' + f((t - .5) * 70 + rng() * 40 - 20) + ' ' + f(x) + ' ' + f(sy) + ')"/>';
    }
    out += '<g class="' + cls('pao-brioche') + '"><path d="' + domePath(y) + '" fill="url(#' + id + 'bun)" stroke="#935a2c" stroke-width="3"/><g clip-path="url(#' + id + 'bc)"><rect width="500" height="500" fill="#000" filter="url(#' + id + 'grain)" opacity=".5"/></g><path d="M' + (L + 30) + ' ' + (y - 50) + 'C' + (L + 50) + ' ' + (y - 96) + ' ' + (L + 100) + ' ' + (y - 114) + ' ' + (L + 160) + ' ' + (y - 118) + '" fill="none" stroke="#fff0c2" stroke-width="7" stroke-linecap="round" opacity=".5"/><path d="M' + (L + 6) + ' ' + (y - 8) + 'h' + (W - 12) + '" stroke="#8a5124" stroke-width="3" opacity=".25"/>' + seeds + '</g>';
  };
  // pilha de baixo para cima
  bunBottom();
  if (has('molho-especial')) sauceLayer();
  if (has('alface')) lettuce();
  if (has('tomate-burger')) tomato();
  if (has('cebola-burger')) onion();
  if (has('picles')) pickles();
  if (has('carne')) { patty(); if (opts.double) patty(); }
  if (has('bacon-burger')) bacon();
  if (has('ovo')) egg();
  if (has('queijo-cheddar') || has('queijo-extra')) cheese();
  const topY = y;
  if (has('pao-brioche')) bunTop();
  const total = 372 - topY;
  const vbTop = topY - (has('pao-brioche') ? 150 : 40);

  const defs = '<defs>'
    + '<linearGradient id="' + id + 'bun" x1="0" y1="0" x2=".2" y2="1"><stop stop-color="#f6cf80"/><stop offset=".55" stop-color="#dc9a4c"/><stop offset="1" stop-color="#b66e34"/></linearGradient>'
    + '<linearGradient id="' + id + 'meat" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#7a4a35"/><stop offset=".5" stop-color="#5a3224"/><stop offset="1" stop-color="#3b2017"/></linearGradient>'
    + '<linearGradient id="' + id + 'chz" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#f7c75a"/><stop offset="1" stop-color="#e6a02c"/></linearGradient>'
    + '<linearGradient id="' + id + 'let" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#98bb62"/><stop offset="1" stop-color="#6c9143"/></linearGradient>'
    + '<filter id="' + id + 'grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="2" seed="11" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 .36  0 0 0 0 .2  0 0 0 0 .07  0 0 0 1.7 -.72"/></filter>'
    + '<filter id="' + id + 'blur"><feGaussianBlur stdDeviation="8"/></filter>'
    + '<clipPath id="' + id + 'bc"><path d="' + domePath(topY) + '"/></clipPath>'
    + '</defs>';
  void total;
  return '<svg viewBox="0 ' + f(vbTop) + ' 500 ' + f(430 - vbTop) + '" role="img" aria-label="Hambúrguer com os ingredientes selecionados" xmlns="http://www.w3.org/2000/svg">' + defs
    + '<ellipse cx="256" cy="398" rx="196" ry="20" fill="#1b1530" opacity=".25" filter="url(#' + id + 'blur)"/>'
    + out + '</svg>';
}

/* ───────────────────────────── PORÇÃO (BATATAS) ───────────────────────────── */
export function plateArt(seed = 'plate') {
  const id = 'pl' + (++uidCounter), rng = rngFrom('plate:' + seed);
  let fries = '';
  for (let i = 0; i < 34; i++) {
    const t = i / 34, x = 250 + (t - .5) * 220 + (rng() - .5) * 24, y = 214 + Math.sin(t * Math.PI) * -10 + (rng() - .5) * 30;
    const len = 104 + rng() * 52, rot = -70 + rng() * 140 + (t - .5) * 50, w = 15 + rng() * 5;
    fries += '<g transform="translate(' + f(x) + ' ' + f(y) + ') rotate(' + f(rot) + ')"><rect x="' + f(-w / 2) + '" y="' + f(-len / 2) + '" width="' + f(w) + '" height="' + f(len) + '" rx="3" fill="url(#' + id + 'fry)" stroke="#a96d26" stroke-width="1.6"/><path d="M' + f(-w / 2 + 3) + ' ' + f(-len / 2 + 4) + 'v' + f(len - 8) + '" stroke="#fbe3a1" stroke-width="2" opacity=".7" stroke-linecap="round"/>' + (rng() > .5 ? '<ellipse cx="0" cy="' + f((rng() - .5) * len * .6) + '" rx="' + f(w / 2) + '" ry="2.5" fill="#8c5518" opacity=".35"/>' : '') + '</g>';
  }
  let salt = '';
  for (let i = 0; i < 40; i++) salt += '<circle cx="' + f(150 + rng() * 200) + '" cy="' + f(150 + rng() * 110) + '" r="' + f(.8 + rng() * 1.1) + '" fill="#fff" opacity=".85"/>';
  let herbs = '';
  for (let i = 0; i < 6; i++) herbs += '<path transform="translate(' + f(170 + rng() * 160) + ' ' + f(165 + rng() * 80) + ') rotate(' + f(rng() * 360) + ')" d="M0 0q9-14 19-6q-8 13-19 6z" fill="#5f7d3f"/>';
  return '<svg viewBox="0 0 500 420" role="img" aria-label="Porção de batatas fritas" xmlns="http://www.w3.org/2000/svg"><defs>'
    + '<linearGradient id="' + id + 'fry" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#f2c15f"/><stop offset=".6" stop-color="#e0a043"/><stop offset="1" stop-color="#c98a32"/></linearGradient>'
    + '<radialGradient id="' + id + 'pl" cx="40%" cy="30%" r="85%"><stop stop-color="#ffffff"/><stop offset="1" stop-color="#dcdae4"/></radialGradient>'
    + '<filter id="' + id + 'blur"><feGaussianBlur stdDeviation="9"/></filter>'
    + '<filter id="' + id + 'ts"><feDropShadow dx="1.5" dy="3" stdDeviation="2" flood-color="#2a1608" flood-opacity=".35"/></filter></defs>'
    + '<ellipse cx="258" cy="262" rx="216" ry="134" fill="#1b1530" opacity=".22" filter="url(#' + id + 'blur)"/>'
    + '<ellipse cx="250" cy="236" rx="206" ry="130" fill="url(#' + id + 'pl)" stroke="#cfcddb" stroke-width="3"/>'
    + '<ellipse cx="250" cy="238" rx="150" ry="88" fill="#efedf5" stroke="#d9d7e3" stroke-width="2"/>'
    + '<g filter="url(#' + id + 'ts)">' + fries + '</g>' + salt + herbs + '</svg>';
}
