// Launch vehicles: Saturn V (S-IC, S-II, S-IVB) and Saturn IB (S-IB, S-IVB-200), with the
// Instrument Unit guidance and the S-IVB restart for Translunar Injection (TB6 → TLI cutoff).
// Masses are the launch vehicle only (the CSM/LM add their own). Saturn V numbers follow the
// Apollo 11 (SA-506) flight evaluation report closely enough to reproduce the real timeline:
// CECO 2:15, staging 2:42, S-II CECO 7:40 (Apollo 13: 5:30 pogo shutdown), S-IVB cutoff ≈ 11:40.
// Saturn IB (SA-205-like): IECO 2:20, OECO 2:24, S-IVB cutoff ≈ 10:00 into a ~125 × 150 nmi orbit.
// Steering is kinematic: the IU computes a thrust direction (steerDir, ECI) that physics applies.

import { Vector3 } from 'three';
import { DEG, MU_EARTH, R_EARTH, SITES_DEG } from '../../core/constants.js';

const SIC = { dry: 131000, prop: 2077000, thrustSL: 6.77e6, thrustVac: 7.74e6, engines: 5 }; // per engine
const SII = { dry: 36000 + 4500, prop: 444000, thrust: 1.023e6, isp: 421, engines: 5 };
const SIVB = { dry: 13500 + 2000 + 1800, prop: 109000, thrust: 1.0e6, isp: 421 };
// Saturn IB
const SIB = { dry: 41600 + 3500, prop: 410000, thrustSL: 0.889e6, thrustVac: 1.0e6, engines: 8 };
const SIVB2 = { dry: 11600 + 2000 + 1800, prop: 104000, thrust: 1.0e6, isp: 421 };

export const TB6_TO_IGNITION = 578; // s: TB6 start → J-2 restart (O2/H2 burner, repressurisation, ullage)

const _up = new Vector3();
const _east = new Vector3();
const _north = new Vector3();
const _h = new Vector3();
const _v = new Vector3();

export class SaturnV {
  constructor({ vehicle, bus, clock, missionId = 'apollo11', setup = {} }) {
    this.vehicle = vehicle;
    this.bus = bus;
    this.clock = clock;
    this.missionId = missionId;
    const cfg = setup.config ?? vehicle.config;
    this.variant = cfg.startsWith('SATURN_IB') ? 'IB' : 'V';
    this.stage = this.variant === 'IB' ? 'SIB' : 'SIC'; // SIC | SIB | SII | SIVB | SIVB_COAST | SIVB_TLI | SIVB_SAFED
    this.sicProp = SIC.prop;
    this.sibProp = SIB.prop;
    this.siiProp = SII.prop;
    this.sivbProp = this.variant === 'IB' ? SIVB2.prop : SIVB.prop;
    this.enginesOn = 0;
    this.ignited = false;
    this.thrust = 0;
    this.steerDir = new Vector3();
    this.headingDir = new Vector3(0, 0, 1);
    this.azimuth = (missionId === 'apollo13' ? 72.043 : 72.058) * DEG;
    this.siiCecoT = missionId === 'apollo13' ? 330.6 : 460.6;
    this.hTarget = this.variant === 'IB' ? 232000 : 185500;
    this.done = new Set();
    this.lat = SITES_DEG.LC39A.lat * DEG;
    this.tb6 = null; // GET at which TB6 (TLI restart sequence) started
    this.tliTargetC3 = null; // m²/s² target energy for TLI cutoff
    // starting in orbit (free flight / later chapters): S-IVB coasting with its first burn done
    if (cfg === 'SIVB_STACK' || cfg === 'SATURN_IB_SIVB' && setup.state && setup.state !== 'PAD_39B_IB') {
      this.stage = 'SIVB_COAST';
      this.ignited = true;
      this.sivbProp = this.variant === 'IB' ? 9000 : 76500; // ~70 t are needed for TLI
      for (const k of ['IGNITION_SEQUENCE', 'LIFTOFF', 'TOWER_CLEAR', 'SIC_CECO', 'SIC_OECO', 'SIC_SEP', 'SIB_SEP', 'SII_IGNITION', 'SII_INTERSTAGE_JETT', 'SII_CECO', 'SII_OECO', 'SII_SEP', 'SIVB_IGNITION', 'SIVB_CUTOFF', 'ORBIT_INSERTION']) this.done.add(k);
      vehicle.state.liftoff = true;
    }
    this._offs = [
      bus.on('switch:changed', ({ id, value }) => {
        // XLUNAR SAFE inhibits the restart (or stops the burn); INJECT re-enables it
        if (id === 'CM.LV.XLUNAR' && value === 'SAFE' && (this.stage === 'SIVB_TLI' || this.tb6 !== null)) this.inhibitTLI('crew');
      }),
    ];
  }

  _event(kind, extra = {}) {
    if (this.done.has(kind)) return;
    this.done.add(kind);
    this.vehicle.request(kind, { source: 'saturn', ...extra });
  }

  _frame(st) {
    _up.copy(st.r).normalize();
    _east.set(-_up.y, _up.x, 0).normalize();
    _north.crossVectors(_up, _east);
  }

  /** Ground uplink: start TB6 now (ignition 9 min 38 s later) with a cutoff energy target. */
  startTB6({ c3 = -1.6e6, tb6 = null } = {}) {
    if (this.stage !== 'SIVB_COAST' || this.sivbProp < 1000) return false;
    this.tb6 = tb6 ?? this.clock.get;
    this.tliTargetC3 = c3;
    this.done.delete('TLI_IGNITION');
    this.done.delete('TLI_CUTOFF');
    this.bus.emit('saturn:tb6', { get: this.tb6, ignition: this.tb6 + TB6_TO_IGNITION });
    return true;
  }

  inhibitTLI(source = 'crew') {
    if (this.stage === 'SIVB_TLI') {
      this.stage = 'SIVB_COAST';
      this._event('TLI_CUTOFF', { inhibited: true });
    }
    this.tb6 = null;
    this.bus.emit('saturn:tliInhibit', { source });
  }

  get tliIgnitionGET() {
    return this.tb6 === null ? null : this.tb6 + TB6_TO_IGNITION;
  }

  update(dt) {
    const t = this.clock.get;
    const v = this.vehicle;
    const st = v.state;
    const tm = v.tm;
    const IB = this.variant === 'IB';
    if (this.stage === 'SIC' || this.stage === 'SIB') {
      if (t >= -8.9 && !this.ignited) {
        this.ignited = true;
        this._event('IGNITION_SEQUENCE');
      }
      if (t >= 0) this._event('LIFTOFF');
      if (t > 6 && st.alt > (IB ? 245 : 205)) this._event('TOWER_CLEAR'); // engines above the 136 m tower
    }

    // ---- stage logic
    let thrust = 0;
    let mdot = 0;
    if (this.stage === 'SIC' && this.ignited) {
      const n = t < -2 ? Math.min(5, Math.max(0, (t + 8.9) / 1.2)) : t >= 135.2 ? 4 : 5;
      if (t >= 135.2) this._event('SIC_CECO');
      const p = Math.exp(-Math.max(0, st.alt) / 7200);
      const perEngine = SIC.thrustSL + (SIC.thrustVac - SIC.thrustSL) * (1 - p);
      thrust = n * perEngine;
      if (t < 0) thrust *= Math.min(1, (t + 8.9) / 7);
      mdot = (n * 2578) * (t < 0 ? 0.4 : 1);
      this.enginesOn = Math.round(n);
      if (this.sicProp <= 0 || t >= 161.6) {
        this._event('SIC_OECO');
        this._event('SIC_SEP');
        this.stage = 'SII';
        this.stageT = t;
      }
      this.sicProp = Math.max(0, this.sicProp - mdot * dt);
    } else if (this.stage === 'SIB' && this.ignited) {
      // 8 H-1s: inboard four cut at IECO 140.6 s, outboard four at OECO 144 s
      const n = t < -2 ? Math.min(8, Math.max(0, (t + 8.9) * 1.6)) : t >= 140.6 ? 4 : 8;
      if (t >= 140.6) this._event('SIC_CECO');
      const p = Math.exp(-Math.max(0, st.alt) / 7200);
      thrust = n * (SIB.thrustSL + (SIB.thrustVac - SIB.thrustSL) * (1 - p));
      if (t < 0) thrust *= Math.min(1, (t + 8.9) / 7);
      mdot = n * 350 * (t < 0 ? 0.4 : 1);
      this.enginesOn = Math.round(n);
      if (this.sibProp <= 0 || t >= 144.2) {
        this._event('SIC_OECO');
        this._event('SIB_SEP');
        this.stage = 'SIVB';
        this.stageT = t;
      }
      this.sibProp = Math.max(0, this.sibProp - mdot * dt);
    } else if (this.stage === 'SII') {
      const since = t - this.stageT;
      if (since > 1.7) this._event('SII_IGNITION');
      if (since > 30) this._event('SII_INTERSTAGE_JETT');
      const n = since < 1.7 ? 0 : t >= this.siiCecoT ? 4 : 5;
      if (t >= this.siiCecoT) this._event('SII_CECO');
      thrust = n * SII.thrust;
      mdot = thrust / (SII.isp * 9.80665);
      this.enginesOn = n;
      this.siiProp = Math.max(0, this.siiProp - mdot * dt);
      if (this.siiProp <= 0) {
        this._event('SII_OECO');
        this._event('SII_SEP');
        this.stage = 'SIVB';
        this.stageT = t;
      }
    } else if (this.stage === 'SIVB') {
      const since = t - this.stageT;
      if (since > 3) this._event('SIVB_IGNITION');
      thrust = since > 3 ? (IB ? SIVB2 : SIVB).thrust : 0;
      mdot = thrust / ((IB ? SIVB2 : SIVB).isp * 9.80665);
      this.enginesOn = thrust > 0 ? 1 : 0;
      this.sivbProp = Math.max(0, this.sivbProp - mdot * dt);
      const r = st.r.length();
      if ((st.alt > this.hTarget - 35000 && st.speed >= Math.sqrt(MU_EARTH / r) * 1.0005) || this.sivbProp <= 0) {
        this._event('SIVB_CUTOFF');
        this.stage = 'SIVB_COAST';
        this.cutT = t;
      }
    } else if (this.stage === 'SIVB_COAST') {
      if (!this.done.has('ORBIT_INSERTION') && t - this.cutT > 10) this._event('ORBIT_INSERTION');
      // TB6: restart preparations, then J-2 ignition for TLI
      if (this.tb6 !== null && t >= this.tb6 + TB6_TO_IGNITION && v.sw.get('CM.LV.XLUNAR') !== 'SAFE' && v.isAttached('saturn')) {
        this.stage = 'SIVB_TLI';
        this.stageT = t;
        this._event('TLI_IGNITION');
      }
    } else if (this.stage === 'SIVB_TLI') {
      const since = t - this.stageT;
      thrust = (IB ? SIVB2 : SIVB).thrust * Math.min(1, since / 2.5);
      // velocity cutoff: trim the last step so the energy target is met exactly (IU cutoff logic)
      const c3 = st.speed * st.speed - (2 * MU_EARTH) / st.r.length();
      const target = this.tliTargetC3 ?? -1.6e6;
      const gain = 2 * st.speed * (thrust / Math.max(1, st.mass)) * dt;
      let cut = false;
      if (c3 + gain >= target) {
        thrust *= Math.max(0, Math.min(1, (target - c3) / Math.max(1e-6, gain)));
        cut = true;
      }
      mdot = thrust / (SIVB.isp * 9.80665);
      this.enginesOn = 1;
      this.sivbProp = Math.max(0, this.sivbProp - mdot * dt);
      if (cut || this.sivbProp <= 0) {
        this.stage = 'SIVB_COAST';
        this.tb6 = null;
        this._event('TLI_CUTOFF', { c3: target });
        this.bus.emit('saturn:tliCutoff', { c3: target, residualKg: this.sivbProp });
      }
    }
    this.thrust = thrust;
    this.mdot = mdot;

    // ---- IU guidance
    if (st.liftoff && this.stage !== 'SIVB_COAST') this._steer(t, st);
    else if (!st.liftoff) {
      this._frame(st);
      this.steerDir.copy(_up);
      this.headingDir.copy(_north).multiplyScalar(Math.cos(this.azimuth)).addScaledVector(_east, Math.sin(this.azimuth));
    } else {
      // coasting in orbit: IU holds local horizontal (prograde) — the vehicle "orbital rate" attitude
      _v.copy(st.vRel).normalize();
      this.steerDir.copy(_v);
    }

    // ---- telemetry for crew panel / BOOSTER console
    const stageEngines = this.stage === 'SIC' ? 5 : this.stage === 'SIB' ? 8 : this.stage === 'SII' ? 5 : 1;
    for (let i = 1; i <= 8; i++) {
      // engine lights are ON when the engine is NOT running (thrust OK lights out)
      let off;
      if (this.stage === 'SIVB' || this.stage === 'SIVB_COAST' || this.stage === 'SIVB_TLI') off = i === 1 ? this.enginesOn === 0 : false;
      else if (this.stage === 'SII' && t >= this.siiCecoT) off = i === 5;
      else if (this.stage === 'SIC' && t >= 135.2) off = i === 5;
      else if (this.stage === 'SIB' && t >= 140.6) off = i <= 4;
      else off = !this.ignited || this.enginesOn < stageEngines;
      tm[`CM.LV.ENG${i}`] = !!off && this.stage !== 'SIVB_COAST';
    }
    tm['CM.LV.LIFTOFF'] = !!st.liftoff && t < 30;
    tm['CM.LV.SII_SEP'] = this.stage === 'SII' && t - this.stageT < 30;
    tm['SAT.STAGE'] = this.stage;
    tm['SAT.VARIANT'] = this.variant;
    tm['SAT.THRUST_N'] = thrust;
    tm['SAT.ENGINES_ON'] = this.enginesOn;
    tm['SAT.PROP_KG'] = this.stage === 'SIC' ? this.sicProp : this.stage === 'SIB' ? this.sibProp : this.stage === 'SII' ? this.siiProp : this.sivbProp;
    tm['SAT.TB6'] = this.tb6 ?? NaN;
  }

  _steer(t, st) {
    this._frame(st);
    if (this.stage === 'SIVB_TLI') {
      // TLI: prograde with a slight pitch-down that keeps the burn near the local horizontal
      _v.copy(st.vRel).normalize();
      this.steerDir.copy(_v).addScaledVector(_up, -0.05).normalize();
      return;
    }
    // launch heading (azimuth from north)
    _h.copy(_north).multiplyScalar(Math.cos(this.azimuth)).addScaledVector(_east, Math.sin(this.azimuth));
    this.headingDir.copy(_h);
    if (t < 12 || this.stage === 'SIC' || this.stage === 'SIB') {
      // tower clear → roll/pitch program: pitch from vertical
      const IB = this.stage === 'SIB';
      const s = Math.max(0, Math.min(1, (t - 12) / (IB ? 132 : 150)));
      const pitch = (t < 12 ? 0 : (IB ? 62 : 67) * Math.pow(s, 0.85)) * DEG;
      this.steerDir.copy(_up).multiplyScalar(Math.cos(pitch)).addScaledVector(_h, Math.sin(pitch));
      return;
    }
    // Upper stages: hold the trajectory plane and steer vertical acceleration to reach the target altitude.
    _v.copy(st.vRel).addScaledVector(_up, -st.hdot);
    if (_v.lengthSq() > 1) _h.copy(_v).normalize();
    const r = st.r.length();
    const mass = Math.max(st.mass, 1);
    const aT = this.thrust / mass;
    if (aT < 0.1) {
      this.steerDir.copy(_h);
      return;
    }
    const g = MU_EARTH / (r * r);
    const centrifugal = (st.vHoriz * st.vHoriz) / r;
    const aV = g - centrifugal + 0.0008 * (this.hTarget - st.alt) - 0.06 * st.hdot;
    const sinP = Math.max(-0.35, Math.min(0.85, aV / aT));
    this.steerDir.copy(_h).multiplyScalar(Math.sqrt(1 - sinP * sinP)).addScaledVector(_up, sinP).normalize();
  }

  /** Launch-vehicle mass only. */
  massProps() {
    let mass = 0;
    if (this.variant === 'IB') {
      if (this.stage === 'SIB') mass = SIB.dry + this.sibProp + SIVB2.dry + SIVB2.prop + (this.done.has('LES_JETT') ? 0 : 4000);
      else mass = SIVB2.dry + this.sivbProp + (this.done.has('LES_JETT') || this.vehicle.parts.les === false ? 0 : 4000);
    } else if (this.stage === 'SIC') mass = SIC.dry + this.sicProp + SII.dry + SII.prop + SIVB.dry + SIVB.prop + 4000;
    else if (this.stage === 'SII') mass = SII.dry - (this.done.has('SII_INTERSTAGE_JETT') ? 4500 : 0) + this.siiProp + SIVB.dry + SIVB.prop + (this.done.has('LES_JETT') ? 0 : 4000);
    else mass = SIVB.dry + this.sivbProp;
    return { mass, inertia: new Vector3(2e7, 6e9, 6e9) };
  }

  propulsion(acc) {
    acc.force.x += this.thrust;
  }

  dispose() {
    this._offs?.forEach((f) => f());
  }
}

export { R_EARTH };
