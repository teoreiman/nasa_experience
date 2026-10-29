// Astronaut view: exterior rendering (Earth, Moon, Sun, stars, sky, launch site, vehicle, plumes,
// smoke) + the first-person cockpit pass. Three.js world axes = ECI axes, metres, rendered
// camera-relative: each frame objects are placed at (worldPos − cameraWorldPos).
// Passes: far (sky, stars, Earth, Moon) → near (vehicle, pad, ground, plumes) → cockpit.

import * as THREE from 'three';
import { R_EARTH, R_MOON, SITES_DEG, DEG } from '../core/constants.js';
import { store } from '../core/Store.js';
import { gmst, earthFixedToEci } from '../sim/physics/ephemeris.js';
import { buildConfigModel, createLaunchTower, createLM, createCSM } from './models/index.js';
import { moduleTransform } from '../sim/geometry.js';
import { CockpitView } from '../cockpit/CockpitView.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _camWorld = new THREE.Vector3();

const EARTH_VS = `
varying vec3 vN; varying vec2 vUv; varying vec3 vW;
void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const EARTH_FS = `
uniform sampler2D dayMap; uniform sampler2D nightMap; uniform sampler2D cloudMap; uniform sampler2D waterMap;
uniform vec3 sunDir; uniform float cloudShift;
varying vec3 vN; varying vec2 vUv; varying vec3 vW;
void main(){
  vec3 n = normalize(vN); vec3 v = normalize(-vW);
  float d = dot(n, sunDir);
  float day = smoothstep(-0.12, 0.18, d);
  vec3 dayC = texture2D(dayMap, vUv).rgb;
  float cl = texture2D(cloudMap, vUv + vec2(cloudShift, 0.0)).r;
  float water = texture2D(waterMap, vUv).r;
  vec3 col = mix(dayC, vec3(1.0), cl * 0.92) * (0.08 + 0.95 * max(d, 0.0));
  vec3 h = normalize(sunDir + v);
  col += water * (1.0 - cl) * pow(max(dot(n, h), 0.0), 60.0) * vec3(1.0, 0.92, 0.75) * 0.7 * day;
  vec3 night = texture2D(nightMap, vUv).rgb * vec3(1.0, 0.85, 0.6) * 1.6 * (1.0 - cl * 0.8);
  col = mix(night * 0.9, col, day);
  float fr = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  col += vec3(0.30, 0.55, 1.0) * fr * (0.15 + 0.85 * smoothstep(-0.2, 0.4, d));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;
const ATMO_FS = `
uniform vec3 sunDir; varying vec3 vN; varying vec3 vW;
void main(){
  vec3 n = normalize(vN); vec3 v = normalize(-vW);
  float rim = pow(1.0 - abs(dot(n, v)), 2.5);
  float lit = smoothstep(-0.3, 0.5, dot(n, sunDir));
  gl_FragColor = vec4(vec3(0.35, 0.6, 1.0) * rim * lit * 1.4, rim * lit);
}`;
const SKY_FS = `
uniform vec3 up; uniform vec3 sunDir; uniform float density; varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);
  float e = dot(d, up);
  float sunUp = dot(sunDir, up);
  vec3 zen = vec3(0.10, 0.32, 0.78); vec3 hor = vec3(0.62, 0.78, 0.95);
  vec3 c = mix(hor, zen, pow(clamp(e, 0.0, 1.0), 0.45));
  float s = max(dot(d, sunDir), 0.0);
  c += vec3(1.0, 0.85, 0.6) * (pow(s, 600.0) * 4.0 + pow(s, 8.0) * 0.25);
  c *= clamp(sunUp * 3.0 + 0.35, 0.05, 1.0);
  float below = smoothstep(0.02, -0.08, e);
  c = mix(c, vec3(0.5, 0.6, 0.7) * clamp(sunUp * 2.0 + 0.3, 0.05, 1.0), below * 0.6);
  gl_FragColor = vec4(c, density * (1.0 - below * 0.3));
  #include <colorspace_fragment>
}`;
const PLUME_VS = 'varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }';
const PLUME_FS = `
uniform float intensity; uniform float vac; uniform float time; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main(){
  float along = clamp(vUv.y, 0.0, 1.0);
  float facing = abs(dot(normalize(vN), normalize(vV)));
  float flick = 0.85 + 0.15 * sin(time * 40.0 + along * 30.0);
  float a = pow(facing, 1.6) * pow(along, 0.8) * intensity * flick * mix(1.0, 0.45, vac);
  vec3 c = mix(vec3(1.0, 0.38, 0.06), vec3(1.0, 0.92, 0.65), pow(along, 3.0) * facing);
  gl_FragColor = vec4(c * 2.4, a);
}`;

function groundTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d');
  // KSC area: land (green/brown marsh) west, Atlantic east (+x of the canvas), Banana River inlet
  g.fillStyle = '#516b45';
  g.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 4000; i++) {
    g.fillStyle = `rgba(${60 + Math.random() * 60},${80 + Math.random() * 50},${40 + Math.random() * 30},0.35)`;
    g.fillRect(Math.random() * 1024, Math.random() * 1024, 4 + Math.random() * 14, 4 + Math.random() * 14);
  }
  g.fillStyle = '#2b4a6b';
  g.beginPath();
  g.moveTo(610, 0);
  for (let y = 0; y <= 1024; y += 32) g.lineTo(600 + Math.sin(y / 90) * 20 + y * 0.05, y);
  g.lineTo(1024, 1024);
  g.lineTo(1024, 0);
  g.fill();
  g.fillStyle = '#c9c1a2';
  for (let y = 0; y <= 1024; y += 4) g.fillRect(596 + Math.sin(y / 90) * 20 + y * 0.05, y, 6, 4);
  g.fillStyle = '#35506a';
  g.fillRect(380, 0, 40, 1024);
  // crawlerway + pad
  g.fillStyle = '#b9b3a1';
  g.fillRect(300, 512, 212, 8);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
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
    const st = sim.vehicle.state;
    this.cameraMode = observer ? (sim.dyn.mode === 'PAD' ? 'pad:far' : 'exterior:chase') : 'cockpit';
    this.active = false;
    this.cockpit = null;
    this.shakeAmt = 0;
    this.orbit = { yaw: -0.35, pitch: 0.12, dist: 60 };
    this._partsSig = '';
    this.fadeEl = null;
    this.particles = [];
  }

  async init() {
    const { game, sim } = this;
    const q = game.quality;
    this.far = new THREE.Scene();
    this.near = new THREE.Scene();
    this.farCam = new THREE.PerspectiveCamera(store.settings.fov ?? 70, game.width / game.height, 50, 2e9);
    this.nearCam = new THREE.PerspectiveCamera(store.settings.fov ?? 70, game.width / game.height, 0.3, 4e5);
    this.camQ = new THREE.Quaternion();

    const tex = async (n, o) => game.assets.texture(n, o).catch(() => null);
    const [day, night, clouds, water, moonTex] = await Promise.all([
      tex('earth_day', { sizes: ['4k', '2k'] }),
      tex('earth_night_2k'),
      tex('earth_clouds_2k', { srgb: false }),
      tex('earth_water_2k', { srgb: false }),
      tex('moon_color', { sizes: ['4k', '2k'] }),
    ]);
    for (const t of [clouds]) if (t) t.wrapS = THREE.RepeatWrapping;

    // sky dome (far pass, first)
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: { up: { value: new THREE.Vector3(0, 0, 1) }, sunDir: { value: new THREE.Vector3(1, 0, 0) }, density: { value: 1 } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = (modelMatrix * vec4(position, 0.0)).xyz; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position,1.0); }',
      fragmentShader: SKY_FS,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1e8, 32, 16), this.skyMat);
    this.sky.renderOrder = 2;

    // stars
    const n = 4000;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) {
      const z = rnd() * 2 - 1;
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(1 - z * z);
      pos.set([r * Math.cos(a) * 1e9, r * Math.sin(a) * 1e9, z * 1e9], i * 3);
      const b = Math.pow(rnd(), 6) * 0.9 + 0.12;
      const tint = rnd();
      col.set([b * (tint > 0.8 ? 1 : 0.85), b * 0.9, b * (tint < 0.2 ? 0.8 : 1)], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.starMat = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false });
    this.stars = new THREE.Points(sg, this.starMat);
    this.stars.renderOrder = 0;

    // Earth
    this.earthMat = new THREE.ShaderMaterial({
      uniforms: { dayMap: { value: day }, nightMap: { value: night }, cloudMap: { value: clouds }, waterMap: { value: water }, sunDir: { value: new THREE.Vector3(1, 0, 0) }, cloudShift: { value: 0 } },
      vertexShader: EARTH_VS,
      fragmentShader: EARTH_FS,
    });
    const eg = new THREE.SphereGeometry(R_EARTH, 128, 96);
    eg.rotateX(Math.PI / 2);
    this.earth = new THREE.Mesh(eg, this.earthMat);
    this.earth.renderOrder = 1;
    const ag = new THREE.SphereGeometry(R_EARTH * 1.025, 96, 64);
    this.atmo = new THREE.Mesh(ag, new THREE.ShaderMaterial({ uniforms: { sunDir: this.earthMat.uniforms.sunDir }, vertexShader: EARTH_VS, fragmentShader: ATMO_FS, side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.atmo.renderOrder = 1;

    // Moon
    const mg = new THREE.SphereGeometry(R_MOON, 96, 64);
    mg.rotateX(Math.PI / 2);
    this.moon = new THREE.Mesh(mg, new THREE.MeshStandardMaterial({ map: moonTex, roughness: 1, metalness: 0 }));

    // Sun
    const sc = document.createElement('canvas');
    sc.width = sc.height = 128;
    const sg2 = sc.getContext('2d');
    const grd = sg2.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.12, 'rgba(255,250,235,1)');
    grd.addColorStop(0.3, 'rgba(255,220,160,0.35)');
    grd.addColorStop(1, 'rgba(255,200,120,0)');
    sg2.fillStyle = grd;
    sg2.fillRect(0, 0, 128, 128);
    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(sc), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.sunSprite.scale.setScalar(6e7);
    this.sunSprite.renderOrder = 3;

    this.sunLightFar = new THREE.DirectionalLight(0xffffff, 3.2);
    this.far.add(this.sunLightFar, this.sunLightFar.target, new THREE.AmbientLight(0x404858, 0.15));
    this.far.add(this.stars, this.earth, this.atmo, this.moon, this.sky, this.sunSprite);

    // near scene lights
    this.sunLight = new THREE.DirectionalLight(0xfff4e6, 3.4);
    this.hemi = new THREE.HemisphereLight(0xb8d4ff, 0x6a6650, 0.9);
    this.near.add(this.sunLight, this.sunLight.target, this.hemi);

    // launch site (local tangent frame at LC-39A)
    this.site = new THREE.Group();
    const gtex = groundTexture();
    const ground = new THREE.Mesh(new THREE.CircleGeometry(60000, 64), new THREE.MeshStandardMaterial({ map: gtex, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -8;
    this.site.add(ground);
    const apron = new THREE.Mesh(new THREE.CircleGeometry(160, 8), new THREE.MeshStandardMaterial({ color: 0xb4b0a6, roughness: 0.95 }));
    apron.rotation.x = -Math.PI / 2;
    apron.position.y = -7.9;
    this.site.add(apron);
    const trench = new THREE.Mesh(new THREE.PlaneGeometry(18, 140), new THREE.MeshStandardMaterial({ color: 0x2a2724, roughness: 1 }));
    trench.rotation.x = -Math.PI / 2;
    trench.position.y = -7.85;
    this.site.add(trench);
    this.tower = createLaunchTower();
    this.site.add(this.tower);
    const vab = new THREE.Mesh(new THREE.BoxGeometry(160, 160, 218), new THREE.MeshStandardMaterial({ color: 0xd9d6cc, roughness: 0.9 }));
    vab.position.set(-5200, 72, 1800);
    this.site.add(vab);
    this.near.add(this.site);

    // smoke particles (world-fixed, recycled)
    const PN = Math.round(1400 * q.particles);
    this.smoke = { n: PN, pos: new Float32Array(PN * 3), age: new Float32Array(PN).fill(99), world: Array.from({ length: PN }, () => new THREE.Vector3()), vel: Array.from({ length: PN }, () => new THREE.Vector3()), next: 0 };
    const smg = new THREE.BufferGeometry();
    smg.setAttribute('position', new THREE.BufferAttribute(this.smoke.pos, 3));
    smg.setAttribute('age', new THREE.BufferAttribute(this.smoke.age, 1));
    this.smokeMat = new THREE.ShaderMaterial({
      uniforms: { scale: { value: game.height } },
      vertexShader: 'attribute float age; varying float vA; uniform float scale; void main(){ vA = age; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = min(1400.0, (30.0 + age * 14.0) * scale / -mv.z); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'varying float vA; void main(){ vec2 p = gl_PointCoord - 0.5; float d = length(p); if (d > 0.5) discard; float a = smoothstep(0.5, 0.1, d) * clamp(1.0 - vA / 40.0, 0.0, 1.0) * clamp(vA * 2.0, 0.0, 1.0) * 0.55; gl_FragColor = vec4(vec3(0.82, 0.8, 0.77) * (0.7 + 0.3 * (1.0 - d)), a); }',
      transparent: true,
      depthWrite: false,
    });
    this.smokePts = new THREE.Points(smg, this.smokeMat);
    this.smokePts.frustumCulled = false;
    this.near.add(this.smokePts);

    // plume material
    this.plumeMat = new THREE.ShaderMaterial({
      uniforms: { intensity: { value: 1 }, vac: { value: 0 }, time: { value: 0 } },
      vertexShader: PLUME_VS,
      fragmentShader: PLUME_FS,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const pg = new THREE.ConeGeometry(1, 1, 20, 1, true);
    pg.translate(0, -0.5, 0);
    pg.rotateZ(-Math.PI / 2); // tip at origin, cone opens toward −X
    this.plumeGeo = pg;
    this.plumeGlow = new THREE.PointLight(0xffa040, 0, 900, 2);
    this.near.add(this.plumeGlow);

    this.vehicleRoot = new THREE.Group();
    this.near.add(this.vehicleRoot);
    this.bodyRoots = new Map();
    this._rebuildVehicle();

    this.offs = [
      sim.bus.on('vehicle:config', () => this._rebuildVehicle()),
      sim.bus.on('vehicle:station', () => this._makeCockpit()),
      sim.bus.on('mission:highlight', ({ ids }) => this.cockpit?.highlight(ids)),
      sim.bus.on('vehicle:event', (e) => this._onEvent(e)),
    ];
    if (!this.observer) await this._makeCockpit();

    // input: mouse orbit for exterior cameras
    this._onWheel = (e) => {
      if (!this.active || this.cameraMode === 'cockpit') return;
      this.orbit.dist = Math.max(15, Math.min(4000, this.orbit.dist * (e.deltaY > 0 ? 1.12 : 0.89)));
    };
    window.addEventListener('wheel', this._onWheel, { passive: true });
    this._drag = null;
    this._onDown = (e) => {
      if (this.cameraMode !== 'cockpit' && e.target === game.canvas) this._drag = { x: e.clientX, y: e.clientY };
    };
    this._onMove = (e) => {
      if (!this._drag) return;
      this.orbit.yaw -= (e.clientX - this._drag.x) * 0.006;
      this.orbit.pitch = Math.max(-1.4, Math.min(1.4, this.orbit.pitch + (e.clientY - this._drag.y) * 0.006));
      this._drag = { x: e.clientX, y: e.clientY };
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

  _rebuildVehicle() {
    const v = this.sim.vehicle;
    this.vehicleRoot.clear();
    const model = buildConfigModel(v.config, v.parts);
    this.vehicleRoot.add(model.root);
    this.model = model;
    this.plumes = [];
    for (const nz of [...model.nozzles.main, ...model.nozzles.sps, ...model.nozzles.dps]) {
      const p = new THREE.Mesh(this.plumeGeo, this.plumeMat);
      p.visible = false;
      nz.add(p);
      this.plumes.push({ mesh: p, kind: model.nozzles.main.includes(nz) ? 'main' : model.nozzles.sps.includes(nz) ? 'sps' : 'dps' });
    }
    this._partsSig = JSON.stringify(v.parts);
  }

  _onEvent(e) {
    const st = this.sim.vehicle.state;
    if (['SIC_SEP', 'SII_SEP', 'LES_JETT', 'CSM_SEP', 'CM_SM_SEP'].includes(e.kind)) {
      this.flash(0.25);
      // spawn falling debris for the jettisoned part
      let obj = null;
      if (e.kind === 'LES_JETT') {
        obj = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 10, 8), new THREE.MeshStandardMaterial({ color: 0xc0431c }));
        obj.rotation.z = Math.PI / 2;
      } else if (e.kind === 'SIC_SEP') {
        obj = new THREE.Group();
        const c = new THREE.Mesh(new THREE.CylinderGeometry(5.03, 5.03, 42, 32), new THREE.MeshStandardMaterial({ color: 0xeeeeea }));
        c.rotation.z = Math.PI / 2;
        c.position.x = -21;
        obj.add(c);
      } else if (e.kind === 'SII_SEP') {
        obj = new THREE.Mesh(new THREE.CylinderGeometry(5.03, 5.03, 24, 32), new THREE.MeshStandardMaterial({ color: 0xeeeeea }));
        obj.rotation.z = Math.PI / 2;
      }
      if (obj) {
        const g = new THREE.Group();
        g.add(obj);
        this.near.add(g);
        const back = new THREE.Vector3(e.kind === 'LES_JETT' ? 12 : -30, 0, 0).applyQuaternion(st.q);
        this.debris = this.debris ?? [];
        this.debris.push({ g, r: st.r.clone().add(back), v: st.v.clone().addScaledVector(back.clone().normalize(), e.kind === 'LES_JETT' ? 40 : -8), q: st.q.clone(), spin: (Math.random() - 0.5) * 0.4, ttl: 40 });
      }
    }
  }

  setActive(on) {
    this.active = on;
    this.game.input.setContext('flight', on && !this.observer);
    this.cockpit?.setActive(on && this.cameraMode === 'cockpit');
  }

  // ---- facade used by missions (ctx.view)
  setCamera(mode) {
    if (this.observer && mode === 'cockpit') mode = 'exterior:chase';
    this.cameraMode = mode;
    this.cockpit?.setActive(this.active && mode === 'cockpit');
    this.sim.bus.emit('view:camera', { mode });
  }

  cycleCamera() {
    const modes = this.observer ? ['exterior:chase', 'pad:far', 'exterior:wide'] : ['cockpit', 'exterior:chase', 'pad:far', 'exterior:wide'];
    const usable = modes.filter((m) => m !== 'pad:far' || this.sim.vehicle.state.alt < 60000);
    const i = usable.indexOf(this.cameraMode);
    this.setCamera(usable[(i + 1) % usable.length]);
  }

  shake(amount = 1, seconds = 1) {
    this.shakeAmt = Math.max(this.shakeAmt, amount);
    this.shakeT = seconds;
  }

  fade(toBlack, seconds = 1) {
    if (!this.fadeEl) {
      this.fadeEl = document.createElement('div');
      this.fadeEl.style.cssText = 'position:fixed;inset:0;background:#000;pointer-events:none;opacity:0;transition:opacity 1s;z-index:50';
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

  // ---- frame
  _readControls() {
    const { input } = this.game;
    const v = this.sim.vehicle;
    const c = v.controls;
    c.rhc.set(input.axis('roll'), input.axis('pitch'), input.axis('yaw'));
    c.thc.set(input.axis('transX'), input.axis('transY'), input.axis('transZ'));
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

  update(dt, paused) {
    const { sim, game } = this;
    const v = sim.vehicle;
    const st = v.state;
    if (this.active && !paused) {
      if (!this.observer) this._readControls();
      else if (game.input.pressed('cameraNext') || game.input.pressed('camera')) this.cycleCamera();
    }
    const sig = JSON.stringify(v.parts);
    if (sig !== this._partsSig) this._rebuildVehicle();

    const utc = sim.clock.utcMs;
    const sunDir = sim.dyn.sunDir;
    const up = _v.copy(st.r).normalize();
    const alt = Math.max(0, st.alt);

    // pad local frame (earth-fixed): +Y up, -Z north, +X east
    const s = SITES_DEG.LC39A;
    const padPos = earthFixedToEci(s.lat * DEG, s.lon * DEG, 0, utc, new THREE.Vector3());
    const padUp = padPos.clone().normalize();
    const padEast = new THREE.Vector3(-padUp.y, padUp.x, 0).normalize();
    const padNorth = new THREE.Vector3().crossVectors(padUp, padEast);
    _m.makeBasis(padEast, padUp, padNorth.clone().negate());
    const padQ = new THREE.Quaternion().setFromRotationMatrix(_m);

    // camera world pose
    const camQ = this.camQ;
    const shakeOn = store.settings.cameraShake !== false;
    let shake = 0;
    const sat = v.modules.saturn;
    if (sat && sat.thrust > 0 && alt < 30000) shake = 0.012 * Math.min(1, sat.thrust / 3e7) * (alt < 2000 ? 1.6 : 1) + st.dynPressure / 3e6;
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      shake += 0.01 * this.shakeAmt;
    }
    if (!shakeOn) shake = 0;
    if (this.cameraMode === 'cockpit' && this.cockpit) {
      const eye = this.cockpit.getEyeTransform();
      const module = v.station === 'LM' ? (v.config === 'LM_ASC' ? 'LM_ASC' : v.config.includes('LM_DOCKED') || v.config === 'CSM_LM' ? 'LM_DOCKED' : 'LM') : v.config === 'CM' ? 'CM' : v.config.includes('CSM_DOCKED_TOP') ? 'CSM_DOCKED_TOP' : 'CSM';
      let mt;
      try {
        mt = moduleTransform(v.config, module);
      } catch {
        mt = { offset: new THREE.Vector3(), quat: new THREE.Quaternion() };
      }
      _v2.copy(eye.position).applyQuaternion(mt.quat).add(mt.offset).applyQuaternion(st.q);
      _camWorld.copy(st.r).add(_v2);
      camQ.copy(st.q).multiply(mt.quat).multiply(eye.quaternion);
      if (shake) camQ.multiply(_q.setFromEuler(new THREE.Euler((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake)));
    } else if (this.cameraMode === 'pad:far' && alt < 80000) {
      // tracking camera ~1.6 km west-southwest of the pad
      const camPos = padPos.clone().addScaledVector(padEast, 300).addScaledVector(padNorth, -1700).addScaledVector(padUp, 6);
      _camWorld.copy(camPos);
      const look = _v2.copy(st.r).sub(camPos).normalize();
      _m.lookAt(new THREE.Vector3(), look, padUp);
      camQ.setFromRotationMatrix(_m);
      this.nearCam.fov = Math.max(1.2, Math.min(55, 2 * Math.atan(80 / Math.max(1, st.r.distanceTo(camPos))) * 57.3 * 1.6));
    } else {
      const dist = this.cameraMode === 'exterior:wide' ? this.orbit.dist * 6 : v.hasSaturn ? Math.max(this.orbit.dist, 150) : this.orbit.dist;
      const local = new THREE.Vector3(Math.cos(this.orbit.pitch) * Math.cos(this.orbit.yaw), Math.cos(this.orbit.pitch) * Math.sin(this.orbit.yaw), Math.sin(this.orbit.pitch)).multiplyScalar(dist);
      // orbit around the vehicle in a frame aligned with the local vertical (nice horizon)
      const east = new THREE.Vector3(-up.y, up.x, 0).normalize();
      const north = new THREE.Vector3().crossVectors(up, east);
      _m.makeBasis(east, north, up);
      local.applyMatrix4(_m);
      const target = v.hasSaturn ? new THREE.Vector3(30, 0, 0).applyQuaternion(st.q).add(st.r) : st.r.clone();
      _camWorld.copy(target).add(local);
      const look = _v2.copy(target).sub(_camWorld).normalize();
      _m.lookAt(new THREE.Vector3(), look, up);
      camQ.setFromRotationMatrix(_m);
      if (shake) camQ.multiply(_q.setFromEuler(new THREE.Euler((Math.random() - 0.5) * shake * 0.3, (Math.random() - 0.5) * shake * 0.3, 0)));
    }
    if (this.cameraMode !== 'pad:far') this.nearCam.fov = store.settings.fov ?? 70;
    this.nearCam.updateProjectionMatrix();
    this.farCam.fov = this.nearCam.fov;
    this.farCam.updateProjectionMatrix();
    for (const c of [this.farCam, this.nearCam]) {
      c.position.set(0, 0, 0);
      c.quaternion.copy(camQ);
    }

    // far objects
    const camAlt = _camWorld.length() - R_EARTH;
    this.earth.position.copy(_camWorld).negate();
    this.earth.rotation.set(0, 0, gmst(utc));
    this.atmo.position.copy(this.earth.position);
    this.earthMat.uniforms.sunDir.value.copy(sunDir);
    this.earthMat.uniforms.cloudShift.value = (sim.clock.get / 86400) * 0.02;
    this.moon.position.copy(sim.dyn.moonPos).sub(_camWorld);
    const mp = sim.dyn.moonPos;
    this.moon.rotation.set(0, 0, Math.atan2(-mp.y, -mp.x));
    this.sunSprite.position.copy(sunDir).multiplyScalar(9e8);
    this.sunLightFar.position.copy(sunDir).multiplyScalar(1e6);
    this.stars.position.set(0, 0, 0);
    // sky
    const camUp = _v2.copy(_camWorld).normalize();
    const density = Math.max(0, Math.min(1, 1 - camAlt / 60000)) ** 1.5;
    this.skyMat.uniforms.up.value.copy(camUp);
    this.skyMat.uniforms.sunDir.value.copy(sunDir);
    this.skyMat.uniforms.density.value = density;
    this.sky.visible = density > 0.01;
    const sunUp = sunDir.dot(camUp);
    this.starMat.opacity = Math.max(0, 1 - density * Math.max(0, sunUp * 4 + 1.2));
    this.atmo.visible = camAlt > 15000;

    // near objects
    this.sunLight.position.copy(sunDir).multiplyScalar(1000);
    this.sunLight.target.position.set(0, 0, 0);
    this.hemi.intensity = 0.2 + 0.9 * density;
    this.vehicleRoot.position.copy(st.r).sub(_camWorld);
    this.vehicleRoot.quaternion.copy(st.q);
    this.vehicleRoot.visible = !(this.cameraMode === 'cockpit');
    this.site.visible = camAlt < 120000;
    if (this.site.visible) {
      this.site.position.copy(padPos).sub(_camWorld);
      this.site.quaternion.copy(padQ);
      // swing arms retract during the last minutes, tower stays
      const arms = this.tower.userData.arms;
      const t = sim.clock.get;
      arms.forEach((a, i) => {
        const tr = i === 6 ? -300 : -15 + i * 1.2;
        const k = Math.max(0, Math.min(1, (t - tr) / 6));
        a.rotation.y = k * 1.3;
      });
    }

    // plumes
    let thrustK = 0;
    if (sat && sat.thrust > 0 && v.isAttached('saturn')) thrustK = Math.min(1.2, sat.thrust / 3.4e7 + 0.35);
    const vac = Math.min(1, alt / 50000);
    const spsOn = !!v.tm['CM.SPS.THRUST'];
    const dpsOn = v.cmd.dps;
    for (const p of this.plumes) {
      let on = false;
      let len = 1;
      let rad = 1;
      if (p.kind === 'main' && thrustK > 0) {
        on = true;
        const stageScale = v.config === 'SATURN_V' ? 1 : v.config === 'SATURN_V_SII' ? 0.55 : 0.45;
        len = (60 + 60 * vac) * stageScale * (0.9 + Math.random() * 0.2);
        rad = (2.2 + 14 * vac) * stageScale;
      } else if (p.kind === 'sps' && spsOn) {
        on = true;
        len = 14;
        rad = 3.5;
      } else if (p.kind === 'dps' && dpsOn) {
        on = true;
        len = 8 * (0.4 + v.cmd.dpsThrottle);
        rad = 2.2;
      }
      p.mesh.visible = on && this.cameraMode !== 'cockpit';
      p.mesh.scale.set(len, rad, rad);
    }
    this.plumeMat.uniforms.intensity.value = 0.85;
    this.plumeMat.uniforms.vac.value = vac;
    this.plumeGlow.intensity = thrustK > 0 && alt < 3000 ? 6e4 * thrustK : 0;
    this.plumeMat.uniforms.time.value += dt;
    if (this.plumeGlow.intensity) {
      this.plumeGlow.position.copy(new THREE.Vector3(-20, 0, 0).applyQuaternion(st.q)).add(st.r).sub(_camWorld);
    }

    // smoke: emitted at the base while thrusting low in the atmosphere; flame-trench clouds on the pad
    const sm = this.smoke;
    const emitRate = thrustK > 0 && alt < 25000 ? (st.liftoff ? 90 : 60) * game.quality.particles : 0;
    this._emitAcc = (this._emitAcc ?? 0) + emitRate * dt;
    const base = _v2.set(-2, 0, 0);
    while (this._emitAcc >= 1) {
      this._emitAcc -= 1;
      const i = sm.next;
      sm.next = (sm.next + 1) % sm.n;
      sm.age[i] = 0;
      const w = sm.world[i];
      const vel = sm.vel[i];
      if (!st.liftoff || alt < 150) {
        // trench exhaust: billows sideways north and south from the flame deflector
        w.copy(padPos).addScaledVector(padUp, 2).addScaledVector(padNorth, (Math.random() < 0.5 ? -1 : 1) * (20 + Math.random() * 40));
        vel.copy(padNorth).multiplyScalar((w.clone().sub(padPos).dot(padNorth) > 0 ? 1 : -1) * (25 + Math.random() * 25)).addScaledVector(padUp, 4 + Math.random() * 10).addScaledVector(padEast, (Math.random() - 0.5) * 20);
      } else {
        w.copy(base).applyQuaternion(st.q).add(st.r).addScaledVector(_v.copy(st.v).normalize(), -40 - Math.random() * 40);
        vel.set((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6);
      }
      vel.add(new THREE.Vector3(-7.2921159e-5 * w.y, 7.2921159e-5 * w.x, 0)); // co-rotate with Earth
    }
    for (let i = 0; i < sm.n; i++) {
      if (sm.age[i] > 60) {
        sm.pos[i * 3] = 1e9;
        continue;
      }
      sm.age[i] += dt;
      const w = sm.world[i];
      sm.vel[i].multiplyScalar(1 - Math.min(1, dt * 0.25));
      w.addScaledVector(sm.vel[i], dt);
      sm.pos[i * 3] = w.x - _camWorld.x;
      sm.pos[i * 3 + 1] = w.y - _camWorld.y;
      sm.pos[i * 3 + 2] = w.z - _camWorld.z;
    }
    this.smokePts.geometry.attributes.position.needsUpdate = true;
    this.smokePts.geometry.attributes.age.needsUpdate = true;
    this.smokeMat.uniforms.scale.value = game.height / (2 * Math.tan((this.nearCam.fov * Math.PI) / 360));

    // debris
    if (this.debris) {
      for (const d of this.debris) {
        d.ttl -= dt;
        const g = -9.8 * dt;
        d.v.addScaledVector(_v.copy(d.r).normalize(), g * 0.6);
        d.r.addScaledVector(d.v, dt);
        d.q.multiply(_q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), d.spin * dt));
        d.g.position.copy(d.r).sub(_camWorld);
        d.g.quaternion.copy(d.q);
        d.g.visible = this.cameraMode !== 'cockpit' || true;
      }
      this.debris = this.debris.filter((d) => {
        if (d.ttl > 0) return true;
        this.near.remove(d.g);
        return false;
      });
    }

    if (this._flash > 0) this._flash -= dt;
    if (this.cockpit) {
      this.cockpit.setActive(this.active && this.cameraMode === 'cockpit');
      this.cockpit.update(dt, { sunDir, camQ, shake, paused });
    }
  }

  render() {
    const r = this.game.renderer;
    r.setRenderTarget(null);
    r.setClearColor(0x000000, 1);
    r.toneMappingExposure = this._flash > 0 ? 2.5 : 1.0;
    r.clear();
    r.render(this.far, this.farCam);
    r.clearDepth();
    r.render(this.near, this.nearCam);
    if (this.cameraMode === 'cockpit' && this.cockpit) {
      r.clearDepth();
      this.cockpit.render(r);
    }
  }

  resize(w, h) {
    for (const c of [this.farCam, this.nearCam]) {
      if (!c) continue;
      c.aspect = w / h;
      c.updateProjectionMatrix();
    }
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
    for (const s of [this.far, this.near]) s?.traverse((o) => {
      o.geometry?.dispose?.();
      if (o.material) [].concat(o.material).forEach((m) => m.dispose?.());
    });
  }
}
