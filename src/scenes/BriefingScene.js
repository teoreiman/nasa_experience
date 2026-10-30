// Pre-chapter briefing over the menu backdrop: patch, date and place, summary, objectives,
// role-specific info (crew or the player's MOCR console), key controls, tips → "Comenzar".
//   enter({ chapterId, role })

import { h } from '../core/dom.js';
import { store } from '../core/Store.js';
import { MISSION_EPOCH } from '../core/constants.js';
import { MissionClock } from '../core/MissionClock.js';
import { loadChapter } from '../missions/registry.js';
import { createMenuBackdrop } from '../render/MenuBackdrop.js';
import { createCinematicBackdrop } from '../render/CinematicBackdrop.js';
import { icon, patchEl, patchSVG } from '../ui/components.js';

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export const CONSOLE_INFO = {
  FLIGHT: ['Director de vuelo', 'Tiene la última palabra en todo. Escucha a cada consola y decide.'],
  CAPCOM: ['Comunicador con la cápsula', 'La única voz de Houston que habla con la tripulación; siempre un astronauta.'],
  BOOSTER: ['Sistemas del lanzador', 'Motores, etapas y guiado del Saturn V. Puede pedir el aborto.'],
  RETRO: ['Oficial de retrofuego', 'Planes de aborto y de regreso a la Tierra: encendidos de retorno y reentrada.'],
  FIDO: ['Dinámica de vuelo', 'La trayectoria: órbitas, maniobras y PAD de encendido.'],
  GUIDO: ['Oficial de guiado', 'Los ordenadores de a bordo (AGC) y la navegación. Las alarmas 1201/1202 son suyas.'],
  SURGEON: ['Médico de vuelo', 'Ritmo cardíaco, respiración y salud de la tripulación.'],
  EECOM: ['Sistemas eléctricos y ambientales', 'Pilas de combustible, tanques criogénicos, buses eléctricos y soporte vital del CSM.'],
  GNC: ['Guiado, navegación y control', 'Actitud, propulsores RCS y el motor SPS del módulo de servicio.'],
  TELMU: ['Sistemas del LM', 'Energía, comunicaciones y soporte vital del módulo lunar.'],
  CONTROL: ['Control del LM', 'Guiado, navegación y propulsión del módulo lunar.'],
  INCO: ['Instrumentación y comunicaciones', 'Antenas, enlaces de datos y televisión.'],
  PROCEDURES: ['Procedimientos', 'Las listas de comprobación y las reglas de vuelo.'],
  FAO: ['Planificación de actividades', 'El plan de vuelo y las tareas de la tripulación.'],
  NETWORK: ['Red de seguimiento', 'Las estaciones de la red de vuelos tripulados en todo el mundo.'],
};

function controlsFor(chapter, role) {
  if (role === 'controller') {
    return [
      [['W', 'A', 'S', 'D'], 'Caminar por la sala'],
      [['Ratón'], 'Mirar (clic para capturar el puntero)'],
      [['E'], 'Sentarse / levantarse de una consola'],
      [['Clic'], 'Pulsar botones de la consola'],
      [['T'], 'Ver la TV de la nave'],
      [['.', ','], 'Acelerar / frenar el tiempo'],
    ];
  }
  const id = chapter.id;
  const base = [
    [['Clic'], 'Accionar controles · clic derecho: tapa protectora'],
    [['Arrastrar'], 'Mirar alrededor · rueda: zoom'],
    [['C', 'V'], 'Cámara exterior · siguiente cámara'],
    [['Tab'], 'Lista de comprobación'],
  ];
  if (/landing/.test(id)) {
    return [
      [['W', 'A', 'S', 'D', 'Q', 'E'], 'Actitud del LM (inclinar = moverse)'],
      [['Inicio', 'Fin'], 'Velocidad de descenso ±1 pie/s en P66'],
      [['← → ↑ ↓'], 'Redesignar el punto de alunizaje en P64'],
      [['RePág', 'AvPág'], 'Acelerador manual'],
      ...base.slice(2),
    ];
  }
  if (/docking|tde|ascent|undock/.test(id)) {
    return [
      [['I', 'K', 'J', 'L', 'U', 'O'], 'Traslación RCS (adelante/atrás, lados, arriba/abajo)'],
      [['W', 'A', 'S', 'D', 'Q', 'E'], 'Rotación'],
      ...base,
    ];
  }
  if (/entry/.test(id)) {
    return [[['Q', 'E'], 'Alabeo: orienta el vector de sustentación'], ...base, [['.', ','], 'Acelerar / frenar el tiempo']];
  }
  if (/mcc5|freereturn|loi|tei|tli|pc2/.test(id)) {
    return [[['W', 'A', 'S', 'D', 'Q', 'E'], 'Rotación manual'], ...base, [['.', ','], 'Acelerar / frenar el tiempo'], [['F8'], 'Saltar al siguiente evento']];
  }
  return [...base, [['.', ','], 'Acelerar / frenar el tiempo'], [['F8'], 'Saltar al siguiente evento']];
}

export default class BriefingScene {
  constructor(game) {
    this.game = game;
  }

  async enter({ chapterId, role = store.session.role ?? 'astronaut' }) {
    const game = this.game;
    store.session.role = role;
    const { mission, chapter } = await loadChapter(chapterId);
    const launch = /launch|lightning/.test(chapterId);
    this.backdrop = launch ? createCinematicBackdrop(game, { shots: ['dawn', 'ignition', 'tower', 'ascent'] }) : createMenuBackdrop(game);
    this.backdrop.setFocus(launch ? 0.9 : 1.4);
    this.backdrop.resize(game.width, game.height);
    await Promise.race([this.backdrop.loading, new Promise((r) => setTimeout(r, 5000))]);

    const b = chapter.briefing ?? {};
    const isCtl = role === 'controller';
    const summary = (isCtl && b.controller?.summary) || b.summary || chapter.subtitle;
    const objectives = (isCtl && b.controller?.objectives) || b.objectives || [];
    const tips = (isCtl && b.controller?.tips) || b.tips || [];
    const epoch = MISSION_EPOCH[mission.id] ?? MISSION_EPOCH.apollo11;
    const get = chapter.setup?.get ?? chapter.getStart ?? 0;
    const d = new Date(epoch + get * 1000);
    const when = `${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]} de ${d.getUTCFullYear()} · ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
    const getStr = get < 0 ? MissionClock.formatT(get) : `GET ${MissionClock.format(get)}`;
    const keys = controlsFor(chapter, role);
    const consoleId = chapter.controllerRole;
    const ci = CONSOLE_INFO[consoleId];

    const start = () => {
      game.audio?.unlock?.();
      game.audio?.sfx?.('uiConfirm');
      game.goto(chapter.id === 'a11-eva' ? 'eva' : 'play', { chapterId, role, loadingText: `${mission.name} · ${chapter.title}`, loadingPatch: patchSVG(mission.patch) });
    };
    this._onKey = (e) => {
      if (e.code === 'Enter' || e.code === 'Space') start();
      if (e.code === 'Escape') game.goto('menu', { screen: 'missions', missionId: mission.id });
    };
    window.addEventListener('keydown', this._onKey);

    this.root = h(
      'div',
      { class: 'ui-screen briefing fade-in', style: { background: 'linear-gradient(90deg, rgba(2,4,8,0.9), rgba(2,4,8,0.55) 60%, rgba(2,4,8,0.35))' } },
      h(
        'div',
        { class: 'col rise-in' },
        h(
          'div',
          { class: 'brief-head' },
          patchEl(mission.patch, 'patch-lg'),
          h(
            'div',
            null,
            h('div', { class: 'overline' }, `${mission.name} · Capítulo ${String(chapter.order).padStart(2, '0')} · ${isCtl ? 'Control de Misión' : 'Tripulación'}`),
            h('h1', null, chapter.title),
            h('div', { class: 'sub' }, chapter.subtitle),
            h('div', { class: 'mission-meta' }, h('span', null, icon('clock'), ' ', when), h('span', { class: 'mono' }, getStr), h('span', null, `≈ ${chapter.minutes} min`)),
          ),
        ),
        h('div', { class: 'frame ticks brief-card' }, h('h3', null, 'Situación'), h('p', null, summary)),
        objectives.length ? h('div', { class: 'frame brief-card' }, h('h3', null, 'Objetivos'), h('ul', { class: 'obj-list' }, objectives.map((o) => h('li', null, o)))) : null,
        h(
          'div',
          { class: 'brief-actions' },
          h('button', { class: 'btn btn-primary btn-lg', on: { click: start } }, icon('play'), 'Comenzar misión'),
          h('button', { class: 'btn btn-ghost', on: { click: () => game.goto('menu', { screen: 'missions', missionId: mission.id }) } }, icon('back'), 'Volver'),
          h('span', { class: 'muted', style: { fontSize: '0.8rem' } }, 'Intro para comenzar'),
        ),
      ),
      h(
        'div',
        { class: 'col rise-in ui-scroll', style: { animationDelay: '0.12s' } },
        isCtl && ci
          ? h('div', { class: 'frame ticks brief-card' }, h('h3', null, `Tu consola · ${consoleId}`), h('p', null, h('b', null, ci[0]), ' — ', ci[1]))
          : mission.crew
            ? h(
                'div',
                { class: 'frame brief-card' },
                h('h3', null, 'Tripulación'),
                h('div', { class: 'crew-row' }, Object.entries(mission.crew).map(([k, v]) => h('div', null, h('b', null, v), { CDR: 'Comandante', CMP: 'Piloto del CM', LMP: 'Piloto del LM' }[k]))),
                mission.callsigns ? h('p', { class: 'muted', style: { marginTop: '0.6rem', fontSize: '0.85rem' } }, Object.entries(mission.callsigns).map(([k, v]) => `${k} «${v}»`).join(' · ')) : null,
              )
            : null,
        h('div', { class: 'frame brief-card' }, h('h3', null, 'Controles clave'), h('div', { class: 'keys' }, keys.flatMap(([ks, desc]) => [h('span', { class: 'k' }, ks.map((k) => h('kbd', null, k))), h('span', null, desc)]))),
        tips.length ? h('div', { class: 'frame brief-card' }, h('h3', null, 'Consejos'), h('ul', { class: 'tip-list' }, tips.map((t) => h('li', null, t)))) : null,
        h(
          'div',
          { class: 'frame brief-card' },
          h('h3', null, 'Dificultad'),
          h('p', { class: 'muted', style: { fontSize: '0.9rem' } }, {
            cadet: 'Cadete — pistas, controles resaltados y botón «Auto» en las listas. Puedes pedir ayuda al piloto automático.',
            astronaut: 'Astronauta — pistas y controles resaltados, sin piloto automático en los tramos de pilotaje.',
            realistic: 'Realista — sin pistas ni resaltados. Como en 1969.',
          }[store.settings.difficulty] ?? ''),
        ),
      ),
    );
    game.uiRoot.append(this.root);
    game.audio?.music?.('briefing');
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
    window.removeEventListener('keydown', this._onKey);
    this.root?.remove();
    this.backdrop?.dispose();
  }
}
