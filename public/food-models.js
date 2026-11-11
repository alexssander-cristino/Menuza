// Menuza — modelos 3D procedurais de alimentos.
// Cada ingrediente é uma "peça" (part) independente, com chave de cache própria: ao adicionar ou
// remover um ingrediente só as peças afetadas são reconstruídas; as demais apenas mudam de altura.
import {
  TAU, clamp, lerp, sstep, hash, randomFor, lin, mix, mul, noise3, fbm, rigid, onSurface, norm, cross, sub,
  profile, smoothPoly, superPuck, loopProfile, Mesh, MAT, poissonDisc
} from './food-geo.js';

// Biblioteca de malhas 3D dos alimentos.
// Cada função abaixo constrói a geometria de uma peça (pão, queijo, carne, molho etc.).
// A composição final é montada conforme o tipo de produto e os ingredientes escolhidos;
// mantenha as funções de geometria independentes para permitir cache e reconstrução parcial.
const C = {
  bunCrown: lin('#b9783f'), bunSide: lin('#c88a50'), bunCrumb: lin('#e8d2ad'), bunToast: lin('#a96835'), bunDeep: lin('#754321'), bunUnder: lin('#ad7446'),
  seed: lin('#f1e2ba'),
  patty: lin('#4b2b1e'), pattySear: lin('#24130e'), pattySide: lin('#68402c'), pattyFat: lin('#8b5b3a'),
  cheddar: lin('#e99622'), cheddarLight: lin('#f3b73e'), cheddarDeep: lin('#d98310'),
  lettuceA: lin('#b6cd6c'), lettuceB: lin('#6fa536'), lettuceC: lin('#3a7821'), lettuceVein: lin('#e3edaa'),
  tomSkin: lin('#c42d1c'), tomWall: lin('#e97d5f'), tomJelly: lin('#d2392a'), tomCore: lin('#f3a892'),
  pickleSkin: lin('#58792a'), pickleFlesh: lin('#a4bb55'),
  onionBrown: lin('#8c4e1d'), onionGold: lin('#c88a3a'), onionPurple: lin('#8b3a74'), onionPale: lin('#e7cfe0'),
  baconLean: lin('#8e2c19'), baconFat: lin('#f0cb9c'), baconCrisp: lin('#5a1b0d'),
  eggWhite: lin('#fbf5e6'), eggCrisp: lin('#d9aa5c'), yolkA: lin('#f6ac1c'), yolkB: lin('#e08a0b'),
  sauce: lin('#eab283'), sauceDeep: lin('#d98f57'),
  doughRim: lin('#d99a4e'), doughBrown: lin('#985329'), doughChar: lin('#57301e'), doughPale: lin('#c9955e'), doughCream: lin('#ead4ad'),
  tomSauce: lin('#b2301c'), tomSauceDeep: lin('#7f2013'),
  // Mussarela em tom marfim dourado: distingue-se de catupiry, creme e outros ingredientes brancos.
  mozz: lin('#e8d9b8'), mozzGold: lin('#d9bd8c'), mozzBrown: lin('#b58b58'),
  pep: lin('#b8412a'), pepDeep: lin('#8c2a18'), pepChar: lin('#5a190d'), pepFat: lin('#e49e80'),
  mush: lin('#eadfc6'), mushSkin: lin('#a68656'),
  olive: lin('#2b2723'), oliveIn: lin('#66753a'),
  corn: lin('#f2b72a'), chicken: lin('#e1c08f'), chickenBrown: lin('#a97a42'),
  cream: lin('#f8f1df'), herb: lin('#506027'), herbLight: lin('#7d923b'), basil: lin('#2f7b3f'), basilLight: lin('#75ad58'),
  ceramic: lin('#f1ede3'), ceramicLine: lin('#a9b6bb'),
  potato: lin('#eebf68'), potatoSkin: lin('#a8662a'), potatoDark: lin('#7a4519'), rosemary: lin('#4f6a2e'), aioli: lin('#f4e9ca'),
    wood: lin('#4a2f1d'),
  // pizza brasileira
  pizzaWoodA: lin('#c79a63'), pizzaWoodB: lin('#e3bf8a'),
  ham: lin('#eaa3a3'), hamDeep: lin('#c9737a'),
  oliveGreen: lin('#8a9a3a'), oliveGreenDeep: lin('#5f6f26'), pimento: lin('#c8321e'),
  pepperGreen: lin('#4f8a2e'), pepperRed: lin('#cf3a22'), pepperYellow: lin('#e8b422'),
  calabLean: lin('#a63a22'), calabCasing: lin('#5e1f10'), oilOrange: lin('#e2923a'),
  catupiry: lin('#fbf4e2')

};
const nz = (p, f, s, o = 2) => fbm(p[0] * f, p[1] * f, p[2] * f, s, o);

// ===================== HAMBÚRGUER =====================
function bunBottomMesh(R, H, seed, detail) {
  const m = new Mesh(), prof = superPuck(R * .97, H, 2.6, 56, .05), ph = (seed % 97) / 97 * TAU;
  m.revolve(prof, {
    nu: 104, nv: 44, detail,
    R: a => 1 + .028 * (noise3(Math.cos(a) * 1.4, Math.sin(a) * 1.4, seed) - .5) * 2 + .016 * Math.cos(a - ph),
    disp: (a, r, y) => { const d = (fbm(Math.cos(a) * r * 55, y * 55, Math.sin(a) * r * 55, seed, 3) - .5) * .0026; return [d * .6, d]; },
    shade: (u, v, p, n, [r, y]) => {
      const tv = 1 + (nz(p, 70, seed + 5) - .5) * .18, rn = r / (R * .97);
      if (n[1] > .5 && y > H * .5) {
        // miolo tostado com poros
        const pore = sstep(.6, .78, nz(p, 120, seed + 21));
        const toast = mix(C.bunToast, C.bunCrumb, .3 * (1 - rn) + .1 + pore * .12), patch = sstep(.55, .7, nz(p, 38, seed + 9));
        return MAT(mul(mix(toast, C.bunDeep, patch * .62), tv), .86, .06, 1.25, .88);
      }
      if (n[1] < -.5) return MAT(mul(C.bunUnder, tv), .72, .05, .6, .7);
      return MAT(mul(mix(C.bunCrumb, C.bunSide, sstep(0, .5, y / H)), tv), .68, .12, .9, y < H * .22 ? .72 : 1);
    }
  });
  return m.finish();
}

function bunTopMesh(R, H, seed, detail) {
  const m = new Mesh(), ph = (seed % 89) / 89 * TAU, pts = [];
  for (let i = 0; i <= 10; i++) { const s = i / 10; pts.push([s * R * .97, .03 * H * (1 - s * s)]); }
  const N = 46, nExp = 2.15;
  for (let i = 1; i <= N; i++) {
    const th = (Math.PI / 2) * i / N;
    pts.push([i === N ? 0 : R * Math.cos(th) ** (2 / nExp) * (1 + .04 * Math.sin(2 * th)), H * Math.sin(th) ** (2 / nExp)]);
  }
  const prof = profile(pts);
  const Rf = a => 1 + .026 * (noise3(Math.cos(a) * 1.3, Math.sin(a) * 1.3, seed + 4) - .5) * 2 + .02 * Math.cos(a - ph);
  const dispf = (a, r, y) => { const x = Math.cos(a) * r, z = Math.sin(a) * r, d = (fbm(x * 40, y * 40, z * 40, seed, 3) - .5) * .0042 * clamp(y / H + .1, 0, 1); return [d * .5, d]; };
  const surf = (a, v) => { const [r0, y0] = prof.at(v); const r = r0 * Rf(a); const d = dispf(a, r, y0); return [Math.cos(a) * (r + d[0]), y0 + d[1], Math.sin(a) * (r + d[0])]; };
  m.revolve(prof, {
    nu: 144, nv: 72, detail, R: Rf, disp: dispf,
    shade: (u, v, p, n, [r, y]) => {
      const tv = 1 + (nz(p, 60, seed + 5) - .5) * .14, hy = y / H;
      if (hy < .1 && n[1] < -.25) return MAT(mul(mix(C.bunToast, C.bunCrumb, .35), tv), .8, .1, 1, .75);
      // brilho de ovo: faixas suaves radiais sobre o degradê da casca
      const streak = .5 + .5 * Math.sin(Math.atan2(p[2], p[0]) * 6 + hy * 8 + seed);
      const glaze = mix(mix(C.bunSide, C.bunCrown, sstep(.05, .85, hy)), C.bunToast, streak * .07), blotch = sstep(.62, .78, nz(p, 28, seed + 11));
      return MAT(mul(mix(glaze, C.bunDeep, blotch * .42), tv), .56, .10, .78, hy < .18 ? .8 : 1);
    }
  });
  // sementes de gergelim: pequenos elipsoides pousados sobre a cúpula
  const rnd = randomFor(seed + 31), placed = [], target = Math.round(54 * (R / .06) ** 2), minD = .0105 * (R / .06);
  for (let t = 0; t < 1200 && placed.length < target; t++) {
    const a = rnd() * TAU, v = lerp(.5, .985, Math.sqrt(rnd())), p = surf(a, v), e = .004 / TAU;
    const nrm = norm(cross(sub(surf(a, Math.min(1, v + .004)), surf(a, Math.max(0, v - .004))), sub(surf(a + e, v), surf(a - e, v))));
    const n = nrm[1] < 0 ? [-nrm[0], -nrm[1], -nrm[2]] : nrm;
    if (n[1] < .5 || placed.some(q => Math.hypot(q[0] - p[0], q[2] - p[2]) < minD)) continue;
    placed.push(p);
    const ax = .0017 * (R / .06), ay = .00062 * (R / .06), az = .00092 * (R / .06);
    m.grid(8, 6, (u, w) => { const th = w * Math.PI, ph2 = u * TAU, s = Math.sin(th); return [ax * s * Math.cos(ph2) * (1 + .22 * Math.cos(th * .5)), ay * Math.cos(th), az * s * Math.sin(ph2)]; },
      () => MAT(mul(C.seed, .92 + rnd() * .16), .46, .15, .25, 1), { xf: onSurface([p[0], p[1] - .0003, p[2]], n, rnd() * TAU), ref: () => [0, 0, 0] });
  }
  return m.finish();
}

function pattyMesh(R, H, seed, detail) {
  const m = new Mesh(), prof = superPuck(R, H, 4.2, 56, .035), ph = (seed % 71) / 71 * TAU, dir = .7 + (seed % 5) * .05;
  m.revolve(prof, {
    nu: 112, nv: 48, detail,
    R: a => 1 + .05 * (fbm(Math.cos(a) * 2.2 + 3, Math.sin(a) * 2.2, seed, 2) - .5) * 2 + .018 * Math.sin(a * 11 + ph) + .01 * Math.sin(a * 23 + ph * 2),
    disp: (a, r, y) => {
      const x = Math.cos(a) * r, z = Math.sin(a) * r, d = (fbm(x * 120, y * 80, z * 120, seed, 3) - .5) * H * .18;
      return [d * .8, y > H * .5 ? d : d * .3];
    },
    shade: (u, v, p, n, [r, y]) => {
      const rn = r / R, tv = 1 + (nz(p, 90, seed + 3) - .5) * .16;
      if (n[1] > .5 && y > H * .5) {
        // Selagem irregular e localizada, sem listras repetidas de grelha.
        const searField = fbm(p[0] * 30, p[2] * 54, seed + 17, 3);
        const mark = sstep(.48, .72, searField) * sstep(.12, .48, nz(p, 36, seed + 13));
        const sear = sstep(.55, .78, fbm(p[0] * 46, p[2] * 70, seed + 19, 2));
        const base = mix(C.patty, C.pattyFat, sstep(.58, .78, nz(p, 55, seed + 7)) * .28);
        const cooked = mix(base, C.pattySear, clamp(mark * .78 + sear * .48, 0, .92));
        return MAT(mul(cooked, tv), .62, .06, .9, lerp(1, .88, sstep(.7, 1, rn)));
      }
      if (n[1] < -.5) return MAT(mul(C.patty, .8 * tv), .7, .05, 1, .6);
      return MAT(mul(mix(C.pattySide, C.pattyFat, sstep(.6, .78, nz(p, 70, seed + 2)) * .5), tv), .55, .08, 1.3, y < H * .25 ? .7 : .95);
    }
  });
  return m.finish();
}

function cheeseMesh(Rp, Hp, seed, detail, yaw = 0, style = 'cheddar') {
  const m = new Mesh(), t = .0026, S = Rp * 1.0;
  const fold = (x, z) => {
    const d = Math.hypot(x, z), a = Math.atan2(z, x), over = Math.max(0, d - Rp * .86);
    // cai mais nas pontas, como queijo derretido
    const drop = Math.min(Hp * 1.15, (over / (Rp * .26)) ** 1.6 * Hp * .5);
    const ripple = sstep(.9, 1.2, d / Rp) * .0017 * Math.sin(a * 9 + seed) * (.6 + noise3(x * 70, z * 70, seed));
    return (1 - sstep(0, .9, d / Rp)) * .0006 - drop + ripple;
  };
  const Ptop = (u, v) => {
    let x = (u - .5) * 2 * S, z = (v - .5) * 2 * S;
    const d = Math.hypot(x, z) || 1e-9, k = 1 / (1 + (d / (1.2 * Rp)) ** 6) ** (1 / 6);
    x *= k; z *= k;
    x += (noise3(z * 90, 0, seed) - .5) * .0016; z += (noise3(x * 90, 5, seed) - .5) * .0016;
    return [x, fold(x, z), z];
  };
  const sh = (u, v, p, n, part) => {
    const d = Math.hypot(p[0], p[2]) / Rp, low = sstep(-.0015, -.009, p[1]), tv = 1 + (nz(p, 60, seed + 1) - .5) * .12;
    const palettes = {
      cheddar: [C.cheddar, C.cheddarLight, C.cheddarDeep],
      mozzarella: [lin('#dfc99b'), lin('#f0dfb8'), lin('#b99a68')],
      parmesan: [lin('#d9c58f'), lin('#f4e4b7'), lin('#bba16b')],
      gorgonzola: [lin('#e8dfc9'), lin('#f5eddc'), lin('#aeb69a')],
      provolone: [lin('#ead9a8'), lin('#fff0c9'), lin('#c9b77f')],
      generic: [lin('#eadfc7'), lin('#f7efdF'), lin('#cdbf9f')]
    };
    const [base, light, deep] = palettes[style] || palettes.cheddar;
    const color = mix(mix(base, light, sstep(.2, .6, nz(p, 25, seed + 4)) * .5), deep, low * .5 + (part === 2 ? .25 : 0));
    return MAT(mul(color, tv), .43, .42, .52, part === 1 ? .6 : lerp(1, .88, sstep(.8, 1.1, d)));
  };
  m.slab(44, 44, Ptop, t, sh, { xf: rigid({ yaw }), ref: () => [0, 0, 0] });
  return m.finish();
}
function lettuceMesh(R, kH, seed, detail, leaves) {
  const m = new Mesh(), rnd = randomFor(seed);
  for (let i = 0; i < leaves; i++) {
    const s2 = seed * 7 + i * 131, ph = rnd() * TAU, k1 = 9 + (s2 % 4), Rl = R * (1.04 - .045 * i);
    const edge = a => 1 + .07 * Math.sin(a * 3 + ph) + .045 * Math.sin(a * 7 + ph * 2) + .07 * (noise3(Math.cos(a) * 2 + i, Math.sin(a) * 2, s2) - .5);
    const P = (u, v) => {
      const a = u * TAU, rr = v * Rl * edge(a);
      // folha mais crespa: ondulação extra concentrada na borda
      const wave = Math.sin(a * k1 + ph * 2) * .55 + Math.sin(a * (k1 + 6) + ph * 3) * .3
        + Math.sin(a * (k1 + 13) + ph * 5) * .18 * sstep(.6, 1, v)
        + (noise3(Math.cos(a) * 3 * v + 1, Math.sin(a) * 3 * v, s2) - .5) * 1.2;
      const y = v ** 1.6 * .0058 * kH * wave - .0058 * kH * sstep(.7, 1, v) ** 2 + .0014 * (1 - v) * kH;
      return [Math.cos(a) * rr, y, Math.sin(a) * rr];
    };
    m.grid(seg(120, detail, 24), seg(26, detail, 8), P, (u, v, p) => {      
      const a = u * TAU, crest = .5 + .5 * Math.sin(a * k1 + ph * 2), vein = Math.abs(Math.cos(a * 7 + ph)) ** 24 * sstep(.1, .9, v);
      let c = mix(mix(C.lettuceA, C.lettuceB, sstep(.08, .55, v)), C.lettuceC, sstep(.55, 1, v));
      c = mix(c, C.lettuceVein, vein * .3 + crest * .14);
      c = mix(c, C.lettuceA, sstep(.93, 1, v) * .35); // borda mais clara
      return MAT(c, .70, .82, .82, .6 + .4 * crest);
    }, { up: true, xf: rigid({ yaw: rnd() * TAU, pitch: (rnd() - .5) * .07, roll: (rnd() - .5) * .07, t: [(rnd() - .5) * .006, i * .0026 * kH, (rnd() - .5) * .006] }) });
  }
  return m.finish();
}

function tomatoSliceInto(m, { R, t, seed, xf, detail = 1, cup = 0 }) {
  const prof = superPuck(1, t, 6, 36, .04), ch = 3 + (seed % 2), ph = (seed % 41) / 41 * TAU;
  m.revolve(prof, {
    nu: 96, nv: 16, detail, xf,
    R: a => R * (1 + .03 * (noise3(Math.cos(a) * 1.5, Math.sin(a) * 1.5, seed) - .5) * 2),
    disp: (a, r, y) => [0, cup * (r / R) ** 3 + (fbm(Math.cos(a) * r * 90, y * 50, Math.sin(a) * r * 90, seed, 2) - .5) * t * .1],
    shade: (u, v, p, n, [rn, y]) => {
      const a = u * TAU;
      if (Math.abs(n[1]) > .45) {
        const wedge = .5 + .5 * Math.cos(a * ch + ph), chamber = sstep(.12, .4, wedge) * sstep(.86, .72, rn) * sstep(.12, .2, rn);
        let c = mix(C.tomWall, C.tomJelly, chamber); c = mix(c, C.tomCore, sstep(.17, .08, rn) * .8); c = mix(c, C.tomSkin, sstep(.84, .95, rn));
        // sementes no gel
        const seedSpeck = sstep(.78, .86, noise3(p[0] * 420, p[2] * 420, seed + 3)) * chamber;
        c = mix(c, lin('#f4e2a0'), seedSpeck * .85);
        return MAT(c, lerp(.34, .22, chamber), .52, .38, lerp(1, .85, sstep(.8, 1, rn)));
      }
      return MAT(C.tomSkin, .30, .42, .32, .85);
    }
  });
}
function tomatoMesh(R, kH, seed, detail, layers) {
  const m = new Mesh(), rnd = randomFor(seed), Rs = R * .52, t = .0072 * kH;
  for (let l = 0; l < layers; l++) {
    const off = l % 2 ? [0, 1] : [1, 0];
    for (const sgn of [-1, 1]) {
      const x = off[0] * sgn * Rs * .72 + (rnd() - .5) * .004, z = off[1] * sgn * Rs * .72 + (rnd() - .5) * .004;
      tomatoSliceInto(m, { R: Rs * (.96 + rnd() * .08), t, seed: seed + l * 7 + (sgn > 0 ? 3 : 0), detail, xf: rigid({ yaw: rnd() * TAU, pitch: (rnd() - .5) * .05, t: [x, l * t * .98, z] }) });
    }
  }
  return m.finish();
}

function pickleMesh(R, kH, seed, detail, layers) {
  const m = new Mesh(), rnd = randomFor(seed), Rs = .0165 * (R / .06), t = .0032 * kH;
  for (let l = 0; l < layers; l++) {
    const n = 4, off = l * .8;
    for (let i = 0; i < n; i++) {
      const a = off + i * TAU / n + (rnd() - .5) * .3, rr = R * .45, ph = rnd() * TAU, sd = seed + i + l * 9;
      m.revolve(superPuck(1, t, 5, 24), {
        nu: 64, nv: 10, detail, xf: rigid({ yaw: rnd() * TAU, pitch: (rnd() - .5) * .08, t: [Math.cos(a) * rr, l * t, Math.sin(a) * rr] }),
        R: ang => Rs * (1 + .045 * Math.sin(ang * 17 + ph) + .02 * (noise3(Math.cos(ang), Math.sin(ang), sd) - .5)),
        shade: (u, v, p, n2, [rn]) => {
          // pele rugosa, miolo claro e anel de sementes
          const bump = sstep(.62, .8, noise3(p[0] * 320, p[2] * 320, sd));
          const ring = sstep(.1, 0, Math.abs(rn - .42) - .06);
          let c = mix(C.pickleFlesh, lin('#c5d681'), sstep(.3, 0, rn) * .6);
          c = mix(c, lin('#e6edb0'), ring * .7);
          c = mix(c, C.pickleSkin, sstep(.8, .96, rn));
          c = mix(c, C.pickleSkin, Math.abs(n2[1]) < .4 ? 1 : 0);
          return MAT(mul(c, 1 - bump * .1), .28, .6, .3, .9);
        }
      });
    }
  }
  return m.finish();
}

function onionMesh(R, kH, seed, detail, layers) {
  const m = new Mesh(), rnd = randomFor(seed);
  for (let l = 0; l < layers; l++) for (const f of [.24, .46, .68]) {
    m.ringTube({
      R: R * f, y: .0022 * kH + l * .0042 * kH, rw: .0042 * kH, rh: .0025 * kH, seed: seed + l * 5 + Math.round(f * 10), wob: .05, nu: seg(72, detail, 24), nv: 14,
      xf: rigid({ yaw: rnd() * TAU, t: [(rnd() - .5) * .006, 0, (rnd() - .5) * .006] }),
      shade: (u, v, p) => MAT(mul(mix(mix(C.onionGold, C.onionPale, .25), C.onionBrown, sstep(.4, .75, nz(p, 45, seed)) * .8), .95 + rnd() * .1), .3, .55, .35, .9)
    });
  }
  return m.finish();
}

function baconStripInto(m, { L, W, t, seed, xf, curl = .003, detail = 1 }) {
  const ph = (seed % 31) / 31 * TAU;
  const P = (u, v) => {
    const x = (u - .5) * L, zw = (v - .5) * W, wave = Math.sin(u * Math.PI * 3 + ph) * .0042 + Math.sin(u * Math.PI * 7 + ph * 2) * .0009;
    return [x + Math.sin(v * 3 + ph) * .0005, Math.sin(u * Math.PI * 2.2 + ph) * .0022 + (Math.abs(v - .5) * 2) ** 2 * curl, zw + wave];
  };
 m.slab(seg(40, detail, 8), 10, P, t, (u, v, p, n, part) => {
    const band = .5 + .5 * Math.sin(v * Math.PI * 4 + ph + (u - .5) * 2) + (noise3(u * 9, v * 9, 0, seed) - .5) * .35;
    const fat = sstep(.5, .7, band), edge = sstep(.08, 0, Math.min(u, 1 - u)) * .8;
    let c = mix(C.baconLean, C.baconFat, fat); c = mix(c, C.baconCrisp, edge + (part === 1 ? .4 : 0));
    return MAT(c, .52, .28, .92, part === 1 ? .6 : 1);
  }, { xf, ref: () => [0, 0, 0] });
}
function baconMesh(R, kH, seed, detail, q) {
  const m = new Mesh(), rnd = randomFor(seed), n = 2 * q;
  for (let i = 0; i < n; i++) {
    const a = (i % 2 ? .9 : -.9) + (rnd() - .5) * .5 + Math.floor(i / 2) * .3;
    baconStripInto(m, { L: R * 1.62, W: .0138 * (R / .06), t: .0024, seed: seed + i * 5, detail, curl: .003, xf: rigid({ yaw: a, t: [(rnd() - .5) * R * .25, .0016 * kH + Math.floor(i / 2) * .0026 * kH + (i % 2) * .0014, (rnd() - .5) * R * .25] }) });
  }
  return m.finish();
}

function eggMesh(R, kH, seed, detail, count = 1) {
  const m = new Mesh(), Re = R * .62, ph = (seed % 37) / 37 * TAU, n = clamp(Number(count) || 1, 1, 10);
  const Rw = a => 1 + .28 * (fbm(Math.cos(a) * 1.6 + 2, Math.sin(a) * 1.6, seed, 2) - .5) * 2 + .06 * Math.sin(a * 3 + ph);
  for (let k = 0; k < n; k++) {
    const dy = k * .0085 * kH, jx = k ? Math.sin(k * 2.1 + seed) * R * .05 : 0, jz = k ? Math.cos(k * 1.7 + seed) * R * .05 : 0;
    m.revolve(superPuck(Re, .0042 * kH, 3, 40), {
      nu: 96, nv: 28, detail, R: Rw, xf: rigid({ yaw: k * 1.3, t: [jx, dy, jz] }),
      shade: (u, v, p, nn, [r]) => MAT(mix(C.eggWhite, C.eggCrisp, sstep(.88, 1, r / Re) * .8), .17, .35, .1, lerp(1, .85, sstep(.85, 1, r / Re)))
    });
    const Ry = Re * .33, Hy = .0092 * kH, pts = [[0, .002 * kH], [Ry * .96, .002 * kH]];
    for (let i = 1; i <= 28; i++) { const th = (Math.PI / 2) * i / 28; pts.push([i === 28 ? 0 : Ry * Math.cos(th), .002 * kH + Hy * Math.sin(th) ** 1.05]); }
    m.revolve(profile(pts), {
      nu: 48, nv: 36, detail, xf: rigid({ t: [Re * .12 + jx, .0012 * kH + dy, Re * .08 + jz] }),
      shade: (u, v, p, nn, [r, y]) => MAT(mix(C.yolkB, C.yolkA, sstep(.2, 1, y / (Hy + .002 * kH))), .1, .5, 0, 1)
    });
  }
  return m.finish();
}

function sauceMesh(R, kH, seed, detail) {
  const m = new Mesh(), ph = (seed % 29) / 29 * TAU, t = .0032 * kH;
  m.revolve(superPuck(R, t, 3, 32), {
    nu: 80, nv: 20, detail,
    R: a => 1 + .16 * Math.sin(a * 5 + ph) + .09 * Math.sin(a * 9 + ph * 2) + .1 * (noise3(Math.cos(a) * 2, Math.sin(a) * 2, seed) - .5),
    disp: (a, r, y) => [0, (fbm(Math.cos(a) * r * 120, 0, Math.sin(a) * r * 120, seed, 2) - .5) * .0009 * (y / t)],
    shade: (u, v, p, n, [r, y]) => MAT(mix(C.sauce, C.sauceDeep, sstep(.4, .85, nz(p, 50, seed))), .14, .45, .12, 1)
  });
  return m.finish();
}

// ===================== TÁBUA / PRATO (apresentação) =====================
function boardMesh(R, T, seed, detail) {
  const m = new Mesh();
  m.revolve(superPuck(R, T, 7, 40, 0), {
    nu: 120, nv: 20, detail, R: a => 1 + .006 * Math.sin(a * 3 + seed),
    shade: (u, v, p, n) => {
      // veio da madeira
      const grain = .5 + .5 * Math.sin(p[0] * 150 + nz(p, 7, seed) * 9 + nz(p, 40, seed + 3) * 2);
      const c = mix(C.wood, lin('#6b4528'), grain * .55);
      return MAT(mul(c, 1 + (nz(p, 60, seed + 1) - .5) * .14), .5, 0, .6, n[1] > .5 ? 1 : .8);
    }
  });
  return m.finish();
}

// ===================== PIZZA =====================
const CRUSTS = {
  tradicional: { rho: .0105, k: 1, deck: .0058 },
  fina: { rho: .0066, k: .82, deck: .0036 },
  recheada: { rho: .0138, k: 1, deck: .0066, stuffed: true }
};
const TOPPINGS = {
  'queijo-generico': { r: .010, cover: [.08, .14, .2], kind: 'cheese-generic' },
  catupiry: { r: .0095, cover: [.10, .17, .24], kind: 'catupiry' },
  'queijo-cheddar': { r: .010, cover: [.08, .14, .2], kind: 'cheddar-drizzle' },
  'queijo-parmesao': { r: .008, cover: [.1, .18, .26], kind: 'cheese-parmesan' },
  'queijo-gorgonzola': { r: .0085, cover: [.08, .14, .2], kind: 'cheese-gorgonzola' },
  'queijo-provolone': { r: .010, cover: [.08, .14, .2], kind: 'cheese-provolone' },
  calabresa: { r: .0185, cover: [.30, .50, .70], kind: 'pep' },
  presunto: { r: .0125, cover: [.14, .24, .34], kind: 'ham' },
  ovo: { r: .011, cover: [.05, .09, .13], kind: 'quail' },
  tomate: { r: .016, cover: [.16, .28, .4], kind: 'tom' },
  champignon: { r: .0165, cover: [.14, .24, .34], kind: 'mush' },
  frango: { r: .0095, cover: [.12, .2, .3], kind: 'chicken' },
  bacon: { r: .0085, cover: [.07, .12, .17], kind: 'bacon' },
  cebola: { r: .011, cover: [.08, .14, .2], kind: 'onion' },
  pimentao: { r: .0105, cover: [.07, .12, .17], kind: 'pepper' },
  azeitona: { r: .0085, cover: [.05, .09, .13], kind: 'olive' },
  requeijao: { r: .0105, cover: [.10, .17, .24], kind: 'catupiry' },
  milho: { r: .0034, cover: [.04, .07, .1], kind: 'corn', loose: true },
  oregano: { r: .0038, cover: [.06, .10, .15], kind: 'herb', loose: true },
  'canela-em-po': { r: .0048, cover: [.07, .11, .16], kind: 'powder', loose: true },
  manjericao: { r: .018, cover: [.10, .18, .26], kind: 'basil' },
  abacaxi: { r: .012, cover: [.12, .2, .3], kind: 'pineapple' },
  banana: { r: .012, cover: [.1, .18, .26], kind: 'banana' },
  morango: { r: .012, cover: [.1, .18, .26], kind: 'strawberry' },
  alho: { r: .006, cover: [.05, .09, .14], kind: 'garlic', loose: true },
  brocolis: { r: .012, cover: [.1, .18, .26], kind: 'greens' },
  ervilha: { r: .0034, cover: [.04, .07, .1], kind: 'peas', loose: true },
  'batata-palha': { r: .006, cover: [.08, .14, .2], kind: 'crisps', loose: true },
  chocolate: { r: .011, cover: [.1, .18, .26], kind: 'chocolate' },
  coco: { r: .006, cover: [.08, .14, .2], kind: 'coconut', loose: true },
  atum: { r: .0095, cover: [.12, .2, .3], kind: 'tuna' },
  palmito: { r: .0115, cover: [.10, .18, .26], kind: 'palm' },
  salsicha: { r: .011, cover: [.12, .2, .3], kind: 'sausage' },
  barbecue: { r: .011, cover: [.08, .14, .2], kind: 'barbecue', loose: true },
  mayonnaise: { r: .011, cover: [.08, .14, .2], kind: 'mayonnaise', loose: true },
  mustard: { r: .010, cover: [.08, .14, .2], kind: 'mustard', loose: true },
  'hot-sauce': { r: .010, cover: [.08, .14, .2], kind: 'hot-sauce', loose: true },
  cream: { r: .011, cover: [.08, .14, .2], kind: 'cream', loose: true },
  'white-chocolate': { r: .010, cover: [.1, .18, .26], kind: 'white-chocolate' },
  sprinkles: { r: .004, cover: [.12, .2, .3], kind: 'sprinkles', loose: true },
  peanut: { r: .006, cover: [.1, .18, .26], kind: 'peanut', loose: true }
};
const TOPPING_ORDER = Object.keys(TOPPINGS);
const angDiff = (a, b) => Math.abs(((a - b + Math.PI * 3) % TAU) - Math.PI);

const ctxCache = new Map();
function pizzaCtx(Rp, crustKey, hasSauce, hasCheese, seed) {
  const key = [Rp, crustKey, hasSauce, hasCheese, seed].join('|');
  if (ctxCache.has(key)) return ctxCache.get(key);
  const cr = CRUSTS[crustKey] || CRUSTS.tradicional, { rho, deck } = cr, ph = (seed % 83) / 83 * TAU;
  const Rin = Rp - 2.55 * rho, Rt = Rin * .9, cuts = 8;
  const cutGroove = (x, z) => {
    const r = Math.hypot(x, z), a = Math.atan2(z, x); let g = 0;
    for (let k = 0; k < cuts; k++) { const da = angDiff(a, ph + k * TAU / cuts); if (da < .5) g = Math.max(g, Math.exp(-(((r * Math.sin(da)) / .0011) ** 2))); }
    return g;
  };
  const sauceR = a => Rin * (1.02 + .012 * Math.sin(a * 5 + ph));
  // A mussarela cobre praticamente toda a área do molho, deixando só uma faixa
  // irregular de molho visível junto à borda — não um grande anel sem queijo.
  // Camada de mussarela acompanha praticamente todo o disco de molho.
    // A mussarela para um pouco antes do molho, de forma irregular: sobra um fio
  // vermelho na beirada, como numa pizza de verdade.
  const cheeseR = a => sauceR(a) * (.972 + .014 * Math.sin(a * 7 + ph * 1.7) + .008 * Math.sin(a * 13 + ph));
  const edgeF = rn => Math.sqrt(Math.max(0, 1 - clamp(rn, 0, 1) ** 7));
  const sauceH = (x, z) => (.0017 + .0004 * (fbm(x * 60, z * 60, seed + 1, 2) - .5) * 2) * 1;
  const cheeseH = (x, z) => {
    const b = fbm(x * 70, z * 70, seed + 3, 3), bub = sstep(.55, .75, fbm(x * 130, z * 130, seed + 8, 2));
    return Math.max(.0008, .0034 * (.78 + .5 * b) + .0011 * bub - .0012 * cutGroove(x, z));
  };
  const surf = (x, z) => {
    const r = Math.hypot(x, z), a = Math.atan2(z, x);
    let y = deck;
    if (hasSauce) y += sauceH(x, z) * edgeF(r / sauceR(a)) - (cutGroove(x, z) * .0007);
    if (hasCheese) { const rn = r / cheeseR(a); if (rn < 1) y += cheeseH(x, z) * edgeF(rn); }
    return y;
  };
  const ctx = { Rp, Rin, Rt, rho, deck, cr, ph, seed, sauceR, cheeseR, edgeF, sauceH, cheeseH, cutGroove, surf };
  ctxCache.set(key, ctx); if (ctxCache.size > 24) ctxCache.delete(ctxCache.keys().next().value);
  return ctx;
}

function doughMesh(ctx, detail) {
  const { Rp, rho, deck, cr, seed, ph } = ctx, k = cr.k, yc = rho * k, pts = [];
  for (let i = 0; i <= 12; i++) pts.push([(Rp - rho) * i / 12, 0]);
  for (let i = 1; i <= 30; i++) { const psi = -Math.PI / 2 + (Math.PI * 1.5) * i / 30; pts.push([Rp - rho + rho * Math.cos(psi), yc + rho * k * Math.sin(psi)]); }
  for (let i = 1; i <= 8; i++) { const s = i / 8; pts.push([Rp - 2 * rho - rho * .75 * (1 - Math.cos(s * Math.PI / 2)), deck + (yc - deck) * Math.cos(s * Math.PI / 2)]); }
  const rStart = Rp - 2.75 * rho;
  for (let i = 1; i <= 14; i++) pts.push([rStart * (1 - i / 14), deck]);
  pts[pts.length - 1][0] = 0;
  const prof = profile(smoothPoly(pts, 2)), m = new Mesh();
  m.revolve(prof, {
    nu: 200, nv: 120, detail,
    R: a => 1 + .018 * (noise3(Math.cos(a) * 1.2 + 4, Math.sin(a) * 1.2, seed) - .5) * 2 + .008 * Math.sin(a * 5 + ph),
    disp: (a, r, y) => {
      const x = Math.cos(a) * r, z = Math.sin(a) * r, rim = sstep(rStart - .002, rStart + .004, r);
      const bl = sstep(.70, .88, noise3(x * 38, z * 38, seed + 9)), small = (fbm(x * 118, z * 118, seed + 2, 2) - .5) * .0022;
      const notch = rim * ctx.cutGroove(x, z) * .0012;
      const deckWave = (1 - rim) * (fbm(x * 40, z * 40, seed + 5, 2) - .5) * .0012;
      return [rim * (fbm(x * 72, z * 72, seed + 6, 2) - .5) * .0010, rim * (small + bl * .0018) - notch + deckWave];
    },
    shade: (u, v, p, n, [r, y]) => {
      const x = p[0], z = p[2], rim = sstep(rStart - .003, rStart + .003, r), tv = 1 + (nz(p, 80, seed + 3) - .5) * .12;
      const blister = sstep(.42, .70, noise3(x * 34, z * 34, seed + 9)), char = sstep(.72, .88, noise3(x * 72, z * 72, seed + 12));
      if (n[1] > .25 && rim > 0) {
        let c = mix(C.doughRim, C.doughBrown, clamp(blister * .88 + sstep(.38, .68, nz(p, 22, seed + 14)) * .30, 0, .92));
        c = mix(c, C.doughChar, char * blister * .48);
        c = mix(c, lin('#e6ad5b'), sstep(.58, .82, nz(p, 24, seed + 18)) * (1 - char) * .14);
        // topo da borda mais dourado (pincelada de azeite) e brilhante
        c = mix(c, lin('#e8bd80'), sstep(.55, 1, n[1]) * .18);
        // borda recheada: queijo escapando em manchas claras e cremosas
        if (cr.stuffed) c = mix(c, lin('#f6e7b8'), sstep(.7, .84, noise3(x * 28, z * 28, seed + 20)) * .8);
        // farinha na borda
        const flour = sstep(.8, .9, noise3(x * 220, z * 220, seed + 30)) * rim;
        c = mix(c, C.doughCream, flour * .35);
        return MAT(mul(c, tv), cr.stuffed ? .6 : .68, .1, 1.2, 1);
      }
      if (n[1] < -.4) return MAT(mul(C.doughPale, .92 * tv), .8, .05, .8, .75);
      return MAT(mul(mix(C.doughPale, C.doughRim, rim * .65), tv), .78, .08, 1, y < .003 ? .75 : (rim ? .95 : .85));
    }
  });
  return m.finish();
}

function veneerMesh(R, hFn, shade, nu, nv, up = true) {
  const m = new Mesh();
  m.grid(nu, nv, (u, v) => {
    const a = u * TAU, rr = v * R(a), x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    return [x, hFn(x, z, v), z];
  }, shade, { up });
  return m.finish();
}
function sauceMeshPizza(ctx, detail) {
  const { sauceR, sauceH, edgeF, deck, seed, cutGroove } = ctx;
  return veneerMesh(sauceR, (x, z, v) => deck - .0004 + (sauceH(x, z) * edgeF(v) - cutGroove(x, z) * .0007), (u, v, p) => {
    const swirl = .5 + .5 * Math.sin(Math.atan2(p[2], p[0]) * 3 + Math.hypot(p[0], p[2]) * 120 + ctx.seed);
    const c = mix(C.tomSauce, C.tomSauceDeep, swirl * .35 + sstep(.55, .8, nz(p, 50, ctx.seed + 2)) * .3);
    return MAT(mul(c, 1 + (nz(p, 90, ctx.seed + 4) - .5) * .16), .46, .28, .42, 1);
  }, Math.round(160 * detail), Math.round(32 * detail));
}
function cheeseMeshPizza(ctx, detail) {
  const { cheeseR, cheeseH, edgeF, seed, cutGroove } = ctx;
  const bubbles = (x, z) => sstep(.6, .8, fbm(x * 150, z * 150, seed + 41, 2)) * .0007;
  return veneerMesh(cheeseR, (x, z, v) => {
    // Camada contínua acima do molho, com bolhas de queijo derretido e sulcos nos cortes.
    const sauce = ctx.sauceTop(x, z);
    return sauce + .0022 + cheeseH(x, z) * (.35 + .65 * edgeF(v)) + bubbles(x, z) * edgeF(v) - cutGroove(x, z) * .0006;
  }, (u, v, p) => {
    const x = p[0], z = p[2];
    const grain = (nz(p, 92, seed + 1) - .5) * .035;
    // Mussarela cremosa: marfim quente, pequenas bolhas e pontos dourados discretos.
    // Evita o branco puro e o aspecto plástico mesmo sob iluminação forte.
    // Queijo de forno: base marfim, com gratinado localizado em manchas suaves.
    // O tostado ocupa apenas pequenas ilhas, sem transformar a cobertura em crosta marrom.
    const toastNoise = fbm(x * 27, z * 27, seed + 51, 3);
    const toast = sstep(.48, .72, toastNoise) * (.78 + .20 * sstep(.15, .9, v));
    const browned = sstep(.60, .82, fbm(x * 58, z * 58, seed + 53, 2)) * toast;
    const freckles = sstep(.72, .88, fbm(x * 108, z * 108, seed + 59, 2)) * browned;
    const bub = sstep(.66, .82, fbm(x * 112, z * 112, seed + 41, 2));
    let c = mix(C.mozz, C.mozzGold, clamp(.16 + grain + sstep(.82, .99, v) * .08, 0, .30));
    c = mix(c, lin('#ead8b4'), bub * .12);
    c = mix(c, lin('#c58a43'), toast * .68);
    c = mix(c, lin('#874a29'), browned * .58);
    c = mix(c, lin('#54301d'), freckles * .42);
    c = mix(c, C.mozzBrown, cutGroove(x, z) * .18);
    return MAT(mul(c, 1 + grain), .48 + toast * .04, .18, .52, 1);
  }, Math.round(200 * detail), Math.round(52 * detail));
}

function chocolateMeshPizza(ctx, detail, style = 'chocolate') {
  // Todos os chocolates são uma única cobertura cremosa contínua.
  // Quando há chocolate ao leite e branco juntos, a mistura fica sutil e homogênea:
  // nenhum sabor vira pedaço grande ou camada isolada que roube a cena.
  const radius = ctx.sector ? (angle => {
    const span = ((angle - ctx.sector.start) % TAU + TAU) % TAU;
    const width = ((ctx.sector.end - ctx.sector.start) % TAU + TAU) % TAU;
    return span <= width ? ctx.sauceR(angle) : 0;
  }) : ctx.sauceR;
  const mixed = style === 'mixed';
  const white = style === 'white-chocolate';
  const base = mixed ? lin('#76503a') : white ? lin('#d9c29c') : lin('#563126');
  const deep = mixed ? lin('#4b2c22') : white ? lin('#b99b70') : lin('#321b15');
  const accent = mixed ? lin('#c9ad86') : base;
  return veneerMesh(radius, (x, z, v) => {
    const edge = ctx.edgeF(v);
    return ctx.surf(x, z) + .0025 + .0011 * edge
      + (fbm(x * 105, z * 105, ctx.seed + (white ? 31 : 29), 3) - .5) * .00028;
  }, (u, v, p) => {
    const swirl = .5 + .5 * Math.sin(Math.atan2(p[2], p[0]) * 2.1 + Math.hypot(p[0], p[2]) * 78 + ctx.seed);
    const grain = (nz(p, 112, ctx.seed + 33) - .5) * .045;
    let c = mix(base, deep, clamp(.16 + swirl * .13 + grain, 0, .32));
    if (mixed) {
      const marbling = fbm(p[0] * 68, p[2] * 68, ctx.seed + 37, 2);
      c = mix(c, accent, sstep(.61, .82, marbling) * .18);
    }
    return MAT(c, .42, .30, .42, 1);
  }, Math.round(200 * detail), Math.round(52 * detail));
}

// ---- coberturas ----
function pepperoniInto(m, x, y, z, R, seed, rnd, detail) {
  // Calabresa fatiada: fatia fina, bordas levemente enroladas, tripa escura e pintas de gordura.
  const t = .0022, pts = [[0, 0], [R * .95, 0], [R, t * .3], [R, t * .8]];
  for (let i = 0; i <= 14; i++) { const s = 1 - i / 14; pts.push([R * s * .985, t + .0011 * s ** 3 - .0003 * (1 - s * s)]); }
  pts[pts.length - 1][0] = 0;
  const ph = rnd() * TAU, sd = seed, cup = .0007 + rnd() * .0006;
  m.revolve(profile(smoothPoly(pts, 1)), {
    nu: 64, nv: 16, detail, R: a => 1 + .035 * Math.sin(a * 4 + ph) + .02 * Math.sin(a * 9 + ph * 2),
    disp: (a, r) => [0, cup * (r / R) ** 3],
    xf: rigid({ yaw: rnd() * TAU, pitch: (rnd() - .5) * .14, roll: (rnd() - .5) * .14, t: [x, y - .0007, z] }),
    shade: (u, v, p, n, [r]) => {
      const rn = r / R;
      const fat = sstep(.74, .8, noise3(p[0] * 430 + sd, p[1] * 430, p[2] * 430, 4));
      const spice = sstep(.8, .86, noise3(p[0] * 600 + sd * 2, p[1] * 600, p[2] * 600, 7));
      let c = mix(C.calabLean, C.pepDeep, nz(p, 80, sd) * .6);
      c = mix(c, C.pepFat, fat * .75);
      c = mix(c, C.pepChar, spice * .5);
      c = mix(c, C.oilOrange, sstep(.3, .7, nz(p, 45, sd + 3)) * .12);
      c = mix(c, C.calabCasing, sstep(.88, .97, rn) * .9);
      if (n[1] < .3) c = mul(C.pepDeep, .85);
      return MAT(c, lerp(.3, .16, fat), .35, .55, lerp(1, .8, sstep(.75, 1, rn)));
    }
  });
}
function tomatoSlicePizza(m, x, y, z, R, seed, rnd, detail) {
  tomatoSliceInto(m, { R, t: .0028, seed, detail, cup: .0008, xf: rigid({ yaw: rnd() * TAU, pitch: (rnd() - .5) * .1, roll: (rnd() - .5) * .1, t: [x, y - .0006, z] }) });
}
function mushroomInto(m, x, y, z, RM, seed, rnd, detail) {
  const rho = a => {
    const c = Math.cos(a), s = Math.sin(a), A = c * c + s * s / .5184, B = -2 * .18 * s / .5184, Cc = .0324 / .5184 - 1;
    const te = (-B + Math.sqrt(Math.max(B * B - 4 * A * Cc, 0))) / (2 * A);
    const tx = Math.abs(c) < 1e-6 ? 1e9 : .3 / Math.abs(c), ty = s > 0 ? .2 / Math.max(s, 1e-6) : .8 / Math.max(-s, 1e-6);
    return Math.max(te, Math.min(tx, ty));
  };
  m.revolve(superPuck(1, .0026, 3.4, 20, 0), {
    nu: 72, nv: 12, detail, R: a => RM * rho(a),
    xf: rigid({ yaw: rnd() * TAU, pitch: (rnd() - .5) * .1, roll: (rnd() - .5) * .1, t: [x, y - .0006, z] }),
    shade: (u, v, p, n, [rn]) => {
      const a = u * TAU, cap = Math.sin(a) > -.2 ? 1 : 0;
      // lamelas radiais perto do centro
      const gill = (.5 + .5 * Math.sin(a * 34)) * sstep(.75, .2, rn) * .22;
      const base = mix(mul(C.mush, 1 + (nz(p, 120, seed) - .5) * .12), lin('#cdbd9b'), gill);
      return MAT(mix(base, C.mushSkin, sstep(.86, .99, rn) * cap * .9), .42, .3, .3, lerp(1, .85, sstep(.8, 1, rn)));
    }
  });
}
function oliveInto(m, x, y, z, R, seed, rnd, detail) {
  // Azeitona inteira: verde com pimentão (mais comum no Brasil) ou preta.
  const green = rnd() < .65, yaw = rnd() * TAU, rx = R * .74, ry = R * .62, rz = R * .6;
  blobInto(m, {
    rx, ry, rz, seed, amp: .05, nu: 20, nv: 14,
    xf: rigid({ yaw, pitch: (rnd() - .5) * .1, roll: (rnd() - .5) * .2, t: [x, y + ry * .55, z] }),
    shade: (u, v, p) => MAT(green ? mix(C.oliveGreen, C.oliveGreenDeep, nz(p, 90, seed) * .7) : mix(C.olive, lin('#3a2d38'), nz(p, 80, seed)), .14, .55, .25, 1)
  });
  if (green) blobInto(m, {
    rx: R * .2, ry: R * .1, rz: R * .2, seed: seed + 1, amp: .05, nu: 10, nv: 8,
    xf: rigid({ yaw, t: [x, y + ry * 1.2, z] }),
    shade: () => MAT(C.pimento, .3, .4, .2, 1)
  });
}
function onionInto(m, x, y, z, R, seed, rnd, detail) {
  const rings = 2, yaw0 = rnd() * TAU;
  for (let i = 0; i < rings; i++) {
    const rr = R * (1.2 - i * .38), len = TAU * (.62 + rnd() * .38);
    m.ringTube({
      R: rr, y: 0, rw: .0019, rh: .0012, a0: 0, a1: len, seed: seed + i, wob: .06, nu: 40, nv: 8,
      xf: rigid({ yaw: yaw0 + rnd() * .8, pitch: (rnd() - .5) * .1, t: [x, y - .0003 + i * .0007, z] }),
      shade: (u, v, p) => {
        const toast = sstep(.55, .78, nz(p, 70, seed + i));
        return MAT(mix(mix(lin('#f7eedb'), lin('#fffaf0'), .4), C.onionGold, toast * .65), .3, .65, .25, .95);
      }
    });
  }
}
function blobInto(m, { rx, ry, rz, seed, amp = .12, nu = 14, nv = 10, xf, shade }) {
  m.grid(nu, nv, (u, v) => {
    const th = v * Math.PI, ph = u * TAU, s = Math.sin(th), x = s * Math.cos(ph), yy = Math.cos(th), z = s * Math.sin(ph);
    const k = 1 + amp * (noise3(x * 1.8 + seed, yy * 1.8, z * 1.8, seed) - .5) * 2;
    return [x * rx * k, yy * ry * k, z * rz * k];
  }, shade, { xf, ref: () => [0, 0, 0] });
}
function cornInto(m, x, y, z, R, seed, rnd) {
  blobInto(m, { rx: R, ry: R * .75, rz: R * .8, seed, amp: .06, nu: 9, nv: 7, xf: rigid({ yaw: rnd() * TAU, pitch: (rnd() - .5) * .5, roll: (rnd() - .5) * .5, t: [x, y + R * .2, z] }), shade: (u, v, p) => MAT(mul(C.corn, .88 + (nz(p, 95, seed + 3) - .5) * .20), .38, .32, .48, 1) });
}
function chickenInto(m, x, y, z, R, seed, rnd) {
  // Frango desfiado: fiapos longos e finos cruzados.
  for (let i = 0; i < 4; i++) {
    blobInto(m, {
      rx: R * (.95 + rnd() * .6), ry: R * (.18 + rnd() * .05), rz: R * (.19 + rnd() * .10), seed: seed + i, amp: .3, nu: 12, nv: 8,
      xf: rigid({ yaw: rnd() * TAU, pitch: (rnd() - .5) * .35, roll: (rnd() - .5) * .35, t: [x + (rnd() - .5) * R * 1.1, y + R * .14 + i * R * .06, z + (rnd() - .5) * R * 1.1] }),
      shade: (u, v, p) => {
        const fiber = nz(p, 185, seed + i * 17), sear = sstep(.68, .88, nz(p, 34, seed + i * 23));
        let color = mix(C.chicken, lin('#f1dcb4'), .12 + fiber * .22);
        color = mix(color, C.chickenBrown, sstep(.57, .78, fiber) * .34 + sear * .22);
        return MAT(color, .66, .30, 1.05, .92);
      }
    });
  }
}
function creamInto(m, x, y, z, R, seed, rnd, detail) {
  const ph = rnd() * TAU;
  m.revolve(superPuck(R, R * .5, 2.4, 24), {
    nu: 32, nv: 12, detail, R: a => 1 + .12 * Math.sin(a * 3 + ph) + .06 * Math.sin(a * 6 + ph), xf: rigid({ t: [x, y - .0008, z] }),
    shade: (u, v, p) => MAT(mul(C.cream, .96 + (nz(p, 80, seed + 2) - .5) * .08), .34, .48, .3, 1)
  });
}

function catupiryInto(m, x, y, z, R, seed, rnd, detail) {
  // Colherada cremosa de catupiry/requeijão com pontinha no topo.
  const ph = rnd() * TAU, N = 16, H = R * .62, y0 = .0002, pts = [[0, y0], [R * .97, y0]];
  for (let i = 1; i <= N; i++) { const th = (Math.PI / 2) * i / N; pts.push([i === N ? 0 : R * Math.cos(th) ** .9, y0 + H * Math.sin(th) ** .8]); }
  m.revolve(profile(pts), {
    nu: 36, nv: 20, detail, R: a => 1 + .1 * Math.sin(a * 3 + ph) + .05 * Math.sin(a * 5 + ph * 2),
    xf: rigid({ yaw: rnd() * TAU, t: [x, y - .0004, z] }),
    shade: (u, v, p, n, [r, yy]) => {
      const sw = .5 + .5 * Math.sin(Math.atan2(p[2], p[0]) * 3 + yy * 900);
      return MAT(mix(C.catupiry, lin('#efe2c0'), sw * .25 + (1 - yy / (H + y0)) * .1), .32, .52, .32, 1);
    }
  });
}
function hamInto(m, x, y, z, R, seed, rnd) {
  // Presunto fatiado, dobrado em duas camadas.
  for (let i = 0; i < 2; i++) {
    blobInto(m, {
      rx: R * (1.05 - i * .15), ry: .0017, rz: R * (.9 - i * .1), seed: seed + i, amp: .34, nu: 14, nv: 10,
      xf: rigid({ yaw: rnd() * TAU, pitch: (rnd() - .5) * .25, roll: (rnd() - .5) * .25, t: [x + (rnd() - .5) * R * .3, y + .0008 + i * .0012, z + (rnd() - .5) * R * .3] }),
      shade: (u, v, p) => MAT(mix(C.ham, C.hamDeep, sstep(.45, .8, nz(p, 60, seed + i)) * .55), .34, .4, .3, .95)
    });
  }
}
function quailEggInto(m, x, y, z, R, seed, rnd) {
  // Metade de ovo de codorna: clara com gema.
  const yaw = rnd() * TAU, tilt = [(rnd() - .5) * .12, (rnd() - .5) * .12];
  blobInto(m, {
    rx: R * .82, ry: R * .28, rz: R * .58, seed, amp: .05, nu: 18, nv: 12,
    xf: rigid({ yaw, pitch: tilt[0], roll: tilt[1], t: [x, y + .0008, z] }),
    shade: () => MAT(C.eggWhite, .2, .4, .1, 1)
  });
  blobInto(m, {
    rx: R * .42, ry: R * .3, rz: R * .4, seed: seed + 1, amp: .04, nu: 14, nv: 10,
    xf: rigid({ yaw, pitch: tilt[0], roll: tilt[1], t: [x, y + .0016, z] }),
    shade: () => MAT(mix(C.yolkB, C.yolkA, .4), .1, .5, 0, 1)
  });
}
function pepperRingInto(m, x, y, z, R, seed, rnd) {
  // Anel de pimentão (verde, vermelho ou amarelo), como na pizza portuguesa.
  const col = [C.pepperGreen, C.pepperRed, C.pepperYellow][Math.floor(rnd() * 3)];
  m.ringTube({
    R: R * .8, y: 0, rw: .0023, rh: .0015, a0: 0, a1: TAU * .92, seed, wob: .07, nu: 36, nv: 8,
    xf: rigid({ yaw: rnd() * TAU, pitch: (rnd() - .5) * .1, t: [x, y - .0003, z] }),
    shade: (u, v, p) => MAT(mix(col, lin('#ffffff'), .08 * (.5 + .5 * Math.sin(v * TAU))), .22, .6, .2, .95)
  });
}
function palmInto(m, x, y, z, R, seed, rnd, detail) {
  // Rodela de palmito.
  m.revolve(superPuck(R * .5, .0046, 3, 20), {
    nu: 40, nv: 10, detail,
    xf: rigid({ yaw: rnd() * TAU, pitch: (rnd() - .5) * .35, roll: (rnd() - .5) * .35, t: [x, y + .0003, z] }),
    shade: (u, v, p, n, [r]) => MAT(mix(lin('#f1e4bf'), lin('#d9c795'), sstep(.5, .95, r / (R * .5)) * .5), .34, .4, .3, 1)
  });
}
function baconBitInto(m, x, y, z, seed, rnd, detail) {
  baconStripInto(m, { L: .0185, W: .0075, t: .0022, seed, detail: .6, curl: .0016, xf: rigid({ yaw: rnd() * TAU, pitch: (rnd() - .5) * .1, t: [x, y + .0003, z] }) });
}
function toppingBlob(m, x, y, z, rx, ry, rz, color, seed, rnd) {
  blobInto(m, { rx, ry, rz, seed, amp: .16, nu: 12, nv: 8,
    xf: rigid({ yaw: rnd() * TAU, pitch: (rnd() - .5) * .18, roll: (rnd() - .5) * .18, t: [x, y + ry * .25, z] }),
    shade: (u, v, p) => MAT(mix(color, lin('#fff0d0'), nz(p, 70, seed) * .12), .48, .24, .48, .95)
  });
}
function garlicInto(m, x, y, z, R, seed, rnd) {
  toppingBlob(m, x, y, z, R * .9, .0022, R * .58, lin('#f1e5c9'), seed, rnd);
}
function fruitInto(m, kind, x, y, z, R, seed, rnd) {
  if (kind === 'pineapple') toppingBlob(m, x, y, z, R * 1.25, .0032, R * .72, lin('#e9b83e'), seed, rnd);
  else if (kind === 'banana') toppingBlob(m, x, y, z, R * 1.35, .0026, R * .55, lin('#f4d36c'), seed, rnd);
  else if (kind === 'strawberry') toppingBlob(m, x, y, z, R * .82, .0034, R * .72, lin('#d94343'), seed, rnd);
  else if (kind === 'coconut') toppingBlob(m, x, y, z, R * .9, .0015, R * .45, lin('#fff1d9'), seed, rnd);
  else toppingBlob(m, x, y, z, R, .0025, R * .65, lin('#ead7b4'), seed, rnd);
}
function herbInto(m, x, y, z, rnd) {
  const L = .0048 + rnd() * .0018, W = .0021 + rnd() * .0009, yaw = rnd() * TAU, curl = .0008 + rnd() * .0008, c = mix(C.herb, C.herbLight, rnd());
  m.grid(5, 3, (u, v) => [(u - .5) * L, curl * (2 * u - 1) ** 2, (v - .5) * W * Math.sin(Math.PI * u) ** .6], () => MAT(c, .5, .5, .2, 1), { wrapU: false, up: true, xf: rigid({ yaw, pitch: (rnd() - .5) * .5, t: [x, y + .0006, z] }) });
}
function basilInto(m, x, y, z, seed, rnd) {
  // Folha de manjericão comum de folha larga: proporção de referência 6,5 x 2,8 cm.
  // As folhas ficam acima do queijo/molho para não desaparecerem dentro da cobertura.
  const branchYaw = rnd() * TAU;
  const leafAngles = [-.52, 0, .52];
  for (let leaf = 0; leaf < leafAngles.length; leaf++) {
    const length = .065, width = .028;
    const yaw = branchYaw + leafAngles[leaf] + (rnd() - .5) * .08;
    const tint = rnd(), offset = (leaf - 1) * .009;
    const pitch = (rnd() - .5) * .12, roll = (rnd() - .5) * .10;
    const leafX = x + Math.cos(branchYaw + Math.PI / 2) * offset;
    const leafZ = z + Math.sin(branchYaw + Math.PI / 2) * offset;
    const leafY = y + .0034 + leaf * .00035;
    const surface = (u, v) => {
      const taper = Math.sin(Math.PI * u) ** .72;
      const across = (v - .5) * width * taper;
      const arch = Math.sin(Math.PI * u) * (.0038 + .0014 * (1 - Math.abs(v - .5) * 2));
      const edgeWave = Math.sin(u * Math.PI * 5 + seed * .13) * .00038 * Math.abs(v - .5) * 2;
      return [(u - .5) * length, arch + edgeWave, across];
    };
    const leafColor = mix(C.basil, C.basilLight, clamp(.16 + tint * .24, 0, 1));
    const xf = rigid({ yaw, pitch, roll, t: [leafX, leafY, leafZ] });
    m.grid(26, 13, surface, (u, v) => {
      const edge = Math.abs(v - .5) * 2;
      const highlight = .10 + .13 * Math.sin(u * Math.PI) + .07 * (1 - edge);
      return MAT(mix(leafColor, C.basilLight, highlight), .42, .42, .18, 1);
    }, { wrapU: false, up: true, xf });

    // Nervura central mais legível, sem virar uma faixa grossa.
    m.grid(22, 2, (u, v) => {
      const p = surface(u, v);
      return [p[0], p[1] + .00048, (v - .5) * .00135 * Math.sin(Math.PI * u)];
    }, () => MAT(mix(C.basilLight, lin('#b2cb79'), .34), .5, .28, .12, 1), {
      wrapU: false, up: true, xf
    });
  }
  // Pecíolo elevado junto à base do pequeno ramo.
  m.grid(10, 3, (u, v) => [
    (u - .5) * .018,
    .00055 + Math.sin(u * Math.PI) * .00045,
    (v - .5) * .0015
  ], () => MAT(C.basil, .5, .3, .1, 1), {
    wrapU: false, up: true,
    xf: rigid({ yaw: branchYaw, t: [x, y + .0031, z] })
  });
}
function cheesePieceInto(m, style, x, y, z, R, seed, rnd, detail) {
  if (style === 'cheese-parmesan') {
    for (let i = 0; i < 4; i++) {
      const L = R * (1.1 + rnd() * .5), W = R * (.24 + rnd() * .18), H = .0007 + rnd() * .00045;
      m.grid(5, 3, (u, v) => [(u - .5) * L, Math.sin(u * Math.PI) * H + Math.sin(v * Math.PI) * H * .3, (v - .5) * W], () => MAT(mix(lin('#e8d6a0'), lin('#fff0c7'), rnd() * .45), .5, .18, .25, .9), { wrapU: false, up: true, xf: rigid({ yaw: rnd() * TAU, pitch: (rnd() - .5) * .2, roll: (rnd() - .5) * .2, t: [x + (rnd() - .5) * R, y + i * .00035, z + (rnd() - .5) * R] }) });
    }
    return;
  }
  if (style === 'cheese-gorgonzola') {
    for (let i = 0; i < 5; i++) {
      const tint = rnd();
      blobInto(m, { rx: R * (.45 + rnd() * .35), ry: .0012 + rnd() * .0009, rz: R * (.38 + rnd() * .3), seed: seed + i, amp: .32, nu: 10, nv: 7, xf: rigid({ yaw: rnd() * TAU, t: [x + (rnd() - .5) * R, y + i * .00015, z + (rnd() - .5) * R] }), shade: (u, v, p) => MAT(mix(lin('#eee4c9'), lin('#71866a'), sstep(.76, .96, nz(p, 90, seed + i)) * (.35 + tint * .4)), .42, .22, .2, .9) });
    }
    return;
  }
  const isCheddar = style === 'cheese-cheddar';
  const isProvolone = style === 'cheese-provolone';
  const count = isCheddar ? 3 : 4;
  for (let i = 0; i < count; i++) {
    const rr = R * (.34 + rnd() * .18), h = isCheddar ? .0022 : .0015;
    const color = isCheddar ? lin('#e9a52d') : style === 'cheese-generic' ? lin('#f0dfb6') : lin('#f4e7c8');
    m.revolve(superPuck(rr, h, isProvolone ? 2.2 : 3.4, 18), { nu: 28, nv: 10, detail: Math.min(detail, .8), xf: rigid({ yaw: rnd() * TAU, pitch: (rnd() - .5) * .18, roll: (rnd() - .5) * .18, t: [x + (rnd() - .5) * R, y + i * .00022, z + (rnd() - .5) * R] }), shade: (u, v, p) => MAT(mix(color, lin('#fff0ce'), nz(p, 55, seed + i) * .18), .32, .35, .2, .95) });
  }
}
function pizzaDrizzleInto(m, ctx, kind, seed, detail) {
  const cheddar = kind === 'cheddar-drizzle';
  const base = cheddar ? lin('#e9a12b') : lin('#f5ead2');
  const light = cheddar ? lin('#ffc04a') : lin('#fff8e9');
  const lanes = cheddar ? 10 : 9;
  const radius = ctx.Rt * .965;
  const width = ctx.Rt * (cheddar ? .052 : .058);
  const thickness = cheddar ? .0019 : .0021;
  const phase = (seed % 101) * .071;
  for (let lane = 0; lane < lanes; lane++) {
    const offset = (lane / (lanes - 1) - .5) * radius * 1.48;
    m.grid(Math.round(100 * detail), 10, (u, v) => {
      const x = (u - .5) * radius * 2;
      const edge = Math.sqrt(Math.max(0, radius * radius - x * x));
      const wave = Math.sin(u * TAU * 2.15 + phase + lane * .38) * width * .8;
      const across = (v - .5) * width * .72;
      const z = clamp(offset + wave + across, -edge * .96, edge * .96);
      const crown = Math.sqrt(Math.max(0, 1 - ((v - .5) * 2) ** 2));
      return [x, ctx.surf(x, z) + thickness * crown + .00018, z];
    }, (u, v, p) => MAT(mix(base, light, .2 + .12 * Math.sin(u * Math.PI * 3 + lane) + (nz(p, 82, seed + lane) - .5) * .10), .34, cheddar ? .30 : .42, .28, 1), { wrapU: false, up: true });
  }
}

const siteCache = new Map();
function toppingMesh(ctx, id, qtyIdx, earlier, detail) {
  const def = TOPPINGS[id], m = new Mesh(), rnd = randomFor(hash(id + ctx.seed + qtyIdx)), A = Math.PI * ctx.Rt * ctx.Rt, sectorRatio = ctx.sector ? Math.min(1, Math.max(0, ((ctx.sector.end - ctx.sector.start + TAU) % TAU) / TAU)) : 1;
  if (!def) return m.finish();
  if (def.kind === 'cheddar-drizzle' || def.kind === 'catupiry-drizzle') {
    pizzaDrizzleInto(m, ctx, def.kind, hash(id + ctx.seed + qtyIdx), detail);
    return m.finish();
  }
  const count = Math.max(1, Math.round(def.cover[qtyIdx] * A * sectorRatio / (Math.PI * def.r * def.r)));
  // posições já ocupadas por toppings de maior prioridade (com cache: o resultado depende só da sequência anterior)
  const placed = [];
  let sig = ctx.Rt.toFixed(4) + '|' + ctx.seed + '|' + (ctx.sector ? `${ctx.sector.start.toFixed(5)}:${ctx.sector.end.toFixed(5)}|` : 'whole|');
  for (const e of earlier) {
    const d2 = TOPPINGS[e.id]; if (d2.loose) continue;
    sig += e.id + e.qtyIdx + ',';
    const c2 = Math.max(1, Math.round(d2.cover[e.qtyIdx] * A * sectorRatio / (Math.PI * d2.r * d2.r)));
    let got = siteCache.get(sig);
    if (!got) {
      got = pickSites(ctx, e.id, e.qtyIdx, c2, placed, d2.r);
      siteCache.set(sig, got);
      if (siteCache.size > 200) siteCache.delete(siteCache.keys().next().value);
    }
    placed.push(...got);
  }
  const sites = def.loose ? looseSites(ctx, id, count) : pickSites(ctx, id, qtyIdx, count, placed, def.r);
  sites.forEach((s, i) => {
    const y = ctx.surf(s.x, s.z), r = def.r * (def.kind === 'herb' ? 1 : .92 + rnd() * .16), sd = hash(id) + i * 13;
    switch (def.kind) {
      case 'pep': pepperoniInto(m, s.x, y, s.z, r, sd, rnd, detail); break;
      case 'tom': tomatoSlicePizza(m, s.x, y, s.z, r, sd, rnd, detail); break;
      case 'mush': mushroomInto(m, s.x, y, s.z, r, sd, rnd, detail); break;
      case 'olive': oliveInto(m, s.x, y, s.z, r, sd, rnd, detail); break;
      case 'onion': onionInto(m, s.x, y, s.z, r, sd, rnd, detail); break;
      case 'corn': cornInto(m, s.x, y, s.z, r, sd, rnd); break;
      case 'chicken': chickenInto(m, s.x, y, s.z, r, sd, rnd); break;
      case 'cream': creamInto(m, s.x, y, s.z, r, sd, rnd, detail); break;
      case 'bacon': baconBitInto(m, s.x, y, s.z, sd, rnd, detail); break;
      case 'herb': herbInto(m, s.x, y, s.z, rnd); break;
      case 'powder': {
        // Canela em pó: partículas minúsculas, achatadas e distribuídas; nunca folhas ou grumos.
        const powderColors = ['#9a6037', '#ad7547', '#81502f', '#bd8958'];
        for (let n = 0; n < 5; n++) {
          const px = s.x + (rnd() - .5) * r * 1.25;
          const pz = s.z + (rnd() - .5) * r * 1.25;
          toppingBlob(m, px, ctx.surf(px, pz), pz, r * (.16 + rnd() * .12), .00022 + rnd() * .00012, r * (.14 + rnd() * .10), lin(powderColors[(sd + n) % powderColors.length]), sd + n, rnd);
        }
        break;
      }
      case 'basil': basilInto(m, s.x, y, s.z, sd, rnd); break;
      case 'pineapple': case 'banana': case 'strawberry': case 'coconut': fruitInto(m, def.kind, s.x, y, s.z, r, sd, rnd); break;
      case 'garlic': garlicInto(m, s.x, y, s.z, r, sd, rnd); break;
      case 'greens': toppingBlob(m, s.x, y, s.z, r * 1.2, .0025, r, lin('#43833d'), sd, rnd); break;
      case 'peas': for (let n = 0; n < 4; n++) toppingBlob(m, s.x + (rnd()-.5)*r, y, s.z + (rnd()-.5)*r, r*.42, r*.34, r*.42, lin('#7b9b3d'), sd+n, rnd); break;
      case 'crisps': for (let n = 0; n < 3; n++) toppingBlob(m, s.x + (rnd()-.5)*r, y, s.z + (rnd()-.5)*r, r*.9, .0014, r*.22, lin('#e7b84d'), sd+n, rnd); break;
      case TOPPINGS.chocolate.kind: toppingBlob(m, s.x, y, s.z, r*1.25, .0026, r*.9, lin('#4b251c'), sd, rnd); break;
      case 'barbecue': toppingBlob(m, s.x, y, s.z, r*1.35, .0022, r*.8, lin('#71351f'), sd, rnd); break;
      case 'mayonnaise': toppingBlob(m, s.x, y, s.z, r*1.3, .002, r*.75, lin('#f2e8d2'), sd, rnd); break;
      case 'mustard': toppingBlob(m, s.x, y, s.z, r*1.25, .002, r*.7, lin('#d9a92f'), sd, rnd); break;
      case 'hot-sauce': toppingBlob(m, s.x, y, s.z, r*1.3, .002, r*.72, lin('#bd3824'), sd, rnd); break;
      case 'white-chocolate': toppingBlob(m, s.x, y, s.z, r*1.1, .0022, r*.82, lin('#f3e5c6'), sd, rnd); break;
      case 'sprinkles': {
        const colors = ['#e84b4b','#f2c84b','#55a7d8','#68a65b','#c36bb4'];
        for (let n = 0; n < 5; n++) toppingBlob(m, s.x + (rnd()-.5)*r, y, s.z + (rnd()-.5)*r, r*.45, .0012, r*.16, lin(colors[n % colors.length]), sd+n, rnd);
        break;
      }
      case 'peanut': for (let n = 0; n < 5; n++) toppingBlob(m, s.x + (rnd()-.5)*r, y, s.z + (rnd()-.5)*r, r*.34, .0014, r*.3, lin('#c99a58'), sd+n, rnd); break;
      case 'tuna': toppingBlob(m, s.x, y, s.z, r*1.15, .0026, r*.8, lin('#b9a17b'), sd, rnd); break;
      case 'palm': palmInto(m, s.x, y, s.z, r, sd, rnd, detail); break;
      case 'catupiry': catupiryInto(m, s.x, y, s.z, r, sd, rnd, detail); break;
      case 'ham': hamInto(m, s.x, y, s.z, r, sd, rnd); break;
      case 'quail': quailEggInto(m, s.x, y, s.z, r, sd, rnd); break;
      case 'pepper': pepperRingInto(m, s.x, y, s.z, r, sd, rnd); break;      case 'sausage': toppingBlob(m, s.x, y, s.z, r*1.35, .0032, r*.52, lin('#b94b32'), sd, rnd); break;
      case 'cheese-generic':
      case 'cheese-cheddar':
      case 'cheese-parmesan':
      case 'cheese-gorgonzola':
      case 'cheese-provolone':
        cheesePieceInto(m, def.kind, s.x, y + .0004, s.z, r, sd, rnd, detail); break;
    }
  });
  return m.finish();
}
const poolCache = new Map();
function poolFor(ctx) {
  const key = ctx.Rt.toFixed(4) + '|' + ctx.seed;
  if (!poolCache.has(key)) { poolCache.set(key, poissonDisc(ctx.Rt, .0125, ctx.seed + 77)); if (poolCache.size > 12) poolCache.delete(poolCache.keys().next().value); }
  return poolCache.get(key);
}
function pickSites(ctx, id, qtyIdx, count, placed, r) {
  const pool = poolFor(ctx), rnd = randomFor(hash(id + ctx.seed)), candidates = pool.slice();
  // Começa em um ponto pseudoaleatório e depois escolhe sempre a região mais vazia.
  // Assim as fatias não ficam concentradas em um único canto da pizza.
  for (let i = candidates.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [candidates[i], candidates[j]] = [candidates[j], candidates[i]]; }
  const out = [], own = [...placed];
  for (const tol of [.86, .66, .48]) {
    while (out.length < count && candidates.length) {
      let best = -1, bestScore = -Infinity;
      for (let i = 0; i < candidates.length; i++) {
        const [x, z] = candidates[i];
        if (Math.hypot(x, z) > ctx.Rt - r * .6) continue;
        if (ctx.sector) { const a = Math.atan2(z, x); const span = ((a - ctx.sector.start) % TAU + TAU) % TAU; if (span > ((ctx.sector.end - ctx.sector.start + TAU) % TAU)) continue; }
        let score = Infinity, valid = true;
        for (const q of own) {
          const distance = Math.hypot(q.x - x, q.z - z);
          if (distance < (r + (q.r || r)) * tol) { valid = false; break; }
          score = Math.min(score, distance);
        }
        if (valid && (score > bestScore || (score === bestScore && rnd() > .5))) { best = i; bestScore = score; }
      }
      if (best < 0) break;
      const [x, z] = candidates.splice(best, 1)[0];
      const site = { x, z, r }; own.push(site); out.push(site);
    }
    if (out.length >= count) break;
  }
  return out;
}
function looseSites(ctx, id, count) {
  const rnd = randomFor(hash(id + ctx.seed + 5)), out = [];
  for (let i = 0, attempts = 0; i < count && attempts < count * 12; attempts++) {
    const a = rnd() * TAU, r = Math.sqrt(rnd()) * ctx.Rt * .97;
    if (ctx.sector) { const span = ((a - ctx.sector.start) % TAU + TAU) % TAU; if (span > ((ctx.sector.end - ctx.sector.start + TAU) % TAU)) continue; }
    out.push({ x: Math.cos(a) * r, z: Math.sin(a) * r }); i++;
  }
  return out;
}

// ===================== BATATAS RÚSTICAS =====================
function plateMesh(R, seed, detail) {
  const pts = [[0, .0012], [.5 * R, .0012], [.52 * R, 0], [.62 * R, 0], [.64 * R, .0014], [.9 * R, .006], [.985 * R, .0165], [R, .0185], [R, .0195], [.93 * R, .0205], [.78 * R, .0125], [.62 * R, .0082], [.4 * R, .0072], [0, .0072]];
  const m = new Mesh();
  m.revolve(profile(smoothPoly(pts.flatMap((p, i) => i ? [[(pts[i - 1][0] + p[0]) / 2, (pts[i - 1][1] + p[1]) / 2], p] : [p]), 2)), {
    nu: 128, nv: 70, detail,
    shade: (u, v, p, n, [r, y]) => MAT(mix(C.ceramic, C.ceramicLine, Math.abs(r - .885 * R) < .0016 && n[1] > .3 ? .85 : 0), .12, .12, 0, y < .003 ? .7 : 1)
  });
  return m.finish();
}
function friesMesh(R, seed, detail, quantity = 1) {
  const m = new Mesh(), rnd = randomFor(seed), cell = .006, N = Math.ceil(R * 2 / cell), hm = new Float32Array(N * N).fill(.0072);
  const hAt = (x, z) => { const i = clamp(Math.floor((x + R) / cell), 0, N - 1), j = clamp(Math.floor((z + R) / cell), 0, N - 1); return hm[j * N + i]; };
  const count = Math.round(30 * (R / .115) ** 2 * clamp(Number(quantity) || 1, 1, 10)), cx = R * .14, cz = -R * .06;
  for (let i = 0; i < count; i++) {
    const L = .062 + rnd() * .028, r = .0072 + rnd() * .0022, yaw = rnd() * TAU, ph = rnd() * TAU, bend = (rnd() - .5) * .006;
    let gx = 0, gz = 0, ytop = 1e9, samples = [];
    for (let c = 0; c < 16; c++) {
      const ca = rnd() * TAU, cr = Math.sqrt(rnd()) * R * .62, tx = cx + Math.cos(ca) * cr, tz = cz + Math.sin(ca) * cr;
      const ss = []; let top = .0072;
      for (let k = -3; k <= 3; k++) { const sx = tx + Math.cos(yaw) * k * L / 7, sz = tz + Math.sin(yaw) * k * L / 7; ss.push([sx, sz]); top = Math.max(top, hAt(sx, sz)); }
      const score = top + Math.hypot(tx - cx, tz - cz) * .02;
      if (score < ytop) { ytop = score; gx = tx; gz = tz; samples = ss; }
    }
    ytop = Math.max(.0072, ...samples.map(([sx, sz]) => hAt(sx, sz)));
    const yc = ytop + r * .72, pitch = (rnd() - .5) * .22;
    const xf = rigid({ yaw: -yaw, pitch: 0, roll: pitch, t: [gx, yc, gz] });
    const lobe = .3;
    m.grid(40, 24, (u, v) => {
      const phi = u * TAU, taper = Math.sqrt(Math.max(0, 1 - Math.abs(2 * v - 1) ** 8)), rho = r * taper * (1 + lobe * Math.cos(3 * phi + ph));
      return [(v - .5) * L, bend * Math.sin(Math.PI * v) + rho * Math.sin(phi), rho * Math.cos(phi)];
    }, (u, v, p) => {
      const phi = u * TAU, corner = sstep(.55, .95, Math.cos(3 * phi + ph)), roast = sstep(.45, .75, fbm(p[0] * 60, p[1] * 60, p[2] * 60, seed + i, 2));
      let c = mix(C.potato, C.potatoSkin, clamp(corner * .85 + roast * .35, 0, 1)); c = mix(c, C.potatoDark, sstep(.8, 1, corner * roast));
      return MAT(c, .42, .15, .9, .9);
    }, { wrapV: false, xf, ref: p => [p[0], 0, 0] });
    for (const [sx, sz] of samples) { const ix = clamp(Math.floor((sx + R) / cell), 0, N - 1), iz = clamp(Math.floor((sz + R) / cell), 0, N - 1); for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const a = clamp(ix + dx, 0, N - 1), b = clamp(iz + dz, 0, N - 1); hm[b * N + a] = Math.max(hm[b * N + a], yc + r * .62); } }
  }
  // alecrim sobre o monte
  const topY = Math.max(...hm), sprigs = 2;
  for (let s = 0; s < sprigs; s++) {
    const a = rnd() * TAU, bx = cx + Math.cos(a) * R * .12, bz = cz + Math.sin(a) * R * .12, y0 = hAt(bx, bz) - .004, len = .055;
    for (let k = 0; k < 26; k++) {
      const t = k / 25, px = bx + Math.cos(a) * t * len, pz = bz + Math.sin(a) * t * len, py = y0 + Math.sin(t * 2.2) * .008, side = k % 2 ? 1 : -1, la = a + side * (.9 + rnd() * .4);
      m.grid(2, 2, (u, v) => [u * .0125, .0004 * Math.sin(u * 3), (v - .5) * .0012], () => MAT(mix(C.rosemary, lin('#6f8a3d'), rnd() * .6), .5, .4, .2, 1), { wrapU: false, up: true, xf: rigid({ yaw: -la, roll: .35, t: [px, py, pz] }) });
    }
  }
  return m.finish();
}
function ramekinMesh(seed, detail) {
  const m = new Mesh();
  m.revolve(profile(smoothPoly([[0, 0], [.022, 0], [.026, .0015], [.0325, .028], [.032, .0305], [.0295, .0305], [.029, .0235]], 2)), {
    nu: 64, nv: 24, detail, shade: () => MAT(C.ceramic, .16, .1, 0, 1)
  });
  m.revolve(profile([[0, .0268], [.01, .0262], [.02, .0248], [.029, .0238], [.029, .0226]]), {
    nu: 48, nv: 10, detail, shade: (u, v, p) => MAT(mix(C.aioli, lin('#fff6dc'), .3 + .3 * nz(p, 60, seed)), .18, .5, .1, 1)
  });
  return m.finish();
}

// ===================== LAYOUT =====================
const DEFAULT_BURGER = ['pao-brioche', 'carne', 'queijo-cheddar', 'alface', 'tomate-burger', 'molho-especial'];

function burgerSauceMesh(R, kH, seed, detail, color) {
  const m = new Mesh(), tint = lin(color);
  m.revolve(superPuck(R, .0028 * kH, 3, 32), {
    nu: 80, nv: 20, detail,
    R: a => 1 + .12 * Math.sin(a * 5 + seed) + .06 * Math.sin(a * 9 + seed * .7),
    shade: (u, v, p) => MAT(mul(tint, .96 + (nz(p, 74, seed + 2) - .5) * .08), .34, .42, .32, 1)
  });
  return m.finish();
}
function burgerChickenMesh(R, seed, quantity = 1) {
  const m = new Mesh(), rnd = randomFor(seed), count = clamp(Number(quantity) || 1, 1, 10);
  for (let i = 0; i < count; i++) {
    const a = i * 2.39996, rr = R * (count > 1 ? .18 : 0);
    chickenInto(m, Math.cos(a) * rr, .001 + i * .0008, Math.sin(a) * rr, R * .42, seed + i * 11, rnd);
  }
  return m.finish();
}
function burgerCalabresaMesh(R, seed, detail, quantity = 1, kH = 1) {
  const m = new Mesh(), rnd = randomFor(seed), layers = clamp(Number(quantity) || 1, 1, 10);
  for (let l = 0; l < layers; l++) for (let i = 0; i < 4; i++) {
    const a = i * TAU / 4 + l * .6 + rnd() * .25, rr = R * (.38 + rnd() * .06);
    pepperoniInto(m, Math.cos(a) * rr, .001 + l * .0042 * kH, Math.sin(a) * rr, R * .2, seed + i + l * 9, rnd, detail);
  }
  return m.finish();
}
function burgerCornMesh(R, seed, quantity = 1) {
  const m = new Mesh(), rnd = randomFor(seed), count = 7 * clamp(Number(quantity) || 1, 1, 10);
  for (let i = 0; i < count; i++) {
    const a = i * 2.39996 + rnd() * .25, rr = R * (.15 + rnd() * .55);
    cornInto(m, Math.cos(a) * rr, .001, Math.sin(a) * rr, R * .075, seed + i, rnd);
  }
  return m.finish();
}
function burgerPeasMesh(R, seed, quantity = 1) {
  const m = new Mesh(), rnd = randomFor(seed), count = 8 * clamp(Number(quantity) || 1, 1, 10);
  for (let i = 0; i < count; i++) {
    const a = i * 2.39996 + rnd() * .2, rr = R * (.12 + rnd() * .58), radius = R * .065;
    blobInto(m, { rx: radius, ry: radius * .82, rz: radius, seed: seed + i, amp: .08, nu: 10, nv: 8,
      xf: rigid({ t: [Math.cos(a) * rr, .001 + radius * .25, Math.sin(a) * rr] }),
      shade: () => MAT(mix(C.lettuceB, C.lettuceC, rnd() * .35), .3, .35, .2, 1) });
  }
  return m.finish();
}
function burgerHamMesh(R, seed, quantity = 1) {
  const m = new Mesh(), rnd = randomFor(seed), count = clamp(Number(quantity) || 1, 1, 10);
  for (let i = 0; i < count; i++) hamInto(m, (i % 2 ? 1 : -1) * R * .12, .001 + i * .0007, (i % 3 - 1) * R * .1, R * .48, seed + i * 9, rnd);
  return m.finish();
}
function burgerCustomMesh(R, seed, detail, quantity = 1) {
  const m = new Mesh(), rnd = randomFor(seed), count = clamp(Number(quantity) || 1, 1, 10);
  for (let i = 0; i < count * 5; i++) {
    const angle = i * 2.39996 + rnd() * .25, radius = Math.sqrt(rnd()) * R * .68;
    const size = R * (.055 + rnd() * .035);
    blobInto(m, {
      rx: size * 1.35, ry: size * .48, rz: size,
      seed: seed + i * 3, amp: .24, nu: seg(10, detail, 6), nv: 7,
      xf: rigid({ yaw: rnd() * TAU, pitch: (rnd() - .5) * .3, roll: (rnd() - .5) * .3,
        t: [Math.cos(angle) * radius, .001 + Math.floor(i / 5) * .0012, Math.sin(angle) * radius] }),
      shade: () => MAT(mix(lin('#a66a36'), lin('#d2a06a'), rnd() * .65), .48, .22, .12, 1)
    });
  }
  return m.finish();
}

    // Segmentos sempre inteiros: com detail < 1 (celulares) valores como 74,4 deixavam uma fenda na costura da malha.
const seg = (n, detail, min = 6) => Math.max(min, Math.round(n * detail));

// Batata palha: fios finos e dourados. (Antes era usada a malha de batata frita rústica, com alecrim e tudo.)
function strawPotatoInto(m, x, y, z, len, seed, rnd) {
  const r = .0007, arch = .0006 + rnd() * .0016, bendZ = (rnd() - .5) * len * .3, tone = rnd(), k = .92 + rnd() * .1;
  const mid = p => { const s = Math.sin(Math.PI * (p[0] / len + .5)); return [p[0], arch * s, bendZ * s]; };
  m.grid(6, 9, (u, v) => {
    const phi = u * TAU, taper = Math.sqrt(Math.max(0, 1 - Math.abs(2 * v - 1) ** 6)), s = Math.sin(Math.PI * v);
    return [(v - .5) * len, arch * s + r * taper * Math.sin(phi), bendZ * s + r * taper * Math.cos(phi)];
  }, () => MAT(mul(mix(C.potato, lin('#cf9a3f'), tone * .7), k), .42, .12, .25, .95),
  { wrapV: false, xf: rigid({ yaw: rnd() * TAU, roll: (rnd() - .5) * .5, t: [x, y, z] }), ref: mid });
}
function burgerStrawPotatoMesh(R, kH, seed, quantity = 1) {
  const m = new Mesh(), rnd = randomFor(seed), q = clamp(Number(quantity) || 1, 1, 10);
  const count = Math.min(420, Math.round(70 * q * (R / .06) ** 2));
  for (let i = 0; i < count; i++) {
    const a = rnd() * TAU, rr = Math.sqrt(rnd()) * R * .74;
    strawPotatoInto(m, Math.cos(a) * rr, .0008 + rnd() * .0034 * kH * q, Math.sin(a) * rr, (.019 + rnd() * .012) * (R / .06), seed + i, rnd);
  }
  return m.finish();
}

function burgerLayout(product, ings, size, o, kH) {
  const R = (Number(product.widthCm) || 12) / 200, seed = hash(product.id || 'burger'), detail = o.detail;
  const isDouble = size?.key === 'duplo';
  const q = new Map(ings.map(i => [i.id, clamp(Number(i.quantity) || 1, 1, 10)]));
  const has = id => q.has(id), qty = id => q.get(id) || 0;
  const parts = []; let y = 0;
  const key = (kind, extra = '') => `burger|${kind}|${extra}|${R.toFixed(4)}|${kH.toFixed(3)}|${detail}|${seed}`;
  const add = (kind, extra, build, h, dy = 0) => {
    parts.push({ kind, key: key(kind, extra), y: y + dy, base: false, build });
    y += h;
  };
  const buns = has('pao-brioche');
  if (buns) add('bun-bottom', '', () => bunBottomMesh(R, .022 * kH, seed + 1, detail), .022 * kH);

  // Proteínas: cada unidade é um disco real. O tamanho "Duplo" (2 carnes) agora também aparece no 3D.
  const proteinIds = ['carne', 'costela-burger', 'alcatra-burger', 'hamburguer-140g'];
  const patties = [];
  for (const id of proteinIds) for (let i = 0; i < qty(id); i++) patties.push(id);
  if (isDouble && patties.length) patties.push(patties[0]);
  patties.forEach((id, index) => {
    const proteinSeed = seed + 7 + index * 13;
    add('patty', `${id}-${index}-${proteinSeed}`, () => pattyMesh(R * .92, .017 * kH, proteinSeed, detail), .0164 * kH);
  });

  // Queijos: cada fatia guarda sua própria rotação. Antes a rotação era lida só na hora de construir
  // (variável já alterada pelo laço), então todas as fatias saíam iguais e o cache podia ficar velho.
  const cheeseStyleById = {
    'queijo-cheddar': 'cheddar', 'queijo-extra': 'generic',
    'queijo-mussarela-burger': 'mozzarella', 'queijo-parmesao-burger': 'parmesan',
    'queijo-gorgonzola-burger': 'gorgonzola', 'queijo-provolone-burger': 'provolone'
  };
  let cheeseIndex = 0;
  for (const [id, style] of Object.entries(cheeseStyleById)) {
    for (let i = 0; i < qty(id); i++) {
      const idx = cheeseIndex++, cheeseSeed = seed + 31 + idx * 7, yaw = (idx % 4) * Math.PI / 4;
      add('cheese', `${id}-${i}-${idx}`, () => cheeseMesh(R * .92, .017 * kH, cheeseSeed, detail, yaw, style), .0031 * kH, .0005);
    }
  }

  // single: molhos são uma única camada; a quantidade não cria vão de ar entre as peças.
  const toppings = [
    { id: 'molho-especial', kind: 'sauce', height: .0032, single: true, build: n => burgerSauceMesh(R * .86, kH, seed + 41, detail, '#d58a43') },
    { id: 'ketchup-burger', kind: 'ketchup', height: .0028, single: true, build: n => burgerSauceMesh(R * .82, kH, seed + 42, detail, '#bd2922') },
    { id: 'maionese-burger', kind: 'mayonnaise', height: .0028, single: true, build: n => burgerSauceMesh(R * .82, kH, seed + 43, detail, '#f3e9cf') },
    { id: 'alface', kind: 'lettuce', height: .0085, build: n => lettuceMesh(R, kH, seed + 3, detail, 2 + n) },
    { id: 'tomate-burger', kind: 'tomato', height: .0072, build: n => tomatoMesh(R, kH, seed + 4, detail, n) },
    { id: 'picles', kind: 'pickles', height: .0034, build: n => pickleMesh(R, kH, seed + 5, detail, n) },
    { id: 'cebola-burger', kind: 'onion', height: .0046, build: n => onionMesh(R, kH, seed + 6, detail, n) },
    { id: 'bacon-burger', kind: 'bacon', height: .0042, build: n => baconMesh(R, kH, seed + 20, detail, n) },
    { id: 'calabresa-burger', kind: 'calabresa', height: .0042, build: n => burgerCalabresaMesh(R, seed + 51, detail, n, kH) },
    { id: 'presunto-burger', kind: 'ham', height: .0038, build: n => burgerHamMesh(R, seed + 52, n) },
    { id: 'frango-burger', kind: 'chicken', height: .009, build: n => burgerChickenMesh(R, seed + 56, n) },
    { id: 'batata-palha-burger', kind: 'potato-straw', height: .0045, build: n => burgerStrawPotatoMesh(R, kH, seed + 53, n) },
    { id: 'milho-burger', kind: 'corn', height: .0035, build: n => burgerCornMesh(R, seed + 54, n) },
    { id: 'ervilha-burger', kind: 'peas', height: .0035, build: n => burgerPeasMesh(R, seed + 55, n) },
    { id: 'ovo', kind: 'egg', height: .0085, build: n => eggMesh(R, kH, seed + 21, detail, n) }
  ];
  for (const item of toppings) {
    const count = qty(item.id);
    if (!count) continue;
    const h = item.height * kH * (item.single ? 1 : count);
    add(item.kind, `${item.id}-quantity-${count}`,
      () => item.build(count), h, item.id.includes('molho') || item.id.includes('ketchup') || item.id.includes('maionese') ? -.0007 : 0);
  }
  // Ingredientes personalizados sem correspondência conhecida ganham uma cobertura
  // própria de pedaços tostados; nunca são convertidos silenciosamente em queijo.
  for (const item of ings) {
    if (!String(item.id).startsWith('burger-custom-')) continue;
    const count = qty(item.id);
    if (!count) continue;
    add('custom:' + item.id, `${item.id}-quantity-${count}`,
      () => burgerCustomMesh(R, seed + Array.from(item.id).reduce((value, char) => value + char.charCodeAt(0), 0), detail, count), .0042 * kH * count);
  }

  if (buns) add('bun-top', '', () => bunTopMesh(R, .036 * kH, seed + 30, detail), .036 * kH, -.0012);
  const boardR = R * 1.45, bt = .018;
  parts.unshift({ kind: 'board', key: `board|${boardR.toFixed(4)}|${detail}`, y: -bt + .0004, base: true, build: () => boardMesh(boardR, bt, seed, detail) });
  return { parts, total: y, radius: boardR * .92, extentH: [-bt, y] };
}
function pizzaBoardMesh(R, T, seed, detail) {
  const m = new Mesh();
  m.revolve(superPuck(R, T, 7, 40, 0), {
    nu: 120, nv: 20, detail, R: a => 1 + .005 * Math.sin(a * 3 + seed),
    shade: (u, v, p, n) => {
      const grain = .5 + .5 * Math.sin(p[0] * 120 + nz(p, 7, seed) * 9 + nz(p, 40, seed + 3) * 2);
      const c = mix(C.pizzaWoodA, C.pizzaWoodB, grain * .6);
      return MAT(mul(c, 1 + (nz(p, 60, seed + 1) - .5) * .12), .5, 0, .6, n[1] > .5 ? 1 : .85);
    }
  });
  return m.finish();
}

// Recorta a geometria real de cada cobertura pelos dois raios da fatia.
// Filtrar apenas o centro das peças não basta: peças grandes e fios de molho
// ainda atravessavam a divisória e pareciam pertencer aos sabores vizinhos.
function clipGeometryToSector(geometry, sector) {
  if (!sector || !geometry?.positions?.length || !geometry?.indices?.length) return geometry;
  const positions = [], normals = [], colors = [], materials = [], indices = [];
  const readVertex = index => {
    const p = index * 3, n = index * 3, m = index * 4;
    return {
      p: [geometry.positions[p], geometry.positions[p + 1], geometry.positions[p + 2]],
      n: geometry.normals?.length >= p + 3 ? [geometry.normals[p], geometry.normals[p + 1], geometry.normals[p + 2]] : [0, 1, 0],
      c: geometry.colors?.length >= p + 3 ? [geometry.colors[p], geometry.colors[p + 1], geometry.colors[p + 2]] : [1, 1, 1],
      m: geometry.materials?.length >= m + 4 ? Array.from(geometry.materials.slice(m, m + 4)) : [0, 0, 0, 1]
    };
  };
  const interpolate = (a, b, t) => ({
    p: a.p.map((v, i) => v + (b.p[i] - v) * t),
    n: a.n.map((v, i) => v + (b.n[i] - v) * t),
    c: a.c.map((v, i) => v + (b.c[i] - v) * t),
    m: a.m.map((v, i) => v + (b.m[i] - v) * t)
  });
  const crossRay = (vertex, angle) => Math.cos(angle) * vertex.p[2] - Math.sin(angle) * vertex.p[0];
  const clip = (polygon, angle, keepPositive) => {
    const output = [];
    for (let i = 0; i < polygon.length; i++) {
      const current = polygon[i], previous = polygon[(i + polygon.length - 1) % polygon.length];
      const dc = crossRay(current, angle) * (keepPositive ? 1 : -1);
      const dp = crossRay(previous, angle) * (keepPositive ? 1 : -1);
      const insideCurrent = dc >= -1e-9, insidePrevious = dp >= -1e-9;
      if (insideCurrent !== insidePrevious) {
        const denominator = dp - dc;
        const t = Math.abs(denominator) < 1e-12 ? 0 : dp / denominator;
        output.push(interpolate(previous, current, t));
      }
      if (insideCurrent) output.push(current);
    }
    return output;
  };
  const emit = vertex => {
    const index = positions.length / 3;
    positions.push(...vertex.p); normals.push(...vertex.n); colors.push(...vertex.c); materials.push(...vertex.m);
    indices.push(index);
  };
  for (let i = 0; i + 2 < geometry.indices.length; i += 3) {
    let polygon = [readVertex(geometry.indices[i]), readVertex(geometry.indices[i + 1]), readVertex(geometry.indices[i + 2])];
    polygon = clip(polygon, sector.start, true);
    polygon = clip(polygon, sector.end, false);
    if (polygon.length < 3) continue;
    const baseIndex = positions.length / 3;
    for (const vertex of polygon) {
      positions.push(...vertex.p); normals.push(...vertex.n); colors.push(...vertex.c); materials.push(...vertex.m);
    }
    for (let j = 1; j < polygon.length - 1; j++) indices.push(baseIndex, baseIndex + j, baseIndex + j + 1);
  }
  if (!positions.length) return { ...geometry, positions: new Float32Array(), normals: new Float32Array(), colors: new Float32Array(), materials: new Float32Array(), indices: new Uint32Array(), box: [0, 0, 0, 0, 0, 0] };
  const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    box[0] = Math.min(box[0], positions[i]); box[1] = Math.min(box[1], positions[i + 1]); box[2] = Math.min(box[2], positions[i + 2]);
    box[3] = Math.max(box[3], positions[i]); box[4] = Math.max(box[4], positions[i + 1]); box[5] = Math.max(box[5], positions[i + 2]);
  }
  return { ...geometry, positions: new Float32Array(positions), normals: new Float32Array(normals), colors: new Float32Array(colors), materials: new Float32Array(materials), indices: new Uint32Array(indices), box };
}

function pizzaDividerMesh(ctx, angle, detail) {
  const m = new Mesh(), radius = ctx.Rp - ctx.rho * 1.95, halfWidth = Math.max(.00055, ctx.Rp * .0032);
  m.grid(Math.max(24, Math.round(72 * detail)), 4, (u, v) => {
    const r = .001 + u * radius;
    const side = (v - .5) * halfWidth * 2;
    const x = Math.cos(angle) * r - Math.sin(angle) * side;
    const z = Math.sin(angle) * r + Math.cos(angle) * side;
    return [x, ctx.surf(x, z) + .0018, z];
  }, () => MAT(lin('#75452b'), .42, .18, .3, .96), { up: true });
  return m.finish();
}

function pizzaLayout(product, ings, size, o) {
  const D = (size?.diameterCm || Number(product.widthCm) || 30) / 100, Rp = D / 2, detail = o.detail, seed = hash(product.id || 'pizza');
  const crustKey = CRUSTS[o.crustKey] ? o.crustKey : 'tradicional';
  const flavorList = Array.isArray(o.flavors) && o.flavors.length ? o.flavors.slice(0, 8) : null;
  const normalizeItems = items => {
    const q = new Map();
    for (const item of items || []) {
      const resolved = resolveVisualIngredient('pizza', item);
      const id = resolved.id;
      q.set(id, clamp((q.get(id) || 0) + (Number(item.quantity) || 1), 1, 3));
    }
    return q;
  };
  const flavorMaps = flavorList ? flavorList.map(flavor => normalizeItems(flavor.ingredients || [])) : [normalizeItems(ings)];
  const sectors = flavorList ? flavorMaps : [normalizeItems(ings)];
  const sectorCount = sectors.length;
  const base = `${Rp.toFixed(4)}|${crustKey}|${detail}|${seed}`;
  const parts = [{ kind: 'dough', key: `pizza|dough|${base}`, y: 0, base: false, build: () => doughMesh(pizzaCtx(Rp, crustKey, false, false, seed), detail) }];

  // Cada sabor é uma fatia independente. Molho, queijo e coberturas são
  // construídos e recortados dentro do mesmo setor, nunca como uma camada global.
  sectors.forEach((flavorQ, flavorIndex) => {
    const sector = flavorList && sectorCount > 1
      ? { start: -Math.PI + flavorIndex * TAU / sectorCount, end: -Math.PI + (flavorIndex + 1) * TAU / sectorCount }
      : null;
    const hasSauce = flavorQ.has('molho-tomate');
    const hasCheese = flavorQ.has('mussarela') || hasSauce;
    const flags = `${hasSauce ? 1 : 0}${hasCheese ? 1 : 0}`;
    const ctx = pizzaCtx(Rp, crustKey, hasSauce, hasCheese, seed + flavorIndex * 97);
    ctx.hasSauce = hasSauce;
    ctx.sector = sector;
    ctx.sauceTop = (x, z) => {
      const a = Math.atan2(z, x), r = Math.hypot(x, z);
      return ctx.deck + (hasSauce ? ctx.sauceH(x, z) * ctx.edgeF(r / ctx.sauceR(a)) : 0);
    };
    const suffix = sector ? `:${flavorIndex}` : '';
    const sectorKey = sector ? `|sector-${flavorIndex}-${sectorCount}` : '|whole';
    if (hasSauce) parts.push({
      kind: 'sauce' + suffix, key: `pizza|sauce|${base}|${flags}${sectorKey}`, y: 0, base: false,
      build: () => clipGeometryToSector(sauceMeshPizza(ctx, detail), sector)
    });
    if (hasCheese) parts.push({
      kind: 'cheese' + suffix, key: `pizza|cheese|${base}|${flags}${sectorKey}`, y: 0, base: false,
      build: () => clipGeometryToSector(cheeseMeshPizza(ctx, detail), sector)
    });

    const flavorChocolateIds = ['chocolate', 'white-chocolate'].filter(id => flavorQ.has(id));
    if (flavorChocolateIds.length) {
      const style = flavorChocolateIds.length > 1 ? 'mixed' : flavorChocolateIds[0];
      parts.push({
        kind: 'chocolate-cream' + suffix,
        key: `pizza|chocolate-cream|${flavorChocolateIds.join('+')}|${base}|${flags}${sectorKey}`,
        y: 0, base: false,
        build: () => clipGeometryToSector(chocolateMeshPizza(ctx, detail, style), sector)
      });
    }
    const earlier = [];
    for (const id of TOPPING_ORDER) {
      if (!flavorQ.has(id) || id === 'molho-tomate' || id === 'mussarela' || id === 'chocolate' || id === 'white-chocolate') continue;
      const qi = flavorQ.get(id) - 1, sig = earlier.map(e => `${e.id}${e.qtyIdx}`).join(',');
      const ear = earlier.slice();
      parts.push({
        kind: 'topping:' + id + suffix,
        key: `pizza|top|${id}${qi}|${base}|${flags}|${sig}${sectorKey}`,
        y: 0, base: false,
        build: () => clipGeometryToSector(toppingMesh(ctx, id, qi, ear, detail), sector)
      });
      earlier.push({ id, qtyIdx: qi });
    }
  });

  // Uma divisória radial para cada fronteira entre sabores. Ao selecionar ou
  // remover um sabor, a quantidade e o ângulo das divisórias são recalculados.
  if (flavorList && sectorCount > 1) {
    for (let i = 0; i < sectorCount; i++) {
      const angle = -Math.PI + i * TAU / sectorCount;
      const dividerCtx = pizzaCtx(Rp, crustKey, true, true, seed);
      parts.push({
        kind: 'flavor-divider:' + i,
        key: `pizza|divider|${base}|${sectorCount}|${i}`,
        y: 0, base: false,
        build: () => pizzaDividerMesh(dividerCtx, angle, detail)
      });
    }
  }
  const boardR = Rp * 1.12 + .012, bt = .016;
  parts.unshift({ kind: 'board', key: 'pboard|' + boardR.toFixed(4) + '|' + detail, y: -bt + .0004, base: true, build: () => pizzaBoardMesh(boardR, bt, seed, detail) });
  return { parts, total: .026, radius: boardR * .86, extentH: [-bt, .026] };
}


// Escala uma peça procedural preservando normais e materiais.
function scaleFoodGeometry(geometry, sx, sy, sz) {
  const positions = geometry.positions;
  const normals = geometry.normals;
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] *= sx; positions[i + 1] *= sy; positions[i + 2] *= sz;
    if (normals?.length >= i + 3) {
      let x = normals[i] / sx, y = normals[i + 1] / sy, z = normals[i + 2] / sz;
      const d = Math.hypot(x, y, z) || 1;
      normals[i] = x / d; normals[i + 1] = y / d; normals[i + 2] = z / d;
    }
  }
  if (geometry.box?.length === 6) geometry.box = [
    geometry.box[0] * sx, geometry.box[1] * sy, geometry.box[2] * sz,
    geometry.box[3] * sx, geometry.box[4] * sy, geometry.box[5] * sz
  ];
  return geometry;
}

// Pão de cachorro-quente em formato de bisnaga, com pontas arredondadas
// e um corte/canaleta profunda para a salsicha ficar visivelmente encaixada.
// ===================== HOT DOG =====================
const CHEESE_PALETTES = {
  cheddar: ['#e99622', '#f3b73e', '#d98310'], mozzarella: ['#dfc99b', '#f0dfb8', '#b99a68'],
  parmesan: ['#d9c58f', '#f4e4b7', '#bba16b'], gorgonzola: ['#e8dfc9', '#f5eddc', '#aeb69a'],
  provolone: ['#ead9a8', '#fff0c9', '#c9b77f'], generic: ['#eadfc7', '#f7efdf', '#cdbf9f'],
  mash: ['#f0dca0', '#f8ebc2', '#d6bd78']
};

// Pão em duas metades (cada uma um tubo elíptico fechado). As metades se sobrepõem embaixo e abrem um vale
// no topo onde a salsicha se encaixa. Construído direto no tamanho final: sem esticar a malha.
function hotDogBunMesh(L, W, H, seed, detail) {
  const m = new Mesh(), b = H / 2, a = W * .56, zc = W - a;
  const capAt = x => { const e = clamp((Math.abs(x) / (L / 2) - .78) / .22, 0, 1); return Math.sqrt(Math.max(0, 1 - e * e)); };
  for (const side of [-1, 1]) {
    const ph = seed * .37 + side;
    m.grid(seg(72, detail, 28), seg(150, detail, 48), (u, v) => {
      const th = u * TAU, x = (v - .5) * L, cap = capAt(x);
      const wob = 1 + .014 * Math.sin(v * Math.PI * 6 + ph) + .03 * (fbm(Math.cos(th) * 1.4 + side * 3, Math.sin(th) * 1.4, v * 4, seed, 2) - .5);
      return [x, cap * wob * b * (1 + Math.sin(th)), side * zc * cap + cap * wob * a * Math.cos(th)];
    }, (u, v, p, n) => {
      const hy = clamp(p[1] / H, 0, 1), toward = -side * n[2];
      const toastNoise = fbm(p[0] * 38, p[1] * 52 + p[2] * 24, seed + 7, 3);
      const toast = sstep(.40, .68, toastNoise) * sstep(.08, .58, hy);
      const freckles = sstep(.78, .90, nz(p, 92, seed + 15)) * toast;
      let c = mix(C.bunSide, C.bunCrown, sstep(.12, .78, hy));
      c = mix(c, lin('#995322'), toast * .78);
      c = mix(c, lin('#593018'), freckles * .55);
      const inner = sstep(.5, .85, toward);
      c = mix(c, mix(C.bunCrumb, lin('#f6e6bf'), nz(p, 90, seed + 9) * .5), inner);
      return MAT(mul(c, 1 + (nz(p, 62, seed + 4) - .5) * .1), inner > .5 ? .84 : .62, .11, inner > .5 ? 1.15 : .92, hy < .12 ? .75 : .95);
    }, { wrapV: false, ref: p => { const c = capAt(p[0]); return [p[0], b * c, side * zc * c]; } });
  }
  return m.finish();
}

// Salsicha: cilindro de verdade com pontas arredondadas e marcas de grelha.
// (Antes era um disco achatado esticado, com ~7,5 mm de altura, quase invisível dentro do pão.)
function hotDogSausageMesh(L, R, seed, detail) {
  const m = new Mesh(), bend = R * .06;
  m.grid(seg(56, detail, 24), seg(120, detail, 40), (u, v) => {
    const phi = u * TAU, t = Math.abs(2 * v - 1), taper = Math.sqrt(Math.max(0, 1 - t ** 6));
    const rho = R * taper * (1 + .012 * Math.sin(v * Math.PI * 7 + seed));
    return [(v - .5) * L, bend * Math.sin(Math.PI * v) + rho * Math.sin(phi), rho * Math.cos(phi)];
  }, (u, v, p, n) => {
    const searField = fbm(p[0] * 24, p[2] * 62, seed + 17, 3);
    const mark = sstep(.42, .70, searField) * sstep(.06, .42, n[1]);
    const meat = mix(lin('#71301f'), lin('#963f27'), .42 + .10 * (nz(p, 34, seed + 11) - .5));
    const char = sstep(.88, .96, nz(p, 92, seed + 23)) * mark;
    const cooked = mix(meat, lin('#3b1d14'), mark * .72);
    return MAT(mul(mix(cooked, lin('#593526'), char * .12), 1 + (nz(p, 54, seed + 12) - .5) * .045), .54, .16, .62, .98);
  }, { wrapV: false, ref: p => [p[0], 0, 0] });
  return m.finish();
}

// Faixa que acompanha a curva da salsicha (queijo, purê). ls(z) = altura da superfície em relação ao topo.
function drapeStripMesh({ L, w, t, ls, palette, seed, detail, lift = .0006, ruffle = .0005 }) {
  const m = new Mesh(), [base, light, deep] = palette.map(lin);
  const P = (u, v) => {
    const x = (u - .5) * L, z = (v - .5) * 2 * w, edge = sstep(.7, 1, Math.abs(2 * v - 1)), endDrop = sstep(.9, 1, Math.abs(2 * u - 1));
    return [x, ls(z) + lift - edge * .0006 - endDrop * .0008 + (fbm(u * 8, v * 4, 0, seed, 2) - .5) * ruffle * 2, z];
  };
  m.slab(seg(96, detail, 32), 14, P, t, (u, v, p, n, part) => {
    const edge = sstep(.8, 1, Math.abs(2 * v - 1));
    const c = mix(mix(base, light, sstep(.2, .6, nz(p, 25, seed + 4)) * .5), deep, edge * .35 + (part === 2 ? .25 : 0));
    return MAT(mul(c, 1 + (nz(p, 60, seed + 1) - .5) * .1), .28, .6, .1, part === 1 ? .6 : 1);
  }, { ref: () => [0, 0, 0] });
  return m.finish();
}

function hotDogLayout(product, ings, o) {
  const length = clamp((Number(product.widthCm) || 20) / 100, .18, .24);
  const seed = hash(product.id || 'hotdog'), detail = o.detail;
  // O pão acompanha o volume do recheio: mais unidades sólidas ampliam o vale e as laterais.
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const bulkPattern = /^(?!.*(?:pao|bread|bun|salsicha|vina|viena|sausage|ketchup|catchup|mostarda|mustard|maionese|mayo|mayonnaise|molho|sauce)).+/i;
  const fillingUnits = ings.reduce((sum, item) => {
    const name = normalize([item.name, item.label, item.id].filter(Boolean).join(' '));
    return bulkPattern.test(name) ? sum + clamp(Number(item.quantity) || 1, 1, 10) : sum;
  }, 0);
  const load = clamp((fillingUnits - 1) / 10, 0, 1);
  // A receita altera a estrutura do pão, não apenas alguns milímetros:
  // as duas abas se afastam para formar um berço aberto e as laterais ganham corpo.
  const bunL = length * .94, bunW = length * (.15 + load * .045), bunH = .034 + load * .008;
  const sausageR = length * .066, sausageL = length * .9;
  const sausageY = bunH - sausageR * .45;           // encaixada no vale; ~1/4 do diâmetro acima do pão
  const bt = .014, boardR = length * .62;
  const baseKey = `hotdog-v15|${length.toFixed(3)}|${detail}|${seed}`;

  // Classificação pelo nome real, pelo id e pelos aliases visuais.
  const names = ings.map(item => ({ item, name: normalize([item.name, item.label, item.id, item.visual, item.visual_key, item.visualKey].filter(Boolean).join(' ')) }));
  const matching = pattern => names.filter(x => pattern.test(x.name));
  const has = pattern => matching(pattern).length > 0;
  const qty = pattern => matching(pattern).reduce((sum, x) => sum + clamp(Number(x.item.quantity) || 1, 1, 10), 0);

  // Salsichas (1 a 4), lado a lado; o resto das coberturas acompanha a superfície delas.
  const sausageCount = clamp(qty(/salsicha|vina|viena|sausage|hot.?dog sausage/), 1, 4);
  const spacing = sausageCount > 1 ? Math.min(sausageR * 1.96, bunW * 1.5 / (sausageCount - 1)) : 0;
  const sausages = Array.from({ length: sausageCount }, (_, k) => ({ z: (k - (sausageCount - 1) / 2) * spacing, y: sausageY + (sausageCount > 1 ? sausageR * .1 : 0) }));
  const topY = Math.max(...sausages.map(s => s.y)) + sausageR;
  const ls = z => {
    let best = -Infinity;
    for (const s of sausages) { const d = z - s.z; if (Math.abs(d) < sausageR) best = Math.max(best, s.y + Math.sqrt(sausageR * sausageR - d * d)); }
    return (best === -Infinity ? sausageY - sausageR * .2 : best) - topY;
  };

  const parts = [
    { kind: 'board', key: `hotdog-board|${boardR.toFixed(4)}|${detail}`, y: -bt + .0004, base: true, build: () => boardMesh(boardR, bt, seed, detail) },
    { kind: 'hotdog-bun', key: `${baseKey}|bun`, y: 0, base: true, build: () => hotDogBunMesh(bunL, bunW, bunH, seed + 1, detail) }
  ];
  sausages.forEach((s, k) => parts.push({
    kind: k ? 'hotdog-sausage-extra' : 'hotdog-sausage', key: `${baseKey}|sausage|${k ? 'extra' + k : 'main'}`,
    y: s.y, z: s.z, base: k === 0, build: () => hotDogSausageMesh(sausageL * (1 - k * .02), sausageR, seed + 3 + k * 7, detail)
  }));

  // Coberturas empilhadas na ordem em que são adicionadas. A chave não depende da composição inteira,
  // só da própria cobertura e do número de salsichas (que muda o formato da superfície).
  const sig = 's' + sausageCount;
  let stack = 0;
  const add = (kind, id, build, h = .0016, dy = 0) => {
    parts.push({ kind: 'hotdog-' + kind, key: `${baseKey}|${sig}|${kind}|${id}`, y: topY + stack + dy, base: false, build });
    stack += h;
  };
  // Posições em 1 a 3 fileiras ao longo da salsicha (quantidade = mais fileiras/densidade).
  const rowPlaces = (span, r, count, sd) => {
    const rnd = randomFor(sd), lanes = count <= 1 ? [0] : count === 2 ? [-.38, .38] : [-.62, 0, .62];
    const perRow = Math.max(3, Math.round(span / (r * 2 * (count > 3 ? .7 : .98)))), sites = [];
    lanes.forEach((lane, li) => {
      for (let i = 0; i < perRow; i++) {
        const t = (i + .5 + (li % 2 ? .45 : 0)) / (perRow + .45);
        sites.push({ x: (t - .5) * span + (rnd() - .5) * r * .2, z: lane * sausageR + (rnd() - .5) * r * .2 });
      }
    });
    return { sites, rnd };
  };
  const rowTopping = (kind, count, r, make, h = .0018, sink = -.0008) => {
    if (!count) return;
    add(kind, `q${count}`, () => {
      const m = new Mesh(), sd = seed + hash(kind), { sites, rnd } = rowPlaces(sausageL * .82, r, count, sd);
      sites.forEach((s, i) => make(m, s.x, ls(s.z) + sink, s.z, r, sd + i * 13, rnd));
      return m.finish();
    }, h);
  };
  const scatter = (kind, count, perQty, make, h = .0018) => {
    if (!count) return;
    add(kind, `q${count}`, () => {
      const m = new Mesh(), sd = seed + hash(kind), rnd = randomFor(sd), n = Math.min(140, perQty * count);
      for (let i = 0; i < n; i++) {
        const z = (rnd() * 2 - 1) * sausageR * .82, x = (rnd() - .5) * sausageL * .8;
        make(m, x, ls(z), z, sd + i, rnd);
      }
      return m.finish();
    }, h);
  };

  // Queijos: fatia que acompanha a curva da salsicha; cada tipo mantém a própria cor.
  const cheeseTypes = [
    { pattern: /cheddar/, style: 'cheddar', kind: 'cheddar' },
    { pattern: /mussarela|mozzarella|mozzarela/, style: 'mozzarella', kind: 'mozzarella' },
    { pattern: /parmesao|parmesan/, style: 'parmesan', kind: 'parmesan' },
    { pattern: /gorgonzola|queijo azul|roquefort/, style: 'gorgonzola', kind: 'gorgonzola' },
    { pattern: /provolone/, style: 'provolone', kind: 'provolone' },
    { pattern: /^(?!.*(?:cheddar|mussarela|mozzarella|parmesao|parmesan|gorgonzola|queijo azul|roquefort|provolone)).*(?:catupiry|requeijao|cream cheese|creme de queijo|queijo|cheese)/, style: 'generic', kind: 'generic' }
  ];
  let cheeseIdx = 0;
  for (const cheese of cheeseTypes) {
    const count = qty(cheese.pattern);
    for (let i = 0; i < count; i++) {
      const idx = cheeseIdx++;
      add('cheese-' + cheese.kind, `${i}-${idx}`, () => drapeStripMesh({
        L: sausageL * (.86 - (idx % 3) * .04), w: sausageR * .98, t: .0017, ls, palette: CHEESE_PALETTES[cheese.style], seed: seed + 10 + idx, detail
      }), .0016);
    }
  }

  const baconCount = qty(/bacon|panceta/);
  if (baconCount) add('bacon', `q${baconCount}`, () => {
    const m = new Mesh(), rnd = randomFor(seed + 11), strips = Math.min(6, baconCount * 2);
    for (let i = 0; i < strips; i++) {
      const lane = [-.34, .34, -.62, .62, 0, 0][i] * sausageR, tier = i >= 4 ? 1 : 0;
      baconStripInto(m, { L: sausageL * .9, W: .0092, t: .0022, seed: seed + i * 5, detail, curl: .0014,
        xf: rigid({ yaw: (rnd() - .5) * .08, t: [(rnd() - .5) * .01, ls(lane) + .0018 + tier * .0026, lane] }) });
    }
    return m.finish();
  }, .0026 + (baconCount > 1 ? .0026 : 0));

  rowTopping('calabresa', qty(/calabresa|linguica|pepperoni|salame/), sausageR * .6, (m, x, y, z, r, sd, rnd) => pepperoniInto(m, x, y, z, r, sd, rnd, detail), .0026);
  rowTopping('ham', qty(/presunto|ham|peito de peru/), sausageR * .7, (m, x, y, z, r, sd, rnd) => hamInto(m, x, y, z, r, sd, rnd), .0026);
  rowTopping('chicken', qty(/frango|chicken/), sausageR * .7, (m, x, y, z, r, sd, rnd) => chickenInto(m, x, y, z, r, sd, rnd), .003);
  rowTopping('beef', qty(/costela|carne|alcatra|proteina|protein|patty/), sausageR * .7, (m, x, y, z, r, sd, rnd) => {
    for (let n = 0; n < 3; n++) toppingBlob(m, x + (rnd() - .5) * r, y, z + (rnd() - .5) * r, r * .7, .0022, r * .55, lin(['#6a3a22', '#7d4a2c', '#5a2f1b'][n]), sd + n, rnd);
  }, .003);

  if (has(/alface|rucula|repolho|salada|lettuce|herb/)) {
    const leaves = 1 + Math.min(2, qty(/alface|rucula|repolho|salada|lettuce/)), R0 = sausageR * .7;
    add('greens', `q${leaves}`, () => scaleFoodGeometry(lettuceMesh(R0, 1, seed + 12, detail, leaves), sausageL * .84 / (2 * R0), 1, sausageR * 2.1 / (2 * R0)), .0026, -.0016);
  }

  // Molho de tomate é líquido, não vira fatia de tomate.
  const tomatoCount = Math.max(0, qty(/tomate|tomato/) - qty(/molho.*tomate|tomato.*sauce/));
  rowTopping('tomato', tomatoCount, sausageR * .62, (m, x, y, z, r, sd, rnd) => tomatoSlicePizza(m, x, y + .0012, z, r, sd, rnd, detail), .002);
  rowTopping('pepper', qty(/pimentao|bell pepper/), sausageR * .75, (m, x, y, z, r, sd, rnd) => pepperRingInto(m, x, y, z, r, sd, rnd), .0018);
  rowTopping('onion', qty(/cebola|onion/), sausageR * .55, (m, x, y, z, r, sd, rnd) => onionInto(m, x, y, z, r, sd, rnd, detail), .002);
  rowTopping('pickles', qty(/picles|pepino|pickle/), sausageR * .5, (m, x, y, z, r, sd, rnd) => toppingBlob(m, x, y, z, r, .0013, r * .95, lin('#7d9a34'), sd, rnd), .0016);
  rowTopping('olive', qty(/azeitona|oliva|olive/), sausageR * .45, (m, x, y, z, r, sd, rnd) => oliveInto(m, x, y, z, r, sd, rnd, detail), .003);
  rowTopping('egg', qty(/ovo|egg/), sausageR * .7, (m, x, y, z, r, sd, rnd) => quailEggInto(m, x, y, z, r, sd, rnd), .003);

  scatter('corn', qty(/milho|corn/), 26, (m, x, y, z, sd, rnd) => cornInto(m, x, y - .0004, z, sausageR * .2, sd, rnd));
  scatter('peas', qty(/ervilha|erivlha|peas/), 18, (m, x, y, z, sd, rnd) => {
    const r = sausageR * .17, tone = rnd() * .35;
    blobInto(m, { rx: r, ry: r * .85, rz: r, seed: sd, amp: .08, nu: 10, nv: 8, xf: rigid({ t: [x, y + r * .35, z] }), shade: () => MAT(mix(C.lettuceB, C.lettuceC, tone), .3, .35, .2, 1) });
  });

  const mashCount = qty(/pure|mashed potato/);
  for (let i = 0; i < mashCount; i++) add('mashed-potato', `${i}`, () => drapeStripMesh({
    L: sausageL * .8, w: sausageR, t: .0034, ls, palette: CHEESE_PALETTES.mash, seed: seed + 19 + i, detail, lift: .0016, ruffle: .0011
  }), .003);

  // Batata palha: fios finos (sem purê, que é outra cobertura).
  const strawCount = names.filter(x => /batata|potato|fries|palha/.test(x.name) && !/pure|mashed/.test(x.name))
    .reduce((sum, x) => sum + clamp(Number(x.item.quantity) || 1, 1, 10), 0);
  if (strawCount) add('potato-straw', `q${strawCount}`, () => {
    const m = new Mesh(), sd = seed + 18, rnd = randomFor(sd), n = Math.min(260, 60 * strawCount);
    for (let i = 0; i < n; i++) {
      const z = (rnd() * 2 - 1) * sausageR * .85, x = (rnd() - .5) * sausageL * .78;
      strawPotatoInto(m, x, ls(z) + .0004 + rnd() * .0026 * Math.min(strawCount, 3), z, .016 + rnd() * .012, sd + i, rnd);
    }
    return m.finish();
  }, .004);

  // Molhos: fio em zigue-zague sobre a salsicha, uma cor por molho.
  const sauceRibbon = (color, rs, zoff) => {
    const m = new Mesh(), L = sausageL * .84, W = .0028, T = .0007, ph = rs * .7, amp = sausageR * .34;
    const P = (u, v) => {
      const x = (u - .5) * L, z = zoff + amp * Math.sin(u * Math.PI * 9 + ph) + (v - .5) * W;
      return [x, ls(z) + .0003 + Math.sin(v * Math.PI) * .0004, z];
    };
    m.slab(seg(150, detail, 60), 6, P, T, (u, v, p, n, face) => MAT(mul(lin(color), .95 + .05 * Math.sin(u * Math.PI * 8 + rs)), .18, .42, .12, face === 1 ? .7 : 1), { ref: () => [0, 0, 0] });
    return m.finish();
  };
  const sauceTypes = [
    { pattern: /ketchup|catchup/, kind: 'ketchup', color: '#c52f2f', z: -.35 },
    { pattern: /mostarda|mustard/, kind: 'mustard', color: '#e5b52f', z: .35 },
    { pattern: /maionese|mayo|mayonnaise/, kind: 'mayo', color: '#f1e4bd', z: 0 },
    { pattern: /barbecue|bbq/, kind: 'barbecue', color: '#71351f', z: .15 },
    { pattern: /^(?!.*(?:ketchup|catchup|mostarda|maionese|mayo|barbecue|bbq|tomate)).*(?:molho|sauce)/, kind: 'special-sauce', color: '#cf7132', z: -.15 },
    { pattern: /molho de tomate|tomate sauce/, kind: 'tomato-sauce', color: '#b52b20', z: -.5 }
  ];
  for (const sauce of sauceTypes) {
    const count = qty(sauce.pattern);
    for (let i = 0; i < count; i++)
      add(sauce.kind, `${i}`, () => sauceRibbon(sauce.color, seed + sauce.kind.length * 13 + i * 17, (sauce.z + (i % 2 ? .12 : 0)) * sausageR), .0007);
  }

  // Ingrediente cadastrado sem família visual: pequenas peças neutras, para não sumir do modelo.
  const recognized = /queijo|cheddar|mussarela|catupiry|cream|cheese|bacon|panceta|calabresa|linguica|pepperoni|salame|presunto|ham|peito de peru|alface|rucula|repolho|salada|lettuce|herb|tomate|tomato|pimentao|bell pepper|cebola|onion|picles|pepino|pickle|azeitona|oliva|olive|milho|corn|ervilha|erivlha|peas|batata|potato|fries|palha|crispy|pure|mashed potato|ovo|ovos|egg|frango|chicken|costela|carne|alcatra|proteina|protein|patty|ketchup|catchup|mostarda|mustard|maionese|mayo|mayonnaise|barbecue|bbq|molho|sauce|salsicha|vina|viena|sausage|pao|bread|bun/i;
  names.forEach((entry, index) => {
    if (recognized.test(entry.name)) return;
    scatter('custom-' + index, clamp(Number(entry.item.quantity) || 1, 1, 10), 14,
      (m, x, y, z, sd, rnd) => toppingBlob(m, x, y, z, sausageR * .2, .0016, sausageR * .17, lin('#b8894c'), sd, rnd), .0014);
  });

  return { parts, total: .036, radius: boardR * .9, extentH: [-bt, Math.max(.048, topY + stack + .01)] };
}
function plateLayout(product, ings, size, o) {
  const W = (Number(product.widthCm) || 20) / 100, R = W / 2 * 1.2, detail = o.detail, seed = hash(product.id || 'plate');
  const key = k => `plate|${k}|${R.toFixed(4)}|${detail}|${seed}`;
  const parts = [
    { kind: 'plate', key: key('plate'), y: 0, base: true, build: () => plateMesh(R, seed, detail) },
    { kind: 'fries', key: key('fries'), y: 0, base: false, build: () => friesMesh(R, seed, detail) },
    { kind: 'ramekin', key: key('ramekin'), y: 0, base: false, xz: [-R * .5, R * .38], build: () => ramekinMesh(seed, detail), dy: .0074 }
  ];
  parts[2].y = .0074; parts[2].x = -R * .5; parts[2].z = R * .38;
  const count = Math.min(10, ings.length);
  for (let i = 0; i < count; i++) {
    const item = ings[i], n = String(item.id || '').toLowerCase(), q = clamp(Number(item.quantity) || 1, 1, 3), idx = i;
    const angle = idx * 2.39996 + seed * .013, radius = R * (.16 + .23 * Math.sqrt((idx + 1) / Math.max(1, count)));
    const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
    let kind = 'plate-piece', build;
    if (n.includes('cheese') || n.includes('queijo')) { kind = 'plate-cheese'; build = () => cheeseMesh(R * .18, .006, seed + idx * 13, detail); }
    else if (n.includes('tomato') || n.includes('tomate') || n.includes('piment')) { kind = 'plate-tomato'; build = () => tomatoMesh(R * .19, 1, seed + idx * 13, detail, q); }
    else if (n.includes('bacon') || n.includes('calabresa') || n.includes('linguica')) { kind = 'plate-bacon'; build = () => baconMesh(R * .18, 1, seed + idx * 13, detail, q); }
    else if (n.includes('alface') || n.includes('rucula') || n.includes('salada') || n.includes('erva') || n.includes('oregano')) { kind = 'plate-greens'; build = () => lettuceMesh(R * .17, 1, seed + idx * 13, detail, q + 1); }
    else if (n.includes('molho') || n.includes('maionese') || n.includes('ketchup') || n.includes('mostarda') || n.includes('barbecue')) { kind = 'plate-sauce'; build = () => sauceMesh(R * .15, 1, seed + idx * 13, detail); }
    else if (n.includes('carne') || n.includes('hamburguer') || n.includes('frango') || n.includes('chicken')) { kind = 'plate-protein'; build = () => pattyMesh(R * .18, .008 + q * .001, seed + idx * 13, detail); }
    else if (n.includes('ovo') || n.includes('egg')) { kind = 'plate-egg'; build = () => eggMesh(R * .17, 1, seed + idx * 13, detail); }
    else if (n.includes('cebola') || n.includes('picles') || n.includes('pepino') || n.includes('azeitona') || n.includes('cogumelo') || n.includes('champignon')) { kind = 'plate-vegetable'; build = () => pickleMesh(R * .15, 1, seed + idx * 13, detail, q); }
    else { build = () => pattyMesh(R * .14, .006 + q * .001, seed + idx * 13, detail); }
    parts.push({ kind, key: key(kind + '-' + idx + '-' + q), y: .008 + idx * .0005, x, z, base: false, build });
  }
  return { parts, total: .05, radius: R, extentH: [0, .055] };
}

// Converte nomes personalizados do painel em peças procedurais conhecidas.
// Assim, "Catupiry extra", "Pepperoni", "Cheddar adicional" etc. alteram o modelo
// sem exigir que o ID cadastrado seja igual ao nome interno do modelo.
function resolveVisualIngredient(type, ingredient) {
  const id = String(ingredient?.id || '').toLowerCase();
  const raw = String(ingredient?.name || ingredient?.label || ingredient?.groupName || id);
  // Ingredientes cadastrados pelo restaurante podem ter IDs próprios. O campo
  // visual (ou visual_key da API) é a referência mais confiável para o modelo.
  const visual = String(ingredient?.visual || ingredient?.visual_key || ingredient?.visualKey || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const normalizedName = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  // O nome explícito do ingrediente prevalece sobre visual_key/grupo herdado.
  // Isso impede chocolate de virar erva quando o cadastro traz um visual padrão incorreto.
  if (type === 'pizza' && /(^| )(canela|canela em po|cinnamon|cinnamon powder)( |$)/.test(normalizedName)) {
    return { ...ingredient, id: 'canela-em-po' };
  }
  if (type === 'pizza' && /(^| )(chocolate|choc|kit kat|confete|pacoquinha|leite condensado|brigadeiro|nutella)( |$)/.test(normalizedName)) {
    return { ...ingredient, id: /(^| )chocolate branco( |$)/.test(normalizedName) ? 'white-chocolate' : 'chocolate' };
  }
  const visualAliases = type === 'pizza' ? {
    sauce: 'molho-tomate', molho: 'molho-tomate', 'tomato-sauce': 'molho-tomate',
    cheese: 'queijo-generico', queijo: 'queijo-generico', mozzarella: 'mussarela',
    catupiry: 'catupiry', cheddar: 'queijo-cheddar', parmesan: 'queijo-parmesao', 'queijo-parmesao': 'queijo-parmesao',
    gorgonzola: 'queijo-gorgonzola', provolone: 'queijo-provolone',
    pepperoni: 'calabresa', sausage: 'salsicha', bacon: 'bacon', chicken: 'frango',
    ham: 'presunto', egg: 'ovo', pepper: 'pimentao', 'bell-pepper': 'pimentao', palmito: 'palmito',    onion: 'cebola', tomato: 'tomate', corn: 'milho', olive: 'azeitona',
    mushroom: 'champignon', herb: 'oregano', manjericao: 'manjericao', basil: 'manjericao', basilico: 'manjericao',
    pineapple: 'abacaxi', banana: 'banana', strawberry: 'morango', chocolate: 'chocolate', coconut: 'coco',
    garlic: 'alho', greens: 'brocolis', peas: 'ervilha', crisps: 'batata-palha', tuna: 'atum',
    palm: 'palmito', barbecue: 'barbecue', mayonnaise: 'mayonnaise',
    mustard: 'mustard', 'hot-sauce': 'hot-sauce', cream: 'cream', 'white-chocolate': 'white-chocolate',
    sprinkles: 'sprinkles', peanut: 'peanut', cinnamon: 'canela-em-po', 'cinnamon-powder': 'canela-em-po', 'canela-em-po': 'canela-em-po', canela: 'canela-em-po'
  } : type === 'burger' ? {
    bun: 'pao-brioche', bread: 'pao-brioche', patty: 'carne', beef: 'carne',
    cheddar: 'queijo-cheddar', cheese: 'queijo-extra', mozzarella: 'queijo-mussarela-burger',
    parmesan: 'queijo-parmesao-burger', gorgonzola: 'queijo-gorgonzola-burger',
    provolone: 'queijo-provolone-burger', lettuce: 'alface',
    tomato: 'tomate-burger', sauce: 'molho-especial', onion: 'cebola-burger',
    bacon: 'bacon-burger', egg: 'ovo', pickle: 'picles',
    'potato-straw': 'batata-palha-burger', 'batata-palha': 'batata-palha-burger',
    calabresa: 'calabresa-burger', ketchup: 'ketchup-burger', catchup: 'ketchup-burger',
    mayonnaise: 'maionese-burger', maionese: 'maionese-burger',
    corn: 'milho-burger', milho: 'milho-burger', peas: 'ervilha-burger', ervilha: 'ervilha-burger',
    ham: 'presunto-burger', presunto: 'presunto-burger',
    chicken: 'frango-burger', frango: 'frango-burger', ribs: 'costela-burger',
    alcatra: 'alcatra-burger', 'hamburguer-140g': 'hamburguer-140g'
  } : {};
  const name = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const text = (id + ' ' + name).replace(/[^a-z0-9]+/g, ' ').trim();
  // O nome/id do ingrediente sempre vence um visual genérico herdado do cadastro.
  // Isso evita que alface, tomate, bacon etc. sejam transformados em queijo.
  const has = (...terms) => terms.some(term => {
    const normalized = String(term).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    return normalized && (' ' + text + ' ').includes(' ' + normalized + ' ');
  });
  if (type === 'burger') {
    let burgerId = '';
    if (has('pao', 'brioche', 'bun', 'bread')) burgerId = 'pao-brioche';
    else if (has('hamburguer 140g')) burgerId = 'hamburguer-140g';
    else if (has('costela', 'ribs')) burgerId = 'costela-burger';
    else if (has('alcatra')) burgerId = 'alcatra-burger';
    else if (has('frango', 'crispy chicken', 'chicken')) burgerId = 'frango-burger';
    else if (has('carne', 'hamburguer', 'burger', 'patty', 'bovina', 'blend')) burgerId = 'carne';
    else if (has('cheddar')) burgerId = 'queijo-cheddar';
    else if (has('mussarela', 'mozzarella', 'mozzarela', 'bufala')) burgerId = 'queijo-mussarela-burger';
    else if (has('parmesao', 'parmesan')) burgerId = 'queijo-parmesao-burger';
    else if (has('gorgonzola', 'queijo azul', 'roquefort')) burgerId = 'queijo-gorgonzola-burger';
    else if (has('provolone')) burgerId = 'queijo-provolone-burger';
    else if (has('queijo', 'cheese', 'prato', 'catupiry', 'requeijao')) burgerId = 'queijo-extra';
    else if (has('alface', 'lettuce', 'rucula', 'folha')) burgerId = 'alface';
    else if (has('tomate', 'tomato')) burgerId = 'tomate-burger';
    else if (has('bacon', 'panceta')) burgerId = 'bacon-burger';
    else if (has('ovo', 'egg')) burgerId = 'ovo';
    else if (has('cebola', 'onion')) burgerId = 'cebola-burger';
    else if (has('picles', 'pickle', 'pepino')) burgerId = 'picles';
    else if (has('molho especial', 'molho da casa', 'sauce')) burgerId = 'molho-especial';
    else if (has('catchup', 'ketchup')) burgerId = 'ketchup-burger';
    else if (has('maionese', 'mayonnaise', 'mayo', 'aioli')) burgerId = 'maionese-burger';
    else if (has('calabresa', 'pepperoni', 'salame')) burgerId = 'calabresa-burger';
    else if (has('presunto', 'ham')) burgerId = 'presunto-burger';
    else if (has('batata palha', 'potato straw')) burgerId = 'batata-palha-burger';
    else if (has('milho', 'corn')) burgerId = 'milho-burger';
    else if (has('ervilha', 'peas')) burgerId = 'ervilha-burger';
    if (burgerId) return { ...ingredient, id: burgerId };
    // Só aceita visual de queijo quando o nome realmente identifica um queijo.
    if (/queij|cheese|cheddar|mussarel|mozzarella|catupiry|requeij|provolone|gorgonzola|parmesan/.test(name) && visualAliases[visual]) {
      return { ...ingredient, id: visualAliases[visual] };
    }
    const group = String(ingredient?.groupName || ingredient?.group || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (/queij|latic/.test(group)) return { ...ingredient, id: 'queijo-extra' };
    if (/carne|prote/.test(group)) return { ...ingredient, id: 'carne' };
    if (/molho|crem/.test(group)) return { ...ingredient, id: 'molho-especial' };
    if (/veget|verde|hort/.test(group)) return { ...ingredient, id: 'alface' };
    const customId = 'burger-custom-' + (id || name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
    return { ...ingredient, id: customId || 'burger-custom-item' };
  }
  if (visualAliases[visual]) return { ...ingredient, id: visualAliases[visual] };
  const knownPizza = new Set(['molho-tomate', 'mussarela', ...Object.keys(TOPPINGS)]);
  const knownBurger = new Set(['pao-brioche', 'carne', 'queijo-cheddar', 'queijo-extra', 'queijo-mussarela-burger', 'queijo-parmesao-burger', 'queijo-gorgonzola-burger', 'queijo-provolone-burger', 'alface', 'tomate-burger', 'molho-especial', 'picles', 'cebola-burger', 'bacon-burger', 'ovo']);
  if ((type === 'pizza' && knownPizza.has(id)) || (type === 'burger' && knownBurger.has(id))) return { ...ingredient };
  let visualId = '';
  if (type === 'pizza') {
    if (has('molho', 'sauce')) visualId = 'molho-tomate';
    else if (has('catupiry')) visualId = 'catupiry';
    else if (has('requeijao', 'cream cheese', 'creme de queijo', 'cream')) visualId = 'requeijao';
    else if (has('cheddar')) visualId = 'queijo-cheddar';
    else if (has('parmesao', 'parmesan', 'grana padano', 'pecorino')) visualId = 'queijo-parmesao';
    else if (has('gorgonzola', 'queijo azul', 'blue cheese', 'roquefort')) visualId = 'queijo-gorgonzola';
    else if (has('provolone')) visualId = 'queijo-provolone';
    else if (has('mussarela', 'mozzarella', 'mozzarela', 'bufala')) visualId = 'mussarela';
    else if (has('queijo', 'cheese', 'coalho')) visualId = 'queijo-generico';
    else if (has('calabresa', 'pepperoni', 'salame')) visualId = 'calabresa';
    else if (has('champignon', 'cogumelo', 'fungo', 'shimeji', 'shitake', 'portobello')) visualId = 'champignon';
    else if (has('presunto', 'ham', 'peito de peru', 'blanquet')) visualId = 'presunto';
    else if (has('ovo', 'ovos', 'egg', 'codorna')) visualId = 'ovo';
    else if (has('pimentao', 'pimentoes', 'pimentão', 'bell pepper')) visualId = 'pimentao';
    else if (has('frango', 'frango desfiado', 'chicken')) visualId = 'frango';
    else if (has('bacon', 'panceta', 'linguica')) visualId = 'bacon';
    else if (has('cebola', 'onion', 'alho', 'alho poro')) visualId = 'cebola';
    else if (has('azeitona', 'oliva', 'olive')) visualId = 'azeitona';
    else if (has('milho', 'corn')) visualId = 'milho';
    else if (has('manjericao', 'basil', 'basilico')) visualId = 'manjericao';
    else if (has('oregano', 'salsinha', 'cebolinha', 'rucula', 'erva', 'herb')) visualId = 'oregano';
    else if (has('abacaxi', 'pineapple')) visualId = 'abacaxi';
    else if (has('banana')) visualId = 'banana';
    else if (has('morango', 'strawberry')) visualId = 'morango';
    else if (has('canela', 'cinnamon')) visualId = 'canela-em-po';
    else if (has('chocolate', 'kit kat', 'confete', 'pacoquinha', 'paçoquinha', 'leite condensado')) visualId = 'chocolate';
    else if (has('coco')) visualId = 'coco';
    else if (has('alho')) visualId = 'alho';
    else if (has('brocolis')) visualId = 'brocolis';
    else if (has('ervilha')) visualId = 'ervilha';
    else if (has('batata palha', 'doritos')) visualId = 'batata-palha';
    else if (has('atum')) visualId = 'atum';
    else if (has('palmito')) visualId = 'palmito';
    else if (has('salsicha')) visualId = 'salsicha';
    else if (has('barbecue', 'maionese', 'mostarda', 'tarê', 'tare', 'molho de pimenta', 'molho')) visualId = 'requeijao';
    else if (has('costela', 'file', 'filé', 'coxao mole', 'frango')) visualId = 'frango';
    else if (has('tomate', 'tomato', 'pimentao', 'pepper')) visualId = 'tomate';
    else if (has('alho frito', 'cebola crispy', 'crispy')) visualId = 'cebola';
  } else if (type === 'burger') {
    if (has('pao', 'brioche', 'bun')) visualId = 'pao-brioche';
    else if (has('batata palha', 'potato straw')) visualId = 'batata-palha-burger';
    else if (has('catchup', 'ketchup')) visualId = 'ketchup-burger';
    else if (has('maionese', 'mayonnaise')) visualId = 'maionese-burger';
    else if (has('ervilha', 'peas')) visualId = 'ervilha-burger';
    else if (has('milho', 'corn')) visualId = 'milho-burger';
    else if (has('calabresa')) visualId = 'calabresa-burger';
    else if (has('presunto', 'ham')) visualId = 'presunto-burger';
    else if (has('costela', 'ribs')) visualId = 'costela-burger';
    else if (has('alcatra')) visualId = 'alcatra-burger';
    else if (has('frango', 'crispy chicken', 'chicken')) visualId = 'frango-burger';
    else if (has('hamburguer 140g', 'hamburguer artesanal', 'hamburguer', 'carne', 'patty', 'bovina')) visualId = 'carne';
    else if (has('cheddar')) visualId = 'queijo-cheddar';
    else if (has('mussarela', 'mozzarella', 'mozzarela', 'bufala')) visualId = 'queijo-mussarela-burger';
    else if (has('parmesao', 'parmesan')) visualId = 'queijo-parmesao-burger';
    else if (has('gorgonzola', 'queijo azul', 'roquefort')) visualId = 'queijo-gorgonzola-burger';
    else if (has('provolone')) visualId = 'queijo-provolone-burger';
    else if (has('queijo', 'cheese', 'prato')) visualId = 'queijo-extra';
    else if (has('alface', 'lettuce', 'rucula')) visualId = 'alface';
    else if (has('tomate', 'tomato')) visualId = 'tomate-burger';
    else if (has('molho', 'mostarda', 'barbecue', 'bbq', 'aioli')) visualId = 'molho-especial';
    else if (has('picles', 'pickle', 'pepino')) visualId = 'picles';
    else if (has('cebola', 'onion', 'alho')) visualId = 'cebola-burger';
    else if (has('bacon', 'panceta')) visualId = 'bacon-burger';
    else if (has('ovo', 'egg')) visualId = 'ovo';
  } else if (type === 'plate') {
    // Hot dog (type=plate) is classified by its original ingredient name
    // inside hotDogLayout. Do not replace IDs with shared visual IDs here:
    // that merged different ingredients (e.g. ketchup and mayonnaise)
    // before the hot dog builder could render them separately.
    return { ...ingredient };

  }
  if (!visualId) {
    const group = String(ingredient?.groupName || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (type === 'pizza') {
      if (/queij|latic/.test(group)) visualId = 'queijo-generico';
      else if (/molho|crem/.test(group)) visualId = 'requeijao';
      else if (/carne|prote|frango/.test(group)) visualId = 'frango';
      else if (/tempero|erva|verde/.test(group)) visualId = 'oregano';
      else if (/veget|legum/.test(group)) visualId = 'cebola';
      else visualId = 'requeijao'; // peça genérica para nomes livres sem correspondência conhecida
    } else if (type === 'burger') {
      if (/queij|latic/.test(group)) visualId = 'queijo-extra';
      else if (/carne|prote/.test(group)) visualId = 'carne';
      else if (/molho|crem/.test(group)) visualId = 'molho-especial';
      else if (/veget|verde|hort/.test(group)) visualId = 'alface';
      else visualId = 'queijo-extra';
    }
  }
  // Todo ingrediente selecionado no hambúrguer precisa gerar uma peça.
  // Cadastros personalizados sem palavra-chave ou grupo também aparecem
  // usando uma camada neutra como representação visual.
  if (!visualId && type === 'burger') visualId = 'queijo-extra';
  return visualId ? { ...ingredient, id: visualId } : { ...ingredient };
}

export function buildFoodLayout(product, ingredients, size, options = {}) {
  const o = { detail: options.detail || 1, crustKey: options.crustKey, flavors: Array.isArray(options.flavors) ? options.flavors : [] };
  const type = product.type;
  const combined = new Map();
  for (const original of (ingredients || [])) {
    const item = resolveVisualIngredient(type, original);
    const previous = combined.get(item.id);
    const maxQuantity = (type === 'burger' || type === 'plate') ? 10 : 3;
    if (previous) previous.quantity = clamp((Number(previous.quantity) || 1) + (Number(item.quantity) || 1), 1, maxQuantity);
    else combined.set(item.id, { ...item, quantity: clamp(Number(item.quantity) || 1, 1, maxQuantity) });
  }
  const list = Array.from(combined.values());
  let layout, bounds;
  if (type === 'pizza') {
    layout = pizzaLayout(product, list, size, o);
    const D = (size?.diameterCm || Number(product.widthCm) || 30) / 100;
    bounds = [D, (Number(product.heightCm) || 2) / 100, size?.diameterCm ? D : (Number(product.depthCm) || D * 100) / 100];
  } else if (type === 'burger') {
    const H = (Number(product.heightCm) || 10) / 100;
    const ref = burgerLayout(product, DEFAULT_BURGER.map(id => ({ id, quantity: 1 })), { key: 'classico' }, o, 1).total;
    layout = burgerLayout(product, list, size, o, H / ref);
    // A caixa de enquadramento acompanha a altura real da montagem. Antes ela
    // ficava presa à altura cadastrada e cortava/achatava lanches com adicionais.
    const fittedHeight = Math.max(H, layout.extentH[1] - layout.extentH[0]);
    bounds = [(Number(product.widthCm) || 12) / 100, fittedHeight, (Number(product.depthCm) || 12) / 100];
  } else {
    layout = hotDogLayout(product, list, o);
    bounds = [Math.max(.17, Math.min(.25, (Number(product.widthCm) || 20) / 100)), .055, .085];
  }
  return { type: type === 'pizza' || type === 'burger' ? type : 'hotdog', parts: layout.parts, bounds, hint: { radius: layout.radius, minY: layout.extentH[0], maxY: layout.extentH[1] } };
}

// Versão síncrona: constrói e funde todas as peças (usada em testes e como fallback).
export function buildFoodGeometry(product, ingredients, size, options = {}) {
  const layout = buildFoodLayout(product, ingredients, size, options);
  const pos = [], nor = [], col = [], mat = [], idx = [];
  let box = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9];
  for (const part of layout.parts) {
    const g = part.build(), off = [part.x || 0, part.y, part.z || 0], base = pos.length / 3;
    for (let i = 0; i < g.positions.length; i += 3) pos.push(g.positions[i] + off[0], g.positions[i + 1] + off[1], g.positions[i + 2] + off[2]);
    for (const v of g.normals) nor.push(v); for (const v of g.colors) col.push(v); for (const v of g.materials) mat.push(v);
    for (const i of g.indices) idx.push(i + base);
    box = [Math.min(box[0], g.box[0] + off[0]), Math.min(box[1], g.box[1] + off[1]), Math.min(box[2], g.box[2] + off[2]), Math.max(box[3], g.box[3] + off[0]), Math.max(box[4], g.box[4] + off[1]), Math.max(box[5], g.box[5] + off[2])];
  }
  return {
    geometry: { positions: new Float32Array(pos), normals: new Float32Array(nor), colors: new Float32Array(col), materials: new Float32Array(mat), indices: new Uint32Array(idx) },
    bounds: layout.bounds, type: layout.type, extent: box, parts: layout.parts.map(p => p.kind)
  };
}