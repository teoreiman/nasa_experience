// Registry and state of every crew-operable control (switches, circuit breakers, rotaries,
// pushbuttons, thumbwheels, handles) of a vehicle and of the MOCR consoles.
//
// Panels (widgets) only read/write switch positions here; systems read positions and react.
// Momentary actions (spring-loaded switches, pushbuttons) MUST be handled edge-driven through the
// 'switch:changed' bus event, because at high time warp a short pulse can fall between two steps.
//
// Definition:
//   { id: 'CM.EPS.FC1_REAC', type: 'toggle'|'rotary'|'cb'|'button'|'thumbwheel'|'handle',
//     positions: ['OPEN','CENTER','CLOSE'],   // top→bottom for toggles, CCW→CW for rotaries
//     default: 'CENTER',
//     momentary: ['OPEN','CLOSE'], rest: 'CENTER',   // positions that spring back to `rest`
//     guarded: true, guardSafe: 'OFF',              // guard closed ⇒ forced to/held at guardSafe
//     label: 'FC 1 REAC', panel: 'CM_P3', group: 'EPS',
//     desc: 'Válvulas de reactivos de la pila de combustible 1',   // Spanish tooltip
//     talkback: 'CM.EPS.FC1_REAC_TB' }                              // optional related telemetry key
//
// Event: bus.emit('switch:changed', { id, value, prev, source })
//   source: 'user' (player), 'crew' (AI crew), 'script' (mission script), 'system' (spring return,
//   failures), 'restore'.

export class SwitchBoard {
  constructor(bus) {
    this.bus = bus;
    this.defs = new Map();
    this.values = new Map();
    this.guards = new Map(); // id -> open?
    this.stuck = new Set();
    this.broken = new Set();
    this._pulses = []; // { id, rest, remaining }
  }

  define(def) {
    if (!def?.id || !Array.isArray(def.positions) || def.positions.length === 0) {
      throw new Error(`Invalid switch definition: ${JSON.stringify(def)}`);
    }
    const d = {
      type: 'toggle',
      momentary: null,
      rest: null,
      guarded: false,
      guardSafe: null,
      label: def.id,
      panel: null,
      group: null,
      desc: '',
      ...def,
    };
    if (d.default === undefined) d.default = d.rest ?? d.positions[0];
    if (d.momentary && !d.rest) d.rest = d.default;
    if (d.guarded && !d.guardSafe) d.guardSafe = d.default;
    if (!d.positions.includes(d.default)) throw new Error(`Switch ${d.id}: default "${d.default}" not in positions`);
    this.defs.set(d.id, d);
    this.values.set(d.id, d.default);
    if (d.guarded) this.guards.set(d.id, d.guardDefault === 'open');
    return d;
  }

  defineAll(defs) {
    for (const d of defs) this.define(d);
  }

  has(id) {
    return this.defs.has(id);
  }

  def(id) {
    return this.defs.get(id);
  }

  ids(prefix = '') {
    return [...this.defs.keys()].filter((k) => k.startsWith(prefix));
  }

  get(id) {
    return this.values.get(id);
  }

  is(id, pos) {
    return this.values.get(id) === pos;
  }

  index(id) {
    const d = this.defs.get(id);
    return d ? d.positions.indexOf(this.values.get(id)) : -1;
  }

  /** @returns {boolean} whether the switch is now in `pos` */
  set(id, pos, source = 'user') {
    const d = this.defs.get(id);
    if (!d) {
      if (!this._warned?.has(id)) {
        (this._warned ??= new Set()).add(id);
        console.warn(`[switchboard] unknown switch ${id}`);
      }
      return false;
    }
    if (!d.positions.includes(pos)) return false;
    const prev = this.values.get(id);
    if (prev === pos) return true;
    if (source !== 'system' && source !== 'restore') {
      if (this.stuck.has(id)) return false;
      if (d.guarded && !this.guards.get(id) && pos !== d.guardSafe) return false;
      if (this.broken.has(id) && d.type === 'cb' && pos === 'IN' && source === 'user') return false;
    }
    this.values.set(id, pos);
    this.bus?.emit('switch:changed', { id, value: pos, prev, source });
    return true;
  }

  /** Move one detent: dir -1 = up / counter-clockwise, +1 = down / clockwise. */
  step(id, dir, source = 'user') {
    const d = this.defs.get(id);
    if (!d) return false;
    const i = d.positions.indexOf(this.values.get(id));
    const j = Math.max(0, Math.min(d.positions.length - 1, i + dir));
    if (j === i) return false;
    return this.set(id, d.positions[j], source);
  }

  /** Momentary actuation held for `holdS` simulated seconds (used by AI crew and scripts). */
  pulse(id, pos, holdS = 0.5, source = 'crew') {
    const d = this.defs.get(id);
    if (!d) return false;
    const ok = this.set(id, pos, source);
    if (ok) this._pulses.push({ id, rest: d.rest ?? d.default, remaining: holdS });
    return ok;
  }

  /** Spring-loaded return for a momentary control the user released. */
  release(id) {
    const d = this.defs.get(id);
    if (!d?.momentary) return;
    const cur = this.values.get(id);
    if (d.momentary.includes(cur)) this.set(id, d.rest, 'system');
  }

  isGuardOpen(id) {
    return !!this.guards.get(id);
  }

  setGuard(id, open, source = 'user') {
    const d = this.defs.get(id);
    if (!d?.guarded) return false;
    if (this.guards.get(id) === open) return true;
    this.guards.set(id, open);
    this.bus?.emit('switch:guard', { id, open, source });
    if (!open && this.values.get(id) !== d.guardSafe) this.set(id, d.guardSafe, 'system');
    return true;
  }

  setStuck(id, stuck = true) {
    if (stuck) this.stuck.add(id);
    else this.stuck.delete(id);
  }

  /** Broken circuit breaker: the user cannot push it IN by hand (see Apollo 11 ENG ARM breaker). */
  setBroken(id, broken = true) {
    if (broken) this.broken.add(id);
    else this.broken.delete(id);
    this.bus?.emit('switch:broken', { id, broken });
  }

  isBroken(id) {
    return this.broken.has(id);
  }

  update(dt) {
    if (!this._pulses.length) return;
    for (let i = this._pulses.length - 1; i >= 0; i--) {
      const p = this._pulses[i];
      p.remaining -= dt;
      if (p.remaining <= 0) {
        this._pulses.splice(i, 1);
        this.set(p.id, p.rest, 'system');
      }
    }
  }

  snapshot() {
    return { values: Object.fromEntries(this.values), guards: Object.fromEntries(this.guards) };
  }

  restore(snap, source = 'restore') {
    if (!snap) return;
    for (const [id, v] of Object.entries(snap.values ?? snap)) if (this.defs.has(id)) this.set(id, v, source);
    if (snap.guards) for (const [id, open] of Object.entries(snap.guards)) if (this.guards.has(id)) this.guards.set(id, open);
  }

  /** Apply many positions at once: { 'CM.EPS.X': 'ON', ... } (used by presets). */
  apply(map, source = 'script') {
    for (const [id, pos] of Object.entries(map)) {
      const d = this.defs.get(id);
      if (d?.guarded && pos !== d.guardSafe) this.guards.set(id, true);
      this.set(id, pos, source === 'user' ? 'script' : source);
    }
  }
}
