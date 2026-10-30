// Flight dynamics: translation (Earth + Moon gravity, thrust, drag/lift), rate-based attitude
// control, surface contact on the Moon (terrain + boulders), atmospheric entry with parachutes,
// separations/docking (config changes + passive bodies) and derived state for displays.

import { Matrix4, Quaternion, Vector3 } from 'three';
import { DEG, MU_EARTH, MU_MOON, R_EARTH, R_MOON, SITES_DEG, FT } from '../../core/constants.js';
import { earthFixedToEci, moonPosition, moonVelocity, sunDirection } from './ephemeris.js';
import { getInitialState } from './initialStates.js';
import { heightLocal, boulderAt, siteFrame } from '../terrain/lunarTerrain.js';
import { CONFIGS, GEOM, moduleTransform } from '../geometry.js';

/** Altitude of the SATURN_V reference point on the pad: ML deck (29 m above sea level) + 33 m. */
export const PAD_REF_ALT = 62;
export const MOON_OMEGA = (2 * Math.PI) / (27.321661 * 86400); // sidereal rotation (rad/s)

const _acc = { force: new Vector3(), torque: new Vector3(), mdot: 0 };
const _tmp = new Vector3();
const _tmp2 = new Vector3();
const _gm = new Vector3();
const _q = new Quaternion();
const _q2 = new Quaternion();
const _bx = new Vector3();
const _by = new Vector3();
const _bz = new Vector3();
const _vAir = new Vector3();
const _m4 = new Matrix4();
const _mNext = new Vector3();
const _sl = new Vector3();
const _sl2 = new Vector3();
const _rc = new Vector3();
const _mMid = new Vector3();
const _r0 = new Vector3();
const _v0 = new Vector3();
const _rt = new Vector3();
const _vt = new Vector3();
const _v2c = new Vector3();
const _v3c = new Vector3();
const _k1 = new Vector3();
const _k2 = new Vector3();
const _k3 = new Vector3();
const _k4 = new Vector3();

export class FlightDynamics {
  constructor({ vehicle, bus, clock, missionId }) {
    this.vehicle = vehicle;
    this.bus = bus;
    this.clock = clock;
    this.missionId = missionId;
    this.mode = 'SPACE';
    this.bodies = new Map();
    this.moonPos = new Vector3();
    this.moonVel = new Vector3();
    this.moonAngle = 0;
    this.sunDir = new Vector3(1, 0, 0);
    this.site = 'TRANQUILITY';
    this.landedLocal = null;
    this._off = [bus.on('vehicle:request', (e) => this.handleRequest(e))];
  }

  async init(setup) {
    const s = typeof setup.state === 'string' || !setup.state
      ? getInitialState(setup.state ?? 'EARTH_PARKING_ORBIT', { epochUTC: this.clock.epochUTC, get: this.clock.get, missionId: this.missionId })
      : setup.state;
    const st = this.vehicle.state;
    st.r.copy(s.r);
    st.v.copy(s.v);
    st.q.copy(s.q ?? new Quaternion());
    st.w.copy(s.w ?? new Vector3());
    this.site = setup.site ?? s.site ?? 'TRANQUILITY';
    this.pad = s.pad ?? { id: 'A', lat: SITES_DEG.LC39A.lat, lon: SITES_DEG.LC39A.lon, alt: PAD_REF_ALT };
    this.mode = setup.mode ?? s.mode ?? 'SPACE';
    this._updateEphemeris();
    if (this.mode === 'LANDED') this._captureSurface();
    for (const b of s.bodies ?? []) this.addBody(b);
    this._derive();
  }

  setMode(mode) {
    if (this.mode === mode) return;
    const prev = this.mode;
    this.mode = mode;
    this.bus.emit('dynamics:mode', { mode, prev });
  }

  maxStep() {
    const v = this.vehicle;
    const st = v.state;
    if (this.mode === 'PAD' || this.mode === 'ASCENT' || this.mode === 'ENTRY') return 0.05;
    if (v.cmd.sps || v.cmd.dps || v.cmd.aps || v.cmd.burnArmed || v.tm['CM.SPS.THRUST'] || v.tm['LM.ENG.THRUST_PCT'] > 0) return 0.05;
    if (v.modules.saturn && v.isAttached('saturn') && (v.modules.saturn.thrust > 0 || v.modules.saturn.tb6 !== null && this.clock.get > v.modules.saturn.tb6 + 560)) return 0.1;
    if (st.primary === 'MOON' && st.alt < 30000) return 0.05;
    if (st.primary === 'EARTH' && st.alt < 140000) return 0.1;
    if (this.bodies.size && this.nearestBodyDist() < 2000) return 0.05;
    return st.alt > 5e6 ? 8 : 1;
  }

  maxWarp() {
    const v = this.vehicle;
    const st = v.state;
    if (this.mode === 'ASCENT' || this.mode === 'ENTRY') return 10;
    if (v.cmd.sps || v.cmd.dps || v.cmd.aps || v.tm['CM.SPS.THRUST'] || v.tm['LM.ENG.THRUST_PCT'] > 0) return 5;
    if (v.modules.saturn?.thrust > 0 && v.isAttached('saturn')) return 10;
    if (st.primary === 'MOON' && st.alt < 30000 && !st.landed) return 4;
    if (this.bodies.size && this.nearestBodyDist() < 500) return 2;
    return 10000;
  }

  nearestBodyDist() {
    let d = Infinity;
    for (const b of this.bodies.values()) if (!b.debris) d = Math.min(d, b.r.distanceTo(this.vehicle.state.r));
    return d;
  }

  addBody(body) {
    const b = { w: new Vector3(), q: new Quaternion(), mass: 1000, ...body };
    b.r = body.r.clone();
    b.v = body.v.clone();
    b.q = (body.q ?? new Quaternion()).clone();
    this.bodies.set(b.id, b);
    this.bus.emit('dynamics:bodyAdded', { id: b.id });
    return b;
  }

  removeBody(id) {
    if (this.bodies.delete(id)) this.bus.emit('dynamics:bodyRemoved', { id });
  }

  getBody(id) {
    return this.bodies.get(id) ?? null;
  }

  /** Spawn a jettisoned part at an offset (body frame) with a separation velocity (body frame). */
  _spawn(id, config, offsetBody, dvBody, ttl = null, extra = {}) {
    const st = this.vehicle.state;
    const r = st.r.clone().add(offsetBody.clone().applyQuaternion(st.q));
    const v = st.v.clone().add(dvBody.clone().applyQuaternion(st.q));
    return this.addBody({ id, config, r, v, q: st.q.clone(), ttl, debris: ttl !== null, ...extra });
  }

  _shift(fromConfig, toConfig, module) {
    this._reframe(toConfig, module, module, false);
  }

  /** World pose of a module datum of the current configuration. */
  _modulePose(module) {
    const st = this.vehicle.state;
    const a = moduleTransform(this.vehicle.config, module);
    return { P: a.offset.clone().applyQuaternion(st.q).add(st.r), Q: st.q.clone().multiply(a.quat) };
  }

  /** Switch the player's vehicle to `newCfg` keeping `moduleOld` (now `moduleNew`) fixed in space. */
  _reframe(newCfg, moduleOld, moduleNew = moduleOld, setConfig = true, info = {}) {
    const v = this.vehicle;
    const st = v.state;
    let pose;
    let b;
    try {
      pose = this._modulePose(moduleOld);
      b = moduleTransform(newCfg, moduleNew);
    } catch {
      if (setConfig) v._setConfig(newCfg, info);
      return;
    }
    const wWorld = st.w.clone().applyQuaternion(st.q);
    const qn = pose.Q.multiply(b.quat.clone().invert());
    st.q.copy(qn).normalize();
    st.r.copy(pose.P).sub(b.offset.clone().applyQuaternion(qn));
    st.w.copy(wWorld.applyQuaternion(qn.clone().invert()));
    if (setConfig) v._setConfig(newCfg, info);
  }

  /** Spawn a passive body for a module of the current stack. Pseudo-configs (SIC, SII,
   *  INTERSTAGE, LES, LM_DESCENT) have their origin at the module datum; real CONFIGS at their ref. */
  _spawnPart(id, bodyCfg, module, moduleInBody, dvBody, ttl = null, extra = {}) {
    const st = this.vehicle.state;
    let r;
    let q;
    try {
      const { P, Q } = this._modulePose(module);
      r = P;
      q = Q;
      if (CONFIGS[bodyCfg]) {
        const b = moduleTransform(bodyCfg, moduleInBody ?? module);
        q = Q.clone().multiply(b.quat.clone().invert());
        r = P.clone().sub(b.offset.clone().applyQuaternion(q));
      }
    } catch {
      r = st.r.clone();
      q = st.q.clone();
    }
    const v = st.v.clone().add(dvBody.clone().applyQuaternion(st.q));
    return this.addBody({ id, config: bodyCfg, r, v, q, ttl, debris: ttl !== null, ...extra });
  }

  handleRequest(req) {
    const { kind } = req;
    const v = this.vehicle;
    const st = v.state;
    const cfg = v.config;
    let done = true;
    switch (kind) {
      case 'LIFTOFF':
        st.liftoff = true;
        this.setMode('ASCENT');
        break;
      case 'LES_JETT':
        if (!v.parts.les) return;
        v.parts.les = false;
        v.parts.bpc = false;
        this._spawnPart('LES', 'LES', 'LES', null, new Vector3(32, 2.5, 0.6), 40, { w: new Vector3(0.02, 0.06, 0.03) });
        break;
      case 'SIC_SEP':
        this._spawnPart('SIC', 'SIC', 'SIC', null, new Vector3(-3.5, 0, 0), 150, { w: new Vector3(0.01, 0.012, -0.008) });
        this._reframe('SATURN_V_SII', 'SII', 'SII', true, { event: kind });
        break;
      case 'SIB_SEP':
        this._spawnPart('SIB', 'SIB', 'SIB', null, new Vector3(-3, 0, 0), 150, { w: new Vector3(0.012, -0.01, 0.006) });
        this._reframe('SATURN_IB_SIVB', 'SIVB', 'SIVB', true, { event: kind });
        break;
      case 'SII_INTERSTAGE_JETT':
        v.parts.interstage = false;
        this._spawnPart('INTERSTAGE', 'INTERSTAGE', 'SII', null, new Vector3(-2.5, 0, 0), 60, { w: new Vector3(0.05, 0.01, 0.02) });
        break;
      case 'SII_SEP':
        this._spawnPart('SII', 'SII', 'SII', null, new Vector3(-3, 0, 0), 150, { w: new Vector3(0.006, -0.01, 0.008) });
        this._reframe('SIVB_STACK', 'SIVB', 'SIVB', true, { event: kind });
        break;
      case 'ORBIT_INSERTION':
        this.setMode('SPACE');
        break;
      case 'CSM_SEP':
        if (cfg !== 'SIVB_STACK' && cfg !== 'SATURN_IB_SIVB') return;
        if (cfg === 'SATURN_IB_SIVB') this._spawnPart('SIVB', 'SIVB', 'SIVB', 'SIVB', new Vector3(-0.3, 0, 0), null, { label: 'S-IVB' });
        else this._spawnPart('SIVB_LM', 'SIVB_LM', 'SIVB', 'SIVB', new Vector3(-0.3, 0, 0), null, { label: 'S-IVB / LM' });
        v.parts.slaPanels = false;
        this._reframe('CSM', 'CSM', 'CSM', true, { event: kind });
        break;
      case 'DOCK_CAPTURE':
        break;
      case 'DOCK_HARD': {
        const target = req.targetId ? this.bodies.get(req.targetId) : this._dockTarget;
        if (!target || !this._captured) return;
        this.removeBody(target.id);
        this._captured = false;
        if (target.config === 'SIVB_LM') this._reframe('CSM_LM_SIVB', 'CSM', 'CSM_DOCKED_TOP', true, { event: kind });
        else if (target.config === 'LM_ASC') this._reframe('CSM_LMASC', 'CSM', 'CSM', true, { event: kind });
        else if (target.config === 'LM') this._reframe('CSM_LM', 'CSM', 'CSM', true, { event: kind });
        else if (target.config === 'CSM') {
          if (cfg === 'LM_ASC') this._reframe('CSM_LMASC', 'LM_ASC', 'LM_ASC_DOCKED', true, { event: kind });
          else this._reframe('CSM_LM', 'LM', 'LM_DOCKED', true, { event: kind });
        }
        v.parts.probeExtended = false;
        break;
      }
      case 'LM_EXTRACT':
        if (cfg !== 'CSM_LM_SIVB') return;
        this._spawnPart('SIVB', 'SIVB', 'SIVB', 'SIVB', new Vector3(-0.25, 0, 0), null, { label: 'S-IVB' });
        this._reframe('CSM_LM', 'CSM_DOCKED_TOP', 'CSM', true, { event: kind });
        break;
      case 'UNDOCK': {
        if (cfg !== 'CSM_LM' && cfg !== 'CSM_LMASC') return;
        const asc = cfg === 'CSM_LMASC';
        if (v.station === 'LM') {
          this._spawnPart('CSM', 'CSM', 'CSM', 'CSM', new Vector3(-0.15, 0, 0), null, { label: req.label ?? 'Columbia' });
          this._reframe(asc ? 'LM_ASC' : 'LM', asc ? 'LM_ASC_DOCKED' : 'LM_DOCKED', asc ? 'LM_ASC' : 'LM', true, { event: kind });
        } else {
          this._spawnPart('LM', asc ? 'LM_ASC' : 'LM', asc ? 'LM_ASC_DOCKED' : 'LM_DOCKED', asc ? 'LM_ASC' : 'LM', new Vector3(0.15, 0, 0), null, { label: req.label ?? 'Eagle' });
          this._reframe('CSM', 'CSM', 'CSM', true, { event: kind });
        }
        v.parts.probeExtended = true;
        break;
      }
      case 'LM_STAGE':
      case 'LM_ASC_LIFTOFF':
        if (cfg === 'LM') {
          if (st.landed) this._spawnPart('LM_DESCENT', 'LM_DESCENT', 'LM', null, new Vector3(), null, { static: true, label: 'Etapa de descenso' });
          v.modules.lm && (v.modules.lm.staged = true);
          this._reframe('LM_ASC', 'LM', 'LM_ASC', true, { event: kind });
          if (st.landed) this._captureSurface();
        }
        break;
      case 'LM_JETT': {
        if (cfg !== 'CSM_LM' && cfg !== 'CSM_LMASC' && cfg !== 'CM_LM') return;
        const asc = cfg === 'CSM_LMASC';
        this._spawnPart('LM', asc ? 'LM_ASC' : 'LM', asc ? 'LM_ASC_DOCKED' : 'LM_DOCKED', asc ? 'LM_ASC' : 'LM', new Vector3(0.6, 0, 0), null, { label: req.label ?? 'Aquarius' });
        v.setStation('CM');
        if (cfg === 'CM_LM') this._reframe('CM', 'CM', 'CM', true, { event: kind });
        else this._reframe('CSM', 'CSM', 'CSM', true, { event: kind });
        break;
      }
      case 'CM_SM_SEP':
        if (cfg !== 'CSM' && cfg !== 'CSM_LM') return;
        this._spawnPart('SM', 'SM', cfg === 'CSM' ? 'CSM' : 'CSM', 'SM', new Vector3(-0.6, 0, 0.15), null, { label: 'Módulo de servicio', damaged: v.parts.smDamaged, w: new Vector3(0.004, 0.01, 0) });
        if (v.modules.csm) v.modules.csm.hasSM = false;
        if (cfg === 'CSM_LM') this._reframe('CM_LM', 'CSM', 'CM', true, { event: kind });
        else this._reframe('CM', 'CSM', 'CM', true, { event: kind });
        break;
      case 'APEX_COVER_JETT':
        v.parts.apexCover = false;
        break;
      case 'DROGUE_DEPLOY':
        if (st.alt > 9000 && st.alt < 12000 && st.primary === 'EARTH') v.parts.drogues = true;
        else if (st.alt < 9000 && st.primary === 'EARTH') v.parts.drogues = true;
        else return;
        break;
      case 'MAIN_DEPLOY':
        if (st.primary !== 'EARTH' || st.alt > 5000) return;
        v.parts.drogues = false;
        v.parts.mains = true;
        break;
      case 'O2_TANK2_EXPLOSION':
        st.w.add(new Vector3(0.01, -0.006, 0.008));
        this.venting = this.clock.get;
        break;
      default:
        done = !!req.source;
        break;
    }
    if (done) this.bus.emit('vehicle:event', { kind, get: this.clock.get, ...req });
  }

  _updateEphemeris() {
    const utc = this.clock.utcMs;
    moonPosition(utc, this.moonPos);
    moonVelocity(utc, this.moonVel);
    sunDirection(utc, this.sunDir);
    this.moonAngle = Math.atan2(-this.moonPos.y, -this.moonPos.x);
  }

  /** Moon-fixed (rotating with moonAngle about Z) → ECI for a unit direction. */
  moonFixedToEci(dir, out = new Vector3()) {
    const c = Math.cos(this.moonAngle);
    const s = Math.sin(this.moonAngle);
    return out.set(dir.x * c - dir.y * s, dir.x * s + dir.y * c, dir.z);
  }

  eciToMoonFixed(dir, out = new Vector3()) {
    const c = Math.cos(-this.moonAngle);
    const s = Math.sin(-this.moonAngle);
    return out.set(dir.x * c - dir.y * s, dir.x * s + dir.y * c, dir.z);
  }

  /** Local site coordinates (east, north metres) of a moon-relative position. */
  siteLocal(rRel) {
    const f = siteFrame(this.site);
    const dir = this.eciToMoonFixed(_sl.copy(rRel).normalize(), _sl2);
    const ang = Math.acos(Math.max(-1, Math.min(1, dir.dot(f.up))));
    const tang = dir.clone().addScaledVector(f.up, -dir.dot(f.up));
    if (tang.lengthSq() < 1e-12) return { x: 0, y: 0, dist: 0 };
    tang.normalize();
    const d = ang * R_MOON;
    return { x: tang.dot(f.east) * d, y: tang.dot(f.north) * d, dist: d };
  }

  terrainHeightAt(rRel) {
    const l = this.siteLocal(rRel);
    if (l.dist > 30000) return 0;
    return heightLocal(l.x, l.y, this.site);
  }

  _gravity(r, out) {
    const r3 = Math.pow(r.lengthSq(), 1.5);
    out.copy(r).multiplyScalar(-MU_EARTH / r3);
    _gm.subVectors(r, this.moonPos);
    const d3 = Math.pow(_gm.lengthSq(), 1.5);
    out.addScaledVector(_gm, -MU_MOON / d3);
    const m3 = Math.pow(this.moonPos.lengthSq(), 1.5);
    out.addScaledVector(this.moonPos, -MU_MOON / m3);
    return out;
  }

  _gravityAt(r, moon, out) {
    const r3 = Math.pow(r.lengthSq(), 1.5);
    out.copy(r).multiplyScalar(-MU_EARTH / r3);
    _gm.subVectors(r, moon);
    out.addScaledVector(_gm, -MU_MOON / Math.pow(_gm.lengthSq(), 1.5));
    out.addScaledVector(moon, -MU_MOON / Math.pow(moon.lengthSq(), 1.5));
    return out;
  }

  _rk4(st, h, aExtra) {
    const m0 = this.moonPos;
    const m1 = moonPosition(this.clock.utcMs + h * 1000, _mNext);
    const mh = _mMid.addVectors(m0, m1).multiplyScalar(0.5);
    const r0 = _r0.copy(st.r);
    const v0 = _v0.copy(st.v);
    const a1 = this._gravityAt(r0, m0, _k1).add(aExtra);
    const r2 = _rt.copy(v0).multiplyScalar(h / 2).add(r0);
    const v2 = _vt.copy(a1).multiplyScalar(h / 2).add(v0);
    const a2 = this._gravityAt(r2, mh, _k2).add(aExtra);
    const v2c = _v2c.copy(v2);
    const r3 = _rt.copy(v2c).multiplyScalar(h / 2).add(r0);
    const v3 = _vt.copy(a2).multiplyScalar(h / 2).add(v0);
    const a3 = this._gravityAt(r3, mh, _k3).add(aExtra);
    const v3c = _v3c.copy(v3);
    const r4 = _rt.copy(v3c).multiplyScalar(h).add(r0);
    const v4 = _vt.copy(a3).multiplyScalar(h).add(v0);
    const a4 = this._gravityAt(r4, m1, _k4).add(aExtra);
    // r += h/6 (v0 + 2 v2 + 2 v3 + v4) ; v += h/6 (a1 + 2 a2 + 2 a3 + a4)
    st.r.addScaledVector(v0, h / 6).addScaledVector(v2c, h / 3).addScaledVector(v3c, h / 3).addScaledVector(v4, h / 6);
    st.v.addScaledVector(a1, h / 6).addScaledVector(a2, h / 3).addScaledVector(a3, h / 3).addScaledVector(a4, h / 6);
  }

  _massProps() {
    const v = this.vehicle;
    const m = v.modules;
    let mass = 0;
    const inertia = new Vector3();
    for (const [k, mod] of [['saturn', m.saturn], ['csm', m.csm], ['lm', m.lm]]) {
      if (!mod || !v.isAttached(k)) continue;
      const p = mod.massProps();
      mass += p.mass;
      inertia.add(p.inertia);
    }
    return { mass: Math.max(mass, 500), inertia };
  }

  _captureSurface() {
    const st = this.vehicle.state;
    st.rRel.subVectors(st.r, this.moonPos);
    this.landedLocal = this.eciToMoonFixed(st.rRel.clone());
    this.landedQ = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -this.moonAngle).multiply(st.q);
    st.landed = true;
  }

  step(h) {
    this._updateEphemeris();
    const v = this.vehicle;
    const st = v.state;
    const mods = v.modules;
    _acc.force.set(0, 0, 0);
    _acc.torque.set(0, 0, 0);
    _acc.mdot = 0;
    for (const [k, mod] of [['saturn', mods.saturn], ['csm', mods.csm], ['lm', mods.lm]]) if (mod && v.isAttached(k)) mod.propulsion(_acc, h);
    const { mass } = this._massProps();
    st.mass = mass;

    if (this.mode === 'PAD') {
      const s = this.pad;
      earthFixedToEci(s.lat * DEG, s.lon * DEG, s.alt, this.clock.utcMs, st.r, st.v);
      if (mods.saturn) {
        mods.saturn.update?.(0);
        this._ascentAttitude(h, 1);
      }
      st.w.set(0, 0, 0);
    } else if (this.mode === 'LANDED') {
      // fixed to the rotating Moon until the APS or DPS lifts off
      const lift = _acc.force.x / mass > 1.7;
      if (lift) {
        st.landed = false;
        this.setMode('SPACE');
        this.bus.emit('vehicle:event', { kind: 'LM_ASC_LIFTOFF', get: this.clock.get });
      } else {
        this.moonFixedToEci(this.landedLocal, st.r).add(this.moonPos);
        const rot = _q.setFromAxisAngle(_tmp.set(0, 0, 1), this.moonAngle);
        st.q.copy(rot).multiply(this.landedQ);
        st.v.copy(this.moonVel).add(_tmp2.set(0, 0, MOON_OMEGA).cross(st.r.clone().sub(this.moonPos)));
        st.w.set(0, 0, 0);
        st.accel.set(0, 0, 0);
      }
    } else if (this.mode === 'SPLASHED') {
      st.v.set(-7.2921159e-5 * st.r.y, 7.2921159e-5 * st.r.x, 0);
      st.r.addScaledVector(st.v, h);
    } else {
      // the IU flies the stack: ascent steering, TLI steering, and an orbital-rate prograde hold while
      // coasting in the parking orbit (the crew only takes over with LV GUID = CMC)
      const iu = mods.saturn && v.isAttached('saturn') && (this.mode === 'ASCENT' || ((mods.saturn.stage === 'SIVB_TLI' || mods.saturn.stage === 'SIVB_COAST') && v.sw.get('CM.LV.LV_GUID') !== 'CMC'));
      if (iu) this._ascentAttitude(h, this.mode === 'ASCENT' ? 2 : 0.5);
      else this._rotate(h);
      this._translate(h, mass);
      this._contacts(h);
    }
    for (const b of this.bodies.values()) {
      if (b.static) continue;
      const wl = b.w.length();
      if (wl > 1e-7) b.q.multiply(_q2.setFromAxisAngle(_tmp.copy(b.w).divideScalar(wl), wl * h)).normalize();
      const g = this._gravity(b.r, _tmp2.set(0, 0, 0));
      b.v.addScaledVector(g, h);
      if (b.debris && b.r.length() - R_EARTH < 120000) b.v.multiplyScalar(1 - Math.min(0.9, h * 0.02));
      b.r.addScaledVector(b.v, h);
      if (b.ttl !== undefined && b.ttl !== null && (b.ttl -= h) <= 0) this.removeBody(b.id);
    }
    this._docking(h);
    this._derive();
  }

  /** Saturn V kinematic steering: body +X along the IU thrust direction, crew heads-down. */
  _ascentAttitude(h, rate) {
    const st = this.vehicle.state;
    const sat = this.vehicle.modules.saturn;
    const x = sat.steerDir;
    if (x.lengthSq() < 0.5) return;
    _bx.copy(x).normalize();
    _tmp.copy(sat.headingDir);
    _bz.copy(_tmp).addScaledVector(_bx, -_tmp.dot(_bx)).normalize().negate();
    _by.crossVectors(_bz, _bx);
    _m4.makeBasis(_bx, _by, _bz);
    _q.setFromRotationMatrix(_m4);
    st.q.slerp(_q, Math.min(1, h * rate));
    st.w.set(0, 0, 0);
  }

  /** Rate-based attitude: slew to cmd.attitudeTarget, else follow cmd.rateCmd. */
  _rotate(h) {
    const v = this.vehicle;
    const st = v.state;
    const cmd = v.cmd;
    const rcsOk = v.station === 'LM' ? !!v.modules.lm && ((v.tm['LM.EPS.CDR_BUS.V'] ?? 0) > 18 || (v.tm['LM.EPS.LMP_BUS.V'] ?? 0) > 18) : true;
    if (cmd.attitudeTarget && rcsOk) {
      // swing-twist slew: bring the thrust axis (+X) onto the target by the shortest rotation first,
      // then roll about it — the DAP never wanders off-axis while the target's roll changes
      const maxStep = (v.station === 'LM' ? 8 : 3) * DEG * h;
      const x = _bx.set(1, 0, 0).applyQuaternion(st.q);
      const xt = _by.set(1, 0, 0).applyQuaternion(cmd.attitudeTarget);
      const ang = Math.acos(Math.max(-1, Math.min(1, x.dot(xt))));
      if (ang > 1e-6) {
        const axis = _bz.crossVectors(x, xt);
        if (axis.lengthSq() < 1e-12) axis.set(0, 0, 1).applyQuaternion(st.q);
        st.q.premultiply(_q.setFromAxisAngle(axis.normalize(), Math.min(ang, maxStep)));
      }
      if (ang < 0.1) {
        const z = _tmp2.set(0, 0, 1).applyQuaternion(st.q);
        const zt = _gm.set(0, 0, 1).applyQuaternion(cmd.attitudeTarget);
        const xb = _bx.set(1, 0, 0).applyQuaternion(st.q);
        const roll = Math.atan2(_bz.crossVectors(z, zt).dot(xb), z.dot(zt));
        if (Math.abs(roll) > 1e-6) st.q.premultiply(_q.setFromAxisAngle(xb, Math.sign(roll) * Math.min(Math.abs(roll), maxStep * 0.6)));
      }
      st.w.set(0, 0, 0);
      st.q.normalize();
      return;
    }
    if (rcsOk && cmd.rateCmd) {
      const k = Math.min(1, h * 2.5);
      st.w.x += (cmd.rateCmd.x - st.w.x) * k;
      st.w.y += (cmd.rateCmd.y - st.w.y) * k;
      st.w.z += (cmd.rateCmd.z - st.w.z) * k;
    }
    const wl = st.w.length();
    if (wl > 1e-9) {
      _q.setFromAxisAngle(_tmp.copy(st.w).divideScalar(wl), wl * h);
      st.q.multiply(_q).normalize();
    }
  }

  _translate(h, mass) {
    const st = this.vehicle.state;
    const v = this.vehicle;
    const thrustEci = _tmp.copy(_acc.force).applyQuaternion(st.q).divideScalar(mass);
    st.accel.copy(_acc.force).divideScalar(mass);
    // RK4 on gravity (Earth + Moon, Moon position interpolated across the step) + constant thrust
    this._rk4(st, h, thrustEci);
    const alt = st.r.length() - R_EARTH;
    if (alt < 125000) {
      _vAir.set(st.v.x + 7.2921159e-5 * st.r.y, st.v.y - 7.2921159e-5 * st.r.x, st.v.z);
      const rho = 1.225 * Math.exp(-Math.max(0, alt) / 7160);
      const va = _vAir.length();
      let area = 80;
      let cd = 0.5;
      let ld = 0;
      if (!v.hasSaturn) {
        area = 12.0;
        cd = 1.25;
        ld = v.config === 'CM' ? 0.3 : 0;
        if (v.parts.drogues) {
          area = 2 * 18;
          cd = 1.0;
          ld = 0;
        }
        if (v.parts.mains) {
          area = 3 * 380;
          cd = 0.85;
          ld = 0;
        }
      }
      st.dynPressure = 0.5 * rho * va * va;
      st.mach = va / 300;
      const dragAcc = (st.dynPressure * cd * area) / mass;
      if (va > 1) {
        const dv = Math.min(va * 0.9, dragAcc * h);
        st.v.addScaledVector(_vAir, -dv / va);
        if (ld > 0) {
          // lift perpendicular to the airflow, rotated by the bank angle around it
          const upR = _gm.copy(st.r).normalize();
          const liftDir = upR.addScaledVector(_vAir, -upR.dot(_vAir) / (va * va)).normalize();
          const side = _bx.crossVectors(_vAir, liftDir).normalize();
          const bank = v.cmd.entryBank ?? 0;
          liftDir.multiplyScalar(Math.cos(bank)).addScaledVector(side, Math.sin(bank));
          st.v.addScaledVector(liftDir, dragAcc * ld * h);
        }
        st.accel.addScaledVector(_vAir.clone().applyQuaternion(_q2.copy(st.q).invert()), -dragAcc / va);
      }
      if (!v.hasSaturn && alt < 122000 && this.mode !== 'ENTRY' && st.speed > 2000) {
        this.setMode('ENTRY');
        this.bus.emit('vehicle:event', { kind: 'ENTRY_INTERFACE', get: this.clock.get });
      }
      const black = !v.hasSaturn && alt < 90000 && alt > 40000 && va > 5500;
      if (black !== st.inBlackout) {
        st.inBlackout = black;
        this.bus.emit('vehicle:event', { kind: black ? 'BLACKOUT_START' : 'BLACKOUT_END', get: this.clock.get });
      }
      // ELS automatic sequence (baroswitches)
      if (v.config === 'CM' && this.mode === 'ENTRY' && v.sw.get('CM.SEQ.ELS_AUTO') === 'AUTO' && v.sw.get('CM.SEQ.ELS_LOGIC') === 'ON') {
        if (alt < 7300 && !v.parts.drogues && !v.parts.mains) this.handleRequest({ kind: 'DROGUE_DEPLOY', source: 'els' });
        if (alt < 3050 && !v.parts.mains) this.handleRequest({ kind: 'MAIN_DEPLOY', source: 'els' });
      }
    } else st.dynPressure = 0;
    st.gLoad = st.accel.length() / 9.80665;
  }

  _contacts() {
    const v = this.vehicle;
    const st = v.state;
    // Earth: splashdown
    const altE = st.r.length() - R_EARTH;
    if (altE <= 0 && !v.hasSaturn) {
      st.r.setLength(R_EARTH);
      const vs = st.speed;
      st.splashed = true;
      this.setMode('SPLASHED');
      this.bus.emit('vehicle:event', { kind: 'SPLASHDOWN', get: this.clock.get, speed: vs, chutes: v.parts.mains });
      return;
    }
    // Moon: touchdown (footpads at the LM datum)
    const rRel = _rc.subVectors(st.r, this.moonPos);
    const d = rRel.length();
    if (d - R_MOON > 2000) return;
    const terr = this.terrainHeightAt(rRel);
    let footOffset = 2;
    if (v.config === 'LM') footOffset = CONFIGS.LM.ref;
    else if (v.config === 'LM_ASC') footOffset = CONFIGS.LM_ASC.ref - GEOM.lm.ascStageBaseX + 0.3;
    const hFoot = d - R_MOON - terr - footOffset;
    st.altTerrain = hFoot;
    if (hFoot <= 0 && !st.landed) {
      const up = rRel.clone().normalize();
      const vRel = st.v.clone().sub(this.moonVel).sub(new Vector3(-MOON_OMEGA * rRel.y, MOON_OMEGA * rRel.x, 0));
      const vVert = vRel.dot(up);
      const vHor = vRel.clone().addScaledVector(up, -vVert).length();
      const bodyUp = new Vector3(1, 0, 0).applyQuaternion(st.q);
      const tilt = Math.acos(Math.max(-1, Math.min(1, bodyUp.dot(up)))) / DEG;
      const l = this.siteLocal(rRel);
      const boulder = l.dist < 3000 ? boulderAt(l.x, l.y, 4.5, this.site) : 0;
      const slope = Math.abs(heightLocal(l.x + 4, l.y, this.site) - heightLocal(l.x - 4, l.y, this.site)) / 8;
      const crash = -vVert > 3.2 || vHor > 1.6 || tilt > 14 || boulder > 0.9 || slope > 0.22;
      rRel.setLength(R_MOON + terr + footOffset);
      st.r.copy(this.moonPos).add(rRel);
      // settle upright on the surface
      const yaw = new Vector3(0, 0, 1).applyQuaternion(st.q);
      st.q.copy(GNCQuat(up, yaw));
      this.setMode('LANDED');
      this._captureSurface();
      this.bus.emit('vehicle:event', { kind: 'TOUCHDOWN', get: this.clock.get, vSpeed: -vVert, hSpeed: vHor, tilt, crash, boulder, slope, local: l });
    }
  }

  // ---------------------------------------------------------------- docking

  /** Relative geometry between the active vehicle's docking port and the target's. */
  dockingTelemetry(targetId) {
    const v = this.vehicle;
    const st = v.state;
    const tgt = targetId ? this.bodies.get(targetId) : this._findDockTarget();
    if (!tgt) return null;
    // active port: CSM probe tip (+X); target port: LM drogue (+X of the LM, which faces the CSM)
    let portOff;
    try {
      const mt = moduleTransform(v.config, v.config === 'LM_ASC' || v.config === 'LM' ? (v.config === 'LM' ? 'LM' : 'LM_ASC') : 'CSM');
      portOff = mt.offset.clone().add(new Vector3(v.config.startsWith('LM') ? GEOM.lm.dockRingX : GEOM.csm.probeTipX, 0, 0).applyQuaternion(mt.quat));
    } catch {
      portOff = new Vector3(5, 0, 0);
    }
    const portA = st.r.clone().add(portOff.applyQuaternion(st.q));
    let tOff;
    try {
      const module = tgt.config === 'SIVB_LM' ? 'LM_STOWED' : tgt.config === 'CSM' ? 'CSM' : tgt.config === 'LM_ASC' ? 'LM_ASC' : 'LM';
      const mt = moduleTransform(tgt.config === 'LM_DESCENT' ? 'LM' : tgt.config, module);
      tOff = mt.offset.clone().add(new Vector3(module === 'CSM' ? GEOM.csm.probeTipX : GEOM.lm.dockRingX, 0, 0).applyQuaternion(mt.quat));
    } catch {
      tOff = new Vector3(5, 0, 0);
    }
    const portB = tgt.r.clone().add(tOff.applyQuaternion(tgt.q));
    const axisB = new Vector3(1, 0, 0).applyQuaternion(tgt.q);
    const rel = portB.clone().sub(portA);
    const relV = tgt.v.clone().sub(st.v);
    const range = rel.length();
    const rangeRate = range > 1e-6 ? rel.dot(relV) / range : 0;
    // lateral offsets in the active body frame
    const inv = st.q.clone().invert();
    const relBody = rel.clone().applyQuaternion(inv);
    const relVBody = relV.clone().applyQuaternion(inv);
    const myAxis = new Vector3(1, 0, 0).applyQuaternion(st.q);
    const misalign = Math.acos(Math.max(-1, Math.min(1, -myAxis.dot(axisB)))) / DEG;
    // attitude that points our +X against the target axis (nose to nose)
    const alignQ = GNCQuat(axisB.clone().negate(), new Vector3(0, 0, 1).applyQuaternion(tgt.q), true);
    return { target: tgt, range, rangeRate, lateral: { y: relBody.y, z: relBody.z }, latRate: { y: relVBody.y, z: relVBody.z }, axial: relBody.x, misalign, alignQ };
  }

  _findDockTarget() {
    for (const b of this.bodies.values()) if (!b.debris && ['SIVB_LM', 'CSM', 'LM_ASC', 'LM'].includes(b.config) && b.r.distanceTo(this.vehicle.state.r) < 3000) return b;
    return null;
  }

  _docking() {
    const v = this.vehicle;
    if (!['CSM', 'LM_ASC'].includes(v.config) || this._captured) return;
    const tel = this.dockingTelemetry();
    if (!tel) return;
    this._dockTarget = tel.target;
    const lat = Math.hypot(tel.lateral.y, tel.lateral.z);
    if (tel.range < 0.35 && lat < 0.3 && tel.misalign < 10) {
      const closing = -tel.rangeRate;
      if (closing > 0.6) {
        this.bus.emit('vehicle:event', { kind: 'DOCK_BOUNCE', get: this.clock.get, closing });
        // bounce back
        v.state.v.addScaledVector(new Vector3(1, 0, 0).applyQuaternion(v.state.q), -closing * 1.5);
        return;
      }
      this._captured = true;
      // match velocities and lock attitude
      v.state.v.copy(tel.target.v);
      v.state.q.copy(tel.alignQ);
      this.bus.emit('vehicle:event', { kind: 'DOCK_CAPTURE', get: this.clock.get, closing, lateral: lat, misalign: tel.misalign, targetId: tel.target.id });
    }
  }

  _derive() {
    const st = this.vehicle.state;
    const dMoon = _tmp.subVectors(st.r, this.moonPos).length();
    st.primary = dMoon < 6.61e7 ? 'MOON' : 'EARTH';
    let mu;
    if (st.primary === 'MOON') {
      st.rRel.subVectors(st.r, this.moonPos);
      st.vRel.subVectors(st.v, this.moonVel);
      st.alt = st.rRel.length() - R_MOON;
      mu = MU_MOON;
      if (st.alt > 2000) st.altTerrain = st.alt;
    } else {
      st.rRel.copy(st.r);
      st.vRel.copy(st.v);
      st.alt = st.r.length() - R_EARTH;
      st.altTerrain = st.alt;
      mu = MU_EARTH;
    }
    st.speed = st.vRel.length();
    const up = _tmp.copy(st.rRel).normalize();
    st.hdot = st.vRel.dot(up);
    // velocity relative to the rotating surface (the Moon turns once per 27.3 days: 4.6 m/s at the equator)
    if (st.primary === 'MOON') st.vSurface.copy(st.vRel).sub(_tmp2.set(-MOON_OMEGA * st.rRel.y, MOON_OMEGA * st.rRel.x, 0));
    else st.vSurface.copy(st.vRel).sub(_tmp2.set(-7.2921159e-5 * st.rRel.y, 7.2921159e-5 * st.rRel.x, 0));
    const vs = st.primary === 'MOON' ? st.vSurface : st.vRel;
    st.vHoriz = Math.sqrt(Math.max(0, vs.lengthSq() - st.hdot * st.hdot));
    // two-body orbit about the primary
    const r = st.rRel.length();
    const energy = (st.speed * st.speed) / 2 - mu / r;
    const hvec = _tmp2.crossVectors(st.rRel, st.vRel);
    const R0 = st.primary === 'MOON' ? R_MOON : R_EARTH;
    if (energy < 0) {
      const a = -mu / (2 * energy);
      const e = Math.sqrt(Math.max(0, 1 - hvec.lengthSq() / (mu * a)));
      st.apoAlt = a * (1 + e) - R0;
      st.periAlt = a * (1 - e) - R0;
    } else {
      st.apoAlt = NaN;
      st.periAlt = hvec.lengthSq() / mu / 2 - R0;
    }
    st.inclination = Math.acos(Math.max(-1, Math.min(1, hvec.z / hvec.length()))) / DEG;
    // line of sight to Earth (behind the Moon → no comms)
    st.losEarth = false;
    if (st.primary === 'MOON') {
      const toEarth = st.r.clone().negate().normalize();
      const toMoon = this.moonPos.clone().sub(st.r);
      const proj = toMoon.dot(toEarth);
      if (proj > 0) st.losEarth = Math.sqrt(Math.max(0, toMoon.lengthSq() - proj * proj)) < R_MOON;
    }
    // Earth's shadow
    const sd = this.sunDir;
    const along = st.r.dot(sd);
    st.inShadow = along < 0 && Math.sqrt(Math.max(0, st.r.lengthSq() - along * along)) < R_EARTH;
    if (st.landed) st.altTerrain = 0;
  }

  predict(durationS = 3600, stepS = 60) {
    const pts = [];
    const r = this.vehicle.state.r.clone();
    const v = this.vehicle.state.v.clone();
    const a = new Vector3();
    for (let t = 0; t <= durationS; t += stepS) {
      pts.push({ t: this.clock.get + t, r: r.clone() });
      this._gravity(r, a.set(0, 0, 0));
      v.addScaledVector(a, stepS);
      r.addScaledVector(v, stepS);
    }
    return pts;
  }

  dispose() {
    this._off.forEach((f) => f());
  }
}


/** Attitude with +X along `x` and body +Z toward `zRef` (or along −zRef when flip). */
function GNCQuat(x, zRef, flip = false) {
  const bx = x.clone().normalize();
  const bz = zRef.clone().addScaledVector(bx, -zRef.dot(bx));
  if (bz.lengthSq() < 1e-8) bz.set(0, 1, 0).addScaledVector(bx, -bx.y);
  bz.normalize();
  if (flip) bz.negate();
  const by = new Vector3().crossVectors(bz, bx);
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(bx, by, bz));
}
