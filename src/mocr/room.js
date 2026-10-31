// Procedural Mission Operations Control Room 2 (Building 30, Houston, 1969–70): four tiered rows of
// Philco-Ford consoles facing the front wall of projection screens and clocks, wood-panelled side
// walls with mission plaques, acoustic ceiling with fluorescent troffers, the glass-walled viewing
// room at the back. Static geometry is merged per material (few draw calls); every console slot
// exposes the anchors MOCRView needs (CRT screens, keyboard shelf, seat, nameplate, status lamp).
//
// Room frame: x right (facing the screens), y up, z toward the back wall. Screens at z ≈ −1.2.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const ROOM = {
  halfW: 11,
  front: -1.25,
  back: 17.2,
  ceiling: 6.1,
  tierH: 0.4,
  posW: 1.55, // one console position
  eye: 1.27, // seated eye height above the tier floor
};

/** Console rows, front (the "trench") to back. desk = z of the desk edge (controller side). */
export const ROWS = [
  { tier: 0, desk: 4.9, consoles: ['BOOSTER', 'RETRO', 'FIDO', 'GUIDO'] },
  { tier: 1, desk: 8.4, consoles: ['SURGEON', 'CAPCOM', 'EECOM', 'GNC', 'TELMU', 'CONTROL'] },
  { tier: 2, desk: 11.7, consoles: ['INCO', 'PROCEDURES', 'AFD', 'FLIGHT', 'FAO', 'NETWORK'] },
  { tier: 3, desk: 15.0, consoles: ['PAO', 'DOD', 'MISSION_DIRECTOR'] },
];

/** Tier floor boundaries (z where each tier starts). */
const TIER_Z = [ROOM.front, 6.25, 9.75, 13.05];

export function floorHeight(z) {
  let t = 0;
  for (let i = 1; i < TIER_Z.length; i++) if (z >= TIER_Z[i]) t = i;
  return t * ROOM.tierH;
}

// ------------------------------------------------------------------ procedural textures

function canvasTex(w, h, draw, { repeat = [1, 1], srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 4;
  return t;
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function speckle(g, w, h, base, n, amp, seed = 1) {
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const v = (r() - 0.5) * amp;
    g.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
    g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
  }
}

function makeTextures() {
  const carpet = canvasTex(256, 256, (g, w, h) => speckle(g, w, h, '#2c3237', 9000, 0.22, 3), { repeat: [10, 4] });
  const wood = canvasTex(512, 512, (g, w, h) => {
    const r = rng(7);
    for (let x = 0; x < w; x += 64) {
      const tone = 52 + r() * 16;
      g.fillStyle = `rgb(${tone + 18},${tone - 2},${tone - 18})`;
      g.fillRect(x, 0, 64, h);
      for (let i = 0; i < 70; i++) {
        g.strokeStyle = `rgba(${r() > 0.5 ? '255,220,180' : '20,10,4'},${0.03 + r() * 0.05})`;
        g.lineWidth = 1 + r() * 2;
        const xx = x + r() * 64;
        g.beginPath();
        g.moveTo(xx, 0);
        g.bezierCurveTo(xx + (r() - 0.5) * 12, h * 0.3, xx + (r() - 0.5) * 12, h * 0.7, xx + (r() - 0.5) * 8, h);
        g.stroke();
      }
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(x, 0, 2, h);
    }
  }, { repeat: [9, 1] });
  const fabric = canvasTex(256, 256, (g, w, h) => {
    speckle(g, w, h, '#77746b', 6000, 0.12, 11);
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    for (let x = 0; x < w; x += 128) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, h);
      g.stroke();
    }
  }, { repeat: [12, 2] });
  const ceiling = canvasTex(256, 256, (g, w, h) => {
    speckle(g, w, h, '#9b978c', 5000, 0.18, 5);
    g.strokeStyle = 'rgba(40,38,34,0.7)';
    g.lineWidth = 3;
    for (let i = 0; i <= w; i += 128) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i, h);
      g.moveTo(0, i);
      g.lineTo(w, i);
      g.stroke();
    }
  }, { repeat: [11, 9] });
  return { carpet, wood, fabric, ceiling };
}

// ------------------------------------------------------------------ merged geometry builder

class Batch {
  constructor() {
    this.parts = [];
  }

  /** Add a geometry with a solid colour and a transform (Matrix4). */
  add(geo, color, matrix) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (geo.index) geo.dispose();
    const n = g.attributes.position.count;
    const c = new THREE.Color(color);
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    if (matrix) g.applyMatrix4(matrix);
    this.parts.push(g);
    return this;
  }

  box(w, h, d, color, x, y, z, rx = 0, ry = 0, rz = 0) {
    return this.add(new THREE.BoxGeometry(w, h, d), color, mtx(x, y, z, rx, ry, rz));
  }

  cyl(rt, rb, h, color, x, y, z, seg = 14, rx = 0, ry = 0, rz = 0) {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), color, mtx(x, y, z, rx, ry, rz));
  }

  mesh(material) {
    if (!this.parts.length) return null;
    const geo = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, material);
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    return m;
  }
}

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const _p = new THREE.Vector3();
function mtx(x, y, z, rx = 0, ry = 0, rz = 0) {
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s);
}

const D = Math.PI / 180;

// ------------------------------------------------------------------ console geometry

const COL = {
  body: '#8a9495',
  bodyDark: '#6c7577',
  desk: '#6f786c',
  trim: '#1d2022',
  chrome: '#b9c0c4',
  bezel: '#141618',
  top: '#9aa3a4',
};

/** Local anchors of one console position (x across, y from the tier, z: desk edge = 0, −z = front). */
export const CONSOLE_LOCAL = {
  crtY: 1.035,
  crtZ: -0.672,
  crtTilt: -8 * D, // rotation about X (top leans away)
  crtW: 0.4,
  crtH: 0.3,
  crtDX: 0.462,
  shelf: { y: 0.807, z: -0.52, rotX: -70 * D, len: 0.3 },
  nameplate: { y: 1.25, z: -0.616 },
  lamp: { y: 1.297, z: -0.78 },
  top: 1.285,
};

function addConsoleBody(b, x0, tierY, desk) {
  const w = ROOM.posW;
  const y = tierY;
  const L = CONSOLE_LOCAL;
  // base cabinet + kick plate
  b.box(w, 0.66, 0.62, COL.body, x0, y + 0.37, desk - 0.64);
  b.box(w, 0.06, 0.6, COL.trim, x0, y + 0.03, desk - 0.64);
  // desk work surface + chrome front edge
  b.box(w, 0.035, 0.44, COL.desk, x0, y + 0.735, desk - 0.18);
  b.box(w, 0.04, 0.02, COL.chrome, x0, y + 0.735, desk + 0.04);
  // gently sloped keyboard shelf (box rotated +20° about X: top face normal = the panel normal)
  b.box(w, 0.03, L.shelf.len + 0.02, COL.bodyDark, x0, y + L.shelf.y - 0.018 * 0.94, desk + L.shelf.z - 0.018 * 0.342, 20 * D);
  // CRT bay face, tilted back, between the shelf and the hood
  b.box(w, 0.4, 0.05, COL.body, x0, y + 1.04, desk + L.crtZ - 0.035, L.crtTilt);
  for (let i = -1; i <= 1; i++) {
    const cx = x0 + i * L.crtDX;
    b.box(L.crtW + 0.05, L.crtH + 0.05, 0.03, COL.bezel, cx, y + L.crtY, desk + L.crtZ - 0.006, L.crtTilt);
  }
  // hood with the event-light strip, low enough to see the wall screens over it
  b.box(w, 0.07, 0.38, COL.top, x0, y + L.top - 0.035, desk - 0.8);
  b.box(w, 0.01, 0.38, COL.trim, x0, y + L.top - 0.074, desk - 0.8);
  // back (the side facing the screens)
  b.box(w, L.top, 0.03, COL.bodyDark, x0, y + L.top / 2, desk - 0.97);
  // separator line between positions
  b.box(0.012, 0.66, 0.63, COL.trim, x0 - w / 2, y + 0.37, desk - 0.64);
}

function addDeskProps(b, x0, tierY, desk, r, { headsetOnDesk, player = false }) {
  const y = tierY + 0.755;
  // rotary-dial telephone (black or beige) — kept off the player's desk edge (it would fill the view)
  if (r() < 0.75 && !player) {
    const px = x0 + 0.5 + (r() - 0.5) * 0.08;
    const pz = desk - 0.25;
    const tone = r() < 0.7 ? '#151515' : '#b8ad92';
    b.box(0.19, 0.075, 0.21, tone, px, y + 0.035, pz, 0, (r() - 0.5) * 0.4);
    b.add(new THREE.CapsuleGeometry(0.028, 0.15, 4, 8), tone, mtx(px, y + 0.095, pz, 0, 0, Math.PI / 2));
    b.cyl(0.055, 0.055, 0.006, '#d8d2c2', px, y + 0.074, pz + 0.04, 16);
  }
  // coffee mug or paper cup
  if (r() < 0.85 && !player) {
    const mx = x0 - 0.55 + r() * 0.5;
    const mz = desk - 0.08 - r() * 0.18;
    b.cyl(0.038, 0.034, 0.095, r() < 0.5 ? '#e9e4d6' : '#c74a33', mx, y + 0.047, mz, 14);
    b.cyl(0.032, 0.032, 0.004, '#2a1608', mx, y + 0.092, mz, 12);
  }
  // glass ashtray
  if (r() < 0.6) {
    const ax = x0 + 0.15 + r() * 0.3;
    b.cyl(0.07, 0.06, 0.026, '#3b4a4f', ax, y + 0.013, desk - 0.05 - r() * 0.1, 18);
    b.cyl(0.045, 0.045, 0.003, '#606060', ax, y + 0.027, desk - 0.08, 12);
  }
  // procedures binder (closed or open) and loose sheets
  if (r() < 0.8) {
    const bx = x0 - 0.2 + (r() - 0.5) * 0.4;
    const bz = desk - 0.16;
    const colors = ['#1e3c74', '#7a1e1e', '#1d1d1d', '#e2dccb', '#2d5a3a'];
    const c = colors[Math.floor(r() * colors.length)];
    if (r() < 0.5) {
      b.box(0.29, 0.045, 0.24, c, bx, y + 0.022, bz, 0, (r() - 0.5) * 0.5);
    } else {
      b.box(0.56, 0.012, 0.25, c, bx, y + 0.006, bz, 0, (r() - 0.5) * 0.3);
      b.box(0.52, 0.006, 0.23, '#f1ede2', bx, y + 0.015, bz, 0, (r() - 0.5) * 0.3);
    }
  }
  for (let i = 0; i < 2; i++) {
    if (r() < 0.6) b.box(0.21, 0.002, 0.28, '#efeadb', x0 + (r() - 0.5) * 1.1, y + 0.002 + i * 0.002, desk - 0.12 - r() * 0.12, 0, (r() - 0.5) * 0.8);
  }
  if (headsetOnDesk) {
    const hx = x0 + 0.3;
    b.add(new THREE.TorusGeometry(0.08, 0.008, 6, 16, Math.PI), '#1a1a1a', mtx(hx, y + 0.01, desk - 0.1, -Math.PI / 2));
    b.cyl(0.03, 0.03, 0.02, '#1a1a1a', hx - 0.08, y + 0.01, desk - 0.1);
  }
}

// ------------------------------------------------------------------ plaques & signage

const PLAQUES = ['GEMINI IV', 'GEMINI VII', 'GEMINI VIII', 'GEMINI IX', 'GEMINI X', 'GEMINI XI', 'GEMINI XII', 'APOLLO 7', 'APOLLO 8', 'APOLLO 9', 'APOLLO 10', 'APOLLO 11', 'APOLLO 12'];

function plaqueTexture(names) {
  const n = names.length;
  const c = document.createElement('canvas');
  c.width = 256 * n;
  c.height = 256;
  const g = c.getContext('2d');
  names.forEach((name, i) => {
    const x = i * 256;
    g.fillStyle = '#3a2a1c';
    g.fillRect(x, 0, 256, 256);
    g.strokeStyle = '#c9a85a';
    g.lineWidth = 6;
    g.strokeRect(x + 10, 10, 236, 236);
    const hue = (i * 47) % 360;
    const grd = g.createRadialGradient(x + 128, 112, 10, x + 128, 112, 78);
    grd.addColorStop(0, `hsl(${hue},55%,62%)`);
    grd.addColorStop(1, `hsl(${(hue + 40) % 360},60%,28%)`);
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x + 128, 112, 76, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#e8d9a8';
    g.lineWidth = 4;
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.beginPath();
    g.arc(x + 150, 92, 18, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#f2e6c4';
    g.font = '700 26px "Barlow Condensed", sans-serif';
    g.textAlign = 'center';
    g.fillText(name, x + 128, 222);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function signTexture(text, sub) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#16191b';
  g.fillRect(0, 0, 1024, 128);
  g.fillStyle = '#d9d4c4';
  g.font = '700 54px "Barlow Condensed", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 512, sub ? 50 : 64);
  if (sub) {
    g.font = '600 28px "Barlow Condensed", sans-serif';
    g.fillStyle = '#9a968a';
    g.fillText(sub, 512, 100);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function nameplateTexture(name) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 72;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 72);
  grd.addColorStop(0, '#2c2e2f');
  grd.addColorStop(1, '#121314');
  g.fillStyle = grd;
  g.fillRect(0, 0, 512, 72);
  g.fillStyle = '#f2efe4';
  g.font = '700 50px "Barlow Condensed", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(name.replace('_', ' '), 256, 38);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ------------------------------------------------------------------ room

/**
 * @returns {{ group: THREE.Group, slots: Map<string, object>, screens: object, lights: object,
 *   colliders: Array<{x0,x1,z0,z1}>, dispose(): void }}
 */
export function buildRoom({ quality = 'medium', seed = 1969, playerConsole = null } = {}) {
  const group = new THREE.Group();
  const T = makeTextures();
  const disposables = [T.carpet, T.wood, T.fabric, T.ceiling];
  const r = rng(seed);
  const { halfW, front, back, ceiling, tierH } = ROOM;
  const depth = back - front;

  // ---- floor tiers (carpet tops + risers)
  const carpetMat = new THREE.MeshStandardMaterial({ map: T.carpet, roughness: 0.97, metalness: 0 });
  const tops = new Batch();
  const risers = new Batch();
  for (let i = 0; i < TIER_Z.length; i++) {
    const z0 = TIER_Z[i];
    const z1 = i + 1 < TIER_Z.length ? TIER_Z[i + 1] : back;
    const y = i * tierH;
    const g = new THREE.PlaneGeometry(halfW * 2, z1 - z0);
    // UVs in metres so the carpet tiles evenly
    const uv = g.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * halfW * 0.5, uv.getY(k) * (z1 - z0) * 0.25);
    tops.add(g, '#ffffff', mtx(0, y, (z0 + z1) / 2, -Math.PI / 2));
    if (i > 0) {
      risers.box(halfW * 2, tierH, 0.04, '#20252a', 0, y - tierH / 2, z0);
      // aluminium nosing on the step edge
      risers.box(halfW * 2, 0.02, 0.06, '#8d9499', 0, y - 0.005, z0 + 0.02);
    }
  }
  const floorMesh = tops.mesh(new THREE.MeshStandardMaterial({ map: T.carpet, vertexColors: true, roughness: 0.97 }));
  floorMesh.receiveShadow = true;
  group.add(floorMesh);
  void carpetMat;
  group.add(risers.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.2 })));

  // ---- walls
  const wallH = ceiling;
  const lower = 2.5;
  const woodMat = new THREE.MeshStandardMaterial({ map: T.wood, roughness: 0.62, metalness: 0.02 });
  const fabricMat = new THREE.MeshStandardMaterial({ map: T.fabric, roughness: 0.95 });
  for (const side of [-1, 1]) {
    const wl = new THREE.Mesh(new THREE.PlaneGeometry(depth, lower), woodMat);
    wl.position.set(side * halfW, lower / 2, front + depth / 2);
    wl.rotation.y = -side * Math.PI / 2;
    group.add(wl);
    const wu = new THREE.Mesh(new THREE.PlaneGeometry(depth, wallH - lower), fabricMat);
    wu.position.set(side * halfW, lower + (wallH - lower) / 2, front + depth / 2);
    wu.rotation.y = -side * Math.PI / 2;
    group.add(wu);
  }
  // chair rail between wood and fabric
  const trims = new Batch();
  for (const side of [-1, 1]) trims.box(0.05, 0.06, depth, '#2a2016', side * (halfW - 0.025), lower, front + depth / 2);

  // ---- front wall: dark surround with the screen recesses
  const fw = new Batch();
  fw.box(halfW * 2, wallH, 0.1, '#15181b', 0, wallH / 2, front - 0.05);
  // stage below the screens
  fw.box(halfW * 2, 0.9, 0.9, '#1d2125', 0, 0.45, front + 0.45);
  fw.box(halfW * 2, 0.03, 0.92, '#3a4046', 0, 0.9, front + 0.45);
  group.add(fw.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 })));

  // screens (textures supplied by MOCRView)
  const screenMat = () => new THREE.MeshBasicMaterial({ color: 0x222831, toneMapped: false });
  const mkScreen = (w, h, x, y) => {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.16, h + 0.16, 0.06), new THREE.MeshStandardMaterial({ color: 0x08090a, roughness: 0.6 }));
    frame.position.set(x, y, front + 0.02);
    group.add(frame);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), screenMat());
    m.position.set(x, y, front + 0.06);
    group.add(m);
    return m;
  };
  const mainW = 6.9;
  const mainH = mainW / 2.25;
  const screens = {
    main: mkScreen(mainW, mainH, 0, 2.25 + mainH / 2),
    left1: mkScreen(3.0, 2.25, -(mainW / 2 + 0.3 + 1.5), 3.6),
    left2: mkScreen(3.0, 2.25, -(mainW / 2 + 0.6 + 4.5), 3.6),
    right1: mkScreen(3.0, 2.25, mainW / 2 + 0.3 + 1.5, 3.6),
    right2: mkScreen(3.0, 2.25, mainW / 2 + 0.6 + 4.5, 3.6),
    clock: mkScreen(6.6, 0.52, 0, 2.25 + mainH + 0.36),
  };
  // sign over the side screens
  const signMat = new THREE.MeshBasicMaterial({ map: signTexture('MISSION OPERATIONS CONTROL ROOM', 'MANNED SPACECRAFT CENTER · HOUSTON, TEXAS'), toneMapped: true });
  disposables.push(signMat.map);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 0.58), signMat);
  sign.position.set(-(mainW / 2 + 3.3), 5.3, front + 0.03);
  group.add(sign);
  const sign2 = sign.clone();
  sign2.material = new THREE.MeshBasicMaterial({ map: signTexture('APOLLO', 'MSFN · NASA'), toneMapped: true });
  disposables.push(sign2.material.map);
  sign2.position.x = mainW / 2 + 3.3;
  group.add(sign2);

  // ---- ceiling with fluorescent troffers
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(halfW * 2, depth), new THREE.MeshStandardMaterial({ map: T.ceiling, roughness: 1 }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(0, ceiling, front + depth / 2);
  group.add(ceil);
  const troffers = new Batch();
  for (let z = front + 2.5; z < back - 1; z += 2.6) {
    for (let x = -halfW + 2.2; x <= halfW - 2.2; x += 3.3) troffers.box(1.2, 0.03, 0.6, '#ffffff', x, ceiling - 0.016, z);
  }
  const trofMat = new THREE.MeshStandardMaterial({ vertexColors: true, emissive: 0xfff3dc, emissiveIntensity: 0.9, roughness: 0.4 });
  group.add(troffers.mesh(trofMat));

  // ---- back wall + viewing room
  const bw = new Batch();
  const topTier = (TIER_Z.length - 1) * tierH;
  bw.box(halfW * 2, 1.1, 0.12, '#2a2622', 0, topTier + 0.55, back);
  bw.box(halfW * 2, wallH - topTier - 3.4, 0.12, '#2a2622', 0, topTier + 3.4 + (wallH - topTier - 3.4) / 2, back);
  for (let x = -halfW; x <= halfW; x += 2.75) bw.box(0.1, 2.3, 0.14, '#1a1714', x, topTier + 2.25, back);
  // viewing room behind the glass
  const vr = 4;
  bw.box(halfW * 2, 0.05, vr, '#2b2723', 0, topTier + 0.7, back + vr / 2);
  bw.box(halfW * 2, wallH, 0.1, '#221f1c', 0, wallH / 2, back + vr);
  for (let row = 0; row < 3; row++) {
    for (let x = -halfW + 1; x < halfW - 0.5; x += 0.7) {
      const zz = back + 0.9 + row * 1.0;
      const yy = topTier + 0.75 + row * 0.25;
      bw.box(0.5, 0.06, 0.45, '#5b2b24', x, yy + 0.42, zz);
      bw.box(0.5, 0.45, 0.06, '#5b2b24', x, yy + 0.66, zz + 0.22);
    }
  }
  group.add(bw.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 })));
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(halfW * 2, 2.3),
    new THREE.MeshStandardMaterial({ color: 0x1a2630, transparent: true, opacity: 0.38, roughness: 0.05, metalness: 0.6, depthWrite: false }),
  );
  glass.position.set(0, topTier + 2.25, back - 0.02);
  glass.rotation.y = Math.PI;
  group.add(glass);
  const vrLight = new THREE.PointLight(0xffd9a0, 6, 9, 2);
  vrLight.position.set(0, topTier + 3, back + 2);
  group.add(vrLight);

  // ---- plaques on the side walls
  const plaqueTex = plaqueTexture(PLAQUES);
  disposables.push(plaqueTex);
  const plaqueMat = new THREE.MeshStandardMaterial({ map: plaqueTex, roughness: 0.6, metalness: 0.15 });
  const plaques = new THREE.Group();
  PLAQUES.forEach((name, i) => {
    const side = i % 2 === 0 ? -1 : 1;
    const k = Math.floor(i / 2);
    const g = new THREE.PlaneGeometry(0.62, 0.62);
    const uv = g.attributes.uv;
    for (let j = 0; j < uv.count; j++) uv.setX(j, (i + uv.getX(j)) / PLAQUES.length);
    const m = new THREE.Mesh(g, plaqueMat);
    m.position.set(side * (halfW - 0.02), 3.35, front + 3 + k * 2.05);
    m.rotation.y = -side * Math.PI / 2;
    plaques.add(m);
  });
  group.add(plaques);

  // ---- consoles
  const body = new Batch();
  const props = new Batch();
  const slots = new Map();
  const colliders = [];
  for (const row of ROWS) {
    const n = row.consoles.length;
    const tierY = row.tier * tierH;
    const x0 = -(n * ROOM.posW) / 2 + ROOM.posW / 2;
    // end caps of the bank
    const ends = [x0 - ROOM.posW / 2, x0 + (n - 1) * ROOM.posW + ROOM.posW / 2];
    for (const ex of ends) body.box(0.05, CONSOLE_LOCAL.top + 0.02, 1.04, COL.bodyDark, ex, tierY + (CONSOLE_LOCAL.top + 0.02) / 2, row.desk - 0.5);
    colliders.push({ x0: ends[0] - 0.1, x1: ends[1] + 0.1, z0: row.desk - 1.05, z1: row.desk + 0.12, y: tierY });
    row.consoles.forEach((id, i) => {
      const x = x0 + i * ROOM.posW;
      addConsoleBody(body, x, tierY, row.desk);
      addDeskProps(props, x, tierY, row.desk, r, { headsetOnDesk: id === playerConsole, player: id === playerConsole });
      slots.set(id, {
        id,
        x,
        tierY,
        desk: row.desk,
        row: ROWS.indexOf(row),
        seat: new THREE.Vector3(x, tierY + ROOM.eye, row.desk + 0.5),
      });
    });
  }
  const consoleMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.12 });
  group.add(body.mesh(consoleMat));
  const propMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.05 });
  group.add(props.mesh(propMat));
  group.add(trims.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 })));

  // ---- lights
  const hemi = new THREE.HemisphereLight(0xe2e8f0, 0x3b342d, quality === 'low' ? 1.25 : 1.0);
  group.add(hemi);
  const key = new THREE.DirectionalLight(0xfff1dc, 1.1);
  key.position.set(-4, 12, 14);
  group.add(key, key.target);
  const rowLights = ROWS.map((row) => {
    const l = new THREE.PointLight(0xffe6c0, quality === 'low' ? 0 : 7, 7, 2);
    l.position.set(0, row.tier * tierH + 3.6, row.desk + 0.6);
    group.add(l);
    return l;
  });
  // the projection screens light the front of the room a little
  const screenGlow = new THREE.PointLight(0x7fb2ff, 9, 16, 2);
  screenGlow.position.set(0, 3.4, front + 2.5);
  group.add(screenGlow);

  return {
    group,
    slots,
    screens,
    colliders,
    lights: { hemi, key, rowLights, screenGlow },
    dispose() {
      for (const t of disposables) t.dispose();
      group.traverse((o) => {
        o.geometry?.dispose?.();
        if (o.material) for (const m of [].concat(o.material)) m.dispose?.();
      });
    },
  };
}
