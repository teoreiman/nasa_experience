// CSM hardware simulation. STUB by the architect with the final public interface (see
// docs/ARCHITECTURE.md §6). The "csm" agent replaces the internals (EPS, cryo, ECS, RCS, SPS, C&W,
// sequencer, failures) and keeps this interface.

import { Vector3 } from 'three';
import { CM_SWITCHES } from './registry.js';

export const CSM_PRESETS = ['PRELAUNCH', 'EARTH_ORBIT', 'TLC', 'LUNAR_ORBIT', 'TEC', 'ENTRY', 'POWERED_DOWN', 'A13_PRE_EXPLOSION'];

export class CSMSystems {
  /** @param {{vehicle: import('../Vehicle.js').Vehicle, bus: any, clock: any}} deps */
  constructor({ vehicle, bus, clock }) {
    this.vehicle = vehicle;
    this.bus = bus;
    this.clock = clock;
    this.hasSM = true;
    vehicle.sw.defineAll(CM_SWITCHES);
    this.spsProp = 18413; // kg (Apollo 11 SPS load)
    this.smRcsProp = 4 * 140;
    this.cmRcsProp = 2 * 55;
    this._off = [
      bus.on('switch:changed', (e) => this._onSwitch(e)),
    ];
    this.reset('PRELAUNCH');
  }

  /** Configure switches & consumables for a mission phase preset (see CSM_PRESETS) or an object
   *  { switches: {...}, consumables: {...} }. */
  reset(preset) {
    const tm = this.vehicle.tm;
    tm['CM.EPS.MNA.V'] = 28.6;
    tm['CM.EPS.MNB.V'] = 28.5;
    tm['CM.EPS.AC1.V'] = 115.8;
    tm['CM.EPS.AC2.V'] = 115.6;
    tm['CM.CRYO.O2_1.P_PSI'] = 900;
    tm['CM.CRYO.O2_2.P_PSI'] = 900;
    tm['CM.CRYO.O2_1.QTY'] = 0.98;
    tm['CM.CRYO.O2_2.QTY'] = 0.98;
    tm['CM.CW.MASTER_ALARM'] = false;
    tm['CM.CW.TONE'] = false;
    if (preset && typeof preset === 'object' && preset.switches) this.vehicle.sw.apply(preset.switches, 'script');
  }

  _onSwitch({ id, value }) {
    if (id.startsWith('CM.CW.MASTER_ALARM_') && value === 'PUSHED') {
      this.vehicle.tm['CM.CW.MASTER_ALARM'] = false;
      this.vehicle.tm['CM.CW.TONE'] = false;
    }
    if ((id === 'CM.LV.TWR_JETT_1' || id === 'CM.LV.TWR_JETT_2') && value === 'FIRE') this.vehicle.request('LES_JETT');
    if (id === 'CM.LV.CSM_LV_SEP' && value === 'SEP') this.vehicle.request('CSM_SEP');
    if ((id === 'CM.SEQ.CM_SM_SEP_1' || id === 'CM.SEQ.CM_SM_SEP_2') && value === 'SEP') this.vehicle.request('CM_SM_SEP');
  }

  /** Raise a C&W condition (lamp + master alarm + tone). */
  caution(lamp) {
    const tm = this.vehicle.tm;
    if (!tm[`CM.CW.${lamp}`]) {
      tm[`CM.CW.${lamp}`] = true;
      tm['CM.CW.MASTER_ALARM'] = true;
      tm['CM.CW.TONE'] = true;
      this.bus.emit('cw:alarm', { vehicle: 'CM', lamp });
    }
  }

  /** Inject a failure: 'O2_TANK2_EXPLOSION', 'LIGHTNING_STRIKE', ... */
  trigger(name, opts = {}) {
    this.bus.emit('systems:failure', { module: 'CSM', name, opts });
  }

  update(dt) {
    this.vehicle.tm['CM.MT.GET'] = this.clock.get;
  }

  massProps() {
    const dry = this.hasSM ? 5557 + 6110 : 5557;
    return { mass: dry + (this.hasSM ? this.spsProp + this.smRcsProp : 0) + this.cmRcsProp, inertia: new Vector3(42000, 75000, 75000) };
  }

  /** Add body-frame force (N), torque (N·m) and mass flow (kg/s) to the accumulator. */
  propulsion(acc, dt) {
    const { cmd, sw } = this.vehicle;
    const rcsTorque = 4 * 445 * 1.95; // 4 jets × 445 N × arm
    acc.torque.x += cmd.rcsRot.x * rcsTorque;
    acc.torque.y += cmd.rcsRot.y * rcsTorque * 2.5;
    acc.torque.z += cmd.rcsRot.z * rcsTorque * 2.5;
    acc.force.addScaledVector(cmd.rcsTrans, 2 * 445);
    const spsArmed = sw.is('CM.SPS.DV_THRUST_A', 'NORMAL') || sw.is('CM.SPS.DV_THRUST_B', 'NORMAL');
    if (this.hasSM && cmd.sps && spsArmed && this.spsProp > 0) {
      acc.force.x += 91190; // SPS 20,500 lbf
      const mdot = 91190 / (314 * 9.80665);
      acc.mdot += mdot;
      this.spsProp = Math.max(0, this.spsProp - mdot * dt);
      this.vehicle.tm['CM.SPS.THRUST'] = true;
    } else this.vehicle.tm['CM.SPS.THRUST'] = false;
  }

  dispose() {
    this._off.forEach((f) => f());
  }
}
