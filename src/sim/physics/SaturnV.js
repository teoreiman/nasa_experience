// Saturn V launch vehicle: S-IC, S-II, S-IVB stage propulsion and Instrument Unit guidance.
// Masses are the launch vehicle only (the CSM/LM add their own). Numbers follow the Apollo 11
// (SA-506) flight evaluation report closely enough to reproduce the real timeline:
// CECO 2:15, staging 2:42, S-II CECO 7:40 (Apollo 13: 5:30 pogo shutdown), S-IVB cutoff ≈ 11:40.
// Steering is kinematic: the IU computes a thrust direction (steerDir, ECI) that physics applies.

import { Vector3 } from 'three';
import { DEG, MU_EARTH, R_EARTH, SITES_DEG } from '../../core/constants.js';

const SIC = { dry: 131000, prop: 2077000, thrustSL: 6.77e6, thrustVac: 7.74e6, engines: 5 }; // per-engine thrust ×5 below
const SII = { dry: 36000 + 4500, prop: 444000, thrust: 1.023e6, isp: 421, engines: 5 };
const SIVB = { dry: 13500 + 2000 + 1800, prop: 105500, thrust: 1.0e6, isp: 421 };

const _up = new Vector3();
const _east = new Vector3();
const _north = new Vector3();
const _h = new Vector3();
const _v = new Vector3();

export class SaturnV {
  constructor({ vehicle, bus, clock, missionId = 'apollo11' }) {
    this.vehicle = vehicle;
    this.bus = bus;
    this.clock = clock;
    this.missionId = missionId;
    this.stage = 'SIC'; // SIC | SII | SIVB | SIVB_COAST
    this.sicProp = SIC.prop;
    this.siiProp = SII.prop;
    this.sivbProp = SIVB.prop;
    this.enginesOn = 0;
    this.ignited = false;
    this.thrust = 0;
    this.steerDir = new Vector3();
    this.headingDir = new Vector3(0, 0, 1);
    this.azimuth = (missionId === 'apollo13' ? 72.043 : 72.058) * DEG;
    this.siiCecoT = missionId === 'apollo13' ? 330.6 : 460.6;
    this.done = new Set();
    this.lat = SITES_DEG.LC39A.lat * DEG;
  }

  _event(kind) {
    if (this.done.has(kind)) return;
    this.done.add(kind);
    this.vehicle.request(kind, { source: 'saturn' });
  }

  _frame(st) {
    _up.copy(st.r).normalize();
    _east.set(-_up.y, _up.x, 0).normalize();
    _north.crossVectors(_up, _east);
  }

  update(dt) {
    const t = this.clock.get;
    const v = this.vehicle;
    const st = v.state;
    const tm = v.tm;
    if (t >= -8.9 && !this.ignited) {
      this.ignited = true;
      this._event('IGNITION_SEQUENCE');
    }
    if (t >= 0) this._event('LIFTOFF');
    if (t > 10 && st.alt > 150) this._event('TOWER_CLEAR');

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
    } else if (this.stage === 'SII') {
      const since = t - this.stageT;
      if (since > 1.7) this._event('SII_IGNITION');
      if (since > 30) this._event('SII_INTERSTAGE_JETT');
      const n = since < 1.7 ? 0 : t >= this.siiCecoT ? 4 : 5;
      if (t >= this.siiCecoT) this._event('SII_CECO');
      thrust = n * SII.thrust;
      mdot = (thrust / (SII.isp * 9.80665));
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
      thrust = since > 3 ? SIVB.thrust : 0;
      mdot = thrust / (SIVB.isp * 9.80665);
      this.enginesOn = thrust > 0 ? 1 : 0;
      this.sivbProp = Math.max(0, this.sivbProp - mdot * dt);
      const r = st.r.length();
      if (st.alt > 150000 && st.speed >= Math.sqrt(MU_EARTH / r) * 1.0005) {
        this._event('SIVB_CUTOFF');
        this.stage = 'SIVB_COAST';
        this.cutT = t;
      }
    } else if (this.stage === 'SIVB_COAST') {
      if (t - this.cutT > 10) this._event('ORBIT_INSERTION');
    }
    this.thrust = thrust;
    this.mdot = mdot;

    // ---- IU guidance
    if (st.liftoff && this.stage !== 'SIVB_COAST') this._steer(t, st);
    else if (!st.liftoff) {
      this._frame(st);
      this.steerDir.copy(_up);
      this.headingDir.copy(_north).multiplyScalar(Math.cos(this.azimuth)).addScaledVector(_east, Math.sin(this.azimuth));
    }

    // ---- telemetry for crew panel / BOOSTER console
    const stageEngines = this.stage === 'SIC' ? 5 : this.stage === 'SII' ? 5 : 1;
    for (let i = 1; i <= 5; i++) {
      // engine lights are ON when the engine is NOT running (thrust OK lights out)
      let off;
      if (this.stage === 'SIVB' || this.stage === 'SIVB_COAST') off = i === 1 ? this.enginesOn === 0 : false;
      else if (this.stage === 'SII' && t >= this.siiCecoT) off = i === 5;
      else if (this.stage === 'SIC' && t >= 135.2) off = i === 5;
      else off = !this.ignited || this.enginesOn < stageEngines;
      tm[`CM.LV.ENG${i}`] = !!off && this.stage !== 'SIVB_COAST';
    }
    tm['CM.LV.LIFTOFF'] = !!st.liftoff && t < 30;
    tm['CM.LV.SII_SEP'] = this.stage === 'SII' && t - this.stageT < 30;
    tm['SAT.STAGE'] = this.stage;
    tm['SAT.THRUST_N'] = thrust;
    tm['SAT.ENGINES_ON'] = this.enginesOn;
    tm['SAT.PROP_KG'] = this.stage === 'SIC' ? this.sicProp : this.stage === 'SII' ? this.siiProp : this.sivbProp;
  }

  _steer(t, st) {
    this._frame(st);
    // launch heading (azimuth from north)
    _h.copy(_north).multiplyScalar(Math.cos(this.azimuth)).addScaledVector(_east, Math.sin(this.azimuth));
    this.headingDir.copy(_h);
    if (t < 12 || this.stage === 'SIC') {
      // tower clear → roll/pitch program: pitch from vertical
      const s = Math.max(0, Math.min(1, (t - 12) / 150));
      const pitch = (t < 12 ? 0 : 67 * Math.pow(s, 0.85)) * DEG;
      this.steerDir.copy(_up).multiplyScalar(Math.cos(pitch)).addScaledVector(_h, Math.sin(pitch));
      return;
    }
    // Upper stages: hold the trajectory plane and steer vertical acceleration to reach 100 nmi.
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
    const hTarget = 185500;
    const aV = g - centrifugal + 0.0008 * (hTarget - st.alt) - 0.06 * st.hdot;
    const sinP = Math.max(-0.35, Math.min(0.85, aV / aT));
    this.steerDir.copy(_h).multiplyScalar(Math.sqrt(1 - sinP * sinP)).addScaledVector(_up, sinP).normalize();
  }

  /** Launch-vehicle mass only. */
  massProps() {
    let mass = 0;
    if (this.stage === 'SIC') mass = SIC.dry + this.sicProp + SII.dry + SII.prop + SIVB.dry + SIVB.prop + 4000;
    else if (this.stage === 'SII') mass = SII.dry - (this.done.has('SII_INTERSTAGE_JETT') ? 4500 : 0) + this.siiProp + SIVB.dry + SIVB.prop + (this.done.has('LES_JETT') ? 0 : 4000);
    else mass = SIVB.dry + this.sivbProp;
    return { mass, inertia: new Vector3(2e7, 6e9, 6e9) };
  }

  propulsion(acc) {
    acc.force.x += this.thrust;
  }

  dispose() {}
}
