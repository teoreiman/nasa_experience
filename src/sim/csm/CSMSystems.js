// CSM hardware simulation: EPS (3 fuel cells, main buses A/B, batteries, inverters → AC buses),
// cryogenics (O2/H2 tanks with heaters & fans), ECS (cabin, suit loop, CO2), SM/CM RCS, SPS,
// sequencer pyros, timers, caution & warning. Numerically stable for dt up to 10 s.
// Failures: O2_TANK2_EXPLOSION (Apollo 13), LIGHTNING_STRIKE (Apollo 12), FC_FAIL_n.

import { Vector3 } from 'three';
import { CM_SWITCHES } from './registry.js';

export const CSM_PRESETS = ['PRELAUNCH', 'EARTH_ORBIT', 'TLC', 'LUNAR_ORBIT', 'TEC', 'ENTRY', 'POWERED_DOWN', 'A13_PRE_EXPLOSION'];

const relax = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

export class CSMSystems {
  constructor({ vehicle, bus, clock, missionId }) {
    this.vehicle = vehicle;
    this.bus = bus;
    this.clock = clock;
    this.missionId = missionId;
    this.hasSM = true;
    vehicle.sw.defineAll(CM_SWITCHES);
    const sw = vehicle.sw;
    this.fc = [1, 2, 3].map((n) => ({ n, reac: true, failed: false, online: { A: n !== 3, B: n !== 1 }, amps: 0, v: 30, temp: 420 }));
    this.o2 = [{ p: 900, qty: 0.97, leak: 0 }, { p: 900, qty: 0.97, leak: 0 }];
    this.h2 = [{ p: 240, qty: 0.96 }, { p: 240, qty: 0.96 }];
    this.bat = { A: 40, B: 40, C: 40 }; // Ah
    this.inv = { 1: true, 2: true, 3: false };
    this.ac = { 1: { inv: 1 }, 2: { inv: 2 } };
    this.mn = { A: 28.8, B: 28.8 };
    this.cabin = { p: 5.0, t: 72, co2: 1.5 };
    this.spsOx = 1;
    this.spsFuel = 1;
    this.spsProp = 18413;
    this.smRcs = { A: 1, B: 1, C: 1, D: 1 };
    this.cmRcs = [1, 1];
    this.smRcsKg = 4 * 153;
    this.cmRcsKg = 2 * 55;
    this.sce = 1;
    this.lightning = false;
    this.exploded = false;
    this.cwInhibit = new Set();
    this.event = 0;
    this.eventRun = false;
    this.lampTest = false;
    this.tbState = Object.create(null);
    // talkback initial states for momentary valves
    for (const q of ['A', 'B', 'C', 'D']) {
      this.tbState[`CM.RCS.SM_${q}_PRPLNT_TB`] = 'GRAY';
      this.tbState[`CM.RCS.SM_${q}_HE1_TB`] = 'GRAY';
      this.tbState[`CM.RCS.SM_${q}_HE2_TB`] = 'GRAY';
    }
    this._off = [bus.on('switch:changed', (e) => this._onSwitch(e))];
    this.reset('TLC');
  }

  reset(preset) {
    const name = typeof preset === 'object' ? preset.preset ?? 'TLC' : preset;
    const sw = this.vehicle.sw;
    sw.set('CM.CRYO.O2_FAN_1', 'OFF', 'restore');
    sw.set('CM.CRYO.O2_FAN_2', 'OFF', 'restore');
    if (name === 'PRELAUNCH') {
      this.cabin = { p: 14.7, t: 70, co2: 0.8 };
      sw.set('CM.GNC.CMC_MODE', 'FREE', 'restore');
      sw.set('CM.ECS.SUIT_COMPR_2', 'OFF', 'restore');
    }
    if (name === 'POWERED_DOWN') {
      for (const f of this.fc) f.reac = false;
      this.o2 = [{ p: 0, qty: 0, leak: 0 }, { p: 0, qty: 0, leak: 0 }];
      this.exploded = true;
      this.hasSM = true;
      this.vehicle.parts.smDamaged = true;
      this.poweredDown = true;
      this.bat = { A: 25, B: 30, C: 35 };
      this.cabin = { p: 5.0, t: 45, co2: 4 };
    }
    if (name === 'ENTRY') {
      this.hasSM = this.vehicle.config !== 'CM';
    }
    if (typeof preset === 'object') {
      if (preset.switches) sw.apply(preset.switches, 'script');
      if (preset.consumables) Object.assign(this, preset.consumables);
    }
    this._writeTm(0);
  }

  _onSwitch({ id, value, source }) {
    const v = this.vehicle;
    const tm = v.tm;
    if (id.startsWith('CM.CW.MASTER_ALARM_') && value === 'PUSHED') {
      tm['CM.CW.MASTER_ALARM'] = false;
      tm['CM.CW.TONE'] = false;
    }
    if (id === 'CM.CW.LAMP_TEST') this.lampTest = value !== 'OFF';
    if ((id === 'CM.LV.TWR_JETT_1' || id === 'CM.LV.TWR_JETT_2') && value === 'FIRE' && v.parts.les) v.request('LES_JETT');
    if (id === 'CM.LV.CSM_LV_SEP' && value === 'SEP') v.request('CSM_SEP');
    if (id === 'CM.LV.SIVB_LM_SEP' && value === 'SEP') v.request('LM_EXTRACT');
    if ((id === 'CM.SEQ.CM_SM_SEP_1' || id === 'CM.SEQ.CM_SM_SEP_2') && value === 'SEP') v.request('CM_SM_SEP');
    if (id === 'CM.SEQ.LES_MOTOR_FIRE' && value === 'FIRE') v.request('ABORT', { mode: 'I' });
    if (id === 'CM.SEQ.APEX_COVER_JETT' && value === 'JETT') v.request('APEX_COVER_JETT');
    if (id === 'CM.SEQ.DROGUE_DEPLOY' && value === 'DEPLOY') v.request('DROGUE_DEPLOY');
    if (id === 'CM.SEQ.MAIN_DEPLOY' && value === 'DEPLOY') v.request('MAIN_DEPLOY');
    if (id === 'CM.DOCK.PROBE' && value === 'RETRACT') v.request('DOCK_HARD');
    // fuel-cell reactant valves (momentary) — closing is irreversible once O2 is gone
    const reac = id.match(/^CM\.EPS\.FC(\d)_REAC$/);
    if (reac) {
      const f = this.fc[+reac[1] - 1];
      if (value === 'CLOSE') f.reac = false;
      if (value === 'OPEN' && !this.exploded) f.reac = true;
    }
    const conn = id.match(/^CM\.EPS\.MN([AB])_FC(\d)$/);
    if (conn) {
      const f = this.fc[+conn[2] - 1];
      if (value === 'ON') f.online[conn[1]] = true;
      if (value === 'OFF') f.online[conn[1]] = false;
    }
    const acs = id.match(/^CM\.EPS\.AC(\d)_INV(\d)$/);
    if (acs) {
      if (value === 'ON') this.ac[acs[1]].inv = +acs[2];
      if (value === 'OFF' && this.ac[acs[1]].inv === +acs[2]) this.ac[acs[1]].inv = 0;
    }
    const rcsV = id.match(/^CM\.RCS\.SM_([A-D])_(PRPLNT|HE1|HE2)$/);
    if (rcsV && value !== 'CENTER') this.tbState[`CM.RCS.SM_${rcsV[1]}_${rcsV[2]}_TB`] = value === 'OPEN' ? 'GRAY' : 'BARBER';
    if (id === 'CM.MT.EVENT_TIMER') {
      if (value === 'START') this.eventRun = true;
      if (value === 'STOP') this.eventRun = false;
      if (value === 'RESET') {
        this.event = 0;
        this.eventRun = false;
      }
    }
    if (id === 'CM.EPS.SCE_PWR' && value === 'AUX') this.sce = 1;
    // Apollo 13 cryo stir: fans ON after the TV broadcast set off the damaged tank 2 wiring
    if ((id === 'CM.CRYO.O2_FAN_2' || id === 'CM.CRYO.O2_FAN_1') && value === 'ON' && this.armedTank2 && !this.exploded) {
      this.stirAt = this.clock.get + 16; // ~16 s after the fans came on
    }
  }

  caution(lamp, warn = false) {
    const tm = this.vehicle.tm;
    const k = `CM.CW.${lamp}`;
    if (!tm[k]) {
      tm[k] = true;
      tm['CM.CW.MASTER_ALARM'] = true;
      tm['CM.CW.TONE'] = true;
      this.bus.emit('cw:alarm', { vehicle: 'CM', lamp, warn });
    }
  }

  _clear(lamp) {
    this.vehicle.tm[`CM.CW.${lamp}`] = false;
  }

  /** Arm the Apollo 13 tank-2 failure: the next cryo stir with tank 2 fans triggers the explosion. */
  armA13() {
    this.armedTank2 = true;
  }

  trigger(name, opts = {}) {
    const tm = this.vehicle.tm;
    if (name === 'O2_TANK2_EXPLOSION' && !this.exploded) {
      this.exploded = true;
      this.o2[1].p = 1008;
      this.o2[1].qty = 1.05;
      this.o2[0].leak = 1 / (100 * 60); // tank 1 empties in ~100 min
      this.fc[0].reac = false; // FC1 & FC3 starve immediately (reactant valves slammed shut)
      this.fc[2].reac = false;
      this.fc[0].failed = true;
      this.fc[2].failed = true;
      this.vehicle.parts.smDamaged = true;
      this.dropoutUntil = this.clock.get + 1.8;
      this.vehicle.request('O2_TANK2_EXPLOSION');
      this.caution('MAIN_BUS_B_UNDERVOLT', true);
    }
    if (name === 'LIGHTNING_STRIKE') {
      this.lightning = true;
      this.sce = 0.15;
      for (const f of this.fc) f.online = { A: false, B: false };
      for (const l of ['FC_BUS_DISCONNECT', 'FC_1', 'FC_2', 'FC_3', 'AC_BUS_1', 'AC_BUS_2', 'AC_BUS_1_OVERLOAD', 'AC_BUS_2_OVERLOAD', 'MAIN_BUS_A_UNDERVOLT', 'MAIN_BUS_B_UNDERVOLT', 'ISS', 'BAT_CHARGER']) this.caution(l, true);
      tm['CM.GNC.IMU.FAILED'] = true;
    }
    const fcf = name.match(/^FC_FAIL_(\d)$/);
    if (fcf) this.fc[+fcf[1] - 1].failed = true;
    this.bus.emit('systems:failure', { module: 'CSM', name, opts });
  }

  /** Electrical load per main bus (A) derived from switch positions. */
  _loads() {
    const sw = this.vehicle.sw;
    let a = 18;
    let b = 18;
    if (this.poweredDown) return { A: 0, B: 0 };
    const add = (bus, amps) => (bus === 'A' ? (a += amps) : (b += amps));
    if (sw.is('CM.GN.IMU_PWR', 'ON')) add('A', 6);
    if (sw.is('CM.GN.CMC_PWR', 'ON')) add('B', 4);
    if (sw.is('CM.GN.OPTICS_PWR', 'ON')) add('B', 1.5);
    for (const n of [1, 2]) if (!sw.is(`CM.ECS.SUIT_COMPR_${n}`, 'OFF')) add(n === 1 ? 'A' : 'B', 5);
    if (sw.is('CM.ECS.CABIN_FAN_1', 'ON')) add('A', 1.5);
    if (sw.is('CM.ECS.CABIN_FAN_2', 'ON')) add('B', 1.5);
    for (const [id, bus, amps] of [['CM.CRYO.O2_FAN_1', 'A', 1.2], ['CM.CRYO.O2_FAN_2', 'B', 1.2], ['CM.CRYO.H2_FAN_1', 'A', 0.6], ['CM.CRYO.H2_FAN_2', 'B', 0.6]]) if (sw.is(id, 'ON')) add(bus, amps);
    for (const [id, amps] of [['CM.SPS.GMBL_P1', 4], ['CM.SPS.GMBL_P2', 4], ['CM.SPS.GMBL_Y1', 4], ['CM.SPS.GMBL_Y2', 4]]) if (!sw.is(id, 'OFF')) add(id.endsWith('1') ? 'A' : 'B', amps);
    if (sw.is('CM.COMM.HGA_PWR', 'POWER')) add('B', 2.5);
    if (!sw.is('CM.LTG.FLOOD', 'OFF')) add('A', sw.is('CM.LTG.FLOOD', 'BRIGHT') ? 3 : 1.5);
    if (this.vehicle.cmd.sps) add('A', 6);
    return { A: a, B: b };
  }

  update(dt) {
    const v = this.vehicle;
    const sw = v.sw;
    const tm = v.tm;
    const t = this.clock.get;
    if (this.stirAt && t >= this.stirAt && !this.exploded) {
      this.stirAt = null;
      this.trigger('O2_TANK2_EXPLOSION');
    }
    // ---- cryogenics
    const fansOn = (n) => sw.is(`CM.CRYO.O2_FAN_${n}`, 'ON');
    for (let i = 0; i < 2; i++) {
      const o = this.o2[i];
      if (this.exploded && i === 1) {
        o.p = relax(o.p, 0, 0.05, dt);
        o.qty = o.p < 50 ? 0 : relax(o.qty, 1.05, 1, dt); // off-scale high then dead
        continue;
      }
      const draw = this.fc.reduce((s, f) => s + (f.reac && !f.failed ? f.amps : 0), 0) * 3.4e-7; // fraction/s
      o.qty = Math.max(0, o.qty - (draw / 2 + o.leak) * dt);
      const target = o.qty <= 0.002 ? 0 : 880 + (fansOn(i + 1) ? 25 : 0) + (sw.is(`CM.CRYO.O2_HTR_${i + 1}`, 'ON') ? 40 : 0);
      o.p = relax(o.p, o.leak ? target * Math.min(1, o.qty * 3) : target, 0.02, dt);
    }
    for (const h of this.h2) h.qty = Math.max(0, h.qty - 2e-7 * dt);
    // ---- fuel cells
    const o2ok = this.o2[0].p > 120 || this.o2[1].p > 120;
    const loads = this._loads();
    for (const f of this.fc) {
      if (f.reac && !o2ok) {
        f.failed = true;
      }
      const alive = f.reac && !f.failed;
      if (!alive) f.online = f.online; // stays connected but supplies nothing
      f.v = alive ? relax(f.v, 30.5, 0.5, dt) : relax(f.v, 0, 0.3, dt);
    }
    const supply = (bus) => this.fc.filter((f) => f.reac && !f.failed && f.online[bus] && this.sceOk()).length;
    const batTie = { A: sw.is('CM.EPS.MAIN_BUS_TIE_AC', 'ON'), B: sw.is('CM.EPS.MAIN_BUS_TIE_BC', 'ON') };
    for (const bus of ['A', 'B']) {
      const n = supply(bus);
      let target;
      if (this.poweredDown && !batTie[bus]) target = 0;
      else if (n > 0) target = 29.2 - loads[bus] * 0.012 / n;
      else if (batTie[bus]) target = 28.2 - loads[bus] * 0.02;
      else target = this.lightning ? 0 : 23 - loads[bus] * 0.15;
      this.mn[bus] = relax(this.mn[bus], Math.max(0, target), 2, dt);
      if (n === 0 && batTie[bus]) this.bat.A = Math.max(0, this.bat.A - (loads[bus] * dt) / 3600 / 2);
    }
    for (const f of this.fc) {
      const shares = ['A', 'B'].filter((b) => f.online[b]).reduce((s, b) => s + loads[b] / Math.max(1, supply(b)), 0);
      f.amps = f.reac && !f.failed ? relax(f.amps, shares, 1, dt) : relax(f.amps, 0, 2, dt);
      f.temp = relax(f.temp, f.reac && !f.failed ? 420 : 300, 0.01, dt);
    }
    // ---- AC
    const invPower = (n) => (n === 1 ? this.mn.A : n === 2 ? this.mn.B : Math.max(this.mn.A, this.mn.B)) > 22 && !sw.is(`CM.EPS.INV${n}_PWR`, 'OFF');
    const acV = (k) => {
      const inv = this.ac[k].inv;
      return inv && invPower(inv) ? 115.5 : 0;
    };
    // ---- ECS
    const crew = 3;
    const scrub = !sw.is('CM.ECS.SUIT_COMPR_1', 'OFF') || !sw.is('CM.ECS.SUIT_COMPR_2', 'OFF') ? (this.mn.A > 20 || this.mn.B > 20 ? 1 : 0) : 0;
    this.cabin.co2 = Math.max(0.2, this.cabin.co2 + (crew * 0.0009 - scrub * 0.0035 * (this.cabin.co2 / 4)) * dt);
    const tTarget = this.mn.A < 20 && this.mn.B < 20 ? 40 : 72;
    this.cabin.t = relax(this.cabin.t, tTarget, 0.00005, dt);
    if (v.state.liftoff && this.cabin.p > 5.1) this.cabin.p = relax(this.cabin.p, 5.0, 0.004, dt);
    // ---- timers
    if (this.eventRun) this.event += sw.is('CM.MT.EVENT_TIMER_DIR', 'DOWN') ? -dt : dt;
    this._writeTm(dt, { loads, acV });
  }

  sceOk() {
    return true;
  }

  _writeTm(dt, info = null) {
    const v = this.vehicle;
    const tm = v.tm;
    const sw = v.sw;
    const t = this.clock.get;
    const powered = this.mn.A > 18 || this.mn.B > 18;
    const garble = this.lightning && this.vehicle.sw.get('CM.EPS.SCE_PWR') !== 'AUX';
    const g = (x) => (garble ? x * (0.2 + Math.random() * 1.6) : x);
    tm['CM.TLM.QUALITY'] = garble ? 0.15 : t < (this.dropoutUntil ?? -1e9) ? 0 : 1;
    tm['CM.EPS.MNA.V'] = g(this.mn.A);
    tm['CM.EPS.MNB.V'] = g(this.mn.B);
    const acV = info?.acV ?? (() => 115.5);
    tm['CM.EPS.AC1.V'] = g(acV(1));
    tm['CM.EPS.AC2.V'] = g(acV(2));
    this.fc.forEach((f, i) => {
      tm[`CM.EPS.FC${i + 1}.AMPS`] = g(f.amps);
      tm[`CM.EPS.FC${i + 1}.V`] = g(f.v);
      tm[`CM.EPS.FC${i + 1}.ON_LINE`] = f.reac && !f.failed;
      tm[`CM.EPS.FC${i + 1}.TEMP_F`] = f.temp;
      tm[`CM.EPS.FC${i + 1}_REAC_TB`] = f.reac ? 'GRAY' : 'BARBER';
      tm[`CM.EPS.MNA_FC${i + 1}_TB`] = f.online.A ? 'GRAY' : 'BARBER';
      tm[`CM.EPS.MNB_FC${i + 1}_TB`] = f.online.B ? 'GRAY' : 'BARBER';
    });
    for (const k of [1, 2]) for (const n of [1, 2, 3]) tm[`CM.EPS.AC${k}_INV${n}_TB`] = this.ac[k].inv === n ? 'GRAY' : 'BARBER';
    const sel = sw.get('CM.EPS.DC_IND');
    tm['CM.EPS.IND_AMPS'] = sel?.startsWith('FC') ? this.fc[+sel[2] - 1].amps : info ? (sel === 'MNA' ? info.loads.A : info.loads.B) : 30;
    for (let i = 0; i < 2; i++) {
      tm[`CM.CRYO.O2_${i + 1}.P_PSI`] = g(this.o2[i].p);
      tm[`CM.CRYO.O2_${i + 1}.QTY`] = g(this.o2[i].qty);
      tm[`CM.CRYO.H2_${i + 1}.P_PSI`] = g(this.h2[i].p);
      tm[`CM.CRYO.H2_${i + 1}.QTY`] = g(this.h2[i].qty);
    }
    tm['CM.ECS.CABIN.P_PSI'] = this.cabin.p;
    tm['CM.ECS.SUIT.P_PSI'] = this.cabin.p - 0.05;
    tm['CM.ECS.CABIN.T_F'] = this.cabin.t;
    tm['CM.ECS.PPCO2_MMHG'] = this.cabin.co2;
    tm['CM.SPS.OX_QTY'] = this.spsProp / 18413;
    tm['CM.SPS.FUEL_QTY'] = this.spsProp / 18413;
    for (const q of ['A', 'B', 'C', 'D']) tm[`CM.RCS.QUAD_${q}.QTY`] = this.smRcsKg / (4 * 153);
    for (const [k, val] of Object.entries(this.tbState)) tm[k] = val;
    tm['CM.MT.GET'] = powered ? t : NaN;
    tm['CM.MT.EVENT'] = powered ? this.event : NaN;
    tm['CW.LAMP_TEST'] = this.lampTest;
    const st = v.state;
    tm['CM.GNC.ACCEL_G'] = st.gLoad ?? 0;
    tm['CM.ALT_KFT'] = st.primary === 'EARTH' && st.alt < 15240 ? st.alt / 304.8 : NaN;
    // caution & warning conditions
    if (!powered) return;
    const lamp = (name, cond, warn) => (cond ? this.caution(name, warn) : !this.lightning && this._clear(name));
    lamp('MAIN_BUS_A_UNDERVOLT', this.mn.A < 26.25 && this.mn.A > 1, true);
    lamp('MAIN_BUS_B_UNDERVOLT', this.mn.B < 26.25 && this.mn.B > 1, true);
    this.fc.forEach((f, i) => lamp(`FC_${i + 1}`, f.failed || !f.reac));
    lamp('CRYO_PRESS', this.o2.some((o) => o.p < 800) || this.o2[1].p > 1000);
    lamp('O2_FLOW_HI', this.exploded && this.o2[0].leak > 0 && this.o2[0].qty > 0.02);
    lamp('CO2_PP_HI', this.cabin.co2 > 7.6, true);
    lamp('AC_BUS_2', acV(2) < 95, true);
    lamp('AC_BUS_1', acV(1) < 95, true);
    tm['CM.CW.CMC'] = !!tm['CM.GNC.CMC_WARN'];
    tm['CM.CW.ISS'] = !!tm['CM.GNC.IMU.FAILED'];
  }

  powerBudget() {
    const l = this._loads();
    return { mna: l.A, mnb: l.B, total: l.A + l.B };
  }

  consumables() {
    return { o2kg: (this.o2[0].qty + this.o2[1].qty) * 145, batAh: { ...this.bat }, spsKg: this.spsProp, rcsKg: this.smRcsKg };
  }

  massProps() {
    const dry = this.hasSM ? 5557 + 6110 : 5557;
    return { mass: dry + (this.hasSM ? this.spsProp + this.smRcsKg : 0) + this.cmRcsKg, inertia: new Vector3(42000, 75000, 75000) };
  }

  /** SPS fires only with ΔV THRUST A/B NORMAL, gimbal motors on and the thrust signal. */
  spsReady() {
    const sw = this.vehicle.sw;
    return (sw.is('CM.SPS.DV_THRUST_A', 'NORMAL') || sw.is('CM.SPS.DV_THRUST_B', 'NORMAL')) && (!sw.is('CM.SPS.GMBL_P1', 'OFF') || !sw.is('CM.SPS.GMBL_P2', 'OFF')) && (!sw.is('CM.SPS.GMBL_Y1', 'OFF') || !sw.is('CM.SPS.GMBL_Y2', 'OFF'));
  }

  propulsion(acc, dt) {
    const v = this.vehicle;
    const { cmd } = v;
    if (!v.isAttached('csm')) return;
    const powered = this.mn.A > 18 || this.mn.B > 18;
    const rcsOk = (this.hasSM ? this.smRcsKg > 0 : this.cmRcsKg > 0) && (powered || !this.hasSM);
    if (rcsOk && v.station === 'CM') {
      const torque = 2 * 445 * 1.95;
      acc.torque.x += cmd.rcsRot.x * torque;
      acc.torque.y += cmd.rcsRot.y * torque * 2.5;
      acc.torque.z += cmd.rcsRot.z * torque * 2.5;
      acc.force.addScaledVector(cmd.rcsTrans, 2 * 445);
      const use = (Math.abs(cmd.rcsRot.x) + Math.abs(cmd.rcsRot.y) + Math.abs(cmd.rcsRot.z) + cmd.rcsTrans.length()) * 0.3 * dt;
      if (this.hasSM) this.smRcsKg = Math.max(0, this.smRcsKg - use);
      else this.cmRcsKg = Math.max(0, this.cmRcsKg - use);
    }
    const fire = this.hasSM && cmd.sps && this.spsProp > 0 && this.spsReady() && powered;
    if (fire) {
      acc.force.x += 91190;
      const mdot = 91190 / (314 * 9.80665);
      acc.mdot += mdot;
      this.spsProp = Math.max(0, this.spsProp - mdot * dt);
    }
    v.tm['CM.SPS.THRUST'] = !!fire;
    v.tm['CM.SPS.PC_PSI'] = fire ? 97 : 0;
  }

  dispose() {
    this._off.forEach((f) => f());
  }
}
