// Guidance, navigation & control: the Apollo Guidance Computers (CMC / LGC) with their DSKYs,
// the digital autopilots, burn programs (P30/P40/P41 CSM, P40/P42 LM), lunar descent (P63, P64
// with LPD redesignation, P66 manual rate of descent), lunar ascent (P12), entry (P61–P67),
// executive-overflow alarms (1201/1202), FDAI drive and the AI-crew autopilots.
//
// Attitude control is rate based: GNC writes vehicle.cmd.rateCmd (body rad/s) or
// vehicle.cmd.attitudeTarget (Quaternion body→ECI); physics slews the vehicle accordingly.

import { Quaternion, Vector3, Matrix4, Euler } from 'three';
import { RAD, DEG, MU_MOON, R_MOON, FT } from '../../core/constants.js';

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

const _v1 = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _q = new Quaternion();
const _m = new Matrix4();
const _e = new Euler();

/** DSKY keyboard/display state machine. */
export class DSKY {
  constructor(agc) {
    this.agc = agc;
    this.display = blankDisplay();
    this._entry = null;
    this._buf = '';
    this.monitor = null;
    this.version = 0;
    this.load = null; // pending data load (V21–V25)
  }

  _touch() {
    this.version++;
  }

  press(key) {
    const d = this.display;
    const agc = this.agc;
    agc.bus.emit('dsky:key', { agc: agc.id, key });
    if (!agc.powered) return;
    d.compActy = true;
    agc._actyT = 0.25;
    if (key === 'VERB' || key === 'NOUN') {
      this._entry = key === 'VERB' ? 'verb' : 'noun';
      this._buf = '';
      d[this._entry] = '  ';
      d.flashVN = false;
    } else if (/^[0-9]$/.test(key) && this._entry) {
      if (this._entry === 'reg') {
        if (this._buf.length < 6) this._buf += key;
        d[this._reg] = (this._buf[0] ?? '+') + this._buf.slice(1).padEnd(5, ' ');
      } else {
        if (this._buf.length < 2) this._buf += key;
        d[this._entry] = this._buf.padEnd(2, ' ');
      }
    } else if ((key === '+' || key === '-') && this._entry === 'reg' && this._buf.length === 0) {
      this._buf = key;
      d[this._reg] = `${key}     `;
    } else if (key === 'CLR') {
      if (this._entry) {
        this._buf = this._entry === 'reg' ? '' : '';
        if (this._entry === 'reg') d[this._reg] = '      ';
        else d[this._entry] = '  ';
      }
    } else if (key === 'ENTR') {
      if (this._entry === 'reg') {
        const val = Number(this._buf.replace(/\s/g, '')) || 0;
        this._entry = null;
        this.load?.(val);
      } else {
        this._entry = null;
        this._execute(d.verb.trim(), d.noun.trim());
      }
    } else if (key === 'RSET') {
      d.lights.oprErr = false;
      d.lights.prog = false;
      d.lights.restart = false;
      agc.alarmCode = 0;
    } else if (key === 'KEY REL') {
      d.lights.keyRel = false;
      if (agc._savedMonitor) {
        this.monitor = agc._savedMonitor;
        agc._savedMonitor = null;
      }
    } else if (key === 'PRO') {
      agc.bus.emit('dsky:proceed', { agc: agc.id });
      agc.onProceed();
    }
    this._touch();
  }

  release() {}

  /** Start a data load into register r1..r3; cb(value) on ENTR. */
  requestLoad(regName, cb) {
    this._entry = 'reg';
    this._reg = regName;
    this._buf = '';
    this.display[regName] = '      ';
    this.load = cb;
    this.display.flashVN = true;
    this._touch();
  }

  _execute(verb, noun) {
    const d = this.display;
    const agc = this.agc;
    d.flashVN = false;
    if (verb === '35') {
      this._lampTest = 5;
      return;
    }
    if (verb === '37') {
      // V37 E nn E — program number entered in the noun field, or prompt
      if (noun) agc.runProgram(noun.padStart(2, '0'));
      else {
        d.noun = '  ';
        this._entry = 'noun';
        this._buf = '';
        this._v37 = true;
      }
      return;
    }
    if (this._v37) {
      this._v37 = false;
      agc.runProgram(noun.padStart(2, '0'));
      return;
    }
    if (['05', '06', '16'].includes(verb) && noun) {
      this.monitor = { verb, noun: noun.padStart(2, '0') };
      return;
    }
    if (verb === '34') {
      agc.runProgram('00');
      return;
    }
    if (verb === '33') {
      agc.onProceed();
      return;
    }
    if (verb === '82') {
      this.monitor = { verb: '16', noun: '44' };
      return;
    }
    if (verb === '49' || verb === '50' || verb === '99') {
      agc.onProceed();
      return;
    }
    d.lights.oprErr = true;
  }

  update(dt) {
    const d = this.display;
    const agc = this.agc;
    if (!agc.powered) {
      const b = blankDisplay();
      if (d.prog !== b.prog || d.r1 !== b.r1) {
        Object.assign(d, b);
        this._touch();
      }
      return;
    }
    if (this._lampTest > 0) {
      this._lampTest -= dt;
      const on = this._lampTest > 0;
      for (const k of Object.keys(d.lights)) d.lights[k] = on;
      d.r1 = d.r2 = d.r3 = on ? '+88888' : '      ';
      d.prog = d.verb = d.noun = on ? '88' : agc.program;
      if (!on) d.verb = d.noun = '  ';
      d.flashVN = on;
      this._touch();
      return;
    }
    if (agc._actyT > 0) {
      agc._actyT -= dt;
      if (agc._actyT <= 0) {
        d.compActy = false;
        this._touch();
      }
    }
    if (this._entry) return;
    if (this.monitor) {
      const { verb, noun } = this.monitor;
      const vals = agc.noun(noun);
      if (vals) {
        const [a, b, c] = vals;
        const n1 = reg(a);
        const n2 = reg(b);
        const n3 = reg(c);
        if (n1 !== d.r1 || n2 !== d.r2 || n3 !== d.r3 || d.verb !== verb || d.noun !== noun) {
          d.r1 = n1;
          d.r2 = n2;
          d.r3 = n3;
          d.verb = verb;
          d.noun = noun;
          this._touch();
        }
      }
    }
  }
}

/** Apollo Guidance Computer (one per spacecraft). */
export class AGC {
  constructor({ id, vehicle, bus, clock, host }) {
    this.id = id;
    this.vehicle = vehicle;
    this.bus = bus;
    this.clock = clock;
    this.host = host;
    this.powered = true;
    this.program = '00';
    this.dsky = new DSKY(this);
    this.dsky.display.prog = '00';
    this.alarms = [];
    this.alarmCode = 0;
    this.refsmmat = new Quaternion();
    this.burn = null; // { pad, tig, dvTarget: Vector3 (ECI), vg: Vector3, armed, firing, done }
    this._actyT = 0;
  }

  runProgram(p) {
    this.program = p;
    const d = this.dsky.display;
    d.prog = p;
    this.dsky.monitor = null;
    d.flashVN = false;
    if (p === '00') {
      d.verb = d.noun = '  ';
      d.r1 = d.r2 = d.r3 = '      ';
    }
    if (p === '40' || p === '41' || p === '42') {
      if (!this.burn) {
        d.lights.oprErr = true;
      } else this.dsky.monitor = { verb: '06', noun: '40' };
    }
    if (p === '30') this.dsky.monitor = { verb: '06', noun: '33' };
    if (p === '63' || p === '64' || p === '66') {
      this.host.lmGuidance?.setPhase(p);
      this.dsky.monitor = { verb: '06', noun: p === '64' ? '64' : '63' };
    }
    if (p === '12') this.host.startAscent();
    if (['61', '62', '63E', '64E'].includes(p)) this.dsky.monitor = { verb: '16', noun: '64' };
    this.dsky._touch();
    this.bus.emit('agc:program', { agc: this.id, program: p });
  }

  /** Load an external ΔV target (P30). pad: { tig, dvECI: Vector3 m/s, name } */
  loadBurn(pad) {
    // steer: 'inertial' (external ΔV, fixed direction) or 'pro'/'retro' (along the velocity relative to
    // the primary, rotating with the orbit — long burns like LOI/TEI stay horizontal)
    this.burn = { pad, tig: pad.tig, dv: pad.dvECI.clone(), vg: pad.dvECI.clone(), dvMag: pad.dvECI.length(), steer: pad.steer ?? 'inertial', lvlh: pad.lvlh ?? null, armed: false, firing: false, done: false, gained: 0 };
    // never let time acceleration skip past the ignition: stop the clock 90 s before TIG
    if (pad.tig - 90 > this.clock.get) this.clock.addStop(pad.tig - 90);
    this.bus.emit('agc:burnLoaded', { agc: this.id, pad });
  }

  onProceed() {
    if (this.burn && this.dsky.display.verb === '99') {
      this.burn.armed = true;
      this.dsky.display.flashVN = false;
      this.dsky.monitor = { verb: '06', noun: '40' };
      this.dsky._touch();
      this.bus.emit('agc:engineEnabled', { agc: this.id });
    }
    this.bus.emit('agc:pro', { agc: this.id, program: this.program, verb: this.dsky.display.verb, noun: this.dsky.display.noun });
  }

  /** Program alarm (e.g. 1202). */
  alarm(code) {
    const d = this.dsky.display;
    this.alarms.push({ code, get: this.clock.get });
    this.alarmCode = code;
    d.lights.prog = true;
    this._savedMonitor = this.dsky.monitor;
    this.dsky.monitor = null;
    d.verb = '05';
    d.noun = '09';
    d.r1 = reg(code);
    d.r2 = '      ';
    d.r3 = '      ';
    d.flashVN = true;
    this.dsky._touch();
    this.bus.emit('agc:alarm', { agc: this.id, code });
    setTimeout?.(() => {}, 0);
  }

  /** Values for a noun display. */
  noun(n) {
    const v = this.vehicle;
    const st = v.state;
    const t = this.clock.get;
    const b = this.burn;
    switch (n) {
      case '36':
      case '65': {
        const tt = Math.abs(t);
        return [Math.floor(tt / 3600), Math.floor((tt % 3600) / 60), Math.floor(tt % 60) * 100 + Math.floor((tt * 100) % 100)];
      }
      case '20':
      case '22': {
        const [r, p, y] = this.host.gimbals(this.id === 'LGC' ? 'LM' : 'CM');
        return [r * 100, p * 100, y * 100];
      }
      case '33': {
        if (!b) return [0, 0, 0];
        const tig = Math.abs(b.tig);
        return [Math.floor(tig / 3600), Math.floor((tig % 3600) / 60), Math.floor(tig % 60) * 100];
      }
      case '40': {
        if (!b) return [0, 0, 0];
        const tfi = b.firing || b.done ? 0 : t - b.tig;
        const mm = Math.trunc(tfi / 60);
        const ss = Math.abs(Math.round(tfi % 60));
        return [mm * 1000 + Math.sign(tfi || 1) * ss * 10, b.vg.length() / FT * 10, b.gained / FT * 10];
      }
      case '42':
      case '44':
        return [st.apoAlt / 1852 * 10, st.periAlt / 1852 * 10, 0];
      case '60':
      case '62':
        return [st.speed / FT, st.hdot / FT * 10, st.alt / FT / 10];
      case '63':
        return [st.speed / FT, st.hdot / FT * 10, (st.altTerrain ?? st.alt) / FT];
      case '64': {
        const g = this.host.lmGuidance;
        if (g) return [g.lpdTime * 1000 + g.lpdAngle, st.hdot / FT * 10, (st.altTerrain ?? st.alt) / FT];
        return [0, 0, 0];
      }
      case '68':
        return [(this.host.lmGuidance?.rangeToSite() ?? 0) / 185.2, this.host.lmGuidance?.tgo ?? 0, st.alt / FT];
      case '85':
        return b ? [b.vg.x / FT * 10, b.vg.y / FT * 10, b.vg.z / FT * 10] : [0, 0, 0];
      default:
        return null;
    }
  }

  update(dt) {
    // power from the hosting vehicle's buses
    const tm = this.vehicle.tm;
    if (this.id === 'CMC') {
      const mn = Math.max(tm['CM.EPS.MNA.V'] ?? 28, tm['CM.EPS.MNB.V'] ?? 28);
      const on = mn > 20 && this.vehicle.sw.get('CM.GN.CMC_PWR') !== 'OFF';
      if (on !== this.powered) {
        this.powered = on;
        if (on) {
          this.dsky.display.lights.restart = true;
          this.runProgram('00');
        }
        this.dsky._touch();
      }
    } else {
      const lm = this.vehicle.modules.lm;
      const on = lm ? Math.max(tm['LM.EPS.CDR_BUS.V'] ?? 0, tm['LM.EPS.LMP_BUS.V'] ?? 0) > 20 : false;
      if (on !== this.powered) {
        this.powered = on;
        if (on) this.runProgram('00');
        this.dsky._touch();
      }
    }
    this._burnLogic(dt);
    this.dsky.update(dt);
  }

  _burnLogic(dt) {
    const b = this.burn;
    if (!b || b.done || !this.powered) return;
    const t = this.clock.get;
    const d = this.dsky.display;
    if (b.steer !== 'inertial') {
      // orbit-referenced steering: Vg keeps fixed components in the local frame (±v for pro/retro,
      // v/r/h mix for LVLH burns); magnitude = what is left of the ΔV
      const st = this.vehicle.state;
      const vr = st.vRel;
      if (vr.lengthSq() > 1) {
        const left = Math.max(0, b.dvMag - b.gained);
        if (b.steer === 'lvlh' && b.lvlh) {
          const ev = _v2.copy(vr).normalize();
          const eh = _v3.crossVectors(st.rRel, vr).normalize();
          const er = new Vector3().crossVectors(ev, eh).negate().normalize();
          b.vg.copy(ev).multiplyScalar(b.lvlh.v).addScaledVector(er, b.lvlh.r).addScaledVector(eh, b.lvlh.h).normalize().multiplyScalar(left);
        } else b.vg.copy(vr).normalize().multiplyScalar((b.steer === 'retro' ? -1 : 1) * left);
        if (!b.firing) b.dv.copy(b.vg);
      }
    }
    const burnProg = this.program === '40' || this.program === '41' || this.program === '42';
    if (!burnProg) return;
    // V99 at TIG−5 s requests engine enable
    if (!b.armed && t >= b.tig - 5 && d.verb !== '99') {
      this.dsky.monitor = null;
      d.verb = '99';
      d.noun = '40';
      d.flashVN = true;
      this.dsky._touch();
      this.bus.emit('agc:v99', { agc: this.id });
    }
    if (b.armed && t >= b.tig && !b.firing) {
      b.firing = true;
      this.bus.emit('agc:ignition', { agc: this.id });
    }
    if (b.firing || b.armed) {
      // Average-G: velocity-to-be-gained bookkeeping from sensed acceleration (body → ECI), running
      // from engine enable (so the RCS ullage counts too)
      const st = this.vehicle.state;
      _v1.copy(st.accel).applyQuaternion(st.q).multiplyScalar(dt);
      if (b.steer === 'inertial') b.vg.sub(_v1);
      b.gained += _v1.length();
      const finished = b.steer === 'inertial' ? b.vg.dot(b.dv) <= 0 || b.vg.length() < 0.02 : b.gained >= b.dvMag - 0.05;
      if (finished) {
        b.firing = false;
        b.done = true;
        this.bus.emit('agc:cutoff', { agc: this.id, residual: b.vg.length() });
        this.dsky.monitor = { verb: '16', noun: '85' };
      }
    }
  }
}

/** Lunar descent guidance (P63 braking, P64 approach with LPD, P66 rate of descent). */
class LMDescentGuidance {
  constructor(host) {
    this.host = host;
    this.phase = null;
    this.site = null; // { local: Vector3 (moon-fixed unit dir), r: Vector3 (ECI, updated) }
    this.tgo = 0;
    this.lpdTime = 0;
    this.lpdAngle = 0;
    this.rodCmd = 0;
  }

  setSite(dirMoonFixed) {
    this.site = { local: dirMoonFixed.clone().normalize(), r: new Vector3(), v: new Vector3() };
  }

  setPhase(p) {
    this.phase = p;
    if (p === '66') this.rodCmd = this.host.vehicle.state.hdot;
    this.host.bus.emit('lm:phase', { phase: p });
  }

  _sitePos() {
    const dyn = this.host.dyn;
    const s = this.site;
    const ang = dyn.moonAngle ?? 0;
    const c = Math.cos(ang);
    const sn = Math.sin(ang);
    const l = s.local;
    s.r.set(l.x * c - l.y * sn, l.x * sn + l.y * c, l.z).multiplyScalar(R_MOON).add(dyn.moonPos);
    s.v.copy(dyn.moonVel);
    return s.r;
  }

  rangeToSite() {
    if (!this.site) return 0;
    return this._sitePos().distanceTo(this.host.vehicle.state.r);
  }

  /** Move the target `meters` downrange along the current ground track (late PDI lands long). */
  shiftSiteDownrange(meters) {
    if (!this.site || !meters) return;
    const host = this.host;
    const st = host.vehicle.state;
    const moonPos = host.dyn.moonPos;
    const siteR = this._sitePos().clone().sub(moonPos);
    const h = new Vector3().crossVectors(st.rRel, st.vSurface).normalize();
    const p = siteR.applyAxisAngle(h, meters / R_MOON).normalize();
    const ang = host.dyn.moonAngle ?? 0;
    const c = Math.cos(-ang);
    const sn = Math.sin(-ang);
    this.site.local.set(p.x * c - p.y * sn, p.x * sn + p.y * c, p.z).normalize();
  }

  /** Shift the target by LPD clicks (az right +, el long +). */
  redesignate(az, el) {
    if (!this.site || (!az && !el)) return;
    const st = this.host.vehicle.state;
    const up = _v1.copy(this._sitePos()).sub(this.host.dyn.moonPos).normalize();
    const fwd = _v2.copy(st.vSurface).addScaledVector(up, -st.vSurface.dot(up)).normalize();
    const right = _v3.crossVectors(fwd, up).normalize();
    const step = Math.max(30, (st.altTerrain ?? st.alt) * 0.045);
    const p = this.site.r.clone().addScaledVector(right, az * step).addScaledVector(fwd, el * step).sub(this.host.dyn.moonPos).normalize();
    // back to moon-fixed
    const ang = this.host.dyn.moonAngle ?? 0;
    const c = Math.cos(-ang);
    const sn = Math.sin(-ang);
    this.site.local.set(p.x * c - p.y * sn, p.x * sn + p.y * c, p.z).normalize();
    this.host.bus.emit('lm:redesignate', { az, el });
  }

  /** Returns desired thrust acceleration (ECI) and window reference. */
  command(dt) {
    const host = this.host;
    const v = host.vehicle;
    const st = v.state;
    const moonPos = host.dyn.moonPos;
    const rRel = _v1.copy(st.r).sub(moonPos);
    const up = rRel.clone().normalize();
    const g = MU_MOON / rRel.lengthSq();
    const site = this._sitePos();
    const h = st.altTerrain ?? st.alt;
    const out = { acc: new Vector3(), windowsUp: this.phase === '63' };
    if (this.phase === '66') {
      // ROD: each click ±1 ft/s on the commanded descent rate; horizontal via attitude (crew)
      const clicks = v.controls.rodClicks;
      v.controls.rodClicks = 0;
      this.rodCmd += clicks * FT;
      if (host.autopilot.mode === 'LANDING') this.rodCmd = -Math.min(Math.max(0.6, h / 14), 6);
      const aVert = g + 1.2 * (this.rodCmd - st.hdot);
      out.acc.copy(up).multiplyScalar(Math.max(0.3, aVert));
      // horizontal: AI nulls velocity toward the (redesignated) site; human uses the ACA
      const vh = st.vSurface.clone().addScaledVector(up, -st.vSurface.dot(up));
      if (host.autopilot.mode === 'LANDING') {
        const toSite = site.clone().sub(st.r);
        toSite.addScaledVector(up, -toSite.dot(up));
        // creep toward the (redesignated) site, then stop: no horizontal speed in the last metres
        const want = toSite.multiplyScalar(0.12);
        const cap = Math.max(0, Math.min(4, (h - 4) * 0.12));
        if (want.length() > cap) want.setLength(cap);
        const aMax = (0.925 * 45040) / Math.max(1000, st.mass);
        const aV = out.acc.dot(up);
        const aH = want.sub(vh).multiplyScalar(0.7);
        const aHmax = Math.sqrt(Math.max(0, aMax * aMax - aV * aV));
        if (aH.length() > aHmax) aH.setLength(aHmax);
        out.acc.add(aH);
      } else out.manualTilt = true;
      return out;
    }
    // target-referenced guidance toward the gate for the current phase
    const tNow = host.clock.get;
    const gate = this.phase === '63' ? this.highGate : this.lowGate;
    const toSite = site.clone().sub(moonPos).normalize();
    const downrange = st.vSurface.clone().addScaledVector(up, -st.vSurface.dot(up)).normalize();
    let rT;
    let vT;
    let tgo;
    if (this.phase === '63') {
      tgo = Math.max(8, this.t0 + 507 - tNow);
      rT = site.clone().addScaledVector(toSite, 7000 * FT).addScaledVector(downrange, -26000 * FT);
      vT = downrange.clone().multiplyScalar(500 * FT).addScaledVector(toSite, -140 * FT);
      if (tgo <= 8.5 || h < 7200 * FT) {
        this.setPhase('64');
        host.cmc;
        host.lgc.runProgram('64');
      }
    } else {
      // P64 approach (≈105 s from the high gate on Apollo 11): quadratic guidance to the low gate,
      // 150 ft above the (redesignatable) site, arriving almost stopped; vertical-priority allocation
      if (!this.t64) {
        this.t64 = tNow;
        this.fwd64 = st.vSurface.clone().addScaledVector(up, -st.vSurface.dot(up)).normalize();
      }
      tgo = Math.max(5, this.t64 + 105 - tNow);
      const siteUp = site.clone().sub(moonPos).normalize();
      const rT = site.clone().addScaledVector(siteUp, 46).addScaledVector(this.fwd64, -12);
      const vT = siteUp.clone().multiplyScalar(-1.5).addScaledVector(this.fwd64, 1.0);
      const aCmd = rT.sub(st.r).addScaledVector(st.vSurface, -tgo).multiplyScalar(6 / (tgo * tgo)).addScaledVector(vT.sub(st.vSurface), -2 / tgo).addScaledVector(up, g);
      const aMax = (0.925 * 45040) / Math.max(1000, st.mass);
      const aV = Math.min(aMax * 0.97, Math.max(0.2, aCmd.dot(up)));
      const aH = aCmd.addScaledVector(up, -aCmd.dot(up));
      const aHmax = Math.sqrt(Math.max(0, aMax * aMax - aV * aV));
      if (aH.length() > aHmax) aH.setLength(aHmax);
      out.acc.copy(aH).addScaledVector(up, aV);
      // a click on the ROD switch hands over to P66 (manual rate of descent), like the real LM
      if (v.controls.rodClicks && host.autopilot.mode !== 'LANDING') {
        this.setPhase('66');
        host.lgc.runProgram('66');
      }
      if (h < 150 * FT && (host.autopilot.mode === 'LANDING' || v.sw.get('LM.GNC.MODE_CONTROL_PGNS') === 'AUTO')) {
        this.setPhase('66');
        host.lgc.runProgram('66');
      }
      // LPD display: time remaining in P64 and look angle to the site
      const los = site.clone().sub(st.r);
      const ang = Math.acos(Math.max(-1, Math.min(1, los.clone().normalize().dot(up.clone().negate())))) * RAD;
      this.lpdAngle = Math.round(Math.max(0, Math.min(80, 90 - (90 - ang))));
      this.lpdTime = Math.max(0, Math.round(tgo - 6));
      const c = v.controls;
      if (c.lpdAz || c.lpdEl) {
        this.redesignate(c.lpdAz, c.lpdEl);
        c.lpdAz = 0;
        c.lpdEl = 0;
      }
      this.tgo = tgo;
      return out;
    }
    this.tgo = tgo;
    const r = st.r;
    const vRel = st.vSurface;
    const a = rT.clone().sub(r).addScaledVector(vRel, -tgo).multiplyScalar(6 / (tgo * tgo)).addScaledVector(vT.clone().sub(vRel), -2 / tgo);
    out.acc.copy(a).addScaledVector(up, g);
    return out;
  }
}

export class GNCHost {
  constructor({ vehicle, bus, clock, dyn }) {
    this.vehicle = vehicle;
    this.bus = bus;
    this.clock = clock;
    this.dyn = dyn;
    this.cmc = new AGC({ id: 'CMC', vehicle, bus, clock, host: this });
    this.lgc = new AGC({ id: 'LGC', vehicle, bus, clock, host: this });
    this.lgc.powered = false;
    this.ags = null;
    this.lmGuidance = new LMDescentGuidance(this);
    this.alarmPlan = [];
    this.ascent = null;
    this.entry = null;
    this.autopilot = {
      mode: null,
      opts: null,
      set: (mode, opts = {}) => {
        this.autopilot.mode = mode;
        this.autopilot.opts = opts;
        this.bus.emit('gnc:autopilot', { mode });
      },
      clear: () => {
        this.autopilot.mode = null;
        this.bus.emit('gnc:autopilot', { mode: null });
      },
    };
    vehicle.cmd.rateCmd = new Vector3();
    vehicle.cmd.attitudeTarget = null;
    this._offs = [bus.on('systems:failure', (e) => this._onFailure(e))];
  }

  get activeComputer() {
    return this.vehicle.station === 'LM' ? this.lgc : this.cmc;
  }

  configure(opts = {}) {
    if (opts.alarms) this.alarmPlan = opts.alarms.map((a) => ({ ...a, done: false }));
  }

  _onFailure({ name }) {
    if (name === 'LIGHTNING_STRIKE') {
      this.imuFailed = true;
    }
  }

  /** Begin powered descent (P63) at the current time toward a moon-fixed site direction. */
  startDescent(siteDirMoonFixed) {
    this.lmGuidance.setSite(siteDirMoonFixed);
    this.lmGuidance.t0 = this.clock.get;
    this.lmGuidance.t64 = 0;
    this.lgc.runProgram('63');
  }

  startAscent() {
    // the pitch program clock starts at liftoff (staging), not when P12 is keyed
    this.ascent = { t0: null };
  }

  /** IMU gimbal angles (deg) for the station's FDAI: outer=roll, inner=pitch, middle=yaw. */
  gimbals(station = this.vehicle.station) {
    const q = _q.copy(this.cmc.refsmmat).invert().multiply(this.vehicle.state.q);
    _e.setFromQuaternion(q, 'XZY');
    return [(_e.x * RAD + 360) % 360, (_e.z * RAD + 360) % 360, (_e.y * RAD + 360) % 360];
  }

  /** Point body +X along dir (ECI) with a reference for the body Z axis. */
  static attitudeFor(dir, zRef, out = new Quaternion()) {
    const x = _v1.copy(dir).normalize();
    const z = _v2.copy(zRef).addScaledVector(x, -zRef.dot(x));
    if (z.lengthSq() < 1e-8) z.set(0, 0, 1).addScaledVector(x, -x.z);
    z.normalize();
    const y = _v3.crossVectors(z, x);
    _m.makeBasis(x, y, z);
    return out.setFromRotationMatrix(_m);
  }

  update(dt) {
    const v = this.vehicle;
    const st = v.state;
    const cmd = v.cmd;
    this.cmc.update(dt);
    this.lgc.update(dt);
    const ap = this.autopilot.mode;
    const maxRate = 2.5 * DEG;
    // ---- manual rate command from the hand controller (CMC/SCS rate command, LM ACA)
    cmd.rateCmd.set(v.controls.rhc.x, v.controls.rhc.y, v.controls.rhc.z).multiplyScalar(maxRate * (v.station === 'LM' ? 1.6 : 1));
    cmd.attitudeTarget = null;
    cmd.rcsTrans.copy(v.controls.thc);
    cmd.rcsRot.copy(cmd.rateCmd).multiplyScalar(1 / maxRate);
    const comp = this.activeComputer;
    // ---- burns: auto maneuver to the burn attitude when CMC MODE AUTO / LM PGNS AUTO or AI crew
    const b = comp.burn;
    const autoAtt = ap === 'BURN' || ap === 'ATT_MANEUVER' || (v.station === 'CM' ? v.sw.get('CM.GNC.CMC_MODE') === 'AUTO' : v.sw.get('LM.GNC.MODE_CONTROL_PGNS') === 'AUTO');
    if (b && !b.done && ['40', '41', '42'].includes(comp.program) && autoAtt && v.controls.rhc.lengthSq() < 0.01) {
      const zRef = _v1.copy(st.rRel).normalize().negate();
      cmd.attitudeTarget = GNCHost.attitudeFor(b.vg.lengthSq() > 0.01 ? b.vg : b.dv, zRef, new Quaternion());
    }
    if (ap === 'BURN' && b && !b.armed && this.clock.get >= b.tig - 5) comp.onProceed();
    // limit time warp around a loaded burn: ×10 for the attitude maneuver and the burn itself, real
    // time from TIG−30 s until ignition so a person can answer V99 with PRO before TIG (a late
    // ignition of a long orbit-referenced burn like TEI misses the entry corridor)
    const tNow = this.clock.get;
    const nearBurn = b && !b.done && tNow > b.tig - 600 && tNow < b.tig + (b.pad.burnTime ?? 60) + 60;
    const burnLimit = !nearBurn ? 0 : !b.firing && tNow > b.tig - 30 ? 1 : 10;
    if (burnLimit !== this._burnLimit) {
      this._burnLimit = burnLimit;
      if (burnLimit) this.clock.setLimit('burn', burnLimit);
      else this.clock.clearLimit('burn');
    }
    if (ap === 'ATT_MANEUVER' && this.autopilot.opts?.dir) cmd.attitudeTarget = GNCHost.attitudeFor(this.autopilot.opts.dir, this.autopilot.opts.zRef ?? st.rRel.clone().negate(), new Quaternion());
    const firing = !!(b && b.firing);
    cmd.sps = v.station === 'CM' && firing;
    const lmFire = v.station === 'LM' && firing;
    // (only before ignition: after cutoff `armed` stays set and the +X jets would push forever)
    cmd.ullage = !!(b && b.armed && !b.firing && !b.done && this.clock.get > b.tig - 8 && b.dvMag > 3);
    cmd.burnArmed = !!(b && (b.armed || this.clock.get > b.tig - 30) && !b.done);
    if (cmd.ullage) cmd.rcsTrans.x = 1;

    // ---- LM powered descent / ascent
    const g = this.lmGuidance;
    cmd.dps = lmFire && comp.program !== '42';
    const apsBurn = lmFire && comp.program === '42';
    // P40 DPS burns: 10 % for the first seconds (trim the gimbal through the c.g.), then the PAD throttle
    if (cmd.dps && !g.phase && b) {
      const tb = this.clock.get - b.tig;
      cmd.dpsThrottle = tb < 5 ? 0.1 : b.pad.throttle ?? (b.dvMag > 60 ? 0.925 : 0.4);
    }
    if (v.station === 'LM' && g.phase && !st.landed) {
      const out = g.command(dt);
      const m = st.mass;
      const maxThrust = 45040;
      let acc = out.acc;
      if (out.manualTilt) {
        // P66 manual: crew tilts with the ACA; throttle holds the commanded descent rate
        const tiltQ = st.q;
        const thrustDir = _v1.set(1, 0, 0).applyQuaternion(tiltQ);
        const up = _v2.copy(st.rRel).normalize();
        const need = acc.dot(up) / Math.max(0.3, thrustDir.dot(up));
        cmd.dpsThrottle = Math.max(0.1, Math.min(0.925, (need * m) / maxThrust));
        cmd.dps = true;
      } else {
        // throttle for the component along the engine's actual axis (no full thrust while slewing)
        const axis = _v3.set(1, 0, 0).applyQuaternion(st.q);
        const along = g.phase === '63' ? acc.length() : Math.max(acc.dot(axis), acc.dot(_v2.copy(st.rRel).normalize()) / Math.max(0.3, axis.dot(_v2)) * 0.5);
        const T = along * m;
        cmd.dpsThrottle = Math.max(0.1, Math.min(0.925, T / maxThrust));
        const windows = out.windowsUp ? _v2.copy(st.rRel).normalize() : _v2.copy(g._sitePos()).sub(st.r).normalize();
        // LM: thrust along +X, windows along +Z
        cmd.attitudeTarget = GNCHost.attitudeFor(acc, windows, new Quaternion());
        cmd.dps = true;
      }
      if (v.sw.get('LM.ENG.STOP_CDR') === 'PUSHED' || v.sw.get('LM.ENG.STOP_LMP') === 'PUSHED') cmd.dps = false;
      if (v.sw.get('LM.GNC.THR_CONT') === 'MAN' && !ap) cmd.dpsThrottle = Math.max(0.1, v.controls.ttca * 0.925);
      this._alarms();
    }
    if (st.landed && g.phase) {
      g.phase = null;
      cmd.dps = false;
    }
    // ---- lunar ascent P12: 10 s vertical rise, then explicit guidance to the insertion point
    //      (60,000 ft, +32 ft/s up, 5,535 ft/s horizontal → 9 × 45 nmi), westward in the plane of
    //      the CSM's orbit (the Moon's orbital plane through the site)
    cmd.aps = apsBurn;
    if (this.ascent && v.station === 'LM' && this.ascent.t0 === null && v.config === 'LM_ASC') this.ascent.t0 = this.clock.get;
    if (this.ascent && v.station === 'LM' && this.ascent.t0 !== null && !this.ascent.done) {
      const tt = this.clock.get - this.ascent.t0;
      const rr = st.rRel.length();
      const up = _v1.copy(st.rRel).normalize();
      if (!this.ascent.dir) {
        const hM = new Vector3().crossVectors(this.dyn.moonPos, this.dyn.moonVel).normalize();
        this.ascent.dir = new Vector3().crossVectors(hM, up).normalize().negate();
      }
      const fwd = _v2.copy(this.ascent.dir).addScaledVector(up, -this.ascent.dir.dot(up)).normalize();
      const vh = st.vRel.dot(fwd);
      const vhT = 1687;
      const aT = 15570 / Math.max(1500, st.mass);
      if (vh >= vhT && tt > 12) {
        this.ascent.done = true;
        this.bus.emit('gnc:insertion', { agc: 'LGC' });
      } else {
        cmd.aps = true;
        let dir;
        if (tt < 10) dir = up.clone();
        else {
          const g = MU_MOON / (rr * rr);
          const geff = g - (vh * vh) / rr;
          const tgo = Math.max(8, (vhT - vh) / aT);
          const hT = 18300;
          const hdotT = 9.8;
          let av = (6 * (hT - st.alt - st.hdot * tgo)) / (tgo * tgo) - (2 * (hdotT - st.hdot)) / tgo + geff;
          av = Math.max(-0.2 * aT, Math.min(0.85 * aT, av));
          const ah = Math.sqrt(Math.max(0, aT * aT - av * av));
          dir = up.clone().multiplyScalar(av).addScaledVector(fwd, ah).normalize();
        }
        cmd.attitudeTarget = GNCHost.attitudeFor(dir, fwd, new Quaternion());
      }
    }
    // ---- entry (bank-angle) — AI or CMC P64-P67 holds lift vector up until g peaks, then modulates
    if (st.primary === 'EARTH' && st.alt < 130000 && v.config === 'CM') {
      const bankCmd = ap === 'ENTRY' || v.sw.get('CM.GNC.SC_CONT') === 'CMC' ? (st.gLoad > 5.5 ? 0 : st.hdot > 30 ? Math.PI * 0.6 : Math.PI * 0.25) : null;
      if (bankCmd !== null) cmd.entryBank = bankCmd;
      else cmd.entryBank = (cmd.entryBank ?? 0) + v.controls.rhc.x * 0.6 * dt;
    }
    // ---- AI docking autopilot
    if (ap === 'DOCKING') this._dockingAuto();
    this._fdai();
  }

  _alarms() {
    const t = this.clock.get;
    for (const a of this.alarmPlan) {
      if (!a.done && t >= a.get) {
        a.done = true;
        this.lgc.alarm(a.code);
      }
    }
  }

  _dockingAuto() {
    const tel = this.dyn.dockingTelemetry?.(this.autopilot.opts?.targetId);
    const cmd = this.vehicle.cmd;
    if (!tel) return;
    // align attitude with the target axis, then translate along it
    cmd.attitudeTarget = tel.alignQ ?? null;
    const lat = tel.lateral;
    const closing = -tel.rangeRate;
    const want = tel.range > 15 ? 0.6 : tel.range > 3 ? 0.25 : 0.1;
    // turn first (nose to the target's drogue), translate only once aligned
    if (tel.misalign > 10) {
      cmd.rcsTrans.set(0, 0, 0);
      return;
    }
    // lateral = target port − own port (body frame): thrust toward it, damping the relative drift
    cmd.rcsTrans.set(Math.max(-1, Math.min(1, (want - closing) * 3)), Math.max(-1, Math.min(1, lat.y * 0.8 + tel.latRate.y * 4)), Math.max(-1, Math.min(1, lat.z * 0.8 + tel.latRate.z * 4)));
  }

  _fdai() {
    const v = this.vehicle;
    const [r, p, y] = this.gimbals();
    const w = v.state.w;
    const tm = v.tm;
    // error needles: the autopilot's target, or a crew reference attitude (manual burns)
    const err = v.cmd.attitudeTarget ?? v.cmd.fdaiTarget ?? null;
    let er = 0;
    let ep = 0;
    let ey = 0;
    if (err) {
      _q.copy(v.state.q).invert().multiply(err);
      _e.setFromQuaternion(_q, 'XYZ');
      er = Math.max(-1, Math.min(1, (_e.x * RAD) / 15));
      ep = Math.max(-1, Math.min(1, (_e.y * RAD) / 15));
      ey = Math.max(-1, Math.min(1, (_e.z * RAD) / 15));
    }
    const sc = 5 * DEG;
    for (const pre of ['CM.FDAI1', 'CM.FDAI2', 'LM.FDAI1', 'LM.FDAI2']) {
      tm[`${pre}.ROLL`] = r;
      tm[`${pre}.PITCH`] = p;
      tm[`${pre}.YAW`] = y;
      tm[`${pre}.RATE_ROLL`] = Math.max(-1, Math.min(1, w.x / sc));
      tm[`${pre}.RATE_PITCH`] = Math.max(-1, Math.min(1, w.y / sc));
      tm[`${pre}.RATE_YAW`] = Math.max(-1, Math.min(1, w.z / sc));
      tm[`${pre}.ERR_ROLL`] = er;
      tm[`${pre}.ERR_PITCH`] = ep;
      tm[`${pre}.ERR_YAW`] = ey;
    }
    tm['CM.GNC.IMU.MGA'] = y > 180 ? y - 360 : y;
    const gl = Math.abs(tm['CM.GNC.IMU.MGA']) > 70;
    if (this.cmc.dsky.display.lights.gimbalLock !== gl) {
      this.cmc.dsky.display.lights.gimbalLock = gl;
      this.cmc.dsky._touch();
    }
    // LM landing displays
    const st = v.state;
    if (st.primary === 'MOON') {
      const h = st.altTerrain ?? st.alt;
      tm['LM.GNC.ALT_FT'] = h / FT;
      tm['LM.GNC.ALTRATE_FPS'] = st.hdot / FT;
      const up = _v1.copy(st.rRel).normalize();
      const vh = _v2.copy(st.vSurface).addScaledVector(up, -st.vSurface.dot(up));
      const fwd = _v3.set(0, 0, 1).applyQuaternion(st.q);
      tm['LM.GNC.XPTR_FWD_FPS'] = vh.dot(fwd) / FT;
      tm['LM.GNC.XPTR_LAT_FPS'] = vh.dot(_v3.set(0, 1, 0).applyQuaternion(st.q)) / FT;
      tm['LM.GNC.CONTACT_LIGHT'] = h < 1.73 + 0.3 && !st.landed ? true : st.landed;
      const lights = this.lgc.dsky.display.lights;
      const altLt = h > 39000 * FT;
      if (lights.alt !== altLt || lights.vel !== altLt) {
        lights.alt = altLt;
        lights.vel = altLt;
        this.lgc.dsky._touch();
      }
    }
  }

  dispose() {
    this._offs.forEach((f) => f());
  }
}
