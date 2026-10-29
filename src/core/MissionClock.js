// Mission clock: Ground Elapsed Time (GET, seconds from liftoff; negative during the countdown),
// time acceleration with named limits, and "stops" that a frame must not overshoot (used by
// MissionRunner.waitGET so scripted events happen at the exact second even at 10000x).

export const WARP_LEVELS = [1, 2, 5, 10, 25, 50, 100, 250, 1000, 2500, 10000];

export class MissionClock {
  constructor({ get = 0, epochUTC = 0 } = {}) {
    this.get = get;
    this.epochUTC = epochUTC;
    this.warp = 1;
    this.paused = false;
    this._limits = new Map();
    this._stops = [];
    this.onWarpChange = null; // optional callback(warp)
  }

  /** UTC timestamp (ms) for the current GET. */
  get utcMs() {
    return this.epochUTC + this.get * 1000;
  }

  utcAt(get) {
    return this.epochUTC + get * 1000;
  }

  setLimit(name, maxWarp) {
    this._limits.set(name, maxWarp);
    this._notify();
  }

  clearLimit(name) {
    this._limits.delete(name);
    this._notify();
  }

  get maxWarp() {
    let m = WARP_LEVELS[WARP_LEVELS.length - 1];
    for (const v of this._limits.values()) m = Math.min(m, v);
    return m;
  }

  get effectiveWarp() {
    return Math.min(this.warp, this.maxWarp);
  }

  setWarp(w) {
    const max = this.maxWarp;
    let best = 1;
    for (const lvl of WARP_LEVELS) if (lvl <= w && lvl <= max) best = lvl;
    if (best !== this.warp) {
      this.warp = best;
      this._notify();
    }
    return this.warp;
  }

  warpUp() {
    const i = WARP_LEVELS.indexOf(this.effectiveWarp);
    return this.setWarp(WARP_LEVELS[Math.min(WARP_LEVELS.length - 1, i + 1)]);
  }

  warpDown() {
    const i = WARP_LEVELS.indexOf(this.effectiveWarp);
    return this.setWarp(WARP_LEVELS[Math.max(0, i - 1)]);
  }

  /** Drop to real time (e.g. master alarm, important call). */
  dropWarp() {
    if (this.warp !== 1) {
      this.warp = 1;
      this._notify();
    }
  }

  addStop(t) {
    this._stops.push(t);
    this._stops.sort((a, b) => a - b);
  }

  removeStop(t) {
    const i = this._stops.indexOf(t);
    if (i >= 0) this._stops.splice(i, 1);
  }

  /** Simulated seconds to run this frame (does not advance GET; the Simulation advances it per substep). */
  advance(realDt) {
    if (this.paused) return 0;
    let dt = realDt * this.effectiveWarp;
    while (this._stops.length && this._stops[0] <= this.get) this._stops.shift();
    if (this._stops.length) dt = Math.min(dt, this._stops[0] - this.get);
    return Math.max(0, dt);
  }

  tick(h) {
    this.get += h;
  }

  _notify() {
    if (this.onWarpChange) this.onWarpChange(this.effectiveWarp);
  }

  /** "055:54:53" or "-000:15:00". */
  static format(t, { tenths = false } = {}) {
    const neg = t < 0;
    let s = Math.abs(t);
    const hh = Math.floor(s / 3600);
    s -= hh * 3600;
    const mm = Math.floor(s / 60);
    s -= mm * 60;
    const ss = tenths ? s.toFixed(1).padStart(4, '0') : String(Math.floor(s)).padStart(2, '0');
    return `${neg ? '-' : ''}${String(hh).padStart(3, '0')}:${String(mm).padStart(2, '0')}:${ss}`;
  }

  /** Countdown style "T-00:15:00" / "T+00:02:41". */
  static formatT(t) {
    const sign = t < 0 ? '-' : '+';
    let s = Math.abs(t);
    const hh = Math.floor(s / 3600);
    s -= hh * 3600;
    const mm = Math.floor(s / 60);
    const ss = Math.floor(s - mm * 60);
    return `T${sign}${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }

  /** Parse "055:54:53" → seconds. */
  static parse(str) {
    const neg = str.trim().startsWith('-');
    const parts = str.replace('-', '').split(':').map(Number);
    let s = 0;
    for (const p of parts) s = s * 60 + p;
    return neg ? -s : s;
  }
}

/** Shorthand used in mission scripts: GET(55, 54, 53) → 201293 s. */
export const GET = (h, m = 0, s = 0) => h * 3600 + m * 60 + s;
