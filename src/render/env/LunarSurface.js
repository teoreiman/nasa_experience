// Lunar surface around the landing site (mid pass), matching the physics terrain exactly:
//  - radial-grid terrain mesh re-centred under the vehicle (arc-distance east/north coordinates,
//    true curvature), heights from lunarTerrain.heightLocal (West crater, its boulder field…)
//  - regolith material with tiled micro-crater detail + large-scale albedo variation
//  - instanced boulders (physics boulders near the site + decorative rocks), long shadows from
//    the low Sun, and an invisible LM proxy that casts the LM's shadow onto the ground
// Group frame: x = east, y = north, z = up at the grid centre (site basis), metres.

import * as THREE from 'three';
import { R_MOON } from '../../core/constants.js';
import { siteFeatures, siteFrame, heightLocal } from '../../sim/terrain/lunarTerrain.js';

const RINGS_MIN = 3;
const RING_K = 1.072;
const RING_MAX = 70000;
const SEGS = 200;
const TILE = 36; // metres per detail-texture tile

function regolithTextures() {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const hc = document.createElement('canvas');
  hc.width = hc.height = S;
  const hg = hc.getContext('2d');
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.fillStyle = '#8c8b88';
  g.fillRect(0, 0, S, S);
  hg.fillStyle = '#808080';
  hg.fillRect(0, 0, S, S);
  // grain
  const img = g.getImageData(0, 0, S, S);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * 26;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n * 0.98;
  }
  g.putImageData(img, 0, 0);
  // micro craters (wrap around the tile edges so the texture tiles seamlessly)
  const crater = (x, y, r, depth) => {
    for (const ox of [-S, 0, S]) {
      for (const oy of [-S, 0, S]) {
        const cx = x + ox;
        const cy = y + oy;
        if (cx + r * 1.6 < 0 || cx - r * 1.6 > S || cy + r * 1.6 < 0 || cy - r * 1.6 > S) continue;
        const grd = hg.createRadialGradient(cx, cy, 0, cx, cy, r * 1.5);
        grd.addColorStop(0, `rgba(0,0,0,${0.38 * depth})`);
        grd.addColorStop(0.62, `rgba(0,0,0,${0.1 * depth})`);
        grd.addColorStop(0.72, `rgba(255,255,255,${0.09 * depth})`);
        grd.addColorStop(1, 'rgba(255,255,255,0)');
        hg.fillStyle = grd;
        hg.fillRect(cx - r * 1.6, cy - r * 1.6, r * 3.2, r * 3.2);
        g.fillStyle = `rgba(${rnd() < 0.3 ? '178,176,172' : '72,71,69'},${0.03 + rnd() * 0.05})`;
        g.beginPath();
        g.arc(cx, cy, r * (0.9 + rnd() * 0.5), 0, Math.PI * 2);
        g.fill();
      }
    }
  };
  // mostly small pits, a few metre-size craters per tile (36 m): soft bowls, not rings
  for (let i = 0; i < 190; i++) crater(rnd() * S, rnd() * S, 1.5 + Math.pow(rnd(), 4) * 30, 0.4 + rnd() * 0.5);
  // pebbles
  for (let i = 0; i < 900; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = 0.6 + rnd() * 2.2;
    hg.fillStyle = 'rgba(255,255,255,0.3)';
    hg.beginPath();
    hg.arc(x, y, r, 0, Math.PI * 2);
    hg.fill();
    g.fillStyle = `rgba(${150 + rnd() * 60},${148 + rnd() * 55},${140 + rnd() * 50},0.5)`;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  // normal map from the height canvas
  const hd = hg.getImageData(0, 0, S, S).data;
  const nc = document.createElement('canvas');
  nc.width = nc.height = S;
  const ng = nc.getContext('2d');
  const out = ng.createImageData(S, S);
  const H = (x, y) => hd[(((y + S) % S) * S + ((x + S) % S)) * 4] / 255;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * 2.4;
      const dy = (H(x, y + 1) - H(x, y - 1)) * 2.4;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * S + x) * 4;
      out.data[i] = (-dx / l * 0.5 + 0.5) * 255;
      out.data[i + 1] = (dy / l * 0.5 + 0.5) * 255;
      out.data[i + 2] = (1 / l) * 255;
      out.data[i + 3] = 255;
    }
  }
  ng.putImageData(out, 0, 0);
  // mean colour (linear) of the tile: the coarse layers multiply by colour / mean (no net darkening)
  const px = g.getImageData(0, 0, S, S).data;
  let sum = 0;
  for (let i = 0; i < px.length; i += 4) sum += Math.pow((px[i] + px[i + 1] + px[i + 2]) / (3 * 255), 2.2);
  const mean = sum / (px.length / 4);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;
  const normal = new THREE.CanvasTexture(nc);
  normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
  normal.anisotropy = 8;
  return { map, normal, mean };
}

// ---- craters seen from altitude (rendering only)
// The physics terrain (lunarTerrain.heightLocal) is detailed around the landing site and nearly flat
// elsewhere. From the descent orbit the player sees tens of kilometres of ground, so the rendered
// terrain adds a deterministic crater field at three scales, faded out within ~10 km of the site where
// the LM actually comes down (there the picture and the collision terrain stay identical).
const CRATER_SCALES = [
  { cell: 26000, p: 0.38, r0: 2600, r1: 8500, depth: 0.1 },
  { cell: 5200, p: 0.55, r0: 380, r1: 2100, depth: 0.15 },
  { cell: 1300, p: 0.6, r0: 70, r1: 480, depth: 0.18 },
];
function hash2(i, j, k) {
  let h = (i * 374761393 + j * 668265263 + k * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822519) ^ Math.imul(h + 0x9e3779b9, 3266489917);
    return ((h >>> 0) % 1000003) / 1000003;
  };
}
/** → { h: height offset (m), a: albedo factor (fresh rims and ejecta are brighter) } */
const _crater = { h: 0, a: 1 };
function visualCraters(e, n) {
  let h = 0;
  let a = 1;
  for (let s = 0; s < CRATER_SCALES.length; s++) {
    const S = CRATER_SCALES[s];
    const ci = Math.floor(e / S.cell);
    const cj = Math.floor(n / S.cell);
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const rnd = hash2(ci + di, cj + dj, s + 1);
        if (rnd() > S.p) continue;
        const cx = (ci + di + rnd()) * S.cell;
        const cy = (cj + dj + rnd()) * S.cell;
        const r = S.r0 + Math.pow(rnd(), 2.2) * (S.r1 - S.r0);
        const dx = e - cx;
        const dy = n - cy;
        const q = (dx * dx + dy * dy) / (r * r);
        if (q > 3.2) continue;
        const d = r * S.depth;
        const fresh = rnd();
        if (q < 1) h -= d * (1 - q) * (1 - q * 0.3);
        else if (q < 2.3) h += d * 0.25 * Math.max(0, 1 - (q - 1) / 1.3);
        // young craters: a bright rim and ejecta blanket
        if (fresh > 0.72) a += (fresh - 0.72) * 1.2 * Math.max(0, 1 - Math.abs(Math.sqrt(q) - 1.15) / 0.65);
      }
    }
  }
  _crater.h = h;
  _crater.a = a;
  return _crater;
}

/** Large-scale albedo of the real Moon (the LROC map of the global sphere), sampled on the CPU so the
 *  terrain around the vehicle shows the same maria and highlands as the globe it blends into.
 *  Returns sample(xMoonFixed, y, z) → relative albedo (≈1 on average), or null if the image is not ready. */
function albedoSampler(moonTex) {
  const img = moonTex?.image;
  if (!img || !(img.width > 0)) return null;
  const W = Math.min(2048, img.width);
  const H = Math.round((W * img.height) / img.width);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, W, H);
  let data;
  try {
    data = g.getImageData(0, 0, W, H).data;
  } catch {
    return null;
  }
  const lum = new Float32Array(W * H);
  let sum = 0;
  for (let i = 0; i < W * H; i++) {
    const l = (0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) / 255;
    lum[i] = l;
    sum += l;
  }
  const mean = sum / (W * H);
  const at = (x, y) => lum[Math.min(H - 1, Math.max(0, y)) * W + (((x % W) + W) % W)];
  // same mapping as the globe: SphereGeometry rotated +90° about X (poles on Z), default UVs
  return (x, y, z) => {
    const r = Math.hypot(x, y, z) || 1;
    const theta = Math.acos(Math.max(-1, Math.min(1, z / r)));
    let u = Math.atan2(-y, -x) / (2 * Math.PI);
    if (u < 0) u += 1;
    const fx = u * W - 0.5;
    const fy = (theta / Math.PI) * H - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const v = (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
    return v / mean;
  };
}

/** Lunar regolith photometry on a standard material: Lommel–Seeliger (bright at grazing views, flat
 *  at full phase) with a little Lambert, the same law as the globe's shader so the terrain around the
 *  vehicle and the distant Moon match in brightness. */
function regolithPhotometry(mat, mean = 0.25) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.texMean = { value: mean };
    // the same crater texture at ~1 km and ~17 km per tile on top of the 36 m one: from the descent
    // orbit the ground is a field of craters instead of a smooth average (offset + rotated layers)
    shader.fragmentShader = 'uniform float texMean;\n' + shader.fragmentShader
      .replace(
        'vec4 sampledDiffuseColor = texture2D( map, vMapUv );',
        `vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	float camDist = length( vViewPosition );
	float fadeA = smoothstep( 250.0, 900.0, camDist );
	float fadeB = smoothstep( 2500.0, 9000.0, camDist );
	vec2 uvA = mat2(0.8, -0.6, 0.6, 0.8) * vMapUv * 0.031 + vec2(0.37, 0.61);
	vec2 uvB = mat2(0.28, 0.96, -0.96, 0.28) * vMapUv * 0.0021 + vec2(0.13, 0.29);
	sampledDiffuseColor.rgb *= mix( vec3(1.0), clamp(texture2D( map, uvA ).rgb / texMean, 0.55, 1.6), fadeA ) * mix( vec3(1.0), clamp(texture2D( map, uvB ).rgb / texMean, 0.5, 1.7), fadeB );`,
      )
      .replace(
        'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
        `vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	vec2 nA = texture2D( normalMap, mat2(0.8, -0.6, 0.6, 0.8) * vNormalMapUv * 0.031 + vec2(0.37, 0.61) ).xy * 2.0 - 1.0;
	vec2 nB = texture2D( normalMap, mat2(0.28, 0.96, -0.96, 0.28) * vNormalMapUv * 0.0021 + vec2(0.13, 0.29) ).xy * 2.0 - 1.0;
	float camDistN = length( vViewPosition );
	mapN = normalize( vec3( mapN.xy + mat2(0.8, 0.6, -0.6, 0.8) * nA * 0.8 * smoothstep( 250.0, 900.0, camDistN ) + mat2(0.28, -0.96, 0.96, 0.28) * nB * 1.0 * smoothstep( 2500.0, 9000.0, camDistN ), mapN.z ) );`,
      )
      .replace(
      '#include <lights_physical_pars_fragment>',
      THREE.ShaderChunk.lights_physical_pars_fragment.replace(
        'vec3 irradiance = dotNL * directLight.color;',
        `float dotNVls = saturate( dot( geometryNormal, geometryViewDir ) );
	float lsShade = dotNL / max( dotNL + dotNVls, 1e-3 );
	vec3 irradiance = ( lsShade * 1.45 + dotNL * 0.3 ) * directLight.color;`,
      ),
    );
  };
  mat.customProgramCacheKey = () => 'regolith-ls-ms';
}

function rockGeometry(seed) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const k = [0.75 + rnd() * 0.5, 0.55 + rnd() * 0.3, 0.75 + rnd() * 0.5];
  for (let i = 0; i < p.count; i++) {
    const f = 0.78 + rnd() * 0.4;
    p.setXYZ(i, p.getX(i) * f * k[0], p.getY(i) * f * k[1], p.getZ(i) * f * k[2]);
  }
  g.computeVertexNormals();
  return g;
}

export function createLunarSurface(game, { site = 'TRANQUILITY', quality = {}, moonTex = null } = {}) {
  const group = new THREE.Group();
  let albedo = null; // built from the globe's colour map on the first rebuild where it is loaded
  group.name = 'LunarSurface';
  const frame = siteFrame(site);
  const tex = regolithTextures();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xc6c5c2,
    map: tex.map,
    normalMap: tex.normal,
    // gentle: under a 10° Sun a strong micro-relief turns every small crater into a glowing ring
    normalScale: new THREE.Vector2(0.4, 0.4),
    roughness: 1,
    metalness: 0,
    vertexColors: true,
  });
  regolithPhotometry(mat, tex.mean);
  // ---- radial grid
  const radii = [0];
  for (let r = RINGS_MIN; r < RING_MAX; r *= RING_K) radii.push(r);
  const nV = 1 + (radii.length - 1) * SEGS;
  const pos = new Float32Array(nV * 3);
  const uv = new Float32Array(nV * 2);
  const col = new Float32Array(nV * 3);
  const idx = [];
  for (let j = 0; j < SEGS; j++) idx.push(0, 1 + j, 1 + ((j + 1) % SEGS));
  for (let i = 1; i < radii.length - 1; i++) {
    const a0 = 1 + (i - 1) * SEGS;
    const b0 = 1 + i * SEGS;
    for (let j = 0; j < SEGS; j++) {
      const j1 = (j + 1) % SEGS;
      idx.push(a0 + j, b0 + j, a0 + j1, a0 + j1, b0 + j, b0 + j1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  const terrain = new THREE.Mesh(geo, mat);
  terrain.receiveShadow = true;
  terrain.castShadow = true;
  terrain.frustumCulled = false;
  group.add(terrain);

  // ---- boulders
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x8f8d89, roughness: 0.95, metalness: 0, map: tex.map });
  const feats = siteFeatures(site);
  const rocks = [];
  let rs = 1234;
  const rnd = () => ((rs = (rs * 16807) % 2147483647) / 2147483647);
  for (const b of feats.boulders) rocks.push({ x: b.x, y: b.y, r: b.r });
  for (let i = 0; i < 1400; i++) {
    const rr = Math.pow(rnd(), 0.5) * 900;
    const a = rnd() * Math.PI * 2;
    rocks.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr, r: 0.08 + Math.pow(rnd(), 3) * 0.9 });
  }
  const rockGeos = [rockGeometry(3), rockGeometry(17), rockGeometry(91)];
  const rockMeshes = rockGeos.map((g) => {
    const m = new THREE.InstancedMesh(g, rockMat, Math.ceil(rocks.length / 3) + 1);
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    group.add(m);
    return m;
  });

  // ---- invisible LM shadow caster (the real LM model lives in the near pass)
  const proxyMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  const proxy = new THREE.Group();
  const ds = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 1.7, 8), proxyMat);
  ds.rotation.x = Math.PI / 2;
  ds.position.z = 2.4;
  const as = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3.0, 2.6), proxyMat);
  as.position.z = 4.6;
  const legs = [];
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4.0, 4), proxyMat);
    l.position.set(Math.sin(a) * 3.3, Math.cos(a) * 3.3, 1.4);
    l.rotation.set(Math.cos(a) * 0.7, -Math.sin(a) * 0.7, 0, 'XYZ');
    legs.push(l);
  }
  proxy.add(ds, as, ...legs);
  proxy.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.renderOrder = -5;
    }
  });
  group.add(proxy);

  // ---- lights for this pass
  // as bright as the globe's shader at the same spot (the terrain blends into it at the horizon)
  const sun = new THREE.DirectionalLight(0xfffcf6, 8.2);
  sun.castShadow = quality.shadows !== false;
  if (sun.castShadow) {
    const size = quality.name === 'high' ? 4096 : 2048;
    sun.shadow.mapSize.set(size, size);
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.05;
  }
  const amb = new THREE.HemisphereLight(0x10141c, 0x2a2826, 0.25);
  group.add(sun, sun.target, amb);

  const state = { cx: NaN, cy: NaN, built: false };
  const _p = new THREE.Vector3();
  const _d = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const basisQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(frame.east, frame.north, frame.up));

  /** arc-distance local (e, n) → moon-fixed position (m, relative to the Moon's centre) */
  function lmToMoonFixed(e, n, h, out) {
    const d = Math.hypot(e, n);
    const th = d / R_MOON;
    if (d < 1e-6) return out.copy(frame.up).multiplyScalar(R_MOON + h);
    out.copy(frame.up).multiplyScalar(Math.cos(th));
    _d.copy(frame.east).multiplyScalar(e / d).addScaledVector(frame.north, n / d).multiplyScalar(Math.sin(th));
    return out.add(_d).multiplyScalar(R_MOON + h);
  }

  function rebuild(cx, cy) {
    state.cx = cx;
    state.cy = cy;
    albedo ??= albedoSampler(moonTex);
    state.albedo = !!albedo;
    const c0 = lmToMoonFixed(cx, cy, 0, new THREE.Vector3());
    const near = Math.hypot(cx, cy) < 40000;
    let k = 0;
    const put = (e, n) => {
      let h = near && Math.abs(e) < 32000 && Math.abs(n) < 32000 ? heightLocal(e, n, site) : 0;
      // the crater field fades in beyond ~10 km of the site (see visualCraters)
      const fade = Math.min(1, Math.max(0, (Math.hypot(e, n) - 8000) / 8000));
      let ejecta = 1;
      if (fade > 0) {
        const c = visualCraters(e, n);
        h += c.h * fade;
        ejecta = 1 + (c.a - 1) * fade;
      }
      lmToMoonFixed(e, n, h, _p);
      // the real Moon's albedo at this spot (maria dark, highlands and rays bright)
      const real = albedo ? Math.max(0.42, Math.min(1.5, albedo(_p.x, _p.y, _p.z))) : 1;
      _p.sub(c0);
      pos[k * 3] = _p.dot(frame.east);
      pos[k * 3 + 1] = _p.dot(frame.north);
      pos[k * 3 + 2] = _p.dot(frame.up);
      uv[k * 2] = e / TILE;
      uv[k * 2 + 1] = n / TILE;
      // large-scale albedo: brighter ejecta near crater rims, darker mare patches
      const v = Math.min(1.6, (0.86 + 0.06 * Math.sin(e * 0.0021 + Math.cos(n * 0.0017) * 2) + 0.04 * Math.sin((e - n) * 0.009)) * real * ejecta);
      col[k * 3] = v;
      col[k * 3 + 1] = v * 0.985;
      col[k * 3 + 2] = v * 0.96;
      k++;
    };
    put(cx, cy);
    for (let i = 1; i < radii.length; i++) {
      const r = radii[i];
      for (let j = 0; j < SEGS; j++) {
        const a = (j / SEGS) * Math.PI * 2;
        put(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.uv.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.computeVertexNormals();
    // rocks within 2.5 km of the centre, sitting on the terrain
    const m4 = new THREE.Matrix4();
    const counts = [0, 0, 0];
    rocks.forEach((rk, i) => {
      if (Math.hypot(rk.x - cx, rk.y - cy) > 2500) return;
      const h = heightLocal(rk.x, rk.y, site);
      lmToMoonFixed(rk.x, rk.y, h + rk.r * 0.25, _p).sub(c0);
      const local = new THREE.Vector3(_p.dot(frame.east), _p.dot(frame.north), _p.dot(frame.up));
      const s = rk.r;
      m4.compose(local, _q.setFromAxisAngle(_d.set(0.3, 0.5, 1).normalize(), i * 1.7), new THREE.Vector3(s, s, s * 0.7));
      const mesh = rockMeshes[i % 3];
      if (counts[i % 3] < mesh.count) mesh.setMatrixAt(counts[i % 3]++, m4);
    });
    rockMeshes.forEach((m, i) => {
      m.count = counts[i];
      m.instanceMatrix.needsUpdate = true;
    });
    state.c0 = c0;
    state.built = true;
  }

  const tmpRel = new THREE.Vector3();
  const moonRotQ = new THREE.Quaternion();
  const _gi = new THREE.Quaternion();
  return {
    group,
    get center() {
      return { x: state.cx, y: state.cy };
    },
    /** The vehicle's sub-point in site metres (x east, y north). */
    get vehicleLocal() {
      return { x: state.lmx ?? 0, y: state.lmy ?? 0 };
    },
    /** Ground height (m) at a site-local point (the collision terrain). */
    heightAt: (e, n) => heightLocal(e, n, site),
    /** ECI position of a site-local point (east, north, height above the reference sphere). */
    siteToEci(dyn, e, n, h, out) {
      lmToMoonFixed(e, n, h, out);
      return dyn.moonFixedToEci(out, out).add(dyn.moonPos);
    },
    /** An invisible copy of `object` that throws its shadow on the regolith (EVA astronauts, props). */
    addShadowCaster(object) {
      const c = object.clone(true);
      c.traverse((o) => {
        if (o.isMesh) {
          o.material = proxyMat;
          o.castShadow = true;
          o.receiveShadow = false;
          o.renderOrder = -5;
        }
      });
      group.add(c);
      return c;
    },
    /** Place a shadow caster at an ECI pose (camera-relative frame of this frame; after update()). */
    placeCaster(obj, posEci, quatEci, camWorld) {
      _gi.copy(group.quaternion).invert();
      obj.position.copy(posEci).sub(camWorld).sub(group.position).applyQuaternion(_gi);
      obj.quaternion.copy(_gi).multiply(quatEci);
    },
    removeCaster(obj) {
      group.remove(obj);
    },
    /** surface "TV camera" a few tens of metres from the vehicle (or the site) in ECI. */
    tvCameraWorld(dyn, out) {
      const c = Number.isFinite(state.cx) ? state : { cx: 0, cy: 0 };
      const e = (c.lmx ?? c.cx) - 45;
      const n = (c.lmy ?? c.cy) - 28;
      lmToMoonFixed(e, n, heightLocal(e, n, site) + 1.6, out);
      return dyn.moonFixedToEci(out, out).add(dyn.moonPos);
    },
    update({ dyn, camWorld, sunDir, vehicle, time }) {
      const st = vehicle.state;
      // vehicle sub-point in site arc coordinates
      const l = dyn.siteLocal(tmpRel.subVectors(st.r, dyn.moonPos));
      state.lmx = l.x;
      state.lmy = l.y;
      const alt = Math.max(5, st.altTerrain ?? st.alt);
      const moved = Math.hypot(l.x - state.cx, l.y - state.cy);
      // also once the globe's colour map has loaded (it tints the terrain)
      if (!state.built || moved > Math.max(15, alt * 0.12) || (!state.albedo && moonTex?.image?.width > 0)) rebuild(l.x, l.y);
      // place the grid: centre point (moon-fixed) → ECI, camera-relative
      moonRotQ.setFromAxisAngle(_d.set(0, 0, 1), dyn.moonAngle);
      _p.copy(state.c0).applyQuaternion(moonRotQ).add(dyn.moonPos).sub(camWorld);
      group.position.copy(_p);
      group.quaternion.copy(moonRotQ).multiply(basisQ);
      // sun in the group frame + shadow frustum around the vehicle
      const inv = _q.copy(group.quaternion).invert();
      const sunL = _d.copy(sunDir).applyQuaternion(inv);
      const vehL = tmpRel.copy(st.r).sub(camWorld).sub(group.position).applyQuaternion(inv);
      sun.target.position.copy(vehL);
      sun.position.copy(vehL).addScaledVector(sunL, 600);
      const sc = sun.shadow.camera;
      const ext = Math.min(900, Math.max(60, alt * 1.5 + 40));
      sc.left = sc.bottom = -ext;
      sc.right = sc.top = ext;
      sc.near = 10;
      sc.far = 1500;
      sc.updateProjectionMatrix();
      amb.position.set(0, 0, 1);
      // LM shadow proxy
      const lmAttached = vehicle.config === 'LM' || vehicle.config === 'LM_ASC';
      proxy.visible = lmAttached;
      if (lmAttached) {
        proxy.position.copy(vehL);
        // body +X (up) → group frame; the proxy is built with +Z up
        const bq = _q.copy(inv).multiply(st.q);
        proxy.quaternion.copy(bq).multiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)));
        // datum offset: the LM ref point sits ~2.5 m above the footpads
        proxy.position.addScaledVector(new THREE.Vector3(1, 0, 0).applyQuaternion(bq), -2.5);
      }
      void time;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      tex.map.dispose();
      tex.normal.dispose();
      rockMat.dispose();
      rockGeos.forEach((g) => g.dispose());
      rockMeshes.forEach((m) => m.dispose());
      proxy.traverse((o) => o.geometry?.dispose?.());
      proxyMat.dispose();
    },
  };
}
