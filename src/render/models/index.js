// Procedural models of the Apollo hardware with PBR materials and canvas-painted liveries.
// Model space = body axes (metres): Saturn V / CSM: +X toward the nose. LM: +X up, +Z forward.
// Origins = module datums (geometry.js); buildConfigModel() assembles a configuration around its
// reference point. Each create*() returns { root, parts, nozzles } — nozzles are Object3D anchors
// at engine exit planes whose local −X points along the exhaust (used by the exhaust effects).

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GEOM, STACK, STACK_IB, CONFIGS, moduleTransform } from '../../sim/geometry.js';

const R = GEOM.saturnV.diameter / 2; // 5.03
const RS4 = GEOM.saturnV.sivbDiameter / 2; // 3.30
const TAU = Math.PI * 2;

// ------------------------------------------------------------------ canvas textures

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function tex(c, { srgb = true, repeat = false, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

let _seed = 4242;
const rnd = () => ((_seed = (_seed * 16807) % 2147483647) / 2147483647);

/** Normal map from a greyscale height canvas (Sobel). */
function heightToNormal(src, strength = 2) {
  const w = src.width;
  const h = src.height;
  const sd = src.getContext('2d').getImageData(0, 0, w, h).data;
  const out = canvas(w, h);
  const og = out.getContext('2d');
  const img = og.createImageData(w, h);
  const H = (x, y) => sd[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / len) * 255;
      img.data[i + 3] = 255;
    }
  }
  og.putImageData(img, 0, 0);
  return out;
}

/** Subtle weathering on painted surfaces: soft streaks and blotches. */
function grime(g, w, h, amount = 1) {
  for (let i = 0; i < 260 * amount; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    g.fillStyle = `rgba(${rnd() < 0.5 ? '60,55,50' : '255,255,255'},${0.012 + rnd() * 0.025})`;
    g.fillRect(x, y, 2 + rnd() * 6, 20 + rnd() * 120);
  }
  for (let i = 0; i < 90 * amount; i++) {
    g.fillStyle = `rgba(70,64,58,${0.01 + rnd() * 0.02})`;
    g.beginPath();
    g.arc(rnd() * w, rnd() * h, 6 + rnd() * 40, 0, TAU);
    g.fill();
  }
}

function drawFlag(g, x, y, w, h) {
  for (let i = 0; i < 13; i++) {
    g.fillStyle = i % 2 ? '#f4f4f0' : '#b0262f';
    g.fillRect(x, y + (i * h) / 13, w, h / 13 + 0.6);
  }
  g.fillStyle = '#2f3069';
  g.fillRect(x, y, w * 0.4, (h * 7) / 13);
  g.fillStyle = '#f4f4f0';
  for (let r = 0; r < 9; r++) for (let c = 0; c < (r % 2 ? 5 : 6); c++) g.fillRect(x + w * 0.4 * ((c + (r % 2 ? 1 : 0.5)) / 6.2), y + ((h * 7) / 13) * ((r + 0.6) / 9.6), 2, 2);
}

/** Stacked upright letters (as painted on the S-IC). */
function stackedText(g, text, cx, yTop, letterH, pitch, sx = 1, color = '#121212') {
  g.save();
  g.fillStyle = color;
  g.font = `700 ${letterH}px "Barlow Condensed", "Arial Narrow", Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'top';
  [...text].forEach((ch, i) => {
    if (ch === ' ') return;
    g.save();
    g.translate(cx, yTop + i * pitch);
    g.scale(sx, 1);
    g.fillText(ch, 0, 0);
    g.restore();
  });
  g.restore();
}

/** Black/white roll-pattern band: 8 alternating sectors between v0..v1 (canvas y). */
function rollBand(g, w, y0, y1, offset = 0, black = '#151515') {
  g.fillStyle = black;
  for (let i = 0; i < 4; i++) g.fillRect(((i + offset) / 4) * w, y0, w / 8, y1 - y0);
}

function corrugation(g, w, y0, y1, step = 6, alpha = 0.16) {
  for (let x = 0; x < w; x += step) {
    g.fillStyle = `rgba(0,0,0,${alpha})`;
    g.fillRect(x, y0, step * 0.35, y1 - y0);
    g.fillStyle = `rgba(255,255,255,${alpha * 0.6})`;
    g.fillRect(x + step * 0.5, y0, step * 0.2, y1 - y0);
  }
}

// S-IC body from x=5.8 to 42.0 m (36.2 m). Canvas y = (1 − v) · H, top of the stage at y = 0.
function sicLivery() {
  const W = 2048;
  const H = 2048;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  const hc = canvas(1024, 1024);
  const hg = hc.getContext('2d');
  const y = (x) => (1 - (x - 5.8) / 36.2) * H;
  const yh = (x) => (1 - (x - 5.8) / 36.2) * 1024;
  g.fillStyle = '#f1f0eb';
  g.fillRect(0, 0, W, H);
  hg.fillStyle = '#808080';
  hg.fillRect(0, 0, 1024, 1024);
  // forward skirt roll pattern (39.2–42) + intertank (19.6–26.2) + thrust structure (5.8–9.4)
  rollBand(g, W, y(42), y(39.2), 0);
  rollBand(g, W, y(26.2), y(19.6), 0.5);
  rollBand(g, W, y(9.4), y(5.8), 0);
  // corrugation (height) in skirts / intertank / thrust structure
  for (const [a, b] of [[42, 39.2], [26.2, 19.6], [9.4, 5.8]]) {
    for (let x = 0; x < 1024; x += 4) {
      hg.fillStyle = '#b0b0b0';
      hg.fillRect(x, yh(a), 2, yh(b) - yh(a));
    }
    corrugation(g, W, y(a), y(b), 8, 0.08);
  }
  // tank weld rings / panel lines
  g.fillStyle = 'rgba(40,40,40,0.25)';
  for (const x of [9.4, 12.5, 15.6, 19.6, 26.2, 29.5, 32.8, 36.1, 39.2]) g.fillRect(0, y(x) - 1.5, W, 3);
  hg.fillStyle = '#5a5a5a';
  for (const x of [9.4, 19.6, 26.2, 39.2]) hg.fillRect(0, yh(x) - 1, 1024, 2);
  // flag + UNITED STATES (LOX tank) and USA (RP-1 tank) on two opposite sides
  const pxm = H / 36.2; // px per metre vertically
  const sx = (W / (TAU * R)) / pxm; // horizontal stretch to keep letters proportional
  for (const u of [0.125, 0.625]) {
    const cx = u * W;
    const fw = 3.6 * pxm * sx;
    drawFlag(g, cx - fw / 2, y(38.7), fw, 2.4 * pxm);
    stackedText(g, 'UNITED', cx, y(35.6), 0.78 * pxm, 0.86 * pxm, sx);
    stackedText(g, 'STATES', cx, y(30.2), 0.78 * pxm, 0.86 * pxm, sx);
    stackedText(g, 'USA', cx, y(17.6), 1.7 * pxm, 1.85 * pxm, sx);
  }
  // cable-tunnel shadow line
  g.fillStyle = 'rgba(0,0,0,0.12)';
  g.fillRect(0.375 * W - 3, 0, 6, H);
  grime(g, W, H, 1.4);
  return { map: tex(c), normal: tex(heightToNormal(hc, 3), { srgb: false }) };
}

// S-II: interstage 42–47.6 + stage 47.6–66.9 (24.9 m)
function siiLivery() {
  const W = 2048;
  const H = 1536;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  const hc = canvas(1024, 768);
  const hg = hc.getContext('2d');
  const y = (x) => (1 - x / 24.9) * H;
  const yh = (x) => (1 - x / 24.9) * 768;
  g.fillStyle = '#f0efea';
  g.fillRect(0, 0, W, H);
  hg.fillStyle = '#808080';
  hg.fillRect(0, 0, 1024, 768);
  // forward skirt roll pattern (22.4–24.9), aft interstage stringers (0–5.6), aft skirt (5.6–7.8)
  rollBand(g, W, y(24.9), y(22.6), 0.5);
  for (const [a, b] of [[24.9, 22.6], [5.6, 0], [7.8, 5.6]]) {
    for (let x = 0; x < 1024; x += 5) {
      hg.fillStyle = '#a8a8a8';
      hg.fillRect(x, yh(a), 2, yh(b) - yh(a));
    }
    corrugation(g, W, y(a), y(b), 10, 0.06);
  }
  g.fillStyle = 'rgba(40,40,40,0.25)';
  for (const x of [5.6, 7.8, 12, 16, 20, 22.6]) g.fillRect(0, y(x) - 1.5, W, 3);
  // separation plane line at interstage top
  g.fillStyle = '#222';
  g.fillRect(0, y(5.6) - 3, W, 6);
  grime(g, W, H, 1.1);
  return { map: tex(c), normal: tex(heightToNormal(hc, 2.5), { srgb: false }) };
}

// S-IVB tank from local 2.0 to 17.9 (15.9 m)
function sivbLivery() {
  const W = 1536;
  const H = 1536;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  const y = (x) => (1 - (x - 2.0) / 15.9) * H;
  g.fillStyle = '#f0efea';
  g.fillRect(0, 0, W, H);
  // aft skirt roll pattern with the four black quadrant stripes running up the tank
  rollBand(g, W, y(4.3), y(2.0), 0);
  g.fillStyle = '#151515';
  for (let i = 0; i < 4; i++) g.fillRect((i / 4 + 0.03) * W, y(10.5), W / 40, y(4.3) - y(10.5));
  corrugation(g, W, y(4.3), y(2.0), 8, 0.07);
  corrugation(g, W, y(17.9), y(15.8), 8, 0.06);
  g.fillStyle = 'rgba(40,40,40,0.3)';
  for (const x of [4.3, 15.8]) g.fillRect(0, y(x) - 1.5, W, 3);
  grime(g, W, H, 0.9);
  return { map: tex(c) };
}

function iuLivery() {
  const c = canvas(1024, 64);
  const g = c.getContext('2d');
  g.fillStyle = '#d9d8d2';
  g.fillRect(0, 0, 1024, 64);
  g.fillStyle = '#2a2a2a';
  for (let i = 0; i < 24; i++) g.fillRect(i * 42 + 6, 14, 22 + (i % 3) * 6, 30);
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(0, 0, 1024, 3);
  g.fillRect(0, 61, 1024, 3);
  return tex(c);
}

function slaLivery() {
  const c = canvas(1024, 512);
  const g = c.getContext('2d');
  g.fillStyle = '#e8e6df';
  g.fillRect(0, 0, 1024, 512);
  g.fillStyle = 'rgba(30,30,30,0.5)';
  for (let i = 0; i < 4; i++) g.fillRect(i * 256 - 1, 0, 3, 512);
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(0, 300, 1024, 3);
  for (let i = 0; i < 4; i++) {
    g.fillStyle = '#1a1a1a';
    g.fillRect(i * 256 + 100, 430, 56, 30);
  }
  grime(g, 1024, 512, 0.6);
  return tex(c);
}

function smLivery({ damaged = false } = {}) {
  const c = canvas(1024, 512);
  const g = c.getContext('2d');
  g.fillStyle = '#c9ccd0';
  g.fillRect(0, 0, 1024, 512);
  // bays separated by longerons; white radiator panels on the upper half
  for (let i = 0; i < 6; i++) {
    g.fillStyle = 'rgba(30,30,30,0.35)';
    g.fillRect((i * 1024) / 6, 0, 3, 512);
  }
  g.fillStyle = '#eceae4';
  for (let i = 0; i < 6; i++) g.fillRect((i * 1024) / 6 + 18, 30, 1024 / 6 - 36, 190);
  g.fillStyle = 'rgba(0,0,0,0.12)';
  for (let y = 40; y < 220; y += 12) g.fillRect(0, y, 1024, 2);
  // EPS radiators near the CM end
  g.fillStyle = '#f2f1ec';
  g.fillRect(340, 0, 120, 26);
  g.fillRect(852, 0, 120, 26);
  g.fillStyle = '#1b1b1b';
  g.font = '700 40px "Barlow Condensed", Arial';
  g.textAlign = 'center';
  g.save();
  g.translate(170, 380);
  g.scale(1.5, 1);
  g.fillText('UNITED STATES', 0, 0);
  g.restore();
  if (damaged) {
    g.fillStyle = '#1a1410';
    g.fillRect(512 + 10, 20, 150, 470);
    g.fillStyle = '#7a5a30';
    for (let i = 0; i < 60; i++) g.fillRect(512 + 10 + rnd() * 150, 20 + rnd() * 470, 3 + rnd() * 10, 2 + rnd() * 6);
  }
  grime(g, 1024, 512, 0.5);
  return tex(c);
}

function kaptonMaps(gold = true) {
  const W = 512;
  const c = canvas(W, W);
  const g = c.getContext('2d');
  const hc = canvas(W, W);
  const hg = hc.getContext('2d');
  const grd = g.createLinearGradient(0, 0, W, W);
  if (gold) {
    grd.addColorStop(0, '#b47a12');
    grd.addColorStop(0.5, '#e8b23a');
    grd.addColorStop(1, '#9a6608');
  } else {
    grd.addColorStop(0, '#1d1d1f');
    grd.addColorStop(1, '#2c2c30');
  }
  g.fillStyle = grd;
  g.fillRect(0, 0, W, W);
  hg.fillStyle = '#808080';
  hg.fillRect(0, 0, W, W);
  for (let i = 0; i < 1400; i++) {
    const x = rnd() * W;
    const y = rnd() * W;
    const len = 10 + rnd() * 60;
    const a = rnd() * TAU;
    const light = rnd() < 0.5;
    g.strokeStyle = gold ? `rgba(${light ? '255,236,170' : '70,40,0'},${0.12 + rnd() * 0.25})` : `rgba(${light ? '120,120,130' : '0,0,0'},${0.15 + rnd() * 0.2})`;
    g.lineWidth = 1 + rnd() * 3;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
    hg.strokeStyle = light ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)';
    hg.lineWidth = 2 + rnd() * 4;
    hg.beginPath();
    hg.moveTo(x, y);
    hg.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    hg.stroke();
  }
  return { map: tex(c, { repeat: true }), normal: tex(heightToNormal(hc, 4), { srgb: false, repeat: true }) };
}

function f1Tubes() {
  // F-1 thrust chamber: brazed Inconel tubes (vertical stripes), bronze-dark
  const c = canvas(512, 256);
  const g = c.getContext('2d');
  g.fillStyle = '#3b332c';
  g.fillRect(0, 0, 512, 256);
  for (let x = 0; x < 512; x += 4) {
    g.fillStyle = `rgba(${150 + rnd() * 40},${120 + rnd() * 30},${90 + rnd() * 20},0.35)`;
    g.fillRect(x, 0, 2, 256);
  }
  return tex(c, { repeat: true });
}

function cmFoil() {
  const c = canvas(512, 512);
  const g = c.getContext('2d');
  g.fillStyle = '#d7dbe0';
  g.fillRect(0, 0, 512, 512);
  // aluminised Mylar strips
  for (let x = 0; x < 512; x += 16) {
    g.fillStyle = `rgba(${200 + rnd() * 55},${200 + rnd() * 55},${205 + rnd() * 50},0.55)`;
    g.fillRect(x, 0, 15, 512);
    g.fillStyle = 'rgba(80,80,90,0.25)';
    g.fillRect(x + 15, 0, 1, 512);
  }
  return tex(c, { repeat: true });
}

// ------------------------------------------------------------------ materials

const MAT = {};
export function materials() {
  if (MAT.ready) return MAT;
  MAT.ready = true;
  const sic = sicLivery();
  const sii = siiLivery();
  const sivb = sivbLivery();
  const kg = kaptonMaps(true);
  const kb = kaptonMaps(false);
  const std = (o) => new THREE.MeshStandardMaterial(o);
  MAT.sic = std({ map: sic.map, normalMap: sic.normal, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.62, metalness: 0.05 });
  MAT.sii = std({ map: sii.map, normalMap: sii.normal, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.6, metalness: 0.05 });
  MAT.sivb = std({ map: sivb.map, roughness: 0.6, metalness: 0.05 });
  MAT.iu = std({ map: iuLivery(), roughness: 0.55, metalness: 0.2 });
  MAT.sla = std({ map: slaLivery(), roughness: 0.6, metalness: 0.15, side: THREE.DoubleSide });
  MAT.white = std({ color: 0xefeee9, roughness: 0.6, metalness: 0.03 });
  MAT.whiteDS = std({ color: 0xefeee9, roughness: 0.6, metalness: 0.03, side: THREE.DoubleSide });
  MAT.black = std({ color: 0x141414, roughness: 0.7, metalness: 0.05 });
  MAT.heatShield = std({ color: 0x222120, roughness: 0.9, metalness: 0.1, side: THREE.DoubleSide });
  MAT.f1Chamber = std({ map: f1Tubes(), roughness: 0.5, metalness: 0.7, side: THREE.DoubleSide });
  MAT.f1Ext = std({ color: 0x17181a, roughness: 0.55, metalness: 0.5, side: THREE.DoubleSide });
  MAT.nozzleIn = std({ color: 0x2a201b, roughness: 0.85, metalness: 0.3, side: THREE.BackSide });
  MAT.engine = std({ color: 0x5b5d61, roughness: 0.4, metalness: 0.8, side: THREE.DoubleSide });
  MAT.j2 = std({ color: 0x7c7f84, roughness: 0.35, metalness: 0.85, side: THREE.DoubleSide });
  MAT.insul = std({ color: 0xb9bcc0, roughness: 0.38, metalness: 0.9 });
  MAT.alu = std({ color: 0xc9ccd1, roughness: 0.32, metalness: 0.85 });
  MAT.darkMetal = std({ color: 0x2d2f33, roughness: 0.5, metalness: 0.6 });
  MAT.les = std({ color: 0xb8401d, roughness: 0.5, metalness: 0.25 });
  MAT.cm = std({ map: cmFoil(), color: 0xe9ecf0, roughness: 0.16, metalness: 1.0 });
  MAT.sm = std({ map: smLivery(), roughness: 0.35, metalness: 0.6 });
  MAT.smDamaged = std({ map: smLivery({ damaged: true }), roughness: 0.35, metalness: 0.6 });
  MAT.sps = std({ color: 0x3d3a44, roughness: 0.4, metalness: 0.75, side: THREE.DoubleSide });
  MAT.spsUpper = std({ color: 0xa9adb3, roughness: 0.3, metalness: 0.9, side: THREE.DoubleSide });
  MAT.kapton = std({ map: kg.map, normalMap: kg.normal, roughness: 0.28, metalness: 0.75 });
  MAT.kaptonBlack = std({ map: kb.map, normalMap: kb.normal, roughness: 0.4, metalness: 0.5 });
  MAT.lmGrey = std({ color: 0x9a9da2, roughness: 0.5, metalness: 0.45 });
  MAT.lmDark = std({ color: 0x232427, roughness: 0.6, metalness: 0.35 });
  MAT.lmPanel = std({ color: 0x6f7378, roughness: 0.45, metalness: 0.55 });
  MAT.window = std({ color: 0x0b1118, roughness: 0.04, metalness: 0.95 });
  MAT.windowDS = std({ color: 0x0b1118, roughness: 0.04, metalness: 0.95, side: THREE.DoubleSide });
  MAT.heat = std({ color: 0x6a4a2e, roughness: 0.9, metalness: 0.05 });
  MAT.gold = std({ color: 0xd8a640, roughness: 0.25, metalness: 1.0 });
  MAT.dish = std({ color: 0xe8e8e2, roughness: 0.45, metalness: 0.2, side: THREE.DoubleSide });
  MAT.tower = std({ color: 0xa8341f, roughness: 0.65, metalness: 0.3 });
  MAT.towerDark = std({ color: 0x5a2014, roughness: 0.7, metalness: 0.3 });
  MAT.concrete = std({ color: 0xb6b2a8, roughness: 0.95, metalness: 0 });
  MAT.mlGrey = std({ color: 0x8e8e88, roughness: 0.85, metalness: 0.15 });
  MAT.dockTarget = std({ color: 0xf2f2f2, roughness: 0.6, emissive: 0x111111 });
  return MAT;
}

// ------------------------------------------------------------------ geometry helpers (along +X)

/** Lathe a profile [[x, radius], ...] around +X (v runs along the profile, u around from +Z). */
function latheX(profile, segs = 48, phiStart = 0, phiLength = TAU) {
  const pts = profile.map(([x, r]) => new THREE.Vector2(Math.max(r, 0.0001), x));
  const g = new THREE.LatheGeometry(pts, segs, phiStart, phiLength);
  g.rotateZ(-Math.PI / 2);
  return g;
}

function cylX(r0, r1, x0, x1, segs = 40, open = false) {
  const g = new THREE.CylinderGeometry(r1, r0, x1 - x0, segs, 1, open);
  g.rotateZ(-Math.PI / 2);
  g.translate((x0 + x1) / 2, 0, 0);
  return g;
}

function boxAt(sx, sy, sz, x, y, z) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.translate(x, y, z);
  return g;
}

/** Cylinder between two points. */
function rod(a, b, r, segs = 6) {
  const d = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.CylinderGeometry(r, r, d.length(), segs, 1, true);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

/** Remap a lathe's v (0..1 along the profile) into [v0, v1] so several meshes share one livery. */
function remapV(geo, v0, v1) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, v0 + uv.getY(i) * (v1 - v0));
  uv.needsUpdate = true;
}

function merged(list, mat) {
  const m = new THREE.Mesh(mergeGeometries(list.filter(Boolean), false), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function mesh(geo, mat) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Engine-exit anchor: local −X is the exhaust direction (rotate with `dir` if canted). */
function anchor(parent, x, y, z, dir = null) {
  const o = new THREE.Object3D();
  o.position.set(x, y, z);
  if (dir) o.quaternion.setFromUnitVectors(new THREE.Vector3(-1, 0, 0), dir.clone().normalize());
  parent.add(o);
  return o;
}

/** Rocket bell along −X from the throat at x=0: [[x, r], ...] profile helper. */
function bellProfile(throatR, exitR, len, n = 12, k = 0.62) {
  const p = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    p.push([-t * len, throatR + (exitR - throatR) * Math.pow(t, k)]);
  }
  return p;
}

// ------------------------------------------------------------------ engines

/** F-1 engine, exit plane at x=0, mounted at x≈5.8. Returns geometries per material. */
function f1Geoms(y, z, out) {
  const ext = latheX([[0, 1.88], [0.7, 1.74], [1.6, 1.58], [2.6, 1.42]], 40);
  const extIn = latheX([[0, 1.84], [2.6, 1.38]], 40);
  const ch = latheX([[2.6, 1.42], [3.3, 1.22], [4.0, 0.96], [4.6, 0.62], [4.85, 0.48], [5.05, 0.5], [5.35, 0.6], [5.75, 0.58], [5.9, 0.3], [5.95, 0.05]], 40);
  const man = new THREE.TorusGeometry(1.48, 0.15, 10, 40);
  man.rotateY(Math.PI / 2);
  man.translate(2.62, 0, 0);
  const tp = cylX(0.42, 0.42, 4.4, 5.9, 16);
  tp.translate(0, 0.98, 0.0);
  const duct = rod(new THREE.Vector3(4.5, 0.98, 0), new THREE.Vector3(2.8, 1.45, 0.0), 0.16, 10);
  const gg = cylX(0.18, 0.18, 4.7, 5.5, 10);
  gg.translate(0, -0.8, 0.4);
  const boot = latheX([[4.4, 0.8], [5.2, 0.76], [5.85, 0.66]], 24);
  for (const g of [ext, extIn, ch, man, tp, duct, gg, boot]) g.translate(0, y, z);
  out.ext.push(ext, man);
  out.extIn.push(extIn);
  out.ch.push(ch);
  out.misc.push(duct, gg);
  out.insul.push(tp, boot);
}

/** J-2 engine with exit plane at x=0 (bell, chamber, turbopumps). */
function j2Geoms(y, z, out, scale = 1) {
  const bell = latheX(bellProfile(0.32, 0.98, 2.5).map(([x, r]) => [x + 2.5, r]).reverse(), 28);
  const ch = latheX([[2.5, 0.32], [2.75, 0.42], [3.05, 0.44], [3.3, 0.3], [3.38, 0.05]], 20);
  const p1 = cylX(0.24, 0.24, 2.7, 3.35, 12);
  p1.translate(0, 0.62, 0);
  const p2 = cylX(0.2, 0.2, 2.7, 3.3, 12);
  p2.translate(0, -0.6, 0.1);
  for (const g of [bell, ch, p1, p2]) {
    g.scale(scale, scale, scale);
    g.translate(0, y, z);
  }
  out.bell.push(bell);
  out.misc.push(ch, p1, p2);
}

// ------------------------------------------------------------------ Saturn V

export function createSaturnV() {
  const m = materials();
  const root = new THREE.Group();
  root.name = 'SaturnV';
  const parts = {};
  const nozzles = { sic: [], sii: [], sivb: [], les: [], retro: [], ullage: [], aps: [] };

  // ================= S-IC (datum: F-1 exit plane)
  const sic = new THREE.Group();
  sic.add(mesh(latheX([[5.8, R], [42.0, R]], 72), m.sic));
  // forward lip & base heat shield
  sic.add(mesh(latheX([[41.85, R + 0.03], [42.0, R + 0.03]], 72), m.black));
  const hs = latheX([[5.8, 0.0], [5.8, R]], 48);
  sic.add(mesh(hs, m.heatShield));
  // cable tunnel (u = 0.375 around the stage)
  {
    const a = TAU * 0.375;
    const tun = cylX(0.32, 0.32, 6.5, 41.5, 10);
    tun.translate(0, -Math.sin(a) * (R + 0.05), Math.cos(a) * (R + 0.05));
    sic.add(mesh(tun, m.white));
  }
  // engine fairings + fins (at the outboard engines, 45° diagonals)
  const fair = [];
  const fairBand = [];
  const fins = [];
  const outR = GEOM.saturnV.sicOutboardRadius;
  const eng = [[0, 0]];
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const cy = Math.sin(a);
    const cz = Math.cos(a);
    eng.push([cy * outR, cz * outR]);
    const fg = latheX([[0.9, 2.12], [1.6, 2.2], [4.0, 2.05], [6.8, 1.6], [9.4, 0.75], [10.3, 0.15]], 28);
    fg.translate(0, cy * 3.95, cz * 3.95);
    fair.push(fg);
    const band = latheX([[0.9, 2.14], [1.9, 2.22]], 28);
    band.translate(0, cy * 3.95, cz * 3.95);
    fairBand.push(band);
    // fin: trapezoid in the (radial, x) plane, extruded tangentially
    const sh = new THREE.Shape();
    sh.moveTo(0, 0.7);
    sh.lineTo(0, 6.4);
    sh.lineTo(3.55, 2.3);
    sh.lineTo(3.55, 0.7);
    sh.closePath();
    const fgeo = new THREE.ExtrudeGeometry(sh, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 2, steps: 1 });
    fgeo.translate(0, 0, -0.15);
    // shape x → radial, shape y → body X, extrude z → tangential
    const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, cy, cz), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, cz, -cy));
    fgeo.applyMatrix4(basis);
    fgeo.translate(0, cy * 5.45, cz * 5.45);
    fins.push(fgeo);
  }
  sic.add(merged(fair, m.white), merged(fairBand, m.black), merged(fins, m.white));
  // F-1 engines
  const fo = { ext: [], extIn: [], ch: [], misc: [], insul: [] };
  for (const [y, z] of eng) f1Geoms(y, z, fo);
  sic.add(merged(fo.ext, m.f1Ext), merged(fo.extIn, m.nozzleIn), merged(fo.ch, m.f1Chamber), merged(fo.misc, m.engine), merged(fo.insul, m.insul));
  for (const [y, z] of eng) nozzles.sic.push(anchor(sic, 0.05, y, z));
  // retro-rockets: two per fairing near the top, firing forward and outward
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    for (const s of [-0.35, 0.35]) {
      const dir = new THREE.Vector3(1, Math.sin(a + s * 0.3) * 0.5, Math.cos(a + s * 0.3) * 0.5);
      nozzles.retro.push(anchor(sic, 9.0, Math.sin(a + s * 0.12) * 5.6, Math.cos(a + s * 0.12) * 5.6, dir.negate()));
    }
  }
  parts.sic = sic;

  // ================= S-II (datum: bottom of the S-IC/S-II interstage)
  const sii = new THREE.Group();
  const iTop = STACK.interstageTop - STACK.siiDatum; // 5.6
  const sTop = STACK.siiTop - STACK.siiDatum; // 24.9
  const interstage = new THREE.Group();
  const isMesh = mesh(latheX([[0, R], [iTop, R]], 72, 0, TAU), m.sii);
  remapV(isMesh.geometry, 0, iTop / sTop);
  interstage.add(isMesh);
  // the 8 ullage-motor fairings on the interstage
  const ull = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + Math.PI / 8;
    const g = latheX([[0.4, 0.05], [0.9, 0.32], [2.6, 0.32], [3.0, 0.05]], 12);
    g.translate(0, Math.sin(a) * (R + 0.12), Math.cos(a) * (R + 0.12));
    ull.push(g);
    nozzles.ullage.push(anchor(interstage, 0.35, Math.sin(a) * (R + 0.12), Math.cos(a) * (R + 0.12), new THREE.Vector3(-1, Math.sin(a) * 0.25, Math.cos(a) * 0.25)));
  }
  interstage.add(merged(ull, m.black));
  sii.add(interstage);
  parts.interstage = interstage;
  // stage body — u/v of the livery cover 0..24.9; build as lathe over the full span so the
  // texture lines up; the lower 5.6 m is hidden under the interstage.
  const siiBody = mesh(latheX([[iTop - 0.02, R - 0.02], [sTop, R - 0.02]], 72), m.sii);
  remapV(siiBody.geometry, iTop / sTop, 1);
  sii.add(siiBody);
  sii.add(mesh(latheX([[iTop, 0], [iTop, R - 0.05]], 48), m.heatShield));
  // thrust cone (visible after S-IC sep) + J-2 cluster
  sii.add(mesh(latheX([[iTop - 1.4, 2.3], [iTop - 0.2, 4.6], [iTop, 4.9]], 40), m.darkMetal));
  const jo = { bell: [], misc: [] };
  const siiEng = [[0, 0], ...[0, 1, 2, 3].map((i) => {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    return [Math.sin(a) * GEOM.saturnV.siiOutboardRadius, Math.cos(a) * GEOM.saturnV.siiOutboardRadius];
  })];
  for (const [y, z] of siiEng) {
    const g = { bell: [], misc: [] };
    j2Geoms(y, z, g);
    for (const b of g.bell) b.translate(iTop - 3.45, 0, 0);
    for (const b of g.misc) b.translate(iTop - 3.45, 0, 0);
    jo.bell.push(...g.bell);
    jo.misc.push(...g.misc);
    nozzles.sii.push(anchor(sii, iTop - 3.45, y, z));
  }
  sii.add(merged(jo.bell, m.j2), merged(jo.misc, m.engine));
  parts.sii = sii;

  // ================= S-IVB + IU (datum: J-2 exit plane)
  const sivb = new THREE.Group();
  const s4Top = STACK.sivbTop - STACK.sivbDatum; // 17.9
  const taper = mesh(latheX([[STACK.siiTop - STACK.sivbDatum, R - 0.02], [4.6, RS4]], 72), m.whiteDS);
  sivb.add(taper);
  parts.sivbInterstage = taper;
  sivb.add(mesh(latheX([[2.0, RS4], [s4Top, RS4]], 64), m.sivb));
  sivb.add(mesh(latheX([[2.0, 0], [2.0, RS4]], 40), m.heatShield));
  sivb.add(mesh(latheX([[s4Top, RS4 + 0.01], [s4Top + 0.9, RS4 + 0.01]], 64), m.iu));
  // APS modules (two pods, ±Y)
  const aps = [];
  for (const s of [-1, 1]) {
    const g = latheX([[2.0, 0.05], [2.3, 0.45], [3.8, 0.45], [4.4, 0.05]], 16);
    g.scale(1, 1.25, 0.8);
    g.translate(0, s * (RS4 + 0.3), 0);
    aps.push(g);
    nozzles.aps.push(anchor(sivb, 2.1, s * (RS4 + 0.3), 0));
  }
  sivb.add(merged(aps, m.black));
  const so = { bell: [], misc: [] };
  j2Geoms(0, 0, so);
  sivb.add(merged(so.bell, m.j2), merged(so.misc, m.engine));
  nozzles.sivb.push(anchor(sivb, 0.05, 0, 0));
  parts.sivb = sivb;

  // ================= SLA: fixed lower section + 4 upper panels hinged at its top edge
  const sla = new THREE.Group();
  const slaH = STACK.slaTop - STACK.slaDatum;
  const slaR = (x) => RS4 + (GEOM.csm.smRadius - RS4) * (x / slaH);
  const hinge = 2.1;
  sla.add(mesh(latheX([[0, RS4], [hinge, slaR(hinge)]], 48), m.sla));
  const panels = [];
  for (let i = 0; i < 4; i++) {
    const a0 = (i * TAU) / 4 + Math.PI / 4;
    const p = new THREE.Group();
    const mid = a0 + TAU / 8;
    // pivot on the hinge line; the panel geometry is offset so it rotates outward about it
    const hy = -Math.sin(mid) * slaR(hinge);
    const hz = Math.cos(mid) * slaR(hinge);
    const g = latheX([[hinge, slaR(hinge)], [slaH, slaR(slaH)]], 16, a0, TAU / 4);
    g.translate(-hinge, -hy, -hz);
    p.add(mesh(g, m.sla));
    p.position.set(hinge, hy, hz);
    p.userData.axis = new THREE.Vector3(0, -Math.cos(mid), -Math.sin(mid)); // tangent: +angle tilts outward
    panels.push(p);
    sla.add(p);
  }
  parts.slaPanels = panels;
  parts.sla = sla;

  // ================= CSM + LES
  const csm = createCSM();
  parts.csm = csm.root;
  parts.csmParts = csm.parts;
  const les = createLES(nozzles);
  parts.les = les.root;
  parts.bpc = les.bpc;

  root.add(sic, sii, sivb, sla, csm.root, les.root);
  sic.position.x = STACK.sicBase;
  sii.position.x = STACK.siiDatum;
  sivb.position.x = STACK.sivbDatum;
  sla.position.x = STACK.slaDatum;
  csm.root.position.x = STACK.csmDatum;
  les.root.position.x = STACK.csmDatum;
  nozzles.sps = csm.nozzles.sps;
  return { root, parts, nozzles };
}

function createLES(nozzles) {
  const m = materials();
  const g = new THREE.Group();
  // boost protective cover over the CM (datum = CM/SM interface)
  const bpc = mesh(latheX([[-0.05, 2.02], [0.25, 2.02], [2.9, 0.62], [3.35, 0.42], [3.45, 0.2]], 48), m.white);
  g.add(bpc);
  g.add(mesh(latheX([[-0.05, 2.03], [0.22, 2.03]], 48), m.black));
  // tower truss: 4 legs + Z braces on every face
  const legs = [];
  const base = 3.3;
  const top = 6.75;
  const L = (x) => 0.62 - ((x - base) / (top - base)) * 0.22;
  const P = (x, k) => {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    return new THREE.Vector3(x, Math.sin(a) * L(x), Math.cos(a) * L(x));
  };
  for (let k = 0; k < 4; k++) legs.push(rod(P(base, k), P(top, k), 0.055, 6));
  const levels = 5;
  for (let i = 0; i < levels; i++) {
    const x0 = base + ((top - base) * i) / levels;
    const x1 = base + ((top - base) * (i + 1)) / levels;
    for (let k = 0; k < 4; k++) {
      legs.push(rod(P(x0, k), P(x0, (k + 1) % 4), 0.035, 5));
      legs.push(rod(P(i % 2 ? x0 : x1, k), P(i % 2 ? x1 : x0, (k + 1) % 4), 0.03, 5));
    }
  }
  g.add(merged(legs, m.les));
  // escape motor with canted nozzles, jettison motor, canard section, Q-ball nose
  g.add(mesh(latheX([[6.6, 0.18], [6.8, 0.33], [9.9, 0.33], [10.1, 0.36], [10.6, 0.36], [10.75, 0.3]], 28), m.white));
  g.add(mesh(latheX([[10.75, 0.3], [11.0, 0.22], [11.25, 0.12], [11.35, 0.04]], 24), m.black));
  const noz = [];
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const n = latheX([[0, 0.17], [0.35, 0.08]], 12);
    n.rotateZ(0);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0.94, Math.sin(a) * 0.34, Math.cos(a) * 0.34).normalize());
    n.applyQuaternion(q);
    n.translate(6.55, Math.sin(a) * 0.33, Math.cos(a) * 0.33);
    noz.push(n);
    nozzles?.les?.push(anchor(g, 6.55, Math.sin(a) * 0.36, Math.cos(a) * 0.36, new THREE.Vector3(-0.94, Math.sin(a) * 0.34, Math.cos(a) * 0.34)));
  }
  g.add(merged(noz, m.darkMetal));
  // folded canards
  const can = [];
  for (const s of [-1, 1]) can.push(boxAt(0.9, 0.02, 0.18, 10.35, s * 0.37, 0));
  g.add(merged(can, m.white));
  return { root: g, bpc };
}


// ------------------------------------------------------------------ Saturn IB

function sibTankLivery() {
  const c = canvas(256, 1024);
  const g = c.getContext('2d');
  g.fillStyle = '#efeee9';
  g.fillRect(0, 0, 256, 1024);
  g.fillStyle = 'rgba(40,40,40,0.25)';
  for (const y of [120, 360, 600, 840]) g.fillRect(0, y, 256, 3);
  grime(g, 256, 1024, 0.3);
  return tex(c);
}

/** Saturn IB: S-IB (8 H-1s, 9-tank cluster, 8 fins) + S-IVB-200 + SLA + CSM + LES. Datum: H-1 exit plane. */
export function createSaturnIB() {
  const m = materials();
  MAT.sibTank ??= new THREE.MeshStandardMaterial({ map: sibTankLivery(), roughness: 0.55, metalness: 0.08 });
  const root = new THREE.Group();
  root.name = 'SaturnIB';
  const parts = {};
  const nozzles = { sib: [], sivb: [], les: [], retro: [], aps: [] };
  const sib = new THREE.Group();
  const tankR = 0.89;
  const ringR = 2.42;
  const t0 = 4.6;
  const t1 = 21.6;
  // centre LOX tank (105 in) + eight 70 in tanks alternating LOX (white) / RP-1 (black bands)
  sib.add(mesh(latheX([[t0 - 0.6, 0.3], [t0, 1.33], [t1, 1.33], [t1 + 0.7, 0.4]], 32), m.white));
  const white = [];
  const dark = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + TAU / 16;
    const y = Math.sin(a) * ringR;
    const z = Math.cos(a) * ringR;
    const g = latheX([[t0 - 0.45, 0.2], [t0, tankR], [t1, tankR], [t1 + 0.45, 0.25]], 20);
    g.translate(0, y, z);
    white.push(g);
    if (i % 2 === 0) {
      for (const [x0, x1] of [[t1 - 3.2, t1 - 1.6], [t0 + 1.2, t0 + 2.6]]) {
        const b = latheX([[x0, tankR + 0.01], [x1, tankR + 0.01]], 20);
        b.translate(0, y, z);
        dark.push(b);
      }
    }
  }
  sib.add(merged(white, MAT.sibTank), merged(dark, m.black));
  // tail section + heat shield, forward skirt with the spider beam, interstage to the S-IVB
  sib.add(mesh(latheX([[0.9, 3.3], [t0, 3.3]], 48), m.black));
  sib.add(mesh(latheX([[0.9, 0], [0.9, 3.3]], 40), m.heatShield));
  sib.add(mesh(latheX([[t1 - 0.2, 3.32], [t1 + 1.0, 3.32]], 48), m.black));
  const inter = mesh(latheX([[t1 + 1.0, 3.32], [STACK_IB.sibTop + 1.6, 3.32]], 48), m.white);
  sib.add(inter);
  parts.sibInterstage = inter;
  // fins: 4 large (outboard engines) + 4 small stubs
  const fins = [];
  for (let i = 0; i < 8; i++) {
    const big = i % 2 === 0;
    const a = (i / 8) * TAU;
    const cy = Math.sin(a);
    const cz = Math.cos(a);
    const sh = new THREE.Shape();
    sh.moveTo(0, 0.6);
    sh.lineTo(0, big ? 6.2 : 3.6);
    sh.lineTo(big ? 2.9 : 1.2, big ? 2.4 : 1.8);
    sh.lineTo(big ? 2.9 : 1.2, 0.6);
    sh.closePath();
    const fg = new THREE.ExtrudeGeometry(sh, { depth: 0.18, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 1 });
    fg.translate(0, 0, -0.09);
    fg.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, cy, cz), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, cz, -cy)));
    fg.translate(0, cy * 3.25, cz * 3.25);
    fins.push(fg);
  }
  sib.add(merged(fins, m.white));
  // 8 H-1 engines: inner four (r 0.9) and outer four (r 2.25)
  const bells = [];
  const inner = [];
  for (let i = 0; i < 8; i++) {
    const outer = i >= 4;
    const a = (i % 4) * (TAU / 4) + (outer ? TAU / 8 : 0);
    const rr = outer ? 2.25 : 0.95;
    const y = Math.sin(a) * rr;
    const z = Math.cos(a) * rr;
    const b = latheX(bellProfile(0.28, 0.6, 1.9, 8).map(([x, r]) => [x + 2.0, r]), 20);
    b.translate(0, y, z);
    bells.push(b);
    const ch = latheX([[2.0, 0.28], [2.3, 0.36], [2.6, 0.3], [2.8, 0.1]], 12);
    ch.translate(0, y, z);
    inner.push(ch);
    nozzles.sib.push(anchor(sib, 0.08, y, z));
  }
  sib.add(merged(bells, m.f1Ext), merged(inner, m.engine));
  parts.sib = sib;
  root.add(sib);
  // upper stack from the Saturn V parts (S-IVB, SLA, CSM, LES) at Saturn IB stations
  const sv = createSaturnV();
  const sivb = sv.parts.sivb;
  sv.parts.sivbInterstage.visible = false;
  sivb.removeFromParent();
  sivb.position.x = STACK_IB.sivbDatum;
  const sla = sv.parts.sla;
  sla.removeFromParent();
  sla.position.x = STACK_IB.slaDatum;
  const csm = sv.parts.csm;
  csm.removeFromParent();
  csm.position.x = STACK_IB.csmDatum;
  const les = sv.parts.les;
  les.removeFromParent();
  les.position.x = STACK_IB.csmDatum;
  root.add(sivb, sla, csm, les);
  Object.assign(parts, { sivb, sla, slaPanels: sv.parts.slaPanels, csm, csmParts: sv.parts.csmParts, les, bpc: sv.parts.bpc });
  nozzles.sivb = sv.nozzles.sivb;
  nozzles.les = sv.nozzles.les;
  nozzles.aps = sv.nozzles.aps;
  nozzles.sps = sv.nozzles.sps;
  return { root, parts, nozzles };
}

// ------------------------------------------------------------------ CSM

export function createCSM({ damaged = false } = {}) {
  const m = materials();
  const root = new THREE.Group();
  root.name = 'CSM';
  const H = GEOM.csm.cmHeight;
  const Rb = GEOM.csm.cmBaseRadius;
  // ---- CM (datum = CM/SM interface)
  const cm = new THREE.Group();
  cm.add(mesh(latheX([[0.0, Rb * 0.985], [0.1, Rb], [0.22, Rb * 0.985], [H * 0.86, 0.6], [H * 0.93, 0.5], [H, 0.42]], 64), m.cm));
  cm.add(mesh(latheX([[-0.32, 0.05], [-0.22, Rb * 0.7], [-0.07, Rb * 0.96], [0.0, Rb * 0.985]], 64), m.heat));
  // tunnel + docking ring
  cm.add(mesh(latheX([[H - 0.02, 0.42], [H + 0.18, 0.4], [H + 0.24, 0.44], [H + 0.28, 0.44]], 32), m.alu));
  // windows: 2 rendezvous (forward-facing), 2 side, 1 hatch (−Z side = crew's "up")
  const wins = [];
  const winGeo = (w, h) => new THREE.PlaneGeometry(w, h);
  const surfAt = (x, a) => {
    const r = Rb - ((x - 0.1) / (H * 0.86 - 0.1)) * (Rb - 0.6);
    return new THREE.Vector3(x, Math.sin(a) * r, -Math.cos(a) * r);
  };
  const half = (33 * Math.PI) / 180;
  for (const [x, a, w, h] of [[2.1, -0.32, 0.2, 0.24], [2.1, 0.32, 0.2, 0.24], [1.15, -1.2, 0.3, 0.3], [1.15, 1.2, 0.3, 0.3], [1.3, 0, 0.26, 0.26]]) {
    const p = surfAt(x, a);
    const n = new THREE.Vector3(Math.sin(half), Math.sin(a) * Math.cos(half), -Math.cos(a) * Math.cos(half)).normalize();
    const g = winGeo(w, h);
    g.lookAt(n);
    g.translate(p.x + n.x * 0.012, p.y + n.y * 0.012, p.z + n.z * 0.012);
    wins.push(g);
  }
  cm.add(merged(wins, m.window));
  // probe (retractable)
  const probe = new THREE.Group();
  probe.add(mesh(cylX(0.07, 0.03, H + 0.2, GEOM.csm.probeTipX, 10), m.alu));
  const arms = [];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * TAU;
    arms.push(rod(new THREE.Vector3(H + 0.3, Math.sin(a) * 0.38, Math.cos(a) * 0.38), new THREE.Vector3(H + 0.75, Math.sin(a) * 0.08, Math.cos(a) * 0.08), 0.025, 5));
  }
  probe.add(merged(arms, m.alu));
  cm.add(probe);
  root.add(cm);

  // ---- SM
  const sm = new THREE.Group();
  const L = GEOM.csm.smLength;
  sm.add(mesh(latheX([[-L, Rb], [0, Rb]], 64), damaged ? m.smDamaged : m.sm));
  sm.add(mesh(latheX([[-L, 0], [-L, Rb]], 48), m.heatShield));
  // RCS quads (4) with four nozzles each
  const quad = [];
  const quadN = [];
  const rcsAnchors = [];
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4 + 0.12;
    const ry = Math.sin(a);
    const rz = Math.cos(a);
    const c = new THREE.Vector3(GEOM.csm.rcsQuadX, ry * (Rb + 0.16), rz * (Rb + 0.16));
    const box = new THREE.BoxGeometry(0.85, 0.3, 0.42);
    box.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, rz, -ry), new THREE.Vector3(0, ry, rz)));
    box.translate(c.x, c.y, c.z);
    quad.push(box);
    const tang = new THREE.Vector3(0, rz, -ry);
    for (const d of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), tang.clone(), tang.clone().negate()]) {
      const n = latheX([[0, 0.05], [0.16, 0.09]], 8);
      n.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), d));
      const p = c.clone().addScaledVector(d, 0.42).addScaledVector(new THREE.Vector3(0, ry, rz), 0.06);
      n.translate(p.x, p.y, p.z);
      quadN.push(n);
      rcsAnchors.push(anchor(sm, p.x + d.x * 0.16, p.y + d.y * 0.16, p.z + d.z * 0.16, d.clone().negate()));
    }
  }
  sm.add(merged(quad, m.white), merged(quadN, m.darkMetal));
  // SPS engine: bright upper chamber + dark columbium nozzle extension
  const sps = new THREE.Group();
  sps.add(mesh(latheX([[-L + 0.15, 0.55], [-L - 0.25, 0.45], [-L - 0.7, 0.62], [-L - 1.0, 0.75]], 32), m.spsUpper));
  sps.add(mesh(latheX(bellProfile(0.75, GEOM.csm.spsExitRadius, GEOM.csm.spsNozzleLength - 1.0, 10, 0.75).map(([x, r]) => [x - L - 1.0, r]), 40), m.sps));
  sps.add(mesh(latheX(bellProfile(0.73, GEOM.csm.spsExitRadius - 0.03, GEOM.csm.spsNozzleLength - 1.0, 8, 0.75).map(([x, r]) => [x - L - 1.0, r]), 40), m.nozzleIn));
  sm.add(sps);
  // high-gain antenna (stowed alongside the SPS bell; deployed after TD&E)
  const hga = new THREE.Group();
  hga.add(mesh(cylX(0.05, 0.05, 0, 1.3, 6), m.alu));
  const dishes = [];
  for (const [y, z] of [[0.33, 0.33], [-0.33, 0.33], [0.33, -0.33], [-0.33, -0.33]]) {
    const d = new THREE.SphereGeometry(0.39, 16, 6, 0, TAU, 0, 0.75);
    d.rotateZ(Math.PI / 2);
    d.translate(1.55, y, z);
    dishes.push(d);
  }
  hga.add(merged(dishes, m.dish));
  hga.position.set(-L, 0, -Rb);
  hga.rotation.y = 0.75;
  sm.add(hga);
  // scimitar VHF antennas
  const sc = [];
  for (const s of [-1, 1]) {
    const t = new THREE.TorusGeometry(0.5, 0.03, 4, 16, Math.PI * 0.9);
    t.rotateX(Math.PI / 2);
    t.translate(-1.2, s * (Rb + 0.25), 0);
    sc.push(t);
  }
  sm.add(merged(sc, m.alu));
  if (damaged) {
    // Apollo 13: bay 4 panel blown away — exposed shelves, tanks and torn foil
    const hole = mesh(boxAt(2.7, 0.15, 1.35, -1.9, 0, Rb - 0.08), m.black);
    sm.add(hole);
    const shreds = [];
    for (let i = 0; i < 16; i++) shreds.push(boxAt(0.2 + rnd() * 0.5, 0.02, 0.1 + rnd() * 0.3, -3.2 + rnd() * 2.6, (rnd() - 0.5) * 1.2, Rb - 0.02 + rnd() * 0.1));
    sm.add(merged(shreds, m.kapton));
    const tank = mesh(new THREE.SphereGeometry(0.4, 14, 10), m.darkMetal);
    tank.position.set(-1.9, 0.35, Rb - 0.55);
    sm.add(tank);
  }
  root.add(sm);
  return {
    root,
    parts: { cm, sm, probe, hga, sps },
    nozzles: { sps: [anchor(sm, -L - GEOM.csm.spsNozzleLength, 0, 0)], rcs: rcsAnchors },
  };
}

// ------------------------------------------------------------------ LM (datum = footpad plane, +X up, +Z forward)

export function createLM({ stowed = false, ascentOnly = false } = {}) {
  const m = materials();
  const root = new THREE.Group();
  root.name = 'LM';
  const parts = {};
  const nozzles = { dps: [], aps: [], rcs: [] };
  const h0 = GEOM.lm.descStageBottomX; // 1.55
  const h1 = GEOM.lm.descStageTopX; // 3.25
  if (!ascentOnly) {
    const ds = new THREE.Group();
    // cruciform octagon: central box + four side bays (gold Kapton) and black corner panels
    const oct = new THREE.CylinderGeometry(2.12, 2.12, h1 - h0, 8, 1);
    oct.rotateY(Math.PI / 8);
    oct.rotateZ(-Math.PI / 2);
    oct.translate((h0 + h1) / 2, 0, 0);
    ds.add(mesh(oct, m.kapton));
    const corners = [];
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const g = new THREE.BoxGeometry(h1 - h0 - 0.12, 1.1, 0.06);
      g.applyMatrix4(new THREE.Matrix4().makeRotationX(-a));
      g.translate((h0 + h1) / 2, Math.sin(a) * 1.99, Math.cos(a) * 1.99);
      corners.push(g);
    }
    ds.add(merged(corners, m.kaptonBlack));
    // top deck + bottom heat shield
    ds.add(mesh(latheX([[h1, 0], [h1, 2.05]], 8, Math.PI / 8), m.kaptonBlack));
    ds.add(mesh(latheX([[h0, 0], [h0, 2.1]], 8, Math.PI / 8), m.kaptonBlack));
    // DPS engine with skirt
    const dps = new THREE.Group();
    dps.add(mesh(latheX([[h0 + 0.05, 0.42], [h0 - 0.1, 0.48], [GEOM.lm.dpsExitX, 0.75]], 28), m.sps));
    dps.add(mesh(latheX([[h0 + 0.05, 0.4], [GEOM.lm.dpsExitX + 0.02, 0.72]], 28), m.nozzleIn));
    ds.add(dps);
    nozzles.dps.push(anchor(root, GEOM.lm.dpsExitX, 0, 0));
    // landing gear (±Y, ±Z): primary strut, two secondaries, footpad, probes (not on +Z leg)
    const gear = [];
    const pads = [];
    const probes = [];
    const R0 = GEOM.lm.footpadCircleRadius;
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2; // 0: +Z (front, ladder), 1: +Y, 2: −Z, 3: −Y
      const dir = new THREE.Vector3(0, Math.sin(a), Math.cos(a));
      const side = new THREE.Vector3(0, Math.cos(a), -Math.sin(a));
      const upper = dir.clone().multiplyScalar(2.05).setX(h1 - 0.15);
      const lowA = dir.clone().multiplyScalar(2.08).addScaledVector(side, 0.7).setX(h0 + 0.1);
      const lowB = dir.clone().multiplyScalar(2.08).addScaledVector(side, -0.7).setX(h0 + 0.1);
      const foot = stowed ? dir.clone().multiplyScalar(2.45).setX(h0 + 0.6) : dir.clone().multiplyScalar(R0).setX(0.18);
      const knee = upper.clone().lerp(foot, 0.55);
      gear.push(rod(upper, foot, 0.075, 8));
      gear.push(rod(lowA, knee, 0.045, 6), rod(lowB, knee, 0.045, 6));
      gear.push(rod(lowA, upper.clone().setX(h1 - 0.4).addScaledVector(side, 0.55), 0.03, 5));
      const pad = latheX([[0, 0.45], [0.06, 0.47], [0.2, 0.38], [0.28, 0.12]], 18);
      pad.translate(foot.x - 0.16, foot.y, foot.z);
      pads.push(pad);
      if (!stowed && i !== 0) probes.push(rod(foot.clone().setX(foot.x - 0.1), foot.clone().setX(foot.x - GEOM.lm.probeLength), 0.012, 4));
      if (!stowed && i === 0) {
        // ladder along the forward strut + porch
        const rungs = [];
        const lt = upper.clone().addScaledVector(dir, 0.25);
        const lb = foot.clone().addScaledVector(dir, -0.25).setX(0.9);
        for (const s of [-0.24, 0.24]) rungs.push(rod(lt.clone().addScaledVector(side, s), lb.clone().addScaledVector(side, s), 0.02, 4));
        for (let k = 1; k < 9; k++) {
          const p = lt.clone().lerp(lb, k / 9);
          rungs.push(rod(p.clone().addScaledVector(side, -0.24), p.clone().addScaledVector(side, 0.24), 0.015, 4));
        }
        ds.add(merged(rungs, m.alu));
        ds.add(mesh(boxAt(0.05, 0.9, 0.8, h1 + 0.02, 0, 2.3), m.alu));
      }
    }
    ds.add(merged(gear, m.gold), merged(pads, m.kapton));
    if (probes.length) ds.add(merged(probes, m.alu));
    // MESA (folded, front-left bay) and quad 4 plume deflectors
    ds.add(mesh(boxAt(1.2, 0.9, 0.12, (h0 + h1) / 2, -0.9, 2.08), m.kaptonBlack));
    parts.descent = ds;
    root.add(ds);
  }
  // ---- ascent stage
  const as = new THREE.Group();
  const b = GEOM.lm.ascStageBaseX;
  // crew cabin: horizontal cylinder (axis Y) with the flat front face
  const cab = new THREE.CylinderGeometry(1.17, 1.17, 2.34, 24, 1, false);
  cab.rotateX(Math.PI / 2);
  cab.rotateY(Math.PI / 2);
  cab.translate(b + 1.5, 0, 0.45);
  as.add(mesh(cab, m.lmGrey));
  // front face: faceted with two triangular windows and the hatch
  const front = new THREE.Group();
  front.add(mesh(boxAt(1.85, 2.1, 0.5, b + 1.45, 0, 1.45), m.lmDark));
  for (const s of [-1, 1]) {
    // triangular windows: vertical inner edge, hypotenuse down and outward
    const tri = new THREE.BufferGeometry();
    const zf = 1.712;
    tri.setAttribute('position', new THREE.Float32BufferAttribute([b + 2.32, s * 0.14, zf, b + 1.58, s * 0.14, zf, b + 1.58, s * 0.86, zf], 3));
    tri.computeVertexNormals();
    front.add(mesh(tri, m.windowDS));
  }
  front.add(mesh(boxAt(0.82, 0.82, 0.04, b + 0.75, 0, 1.72), m.lmPanel));
  as.add(front);
  // aft equipment bay + midsection
  as.add(mesh(boxAt(1.6, 2.6, 1.5, b + 1.35, 0, -0.9), m.lmGrey));
  as.add(mesh(boxAt(1.0, 1.8, 0.7, b + 1.0, 0, -1.95), m.kaptonBlack));
  // RCS tank cheeks
  for (const s of [-1, 1]) {
    const ch = new THREE.SphereGeometry(0.62, 18, 12);
    ch.scale(1.25, 0.65, 1.1);
    ch.translate(b + 1.25, s * 1.32, -0.15);
    as.add(mesh(ch, m.lmPanel));
  }
  // top: docking tunnel + drogue + overhead window + docking target standoff
  as.add(mesh(latheX([[b + 2.5, 0.52], [GEOM.lm.dockRingX - 0.15, 0.46], [GEOM.lm.dockRingX, 0.5]], 24), m.lmDark));
  as.add(mesh(latheX([[GEOM.lm.dockRingX - 0.02, 0.36], [GEOM.lm.dockRingX - 0.45, 0.08]], 20), m.alu));
  const tgt = new THREE.Group();
  const td = mesh(new THREE.CircleGeometry(0.22, 24), m.dockTarget);
  td.rotation.y = Math.PI / 2;
  tgt.add(td);
  tgt.add(mesh(boxAt(0.5, 0.03, 0.03, 0.25, 0, 0), m.black));
  tgt.add(mesh(boxAt(0.01, 0.4, 0.035, 0.01, 0, 0), m.black));
  tgt.add(mesh(boxAt(0.01, 0.035, 0.4, 0.01, 0, 0), m.black));
  tgt.position.set(b + 2.75, -0.8, -0.5);
  as.add(tgt);
  parts.dockTarget = tgt;
  // rendezvous radar dish (front top) and S-band steerable antenna
  const rr = mesh(new THREE.SphereGeometry(0.33, 18, 8, 0, TAU, 0, 1.1), m.dish);
  rr.rotation.x = Math.PI / 2;
  rr.position.set(b + 2.6, 0, 1.1);
  as.add(rr);
  const sb = mesh(new THREE.SphereGeometry(0.33, 18, 8, 0, TAU, 0, 1.1), m.dish);
  sb.position.set(b + 2.8, 1.05, -0.55);
  sb.rotation.z = -0.7;
  as.add(sb);
  // VHF antennas
  as.add(mesh(rod(new THREE.Vector3(b + 2.4, -0.9, -0.9), new THREE.Vector3(b + 3.3, -1.1, -1.2), 0.012, 4), m.alu));
  as.add(mesh(rod(new THREE.Vector3(b + 2.4, 0.9, -1.0), new THREE.Vector3(b + 3.4, 1.1, -1.25), 0.012, 4), m.alu));
  // RCS quads at the four corners (4 nozzles each: up, down, two sideways)
  const qb = [];
  const qn = [];
  const corners = [[1.55, 1.25], [-1.55, 1.25], [1.55, -1.25], [-1.55, -1.25]];
  for (const [y, z] of corners) {
    qb.push(boxAt(0.36, 0.36, 0.36, b + 1.95, y, z));
    const outY = Math.sign(y);
    const outZ = Math.sign(z);
    for (const d of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, outY, 0), new THREE.Vector3(0, 0, outZ)]) {
      const n = latheX([[0, 0.05], [0.14, 0.08]], 8);
      n.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), d));
      const p = new THREE.Vector3(b + 1.95, y, z).addScaledVector(d, 0.18);
      n.translate(p.x, p.y, p.z);
      qn.push(n);
      nozzles.rcs.push(anchor(as, p.x + d.x * 0.14, p.y + d.y * 0.14, p.z + d.z * 0.14, d.clone().negate()));
    }
  }
  as.add(merged(qb, m.lmDark), merged(qn, m.darkMetal));
  // APS nozzle (visible after staging)
  as.add(mesh(latheX([[b + 0.15, 0.4], [GEOM.lm.apsExitX, 0.65]], 24), m.sps));
  nozzles.aps.push(anchor(root, GEOM.lm.apsExitX - 0.05, 0, 0));
  parts.ascent = as;
  root.add(as);
  return { root, parts, nozzles };
}

// ------------------------------------------------------------------ assembly

/** Builds the model of a configuration (origin = config reference point). */
export function buildConfigModel(config, parts = {}) {
  const root = new THREE.Group();
  const nozzles = { main: [], sps: [], dps: [], aps: [], rcs: [], les: [], retro: [], ullage: [] };
  const handles = {};
  const mods = CONFIGS[config].modules;
  const place = (obj, module) => {
    const t = moduleTransform(config, module);
    obj.position.copy(t.offset);
    obj.quaternion.copy(t.quat);
    root.add(obj);
  };
  if (config.startsWith('SATURN_IB')) {
    const ib = createSaturnIB();
    const p = ib.parts;
    const ref = CONFIGS[config].ref;
    ib.root.position.set(-ref, 0, 0);
    root.add(ib.root);
    p.sib.visible = mods.includes('SIB');
    p.les.visible = mods.includes('LES') && parts.les !== false;
    for (const pn of p.slaPanels) pn.visible = parts.slaPanels !== false;
    p.csmParts.hga.visible = false;
    nozzles.main = mods.includes('SIB') ? ib.nozzles.sib : ib.nozzles.sivb;
    nozzles.les = p.les.visible ? ib.nozzles.les : [];
    nozzles.aps = ib.nozzles.aps;
    nozzles.sps = ib.nozzles.sps;
    handles.slaPanels = p.slaPanels;
    return { root, nozzles, handles };
  }
  if (mods.includes('SIC') || mods.includes('SII') || mods.includes('SIVB')) {
    const sv = createSaturnV();
    const { parts: p } = sv;
    const t = moduleTransform(config, mods.includes('SIC') ? 'SIC' : mods.includes('SII') ? 'SII' : 'SIVB');
    const datumStation = mods.includes('SIC') ? STACK.sicBase : mods.includes('SII') ? STACK.siiDatum : STACK.sivbDatum;
    sv.root.position.copy(t.offset).add(new THREE.Vector3(-datumStation, 0, 0));
    root.add(sv.root);
    p.sic.visible = mods.includes('SIC');
    p.sii.visible = mods.includes('SII');
    p.interstage.visible = parts.interstage !== false && mods.includes('SII');
    p.les.visible = mods.includes('LES') && parts.les !== false;
    p.csm.visible = mods.includes('CSM');
    p.sivbInterstage.visible = mods.includes('SII');
    const slaOn = mods.includes('SLA') && parts.slaPanels !== false;
    for (const pn of p.slaPanels) pn.visible = slaOn;
    p.sla.visible = mods.includes('SLA') || mods.includes('SLA_BASE');
    if (mods.includes('SIC')) nozzles.main = sv.nozzles.sic;
    else if (mods.includes('SII')) nozzles.main = sv.nozzles.sii;
    else nozzles.main = sv.nozzles.sivb;
    nozzles.les = p.les.visible ? sv.nozzles.les : [];
    nozzles.retro = mods.includes('SIC') ? sv.nozzles.retro : [];
    nozzles.ullage = mods.includes('SII') && p.interstage.visible ? sv.nozzles.ullage : [];
    nozzles.aps = mods.includes('SIVB') ? sv.nozzles.aps : [];
    if (mods.includes('CSM')) {
      nozzles.sps = sv.nozzles.sps;
      p.csmParts.hga.visible = false;
    }
    handles.slaPanels = p.slaPanels;
    if (mods.includes('LM_STOWED')) place(createLM({ stowed: true }).root, 'LM_STOWED');
    if (mods.includes('CSM_DOCKED_TOP')) {
      const c = createCSM();
      c.parts.probe.visible = true;
      place(c.root, 'CSM_DOCKED_TOP');
      nozzles.sps.push(...c.nozzles.sps);
      nozzles.rcs.push(...c.nozzles.rcs);
    }
    return { root, nozzles, handles };
  }
  for (const mod of mods) {
    if (mod === 'CSM' || mod === 'CM' || mod === 'SM') {
      const c = createCSM({ damaged: !!parts.smDamaged });
      if (mod === 'CM') c.parts.sm.visible = false;
      if (mod === 'SM') c.parts.cm.visible = false;
      c.parts.probe.visible = mod !== 'CM' && parts.probeExtended !== false;
      place(c.root, mod);
      if (mod !== 'CM') {
        nozzles.sps.push(...c.nozzles.sps);
        nozzles.rcs.push(...c.nozzles.rcs);
      }
      handles.csm = c;
    } else if (mod.startsWith('LM')) {
      const l = createLM({ stowed: !parts.lmGearDeployed && mod !== 'LM' && mod !== 'LM_ASC', ascentOnly: mod.includes('ASC') });
      place(l.root, mod);
      nozzles.dps.push(...l.nozzles.dps);
      nozzles.aps.push(...l.nozzles.aps);
      nozzles.rcs.push(...l.nozzles.rcs);
      handles.lm = l;
    }
  }
  return { root, nozzles, handles };
}

// ------------------------------------------------------------------ launch umbilical tower

/**
 * Mobile Launcher + Launch Umbilical Tower (local frame: +Y up, deck top at y=0, rocket axis at
 * the origin, tower on the −X side). userData.arms = swing arms (pivot at the tower face).
 */
export function createLaunchTower() {
  const m = materials();
  const g = new THREE.Group();
  // ML base: 49 × 7.6 × 41 m with the 13.7 m exhaust hole under the rocket
  const deckGeo = [];
  const W = 49;
  const D = 41;
  const hole = 13.7;
  deckGeo.push(boxAt((W - hole) / 2, 7.6, D, -(hole / 2 + (W - hole) / 4), -3.8, 0));
  deckGeo.push(boxAt((W - hole) / 2, 7.6, D, hole / 2 + (W - hole) / 4, -3.8, 0));
  deckGeo.push(boxAt(hole, 7.6, (D - hole) / 2, 0, -3.8, -(hole / 2 + (D - hole) / 4)));
  deckGeo.push(boxAt(hole, 7.6, (D - hole) / 2, 0, -3.8, hole / 2 + (D - hole) / 4));
  const deck = merged(deckGeo, m.mlGrey);
  g.add(deck);
  // hold-down arms (4) and tail service masts (3)
  const hd = [];
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    hd.push(boxAt(1.4, 1.6, 1.4, Math.cos(a) * 6.1, 0.8, Math.sin(a) * 6.1));
  }
  for (const [x, z] of [[-7.5, 2.5], [-7.5, -2.5], [7.2, 0]]) hd.push(boxAt(1.6, 9.5, 1.8, x, 4.75, z));
  g.add(merged(hd, m.mlGrey));
  // tower: 4 corner columns + bracing, 12 × 12 m, 122 m above the deck, red
  const tx = -24; // tower centre; its face is ~13 m from the S-IC skin
  const geo = [];
  const geoDark = [];
  const half = 6;
  for (const [x, z] of [[tx - half, -half], [tx + half, -half], [tx - half, half], [tx + half, half]]) geo.push(boxAt(0.9, 122, 0.9, x, 61, z));
  for (let y = 0; y < 122; y += 6.1) {
    geo.push(boxAt(12, 0.5, 0.5, tx, y, -half), boxAt(12, 0.5, 0.5, tx, y, half), boxAt(0.5, 0.5, 12, tx - half, y, 0), boxAt(0.5, 0.5, 12, tx + half, y, 0));
    geoDark.push(boxAt(11.6, 0.15, 11.6, tx, y + 0.1, 0));
    // X bracing on the faces
    for (const s of [-1, 1]) {
      geo.push(rod(new THREE.Vector3(tx - half, y, s * half), new THREE.Vector3(tx + half, y + 6.1, s * half), 0.18, 4));
      geo.push(rod(new THREE.Vector3(tx + s * half, y, -half), new THREE.Vector3(tx + s * half, y + 6.1, half), 0.18, 4));
    }
  }
  g.add(merged(geo, m.tower));
  g.add(merged(geoDark, m.towerDark));
  // elevator shafts and the hammerhead crane + lightning mast
  g.add(mesh(boxAt(3, 124, 3, tx - 2.5, 62, 2.5), m.towerDark));
  const crane = [];
  crane.push(boxAt(26, 2.2, 2.2, tx + 4, 124, 0), boxAt(2.2, 5, 2.2, tx, 125.5, 0), boxAt(0.3, 14, 0.3, tx, 135, 0));
  g.add(merged(crane, m.tower));
  // swing arms (9): pivots at the tower face, reaching to the vehicle
  g.userData.arms = [];
  // [height above deck, length to the vehicle skin]: S-IC ×2, S-II ×3, S-IVB/IU ×2, SM, CM access arm
  const armDefs = [[18.3, 12.9], [30.5, 12.9], [48.8, 12.9], [61.0, 12.9], [66.5, 12.9], [76.2, 14.6], [83.5, 14.6], [96.5, 15.9], [101.2, 16.2]];
  for (const [y, len] of armDefs) {
    const arm = new THREE.Group();
    const ag = [];
    ag.push(boxAt(len, 0.3, 0.3, len / 2, 1.0, 0.9), boxAt(len, 0.3, 0.3, len / 2, 1.0, -0.9), boxAt(len, 0.3, 0.3, len / 2, -0.4, 0.9), boxAt(len, 0.3, 0.3, len / 2, -0.4, -0.9));
    for (let k = 0; k < len; k += 1.6) ag.push(rod(new THREE.Vector3(k, -0.4, 0.9), new THREE.Vector3(k + 1.6, 1.0, 0.9), 0.08, 3), rod(new THREE.Vector3(k, -0.4, -0.9), new THREE.Vector3(k + 1.6, 1.0, -0.9), 0.08, 3));
    ag.push(boxAt(len, 0.12, 1.8, len / 2, -0.4, 0));
    arm.add(merged(ag, m.tower));
    arm.position.set(tx + half, y, 0);
    g.add(arm);
    g.userData.arms.push(arm);
  }
  g.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return g;
}
