// Astronaut / TV view: exterior rendering + the first-person cockpit pass.
// Three.js world axes = ECI axes, metres, rendered camera-relative (objects at worldPos − camPos).
// Passes: far (stars, Milky Way, Earth, Moon, Sun, sky) → mid (lunar terrain) → near (vehicles,
// launch site, plumes, smoke) → cockpit. HDR + bloom through PostFX on medium/high quality.
//
// Cameras: cockpit · exterior:chase (drag to orbit, wheel to zoom) · exterior:wide · pad:far
// (long-lens tracking camera 1.6 km from the pad) · pad:tower (LUT camera) · pad:deck (engine
// camera) · onboard (S-II camera looking aft at staging) · surface (lunar TV camera).

import * as THREE from 'three';
import { R_EARTH, R_MOON, SITES_DEG, DEG } from '../core/constants.js';
import { store } from '../core/Store.js';
import { gmst, earthFixedToEci } from '../sim/physics/ephemeris.js';
import { buildConfigModel, createSaturnV, createSaturnIB, createLM } from './models/index.js';
import { moduleTransform, CONFIGS, STACK, GEOM } from '../sim/geometry.js';
import { CockpitView } from '../cockpit/CockpitView.js';
import { createEarth, createMoon, createStarfield, createSun } from './env/Bodies.js';
import { createSky, skyColor } from './env/Sky.js';
import { createLaunchSite, DECK_Y } from './env/LaunchSite.js';
import { createPlume, Particles, PLUME_SPEC } from './effects/Exhaust.js';
import { createPostFX } from './effects/PostFX.js';
import { createLunarSurface } from './env/LunarSurface.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _e = new THREE.Euler();
const X = new THREE.Vector3(1, 0, 0);
const OMEGA = 7.2921159e-5;

/** Visual model for a passive body spawned by physics (stages, LES, targets…). */
function bodyModel(body, parts) {
  const cfg = body.config;
  if (CONFIGS[cfg]) return buildConfigModel(cfg, { ...parts, smDamaged: body.damaged ?? parts.smDamaged, slaPanels: false, lmGearDeployed: cfg === 'LM' || cfg === 'LM_ASC' ? true : parts.lmGearDeployed });
  const sv = createSaturnV();
  const root = new THREE.Group();
  const nozzles = { main: [], retro: [], les: [] };
  let part = null;
  if (cfg === 'SIB') {
    const ib = createSaturnIB();
    part = ib.parts.sib;
  } else if (cfg === 'SIC') {
    part = sv.parts.sic;
    nozzles.retro = sv.nozzles.retro;
  } else if (cfg === 'SII') {
    part = sv.parts.sii;
    sv.parts.interstage.visible = false;
  } else if (cfg === 'INTERSTAGE') {
    part = sv.parts.interstage;
    nozzles.ullage = sv.nozzles.ullage;
  } else if (cfg === 'LES') {
    part = sv.parts.les;
    nozzles.les = sv.nozzles.les;
  } else if (cfg === 'LM_DESCENT') {
    const l = createLM();
    l.parts.ascent.visible = false;
    root.add(l.root);
    return { root, nozzles };
  } else if (cfg === 'SLA_PANEL') {
    part = sv.parts.slaPanels[0];
  }
  if (part) {
    part.removeFromParent();
    part.position.set(0, 0, 0);
    root.add(part);
  }
  return { root, nozzles };
}

export class FlightView {
  /** @param {{ game, sim, role, chapter, mission, observer?: boolean }} o */
  constructor({ game, sim, role, chapter, mission, observer = false }) {
    this.game = game;
    this.sim = sim;
    this.role = role;
    this.chapter = chapter;
    this.mission = mission;
    this.observer = observer;
    this.cameraMode = observer ? (sim.dyn.mode === 'PAD' ? 'pad:far' : 'exterior:chase') : 'cockpit';
    this.active = false;
    this.cockpit = null;
    this.shakeAmt = 0;
    this.shakeT = 0;
    this.orbit = { yaw: -0.5, pitch: 0.18, dist: 0 };
    this._partsSig = '';
    this.fadeEl = null;
    this.time = 0;
    this.camWorld = new THREE.Vector3();
    this.camQ = new THREE.Quaternion();
    this.bodyViews = new Map();
    this.events = { sicSep: -1e9, siiSep: -1e9, lesJett: -1e9, ignition: -1e9, csmSep: -1e9 };
  }

  async init() {
    const { game, sim } = this;
    const q = game.quality;
    this.far = new THREE.Scene();
    this.mid = new THREE.Scene();
    this.near = new THREE.Scene();
    const fov = store.settings.fov ?? 70;
    this.farCam = new THREE.PerspectiveCamera(fov, game.width / game.height, 100, 2.5e9);
    this.midCam = new THREE.PerspectiveCamera(fov, game.width / game.height, 1, 2e5);
    this.nearCam = new THREE.PerspectiveCamera(fov, game.width / game.height, 0.2, 3e5);

    const tex = async (n, o) => game.assets.texture(n, o).catch(() => null);
    const [day, night, clouds, water, moonTex, moonH] = await Promise.all([
      tex('earth_day', { sizes: ['4k', '2k'] }),
      tex('earth_night_2k'),
      tex('earth_clouds_2k', { srgb: false }),
      tex('earth_water_2k', { srgb: false }),
      tex('moon_color', { sizes: ['4k', '2k'] }),
      tex('moon_height_1k', { srgb: false }),
    ]);
    this.tex = { day, water, moonTex, moonH };

    // ---- far pass
    this.stars = createStarfield({ count: q.name === 'low' ? 5000 : 9000, radius: 2e9 });
    this.earth = createEarth({ day, night, clouds, water }, { segments: q.name === 'low' ? 96 : 160 });
    this.moon = createMoon({ color: moonTex, height: moonH }, { segments: 160 });
    this.sun = createSun({ flare: false });
    this.sky = createSky();
    this.far.add(this.stars.group, this.earth.group, this.moon.mesh, this.sun.group, this.sky.mesh);

    // ---- near pass: lights
    this.sunLight = new THREE.DirectionalLight(0xfff3e4, 3.4);
    this.sunLight.castShadow = !!q.shadows;
    if (this.sunLight.castShadow) {
      this.sunLight.shadow.mapSize.set(q.name === 'high' ? 2048 : 1024, q.name === 'high' ? 2048 : 1024);
      this.sunLight.shadow.bias = -0.0004;
      this.sunLight.shadow.normalBias = 0.02;
    }
    this.hemi = new THREE.HemisphereLight(0xa8c4ff, 0x5a5440, 0.6);
    this.near.add(this.sunLight, this.sunLight.target, this.hemi);
    this._buildEnvMap();

    // ---- launch site (only built for chapters that can see KSC)
    const pad = sim.dyn.pad ?? { id: 'A', lat: SITES_DEG.LC39A.lat, lon: SITES_DEG.LC39A.lon };
    this.padLatLon = [pad.lat * DEG, pad.lon * DEG];
    this.padInfo = pad;
    if (sim.vehicle.state.primary === 'EARTH' && (sim.dyn.mode === 'PAD' || sim.dyn.mode === 'ASCENT' || sim.vehicle.hasSaturn)) {
      this.site = createLaunchSite({ day, water }, { pad: pad.id, milkstool: !!pad.milkstool });
      this.near.add(this.site.group);
    }
    // ---- lunar surface (landing, ascent, EVA)
    const st = sim.vehicle.state;
    if (st.primary === 'MOON' && (st.alt < 200000 || sim.dyn.mode === 'LANDED')) {
      this.lunar = createLunarSurface(game, { site: sim.dyn.site, moonTex, quality: q });
      this.mid.add(this.lunar.group);
    }

    // ---- effects
    this.smoke = new Particles({ max: Math.round(2600 * q.particles + 400) });
    this.flames = new Particles({ max: 500, additive: true, renderOrder: 9 });
    this.near.add(this.smoke.mesh, this.flames.mesh);
    if (this.lunar) {
      this.dust = new Particles({ max: 900 });
      this.mid.add(this.dust.mesh);
    }

    // ---- vehicle
    this.vehicleRoot = new THREE.Group();
    this.near.add(this.vehicleRoot);
    this._rebuildVehicle();

    // ---- post
    this.post = q.name !== 'low' ? createPostFX(game, { bloom: true, strength: 0.32, radius: 0.5, threshold: 2.2 }) : null;

    this._subscribe();
    if (!this.observer) await this._makeCockpit();
    this._installInput();
  }

  _subscribe() {
    const sim = this.sim;
    this.offs?.forEach((f) => f());
    this.offs = [
      sim.bus.on('vehicle:config', () => this._rebuildVehicle()),
      sim.bus.on('vehicle:station', () => this._makeCockpit()),
      sim.bus.on('mission:highlight', ({ ids }) => this.cockpit?.highlight(ids)),
      sim.bus.on('vehicle:event', (e) => this._onEvent(e)),
      sim.bus.on('dynamics:bodyRemoved', ({ id }) => this._removeBody(id)),
    ];
  }

  /** Swap in a fresh Simulation of the same kind (menu cinematics loop) without rebuilding the world. */
  rebind(sim) {
    for (const id of [...this.bodyViews.keys()]) this._removeBody(id);
    this.smoke.clear();
    this.flames.clear();
    this.dust?.clear();
    this.sim = sim;
    this.events = { sicSep: -1e9, siiSep: -1e9, lesJett: -1e9, ignition: -1e9, csmSep: -1e9 };
    this._padAcc = 0;
    this._trailAcc = 0;
    this._subscribe();
    this._rebuildVehicle();
  }

  _buildEnvMap() {
    // Soft image-based lighting: sky above, warm ground below, a bright sun spot.
    const r = this.game.renderer;
    const pmrem = new THREE.PMREMGenerator(r);
    const scene = new THREE.Scene();
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { top: { value: new THREE.Color(0.32, 0.42, 0.6) }, bottom: { value: new THREE.Color(0.22, 0.2, 0.17) } },
      vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vD; void main(){ vec3 d = normalize(vD); float t = smoothstep(-0.3, 0.4, d.y); gl_FragColor = vec4(mix(bottom, top, t), 1.0); }',
    });
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 24, 12), mat));
    this.envUniforms = mat.uniforms;
    this._pmrem = pmrem;
    this._envScene = scene;
    this._envKey = '';
  }

  _updateEnv(top, bottom, upWorld) {
    // rebuild the PMREM only when the lighting context changes noticeably
    const key = `${top.r.toFixed(2)}${top.g.toFixed(2)}${bottom.r.toFixed(2)}${bottom.g.toFixed(2)}`;
    if (key === this._envKey || this.time - (this._envT ?? -10) < 2) return;
    this._envT = this.time;
    this._envKey = key;
    this.envUniforms.top.value.copy(top);
    this.envUniforms.bottom.value.copy(bottom);
    this._envRT?.dispose();
    this._envRT = this._pmrem.fromScene(this._envScene, 0.02);
    this.near.environment = this._envRT.texture;
    this.near.environmentIntensity = 0.55;
    void upWorld;
  }

  _installInput() {
    const game = this.game;
    this._onWheel = (e) => {
      if (!this.active || this.cameraMode === 'cockpit') return;
      const d = this.orbit.dist || this._defaultDist();
      this.orbit.dist = Math.max(8, Math.min(20000, d * (e.deltaY > 0 ? 1.12 : 0.89)));
    };
    window.addEventListener('wheel', this._onWheel, { passive: true });
    this._drag = null;
    this._onDown = (e) => {
      if (this.cameraMode !== 'cockpit' && e.target === game.canvas) this._drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
    };
    this._onMove = (e) => {
      if (!this._drag || e.pointerId !== this._drag.id) return;
      this.orbit.yaw -= (e.clientX - this._drag.x) * 0.006;
      this.orbit.pitch = Math.max(-1.45, Math.min(1.45, this.orbit.pitch + (e.clientY - this._drag.y) * 0.006));
      this._drag.x = e.clientX;
      this._drag.y = e.clientY;
    };
    this._onUp = () => (this._drag = null);
    game.canvas.addEventListener('pointerdown', this._onDown);
    window.addEventListener('pointermove', this._onMove);
    window.addEventListener('pointerup', this._onUp);
  }

  async _makeCockpit() {
    if (this.observer) return;
    const station = this.sim.vehicle.station;
    if (this.cockpit?.station === station) return;
    this.cockpit?.dispose();
    this.cockpit = new CockpitView({ game: this.game, sim: this.sim, station });
    await this.cockpit.init();
    this.cockpit.resize(this.game.width, this.game.height);
    this.cockpit.setActive(this.active && this.cameraMode === 'cockpit');
  }

  // ---------------------------------------------------------------- vehicle & bodies

  _rebuildVehicle() {
    const v = this.sim.vehicle;
    for (const p of this.plumes ?? []) p.dispose();
    this.vehicleRoot.clear();
    const model = buildConfigModel(v.config, v.parts);
    this.vehicleRoot.add(model.root);
    this.model = model;
    this.plumes = [];
    const add = (anchors, kind, group) => {
      for (const a of anchors ?? []) {
        const p = createPlume(kind);
        a.add(p.mesh);
        p.group = group;
        p.anchor = a;
        this.plumes.push(p);
      }
    };
    const n = model.nozzles;
    const mods = CONFIGS[v.config].modules;
    const stage = mods.includes('SIC') || mods.includes('SIB') ? 'F1' : mods.includes('SII') || mods.includes('SIVB') ? 'J2' : null;
    if (stage) add(n.main, stage, 'main');
    if ((mods.includes('SIC') || mods.includes('SIB')) && n.main.length) {
      // the merged column of the five F-1s, centred under the cluster
      const col = createPlume('F1');
      n.main[0].add(col.mesh);
      col.group = 'column';
      this.plumes.push(col);
    }
    add(n.sps, 'HYPER', 'sps');
    add(n.dps, 'HYPER', 'dps');
    add(n.aps, mods.includes('SIVB') ? 'SOLID' : 'HYPER', mods.includes('SIVB') ? 'sivbAps' : 'aps');
    add(n.les, 'SOLID', 'les');
    add(n.ullage, 'SOLID', 'ullage');
    // RCS jets with their force direction / torque arm (model frame ≈ body frame)
    for (const a of n.rcs ?? []) {
      const p = createPlume('RCS');
      a.add(p.mesh);
      p.group = 'rcs';
      // jet pose in the model (= body) frame: force on the vehicle is the anchor's +X
      a.updateWorldMatrix(true, false);
      const rel = new THREE.Matrix4().copy(this.vehicleRoot.matrixWorld).invert().multiply(a.matrixWorld);
      const pos = new THREE.Vector3();
      const rq = new THREE.Quaternion();
      rel.decompose(pos, rq, new THREE.Vector3());
      const dir = new THREE.Vector3(1, 0, 0).applyQuaternion(rq).normalize();
      p.force = dir;
      p.torque = new THREE.Vector3().crossVectors(pos, dir).normalize();
      p.lm = a.parent?.parent?.name === 'LM';
      this.plumes.push(p);
    }
    model.root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this._partsSig = JSON.stringify(v.parts);
    this._modelCenter = this._centerOf(v.config);
    this.orbit.dist = 0;
  }

  _centerOf(config) {
    // visual centre of the stack relative to the reference point (for camera targeting)
    const c = CONFIGS[config];
    if (!c?.stack) return new THREE.Vector3();
    if (config.startsWith('SATURN_IB')) return new THREE.Vector3((c.modules.includes('SIB') ? 32 : 43) - c.ref, 0, 0);
    const top = c.modules.includes('LES') ? STACK.lesTop : c.modules.includes('CSM') ? STACK.cmApex : STACK.slaTop;
    const bottom = c.modules.includes('SIC') ? 0 : c.modules.includes('SII') ? STACK.siiDatum : STACK.sivbDatum;
    return new THREE.Vector3((top + bottom) / 2 - c.ref, 0, 0);
  }

  _defaultDist() {
    const v = this.sim.vehicle;
    if (v.config === 'SATURN_V') return 190;
    if (v.config === 'SATURN_IB') return 120;
    if (v.config === 'SATURN_IB_SIVB') return 70;
    if (v.config === 'SATURN_V_SII') return 120;
    if (v.config === 'SIVB_STACK' || v.config === 'CSM_LM_SIVB') return 70;
    if (v.config.startsWith('CSM') || v.config === 'CSM_LM') return 32;
    if (v.config.startsWith('LM')) return 24;
    return 30;
  }

  _syncBodies(dt) {
    const dyn = this.sim.dyn;
    for (const b of dyn.bodies.values()) {
      let bv = this.bodyViews.get(b.id);
      if (!bv) {
        const m = bodyModel(b, this.sim.vehicle.parts);
        m.root.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
          }
        });
        this.near.add(m.root);
        bv = { model: m, born: this.time, plumes: [] };
        const addP = (anchors, kind, life) => {
          for (const a of anchors ?? []) {
            const p = createPlume(kind);
            a.add(p.mesh);
            p.life = life;
            bv.plumes.push(p);
          }
        };
        if (b.config === 'SIC') addP(m.nozzles.retro, 'SOLID', 0.9);
        if (b.config === 'LES') addP(m.nozzles.les, 'SOLID', 1.1);
        this.bodyViews.set(b.id, bv);
      }
      const root = bv.model.root;
      root.position.copy(b.r).sub(this.camWorld);
      root.quaternion.copy(b.q);
      const age = this.time - bv.born;
      for (const p of bv.plumes) p.set(age < p.life, b.config === 'LES' ? 16 : 9, 1.8, 1 - age / p.life, this._vac, this.time);
      // SLA panels peel away from the S-IVB after CSM separation
      if (b.config === 'SIVB_LM' && age < 25 && bv.model.handles?.slaPanels) {
        const k = Math.min(1, age / 3);
        for (const pn of bv.model.handles.slaPanels) {
          pn.visible = true;
          pn.quaternion.setFromAxisAngle(pn.userData.axis, k * 0.8 + Math.max(0, age - 3) * 0.06);
          if (age > 3) pn.position.addScaledVector(_v.copy(pn.userData.axis).cross(X), dt * 0.6);
        }
      } else if (bv.model.handles?.slaPanels && age >= 25) for (const pn of bv.model.handles.slaPanels) pn.visible = false;
    }
    void dt;
  }

  _removeBody(id) {
    const bv = this.bodyViews.get(id);
    if (!bv) return;
    this.near.remove(bv.model.root);
    for (const p of bv.plumes) p.dispose();
    bv.model.root.traverse((o) => o.geometry?.dispose?.());
    this.bodyViews.delete(id);
  }

  _onEvent(e) {
    const t = this.time;
    switch (e.kind) {
      case 'IGNITION_SEQUENCE':
        this.events.ignition = t;
        break;
      case 'SIC_SEP':
        this.events.sicSep = t;
        this.flash(0.12);
        this.shake(1.2, 0.8);
        break;
      case 'SII_SEP':
        this.events.siiSep = t;
        this.flash(0.08);
        this.shake(0.8, 0.6);
        break;
      case 'LES_JETT':
        this.events.lesJett = t;
        this.shake(0.6, 0.4);
        break;
      case 'CSM_SEP':
        this.events.csmSep = t;
        this.shake(0.4, 0.3);
        break;
      case 'DOCK_CAPTURE':
      case 'DOCK_HARD':
        this.shake(0.5, 0.35);
        break;
      case 'TOUCHDOWN':
        this.shake(e.crash ? 3 : 0.8, e.crash ? 1.5 : 0.4);
        break;
      case 'O2_TANK2_EXPLOSION':
        this.shake(1.6, 1.2);
        this.flash(0.06);
        break;
      case 'LIGHTNING_STRIKE':
        this.shake(1.1, 0.7);
        this.flash(0.3);
        break;
      case 'SPLASHDOWN':
        this.shake(1.4, 0.8);
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- facade used by missions (ctx.view)

  setActive(on) {
    this.active = on;
    this.game.input.setContext('flight', on && !this.observer);
    this.cockpit?.setActive(on && this.cameraMode === 'cockpit');
  }

  setCamera(mode) {
    if (this.observer && mode === 'cockpit') mode = 'exterior:chase';
    this.cameraMode = mode;
    this.cockpit?.setActive(this.active && mode === 'cockpit');
    this.sim.bus.emit('view:camera', { mode });
  }

  availableCameras() {
    const v = this.sim.vehicle;
    const st = v.state;
    const list = this.observer ? [] : ['cockpit'];
    list.push('exterior:chase', 'exterior:wide');
    if (this.site && st.primary === 'EARTH' && st.alt < 60000) list.push('pad:far', 'pad:tower', 'pad:deck');
    const sat = v.modules.saturn;
    if (sat && (v.config === 'SATURN_V' || v.config === 'SATURN_V_SII') && st.alt > 3000) list.push('onboard');
    if (this.lunar && st.primary === 'MOON' && st.altTerrain < 3000) list.push('surface');
    if (this.cinematicCam) list.push('cinematic');
    return list;
  }

  cycleCamera() {
    const list = this.availableCameras();
    const i = list.indexOf(this.cameraMode);
    this.setCamera(list[(i + 1) % list.length]);
  }

  cameraDistance() {
    return this.camWorld.distanceTo(this.sim.vehicle.state.r);
  }

  shake(amount = 1, seconds = 1) {
    this.shakeAmt = Math.max(this.shakeAmt * (this.shakeT > 0 ? 1 : 0), amount);
    this.shakeT = Math.max(this.shakeT, seconds);
  }

  fade(toBlack, seconds = 1) {
    if (!this.fadeEl) {
      this.fadeEl = document.createElement('div');
      this.fadeEl.className = 'view-fade';
      document.body.append(this.fadeEl);
    }
    this.fadeEl.style.transition = `opacity ${seconds}s`;
    requestAnimationFrame(() => (this.fadeEl.style.opacity = toBlack ? '1' : '0'));
    return new Promise((r) => setTimeout(r, seconds * 1000));
  }

  flash(seconds = 0.2) {
    this._flash = seconds;
  }

  setSeat(seat) {
    this.cockpit?.setSeat(seat);
  }

  highlight(ids) {
    this.cockpit?.highlight(ids);
  }

  // ---------------------------------------------------------------- frame

  _readControls() {
    const { input } = this.game;
    const v = this.sim.vehicle;
    const c = v.controls;
    c.rhc.set(input.axis('roll'), input.axis('pitch'), input.axis('yaw'));
    c.thc.set(input.axis('transX'), input.axis('transY'), input.axis('transZ'));
    c.outOfDetent = c.rhc.lengthSq() > 0.01;
    if (input.down('throttleUp')) c.ttca = Math.min(1, c.ttca + 0.01);
    if (input.down('throttleDown')) c.ttca = Math.max(0, c.ttca - 0.01);
    if (input.pressed('rodUp')) c.rodClicks += 1;
    if (input.pressed('rodDown')) c.rodClicks -= 1;
    if (input.pressed('lpdLeft')) c.lpdAz -= 1;
    if (input.pressed('lpdRight')) c.lpdAz += 1;
    if (input.pressed('lpdFwd')) c.lpdEl += 1;
    if (input.pressed('lpdBack')) c.lpdEl -= 1;
    if (input.pressed('camera')) this.setCamera(this.cameraMode === 'cockpit' ? 'exterior:chase' : 'cockpit');
    if (input.pressed('cameraNext')) this.cycleCamera();
  }

  _padFrame(utc) {
    const [lat, lon] = this.padLatLon;
    const padPos = earthFixedToEci(lat, lon, 0, utc, this._padPos ?? (this._padPos = new THREE.Vector3()));
    const up = (this._padUp ??= new THREE.Vector3()).copy(padPos).normalize();
    const east = (this._padEast ??= new THREE.Vector3()).set(-up.y, up.x, 0).normalize();
    const north = (this._padNorth ??= new THREE.Vector3()).crossVectors(up, east);
    _m.makeBasis(east, up, _v.copy(north).negate());
    (this._padQ ??= new THREE.Quaternion()).setFromRotationMatrix(_m);
    return { padPos, up, east, north, padQ: this._padQ };
  }

  /** Local (x east, y up, z south) pad point → ECI */
  _padPoint(x, y, z, out) {
    return out.copy(this._padEast).multiplyScalar(x).addScaledVector(this._padUp, y).addScaledVector(this._padNorth, -z).add(this._padPos);
  }

  update(dt, paused) {
    const { sim, game } = this;
    const v = sim.vehicle;
    const st = v.state;
    if (!paused) this.time += dt;
    if (this.active && !paused) {
      if (!this.observer) this._readControls();
      else if (game.input.pressed('cameraNext') || game.input.pressed('camera')) this.cycleCamera();
    }
    if (!this.availableCameras().includes(this.cameraMode)) this.setCamera(this.observer ? 'exterior:chase' : 'cockpit');
    const sig = JSON.stringify(v.parts);
    if (sig !== this._partsSig) this._rebuildVehicle();

    const utc = sim.clock.utcMs;
    const sunDir = sim.dyn.sunDir;
    const alt = st.alt;
    const pad = this._padFrame(utc);
    const sat = v.modules.saturn;
    const satThrust = sat && v.isAttached('saturn') ? sat.thrust : 0;

    // ------------------------------------------------ camera pose
    const camQ = this.camQ;
    const camWorld = this.camWorld;
    let fovOverride = null;
    let shake = 0;
    if (sat && satThrust > 0 && st.primary === 'EARTH' && alt < 40000) shake += 0.008 * Math.min(1, satThrust / 3e7) * (alt < 1500 ? 1.8 : 1) + st.dynPressure / 4e6;
    if (sim.dyn.mode === 'ENTRY') shake += Math.min(0.012, st.dynPressure / 3e6);
    if (v.cmd.sps || v.cmd.dps) shake += 0.0012;
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      shake += 0.012 * this.shakeAmt * Math.max(0, Math.min(1, this.shakeT * 2));
    }
    if (store.settings.cameraShake === false) shake = 0;
    const center = (this._centerW ??= new THREE.Vector3()).copy(this._modelCenter ?? X.clone().multiplyScalar(0)).applyQuaternion(st.q).add(st.r);
    const mode = this.cameraMode;
    if (mode === 'cinematic' && this.cinematicCam) {
      const c = this.cinematicCam(this, dt);
      camWorld.copy(c.pos);
      _v.copy(c.look).sub(camWorld).normalize();
      _m.lookAt(new THREE.Vector3(), _v, c.up ?? pad.up);
      camQ.setFromRotationMatrix(_m);
      if (c.roll) camQ.multiply(_q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), c.roll));
      if (shake) camQ.multiply(_q.setFromEuler(_e.set((Math.random() - 0.5) * shake * (c.shake ?? 0.5), (Math.random() - 0.5) * shake * (c.shake ?? 0.5), 0)));
      fovOverride = c.fov ?? 40;
    } else if (mode === 'cockpit' && this.cockpit) {
      const eye = this.cockpit.getEyeTransform();
      const module = v.station === 'LM' ? (v.config === 'LM_ASC' ? 'LM_ASC' : v.config === 'CSM_LM' || v.config === 'CSM_LMASC' ? 'LM_DOCKED' : v.config === 'SIVB_STACK' || v.config.startsWith('SATURN') ? 'LM_STOWED' : 'LM') : v.config === 'CM' ? 'CM' : v.config === 'CSM_LM_SIVB' ? 'CSM_DOCKED_TOP' : 'CSM';
      let mt;
      try {
        mt = moduleTransform(v.config, module);
      } catch {
        mt = { offset: new THREE.Vector3(), quat: new THREE.Quaternion() };
      }
      _v2.copy(eye.position).applyQuaternion(mt.quat).add(mt.offset).applyQuaternion(st.q);
      camWorld.copy(st.r).add(_v2);
      camQ.copy(st.q).multiply(mt.quat).multiply(eye.quaternion);
      if (shake) camQ.multiply(_q.setFromEuler(_e.set((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake)));
    } else if (mode.startsWith('pad:') && this.site) {
      let look;
      if (mode === 'pad:far') {
        this._padPoint(-1480, 22, 640, camWorld);
        look = center;
        const d = camWorld.distanceTo(center);
        fovOverride = Math.max(0.8, Math.min(40, 2 * Math.atan(78 / Math.max(1, d)) * (180 / Math.PI)));
      } else if (mode === 'pad:tower') {
        this._padPoint(-9, DECK_Y + 64, -16.5, camWorld);
        look = _v2.copy(st.r).addScaledVector(_v.copy(X).applyQuaternion(st.q), (CONFIGS[v.config]?.stack ? -CONFIGS[v.config].ref + 14 : 0));
        fovOverride = 58;
      } else {
        this._padPoint(-11, DECK_Y + 1.8, 9, camWorld);
        look = _v2.copy(st.r).addScaledVector(_v.copy(X).applyQuaternion(st.q), CONFIGS[v.config]?.stack ? -CONFIGS[v.config].ref + 2 : 0);
        fovOverride = 78;
      }
      _v.copy(look).sub(camWorld).normalize();
      _m.lookAt(new THREE.Vector3(), _v, pad.up);
      camQ.setFromRotationMatrix(_m);
      if (shake) camQ.multiply(_q.setFromEuler(_e.set((Math.random() - 0.5) * shake * 0.6, (Math.random() - 0.5) * shake * 0.6, 0)));
    } else if (mode === 'onboard') {
      // S-II camera looking aft along the stack (classic staging film)
      const off = _v2.set(STACK.interstageTop + 1.5 - CONFIGS[v.config].ref, -5.35, 0.4).applyQuaternion(st.q);
      camWorld.copy(st.r).add(off);
      // camera −Z looks along body −X (aft), camera up = body −Y (outward from the stack)
      _m.makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 0, 0));
      camQ.copy(st.q).multiply(_q.setFromRotationMatrix(_m)).multiply(_q2.setFromEuler(_e.set(0.12, 0, 0)));
      fovOverride = 70;
      if (shake) camQ.multiply(_q.setFromEuler(_e.set((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, 0)));
    } else if (mode === 'surface' && this.lunar) {
      const p = this.lunar.tvCameraWorld(sim.dyn, camWorld);
      _v.copy(center).sub(p).normalize();
      const upM = _v2.copy(p).sub(sim.dyn.moonPos).normalize();
      _m.lookAt(new THREE.Vector3(), _v, upM);
      camQ.setFromRotationMatrix(_m);
      fovOverride = 50;
    } else {
      // orbit camera in a frame aligned with the local vertical (keeps a level horizon)
      const dist0 = this.orbit.dist || this._defaultDist();
      const dist = mode === 'exterior:wide' ? dist0 * 5 : dist0;
      const up = (this._camUpV ??= new THREE.Vector3()).copy(st.rRel).normalize();
      if (st.alt > 5e6) up.set(0, 0, 1);
      const east = _v2.set(-up.y, up.x, 0);
      if (east.lengthSq() < 1e-6) east.set(1, 0, 0);
      east.normalize();
      const north = new THREE.Vector3().crossVectors(up, east);
      const cp = Math.cos(this.orbit.pitch);
      const local = new THREE.Vector3(cp * Math.cos(this.orbit.yaw), cp * Math.sin(this.orbit.yaw), Math.sin(this.orbit.pitch));
      const offW = new THREE.Vector3().addScaledVector(east, local.x).addScaledVector(north, local.y).addScaledVector(up, local.z).multiplyScalar(dist);
      camWorld.copy(center).add(offW);
      // don't go below the ground on the pad / the Moon
      if (st.primary === 'EARTH' && camWorld.length() < R_EARTH + 3) camWorld.setLength(R_EARTH + 3);
      _v.copy(center).sub(camWorld).normalize();
      _m.lookAt(new THREE.Vector3(), _v, up);
      camQ.setFromRotationMatrix(_m);
      if (shake) camQ.multiply(_q.setFromEuler(_e.set((Math.random() - 0.5) * shake * 0.35, (Math.random() - 0.5) * shake * 0.35, 0)));
    }
    const fov = fovOverride ?? store.settings.fov ?? 70;
    for (const c of [this.farCam, this.midCam, this.nearCam]) {
      c.position.set(0, 0, 0);
      c.quaternion.copy(camQ);
      if (c.fov !== fov) {
        c.fov = fov;
        c.updateProjectionMatrix();
      }
    }

    // ------------------------------------------------ environment
    const camR = camWorld.length();
    const camAlt = camR - R_EARTH;
    const camUp = _v.copy(camWorld).normalize();
    const muSun = sunDir.dot(camUp);
    const nearEarth = camAlt < 2e5;
    this._vac = Math.min(1, Math.max(0, alt / 60000));
    // far: Earth/Moon/stars/sun
    this.earth.setPosition(_v2.copy(camWorld).negate());
    this.earth.setRotation(gmst(utc));
    this.earth.setSun(sunDir);
    this.earth.uniforms.cloudShift.value = (sim.clock.get / 86400) * 0.015;
    this.moon.mesh.position.copy(sim.dyn.moonPos).sub(camWorld);
    this.moon.mesh.rotation.set(0, 0, sim.dyn.moonAngle);
    this.moon.setSun(sunDir);
    this.moon.uniforms.earthDir.value.copy(sim.dyn.moonPos).negate().normalize();
    this.sun.group.position.copy(sunDir).multiplyScalar(1.5e9);
    this.sun.setSize(1.5e9, 0.16);
    this.sky.update(camUp, sunDir, camAlt);
    const dayK = Math.max(0, Math.min(1, (muSun + 0.08) / 0.25));
    const airK = Math.max(0, Math.min(1, 1 - camAlt / 40000));
    const skyBright = airK * dayK;
    this.stars.setVisibility(Math.max(0, 1 - skyBright * 4) * (mode === 'cockpit' ? 0.85 : 1));
    this.stars.setPixelScale(Math.min(2, game.renderer.getPixelRatio()));
    this.sun.setIntensity(st.inShadow || this._sunOccluded(camWorld, sunDir) ? 0 : 1);
    // near-pass lights
    const sunVis = st.inShadow ? 0 : nearEarth ? Math.max(0, Math.min(1, (muSun + 0.03) / 0.12)) : 1;
    const horizonCol = skyColor(0.02, muSun, Math.max(0, camAlt));
    const sunCol = _v2.set(1, 0.95, 0.88);
    if (nearEarth && muSun < 0.3) sunCol.set(1, 0.78 + muSun * 0.6, 0.55 + muSun * 1.1);
    this.sunLight.color.setRGB(sunCol.x, sunCol.y, sunCol.z);
    this.sunLight.intensity = 3.4 * sunVis;
    this.sunLight.position.copy(sunDir).multiplyScalar(400);
    this.sunLight.target.position.set(0, 0, 0);
    let hTop = new THREE.Color(0.02, 0.02, 0.025);
    let hBot = new THREE.Color(0.02, 0.02, 0.02);
    if (st.primary === 'EARTH' && camAlt < 60000) {
      hTop = new THREE.Color().copy(horizonCol).multiplyScalar(0.9).lerp(new THREE.Color(0.3, 0.42, 0.62), 0.4);
      hBot = new THREE.Color(0.24, 0.24, 0.18).multiplyScalar(0.4 + 0.6 * dayK);
    } else if (st.primary === 'EARTH' && camAlt < 3e7) {
      hBot = new THREE.Color(0.14, 0.2, 0.32).multiplyScalar(0.5 + 0.5 * Math.max(0, sunDir.dot(_v3.copy(camWorld).normalize())));
    } else if (st.primary === 'MOON') {
      hBot = new THREE.Color(0.16, 0.155, 0.15).multiplyScalar(Math.max(0.15, sunDir.dot(_v3.copy(camWorld).sub(sim.dyn.moonPos).normalize()) + 0.2));
    }
    this.hemi.color.copy(hTop);
    this.hemi.groundColor.copy(hBot);
    this.hemi.intensity = 1.1;
    const worldUp = st.primary === 'MOON' ? _v3.copy(camWorld).sub(sim.dyn.moonPos).normalize() : camUp;
    this.hemi.position.copy(worldUp);
    this._updateEnv(hTop, hBot, worldUp);
    // shadows follow the focus object
    if (this.sunLight.castShadow) {
      const focusDist = st.landed || sim.dyn.mode === 'PAD' ? 160 : v.hasSaturn ? 90 : 25;
      const sc = this.sunLight.shadow.camera;
      sc.left = sc.bottom = -focusDist;
      sc.right = sc.top = focusDist;
      sc.near = 1;
      sc.far = 900;
      sc.updateProjectionMatrix();
      this.sunLight.target.position.copy(center).sub(camWorld);
      this.sunLight.position.copy(this.sunLight.target.position).addScaledVector(sunDir, 450);
    }

    // ------------------------------------------------ vehicle + site
    this.vehicleRoot.position.copy(st.r).sub(camWorld);
    this.vehicleRoot.quaternion.copy(st.q);
    this.vehicleRoot.visible = mode !== 'cockpit';
    if (this.site) {
      const show = camAlt < 46000;
      this.site.group.visible = show;
      // blend the painted KSC ground into the Blue Marble globe while climbing
      this.site.uniforms.opacity.value = 1 - THREE.MathUtils.smoothstep(camAlt, 14000, 44000);
      if (show) {
        this.site.group.position.copy(pad.padPos).sub(camWorld);
        this.site.group.quaternion.copy(pad.padQ);
        const u = this.site.uniforms;
        u.sunDir.value.copy(sunDir);
        u.upW.value.copy(pad.up);
        u.time.value = this.time;
        u.fogColor.value.copy(horizonCol).multiplyScalar(0.9);
        u.fogDensity.value = 1 / (38000 + camAlt * 6);
        u.skyTint.value.copy(hTop);
        const t = sim.clock.get;
        // swing arms: CM access arm parked at T−5 min, the rest swing at T−0 (with a stagger)
        this.site.setArms((i) => (i === 8 ? Math.min(1, Math.max(0, (t + 300) / 30)) : Math.min(1, Math.max(0, (t + 0.5 - i * 0.12) / 6))));
      }
    }

    // ------------------------------------------------ plumes
    const vac = this._vac;
    const tSinceSicSep = this.time - this.events.sicSep;
    const rcsOn = v.cmd.rcsRot.lengthSq() + v.cmd.rcsTrans.lengthSq() > 0.02;
    const throttle = sat ? Math.min(1.1, satThrust / (sat.stage === 'SIC' ? 3.4e7 : sat.stage === 'SIB' ? 7.5e6 : sat.stage === 'SII' ? 5.1e6 : 1.0e6)) : 0;
    const spsOn = !!v.tm['CM.SPS.THRUST'];
    const dpsOn = !!v.tm['LM.DPS.FIRING'] && v.isAttached('lm');
    const apsOn = !!v.modules.lm?.apsFiring;
    const hideOwn = mode === 'cockpit';
    for (const p of this.plumes) {
      let on = false;
      let len = 1;
      let rad = 1;
      let k = 1;
      switch (p.group) {
        case 'main': {
          on = satThrust > 0;
          if (sat?.stage === 'SIB') {
            len = 17 * (1 + vac * 2.5);
            rad = 1.5 * (1 + vac * 2.2);
            k = 0.85 * throttle;
          } else if (sat?.stage === 'SIC') {
            len = PLUME_SPEC.F1.len * (1 + vac * 2.5);
            rad = PLUME_SPEC.F1.rad * (1 + vac * 2.2);
            k = 0.9 * throttle;
            // the centre engine shuts down at CECO
            if (p.anchor === this.model.nozzles.main[0] && sim.clock.get > 135.2) on = false;
          } else {
            len = PLUME_SPEC.J2.len * (0.8 + vac * 1.5);
            rad = PLUME_SPEC.J2.rad * (0.8 + vac * 2.5);
            k = 0.85 * Math.min(1, throttle * (sat?.stage === 'SII' ? 1.25 : 1));
            if (sat?.stage === 'SII' && p.anchor === this.model.nozzles.main[0] && sim.clock.get > (sat.siiCecoT ?? 1e9)) on = false;
          }
          break;
        }
        case 'column':
          on = satThrust > 0 && (sat?.stage === 'SIC' || sat?.stage === 'SIB');
          len = PLUME_SPEC.F1_COLUMN.len * (sat?.stage === 'SIB' ? 0.7 : 1) * (1 + vac * 3.5) * (0.92 + Math.random() * 0.12);
          rad = PLUME_SPEC.F1_COLUMN.rad * (sat?.stage === 'SIB' ? 0.62 : 1) * (1 + vac * 4.5);
          k = 0.75 * throttle * (1 - vac * 0.45);
          break;
        case 'sps':
          on = spsOn;
          len = PLUME_SPEC.SPS.len;
          rad = PLUME_SPEC.SPS.rad;
          k = 0.55;
          break;
        case 'dps':
          on = dpsOn;
          len = PLUME_SPEC.DPS.len * (0.5 + (v.cmd.dpsThrottle ?? 0.5));
          rad = PLUME_SPEC.DPS.rad;
          k = 0.45 + 0.3 * (v.cmd.dpsThrottle ?? 0.5);
          break;
        case 'aps':
          on = apsOn;
          len = PLUME_SPEC.APS.len;
          rad = PLUME_SPEC.APS.rad;
          k = 0.55;
          break;
        case 'sivbAps':
          on = sat?.stage === 'SIVB' && sim.clock.get - (sat.stageT ?? -1e9) < 3.5;
          len = 6;
          rad = 1.2;
          k = 0.7;
          break;
        case 'ullage':
          on = tSinceSicSep > 0 && tSinceSicSep < 3.6;
          len = PLUME_SPEC.ULLAGE.len * (1 + vac);
          rad = PLUME_SPEC.ULLAGE.rad * (1 + vac);
          k = 0.9;
          break;
        case 'les':
          on = !!sim.runner?.flags?.lesAbort;
          len = PLUME_SPEC.LES.len;
          rad = PLUME_SPEC.LES.rad;
          break;
        case 'rcs': {
          if (!rcsOn || (p.lm ? v.station !== 'LM' : v.station !== 'CM')) break;
          const rot = v.cmd.rcsRot;
          const tr = v.cmd.rcsTrans;
          const a = rot.lengthSq() > 0.01 ? p.torque.dot(_v.copy(rot).normalize()) : 0;
          const b = tr.lengthSq() > 0.01 ? p.force.dot(_v.copy(tr).normalize()) : 0;
          on = a > 0.45 || b > 0.6;
          len = PLUME_SPEC.RCS.len * (0.8 + Math.random() * 0.4);
          rad = PLUME_SPEC.RCS.rad;
          k = 0.8;
          break;
        }
        default:
          break;
      }
      p.set(on && !(hideOwn && p.group !== 'rcs'), len, rad, k, vac, this.time);
      if (hideOwn) p.mesh.visible = false;
    }

    // ------------------------------------------------ particles: steam, smoke, trail, dust
    this._emitParticles(dt, paused, { sat, satThrust, pad, sunDir, alt, throttle });
    const camPos = camWorld;
    const sunView = _v2.copy(sunDir).applyQuaternion(_q.copy(camQ).invert());
    const amb = nearEarth ? new THREE.Vector3(hTop.r, hTop.g, hTop.b).multiplyScalar(1.3).addScalar(0.08) : new THREE.Vector3(0.08, 0.08, 0.09);
    this.smoke.setLighting(sunView, new THREE.Vector3(1.25 * sunVis, 1.2 * sunVis, 1.1 * sunVis), amb);
    if (!paused) {
      this.smoke.update(dt * (sim.clock.effectiveWarp > 1 ? Math.min(sim.clock.effectiveWarp, 4) : 1), camPos);
      this.flames.update(dt, camPos);
    } else {
      this.smoke.update(0, camPos);
      this.flames.update(0, camPos);
    }

    // ------------------------------------------------ passive bodies
    this._syncBodies(dt);

    // ------------------------------------------------ lunar surface
    if (this.lunar) {
      this.lunar.update({ dyn: sim.dyn, camWorld, sunDir, dt, vehicle: v, time: this.time });
      const showT = st.primary === 'MOON' && camWorld.distanceTo(sim.dyn.moonPos) - R_MOON < 120000;
      this.lunar.group.visible = showT;
      if (this.dust) {
        this.dust.setLighting(sunView, new THREE.Vector3(1.4, 1.38, 1.32), new THREE.Vector3(0.05, 0.05, 0.05));
        this.dust.update(paused ? 0 : dt, camPos);
      }
      const dMoon = camWorld.distanceTo(sim.dyn.moonPos) - R_MOON;
      this.midCam.near = Math.max(0.5, Math.min(800, (dMoon - 50) * 0.3));
      this.midCam.far = Math.max(5e4, dMoon * 4 + 6e4);
      this.midCam.updateProjectionMatrix();
    }

    // near pass clipping: tight near plane when something is close
    const focusD = camWorld.distanceTo(center);
    const nearPlane = mode === 'cockpit' ? 0.5 : Math.max(0.15, Math.min(20, focusD * 0.02));
    if (Math.abs(this.nearCam.near - nearPlane) > 1e-3) {
      this.nearCam.near = nearPlane;
      this.nearCam.far = this.site?.group.visible ? 1.2e5 : 2e5;
      this.nearCam.updateProjectionMatrix();
    }
    this.farCam.near = Math.max(50, Math.min(1e5, (camAlt < 1e5 ? camAlt : camWorld.distanceTo(sim.dyn.moonPos) - R_MOON) * 0.2));
    this.farCam.updateProjectionMatrix();

    if (this._flash > 0) this._flash -= dt;
    if (this.cockpit) {
      this.cockpit.setActive(this.active && mode === 'cockpit');
      this.cockpit.update(dt, { sunDir, camQ, shake, paused });
    }
  }

  _sunOccluded(cam, sunDir) {
    // Earth / Moon blocking the Sun (ray-sphere test from the camera)
    const test = (center, radius) => {
      _v.copy(center).sub(cam);
      const t = _v.dot(sunDir);
      if (t < 0) return false;
      return _v.lengthSq() - t * t < radius * radius;
    };
    return test(_v3.set(0, 0, 0), R_EARTH) || test(this.sim.dyn.moonPos, R_MOON);
  }

  _emitParticles(dt, paused, { sat, satThrust, pad, alt }) {
    if (paused || dt <= 0) return;
    const sim = this.sim;
    const v = sim.vehicle;
    const st = v.state;
    const q = this.game.quality.particles;
    const t = sim.clock.get;
    const rnd = Math.random;
    const earthVel = (p, out) => out.set(-OMEGA * p.y, OMEGA * p.x, 0);
    // ---- pad: steam & smoke billowing north and south out of the flame trench
    if (this.site && sat && sat.ignited && st.primary === 'EARTH' && alt < 2500 && satThrust > 0) {
      const lift = Math.max(0, alt - 62);
      const k = Math.max(0, 1 - lift / 900);
      const rate = 34 * q * k * Math.min(1, (t + 9) / 2);
      this._padAcc = (this._padAcc ?? 0) + rate * dt;
      while (this._padAcc >= 1) {
        this._padAcc -= 1;
        const side = rnd() < 0.5 ? -1 : 1;
        const pos = this._padPoint((rnd() - 0.5) * 30, 8 + rnd() * 14, side * (90 + rnd() * 40), new THREE.Vector3());
        // fan out of the trench mouth: ±55° around north/south, slowing as it spreads
        const ang = (rnd() - 0.5) * 1.9;
        const sp = 12 + rnd() * 48;
        const vel = new THREE.Vector3()
          .addScaledVector(this._padNorth, -side * Math.cos(ang) * sp)
          .addScaledVector(this._padEast, Math.sin(ang) * sp)
          .addScaledVector(this._padUp, 1.5 + rnd() * 6);
        vel.add(earthVel(pos, _v));
        const steam = rnd() < 0.6;
        this.smoke.emit({
          pos,
          vel,
          life: 32 + rnd() * 26,
          size0: 26 + rnd() * 14,
          size1: 95 + rnd() * 75,
          alpha: steam ? 0.5 : 0.45,
          drag: 0.14,
          rise: this._padUp.clone().multiplyScalar(0.22),
          tint: steam ? [1, 1, 1] : [0.8, 0.76, 0.7],
          spin: 0.1,
        });
        // fire at the trench mouths during ignition
        if (rnd() < 0.35 && t < 6) {
          const fp = this._padPoint((rnd() - 0.5) * 16, 12, side * (70 + rnd() * 15), new THREE.Vector3());
          this.flames.emit({ pos: fp, vel: vel.clone().multiplyScalar(0.8), life: 1.1 + rnd(), size0: 14, size1: 40, alpha: 0.9, drag: 0.5, tint: [2.6, 1.3, 0.35] });
        }
      }
    }
    // ---- exhaust trail in the atmosphere
    if (sat && satThrust > 0 && v.isAttached('saturn') && st.primary === 'EARTH' && alt < 32000 && st.liftoff) {
      const dens = Math.exp(-alt / 9000);
      const rate = Math.min(140, 22 + st.speed / 5) * q * (0.4 + 0.6 * dens);
      this._trailAcc = (this._trailAcc ?? 0) + rate * dt;
      const back = _v2.copy(X).applyQuaternion(st.q).negate();
      const base = moduleTransform(v.config, v.config === 'SATURN_V' ? 'SIC' : v.config === 'SATURN_IB' ? 'SIB' : v.config === 'SATURN_IB_SIVB' ? 'SIVB' : 'SII').offset;
      const plumeLen = PLUME_SPEC.F1_COLUMN.len * (1 + this._vac * 3.5);
      while (this._trailAcc >= 1) {
        this._trailAcc -= 1;
        const along = plumeLen * (0.5 + rnd() * 0.6) + rnd() * st.speed * dt;
        const pos = new THREE.Vector3().copy(st.r).addScaledVector(back, -base.x + along);
        pos.add(new THREE.Vector3((rnd() - 0.5) * 6, (rnd() - 0.5) * 6, (rnd() - 0.5) * 6));
        const vel = earthVel(pos, new THREE.Vector3()).add(new THREE.Vector3((rnd() - 0.5) * 6, (rnd() - 0.5) * 6, (rnd() - 0.5) * 6));
        const grow = 1 + alt / 6000;
        this.smoke.emit({
          pos,
          vel,
          life: 45 + rnd() * 30,
          size0: 10 * grow,
          size1: (55 + rnd() * 45) * grow,
          alpha: 0.42 * (0.35 + 0.65 * dens),
          drag: 0.05,
          tint: [0.95, 0.93, 0.9],
        });
      }
    }
    // ---- lunar dust sheet under the DPS
    if (this.dust && v.tm['LM.DPS.FIRING'] && st.primary === 'MOON' && !st.landed && st.altTerrain < 45) {
      const k = 1 - st.altTerrain / 45;
      const rate = 160 * q * k;
      this._dustAcc = (this._dustAcc ?? 0) + rate * dt;
      const up = _v2.copy(st.rRel).normalize();
      const groundPt = _v3.copy(st.r).addScaledVector(up, -(st.altTerrain + 2.4));
      const e1 = new THREE.Vector3(1, 0, 0).cross(up).normalize();
      const e2 = new THREE.Vector3().crossVectors(up, e1);
      while (this._dustAcc >= 1) {
        this._dustAcc -= 1;
        const a = rnd() * Math.PI * 2;
        const dir = e1.clone().multiplyScalar(Math.cos(a)).addScaledVector(e2, Math.sin(a));
        const pos = groundPt.clone().addScaledVector(dir, 1 + rnd() * 4).addScaledVector(up, 0.3);
        const vel = dir.clone().multiplyScalar(40 + rnd() * 50).addScaledVector(up, 0.6 + rnd() * 1.5).add(sim.dyn.moonVel);
        this.dust.emit({ pos, vel, life: 1.6 + rnd() * 1.2, size0: 2, size1: 12 + rnd() * 10, alpha: 0.32 * k, drag: 0.02, tint: [0.85, 0.83, 0.8] });
      }
    }
  }

  /** Where the active camera looks (ECI unit vector), from where, and its vertical field of view (deg). */
  lookInfo() {
    return { dir: new THREE.Vector3(0, 0, -1).applyQuaternion(this.camQ), pos: this.camWorld.clone(), fov: this.nearCam.fov, aspect: this.nearCam.aspect };
  }

  /** Resolves with the next rendered frame as a JPEG data URL (in-game photographs). */
  capture() {
    return new Promise((resolve) => (this._captureQ ??= []).push(resolve));
  }

  render() {
    const r = this.game.renderer;
    const draw = (renderer) => {
      renderer.toneMappingExposure = this._flash > 0 ? 2.2 : 1.0;
      renderer.render(this.far, this.farCam);
      if (this.lunar?.group.visible) {
        renderer.clearDepth();
        renderer.render(this.mid, this.midCam);
      }
      renderer.clearDepth();
      renderer.render(this.near, this.nearCam);
      if (this.cameraMode === 'cockpit' && this.cockpit) {
        renderer.clearDepth();
        this.cockpit.render(renderer);
      }
    };
    if (this.post) this.post.render(draw, 1 / 60);
    else {
      r.setRenderTarget(null);
      r.setClearColor(0x000000, 1);
      r.clear();
      draw(r);
    }
    // the drawing buffer is still valid in this task: hand the frame to pending photographs
    if (this._captureQ?.length) {
      let url = null;
      try {
        url = r.domElement.toDataURL('image/jpeg', 0.9);
      } catch (err) {
        console.warn('[view] capture failed', err);
      }
      for (const f of this._captureQ.splice(0)) f(url);
    }
  }

  resize(w, h) {
    for (const c of [this.farCam, this.midCam, this.nearCam]) {
      if (!c) continue;
      c.aspect = w / h;
      c.updateProjectionMatrix();
    }
    this.post?.resize(w, h);
    this.cockpit?.resize(w, h);
  }

  dispose() {
    this.setActive(false);
    this.offs?.forEach((f) => f());
    window.removeEventListener('wheel', this._onWheel);
    this.game.canvas.removeEventListener('pointerdown', this._onDown);
    window.removeEventListener('pointermove', this._onMove);
    window.removeEventListener('pointerup', this._onUp);
    this.cockpit?.dispose();
    this.fadeEl?.remove();
    this.post?.dispose();
    this.site?.dispose();
    this.lunar?.dispose();
    this.stars?.dispose();
    this.earth?.dispose();
    this.moon?.dispose();
    this.sun?.dispose();
    this.sky?.dispose();
    this.smoke?.dispose();
    this.flames?.dispose();
    this.dust?.dispose();
    this._envRT?.dispose();
    this._pmrem?.dispose();
    for (const p of this.plumes ?? []) p.dispose();
    for (const id of [...this.bodyViews.keys()]) this._removeBody(id);
    for (const s of [this.near, this.mid]) s?.traverse((o) => o.geometry?.dispose?.());
  }
}

export { GEOM };
