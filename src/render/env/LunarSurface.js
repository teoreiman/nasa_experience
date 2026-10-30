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
  g.fillStyle = '#8a8680';
  g.fillRect(0, 0, S, S);
  hg.fillStyle = '#808080';
  hg.fillRect(0, 0, S, S);
  // grain
  const img = g.getImageData(0, 0, S, S);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * 26;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n * 0.95;
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
        grd.addColorStop(0, `rgba(0,0,0,${0.5 * depth})`);
        grd.addColorStop(0.62, `rgba(0,0,0,${0.12 * depth})`);
        grd.addColorStop(0.7, `rgba(255,255,255,${0.35 * depth})`);
        grd.addColorStop(1, 'rgba(255,255,255,0)');
        hg.fillStyle = grd;
        hg.fillRect(cx - r * 1.6, cy - r * 1.6, r * 3.2, r * 3.2);
        g.fillStyle = `rgba(${rnd() < 0.3 ? '190,186,178' : '60,58,55'},${0.06 + rnd() * 0.08})`;
        g.beginPath();
        g.arc(cx, cy, r * (0.9 + rnd() * 0.5), 0, Math.PI * 2);
        g.fill();
      }
    }
  };
  for (let i = 0; i < 260; i++) crater(rnd() * S, rnd() * S, 2 + Math.pow(rnd(), 3) * 40, 0.5 + rnd() * 0.5);
  // pebbles
  for (let i = 0; i < 900; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = 0.6 + rnd() * 2.2;
    hg.fillStyle = 'rgba(255,255,255,0.5)';
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
      const dx = (H(x + 1, y) - H(x - 1, y)) * 3.2;
      const dy = (H(x, y + 1) - H(x, y - 1)) * 3.2;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * S + x) * 4;
      out.data[i] = (-dx / l * 0.5 + 0.5) * 255;
      out.data[i + 1] = (dy / l * 0.5 + 0.5) * 255;
      out.data[i + 2] = (1 / l) * 255;
      out.data[i + 3] = 255;
    }
  }
  ng.putImageData(out, 0, 0);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;
  const normal = new THREE.CanvasTexture(nc);
  normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
  normal.anisotropy = 8;
  return { map, normal };
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

export function createLunarSurface(game, { site = 'TRANQUILITY', quality = {} } = {}) {
  const group = new THREE.Group();
  group.name = 'LunarSurface';
  const frame = siteFrame(site);
  const tex = regolithTextures();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xa39e96,
    map: tex.map,
    normalMap: tex.normal,
    normalScale: new THREE.Vector2(0.9, 0.9),
    roughness: 1,
    metalness: 0,
    vertexColors: true,
  });
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
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x9a958c, roughness: 0.95, metalness: 0, map: tex.map });
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
  const sun = new THREE.DirectionalLight(0xfffaf2, 3.6);
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
    const c0 = lmToMoonFixed(cx, cy, 0, new THREE.Vector3());
    const near = Math.hypot(cx, cy) < 40000;
    let k = 0;
    const put = (e, n) => {
      const h = near && Math.abs(e) < 32000 && Math.abs(n) < 32000 ? heightLocal(e, n, site) : 0;
      lmToMoonFixed(e, n, h, _p).sub(c0);
      pos[k * 3] = _p.dot(frame.east);
      pos[k * 3 + 1] = _p.dot(frame.north);
      pos[k * 3 + 2] = _p.dot(frame.up);
      uv[k * 2] = e / TILE;
      uv[k * 2 + 1] = n / TILE;
      // large-scale albedo: brighter ejecta near crater rims, darker mare patches
      const v = 0.86 + 0.08 * Math.sin(e * 0.0021 + Math.cos(n * 0.0017) * 2) + 0.05 * Math.sin((e - n) * 0.009) + Math.max(0, h - 1.5) * 0.02;
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
  return {
    group,
    get center() {
      return { x: state.cx, y: state.cy };
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
      if (!state.built || moved > Math.max(15, alt * 0.12)) rebuild(l.x, l.y);
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
