// In-mission HTML overlay. STUB by the architect: minimal but functional (clock, subtitles,
// objectives, checklist, choices/ground tasks, pause). The "ui" agent replaces it with the full,
// responsive HUD (touch controls, PAD cards, trajectory map, poll board, telemetry strip…),
// keeping the constructor signature and the bus events of docs/ARCHITECTURE.md §11.

import { h, clear } from '../core/dom.js';
import { MissionClock } from '../core/MissionClock.js';

export class HUD {
  constructor({ game, sim, view, role, chapter, mission, actions }) {
    this.game = game;
    this.sim = sim;
    this.role = role;
    this.actions = actions;
    this.root = h('div', { class: 'hud-stub' });
    this.clockEl = h('div', { class: 'hud-stub-clock' });
    this.subEl = h('div', { class: 'hud-stub-sub' });
    this.objEl = h('div', { class: 'hud-stub-obj' });
    this.clEl = h('div', { class: 'hud-stub-cl' });
    this.modalEl = h('div', { class: 'hud-stub-modal', hidden: true });
    this.pauseEl = h(
      'div',
      { class: 'hud-stub-modal', hidden: true },
      h('h2', null, 'Pausa'),
      h('button', { class: 'btn', on: { click: () => actions.resume() } }, 'Continuar'),
      h('button', { class: 'btn', on: { click: () => actions.restart() } }, 'Reiniciar capítulo'),
      h('button', { class: 'btn', on: { click: () => actions.quit() } }, 'Salir al menú'),
    );
    this.root.append(this.clockEl, this.objEl, this.clEl, this.subEl, this.modalEl, this.pauseEl);
    game.uiRoot.append(this.root);
    this.objectives = new Map();
    const bus = sim.bus;
    this._off = [
      bus.on('mission:say', (l) => {
        this.subEl.textContent = `${l.whoLabel}: ${l.es ?? l.en}`;
        this.subEl.title = l.en ?? '';
      }),
      bus.on('mission:sayEnd', () => (this.subEl.textContent = '')),
      bus.on('mission:objective', (o) => {
        this.objectives.set(o.id, o);
        clear(this.objEl).append(...[...this.objectives.values()].map((x) => h('div', { class: `obj obj-${x.state}` }, x.text)));
      }),
      bus.on('mission:checklist', (c) => {
        clear(this.clEl);
        if (c.state !== 'active') return;
        this.clEl.append(
          h('div', { class: 'cl-title' }, c.title),
          ...c.items.map((i) =>
            h('div', { class: `cl-item ${i.done ? 'done' : ''}` }, i.text, !i.done && c.mode === 'player'
              ? h('button', { class: 'btn-mini', on: { click: () => bus.emit(i.manual ? 'mission:checklistConfirm' : 'mission:checklistAuto', { checklistId: c.id, itemId: i.id }) } }, i.manual ? 'Hecho' : 'Auto')
              : null),
          ),
        );
      }),
      bus.on('mission:choice', (c) => this._modal(c.title, c.prompt, c.options, c.resolve)),
      bus.on('mission:groundTask', (t) => this._modal(`${t.console} — ${t.title ?? ''}`, t.prompt, t.options, t.resolve)),
      bus.on('mission:groundTaskEnd', () => (this.modalEl.hidden = true)),
      bus.on('mission:choiceEnd', () => (this.modalEl.hidden = true)),
      bus.on('mission:caption', (c) => {
        this.subEl.textContent = `${c.text} — ${c.sub ?? ''}`;
      }),
    ];
  }

  _modal(title, prompt, options, resolve) {
    clear(this.modalEl).append(
      h('h3', null, title ?? ''),
      h('p', null, prompt ?? ''),
      ...options.map((o) => h('button', { class: 'btn', on: { click: () => { this.modalEl.hidden = true; resolve(o.id); } } }, o.label)),
    );
    this.modalEl.hidden = false;
  }

  setPaused(p) {
    this.pauseEl.hidden = !p;
  }

  update() {
    const c = this.sim.clock;
    this.clockEl.textContent = `GET ${MissionClock.format(c.get)}  ×${c.effectiveWarp}`;
  }

  resize() {}

  dispose() {
    this._off.forEach((f) => f());
    this.root.remove();
  }
}
