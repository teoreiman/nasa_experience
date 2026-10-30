// Main menu over the 3D "Earthrise" backdrop: title → role (every start) → missions & chapters.
// Settings, achievements and credits open as modals.
//   enter({ screen?: 'title'|'role'|'missions', missionId? })

import { h, clear } from '../core/dom.js';
import { store } from '../core/Store.js';
import { MISSIONS, ROLES, isUnlocked } from '../missions/registry.js';
import { createCinematicBackdrop } from '../render/CinematicBackdrop.js';
import { icon, patchEl, patchSVG, ROLE_ART, ROCKET_SVG, openSettings, openCredits, openAchievements, allAchievements, toggleFullscreen } from '../ui/components.js';
import { FREE_MISSION, FREE_VEHICLES, FREE_STARTS } from '../missions/free/index.js';

const ROLE_FEATURES = {
  astronaut: [
    'Cabinas del CM y del LM con cientos de controles funcionales',
    'Pilota el alunizaje, los acoplamientos y la reentrada',
    'Ordenador de guiado (DSKY) con verbos y nombres reales',
  ],
  controller: [
    'La sala de control de Houston, en primera persona',
    'Telemetría en vivo: diagnostica fallos como EECOM o GUIDO',
    'Responde a las votaciones GO / NO GO del director de vuelo',
  ],
};

export default class MenuScene {
  constructor(game) {
    this.game = game;
    this.screen = null;
    this.selectedMission = null;
  }

  async enter({ screen, missionId } = {}) {
    const game = this.game;
    this.backdrop = createCinematicBackdrop(game);
    this.backdrop.resize(game.width, game.height);
    await Promise.race([this.backdrop.loading, new Promise((r) => setTimeout(r, 6000))]);

    this.body = h('div', { class: 'menu-body' });
    this.root = h(
      'div',
      { class: 'ui-screen menu fade-in' },
      h('div', { class: 'menu-vignette' }),
      h(
        'div',
        { class: 'menu-bar' },
        h('div', { class: 'menu-brand', on: { click: () => this.show('title') } }, patchEl('apollo11'), 'Proyecto Apolo'),
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn btn-ghost btn-sm', on: { click: () => this._click(() => openAchievements()) } }, icon('trophy'), this._achLabel()),
        h('button', { class: 'btn btn-ghost btn-sm', on: { click: () => this._click(() => openSettings()) } }, icon('settings'), 'Ajustes'),
        h('button', { class: 'btn btn-ghost btn-sm', on: { click: () => this._click(() => openCredits()) } }, icon('credits'), 'Créditos'),
        h('button', { class: 'btn btn-ghost btn-icon', title: 'Pantalla completa', on: { click: () => toggleFullscreen() } }, icon('fullscreen')),
      ),
      this.body,
      h(
        'div',
        { class: 'menu-foot' },
        h('span', null, 'Homenaje independiente al programa Apolo · No afiliado a la NASA'),
        (this.clockEl = h('span', { class: 'menu-clock' }, this._clockText())),
      ),
    );
    game.uiRoot.append(this.root);
    this._onKey = (e) => {
      if (e.code !== 'Escape' || document.querySelector('.modal-backdrop')) return;
      if (this.screen === 'missions') this.show('role');
      else if (this.screen === 'role') this.show('title');
    };
    window.addEventListener('keydown', this._onKey);

    const role = store.session.role;
    if (screen === 'missions' && role) this.show('missions', { missionId });
    else if (screen === 'role') this.show('role');
    else this.show('title');
    game.audio?.music?.('menu');
  }

  _achLabel() {
    const all = allAchievements();
    const got = all.filter((a) => store.hasAchievement(a.id)).length;
    return `Logros ${got}/${all.length}`;
  }

  _clockText() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `HOUSTON ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} UTC · LC-39A 28°36′30″N 80°36′15″O`;
  }

  _click(fn) {
    this.game.audio?.sfx?.('uiClick');
    fn();
  }

  show(screen, opts = {}) {
    this.screen = screen;
    this.game.audio?.sfx?.('uiClick', { gain: 0.6 });
    clear(this.body);
    this.root.classList.toggle('letterbox-on', screen === 'title');
    if (screen === 'title') {
      this.backdrop.setFocus(0);
      this.body.append(this._title());
    } else if (screen === 'role') {
      this.backdrop.setFocus(0.35);
      this.body.append(this._roles());
    } else {
      this.backdrop.setFocus(1);
      this.body.append(this._missions(opts.missionId));
    }
  }

  _title() {
    const playing = { el: null };
    const jfk = h('button', {
      class: 'btn btn-ghost btn-sm',
      style: { marginTop: '0.8rem' },
      on: {
        click: async (e) => {
          const b = e.currentTarget;
          this.game.audio?.unlock?.();
          if (playing.el) return;
          playing.el = true;
          b.disabled = true;
          b.lastChild.textContent = 'Reproduciendo… (Universidad Rice, 1962)';
          this.game.audio?.duck?.(0.25, 18);
          await this.game.audio?.clip?.('jfk_we_choose', { radio: false });
          b.disabled = false;
          b.lastChild.textContent = 'Escuchar el discurso original';
          playing.el = null;
        },
      },
    }, icon('volume'), h('span', null, 'Escuchar el discurso original'));
    return h(
      'div',
      { class: 'title-screen rise-in' },
      h('div', { class: 'overline' }, 'Simulador de misiones lunares · 1968 – 1970'),
      h('h1', null, ...this._letters('Proyecto', 0.15), h('br'), ...this._letters('Apolo', 0.6)),
      h('div', { class: 'title-rule' }),
      h('p', { class: 'lead' },
        'Viaja a la Luna con las tripulaciones del Apolo 11 y el Apolo 13. Pilota el Saturn V, el módulo de mando y el módulo lunar desde la cabina — o dirige la misión desde el Control de Misión de Houston.'),
      h(
        'div',
        { class: 'title-actions' },
        h('button', {
          class: 'btn btn-primary btn-lg pulse',
          on: {
            click: () => {
              this.game.audio?.unlock?.();
              this.game.audio?.music?.('menu');
              this.show('role');
            },
          },
        }, icon('play'), 'Comenzar'),
        h('button', { class: 'btn btn-lg', on: { click: () => this._click(() => openSettings()) } }, icon('settings'), 'Ajustes'),
      ),
      h(
        'div',
        { class: 'quote' },
        '«Elegimos ir a la Luna en esta década, y hacer las otras cosas, no porque sean fáciles, sino porque son difíciles.»',
        h('cite', null, 'John F. Kennedy · 12 de septiembre de 1962'),
        jfk,
      ),
    );
  }

  _letters(word, delay) {
    return [...word].map((ch, i) => h('span', { class: 'ch', style: { animationDelay: `${delay + i * 0.06}s` } }, ch));
  }

  _roles() {
    const card = (r) =>
      h(
        'button',
        {
          class: 'frame ticks role-card',
          on: {
            click: () => {
              store.session.role = r.id;
              this.game.audio?.sfx?.('uiConfirm');
              this.show('missions');
            },
            pointerenter: () => this.game.audio?.sfx?.('uiHover'),
          },
        },
        h('div', { class: 'role-art', html: ROLE_ART[r.id] }),
        h('div', { class: 'role-info' }, h('h3', null, r.name), h('p', null, r.desc), h('ul', null, ROLE_FEATURES[r.id].map((f) => h('li', null, f)))),
      );
    return h(
      'div',
      { class: 'role-screen rise-in' },
      h('div', { class: 'screen-head' }, h('div', { class: 'overline' }, 'Paso 1 de 2'), h('h2', null, '¿Cómo quieres vivir la misión?'), h('p', null, 'Puedes cambiar de rol cada vez que empiezas. Cada capítulo se juega distinto desde la cabina y desde Houston.')),
      h('div', { class: 'role-cards' }, card(ROLES.astronaut), card(ROLES.controller)),
      h('div', null, h('button', { class: 'btn btn-ghost', on: { click: () => this.show('title') } }, icon('back'), 'Volver')),
    );
  }

  _missions(missionId) {
    const role = store.session.role;
    const visible = MISSIONS.filter((m) => m.chapters.some((c) => c.roles.includes(role)));
    if (role === 'astronaut') visible.unshift(FREE_MISSION);
    const sel = visible.find((m) => m.id === (missionId ?? this.selectedMission)) ?? visible[0];
    this.selectedMission = sel.id;
    const list = h('div', { class: 'mission-list ui-scroll stagger' });
    const detail = h('div', { class: 'frame ticks mission-detail' });
    const groups = [
      ['Vuelo libre', visible.filter((m) => m.free)],
      ['Campaña', visible.filter((m) => m.campaign)],
      ['Misiones especiales', visible.filter((m) => m.special)],
      ['Simuladores', visible.filter((m) => m.training)],
    ];
    const items = new Map();
    for (const [label, ms] of groups) {
      if (!ms.length) continue;
      list.append(h('div', { class: 'mission-group-label' }, label));
      for (const m of ms) {
        const chs = m.chapters.filter((c) => c.roles.includes(role));
        const done = chs.filter((c) => store.isChapterCompleted(c.id, role)).length;
        const free = !!m.free;
        const it = h(
          'button',
          {
            class: `frame mission-item ${m.id === sel.id ? 'active' : ''}`,
            on: {
              click: () => {
                this.selectedMission = m.id;
                for (const [id, el] of items) el.classList.toggle('active', id === m.id);
                this.game.audio?.sfx?.('uiClick');
                this._fillDetail(detail, m, role);
              },
              pointerenter: () => this.game.audio?.sfx?.('uiHover'),
            },
          },
          free ? h('div', { class: 'patch-sm free-ico', html: ROCKET_SVG.saturnv }) : patchEl(m.patch, 'patch-sm'),
          h('div', null, h('b', null, m.name), h('small', null, m.tagline)),
          free ? h('span', { class: 'chip amber' }, 'Sandbox') : h('span', { class: 'progress' }, `${done}/${chs.length}`),
        );
        items.set(m.id, it);
        list.append(it);
      }
    }
    this._fillDetail(detail, sel, role);
    return h(
      'div',
      { class: 'missions-screen rise-in' },
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', minHeight: '0' } },
        h(
          'div',
          { class: 'screen-head', style: { marginBottom: '0.3rem' } },
          h('div', { class: 'overline' }, `Paso 2 de 2 · ${ROLES[role].name}`),
          h('button', { class: 'btn btn-ghost btn-sm', style: { marginTop: '0.4rem' }, on: { click: () => this.show('role') } }, icon('back'), 'Cambiar de rol'),
        ),
        list,
      ),
      detail,
    );
  }

  _fillFree(detail) {
    const st = (this.freeSel ??= { vehicle: 'saturnv', start: 'pad' });
    const veh = FREE_VEHICLES.find((x) => x.id === st.vehicle) ?? FREE_VEHICLES[0];
    if (!veh.starts.includes(st.start)) st.start = veh.starts[0];
    const launch = () => {
      this.game.audio?.unlock?.();
      this.game.audio?.sfx?.('uiConfirm');
      const sv = FREE_STARTS[st.start];
      this.game.goto('play', { chapterId: `free:${veh.id}:${st.start}`, role: 'astronaut', loadingText: `Vuelo libre · ${veh.name} · ${sv.title}`, loadingPatch: patchSVG('training') });
    };
    clear(detail).append(
      h(
        'div',
        { class: 'mission-hero fade-in' },
        h('div', { class: 'patch-lg free-hero', html: ROCKET_SVG[veh.id] }),
        h(
          'div',
          null,
          h('div', { class: 'overline' }, 'Sandbox · sin guion'),
          h('h2', null, 'Vuelo libre'),
          h('div', { class: 'tagline' }, 'Elige tu cohete y un punto de partida. Todos los sistemas funcionan: lanza, acopla, viaja a la Luna, aluniza y vuelve — con Houston calculando cada maniobra que le pidas.'),
        ),
      ),
      h(
        'div',
        { class: 'ui-scroll', style: { minHeight: '0', overflowY: 'auto', paddingRight: '0.3rem' } },
        h('div', { class: 'overline', style: { margin: '0 0 0.5rem' } }, '1 · Tu cohete'),
        h(
          'div',
          { class: 'free-vehicles stagger' },
          FREE_VEHICLES.map((x) =>
            h(
              'button',
              {
                class: `veh-card ${x.id === veh.id ? 'sel' : ''}`,
                on: {
                  click: () => {
                    st.vehicle = x.id;
                    this.game.audio?.sfx?.('uiClick');
                    this._fillFree(detail);
                  },
                  pointerenter: () => this.game.audio?.sfx?.('uiHover'),
                },
              },
              h('div', { class: 'sil', html: ROCKET_SVG[x.id] }),
              h(
                'div',
                null,
                h('h4', null, x.name),
                h('div', { class: 'sub' }, x.sub),
                h('p', null, x.desc),
                h('div', { class: 'specs' }, x.specs.flatMap(([a, b]) => [h('span', null, a), h('b', null, b)])),
              ),
              x.favorite ? h('span', { class: 'chip amber fav' }, icon('star'), 'Favorito') : null,
            ),
          ),
        ),
        h('div', { class: 'overline', style: { margin: '0.2rem 0 0.5rem' } }, '2 · Punto de partida'),
        h(
          'div',
          { class: 'free-starts stagger' },
          veh.starts.map((id) => {
            const sv = FREE_STARTS[id];
            return h(
              'button',
              {
                class: `start-card ${id === st.start ? 'sel' : ''}`,
                on: {
                  click: () => {
                    st.start = id;
                    this.game.audio?.sfx?.('uiClick');
                    this._fillFree(detail);
                  },
                  dblclick: launch,
                },
              },
              h('b', null, sv.title),
              h('small', null, sv.sub),
            );
          }),
        ),
        h(
          'div',
          { class: 'brief-actions' },
          h('button', { class: 'btn btn-primary btn-lg pulse', on: { click: launch } }, icon('rocket'), st.start === 'pad' ? 'Ir a la plataforma' : 'Comenzar vuelo'),
          h('span', { class: 'muted', style: { fontSize: '0.85rem' } }, 'Consejo: abre el manual de procedimientos (B) y pide PADs a Houston.'),
        ),
      ),
    );
  }

  _fillDetail(detail, m, role) {
    if (m.free) {
      this._fillFree(detail);
      return;
    }
    const chs = m.chapters.filter((c) => c.roles.includes(role));
    const crew = m.crew ? Object.entries(m.crew).map(([k, v]) => `${{ CDR: 'Comandante', CMP: 'Piloto del CM', LMP: 'Piloto del LM' }[k]}: ${v}`) : [];
    const callsigns = m.callsigns ? Object.entries(m.callsigns).map(([k, v]) => `${k} «${v}»`).join(' · ') : '';
    clear(detail).append(
      h(
        'div',
        { class: 'mission-hero fade-in' },
        patchEl(m.patch, 'patch-lg'),
        h(
          'div',
          null,
          h('div', { class: 'overline' }, m.date),
          h('h2', null, m.name),
          h('div', { class: 'tagline' }, m.tagline),
          h('div', { class: 'mission-meta' }, crew.map((c) => h('span', null, c)), callsigns ? h('span', null, h('b', null, callsigns)) : null, m.hardware ? h('span', null, m.hardware) : null),
        ),
      ),
      h(
        'div',
        { class: 'chapter-grid ui-scroll stagger' },
        chs.map((c) => {
          const unlocked = isUnlocked(store, m.id, c.id);
          const res = store.chapterResult(c.id, role);
          return h(
            'button',
            {
              class: `chapter-card fade-in ${unlocked ? '' : 'locked'}`,
              title: unlocked ? '' : 'Completa el capítulo anterior para desbloquearlo',
              on: {
                click: () => {
                  if (!unlocked) {
                    this.game.audio?.sfx?.('uiBack');
                    return;
                  }
                  this.game.audio?.sfx?.('uiConfirm');
                  this.game.goto('briefing', { chapterId: c.id, role });
                },
                pointerenter: () => unlocked && this.game.audio?.sfx?.('uiHover'),
              },
            },
            h('span', { class: 'num' }, `CAPÍTULO ${String(c.order).padStart(2, '0')}`),
            h('h4', null, c.title),
            h('p', null, c.subtitle),
            h(
              'div',
              { class: 'row' },
              h('span', { class: 'chip' }, icon('clock'), `${c.minutes} min`),
              role === 'controller' && c.controllerRole ? h('span', { class: 'chip amber' }, icon('headset'), c.controllerRole) : null,
              !unlocked ? h('span', { class: 'chip' }, icon('lock'), 'Bloqueado') : null,
              res?.completed ? h('span', { class: 'chip green' }, icon('check'), 'Completado') : null,
            ),
            res?.bestGrade && res.completed ? h('span', { class: 'grade' }, res.bestGrade) : null,
          );
        }),
      ),
    );
  }

  update(dt) {
    this.backdrop?.update(dt);
    this._clockAcc = (this._clockAcc ?? 0) + dt;
    if (this._clockAcc > 0.5 && this.clockEl) {
      this._clockAcc = 0;
      this.clockEl.textContent = this._clockText();
    }
  }

  render() {
    this.backdrop?.render();
  }

  resize(w, h) {
    this.backdrop?.resize(w, h);
  }

  exit() {
    window.removeEventListener('keydown', this._onKey);
    this.root?.remove();
    this.backdrop?.dispose();
  }
}
