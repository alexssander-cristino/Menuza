// Menuza — modelos 3D procedurais de alimentos.
// Cada ingrediente é uma "peça" (part) independente, com chave de cache própria: ao adicionar ou
// remover um ingrediente só as peças afetadas são reconstruídas; as demais apenas mudam de altura.
import {
  TAU, clamp, lerp, sstep, hash, randomFor, lin, mix, mul, noise3, fbm, rigid, onSurface, norm, cross, sub,
  profile, smoothPoly, superPuck, loopProfile, Mesh, MAT, poissonDisc
} from './food-geo.js';

const C = {
  bunCrown: lin('#b9702c'), bunSide: lin('#cf9448'), bunCrumb: lin('#efd6a2'), bunToast: lin('#d8a458'), bunDeep: lin('#a8662a'), bunUnder: lin('#c98b45'),
  seed: lin('#f1e2ba'),
  patty: lin('#4d2b1b'), pattySear: lin('#2a150b'), pattySide: lin('#6d3d25'), pattyFat: lin('#8a5532'),
  cheddar: lin('#e99622'), cheddarLight: lin('#f3b73e'), cheddarDeep: lin('#d98310'),
  lettuceA: lin('#b6cd6c'), lettuceB: lin('#6fa536'), lettuceC: lin('#3a7821'), lettuceVein: lin('#e3edaa'),
  tomSkin: lin('#c42d1c'), tomWall: lin('#e97d5f'), tomJelly: lin('#d2392a'), tomCore: lin('#f3a892'),
  pickleSkin: lin('#58792a'), pickleFlesh: lin('#a4bb55'),
  onionBrown: lin('#8c4e1d'), onionGold: lin('#c88a3a'), onionPurple: lin('#8b3a74'), onionPale: lin('#e7cfe0'),
  baconLean: lin('#8e2c19'), baconFat: lin('#f0cb9c'), baconCrisp: lin('#5a1b0d'),
  eggWhite: lin('#fbf5e6'), eggCrisp: lin('#d9aa5c'), yolkA: lin('#f6ac1c'), yolkB: lin('#e08a0b'),
  sauce: lin('#eab283'), sauceDeep: lin('#d98f57'),
  doughRim: lin('#c98a3d'), doughBrown: lin('#a65f27'), doughChar: lin('#5f2f12'), doughPale: lin('#e2c086'), doughCream: lin('#f2e0b2'),
  tomSauce: lin('#b2301c'), tomSauceDeep: lin('#7f2013'),
  mozz: lin('#ebc878'), mozzGold: lin('#c4822f'), mozzBrown: lin('#a8651f'),
  pep: lin('#b8412a'), pepDeep: lin('#8c2a18'), pepChar: lin('#5a190d'), pepFat: lin('#e49e80'),
  mush: lin('#eadfc6'), mushSkin: lin('#a68656'),
  olive: lin('#2b2723'), oliveIn: lin('#66753a'),
  corn: lin('#f2b72a'), chicken: lin('#e1c08f'), chickenBrown: lin('#a97a42'),
  cream: lin('#f8f1df'), herb: lin('#506027'), herbLight: lin('#7d923b'),
  ceramic: lin('#f1ede3'), ceramicLine: lin('#a9b6bb'),
  potato: lin('#eebf68'), potatoSkin: lin('#a8662a'), potatoDark: lin('#7a4519'), rosemary: lin('#4f6a2e'), aioli: lin('#f4e9ca'),
  wood: lin('#4a2f1d')
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
      const tv = 1 + (nz(p, 70, seed + 5) - .5) * .34, rn = r / (R * .97);
      if (n[1] > .5 && y > H * .5) { const toast = mix(C.bunToast, C.bunCrumb, .3 * (1 - rn) + .1), patch = sstep(.55, .7, nz(p, 38, seed + 9)); return MAT(mul(mix(toast, C.bunDeep, patch * .55), tv), .8, .1, 1.1, .9); }
      if (n[1] < -.5) return MAT(mul(C.bunUnder, tv), .72, .05, .6, .7);
      return MAT(mul(mix(C.bunCrumb, C.bunSide, sstep(0, .5, y / H)), tv), .5, .1, .6, y < H * .22 ? .72 : 1);
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
    nu: 120, nv: 60, detail, R: Rf, disp: dispf,
    shade: (u, v, p, n, [r, y]) => {
      const tv = 1 + (nz(p, 60, seed + 5) - .5) * .3, hy = y / H;
      if (hy < .1 && n[1] < -.25) return MAT(mul(mix(C.bunToast, C.bunCrumb, .35), tv), .8, .1, 1, .75);
      const glaze = mix(C.bunSide, C.bunCrown, sstep(.05, .85, hy)), blotch = sstep(.55, .72, nz(p, 36, seed + 11));
      return MAT(mul(mix(glaze, C.bunDeep, blotch * .5), tv), .34, .12, .45, hy < .18 ? .8 : 1);
    }
  });
  // sementes de gergelim: pequenos elipsoides pousados sobre a cúpula
  const rnd = randomFor(seed + 31), placed = [], target = Math.round(38 * (R / .06) ** 2), minD = .0105 * (R / .06);
  for (let t = 0; t < 900 && placed.length < target; t++) {
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
      const x = Math.cos(a) * r, z = Math.sin(a) * r, d = (fbm(x * 120, y * 80, z * 120, seed, 3) - .5) * H * .13;
      return [d * .8, y > H * .5 ? d : d * .3];
    },
    shade: (u, v, p, n, [r, y]) => {
      const rn = r / R, tv = 1 + (nz(p, 90, seed + 3) - .5) * .4;
      if (n[1] > .5 && y > H * .5) {
        const s = p[0] * Math.cos(dir) + p[2] * Math.sin(dir), d = Math.abs(s / .024 - Math.round(s / .024)), mark = 1 - sstep(.1, .19, d);
        const base = mix(C.patty, C.pattyFat, sstep(.55, .75, nz(p, 55, seed + 7)) * .5);
        return MAT(mul(mix(base, C.pattySear, mark * .85), tv), mark > .5 ? .72 : .6, .08, 1.5, lerp(1, .85, sstep(.7, 1, rn)));
      }
      if (n[1] < -.5) return MAT(mul(C.patty, .8 * tv), .7, .05, 1, .6);
      return MAT(mul(mix(C.pattySide, C.pattyFat, sstep(.6, .78, nz(p, 70, seed + 2)) * .5), tv), .55, .08, 1.3, y < H * .25 ? .7 : .95);
    }
  });
  return m.finish();
}

function cheeseMesh(Rp, Hp, seed, detail, yaw = 0) {
  const m = new Mesh(), t = .0026, S = Rp * 1.0;
  const fold = (x, z) => {
    const d = Math.hypot(x, z), a = Math.atan2(z, x), over = Math.max(0, d - Rp * .86);
    const drop = Math.min(Hp * 1.05, (over / (Rp * .28)) ** 1.7 * Hp * .42);
    const ripple = sstep(.9, 1.2, d / Rp) * .0017 * Math.sin(a * 9 + seed) * (.6 + noise3(x * 70, z * 70, seed));
    return (1 - sstep(0, .9, d / Rp)) * .0006 - drop + ripple;
  };
  const Ptop = (u, v) => {
    let x = (u - .5) * 2 * S, z = (v - .5) * 2 * S;
    const d = Math.hypot(x, z) || 1e-9, k = 1 / (1 + (d / (1.2 * Rp)) ** 6) ** (1 / 6) ;
    x *= k; z *= k;
    x += (noise3(z * 90, 0, seed) - .5) * .0016; z += (noise3(x * 90, 5, seed) - .5) * .0016;
    return [x, fold(x, z), z];
  };
  const sh = (u, v, p, n, part) => {
    const d = Math.hypot(p[0], p[2]) / Rp, low = sstep(-.0015, -.009, p[1]), tv = 1 + (nz(p, 60, seed + 1) - .5) * .12;
    const c = mix(mix(C.cheddar, C.cheddarLight, sstep(.2, .6, nz(p, 25, seed + 4)) * .5), C.cheddarDeep, low * .5 + (part === 2 ? .25 : 0));
    return MAT(mul(c, tv), .36, .55, .1, part === 1 ? .6 : lerp(1, .88, sstep(.8, 1.1, d)));
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
      const wave = Math.sin(a * k1 + ph * 2) * .55 + Math.sin(a * (k1 + 6) + ph * 3) * .3 + (noise3(Math.cos(a) * 3 * v + 1, Math.sin(a) * 3 * v, s2) - .5) * 1.2;
      const y = v ** 1.6 * .0044 * kH * wave - .0058 * kH * sstep(.7, 1, v) ** 2 + .0014 * (1 - v) * kH;
      return [Math.cos(a) * rr, y, Math.sin(a) * rr];
    };
    m.grid(120 * detail, 26 * detail, P, (u, v, p) => {
      const a = u * TAU, crest = .5 + .5 * Math.sin(a * k1 + ph * 2), vein = Math.abs(Math.cos(a * 7 + ph)) ** 24 * sstep(.1, .9, v);
      let c = mix(mix(C.lettuceA, C.lettuceB, sstep(.08, .55, v)), C.lettuceC, sstep(.55, 1, v));
      c = mix(c, C.lettuceVein, vein * .3 + crest * .14);
      return MAT(c, .46, .85, .45, .6 + .4 * crest);
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
        return MAT(c, lerp(.4, .16, chamber), .5, .2, lerp(1, .85, sstep(.8, 1, rn)));
      }
      return MAT(C.tomSkin, .24, .35, .15, .85);
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
        shade: (u, v, p, n2, [rn]) => MAT(mix(mix(C.pickleFlesh, C.pickleSkin, sstep(.8, .96, rn)), C.pickleSkin, Math.abs(n2[1]) < .4 ? 1 : 0), .3, .6, .3, .9)
      });
    }
  }
  return m.finish();
}

function onionMesh(R, kH, seed, detail, layers) {
  const m = new Mesh(), rnd = randomFor(seed);
  for (let l = 0; l < layers; l++) for (const f of [.24, .46, .68]) {
    m.ringTube({
      R: R * f, y: .0022 * kH + l * .0042 * kH, rw: .0042 * kH, rh: .0025 * kH, seed: seed + l * 5 + Math.round(f * 10), wob: .05, nu: 72 * detail, nv: 14,
      xf: rigid({ yaw: rnd() * TAU, t: [(rnd() - .5) * .006, 0, (rnd() - .5) * .006] }),
      shade: (u, v, p) => MAT(mul(mix(C.onionGold, C.onionBrown, sstep(.35, .7, nz(p, 45, seed))), .95 + rnd() * .1), .3, .55, .35, .9)
    });
  }
  return m.finish();
}

function baconStripInto(m, { L, W, t, seed, xf, curl = .003, detail = 1 }) {
  const ph = (seed % 31) / 31 * TAU;
  const P = (u, v) => {
    const x = (u - .5) * L, zw = (v - .5) * W, wave = Math.sin(u * Math.PI * 3 + ph) * .0036;
    return [x + Math.sin(v * 3 + ph) * .0005, Math.sin(u * Math.PI * 2.2 + ph) * .0022 + (Math.abs(v - .5) * 2) ** 2 * curl, zw + wave];
  };
  m.slab(28 * detail, 8, P, t, (u, v, p, n, part) => {
    const band = .5 + .5 * Math.sin(v * Math.PI * 4 + ph + (u - .5) * 2), fat = sstep(.5, .7, band), edge = sstep(.08, 0, Math.min(u, 1 - u)) * .8;
    let c = mix(C.baconLean, C.baconFat, fat); c = mix(c, C.baconCrisp, edge + (part === 1 ? .4 : 0));
    return MAT(c, .38, .35, .6, part === 1 ? .6 : 1);
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

function eggMesh(R, kH, seed, detail) {
  const m = new Mesh(), Re = R * .62, ph = (seed % 37) / 37 * TAU, Rw = a => 1 + .2 * (fbm(Math.cos(a) * 1.6 + 2, Math.sin(a) * 1.6, seed, 2) - .5) * 2 + .06 * Math.sin(a * 3 + ph);
  m.revolve(superPuck(Re, .0042 * kH, 3, 40), {
    nu: 96, nv: 28, detail, R: Rw,
    shade: (u, v, p, n, [r]) => MAT(mix(C.eggWhite, C.eggCrisp, sstep(.88, 1, r / Re) * .8), .17, .35, .1, lerp(1, .85, sstep(.85, 1, r / Re)))
  });
  const Ry = Re * .33, Hy = .0075 * kH, pts = [[0, .002 * kH], [Ry * .96, .002 * kH]];
  for (let i = 1; i <= 28; i++) { const th = (Math.PI / 2) * i / 28; pts.push([i === 28 ? 0 : Ry * Math.cos(th), .002 * kH + Hy * Math.sin(th) ** 1.05]); }
  m.revolve(profile(pts), {
    nu: 48, nv: 28, detail, xf: rigid({ t: [Re * .12, .0012 * kH, Re * .08] }),
    shade: (u, v, p, n, [r, y]) => MAT(mix(C.yolkB, C.yolkA, sstep(.2, 1, y / (Hy + .002 * kH))), .1, .5, 0, 1)
  });
  return m.finish();
}

function sauceMesh(R, kH, seed, detail) {
  const m = new Mesh(), ph = (seed % 29) / 29 * TAU, t = .0032 * kH;
  m.revolve(superPuck(R, t, 3, 32), {
    nu: 80, nv: 20, detail,
    R: a => 1 + .12 * Math.sin(a * 5 + ph) + .07 * Math.sin(a * 9 + ph * 2) + .1 * (noise3(Math.cos(a) * 2, Math.sin(a) * 2, seed) - .5),
    disp: (a, r, y) => [0, (fbm(Math.cos(a) * r * 120, 0, Math.sin(a) * r * 120, seed, 2) - .5) * .0009 * (y / t)],
    shade: (u, v, p, n, [r, y]) => MAT(mix(C.sauce, C.sauceDeep, sstep(.4, .85, nz(p, 50, seed))), .2, .4, .12, 1)
  });
  return m.finish();
}

// ===================== TÁBUA / PRATO (apresentação) =====================
function boardMesh(R, T, seed, detail) {
  const m = new Mesh();
  m.revolve(superPuck(R, T, 7, 40, 0), {
    nu: 120, nv: 20, detail, R: a => 1 + .006 * Math.sin(a * 3 + seed),
    shade: (u, v, p, n) => MAT(C.wood, .55, 0, .6, n[1] > .5 ? 1 : .8)
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
  'queijo-cheddar': { r: .010, cover: [.08, .14, .2], kind: 'cheese-cheddar' },
  'queijo-parmesao': { r: .008, cover: [.1, .18, .26], kind: 'cheese-parmesan' },
  'queijo-gorgonzola': { r: .0085, cover: [.08, .14, .2], kind: 'cheese-gorgonzola' },
  'queijo-provolone': { r: .010, cover: [.08, .14, .2], kind: 'cheese-provolone' },
  calabresa: { r: .0165, cover: [.2, .36, .5], kind: 'pep' },
  tomate: { r: .016, cover: [.16, .28, .4], kind: 'tom' },
  champignon: { r: .0165, cover: [.14, .24, .34], kind: 'mush' },
  frango: { r: .0095, cover: [.12, .2, .3], kind: 'chicken' },
  bacon: { r: .0085, cover: [.07, .12, .17], kind: 'bacon' },
  cebola: { r: .011, cover: [.08, .14, .2], kind: 'onion' },
  azeitona: { r: .0072, cover: [.05, .09, .13], kind: 'olive' },
  requeijao: { r: .012, cover: [.1, .17, .24], kind: 'cream' },
  milho: { r: .0034, cover: [.04, .07, .1], kind: 'corn', loose: true },
  oregano: { r: .003, cover: [.012, .022, .032], kind: 'herb', loose: true }
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
  const cheeseR = a => Rin * (.935 + .05 * Math.sin(a * 4 + ph) + .03 * (noise3(Math.cos(a) * 2.3, Math.sin(a) * 2.3, seed) - .5) * 2 + .018 * Math.sin(a * 11 + ph * 2));
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
      const bl = sstep(.62, .82, noise3(x * 55, z * 55, seed + 9)), small = (fbm(x * 160, z * 160, seed + 2, 2) - .5) * .0032;
      const notch = rim * ctx.cutGroove(x, z) * .0012;
      const deckWave = (1 - rim) * (fbm(x * 40, z * 40, seed + 5, 2) - .5) * .0012;
      return [rim * (fbm(x * 90, z * 90, seed + 6, 2) - .5) * .0014, rim * (small + bl * .0034) - notch + deckWave];
    },
    shade: (u, v, p, n, [r, y]) => {
      const x = p[0], z = p[2], rim = sstep(rStart - .003, rStart + .003, r), tv = 1 + (nz(p, 80, seed + 3) - .5) * .25;
      const blister = sstep(.58, .74, noise3(x * 55, z * 55, seed + 9)), char = sstep(.7, .85, noise3(x * 110, z * 110, seed + 12));
      if (n[1] > .25 && rim > 0) {
        let c = mix(C.doughRim, C.doughBrown, clamp(blister * .75 + sstep(.45, .8, nz(p, 30, seed + 14)) * .35, 0, 1));
        c = mix(c, C.doughChar, char * blister * .8);
        if (cr.stuffed) c = mix(c, C.doughCream, sstep(.72, .86, noise3(x * 35, z * 35, seed + 20)) * .6);
        return MAT(mul(c, tv), .76, .08, 1.2, 1);
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
  return veneerMesh(sauceR, (x, z, v) => deck - .0004 + (sauceH(x, z) * edgeF(v) - cutGroove(x, z) * .0007) + .0004 * (1 - edgeF(v)) * 0, (u, v, p) => {
    const swirl = .5 + .5 * Math.sin(Math.atan2(p[2], p[0]) * 3 + Math.hypot(p[0], p[2]) * 120 + ctx.seed);
    const c = mix(C.tomSauce, C.tomSauceDeep, swirl * .35 + sstep(.55, .8, nz(p, 50, ctx.seed + 2)) * .3);
    return MAT(mul(c, 1 + (nz(p, 90, ctx.seed + 4) - .5) * .2), .34, .3, .5, 1);
  }, Math.round(160 * detail), Math.round(32 * detail));
}
function cheeseMeshPizza(ctx, detail) {
  const { cheeseR, cheeseH, edgeF, seed, cutGroove } = ctx, base = (x, z) => ctx.surf(0, 0) * 0;
  const hasSauce = ctx.hasSauce;
  return veneerMesh(cheeseR, (x, z, v) => {
    const s = ctx.sauceTop(x, z);
    return s + cheeseH(x, z) * edgeF(v);
  }, (u, v, p) => {
    const spots = sstep(.58, .72, nz(p, 32, seed + 6)), deep = sstep(.7, .82, nz(p, 70, seed + 13)), g = cutGroove(p[0], p[2]);
    let c = mix(C.mozz, C.mozzGold, spots * .75); c = mix(c, C.mozzBrown, deep * .55);
    c = mix(c, C.doughPale, g * .45); c = mul(c, 1 + (nz(p, 100, seed + 1) - .5) * .14);
    return MAT(c, .38, .5, .65, lerp(1, .82, sstep(.82, 1, v)));
  }, Math.round(200 * detail), Math.round(52 * detail));
}

// ---- coberturas ----
function pepperoniInto(m, x, y, z, R, seed, rnd, detail) {
  const t = .0027, pts = [[0, 0], [R * .95, 0], [R, t * .35], [R, t * .75]];
  for (let i = 0; i <= 14; i++) { const s = 1 - i / 14; pts.push([R * s * .985, t + .0015 * s ** 2.6 - .0003 * (1 - s * s)]); }
  pts[pts.length - 1][0] = 0;
  const ph = rnd() * TAU, sd = seed;
  m.revolve(profile(smoothPoly(pts, 1)), {
    nu: 56, nv: 16, detail, R: a => 1 + .05 * Math.sin(a * 5 + ph) + .03 * Math.sin(a * 9 + ph * 2),
    xf: rigid({ yaw: rnd() * TAU, pitch: (rnd() - .5) * .14, roll: (rnd() - .5) * .14, t: [x, y - .0007, z] }),
    shade: (u, v, p, n, [r, yy]) => {
      const rn = r / R, fat = sstep(.68, .78, noise3(p[0] * 520 + sd, p[1] * 520, p[2] * 520, 4));
      let c = mix(C.pep, C.pepDeep, nz(p, 90, sd) * .7); c = mix(c, C.pepFat, fat * .7); c = mix(c, C.pepChar, sstep(.84, .98, rn) * .65);
      if (n[1] < .3) c = mul(C.pepDeep, .85);
      return MAT(c, .34, .3, .55, lerp(1, .8, sstep(.7, 1, rn)));
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
      return MAT(mix(mul(C.mush, 1 + (nz(p, 120, seed) - .5) * .12), C.mushSkin, sstep(.86, .99, rn) * cap * .9), .42, .3, .3, lerp(1, .85, sstep(.8, 1, rn)));
    }
  });
}
function oliveInto(m, x, y, z, R, seed, rnd, detail) {
  const rin = R * .46, rout = R, t = .0028;
  m.revolve(loopProfile((rin + rout) / 2, t / 2, (rout - rin) / 2, t / 2, 3, 32), {
    nu: 48, nv: 18, detail, wrapV: true,
    xf: rigid({ yaw: rnd() * TAU, pitch: (rnd() - .5) * .16, roll: (rnd() - .5) * .16, t: [x, y - .0006, z] }),
    shade: (u, v, p, n) => (Math.cos(v * TAU) < -.35 ? MAT(C.oliveIn, .4, .3, .3, .7) : MAT(mix(C.olive, lin('#3a2d38'), nz(p, 80, seed)), .27, .15, .3, 1)),
    ref: p => [0, p[1], 0]
  });
}
function onionInto(m, x, y, z, R, seed, rnd, detail) {
  const arcs = 1 + (rnd() > .5 ? 1 : 0);
  for (let i = 0; i < arcs; i++) {
    const a0 = rnd() * TAU, len = Math.PI * (.7 + rnd() * .6);
    m.ringTube({
      R: R * (.8 + i * .45), y: 0, rw: .0016, rh: .0011, a0: 0, a1: len, seed: seed + i, wob: .05, nu: 28, nv: 8,
      xf: rigid({ yaw: a0, pitch: (rnd() - .5) * .1, t: [x, y - .0004 + i * .0006, z] }),
      shade: (u, v, p) => MAT(mix(C.onionPurple, C.onionPale, sstep(.55, .95, .5 + .5 * Math.sin(v * TAU))), .3, .7, .25, .95)
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
  blobInto(m, { rx: R, ry: R * .75, rz: R * .8, seed, amp: .06, nu: 9, nv: 7, xf: rigid({ yaw: rnd() * TAU, pitch: (rnd() - .5) * .5, roll: (rnd() - .5) * .5, t: [x, y + R * .2, z] }), shade: () => MAT(mul(C.corn, .9 + rnd() * .2), .22, .25, .1, 1) });
}
function chickenInto(m, x, y, z, R, seed, rnd) {
  blobInto(m, { rx: R * (1 + rnd() * .5), ry: R * .5, rz: R * (.8 + rnd() * .4), seed, amp: .28, nu: 14, nv: 10, xf: rigid({ yaw: rnd() * TAU, pitch: (rnd() - .5) * .3, roll: (rnd() - .5) * .3, t: [x, y + R * .22, z] }),
    shade: (u, v, p) => MAT(mix(C.chicken, C.chickenBrown, sstep(.5, .72, nz(p, 140, seed)) * .8), .62, .25, 1, .9) });
}
function creamInto(m, x, y, z, R, seed, rnd, detail) {
  const ph = rnd() * TAU;
  m.revolve(superPuck(R, R * .5, 2.4, 24), {
    nu: 32, nv: 12, detail, R: a => 1 + .12 * Math.sin(a * 3 + ph) + .06 * Math.sin(a * 6 + ph), xf: rigid({ t: [x, y - .0008, z] }),
    shade: () => MAT(C.cream, .16, .6, .1, 1)
  });
}
function baconBitInto(m, x, y, z, seed, rnd, detail) {
  baconStripInto(m, { L: .0185, W: .0075, t: .0022, seed, detail: .6, curl: .0016, xf: rigid({ yaw: rnd() * TAU, pitch: (rnd() - .5) * .1, t: [x, y + .0003, z] }) });
}
function herbInto(m, x, y, z, rnd) {
  const L = .0042 + rnd() * .0018, W = .0018 + rnd() * .0008, yaw = rnd() * TAU, curl = .0008 + rnd() * .0008, c = mix(C.herb, C.herbLight, rnd());
  m.grid(3, 2, (u, v) => [(u - .5) * L, curl * (2 * u - 1) ** 2, (v - .5) * W * Math.sin(Math.PI * u) ** .6], () => MAT(c, .5, .5, .2, 1), { wrapU: false, up: true, xf: rigid({ yaw, pitch: (rnd() - .5) * .5, t: [x, y + .0006, z] }) });
}

function cheesePieceInto(m, style, x, y, z, R, seed, rnd, detail) {
  const baseXf = () => rigid({ yaw: rnd() * TAU, pitch: (rnd() - .5) * .28, roll: (rnd() - .5) * .28, t: [x, y, z] });
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
function toppingMesh(ctx, id, qtyIdx, earlier, detail) {
  const def = TOPPINGS[id], m = new Mesh(), rnd = randomFor(hash(id + ctx.seed + qtyIdx)), A = Math.PI * ctx.Rt * ctx.Rt;
  const count = Math.max(1, Math.round(def.cover[qtyIdx] * A / (Math.PI * def.r * def.r)));
  const pool = poolFor(ctx);
  // posições já ocupadas por toppings de maior prioridade
  const placed = [];
  for (const e of earlier) {
    const d2 = TOPPINGS[e.id]; if (d2.loose) continue;
    const c2 = Math.max(1, Math.round(d2.cover[e.qtyIdx] * A / (Math.PI * d2.r * d2.r)));
    placed.push(...pickSites(ctx, e.id, e.qtyIdx, c2, placed, d2.r));
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
  const pool = poolFor(ctx), rnd = randomFor(hash(id + ctx.seed)), order = pool.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const out = [], own = [...placed];
  // 1ª passada: sem sobreposição; 2ª e 3ª: tolerância crescente quando a pizza está muito cheia
  for (const tol of [.86, .62, .4]) {
    for (const idx of order) {
      if (out.length >= count) break;
      const [x, z] = pool[idx];
      if (Math.hypot(x, z) > ctx.Rt - r * .6 || own.some(q => q.x === x && q.z === z)) continue;
      if (own.every(q => Math.hypot(q.x - x, q.z - z) >= (r + (q.r || r)) * tol)) { const s = { x, z, r }; own.push(s); out.push(s); }
    }
    if (out.length >= count) break;
  }
  return out;
}
function looseSites(ctx, id, count) {
  const rnd = randomFor(hash(id + ctx.seed + 5)), out = [];
  for (let i = 0; i < count; i++) { const a = rnd() * TAU, r = Math.sqrt(rnd()) * ctx.Rt * .97; out.push({ x: Math.cos(a) * r, z: Math.sin(a) * r }); }
  return out;
}

// ===================== BATATAS RÚSTICAS =====================
function plateMesh(R, seed, detail) {
  const pts = [[0, .0012], [.5 * R, .0012], [.52 * R, 0], [.62 * R, 0], [.64 * R, .0014], [.9 * R, .006], [.985 * R, .0165], [R, .0185], [R, .0195], [.93 * R, .0205], [.78 * R, .0125], [.62 * R, .0082], [.4 * R, .0072], [0, .0072]];
  const m = new Mesh();
  m.revolve(profile(smoothPoly(pts.flatMap((p, i) => i ? [[(pts[i - 1][0] + p[0]) / 2, (pts[i - 1][1] + p[1]) / 2], p] : [p]), 2)), {
    nu: 128, nv: 70, detail,
    shade: (u, v, p, n, [r, y]) => MAT(mix(C.ceramic, C.ceramicLine, Math.abs(r - .885 * R) < .0016 && n[1] > .3 ? .85 : 0), .16, .1, 0, y < .003 ? .7 : 1)
  });
  return m.finish();
}
function friesMesh(R, seed, detail) {
  const m = new Mesh(), rnd = randomFor(seed), cell = .006, N = Math.ceil(R * 2 / cell), hm = new Float32Array(N * N).fill(.0072);
  const hAt = (x, z) => { const i = clamp(Math.floor((x + R) / cell), 0, N - 1), j = clamp(Math.floor((z + R) / cell), 0, N - 1); return hm[j * N + i]; };
  const count = Math.round(24 * (R / .115) ** 2), cx = R * .14, cz = -R * .06;
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

function burgerLayout(product, ings, size, o, kH) {
  const R = (Number(product.widthCm) || 12) / 200, seed = hash(product.id || 'burger'), detail = o.detail;
  const q = new Map(ings.map(i => [i.id, clamp(Number(i.quantity) || 1, 1, 3)]));
  const has = id => q.has(id), qty = id => q.get(id) || 0;
  const parts = []; let y = 0;
  const key = (kind, extra = '') => `burger|${kind}|${extra}|${R.toFixed(4)}|${kH.toFixed(3)}|${detail}|${seed}`;
  const add = (kind, extra, build, h, dy = 0) => { parts.push({ kind, key: key(kind, extra), y: y + dy, base: false, build }); y += h; };
  const buns = has('pao-brioche');
  if (buns) add('bun-bottom', '', () => bunBottomMesh(R, .022 * kH, seed + 1, detail), .022 * kH);
  if (has('molho-especial')) add('sauce', '', () => sauceMesh(R * .86, kH, seed + 2, detail), .0028 * kH, -.0008);
  if (has('alface')) { const n = qty('alface'); add('lettuce', n, () => lettuceMesh(R, kH, seed + 3, detail, 2 + n), (.0085 + .0042 * (n - 1)) * kH); }
  if (has('tomate-burger')) { const n = qty('tomate-burger'); add('tomato', n, () => tomatoMesh(R, kH, seed + 4, detail, n), (.0072 * n + .0008) * kH); }
  if (has('picles')) { const n = qty('picles'); add('pickles', n, () => pickleMesh(R, kH, seed + 5, detail, n), .0034 * n * kH); }
  if (has('cebola-burger')) { const n = qty('cebola-burger'); add('onion', n, () => onionMesh(R, kH, seed + 6, detail, n), .0046 * n * kH); }
  const patties = has('carne') ? Math.min(3, Math.max(size?.key === 'duplo' ? 2 : 1, qty('carne'))) : 0;
  let slices = clamp((has('queijo-cheddar') ? 1 : 0) + qty('queijo-extra'), 0, 4);
  const Hp = .017 * (patties === 2 ? .88 : 1) * kH, Rpat = R * .92;
  for (let p = 0; p < patties; p++) {
    add('patty', p, () => pattyMesh(Rpat, Hp, seed + 7 + p * 3, detail), Hp - .0006);
    const last = p === patties - 1, n = last ? slices : (slices >= 2 ? 1 : 0);
    if (!last && n) slices -= 1;
    for (let s = 0; s < n; s++) add('cheese', `${p}.${s}`, () => cheeseMesh(Rpat, Hp, seed + 11 + p * 5 + s * 3, detail, s * Math.PI / 4 + p * .4), .0028 * kH + (s ? .0004 : 0), .0006);
  }
  if (has('bacon-burger')) { const n = qty('bacon-burger'); add('bacon', n, () => baconMesh(R, kH, seed + 20, detail, n), (.0042 + .0028 * (n - 1)) * kH); }
  if (has('ovo')) add('egg', '', () => eggMesh(R, kH, seed + 21, detail), .0085 * kH);
  if (buns) add('bun-top', '', () => bunTopMesh(R, .036 * kH, seed + 30, detail), .036 * kH, -.0012);
  const boardR = R * 1.45, bt = .018;
  parts.unshift({ kind: 'board', key: `board|${boardR.toFixed(4)}|${detail}`, y: -bt + .0004, base: true, build: () => boardMesh(boardR, bt, seed, detail) });
  return { parts, total: y, radius: boardR * .92, extentH: [-bt, y] };
}

function pizzaLayout(product, ings, size, o) {
  const D = (size?.diameterCm || Number(product.widthCm) || 30) / 100, Rp = D / 2, detail = o.detail, seed = hash(product.id || 'pizza');
  const crustKey = CRUSTS[o.crustKey] ? o.crustKey : 'tradicional';
  const q = new Map(ings.map(i => [i.id, clamp(Number(i.quantity) || 1, 1, 3)]));
  const hasSauce = q.has('molho-tomate'), hasCheese = q.has('mussarela');
  const ctxFor = () => { const c = pizzaCtx(Rp, crustKey, hasSauce, hasCheese, seed); c.hasSauce = hasSauce; c.sauceTop = (x, z) => { const a = Math.atan2(z, x), r = Math.hypot(x, z); return c.deck + (hasSauce ? c.sauceH(x, z) * c.edgeF(r / c.sauceR(a)) : 0); }; return c; };
  const base = `${Rp.toFixed(4)}|${crustKey}|${detail}|${seed}`, flags = `${hasSauce ? 1 : 0}${hasCheese ? 1 : 0}`;
  const parts = [{ kind: 'dough', key: `pizza|dough|${base}`, y: 0, base: false, build: () => doughMesh(ctxFor(), detail) }];
  if (hasSauce) parts.push({ kind: 'sauce', key: `pizza|sauce|${base}`, y: 0, base: false, build: () => sauceMeshPizza(ctxFor(), detail) });
  if (hasCheese) parts.push({ kind: 'cheese', key: `pizza|cheese|${base}|${flags}`, y: 0, base: false, build: () => cheeseMeshPizza(ctxFor(), detail) });
  const earlier = [];
  for (const id of TOPPING_ORDER) {
    if (!q.has(id)) continue;
    const qi = q.get(id) - 1, sig = earlier.map(e => `${e.id}${e.qtyIdx}`).join(','), ear = earlier.slice();
    parts.push({ kind: 'topping:' + id, key: `pizza|top|${id}${qi}|${base}|${flags}|${sig}`, y: 0, base: false, build: () => toppingMesh(ctxFor(), id, qi, ear, detail) });
    earlier.push({ id, qtyIdx: qi });
  }
  const boardR = Rp * 1.12 + .012, bt = .016;
  parts.unshift({ kind: 'board', key: `board|${boardR.toFixed(4)}|${detail}`, y: -bt + .0004, base: true, build: () => boardMesh(boardR, bt, seed, detail) });
  return { parts, total: .026, radius: boardR * .86, extentH: [-bt, .026] };
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
  const visualAliases = type === 'pizza' ? {
    sauce: 'molho-tomate', molho: 'molho-tomate', 'tomato-sauce': 'molho-tomate',
    cheese: 'queijo-generico', queijo: 'queijo-generico', mozzarella: 'mussarela',
    cheddar: 'queijo-cheddar', parmesan: 'queijo-parmesao', 'queijo-parmesao': 'queijo-parmesao',
    gorgonzola: 'queijo-gorgonzola', provolone: 'queijo-provolone',
    pepperoni: 'calabresa', sausage: 'calabresa', bacon: 'bacon', chicken: 'frango',
    onion: 'cebola', tomato: 'tomate', corn: 'milho', olive: 'azeitona',
    mushroom: 'champignon', cream: 'requeijao', herb: 'oregano'
  } : type === 'burger' ? {
    bun: 'pao-brioche', bread: 'pao-brioche', patty: 'carne', beef: 'carne',
    cheddar: 'queijo-extra', cheese: 'queijo-extra', lettuce: 'alface',
    tomato: 'tomate-burger', sauce: 'molho-especial', onion: 'cebola-burger',
    bacon: 'bacon-burger', egg: 'ovo', pickle: 'picles'
  } : {};
  if (visualAliases[visual]) return { ...ingredient, id: visualAliases[visual] };
  const name = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const text = (id + ' ' + name).replace(/[^a-z0-9]+/g, ' ').trim();
  const has = (...terms) => terms.some(term => text.includes(term));
  const knownPizza = new Set(['molho-tomate','mussarela',...Object.keys(TOPPINGS)]);
  const knownBurger = new Set(['pao-brioche','carne','queijo-cheddar','alface','tomate-burger','molho-especial','picles','cebola-burger','queijo-extra','bacon-burger','ovo']);
  if ((type === 'pizza' && knownPizza.has(id)) || (type === 'burger' && knownBurger.has(id))) return { ...ingredient };
  let visualId = '';
  if (type === 'pizza') {
    if (has('molho','sauce')) visualId = 'molho-tomate';
    else if (has('catupiry','requeijao','cream cheese','creme de queijo','cream')) visualId = 'requeijao';
    else if (has('cheddar')) visualId = 'queijo-cheddar';
    else if (has('parmesao','parmesan','grana padano','pecorino')) visualId = 'queijo-parmesao';
    else if (has('gorgonzola','queijo azul','blue cheese','roquefort')) visualId = 'queijo-gorgonzola';
    else if (has('provolone')) visualId = 'queijo-provolone';
    else if (has('mussarela','mozzarella','mozzarela','bufala')) visualId = 'mussarela';
    else if (has('queijo','cheese','coalho')) visualId = 'queijo-generico';
    else if (has('calabresa','pepperoni','salame')) visualId = 'calabresa';
    else if (has('champignon','cogumelo','fungo','shimeji','shitake','portobello')) visualId = 'champignon';
    else if (has('frango','frango desfiado','chicken')) visualId = 'frango';
    else if (has('bacon','panceta','linguica')) visualId = 'bacon';
    else if (has('cebola','onion','alho','alho poro')) visualId = 'cebola';
    else if (has('azeitona','oliva','olive')) visualId = 'azeitona';
    else if (has('catupiry','requeijao','cream cheese','creme de queijo','cream')) visualId = 'requeijao';
    else if (has('milho','corn')) visualId = 'milho';
    else if (has('oregano','manjericao','salsinha','cebolinha','rucula','erva','herb')) visualId = 'oregano';
    else if (has('tomate','tomato','pimentao','pepper')) visualId = 'tomate';
    else if (has('alho frito','cebola crispy','crispy')) visualId = 'cebola';
  } else if (type === 'burger') {
    if (has('pao','brioche','bun')) visualId = 'pao-brioche';
    else if (has('carne','hamburguer','burger','patty','bovina')) visualId = 'carne';
    else if (has('cheddar','queijo','mussarela','mozzarella','prato','provolone','gorgonzola')) visualId = 'queijo-extra';
    else if (has('alface','lettuce','rucula')) visualId = 'alface';
    else if (has('tomate','tomato')) visualId = 'tomate-burger';
    else if (has('molho','maionese','ketchup','mostarda','barbecue','bbq','aioli')) visualId = 'molho-especial';
    else if (has('picles','pickle','pepino')) visualId = 'picles';
    else if (has('cebola','onion','alho')) visualId = 'cebola-burger';
    else if (has('bacon','panceta')) visualId = 'bacon-burger';
    else if (has('ovo','egg')) visualId = 'ovo';
    else if (has('frango','crispy chicken')) visualId = 'carne';
  } else if (type === 'plate') {
    if (has('queijo','cheddar','mussarela','catupiry','cream')) visualId = 'plate-cheese';
    else if (has('tomate','tomato','pimentao','pimenta')) visualId = 'plate-tomato';
    else if (has('bacon','calabresa','linguica','salame')) visualId = 'plate-bacon';
    else if (has('alface','rucula','salada','salsinha','cebolinha','oregano','erva','verde')) visualId = 'plate-greens';
    else if (has('molho','maionese','ketchup','mostarda','barbecue','bbq','sauce')) visualId = 'plate-sauce';
    else if (has('carne','hamburguer','frango','chicken','proteina')) visualId = 'plate-protein';
    else if (has('ovo','egg')) visualId = 'plate-egg';
    else if (has('cebola','picles','pepino','azeitona','cogumelo','champignon')) visualId = 'plate-vegetable';
    else visualId = 'plate-piece';
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
      else if (/veget|verde/.test(group)) visualId = 'alface';
      else visualId = 'queijo-extra'; // peça genérica para nomes livres sem correspondência conhecida
    }
  }
  return visualId ? { ...ingredient, id: visualId } : { ...ingredient };
}

export function buildFoodLayout(product, ingredients, size, options = {}) {
  const o = { detail: options.detail || 1, crustKey: options.crustKey };
  const type = product.type;
  const combined = new Map();
  for (const original of (ingredients || [])) {
    const item = resolveVisualIngredient(type, original);
    const previous = combined.get(item.id);
    if (previous) previous.quantity = clamp((Number(previous.quantity) || 1) + (Number(item.quantity) || 1), 1, 3);
    else combined.set(item.id, { ...item, quantity: clamp(Number(item.quantity) || 1, 1, 3) });
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
    bounds = [(Number(product.widthCm) || 12) / 100, H, (Number(product.depthCm) || 12) / 100];
  } else {
    layout = plateLayout(product, list, size, o);
    bounds = [(Number(product.widthCm) || 20) / 100, (Number(product.heightCm) || 4) / 100, (Number(product.depthCm) || 20) / 100];
  }
  return { type: type === 'pizza' || type === 'burger' ? type : 'plate', parts: layout.parts, bounds, hint: { radius: layout.radius, minY: layout.extentH[0], maxY: layout.extentH[1] } };
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
