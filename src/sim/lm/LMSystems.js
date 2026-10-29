// LM hardware simulation. STUB by the architect with the final public interface
// (docs/ARCHITECTURE.md §7). The "lm" agent replaces the internals and keeps the interface.

import { Vector3 } from 'three';
import { LM_SWITCHES } from './registry.js';

export const LM_PRESETS = ['STOWED', 'ACTIVATED', 'PRE_PDI', 'LANDED', 'PRE_ASCENT', 'LIFEBOAT', 'POWERED_DOWN'];

export class LMSystems {
  constructor({ vehicle, bus, clock }) {
    this.vehicle = vehicle;
    this.bus = bus;
    this.clock = clock;
    this.staged = false; // descent stage left behind
    vehicle.sw.defineAll(LM_SWITCHES);
    this.dpsProp = 8200;
    this.apsProp = 2353;
    this.rcsProp = 287;
    this._off = [bus.on('switch:changed', (e) => this._onSwitch(e))];
    this.reset('STOWED');
  }

  reset(preset) {
    const tm = this.vehicle.tm;
    tm['LM.EPS.CDR_BUS.V'] = 0;
    tm['LM.EPS.LMP_BUS.V'] = 0;
    tm['LM.ECS.PPCO2_MMHG'] = 0.5;
    tm['LM.DPS.FUEL_QTY'] = 1;
    tm['LM.CW.MASTER_ALARM'] = false;
    if (preset && typeof preset === 'object' && preset.switches) this.vehicle.sw.apply(preset.switches, 'script');
  }

  _onSwitch({ id, value }) {
    if (id.startsWith('LM.CW.MASTER_ALARM_') && value === 'PUSHED') this.vehicle.tm['LM.CW.MASTER_ALARM'] = false;
  }

  caution(lamp) {
    const tm = this.vehicle.tm;
    if (!tm[`LM.CW.${lamp}`]) {
      tm[`LM.CW.${lamp}`] = true;
      tm['LM.CW.MASTER_ALARM'] = true;
      this.bus.emit('cw:alarm', { vehicle: 'LM', lamp });
    }
  }

  trigger(name, opts = {}) {
    this.bus.emit('systems:failure', { module: 'LM', name, opts });
  }

  update(dt) {
    this.vehicle.tm['LM.MT.GET'] = this.clock.get;
    this.vehicle.tm['LM.DPS.FUEL_QTY'] = this.dpsProp / 8200;
  }

  massProps() {
    const asc = 2445 + this.apsProp + this.rcsProp;
    const des = this.staged ? 0 : 2034 + this.dpsProp;
    return { mass: asc + des, inertia: new Vector3(25000, 23000, 24000) };
  }

  propulsion(acc, dt) {
    const { cmd } = this.vehicle;
    const arm = 4 * 445 * 1.6;
    acc.torque.x += cmd.rcsRot.x * arm;
    acc.torque.y += cmd.rcsRot.y * arm;
    acc.torque.z += cmd.rcsRot.z * arm;
    acc.force.addScaledVector(cmd.rcsTrans, 2 * 445);
    if (!this.staged && cmd.dps && this.dpsProp > 0) {
      const thrust = 45040 * Math.max(0.1, Math.min(1, cmd.dpsThrottle));
      acc.force.x += thrust;
      const mdot = thrust / (311 * 9.80665);
      acc.mdot += mdot;
      this.dpsProp = Math.max(0, this.dpsProp - mdot * dt);
    }
    if (cmd.aps && this.apsProp > 0) {
      acc.force.x += 15570;
      const mdot = 15570 / (311 * 9.80665);
      acc.mdot += mdot;
      this.apsProp = Math.max(0, this.apsProp - mdot * dt);
    }
  }

  dispose() {
    this._off.forEach((f) => f());
  }
}
