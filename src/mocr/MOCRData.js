// Live data model behind every Mission Control screen: telemetry access with LOS / blackout /
// SCE-garble rules, the air-to-ground and MOCR loop logs, vehicle events, alarms, GO/NO-GO polls,
// pending ground tasks per console, the sub-spacecraft point and its track, the MSFN station in
// view and the crew's biomedical numbers. One instance per MOCRView; consoles, wall screens and
// NPCs read from it. Updated every frame (cheap: no allocations unless something changed).

import { DEG, R_EARTH, R_MOON, NMI, FT } from '../core/constants.js';
import { MissionClock } from '../core/MissionClock.js';
import { gmst } from '../sim/physics/ephemeris.js';

const RAD = 180 / Math.PI;

/** Manned Space Flight Network (1969): the stations a 1969 NETWORK controller would list. */
export const MSFN = [
  { id: 'MIL', name: 'MERRITT IS', lat: 28.5, lon: -80.7, deep: false },
  { id: 'BDA', name: 'BERMUDA', lat: 32.35, lon: -64.66, deep: false },
  { id: 'CYI', name: 'CANARIAS', lat: 27.74, lon: -15.6, deep: false },
  { id: 'MAD', name: 'MADRID', lat: 40.43, lon: -4.25, deep: true },
  { id: 'ACN', name: 'ASCENSION', lat: -7.95, lon: -14.33, deep: false },
  { id: 'CRO', name: 'CARNARVON', lat: -24.9, lon: 113.72, deep: false },
  { id: 'HSK', name: 'HONEYSUCKLE', lat: -35.58, lon: 148.98, deep: true },
  { id: 'GWM', name: 'GUAM', lat: 13.31, lon: 144.73, deep: false },
  { id: 'HAW', name: 'HAWAII', lat: 22.13, lon: -159.67, deep: false },
  { id: 'GDS', name: 'GOLDSTONE', lat: 35.34, lon: -116.87, deep: true },
  { id: 'TEX', name: 'CORPUS CHRISTI', lat: 27.65, lon: -97.38, deep: false },
  { id: 'GYM', name: 'GUAYMAS', lat: 27.96, lon: -110.72, deep: false },
];

export const CONSOLE_NAMES = {
  BOOSTER: 'Booster Systems Engineer',
  RETRO: 'Retrofire Officer',
  FIDO: 'Flight Dynamics Officer',
  GUIDO: 'Guidance Officer',
  SURGEON: 'Flight Surgeon',
  CAPCOM: 'Capsule Communicator',
  EECOM: 'Electrical, Environmental & Comm',
  GNC: 'Guidance, Navigation & Control',
  TELMU: 'LM Environmental & Electrical',
  CONTROL: 'LM Guidance & Propulsion',
  INCO: 'Instrumentation & Communications',
  PROCEDURES: 'Organization & Procedures',
  AFD: 'Assistant Flight Director',
  FLIGHT: 'Flight Director',
  FAO: 'Flight Activities Officer',
  NETWORK: 'Network Controller',
  PAO: 'Public Affairs Officer',
  DOD: 'Department of Defense',
  MISSION_DIRECTOR: 'Mission Director',
};

const PHASE_ES = {
  PAD: 'EN LA PLATAFORMA',
  ASCENT: 'ASCENSO',
  EARTH_ORBIT: 'ÓRBITA TERRESTRE',
  TLC: 'CRUCERO TRANSLUNAR',
  LUNAR_ORBIT: 'ÓRBITA LUNAR',
  DESCENT: 'DESCENSO MOTORIZADO',
  SURFACE: 'EN LA SUPERFICIE',
  TEC: 'CRUCERO TRANSTERRESTRE',
  ENTRY: 'REENTRADA',
  SPLASHED: 'AMERIZAJE',
};

export class MOCRData {
  constructor(sim, { mission, chapter, playerConsole }) {
    this.sim = sim;
    this.mission = mission;
    this.chapter = chapter;
    this.playerConsole = playerConsole;
    this.v = sim.vehicle;
    this.tm = sim.vehicle.tm;
    this.st = sim.vehicle.state;
    this.clock = sim.clock;
    this.agLog = []; // { get, who, label, es, en, channel }
    this.loopLog = [];
    this.events = []; // { get, text, level }
    this.objectives = new Map(); // id → { text, state }
    this.alarms = []; // { get, text }
    this.poll = null;
    this.pollLights = new Map(); // console → 'GO' | 'NOGO' (cleared a while after the poll)
    this.tasks = new Map(); // console → ground task payload
    this.speaking = null; // { who, until }
    this.track = []; // [lat, lon] deg, Earth-fixed, newest last
    this.moonTrack = [];
    this.lunarPath = []; // [x, y] in the Earth–Moon rotating plot frame (units of Earth–Moon distance)
    this.lat = 0;
    this.lon = 0;
    this.mlat = 0;
    this.mlon = 0;
    this.version = 0; // bumped when logs change (screens redraw)
    this.hr = { CDR: 72, CMP: 70, LMP: 74 };
    this.resp = { CDR: 14, CMP: 13, LMP: 15 };
    this._trackAcc = 1e9;
    this._lastTrackGet = -1e9;
    this._hrStress = 0;
    this.time = 0;
    const bus = sim.bus;
    this._off = [
      bus.on('mission:say', (l) => this._say(l)),
      bus.on('vehicle:event', (e) => this._event(e)),
      bus.on('cw:alarm', ({ vehicle, lamp }) => this._alarm(`${vehicle} MASTER ALARM · ${lamp.replace(/_/g, ' ')}`)),
      bus.on('agc:alarm', ({ agc, code }) => this._alarm(`${agc ?? 'AGC'} PROG ALARM ${code}`)),
      bus.on('mission:objective', (o) => {
        this.objectives.set(o.id, { text: o.text, state: o.state });
        if (o.state === 'done') this._log(`OK ${o.text}`, 'info');
        this.version++;
      }),
      bus.on('mission:poll', (p) => {
        this.poll = p;
        for (const c of p.consoles) if (c.answer) this.pollLights.set(c.console, c.answer);
        if (p.state === 'done') this._pollClear = this.clock.get + 40;
        this.version++;
      }),
      bus.on('mission:groundTask', (t) => {
        this.tasks.set(t.console, t);
        this.version++;
      }),
      bus.on('mission:groundTaskEnd', ({ id }) => {
        for (const [c, t] of this.tasks) if (t.id === id) this.tasks.delete(c);
        this.version++;
      }),
      bus.on('mission:crewAction', ({ text }) => this._log(`CREW: ${text}`, 'crew')),
      bus.on('systems:failure', (f) => this._alarm(`FAILURE ${f?.name ?? ''}`)),
    ];
  }

  get get() {
    return this.clock.get;
  }

  /** In flight (chapters that start mid-mission have no liftoff event). */
  get flying() {
    return !!this.st.liftoff || (!!this.sim.dyn?.mode && this.sim.dyn.mode !== 'PAD') || this.get > 0;
  }

  /** No telemetry (behind the Moon, entry blackout). */
  get los() {
    return !!(this.st.losEarth || this.st.inBlackout);
  }

  /** Telemetry quality 0..1 (Apollo 12 SCE garble, Apollo 13 data loss). */
  get quality() {
    const q = this.tm['CM.TLM.QUALITY'];
    return typeof q === 'number' ? q : 1;
  }

  get phase() {
    const st = this.st;
    const mode = this.sim.dyn?.mode;
    if (mode === 'PAD' || (!st.liftoff && this.get < 0)) return 'PAD';
    if (mode === 'SPLASHED' || st.splashed) return 'SPLASHED';
    if (mode === 'ENTRY') return 'ENTRY';
    if (mode === 'LANDED' || st.landed) return 'SURFACE';
    if (st.primary === 'MOON') {
      if (this.v.config.startsWith('LM') && (this.tm['LM.DPS.FIRING'] || st.alt < 20000)) return 'DESCENT';
      if (st.alt < 500e3) return 'LUNAR_ORBIT';
      // inside the Moon's sphere of influence: approaching (translunar) or leaving (transearth)
      return st.rRel.dot(st.vRel) < 0 ? 'TLC' : 'TEC';
    }
    if (this.v.hasSaturn && !this.sim.saturn?.done.has('ORBIT_INSERTION') && this.get < 1200) return 'ASCENT';
    if (st.alt < 2000e3) return 'EARTH_ORBIT';
    // cislunar: outbound until the Moon has been passed
    const toMoon = this.sim.dyn?.moonPos ? this.st.r.distanceTo(this.sim.dyn.moonPos) : Infinity;
    const vr = this.st.r.dot(this.st.v);
    return vr >= 0 || toMoon < 3e7 ? 'TLC' : 'TEC';
  }

  get phaseEs() {
    return PHASE_ES[this.phase] ?? '';
  }

  _say(l) {
    const row = { get: this.get, who: l.who, label: l.whoLabel ?? l.who, es: l.es ?? l.en ?? '', en: l.en ?? l.es ?? '', channel: l.channel };
    if (l.channel === 'loop') this.loopLog.push(row);
    else this.agLog.push(row);
    if (this.agLog.length > 60) this.agLog.shift();
    if (this.loopLog.length > 60) this.loopLog.shift();
    this.speaking = { who: l.who, until: this.time + (l.durationS ?? 3) };
    this.version++;
  }

  _log(text, level = 'info') {
    this.events.push({ get: this.get, text, level });
    if (this.events.length > 50) this.events.shift();
    this.version++;
  }

  _alarm(text) {
    this.alarms.push({ get: this.get, text });
    if (this.alarms.length > 30) this.alarms.shift();
    this._log(text, 'alarm');
    this._hrStress = Math.min(1, this._hrStress + 0.5);
  }

  _event(e) {
    const names = {
      LIFTOFF: 'LIFTOFF', TOWER_CLEAR: 'TOWER CLEAR', SIC_CECO: 'S-IC CENTER ENGINE CUTOFF', SIC_OECO: 'S-IC OUTBOARD CUTOFF',
      SIC_SEP: 'S-IC/S-II STAGING', SII_IGNITION: 'S-II IGNITION', SII_INTERSTAGE_JETT: 'INTERSTAGE JETTISON', LES_JETT: 'LES JETTISON',
      SII_CECO: 'S-II CENTER ENGINE CUTOFF', SII_SEP: 'S-II/S-IVB STAGING', SIVB_IGNITION: 'S-IVB IGNITION', SIVB_CUTOFF: 'S-IVB CUTOFF',
      ORBIT_INSERTION: 'ORBIT INSERTION', TLI_IGNITION: 'TLI IGNITION', TLI_CUTOFF: 'TLI CUTOFF', CSM_SEP: 'CSM/S-IVB SEP',
      DOCK_CAPTURE: 'DOCKING CAPTURE', DOCK_HARD: 'HARD DOCK', LM_EXTRACT: 'LM EXTRACTION', UNDOCK: 'UNDOCKING',
      TOUCHDOWN: 'LUNAR TOUCHDOWN', LM_ASC_LIFTOFF: 'LM ASCENT LIFTOFF', DOCK_LM_ASC: 'LM DOCKING', LM_JETT: 'LM JETTISON',
      CM_SM_SEP: 'CM/SM SEPARATION', ENTRY_INTERFACE: 'ENTRY INTERFACE', BLACKOUT_START: 'BLACKOUT', BLACKOUT_END: 'BLACKOUT END',
      DROGUE_DEPLOY: 'DROGUE CHUTES', MAIN_DEPLOY: 'MAIN CHUTES', SPLASHDOWN: 'SPLASHDOWN', O2_TANK2_EXPLOSION: 'MAIN B UNDERVOLT / O2 TK 2',
      LIGHTNING_STRIKE: 'LIGHTNING STRIKE · FC DISCONNECT',
    };
    const n = names[e.kind];
    if (!n) return;
    const warn = e.kind === 'O2_TANK2_EXPLOSION' || e.kind === 'LIGHTNING_STRIKE' || (e.kind === 'TOUCHDOWN' && e.crash);
    this._log(n, warn ? 'alarm' : 'event');
    if (warn) this._hrStress = 1;
    if (e.kind === 'LIFTOFF' || e.kind === 'TOUCHDOWN' || e.kind === 'ENTRY_INTERFACE') this._hrStress = Math.max(this._hrStress, 0.8);
  }

  /** Telemetry value, or NaN when the key is missing. */
  t(k) {
    const v = this.tm[k];
    return typeof v === 'number' ? v : v === true ? 1 : v === false ? 0 : NaN;
  }

  b(k) {
    return !!this.tm[k];
  }

  update(dt) {
    this.time += dt;
    const st = this.st;
    const utc = this.clock.utcMs;
    // ---- sub-spacecraft point
    if (st.primary === 'EARTH' || !this.sim.dyn?.moonPos) {
      const r = st.r;
      const rl = r.length() || 1;
      this.lat = Math.asin(Math.max(-1, Math.min(1, r.z / rl))) * RAD;
      let lon = (Math.atan2(r.y, r.x) - gmst(utc)) * RAD;
      lon = ((lon + 540) % 360) - 180;
      this.lon = lon;
    }
    if (st.primary === 'MOON' && this.sim.dyn?.eciToMoonFixed) {
      const d = this.sim.dyn.eciToMoonFixed(st.rRel.clone().normalize());
      this.mlat = Math.asin(Math.max(-1, Math.min(1, d.z))) * RAD;
      this.mlon = Math.atan2(d.y, d.x) * RAD;
    }
    // ---- track history (every ~30 s of mission time, or per frame when moving fast)
    const g = this.get;
    if (Math.abs(g - this._lastTrackGet) >= 20) {
      this._lastTrackGet = g;
      if (st.primary === 'EARTH' && st.alt < 3000e3) {
        this.track.push([this.lat, this.lon]);
        if (this.track.length > 600) this.track.shift();
      }
      if (st.primary === 'MOON' && st.alt < 600e3) {
        this.moonTrack.push([this.mlat, this.mlon]);
        if (this.moonTrack.length > 600) this.moonTrack.shift();
      }
    }
    // Earth–Moon rotating frame point (Earth at origin, Moon on +x at distance 1)
    const mp = this.sim.dyn?.moonPos;
    if (mp && mp.lengthSq() > 1) {
      const D = mp.length();
      const ux = mp.x / D;
      const uy = mp.y / D;
      const uz = mp.z / D;
      const r = st.primary === 'EARTH' ? st.r : st.r;
      const x = (r.x * ux + r.y * uy + r.z * uz) / D;
      // in-plane perpendicular: component of r orthogonal to the Earth–Moon line, signed by the
      // Moon's orbital direction (h × u)
      const mv = this.sim.dyn.moonVel;
      let py = 0;
      if (mv) {
        const hx = mp.y * mv.z - mp.z * mv.y;
        const hy = mp.z * mv.x - mp.x * mv.z;
        const hz = mp.x * mv.y - mp.y * mv.x;
        const wx = hy * uz - hz * uy;
        const wy = hz * ux - hx * uz;
        const wz = hx * uy - hy * ux;
        const wl = Math.hypot(wx, wy, wz) || 1;
        py = (r.x * wx + r.y * wy + r.z * wz) / wl / D;
      }
      this.emX = x;
      this.emY = py;
      const last = this.lunarPath[this.lunarPath.length - 1];
      if (!last || Math.hypot(last[0] - x, last[1] - py) > 0.004) {
        this.lunarPath.push([x, py]);
        if (this.lunarPath.length > 1500) this.lunarPath.shift();
      }
    }
    // ---- poll lights fade some time after the poll
    if (this._pollClear && g > this._pollClear) {
      this._pollClear = 0;
      this.pollLights.clear();
      this.poll = null;
      this.version++;
    }
    // ---- biomed: heart rates follow g-load, alarms and phase
    const gl = st.gLoad || 0;
    this._hrStress = Math.max(0, this._hrStress - dt * 0.01);
    const ph = this.phase;
    const phaseHR = ph === 'ASCENT' ? 25 : ph === 'DESCENT' ? 38 : ph === 'ENTRY' ? 30 : ph === 'PAD' ? 18 : 0;
    const k = Math.min(1, dt * 0.25);
    const base = { CDR: 68, CMP: 66, LMP: 72 };
    for (const c of ['CDR', 'CMP', 'LMP']) {
      const target = base[c] + phaseHR * (c === 'CDR' ? 1.2 : 0.9) + gl * 6 + this._hrStress * 40;
      this.hr[c] += (target - this.hr[c]) * k;
      this.resp[c] += (12 + (this.hr[c] - 60) * 0.12 - this.resp[c]) * k;
    }
  }

  /** The MSFN station with the best elevation toward the spacecraft (and its elevation, deg). */
  stationInView() {
    const st = this.st;
    const utc = this.clock.utcMs;
    const th0 = gmst(utc);
    const r = st.primary === 'EARTH' ? st.r : st.r;
    const rl = r.length() || 1;
    let best = null;
    let bestEl = -90;
    const far = rl > 4 * R_EARTH;
    for (const s of MSFN) {
      if (far && !s.deep) continue;
      const la = s.lat * DEG;
      const lo = s.lon * DEG + th0;
      const sx = Math.cos(la) * Math.cos(lo);
      const sy = Math.cos(la) * Math.sin(lo);
      const sz = Math.sin(la);
      const dx = r.x - sx * R_EARTH;
      const dy = r.y - sy * R_EARTH;
      const dz = r.z - sz * R_EARTH;
      const dl = Math.hypot(dx, dy, dz) || 1;
      const el = Math.asin((dx * sx + dy * sy + dz * sz) / dl) * RAD;
      if (el > bestEl) {
        bestEl = el;
        best = s;
      }
    }
    return { station: best, el: bestEl, aos: bestEl > (far ? 0 : 2) && !st.losEarth };
  }

  fmtGET(s = this.get) {
    return s < 0 ? MissionClock.formatT(s) : MissionClock.format(s);
  }

  /** Short GET hhh:mm:ss for logs. */
  fmtShort(s) {
    const neg = s < 0;
    s = Math.abs(Math.floor(s));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    return `${neg ? '-' : ''}${String(h).padStart(3, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }

  get altNmi() {
    return this.st.alt / NMI;
  }

  get altFt() {
    return this.st.alt / FT;
  }

  get velFps() {
    return this.st.speed / FT;
  }

  get earthDistNmi() {
    return (this.st.primary === 'EARTH' ? this.st.r.length() : this.st.r.length()) / NMI;
  }

  get moonDistNmi() {
    const mp = this.sim.dyn?.moonPos;
    if (!mp) return NaN;
    return (this.st.r.distanceTo(mp) - R_MOON) / NMI;
  }

  dispose() {
    this._off.forEach((f) => f());
  }
}
