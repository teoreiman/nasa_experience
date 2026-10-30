// First-person 3D cockpit (CM or LM interior) with interactive panels.
// Scene units: metres in the crew module's datum frame (geometry.js). FlightView renders the
// exterior with camera world pose = vehicle pose ∘ moduleTransform ∘ getEyeTransform(), then this
// interior on top (depth cleared); window openings are holes so the real outside shows through.

import * as THREE from 'three';
import { store } from '../core/Store.js';
import { buildCMPanels } from './panels/cm/index.js';
import { buildLMPanels } from './panels/lm/index.js';
import { PanelMesh } from './interaction/PanelMesh.js';
import { PanelInteractor } from './interaction/PanelInteractor.js';

const D = Math.PI / 180;

/** Orientation from panel axes given in the module frame (right, up; normal = right × up). */
function basis(right, up) {
  const r = new THREE.Vector3(...right);
  const u = new THREE.Vector3(...up);
  const n = new THREE.Vector3().crossVectors(r, u);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(r, u, n));
}

// Camera base orientations (camera looks along its local −Z, up local +Y).
const CAM_CM_FWD = basis([0, 1, 0], [0, 0, -1]); // looks +X (apex), head toward −Z
const CAM_LOOK_Z = basis([0, 1, 0], [1, 0, 0]); // looks +Z, up +X (LEB / LM)

// Panel placements: center (module frame) + orientation + tilt (deg about panel X) + yaw (deg about panel Y)
const CM_LAYOUT = {
  CM_P2: { pos: [1.95, 0, -0.36], rot: basis([0, 1, 0], [0, 0, -1]), yaw: 0, tilt: -8 },
  CM_P1: { pos: [1.95 - Math.sin(28 * D) * 0.33, -0.55 - Math.cos(28 * D) * 0.33, -0.36], rot: basis([0, 1, 0], [0, 0, -1]), yaw: 28, tilt: -8 },
  CM_P3: { pos: [1.95 - Math.sin(28 * D) * 0.33, 0.55 + Math.cos(28 * D) * 0.33, -0.36], rot: basis([0, 1, 0], [0, 0, -1]), yaw: -28, tilt: -8 },
  CM_LEFT: { pos: [1.05, -1.42, 0.12], rot: basis([1, 0, 0], [0, 0, -1]), yaw: 0, tilt: 25 },
  CM_RIGHT: { pos: [1.05, 1.42, 0.12], rot: basis([-1, 0, 0], [0, 0, -1]), yaw: 0, tilt: 25 },
  CM_LEB: { pos: [0.95, 0, 1.3], rot: basis([0, 1, 0], [1, 0, 0]), yaw: 0, tilt: 0 },
};

const LM_LAYOUT = {
  LM_P1: { pos: [5.02, -0.4, 1.16], rot: basis([0, 1, 0], [1, 0, 0]), yaw: 12, tilt: -10 },
  LM_P2: { pos: [5.02, 0.4, 1.16], rot: basis([0, 1, 0], [1, 0, 0]), yaw: -12, tilt: -10 },
  LM_P3: { pos: [4.55, 0, 1.12], rot: basis([0, 1, 0], [1, 0, 0]), yaw: 0, tilt: -35 },
  LM_P4: { pos: [4.2, 0, 1.0], rot: basis([0, 1, 0], [1, 0, 0]), yaw: 0, tilt: -30 },
  LM_P5: { pos: [4.3, -0.62, 1.02], rot: basis([0, 1, 0], [1, 0, 0]), yaw: 20, tilt: -30 },
  LM_P6: { pos: [4.3, 0.62, 1.02], rot: basis([0, 1, 0], [1, 0, 0]), yaw: -20, tilt: -30 },
  LM_P8: { pos: [4.75, -1.02, 0.55], rot: basis([0, 0, 1], [1, 0, 0]), yaw: 0, tilt: -20 },
  LM_P12: { pos: [4.6, 1.02, 0.3], rot: basis([0, 0, -1], [1, 0, 0]), yaw: 0, tilt: -20 },
  LM_P14: { pos: [5.12, 1.02, 0.55], rot: basis([0, 0, -1], [1, 0, 0]), yaw: 0, tilt: -10 },
  LM_P11: { pos: [5.92, -0.55, 0.45], rot: basis([0, -1, 0], [0, 0, 1]), yaw: 0, tilt: 0 },
  LM_P16: { pos: [5.92, 0.55, 0.45], rot: basis([0, -1, 0], [0, 0, 1]), yaw: 0, tilt: 0 },
};

// window normals in the cabin frame (where sunlight can come in)
const CM_WINDOWS = [[1, 0, -0.35], [0, -1, -0.2], [0, 1, -0.2], [0.2, 0, -1]].map((n) => { const l = Math.hypot(...n); return n.map((x) => x / l); });
const LM_WINDOWS = [[0.15, -0.3, 1], [0.15, 0.3, 1], [1, 0, 0]].map((n) => { const l = Math.hypot(...n); return n.map((x) => x / l); });
// panel integral lighting (rotary OFF … HIGH) → emissive strength of the legends
const INTEGRAL = { OFF: 0.04, LOW: 0.12, MED: 0.22, HIGH: 0.34, DIM: 0.14, BRIGHT: 0.3 };
const _mq = new THREE.Quaternion();
const _iq = new THREE.Quaternion();
const _sv = new THREE.Vector3();

const SEATS = {
  CM: [
    { id: 'CDR', name: 'Comandante', pos: [1.25, -0.62, -0.3], base: CAM_CM_FWD, yaw: 8, pitch: -4 },
    { id: 'CMP', name: 'Piloto del CM', pos: [1.25, 0, -0.3], base: CAM_CM_FWD, yaw: 0, pitch: -4 },
    { id: 'LMP', name: 'Piloto del LM', pos: [1.25, 0.62, -0.3], base: CAM_CM_FWD, yaw: -8, pitch: -4 },
    { id: 'LEB', name: 'Bahía inferior de equipos', pos: [0.95, 0, 0.45], base: CAM_LOOK_Z, yaw: 0, pitch: 0 },
  ],
  LM: [
    { id: 'CDR', name: 'Comandante (izquierda)', pos: [5.15, -0.42, 0.5], base: CAM_LOOK_Z, yaw: 0, pitch: -6 },
    { id: 'LMP', name: 'Piloto del LM (derecha)', pos: [5.15, 0.42, 0.5], base: CAM_LOOK_Z, yaw: 0, pitch: -6 },
  ],
};

function wallTexture(holes, w = 512, h = 512) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#000';
  for (const hole of holes) {
    g.beginPath();
    hole.forEach(([x, y], i) => (i ? g.lineTo(x * w, y * h) : g.moveTo(x * w, y * h)));
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  return t;
}

/** Quilted Beta-cloth insulation blanket (the off-white padding that lined the cabins). */
function blanketTexture(tone = '#cfc9b8', cells = 6) {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = tone;
  g.fillRect(0, 0, 512, 512);
  // fabric grain
  for (let i = 0; i < 9000; i++) {
    const v = Math.random() < 0.5 ? 255 : 0;
    g.fillStyle = `rgba(${v},${v},${v},${Math.random() * 0.05})`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 2, 1);
  }
  const s = 512 / cells;
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      // puffed cell: lighter middle, shaded seams
      const x = i * s;
      const y = j * s;
      const grd = g.createRadialGradient(x + s * 0.45, y + s * 0.4, s * 0.1, x + s / 2, y + s / 2, s * 0.72);
      grd.addColorStop(0, 'rgba(255,255,255,0.10)');
      grd.addColorStop(1, 'rgba(0,0,0,0.22)');
      g.fillStyle = grd;
      g.fillRect(x, y, s, s);
    }
  }
  g.strokeStyle = 'rgba(60,55,45,0.55)';
  g.setLineDash([5, 4]);
  g.lineWidth = 1.5;
  for (let i = 0; i <= cells; i++) {
    g.beginPath();
    g.moveTo(i * s, 0);
    g.lineTo(i * s, 512);
    g.moveTo(0, i * s);
    g.lineTo(512, i * s);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Window bezel: a dark anodised frame with bolts around a rectangular opening (w × h, metres). */
function bezel(w, h, depth = 0.05) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.45, metalness: 0.55 });
  const t = 0.035;
  for (const [sx, sy, px, py] of [[w + 2 * t, t, 0, h / 2 + t / 2], [w + 2 * t, t, 0, -h / 2 - t / 2], [t, h, -w / 2 - t / 2, 0], [t, h, w / 2 + t / 2, 0]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, depth), mat);
    m.position.set(px, py, 0);
    m.castShadow = true;
    g.add(m);
  }
  const bolt = new THREE.MeshStandardMaterial({ color: 0x9a9a95, roughness: 0.3, metalness: 0.9 });
  const bg = new THREE.CylinderGeometry(0.006, 0.006, 0.01, 10);
  for (let i = 0; i < 4; i++) {
    for (const s of [-1, 1]) {
      const b1 = new THREE.Mesh(bg, bolt);
      b1.rotation.x = Math.PI / 2;
      b1.position.set(-w / 2 + (i + 0.5) * (w / 4), s * (h / 2 + t / 2), depth / 2);
      g.add(b1);
      const b2 = new THREE.Mesh(bg, bolt);
      b2.rotation.x = Math.PI / 2;
      b2.position.set(s * (w / 2 + t / 2), -h / 2 + (i + 0.5) * (h / 4), depth / 2);
      g.add(b2);
    }
  }
  return g;
}

export class CockpitView {
  /** @param {{ game, sim, station: 'CM'|'LM', panels?: import('./Panel.js').Panel[], observer?: boolean }} o */
  constructor({ game, sim, station, panels = null, observer = false }) {
    this.game = game;
    this.sim = sim;
    this.station = station;
    this.observer = observer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(store.settings.fov ?? 70, game.width / game.height, 0.02, 30);
    this.seatIndex = 0;
    this.head = { yaw: 0, pitch: 0, fov: store.settings.fov ?? 70, tYaw: 0, tPitch: 0, tFov: store.settings.fov ?? 70 };
    const v = sim.vehicle;
    this.ctx = { sw: v.sw, tm: v.tm, bus: sim.bus, clock: sim.clock, audio: game.audio, vehicle: v, sim, gnc: sim.gnc, role: sim.role, station, settings: store.settings, input: game.input };
    this.panels = panels ?? (station === 'LM' ? buildLMPanels(this.ctx) : buildCMPanels(this.ctx));
    this.active = false;
    this.highlightIds = [];
  }

  get seats() {
    return SEATS[this.station];
  }

  async init() {
    await document.fonts?.ready;
    const px = this.game.quality.panelPxPerMm ?? 1.6;
    const layout = this.station === 'LM' ? LM_LAYOUT : CM_LAYOUT;
    this.panelMeshes = [];
    for (const p of this.panels) {
      const L = layout[p.id];
      if (!L) continue;
      const pm = new PanelMesh(p, { pxPerMm: px, brightness: 0.95 });
      pm.group.position.set(...L.pos);
      pm.group.quaternion.copy(L.rot);
      pm.group.rotateY(L.yaw * D);
      pm.group.rotateX(L.tilt * D);
      this.scene.add(pm.group);
      this.panelMeshes.push(pm);
    }
    this._buildCabin();
    this.interactor = new PanelInteractor({
      game: this.game,
      camera: this.camera,
      panelMeshes: this.panelMeshes,
      enabled: false,
      onLook: (dx, dy) => {
        const s = 0.18 * (store.settings.mouseSensitivity ?? 1) * (this.head.fov / 70);
        this.head.tYaw = Math.max(-115, Math.min(115, this.head.tYaw - dx * s));
        this.head.tPitch = Math.max(-80, Math.min(80, this.head.tPitch - dy * s * (store.settings.invertY ? -1 : 1)));
      },
      onZoom: (f) => {
        this.head.tFov = Math.max(18, Math.min(95, this.head.tFov * f));
      },
    });
    this.setSeat(this.seats[0].id);
    this.arrow = document.createElement('div');
    this.arrow.style.cssText = 'position:fixed;z-index:40;pointer-events:none;width:0;height:0;border-left:14px solid transparent;border-right:14px solid transparent;border-bottom:26px solid rgba(255,190,0,0.9);display:none;filter:drop-shadow(0 0 4px #000)';
    document.body.append(this.arrow);
  }

  _buildCabin() {
    const wall = new THREE.MeshStandardMaterial({ color: 0x4a4d51, roughness: 0.85, metalness: 0.1, side: THREE.DoubleSide });
    const dark = new THREE.MeshStandardMaterial({ color: 0x232527, roughness: 0.9, side: THREE.DoubleSide });
    const cloth = new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 1 });
    const frame = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.5, metalness: 0.4 });
    const add = (geo, mat, pos, quat) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(...pos);
      if (quat) m.quaternion.copy(quat);
      this.scene.add(m);
      return m;
    };
    this.lights = {
      amb: new THREE.AmbientLight(0xbfc8d8, 0.55),
      flood: new THREE.PointLight(0xfff0dd, 1.6, 6, 1.5),
      fill: new THREE.PointLight(0xdfe8ff, 0.5, 5, 1.8),
      sun: new THREE.DirectionalLight(0xfff6e8, 0),
    };
    const sun = this.lights.sun;
    if (this.game.quality?.shadows) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(1024, 1024);
      sun.shadow.camera.near = 0.1;
      sun.shadow.camera.far = 12;
      sun.shadow.camera.left = sun.shadow.camera.bottom = -3;
      sun.shadow.camera.right = sun.shadow.camera.top = 3;
      sun.shadow.bias = -0.002;
      sun.shadow.normalBias = 0.02;
    }
    this.scene.add(this.lights.amb, this.lights.flood, this.lights.fill, sun, sun.target);
    const blanket = blanketTexture();
    const quilt = (rx, ry, tone) => {
      const t = tone ? blanketTexture(tone) : blanket.clone();
      t.repeat.set(rx, ry);
      t.needsUpdate = true;
      return t;
    };
    const shadowy = (m) => {
      m.castShadow = true;
      m.receiveShadow = true;
      return m;
    };
    if (this.station === 'CM') {
      this.lights.flood.position.set(1.3, 0, -0.9);
      // upper forward bulkhead above the MDC with the two rendezvous windows
      const upper = wallTexture([
        [[0.2, 0.25], [0.36, 0.25], [0.36, 0.62], [0.2, 0.62]],
        [[0.64, 0.25], [0.8, 0.25], [0.8, 0.62], [0.64, 0.62]],
      ]);
      shadowy(add(new THREE.PlaneGeometry(3.2, 0.9), new THREE.MeshStandardMaterial({ color: 0xffffff, map: quilt(5, 1.4, '#bdb8a8'), roughness: 0.95, alphaMap: upper, alphaTest: 0.5, side: THREE.DoubleSide }), [2.0, 0, -1.03], basis([0, 1, 0], [0, 0, -1])));
      for (const u of [0.28, 0.72]) {
        const holder = new THREE.Group();
        holder.position.set(2.0, 0, -1.03);
        holder.quaternion.copy(basis([0, 1, 0], [0, 0, -1]));
        const b = bezel(0.16 * 3.2, 0.37 * 0.9, 0.04);
        b.position.set((u - 0.5) * 3.2, (0.5 - 0.435) * 0.9, 0.02);
        holder.add(b);
        this.scene.add(holder);
      }
      // overhead (toward heads) with the hatch window
      const hatch = wallTexture([[[0.42, 0.35], [0.58, 0.35], [0.58, 0.65], [0.42, 0.65]]]);
      add(new THREE.PlaneGeometry(2.0, 3.2), new THREE.MeshStandardMaterial({ color: 0x45484c, roughness: 0.85, alphaMap: hatch, alphaTest: 0.5, side: THREE.DoubleSide }), [1.0, 0, -1.48], basis([1, 0, 0], [0, 1, 0]));
      // side walls with side windows: quilted insulation blankets, bezels around the windows
      const side = wallTexture([[[0.55, 0.12], [0.75, 0.12], [0.75, 0.32], [0.55, 0.32]]]);
      for (const sgn of [-1, 1]) {
        const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: quilt(3, 3), roughness: 0.95, alphaMap: side, alphaTest: 0.5, side: THREE.DoubleSide });
        const q = basis([sgn, 0, 0], [0, 0, -1]);
        shadowy(add(new THREE.PlaneGeometry(2.2, 2.4), mat, [1.1, sgn * 1.62, -0.2], q));
        // bezel around the window (hole centre u = 0.65, v = 0.22 of the wall), on the cabin side
        const holder = new THREE.Group();
        holder.position.set(1.1, sgn * 1.62, -0.2);
        holder.quaternion.copy(q);
        const b = bezel(0.44, 0.48);
        b.position.set((0.65 - 0.5) * 2.2, (0.5 - 0.22) * 2.4, -0.025);
        holder.add(b);
        this.scene.add(holder);
      }
      // aft bulkhead (behind the crew), floor toward feet
      shadowy(add(new THREE.PlaneGeometry(3.4, 3.0), new THREE.MeshStandardMaterial({ color: 0xffffff, map: quilt(4, 3, '#c4beac'), roughness: 0.95, side: THREE.DoubleSide }), [0.15, 0, 0]));
      this.scene.children.at(-1).quaternion.copy(basis([0, 1, 0], [0, 0, -1]));
      shadowy(add(new THREE.PlaneGeometry(2.4, 3.4), dark, [1.0, 0, 1.6], basis([1, 0, 0], [0, 1, 0])));
      // handholds and conduit along the MDC
      const rail = new THREE.MeshStandardMaterial({ color: 0x8a8d90, roughness: 0.35, metalness: 0.8 });
      for (const y of [-1.2, 1.2]) {
        const h1 = shadowy(add(new THREE.CylinderGeometry(0.012, 0.012, 0.42, 12), rail, [1.62, y, -0.86]));
        h1.rotation.z = Math.PI / 2;
      }
      const conduit = new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.6, metalness: 0.3 });
      const c1 = shadowy(add(new THREE.CylinderGeometry(0.018, 0.018, 3.0, 10), conduit, [1.93, 0, -0.95]));
      c1.rotation.x = Math.PI / 2;
      // checklist books velcroed to the side wall, and the Hasselblad on its bracket
      const book = new THREE.MeshStandardMaterial({ color: 0xd9d2bf, roughness: 0.9 });
      const bookCover = new THREE.MeshStandardMaterial({ color: 0x23466e, roughness: 0.7 });
      shadowy(add(new THREE.BoxGeometry(0.22, 0.03, 0.28), bookCover, [1.35, -1.56, 0.25]));
      shadowy(add(new THREE.BoxGeometry(0.2, 0.025, 0.26), book, [1.35, -1.53, 0.25]));
      const cam = new THREE.MeshStandardMaterial({ color: 0x16171a, roughness: 0.4, metalness: 0.6 });
      shadowy(add(new THREE.BoxGeometry(0.1, 0.1, 0.1), cam, [1.55, 1.5, -0.55]));
      const lens = shadowy(add(new THREE.CylinderGeometry(0.035, 0.035, 0.08, 16), cam, [1.55, 1.42, -0.55]));
      lens.rotation.z = Math.PI / 2;
      // MDC lower section (below the main panels) and frames
      add(new THREE.PlaneGeometry(3.2, 0.75), dark, [1.9, 0, 0.3], basis([0, 1, 0], [0, 0, -1]));
      // MDC lower skirt and frames
      add(new THREE.BoxGeometry(0.1, 3.0, 0.12), frame, [1.97, 0, -0.62]);
      add(new THREE.BoxGeometry(0.1, 3.0, 0.08), frame, [1.98, 0, -0.08]);
      // couches (seen toward the feet) with headrests
      for (const y of [-0.62, 0, 0.62]) {
        add(new THREE.BoxGeometry(0.5, 0.52, 0.06), cloth, [0.95, y, 0.12]);
        add(new THREE.BoxGeometry(0.12, 0.5, 0.5), cloth, [1.35, y, 0.55]);
        add(new THREE.BoxGeometry(0.05, 0.05, 1.2), frame, [0.9, y - 0.27, 0.6]);
        add(new THREE.BoxGeometry(0.05, 0.05, 1.2), frame, [0.9, y + 0.27, 0.6]);
      }
      // COAS on the CDR's left rendezvous window
      this.coas = this._reticle([1.98, -0.48, -1.0], basis([0, 1, 0], [0, 0, -1]));
      this.coas.visible = false;
    } else {
      this.lights.flood.position.set(5.6, 0, 0.6);
      // front wall with two triangular windows
      const front = wallTexture([
        [[0.12, 0.08], [0.46, 0.08], [0.46, 0.44]],
        [[0.88, 0.08], [0.54, 0.08], [0.54, 0.44]],
      ]);
      add(new THREE.PlaneGeometry(2.0, 1.6), new THREE.MeshStandardMaterial({ color: 0x6d7175, roughness: 0.85, alphaMap: front, alphaTest: 0.5, side: THREE.DoubleSide }), [5.0, 0, 1.3], basis([0, 1, 0], [1, 0, 0]));
      const ceil = wallTexture([[[0.3, 0.6], [0.45, 0.6], [0.45, 0.85], [0.3, 0.85]]]);
      add(new THREE.PlaneGeometry(1.8, 2.2), new THREE.MeshStandardMaterial({ color: 0x5f6367, roughness: 0.85, alphaMap: ceil, alphaTest: 0.5, side: THREE.DoubleSide }), [6.05, 0, 0.3], basis([0, -1, 0], [0, 0, 1]));
      const lmWall = () => new THREE.MeshStandardMaterial({ color: 0xffffff, map: quilt(3, 2, '#b9b6ad'), roughness: 0.95, side: THREE.DoubleSide });
      shadowy(add(new THREE.PlaneGeometry(2.4, 1.6), lmWall(), [5.0, -1.12, 0.3], basis([0, 0, 1], [1, 0, 0])));
      shadowy(add(new THREE.PlaneGeometry(2.4, 1.6), lmWall(), [5.0, 1.12, 0.3], basis([0, 0, -1], [1, 0, 0])));
      shadowy(add(new THREE.PlaneGeometry(2.2, 2.4), dark, [3.7, 0, 0.3], basis([0, 1, 0], [0, 0, 1])));
      shadowy(add(new THREE.PlaneGeometry(2.4, 2.2), lmWall(), [5.0, 0, -0.55], basis([0, 1, 0], [1, 0, 0])));

      // LPD scale on the CDR window
      this.lpd = this._lpdScale([5.55, -0.42, 1.28]);
    }
  }

  _reticle(pos, quat) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    g.strokeStyle = 'rgba(255,120,40,0.95)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(128, 128, 90, 0, Math.PI * 2);
    g.moveTo(10, 128);
    g.lineTo(246, 128);
    g.moveTo(128, 10);
    g.lineTo(128, 246);
    for (let i = -4; i <= 4; i++) {
      g.moveTo(118, 128 + i * 22);
      g.lineTo(138, 128 + i * 22);
    }
    g.stroke();
    const tex = new THREE.CanvasTexture(c);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthTest: false }));
    m.position.set(...pos);
    m.quaternion.copy(quat);
    this.scene.add(m);
    return m;
  }

  _lpdScale(pos) {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 512;
    const g = c.getContext('2d');
    g.strokeStyle = 'rgba(255,255,255,0.7)';
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.font = '20px Barlow';
    g.lineWidth = 2;
    for (let deg = 0; deg <= 80; deg += 5) {
      const y = 20 + (deg / 80) * 470;
      g.beginPath();
      g.moveTo(deg % 10 ? 70 : 50, y);
      g.lineTo(90, y);
      g.stroke();
      if (deg % 10 === 0) g.fillText(String(deg), 8, y + 7);
    }
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.32), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }));
    m.position.set(...pos);
    m.quaternion.copy(basis([0, 1, 0], [1, 0, 0]));
    this.scene.add(m);
    return m;
  }

  setSeat(id) {
    const i = this.seats.findIndex((s) => s.id === id);
    this.seatIndex = i < 0 ? 0 : i;
    const s = this.seats[this.seatIndex];
    this.head.yaw = this.head.tYaw = s.yaw;
    this.head.pitch = this.head.tPitch = s.pitch;
    this.sim.bus.emit('view:seat', { seat: s.id, name: s.name });
  }

  highlight(ids) {
    this.highlightIds = ids ?? [];
    for (const p of this.panels) p.setHighlights(ids);
  }

  getEyeTransform() {
    return { position: this.camera.position, quaternion: this.camera.quaternion };
  }

  setActive(on) {
    if (this.active === on) return;
    this.active = on;
    this.interactor?.setEnabled(on);
    if (!on && this.arrow) this.arrow.style.display = 'none';
  }

  update(dt, info = {}) {
    const input = this.game.input;
    if (this.active && !info.paused) {
      if (input.pressed('seatNext')) this.setSeat(this.seats[(this.seatIndex + 1) % this.seats.length].id);
      if (input.pressed('panelFocus')) {
        if (this.head.tFov < 50) this.head.tFov = store.settings.fov ?? 70;
        else this.head.tFov = 34;
      }
      if (input.pressed('freeLook')) {
        const s = this.seats[this.seatIndex];
        this.head.tYaw = s.yaw;
        this.head.tPitch = s.pitch;
        this.head.tFov = store.settings.fov ?? 70;
      }
      this.interactor.routeKeys(input);
    }
    const k = Math.min(1, dt * 10);
    const h = this.head;
    h.yaw += (h.tYaw - h.yaw) * k;
    h.pitch += (h.tPitch - h.pitch) * k;
    h.fov += (h.tFov - h.fov) * k;
    const s = this.seats[this.seatIndex];
    this.camera.position.set(...s.pos);
    const q = this.camera.quaternion.copy(s.base);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), h.yaw * D));
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), h.pitch * D));
    if (this.camera.fov !== h.fov) {
      this.camera.fov = h.fov;
      this.camera.updateProjectionMatrix();
    }
    // lighting: floodlights from the FLOOD rotary, sunlight through the windows
    const v = this.sim.vehicle;
    const flood = this.station === 'CM' ? v.sw.get('CM.LTG.FLOOD') : 'BRIGHT';
    const powered = this.station === 'CM' ? (v.tm['CM.EPS.MNA.V'] ?? 28) > 18 || (v.tm['CM.EPS.MNB.V'] ?? 28) > 18 : (v.tm['LM.EPS.CDR_BUS.V'] ?? 0) > 18 || (v.tm['LM.EPS.LMP_BUS.V'] ?? 0) > 18;
    this.lights.flood.intensity = !powered ? 0 : flood === 'BRIGHT' ? 2.4 : flood === 'DIM' ? 1.2 : 0.15;
    this.lights.amb.intensity = powered ? 0.35 : 0.1;
    this.lights.fill.position.copy(this.camera.position);
    this.lights.fill.intensity = powered ? 0.35 : 0.08;
    // sunlight: the Sun's direction in the cabin frame; it reaches inside when it shines on the windows
    const sunL = this.lights.sun;
    if (info.sunDir && info.camQ) {
      const modQ = _mq.copy(info.camQ).multiply(_iq.copy(this.camera.quaternion).invert()).invert();
      const sl = _sv.copy(info.sunDir).applyQuaternion(modQ).normalize();
      const wins = this.station === 'CM' ? CM_WINDOWS : LM_WINDOWS;
      let lit = 0;
      for (const n of wins) lit = Math.max(lit, sl.x * n[0] + sl.y * n[1] + sl.z * n[2]);
      const shadowed = v.state.inShadow;
      const k = shadowed ? 0 : Math.max(0, Math.min(1, (lit - 0.05) * 2.2));
      sunL.intensity = 2.6 * k;
      const c = this.station === 'CM' ? [1.2, 0, -0.3] : [5.0, 0, 0.5];
      sunL.target.position.set(...c);
      sunL.position.set(c[0] + sl.x * 6, c[1] + sl.y * 6, c[2] + sl.z * 6);
    }
    const bright = powered ? 1 : 0.35;
    const integral = powered ? (this.station === 'CM' ? INTEGRAL[v.sw.get('CM.LTG.INTEGRAL')] ?? 0.22 : INTEGRAL[v.sw.get('LM.LTG.INTEGRAL')] ?? 0.22) : 0.02;
    for (const pm of this.panelMeshes) {
      pm.update(dt);
      for (const t of pm.tiles) {
        t.mesh.material.color.setScalar(bright);
        t.mesh.material.emissiveIntensity = integral;
      }
    }
    if (this.coas) this.coas.visible = !!this.sim.runner?.flags?.coas || v.sw.get('CM.LTG.COAS') === 'ON';
    this._updateArrow();
  }

  _updateArrow() {
    if (!this.arrow) return;
    let target = null;
    if (this.active && this.highlightIds.length) {
      for (const pm of this.panelMeshes) {
        const w = pm.panel.widgets.find((x) => this.highlightIds.includes(x.switchId) || this.highlightIds.includes(x.id));
        if (w) {
          const lx = ((w.x + w.w / 2) / pm.panel.width - 0.5) * pm.width;
          const ly = (0.5 - (w.y + w.h / 2) / pm.panel.height) * pm.height;
          target = pm.group.localToWorld(new THREE.Vector3(lx, ly, 0));
          break;
        }
      }
    }
    if (!target) {
      this.arrow.style.display = 'none';
      return;
    }
    const p = target.clone().project(this.camera);
    const behind = target.clone().applyMatrix4(this.camera.matrixWorldInverse).z > 0;
    if (!behind && Math.abs(p.x) < 0.92 && Math.abs(p.y) < 0.92) {
      this.arrow.style.display = 'none';
      return;
    }
    let ax = behind ? -p.x : p.x;
    let ay = behind ? -p.y : p.y;
    const m = Math.max(Math.abs(ax), Math.abs(ay)) || 1;
    ax /= m;
    ay /= m;
    const sx = (ax * 0.88 + 1) * 0.5 * window.innerWidth;
    const sy = (1 - (ay * 0.88 + 1) * 0.5) * window.innerHeight;
    const ang = Math.atan2(ax, ay);
    this.arrow.style.display = 'block';
    this.arrow.style.left = `${sx - 14}px`;
    this.arrow.style.top = `${sy - 13}px`;
    this.arrow.style.transform = `rotate(${ang}rad)`;
  }

  render(renderer) {
    renderer.render(this.scene, this.camera);
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.interactor?.dispose();
    this.arrow?.remove();
    for (const pm of this.panelMeshes ?? []) pm.dispose();
    for (const p of this.panels) p.dispose();
    this.scene.traverse((o) => {
      o.geometry?.dispose?.();
      o.material?.dispose?.();
    });
  }
}
