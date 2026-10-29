// Saturn V launch vehicle (S-IC, S-II, S-IVB, Instrument Unit guidance). STUB by the architect:
// nominal event times and a crude thrust model. The "physics" agent implements the real stage
// data (Apollo 11 / 13 flight evaluation reports), IU pitch program + IGM, engine-out cases and
// the S-IVB TLI restart, keeping this interface.

import { Vector3 } from 'three';

export const SATURN_EVENTS_A11 = [
  { t: -8.9, kind: 'IGNITION_SEQUENCE' },
  { t: 0, kind: 'LIFTOFF' },
  { t: 135.2, kind: 'SIC_CECO' },
  { t: 161.6, kind: 'SIC_OECO' },
  { t: 162.3, kind: 'SIC_SEP' },
  { t: 164.0, kind: 'SII_IGNITION' },
  { t: 192.3, kind: 'SII_INTERSTAGE_JETT' },
  { t: 460.6, kind: 'SII_CECO' },
  { t: 548.2, kind: 'SII_OECO' },
  { t: 549.1, kind: 'SII_SEP' },
  { t: 552.2, kind: 'SIVB_IGNITION' },
  { t: 699.3, kind: 'SIVB_CUTOFF' },
  { t: 709.3, kind: 'ORBIT_INSERTION' },
];

export class SaturnV {
  constructor({ vehicle, bus, clock, missionId = 'apollo11' }) {
    this.vehicle = vehicle;
    this.bus = bus;
    this.clock = clock;
    this.missionId = missionId;
    this.stage = 'SIC'; // 'SIC' | 'SII' | 'SIVB' | 'SPENT'
    this.events = SATURN_EVENTS_A11.map((e) => ({ ...e, done: false }));
    this.sivbProp = 105000;
    this.thrusting = false;
  }

  update(dt) {
    const t = this.clock.get;
    for (const e of this.events) {
      if (!e.done && t >= e.t) {
        e.done = true;
        if (e.kind === 'SIC_SEP') this.stage = 'SII';
        if (e.kind === 'SII_SEP') this.stage = 'SIVB';
        if (e.kind === 'SIVB_CUTOFF') this.stage = 'SIVB_COAST';
        this.vehicle.request(e.kind, { source: 'saturn' });
      }
    }
    this.thrusting = t >= 0 && this.stage !== 'SIVB_COAST' && this.stage !== 'SPENT';
  }

  /** Launch-vehicle mass only (stages, IU, SLA, LES); the CSM and LM add their own. */
  massProps() {
    const t = Math.max(0, this.clock.get);
    let mass;
    if (this.stage === 'SIC') mass = 2889000 - 13000 * t;
    else if (this.stage === 'SII') mass = 600000 - 1220 * (t - 164);
    else mass = 120000 - 220 * Math.max(0, Math.min(147, t - 552));
    return { mass: Math.max(mass, 15000), inertia: new Vector3(2e7, 6e9, 6e9) };
  }

  propulsion(acc) {
    if (!this.thrusting) return;
    const thrust = this.stage === 'SIC' ? 34e6 : this.stage === 'SII' ? 5.1e6 : 1.0e6;
    acc.force.x += thrust;
  }

  dispose() {}
}
