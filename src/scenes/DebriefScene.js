// Post-chapter debrief: grade, score breakdown, stats, historical note, achievements earned,
// retry / next chapter / menu.
//   enter({ chapterId, missionId, role, result })  result = mission:end payload

import { h } from '../core/dom.js';
import { MissionClock } from '../core/MissionClock.js';
import { getMission, findChapter, chapterScene, isUnlocked } from '../missions/registry.js';
import { FREE_VEHICLES, FREE_STARTS } from '../missions/free/index.js';
import { store } from '../core/Store.js';
import { createMenuBackdrop } from '../render/MenuBackdrop.js';
import { icon, patchEl, patchSVG, achievementById } from '../ui/components.js';

function fmtReal(s) {
  const m = Math.floor(s / 60);
  return `${m} min ${String(Math.floor(s % 60)).padStart(2, '0')} s`;
}

export default class DebriefScene {
  constructor(game) {
    this.game = game;
  }

  async enter({ chapterId, missionId, role, result = {} }) {
    const game = this.game;
    const m = getMission(missionId) ?? findChapter(chapterId)?.mission ?? getMission('free');
    const idx = m.chapters.findIndex((c) => c.id === chapterId);
    let meta = m.chapters[idx];
    let chapter = meta;
    if (meta) {
      // the module only for its history notes (its setup may fly a whole trajectory: not needed)
      try {
        chapter = { ...meta, ...(await meta.load()).default };
      } catch {
        /* metadata is enough */
      }
    } else {
      // free flight ("free:<vehicle>:<start>") is built on demand, not listed in the mission
      const [, vehId, startId] = chapterId.split(':');
      const veh = FREE_VEHICLES.find((x) => x.id === vehId) ?? FREE_VEHICLES[0];
      meta = chapter = { id: chapterId, order: 0, title: `${veh.name} · ${(FREE_STARTS[startId] ?? FREE_STARTS.pad).title}`, roles: ['astronaut'] };
    }
    const next = idx >= 0 ? m.chapters.slice(idx + 1).find((c) => c.roles.includes(role)) : null;
    const ok = !!result.success;
    this.backdrop = createMenuBackdrop(game);
    this.backdrop.setFocus(0.6);
    this.backdrop.resize(game.width, game.height);
    await Promise.race([this.backdrop.loading, new Promise((r) => setTimeout(r, 4000))]);

    const items = result.score?.items ?? [];
    const st = result.stats ?? {};
    const achs = result.achievements ?? [];
    const history = ok ? chapter.history : chapter.historyFail ?? chapter.history;
    const canNext = next && (ok || isUnlocked(store, m.id, next.id));

    this.root = h(
      'div',
      { class: 'ui-screen debrief fade-in' },
      h(
        'div',
        { class: 'frame ticks debrief-card rise-in ui-scroll' },
        h(
          'div',
          { class: `grade-big ${ok ? '' : 'fail'}` },
          patchEl(m.patch, 'patch-lg'),
          h('div', { class: 'letter' }, ok ? result.grade ?? '—' : '✕'),
          h('div', { class: 'overline' }, ok ? 'Calificación' : 'Misión abortada'),
          ok && result.score ? h('div', { class: 'mono muted' }, `${result.score.total} / ${result.score.max} puntos`) : null,
        ),
        h(
          'div',
          null,
          h('div', { class: 'overline' }, meta.order ? `${m.name} · Capítulo ${String(meta.order).padStart(2, '0')}` : m.name),
          h('h2', null, ok ? `${meta.title}: completado` : `${meta.title}: fallido`),
          h('p', { style: { margin: '0 0 0.4rem', lineHeight: 1.55, color: '#dbe3ec' } }, ok ? result.summary || 'Objetivos cumplidos.' : result.reason || 'La misión no pudo completarse.'),
          items.length
            ? h(
                'div',
                { class: 'score-rows' },
                items.map((s, i) => {
                  const frac = s.max > 0 ? Math.max(0, Math.min(1, s.points / s.max)) : s.points >= 0 ? 1 : 0;
                  return h(
                    'div',
                    { class: 'score-row' },
                    h('span', null, s.note || s.key),
                    h('div', { class: 'bar' }, h('i', { style: { width: `${frac * 100}%`, animationDelay: `${0.3 + i * 0.12}s` } })),
                    h('span', { class: 'pts' }, s.max > 0 ? `${Math.round(s.points)}/${s.max}` : `${Math.round(s.points)}`),
                  );
                }),
              )
            : null,
          h(
            'div',
            { class: 'stats' },
            st.get !== undefined ? h('div', null, 'Reloj de misión', h('b', null, st.get < 0 ? MissionClock.formatT(st.get) : MissionClock.format(st.get))) : null,
            st.realTime !== undefined ? h('div', null, 'Tiempo jugado', h('b', null, fmtReal(st.realTime))) : null,
            ...Object.entries(st)
              .filter(([k]) => !['get', 'realTime'].includes(k) && typeof st[k] !== 'object')
              .map(([k, v]) => h('div', null, k, h('b', null, String(v)))),
          ),
          achs.length
            ? h(
                'div',
                { style: { marginTop: '1rem' } },
                h('div', { class: 'overline', style: { marginBottom: '0.5rem' } }, 'Logros desbloqueados'),
                h('div', { class: 'ach-grid' }, achs.map((id) => {
                  const a = achievementById(id);
                  return h('div', { class: 'ach' }, h('div', { class: 'medal' }, a.icon ?? '★'), h('div', null, h('b', null, a.name), h('small', null, a.desc)));
                })),
              )
            : null,
          history ? h('div', { class: 'history-note' }, h('b', null, 'En la historia real · '), history) : null,
          h(
            'div',
            { class: 'brief-actions', style: { marginTop: '1.2rem' } },
            canNext
              ? h('button', { class: 'btn btn-primary', on: { click: () => game.goto('briefing', { chapterId: next.id, role }) } }, 'Siguiente: ', next.title, icon('next'))
              : null,
            h('button', { class: `btn ${canNext ? '' : 'btn-primary'}`, on: { click: () => game.goto(chapterScene(chapterId), { chapterId, role, loadingText: `${m.name} · ${meta.title}`, loadingPatch: patchSVG(m.patch) }) } }, icon('restart'), 'Repetir'),
            h('button', { class: 'btn btn-ghost', on: { click: () => game.goto('menu', { screen: 'missions', missionId: m.id }) } }, icon('home'), 'Menú'),
          ),
        ),
      ),
    );
    game.uiRoot.append(this.root);
    game.audio?.music?.(ok ? 'triumph' : 'sad');
  }

  update(dt) {
    this.backdrop?.update(dt);
  }

  render() {
    this.backdrop?.render();
  }

  resize(w, h) {
    this.backdrop?.resize(w, h);
  }

  exit() {
    this.root?.remove();
    this.backdrop?.dispose();
  }
}
