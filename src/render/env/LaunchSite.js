// Kennedy Space Center around Launch Complex 39A (local frame: +X east, +Y up, +Z south, origin
// at sea level under the pad centre; the Mobile Launcher deck is at y = 29 m, the height of the
// Saturn V's F-1 exit plane in the simulation).
//  - curved ground disc (r = 80 km) that samples the Blue Marble textures far away and a painted
//    KSC map near the pad (Atlantic shore, beach, dunes, lagoons, crawlerway, VAB area, Pad 39B),
//    with an animated ocean (glint, sky reflection) and aerial haze
//  - pad mound with the flame trench, the Mobile Launcher on its pedestals with the Launch
//    Umbilical Tower (createLaunchTower), LOX/LH2 spheres, water tower, VAB, LCC, Pad 39B mound

import * as THREE from 'three';
import { R_EARTH, SITES_DEG } from '../../core/constants.js';
import { createLaunchTower, materials } from '../models/index.js';

export const DECK_Y = 29; // ML deck top above sea level (m)
const MAP_HALF = 12000; // painted map: 24 × 24 km

// ------------------------------------------------------------------ painted maps
// Two painted layers over the Blue Marble (whose 2k water mask is ~20 km per pixel and turns the
// whole Space Coast into sea): a regional map (140 km) of the coastline, Cape Canaveral, the Banana
// and Indian rivers, Merritt Island and Mosquito Lagoon, and a detailed 24 km map around the pads.
// Coordinates: metres east / north of Pad 39A.

const REGION_HALF = 70000;

// Atlantic shoreline: [north, east] points (from 29.2°N down past Cocoa Beach)
const COAST = [[75000, -50000], [43500, -28900], [20000, -13800], [6000, -3000], [0, 1500], [-8000, 5200], [-14000, 7000], [-17900, 7400], [-21000, 5200], [-30000, 1300], [-45000, 700], [-75000, 4200]];
export function coastEast(n) {
  for (let i = 0; i < COAST.length - 1; i++) {
    const [n0, e0] = COAST[i];
    const [n1, e1] = COAST[i + 1];
    if (n <= n0 && n >= n1) return e0 + ((n - n0) / (n1 - n0)) * (e1 - e0);
  }
  return n > COAST[0][0] ? COAST[0][1] : COAST[COAST.length - 1][1];
}

function makeLayer(size, half, maskSize) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const w = document.createElement('canvas');
  w.width = w.height = maskSize;
  const L = {
    c,
    w,
    g: c.getContext('2d'),
    wg: w.getContext('2d'),
    X: (e) => ((e + half) / (2 * half)) * size,
    Y: (n) => ((half - n) / (2 * half)) * size,
    WX: (e) => ((e + half) / (2 * half)) * maskSize,
    WY: (n) => ((half - n) / (2 * half)) * maskSize,
    px: (m) => (m / (2 * half)) * size,
  };
  L.wg.fillStyle = '#000';
  L.wg.fillRect(0, 0, maskSize, maskSize);
  L.poly = (pts, fill, water = false) => {
    L.g.fillStyle = fill;
    L.g.beginPath();
    pts.forEach(([e, n], i) => (i ? L.g.lineTo(L.X(e), L.Y(n)) : L.g.moveTo(L.X(e), L.Y(n))));
    L.g.closePath();
    L.g.fill();
    if (water !== null) {
      L.wg.fillStyle = water ? '#fff' : '#000';
      L.wg.beginPath();
      pts.forEach(([e, n], i) => (i ? L.wg.lineTo(L.WX(e), L.WY(n)) : L.wg.moveTo(L.WX(e), L.WY(n))));
      L.wg.closePath();
      L.wg.fill();
    }
  };
  L.line = (pts, width, col) => {
    L.g.strokeStyle = col;
    L.g.lineWidth = Math.max(1, L.px(width));
    L.g.lineJoin = 'round';
    L.g.lineCap = 'round';
    L.g.beginPath();
    pts.forEach(([e, n], i) => (i ? L.g.lineTo(L.X(e), L.Y(n)) : L.g.moveTo(L.X(e), L.Y(n))));
    L.g.stroke();
  };
  L.textures = () => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    const wt = new THREE.CanvasTexture(w);
    wt.colorSpace = THREE.NoColorSpace;
    return { map: t, water: wt };
  };
  return L;
}

function scrub(L, size, rnd, n = 9000, scale = 1) {
  L.g.fillStyle = '#4f5c38';
  L.g.fillRect(0, 0, size, size);
  for (let i = 0; i < n; i++) {
    const r = (2 + rnd() * 14) * scale;
    L.g.fillStyle = `rgba(${55 + rnd() * 50},${70 + rnd() * 45},${35 + rnd() * 25},${0.25 + rnd() * 0.3})`;
    L.g.beginPath();
    L.g.arc(rnd() * size, rnd() * size, r, 0, Math.PI * 2);
    L.g.fill();
  }
}

function coastBands(L, half, step) {
  const shore = [];
  for (let n = half + 3000; n >= -half - 3000; n -= step) shore.push([coastEast(n) + Math.sin(n / 900) * 20, n]);
  const inland = (d) => shore.map(([e, n]) => [e - d, n]);
  const far = half * 3;
  L.poly([...inland(420), ...shore.slice().reverse()], '#9a9a72');
  L.poly([...inland(70), ...shore.slice().reverse()], '#d9cfae');
  L.poly([...shore, [far, -half - 3000], [far, half + 3000]], '#1d4f6b', true);
}

function paintRegion() {
  const S = 2048;
  const L = makeLayer(S, REGION_HALF, 1024);
  let seed = 69;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  scrub(L, S, rnd, 7000, 0.6);
  // mainland west of the Indian River slightly greener, with towns
  L.poly([[-90000, 90000], [-21000, 90000], [-19500, 30000], [-17500, 0], [-15500, -40000], [-13000, -90000], [-90000, -90000]], '#56653d');
  for (let i = 0; i < 120; i++) {
    const e = -60000 + rnd() * 42000;
    const n = -60000 + rnd() * 120000;
    L.g.fillStyle = `rgba(${120 + rnd() * 40},${118 + rnd() * 30},${100 + rnd() * 30},0.35)`;
    L.g.fillRect(L.X(e), L.Y(n), 2 + rnd() * 9, 2 + rnd() * 9);
  }
  const water = (pts) => L.poly(pts, '#2a5266', true);
  // Indian River (between the mainland and Merritt Island)
  water([[-21500, 75000], [-17000, 75000], [-16800, 40000], [-15600, 8000], [-14200, -20000], [-11800, -75000], [-15800, -75000], [-18000, -20000], [-19400, 8000], [-20500, 40000]]);
  // Mosquito Lagoon (north)
  water([[-16500, 16000], [-9500, 14000], [-6000, 22000], [-17000, 43000], [-30000, 60000], [-26000, 42000]]);
  // Banana River (between Merritt Island and the Cape barrier island)
  water([[-6200, -9000], [-2600, -9500], [-1200, -20000], [-600, -45000], [-2600, -75000], [-6600, -75000], [-5200, -42000], [-6200, -20000]]);
  // Banana Creek + the lagoons near the VAB
  water([[-11500, -900], [-8200, -1300], [-6100, -1000], [-3900, -1500], [-2400, -1300], [-2200, -900], [-3900, -1050], [-6100, -650], [-8300, -800], [-11500, -400]]);
  water([[-12500, -5200], [-7000, -4800], [-4200, -6400], [-3300, -9000], [-6200, -9000], [-12500, -9500]]);
  coastBands(L, REGION_HALF, 1500);
  // Cape Canaveral launch complexes (the "missile row")
  for (const [e, n] of [[6200, -15000], [6700, -17000], [6900, -19200], [5600, -21500], [4600, -24000]]) {
    L.g.fillStyle = '#b8b29c';
    L.g.beginPath();
    L.g.arc(L.X(e), L.Y(n), L.px(260), 0, Math.PI * 2);
    L.g.fill();
  }
  return L.textures();
}

function paintLocal() {
  const S = 2048;
  const L = makeLayer(S, MAP_HALF, 1024);
  let seed = 39;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  scrub(L, S, rnd, 9000, 1);
  const water = (pts) => L.poly(pts, '#2a5266', true);
  water([[-12500, -5200], [-7000, -4800], [-4200, -6400], [-3300, -9000], [-1900, -12500], [-12500, -12500]]);
  water([[-11500, -900], [-8200, -1300], [-6100, -1000], [-3900, -1500], [-2400, -1300], [-2200, -900], [-3900, -1050], [-6100, -650], [-8300, -800], [-11500, -400]]);
  water([[-7200, 6200], [-3800, 5600], [-2200, 7600], [-1400, 12500], [-8800, 12500]]);
  coastBands(L, MAP_HALF, 250);
  // marsh patches
  for (let i = 0; i < 70; i++) {
    const e = -11000 + rnd() * 9000;
    const n = -8000 + rnd() * 16000;
    L.g.fillStyle = `rgba(${70 + rnd() * 20},${80 + rnd() * 20},${50 + rnd() * 15},0.55)`;
    L.g.beginPath();
    L.g.ellipse(L.X(e), L.Y(n), 6 + rnd() * 30, 4 + rnd() * 20, rnd() * 3, 0, Math.PI * 2);
    L.g.fill();
  }
  // roads and the crawlerway (two gravel lanes)
  L.line([[-11000, -3000], [-4700, -3200], [-1200, -3900], [3000, -9000]], 18, '#3b3d3a');
  L.line([[-4400, -2200], [-3000, 600], [-1900, 3400], [-800, 9000]], 16, '#3b3d3a');
  L.line([[-600, -400], [600, -2600], [1300, -6000]], 12, '#3b3d3a');
  const crawlA = [[-4520, -2450], [-3400, -1700], [-2500, -1100], [-1200, -560], [-140, -60]];
  const crawlB = [[-2500, -1100], [-2300, 200], [-1900, 1500], [-1700, 2050]];
  for (const cw of [crawlA, crawlB]) {
    L.line(cw, 44, '#8e8a7c');
    L.line(cw, 12, '#c5c0b1');
  }
  // pad hardstands + cleared sand
  for (const [e, n] of [[0, 0], [-1660, 2100]]) {
    L.g.fillStyle = '#b5ae95';
    L.g.beginPath();
    L.g.arc(L.X(e), L.Y(n), L.px(520), 0, Math.PI * 2);
    L.g.fill();
    L.g.fillStyle = '#c9c4b6';
    L.g.beginPath();
    L.g.arc(L.X(e), L.Y(n), L.px(260), 0, Math.PI * 2);
    L.g.fill();
  }
  // VAB / LCC industrial area
  L.g.fillStyle = '#9c9a92';
  L.g.fillRect(L.X(-5400), L.Y(-1900), L.X(-3700) - L.X(-5400), L.Y(-3300) - L.Y(-1900));
  L.g.fillStyle = '#76746d';
  for (let i = 0; i < 26; i++) L.g.fillRect(L.X(-6800 + rnd() * 3600), L.Y(-3400 + rnd() * 1800), 3 + rnd() * 9, 3 + rnd() * 7);
  return L.textures();
}

// ------------------------------------------------------------------ ground disc

const GROUND_VS = /* glsl */ `
attribute vec2 uvMap; attribute vec2 uvReg;
varying vec2 vUv; varying vec2 vMap; varying vec2 vReg; varying vec3 vW; varying vec3 vL;
void main(){
  vUv = uv; vMap = uvMap; vReg = uvReg; vL = position;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const GROUND_FS = /* glsl */ `
uniform sampler2D dayMap; uniform sampler2D waterMap; uniform sampler2D localMap; uniform sampler2D localWater;
uniform sampler2D regMap; uniform sampler2D regWater;
uniform vec3 sunDir; uniform vec3 upW; uniform vec3 fogColor; uniform float fogDensity; uniform float time;
uniform vec3 skyTint; uniform float exposure; uniform float opacity;
varying vec2 vUv; varying vec2 vMap; varying vec2 vReg; varying vec3 vW; varying vec3 vL;
float edgeW(vec2 m, float k){
  float inside = step(0.0, m.x) * step(m.x, 1.0) * step(0.0, m.y) * step(m.y, 1.0);
  return smoothstep(0.0, k, min(min(m.x, 1.0 - m.x), min(m.y, 1.0 - m.y))) * inside;
}
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
void main(){
  vec3 land = texture2D(dayMap, vUv).rgb * 1.05;
  float water = texture2D(waterMap, vUv).r;
  float eR = edgeW(vReg, 0.1);
  land = mix(land, texture2D(regMap, vReg).rgb, eR);
  water = mix(water, texture2D(regWater, vReg).r, eR);
  float eL = edgeW(vMap, 0.08);
  land = mix(land, texture2D(localMap, vMap).rgb, eL);
  water = mix(water, texture2D(localWater, vMap).r, eL);
  // fine variation on land
  vec2 p = vL.xz;
  float d = vnoise(p * 0.02) * 0.55 + vnoise(p * 0.11) * 0.3 + vnoise(p * 0.6) * 0.15;
  land *= 0.82 + 0.36 * d;
  vec3 V = normalize(cameraPosition - vW);
  float dist = length(cameraPosition - vW);
  float mu = max(dot(upW, sunDir), 0.0);
  vec3 sunCol = vec3(1.0, 0.96, 0.9) * smoothstep(-0.05, 0.12, mu);
  vec3 col = land * (sunCol * mu * 1.35 + skyTint * 0.55);
  // ocean: ripples, Fresnel sky reflection, sun glint
  if (water > 0.02) {
    vec2 q = p * 0.045;
    float r1 = vnoise(q + vec2(time * 0.05, time * 0.03));
    float r2 = vnoise(q * 3.1 - vec2(time * 0.08, -time * 0.05));
    vec3 n = normalize(upW + (r1 - 0.5) * 0.08 * vec3(1.0, 0.0, 0.3) + (r2 - 0.5) * 0.05 * vec3(0.2, 0.0, 1.0));
    float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
    vec3 deep = vec3(0.02, 0.09, 0.14) * (0.5 + mu);
    vec3 refl = skyTint * 1.25 + vec3(0.04, 0.07, 0.1);
    vec3 hv = normalize(sunDir + V);
    float spec = pow(max(dot(n, hv), 0.0), 220.0) * 30.0 + pow(max(dot(n, hv), 0.0), 18.0) * 0.4;
    vec3 wc = mix(deep, refl, fres) + sunCol * spec;
    col = mix(col, wc, smoothstep(0.02, 0.6, water));
  }
  // aerial perspective
  float fog = 1.0 - exp(-dist * fogDensity);
  col = mix(col, fogColor, clamp(fog, 0.0, 1.0));
  gl_FragColor = vec4(col * exposure, opacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function groundDisc(padLat, padLon, off = { e: 0, n: 0 }) {
  const rings = [0];
  let r = 30;
  while (r < 82000) {
    rings.push(r);
    r *= 1.11;
  }
  const segs = 180;
  const pos = [];
  const uv = [];
  const uvMap = [];
  const uvReg = [];
  const idx = [];
  const latR = (padLat * Math.PI) / 180;
  for (let i = 0; i < rings.length; i++) {
    const rr = rings[i];
    const n = i === 0 ? 1 : segs;
    for (let j = 0; j < n; j++) {
      const a = (j / segs) * Math.PI * 2;
      const e = Math.cos(a) * rr;
      const no = Math.sin(a) * rr;
      pos.push(e, -(rr * rr) / (2 * R_EARTH), -no);
      const lat = padLat + (no / R_EARTH) * (180 / Math.PI);
      const lon = padLon + (e / (R_EARTH * Math.cos(latR))) * (180 / Math.PI);
      uv.push((lon + 180) / 360, (lat + 90) / 180);
      const me = e + off.e;
      const mn = no + off.n;
      uvMap.push((me + MAP_HALF) / (2 * MAP_HALF), (mn + MAP_HALF) / (2 * MAP_HALF));
      uvReg.push((me + REGION_HALF) / (2 * REGION_HALF), (mn + REGION_HALF) / (2 * REGION_HALF));
    }
  }
  // center fan
  for (let j = 0; j < segs; j++) idx.push(0, 1 + j, 1 + ((j + 1) % segs));
  for (let i = 1; i < rings.length - 1; i++) {
    const a0 = 1 + (i - 1) * segs;
    const b0 = 1 + i * segs;
    for (let j = 0; j < segs; j++) {
      const j1 = (j + 1) % segs;
      idx.push(a0 + j, b0 + j, a0 + j1, a0 + j1, b0 + j, b0 + j1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('uvMap', new THREE.Float32BufferAttribute(uvMap, 2));
  g.setAttribute('uvReg', new THREE.Float32BufferAttribute(uvReg, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// ------------------------------------------------------------------ structures

function octFrustum(rTop, rBot, h) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, 8, 1);
  g.rotateY(Math.PI / 8);
  g.translate(0, h / 2, 0);
  return g;
}

function vabTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#c9c8c2';
  g.fillRect(0, 0, 512, 512);
  for (let x = 0; x < 512; x += 8) {
    g.fillStyle = `rgba(0,0,0,${0.04 + (x % 32 === 0 ? 0.06 : 0)})`;
    g.fillRect(x, 0, 2, 512);
  }
  for (let y = 0; y < 512; y += 24) {
    g.fillStyle = 'rgba(0,0,0,0.05)';
    g.fillRect(0, y, 512, 2);
  }
  // high-bay doors
  g.fillStyle = 'rgba(70,72,74,0.55)';
  for (const x of [64, 200, 336]) {
    g.fillRect(x, 30, 100, 482);
    g.fillStyle = 'rgba(40,40,40,0.35)';
    for (let y = 40; y < 512; y += 30) g.fillRect(x, y, 100, 3);
    g.fillStyle = 'rgba(70,72,74,0.55)';
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * @param {{ day?, water? }} tex Blue Marble day + water mask (may be null)
 */
export function createLaunchSite(tex = {}, { pad = 'A', milkstool = false } = {}) {
  const m = materials();
  const group = new THREE.Group();
  group.name = 'LC39';
  const s = pad === 'B' ? SITES_DEG.LC39B : SITES_DEG.LC39A;
  // site frame origin = the active pad; everything painted/built relative to 39A is offset
  const off = pad === 'B' ? { e: 1660, n: -2100 } : { e: 0, n: 0 };
  const base = new THREE.Group();
  base.position.set(off.e, 0, -off.n);
  group.add(base);
  const painted = paintLocal();
  const region = paintRegion();
  const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  black.needsUpdate = true;
  const fallback = new THREE.DataTexture(new Uint8Array([70, 90, 55, 255]), 1, 1);
  fallback.needsUpdate = true;
  const uniforms = {
    dayMap: { value: tex.day ?? fallback },
    waterMap: { value: tex.water ?? black },
    localMap: { value: painted.map },
    localWater: { value: painted.water },
    regMap: { value: region.map },
    regWater: { value: region.water },
    sunDir: { value: new THREE.Vector3(0, 1, 0) },
    upW: { value: new THREE.Vector3(0, 1, 0) },
    fogColor: { value: new THREE.Color(0.55, 0.65, 0.78) },
    fogDensity: { value: 1 / 60000 },
    time: { value: 0 },
    skyTint: { value: new THREE.Color(0.35, 0.45, 0.6) },
    exposure: { value: 1 },
    opacity: { value: 1 },
  };
  const ground = new THREE.Mesh(groundDisc(s.lat, s.lon, off), new THREE.ShaderMaterial({ uniforms, vertexShader: GROUND_VS, fragmentShader: GROUND_FS, transparent: true }));
  ground.frustumCulled = false;
  ground.renderOrder = -1;
  group.add(ground);

  const concrete = m.concrete;
  const add = (geo, mat, x = 0, y = 0, z = 0, shadow = true, parent = base) => {
    const o = new THREE.Mesh(geo, mat);
    o.position.set(x, y, z);
    o.castShadow = shadow;
    o.receiveShadow = true;
    parent.add(o);
    return o;
  };
  const here = (geo, mat, x, y, z, shadow = true) => add(geo, mat, x, y, z, shadow, group);
  // Pad A mound (48 ft) with the crawlerway ramp on the west and the N–S flame trench
  const padTop = 14.6;
  const trenchMat = new THREE.MeshStandardMaterial({ color: 0x141312, roughness: 1 });
  // both pad mounds (with crawlerway ramp and the N–S flame trench); the active one is at the origin
  for (const [pe, pn] of [[0, 0], [-1660, 2100]]) {
    add(octFrustum(92, 235, padTop), concrete, pe, 0, -pn);
    const ramp = new THREE.BoxGeometry(300, 2, 34);
    ramp.rotateZ(Math.atan2(padTop, 300));
    add(ramp, concrete, pe - 200, padTop / 2 - 1, -pn);
    add(new THREE.BoxGeometry(18, 0.4, 150), trenchMat, pe, padTop + 0.05, -pn, false);
    add(new THREE.BoxGeometry(22, 12, 4), trenchMat, pe, padTop - 6, -pn + 76, false);
    add(new THREE.BoxGeometry(22, 12, 4), trenchMat, pe, padTop - 6, -pn - 76, false);
  }
  // Mobile Launcher on six pedestals at the active pad, deck top at DECK_Y
  for (const [x, z] of [[14, -18], [-14, -18], [14, 18], [-14, 18], [17, 0], [-17, 0]]) here(new THREE.BoxGeometry(4, DECK_Y - 7.6 - padTop, 4), m.mlGrey, x, padTop + (DECK_Y - 7.6 - padTop) / 2, z);
  const tower = createLaunchTower();
  tower.position.y = DECK_Y;
  tower.rotation.y = -Math.PI / 2; // LUT on the north side of the vehicle (left as seen from the press site)
  group.add(tower);
  if (milkstool) {
    // Saturn IB "milkstool": a 38.7 m pedestal so the S-IVB/CSM line up with the Saturn V swing arms
    const ms = [];
    const H = 38.7;
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const x = Math.cos(a) * 4.2;
      const z = Math.sin(a) * 4.2;
      const leg = new THREE.BoxGeometry(1.2, H, 1.2);
      leg.translate(x, DECK_Y + H / 2, z);
      ms.push(leg);
    }
    for (let y = 4; y < H; y += 6) {
      for (let i = 0; i < 4; i++) {
        const b = new THREE.BoxGeometry(i % 2 ? 0.5 : 8.4, 0.5, i % 2 ? 8.4 : 0.5);
        b.translate(i === 1 ? 2.97 : i === 3 ? -2.97 : 0, DECK_Y + y, i === 0 ? 2.97 : i === 2 ? -2.97 : 0);
        ms.push(b);
      }
    }
    const top = new THREE.BoxGeometry(9.5, 1.4, 9.5);
    top.translate(0, DECK_Y + H - 0.7, 0);
    ms.push(top);
    for (const g of ms) here(g, new THREE.MeshStandardMaterial({ color: 0xd9d6cc, roughness: 0.7, metalness: 0.2 }), 0, 0, 0);
  }
  // propellant spheres, water tower
  const white = new THREE.MeshStandardMaterial({ color: 0xe9e8e2, roughness: 0.5, metalness: 0.2 });
  add(new THREE.SphereGeometry(10.5, 24, 16), white, -235, 12.5, -225);
  add(new THREE.SphereGeometry(12.5, 24, 16), white, 250, 14.5, -255);
  for (const [x, z, r] of [[-235, -225, 10.5], [250, -255, 12.5]]) for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    add(new THREE.CylinderGeometry(0.35, 0.35, r + 2, 6), m.mlGrey, x + Math.cos(a) * r * 0.75, (r + 2) / 2, z + Math.sin(a) * r * 0.75);
  }
  add(new THREE.CylinderGeometry(2.2, 3.4, 52, 12), white, 520, 26, 330);
  add(new THREE.SphereGeometry(10, 20, 14), white, 520, 58, 330);
  // VAB (high bay + low bay), LCC, Pad 39B mound
  const vabMat = new THREE.MeshStandardMaterial({ map: vabTexture(), roughness: 0.85 });
  add(new THREE.BoxGeometry(158, 160, 218), vabMat, -4600, 80, 2450);
  add(new THREE.BoxGeometry(134, 64, 98), new THREE.MeshStandardMaterial({ color: 0xc4c3bd, roughness: 0.9 }), -4600, 32, 2450 + 158);
  add(new THREE.BoxGeometry(110, 24, 55), new THREE.MeshStandardMaterial({ color: 0xd2d0c8, roughness: 0.9 }), -4330, 12, 2760);
  add(octFrustum(92, 235, padTop), concrete, -1660, 0, -2100);
  return {
    group,
    tower,
    ground,
    uniforms,
    /** swing arms: angle per arm (0 = at the vehicle, 1 = fully retracted) */
    setArms(fn) {
      tower.userData.arms.forEach((a, i) => (a.rotation.y = -fn(i) * 1.55));
    },
    dispose() {
      group.traverse((o) => {
        o.geometry?.dispose?.();
        if (o.material && o.material !== m.concrete && o.material !== m.mlGrey) o.material.dispose?.();
      });
      painted.map.dispose();
      painted.water.dispose();
      region.map.dispose();
      region.water.dispose();
    },
  };
}
