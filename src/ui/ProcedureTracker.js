// Follows a procedure from the onboard checklist book (missions/common/procedures.js) live:
// evaluates items in order against switch positions (momentary pulses included), DSKY programs and
// vehicle state, highlights the next control and drives the HUD checklist panel through the same
// 'mission:checklist' events the MissionRunner uses (id prefix "proc:").

import { store } from '../core/Store.js';

export class ProcedureTracker {
  constructor(sim) {
    this.sim = sim;
    this.bus = sim.bus;
    this.proc = null;
    this.items = [];
    this.pulses = new Map();
    this._acc = 0;
    this._offs = [
      this.bus.on('switch:changed', ({ id, value }) => this.pulses.set(`${id}|${value}`, true)),
      this.bus.on('mission:checklistConfirm', ({ checklistId, itemId }) => {
        if (checklistId !== this.id) return;
        const it = this.items.find((i) => i.id === itemId);
        if (it?.manual) it.done = true;
        this.update(1, true);
      }),
      this.bus.on('mission:checklistAuto', ({ checklistId, itemId }) => {
        if (checklistId !== this.id) return;
        const it = this.items.find((i) => i.id === itemId) ?? this.items.find((i) => !i.done);
        if (it && !it.done) {
          it.auto();
          if (it.manual) it.done = true;
        }
        this.update(1, true);
      }),
      // a mission checklist takes the panel over
      this.bus.on('mission:checklist', (c) => {
        if (this.proc && !String(c.id).startsWith('proc:') && c.state === 'active') this.stop(false);
      }),
    ];
  }

  get id() {
    return this.proc ? `proc:${this.proc.id}` : null;
  }

  ctx() {
    const sim = this.sim;
    const v = sim.vehicle;
    return { sim, vehicle: v, sw: v.sw, tm: v.tm, gnc: sim.gnc, dyn: sim.dyn, csm: v.modules.csm, lm: v.modules.lm, saturn: v.modules.saturn };
  }

  start(proc) {
    this.stop(false);
    this.proc = proc;
    this.pulses.clear();
    const sw = this.sim.vehicle.sw;
    this.items = proc.items.map((it, i) => {
      const sws = it.sw ? [].concat(it.sw).filter((s) => sw.has(s.id)) : [];
      const check = it.check
        ? () => !!it.check(this.ctx())
        : sws.length
          ? () => sws.every((s) => sw.get(s.id) === s.pos || (sw.def(s.id)?.momentary?.includes(s.pos) && this.pulses.has(`${s.id}|${s.pos}`)))
          : null;
      return {
        id: `${proc.id}.${i}`,
        text: it.text,
        hint: it.hint ?? null,
        optional: !!it.optional,
        manual: !check,
        assist: !!it.do && !sws.length,
        highlight: sws.map((s) => s.id),
        done: false,
        check,
        auto: () => {
          if (it.do) return it.do(this.ctx());
          for (const s of sws) {
            const d = sw.def(s.id);
            if (d.guarded && s.pos !== d.guardSafe) sw.setGuard(s.id, true, 'crew');
            if (d.momentary?.includes(s.pos)) sw.pulse(s.id, s.pos, 0.6, 'crew');
            else sw.set(s.id, s.pos, 'crew');
          }
        },
      };
    });
    this._sig = '';
    this.update(1, true);
  }

  stop(emit = true) {
    if (!this.proc) return;
    if (emit) this.bus.emit('mission:checklist', { id: this.id, title: this.proc.title, mode: 'player', state: 'done', items: this._snapshot() });
    this.bus.emit('mission:highlight', { ids: [] });
    this.proc = null;
    this.items = [];
  }

  _snapshot() {
    return this.items.map(({ id, text, hint, optional, done, manual, assist }) => ({ id, text, hint, optional, done, manual, assist }));
  }

  /** Call every frame (real dt). */
  update(dt, force = false) {
    if (!this.proc) return;
    this._acc += dt;
    if (!force && this._acc < 0.2) return;
    this._acc = 0;
    let changed = false;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (it.done || !it.check) continue;
      if (this.items.slice(0, i).some((p) => !p.done && !p.optional)) break;
      if (it.check()) {
        it.done = true;
        changed = true;
      }
    }
    const sig = this.items.map((i) => (i.done ? 1 : 0)).join('');
    if (changed || force || sig !== this._sig) {
      this._sig = sig;
      const all = this.items.every((i) => i.done || i.optional);
      this.bus.emit('mission:checklist', { id: this.id, title: this.proc.title, mode: 'player', state: all ? 'done' : 'active', items: this._snapshot() });
      const cur = this.items.find((i) => !i.done && !i.optional) ?? this.items.find((i) => !i.done);
      const hl = store.settings.highlightControls && store.settings.difficulty !== 'realistic';
      this.bus.emit('mission:highlight', { ids: cur && hl ? cur.highlight : [] });
      if (all) {
        this.sim.game?.audio?.sfx?.('uiConfirm');
        this.proc = null;
      }
    }
  }

  dispose() {
    this.stop(false);
    this._offs.forEach((f) => f());
  }
}
