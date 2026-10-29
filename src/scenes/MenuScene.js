// Main menu. STUB by the architect: role choice every start → mission → chapter.
// The "ui" agent replaces it with the full menu (title screen, 3D backdrop, role cards, campaign,
// special missions, training, archive, achievements, settings, credits) keeping scene params:
//   enter({ screen?: 'title'|'role'|'missions' })

import { h } from '../core/dom.js';
import { store } from '../core/Store.js';
import { MISSIONS, ROLES, isUnlocked } from '../missions/registry.js';

export default class MenuScene {
  constructor(game) {
    this.game = game;
  }

  async enter({ screen } = {}) {
    this.root = h('div', { class: 'menu-stub' });
    this.game.uiRoot.append(this.root);
    if (screen === 'missions' && store.session.role) this.showMissions();
    else this.showRoles();
  }

  showRoles() {
    this.root.replaceChildren(
      h('h1', null, 'PROYECTO APOLO'),
      h('p', null, '¿Cómo quieres vivir la misión?'),
      ...Object.values(ROLES).map((r) =>
        h('button', { class: 'btn btn-big', on: { click: () => { store.session.role = r.id; this.showMissions(); } } }, h('b', null, r.name), h('div', null, r.desc)),
      ),
    );
  }

  showMissions() {
    const role = store.session.role;
    this.root.replaceChildren(
      h('h2', null, `Rol: ${ROLES[role].name}`),
      h('button', { class: 'btn', on: { click: () => this.showRoles() } }, 'Cambiar rol'),
      ...MISSIONS.map((m) =>
        h('div', { class: 'mission' },
          h('h3', null, `${m.name} — ${m.tagline}`),
          ...m.chapters.filter((c) => c.roles.includes(role)).map((c) =>
            h('button', {
              class: 'btn',
              disabled: !isUnlocked(store, m.id, c.id),
              on: { click: () => this.game.goto(c.id === 'a11-eva' ? 'eva' : 'play', { chapterId: c.id, role }) },
            }, `${c.order}. ${c.title}`),
          ),
        ),
      ),
    );
  }

  update() {}

  render() {
    const r = this.game.renderer;
    r.setClearColor(0x05070a);
    r.clear();
  }

  exit() {
    this.root?.remove();
  }
}
