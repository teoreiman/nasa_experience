// Controller view: first-person Mission Operations Control Room (MOCR-2, Building 30, Houston).
// The player starts seated at their console (chapter.controllerRole): three live CRTs, the sloped
// keyboard shelf (display-request keys, voice-loop keyset, GO / NO GO and message-response keys) and,
// over the consoles in front, the wall of projection screens: ground track / Earth–Moon plot, the
// spacecraft TV, event board, vehicle status, consumables and the GMT / GET clocks. Tap or click a
// CRT (or use the side buttons / keys 1–5) to lean in and read it; stand up (E) to walk the tiers
// and sit at any other console. NPC controllers idle, talk on the loop and answer polls.
//
// Facade used by PlayScene / missions: init, setActive, sitAt, stand, setCamera, shake, fade,
// flash, highlight, update, render, resize, dispose, tvView (shared spacecraft TV FlightView).

import * as THREE from 'three';
import { store } from '../core/Store.js';
import { h } from '../core/dom.js';
import { icon } from '../ui/components.js';
import { MOCR_CONSOLES } from '../missions/MissionRunner.js';
import { MOCRData } from './MOCRData.js';
import { buildRoom, ROOM, ROWS, CONSOLE_LOCAL, floorHeight, nameplateTexture } from './room.js';
import { createController } from './people.js';
import { MainPlot, Board, ClockStrip } from './wall.js';
import { drawPage, CONSOLE_PAGES, PAGES } from './consoles/pages.js';
import { buildConsolePanel, CONSOLE_PANEL_SIZE } from './consoles/index.js';
import { PanelMesh } from '../cockpit/interaction/PanelMesh.js';
import { PanelInteractor } from '../cockpit/interaction/PanelInteractor.js';
import { createPostFX } from '../render/effects/PostFX.js';

const D = Math.PI / 180;
const FOCI = ['seat', 'crt0', 'crt1', 'crt2', 'keys', 'wall'];
const FOCUS_ES = { seat: 'Consola', crt0: 'Pantalla 1', crt1: 'Pantalla 2', crt2: 'Pantalla 3', keys: 'Teclado', wall: 'Pantallas grandes' };
const WALK_EYE = 1.68;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _UP = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();

// tm key prefix → CRT page that shows it (mission evidence highlights)
const EVIDENCE_PAGE = [
  [/^CM\.CRYO|O2_FLOW/, 'CRYO'],
  [/^CM\.EPS/, 'EPS'],
  [/^CM\.ECS/, 'ECS'],
  [/^CM\.(GNC|FDAI|RCS|SPS)/, 'GNC'],
  [/^LM\.EPS/, 'LMEPS'],
  [/^LM\.ECS/, 'LMECS'],
  [/^LM\.(DPS|APS|GNC|RCS|ENG)/, 'LMPROP'],
  [/^(SAT\.|CM\.LV)/, 'BOOST'],
  [/^CM\.TLM|COMM/, 'COMM'],
];

const TV_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const TV_FRAG = /* glsl */ `
  uniform sampler2D map; uniform float time; uniform float signal; uniform float hasMap;
  varying vec2 vUv;
  float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
  void main(){
    vec2 uv = vUv;
    uv.x += (rnd(vec2(floor(uv.y * 240.0), floor(time * 30.0))) - 0.5) * 0.004 * (1.4 - signal);
    vec3 c = hasMap > 0.5 ? texture2D(map, uv).rgb : vec3(0.0);
    c = c / (c + 0.65) * 1.25;                    // soft tone curve (the feed is linear HDR)
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(vec3(l), c, 0.55);                    // washed-out 1969 colour TV
    c *= 0.9 + 0.1 * sin(vUv.y * 900.0);          // scanlines
    float n = rnd(vUv * 600.0 + time) - 0.5;
    c += n * (0.05 + (1.0 - signal) * 0.5);
    if (hasMap < 0.5) c = vec3(0.12 + n * 0.5);     // snow until the feed is up
    vec2 d = vUv - 0.5;
    c *= 1.0 - dot(d, d) * 0.9;
    gl_FragColor = vec4(c * vec3(0.95, 1.0, 1.05), 1.0);
  }`;

export class MOCRView {
  constructor({ game, sim, role, chapter, mission }) {
    this.game = game;
    this.sim = sim;
    this.role = role;
    this.chapter = chapter;
    this.mission = mission;
    this.home = MOCR_CONSOLES.includes(chapter.controllerRole) ? chapter.controllerRole : 'FLIGHT';
    this.playerConsole = null; // console id the player is seated at (null = walking)
    this.active = false;
    this.mode = 'seated';
    this.focus = 'seat';
    this.loops = new Set(['AG', 'FLIGHT']);
    this.lastAnswer = null;
    this.time = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.fovBase = 62;
    this.fovZoom = 1;
    this.walkPos = new THREE.Vector3();
    this.camPos = new THREE.Vector3();
    this.camQ = new THREE.Quaternion();
    this.camFov = 58;
    this.tvView = null;
    this.npcs = new Map();
    this.consoles = new Map(); // id → { slot, crts: [], lamp, nameplate }
    this.shakeT = 0;
    this.shakeAmt = 0;
    this._crtCursor = 0;
    this._tvAcc = 0;
    this._tvDt = 0;
    this._pageMemo = null;
  }

  // ---------------------------------------------------------------- build

  async init() {
    const { game, sim } = this;
    await document.fonts?.ready;
    const q = game.quality;
    this.lowEnd = q.name === 'low';
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07090c);
    this.scene.fog = new THREE.FogExp2(0x0e1218, this.lowEnd ? 0.012 : 0.017);
    this.camera = new THREE.PerspectiveCamera(this.fovBase, game.width / game.height, 0.03, 80);
    this.data = new MOCRData(sim, { mission: this.mission, chapter: this.chapter, playerConsole: this.home });

    this.room = buildRoom({ quality: q.name, playerConsole: this.home, seed: (this.mission?.id?.length ?? 3) * 977 });
    this.scene.add(this.room.group);

    // ---- wall screens
    this.mainPlot = new MainPlot({ data: this.data, sim, game });
    await this.mainPlot.load();
    this._setScreen(this.room.screens.main, this.mainPlot.texture);
    this.boards = [
      new Board({ data: this.data, sim, kind: 'events', title: 'MISSION EVENTS' }),
      new Board({ data: this.data, sim, kind: 'status', title: `${(this.mission?.callsigns?.CSM ?? 'APOLLO').toUpperCase()} · VEHICLE STATUS` }),
      new Board({ data: this.data, sim, kind: 'consumables', title: 'CONSUMABLES' }),
    ];
    this._setScreen(this.room.screens.left2, this.boards[0].texture);
    this._setScreen(this.room.screens.right1, this.boards[1].texture);
    this._setScreen(this.room.screens.right2, this.boards[2].texture);
    for (const b of this.boards) b.draw(0);
    this.clockStrip = new ClockStrip({ data: this.data, sim });
    this._setScreen(this.room.screens.clock, this.clockStrip.texture);
    this.clockStrip.update();
    // TV (left inner screen): analogue snow until the exterior feed is ready
    this.tvMat = new THREE.ShaderMaterial({
      uniforms: { map: { value: null }, time: { value: 0 }, signal: { value: 1 }, hasMap: { value: 0 } },
      vertexShader: TV_VERT,
      fragmentShader: TV_FRAG,
      toneMapped: false,
    });
    this.room.screens.left1.material.dispose();
    this.room.screens.left1.material = this.tvMat;

    // ---- consoles: CRTs, nameplates, status lamps, NPCs
    this.genericShelf = this._genericShelfTexture();
    let seed = 11;
    for (const [id, slot] of this.room.slots) {
      const c = { id, slot, crts: [], pages: [...(CONSOLE_PAGES[id]?.crt ?? ['FLT', 'TRAJ', 'EVT'])] };
      const L = CONSOLE_LOCAL;
      for (let i = 0; i < 3; i++) {
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(L.crtW, L.crtH), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
        mesh.position.set(slot.x + (i - 1) * L.crtDX, slot.tierY + L.crtY, slot.desk + L.crtZ + 0.012);
        mesh.rotation.x = L.crtTilt;
        mesh.userData.crt = { console: id, index: i };
        this.scene.add(mesh);
        c.crts.push({ mesh, index: i, canvas: null, g: null, tex: null, hi: false, page: c.pages[i] });
      }
      this._allocCRTs(c, false);
      // nameplate
      const np = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.055), new THREE.MeshBasicMaterial({ map: nameplateTexture(id), toneMapped: true, polygonOffset: true, polygonOffsetFactor: -2 }));
      np.position.set(slot.x, slot.tierY + L.nameplate.y, slot.desk + L.nameplate.z + 0.004);
      this.scene.add(np);
      c.nameplate = np;
      // status lamp on the hood (lights green / red when the console answers a poll)
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.025, 0.05), new THREE.MeshBasicMaterial({ color: 0x2a2c2e, toneMapped: false }));
      lamp.position.set(slot.x + 0.6, slot.tierY + L.lamp.y, slot.desk + L.lamp.z + 0.12);
      this.scene.add(lamp);
      c.lamp = lamp;
      // generic keyboard shelf (the seated console gets the interactive PanelMesh instead)
      const shelf = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.3), new THREE.MeshStandardMaterial({ map: this.genericShelf, roughness: 0.6, emissive: 0xffffff, emissiveMap: this.genericShelf, emissiveIntensity: 0.12 }));
      shelf.position.set(slot.x, slot.tierY + L.shelf.y, slot.desk + L.shelf.z);
      shelf.rotation.x = L.shelf.rotX;
      this.scene.add(shelf);
      c.shelf = shelf;
      this.consoles.set(id, c);
      if (id !== this.home) {
        const npc = createController({ seed: seed++ * 31, vest: id === 'FLIGHT' && this.mission?.id === 'apollo13', glasses: id === 'GUIDO' || id === 'EECOM' ? true : undefined });
        npc.root.position.set(slot.x, slot.tierY, slot.desk);
        this.scene.add(npc.root);
        this.npcs.set(id, npc);
      }
    }
    // a few people standing around (back-room visitors, the flight director's assistant)
    this.extras = [];
    const standing = [
      [-6.2, 13.9, 0.6],
      [5.3, 10.6, -0.4],
      [7.4, 7.2, 2.6],
    ];
    standing.forEach(([x, z, yaw], i) => {
      const npc = createController({ seed: 900 + i * 7, standing: true });
      npc.root.position.set(x, floorHeight(z), z);
      npc.root.rotation.y = yaw;
      this.scene.add(npc.root);
      this.extras.push(npc);
    });

    // ---- post (bloom makes the CRTs and the projection screens glow)
    this.post = !this.lowEnd ? createPostFX(game, { bloom: true, strength: 0.55, radius: 0.6, threshold: 0.78 }) : null;

    // ---- input
    for (const [k, code] of [['mocrFocus1', 'Digit1'], ['mocrFocus2', 'Digit2'], ['mocrFocus3', 'Digit3'], ['mocrFocusKeys', 'Digit4'], ['mocrFocusWall', 'Digit5'], ['mocrBack', 'Backspace']]) game.input.bind('walk', k, [code]);
    this._buildUI();
    this._installPointer();
    this._offs = [
      sim.bus.on('mission:groundTask', (t) => this._onTask(t)),
      sim.bus.on('mission:groundTaskEnd', () => this._onTaskEnd()),
      sim.bus.on('mission:highlight', ({ ids }) => this.highlight(ids)),
    ];
    this.sitAt(this.home, true);
    this._initTV().catch((err) => console.warn('[mocr] TV feed unavailable', err));
  }

  _setScreen(mesh, texture) {
    mesh.material.dispose();
    mesh.material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false, color: new THREE.Color(0.92, 0.95, 1.0) });
  }

  _genericShelfTexture() {
    const ctx = this._panelCtx('');
    const p = buildConsolePanel('', ctx);
    const c = p.getCanvas(this.lowEnd ? 0.55 : 0.8);
    p.render();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }

  /** Allocate the CRT canvases of a console at low or high resolution. */
  _allocCRTs(c, hi) {
    const [w, h] = hi ? (this.lowEnd ? [512, 384] : [640, 480]) : this.lowEnd ? [160, 120] : [224, 168];
    for (const crt of c.crts) {
      if (crt.canvas && crt.hi === hi) continue;
      crt.tex?.dispose();
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      crt.canvas = canvas;
      crt.g = canvas.getContext('2d');
      crt.tex = new THREE.CanvasTexture(canvas);
      crt.tex.colorSpace = THREE.SRGBColorSpace;
      crt.tex.anisotropy = 4;
      crt.hi = hi;
      crt.mesh.material.map = crt.tex;
      crt.mesh.material.needsUpdate = true;
      this._drawCRT(c, crt);
    }
  }

  _drawCRT(c, crt) {
    const page = c.id === this.playerConsole && crt.index === 1 && this.data.tasks.has(c.id) ? 'MSG' : crt.page;
    drawPage(crt.g, page, this.data, { w: crt.canvas.width, h: crt.canvas.height, t: this.time, hi: crt.hi, console: c.id });
    crt.tex.needsUpdate = true;
  }

  /** PanelContext for console keyboards; `mocr` is the console-side API. */
  _panelCtx(consoleId) {
    const v = this.sim.vehicle;
    const self = this;
    const d = this.data;
    const mocr = {
      get loops() {
        return self.loops;
      },
      get lastAnswer() {
        return consoleId && consoleId === self.playerConsole ? self.lastAnswer : null;
      },
      pageOf: (i) => self.consoles.get(consoleId)?.crts[i]?.page ?? null,
      setPage: (i, page) => self.setPage(consoleId, i, page),
      toggleLoop: (id) => {
        if (self.loops.has(id)) self.loops.delete(id);
        else self.loops.add(id);
        self.sim.bus.emit('mocr:loop', { loops: [...self.loops] });
      },
      task: () => (consoleId ? d.tasks.get(consoleId) ?? self._anyTask() : null),
      answer: (x) => self.answer(x),
      ack: () => self.answer('ACK'),
      ackPending: () => {
        const t = consoleId ? d.tasks.get(consoleId) ?? self._anyTask() : null;
        return !!t && (t.options?.length ?? 0) === 1;
      },
      alarm: () => !!(v.tm['CM.CW.MASTER_ALARM'] || v.tm['LM.CW.MASTER_ALARM']),
      los: () => d.los,
      tlmBad: () => d.quality < 0.98,
      polling: () => !!d.poll && d.poll.state !== 'done',
    };
    return { sw: v.sw, tm: v.tm, bus: this.sim.bus, clock: this.sim.clock, audio: this.game.audio, vehicle: v, sim: this.sim, gnc: this.sim.gnc, role: this.role, station: 'MOCR', settings: store.settings, input: this.game.input, mocr };
  }

  _anyTask() {
    // tasks for the player's own console, or (when sitting elsewhere) the one waiting for them
    return this.data.tasks.get(this.home) ?? (this.data.tasks.size ? [...this.data.tasks.values()][0] : null);
  }

  async _initTV() {
    const { FlightView } = await import('../render/FlightView.js');
    const tv = new FlightView({ game: this.game, sim: this.sim, role: this.role, chapter: this.chapter, mission: this.mission, observer: true, feed: true });
    await tv.init();
    if (this._disposed) {
      tv.dispose();
      return;
    }
    tv.setActive(false);
    this.tvView = tv;
    const [w, h] = this.lowEnd ? [384, 288] : [640, 480];
    this.tvRT = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true });
    this.tvMat.uniforms.map.value = this.tvRT.texture;
    this.tvMat.uniforms.hasMap.value = 1;
  }

  // ---------------------------------------------------------------- UI overlay

  _buildUI() {
    const btn = (ic, label, title, fn, cls = '') =>
      h('button', { class: `mocr-btn ${cls}`, title, on: { click: (e) => { e.stopPropagation(); this.game.audio?.sfx?.('uiClick'); fn(); } } }, icon(ic), h('span', null, label));
    this.ui = {};
    this.ui.prev = btn('back', 'Anterior', 'Vista anterior', () => this.cycleFocus(-1));
    this.ui.next = btn('next', 'Siguiente', 'Vista siguiente (1–5)', () => this.cycleFocus(1));
    this.ui.view = h('div', { class: 'mocr-view-name' }, 'Consola');
    this.ui.wall = btn('globe', 'Pared', 'Mirar las pantallas grandes (5)', () => this.setFocus(this.focus === 'wall' ? 'seat' : 'wall'));
    this.ui.stand = btn('seat', 'Levantarse', 'Levantarse y caminar por la sala (E)', () => (this.mode === 'seated' ? this.stand() : this.sitNearest()));
    this.ui.pages = h('div', { class: 'mocr-pages', hidden: true });
    this.ui.prompt = h('button', { class: 'mocr-prompt', hidden: true, on: { click: () => this.sitNearest() } });
    this.ui.tip = h('div', { class: 'mocr-tip' });
    this.ui.stickKnob = h('i');
    this.ui.stick = h('div', { class: 'mocr-stick', hidden: true }, this.ui.stickKnob);
    this.ui.root = h(
      'div',
      { class: 'mocr-ui' },
      h('div', { class: 'mocr-side' }, this.ui.view, h('div', { class: 'mocr-row' }, this.ui.prev, this.ui.next), this.ui.wall, this.ui.stand),
      this.ui.pages,
      this.ui.prompt,
      this.ui.tip,
      this.ui.stick,
    );
    this.game.uiRoot.append(this.ui.root);
    // touch joystick for walking
    const input = this.game.input;
    let id = null;
    let cx = 0;
    let cy = 0;
    const set = (dx, dy) => {
      const r = this.ui.stick.clientWidth / 2 || 60;
      const mx = Math.max(-1, Math.min(1, dx / r));
      const my = Math.max(-1, Math.min(1, dy / r));
      this.ui.stickKnob.style.transform = `translate(${mx * r * 0.6}px, ${my * r * 0.6}px)`;
      input.setVirtualAxis('walkX', mx);
      input.setVirtualAxis('walkZ', -my);
    };
    this.ui.stick.addEventListener('pointerdown', (e) => {
      id = e.pointerId;
      const b = this.ui.stick.getBoundingClientRect();
      cx = b.left + b.width / 2;
      cy = b.top + b.height / 2;
      this.ui.stick.setPointerCapture(id);
      set(e.clientX - cx, e.clientY - cy);
    });
    this.ui.stick.addEventListener('pointermove', (e) => e.pointerId === id && set(e.clientX - cx, e.clientY - cy));
    const up = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      set(0, 0);
    };
    this.ui.stick.addEventListener('pointerup', up);
    this.ui.stick.addEventListener('pointercancel', up);
    this._tip(this.game.input.isTouch ? 'Toca una pantalla para ampliarla · arrastra para mirar' : 'Clic en una pantalla para ampliarla · arrastra para mirar · E para levantarte', 9);
  }

  _tip(text, seconds = 6) {
    const el = this.ui?.tip;
    if (!el) return;
    el.textContent = text;
    el.classList.add('on');
    clearTimeout(this._tipT);
    this._tipT = setTimeout(() => el.classList.remove('on'), seconds * 1000);
  }

  _renderUI() {
    const ui = this.ui;
    if (!ui) return;
    const seated = this.mode === 'seated';
    ui.view.textContent = seated ? `${this.playerConsole?.replace('_', ' ') ?? ''} · ${FOCUS_ES[this.focus]}` : 'Caminando';
    ui.prev.hidden = ui.next.hidden = !seated;
    ui.wall.hidden = !seated;
    ui.wall.classList.toggle('on', this.focus === 'wall');
    ui.stand.lastChild.textContent = seated ? 'Levantarse' : 'Sentarse';
    ui.stand.hidden = !seated && !this._near;
    ui.stick.hidden = seated || !this.game.input.isTouch;
    // page strip for the focused CRT
    const crtIdx = this.focus.startsWith('crt') ? Number(this.focus[3]) : -1;
    const sig = `${seated}|${crtIdx}|${this.playerConsole}|${crtIdx >= 0 ? this.consoles.get(this.playerConsole)?.crts[crtIdx]?.page : ''}`;
    if (sig !== this._pagesSig) {
      this._pagesSig = sig;
      ui.pages.hidden = !(seated && crtIdx >= 0);
      ui.pages.replaceChildren();
      if (seated && crtIdx >= 0) {
        const c = this.consoles.get(this.playerConsole);
        const keys = CONSOLE_PAGES[this.playerConsole]?.keys ?? [];
        ui.pages.append(h('div', { class: 'mocr-pages-title' }, `Pantalla ${crtIdx + 1}`));
        for (const p of keys) {
          ui.pages.append(
            h('button', { class: `mocr-page ${c.crts[crtIdx].page === p ? 'on' : ''}`, on: { click: (e) => { e.stopPropagation(); this.game.audio?.sfx?.('button'); this.setPage(this.playerConsole, crtIdx, p); } } }, PAGES[p]?.name ?? p),
          );
        }
      }
    }
    const near = !seated && this._near;
    ui.prompt.hidden = !near;
    if (near) ui.prompt.textContent = `${this.game.input.isTouch ? 'Sentarse' : 'E · Sentarse'} en ${this._near.replace('_', ' ')}`;
  }

  // ---------------------------------------------------------------- pointer (CRT taps, look, pinch)

  _installPointer() {
    const game = this.game;
    this.interactor = null;
    this._tap = null;
    this._onDown = (e) => {
      if (!this.active || e.target !== game.canvas) return;
      this._tap = { x: e.clientX, y: e.clientY, id: e.pointerId, t: performance.now() };
    };
    this._onUp = (e) => {
      const t = this._tap;
      this._tap = null;
      if (!t || t.id !== e.pointerId || !this.active) return;
      if (Math.hypot(e.clientX - t.x, e.clientY - t.y) > 8 || performance.now() - t.t > 600) return;
      this._click(e.clientX, e.clientY);
    };
    game.canvas.addEventListener('pointerdown', this._onDown);
    window.addEventListener('pointerup', this._onUp);
    this._ray = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
  }

  _click(x, y) {
    const r = this.game.canvas.getBoundingClientRect();
    this._ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    this._ray.setFromCamera(this._ndc, this.camera);
    if (this.mode === 'seated') {
      const c = this.consoles.get(this.playerConsole);
      const meshes = c ? c.crts.map((k) => k.mesh) : [];
      const hit = this._ray.intersectObjects(meshes, false)[0];
      if (hit) {
        const f = `crt${hit.object.userData.crt.index}`;
        this.setFocus(this.focus === f ? 'seat' : f);
        return;
      }
      const sc = this.room.screens;
      const wallHit = this._ray.intersectObjects([sc.main, sc.left1, sc.left2, sc.right1, sc.right2, sc.clock], false)[0];
      if (wallHit) {
        this.setFocus(this.focus === 'wall' ? 'seat' : 'wall');
        return;
      }
      // a tap on nothing in a zoomed view goes back to the console overview
      if (this.focus !== 'seat' && this.focus !== 'keys') this.setFocus('seat');
    } else {
      // walking: tapping a console's screens walks to it and sits down
      const all = [];
      for (const c of this.consoles.values()) for (const k of c.crts) all.push(k.mesh);
      const hit = this._ray.intersectObjects(all, false)[0];
      if (hit && hit.distance < 6) this.sitAt(hit.object.userData.crt.console);
    }
  }

  _ensureInteractor(pm) {
    this.interactor?.dispose();
    this.interactor = new PanelInteractor({
      game: this.game,
      camera: this.camera,
      panelMeshes: pm ? [pm] : [],
      enabled: this.active,
      onLook: (dx, dy) => this._look(dx, dy),
      onZoom: (f) => {
        this.fovZoom = Math.max(0.45, Math.min(1.25, this.fovZoom * f));
      },
    });
  }

  _look(dx, dy) {
    const s = 0.0032 * (store.settings.mouseSensitivity ?? 1) * (this.camFov / 60);
    if (this.mode === 'seated' && this.focus !== 'seat') {
      this._dragAcc = (this._dragAcc ?? 0) + Math.hypot(dx, dy);
      if (this._dragAcc < 60) return;
      // a firm drag in a zoomed view: back to the overview, keeping the look direction
      this._dragAcc = 0;
      const dir = _v.set(0, 0, -1).applyQuaternion(this.camQ);
      this.yaw = Math.atan2(-dir.x, -dir.z);
      this.pitch = Math.asin(Math.max(-1, Math.min(1, dir.y)));
      this.setFocus('seat');
    }
    this.yaw -= dx * s;
    this.pitch = Math.max(-1.1, Math.min(1.1, this.pitch - dy * s * (store.settings.invertY ? -1 : 1)));
    if (this.mode === 'seated') this.yaw = Math.max(-2.2, Math.min(2.2, this.yaw));
  }

  // ---------------------------------------------------------------- seats & focus

  sitAt(consoleId, instant = false) {
    const c = this.consoles.get(consoleId);
    if (!c) return;
    const prev = this.playerConsole ? this.consoles.get(this.playerConsole) : null;
    if (prev && prev !== c) this._leaveConsole(prev);
    this.playerConsole = consoleId;
    this.mode = 'seated';
    this.focus = 'seat';
    this.yaw = 0;
    this.pitch = -0.13;
    this.fovZoom = 1;
    // the controller sitting there steps aside while you use their console
    for (const [id, npc] of this.npcs) npc.root.visible = id !== consoleId;
    this._allocCRTs(c, true);
    // interactive keyboard shelf
    this.panel = buildConsolePanel(consoleId, this._panelCtx(consoleId));
    const px = this.lowEnd ? 1.15 : 1.6;
    this.panelMesh = new PanelMesh(this.panel, { pxPerMm: px, brightness: 1 });
    for (const t of this.panelMesh.tiles) t.mesh.material.emissiveIntensity = 0.3;
    const L = CONSOLE_LOCAL;
    this.panelMesh.group.position.set(c.slot.x, c.slot.tierY + L.shelf.y + 0.004, c.slot.desk + L.shelf.z + 0.003);
    this.panelMesh.group.rotation.x = L.shelf.rotX;
    this.panelMesh.group.scale.setScalar(1.4 / (CONSOLE_PANEL_SIZE.width / 1000));
    this.scene.add(this.panelMesh.group);
    c.shelf.visible = false;
    this._ensureInteractor(this.panelMesh);
    if (instant) {
      this._seatPose(this.camPos, this.camQ);
      this.camFov = this.fovBase;
      this.camera.position.copy(this.camPos);
      this.camera.quaternion.copy(this.camQ);
    }
    this.sim.bus.emit('mocr:seat', { console: consoleId });
    if (!instant) this.game.audio?.sfx?.('chair');
    if (!instant && consoleId !== this.home) this._tip(`Estás en la consola ${consoleId.replace('_', ' ')}. Tu puesto es ${this.home.replace('_', ' ')}.`, 6);
  }

  _leaveConsole(c) {
    if (this.panelMesh) {
      this.scene.remove(this.panelMesh.group);
      this.panelMesh.dispose();
      this.panel.dispose();
      this.panelMesh = null;
      this.panel = null;
    }
    c.shelf.visible = true;
    this._allocCRTs(c, false);
  }

  stand() {
    if (this.mode !== 'seated') return;
    const c = this.consoles.get(this.playerConsole);
    this.mode = 'walking';
    this.focus = 'seat';
    this.walkPos.set(c.slot.x, 0, c.slot.desk + 0.95);
    this.yaw = 0;
    this.pitch = -0.05;
    this.fovZoom = 1;
    if (c) this._leaveConsole(c);
    this.npcs.get(this.playerConsole)?.root && (this.npcs.get(this.playerConsole).root.visible = true);
    this.playerConsole = null;
    this._ensureInteractor(null);
    this.sim.bus.emit('mocr:seat', { console: null });
    this.game.audio?.sfx?.('chair');
    this._tip(this.game.input.isTouch ? 'Joystick para caminar · arrastra para mirar · toca una consola para sentarte' : 'WASD para caminar · arrastra para mirar · E para sentarte', 7);
  }

  sitNearest() {
    if (this._near) this.sitAt(this._near);
  }

  setFocus(f) {
    if (!FOCI.includes(f) || this.mode !== 'seated') return;
    this.focus = f;
    this._dragAcc = 0;
    this.fovZoom = 1;
    if (f === 'seat') {
      this.yaw = 0;
      this.pitch = -0.13;
    }
  }

  cycleFocus(dir) {
    const i = FOCI.indexOf(this.focus);
    this.setFocus(FOCI[(i + dir + FOCI.length) % FOCI.length]);
  }

  setPage(consoleId, i, page) {
    const c = this.consoles.get(consoleId);
    const crt = c?.crts[i];
    if (!crt || !PAGES[page]) return;
    crt.page = page;
    this._drawCRT(c, crt);
  }

  _seatPose(outPos, outQ) {
    const c = this.consoles.get(this.playerConsole);
    const s = c.slot;
    outPos.set(s.x, s.tierY + ROOM.eye, s.desk + 0.5);
    outQ.setFromEuler(_e.set(this.pitch, this.yaw, 0, 'YXZ'));
    return this.fovBase;
  }

  /** Target camera pose for the current mode/focus → { fov } (writes position & quaternion). */
  _targetPose(outPos, outQ) {
    if (this.mode === 'walking') {
      outPos.set(this.walkPos.x, this._eyeY ?? floorHeight(this.walkPos.z) + WALK_EYE, this.walkPos.z);
      outQ.setFromEuler(_e.set(this.pitch, this.yaw, 0, 'YXZ'));
      return 66;
    }
    const c = this.consoles.get(this.playerConsole);
    const s = c.slot;
    const L = CONSOLE_LOCAL;
    const aspect = this.game.width / Math.max(1, this.game.height);
    if (this.focus.startsWith('crt')) {
      const i = Number(this.focus[3]);
      const m = c.crts[i].mesh;
      const fov = 40;
      const fitH = (L.crtH / 0.86) / (2 * Math.tan((fov * D) / 2));
      const fitW = (L.crtW / 0.94) / (2 * Math.tan((fov * D) / 2) * aspect);
      const dist = Math.max(fitH, fitW);
      const n = _v2.set(0, 0, 1).applyQuaternion(m.quaternion);
      outPos.copy(m.position).addScaledVector(n, dist);
      _m.lookAt(outPos, m.position, _UP);
      outQ.setFromRotationMatrix(_m);
      return fov;
    }
    if (this.focus === 'keys' && this.panelMesh) {
      const g = this.panelMesh.group;
      const fov = 46;
      const fitW = (1.4 / 0.96) / (2 * Math.tan((fov * D) / 2) * aspect);
      const fitH = (0.3 / 0.8) / (2 * Math.tan((fov * D) / 2));
      const dist = Math.max(fitW, fitH);
      const n = _v2.set(0, 0, 1).applyQuaternion(g.quaternion);
      outPos.copy(g.position).addScaledVector(n, dist);
      _m.lookAt(outPos, g.position, _v3.set(0, 1, 0).applyQuaternion(g.quaternion));
      outQ.setFromRotationMatrix(_m);
      return fov;
    }
    if (this.focus === 'wall') {
      outPos.set(s.x * 0.6, s.tierY + ROOM.eye + 0.05, s.desk + 0.4);
      const target = _v2.set(0, 3.75, ROOM.front);
      _m.lookAt(outPos, target, _UP);
      outQ.setFromRotationMatrix(_m);
      const dist = outPos.distanceTo(target);
      // fit the 20 m wall (or at least the main screen on narrow screens)
      const wantW = Math.min(21, 15 + aspect * 2.4);
      return Math.max(18, Math.min(60, (2 * Math.atan(wantW / (2 * dist * aspect))) / D));
    }
    return this._seatPose(outPos, outQ);
  }

  // ---------------------------------------------------------------- tasks & answers

  _onTask(t) {
    const c = this.consoles.get(this.playerConsole);
    if (c && (t.console === this.playerConsole || t.console === this.home)) {
      this._drawCRT(c, c.crts[1]);
      if (this.mode === 'seated' && this.focus === 'wall') this.setFocus('seat');
    }
    this.game.audio?.sfx?.('phoneRing', { gain: 0.35 });
  }

  _onTaskEnd() {
    const c = this.consoles.get(this.playerConsole);
    if (c) this._drawCRT(c, c.crts[1]);
  }

  /** GO / NOGO / ACK or a message-response index (0..3) from the console keys. */
  answer(x) {
    const t = this.data.tasks.get(this.playerConsole) ?? this._anyTask();
    if (!t) {
      this.game.audio?.sfx?.('uiBack');
      this._tip('No hay ningún mensaje esperando respuesta en tu consola', 3);
      return;
    }
    let id = null;
    if (x === 'GO' || x === 'NOGO') {
      if (t.options?.some((o) => o.id === x)) id = x;
      else {
        this._tip('Este mensaje no es un GO / NO GO: responde con las teclas 1–4', 4);
        return;
      }
      this.lastAnswer = x;
      clearTimeout(this._ansT);
      this._ansT = setTimeout(() => (this.lastAnswer = null), 2500);
    } else if (x === 'ACK') {
      if ((t.options?.length ?? 0) === 1) id = t.options[0].id;
      else {
        this._tip('Elige una respuesta con las teclas 1–4 (o GO / NO GO)', 4);
        return;
      }
    } else if (typeof x === 'number') {
      id = t.options?.[x]?.id ?? null;
      if (!id) return;
    }
    if (id) t.resolve(id);
  }

  // ---------------------------------------------------------------- facade

  setActive(on) {
    this.active = on;
    this.game.input.setContext('walk', on);
    this.interactor?.setEnabled(on);
    if (this.ui) this.ui.root.hidden = !on;
    if (!on) this.game.input.setVirtualAxis('walkX', 0), this.game.input.setVirtualAxis('walkZ', 0);
  }

  setCamera() {}

  shake(amount = 1, seconds = 1) {
    this.shakeAmt = Math.max(this.shakeAmt, amount * 0.5);
    this.shakeT = Math.max(this.shakeT, seconds);
  }

  flash() {}

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

  /** Mission evidence (tm keys): bring the page that shows it up on your first CRT. */
  highlight(ids) {
    const c = this.consoles.get(this.playerConsole);
    if (!c || !ids?.length) return;
    for (const id of ids) {
      const hit = EVIDENCE_PAGE.find(([re]) => re.test(id));
      if (hit) {
        this.setPage(this.playerConsole, 0, hit[1]);
        return;
      }
    }
  }

  cameraDistance() {
    return 0;
  }

  lookInfo() {
    return { dir: new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion), pos: this.camera.position.clone(), fov: this.camera.fov, aspect: this.camera.aspect };
  }

  // ---------------------------------------------------------------- frame

  update(dt, paused) {
    const input = this.game.input;
    this.time += dt;
    const d = this.data;
    d.update(dt);

    // ---- controls
    if (this.active && !paused) {
      if (input.pressed('interact')) {
        if (this.mode === 'seated') this.stand();
        else this.sitNearest();
      }
      if (this.mode === 'seated') {
        if (input.pressed('mocrFocus1')) this.setFocus(this.focus === 'crt0' ? 'seat' : 'crt0');
        if (input.pressed('mocrFocus2')) this.setFocus(this.focus === 'crt1' ? 'seat' : 'crt1');
        if (input.pressed('mocrFocus3')) this.setFocus(this.focus === 'crt2' ? 'seat' : 'crt2');
        if (input.pressed('mocrFocusKeys')) this.setFocus(this.focus === 'keys' ? 'seat' : 'keys');
        if (input.pressed('mocrFocusWall')) this.setFocus(this.focus === 'wall' ? 'seat' : 'wall');
        if (input.pressed('mocrBack')) this.setFocus('seat');
        // arrow keys / A-D look around while seated
        const ax = input.axis('walkX');
        const az = input.axis('walkZ');
        if (ax || az) {
          if (this.focus !== 'seat') this.setFocus('seat');
          this.yaw = Math.max(-2.2, Math.min(2.2, this.yaw - ax * dt * 1.4));
          this.pitch = Math.max(-1.1, Math.min(1.1, this.pitch + az * dt * 0.9));
        }
      } else this._walk(dt, input);
    }

    // ---- camera
    const fov = this._targetPose(_v, _q) * (this.focus === 'seat' || this.mode === 'walking' ? this.fovZoom : 1);
    const k = this.mode === 'walking' ? 1 : 1 - Math.exp(-dt * 7);
    this.camPos.lerp(_v, k);
    this.camQ.slerp(_q, this.mode === 'walking' ? 1 : k);
    this.camFov += (fov - this.camFov) * (1 - Math.exp(-dt * 7));
    this.camera.position.copy(this.camPos);
    this.camera.quaternion.copy(this.camQ);
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const a = 0.006 * this.shakeAmt * Math.min(1, this.shakeT);
      this.camera.rotateX((Math.random() - 0.5) * a);
      this.camera.rotateY((Math.random() - 0.5) * a);
    }
    if (Math.abs(this.camera.fov - this.camFov) > 0.01) {
      this.camera.fov = this.camFov;
      this.camera.updateProjectionMatrix();
    }

    // ---- screens
    this.mainPlot.update(dt, this.time);
    for (const b of this.boards) b.update(dt, this.time);
    this.clockStrip.update();
    this._updateCRTs(dt);
    this.panelMesh?.update(dt);
    this.interactor?.routeKeys?.(input);
    this._updateTV(dt);

    // ---- lamps & people
    const tasks = d.tasks;
    for (const [id, c] of this.consoles) {
      const a = d.pollLights.get(id);
      const blink = tasks.has(id) && Math.floor(this.time * 3) % 2 === 0;
      c.lamp.material.color.setHex(a === 'GO' ? 0x3dff7a : a === 'NOGO' ? 0xff3a2a : blink ? 0xfff4d0 : 0x2a2c2e);
    }
    const speaker = d.speaking && d.time < d.speaking.until ? d.speaking.who : null;
    const player = this.mode === 'walking' ? this.camera.position : null;
    for (const [id, npc] of this.npcs) {
      if (!npc.root.visible) continue;
      let look = null;
      if (player && _v.copy(npc.root.position).distanceToSquared(player) < 3.2) look = player;
      npc.update(dt, { talking: speaker === id, lookAt: look });
    }
    for (const npc of this.extras) npc.update(dt, {});
    this._renderUI();
  }

  _walk(dt, input) {
    const speed = (input.down('run') ? 3.4 : 1.7) * dt;
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const mz = input.axis('walkZ');
    const mx = input.axis('walkX');
    const p = this.walkPos;
    p.x += (fx * mz + -fz * mx) * speed;
    p.z += (fz * mz + fx * mx) * speed;
    // room bounds
    p.x = Math.max(-ROOM.halfW + 0.45, Math.min(ROOM.halfW - 0.45, p.x));
    p.z = Math.max(ROOM.front + 1.25, Math.min(ROOM.back - 0.45, p.z));
    // console banks
    const rad = 0.32;
    for (const b of this.room.colliders) {
      if (p.x > b.x0 - rad && p.x < b.x1 + rad && p.z > b.z0 - rad && p.z < b.z1 + rad) {
        const dl = p.x - (b.x0 - rad);
        const dr = b.x1 + rad - p.x;
        const df = p.z - (b.z0 - rad);
        const db = b.z1 + rad - p.z;
        const m = Math.min(dl, dr, df, db);
        if (m === dl) p.x = b.x0 - rad;
        else if (m === dr) p.x = b.x1 + rad;
        else if (m === df) p.z = b.z0 - rad;
        else p.z = b.z1 + rad;
      }
    }
    const target = floorHeight(p.z) + WALK_EYE + (mx || mz ? Math.sin(this.time * 9) * 0.012 : 0);
    this._eyeY = this._eyeY === undefined ? target : this._eyeY + (target - this._eyeY) * Math.min(1, dt * 8);
    if ((mx || mz) && (this._stepT = (this._stepT ?? 0) + dt) > (input.down('run') ? 0.32 : 0.5)) {
      this._stepT = 0;
      this.game.audio?.sfx?.('footstep', { gain: 0.5 });
    }
    // nearest console seat
    let best = null;
    let bd = 0.95;
    for (const [id, c] of this.consoles) {
      const dd = Math.hypot(p.x - c.slot.x, p.z - (c.slot.desk + 0.55));
      if (dd < bd && Math.abs(floorHeight(p.z) - c.slot.tierY) < 0.05) {
        bd = dd;
        best = id;
      }
    }
    this._near = best;
  }

  _updateCRTs(dt) {
    // the player's console: 8 Hz (15 Hz for a zoomed CRT); the rest round-robin a few per frame
    const mine = this.consoles.get(this.playerConsole);
    this._crtAcc = (this._crtAcc ?? 0) + dt;
    const zoomed = this.focus.startsWith('crt');
    if (mine && this._crtAcc >= (zoomed ? 1 / 15 : 1 / 8)) {
      this._crtAcc = 0;
      for (const crt of mine.crts) {
        if (zoomed && `crt${crt.index}` !== this.focus && Math.random() < 0.6) continue;
        this._drawCRT(mine, crt);
      }
    }
    const list = this._crtList ?? (this._crtList = [...this.consoles.values()].flatMap((c) => c.crts.map((crt) => [c, crt])));
    const n = this.lowEnd ? 2 : 4;
    for (let i = 0; i < n; i++) {
      this._crtCursor = (this._crtCursor + 1) % list.length;
      const [c, crt] = list[this._crtCursor];
      if (c === mine) continue;
      // skip consoles far behind the camera
      if (this.camera.position.distanceToSquared(crt.mesh.position) > 400) continue;
      this._drawCRT(c, crt);
    }
  }

  _updateTV(dt) {
    this.tvMat.uniforms.time.value = this.time;
    const d = this.data;
    this.tvMat.uniforms.signal.value += ((d.los ? 0 : d.quality) - this.tvMat.uniforms.signal.value) * Math.min(1, dt * 3);
    const tv = this.tvView;
    if (!tv) return;
    this._tvDt += dt;
    this._tvAcc += dt;
    const period = this.lowEnd ? 1 / 8 : 1 / 20;
    if (this._tvAcc < period) return;
    // only when the TV can be seen
    _v.set(-5.25, 3.6, ROOM.front);
    const vis = this.camera.position.distanceTo(_v) < 40 && _v2.copy(_v).sub(this.camera.position).normalize().dot(_v.set(0, 0, -1).applyQuaternion(this.camera.quaternion)) > 0.2;
    if (!vis) return;
    this._tvAcc = 0;
    try {
      tv.update(this._tvDt, false);
      tv.renderToTarget(this.tvRT);
    } catch (err) {
      if (!this._tvErr) {
        this._tvErr = true;
        console.warn('[mocr] TV feed error', err);
      }
    }
    this._tvDt = 0;
  }

  render() {
    const r = this.game.renderer;
    if (this.post) this.post.render((renderer) => renderer.render(this.scene, this.camera), 1 / 60);
    else {
      r.setRenderTarget(null);
      r.setClearColor(0x000000, 1);
      r.clear();
      r.render(this.scene, this.camera);
    }
  }

  resize(w, h) {
    if (!this.camera) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.post?.resize(w, h);
  }

  dispose() {
    this._disposed = true;
    this.setActive(false);
    this._offs?.forEach((f) => f());
    this.game.canvas.removeEventListener('pointerdown', this._onDown);
    window.removeEventListener('pointerup', this._onUp);
    clearTimeout(this._tipT);
    clearTimeout(this._ansT);
    this.ui?.root.remove();
    this.fadeEl?.remove();
    this.interactor?.dispose();
    this.panelMesh?.dispose();
    this.panel?.dispose();
    this.data?.dispose();
    this.mainPlot?.dispose();
    for (const b of this.boards ?? []) b.dispose();
    this.clockStrip?.dispose();
    for (const c of this.consoles.values()) for (const crt of c.crts) crt.tex?.dispose();
    for (const npc of [...this.npcs.values(), ...(this.extras ?? [])]) npc.dispose();
    this.genericShelf?.dispose();
    this.tvRT?.dispose();
    this.tvView?.dispose();
    this.post?.dispose();
    this.room?.dispose();
    this.scene?.traverse((o) => {
      o.geometry?.dispose?.();
      if (o.material) for (const m of [].concat(o.material)) m.dispose?.();
    });
  }
}

export { ROWS };
