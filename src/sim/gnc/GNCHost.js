// Guidance, navigation & control host: Apollo Guidance Computers (CMC "Colossus", LGC "Luminary")
// with their DSKYs, digital autopilots, CSM SCS, LM AGS/DEDA, IMU model, FDAI drive and the
// AI-crew autopilots used in controller mode. STUB by the architect with the final interface
// (docs/ARCHITECTURE.md §8). The "gnc" agent replaces internals and keeps the interface.

import { Euler, Quaternion, Vector3 } from 'three';
import { RAD } from '../../core/constants.js';

export const DSKY_KEYS = ['VERB', 'NOUN', '+', '-', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'CLR', 'PRO', 'KEY REL', 'ENTR', 'RSET'];

const blankDisplay = () => ({
  prog: '  ',
  verb: '  ',
  noun: '  ',
  r1: '      ',
  r2: '      ',
  r3: '      ',
  flashVN: false,
  compActy: false,
  lights: { uplinkActy: false, noAtt: false, stby: false, keyRel: false, oprErr: false, temp: false, gimbalLock: false, prog: false, restart: false, tracker: false, alt: false, vel: false },
});

const reg = (n) => {
  if (n === null || n === undefined || Number.isNaN(n)) return '      ';
  const s = n < 0 ? '-' : '+';
  return s + String(Math.min(99999, Math.round(Math.abs(n)))).padStart(5, '0');
};

/** DSKY keyboard/display state machine (minimal verb/noun entry). */
export class DSKY {
  constructor(agc) {
    this.agc = agc;
    this.display = blankDisplay();
    this._entry = null; // 'verb' | 'noun' | null
    this._buf = '';
    this.monitor = null; // { verb, noun } periodic display
    this.version = 0; // increments on every display change (widgets use it as a redraw signature)
  }

  _touch() {
    this.version++;
  }

  press(key) {
    const d = this.display;
    this.agc.bus.emit('dsky:key', { agc: this.agc.id, key });
    if (key === 'VERB' || key === 'NOUN') {
      this._entry = key === 'VERB' ? 'verb' : 'noun';
      this._buf = '';
      d[this._entry] = '  ';
    } else if (/^[0-9]$/.test(key) && this._entry) {
      if (this._buf.length < 2) this._buf += key;
      d[this._entry] = this._buf.padEnd(2, ' ');
    } else if (key === 'CLR') {
      if (this._entry) {
        this._buf = '';
        d[this._entry] = '  ';
      }
    } else if (key === 'ENTR') {
      this._entry = null;
      this._execute(d.verb.trim(), d.noun.trim());
    } else if (key === 'RSET') {
      d.lights.oprErr = false;
      d.lights.prog = false;
      d.lights.restart = false;
    } else if (key === 'KEY REL') {
      d.lights.keyRel = false;
    } else if (key === 'PRO') {
      this.agc.bus.emit('dsky:proceed', { agc: this.agc.id });
    }
    this._touch();
  }

  release() {}

  _execute(verb, noun) {
    const d = this.display;
    if (verb === '35') {
      // lamp test
      this._lampTest = 5;
      return;
    }
    if (verb === '37') {
      // program change: V37 E nn E (stub takes the noun field)
      if (noun) this.agc.runProgram(noun.padStart(2, '0'));
      return;
    }
    if (verb === '16' || verb === '06') {
      this.monitor = { verb, noun };
      return;
    }
    d.lights.oprErr = true;
  }

  update(dt) {
    const d = this.display;
    if (this._lampTest > 0) {
      this._lampTest -= dt;
      for (const k of Object.keys(d.lights)) d.lights[k] = this._lampTest > 0;
      d.r1 = d.r2 = d.r3 = this._lampTest > 0 ? '+88888' : '      ';
      d.prog = d.verb = d.noun = this._lampTest > 0 ? '88' : '  ';
      d.flashVN = this._lampTest > 0;
      this._touch();
      return;
    }
    if (this.monitor) {
      const { noun } = this.monitor;
      const st = this.agc.vehicle.state;
      if (noun === '36') {
        const t = Math.max(0, this.agc.clock.get);
        d.r1 = reg(Math.floor(t / 3600));
        d.r2 = reg(Math.floor((t % 3600) / 60));
        d.r3 = reg(Math.floor(t % 60) * 100);
      } else if (noun === '20') {
        const e = new Euler().setFromQuaternion(st.q, 'XZY');
        d.r1 = reg(((e.x * RAD + 360) % 360) * 100);
        d.r2 = reg(((e.y * RAD + 360) % 360) * 100);
        d.r3 = reg(((e.z * RAD + 360) % 360) * 100);
      } else if (noun === '62') {
        d.r1 = reg(st.speed / 0.3048);
        d.r2 = reg(st.hdot / 0.3048);
        d.r3 = reg(st.alt / 0.3048 / 10);
      }
      d.verb = this.monitor.verb;
      d.noun = noun.padStart(2, '0');
      this._touch();
    }
  }
}

export class AGC {
  constructor({ id, vehicle, bus, clock }) {
    this.id = id; // 'CMC' | 'LGC'
    this.vehicle = vehicle;
    this.bus = bus;
    this.clock = clock;
    this.powered = true;
    this.program = '00';
    this.dsky = new DSKY(this);
    this.dsky.display.prog = '00';
    this.alarms = [];
    this.refsmmat = new Quaternion(); // stable-member orientation (ECI → SM)
  }

  runProgram(p) {
    this.program = p;
    this.dsky.display.prog = p;
    this.dsky._touch();
    this.bus.emit('agc:program', { agc: this.id, program: p });
  }

  /** Program alarm (e.g. 1202): lights PROG, shows V05 N09 codes, emits 'agc:alarm'. */
  alarm(code) {
    const d = this.dsky.display;
    this.alarms.push({ code, get: this.clock.get });
    d.lights.prog = true;
    d.verb = '05';
    d.noun = '09';
    d.r1 = '+0' + String(code).padStart(4, '0');
    d.flashVN = true;
    this.dsky._touch();
    this.bus.emit('agc:alarm', { agc: this.id, code });
  }

  update(dt) {
    this.dsky.update(dt);
  }
}

const _e = new Euler();
const _qr = new Quaternion();

export class GNCHost {
  constructor({ vehicle, bus, clock, dyn }) {
    this.vehicle = vehicle;
    this.bus = bus;
    this.clock = clock;
    this.dyn = dyn;
    this.cmc = new AGC({ id: 'CMC', vehicle, bus, clock });
    this.lgc = new AGC({ id: 'LGC', vehicle, bus, clock });
    this.lgc.powered = false;
    this.ags = null;
    this.autopilot = {
      mode: null,
      opts: null,
      set: (mode, opts = {}) => {
        this.autopilot.mode = mode;
        this.autopilot.opts = opts;
      },
      clear: () => {
        this.autopilot.mode = null;
      },
    };
  }

  /** The AGC driving the station the crew occupies. */
  get activeComputer() {
    return this.vehicle.station === 'LM' ? this.lgc : this.cmc;
  }

  update(dt) {
    const v = this.vehicle;
    this.cmc.update(dt);
    if (this.lgc.powered) this.lgc.update(dt);
    // Rate-command DAP (stub): RHC commands a rate, otherwise damp rates.
    const maxRate = 2 * (Math.PI / 180);
    const w = v.state.w;
    const rhc = v.controls.rhc;
    const k = 4;
    v.cmd.rcsRot.set(
      Math.max(-1, Math.min(1, (rhc.x * maxRate - w.x) * k * 10)),
      Math.max(-1, Math.min(1, (rhc.y * maxRate - w.y) * k * 10)),
      Math.max(-1, Math.min(1, (rhc.z * maxRate - w.z) * k * 10)),
    );
    for (let i = 0; i < 3; i++) if (Math.abs(v.cmd.rcsRot.getComponent(i)) < 0.05) v.cmd.rcsRot.setComponent(i, 0);
    v.cmd.rcsTrans.copy(v.controls.thc);
    // FDAI drive (stub: inertial attitude Euler angles)
    _qr.copy(this.cmc.refsmmat).invert().multiply(v.state.q);
    _e.setFromQuaternion(_qr, 'XZY');
    const prefix = v.station === 'LM' ? 'LM' : 'CM';
    for (const n of [1, 2]) {
      const tm = v.tm;
      tm[`${prefix}.FDAI${n}.ROLL`] = (_e.x * RAD + 360) % 360;
      tm[`${prefix}.FDAI${n}.PITCH`] = (_e.z * RAD + 360) % 360;
      tm[`${prefix}.FDAI${n}.YAW`] = (_e.y * RAD + 360) % 360;
      tm[`${prefix}.FDAI${n}.RATE_ROLL`] = Math.max(-1, Math.min(1, w.x / (5 * Math.PI / 180)));
      tm[`${prefix}.FDAI${n}.RATE_PITCH`] = Math.max(-1, Math.min(1, w.y / (5 * Math.PI / 180)));
      tm[`${prefix}.FDAI${n}.RATE_YAW`] = Math.max(-1, Math.min(1, w.z / (5 * Math.PI / 180)));
      tm[`${prefix}.FDAI${n}.ERR_ROLL`] = 0;
      tm[`${prefix}.FDAI${n}.ERR_PITCH`] = 0;
      tm[`${prefix}.FDAI${n}.ERR_YAW`] = 0;
    }
  }

  dispose() {}
}
