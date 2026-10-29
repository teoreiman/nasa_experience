// Post-chapter debrief. STUB by the architect; the "ui" agent replaces it.
//   enter({ chapterId, missionId, role, result })  result = mission:end payload

import { h } from '../core/dom.js';
import { getMission } from '../missions/registry.js';

export default class DebriefScene {
  constructor(game) {
    this.game = game;
  }

  async enter({ chapterId, missionId, role, result }) {
    const m = getMission(missionId);
    const idx = m.chapters.findIndex((c) => c.id === chapterId);
    const next = m.chapters[idx + 1];
    this.root = h(
      'div',
      { class: 'menu-stub' },
      h('h1', null, result?.success ? 'Capítulo completado' : 'Misión fallida'),
      h('p', null, result?.success ? result.summary : result?.reason),
      h('p', null, `Nota: ${result?.grade ?? '-'}  (${result?.score?.total ?? 0}/${result?.score?.max ?? 0})`),
      h('button', { class: 'btn', on: { click: () => this.game.goto('play', { chapterId, role }) } }, 'Repetir'),
      next ? h('button', { class: 'btn', on: { click: () => this.game.goto('play', { chapterId: next.id, role }) } }, `Siguiente: ${next.title}`) : null,
      h('button', { class: 'btn', on: { click: () => this.game.goto('menu', { screen: 'missions' }) } }, 'Menú'),
    );
    this.game.uiRoot.append(this.root);
  }

  update() {}

  render() {
    this.game.renderer.clear();
  }

  exit() {
    this.root?.remove();
  }
}
