// Menuza — ferramentas de geometria procedural para os modelos 3D de alimentos.
// Sem dependências e sem acesso a DOM: pode ser executado no navegador e em testes Node.

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const hash = value => { let h = 2166136261; for (const c of String(value)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
export const randomFor = seed => { let n = seed >>> 0; return () => { n = (Math.imul(1664525, n) + 1013904223) >>> 0; return n / 4294967296; }; };

// Cores informadas em sRGB e convertidas para espaço linear (o shader aplica tone mapping e gama).
export const lin = h => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255].map(v => (v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4));
};
export const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

// ---------- ruído de valor 3D com semente ----------
function ihash(x, y, z, s) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177) ^ Math.imul(s, 2147483629);
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function noise3(x, y, z, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let xf = x - xi, yf = y - yi, zf = z - zi;
  xf = xf * xf * (3 - 2 * xf); yf = yf * yf * (3 - 2 * yf); zf = zf * zf * (3 - 2 * zf);
  const c = (dx, dy, dz) => ihash(xi + dx, yi + dy, zi + dz, s);
  const x00 = lerp(c(0, 0, 0), c(1, 0, 0), xf), x10 = lerp(c(0, 1, 0), c(1, 1, 0), xf);
  const x01 = lerp(c(0, 0, 1), c(1, 0, 1), xf), x11 = lerp(c(0, 1, 1), c(1, 1, 1), xf);
  return lerp(lerp(x00, x10, yf), lerp(x01, x11, yf), zf);
}
export function fbm(x, y, z, s = 0, oct = 3) {
  let amp = .5, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) { sum += noise3(x * f, y * f, z * f, s + i * 17) * amp; norm += amp; amp *= .5; f *= 2.03; }
  return sum / norm;
}

// ---------- vetores ----------
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// Transformação rígida (rotação + escala uniforme + translação). Nunca espelha: preserva a orientação das faces.
export function rigid({ yaw = 0, pitch = 0, roll = 0, s = 1, t = [0, 0, 0] } = {}) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cx = Math.cos(pitch), sx = Math.sin(pitch), cz = Math.cos(roll), sz = Math.sin(roll);
  return p => {
    const x = p[0] * s, y = p[1] * s, z = p[2] * s;
    const x1 = x * cz - y * sz, y1 = x * sz + y * cz;
    const y2 = y1 * cx - z * sx, z2 = y1 * sx + z * cx;
    return [x1 * cy + z2 * sy + t[0], y2 + t[1], -x1 * sy + z2 * cy + t[2]];
  };
}
// Coloca um objeto sobre uma superfície: o eixo Y local passa a seguir a normal.
export function onSurface(center, normal, yaw = 0, s = 1) {
  const n = norm(normal);
  let t1 = cross(n, Math.abs(n[2]) < .9 ? [0, 0, 1] : [1, 0, 0]); t1 = norm(t1);
  const t2 = cross(t1, n), cy = Math.cos(yaw), sy = Math.sin(yaw);
  return p => {
    const x = (p[0] * cy + p[2] * sy) * s, y = p[1] * s, z = (-p[0] * sy + p[2] * cy) * s;
    return [center[0] + t1[0] * x + n[0] * y + t2[0] * z, center[1] + t1[1] * x + n[1] * y + t2[1] * z, center[2] + t1[2] * x + n[2] * y + t2[2] * z];
  };
}

// ---------- perfis de revolução ----------
export function profile(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1] || 1;
  return {
    pts, total,
    at(v) {
      const d = clamp(v, 0, 1) * total; let lo = 0, hi = cum.length - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= d) lo = mid; else hi = mid; }
      const t = (d - cum[lo]) / ((cum[hi] - cum[lo]) || 1);
      return [lerp(pts[lo][0], pts[hi][0], t), lerp(pts[lo][1], pts[hi][1], t)];
    }
  };
}
export function smoothPoly(pts, passes = 2, closed = false) {
  let cur = pts.map(p => p.slice());
  for (let k = 0; k < passes; k++) {
    const out = cur.map(p => p.slice()), n = cur.length;
    for (let i = closed ? 0 : 1; i < (closed ? n : n - 1); i++) {
      const a = cur[(i - 1 + n) % n], b = cur[(i + 1) % n];
      out[i][0] = lerp(cur[i][0], (a[0] + b[0]) / 2, .5); out[i][1] = lerp(cur[i][1], (a[1] + b[1]) / 2, .5);
    }
    cur = out;
  }
  return cur;
}
// Pastilha de superelipse: do centro inferior, pela lateral, até o centro superior.
export function superPuck(R, H, n, N = 56, bulge = 0) {
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const th = -Math.PI / 2 + Math.PI * i / N, c = Math.cos(th), s = Math.sin(th);
    const y = H * (.5 + .5 * Math.sign(s) * Math.abs(s) ** (2 / n));
    let r = R * Math.max(c, 0) ** (2 / n);
    r *= 1 + bulge * Math.sin(Math.PI * clamp(y / H, 0, 1));
    pts.push([i === 0 || i === N ? 0 : r, y]);
  }
  return profile(pts);
}
// Laço fechado (anéis, azeitonas): superelipse em torno de (cr, cy).
export function loopProfile(cr, cy, hw, hh, n = 3, N = 40) {
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const a = TAU * i / N, c = Math.cos(a), s = Math.sin(a);
    pts.push([cr + hw * Math.sign(c) * Math.abs(c) ** (2 / n), cy + hh * Math.sign(s) * Math.abs(s) ** (2 / n)]);
  }
  pts[N] = pts[0].slice();
  return profile(pts);
}

// ---------- malha ----------
export class Mesh {
  constructor() { this.p = []; this.n = []; this.c = []; this.m = []; this.i = []; }
  get count() { return this.p.length / 3; }

  // Superfície paramétrica (u,v) -> [x,y,z] com normais calculadas por diferenças centrais (shading suave).
  // S(u,v,p,n) -> [r,g,b, roughness, sss, bump, ao]
  grid(nu, nv, P0, S, o = {}) {
    nu = Math.max(2, Math.round(nu)); nv = Math.max(2, Math.round(nv));
    const wrapU = o.wrapU !== false, wrapV = !!o.wrapV, xf = o.xf;
    const P = xf ? (u, v) => xf(P0(u, v)) : P0;
    const eu = .5 / nu, ev = .5 / nv;
    const normalOf = Pf => (u, v) => {
      const ua = wrapU ? u - eu : Math.max(0, u - eu), ub = wrapU ? u + eu : Math.min(1, u + eu);
      const va = wrapV ? v - ev : Math.max(0, v - ev), vb = wrapV ? v + ev : Math.min(1, v + ev);
      let n = cross(sub(Pf(u, vb), Pf(u, va)), sub(Pf(ub, v), Pf(ua, v)));
      let l = Math.hypot(n[0], n[1], n[2]);
      if (l < 1e-13) { // polos: usa uma linha ligeiramente deslocada
        const vv = v < .5 ? Math.min(1, v + ev * 3) : Math.max(0, v - ev * 3);
        n = cross(sub(Pf(u, Math.min(1, vv + ev)), Pf(u, Math.max(0, vv - ev))), sub(Pf(Math.min(1, u + eu), vv), Pf(Math.max(0, u - eu), vv)));
        l = Math.hypot(n[0], n[1], n[2]);
        if (l < 1e-13) return [0, 1, 0];
      }
      return [n[0] / l, n[1] / l, n[2] / l];
    };
    const normal0 = normalOf(P0), normal = xf ? normalOf(P) : normal0;
    // orientação: sólidos apontam para fora; folhas apontam para cima
    let flip = false;
    const pm = P0(.31, .57), nm = normal0(.31, .57);
    if (o.ref) { const r = typeof o.ref === 'function' ? o.ref(pm) : o.ref; flip = dot(nm, sub(pm, r)) < 0; }
    else if (o.up) flip = nm[1] < 0;
    if (o.flip) flip = !flip;
    const base = this.count;
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
      const u = i / nu, v = j / nv, p = P(u, v);
      let n = normal(u, v); if (flip) n = [-n[0], -n[1], -n[2]];
      const s = S(u, v, p, n);
      this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]);
      this.c.push(s[0], s[1], s[2]); this.m.push(s[3], s[4], s[5], s[6]);
    }
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const a = base + i * (nv + 1) + j, b = a + nv + 1, c = b + 1, d = a + 1;
      if (flip) this.i.push(a, b, c, a, c, d); else this.i.push(a, c, b, a, d, c);
    }
  }

  // Sólido de revolução com contorno e relevo orgânicos.
  revolve(prof, o) {
    const { nu = 96, nv = 48, R = () => 1, disp = null, shade, xf, wrapV = false, detail = 1 } = o;
    const P = (u, v) => {
      const a = u * TAU, [r0, y0] = prof.at(v), s = R(a);
      let r = r0 * s, y = y0;
      if (disp) { const d = disp(a, r, y, v); r += d[0]; y += d[1]; }
      return [Math.cos(a) * r, y, Math.sin(a) * r];
    };
    this.grid(nu * detail, nv * detail, P, (u, v, p, n) => shade(u, v, p, n, prof.at(v)), { xf, wrapV, ref: o.ref || (p => [0, p[1], 0]) });
  }

  // Chapa com espessura (queijo, bacon): face superior, inferior e laterais.
  slab(nu, nv, Ptop, t, shade, o = {}) {
    const xf = o.xf, ref = o.ref || (() => [0, 0, 0]);
    this.grid(nu, nv, Ptop, (u, v, p, n) => shade(u, v, p, n, 0), { wrapU: false, up: true, xf });
    this.grid(nu, nv, (u, v) => { const p = Ptop(u, v); return [p[0], p[1] - t, p[2]]; }, (u, v, p, n) => shade(u, v, p, n, 1), { wrapU: false, up: true, flip: true, xf });
    const edge = (n, f) => this.grid(n, 2, (s, w) => { const q = f(s), p = Ptop(q[0], q[1]); return [p[0], p[1] - t * w, p[2]]; }, (s, w, p, nn) => shade(f(s)[0], f(s)[1], p, nn, 2), { wrapU: false, ref: pt => ref(pt), xf });
    edge(nu, s => [s, 0]); edge(nu, s => [s, 1]); edge(nv, s => [0, s]); edge(nv, s => [1, s]);
  }

  // Tubo de seção elíptica ao longo de um arco horizontal (anéis de cebola).
  ringTube(o) {
    const { R, y = 0, rw, rh, a0 = 0, a1 = TAU, seed = 1, wob = .04, shade, xf, nu = 72, nv = 14 } = o;
    const full = Math.abs(a1 - a0 - TAU) < 1e-6;
    const P = (u, v) => {
      const t = a0 + u * (a1 - a0), ph = v * TAU;
      const Rr = R * (1 + wob * (noise3(Math.cos(t) * 1.7, Math.sin(t) * 1.7, seed) - .5) * 2);
      const taper = full ? 1 : Math.sqrt(Math.max(Math.sin(Math.PI * u), 0)) ** .5;
      const w = rw * taper * (1 + .22 * (noise3(t * 3, ph, seed + 3) - .5)), h = rh * taper;
      const rad = Rr + Math.cos(ph) * w;
      return [Math.cos(t) * rad, y + Math.sin(ph) * h, Math.sin(t) * rad];
    };
    this.grid(nu, nv, P, shade, { wrapU: full, wrapV: true, xf, ref: p => { const t = Math.atan2(p[2], p[0]); return [Math.cos(t) * R, y, Math.sin(t) * R]; } });
  }

  finish() {
    const positions = new Float32Array(this.p);
    let minX = 1e9, minY = 1e9, minZ = 1e9, maxX = -1e9, maxY = -1e9, maxZ = -1e9;
    for (let i = 0; i < positions.length; i += 3) {
      minX = Math.min(minX, positions[i]); maxX = Math.max(maxX, positions[i]);
      minY = Math.min(minY, positions[i + 1]); maxY = Math.max(maxY, positions[i + 1]);
      minZ = Math.min(minZ, positions[i + 2]); maxZ = Math.max(maxZ, positions[i + 2]);
    }
    return {
      positions, normals: new Float32Array(this.n), colors: new Float32Array(this.c), materials: new Float32Array(this.m),
      indices: new Uint32Array(this.i), box: this.p.length ? [minX, minY, minZ, maxX, maxY, maxZ] : [0, 0, 0, 0, 0, 0]
    };
  }
}

// Vetor de material por vértice: [r,g,b, rugosidade, translucidez, relevo (bump), oclusão]
export const MAT = (c, rough = .6, sss = 0, bump = 0, ao = 1) => [c[0], c[1], c[2], rough, sss, bump, ao];

// Amostragem de pontos com distância mínima (dardos). Estável para uma mesma semente.
export function poissonDisc(radius, minDist, seed, tries = 30) {
  const rnd = randomFor(seed), pts = [];
  for (let k = 0; k < 4000; k++) {
    let ok = false;
    for (let t = 0; t < tries && !ok; t++) {
      const a = rnd() * TAU, r = Math.sqrt(rnd()) * radius, x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (pts.every(q => Math.hypot(q[0] - x, q[1] - z) >= minDist)) { pts.push([x, z]); ok = true; }
    }
    if (!ok) break;
  }
  return pts;
}
