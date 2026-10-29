// Flight dynamics: translation (Earth + Moon gravity, thrust, drag/lift), rate-based attitude
// control, surface contact on the Moon (terrain + boulders), atmospheric entry with parachutes,
// separations/docking (config changes + passive bodies) and derived state for displays.

import { Matrix4, Quaternion, Vector3 } from 'three';
import { DEG, MU_EARTH, MU_MOON, R_EARTH, R_MOON, SITES_DEG, FT } from '../../core/constants.js';
import { earthFixedToEci, moonPosition, moonVelocity, sunDirection } from './ephemeris.js';
import { getInitialState } from './initialStates.js';
import { heightLocal, boulderAt, siteFrame } from '../terrain/lunarTerrain.js';
import { CONFIGS, GEOM, moduleTransform } from '../geometry.js';

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
    if (v.cmd.sps || v.cmd.dps || v.cmd.aps) return 0.05;
    if (st.primary === 'MOON' && st.alt < 30000) return 0.05;
    if (st.primary === 'EARTH' && st.alt < 140000) return 0.1;
    if (this.bodies.size && this.nearestBodyDist() < 2000) return 0.05;
    return st.alt > 5e6 ? 8 : 1;
  }

  maxWarp() {
    const v = this.vehicle;
    const st = v.state;
    if (this.mode === 'ASCENT' || this.mode === 'ENTRY') return 10;
    if (v.cmd.sps || v.cmd.dps || v.cmd.aps) return 5;
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
    // keep the shared module at the same world place when the reference point moves
    try {
      const a = moduleTransform(fromConfig, module);
      const b = moduleTransform(toConfig, module);
      const d = a.offset.clone().sub(b.offset.clone().applyQuaternion(a.quat.clone().multiply(b.quat.clone().invert())));
      this.vehicle.state.r.add(d.applyQuaternion(this.vehicle.state.q));
    } catch {
      /* modules not shared */
    }
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
        this._spawn('LES', 'LES', new Vector3(STACK_LES, 0, 0), new Vector3(40, 3, 0), 30);
        break;
      case 'SIC_SEP':
        this._spawn('SIC', 'SIC', new Vector3(-12, 0, 0), new Vector3(-6, 0, 0), 60);
        this._shift(cfg, 'SATURN_V_SII', 'SII');
        v._setConfig('SATURN_V_SII', { event: kind });
        break;
      case 'SII_INTERSTAGE_JETT':
        v.parts.interstage = false;
        this._spawn('INTERSTAGE', 'INTERSTAGE', new Vector3(-18, 0, 0), new Vector3(-4, 0, 0), 30);
        break;
      case 'SII_SEP':
        this._spawn('SII', 'SII', new Vector3(-20, 0, 0), new Vector3(-5, 0, 0), 60);
        this._shift(cfg, 'SIVB_STACK', 'SIVB');
        v._setConfig('SIVB_STACK', { event: kind });
        break;
      case 'ORBIT_INSERTION':
        this.setMode('SPACE');
        break;
      case 'CSM_SEP':
        if (cfg !== 'SIVB_STACK') return;
        this._spawn('SIVB_LM', 'SIVB_LM', new Vector3(-14, 0, 0), new Vector3(-0.3, 0, 0), null, { label: 'S-IVB / LM' });
        this._shift(cfg, 'CSM', 'CSM');
        v.parts.slaPanels = false;
        v._setConfig('CSM', { event: kind });
        break;
      case 'DOCK_CAPTURE':
        break;
      case 'DOCK_HARD': {
        const target = req.targetId ? this.bodies.get(req.targetId) : this._dockTarget;
        if (!target || !this._captured) return;
        this.removeBody(target.id);
        this._captured = false;
        if (target.config === 'SIVB_LM') v._setConfig('CSM_LM_SIVB', { event: kind });
        else if (target.config === 'LM_ASC') v._setConfig('CSM_LMASC', { event: kind });
        else if (target.config === 'CSM') v._setConfig(v.station === 'LM' ? 'CSM_LMASC' : 'CSM_LM', { event: kind });
        break;
      }
      case 'LM_EXTRACT':
        if (cfg !== 'CSM_LM_SIVB') return;
        this._spawn('SIVB', 'SIVB', new Vector3(-18, 0, 0), new Vector3(-0.25, 0, 0), null, { label: 'S-IVB' });
        v._setConfig('CSM_LM', { event: kind });
        break;
      case 'UNDOCK': {
        if (cfg !== 'CSM_LM' && cfg !== 'CSM_LMASC') return;
        const lmIsPlayer = v.station === 'LM';
        if (lmIsPlayer) {
          this._spawn('CSM', 'CSM', new Vector3(-3, 0, 0), new Vector3(0, 0, 0), null, { label: 'Columbia' });
          v._setConfig(cfg === 'CSM_LMASC' ? 'LM_ASC' : 'LM', { event: kind });
        } else {
          this._spawn('LM', 'LM', new Vector3(8, 0, 0), new Vector3(0.3, 0, 0), null, { label: 'Eagle' });
          v._setConfig('CSM', { event: kind });
        }
        break;
      }
      case 'LM_STAGE':
      case 'LM_ASC_LIFTOFF':
        if (cfg === 'LM') {
          if (st.landed) this.addBody({ id: 'LM_DESCENT', config: 'LM_DESCENT', r: st.r.clone(), v: st.v.clone(), q: st.q.clone(), static: true });
          v.modules.lm && (v.modules.lm.staged = true);
          v._setConfig('LM_ASC', { event: kind });
        }
        break;
      case 'LM_JETT':
        if (cfg !== 'CSM_LM' && cfg !== 'CSM_LMASC') return;
        this._spawn('LM', cfg === 'CSM_LM' ? 'LM' : 'LM_ASC', new Vector3(10, 0, 0), new Vector3(0.6, 0, 0), null, { label: 'Aquarius' });
        v.setStation('CM');
        v._setConfig('CSM', { event: kind });
        break;
      case 'CM_SM_SEP':
        if (cfg !== 'CSM' && cfg !== 'CSM_LM') return;
        this._spawn('SM', 'SM', new Vector3(-2.5, 0, 0), new Vector3(-1.2, 0, 0.3), null, { label: 'Módulo de servicio', damaged: v.parts.smDamaged });
        if (v.modules.csm) v.modules.csm.hasSM = false;
        v._setConfig('CM', { event: kind });
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
    const dir = this.eciToMoonFixed(_tmp.copy(rRel).normalize());
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
      const s = SITES_DEG.LC39A;
      earthFixedToEci(s.lat * DEG, s.lon * DEG, 33, this.clock.utcMs, st.r, st.v);
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
        st.v.copy(this.moonVel).add(_tmp2.set(0, 0, 2.66e-6).cross(st.r.clone().sub(this.moonPos)));
        st.w.set(0, 0, 0);
        st.accel.set(0, 0, 0);
      }
    } else if (this.mode === 'SPLASHED') {
      st.v.set(-7.2921159e-5 * st.r.y, 7.2921159e-5 * st.r.x, 0);
      st.r.addScaledVector(st.v, h);
    } else {
      if (this.mode === 'ASCENT' && mods.saturn && v.isAttached('saturn')) this._ascentAttitude(h, 2);
      else this._rotate(h);
      this._translate(h, mass);
      this._contacts(h);
    }
    for (const b of this.bodies.values()) {
      if (b.static) continue;
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
      const ang = 2 * Math.acos(Math.min(1, Math.abs(st.q.dot(cmd.attitudeTarget))));
      const maxStep = (v.station === 'LM' ? 8 : 3) * DEG * h;
      if (ang > 1e-6) st.q.slerp(cmd.attitudeTarget, Math.min(1, maxStep / ang));
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
    const g = this._gravity(st.r, _tmp2.set(0, 0, 0));
    st.v.addScaledVector(g, h).addScaledVector(thrustEci, h);
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
    st.r.addScaledVector(st.v, h);
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
    const rRel = _tmp.subVectors(st.r, this.moonPos);
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
      const vRel = st.v.clone().sub(this.moonVel);
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
    st.vHoriz = Math.sqrt(Math.max(0, st.speed * st.speed - st.hdot * st.hdot));
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

const STACK_LES = 13;

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
