// Moonwalk on the lunar surface (FlightView with chapter.scene 'eva'): the astronaut walks the real
// collision terrain around the landed LM at 1/6 g (walk, or the lope with Shift / "Saltar"), throws a
// long shadow on the regolith, kicks dust at every step, and works the tasks the chapter script sets
// out as glowing markers (E / "Acción"). Cameras: 'eva' third person (drag to orbit, wheel to zoom)
// and 'eva:fp' through the visor.
//   script API (ctx.view.eva): lm, position, addTarget/waitAction/clearTarget, place(kind, e, n, yaw),
//   descendLadder(who), stepOff(), addCompanion(), distanceTo(e, n), stats

import * as THREE from 'three';
import { createAstronaut, createFlag, createPSEP, createLRRR, createMarker } from '../render/models/astronaut.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const WALK = 1.05; // m/s
const LOPE = 1.9;
const LM_KEEP_OUT = 2.6; // m from the LM centre (descent stage); the ladder foot is outside it

export class EVAController {
  constructor({ game, sim, view, lunar }) {
    this.game = game;
    this.sim = sim;
    this.view = view;
    this.lunar = lunar;
    this.time = 0;
    this.targets = new Map();
    this.props = [];
    this.stats = { walked: 0, steps: 0 };
    this.controllable = false; // false while a cinematic (ladder) plays
    this.locked = false; // tasks work but the feet stay put (standing on the footpad)
    // the landed LM: sub-point and its forward (+Z, front hatch and ladder) in site metres
    const lmLoc = lunar.vehicleLocal;
    const st = sim.vehicle.state;
    const fwdEci = _v.set(0, 0, 1).applyQuaternion(st.q);
    const { east, north } = this._tangent(lmLoc.x, lmLoc.y);
    const fe = fwdEci.dot(east);
    const fn = fwdEci.dot(north);
    const fl = Math.hypot(fe, fn) || 1;
    this.lm = { e: lmLoc.x, n: lmLoc.y, fe: fe / fl, fn: fn / fl };
    // ladder foot (front footpad) and the porch above it
    this.ladder = { e: this.lm.e + this.lm.fe * 4.1, n: this.lm.n + this.lm.fn * 4.1 };
    this.pos = { e: this.ladder.e, n: this.ladder.n, h: 0 };
    this.yaw = Math.atan2(this.lm.fe, this.lm.fn); // heading: 0 = north, +π/2 = east
    this.vel = { e: 0, n: 0 };
    this.lift = 0; // height above the ground (the ladder, a hop)
    this.crouch = 0;
    this.reach = 0;
    this.astro = createAstronaut({ commander: true });
    this.astro.root.visible = false;
    view.near.add(this.astro.root);
    this.casters = [lunar.addShadowCaster(this.astro.root)];
    this.companion = null;
    // the orbit camera starts out in front of the LM, looking back at the ladder (the TV camera's view)
    this.camYaw = Math.atan2(this.lm.fe, this.lm.fn);
    this._stepPhase = 0;
    this._buildPrompt();
    const input = game.input;
    input.bind('walk', 'evaPhoto', ['KeyF']);
    input.bind('walk', 'evaCamera', ['KeyV']);
  }

  // ---------------------------------------------------------------- frames

  /** East / north unit vectors (ECI) at a site-local point. */
  _tangent(e, n) {
    const L = this.lunar;
    const dyn = this.sim.dyn;
    const p0 = L.siteToEci(dyn, e, n, 0, (this._t0 ??= new THREE.Vector3()));
    const east = L.siteToEci(dyn, e + 1, n, 0, (this._t1 ??= new THREE.Vector3())).sub(p0).normalize();
    const north = L.siteToEci(dyn, e, n + 1, 0, (this._t2 ??= new THREE.Vector3())).sub(p0).normalize();
    const up = (this._t3 ??= new THREE.Vector3()).copy(p0).sub(dyn.moonPos).normalize();
    return { east, north, up, p0 };
  }

  /** ECI position + orientation of a figure standing at (e, n) facing `yaw`. */
  _pose(e, n, h, yaw, outPos, outQ) {
    const { east, north, up } = this._tangent(e, n);
    this.lunar.siteToEci(this.sim.dyn, e, n, h, outPos);
    const fwd = _v.copy(north).multiplyScalar(Math.cos(yaw)).addScaledVector(east, Math.sin(yaw)).normalize();
    // model: +Y up, faces −Z → x = up × back
    const back = _v2.copy(fwd).negate();
    const x = (this._px ??= new THREE.Vector3()).crossVectors(up, back).normalize();
    _m.makeBasis(x, up, back);
    outQ.setFromRotationMatrix(_m);
    return { east, north, up };
  }

  ground(e, n) {
    return this.lunar.heightAt(e, n);
  }

  get position() {
    return { e: this.pos.e, n: this.pos.n };
  }

  distanceTo(e, n) {
    return Math.hypot(this.pos.e - e, this.pos.n - n);
  }

  /** A point relative to the LM: `fwd` metres out of the front hatch, `right` to the LMP side. */
  lmPoint(fwd, right) {
    const { fe, fn } = this.lm;
    // right of forward (looking down from above, x east y north): (fn, −fe)
    return { e: this.lm.e + fe * fwd + fn * right, n: this.lm.n + fn * fwd - fe * right };
  }

  // ---------------------------------------------------------------- tasks

  /** A task marker; resolves with the target when the player performs it there (E / Acción). */
  addTarget({ id, label, e, n, radius = 1.6, color = 0xffb000, anim = null }) {
    this.clearTarget(id);
    const marker = createMarker(color);
    this.view.near.add(marker.root);
    let resolve;
    const done = new Promise((r) => (resolve = r));
    // how the work looks: kneel (samples), reach (setting something down), none (a step, the ladder)
    const how = anim ?? (/rock|contingency/.test(id) ? 'kneel' : /flag|psep|lrrr/.test(id) ? 'reach' : 'none');
    this.targets.set(id, { id, label, e, n, radius, marker, resolve, done, anim: how });
    return done;
  }

  waitAction(id) {
    return this.targets.get(id)?.done ?? Promise.resolve(null);
  }

  clearTarget(id) {
    const t = this.targets.get(id);
    if (!t) return;
    this.view.near.remove(t.marker.root);
    t.marker.dispose();
    this.targets.delete(id);
  }

  /** Leave an object on the surface: 'flag' | 'psep' | 'lrrr'. */
  place(kind, e, n, yaw = 0) {
    const m = kind === 'flag' ? createFlag() : kind === 'psep' ? createPSEP() : createLRRR();
    this.view.near.add(m.root);
    const caster = this.lunar.addShadowCaster(m.root);
    const prop = { kind, m, caster, e, n, yaw, rise: 0 };
    this.props.push(prop);
    return prop;
  }

  // ---------------------------------------------------------------- cinematics

  /** Down the nine rungs of the ladder from the porch to the footpad (≈ 8 s). */
  async descendLadder(figure = 'player') {
    const who = figure === 'player' ? this : this.companion;
    if (!who) return;
    const astro = figure === 'player' ? this.astro : this.companion.astro;
    astro.root.visible = true;
    const top = 3.3;
    const t0 = this.time;
    who.pos.e = this.ladder.e;
    who.pos.n = this.ladder.n;
    who.yaw = Math.atan2(-this.lm.fe, -this.lm.fn); // facing the LM, backing down the ladder
    while (this.time - t0 < 8) {
      const k = (this.time - t0) / 8;
      // rung by rung: short drops with pauses
      const rungs = 9 * k;
      who.lift = top * (1 - (Math.floor(rungs) + Math.min(1, (rungs % 1) * 2.2)) / 9) + 0.25;
      who.climb = (rungs % 1) * Math.PI * 2;
      await this._frame();
    }
    who.lift = 0.25; // standing on the footpad
    who.climb = null;
  }

  /** The first step: off the footpad onto the regolith. */
  async stepOff() {
    const t0 = this.time;
    const from = { e: this.pos.e, n: this.pos.n };
    const away = { e: -this.lm.fe, n: -this.lm.fn };
    while (this.time - t0 < 1.4) {
      const k = (this.time - t0) / 1.4;
      this.lift = 0.25 * (1 - k) + Math.sin(k * Math.PI) * 0.2;
      this.pos.e = from.e - away.e * 0.7 * k;
      this.pos.n = from.n - away.n * 0.7 * k;
      await this._frame();
    }
    this.lift = 0;
    this._footprint(this.pos.e, this.pos.n, 1.4);
    this.yaw = Math.atan2(this.lm.fe, this.lm.fn);
    // three-quarter view with the Eagle behind him
    this.setCameraYaw(this.yaw + 0.6);
  }

  /** Turn the orbit camera (the view keeps the orbit angles; drag moves them too). */
  setCameraYaw(yaw) {
    this.camYaw = yaw;
    if (this.view.orbit) this.view.orbit.yaw = yaw;
  }

  /** The second crewman: down the ladder, then he works near the LM on his own. */
  async addCompanion() {
    const astro = createAstronaut({ commander: false });
    astro.root.visible = false;
    this.view.near.add(astro.root);
    this.companion = { astro, pos: { e: this.ladder.e, n: this.ladder.n }, yaw: 0, lift: 0, caster: this.lunar.addShadowCaster(astro.root), goal: null, wait: 0 };
    await this.descendLadder('companion');
    this.companion.lift = 0;
    this.companion.ready = true;
  }

  _frame() {
    return new Promise((r) => (this._waiters ??= []).push(r));
  }

  // ---------------------------------------------------------------- per frame

  update(dt, paused) {
    if (paused) return;
    this.time += dt;
    for (const r of this._waiters?.splice(0) ?? []) r();
    const input = this.game.input;
    if (input.pressed('evaCamera')) this.view.setCamera(this.view.cameraMode === 'eva' ? 'eva:fp' : 'eva');
    if (input.pressed('evaPhoto')) this.photo();
    // walking: stick / WASD relative to the camera
    let speed = 0;
    let hop = 0;
    if (this.controllable && !this.busy) {
      const ax = this.locked ? 0 : input.axis('walkX');
      const az = this.locked ? 0 : input.axis('walkZ');
      const mag = Math.min(1, Math.hypot(ax, az));
      const lope = input.down('run') || mag > 0.92;
      const vmax = lope ? LOPE : WALK;
      const ref = this.view.cameraMode === 'eva:fp' ? this.yaw : this.camYaw + Math.PI;
      let we = 0;
      let wn = 0;
      if (mag > 0.08) {
        const c = Math.cos(ref);
        const s = Math.sin(ref);
        // forward along the camera heading, right 90° clockwise of it
        wn = (c * az - s * ax) * vmax;
        we = (s * az + c * ax) * vmax;
        const want = Math.atan2(we, wn);
        let d = want - this.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.yaw += d * Math.min(1, dt * 6);
      }
      // regolith grip at 1/6 g: slow to start, slow to stop
      const k = Math.min(1, dt * (mag > 0.08 ? 2.4 : 1.6));
      this.vel.e += (we - this.vel.e) * k;
      this.vel.n += (wn - this.vel.n) * k;
      let ne = this.pos.e + this.vel.e * dt;
      let nn = this.pos.n + this.vel.n * dt;
      // keep out of the descent stage, the deployed experiments and the other crewman
      const solid = [{ e: this.lm.e, n: this.lm.n, r: LM_KEEP_OUT }, ...this.props.map((p) => ({ e: p.e, n: p.n, r: p.kind === 'flag' ? 0.25 : 0.55 }))];
      if (this.companion?.ready) solid.push({ e: this.companion.pos.e, n: this.companion.pos.n, r: 0.55 });
      for (const o of solid) {
        const de = ne - o.e;
        const dn = nn - o.n;
        const d = Math.hypot(de, dn);
        if (d < o.r) {
          ne = o.e + (de / (d || 1)) * o.r;
          nn = o.n + (dn / (d || 1)) * o.r;
        }
      }
      // tether: stay within the TV camera's 60 m of the LM (as the crews were told to)
      const fromLm = Math.hypot(ne - this.lm.e, nn - this.lm.n);
      if (fromLm > 60) {
        ne = this.lm.e + ((ne - this.lm.e) / fromLm) * 60;
        nn = this.lm.n + ((nn - this.lm.n) / fromLm) * 60;
      }
      const moved = Math.hypot(ne - this.pos.e, nn - this.pos.n);
      this.stats.walked += moved;
      this.pos.e = ne;
      this.pos.n = nn;
      speed = moved / Math.max(dt, 1e-3);
      hop = speed > 1.3 ? Math.min(1, (speed - 1.3) / 0.5) : 0;
      // footsteps: a puff of dust and a soft thud through the suit
      if (speed > 0.25) {
        const f = 1.7 + speed * 0.9;
        const prev = this._stepPhase;
        this._stepPhase += dt * f * (hop > 0.5 ? 1 : 2);
        if (Math.floor(this._stepPhase) !== Math.floor(prev)) this._footprint(this.pos.e, this.pos.n, hop > 0.5 ? 1.6 : 0.8);
      }
      // the task under your boots
      const near = this._nearestTarget();
      this._showPrompt(near);
      if (near && (input.pressed('interact') || input.pressed('jump'))) this._perform(near);
    } else this._showPrompt(null);
    this._speed = speed;
    this._hop = hop;
    this.crouch += ((this.busy?.crouch ?? 0) - this.crouch) * Math.min(1, dt * 5);
    this.reach += ((this.busy?.reach ?? 0) - this.reach) * Math.min(1, dt * 5);
    this._updateCompanion(dt);
  }

  _nearestTarget() {
    let best = null;
    for (const t of this.targets.values()) {
      const d = this.distanceTo(t.e, t.n);
      if (d < t.radius && (!best || d < best.d)) best = { t, d };
    }
    return best?.t ?? null;
  }

  /** Kneel / reach for a moment, then resolve the task. */
  async _perform(t) {
    if (this.busy) return;
    const pose = { kneel: { crouch: 0.85, reach: 0.4, s: 1.6 }, reach: { crouch: 0.25, reach: 1, s: 1.5 }, none: { crouch: 0, reach: 0, s: 0.15 } }[t.anim];
    this.busy = pose;
    this.vel.e = this.vel.n = 0;
    if (this.distanceTo(t.e, t.n) > 0.3) this.yaw = Math.atan2(t.e - this.pos.e, t.n - this.pos.n);
    if (t.anim !== 'none') this.game.audio?.sfx?.('latch', { gain: 0.35 });
    const t0 = this.time;
    while (this.time - t0 < pose.s) await this._frame();
    this.busy = null;
    this.clearTarget(t.id);
    this.game.audio?.sfx?.('uiConfirm', { gain: 0.6 });
    t.resolve(t);
  }

  _updateCompanion(dt) {
    const c = this.companion;
    if (!c?.ready) return;
    // wander between a few work spots near the LM (photos, the solar wind experiment, samples)
    if (!c.goal || c.wait > 0) {
      c.wait -= dt;
      if (c.wait <= 0 && !c.goal) {
        const spots = [this.lmPoint(7, -5), this.lmPoint(9, 4), this.lmPoint(3, 6), this.lmPoint(-4, -6), this.lmPoint(12, 0)];
        c.goal = spots[Math.floor(Math.random() * spots.length)];
      }
      c.speed = 0;
    }
    if (c.goal) {
      const de = c.goal.e - c.pos.e;
      const dn = c.goal.n - c.pos.n;
      const d = Math.hypot(de, dn);
      if (d < 0.4) {
        c.goal = null;
        c.wait = 4 + Math.random() * 8;
        c.speed = 0;
      } else {
        const v = Math.min(1.5, d);
        c.pos.e += (de / d) * v * dt;
        c.pos.n += (dn / d) * v * dt;
        // around the descent stage, not through it
        const le = c.pos.e - this.lm.e;
        const ln = c.pos.n - this.lm.n;
        const ld = Math.hypot(le, ln);
        if (ld < LM_KEEP_OUT) {
          c.pos.e = this.lm.e + (le / (ld || 1)) * LM_KEEP_OUT;
          c.pos.n = this.lm.n + (ln / (ld || 1)) * LM_KEEP_OUT;
        }
        c.yaw += (Math.atan2(Math.sin(Math.atan2(de, dn) - c.yaw), Math.cos(Math.atan2(de, dn) - c.yaw))) * Math.min(1, dt * 4);
        c.speed = v;
      }
    }
  }

  _footprint(e, n, k = 1) {
    this.stats.steps++;
    this.game.audio?.sfx?.('footstep', { gain: 0.35 * k });
    const dust = this.view.dust;
    if (!dust) return;
    const dyn = this.sim.dyn;
    const { east, north, up } = this._tangent(e, n);
    const p = this.lunar.siteToEci(dyn, e, n, this.ground(e, n) + 0.05, new THREE.Vector3());
    for (let i = 0; i < 6 * k; i++) {
      const a = Math.random() * Math.PI * 2;
      const dir = new THREE.Vector3().copy(east).multiplyScalar(Math.cos(a)).addScaledVector(north, Math.sin(a));
      // ballistic at 1/6 g, no air: dust flies in clean arcs and drops
      const vel = dir.multiplyScalar(0.4 + Math.random() * 0.9 * k).addScaledVector(up, 0.4 + Math.random() * 0.7).add(dyn.moonVel);
      dust.emit({ pos: p.clone().addScaledVector(dir, 0.1), vel, life: 1.2 + Math.random() * 0.8, size0: 0.08, size1: 0.35 * k, alpha: 0.35, drag: 0, tint: [0.78, 0.77, 0.74] });
    }
  }

  /** Place the figures and props for this frame (after the terrain's update) and drive the camera. */
  sync(camWorld) {
    const L = this.lunar;
    const placeFigure = (astro, caster, pos, yaw, lift, speed, hop, crouch, reach, climb) => {
      const h = this.ground(pos.e, pos.n) + lift;
      this._pose(pos.e, pos.n, h, yaw, (this._pw ??= new THREE.Vector3()), (this._pq ??= new THREE.Quaternion()));
      astro.root.position.copy(this._pw).sub(camWorld);
      astro.root.quaternion.copy(this._pq);
      if (climb !== null && climb !== undefined) astro.setPose(this.time, { speed: 0.35, hop: 0, crouch: 0.15 + Math.sin(climb) * 0.1, reach: 0.6 });
      else astro.setPose(this.time, { speed, hop, crouch, reach });
      if (caster) {
        L.placeCaster(caster, this._pw, this._pq, camWorld);
        caster.visible = astro.root.visible;
        // the caster mirrors the joints
        copyPose(astro.root, caster);
      }
    };
    placeFigure(this.astro, this.casters[0], this.pos, this.yaw, this.lift, this._speed ?? 0, this._hop ?? 0, this.crouch, this.reach, this.climb);
    const c = this.companion;
    if (c) placeFigure(c.astro, c.caster, c.pos, c.yaw, c.lift ?? 0, c.speed ?? 0, 0, 0, 0, c.climb);
    for (const p of this.props) {
      p.rise = Math.min(1, p.rise + 0.02);
      const h = this.ground(p.e, p.n) - (1 - p.rise) * (p.kind === 'flag' ? 1.2 : 0.4);
      this._pose(p.e, p.n, h, p.yaw, (this._pw ??= new THREE.Vector3()), (this._pq ??= new THREE.Quaternion()));
      p.m.root.position.copy(this._pw).sub(camWorld);
      p.m.root.quaternion.copy(this._pq);
      L.placeCaster(p.caster, this._pw, this._pq, camWorld);
    }
    for (const t of this.targets.values()) {
      this._pose(t.e, t.n, this.ground(t.e, t.n) + 0.04, 0, (this._pw ??= new THREE.Vector3()), (this._pq ??= new THREE.Quaternion()));
      t.marker.root.position.copy(this._pw).sub(camWorld);
      t.marker.root.quaternion.copy(this._pq);
      t.marker.setPulse(this.time);
    }
  }

  /** Camera pose for the EVA views (ECI). orbit: { yaw, pitch, dist } from the view's drag/wheel. */
  cameraPose(mode, orbit, outPos, outQ) {
    const { east, north, up } = this._tangent(this.pos.e, this.pos.n);
    const h = this.ground(this.pos.e, this.pos.n) + this.lift;
    const body = this.lunar.siteToEci(this.sim.dyn, this.pos.e, this.pos.n, h, (this._cb ??= new THREE.Vector3()));
    if (mode === 'eva:fp') {
      // through the visor: eye height, looking where the astronaut faces, a little down
      outPos.copy(body).addScaledVector(up, 1.62 - this.crouch * 0.35);
      const fwd = _v.copy(north).multiplyScalar(Math.cos(this.yaw)).addScaledVector(east, Math.sin(this.yaw));
      const look = _v2.copy(fwd).multiplyScalar(Math.cos(orbit.fpPitch ?? -0.18)).addScaledVector(up, Math.sin(orbit.fpPitch ?? -0.18));
      _m.lookAt(new THREE.Vector3(), look, up);
      outQ.setFromRotationMatrix(_m);
      return 72;
    }
    // third person: orbit around the astronaut; the drag turns this.camYaw / pitch
    this.camYaw = orbit.evaYaw ?? this.camYaw;
    const pitch = Math.max(0.05, Math.min(1.2, orbit.evaPitch ?? 0.32));
    let dist = Math.max(2.5, Math.min(16, orbit.evaDist ?? 5.5));
    // keep the camera out of the descent stage: pull it in toward the astronaut when it would be inside
    const se = Math.sin(this.camYaw) * Math.cos(pitch);
    const sn = Math.cos(this.camYaw) * Math.cos(pitch);
    for (let i = 0; i < 12; i++) {
      const ce = this.pos.e + se * dist;
      const cn = this.pos.n + sn * dist;
      if (Math.hypot(ce - this.lm.e, cn - this.lm.n) > LM_KEEP_OUT + 1.6 || dist <= 1.2) break;
      dist *= 0.85;
    }
    const dir = _v.copy(north).multiplyScalar(Math.cos(this.camYaw)).addScaledVector(east, Math.sin(this.camYaw));
    // and above the ground under it
    const ce = this.pos.e + se * dist;
    const cn = this.pos.n + sn * dist;
    const lift = Math.max(1.25 + Math.sin(pitch) * dist, this.ground(ce, cn) - h + 0.6);
    outPos.copy(body).addScaledVector(dir, Math.cos(pitch) * dist).addScaledVector(up, lift);
    const target = (this._ct ??= new THREE.Vector3()).copy(body).addScaledVector(up, 1.1);
    _m.lookAt(outPos, target, up);
    outQ.setFromRotationMatrix(_m);
    return 55;
  }

  // ---------------------------------------------------------------- photo, prompt

  async photo() {
    const url = await this.view.capture?.();
    this.game.audio?.sfx?.('shutter');
    this.sim.bus.emit('mission:photo', { url, title: 'Hasselblad · película 70 mm', caption: 'Mar de la Tranquilidad · 20 de julio de 1969', durationS: 5 });
    this.sim.bus.emit('eva:photo', {});
  }

  _buildPrompt() {
    const el = document.createElement('div');
    el.className = 'eva-prompt';
    el.hidden = true;
    const btn = document.createElement('button');
    btn.className = 'btn btn-primary';
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.game.input.virtualPress('interact');
    });
    el.append(btn);
    this.game.uiRoot.append(el);
    this.promptEl = el;
    this.promptBtn = btn;
  }

  _showPrompt(t) {
    const key = t?.id ?? null;
    if (key === this._promptKey) return;
    this._promptKey = key;
    this.promptEl.hidden = !t;
    if (t) this.promptBtn.textContent = `${this.game.input.isTouch ? '' : 'E · '}${t.label}`;
  }

  dispose() {
    for (const id of [...this.targets.keys()]) this.clearTarget(id);
    for (const p of this.props) {
      this.view.near.remove(p.m.root);
      this.lunar.removeCaster(p.caster);
      p.m.dispose();
    }
    this.view.near.remove(this.astro.root);
    this.astro.dispose();
    for (const c of this.casters) this.lunar.removeCaster(c);
    if (this.companion) {
      this.view.near.remove(this.companion.astro.root);
      this.lunar.removeCaster(this.companion.caster);
      this.companion.astro.dispose();
    }
    this.promptEl.remove();
  }
}

/** Copy the joint rotations / offsets of a figure onto its shadow caster (same hierarchy). */
const _nodes = new WeakMap();
function nodesOf(root) {
  let list = _nodes.get(root);
  if (!list) {
    list = [];
    root.traverse((o) => list.push(o));
    _nodes.set(root, list);
  }
  return list;
}
function copyPose(src, dst) {
  const a = nodesOf(src);
  const b = nodesOf(dst);
  for (let i = 1; i < a.length && i < b.length; i++) {
    b[i].position.copy(a[i].position);
    b[i].quaternion.copy(a[i].quaternion);
  }
}
