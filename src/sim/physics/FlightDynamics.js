// Flight dynamics: translational + rotational integration of the player vehicle and passive bodies
// (targets, jettisoned stages, debris), Earth/Moon gravity, atmosphere, surface contact, config
// transitions (staging/separation/docking). STUB by the architect with the final interface
// (docs/ARCHITECTURE.md §5). The "physics" agent replaces internals and keeps the interface.

import { Quaternion, Vector3 } from 'three';
import { DEG, MU_EARTH, MU_MOON, R_EARTH, R_MOON, SITES_DEG } from '../../core/constants.js';
import { earthFixedToEci, moonPosition, moonVelocity, sunDirection } from './ephemeris.js';
import { getInitialState } from './initialStates.js';

const _acc = { force: new Vector3(), torque: new Vector3(), mdot: 0 };
const _tmp = new Vector3();
const _tmp2 = new Vector3();
const _q = new Quaternion();

export class FlightDynamics {
  constructor({ vehicle, bus, clock, missionId }) {
    this.vehicle = vehicle;
    this.bus = bus;
    this.clock = clock;
    this.missionId = missionId;
    this.mode = 'SPACE'; // 'PAD' | 'ASCENT' | 'SPACE' | 'LANDED' | 'ENTRY' | 'SPLASHED'
    this.bodies = new Map(); // passive bodies: { id, config, r, v, q, w, mass, debris?, ttl? }
    this.moonPos = new Vector3();
    this.moonVel = new Vector3();
    this.sunDir = new Vector3(1, 0, 0);
    this.terrainHeight = null; // (latRad, lonRad) → metres above R_MOON (set by render/lunarTerrain)
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
    this.mode = setup.mode ?? s.mode ?? 'SPACE';
    this._updateEphemeris();
    this._derive();
  }

  setMode(mode) {
    if (this.mode === mode) return;
    const prev = this.mode;
    this.mode = mode;
    this.bus.emit('dynamics:mode', { mode, prev });
  }

  /** Recommended max substep (s) for the current situation. */
  maxStep() {
    if (this.mode === 'PAD' || this.mode === 'ASCENT' || this.mode === 'ENTRY') return 0.05;
    const v = this.vehicle;
    if (v.cmd.sps || v.cmd.dps || v.cmd.aps) return 0.05;
    if (v.state.primary === 'MOON' && v.state.alt < 50000) return 0.1;
    return v.state.alt > 5e6 ? 10 : 1;
  }

  /** Max time warp allowed by the flight situation. */
  maxWarp() {
    if (this.mode === 'ASCENT' || this.mode === 'ENTRY') return 10;
    const v = this.vehicle;
    if (v.cmd.sps || v.cmd.dps || v.cmd.aps) return 10;
    return 10000;
  }

  addBody(body) {
    this.bodies.set(body.id, { w: new Vector3(), q: new Quaternion(), mass: 1000, ...body });
    this.bus.emit('dynamics:bodyAdded', { id: body.id });
  }

  removeBody(id) {
    if (this.bodies.delete(id)) this.bus.emit('dynamics:bodyRemoved', { id });
  }

  getBody(id) {
    return this.bodies.get(id) ?? null;
  }

  handleRequest({ kind }) {
    const v = this.vehicle;
    switch (kind) {
      case 'LIFTOFF':
        v.state.liftoff = true;
        this.setMode('ASCENT');
        break;
      case 'LES_JETT':
        if (v.parts.les) {
          v.parts.les = false;
          v.parts.bpc = false;
        }
        break;
      case 'SIC_SEP':
        v._setConfig('SATURN_V_SII', { event: kind });
        break;
      case 'SII_INTERSTAGE_JETT':
        v.parts.interstage = false;
        break;
      case 'SII_SEP':
        v._setConfig('SIVB_STACK', { event: kind });
        break;
      case 'ORBIT_INSERTION':
        this.setMode('SPACE');
        break;
      case 'CSM_SEP':
        if (v.config === 'SIVB_STACK') v._setConfig('CSM', { event: kind });
        break;
      case 'CM_SM_SEP':
        if (v.config === 'CSM') v._setConfig('CM', { event: kind });
        break;
      default:
        break;
    }
    this.bus.emit('vehicle:event', { kind, get: this.clock.get });
  }

  _updateEphemeris() {
    const utc = this.clock.utcMs;
    moonPosition(utc, this.moonPos);
    moonVelocity(utc, this.moonVel);
    sunDirection(utc, this.sunDir);
  }

  _gravity(r, out) {
    const r3 = Math.pow(r.lengthSq(), 1.5);
    out.copy(r).multiplyScalar(-MU_EARTH / r3);
    _tmp2.subVectors(r, this.moonPos);
    const d3 = Math.pow(_tmp2.lengthSq(), 1.5);
    out.addScaledVector(_tmp2, -MU_MOON / d3);
    const m3 = Math.pow(this.moonPos.lengthSq(), 1.5);
    out.addScaledVector(this.moonPos, -MU_MOON / m3); // indirect term (Earth-centred frame)
    return out;
  }

  _massProps() {
    const m = this.vehicle.modules;
    let mass = 0;
    const inertia = new Vector3();
    for (const mod of [m.saturn, m.csm, m.lm]) {
      if (!mod) continue;
      const p = mod.massProps();
      mass += p.mass;
      inertia.add(p.inertia);
    }
    return { mass: Math.max(mass, 1), inertia };
  }

  step(h) {
    this._updateEphemeris();
    const v = this.vehicle;
    const st = v.state;
    const mods = v.modules;
    _acc.force.set(0, 0, 0);
    _acc.torque.set(0, 0, 0);
    _acc.mdot = 0;
    for (const mod of [mods.saturn, mods.csm, mods.lm]) mod?.propulsion(_acc, h);
    const { mass, inertia } = this._massProps();
    st.mass = mass;

    if (this.mode === 'PAD') {
      const s = SITES_DEG.LC39A;
      earthFixedToEci(s.lat * DEG, s.lon * DEG, 33, this.clock.utcMs, st.r, st.v);
      st.q.setFromUnitVectors(_tmp.set(1, 0, 0), _tmp2.copy(st.r).normalize());
      st.w.set(0, 0, 0);
    } else if (this.mode === 'LANDED') {
      st.v.copy(this.moonVel);
      st.w.set(0, 0, 0);
    } else {
      // rotation
      st.w.x += (_acc.torque.x / inertia.x) * h;
      st.w.y += (_acc.torque.y / inertia.y) * h;
      st.w.z += (_acc.torque.z / inertia.z) * h;
      const wl = st.w.length();
      if (wl > 1e-9) {
        _q.setFromAxisAngle(_tmp.copy(st.w).divideScalar(wl), wl * h);
        st.q.multiply(_q).normalize();
      }
      // translation (semi-implicit Euler; the physics agent replaces with RK4/adaptive)
      const thrustEci = _tmp.copy(_acc.force).applyQuaternion(st.q).divideScalar(mass);
      st.accel.copy(_acc.force).divideScalar(mass);
      const g = this._gravity(st.r, _tmp2.set(0, 0, 0));
      st.v.addScaledVector(g, h).addScaledVector(thrustEci, h);
      st.r.addScaledVector(st.v, h);
    }
    for (const b of this.bodies.values()) {
      const g = this._gravity(b.r, _tmp2.set(0, 0, 0));
      b.v.addScaledVector(g, h);
      b.r.addScaledVector(b.v, h);
      if (b.ttl !== undefined && (b.ttl -= h) <= 0) this.removeBody(b.id);
    }
    this._derive();
  }

  _derive() {
    const st = this.vehicle.state;
    const dMoon = _tmp.subVectors(st.r, this.moonPos).length();
    st.primary = dMoon < 6.61e7 ? 'MOON' : 'EARTH';
    if (st.primary === 'MOON') {
      st.rRel.subVectors(st.r, this.moonPos);
      st.vRel.subVectors(st.v, this.moonVel);
      st.alt = st.rRel.length() - R_MOON;
    } else {
      st.rRel.copy(st.r);
      st.vRel.copy(st.v);
      st.alt = st.r.length() - R_EARTH;
    }
    st.speed = st.vRel.length();
    const up = _tmp.copy(st.rRel).normalize();
    st.hdot = st.vRel.dot(up);
    st.vHoriz = Math.sqrt(Math.max(0, st.speed * st.speed - st.hdot * st.hdot));
    st.losEarth = false;
    if (st.primary === 'MOON') {
      // Earth hidden behind the Moon?
      const toEarth = _tmp2.copy(st.r).negate();
      const toMoon = _tmp.subVectors(this.moonPos, st.r);
      const proj = toMoon.dot(toEarth.normalize());
      if (proj > 0) {
        const perp = Math.sqrt(Math.max(0, toMoon.lengthSq() - proj * proj));
        st.losEarth = perp < R_MOON;
      }
    }
  }

  /** Predicted trajectory points (ECI) for the map: [{ t, r }]. */
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
