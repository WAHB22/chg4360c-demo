// SAO world: a floating tiered island, ICON plaza, 11 buildings and bot orbs.
// Low poly, all geometry generated here (no outside assets).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export const PAL = {
  blue: 0x2f7bff, cyan: 0x39e6ff, orange: 0xff7a1a, white: 0xf2fbff,
  navy: 0x2d63c2, steel: 0xf0e9d8, pale: 0x9fdcf2, yellow: 0xffc400,
};
const STATE_COLOR = { working: PAL.blue, blocked: PAL.orange, waiting: PAL.white };
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const DAY = 86400000;
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

const CAMPUS = { x: -8.6, z: 1 };
export const LAYOUT = {
  icon: { x: 0, z: 0, r: 2.4, h: 4.2 },
  campus: { ...CAMPUS, r: 1.6, h: 3.4 },
  internship: { x: -8.6, z: -6.9, r: 1.5, h: 4.4 },
  port: { x: 13.4, z: 0.8, r: 2.6, h: 2.4 },
  trailer: { x: 7.6, z: 6.8, r: 1.8, h: 2.3 },
  social: { x: 8.4, z: -5.6, r: 1.5, h: 3.8 },
  spitch: { x: 2.8, z: -11.2, r: 1.0, h: 2.4 },
};
const DORMS = ['chg3127', 'chg3337', 'chg3735', 'chg4360', 'chm2120', 'gng4120'];
DORMS.forEach((id, i) => {
  const a = ((i * 60 + 90) * Math.PI) / 180;
  LAYOUT[id] = { x: CAMPUS.x + Math.cos(a) * 3.8, z: CAMPUS.z + Math.sin(a) * 3.8, r: 1.15, h: 3.1 };
});
LAYOUT.gng4120.r = 1.6;

// Small canvas textures
function radialTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function skyTexture() {
  const c = document.createElement('canvas'); c.width = 4; c.height = 512;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#0b46b8'); g.addColorStop(0.45, '#2a78dc');
  g.addColorStop(0.75, '#6fb2ee'); g.addColorStop(0.9, '#bcdcf4'); g.addColorStop(1, '#a8d39a');
  x.fillStyle = g; x.fillRect(0, 0, 4, 512);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function signTexture(title, sub) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#ecdcb5'; x.fillRect(0, 0, 256, 128);
  x.strokeStyle = '#5b3a1c'; x.lineWidth = 6; x.strokeRect(5, 5, 246, 118);
  x.fillStyle = '#3b2412'; x.textAlign = 'center';
  x.font = '700 44px Cinzel, serif'; x.fillText(title, 128, 58);
  x.fillStyle = '#9a3d14'; x.font = 'italic 500 30px Alegreya, serif'; x.fillText(sub, 128, 98);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function windowGridTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, 128, 256);
  for (let r = 0; r < 9; r++) for (let k = 0; k < 4; k++) {
    if (hash(r * 7 + k * 3) < 0.28) continue;
    x.fillStyle = hash(r + k * 11) > 0.8 ? '#ffb27a' : '#bff4ff';
    x.fillRect(10 + k * 29, 14 + r * 27, 18, 14);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// Hand drawn look: the frame wobbles a little, re drawn 8 times a second like
// animation on twos, with a fixed paper grain on top.
const BoilShader = {
  uniforms: { tDiffuse: { value: null }, seed: { value: 0 }, px: { value: new THREE.Vector2(1, 1) }, amp: { value: 1.9 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float seed; uniform vec2 px; uniform float amp; varying vec2 vUv;
    float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
    void main() {
      vec2 q = vUv / px / 42.0 + seed * 17.13;
      vec2 o = vec2(n(q), n(q + 5.2)) - 0.5;
      vec4 c = texture2D(tDiffuse, vUv + o * amp * px * 2.0);
      vec2 cell = floor(vUv / px / 2.0);
      float grain = h(cell) * 0.08 + n(vUv / px / 160.0) * 0.07;
      c.rgb = mix(c.rgb, c.rgb * vec3(1.0, 0.95, 0.86), 0.35);
      c.rgb *= 1.0 - grain;
      gl_FragColor = c;
    }`,
};
class InkPass extends Pass {
  constructor(effect, scene, camera) { super(); Object.assign(this, { effect, scene, camera }); this.needsSwap = false; }
  render(renderer, writeBuffer, readBuffer) {
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    renderer.clear();
    this.effect.render(this.scene, this.camera);
  }
}
function toonRamp() {
  const t = new THREE.DataTexture(new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]), 3, 1);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true;
  return t;
}
const NO_INK = { visible: false };

export function createWorld({ canvas, labelLayer, entities, onPick }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = skyTexture();
  scene.fog = new THREE.Fog(0xc4e2f6, 80, 340);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 900);
  camera.position.set(0, 16, 27);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, -1.5, 0);
  Object.assign(controls, {
    enableDamping: true, dampingFactor: 0.08, minDistance: 9, maxDistance: 90,
    minPolarAngle: 0.3, maxPolarAngle: 1.42, screenSpacePanning: false, rotateSpeed: 0.6,
  });

  const hemi = new THREE.HemisphereLight(0xe8f6ff, 0x9a8a74, 1.25);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.7);
  sun.position.set(10, 22, 14);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 1, far: 70 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  const ink = new OutlineEffect(renderer, { defaultThickness: 0.005, defaultColor: [0.16, 0.1, 0.06], defaultAlpha: 0.95 });
  const composer = new EffectComposer(renderer);
  composer.addPass(new InkPass(ink, scene, camera));
  const boil = new ShaderPass(BoilShader);
  composer.addPass(boil);
  composer.addPass(new OutputPass());
  const ramp = toonRamp();

  const glowTex = radialTexture();
  const glowables = []; // { mat, base, prop }
  const pickables = [];
  const ents = {}; // id -> { anchor, foot, r }
  const labels = [];
  const rest = { value: 0, target: 0 };

  // Material helpers
  const body = (color, extra = {}) => new THREE.MeshToonMaterial({ color, gradientMap: ramp, ...extra });
  const glow = (color, base = 1.2) => {
    const mat = new THREE.MeshToonMaterial({ color: 0x07142a, emissive: color, emissiveIntensity: Math.min(base, 1.1), gradientMap: ramp });
    base = Math.min(base, 1.1);
    glowables.push({ mat, base, prop: 'emissiveIntensity' });
    return mat;
  };
  const additive = (color, opacity) => {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    mat.userData.outlineParameters = NO_INK;
    glowables.push({ mat, base: opacity, prop: 'opacity' });
    return mat;
  };
  const edgeMat = new THREE.LineBasicMaterial({ color: PAL.cyan, transparent: true, opacity: 0.55 });
  glowables.push({ mat: edgeMat, base: 0.55, prop: 'opacity' });

  function mesh(geo, mat, x = 0, y = 0, z = 0, parent) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    if (parent) parent.add(m);
    return m;
  }
  function edges() {}
  function edgesGlow(m, parent = m.parent) {
    const l = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 30), edgeMat);
    l.position.copy(m.position); l.rotation.copy(m.rotation); l.scale.copy(m.scale);
    parent.add(l);
    return l;
  }
  function makeTree(sc = 1) {
    const g = new THREE.Group();
    mesh(new THREE.CylinderGeometry(0.09, 0.13, 0.7, 5), body(0x8a5a35), 0, 0.35, 0, g);
    const greens = [0x3f9a3a, 0x4fae42, 0x2f8a35];
    const k = Math.floor(hash(sc * 97) * 3);
    mesh(new THREE.IcosahedronGeometry(0.55, 0), body(greens[k]), 0, 0.95, 0, g);
    mesh(new THREE.IcosahedronGeometry(0.4, 0), body(greens[(k + 1) % 3]), 0.18, 1.35, 0.05, g);
    g.scale.setScalar(sc);
    return g;
  }
  function slab(g, r, color = 0xd8ccb0) {
    const s = mesh(new THREE.CylinderGeometry(r, r * 1.04, 0.12, 6), body(color), 0, 0.06, 0, g);
    s.rotation.y = Math.PI / 6;
    return s;
  }
  function halo(color, size, opacity = 0.7) {
    const mat = new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
    glowables.push({ mat, base: opacity, prop: 'opacity' });
    const s = new THREE.Sprite(mat); s.scale.setScalar(size);
    return s;
  }
  function register(id, group, { labelText, sub, cls = 'tag' } = {}) {
    const L = LAYOUT[id];
    group.position.set(L.x, 0, L.z);
    scene.add(group);
    const hit = new THREE.Mesh(
      new THREE.BoxGeometry(L.r * 2, L.h, L.r * 2),
      Object.assign(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }), { userData: { outlineParameters: NO_INK } }),
    );
    hit.position.set(L.x, L.h / 2, L.z);
    hit.userData.pick = id;
    scene.add(hit);
    pickables.push(hit);
    ents[id] = { anchor: new THREE.Vector3(L.x, L.h + 0.5, L.z), foot: new THREE.Vector3(L.x, 0.04, L.z), r: L.r };
    addLabel(ents[id].anchor, labelText ?? entities[id].name, sub, cls);
  }
  function addLabel(anchor, text, sub, cls) {
    const el = document.createElement('div');
    el.className = `label ${cls}`;
    const inline = cls.includes('bot');
    el.innerHTML = inline ? '<span class="t"><b></b> <em></em></span>' : `<span class="t"></span>${sub ? '<span class="s"></span>' : ''}`;
    if (inline) { el.querySelector('b').textContent = text; el.querySelector('em').textContent = sub; }
    else {
      el.querySelector('.t').textContent = text;
      if (sub) el.querySelector('.s').textContent = sub;
    }
    labelLayer.appendChild(el);
    labels.push({ el, anchor });
    return el;
  }

  // ISLAND
  const island = new THREE.Group();
  scene.add(island);
  const tierColors = [0xffffff, 0xe6dccf, 0xcfc3b3];
  const strata = (() => {
    const c = document.createElement('canvas'); c.width = 512; c.height = 64;
    const x = c.getContext('2d');
    x.fillStyle = '#c9a77a'; x.fillRect(0, 0, 512, 64);
    const bands = ['#b8925f', '#d6b88b', '#a98457'];
    for (let k = 0; k < 7; k++) { x.fillStyle = bands[k % 3]; x.fillRect(0, 6 + k * 8 + hash(k) * 3, 512, 2 + hash(k * 3) * 3); }
    for (let k = 0; k < 140; k++) {
      x.fillStyle = k % 4 ? 'rgba(111,85,56,.35)' : 'rgba(255,240,210,.35)';
      const rw = 6 + hash(k * 3) * 22, rh = 3 + hash(k * 5) * 8;
      x.beginPath(); x.ellipse(hash(k * 7) * 512, hash(k * 11) * 64, rw, rh, 0, 0, Math.PI * 2); x.fill();
    }
    x.fillStyle = '#5aae40'; x.fillRect(0, 0, 512, 5);
    for (let k = 0; k < 60; k++) { x.beginPath(); x.ellipse(hash(k * 13) * 512, 5, 4 + hash(k) * 8, 2 + hash(k * 2) * 5, 0, 0, Math.PI * 2); x.fill(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.repeat.set(3, 1); return t;
  })();
  const tiers = [[15.6, 15.0, 1.5, -0.87], [12.0, 11.2, 1.8, -2.52], [8.4, 7.4, 2.0, -4.42]];
  tiers.forEach(([rt, rb, h, y], i) => {
    const t = mesh(new THREE.CylinderGeometry(rt, rb, h, 6), body(tierColors[i], { map: strata }), 0, y, 0, island);
    t.rotation.y = Math.PI / 6;
    t.userData.pick = 'ground';
    pickables.push(t);
    edgesGlow(t, island);
  });
  const rockMats = [body(0x8a6c4c), body(0x77603f), body(0x9c7b56)];
  [[0, 0, 6.6, 9.5], [3.2, 2.2, 3.0, 6], [-3.6, -1.4, 3.4, 7], [1.4, -3.6, 2.4, 5], [-2.0, 3.4, 2.2, 4.4]].forEach(([x, z, r, h], i) => {
    const c = mesh(new THREE.ConeGeometry(r, h, 5 + (i % 2)), rockMats[i % 3], x, -5.42 - h / 2, z, island);
    c.rotation.x = Math.PI;
    c.rotation.y = i * 1.3;
  });
  // Jagged rock hanging under each tier, like icicles of stone
  for (let i = 0; i < 46; i++) {
    const tier = i % 3, [rt, , th, ty] = tiers[tier];
    const a = hash(i * 3.1) * Math.PI * 2, d = rt * (0.55 + hash(i * 5.7) * 0.38);
    const len = 1.2 + hash(i * 7.3) * (tier === 0 ? 3.5 : 5);
    const c = mesh(new THREE.ConeGeometry(0.35 + hash(i * 2.2) * 0.7, len, 5), rockMats[i % 3], Math.cos(a) * d, ty - th / 2 - len / 2 + 0.1, Math.sin(a) * d, island);
    c.rotation.x = Math.PI; c.castShadow = false;
  }
  // Blue crystals growing out of the underside
  const crystalMat = glow(PAL.cyan, 0.8);
  for (let i = 0; i < 14; i++) {
    const a = hash(i * 9.1) * Math.PI * 2, d = 4 + hash(i * 4.4) * 7;
    const len = 1 + hash(i * 6.6) * 2.4;
    const c = mesh(new THREE.OctahedronGeometry(0.5, 0), crystalMat, Math.cos(a) * d, -3.6 - hash(i * 3.3) * 3, Math.sin(a) * d, island);
    c.scale.set(0.5, len, 0.5); c.rotation.z = (hash(i) - 0.5) * 0.8; c.castShadow = false;
  }
  // Waterfall pouring off the front left edge
  const fallTex = (() => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 256;
    const x = c.getContext('2d');
    x.fillStyle = '#9fdcff'; x.fillRect(0, 0, 64, 256);
    for (let k = 0; k < 40; k++) { x.fillStyle = k % 3 ? 'rgba(255,255,255,.8)' : 'rgba(60,150,230,.6)'; x.fillRect(hash(k) * 60, hash(k * 3) * 256, 2 + hash(k * 5) * 4, 20 + hash(k * 7) * 60); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 3); return t;
  })();
  const fallMat = new THREE.MeshBasicMaterial({ map: fallTex, transparent: true, opacity: 0.92, side: THREE.DoubleSide, depthWrite: false });
  fallMat.userData.outlineParameters = NO_INK;
  const fa = (200 * Math.PI) / 180, fr = 14.1;
  const fall = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 26), fallMat);
  fall.position.set(Math.cos(fa) * fr, -13, Math.sin(fa) * fr);
  fall.lookAt(0, -13, 0);
  scene.add(fall);
  const pond = mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.05, 12), body(0x5fb6f0), Math.cos(fa) * 12.6, 0.03, Math.sin(fa) * 12.6, scene);
  pond.receiveShadow = true;
  const mist = halo(0xffffff, 6, 0.5); mist.position.set(Math.cos(fa) * fr, -24, Math.sin(fa) * fr); scene.add(mist);

  // Hex tile floor: pointy tiles in a big hex, aligned with the tiers
  const S = 0.9, N = 9, SQ3 = Math.sqrt(3);
  const cells = [];
  for (let q = -N; q <= N; q++) for (let r = Math.max(-N, -q - N); r <= Math.min(N, -q + N); r++) {
    cells.push([S * SQ3 * (q + r / 2), S * 1.5 * r, q, r]);
  }
  const tileGeo = new THREE.CylinderGeometry(S * 0.97, S * 0.97, 0.12, 6);
  const tiles = new THREE.InstancedMesh(tileGeo, body(0xffffff), cells.length);
  tiles.receiveShadow = true;
  const shades = [0x6cc24a, 0x63b945, 0x76c952, 0x5aae40, 0x80cf5a];
  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  cells.forEach(([x, z, q, r], i) => {
    m4.makeTranslation(x, -0.06, z);
    tiles.setMatrixAt(i, m4);
    const d = Math.hypot(x, z);
    const dc = Math.hypot(x - CAMPUS.x, z - CAMPUS.z);
    if (d < 3.4) col.set(0xeae3cf);
    else if (dc < 5.3) col.set(hash(q * 31 + r) > 0.5 ? 0x8fcf63 : 0x86c95b);
    else col.set(shades[Math.floor(hash(q * 13 + r * 7) * shades.length)]);
    tiles.setColorAt(i, col);
  });
  tiles.userData.pick = 'ground';
  scene.add(tiles);
  pickables.push(tiles);
  const linePts = [];
  for (const [x, z] of cells) for (let k = 0; k < 6; k++) {
    const a1 = (k * Math.PI) / 3, a2 = ((k + 1) * Math.PI) / 3;
    linePts.push(x + S * Math.sin(a1), 0.005, z + S * Math.cos(a1), x + S * Math.sin(a2), 0.005, z + S * Math.cos(a2));
  }
  const gridGeo = new THREE.BufferGeometry();
  gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePts, 3));
  const gridMat = new THREE.LineBasicMaterial({ color: 0x2f6e2a, transparent: true, opacity: 0.3, depthWrite: false });
  scene.add(new THREE.LineSegments(gridGeo, gridMat));

  // ICON PLAZA
  const plaza = new THREE.Group();
  const pad = mesh(new THREE.CylinderGeometry(2.7, 2.9, 0.3, 6), body(0xf4efe2), 0, 0.15, 0, plaza);
  pad.rotation.y = Math.PI / 6;
  edges(pad, plaza);
  const ring = mesh(new THREE.RingGeometry(2.95, 3.12, 6), additive(PAL.cyan, 0.9), 0, 0.03, 0, plaza);
  ring.rotation.set(-Math.PI / 2, 0, Math.PI / 6);
  mesh(new THREE.CylinderGeometry(0.55, 0.75, 0.9, 6), body(PAL.navy), 0, 0.75, 0, plaza);
  const beam = mesh(new THREE.CylinderGeometry(0.16, 0.42, 2.4, 6, 1, true), additive(PAL.cyan, 0.35), 0, 2.2, 0, plaza);
  beam.castShadow = false;
  const core = mesh(new THREE.IcosahedronGeometry(0.62, 0), glow(PAL.white, 1.6), 0, 3.3, 0, plaza);
  const ringA = mesh(new THREE.TorusGeometry(1.05, 0.035, 6, 48), glow(PAL.cyan, 2.2), 0, 3.3, 0, plaza);
  const ringB = mesh(new THREE.TorusGeometry(1.3, 0.03, 6, 48), glow(PAL.orange, 1.8), 0, 3.3, 0, plaza);
  ringA.castShadow = ringB.castShadow = false;
  const aura = halo(PAL.cyan, 5.5, 0.55);
  aura.position.set(0, 3.3, 0);
  plaza.add(aura);
  register('icon', plaza, { labelText: 'ICON', sub: 'Wahb', cls: 'tag icon' });

  // CAMPUS (district hall in the middle of six dorms)
  const campus = new THREE.Group();
  const quad = mesh(new THREE.CylinderGeometry(5.6, 5.6, 0.05, 6), body(0xd9cca6), 0, 0.025, 0, campus);
  quad.rotation.y = Math.PI / 6;
  quad.userData.pick = 'campus';
  pickables.push(quad);
  const qring = mesh(new THREE.RingGeometry(5.3, 5.42, 6), additive(PAL.cyan, 0.6), 0, 0.06, 0, campus);
  qring.rotation.set(-Math.PI / 2, 0, Math.PI / 6);
  slab(campus, 1.7, 0xbfeafb);
  const hall = mesh(new THREE.BoxGeometry(2.2, 1.1, 1.6), body(0xe6f7ff), 0, 0.67, 0, campus);
  edges(hall, campus);
  for (const x of [-0.75, -0.25, 0.25, 0.75]) mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.0, 6), body(0xffffff), x, 0.62, 0.92, campus);
  mesh(new THREE.BoxGeometry(2.5, 0.14, 2.0), body(PAL.navy), 0, 1.28, 0.1, campus);
  const tower = mesh(new THREE.BoxGeometry(0.6, 1.5, 0.6), body(0xd7f1ff), 0, 2.05, -0.2, campus);
  edges(tower, campus);
  mesh(new THREE.ConeGeometry(0.5, 0.7, 6), glow(PAL.cyan, 0.9), 0, 3.15, -0.2, campus);
  register('campus', campus, { cls: 'tag district' });

  // DORMS: windows glow brighter as the deadline gets closer
  const dormWindows = {};
  for (const id of DORMS) {
    const g = new THREE.Group();
    const big = id === 'gng4120';
    slab(g, 1.15);
    const b = mesh(new THREE.BoxGeometry(1.6, 1.5, 1.5), body(PAL.steel), 0, 0.87, 0, g);
    edges(b, g);
    const roof = mesh(new THREE.ConeGeometry(1.3, 0.85, 4), body(PAL.navy), 0, 2.05, 0, g);
    roof.rotation.y = Math.PI / 4;
    edges(roof, g);
    const winMat = new THREE.MeshToonMaterial({ color: 0x0a1a33, emissive: 0xfff3b0, emissiveIntensity: 1, gradientMap: ramp });
    winMat.userData.outlineParameters = { thickness: 0.002 };
    const win = new THREE.PlaneGeometry(0.34, 0.4);
    for (const [x, y] of [[-0.42, 1.25], [0.42, 1.25], [-0.42, 0.68], [0.42, 0.68]]) mesh(win, winMat, x, y, 0.76, g).castShadow = false;
    for (const s of [-1, 1]) {
      const w = mesh(win, winMat, s * 0.81, 1.25, 0, g);
      w.rotation.y = (s * Math.PI) / 2; w.castShadow = false;
    }
    mesh(new THREE.BoxGeometry(0.36, 0.5, 0.06), body(0x0c1b33), 0, 0.37, 0.76, g);
    dormWindows[id] = { mat: winMat, base: 1 };
    if (big) {
      // The class project lives inside this dorm: an annex with an orange core
      const annex = mesh(new THREE.BoxGeometry(0.9, 0.8, 0.9), body(0x3a6fae), 0.2, 0.52, 1.25, g);
      edges(annex, g);
      mesh(new THREE.PlaneGeometry(0.5, 0.3), glow(PAL.orange, 1.6), 0.2, 0.6, 1.71, g).castShadow = false;
      const cube = mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), glow(PAL.orange, 2.2), 0, 2.85, 0, g);
      cube.userData.spin = true;
      g.userData.cube = cube;
    }
    const L = LAYOUT[id];
    g.rotation.y = Math.atan2(CAMPUS.x - L.x, CAMPUS.z - L.z) + Math.PI; // face outward
    register(id, g, { sub: big ? 'project inside' : undefined, cls: 'tag dorm' });
  }

  // INTERNSHIP SEARCH
  {
    const g = new THREE.Group();
    slab(g, 1.5);
    const tex = windowGridTexture();
    const office = mesh(new THREE.BoxGeometry(1.9, 3.1, 1.5), new THREE.MeshToonMaterial({ color: 0x2a5d9c, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.9, gradientMap: ramp }), 0, 1.67, 0, g);
    glowables.push({ mat: office.material, base: 0.9, prop: 'emissiveIntensity' });
    edges(office, g);
    const lens = mesh(new THREE.TorusGeometry(0.36, 0.07, 6, 24), glow(PAL.cyan, 1.8), 0, 3.75, 0, g);
    const handle = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 6), glow(PAL.cyan, 1.8), 0.32, 3.42, 0, g);
    handle.rotation.z = Math.PI / 4;
    lens.castShadow = handle.castShadow = false;
    g.userData.lens = lens;
    register('internship', g);
  }

  // PORT: an empty dock that runs off the island edge, sign "to be defined"
  {
    const g = new THREE.Group();
    const deck = mesh(new THREE.BoxGeometry(6.2, 0.14, 2.2), body(0x7fb6dc), 1.2, 0.08, 0, g);
    edges(deck, g);
    for (let i = 0; i < 6; i++) mesh(new THREE.BoxGeometry(0.04, 0.02, 2.2), body(PAL.navy), -1.6 + i * 1.0, 0.16, 0, g);
    for (const x of [1.2, 2.6, 4.0]) for (const z of [-0.95, 0.95]) mesh(new THREE.CylinderGeometry(0.1, 0.1, 2.4, 6), body(0x1c3a66), x, -1.1, z, g);
    for (const z of [-0.85, 0.85]) mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.32, 8), body(0xe6f7ff), 4.1, 0.31, z, g);
    mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.7, 6), body(0xd7f1ff), -1.6, 0.95, -1.4, g);
    const lamp = mesh(new THREE.SphereGeometry(0.14, 8, 6), glow(PAL.cyan, 2.4), -1.6, 1.85, -1.4, g);
    lamp.castShadow = false;
    mesh(new THREE.PlaneGeometry(2.4, 1.2), new THREE.MeshBasicMaterial({ map: signTexture('Port', 'to be defined') }), -0.4, 1.35, 1.3, g).castShadow = false;
    for (const x of [-1.5, 0.7]) mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.5, 6), body(0xd7f1ff), x, 0.75, 1.26, g);
    register('port', g);
  }

  // TRAILER
  {
    const g = new THREE.Group();
    slab(g, 1.6);
    const shell = mesh(new THREE.BoxGeometry(2.5, 1.15, 1.2), body(0xe6f7ff), 0, 0.97, 0, g);
    edges(shell, g);
    mesh(new THREE.BoxGeometry(2.6, 0.12, 1.3), body(PAL.navy), 0, 1.6, 0, g);
    const awning = mesh(new THREE.BoxGeometry(1.5, 0.05, 0.6), glow(PAL.orange, 0.8), -0.2, 1.36, 0.85, g);
    awning.rotation.x = 0.25;
    mesh(new THREE.BoxGeometry(1.2, 0.36, 0.04), glow(PAL.cyan, 1.1), -0.2, 1.02, 0.61, g).castShadow = false;
    for (const x of [-0.7, 0.7]) {
      const w = mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.18, 10), body(0x0c1b33), x, 0.38, 0.62, g);
      w.rotation.x = Math.PI / 2;
    }
    mesh(new THREE.BoxGeometry(0.7, 0.08, 0.1), body(0x0c1b33), 1.55, 0.45, 0, g);
    register('trailer', g);
  }

  // SOCIAL MEDIA: a tower with posts orbiting it
  {
    const g = new THREE.Group();
    slab(g, 1.4);
    const col = mesh(new THREE.BoxGeometry(0.9, 2.6, 0.9), body(PAL.navy), 0, 1.42, 0, g);
    edges(col, g);
    mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.0, 4), body(0xd7f1ff), 0, 3.2, 0, g);
    const tip = mesh(new THREE.SphereGeometry(0.1, 8, 6), glow(PAL.orange, 2.4), 0, 3.72, 0, g);
    tip.castShadow = false;
    const orbit = new THREE.Group(); orbit.position.y = 1.8; g.add(orbit);
    [PAL.cyan, PAL.blue, PAL.orange, PAL.cyan, PAL.blue].forEach((c, i) => {
      const a = (i / 5) * Math.PI * 2;
      const p = mesh(new THREE.BoxGeometry(0.42, 0.62, 0.04), glow(c, 1.4), Math.cos(a) * 1.05, (i % 2) * 0.35 - 0.15, Math.sin(a) * 1.05, orbit);
      p.lookAt(0, p.position.y, 0); p.castShadow = false;
    });
    g.userData.orbit = orbit;
    register('social', g);
  }

  // SPITCH: small hut far back, its orange dot above, kept dim (lowest priority)
  {
    const g = new THREE.Group();
    slab(g, 0.9);
    const hut = mesh(new THREE.BoxGeometry(1.0, 0.8, 0.9), body(0x3a5f8f), 0, 0.52, 0, g);
    edges(hut, g);
    const roof = mesh(new THREE.ConeGeometry(0.85, 0.55, 4), body(PAL.navy), 0, 1.2, 0, g);
    roof.rotation.y = Math.PI / 4;
    const dot = mesh(new THREE.SphereGeometry(0.2, 12, 8), glow(PAL.orange, 1.0), 0, 1.95, 0, g);
    dot.castShadow = false;
    g.userData.dot = dot;
    register('spitch', g);
  }

  // Ground pick target and label for the island itself
  ents.ground = { anchor: new THREE.Vector3(0, 0, 9), foot: new THREE.Vector3(0, 0.04, 9), r: 1 };

  // BOTS: glowing orbs. Blue working, orange blocked, white waiting on Wahb.
  const bots = [];
  Object.values(entities).filter((e) => e.kind === 'bot').forEach((e, i) => {
    const home = LAYOUT[e.home];
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12), new THREE.MeshBasicMaterial({ color: STATE_COLOR[e.state] }));
    const h = halo(STATE_COLOR[e.state], 1.7, 0.75);
    const hit = new THREE.Mesh(new THREE.SphereGeometry(0.75, 8, 6), Object.assign(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }), { userData: { outlineParameters: NO_INK } }));
    hit.userData.pick = e.id;
    scene.add(orb, h, hit);
    pickables.push(hit);
    const anchor = new THREE.Vector3();
    const bot = {
      e, orb, halo: h, hit, anchor,
      cx: home.x, cz: home.z, rad: e.home === 'icon' ? 3.8 : home.r + 1.0,
      y: home.h + 1.5, a: hash(i * 5) * Math.PI * 2, phase: i * 1.7,
      speed: 0.25 + hash(i * 9) * 0.15,
    };
    bots.push(bot);
    ents[e.id] = { anchor, foot: new THREE.Vector3(), r: 0.6, bot };
    const el = addLabel(anchor, e.role, 'Claude Code', `tag bot ${e.state}`);
    bot.label = el;
  });

  // Approval markers (yellow diamonds) and the selection ring
  const markerGeo = new THREE.OctahedronGeometry(0.22, 0);
  const markers = {};
  const selRing = new THREE.Mesh(new THREE.RingGeometry(1, 1.12, 6), new THREE.MeshBasicMaterial({ color: PAL.orange, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  selRing.rotation.set(-Math.PI / 2, 0, Math.PI / 6);
  selRing.visible = false;
  scene.add(selRing);
  let selected = null;

  // Far world: green land far below, hazy mountains on the horizon
  const land = new THREE.Mesh(new THREE.CircleGeometry(700, 24), body(0x7cc35a));
  land.rotation.x = -Math.PI / 2; land.position.y = -90; scene.add(land);
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + hash(i) * 0.3, d = 300 + hash(i * 7) * 140, hgt = 28 + hash(i * 3) * 34;
    const m = new THREE.Mesh(new THREE.ConeGeometry(40 + hash(i * 5) * 40, hgt, 5), body(0x7d93b8));
    m.position.set(Math.cos(a) * d, -90 + hgt / 2, Math.sin(a) * d); m.rotation.y = hash(i * 11) * 3;
    const cap = new THREE.Mesh(new THREE.ConeGeometry((40 + hash(i * 5) * 40) * 0.28, hgt * 0.28, 5), body(0xf3f7ff));
    cap.position.y = hgt * 0.36; cap.rotation.y = 0; m.add(cap);
    scene.add(m);
  }
  // A far floating castle of stacked steel floors on the horizon, hazy in the fog
  const castle = new THREE.Group();
  for (let k = 0; k < 9; k++) {
    const r = 9 + Math.sin((k / 8) * Math.PI) * 9;
    const f = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.96, 2.6, 10), body(k % 2 ? 0x8ea4c4 : 0xa9bbd6));
    f.position.y = k * 2.9; castle.add(f);
  }
  const spire = new THREE.Mesh(new THREE.ConeGeometry(3, 10, 8), body(0xa9bbd6)); spire.position.y = 30; castle.add(spire);
  castle.position.set(-150, 26, -210); scene.add(castle);

  // Small floating islets around the main island
  const islets = [];
  for (let i = 0; i < 6; i++) {
    const g = new THREE.Group(), r = 1.6 + hash(i * 13) * 2.2;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.9, 0.5, 6), body(0x6cc24a)); g.add(top);
    const rock = new THREE.Mesh(new THREE.ConeGeometry(r * 0.9, r * 2.4, 6), body(0x9c7b56));
    rock.rotation.x = Math.PI; rock.position.y = -r * 1.2 - 0.25; g.add(rock);
    if (i % 2 === 0) { const tr = makeTree(0.8); tr.position.y = 0.25; g.add(tr); }
    const a = Math.PI * 0.8 + (i / 5) * Math.PI * 1.4, d = 27 + hash(i * 19) * 16;
    g.position.set(Math.cos(a) * d, -6 + hash(i * 23) * 12, Math.sin(a) * d);
    g.userData.y0 = g.position.y; scene.add(g); islets.push(g);
  }

  // Sky dressing: clouds and a few floating shards
  const clouds = [];
  const cloudMat = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: ramp });
  cloudMat.userData.outlineParameters = { thickness: 0.002, color: [0.45, 0.6, 0.8] };
  for (let i = 0; i < 16; i++) {
    const c = new THREE.Group();
    const puffs = 4 + Math.floor(hash(i * 2) * 4);
    for (let k = 0; k < puffs; k++) {
      const p = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6 + hash(i * 3 + k) * 2.2, 1), cloudMat);
      p.position.set(k * 2.1 - puffs, hash(i + k) * 1.4, (hash(i * 2 + k) - 0.5) * 2.4);
      p.scale.y = 0.62;
      c.add(p);
    }
    const a = Math.PI * 0.8 + (i / 15) * Math.PI * 1.4;
    const d = 34 + hash(i * 17) * 40;
    c.position.set(Math.cos(a) * d, -16 + hash(i * 23) * 26, Math.sin(a) * d - 8);
    c.scale.setScalar(0.8 + hash(i * 31) * 0.8);
    c.userData.v = 0.15 + hash(i * 29) * 0.25;
    scene.add(c);
    clouds.push(c);
  }
  const shards = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const s = mesh(new THREE.OctahedronGeometry(0.45, 0), glow(PAL.cyan, 0.7), Math.cos(a) * 19, -2 + hash(i * 41) * 5, Math.sin(a) * 19);
    s.scale.set(0.6, 1.2, 0.6); s.castShadow = false;
    scene.add(s);
    shards.push(s);
  }

  // Trees on the grass, kept clear of every building and path
  const clear = Object.entries(LAYOUT).map(([, L]) => [L.x, L.z, L.r + 1.3]);
  clear.push([0, 0, 4.6], [CAMPUS.x, CAMPUS.z, 6.6], [CAMPUS.x + 2, CAMPUS.z + 6, 3], [Math.cos(fa) * 12.6, Math.sin(fa) * 12.6, 2], [LAYOUT.port.x - 2, LAYOUT.port.z, 3]);
  let planted = 0;
  for (let i = 0; i < 400 && planted < 30; i++) {
    const x = (hash(i * 1.37) - 0.5) * 28, z = (hash(i * 2.71) - 0.5) * 24;
    if (Math.hypot(x, z) > 12.6) continue;
    if (clear.some(([cx, cz, cr]) => Math.hypot(x - cx, z - cz) < cr)) continue;
    const t = makeTree(0.6 + hash(i * 3.9) * 0.45);
    t.position.set(x, 0, z); t.rotation.y = hash(i) * 6;
    scene.add(t);
    planted++;
  }

  // Small idle motions, each tied to what the building does
  const spinners = [];
  scene.traverse((o) => {
    const u = o.userData;
    if (u.cube) spinners.push((d) => { u.cube.rotation.y += d * 0.8; u.cube.rotation.x += d * 0.4; });
    if (u.lens) spinners.push((d, t) => { u.lens.rotation.y = Math.sin(t * 0.7) * 0.8; });
    if (u.orbit) spinners.push((d) => { u.orbit.rotation.y += d * 0.35; });
  });

  // DATA DRIVEN STATE
  function deadlineGlow(e) {
    if (!e.deadline) return 0.3;
    const days = (e.deadline - Date.now()) / DAY;
    const k = 1 - Math.min(Math.max(days / 21, 0), 1);
    return 0.25 + 2.9 * Math.pow(k, 1.3);
  }
  function refresh() {
    for (const id of DORMS) dormWindows[id].base = deadlineGlow(entities[id]);
    for (const b of bots) {
      const c = STATE_COLOR[b.e.state] ?? PAL.white;
      b.orb.material.color.set(c);
      b.halo.material.color.set(c);
      b.label.className = `label tag bot ${b.e.state}`;
    }
    for (const [id, e] of Object.entries(entities)) {
      const pending = e.queue.some((q) => q.type === 'approval' && !q.done);
      if (pending && !markers[id] && ents[id]) {
        const m = new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({ color: PAL.yellow }));
        m.add(halo(PAL.yellow, 1.1, 0.6));
        scene.add(m);
        markers[id] = m;
      }
      if (markers[id]) markers[id].visible = pending;
    }
  }

  function select(id) {
    selected = id && ents[id] ? id : null;
    selRing.visible = !!selected;
    if (selected) {
      const r = ents[selected].r + 0.35;
      selRing.scale.setScalar(r);
      focusTo.copy(ents[selected].bot ? ents[selected].anchor : ents[selected].foot);
      focusTo.y = Math.min(focusTo.y, 1.5);
      focusing = 1.2;
    }
  }

  // PICKING (a tap is a short press without a drag)
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let down = null;
  canvas.addEventListener('pointerdown', (ev) => { down = { x: ev.clientX, y: ev.clientY, t: performance.now() }; });
  canvas.addEventListener('pointerup', (ev) => {
    if (!down) return;
    const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
    const quick = performance.now() - down.t < 450;
    down = null;
    if (moved > 7 || !quick) return;
    onPick(pickAt(ev.clientX, ev.clientY));
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (ev.pointerType !== 'mouse' || down) return;
    canvas.style.cursor = pickAt(ev.clientX, ev.clientY) ? 'pointer' : 'grab';
  });
  function pickAt(cx, cy) {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(pickables, false);
    // Prefer a bot or building over the ground when both are under the finger.
    const best = hits.find((h) => h.object.userData.pick !== 'ground' && h.object.userData.pick !== 'campus')
      ?? hits.find((h) => h.object.userData.pick === 'campus') ?? hits[0];
    if (best?.object.userData.pick === 'ground') {
      ents.ground.foot.copy(best.point); ents.ground.foot.y = 0.04;
    }
    return best ? best.object.userData.pick : null;
  }

  // LAYOUT AND VIEW
  const inset = { right: 0, bottom: 0, cx: 0, cy: 0 };
  let w = 1, h = 1, firstFit = true;
  const focusTo = new THREE.Vector3();
  let focusing = 0;
  function resize() {
    w = canvas.clientWidth; h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    boil.uniforms.px.value.set(1 / (w * renderer.getPixelRatio()), 1 / (h * renderer.getPixelRatio()));
    camera.aspect = w / h;
    if (firstFit) {
      const fitWidth = camera.aspect < 1 ? 36 : 46;
      const dist = Math.max(34, fitWidth / 2 / (Math.tan(THREE.MathUtils.degToRad(21)) * camera.aspect));
      camera.position.set(0, dist * 0.33, dist * 0.95);
      firstFit = false;
    }
    camera.updateProjectionMatrix();
  }
  function setInset({ right = 0, bottom = 0 }) { inset.right = right; inset.bottom = bottom; }
  function setRest(on) { rest.target = on ? 1 : 0; }

  const clock = new THREE.Clock();
  const v = new THREE.Vector3();
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    const motion = reduce ? 0.15 : 1;

    rest.value += (rest.target - rest.value) * Math.min(dt * 3, 1);
    const dim = 1 - rest.value * 0.8;
    for (const g of glowables) g.mat[g.prop] = g.base * dim;
    for (const id of DORMS) dormWindows[id].mat.emissiveIntensity = dormWindows[id].base * dim;
    hemi.intensity = 1.15 * (1 - rest.value * 0.5);
    sun.intensity = 1.7 * (1 - rest.value * 0.6);
    boil.uniforms.seed.value = reduce ? 0 : Math.floor(t * 8) % 3;

    core.rotation.y += dt * 0.6 * motion * dim;
    core.rotation.x += dt * 0.25 * motion * dim;
    core.position.y = 3.3 + Math.sin(t * 1.4) * 0.12 * motion;
    ringA.rotation.x = Math.PI / 2 + Math.sin(t * 0.5) * 0.35; ringA.rotation.z += dt * 0.5 * motion;
    ringB.rotation.y += dt * 0.35 * motion; ringB.rotation.x = 1.1 + Math.sin(t * 0.4) * 0.2;
    ringA.position.y = ringB.position.y = aura.position.y = core.position.y;
    aura.scale.setScalar((5.5 + Math.sin(t * 1.4) * 0.3 * motion) * (1 - rest.value * 0.4));

    for (const s of spinners) s(dt * motion * dim, t);

    for (const b of bots) {
      b.a += dt * b.speed * motion;
      const bob = Math.sin(t * 2 + b.phase) * 0.18 * motion;
      b.orb.position.set(b.cx + Math.cos(b.a) * b.rad, b.y + bob, b.cz + Math.sin(b.a) * b.rad);
      const st = b.e.state;
      const pulse = st === 'working' ? 1 + Math.sin(t * 6 + b.phase) * 0.1 * motion
        : st === 'blocked' ? 1 + Math.sin(t * 1.6 + b.phase) * 0.18 * motion : 1;
      b.orb.scale.setScalar(pulse);
      b.halo.position.copy(b.orb.position);
      b.halo.scale.setScalar(1.7 * pulse);
      b.hit.position.copy(b.orb.position);
      b.anchor.copy(b.orb.position).y += 0.55;
      ents[b.e.id].foot.set(b.orb.position.x, 0.04, b.orb.position.z);
    }

    for (const [id, m] of Object.entries(markers)) {
      m.position.copy(ents[id].anchor).y += 1.15 + Math.sin(t * 2.2) * 0.1 * motion;
      m.rotation.y += dt * 1.5 * motion;
    }
    fallTex.offset.y = reduce ? 0 : (fallTex.offset.y - dt * 0.9) % 1;
    islets.forEach((g, i) => { g.position.y = g.userData.y0 + Math.sin(t * 0.4 + i) * 0.4 * motion; });
    for (const c of clouds) {
      c.position.x += dt * c.userData.v * motion;
      if (c.position.x > 80) c.position.x = -80;
    }
    shards.forEach((s, i) => { s.rotation.y += dt * 0.2 * motion; s.position.y += Math.sin(t * 0.6 + i) * 0.002 * motion; });

    if (selected) {
      selRing.position.copy(ents[selected].foot);
      selRing.material.opacity = 0.7 + Math.sin(t * 4) * 0.25 * motion;
    }
    if (focusing > 0) {
      focusing -= dt;
      const k = Math.min(dt * 3, 1);
      const delta = v.copy(focusTo).sub(controls.target).multiplyScalar(k);
      controls.target.add(delta);
      camera.position.add(delta);
    }
    // Keep the camera target over the island
    const tr = Math.hypot(controls.target.x, controls.target.z);
    if (tr > 15) { controls.target.x *= 15 / tr; controls.target.z *= 15 / tr; }

    // Shift the view so the selected thing stays clear of the panel
    inset.cx += (inset.right / 2 - inset.cx) * Math.min(dt * 5, 1);
    inset.cy += (inset.bottom / 2 - inset.cy) * Math.min(dt * 5, 1);
    if (Math.abs(inset.cx) > 0.5 || Math.abs(inset.cy) > 0.5) camera.setViewOffset(w, h, inset.cx, inset.cy, w, h);
    else camera.clearViewOffset();

    controls.update();
    composer.render();

    const placed = [];
    for (const L of labels) {
      v.copy(L.anchor).project(camera);
      const vis = v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2;
      L.el.style.display = vis ? '' : 'none';
      if (!vis) continue;
      if (!L.w) { L.w = L.el.offsetWidth; L.h = L.el.offsetHeight; }
      const x = ((v.x + 1) / 2) * w;
      let y = ((1 - v.y) / 2) * h;
      for (let k = 0; k < 6; k++) {
        const hit = placed.find((p) => Math.abs(p.x - x) < (p.w + L.w) / 2 + 2 && Math.abs(p.y - y) < (p.h + L.h) / 2 + 1);
        if (!hit) break;
        y = hit.y - (hit.h + L.h) / 2 - 2;
      }
      placed.push({ x, y, w: L.w, h: L.h });
      L.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    }
    requestAnimationFrame(frame);
  }

  addEventListener('resize', resize);
  resize();
  refresh();
  requestAnimationFrame(frame);

  return { refresh, select, setInset, setRest, resize };
}
