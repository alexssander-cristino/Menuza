// Menuza — visualizador 3D de alimentos (WebGL puro, sem dependências).
//  • Modelos procedurais por ingrediente (food-models.js) com cache por peça.
//  • Shader PBR (GGX + Fresnel) com iluminação de estúdio procedural, relevo procedural, translucidez,
//    sombras suaves por mapa de profundidade (WebGL2), tone mapping ACES e MSAA.
//  • Controles de órbita reais (mouse, toque, pinça, roda, teclado) com amortecimento e inércia.
import { buildFoodLayout, buildFoodGeometry } from './food-models.js?v=1';
export { buildFoodGeometry };

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const norm3 = a => { const d = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / d, a[1] / d, a[2] / d]; };
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function mat4Identity() { return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); }
function mat4Multiply(a, b) { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]; return o; }
function mat4Perspective(fovy, aspect, near, far) { const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far), o = new Float32Array(16); o[0] = f / aspect; o[5] = f; o[10] = (far + near) * nf; o[11] = -1; o[14] = 2 * far * near * nf; return o; }
function mat4Ortho(l, r, b, t, n, f) { const o = new Float32Array(16); o[0] = 2 / (r - l); o[5] = 2 / (t - b); o[10] = -2 / (f - n); o[12] = -(r + l) / (r - l); o[13] = -(t + b) / (t - b); o[14] = -(f + n) / (f - n); o[15] = 1; return o; }
function mat4LookAt(eye, center, up) { const z = norm3(sub3(eye, center)), x = norm3(cross3(up, z)), y = cross3(z, x), o = mat4Identity(); o[0] = x[0]; o[1] = y[0]; o[2] = z[0]; o[4] = x[1]; o[5] = y[1]; o[6] = z[1]; o[8] = x[2]; o[9] = y[2]; o[10] = z[2]; o[12] = -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]); o[13] = -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]); o[14] = -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]); return o; }
function mat4Translate(x, y, z) { const m = mat4Identity(); m[12] = x; m[13] = y; m[14] = z; return m; }
function mat4RotateY(angle) { const c = Math.cos(angle), s = Math.sin(angle); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); }
// Ry(yaw) · T(tx,ty,tz) · S(s)
function partMatrix(yaw, s, tx, ty, tz) {
  const c = Math.cos(yaw), sn = Math.sin(yaw), m = new Float32Array(16);
  m[0] = c * s; m[2] = -sn * s; m[5] = s; m[8] = sn * s; m[10] = c * s; m[15] = 1;
  m[12] = c * tx + sn * tz; m[13] = ty; m[14] = -sn * tx + c * tz;
  return m;
}

// ---------------- shaders ----------------
const VS = `
attribute vec3 aPosition; attribute vec3 aNormal; attribute vec3 aColor; attribute vec4 aMat;
uniform mat4 uProj; uniform mat4 uView; uniform mat4 uModel;
varying vec3 vWorld; varying vec3 vLocal; varying vec3 vNormal; varying vec3 vColor; varying vec4 vMat;
void main(){
  vec4 w = uModel * vec4(aPosition, 1.0);
  vWorld = w.xyz; vLocal = aPosition; vNormal = mat3(uModel) * aNormal; vColor = aColor; vMat = aMat;
  gl_Position = uProj * uView * w;
}`;
const VS_DEPTH = `
attribute vec3 aPosition; uniform mat4 uLightVP; uniform mat4 uModel;
void main(){ gl_Position = uLightVP * uModel * vec4(aPosition, 1.0); }`;
const FS_DEPTH = `void main(){ OUT = vec4(1.0); }`;
const FS = `
uniform vec3 uCam; uniform vec3 uKey; uniform vec3 uFill; uniform vec3 uRim;
uniform mat4 uLightVP; uniform float uShadowOn; uniform vec2 uTexel; uniform float uQuality; uniform float uExposure; uniform int uMode; uniform vec4 uBlob;
#ifdef SHADOW
uniform sampler2DShadow uShadow;
#endif
varying vec3 vWorld; varying vec3 vLocal; varying vec3 vNormal; varying vec3 vColor; varying vec4 vMat;

float h31(vec3 p){ p = fract(p * vec3(.1031, .1030, .0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
float vn(vec3 p){
  vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z);
}
// Estúdio procedural: gradiente suave + três "softboxes" que aparecem nos reflexos das superfícies brilhantes.
vec3 env(vec3 d, float rough){
  float y = d.y;
  vec3 top = vec3(.92, .90, .88), hor = vec3(.34, .32, .33), bot = vec3(.10, .085, .08);
  vec3 c = y > 0. ? mix(hor, top, pow(y, .75)) : mix(hor, bot, pow(-y, .6));
  float gloss = 1. - rough, sharp = mix(3., 80., gloss * gloss);
  c += vec3(5.5, 5.1, 4.6) * pow(max(dot(d, normalize(vec3(-.5, .8, .55))), 0.), sharp) * gloss * .5;
  c += vec3(1.9, 2.1, 2.5) * pow(max(dot(d, normalize(vec3(.85, .3, .4))), 0.), sharp) * gloss * .45;
  c += vec3(2.8) * pow(max(dot(d, normalize(vec3(.15, .45, -.9))), 0.), sharp) * gloss * .35;
  return c;
}
float shadowTaps(vec3 wp, vec3 n, float spread, int r){
#ifdef SHADOW
  if (uShadowOn < .5) return 1.0;
  vec4 lp = uLightVP * vec4(wp + n * 0.0014, 1.0);
  vec3 s = lp.xyz / lp.w * .5 + .5;
  if (s.x < 0. || s.x > 1. || s.y < 0. || s.y > 1. || s.z >= 1.) return 1.0;
  float sum = 0.; float cnt = 0.;
  for (int i = -2; i <= 2; i++) for (int j = -2; j <= 2; j++) {
    if (abs(i) > r || abs(j) > r) continue;
    sum += texture(uShadow, vec3(s.xy + vec2(float(i), float(j)) * uTexel * spread, s.z - 0.0006)); cnt += 1.;
  }
  return sum / cnt;
#else
  return 1.0;
#endif
}
vec3 aces(vec3 x){ return clamp((x * (2.51 * x + .03)) / (x * (2.43 * x + .59) + .14), 0., 1.); }

void main(){
  if (uMode == 2) { // sombra de contato projetada no "tampo da mesa"
    float d = length(vWorld.xz - uBlob.xy);
    float blob = exp(-pow(d / uBlob.z, 2.) * 1.5) * uBlob.w;
    float sh = 1. - shadowTaps(vWorld, vec3(0., 1., 0.), 2.6, 2);
    float fade = 1. - smoothstep(uBlob.z * .9, uBlob.z * 2.4, d);
    float a = clamp(blob * .5 + sh * .55 * fade, 0., .62);
    OUT = vec4(vec3(.05, .035, .08) * a, a);
    return;
  }
  vec3 N = normalize(vNormal); if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(uCam - vWorld);
  vec3 albedo = vColor; float rough = clamp(vMat.x, .06, 1.), sss = vMat.y, bump = vMat.z, ao = vMat.w;
  if (uMode == 1) { // madeira da tábua
    vec3 q = vLocal; float warp = vn(q * vec3(5., 22., 5.)) * 1.6;
    float g = sin((q.x * 140. + warp * 7.)) * .5 + .5, fine = vn(q * vec3(420., 14., 420.));
    float ring = smoothstep(.35, .95, g);
    albedo = mix(vec3(.022, .010, .005), vec3(.07, .035, .017), ring * .5 + fine * .3);
    rough = .5 + fine * .18; bump = .6;
  }
  if (bump > .01) {
    vec3 q = vLocal * (uQuality > .5 ? 400. : 250.);
    float n0 = vn(q);
    vec3 g = vec3(vn(q + vec3(.5,0,0)) - n0, vn(q + vec3(0,.5,0)) - n0, vn(q + vec3(0,0,.5)) - n0) / .5;
    if (uQuality > .5) { vec3 q2 = q * 2.9; float m0 = vn(q2); g += .5 * vec3(vn(q2 + vec3(.5,0,0)) - m0, vn(q2 + vec3(0,.5,0)) - m0, vn(q2 + vec3(0,0,.5)) - m0) / .5; albedo *= 1. + (m0 - .5) * .12 * bump; }
    g -= N * dot(g, N);
    N = normalize(N - g * bump * .085);
    albedo *= 1. + (n0 - .5) * .2 * bump;
  }
  float NoV = clamp(dot(N, V), .001, 1.);
  vec3 F0 = vec3(.04);
  vec3 Fr = F0 + (max(vec3(1. - rough), F0) - F0) * pow(1. - NoV, 5.);
  vec3 col = albedo * env(N, 1.) * ao * .5 * (1. - Fr);
  vec3 R = reflect(-V, N);
  col += env(R, rough) * Fr * mix(1., ao, .75) * .55;
  // luzes direcionais: principal (com sombra), preenchimento e recorte
  float sh = shadowTaps(vWorld, N, 1.25, 1);
  for (int k = 0; k < 3; k++) {
    vec3 L = k == 0 ? uKey : (k == 1 ? uFill : uRim);
    vec3 Lc = k == 0 ? vec3(1.0, .915, .80) * 2.05 : (k == 1 ? vec3(.55, .62, .80) * .38 : vec3(1.0, .95, .9) * .85);
    float s = k == 0 ? mix(1., sh, .96) : 1.;
    vec3 H = normalize(L + V); float NoL = dot(N, L), NoLc = max(NoL, 0.);
    float wrap = sss * .45, dl = clamp((NoL + wrap) / (1. + wrap), 0., 1.);
    float a = rough * rough, a2 = a * a, NoH = max(dot(N, H), 0.), dd = NoH * NoH * (a2 - 1.) + 1.;
    float D = a2 / (3.14159 * dd * dd);
    float kk = (rough + 1.) * (rough + 1.) / 8.;
    float G = (NoV / (NoV * (1. - kk) + kk)) * (NoLc / (NoLc * (1. - kk) + kk));
    vec3 F = F0 + (1. - F0) * pow(1. - max(dot(H, V), 0.), 5.);
    vec3 spec = D * G * F / max(4. * NoV * NoLc, .001) * NoLc;
    vec3 trans = albedo * vec3(1., .72, .42) * sss * pow(clamp(dot(V, -L), 0., 1.), 2.) * .5;
    col += (albedo * dl * (1. - F) * ao + spec + trans) * Lc * s;
  }
  vec3 c = aces(col * uExposure);
  c = pow(c, vec3(1. / 2.2));
  OUT = vec4(c, 1.);
}`;

function shaderSources(webgl2) {
  const vh = webgl2 ? '#version 300 es\n#define attribute in\n#define varying out\n' : '';
  const fh = webgl2
    ? '#version 300 es\nprecision highp float;\nprecision highp sampler2DShadow;\n#define varying in\nout vec4 oColor;\n#define OUT oColor\n#define SHADOW 1\n'
    : '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n#define OUT gl_FragColor\n';
  return { vs: vh + VS, fs: fh + FS, vsDepth: vh + VS_DEPTH, fsDepth: fh + FS_DEPTH };
}

const STRIDE = 13 * 4;
const KEY = norm3([-.5, .8, .55]), FILL = norm3([.85, .3, .4]), RIM = norm3([.15, .45, -.9]);
const MAX_CACHE_VERTS = 900000;

export class FoodScene {
  constructor(canvas, product, ingredients, size, hud, options = {}) {
    this.canvas = canvas; this.hud = hud;
    this.session = null; this.hitSource = null; this.referenceSpace = null; this.reticle = null; this.modelMatrix = mat4Identity(); this.arPlaced = false; this.xrEnding = false;
    this.reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const small = Math.min(screen.width || 1024, screen.height || 768) < 700, lowCores = (navigator.hardwareConcurrency || 8) <= 4;
    this.smallDevice = small;
    this.detail = options.detail || (small || lowCores ? .72 : 1);
    // Mobile keeps the interactive model but caps GPU fill-rate and avoids idle animation/battery drain.
    this.maxDpr = small ? 1 : 1.75; this.renderScale = 1; this.quality = small ? 0 : 1;
    // câmera / controles
    this.yaw = this.yawT = -.5; this.pitch = this.pitchT = .3; this.zoom = this.zoomT = 1; this.vYaw = 0; this.vPitch = 0;
    this.defYaw = -.5; this.defPitch = .3; this.dragging = false; this.pointers = new Map(); this.lastInteract = -1e9;
    this.autoRotate = !this.reduced && !this.smallDevice; this.autoSpeed = .27; this.autoBlend = 0;
    this.active = true; this.last = 0; this.raf = 0; this.frames = 0; this.slow = 0; this.fast = 0;
    this.cache = new Map(); this.parts = []; this.leaving = []; this.desired = []; this.queue = []; this.pumping = false;
    this.state = 'loading'; this.productKey = null; this.hint = { radius: .1, minY: 0, maxY: .05 }; this.fitR = .1; this.camY = .03;
    this.crustKey = undefined; this.disposed = false; this.readyWaiters = [];
    this.initGL();
    this.bindControls();
    this.resizeObserver = new ResizeObserver(() => this.schedule()); this.resizeObserver.observe(canvas);
    this.onVisibility = () => { if (document.hidden) { cancelAnimationFrame(this.raf); this.raf = 0; } else { this.last = 0; this.schedule(); } };
    document.addEventListener('visibilitychange', this.onVisibility);
    this.update(product, ingredients, size, options);
  }

  // ---------- GL ----------
  initGL() {
    const attrs = { alpha: true, antialias: !this.smallDevice, premultipliedAlpha: true, powerPreference: this.smallDevice ? 'low-power' : 'high-performance', preserveDrawingBuffer: false };
    this.gl = this.canvas.getContext('webgl2', attrs) || this.canvas.getContext('webgl', attrs);
    if (!this.gl) throw new Error('Este navegador não oferece WebGL para a prévia 3D.');
    const gl = this.gl;
    this.webgl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    if (!this.webgl2 && !gl.getExtension('OES_element_index_uint')) throw new Error('Este navegador não oferece os recursos WebGL necessários para a prévia 3D.');
    this.loseExt = gl.getExtension('WEBGL_lose_context');
    const src = shaderSources(this.webgl2);
    this.program = this.makeProgram(src.vs, src.fs);
    this.u = this.locations(this.program, ['uProj', 'uView', 'uModel', 'uCam', 'uKey', 'uFill', 'uRim', 'uLightVP', 'uShadowOn', 'uTexel', 'uQuality', 'uExposure', 'uMode', 'uBlob', 'uShadow']);
    this.shadowSize = this.webgl2 ? (this.smallDevice ? 512 : 1536) : 0;
    this.shadows = false;
    if (this.webgl2) {
      this.depthProgram = this.makeProgram(src.vsDepth, src.fsDepth);
      this.ud = this.locations(this.depthProgram, ['uLightVP', 'uModel']);
      this.initShadowMap();
    }
    this.ground = null;
    for (const e of this.cache.values()) e.gpu = null; // reenvio após perda de contexto
    this.onLost = e => { e.preventDefault(); this.lost = true; cancelAnimationFrame(this.raf); this.raf = 0; this.setState('lost'); };
    this.onRestored = () => { try { this.lost = false; this.initGL(); this.setState('ready'); this.schedule(); } catch (err) { this.setState('error', err.message); } };
    if (!this.ctxBound) { this.canvas.addEventListener('webglcontextlost', e => this.onLost(e)); this.canvas.addEventListener('webglcontextrestored', () => this.onRestored()); this.ctxBound = true; }
  }
  locations(program, names) { const o = {}; for (const n of names) o[n] = this.gl.getUniformLocation(program, n); return o; }
  makeProgram(vsSource, fsSource) {
    const gl = this.gl;
    const compile = (type, source) => { const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'Erro ao preparar o visualizador 3D.'); return s; };
    const vs = compile(gl.VERTEX_SHADER, vsSource), fs = compile(gl.FRAGMENT_SHADER, fsSource), p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs);
    ['aPosition', 'aNormal', 'aColor', 'aMat'].forEach((n, i) => gl.bindAttribLocation(p, i, n));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'Erro ao iniciar o visualizador 3D.');
    gl.deleteShader(vs); gl.deleteShader(fs);
    return p;
  }
  initShadowMap() {
    const gl = this.gl, S = this.shadowSize;
    this.shadowTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, S, S, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    this.shadowFbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTex, 0);
    gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
    this.shadows = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // ---------- estado / eventos ----------
  setState(state, message) {
    if (this.state === state && !message) return;
    this.state = state;
    try { this.canvas.dispatchEvent(new CustomEvent('foodscene', { detail: { state, message } })); } catch { /* ignore */ }
    if (state === 'ready') { const w = this.readyWaiters.splice(0); w.forEach(f => f()); }
  }
  whenReady() { return this.state === 'ready' && !this.queue.length ? Promise.resolve() : new Promise(r => this.readyWaiters.push(r)); }
  get debug() {
    let v = 0; for (const p of this.parts) v += p.entry.cpu.positions.length / 3;
    return { state: this.state, parts: this.parts.map(p => p.kind), vertices: v, cached: this.cache.size, shadows: this.shadows, webgl2: this.webgl2, frames: this.frames, yaw: this.yaw, pitch: this.pitch, zoom: this.zoom, autoRotate: this.autoRotate, renderScale: this.renderScale, queue: this.queue.length };
  }

  // ---------- modelo ----------
  update(product, ingredients, size, options = {}) {
    if (this.disposed) return;
    const crustKey = options.crustKey !== undefined ? options.crustKey : this.crustKey; this.crustKey = crustKey;
    const layout = buildFoodLayout(product, ingredients, size, { detail: this.detail, crustKey });
    const pk = `${product.id}|${layout.type}`;
    this.product = product; this.ingredients = ingredients; this.size = size; this.model = { bounds: layout.bounds, type: layout.type };
    if (pk !== this.productKey) { // outro produto: limpa a cena e reinicia o enquadramento
      this.productKey = pk; this.parts = []; this.leaving = [];
      this.defPitch = layout.type === 'pizza' ? .62 : layout.type === 'burger' ? .27 : .55; this.defYaw = -.5;
      this.camY = (layout.hint.minY + layout.hint.maxY) / 2; this.fitR = layout.hint.radius;
      if (!this.hadView) { this.yaw = this.yawT = this.defYaw; this.pitch = this.pitchT = this.defPitch; this.hadView = true; }
    }
    this.hint = layout.hint; this.desired = layout.parts;
    this.syncActive();
    const need = layout.parts.filter(p => !this.cache.has(p.key) && !this.queue.some(q => q.key === p.key));
    if (need.length) { this.queue.push(...need); if (this.state !== 'loading' && !this.parts.length) this.setState('loading'); this.pump(); }
    else if (!this.queue.length) this.setState('ready');
    this.schedule();
  }
  pump() {
    if (this.pumping || this.disposed) return;
    this.pumping = true;
    const step = () => {
      if (this.disposed) return;
      const next = this.queue.shift();
      if (!next) { this.pumping = false; this.syncActive(); this.setState('ready'); this.schedule(); return; }
      if (!this.cache.has(next.key) && this.desired.some(d => d.key === next.key)) {
        try {
          const cpu = next.build();
          this.cache.set(next.key, { key: next.key, cpu, gpu: null, used: performance.now() });
          this.evict();
        } catch (error) { console.error('Menuza 3D:', error); this.pumping = false; this.queue.length = 0; this.setState('error', error.message || 'Não foi possível montar o modelo 3D.'); return; }
        this.syncActive(); this.schedule();
      }
      setTimeout(step, 0);
    };
    setTimeout(step, 0);
  }
  syncActive() {
    const have = new Map(this.parts.map(p => [p.key, p])), next = [], now = performance.now();
    for (const d of this.desired) {
      const p = have.get(d.key);
      if (p) { p.ty = d.y; p.tx = d.x || 0; p.tz = d.z || 0; have.delete(d.key); next.push(p); continue; }
      const entry = this.cache.get(d.key);
      if (entry) next.push({ key: d.key, kind: d.kind, base: d.base, entry, tx: d.x || 0, tz: d.z || 0, ty: d.y, y: d.y, born: d.base || this.reduced ? -1e9 : now });
    }
    for (const p of have.values()) if (!this.reduced && !p.base) this.leaving.push({ ...p, leaveAt: now });
    this.parts = next;
  }
  evict() {
    let total = 0; for (const e of this.cache.values()) total += e.cpu.positions.length / 3;
    if (total <= MAX_CACHE_VERTS) return;
    const inUse = new Set([...this.parts.map(p => p.key), ...this.desired.map(d => d.key)]);
    for (const [k, e] of [...this.cache.entries()].sort((a, b) => a[1].used - b[1].used)) {
      if (total <= MAX_CACHE_VERTS * .7) break;
      if (inUse.has(k)) continue;
      this.freeGpu(e); total -= e.cpu.positions.length / 3; this.cache.delete(k);
    }
  }
  freeGpu(e) { const gl = this.gl; if (gl && e.gpu) { gl.deleteBuffer(e.gpu.vbo); gl.deleteBuffer(e.gpu.ibo); } e.gpu = null; }
  ensureGpu(e) {
    if (e.gpu) return e.gpu;
    const gl = this.gl, c = e.cpu, n = c.positions.length / 3, data = new Float32Array(n * 13);
    for (let i = 0; i < n; i++) {
      const o = i * 13;
      data[o] = c.positions[i * 3]; data[o + 1] = c.positions[i * 3 + 1]; data[o + 2] = c.positions[i * 3 + 2];
      data[o + 3] = c.normals[i * 3]; data[o + 4] = c.normals[i * 3 + 1]; data[o + 5] = c.normals[i * 3 + 2];
      data[o + 6] = c.colors[i * 3]; data[o + 7] = c.colors[i * 3 + 1]; data[o + 8] = c.colors[i * 3 + 2];
      data[o + 9] = c.materials[i * 4]; data[o + 10] = c.materials[i * 4 + 1]; data[o + 11] = c.materials[i * 4 + 2]; data[o + 12] = c.materials[i * 4 + 3];
    }
    const vbo = gl.createBuffer(), ibo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, c.indices, gl.STATIC_DRAW);
    e.gpu = { vbo, ibo, count: c.indices.length };
    return e.gpu;
  }
  makeGround() {
    const gl = this.gl, data = [];
    for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) data.push(x, 0, z, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0); // pos, normal, cor, material
    const vbo = gl.createBuffer(), ibo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
    this.ground = { vbo, ibo, count: 6 };
  }
  bindMesh(g) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, g.vbo); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.ibo);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, STRIDE, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, STRIDE, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, STRIDE, 24);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, STRIDE, 36);
  }

  // ---------- controles ----------
  bindControls() {
    const c = this.canvas; c.style.touchAction = 'none'; c.style.cursor = 'grab'; c.tabIndex = 0;
    c.setAttribute('role', 'application'); c.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight ArrowUp ArrowDown + - 0 Space');
    c.setAttribute('aria-description', 'Visualizador 3D. Arraste ou use as setas para girar, mais e menos para o zoom, zero para voltar à vista inicial e espaço para ligar ou pausar a rotação automática.');
    const L = this.listeners = [];
    const on = (t, f, o) => { c.addEventListener(t, f, o); L.push([t, f, o]); };
    on('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      try { c.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
      this.dragging = true; this.vYaw = 0; this.vPitch = 0; this.touch(); c.style.cursor = 'grabbing';
      if (this.pointers.size === 2) { const [a, b] = [...this.pointers.values()]; this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: this.zoomT }; }
    });
    on('pointermove', e => {
      const p = this.pointers.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y, now = performance.now(), dt = Math.max(.004, (now - p.t) / 1000);
      p.x = e.clientX; p.y = e.clientY; p.t = now;
      if (this.pointers.size >= 2 && this.pinch) {
        const [a, b] = [...this.pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
        this.zoomT = clamp(this.pinch.z * d / Math.max(10, this.pinch.d), .7, 2.6);
      } else {
        const ky = .0078, kp = .0056;
        this.yawT += dx * ky; this.pitchT = clamp(this.pitchT + dy * kp, .06, 1.38);
        this.vYaw = lerp(this.vYaw, clamp(dx * ky / dt, -7, 7), .5); this.vPitch = lerp(this.vPitch, clamp(dy * kp / dt, -3, 3), .5);
      }
      this.touch(); this.schedule(); e.preventDefault();
    });
    const up = e => {
      if (!this.pointers.delete(e.pointerId)) return;
      this.pinch = null;
      if (!this.pointers.size) { this.dragging = false; c.style.cursor = 'grab'; if (performance.now() - (this.lastMove || 0) > 90) { /* sem inércia se parou antes de soltar */ } }
      else { const [r] = [...this.pointers.values()]; r.t = performance.now(); }
      this.touch(); this.schedule();
    };
    on('pointerup', up); on('pointercancel', up); on('lostpointercapture', up);
    on('wheel', e => { e.preventDefault(); this.zoomT = clamp(this.zoomT * Math.exp(-e.deltaY * (e.ctrlKey ? .01 : .0012)), .7, 2.6); this.touch(); this.schedule(); }, { passive: false });
    on('dblclick', () => this.resetView());
    on('keydown', e => {
      const k = e.key; let used = true;
      if (k === 'ArrowLeft') this.rotateBy(-12); else if (k === 'ArrowRight') this.rotateBy(12);
      else if (k === 'ArrowUp') this.tiltBy(-5); else if (k === 'ArrowDown') this.tiltBy(5);
      else if (k === '+' || k === '=') this.zoomBy(1.12); else if (k === '-' || k === '_') this.zoomBy(1 / 1.12);
      else if (k === '0' || k === 'Home') this.resetView(); else if (k === ' ') this.toggleAuto();
      else used = false;
      if (used) e.preventDefault();
    });
  }
  touch() { this.lastInteract = performance.now(); if (!this.canvas.dataset.interacted) { this.canvas.dataset.interacted = '1'; } }
  rotateBy(deg) { this.yawT += deg * Math.PI / 180; this.vYaw = 0; this.touch(); this.schedule(); }
  tiltBy(deg) { this.pitchT = clamp(this.pitchT + deg * Math.PI / 180, .06, 1.38); this.touch(); this.schedule(); }
  zoomBy(f) { this.zoomT = clamp(this.zoomT * f, .7, 2.6); this.touch(); this.schedule(); }
  setAngle(angle) { this.yaw = this.yawT = angle; this.schedule(); }
  setZoom(z) { this.zoom = this.zoomT = clamp(z, .7, 2.6); this.schedule(); }
  resetView() {
    this.yawT = this.defYaw + TAU * Math.round((this.yaw - this.defYaw) / TAU); this.pitchT = this.defPitch; this.zoomT = 1; this.vYaw = this.vPitch = 0;
    this.touch(); this.schedule();
  }
  setAutoRotate(on) { this.autoRotate = !!on; this.lastInteract = -1e9; this.canvas.dispatchEvent(new CustomEvent('foodscene-auto', { detail: { on: this.autoRotate } })); this.schedule(); }
  toggleAuto() { this.setAutoRotate(!this.autoRotate); return this.autoRotate; }
  setActive(on) { this.active = !!on; if (on) { this.last = 0; this.schedule(); } else { cancelAnimationFrame(this.raf); this.raf = 0; } }

  // ---------- laço de renderização (sob demanda) ----------
  schedule() { if (!this.raf && this.active && !this.disposed && !this.session && !this.lost && !document.hidden) this.raf = requestAnimationFrame(t => this.frame(t)); }
  animating(now) { return this.parts.some(p => Math.abs(p.ty - p.y) > 2e-5 || now - p.born < 420) || this.leaving.length > 0; }
  needsFrame(now) {
    const auto = this.autoRotate && !this.dragging && now - this.lastInteract > 2200 && !this.reduced;
    return auto || this.dragging || Math.abs(this.vYaw) > .02 || Math.abs(this.yawT - this.yaw) > 1e-4 || Math.abs(this.pitchT - this.pitch) > 1e-4 || Math.abs(this.zoomT - this.zoom) > 1e-4 || this.animating(now) || this.queue.length > 0 || Math.abs(this.fitR - this.hint.radius) > 1e-4;
  }
  frame(now) {
    this.raf = 0; if (!this.gl || this.session || this.lost || this.disposed) return;
    const dt = this.last ? Math.min(.05, (now - this.last) / 1000) : .016; this.last = now;
    const idle = now - this.lastInteract > 2200;
    if (!this.dragging) { this.yawT += this.vYaw * dt; this.vYaw *= Math.exp(-dt * 3.4); if (Math.abs(this.vYaw) < .02) this.vYaw = 0; this.pitchT = clamp(this.pitchT + this.vPitch * dt, .06, 1.38); this.vPitch *= Math.exp(-dt * 5); if (Math.abs(this.vPitch) < .02) this.vPitch = 0; }
    const wantAuto = this.autoRotate && !this.dragging && idle && !this.reduced && !this.vYaw;
    this.autoBlend += ((wantAuto ? 1 : 0) - this.autoBlend) * (1 - Math.exp(-dt * 2.2));
    if (this.autoBlend > .001) this.yawT += this.autoSpeed * this.autoBlend * dt;
    this.yaw += (this.yawT - this.yaw) * (1 - Math.exp(-dt * (this.dragging ? 28 : 11)));
    this.pitch += (this.pitchT - this.pitch) * (1 - Math.exp(-dt * 12));
    this.zoom += (this.zoomT - this.zoom) * (1 - Math.exp(-dt * 10));
    const cy = (this.hint.minY + this.hint.maxY) / 2;
    this.camY += (cy - this.camY) * (1 - Math.exp(-dt * 6)); this.fitR += (this.hint.radius - this.fitR) * (1 - Math.exp(-dt * 6));
    for (const p of this.parts) p.y += (p.ty - p.y) * (1 - Math.exp(-dt * 14));
    this.leaving = this.leaving.filter(p => now - p.leaveAt < 240);
    this.draw(now);
    this.frames++;
    // resolução adaptativa
    if (this.autoBlend > .05 || this.dragging) {
      const ms = dt * 1000; this.slow = ms > 30 ? this.slow + 1 : Math.max(0, this.slow - 1); this.fast = ms < 18 ? this.fast + 1 : 0;
      if (this.slow > 40 && this.renderScale > .62) { this.renderScale = Math.max(.62, this.renderScale * .85); this.slow = 0; if (this.quality) this.quality = 0; }
      else if (this.fast > 240 && this.renderScale < 1) { this.renderScale = Math.min(1, this.renderScale * 1.1); this.fast = 0; }
    }
    if (this.needsFrame(now)) this.schedule(); else this.last = 0;
  }
  lightMatrix(center, Rs) {
    const e = Rs * 1.4, eye = [center[0] + KEY[0] * Rs * 3, center[1] + KEY[1] * Rs * 3, center[2] + KEY[2] * Rs * 3];
    return mat4Multiply(mat4Ortho(-e, e, -e, e, Rs * .4, Rs * 6.5), mat4LookAt(eye, center, [0, 1, 0]));
  }
  sceneRadius() { const r = this.fitR, hh = (this.hint.maxY - this.hint.minY) / 2; return Math.max(r * .95, Math.sqrt(r * r * .5 + hh * hh)); }
  drawList(now, ar = false) {
    const list = [];
    for (const p of this.parts) {
      if (ar && p.kind === 'board') continue;
      const t = p.base || this.reduced ? 1 : clamp((now - p.born) / 380, 0, 1), e = 1 - (1 - t) ** 3;
      list.push({ p, scale: p.base ? 1 : .88 + .12 * e, dy: p.base ? 0 : (1 - e) * .03 });
    }
    for (const p of this.leaving) { const t = clamp((now - p.leaveAt) / 240, 0, 1); list.push({ p, scale: Math.max(.001, 1 - t), dy: t * .02 }); }
    return list;
  }
  draw(now) {
    const gl = this.gl, canvas = this.canvas;
    if (!canvas.isConnected || !canvas.clientWidth || !canvas.clientHeight) return;
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr) * this.renderScale;
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const Rs = this.sceneRadius(), aspect = w / h, fovy = 28 * Math.PI / 180, fovx = 2 * Math.atan(Math.tan(fovy / 2) * aspect);
    const fit = Rs / Math.sin(Math.min(fovy, fovx) / 2) * 1.2, dist = Math.max(Rs * 1.18, fit / this.zoom);
    const target = [0, this.camY, 0], cp = Math.cos(this.pitch), eye = [0, this.camY + Math.sin(this.pitch) * dist, cp * dist];
    const proj = mat4Perspective(fovy, aspect, Math.max(.004, dist * .08), dist * 8), view = mat4LookAt(eye, target, [0, 1, 0]);
    const list = this.drawList(now), lightVP = this.lightMatrix(target, Rs);
    // 1) mapa de sombra
    const useShadow = this.shadows && this.webgl2;
    if (useShadow) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo); gl.viewport(0, 0, this.shadowSize, this.shadowSize);
      gl.clear(gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.colorMask(false, false, false, false); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(2.5, 5);
      gl.useProgram(this.depthProgram); gl.uniformMatrix4fv(this.ud.uLightVP, false, lightVP);
      for (const it of list) { const g = this.ensureGpu(it.p.entry); this.bindMesh(g); gl.uniformMatrix4fv(this.ud.uModel, false, partMatrix(this.yaw, it.scale, it.p.tx, it.p.y + it.dy, it.p.tz)); gl.drawElements(gl.TRIANGLES, g.count, gl.UNSIGNED_INT, 0); }
      gl.disable(gl.POLYGON_OFFSET_FILL); gl.colorMask(true, true, true, true); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    // 2) cena
    gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    this.useScene(proj, view, eye, lightVP, useShadow);
    if (!this.ground) this.makeGround();
    const gy = this.hint.minY - .0008, gs = Rs * 3.2;
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
    gl.uniform1i(this.u.uMode, 2); gl.uniform4f(this.u.uBlob, 0, 0, Math.max(.05, this.hint.radius * .92), .55);
    this.bindMesh(this.ground);
    gl.uniformMatrix4fv(this.u.uModel, false, new Float32Array([gs, 0, 0, 0, 0, 1, 0, 0, 0, 0, gs, 0, 0, gy, 0, 1]));
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_INT, 0);
    gl.depthMask(true); gl.disable(gl.BLEND);
    for (const it of list) {
      const e = it.p.entry; e.used = now;
      gl.uniform1i(this.u.uMode, it.p.kind === 'board' ? 1 : 0);
      const g = this.ensureGpu(e); this.bindMesh(g);
      gl.uniformMatrix4fv(this.u.uModel, false, partMatrix(this.yaw, it.scale, it.p.tx, it.p.y + it.dy, it.p.tz));
      gl.drawElements(gl.TRIANGLES, g.count, gl.UNSIGNED_INT, 0);
    }
  }
  useScene(proj, view, eye, lightVP, useShadow) {
    const gl = this.gl, u = this.u;
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(u.uProj, false, proj); gl.uniformMatrix4fv(u.uView, false, view); gl.uniform3fv(u.uCam, eye);
    gl.uniform3fv(u.uKey, KEY); gl.uniform3fv(u.uFill, FILL); gl.uniform3fv(u.uRim, RIM);
    gl.uniform1f(u.uExposure, .92); gl.uniform1f(u.uQuality, this.quality);
    if (this.webgl2) {
      gl.uniformMatrix4fv(u.uLightVP, false, lightVP); gl.uniform1f(u.uShadowOn, useShadow ? 1 : 0); gl.uniform2f(u.uTexel, 1 / this.shadowSize, 1 / this.shadowSize);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.shadowTex); gl.uniform1i(u.uShadow, 0);
    }
  }

  // ---------- AR (WebXR) ----------
  async supportsAR() { try { return Boolean(navigator.xr && await navigator.xr.isSessionSupported('immersive-ar')); } catch { return false; } }
  async enterAR() {
    if (!navigator.xr) throw new Error('Este navegador não oferece WebXR. Use a prévia 3D interativa.');
    const session = await navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['hit-test'], optionalFeatures: ['dom-overlay'], domOverlay: { root: this.hud } });
    this.session = session; this.arPlaced = false;
    try {
      this.canvas.classList.add('ar-hidden-canvas'); this.hud?.classList.add('ar-active');
      if (this.hud) this.hud.innerHTML = '<strong>Mova o telefone para localizar uma superfície</strong><span>Quando ela for detectada, toque para posicionar o prato em escala real.</span><button type="button" data-action="exit-ar">Voltar ao menu</button>';
      await this.gl.makeXRCompatible();
      const layer = new XRWebGLLayer(session, this.gl, { alpha: true, depth: true, antialias: true }); session.updateRenderState({ baseLayer: layer });
      this.referenceSpace = await session.requestReferenceSpace('local');
      const viewerSpace = await session.requestReferenceSpace('viewer');
      this.hitSource = await session.requestHitTestSource({ space: viewerSpace });
      this.modelMatrix = mat4Identity();
      session.addEventListener('select', () => { if (this.reticle) { this.arPlaced = true; if (this.hud) { this.hud.innerHTML = '<strong>Prato posicionado em escala real</strong><span>Você pode observar o modelo ao redor.</span><button type="button" data-action="exit-ar">Voltar ao menu</button>'; delete this.hud.dataset.surface; } } });
      session.addEventListener('end', () => this.endAR(), { once: true });
      session.requestAnimationFrame((t, f) => this.onXRFrame(t, f));
    } catch (error) {
      this.session = null; this.hitSource?.cancel?.(); this.hitSource = null; this.canvas.classList.remove('ar-hidden-canvas'); this.hud?.classList.remove('ar-active'); if (this.hud) this.hud.innerHTML = '';
      try { await session.end(); } catch { /* ignore */ }
      throw error;
    }
  }
  onXRFrame(time, frame) {
    const session = frame.session; if (this.session !== session) return;
    session.requestAnimationFrame((t, f) => this.onXRFrame(t, f));
    const pose = frame.getViewerPose(this.referenceSpace); if (!pose) return;
    if (!this.arPlaced && this.hitSource) {
      const hits = frame.getHitTestResults(this.hitSource);
      if (hits.length) { const hitPose = hits[0].getPose(this.referenceSpace); this.reticle = hitPose.transform.matrix; this.modelMatrix = new Float32Array(this.reticle); if (this.hud) this.hud.dataset.surface = 'found'; }
      else { this.reticle = null; if (this.hud) this.hud.dataset.surface = 'searching'; }
    }
    const gl = this.gl, layer = session.renderState.baseLayer, now = performance.now();
    gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer); gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const list = this.drawList(now, true), yaw = mat4RotateY(this.yaw), placement = mat4Multiply(this.modelMatrix, yaw);
    for (const v of pose.views) {
      const vp = layer.getViewport(v); gl.viewport(vp.x, vp.y, vp.width, vp.height);
      this.useScene(new Float32Array(v.projectionMatrix), new Float32Array(v.transform.inverse.matrix), [v.transform.position.x, v.transform.position.y, v.transform.position.z], mat4Identity(), false);
      gl.uniform1i(this.u.uMode, 0);
      for (const it of list) { const g = this.ensureGpu(it.p.entry); this.bindMesh(g); gl.uniformMatrix4fv(this.u.uModel, false, mat4Multiply(placement, partMatrix(0, it.scale, it.p.tx, it.p.y, it.p.tz))); gl.drawElements(gl.TRIANGLES, g.count, gl.UNSIGNED_INT, 0); }
    }
  }
  async endAR() {
    if (this.xrEnding) return; this.xrEnding = true;
    this.session = null; this.hitSource?.cancel?.(); this.hitSource = null; this.referenceSpace = null; this.reticle = null; this.arPlaced = false;
    this.canvas.classList.remove('ar-hidden-canvas'); this.hud?.classList.remove('ar-active'); if (this.hud) { this.hud.innerHTML = ''; delete this.hud.dataset.surface; }
    this.xrEnding = false; this.last = 0; this.schedule();
  }
  async exitAR() { if (this.session) { const s = this.session; this.session = null; try { await s.end(); } catch { /* ignore */ } this.endAR(); } }

  // ---------- liberação de recursos ----------
  dispose() {
    if (this.disposed) return; this.disposed = true;
    cancelAnimationFrame(this.raf); this.raf = 0; this.queue.length = 0;
    this.resizeObserver?.disconnect(); document.removeEventListener('visibilitychange', this.onVisibility);
    for (const [t, f, o] of this.listeners || []) this.canvas.removeEventListener(t, f, o);
    this.exitAR();
    const gl = this.gl;
    if (gl) {
      for (const e of this.cache.values()) this.freeGpu(e);
      if (this.ground) { gl.deleteBuffer(this.ground.vbo); gl.deleteBuffer(this.ground.ibo); }
      if (this.shadowTex) gl.deleteTexture(this.shadowTex); if (this.shadowFbo) gl.deleteFramebuffer(this.shadowFbo);
      gl.deleteProgram(this.program); if (this.depthProgram) gl.deleteProgram(this.depthProgram);
      try { this.loseExt?.loseContext(); } catch { /* ignore */ }
    }
    this.cache.clear(); this.parts = []; this.leaving = []; this.gl = null;
  }
}
