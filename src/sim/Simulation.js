// Simulation core for one chapter: clock, vehicle, hardware modules, GNC, dynamics and the
// substep loop. View-independent (used by both the astronaut FlightView and the controller MOCRView).
//
// Substep order (each substep h ≤ maxSubstep):
//   switches.update → gnc.update → saturn/csm/lm.update → dynamics.step → clock.tick → runner.tick

import { EventBus } from '../core/EventBus.js';
import { MissionClock } from '../core/MissionClock.js';
import { MISSION_EPOCH } from '../core/constants.js';
import { Vehicle } from './Vehicle.js';
import { CONFIGS } from './geometry.js';
import { FlightDynamics } from './physics/FlightDynamics.js';
import { SaturnV } from './physics/SaturnV.js';
import { CSMSystems } from './csm/CSMSystems.js';
import { LMSystems } from './lm/LMSystems.js';
import { GNCHost } from './gnc/GNCHost.js';

const MAX_SUBSTEPS_PER_FRAME = 4000;

export class Simulation {
  /** @param {{ chapter: object, missionId: string, role: 'astronaut'|'controller', difficulty?: string }} opts */
  constructor({ chapter, missionId, role, difficulty = 'astronaut' }) {
    this.chapter = chapter;
    this.missionId = missionId;
    this.role = role;
    this.difficulty = difficulty;
    this.bus = new EventBus();
    const setup = chapter.setup ?? {};
    this.setup = setup;
    this.clock = new MissionClock({ get: setup.get ?? 0, epochUTC: MISSION_EPOCH[missionId] ?? MISSION_EPOCH.apollo11 });
    this.clock.onWarpChange = (w) => this.bus.emit('clock:warp', { warp: w });
    this.vehicle = new Vehicle({ bus: this.bus, clock: this.clock, config: setup.config ?? 'CSM' });
    this.runner = null; // set by PlayScene
    this.time = 0; // real seconds since start
    this.frameSubsteps = 0;
  }

  async init() {
    const { vehicle: v, bus, clock, setup } = this;
    const mods = CONFIGS[v.config].modules;
    if (setup.parts) Object.assign(v.parts, setup.parts);
    v.station = setup.station ?? (mods.some((m) => m === 'LM' || m === 'LM_ASC') ? 'LM' : 'CM');

    const wantsCSM = setup.csm !== null && (setup.csm !== undefined || mods.some((m) => m.startsWith('CSM') || m === 'CM' || m === 'SM'));
    const wantsLM = setup.lm !== null && (setup.lm !== undefined || mods.some((m) => m.startsWith('LM')));
    const wantsSaturn = mods.some((m) => m === 'SIC' || m === 'SII' || m === 'SIVB');

    if (wantsSaturn) v.modules.saturn = new SaturnV({ vehicle: v, bus, clock, missionId: this.missionId, setup });
    if (wantsCSM) {
      v.modules.csm = new CSMSystems({ vehicle: v, bus, clock, missionId: this.missionId });
      v.modules.csm.reset(setup.csm ?? 'TLC');
    }
    if (wantsLM) {
      v.modules.lm = new LMSystems({ vehicle: v, bus, clock, missionId: this.missionId });
      v.modules.lm.reset(setup.lm ?? 'STOWED');
    }
    this.dyn = new FlightDynamics({ vehicle: v, bus, clock, missionId: this.missionId });
    await this.dyn.init(setup);
    this.gnc = new GNCHost({ vehicle: v, bus, clock, dyn: this.dyn, missionId: this.missionId });
    if (setup.gnc) this.gnc.configure?.(setup.gnc);
    for (const b of setup.bodies ?? []) this.dyn.addBody(typeof b === 'function' ? b(this) : b);
    if (setup.maxWarp) clock.setLimit('chapter', setup.maxWarp);
    bus.emit('sim:ready', { sim: this });
  }

  get csm() {
    return this.vehicle.modules.csm;
  }

  get lm() {
    return this.vehicle.modules.lm;
  }

  get saturn() {
    return this.vehicle.modules.saturn;
  }

  maxSubstep() {
    return Math.min(this.dyn.maxStep(), 10);
  }

  /** Advance the simulation by one real frame. */
  step(realDt) {
    this.time += realDt;
    const { clock, vehicle: v } = this;
    clock.setLimit('dynamics', this.dyn.maxWarp());
    let remaining = clock.advance(realDt);
    let n = 0;
    while (remaining > 1e-9 && n < MAX_SUBSTEPS_PER_FRAME) {
      const h = Math.min(remaining, this.maxSubstep());
      v.sw.update(h);
      this.gnc.update(h);
      const m = v.modules;
      m.saturn?.update(h);
      m.csm?.update(h);
      m.lm?.update(h);
      this.dyn.step(h);
      clock.tick(h);
      this.runner?.tick(h);
      remaining -= h;
      n++;
    }
    this.frameSubsteps = n;
  }

  dispose() {
    const m = this.vehicle.modules;
    m.saturn?.dispose?.();
    m.csm?.dispose?.();
    m.lm?.dispose?.();
    this.gnc?.dispose?.();
    this.dyn?.dispose?.();
    this.bus.clear();
  }
}
