// Procedural models of the Apollo hardware. Model space = body axes (metres):
// Saturn V / CSM: +X toward the nose. LM: +X up, +Z forward. Origins = module datums
// (geometry.js); buildConfigModel() assembles a configuration around its reference point.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GEOM, STACK, CONFIGS, moduleTransform } from '../../sim/geometry.js';

const R = GEOM.saturnV.diameter / 2;
const RS4 = GEOM.saturnV.sivbDiameter / 2;

// ------------------------------------------------------------------ textures

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** S-IC skin: white with the black roll-pattern panels, USA + flag. u wraps around, v along length. */
function sicTexture() {
  return canvasTex(1024, 1024, (g, w, h) => {
    g.fillStyle = '#f2f1ec';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#111';
    // lower black band (thrust structure) + four black corrugated sectors at the intertank
    g.fillRect(0, h * 0.86, w, h * 0.14);
    for (let i = 0; i < 4; i++) g.fillRect((i * w) / 4, h * 0.38, w / 8, h * 0.1);
    for (let i = 0; i < 4; i++) g.fillRect((i * w) / 4 + w / 8, h * 0.0, w / 8, h * 0.06);
    // corrugation lines
    g.strokeStyle = 'rgba(0,0,0,0.08)';
    for (let x = 0; x < w; x += 8) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, h);
      g.stroke();
    }
    // USA vertical letters + flag (on two opposite sides)
    for (const cx of [w * 0.06, w * 0.56]) {
      g.fillStyle = '#111';
      g.font = 'bold 56px Arial';
      g.textAlign = 'center';
      ['U', 'S', 'A'].forEach((ch, i) => g.fillText(ch, cx, h * 0.55 + i * 60));
      drawFlag(g, cx - 40, h * 0.12, 80, 52);
      g.save();
      g.translate(cx + 70, h * 0.62);
      g.rotate(-Math.PI / 2);
      g.font = 'bold 34px Arial';
      g.fillText('UNITED STATES', 0, 0);
      g.restore();
    }
  });
}

function drawFlag(g, x, y, w, h) {
  for (let i = 0; i < 13; i++) {
    g.fillStyle = i % 2 ? '#fff' : '#b22234';
    g.fillRect(x, y + (i * h) / 13, w, h / 13 + 0.5);
  }
  g.fillStyle = '#3c3b6e';
  g.fillRect(x, y, w * 0.4, h * 0.54);
}

function siiTexture() {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#f0efea';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#121212';
    g.fillRect(0, h * 0.9, w, h * 0.1);
    g.fillRect(0, 0, w, h * 0.05);
    g.font = 'bold 40px Arial';
    g.textAlign = 'center';
    for (const cx of [w * 0.1, w * 0.6]) ['U', 'S', 'A'].forEach((ch, i) => g.fillText(ch, cx, h * 0.35 + i * 46));
  });
}

function sivbTexture() {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#f0efea';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#121212';
    // aft skirt black with checker quadrants
    g.fillRect(0, h * 0.78, w, h * 0.22);
    for (let i = 0; i < 4; i++) g.fillRect((i * w) / 4, h * 0.55, w / 8, h * 0.23);
  });
}

function kaptonTexture() {
  return canvasTex(512, 512, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, w, h);
    grd.addColorStop(0, '#c8901e');
    grd.addColorStop(0.5, '#f0c050');
    grd.addColorStop(1, '#a87010');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      g.strokeStyle = `rgba(${Math.random() < 0.5 ? '255,240,180' : '90,50,0'},${0.15 + Math.random() * 0.25})`;
      g.lineWidth = 1 + Math.random() * 3;
      g.beginPath();
      const x = Math.random() * w;
      const y = Math.random() * h;
      g.moveTo(x, y);
      g.lineTo(x + (Math.random() - 0.5) * 60, y + (Math.random() - 0.5) * 60);
      g.stroke();
    }
  });
}

const MAT = {};
function mats() {
  if (MAT.ready) return MAT;
  MAT.ready = true;
  MAT.sic = new THREE.MeshStandardMaterial({ map: sicTexture(), roughness: 0.55, metalness: 0.05 });
  MAT.sii = new THREE.MeshStandardMaterial({ map: siiTexture(), roughness: 0.55, metalness: 0.05 });
  MAT.sivb = new THREE.MeshStandardMaterial({ map: sivbTexture(), roughness: 0.55, metalness: 0.05 });
  MAT.white = new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.6 });
  MAT.black = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.7 });
  MAT.engine = new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.45, metalness: 0.7, side: THREE.DoubleSide });
  MAT.nozzleIn = new THREE.MeshStandardMaterial({ color: 0x3b2a22, roughness: 0.8, metalness: 0.3, side: THREE.BackSide });
  MAT.alu = new THREE.MeshStandardMaterial({ color: 0xd8dade, roughness: 0.3, metalness: 0.85 });
  MAT.silver = new THREE.MeshStandardMaterial({ color: 0xe6e8ec, roughness: 0.18, metalness: 1.0 });
  MAT.red = new THREE.MeshStandardMaterial({ color: 0xb8361f, roughness: 0.6 });
  MAT.les = new THREE.MeshStandardMaterial({ color: 0xc0431c, roughness: 0.55, metalness: 0.2 });
  MAT.kapton = new THREE.MeshStandardMaterial({ map: kaptonTexture(), roughness: 0.35, metalness: 0.6 });
  MAT.lmGrey = new THREE.MeshStandardMaterial({ color: 0x8c8f93, roughness: 0.55, metalness: 0.3 });
  MAT.lmDark = new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.6, metalness: 0.3 });
  MAT.window = new THREE.MeshStandardMaterial({ color: 0x0a1018, roughness: 0.05, metalness: 0.9 });
  MAT.heat = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.9 });
  return MAT;
}

// ------------------------------------------------------------------ helpers (geometry along +X)

/** Lathe a profile [[x, radius], ...] around +X. */
function latheX(profile, segs = 40) {
  const pts = profile.map(([x, r]) => new THREE.Vector2(Math.max(r, 0.0001), x));
  const g = new THREE.LatheGeometry(pts, segs);
  g.rotateZ(-Math.PI / 2); // lathe axis Y → X
  // after rotateZ(-90°): +Y → +X. Fix UV direction so v runs along x.
  return g;
}

function cylX(r0, r1, x0, x1, segs = 40, open = false) {
  const g = new THREE.CylinderGeometry(r1, r0, x1 - x0, segs, 1, open);
  g.rotateZ(-Math.PI / 2);
  g.translate((x0 + x1) / 2, 0, 0);
  return g;
}

function bell(exitR, throatR, len, segs = 28) {
  const prof = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    prof.push([-t * len, throatR + (exitR - throatR) * Math.pow(t, 0.7)]);
  }
  const outer = latheX(prof, segs);
  const g = new THREE.Group();
  g.add(new THREE.Mesh(outer, mats().engine));
  const inner = new THREE.Mesh(latheX(prof.map(([x, r]) => [x, r * 0.97]), segs), mats().nozzleIn);
  g.add(inner);
  return g;
}

function nozzleAnchor(parent, x, y, z) {
  const o = new THREE.Object3D();
  o.position.set(x, y, z);
  parent.add(o);
  return o;
}

// ------------------------------------------------------------------ Saturn V

export function createSaturnV() {
  const m = mats();
  const root = new THREE.Group();
  const parts = {};
  const nozzles = { sic: [], sii: [], sivb: [], les: [] };

  // S-IC
  const sic = new THREE.Group();
  sic.add(new THREE.Mesh(cylX(R, R, 5.8, STACK.sicTop, 48), m.sic));
  sic.add(new THREE.Mesh(cylX(R * 1.0, R, 4.6, 5.8, 48), m.black));
  const fairGeo = [];
  const finGeo = [];
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const cy = Math.cos(a) * R * 0.98;
    const cz = Math.sin(a) * R * 0.98;
    const f = cylX(1.1, 1.5, 0.6, 9.5, 16);
    f.translate(0, cy, cz);
    fairGeo.push(f);
    const fin = new THREE.BoxGeometry(5.2, 0.25, 3.4);
    fin.translate(2.8, 0, R + 2.2);
    fin.applyMatrix4(new THREE.Matrix4().makeRotationX(a - Math.PI / 2));
    finGeo.push(fin);
  }
  sic.add(new THREE.Mesh(mergeGeometries(fairGeo), m.black));
  sic.add(new THREE.Mesh(mergeGeometries(finGeo), m.black));
  const eng = [[0, 0], ...[0, 1, 2, 3].map((i) => {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    return [Math.cos(a) * 3.56, Math.sin(a) * 3.56];
  })];
  for (const [y, z] of eng) {
    const b = bell(1.88, 0.55, 5.6);
    b.position.set(5.8, y, z);
    sic.add(b);
    nozzles.sic.push(nozzleAnchor(sic, 0.2, y, z));
  }
  parts.sic = sic;

  // S-II (datum = interstage bottom)
  const sii = new THREE.Group();
  const interstage = new THREE.Mesh(cylX(R, R, 0, STACK.interstageTop - STACK.siiDatum, 48), m.white);
  sii.add(interstage);
  parts.interstage = interstage;
  sii.add(new THREE.Mesh(cylX(R, R, STACK.interstageTop - STACK.siiDatum, STACK.siiTop - STACK.siiDatum, 48), m.sii));
  for (const [y, z] of eng.map(([a, b]) => [a * 0.74, b * 0.74])) {
    const b = bell(0.98, 0.3, 3.2);
    b.position.set(STACK.interstageTop - STACK.siiDatum + 0.2, y, z);
    sii.add(b);
    nozzles.sii.push(nozzleAnchor(sii, STACK.interstageTop - STACK.siiDatum - 3.0, y, z));
  }
  parts.sii = sii;

  // S-IVB (+ tapered interstage, IU) — datum = J-2 exit plane
  const sivb = new THREE.Group();
  const s4len = STACK.sivbTop - STACK.sivbDatum;
  const taper = new THREE.Mesh(cylX(R, RS4, STACK.siiTop - STACK.sivbDatum, STACK.siiTop - STACK.sivbDatum + 5.7, 48), m.white);
  sivb.add(taper);
  parts.sivbInterstage = taper;
  sivb.add(new THREE.Mesh(cylX(RS4, RS4, 3.4, s4len, 40), m.sivb));
  sivb.add(new THREE.Mesh(cylX(RS4, RS4, s4len, s4len + 0.9, 40), m.alu)); // IU
  const j2 = bell(1.0, 0.3, 3.3);
  j2.position.set(3.4, 0, 0);
  sivb.add(j2);
  nozzles.sivb.push(nozzleAnchor(sivb, 0.1, 0, 0));
  parts.sivb = sivb;

  // SLA (cone 6.6 → 3.91)
  const sla = new THREE.Group();
  const slaMesh = new THREE.Mesh(cylX(RS4, GEOM.csm.smRadius, 0, STACK.slaTop - STACK.slaDatum, 40), m.alu);
  sla.add(slaMesh);
  parts.sla = sla;

  // CSM + LES/BPC
  const csmModel = createCSM();
  parts.csm = csmModel.root;
  const les = createLES();
  parts.les = les;

  root.add(sic, sii, sivb, sla, csmModel.root, les);
  sic.position.x = STACK.sicBase;
  sii.position.x = STACK.siiDatum;
  sivb.position.x = STACK.sivbDatum;
  sla.position.x = STACK.slaDatum;
  csmModel.root.position.x = STACK.csmDatum;
  les.position.x = STACK.csmDatum;
  return { root, parts, nozzles };
}

function createLES() {
  const m = mats();
  const g = new THREE.Group();
  // BPC over the CM
  g.add(new THREE.Mesh(latheX([[0, 2.0], [3.3, 0.45], [3.6, 0.3]], 32), m.white));
  // tower lattice (4 legs + braces)
  const legs = [];
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const l = new THREE.CylinderGeometry(0.07, 0.07, 3.3, 6);
    const p0 = new THREE.Vector3(3.4, Math.cos(a) * 0.6, Math.sin(a) * 0.6);
    const p1 = new THREE.Vector3(6.6, Math.cos(a) * 0.4, Math.sin(a) * 0.4);
    const mid = p0.clone().add(p1).multiplyScalar(0.5);
    const dir = p1.clone().sub(p0).normalize();
    l.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
    l.translate(mid.x, mid.y, mid.z);
    legs.push(l);
  }
  for (let k = 0; k < 5; k++) {
    const x = 3.6 + k * 0.6;
    const ring = new THREE.TorusGeometry(0.55 - k * 0.03, 0.04, 4, 4);
    ring.rotateY(Math.PI / 2);
    ring.rotateX(Math.PI / 4);
    ring.translate(x, 0, 0);
    legs.push(ring);
  }
  g.add(new THREE.Mesh(mergeGeometries(legs), m.les));
  // motor + nose + Q-ball
  g.add(new THREE.Mesh(cylX(0.33, 0.33, 6.6, 10.0, 20), m.white));
  g.add(new THREE.Mesh(latheX([[10.0, 0.33], [10.8, 0.2], [11.3, 0.05]], 20), m.black));
  return g;
}

// ------------------------------------------------------------------ CSM

export function createCSM({ damaged = false } = {}) {
  const m = mats();
  const root = new THREE.Group();
  const cm = new THREE.Group();
  const H = GEOM.csm.cmHeight;
  const Rb = GEOM.csm.cmBaseRadius;
  cm.add(new THREE.Mesh(latheX([[0.0, Rb * 0.98], [0.12, Rb], [H * 0.86, 0.55], [H, 0.42], [H + 0.25, 0.42]], 48), m.silver));
  cm.add(new THREE.Mesh(latheX([[-0.25, 0.1], [-0.1, Rb * 0.9], [0.0, Rb * 0.98]], 48), m.heat));
  // windows
  for (const [a, x] of [[-0.6, 1.9], [0.6, 1.9], [-1.4, 1.2], [1.4, 1.2], [0, 1.25]]) {
    const w = new THREE.Mesh(new THREE.CircleGeometry(0.15, 12), m.window);
    const r = Rb - (x / H) * (Rb - 0.55) + 0.02;
    w.position.set(x, Math.sin(a) * r, -Math.cos(a) * r);
    w.lookAt(w.position.clone().multiplyScalar(2).setX(x + 0.6));
    cm.add(w);
  }
  // probe
  const probe = new THREE.Mesh(cylX(0.05, 0.02, H + 0.25, GEOM.csm.probeTipX, 8), m.alu);
  cm.add(probe);
  root.add(cm);

  const sm = new THREE.Group();
  const L = GEOM.csm.smLength;
  sm.add(new THREE.Mesh(cylX(Rb, Rb, -L, 0, 48, false), m.alu));
  // radiator stripes
  const stripes = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const b = new THREE.BoxGeometry(L * 0.7, 0.02, 0.35);
    b.translate(-L * 0.45, 0, 0);
    b.translate(0, 0, Rb + 0.01);
    b.applyMatrix4(new THREE.Matrix4().makeRotationX(a));
    stripes.push(b);
  }
  sm.add(new THREE.Mesh(mergeGeometries(stripes), m.white));
  // RCS quads
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + 0.13;
    const q = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.35, 0.5), m.white);
    q.position.set(GEOM.csm.rcsQuadX, Math.cos(a) * (Rb + 0.2), Math.sin(a) * (Rb + 0.2));
    q.rotation.x = a;
    sm.add(q);
  }
  const sps = bell(GEOM.csm.spsExitRadius, 0.35, GEOM.csm.spsNozzleLength);
  sps.position.x = -L;
  sm.add(sps);
  // HGA
  const hga = new THREE.Group();
  hga.add(new THREE.Mesh(cylX(0.05, 0.05, 0, 1.4, 6), m.alu));
  for (const [y, z] of [[0.35, 0.35], [-0.35, 0.35], [0.35, -0.35], [-0.35, -0.35]]) {
    const d = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 6, 0, Math.PI * 2, 0, 0.9), m.silver);
    d.position.set(-1.4, y, z);
    d.rotation.z = Math.PI / 2;
    hga.add(d);
  }
  hga.position.set(-L, 0, -Rb);
  hga.rotation.y = 0.6;
  sm.add(hga);
  if (damaged) {
    const hole = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.2, 1.4), m.black);
    hole.position.set(-1.9, 0, Rb - 0.05);
    sm.add(hole);
    const shreds = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.05, 1.6), new THREE.MeshStandardMaterial({ color: 0x8a6a40, roughness: 0.9 }));
    shreds.position.set(-1.9, 0, Rb - 0.2);
    sm.add(shreds);
  }
  root.add(sm);
  return { root, parts: { cm, sm, probe }, nozzles: { sps: [nozzleAnchor(sm, -L - GEOM.csm.spsNozzleLength, 0, 0)] } };
}

// ------------------------------------------------------------------ LM (datum = footpad plane, +X up, +Z forward)

export function createLM({ stowed = false, ascentOnly = false } = {}) {
  const m = mats();
  const root = new THREE.Group();
  const parts = {};
  if (!ascentOnly) {
    const ds = new THREE.Group();
    const h0 = GEOM.lm.descStageBottomX;
    const h1 = GEOM.lm.descStageTopX;
    const oct = new THREE.CylinderGeometry(2.1, 2.1, h1 - h0, 8);
    oct.rotateY(Math.PI / 8);
    oct.translate(0, (h0 + h1) / 2, 0);
    oct.rotateZ(-Math.PI / 2);
    ds.add(new THREE.Mesh(oct, m.kapton));
    const dps = bell(0.75, 0.25, 1.2);
    dps.position.x = h0 + 0.1;
    ds.add(dps);
    const legGeo = [];
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      const dir = new THREE.Vector3(0, Math.sin(a), Math.cos(a));
      const foot = stowed ? dir.clone().multiplyScalar(2.3).setX(h0 + 0.2) : dir.clone().multiplyScalar(GEOM.lm.footpadCircleRadius).setX(0.12);
      const top = dir.clone().multiplyScalar(2.0).setX(h1 - 0.2);
      for (const p of [top, dir.clone().multiplyScalar(2.1).setX(h0 + 0.2)]) {
        const len = p.distanceTo(foot);
        const c = new THREE.CylinderGeometry(0.06, 0.06, len, 6);
        c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), p.clone().sub(foot).normalize()));
        const mid = p.clone().add(foot).multiplyScalar(0.5);
        c.translate(mid.x, mid.y, mid.z);
        legGeo.push(c);
      }
      const pad = new THREE.CylinderGeometry(0.47, 0.4, 0.15, 14);
      pad.rotateZ(-Math.PI / 2);
      pad.translate(foot.x, foot.y, foot.z);
      legGeo.push(pad);
      if (!stowed && i !== 0) {
        const pr = new THREE.CylinderGeometry(0.015, 0.015, GEOM.lm.probeLength, 4);
        pr.rotateZ(-Math.PI / 2);
        pr.translate(foot.x - GEOM.lm.probeLength / 2, foot.y, foot.z);
        legGeo.push(pr);
      }
    }
    ds.add(new THREE.Mesh(mergeGeometries(legGeo), m.kapton));
    // ladder on +Z leg
    const ladder = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 0.05), m.alu);
    ladder.position.set(1.4, 0, 3.4);
    ladder.rotation.y = 0.0;
    if (!stowed) ds.add(ladder);
    parts.descent = ds;
    root.add(ds);
  }
  const as = new THREE.Group();
  const b = GEOM.lm.ascStageBaseX;
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 3.2, 2.6), m.lmGrey);
  body.position.set(b + 1.2, 0, 0.1);
  as.add(body);
  const cabin = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 2.3, 10), m.lmGrey);
  cabin.rotation.z = Math.PI / 2;
  cabin.position.set(b + 1.6, 0, 0.6);
  as.add(cabin);
  const front = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.2, 0.6), m.lmDark);
  front.position.set(b + 1.9, 0, 1.55);
  as.add(front);
  for (const y of [-0.5, 0.5]) {
    const w = new THREE.Mesh(new THREE.CircleGeometry(0.32, 3), m.window);
    w.position.set(b + 2.2, y, 1.86);
    w.rotation.z = y < 0 ? Math.PI / 2 : -Math.PI / 2;
    as.add(w);
  }
  const blanket = new THREE.Mesh(new THREE.BoxGeometry(1.4, 3.6, 1.2), m.kapton);
  blanket.position.set(b + 0.7, 0, -1.2);
  as.add(blanket);
  as.add(Object.assign(new THREE.Mesh(cylX(0.45, 0.45, b + 2.4, GEOM.lm.dockRingX, 16), m.lmDark)));
  const rr = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 6, 0, Math.PI * 2, 0, 1.1), m.silver);
  rr.position.set(b + 2.8, -0.9, 1.3);
  rr.rotation.x = Math.PI / 2;
  as.add(rr);
  for (const [y, z] of [[1.6, 1.3], [-1.6, 1.3], [1.6, -1.1], [-1.6, -1.1]]) {
    const q = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), m.lmDark);
    q.position.set(b + 2.0, y, z);
    as.add(q);
  }
  parts.ascent = as;
  root.add(as);
  return { root, parts, nozzles: { dps: [nozzleAnchor(root, GEOM.lm.descStageBottomX - 1.1, 0, 0)], aps: [nozzleAnchor(root, GEOM.lm.apsExitX, 0, 0)] } };
}

// ------------------------------------------------------------------ assembly

/** Builds the model of a configuration (origin = config reference point). */
export function buildConfigModel(config, parts = {}) {
  const root = new THREE.Group();
  const nozzles = { main: [], sps: [], dps: [], aps: [] };
  const mods = CONFIGS[config].modules;
  const place = (obj, module) => {
    const t = moduleTransform(config, module);
    obj.position.copy(t.offset);
    obj.quaternion.copy(t.quat);
    root.add(obj);
  };
  if (mods.includes('SIC') || mods.includes('SII') || mods.includes('SIVB')) {
    const sv = createSaturnV();
    const { parts: p } = sv;
    const t = moduleTransform(config, mods.includes('SIC') ? 'SIC' : mods.includes('SII') ? 'SII' : 'SIVB');
    const datumStation = mods.includes('SIC') ? STACK.sicBase : mods.includes('SII') ? STACK.siiDatum : STACK.sivbDatum;
    sv.root.position.copy(t.offset).add(new THREE.Vector3(-datumStation, 0, 0));
    root.add(sv.root);
    p.sic.visible = mods.includes('SIC');
    p.sii.visible = mods.includes('SII');
    p.interstage.visible = parts.interstage !== false;
    p.les.visible = mods.includes('LES') && parts.les !== false;
    p.csm.visible = mods.includes('CSM');
    p.sivbInterstage.visible = mods.includes('SII');
    if (!mods.includes('SLA')) p.sla.visible = mods.includes('SLA_BASE');
    if (mods.includes('SIC')) nozzles.main = sv.nozzles.sic;
    else if (mods.includes('SII')) nozzles.main = sv.nozzles.sii;
    else nozzles.main = sv.nozzles.sivb;
    if (mods.includes('LM_STOWED') && !mods.includes('SLA')) place(createLM({ stowed: true }).root, 'LM_STOWED');
    if (mods.includes('CSM_DOCKED_TOP')) place(createCSM().root, 'CSM_DOCKED_TOP');
    return { root, nozzles };
  }
  for (const mod of mods) {
    if (mod === 'CSM' || mod === 'CM' || mod === 'SM') {
      const c = createCSM({ damaged: !!parts.smDamaged });
      if (mod === 'CM') c.parts.sm.visible = false;
      if (mod === 'SM') c.parts.cm.visible = false;
      place(c.root, mod);
      nozzles.sps.push(...c.nozzles.sps);
    } else if (mod.startsWith('LM')) {
      const l = createLM({ stowed: !parts.lmGearDeployed && mod !== 'LM' && mod !== 'LM_ASC', ascentOnly: mod.includes('ASC') });
      place(l.root, mod);
      nozzles.dps.push(...l.nozzles.dps);
      nozzles.aps.push(...l.nozzles.aps);
    }
  }
  return { root, nozzles };
}

/** Mobile launcher + umbilical tower (local frame: +Y up, pad deck at y=0, rocket axis at origin). */
export function createLaunchTower() {
  const m = mats();
  const g = new THREE.Group();
  const deck = new THREE.Mesh(new THREE.BoxGeometry(48, 7.6, 41), new THREE.MeshStandardMaterial({ color: 0x6d6d68, roughness: 0.9 }));
  deck.position.set(0, -3.8, 0);
  g.add(deck);
  const geo = [];
  const tx = -18;
  for (const [x, z] of [[tx - 6, -6], [tx + 6, -6], [tx - 6, 6], [tx + 6, 6]]) {
    const c = new THREE.BoxGeometry(0.8, 122, 0.8);
    c.translate(x, 61, z);
    geo.push(c);
  }
  for (let y = 4; y < 122; y += 6) {
    for (const [a, b, len, rot] of [[tx, -6, 12, 0], [tx, 6, 12, 0], [tx - 6, 0, 12, 1], [tx + 6, 0, 12, 1]]) {
      const bm = new THREE.BoxGeometry(rot ? 0.5 : len, 0.5, rot ? len : 0.5);
      bm.translate(a, y, b);
      geo.push(bm);
    }
    const d = new THREE.BoxGeometry(0.35, 0.35, 16.5);
    d.rotateX(Math.atan2(6, 12));
    d.translate(tx + 6, y + 3, 0);
    geo.push(d);
  }
  g.add(new THREE.Mesh(mergeGeometries(geo), m.red));
  // swing arms
  g.userData.arms = [];
  for (const y of [12, 22, 38, 52, 60, 70, 80, 94, 98]) {
    const arm = new THREE.Group();
    const a = new THREE.Mesh(new THREE.BoxGeometry(12, 1.4, 1.6), m.red);
    a.position.x = 6;
    arm.add(a);
    arm.position.set(tx + 6, y, 0);
    g.add(arm);
    g.userData.arms.push(arm);
  }
  // crane hammerhead
  const crane = new THREE.Mesh(new THREE.BoxGeometry(22, 2, 2), m.red);
  crane.position.set(tx, 123, 0);
  g.add(crane);
  return g;
}
