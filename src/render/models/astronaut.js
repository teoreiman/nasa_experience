// Apollo moonwalk models: the A7L suit with its PLSS backpack and gold visor (jointed, animated by
// setPose), the flag, the EASEP experiments (PSEP seismometer, LRRR laser reflector) and the ground
// marker rings of the EVA tasks. Model space: +Y up, the astronaut faces −Z, metres.

import * as THREE from 'three';

const _m = new Map();
function mats() {
  if (_m.size) return _m;
  const std = (o) => new THREE.MeshStandardMaterial(o);
  _m.set('suit', std({ color: 0xeeebe4, roughness: 0.92, metalness: 0 }));
  _m.set('joint', std({ color: 0xc9c6bf, roughness: 0.95, metalness: 0 }));
  _m.set('plss', std({ color: 0xe4e1da, roughness: 0.85, metalness: 0.02 }));
  _m.set('dark', std({ color: 0x2a2e36, roughness: 0.6, metalness: 0.2 }));
  _m.set('glove', std({ color: 0x3a4250, roughness: 0.8, metalness: 0 }));
  _m.set('boot', std({ color: 0xd8d6d0, roughness: 0.9, metalness: 0 }));
  _m.set('sole', std({ color: 0x5b6470, roughness: 0.9, metalness: 0 }));
  _m.set('visor', std({ color: 0xd9a441, roughness: 0.12, metalness: 1, envMapIntensity: 1.6 }));
  _m.set('helmet', std({ color: 0xf2f1ec, roughness: 0.35, metalness: 0.1 }));
  _m.set('red', std({ color: 0xc8352b, roughness: 0.7, metalness: 0 }));
  _m.set('alu', std({ color: 0xb7bcc4, roughness: 0.35, metalness: 0.85 }));
  _m.set('gold', std({ color: 0xc9a14a, roughness: 0.38, metalness: 0.9 }));
  _m.set('panel', std({ color: 0x1b2742, roughness: 0.35, metalness: 0.5 }));
  return _m;
}

function part(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** A jointed limb: pivot group at the joint, the segment hanging down along −Y. */
function limb(len, r0, r1, mat, jointMat) {
  const pivot = new THREE.Group();
  const seg = part(new THREE.CylinderGeometry(r1, r0, len, 10), mat, 0, -len / 2, 0);
  const ring = part(new THREE.TorusGeometry(r0 * 0.95, r0 * 0.22, 6, 12), jointMat, 0, -len * 0.18, 0);
  ring.rotation.x = Math.PI / 2;
  pivot.add(seg, ring);
  return pivot;
}

/**
 * @param {{ commander?: boolean }} o  the commander wore red stripes from Apollo 13 on; Armstrong's
 *   suit had none, so this only changes the arm patch colour a little.
 * @returns {{ root: THREE.Group, setPose(t: number, gait: {speed:number, hop:number, crouch?:number, reach?:number}): void, dispose(): void }}
 */
export function createAstronaut({ commander = true } = {}) {
  const M = mats();
  const root = new THREE.Group();
  const body = new THREE.Group(); // bobs and leans as a whole
  root.add(body);
  // torso with the PLSS and the OPS on top, chest display & control unit (RCU)
  const torso = new THREE.Group();
  torso.position.y = 1.18;
  body.add(torso);
  torso.add(part(new THREE.CapsuleGeometry(0.24, 0.36, 6, 12), M.get('suit'), 0, 0.1, 0));
  const plss = part(new THREE.BoxGeometry(0.5, 0.66, 0.24), M.get('plss'), 0, 0.12, 0.3);
  const ops = part(new THREE.BoxGeometry(0.48, 0.2, 0.22), M.get('plss'), 0, 0.55, 0.31);
  const strap = part(new THREE.BoxGeometry(0.46, 0.04, 0.05), M.get('dark'), 0, -0.14, 0.18);
  const rcu = part(new THREE.BoxGeometry(0.22, 0.13, 0.08), M.get('alu'), 0, 0.12, -0.27);
  const hoses = [-1, 1].map((s) => {
    const h = part(new THREE.TorusGeometry(0.09, 0.022, 6, 12, Math.PI), s < 0 ? M.get('red') : M.get('dark'), s * 0.13, -0.02, -0.25);
    h.rotation.y = Math.PI / 2;
    return h;
  });
  const flagPatch = part(new THREE.BoxGeometry(0.06, 0.04, 0.005), M.get('red'), commander ? -0.25 : 0.25, 0.32, -0.04);
  torso.add(plss, ops, strap, rcu, ...hoses, flagPatch);
  // helmet: neck ring, bubble, gold visor shell
  const head = new THREE.Group();
  head.position.y = 0.52;
  torso.add(head);
  head.add(part(new THREE.CylinderGeometry(0.16, 0.17, 0.06, 16), M.get('alu'), 0, -0.02, 0));
  head.add(part(new THREE.SphereGeometry(0.19, 20, 14), M.get('helmet'), 0, 0.15, 0));
  const visor = part(new THREE.SphereGeometry(0.2, 22, 14, Math.PI * 0.62, Math.PI * 0.76, Math.PI * 0.18, Math.PI * 0.55), M.get('visor'), 0, 0.15, 0);
  visor.rotation.y = Math.PI;
  head.add(visor);
  // arms
  const arms = [-1, 1].map((s) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(s * 0.32, 0.3, 0);
    torso.add(shoulder);
    const upper = limb(0.3, 0.085, 0.075, M.get('suit'), M.get('joint'));
    shoulder.add(upper);
    const elbow = new THREE.Group();
    elbow.position.y = -0.3;
    upper.add(elbow);
    const lower = limb(0.28, 0.072, 0.06, M.get('suit'), M.get('joint'));
    elbow.add(lower);
    const glove = part(new THREE.SphereGeometry(0.065, 10, 8), M.get('glove'), 0, -0.31, 0);
    glove.scale.set(1, 1.2, 0.8);
    lower.add(glove);
    upper.rotation.z = s * 0.18;
    return { shoulder: upper, elbow: lower, s };
  });
  // legs
  const legs = [-1, 1].map((s) => {
    const hip = new THREE.Group();
    hip.position.set(s * 0.12, 0.86, 0);
    body.add(hip);
    const thigh = limb(0.42, 0.11, 0.095, M.get('suit'), M.get('joint'));
    hip.add(thigh);
    const knee = new THREE.Group();
    knee.position.y = -0.42;
    thigh.add(knee);
    const shin = limb(0.4, 0.09, 0.08, M.get('suit'), M.get('joint'));
    knee.add(shin);
    const boot = part(new THREE.BoxGeometry(0.15, 0.1, 0.3), M.get('boot'), 0, -0.43, -0.05);
    const sole = part(new THREE.BoxGeometry(0.16, 0.035, 0.31), M.get('sole'), 0, -0.48, -0.05);
    shin.add(boot, sole);
    return { hip: thigh, knee: shin, s };
  });
  // pelvis / suit bottom
  body.add(part(new THREE.CapsuleGeometry(0.2, 0.12, 4, 12), M.get('suit'), 0, 0.92, 0));

  /** t: seconds (animation clock); gait.speed m/s, gait.hop 0..1 (bunny hop), crouch 0..1 (picking
   *  something up), reach 0..1 (right arm forward: planting, deploying). */
  function setPose(t, { speed = 0, hop = 0, crouch = 0, reach = 0 } = {}) {
    const walk = Math.min(1, speed / 1.2);
    const f = 1.7 + speed * 0.9; // stride frequency, Hz
    const ph = t * f * Math.PI * 2;
    // the 1/6 g lope: both legs together, a long float, a soft landing
    const lope = hop * Math.max(0, Math.sin(ph));
    body.position.y = lope * 0.32 + walk * (1 - hop) * Math.abs(Math.sin(ph)) * 0.05 - crouch * 0.38;
    body.rotation.x = -walk * 0.12 - crouch * 0.25;
    for (const L of legs) {
      const alt = (1 - hop) * Math.sin(ph + (L.s > 0 ? Math.PI : 0)) * 0.55 * walk;
      const together = hop * (Math.sin(ph) * 0.35 - 0.1);
      L.hip.rotation.x = alt + together - crouch * 0.9;
      L.knee.rotation.x = Math.max(0, -Math.sin(ph + (L.s > 0 ? Math.PI : 0)) * 0.7 * walk * (1 - hop)) + hop * 0.35 + crouch * 1.5 + 0.05;
    }
    for (const A of arms) {
      const swing = Math.sin(ph + (A.s > 0 ? 0 : Math.PI)) * 0.4 * walk * (1 - hop);
      const reachThis = A.s > 0 ? reach : 0;
      A.shoulder.rotation.x = swing - hop * 0.3 - reachThis * 1.2 - crouch * 0.7;
      A.elbow.rotation.x = -0.35 - walk * 0.25 - reachThis * 0.3;
    }
    head.rotation.x = crouch * 0.3;
  }
  setPose(0);
  return {
    root,
    setPose,
    dispose() {
      root.traverse((o) => o.geometry?.dispose?.());
    },
  };
}

/** The flag with its horizontal rod (the cloth hangs rippled, as it stayed on the airless Moon). */
export function createFlag() {
  const M = mats();
  const root = new THREE.Group();
  root.add(part(new THREE.CylinderGeometry(0.018, 0.018, 2.4, 8), M.get('alu'), 0, 1.2, 0));
  const rod = part(new THREE.CylinderGeometry(0.012, 0.012, 1.55, 6), M.get('alu'), 0.76, 2.36, 0);
  rod.rotation.z = Math.PI / 2;
  root.add(rod);
  const c = document.createElement('canvas');
  c.width = 380;
  c.height = 200;
  const g = c.getContext('2d');
  for (let i = 0; i < 13; i++) {
    g.fillStyle = i % 2 ? '#f4f2ee' : '#b8242b';
    g.fillRect(0, (i * 200) / 13, 380, 200 / 13 + 1);
  }
  g.fillStyle = '#26326e';
  g.fillRect(0, 0, 152, (7 * 200) / 13);
  g.fillStyle = '#f4f2ee';
  for (let r = 0; r < 9; r++) for (let k = 0; k < (r % 2 ? 5 : 6); k++) g.fillRect(8 + k * 25 + (r % 2 ? 12 : 0), 6 + r * 11.5, 4, 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const geo = new THREE.PlaneGeometry(1.5, 0.9, 24, 6);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    p.setZ(i, Math.sin(x * 7.5) * 0.035 * (0.4 + (x + 0.75) / 1.5));
  }
  geo.computeVertexNormals();
  const cloth = part(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, side: THREE.DoubleSide }), 0.76, 1.9, 0);
  root.add(cloth);
  return {
    root,
    dispose() {
      root.traverse((o) => {
        o.geometry?.dispose?.();
        if (o.material?.map === tex) o.material.dispose();
      });
      tex.dispose();
    },
  };
}

/** Passive Seismic Experiment: the gold sensor under its thermal skirt, two solar panel wings. */
export function createPSEP() {
  const M = mats();
  const root = new THREE.Group();
  root.add(part(new THREE.CylinderGeometry(0.28, 0.34, 0.35, 12), M.get('gold'), 0, 0.2, 0));
  root.add(part(new THREE.BoxGeometry(0.62, 0.08, 0.5), M.get('alu'), 0, 0.42, 0));
  for (const s of [-1, 1]) {
    const w = part(new THREE.BoxGeometry(0.9, 0.025, 0.55), M.get('panel'), s * 0.78, 0.48, 0);
    w.rotation.z = s * 0.06;
    root.add(w);
  }
  root.add(part(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 6), M.get('alu'), 0.1, 0.72, 0.1));
  return { root, dispose: () => root.traverse((o) => o.geometry?.dispose?.()) };
}

/** Laser Ranging Retro-Reflector: a tilted array of 100 fused-silica corner cubes (still in use). */
export function createLRRR() {
  const M = mats();
  const root = new THREE.Group();
  const panel = new THREE.Group();
  panel.position.y = 0.42;
  panel.rotation.x = -0.45;
  root.add(panel);
  panel.add(part(new THREE.BoxGeometry(0.46, 0.04, 0.46), M.get('alu'), 0, 0, 0));
  const cube = new THREE.CylinderGeometry(0.018, 0.018, 0.02, 6);
  for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) panel.add(part(cube, M.get('dark'), -0.2 + i * 0.044, 0.03, -0.2 + j * 0.044));
  root.add(part(new THREE.BoxGeometry(0.06, 0.4, 0.06), M.get('alu'), 0, 0.2, 0.1));
  return { root, dispose: () => root.traverse((o) => o.geometry?.dispose?.()) };
}

/** A glowing ring on the ground marking an EVA task. */
export function createMarker(color = 0xffb000) {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.7, 40), mat);
  ring.rotation.x = -Math.PI / 2;
  const root = new THREE.Group();
  root.add(ring);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 6, 1, true), mat);
  beam.position.y = 0.8;
  root.add(beam);
  return {
    root,
    setPulse(t) {
      mat.opacity = 0.45 + 0.4 * (0.5 + 0.5 * Math.sin(t * 4));
      ring.scale.setScalar(1 + 0.08 * Math.sin(t * 4));
    },
    dispose() {
      ring.geometry.dispose();
      beam.geometry.dispose();
      mat.dispose();
    },
  };
}
