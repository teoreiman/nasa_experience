// Mission script runtime. A chapter's `async run(ctx)` drives the mission with the role-aware
// primitives below. Every chapter is written once and plays in both roles:
//   - ctx.crew(checklist)  astronaut: the player flips the switches | controller: AI crew does it
//   - ctx.ground(task)     controller: the player decides at a MOCR console | astronaut: AI Houston
//   - ctx.poll(...)        Flight Director GO/NO-GO poll (player answers for their console)
//   - ctx.say(...)         radio / intercom / MOCR loop lines with audibility rules per role
// All waits reject with MissionAbort when the chapter ends; scripts must not swallow it.
//
// HUD/MOCR/views communicate through sim.bus events documented in docs/ARCHITECTURE.md §11.

import { store } from '../core/Store.js';

export class MissionAbort extends Error {
  constructor(reason = 'abort') {
    super(`mission-abort:${reason}`);
    this.name = 'MissionAbort';
  }
}

/** Speaker metadata. channel: default audio channel. ground: located in Houston/KSC. */
export const SPEAKERS = {
  CAPCOM: { label: 'CAPCOM', ground: true, channel: 'ag' },
  CDR: { label: 'Comandante', ground: false, channel: 'ag' },
  CMP: { label: 'Piloto del CM', ground: false, channel: 'ag' },
  LMP: { label: 'Piloto del LM', ground: false, channel: 'ag' },
  FLIGHT: { label: 'FLIGHT', ground: true, channel: 'loop' },
  EECOM: { label: 'EECOM', ground: true, channel: 'loop' },
  GNC: { label: 'GNC', ground: true, channel: 'loop' },
  GUIDO: { label: 'GUIDO', ground: true, channel: 'loop' },
  FIDO: { label: 'FIDO', ground: true, channel: 'loop' },
  RETRO: { label: 'RETRO', ground: true, channel: 'loop' },
  BOOSTER: { label: 'BOOSTER', ground: true, channel: 'loop' },
  TELMU: { label: 'TELMU', ground: true, channel: 'loop' },
  CONTROL: { label: 'CONTROL', ground: true, channel: 'loop' },
  INCO: { label: 'INCO', ground: true, channel: 'loop' },
  SURGEON: { label: 'SURGEON', ground: true, channel: 'loop' },
  NETWORK: { label: 'NETWORK', ground: true, channel: 'loop' },
  FAO: { label: 'FAO', ground: true, channel: 'loop' },
  PROCEDURES: { label: 'PROCEDURES', ground: true, channel: 'loop' },
  BACKROOM: { label: 'Sala de apoyo', ground: true, channel: 'loop' },
  PAO: { label: 'Control Apolo (PAO)', ground: true, channel: 'pao' },
  LCC: { label: 'Control de Lanzamiento', ground: true, channel: 'pao' },
  RECOVERY: { label: 'Recuperación', ground: true, channel: 'ag' },
  NARRATOR: { label: 'Narrador', ground: true, channel: 'narration' },
};

/** Consoles of the Mission Operations Control Room (MOCR), Building 30, Houston. */
export const MOCR_CONSOLES = [
  'BOOSTER', 'RETRO', 'FIDO', 'GUIDO', 'SURGEON', 'CAPCOM', 'EECOM', 'GNC', 'TELMU', 'CONTROL',
  'INCO', 'PROCEDURES', 'AFD', 'FLIGHT', 'FAO', 'NETWORK', 'PAO', 'DOD', 'MISSION_DIRECTOR',
];

const GRADES = [
  [0.97, 'A+'], [0.9, 'A'], [0.82, 'B'], [0.72, 'C'], [0.6, 'D'], [0, 'E'],
];

let _lineSeq = 0;

export class MissionRunner {
  /**
   * @param {{ game: any, sim: import('../sim/Simulation.js').Simulation, view: any, chapter: any, mission: any, role: string }} o
   */
  constructor({ game, sim, view, chapter, mission, role }) {
    this.game = game;
    this.sim = sim;
    this.view = view;
    this.chapter = chapter;
    this.mission = mission;
    this.role = role;
    this.bus = sim.bus;
    this.clock = sim.clock;
    this.waiters = new Set();
    this.realWaiters = new Set();
    this.recurring = new Set();
    this.cleanups = [];
    this.flags = Object.create(null);
    this.objectives = new Map();
    this.scoreItems = [];
    this.pads = [];
    this.ended = false;
    this.result = null;
    this.startReal = 0;
    this.realTime = 0;
    this.skip = null; // { get, label }
    this.ctx = this._createContext();
  }

  // ---------------------------------------------------------------- lifecycle

  start() {
    this.bus.emit('mission:start', { chapter: this.chapter.id, role: this.role });
    this._on('mission:skipRequest', () => this._doSkip());
    Promise.resolve()
      .then(() => this.chapter.run(this.ctx))
      .then(() => {
        if (!this.ended) this.complete({});
      })
      .catch((err) => {
        if (err instanceof MissionAbort) return;
        console.error('[mission] script error', err);
        this.bus.emit('mission:error', { error: err });
        if (!this.ended) this.fail(`Error en el guion de la misión: ${err.message}`);
      });
  }

  /** Called by Simulation after each substep. */
  tick(h) {
    if (this.ended) return;
    const t = this.clock.get;
    for (const w of this.waiters) {
      let ok = false;
      try {
        ok = w.check(t);
      } catch (err) {
        console.error('[mission] waitUntil predicate failed', err);
      }
      if (ok) {
        this.waiters.delete(w);
        w.done(true);
      } else if (w.deadline !== null && t >= w.deadline) {
        this.waiters.delete(w);
        w.done(false);
      }
    }
    for (const r of this.recurring) {
      r.acc += h;
      while (r.acc >= r.every && this.recurring.has(r)) {
        r.acc -= r.every;
        try {
          r.fn(this.ctx);
        } catch (err) {
          console.error('[mission] every() callback failed', err);
        }
      }
    }
  }

  /** Called by PlayScene every real frame (not while paused). */
  frame(realDt) {
    this.realTime += realDt;
    for (const w of this.realWaiters) {
      w.remaining -= realDt;
      if (w.remaining <= 0) {
        this.realWaiters.delete(w);
        w.resolve();
      }
    }
  }

  cancel(reason = 'cancel') {
    if (this._cancelled) return;
    this._cancelled = true;
    this.ended = true;
    const err = new MissionAbort(reason);
    for (const w of this.waiters) {
      if (w.stop !== undefined) this.clock.removeStop(w.stop);
      w.reject(err);
    }
    for (const w of this.realWaiters) w.reject(err);
    this.waiters.clear();
    this.realWaiters.clear();
    this.recurring.clear();
    for (const f of this.cleanups) {
      try {
        f();
      } catch (e) {
        console.error(e);
      }
    }
    this.cleanups.length = 0;
    this.clock.clearLimit('groundTask');
    this.clock.clearLimit('mission');
  }

  _on(type, fn) {
    const off = this.bus.on(type, fn);
    this.cleanups.push(off);
    return off;
  }

  // ---------------------------------------------------------------- waits

  _wait(check, { timeout = null } = {}) {
    if (this.ended) return Promise.reject(new MissionAbort('ended'));
    return new Promise((resolve, reject) => {
      const w = { check, deadline: timeout === null || timeout === undefined ? null : this.clock.get + timeout, done: resolve, reject };
      this.waiters.add(w);
    });
  }

  waitGET(t) {
    if (this.clock.get >= t) return Promise.resolve();
    if (this.ended) return Promise.reject(new MissionAbort('ended'));
    this.clock.addStop(t);
    return new Promise((resolve, reject) => {
      const w = {
        check: (now) => now >= t - 1e-6,
        deadline: null,
        stop: t,
        done: () => {
          this.clock.removeStop(t);
          resolve();
        },
        reject,
      };
      this.waiters.add(w);
    });
  }

  waitReal(s) {
    if (this.ended) return Promise.reject(new MissionAbort('ended'));
    return new Promise((resolve, reject) => this.realWaiters.add({ remaining: s, resolve, reject }));
  }

  waitEvent(type, filter = null, { timeout = null } = {}) {
    let payload = null;
    let got = false;
    const off = this.bus.on(type, (p) => {
      if (!got && (!filter || filter(p))) {
        got = true;
        payload = p;
      }
    });
    return this._wait(() => got, { timeout }).then(
      (ok) => {
        off();
        return ok ? payload : null;
      },
      (err) => {
        off();
        throw err;
      },
    );
  }

  // ---------------------------------------------------------------- context

  _createContext() {
    const r = this;
    const sim = this.sim;
    const ctx = {
      runner: r,
      sim,
      game: r.game,
      bus: r.bus,
      clock: r.clock,
      vehicle: sim.vehicle,
      sw: sim.vehicle.sw,
      tm: sim.vehicle.tm,
      get dyn() {
        return sim.dyn;
      },
      get gnc() {
        return sim.gnc;
      },
      get csm() {
        return sim.vehicle.modules.csm;
      },
      get lm() {
        return sim.vehicle.modules.lm;
      },
      get saturn() {
        return sim.vehicle.modules.saturn;
      },
      get view() {
        return r.view;
      },
      audio: r.game?.audio ?? null,
      store,
      settings: store.settings,
      role: r.role,
      isAstronaut: r.role === 'astronaut',
      isController: r.role === 'controller',
      difficulty: store.settings.difficulty,
      chapter: r.chapter,
      mission: r.mission,
      get t() {
        return r.clock.get;
      },

      wait: (s) => r.waitGET(r.clock.get + s),
      waitReal: (s) => r.waitReal(s),
      waitGET: (t) => r.waitGET(t),
      /** @returns {Promise<boolean>} true when predicate passed, false on timeout (sim seconds) */
      waitUntil: (pred, { timeout = null, maxWarp = null } = {}) => {
        if (maxWarp) r.clock.setLimit('waitUntil', maxWarp);
        const p = r._wait(() => pred(ctx), { timeout });
        if (maxWarp) p.finally(() => r.clock.clearLimit('waitUntil')).catch(() => {});
        return p;
      },
      waitEvent: (type, filter, opts) => r.waitEvent(type, filter, opts),
      waitSwitch: (id, pos, { timeout = null } = {}) => r._wait(() => sim.vehicle.sw.get(id) === pos, { timeout }),

      spawn: (fn) => {
        const p = Promise.resolve().then(() => fn(ctx));
        p.catch((err) => {
          if (!(err instanceof MissionAbort)) console.error('[mission] spawned task failed', err);
        });
        return p;
      },
      every: (seconds, fn) => {
        const rec = { every: seconds, fn, acc: 0 };
        r.recurring.add(rec);
        return () => r.recurring.delete(rec);
      },
      on: (type, fn) => r._on(type, fn),
      setWarpLimit: (max) => r.clock.setLimit('mission', max),
      clearWarpLimit: () => r.clock.clearLimit('mission'),
      dropWarp: () => r.clock.dropWarp(),
      allowSkip: (get, label) => {
        r.skip = { get, label };
        r.bus.emit('mission:skipAvailable', { get, label });
      },
      disallowSkip: () => {
        r.skip = null;
        r.bus.emit('mission:skipAvailable', null);
      },
      skipTo: (get) => r._skipTo(get),

      say: (...args) => r.say(...args),
      objective: (id, text, opts) => r.objective(id, text, opts),
      crew: (cl) => r.crew(cl),
      ground: (task) => r.ground(task),
      poll: (p) => r.poll(p),
      choice: (c) => r.choice(c),
      hint: (text, opts = {}) => {
        if (store.settings.hints && store.settings.difficulty !== 'realistic') r.bus.emit('mission:hint', { text, durationS: opts.durationS ?? 8 });
      },
      alert: (text, level = 'info', opts = {}) => r.bus.emit('mission:alert', { text, level, durationS: opts.durationS ?? 5 }),
      caption: (text, sub = '', durationS = 5) => r.bus.emit('mission:caption', { text, sub, durationS }),
      task: (text) => r.bus.emit('mission:task', { text }),
      pad: (pad) => {
        r.pads.push(pad);
        r.bus.emit('mission:pad', { pad });
      },
      highlight: (ids) => r.bus.emit('mission:highlight', { ids: [].concat(ids ?? []) }),
      clearHighlight: () => r.bus.emit('mission:highlight', { ids: [] }),
      score: (key, points, max, note = '') => r.score(key, points, max, note),
      penalty: (key, points, note = '') => r.score(key, -Math.abs(points), 0, note),
      achievement: (id) => {
        if (store.unlockAchievement(id)) r.bus.emit('mission:achievement', { id });
      },
      flag: (k, v) => {
        if (v !== undefined) r.flags[k] = v;
        return r.flags[k];
      },
      complete: (opts) => r.complete(opts),
      fail: (reason, opts) => r.fail(reason, opts),
    };
    return ctx;
  }

  // ---------------------------------------------------------------- comms

  /**
   * say(who, en, es, opts) or say({ who, en, es, ...opts })
   * opts: { channel: 'ag'|'ic'|'loop'|'pao'|'narration', clip, whoLabel, wait (default true),
   *         force (ignore LOS/blackout), priority }
   * @returns {Promise<void>} resolves when the line finished playing (or immediately if inaudible)
   */
  say(who, en, es, opts = {}) {
    const line = typeof who === 'object' ? { ...who } : { who, en, es, ...opts };
    const sp = SPEAKERS[line.who] ?? { label: line.who, ground: true, channel: 'ag' };
    line.channel ??= sp.channel;
    line.id = ++_lineSeq;
    line.whoLabel ??= this.mission?.crew?.[line.who] ?? this.chapter.speakers?.[line.who] ?? sp.label;
    const role = this.role;
    const audible =
      (line.channel === 'ag') ||
      (line.channel === 'ic' && role === 'astronaut') ||
      (line.channel === 'loop' && role === 'controller') ||
      line.channel === 'pao' ||
      line.channel === 'narration';
    if (!audible) return Promise.resolve();
    const play = async () => {
      if (line.channel === 'ag' && !line.force) {
        const st = this.sim.vehicle.state;
        if (st.losEarth || st.inBlackout) await this._wait(() => !st.losEarth && !st.inBlackout);
      }
      const words = `${line.en ?? line.es ?? ''}`.split(/\s+/).length;
      line.durationS ??= Math.max(1.6, words / 2.6 + 0.6);
      this.bus.emit('mission:say', line);
      const audio = this.game?.audio;
      try {
        if (audio?.radio) await Promise.race([audio.radio(line), this.waitReal(line.durationS + 12)]);
        else await this.waitReal(line.durationS);
      } finally {
        this.bus.emit('mission:sayEnd', { id: line.id });
      }
    };
    const p = (this._sayChain = (this._sayChain ?? Promise.resolve()).catch(() => {}).then(play));
    if (line.wait === false) {
      p.catch(() => {});
      return Promise.resolve();
    }
    return p;
  }

  // ---------------------------------------------------------------- objectives & score

  objective(id, text, { optional = false } = {}) {
    const o = { id, text, optional, state: 'active' };
    this.objectives.set(id, o);
    const emit = () => this.bus.emit('mission:objective', { ...o });
    emit();
    return {
      id,
      get state() {
        return o.state;
      },
      done: () => {
        if (o.state === 'active') {
          o.state = 'done';
          emit();
        }
      },
      fail: () => {
        if (o.state === 'active') {
          o.state = 'failed';
          emit();
        }
      },
      update: (newText) => {
        o.text = newText;
        emit();
      },
    };
  }

  score(key, points, max, note = '') {
    const item = { key, points, max, note };
    const i = this.scoreItems.findIndex((s) => s.key === key);
    if (i >= 0) this.scoreItems[i] = item;
    else this.scoreItems.push(item);
    this.bus.emit('mission:score', item);
  }

  // ---------------------------------------------------------------- crew checklists

  /**
   * @param {object} cl
   * @param {string} cl.id @param {string} cl.title @param {'CM'|'LM'} [cl.station]
   * @param {Array<{text:string, sw?:{id:string,pos:string}|Array, check?:Function, do?:Function,
   *   hint?:string, highlight?:string[], optional?:boolean}>} cl.items
   * @param {boolean} [cl.ordered=true] @param {[number,number]} [cl.aiPace=[1.5,4]] sim s per item
   * @param {boolean} [cl.ai] force AI crew even in astronaut mode
   */
  async crew(cl) {
    const sw = this.sim.vehicle.sw;
    const ctx = this.ctx;
    const t0 = this.clock.get;
    const pulses = new Map(); // "id|pos" seen during this checklist (momentary switches)
    const offSw = this.bus.on('switch:changed', ({ id, value }) => pulses.set(`${id}|${value}`, true));
    const items = cl.items.map((it, i) => {
      const sws = it.sw ? [].concat(it.sw) : [];
      const check = it.check
        ? () => !!it.check(ctx)
        : sws.length
          ? () => sws.every((s) => sw.get(s.id) === s.pos || (sw.def(s.id)?.momentary?.includes(s.pos) && pulses.has(`${s.id}|${s.pos}`)))
          : null;
      const auto = it.do
        ? () => it.do(ctx)
        : () => {
            for (const s of sws) {
              const d = sw.def(s.id);
              if (!d) continue;
              if (d.guarded && s.pos !== d.guardSafe) sw.setGuard(s.id, true, 'crew');
              if (d.momentary?.includes(s.pos)) sw.pulse(s.id, s.pos, 0.6, 'crew');
              else sw.set(s.id, s.pos, 'crew');
            }
          };
      return {
        id: it.id ?? `${cl.id}.${i}`,
        text: it.text,
        hint: it.hint ?? null,
        optional: !!it.optional,
        highlight: it.highlight ?? sws.map((s) => s.id),
        manual: !check,
        done: false,
        check,
        auto,
      };
    });
    const aiMode = this.role === 'controller' || !!cl.ai;
    const ordered = cl.ordered !== false;
    const state = { id: cl.id, title: cl.title, station: cl.station ?? this.sim.vehicle.station, mode: aiMode ? 'ai' : 'player', state: 'active' };
    let autoUsed = 0;
    const snapshot = () =>
      this.bus.emit('mission:checklist', {
        ...state,
        items: items.map(({ id, text, hint, optional, done, manual }) => ({ id, text, hint, optional, done, manual })),
      });
    const highlightCurrent = () => {
      if (aiMode || !store.settings.highlightControls || store.settings.difficulty === 'realistic') return;
      const cur = items.find((i) => !i.done && !i.optional) ?? items.find((i) => !i.done);
      this.bus.emit('mission:highlight', { ids: cur ? cur.highlight : [] });
    };
    const offConfirm = this.bus.on('mission:checklistConfirm', ({ checklistId, itemId }) => {
      if (checklistId !== cl.id) return;
      const it = items.find((i) => i.id === itemId);
      if (it && it.manual) it.done = true;
    });
    const offAuto = this.bus.on('mission:checklistAuto', ({ checklistId, itemId }) => {
      if (checklistId !== cl.id) return;
      const it = items.find((i) => i.id === itemId) ?? items.find((i) => !i.done);
      if (it && !it.done) {
        autoUsed++;
        it.auto();
        if (it.manual) it.done = true;
      }
    });
    const cleanup = () => {
      offSw();
      offConfirm();
      offAuto();
      this.bus.emit('mission:highlight', { ids: [] });
    };
    this.cleanups.push(cleanup);
    snapshot();
    try {
      if (aiMode) {
        const [a, b] = cl.aiPace ?? [1.5, 4];
        for (const it of items) {
          if (it.check && it.check()) {
            it.done = true;
            continue;
          }
          await ctx.wait(a + Math.random() * (b - a));
          it.auto();
          it.done = true;
          this.bus.emit('mission:crewAction', { checklistId: cl.id, text: it.text });
          snapshot();
        }
      } else {
        highlightCurrent();
        await this._wait(() => {
          let changed = false;
          for (let i = 0; i < items.length; i++) {
            const it = items[i];
            if (it.done || !it.check) continue;
            if (ordered && items.slice(0, i).some((p) => !p.done && !p.optional)) break;
            if (it.check()) {
              it.done = true;
              changed = true;
            }
          }
          if (changed) {
            snapshot();
            highlightCurrent();
          }
          return items.every((i) => i.done || i.optional);
        });
      }
      state.state = 'done';
      snapshot();
      return { completed: true, time: this.clock.get - t0, autoUsed };
    } finally {
      cleanup();
      const i = this.cleanups.indexOf(cleanup);
      if (i >= 0) this.cleanups.splice(i, 1);
    }
  }

  // ---------------------------------------------------------------- ground tasks

  /**
   * A Mission Control decision. Controller role: the player must answer at `console`
   * (MOCR console UI / HUD). Astronaut role: AI Houston answers with `aiChoice` after `aiDelay`.
   * @param {object} task { id, console, kind: 'decision'|'poll'|'diagnose'|'uplink'|'procedure'|'report',
   *   title, prompt, options: [{ id, label, correct?, say?: line|line[] , detail? }], timeout?, aiChoice?,
   *   aiDelay?, evidence?: string[] (telemetry keys to highlight), hint?, score?: { key, points } }
   * @returns {Promise<{ choice: string, correct: boolean, timedOut: boolean, ai: boolean, time: number }>}
   */
  async ground(task) {
    const options = task.options ?? [{ id: 'OK', label: 'Entendido', correct: true }];
    const sayAll = async (lines) => {
      for (const l of [].concat(lines ?? [])) await this.say(l);
    };
    const t0 = this.clock.get;
    if (this.role !== 'controller' || task.aiOnly) {
      await this.ctx.wait(task.aiDelay ?? 2);
      const opt = options.find((o) => o.id === task.aiChoice) ?? options.find((o) => o.correct) ?? options[0];
      await sayAll(opt.say);
      return { choice: opt.id, correct: opt.correct !== false, timedOut: false, ai: true, time: this.clock.get - t0 };
    }
    this.clock.setLimit('groundTask', 1);
    this.clock.dropWarp();
    let resolved = null;
    const payload = {
      id: task.id,
      console: task.console,
      kind: task.kind ?? 'decision',
      title: task.title,
      prompt: task.prompt,
      options: options.map(({ id, label, detail }) => ({ id, label, detail })),
      timeoutS: task.timeout ?? null,
      evidence: task.evidence ?? [],
      hint: store.settings.hints && store.settings.difficulty !== 'realistic' ? task.hint ?? null : null,
      resolve: (choiceId) => {
        if (!resolved) resolved = { choiceId };
      },
    };
    this.bus.emit('mission:groundTask', payload);
    if (task.evidence?.length) this.bus.emit('mission:highlight', { ids: task.evidence });
    let ok;
    try {
      ok = await this._wait(() => !!resolved, { timeout: task.timeout ?? null });
    } finally {
      this.clock.clearLimit('groundTask');
      if (task.evidence?.length) this.bus.emit('mission:highlight', { ids: [] });
    }
    const timedOut = !ok;
    const choiceId = timedOut ? task.timeoutChoice ?? task.aiChoice ?? options[0].id : resolved.choiceId;
    const opt = options.find((o) => o.id === choiceId) ?? options[0];
    const correct = !timedOut && opt.correct !== false;
    this.bus.emit('mission:groundTaskEnd', { id: task.id, choice: opt.id, correct, timedOut });
    if (task.score) this.score(task.score.key ?? task.id, correct ? task.score.points : 0, task.score.points, task.title);
    await sayAll(opt.say);
    return { choice: opt.id, correct, timedOut, ai: false, time: this.clock.get - t0 };
  }

  /**
   * Flight Director GO/NO-GO poll.
   * @param {object} p { id, title, consoles: string[], expected?: {CONSOLE:'GO'|'NOGO'} | (ctx)=>object,
   *   playerConsoles?: string[] (defaults to chapter.controllerRole), intro?: line, outro?: line,
   *   astronautSummary?: line (what the crew hears from CAPCOM in astronaut mode) }
   */
  async poll(p) {
    const exp = (typeof p.expected === 'function' ? p.expected(this.ctx) : p.expected) ?? {};
    const answerOf = (c) => exp[c] ?? 'GO';
    if (this.role !== 'controller') {
      if (p.astronautSummary) await this.say(p.astronautSummary);
      const answers = Object.fromEntries(p.consoles.map((c) => [c, answerOf(c)]));
      return { allGo: Object.values(answers).every((a) => a === 'GO'), answers, playerCorrect: true, ai: true };
    }
    const playerConsoles = p.playerConsoles ?? [this.chapter.controllerRole].filter(Boolean);
    const rows = p.consoles.map((c) => ({ console: c, answer: null, isPlayer: playerConsoles.includes(c) }));
    const emit = (state = 'active') => this.bus.emit('mission:poll', { id: p.id, title: p.title, consoles: rows.map((r) => ({ ...r })), state });
    emit();
    if (p.intro) await this.say({ who: 'FLIGHT', channel: 'loop', ...p.intro });
    let playerCorrect = true;
    for (const row of rows) {
      const c = row.console;
      await this.say({ who: 'FLIGHT', en: `${c}?`, es: `¿${c}?`, channel: 'loop' });
      if (row.isPlayer) {
        const res = await this.ground({
          id: `${p.id}.${c}`,
          console: c,
          kind: 'poll',
          title: p.title,
          prompt: `FLIGHT te pregunta, ${c}: ¿GO o NO GO?`,
          options: [
            { id: 'GO', label: 'GO', correct: answerOf(c) === 'GO', say: { who: c, en: 'Go!', es: '¡GO!', channel: 'loop' } },
            { id: 'NOGO', label: 'NO GO', correct: answerOf(c) === 'NOGO', say: { who: c, en: 'No go, Flight.', es: 'NO GO, Flight.', channel: 'loop' } },
          ],
          timeout: p.timeoutPer ?? 20,
          timeoutChoice: 'GO',
          evidence: p.evidence?.[c] ?? [],
        });
        row.answer = res.choice;
        playerCorrect &&= res.correct;
      } else {
        row.answer = answerOf(c);
        await this.say({ who: c, en: row.answer === 'GO' ? 'Go!' : 'No go, Flight.', es: row.answer === 'GO' ? '¡GO!' : 'NO GO, Flight.', channel: 'loop' });
      }
      emit();
    }
    const allGo = rows.every((r) => r.answer === 'GO');
    if (p.outro) await this.say({ who: 'FLIGHT', channel: 'loop', ...(typeof p.outro === 'function' ? p.outro(allGo) : p.outro) });
    emit('done');
    return { allGo, answers: Object.fromEntries(rows.map((r) => [r.console, r.answer])), playerCorrect, ai: false };
  }

  /** Modal decision shown to the player in either role. Resolves to the option id. */
  choice({ id, title, prompt, options, timeout = null, defaultOption = null }) {
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (opt) => {
        if (done) return;
        done = true;
        this.bus.emit('mission:choiceEnd', { id, choice: opt });
        resolve(opt);
      };
      this.bus.emit('mission:choice', { id, title, prompt, options, timeoutS: timeout, resolve: finish });
      if (timeout) this.waitReal(timeout).then(() => finish(defaultOption ?? options[0].id), () => {});
      this.cleanups.push(() => {
        if (!done) {
          done = true;
          reject(new MissionAbort('ended'));
        }
      });
    });
  }

  // ---------------------------------------------------------------- skip / fast-forward

  async _skipTo(get) {
    const prevWarp = this.clock.warp;
    this.clock.setWarp(10000);
    try {
      await this.waitGET(get);
    } finally {
      this.clock.setWarp(prevWarp > 100 ? 1 : prevWarp);
    }
  }

  _doSkip() {
    if (this.skip && this.clock.get < this.skip.get) {
      const target = this.skip.get;
      this.ctx.disallowSkip();
      this._skipTo(target).catch(() => {});
    }
  }

  // ---------------------------------------------------------------- end

  _finalScore() {
    const items = this.scoreItems;
    const max = items.reduce((a, s) => a + Math.max(0, s.max), 0);
    const total = items.reduce((a, s) => a + s.points, 0);
    if (max <= 0) return { total: 100, max: 100, items, ratio: 1 };
    const clamped = Math.max(0, Math.min(max, total));
    return { total: Math.round(clamped), max: Math.round(max), items, ratio: clamped / max };
  }

  complete({ summary = '', stats = {} } = {}) {
    if (this.ended) return;
    const score = this._finalScore();
    const grade = GRADES.find(([r]) => score.ratio >= r)[1];
    this.result = { success: true, summary, score, grade, stats: { get: this.clock.get, realTime: this.realTime, ...stats } };
    store.recordChapterResult(this.chapter.id, this.role, { completed: true, score: Math.round(score.ratio * 100), grade });
    this.bus.emit('mission:end', this.result);
    this.cancel('complete');
  }

  fail(reason = 'Misión fallida', { summary = '', stats = {} } = {}) {
    if (this.ended) return;
    const score = this._finalScore();
    this.result = { success: false, reason, summary, score, grade: 'F', stats: { get: this.clock.get, realTime: this.realTime, ...stats } };
    store.recordChapterResult(this.chapter.id, this.role, { completed: false, score: 0, grade: 'F' });
    this.bus.emit('mission:end', this.result);
    this.cancel('fail');
  }
}
