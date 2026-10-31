// Low-poly 1969 flight controllers: short-sleeved white shirts, narrow ties, crew cuts, black
// horn-rimmed glasses, single-ear headsets with boom mics, swivel chairs. One merged body mesh and
// one head mesh (so the head can turn) per person, vertex-coloured, sharing two materials.
//
//   const npc = createController({ seed, standing, pose, vest });  scene.add(npc.root)
//   npc.update(dt, { lookAt: Vector3|null, talking: bool })

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const D = Math.PI / 180;

const SKIN = ['#e8c4a6', '#dcb393', '#f0cfb4', '#c99a76', '#a87a58', '#e2bb98'];
const HAIR = ['#2a1d14', '#1b1715', '#4a3424', '#6d5a48', '#8f8a84', '#3a2a1e', '#b49a6a'];
const SHIRT = ['#f4f2ec', '#f1efe9', '#eef0f2', '#dfe7ee', '#f6f3ea', '#e9e3d4'];
const TIE = ['#1d2433', '#3a1a1a', '#202020', '#2d3a2a', '#4a3a22', '#25324a', '#5a2424'];
const TROUSERS = ['#2e2f33', '#3a352e', '#26292e', '#45413a', '#30343a'];

function rng(seed) {
  let s = (seed * 2654435761) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _sc = new THREE.Vector3();

class Parts {
  constructor() {
    this.list = [];
  }

  add(geo, color, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (geo.index) geo.dispose();
    const m = new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _sc.set(sx, sy, sz));
    g.applyMatrix4(m);
    const c = new THREE.Color(color);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    g.deleteAttribute('uv');
    this.list.push(g);
  }

  /** Capsule between two points. */
  limb(r, a, b, color) {
    const ax = new THREE.Vector3(...a);
    const bx = new THREE.Vector3(...b);
    const dir = bx.clone().sub(ax);
    const len = dir.length();
    const geo = new THREE.CapsuleGeometry(r, Math.max(0.001, len), 3, 8);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    const mid = ax.clone().add(bx).multiplyScalar(0.5);
    const g = geo.toNonIndexed();
    geo.dispose();
    g.applyMatrix4(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)));
    const c = new THREE.Color(color);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    g.deleteAttribute('uv');
    this.list.push(g);
  }

  merge() {
    const g = mergeGeometries(this.list, false);
    for (const p of this.list) p.dispose();
    this.list = [];
    g.computeVertexNormals();
    return g;
  }
}

let _bodyMat = null;
let _headMat = null;
function materials() {
  _bodyMat ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
  _headMat ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0 });
  return { body: _bodyMat, head: _headMat };
}

/**
 * @param {{ seed?: number, standing?: boolean, pose?: 'desk'|'chin'|'back'|'phone', vest?: boolean,
 *   glasses?: boolean, chair?: boolean }} o
 * Local frame: the person faces −Z; seated hips at z ≈ +0.55 from the desk edge (z = 0), y = floor.
 */
export function createController(o = {}) {
  const r = rng(o.seed ?? 1);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const skin = pick(SKIN);
  const hair = pick(HAIR);
  const shirt = o.vest ? '#f2f0ea' : pick(SHIRT);
  const tie = pick(TIE);
  const trousers = pick(TROUSERS);
  const pose = o.pose ?? (r() < 0.55 ? 'desk' : r() < 0.5 ? 'chin' : r() < 0.6 ? 'back' : 'phone');
  const standing = !!o.standing;
  const glasses = o.glasses ?? r() < 0.45;
  const longSleeves = r() < 0.35;
  const body = new Parts();
  const lean = standing ? 0 : pose === 'back' ? 8 * D : -12 * D; // + leans back
  const hipY = standing ? 0.95 : 0.53;
  const hipZ = standing ? 0.45 : 0.56;

  // ---- chair
  if (!standing && o.chair !== false) {
    const up = r() < 0.5 ? '#2a2d32' : r() < 0.5 ? '#3b2b26' : '#2b3a33';
    body.add(new THREE.BoxGeometry(0.48, 0.07, 0.46), up, 0, 0.46, 0.58);
    body.add(new THREE.BoxGeometry(0.44, 0.5, 0.07), up, 0, 0.8, 0.86, 10 * D);
    body.add(new THREE.CylinderGeometry(0.022, 0.022, 0.34, 8), '#5d6266', 0, 0.26, 0.6);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      body.add(new THREE.BoxGeometry(0.03, 0.03, 0.28), '#1c1e20', Math.sin(a) * 0.13, 0.06, 0.6 + Math.cos(a) * 0.13, 0, a);
      body.add(new THREE.SphereGeometry(0.025, 6, 4), '#111111', Math.sin(a) * 0.26, 0.025, 0.6 + Math.cos(a) * 0.26);
    }
  }

  // ---- legs
  for (const s of [-1, 1]) {
    const hx = s * 0.1;
    if (standing) {
      body.limb(0.068, [hx, hipY, hipZ], [hx, 0.5, hipZ], trousers);
      body.limb(0.058, [hx, 0.5, hipZ], [hx, 0.09, hipZ + 0.01], trousers);
      body.add(new THREE.BoxGeometry(0.1, 0.07, 0.25), '#121212', hx, 0.035, hipZ - 0.06);
    } else {
      const kz = 0.14 + (pose === 'back' ? -0.05 : 0);
      body.limb(0.07, [hx, hipY, hipZ], [hx * 1.15, hipY + 0.02, kz], trousers);
      body.limb(0.058, [hx * 1.15, hipY + 0.02, kz], [hx * 1.2, 0.1, kz + 0.06], trousers);
      body.add(new THREE.BoxGeometry(0.1, 0.07, 0.25), '#121212', hx * 1.2, 0.035, kz - 0.02);
    }
  }

  // ---- torso (white shirt), leaning
  const torsoLen = 0.3;
  const tc = new THREE.Vector3(0, hipY + 0.31, hipZ).add(new THREE.Vector3(0, 0, -Math.sin(-lean) * 0.0));
  const torsoTop = new THREE.Vector3(0, hipY + 0.55, hipZ - Math.sin(-lean) * 0.5);
  body.add(new THREE.CapsuleGeometry(0.155, torsoLen, 4, 10), shirt, 0, tc.y, (hipZ + torsoTop.z) / 2, lean, 0, 0, 1.3, 1, 0.82);
  // belt
  body.add(new THREE.CylinderGeometry(0.17, 0.17, 0.05, 12), '#1a1612', 0, hipY + 0.07, hipZ, lean * 0.5, 0, 0, 1.18, 1, 0.8);
  // tie
  body.add(new THREE.BoxGeometry(0.06, 0.32, 0.015), tie, 0, hipY + 0.36, (hipZ + torsoTop.z) / 2 - 0.13, lean);
  body.add(new THREE.BoxGeometry(0.045, 0.045, 0.02), tie, 0, hipY + 0.52, torsoTop.z - 0.115, lean);
  // collar
  body.add(new THREE.CylinderGeometry(0.07, 0.085, 0.05, 10), shirt, 0, hipY + 0.6, torsoTop.z - 0.01, lean);
  // neck
  body.add(new THREE.CylinderGeometry(0.048, 0.052, 0.09, 10), skin, 0, hipY + 0.64, torsoTop.z - 0.01, lean);

  // ---- arms
  const sh = (s) => [s * 0.205, hipY + 0.5, torsoTop.z + 0.02];
  const sleeve = longSleeves ? shirt : skin;
  for (const s of [-1, 1]) {
    const S = sh(s);
    let elbow;
    let hand;
    if (standing) {
      elbow = [s * 0.25, hipY + 0.22, S[2] + 0.02];
      hand = [s * 0.27, hipY - 0.02, S[2] - 0.05];
    } else if ((pose === 'chin' && s === 1) || (pose === 'phone' && s === -1)) {
      elbow = [s * 0.2, 0.79, 0.12];
      hand = pose === 'phone' ? [s * 0.13, hipY + 0.66, torsoTop.z - 0.08] : [s * 0.06, hipY + 0.6, torsoTop.z - 0.12];
    } else if (pose === 'back') {
      elbow = [s * 0.27, hipY + 0.26, S[2] + 0.06];
      hand = [s * 0.16, hipY + 0.16, hipZ - 0.2];
    } else {
      elbow = [s * 0.25, 0.8, 0.34];
      hand = [s * 0.17, 0.78, 0.07];
    }
    body.limb(0.05, S, elbow, shirt);
    body.limb(0.042, elbow, hand, sleeve);
    body.add(new THREE.SphereGeometry(0.045, 8, 6), skin, hand[0], hand[1], hand[2], 0, 0, 0, 0.9, 0.7, 1.2);
    if (pose === 'phone' && s === -1 && !standing) {
      // handset at the ear
      body.limb(0.024, [hand[0] - 0.02, hand[1] + 0.08, hand[2]], [hand[0] + 0.02, hand[1] - 0.1, hand[2] - 0.03], '#151515');
    }
  }

  const bodyGeo = body.merge();

  // ---- head (pivot at the top of the neck)
  const head = new Parts();
  head.add(new THREE.SphereGeometry(0.1, 14, 10), skin, 0, 0.1, 0, 0, 0, 0, 0.9, 1.12, 1.02);
  head.add(new THREE.SphereGeometry(0.104, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.52), hair, 0, 0.125, 0.008, -0.25, 0, 0, 0.94, 1.06, 1.04);
  // nose and ears
  head.add(new THREE.ConeGeometry(0.018, 0.04, 6), skin, 0, 0.09, -0.1, -Math.PI / 2);
  for (const s of [-1, 1]) head.add(new THREE.SphereGeometry(0.022, 6, 5), skin, s * 0.092, 0.1, 0.005, 0, 0, 0, 0.5, 1, 0.8);
  // headset: band, earpiece on the right ear, boom mic
  head.add(new THREE.TorusGeometry(0.108, 0.0065, 5, 18, Math.PI), '#1b1b1b', 0, 0.115, 0.01);
  head.add(new THREE.CylinderGeometry(0.036, 0.036, 0.028, 12), '#202020', 0.104, 0.1, 0.005, 0, 0, Math.PI / 2);
  head.add(new THREE.CylinderGeometry(0.005, 0.005, 0.13, 5), '#2a2a2a', 0.075, 0.065, -0.06, Math.PI / 2 - 0.5, 0.6, 0);
  head.add(new THREE.SphereGeometry(0.012, 6, 5), '#111111', 0.035, 0.035, -0.11);
  if (glasses) {
    head.add(new THREE.BoxGeometry(0.17, 0.035, 0.012), '#0e0e0e', 0, 0.115, -0.094);
    head.add(new THREE.BoxGeometry(0.008, 0.012, 0.1), '#0e0e0e', 0.085, 0.12, -0.045);
    head.add(new THREE.BoxGeometry(0.008, 0.012, 0.1), '#0e0e0e', -0.085, 0.12, -0.045);
  }
  const headGeo = head.merge();

  const mats = materials();
  const root = new THREE.Group();
  const bodyMesh = new THREE.Mesh(bodyGeo, mats.body);
  root.add(bodyMesh);
  const headPivot = new THREE.Group();
  headPivot.position.set(0, hipY + 0.68, torsoTop.z - 0.02);
  const headMesh = new THREE.Mesh(headGeo, mats.head);
  headPivot.add(headMesh);
  root.add(headPivot);

  // ---- idle animation state
  const st = {
    t: r() * 100,
    yaw: 0,
    pitch: pose === 'back' ? -0.1 : 0.12,
    tYaw: 0,
    tPitch: 0.1,
    next: r() * 3,
    nod: 0,
  };
  const baseY = root.position.y;
  void baseY;
  const _v = new THREE.Vector3();
  const _m = new THREE.Matrix4();

  return {
    root,
    head: headPivot,
    pose,
    update(dt, { lookAt = null, talking = false } = {}) {
      st.t += dt;
      st.next -= dt;
      if (lookAt) {
        // turn the head toward a world point (limited)
        headPivot.updateWorldMatrix(true, false);
        _m.copy(root.matrixWorld).invert();
        _v.copy(lookAt).applyMatrix4(_m).sub(headPivot.position);
        st.tYaw = Math.max(-1.1, Math.min(1.1, Math.atan2(-_v.x, -_v.z)));
        st.tPitch = Math.max(-0.5, Math.min(0.6, Math.atan2(_v.y, Math.hypot(_v.x, _v.z))));
      } else if (st.next <= 0) {
        st.next = 2 + r() * 6;
        const k = r();
        // mostly the CRTs in front (slightly down), sometimes the big screens, sometimes a neighbour
        if (k < 0.55) {
          st.tYaw = (r() - 0.5) * 0.7;
          st.tPitch = 0.1 + r() * 0.15;
        } else if (k < 0.8) {
          st.tYaw = (r() - 0.5) * 0.4;
          st.tPitch = -0.28 - r() * 0.12;
        } else {
          st.tYaw = (r() < 0.5 ? -1 : 1) * (0.6 + r() * 0.4);
          st.tPitch = 0.05;
        }
      }
      const k = Math.min(1, dt * 2.2);
      st.yaw += (st.tYaw - st.yaw) * k;
      st.pitch += (st.tPitch - st.pitch) * k;
      st.nod = talking ? Math.sin(st.t * 9) * 0.035 + Math.sin(st.t * 3.1) * 0.02 : st.nod * 0.9;
      headPivot.rotation.set(-st.pitch + st.nod, st.yaw, Math.sin(st.t * 0.37) * 0.03, 'YXZ');
      // breathing
      bodyMesh.scale.y = 1 + Math.sin(st.t * 1.6) * 0.004;
    },
    dispose() {
      bodyGeo.dispose();
      headGeo.dispose();
    },
  };
}
