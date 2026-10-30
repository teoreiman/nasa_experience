// LM hardware simulation: EPS (descent batteries 1–4, ascent 5–6, CDR/LMP buses), ECS (CO2 with
// LiOH canisters + Apollo 13 "mailbox" adapter, water, cabin temperature), DPS (throttleable,
// DES QTY low-level light), APS, RCS, engine arming (incl. Apollo 11's broken ENG ARM breaker),
// ABORT / ABORT STAGE, caution & warning. Stable for dt up to 10 s.

import { Vector3 } from 'three';
import { LM_SWITCHES } from './registry.js';

export const LM_PRESETS = ['STOWED', 'ACTIVATED', 'PRE_PDI', 'LANDED', 'PRE_ASCENT', 'LIFEBOAT', 'POWERED_DOWN'];

const DPS_MAX = 45040; // N at 100 % (FTP 92.5 % ≈ 9,870 lbf)
const APS_THRUST = 15570;

export class LMSystems {
  constructor({ vehicle, bus, clock }) {
    this.vehicle = vehicle;
    this.bus = bus;
    this.clock = clock;
    this.staged = false;
    vehicle.sw.defineAll(LM_SWITCHES);
    this.dpsProp = 8200;
    this.dpsProp0 = 8200;
    this.apsProp = 2353;
    this.rcsKg = { A: 140, B: 140 };
    this.batAh = { 1: 415, 2: 415, 3: 415, 4: 415, 5: 296, 6: 296 };
    this.batOn = { 1: false, 2: false, 3: false, 4: false, 5: false, 6: false };
    this.co2 = 0.6;
    this.adapter = false;
    this.lioh = 1; // remaining capacity of the LM canister (fraction)
    this.waterKg = 151;
    this.cabinT = 68;
    this.amps = 0;
    this.lowLevel = false;
    this.abort = false;
    this.abortStage = false;
    this._off = [bus.on('switch:changed', (e) => this._onSwitch(e))];
    this.reset('STOWED');
  }

  reset(preset) {
    const name = typeof preset === 'object' ? preset.preset ?? 'STOWED' : preset;
    const sw = this.vehicle.sw;
    const on = name !== 'STOWED' && name !== 'POWERED_DOWN';
    for (const n of [1, 2, 3, 4]) this.batOn[n] = on;
    if (name === 'PRE_ASCENT' || name === 'LANDED') {
      this.dpsProp = 8200 * 0.05;
      this.vehicle.parts.lmGearDeployed = true;
    }
    if (name === 'PRE_PDI' || name === 'ACTIVATED') this.vehicle.parts.lmGearDeployed = true;
    if (name === 'PRE_PDI') {
      sw.set('LM.ENG.ENG_ARM', 'DES', 'restore');
      sw.set('LM.GNC.MODE_CONTROL_PGNS', 'AUTO', 'restore');
      sw.set('LM.RADAR.RR_MODE', 'SLEW', 'restore');
    }
    if (name === 'PRE_ASCENT') {
      for (const n of [5, 6]) this.batOn[n] = true;
      this.staged = false;
    }
    if (name === 'LIFEBOAT') {
      this.batAh = { 1: 360, 2: 360, 3: 360, 4: 360, 5: 296, 6: 296 };
      this.co2 = 1.2;
      this.cabinT = 55;
      this.lifeboat = true;
    }
    if (typeof preset === 'object') {
      if (preset.switches) sw.apply(preset.switches, 'script');
      if (preset.consumables) Object.assign(this, preset.consumables);
    }
    this.update(0);
  }

  _onSwitch({ id, value, source }) {
    const v = this.vehicle;
    const tm = v.tm;
    if (id.startsWith('LM.CW.MASTER_ALARM_') && value === 'PUSHED') {
      tm['LM.CW.MASTER_ALARM'] = false;
      tm['LM.CW.TONE'] = false;
    }
    const bat = id.match(/^LM\.EPS\.(DES|ASC)_BAT_(\d)_/);
    if (bat && value !== 'CENTER') this.batOn[+bat[2]] = value === 'ON';
    if (id === 'LM.EXP.LDG_GEAR_DEPLOY' && value === 'FIRE' && v.sw.is('LM.EXP.MASTER_ARM', 'ON')) {
      v.parts.lmGearDeployed = true;
      v.request('LM_GEAR_DEPLOY');
    }
    if (id === 'LM.ENG.ABORT') this.abort = value === 'PUSHED';
    // manual engine start/stop (descent or ascent per ENG ARM); STOP latches
    if (id === 'LM.ENG.START' && value === 'PUSHED') this.manualStart = true;
    if ((id === 'LM.ENG.STOP_CDR' || id === 'LM.ENG.STOP_LMP') && value === 'PUSHED') this.manualStart = false;
    if (id === 'LM.ENG.ABORT_STAGE' && value === 'PUSHED') {
      this.abortStage = true;
      if (!this.staged) v.request('LM_STAGE');
    }
    if (id === 'LM.EXP.STAGE' && value === 'FIRE' && v.sw.is('LM.EXP.MASTER_ARM', 'ON') && !this.staged) v.request('LM_STAGE');
  }

  /** Aldrin's felt-tip pen: push a broken breaker in. */
  fixBreakerWithPen(id = 'LM.CB.ENG_ARM') {
    const sw = this.vehicle.sw;
    sw.setBroken(id, false);
    sw.set(id, 'IN', 'system');
    this.bus.emit('lm:penFix', { id });
  }

  installCO2Adapter() {
    this.adapter = true;
    this.bus.emit('lm:co2Adapter', {});
  }

  caution(lamp) {
    const tm = this.vehicle.tm;
    if (!tm[`LM.CW.${lamp}`]) {
      tm[`LM.CW.${lamp}`] = true;
      tm['LM.CW.MASTER_ALARM'] = true;
      tm['LM.CW.TONE'] = true;
      this.bus.emit('cw:alarm', { vehicle: 'LM', lamp });
    }
  }

  trigger(name, opts = {}) {
    if (name === 'ENG_ARM_CB_BROKEN') {
      this.vehicle.sw.set('LM.CB.ENG_ARM', 'OUT', 'system');
      this.vehicle.sw.setBroken('LM.CB.ENG_ARM', true);
    }
    this.bus.emit('systems:failure', { module: 'LM', name, opts });
  }

  _loads() {
    const sw = this.vehicle.sw;
    let a = 0;
    if (!this.busV()) return 0;
    a += this.lifeboat ? 12 : 42;
    if (sw.is('LM.RADAR.LDG_ANT', 'AUTO') && !this.lifeboat) a += 3;
    if (!sw.is('LM.RADAR.RR_MODE', 'LGC')) a += this.lifeboat ? 0 : 4;
    if (!sw.is('LM.LTG.FLOOD', 'OFF')) a += 1.2;
    if (sw.is('LM.AGS.AEA_PWR', 'ON')) a += 3.5;
    if (this.vehicle.cmd.dps) a += 8;
    return a;
  }

  busV() {
    const n = Object.entries(this.batOn).filter(([k, on]) => on && this.batAh[k] > 1 && (+k > 4 ? true : !this.staged)).length;
    return n > 0 ? 28 + Math.min(4, n) * 0.6 : 0;
  }

  update(dt) {
    const v = this.vehicle;
    const sw = v.sw;
    const tm = v.tm;
    const bus = this.busV();
    this.amps = this._loads();
    const onBats = Object.entries(this.batOn).filter(([k, on]) => on && this.batAh[k] > 1);
    for (const [k] of onBats) this.batAh[k] = Math.max(0, this.batAh[k] - (this.amps / onBats.length) * (dt / 3600));
    // ECS
    const crew = v.station === 'LM' ? (this.lifeboat ? 3 : 2) : 0;
    const removal = bus ? (this.adapter ? 0.012 : 0.006 * this.lioh) : 0;
    this.co2 = Math.max(0.3, this.co2 + (crew * 0.00042 - removal * (this.co2 / 6)) * dt);
    if (!this.adapter && crew) this.lioh = Math.max(0.05, this.lioh - (crew * 1.2e-6) * dt);
    this.cabinT += ((bus ? (this.lifeboat ? 42 : 66) : 35) - this.cabinT) * (1 - Math.exp(-dt / 20000));
    this.waterKg = Math.max(0, this.waterKg - (this.amps * 0.00012) * dt);
    // telemetry
    tm['LM.EPS.CDR_BUS.V'] = bus;
    tm['LM.EPS.LMP_BUS.V'] = bus ? bus - 0.1 : 0;
    tm['LM.EPS.AC.V'] = bus && !sw.is('LM.EPS.INV', 'OFF') ? 115 : 0;
    tm['LM.EPS.TOTAL_AMPS'] = this.amps;
    for (let i = 1; i <= 6; i++) {
      tm[`LM.EPS.BAT${i}.AH`] = this.batAh[i];
      tm[`LM.EPS.BAT${i}.V`] = this.batOn[i] && this.batAh[i] > 1 ? 32.5 : 0;
      const tb = this.batOn[i] ? 'GRAY' : 'BARBER';
      tm[`LM.EPS.${i > 4 ? 'ASC' : 'DES'}_BAT_${i}_${i > 4 ? 'NORM' : 'HV'}_TB`] = tb;
      if (i <= 4) tm[`LM.EPS.DES_BAT_${i}_LV_TB`] = tb;
    }
    tm['LM.ECS.PPCO2_MMHG'] = this.co2;
    tm['LM.ECS.CABIN.P_PSI'] = bus ? 4.9 : 4.8;
    tm['LM.ECS.SUIT.P_PSI'] = bus ? 4.8 : 4.7;
    tm['LM.ECS.CABIN.T_F'] = this.cabinT;
    tm['LM.ECS.H2O_DES_QTY'] = this.waterKg / 151;
    tm['LM.DPS.FUEL_QTY'] = this.staged ? 0 : this.dpsProp / this.dpsProp0;
    tm['LM.DPS.OX_QTY'] = tm['LM.DPS.FUEL_QTY'];
    tm['LM.APS.FUEL_QTY'] = this.apsProp / 2353;
    tm['LM.APS.OX_QTY'] = tm['LM.APS.FUEL_QTY'];
    tm['LM.RCS.A.QTY'] = this.rcsKg.A / 140;
    tm['LM.RCS.B.QTY'] = this.rcsKg.B / 140;
    tm['LM.ENG.ABORT_CMD'] = this.abort;
    tm['LM.ENG.ABORT_STAGE_CMD'] = this.abortStage;
    tm['LM.MT.GET'] = bus ? this.clock.get : NaN;
    tm['LM.MT.EVENT'] = bus ? (this.eventStart !== undefined ? this.clock.get - this.eventStart : 0) : NaN;
    // RR cycle stealing (Apollo 11 1202/1201 root cause): RR switch not in LGC while powered
    tm['LM.RR.CYCLE_STEAL'] = bus > 0 && !sw.is('LM.RADAR.RR_MODE', 'LGC');
    if (!bus) return;
    // C&W
    const frac = this.dpsProp / this.dpsProp0;
    if (!this.staged && frac < 0.056 && v.cmd.dps && !this.lowLevel) {
      this.lowLevel = true;
      this.lowLevelAt = this.clock.get;
      this.caution('DES_QTY');
      this.bus.emit('lm:lowLevel', { get: this.clock.get });
    }
    if (this.co2 > 7.6) this.caution('CO2_HI');
    if (this.waterKg < 15) this.caution('WATER_QTY');
  }

  /** Can the descent / ascent engine fire? (arm switch, breaker, pressurization) */
  engineArmed(kind) {
    const sw = this.vehicle.sw;
    if (sw.get('LM.CB.ENG_ARM') !== 'IN') return false;
    if (kind === 'DPS') return sw.is('LM.ENG.ENG_ARM', 'DES') || this.abort;
    return sw.is('LM.ENG.ENG_ARM', 'ASC') || this.abortStage;
  }

  massProps() {
    const asc = 2445 + this.apsProp + this.rcsKg.A + this.rcsKg.B;
    const des = this.staged ? 0 : 2034 + this.dpsProp;
    return { mass: asc + des, inertia: new Vector3(25000, 23000, 24000) };
  }

  propulsion(acc, dt) {
    const v = this.vehicle;
    if (!v.isAttached('lm')) return;
    const { cmd } = v;
    const bus = this.busV() > 0;
    if (v.station === 'LM' && bus) {
      acc.force.addScaledVector(cmd.rcsTrans, 2 * 445);
      if (v.sw.is('LM.ENG.PLUS_X', 'PUSHED')) acc.force.x += 4 * 445;
      const use = (cmd.rcsRot.length() + cmd.rcsTrans.length()) * 0.25 * dt;
      this.rcsKg.A = Math.max(0, this.rcsKg.A - use / 2);
      this.rcsKg.B = Math.max(0, this.rcsKg.B - use / 2);
    }
    let thrustPct = 0;
    const stopped = v.sw.is('LM.ENG.STOP_CDR', 'PUSHED') || v.sw.is('LM.ENG.STOP_LMP', 'PUSHED');
    const manualDps = this.manualStart && !stopped && v.sw.is('LM.ENG.ENG_ARM', 'DES');
    const manualAps = this.manualStart && !stopped && v.sw.is('LM.ENG.ENG_ARM', 'ASC');
    this.dpsFiring = false;
    this.apsFiring = false;
    if (!this.staged && (cmd.dps || manualDps) && this.dpsProp > 0 && bus && this.engineArmed('DPS')) {
      // manual throttle (TTCA) when THR CONT is MAN or no guidance is commanding the engine
      const manThr = v.sw.is('LM.GNC.THR_CONT', 'MAN') || !cmd.dps;
      const thr = manThr ? Math.max(0.1, Math.min(0.925, 0.1 + v.controls.ttca * 0.825)) : Math.max(0.1, Math.min(0.925, cmd.dpsThrottle));
      if (manThr) cmd.dpsThrottle = thr;
      this.dpsFiring = true;
      const T = DPS_MAX * thr;
      acc.force.x += T;
      const mdot = T / (305 * 9.80665);
      acc.mdot += mdot;
      this.dpsProp = Math.max(0, this.dpsProp - mdot * dt);
      thrustPct = thr * 100;
    }
    if ((cmd.aps || manualAps || (this.abortStage && v.state.alt > 5)) && this.apsProp > 0 && bus && this.engineArmed('APS') && (this.staged || v.config === 'LM_ASC')) {
      this.apsFiring = true;
      acc.force.x += APS_THRUST;
      const mdot = APS_THRUST / (311 * 9.80665);
      acc.mdot += mdot;
      this.apsProp = Math.max(0, this.apsProp - mdot * dt);
      thrustPct = 100;
    }
    v.tm['LM.ENG.THRUST_PCT'] = thrustPct;
    v.tm['LM.DPS.FIRING'] = this.dpsFiring;
    v.tm['LM.DPS.THRUST_PCT'] = thrustPct;
  }

  dispose() {
    this._off.forEach((f) => f());
  }
}
