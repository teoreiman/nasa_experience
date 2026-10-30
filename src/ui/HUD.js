// In-mission HTML overlay: mission clock & time warp, objectives, crew checklist, radio subtitles
// and comm log, phase-dependent telemetry strip, landing / docking instruments, burn PAD card,
// alerts, hints, captions, decisions and Mission Control tasks/polls, pause and help, touch
// controls. Driven by the sim bus events of docs/ARCHITECTURE.md §11.

import { h, clear } from '../core/dom.js';
import { MissionClock } from '../core/MissionClock.js';
import { store } from '../core/Store.js';
import { FT, NMI, R_EARTH, R_MOON } from '../core/constants.js';
import { icon, iconSVG, openSettings, openModal, helpContent, toast, achievementById } from './components.js';
import { ProcedureTracker } from './ProcedureTracker.js';
import { PROCEDURES } from '../missions/common/procedures.js';
import { availableServices } from '../missions/free/index.js';

const CAMERA_NAMES = {
  cockpit: 'Cabina',
  'exterior:chase': 'Exterior',
  'exterior:wide': 'Exterior lejana',
  'pad:far': 'Cámara de seguimiento',
  'pad:tower': 'Torre umbilical',
  'pad:deck': 'Plataforma · motores',
  onboard: 'Cámara a bordo (S-II)',
  surface: 'Cámara de superficie',
  target: 'Objetivo',
  free: 'Libre',
};

const CW_ES = {
  MAIN_BUS_A_UNDERVOLT: 'Subtensión en el bus principal A',
  MAIN_BUS_B_UNDERVOLT: 'Subtensión en el bus principal B',
  FC_1: 'Pila de combustible 1',
  FC_2: 'Pila de combustible 2',
  FC_3: 'Pila de combustible 3',
  FC_BUS_DISCONNECT: 'Pila de combustible desconectada del bus',
  CRYO_PRESS: 'Presión criogénica',
  O2_FLOW_HI: 'Flujo de O₂ alto',
  CO2_PP_HI: 'CO₂ alto',
  AC_BUS_1: 'Bus de corriente alterna 1',
  AC_BUS_2: 'Bus de corriente alterna 2',
  DES_QTY: 'Combustible de descenso bajo',
};

const fmtInt = (n) => Math.round(n).toLocaleString('es-AR');

export class HUD {
  constructor({ game, sim, view, role, chapter, mission, actions }) {
    this.game = game;
    this.sim = sim;
    this.view = view;
    this.role = role;
    this.chapter = chapter;
    this.mission = mission;
    this.actions = actions;
    this.objectives = new Map();
    this.subLines = new Map();
    this.log = [];
    this.checklist = null;
    this.clCollapsed = false;
    this.hidden = false;
    this._tlmAcc = 1;
    this._lastAlarmAlert = -10;
    this._tlmSig = '';
    const bus = sim.bus;

    // ---- skeleton
    this.root = h('div', { class: 'hud' });
    this.clockTitle = h('div', { class: 'title' }, `${mission.name} · ${chapter.title}`);
    this.clockLbl = h('div', { class: 'lbl' }, 'GET');
    this.clockVal = h('div', { class: 'val' }, '000:00:00');
    this.warpVal = h('div', { class: 'val' }, '×1');
    this.clockEl = h(
      'div',
      { class: 'frame hud-clock hud-keep' },
      h('div', { class: 'blk' }, h('div', { class: 'lbl' }, role === 'controller' ? `Houston · ${chapter.controllerRole ?? 'FLIGHT'}` : 'Misión'), this.clockTitle),
      h('div', { class: 'blk' }, this.clockLbl, this.clockVal),
      h(
        'div',
        { class: 'blk' },
        h('div', { class: 'lbl' }, 'Tiempo'),
        h(
          'div',
          { class: 'warp' },
          h('button', { title: 'Frenar (,)', on: { click: () => this._warp(-1) } }, '−'),
          this.warpVal,
          h('button', { title: 'Acelerar (.)', on: { click: () => this._warp(1) } }, '+'),
        ),
      ),
    );
    this.objEl = h('div', { class: 'hud-objectives' });
    this.clEl = h('div', { class: 'frame hud-checklist', hidden: true });
    this.alertsEl = h('div', { class: 'hud-alerts' });
    this.subsEl = h('div', { class: 'hud-subs' });
    this.hintEl = null;
    this.tlmEl = h('div', { class: 'frame hud-telemetry' });
    this.camEl = h('div', { class: 'frame hud-cam' });
    this.toolsEl = h(
      'div',
      { class: 'hud-tools' },
      this.camEl,
      role === 'astronaut' ? h('button', { class: 'btn btn-icon', title: 'Cámara (C)', on: { click: () => this._camera() } }, icon('camera')) : h('button', { class: 'btn btn-icon', title: 'TV de la nave (T)', on: { click: () => actions.toggleView?.() } }, icon('camera')),
      chapter.free ? h('button', { class: 'btn btn-sm hud-houston-btn', title: 'Pedir a Houston', on: { click: () => this._toggleHouston() } }, icon('headset'), 'Houston') : null,
      role === 'astronaut' ? h('button', { class: 'btn btn-icon', title: 'Manual de procedimientos (B)', on: { click: () => this._openProcedures() } }, icon('book')) : null,
      h('button', { class: 'btn btn-icon', title: 'Lista de comprobación (Tab)', on: { click: () => this._toggleChecklist() } }, icon('list')),
      h('button', { class: 'btn btn-icon', title: 'Registro de comunicaciones (G)', on: { click: () => this._toggleLog() } }, icon('log')),
      h('button', { class: 'btn btn-icon', title: 'Ayuda (F1)', on: { click: () => this._help() } }, icon('help')),
      h('button', { class: 'btn btn-icon', title: 'Pausa (Esc)', on: { click: () => actions.resume && this.game.scene?.setPaused?.(true) } }, icon('pause')),
    );
    this.instrEl = h('div', { class: 'frame hud-instr', hidden: true });
    this.padEl = null;
    this.logEl = null;
    this.modals = new Map(); // decision cards by key ('c:<choice id>' | 'g:<ground task id>')
    this.helpModal = null;
    this.pollEl = null;
    this.crewLogEl = role === 'controller' ? h('div', { class: 'hud-crewlog' }) : null;
    this.skipEl = h('button', { class: 'btn hud-skip', hidden: true, on: { click: () => bus.emit('mission:skipRequest') } }, icon('skip'), h('span', null, 'Saltar'));
    this.pauseEl = this._buildPause();
    this.root.append(this.clockEl, this.objEl, this.clEl, this.alertsEl, this.subsEl, this.tlmEl, this.instrEl, this.toolsEl, this.skipEl, this.pauseEl);
    this.tracker = role === 'astronaut' ? new ProcedureTracker(sim) : null;
    this.houstonEl = null;
    if (this.crewLogEl) this.root.append(this.crewLogEl);
    game.uiRoot.append(this.root);
    if (game.input.isTouch && role === 'astronaut') this._buildTouch();

    // ---- bus
    this._off = [
      bus.on('mission:say', (l) => this._say(l)),
      bus.on('mission:sayEnd', ({ id }) => this._sayEnd(id)),
      bus.on('mission:objective', (o) => this._objective(o)),
      bus.on('mission:checklist', (c) => this._checklist(c)),
      // one card per decision (a ground task can arrive while a choice is open): each closes by id
      bus.on('mission:choice', (c) => this._decision({ key: `c:${c.id}`, title: c.title, prompt: c.prompt, options: c.options, timeoutS: c.timeoutS, resolve: c.resolve, overline: 'Decisión' })),
      bus.on('mission:choiceEnd', ({ id }) => this._closeModal(`c:${id}`)),
      // Mission Control tasks dock without a backdrop: the controller keeps walking, looking and
      // pressing console buttons (the console's GO / NO GO keys answer them too)
      bus.on('mission:groundTask', (t) => this._decision({ key: `g:${t.id}`, docked: true, title: t.title, prompt: t.prompt, options: t.options, timeoutS: t.timeoutS, resolve: t.resolve, overline: `Consola ${t.console}`, evidence: t.evidence, hint: t.hint })),
      bus.on('mission:groundTaskEnd', ({ id }) => this._closeModal(`g:${id}`)),
      bus.on('mission:caption', (c) => this._caption(c)),
      bus.on('mission:alert', (a) => this._alert(a.text, a.level, a.durationS)),
      bus.on('mission:hint', (x) => this._hint(x.text, x.durationS)),
      bus.on('mission:task', (x) => this._task(x.text)),
      bus.on('mission:photo', (p) => this._photo(p)),
      bus.on('mission:pad', ({ pad }) => this._pad(pad)),
      bus.on('mission:score', (s) => this._scorePop(s)),
      bus.on('mission:achievement', ({ id }) => {
        const a = achievementById(id);
        toast({ title: a.name, text: a.desc, icon: a.icon ?? '★' });
        game.audio?.sfx?.('uiConfirm');
      }),
      bus.on('mission:poll', (p) => this._poll(p)),
      bus.on('mission:crewAction', ({ text }) => this._crewAction(text)),
      bus.on('mission:skipAvailable', (s) => {
        this.skipEl.hidden = !s;
        if (s) this.skipEl.lastChild.textContent = `Saltar · ${s.label ?? 'siguiente evento'} (F8)`;
      }),
      bus.on('mission:end', (r) => this._end(r)),
      bus.on('mission:error', ({ error }) => this._alert(`Error del guion: ${error?.message ?? error}`, 'warning', 8)),
      bus.on('view:camera', ({ mode }) => this._setCam(mode)),
      bus.on('view:seat', ({ name }) => this._setCam(null, name)),
      bus.on('view:changed', ({ view: v }) => this._setCam(v === 'tv' ? 'TV de la nave' : 'Control de Misión')),
      bus.on('mocr:seat', ({ console: c }) => this._setCam(null, c ? `Consola ${c}` : 'De pie')),
      bus.on('cw:alarm', ({ vehicle, lamp, warn }) => {
        const t = this.sim.clock.get;
        if (t - this._lastAlarmAlert < 1.2) return;
        this._lastAlarmAlert = t;
        this._alert(`ALARMA MAESTRA (${vehicle}) · ${CW_ES[lamp] ?? lamp.replace(/_/g, ' ')}`, warn ? 'warning' : 'caution', 5);
      }),
      bus.on('agc:alarm', ({ agc, code }) => this._alert(`ALARMA DE PROGRAMA ${code} · ${agc === 'LGC' ? 'ordenador del LM' : 'ordenador del CM'}`, 'caution', 6)),
      // the crew authorizes every computer-flown ignition: make the 5-second V99 window obvious
      bus.on('agc:v99', ({ agc }) => {
        if (role === 'astronaut' && agc === this.sim.gnc?.activeComputer?.id) this._alert('V99 · el ordenador pide permiso para encender: pulsa PRO en el DSKY (tecla P con el cursor encima)', 'caution', 7);
      }),
      bus.on('vehicle:event', (e) => this._event(e)),
    ];
    this._setCam(view?.cameraMode ?? (role === 'controller' ? null : 'cockpit'), role === 'controller' ? 'Control de Misión' : null);
    this._render();
  }

  // ---------------------------------------------------------------- clock & warp

  _warp(dir) {
    const c = this.sim.clock;
    if (dir > 0) c.warpUp();
    else c.warpDown();
    this.game.audio?.sfx?.('uiClick', { gain: 0.5 });
  }

  _camera() {
    if (this.view?.setCamera) this.view.setCamera(this.view.cameraMode === 'cockpit' ? 'exterior:chase' : 'cockpit');
  }

  _setCam(mode, label = null) {
    const name = label ?? CAMERA_NAMES[mode] ?? mode ?? '';
    this.camEl.innerHTML = '';
    this.camEl.append(h('span', null, 'Vista · '), h('b', null, name));
  }

  // ---------------------------------------------------------------- comms

  _say(l) {
    this._pushLog(l);
    const showSubs = store.settings.subtitles || store.settings.voiceMode === 'text';
    if (!showSubs) return;
    const isCrew = ['CDR', 'CMP', 'LMP'].includes(l.who);
    const chName = { ag: 'aire-tierra', ic: 'intercomunicador', loop: 'bucle de FLIGHT', pao: 'asuntos públicos', narration: '' }[l.channel] ?? '';
    const showEn = store.settings.showOriginal && store.settings.voiceMode !== 'es' && l.en && l.es && l.en !== l.es;
    const el = h(
      'div',
      { class: 'sub-line' },
      h('span', { class: `who ${isCrew ? 'crew' : l.channel === 'loop' ? 'loop' : ''}` }, l.whoLabel ?? l.who, chName ? h('span', { class: 'ch' }, `· ${chName}`) : null),
      h('span', { class: 'es' }, l.es ?? l.en),
      showEn ? h('span', { class: 'en' }, l.en) : null,
    );
    this.subsEl.append(el);
    while (this.subsEl.children.length > 2) this.subsEl.firstChild.remove();
    this.subLines.set(l.id, el);
    // safety: remove long-lived lines
    setTimeout(() => this._sayEnd(l.id), (l.durationS + 14) * 1000);
  }

  _sayEnd(id) {
    const el = this.subLines.get(id);
    if (!el) return;
    this.subLines.delete(id);
    setTimeout(() => {
      el.style.transition = 'opacity 0.4s';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 450);
    }, 900);
  }

  _pushLog(l) {
    this.log.push({ t: this.sim.clock.get, who: l.whoLabel ?? l.who, es: l.es ?? l.en, en: l.en });
    if (this.log.length > 200) this.log.shift();
    if (this.logEl) this._renderLog();
  }

  _toggleLog() {
    if (this.logEl) {
      this.logEl.remove();
      this.logEl = null;
      return;
    }
    this.logEl = h('div', { class: 'frame hud-log' }, h('div', { class: 'cl-head', on: { click: () => this._toggleLog() } }, h('span', { class: 't' }, 'Registro de comunicaciones'), icon('close')), h('div', { class: 'body ui-scroll' }));
    this.root.append(this.logEl);
    this._renderLog();
  }

  _renderLog() {
    const body = this.logEl.lastChild;
    clear(body).append(
      ...this.log.slice(-60).map((x) =>
        h('div', { class: 'ln' }, h('span', { class: 't' }, MissionClock.format(x.t)), h('span', { class: 'w' }, x.who), x.es),
      ),
    );
    body.scrollTop = body.scrollHeight;
  }

  // ---------------------------------------------------------------- objectives / checklist

  _objective(o) {
    let el = this.objectives.get(o.id);
    if (!el) {
      el = h('div', { class: 'hud-obj' }, h('span', { class: 'mk' }), h('span', { class: 'txt' }));
      this.objectives.set(o.id, el);
      this.objEl.append(el);
    }
    el.className = `hud-obj ${o.state} ${o.optional ? 'optional' : ''}`;
    el.querySelector('.txt').textContent = o.text;
    if (o.state === 'done') {
      this.game.audio?.sfx?.('uiConfirm', { gain: 0.5 });
      setTimeout(() => {
        el.style.opacity = '0';
        setTimeout(() => {
          el.remove();
          this.objectives.delete(o.id);
        }, 700);
      }, 6000);
    }
  }

  _toggleChecklist() {
    this.clCollapsed = !this.clCollapsed;
    this.clEl.classList.toggle('collapsed', this.clCollapsed);
  }

  _checklist(c) {
    if (c.state === 'done') {
      if (this.checklist?.id === c.id) {
        this._renderChecklist(c);
        setTimeout(() => {
          if (this.checklist?.id === c.id) {
            this.clEl.hidden = true;
            this.checklist = null;
          }
        }, 2500);
      }
      return;
    }
    this.checklist = c;
    this.clEl.hidden = false;
    this._renderChecklist(c);
  }

  _renderChecklist(c) {
    const done = c.items.filter((i) => i.done).length;
    const cur = c.items.find((i) => !i.done && !i.optional) ?? c.items.find((i) => !i.done);
    const cadet = store.settings.difficulty === 'cadet';
    const realistic = store.settings.difficulty === 'realistic';
    const bus = this.sim.bus;
    fill(this.clEl,
      h('div', { class: 'cl-head', on: { click: () => this._toggleChecklist() } }, iconSVGEl('list'), h('span', { class: 't' }, c.title), h('span', { class: 'count' }, `${done}/${c.items.length}`)),
      c.mode === 'ai' ? h('div', { class: 'cl-ai' }, this.role === 'controller' ? 'La tripulación ejecuta la lista. Vigila la telemetría.' : 'Lista ejecutada por la tripulación.') : null,
      h(
        'div',
        { class: 'cl-body ui-scroll' },
        c.items.map((i) =>
          h(
            'div',
            { class: `cl-item ${i.done ? 'done' : ''} ${i === cur && c.mode === 'player' ? 'current' : ''}` },
            h('span', { class: 'box' }),
            h('span', { class: 'txt' }, i.text, i.hint && !i.done && i === cur && !realistic ? h('span', { class: 'hint' }, i.hint) : null),
            !i.done && c.mode === 'player' && (i.manual || cadet || (i.assist && i === cur && !realistic))
              ? h('button', {
                  class: `act ${i.assist && !i.manual && !cadet ? 'assist' : ''}`,
                  title: i.assist && !i.manual ? 'El piloto automático lo hace por ti (resta puntos)' : '',
                  on: { click: () => bus.emit(i.manual ? 'mission:checklistConfirm' : 'mission:checklistAuto', { checklistId: c.id, itemId: i.id }) },
                }, i.manual ? 'Hecho' : cadet ? 'Auto' : 'Ayuda')
              : null,
          ),
        ),
      ),
    );
    this.clEl.classList.toggle('collapsed', this.clCollapsed);
  }

  // ---------------------------------------------------------------- captions, alerts, hints

  _caption({ text, sub, durationS = 5 }) {
    this.captionEl?.remove();
    const el = h('div', { class: 'hud-caption' }, h('div', { class: 'c1' }, text), sub ? h('div', { class: 'c2' }, sub) : null);
    this.captionEl = el;
    this.root.append(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 1200);
    }, durationS * 1000);
  }

  _alert(text, level = 'info', durationS = 5) {
    const el = h('div', { class: `alert ${level}` }, h('span', { class: 'ic' }), h('span', null, text));
    this.alertsEl.append(el);
    while (this.alertsEl.children.length > 3) this.alertsEl.firstChild.remove();
    if (level === 'warning') this.game.audio?.sfx?.('uiWarn');
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 500);
    }, durationS * 1000);
  }

  /** A photograph taken in the mission (polaroid that slides in, then away). */
  _photo({ url, title = '', caption = '', durationS = 10 }) {
    if (!url) return;
    this.photoEl?.remove();
    const el = h('figure', { class: 'hud-photo' }, h('img', { src: url, alt: title }), h('figcaption', null, h('b', null, title), caption ? h('span', null, caption) : null));
    this.photoEl = el;
    this.root.append(el);
    this.game.audio?.sfx?.('uiConfirm');
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 900);
    }, durationS * 1000);
  }

  /** Persistent live readout from the mission script (updated in place; empty text hides it). */
  _task(text) {
    if (!text) {
      this.taskEl?.remove();
      this.taskEl = null;
      return;
    }
    if (!this.taskEl) {
      this.taskEl = h('div', { class: 'hud-task' }, iconSVGEl('info'), h('span'));
      this.root.append(this.taskEl);
    }
    this.taskEl.lastChild.textContent = text;
  }

  _hint(text, durationS = 8) {
    this.hintEl?.remove();
    const el = h('div', { class: 'hud-hint' }, iconSVGEl('hint'), h('span', null, text));
    this.hintEl = el;
    this.root.append(el);
    clearTimeout(this._hintT);
    this._hintT = setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 500);
    }, durationS * 1000);
  }

  _scorePop(s) {
    if (!s.note || s.points === 0) return;
    const good = s.points > 0;
    this._alert(`${good ? '+' : ''}${Math.round(s.points)} · ${s.note}`, good ? 'success' : 'caution', 3.5);
  }

  _event(e) {
    const names = {
      LIFTOFF: ['¡Despegue!', 'success'],
      TOWER_CLEAR: ['Torre superada', 'info'],
      SIC_CECO: ['Apagado del motor central del S-IC', 'info'],
      SIC_SEP: ['Separación de la primera etapa (S-IC)', 'info'],
      SIB_SEP: ['Separación de la primera etapa (S-IB)', 'info'],
      SII_IGNITION: ['Ignición de la segunda etapa (S-II)', 'info'],
      SII_INTERSTAGE_JETT: ['Interetapa expulsada', 'info'],
      LES_JETT: ['Torre de escape desechada', 'success'],
      SII_CECO: ['Apagado del motor central del S-II', 'info'],
      SII_SEP: ['Separación de la segunda etapa (S-II)', 'info'],
      SIVB_IGNITION: ['Ignición del S-IVB', 'info'],
      SIVB_CUTOFF: ['Apagado del S-IVB', 'info'],
      ORBIT_INSERTION: ['Inserción en órbita', 'success'],
      TLI_IGNITION: ['Ignición de inyección translunar', 'info'],
      TLI_CUTOFF: ['Fin de la inyección translunar', 'success'],
      DOCK_CAPTURE: ['Captura: los cerrojos del acoplamiento enganchan', 'success'],
      DOCK_HARD: ['Acoplamiento firme', 'success'],
      DOCK_BOUNCE: ['¡Rebote! Velocidad de cierre excesiva', 'caution'],
      UNDOCK: ['Desacoplados', 'info'],
      ENTRY_INTERFACE: ['Interfaz de reentrada: 400.000 pies', 'caution'],
      BLACKOUT_START: ['Apagón de comunicaciones por el plasma', 'caution'],
      BLACKOUT_END: ['Fin del apagón de comunicaciones', 'info'],
      DROGUE_DEPLOY: ['Paracaídas estabilizadores desplegados', 'success'],
      MAIN_DEPLOY: ['Paracaídas principales desplegados', 'success'],
      SPLASHDOWN: ['Amerizaje', 'success'],
      CM_SM_SEP: ['Separación del módulo de servicio', 'info'],
      LM_ASC_LIFTOFF: ['Despegue de la etapa de ascenso', 'success'],
    };
    const n = names[e.kind];
    if (n) this._alert(n[0], n[1], 4);
    if (e.kind === 'TOUCHDOWN') this._alert(e.crash ? 'Impacto contra la superficie' : 'Luz de contacto · alunizaje', e.crash ? 'warning' : 'success', 5);
  }

  // ---------------------------------------------------------------- PAD

  _pad(pad) {
    this.padEl?.remove();
    const f = (v, d = 1) => (v === undefined || v === null || Number.isNaN(v) ? '—' : (v >= 0 ? '+' : '') + Number(v).toFixed(d));
    const rows = [
      ['TIG (GET)', pad.tig !== undefined ? MissionClock.format(pad.tig) : '—'],
      ['ΔV X (pies/s)', f(pad.dv?.x !== undefined ? pad.dv.x / FT : undefined)],
      ['ΔV Y', f(pad.dv?.y !== undefined ? pad.dv.y / FT : undefined)],
      ['ΔV Z', f(pad.dv?.z !== undefined ? pad.dv.z / FT : undefined)],
      ['ΔV total', pad.dvTotal !== undefined ? `${(pad.dvTotal / FT).toFixed(1)}` : '—'],
      ['Duración', pad.burnTime !== undefined ? `${Math.floor(pad.burnTime / 60)}:${String(Math.round(pad.burnTime % 60)).padStart(2, '0')}` : '—'],
      ['Motor', pad.engine ?? '—'],
      pad.ha !== undefined ? ['HA / HP (nmi)', `${Math.round(pad.ha)} / ${Math.round(pad.hp)}`] : null,
      pad.attitude ? ['R / P / Y', `${Math.round(pad.attitude.roll)} / ${Math.round(pad.attitude.pitch)} / ${Math.round(pad.attitude.yaw)}`] : null,
    ].filter(Boolean);
    this.padEl = h(
      'div',
      { class: 'hud-pad' },
      h('span', { class: 'x', title: 'Cerrar', on: { click: () => (this.padEl.remove(), (this.padEl = null)) } }, '✕'),
      h('h5', null, h('span', null, 'P30 · PAD'), h('span', null, pad.name ?? '')),
      rows.map(([a, b]) => h('div', { class: 'r' }, h('span', null, a), h('span', null, b))),
      pad.notes ? h('div', { class: 'note' }, pad.notes) : null,
    );
    this.root.append(this.padEl);
    this.game.audio?.sfx?.('paper');
  }

  // ---------------------------------------------------------------- decisions / ground tasks / polls

  _decision({ key = 'modal', docked = false, title, prompt, options, timeoutS, resolve, overline, evidence = [], hint }) {
    this._closeModal(key);
    const tm = this.sim.vehicle.tm;
    const evEl = evidence?.length ? h('div', { class: 'evidence' }) : null;
    const renderEv = () => {
      if (!evEl) return;
      clear(evEl).append(
        ...evidence.map((k) => {
          const v = tm[k];
          const txt = typeof v === 'number' ? (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)) : String(v ?? '—');
          return h('div', null, h('span', null, k.replace(/^(CM|LM)\./, '')), txt);
        }),
      );
    };
    renderEv();
    const timer = timeoutS ? h('div', { class: 'timer' }, h('i', { style: { transition: `transform ${timeoutS}s linear` } })) : null;
    const modal = h(
      'div',
      { class: 'frame ticks hud-modal' },
      h('div', { class: 'overline' }, overline),
      h('h3', null, title ?? ''),
      timer,
      h('p', null, prompt ?? ''),
      evEl,
      hint ? h('div', { class: 'hud-hint', style: { position: 'static', transform: 'none', margin: '0 0 0.9rem', maxWidth: 'none' } }, iconSVGEl('hint'), h('span', null, hint)) : null,
      h(
        'div',
        { class: 'opts' },
        options.map((o) =>
          h('button', {
            class: `btn opt ${/^GO$/.test(o.label) ? '' : ''}`,
            on: {
              click: () => {
                this.game.audio?.sfx?.('button');
                this._closeModal(key);
                resolve(o.id);
              },
            },
          }, h('span', null, o.label), o.detail || o.hint ? h('small', null, o.detail ?? o.hint) : null),
        ),
      ),
    );
    const el = h('div', { class: `hud-modal-wrap ${docked ? 'docked' : ''}` }, modal);
    this.modals.set(key, { el, timer: evEl ? setInterval(renderEv, 500) : null });
    this.root.append(el);
    if (!docked) this.game.input.exitPointerLock();
    if (timer) requestAnimationFrame(() => requestAnimationFrame(() => (timer.firstChild.style.transform = 'scaleX(0)')));
    this.game.audio?.sfx?.('uiAttention');
  }

  /** Close one decision card by key, or all of them. */
  _closeModal(key = null) {
    for (const [k, m] of this.modals) {
      if (key !== null && k !== key) continue;
      clearInterval(m.timer);
      m.el.remove();
      this.modals.delete(k);
    }
  }

  _poll(p) {
    if (p.state === 'done') {
      setTimeout(() => {
        this.pollEl?.remove();
        this.pollEl = null;
      }, 3000);
    }
    if (!this.pollEl) {
      this.pollEl = h('div', { class: 'frame ticks hud-poll' });
      this.root.append(this.pollEl);
    }
    clear(this.pollEl).append(
      h('div', { class: 'title' }, p.title),
      p.consoles.map((c) =>
        h(
          'div',
          { class: `poll-row ${c.isPlayer ? 'me' : ''}` },
          h('span', null, c.console),
          h('span', { class: c.answer === 'GO' ? 'go' : c.answer === 'NOGO' ? 'nogo' : 'wait' }, c.answer === 'GO' ? 'GO' : c.answer === 'NOGO' ? 'NO GO' : '· · ·'),
        ),
      ),
    );
  }

  _crewAction(text) {
    if (!this.crewLogEl) return;
    const el = h('div', null, h('b', null, 'Tripulación: '), text);
    this.crewLogEl.append(el);
    while (this.crewLogEl.children.length > 4) this.crewLogEl.firstChild.remove();
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 1000);
    }, 7000);
  }

  // ---------------------------------------------------------------- end of chapter

  _end(r) {
    this._closeModal();
    const el = h(
      'div',
      { class: 'hud-caption', style: { top: '38%' } },
      h('div', { class: 'c1', style: { color: r.success ? '#e9fff1' : '#ffd2cc' } }, r.success ? 'Capítulo completado' : 'Misión fallida'),
      h('div', { class: 'c2', style: { color: r.success ? 'var(--crt)' : 'var(--red)' } }, r.success ? `Calificación ${r.grade}` : r.reason ?? ''),
    );
    this.root.append(el);
    this.game.audio?.sfx?.(r.success ? 'uiConfirm' : 'uiWarn');
  }

  // ---------------------------------------------------------------- procedures & Houston

  _openProcedures() {
    const tr = this.tracker;
    if (!tr) return;
    const ctx = tr.ctx();
    const station = this.sim.vehicle.station;
    const phases = [...new Set(PROCEDURES.map((p) => p.phase))];
    let modal = null;
    const content = h(
      'div',
      { class: 'proc-book' },
      h('p', { class: 'muted', style: { margin: '0 0 0.8rem' } }, 'Listas de comprobación de a bordo. Elige una para seguirla en vivo: se marca sola cuando mueves los interruptores o cambia el estado de la nave.'),
      phases.map((ph) =>
        h(
          'div',
          { class: 'proc-phase' },
          h('h4', null, ph),
          PROCEDURES.filter((p) => p.phase === ph).map((p) => {
            let now = false;
            try {
              now = !!p.when?.(ctx);
            } catch {
              now = false;
            }
            const other = p.station && p.station !== station;
            return h(
              'button',
              {
                class: `proc-item ${now && !other ? 'now' : ''}`,
                disabled: other,
                on: {
                  click: () => {
                    tr.start(p);
                    this.clCollapsed = false;
                    modal?.close();
                    this.game.audio?.sfx?.('paper');
                  },
                },
              },
              h('b', null, p.title),
              h('small', null, `${p.items.length} pasos · ${p.station === 'LM' ? 'módulo lunar' : 'módulo de mando'}${now && !other ? ' · recomendado ahora' : ''}${other ? ' · desde la otra nave' : ''}`),
            );
          }),
        ),
      ),
    );
    modal = openModal({ title: 'Manual de procedimientos', content, wide: true });
  }

  _toggleHouston() {
    if (this.houstonEl) {
      this.houstonEl.remove();
      this.houstonEl = null;
      return;
    }
    const services = availableServices(this.sim);
    this.houstonEl = h(
      'div',
      { class: 'frame ticks hud-houston' },
      h('div', { class: 'title' }, 'Houston · servicios de vuelo'),
      services.map(([id, label, desc]) =>
        h('button', {
          class: 'btn opt',
          on: {
            click: () => {
              this.sim.bus.emit('free:service', { id });
              this.game.audio?.sfx?.('button');
              this._toggleHouston();
            },
          },
        }, h('span', null, label), desc ? h('small', null, desc) : null),
      ),
    );
    this.root.append(this.houstonEl);
    this.game.input.exitPointerLock();
  }

  // ---------------------------------------------------------------- pause & help

  _buildPause() {
    const a = this.actions;
    return h(
      'div',
      { class: 'hud-pause', hidden: true },
      h(
        'div',
        { class: 'frame ticks pause-card' },
        h('h2', null, 'Pausa'),
        h('button', { class: 'btn btn-primary', on: { click: () => a.resume() } }, icon('play'), 'Continuar'),
        h('button', { class: 'btn', on: { click: () => openSettings({ inGame: true }) } }, icon('settings'), 'Ajustes'),
        h('button', { class: 'btn', on: { click: () => this._help() } }, icon('help'), 'Controles'),
        this.chapter.free
          ? h('button', { class: 'btn', on: { click: () => { a.resume(); this.sim.bus.emit('free:end'); } } }, icon('flag'), 'Terminar vuelo')
          : h('button', { class: 'btn', on: { click: () => a.restart() } }, icon('restart'), 'Reiniciar capítulo'),
        h('button', { class: 'btn btn-ghost', on: { click: () => a.quit() } }, icon('home'), 'Salir al menú'),
      ),
    );
  }

  /** Controls overlay (F1 toggles it), with the blocks of the current place first. */
  _help() {
    if (this.helpModal) {
      this.helpModal.close();
      return;
    }
    const focus = this.role === 'controller' ? 'mocr' : this.chapter.setup?.scene === 'eva' || this.chapter.scene === 'eva' ? 'eva' : 'cockpit';
    this.game.input.exitPointerLock();
    this.helpModal = openModal({ title: 'Controles', wide: true, content: helpContent({ focus }), onClose: () => (this.helpModal = null) });
  }

  setPaused(p) {
    this.pauseEl.hidden = !p;
  }

  // ---------------------------------------------------------------- telemetry

  _phase() {
    const sim = this.sim;
    const v = sim.vehicle;
    const st = v.state;
    const mode = sim.dyn.mode;
    if (mode === 'PAD' || (mode === 'ASCENT' && v.hasSaturn)) return 'launch';
    if (mode === 'ENTRY' || mode === 'SPLASHED' || (st.primary === 'EARTH' && st.alt < 140000 && !v.hasSaturn && st.speed > 2500)) return 'entry';
    const dt = this._dockTel;
    if (dt && dt.range < 1500 && ['CSM', 'LM_ASC'].includes(v.config)) return 'docking';
    if (st.primary === 'MOON' && v.station === 'LM' && (st.alt < 40000 || st.landed)) return v.config === 'LM_ASC' ? 'ascent' : 'descent';
    if (st.primary === 'MOON') return 'lunar';
    if (st.alt > 3e6) return 'cislunar';
    return 'orbit';
  }

  _fmtAlt(m) {
    const metric = store.settings.units === 'metric';
    if (Number.isNaN(m)) return ['—', ''];
    if (metric) return Math.abs(m) < 10000 ? [fmtInt(m), 'm'] : [(m / 1000).toFixed(1), 'km'];
    const ft = m / FT;
    return Math.abs(ft) < 100000 ? [fmtInt(ft), 'ft'] : [(m / NMI).toFixed(1), 'nmi'];
  }

  _fmtVel(ms) {
    return store.settings.units === 'metric' ? [fmtInt(ms), 'm/s'] : [fmtInt(ms / FT), 'ft/s'];
  }

  _fmtRate(ms) {
    const metric = store.settings.units === 'metric';
    const v = metric ? ms : ms / FT;
    return [`${v >= 0 ? '+' : ''}${Math.abs(v) < 100 ? v.toFixed(1) : fmtInt(v)}`, metric ? 'm/s' : 'ft/s'];
  }

  _fmtDist(m) {
    const metric = store.settings.units === 'metric';
    return metric ? [fmtInt(m / 1000), 'km'] : [fmtInt(m / NMI), 'nmi'];
  }

  _fields() {
    const sim = this.sim;
    const v = sim.vehicle;
    const st = v.state;
    const tm = v.tm;
    const ph = this._phase();
    const F = [];
    const add = (lbl, [val, unit], cls = '', bar = null) => F.push({ lbl, val, unit, cls, bar });
    const burn = sim.gnc?.activeComputer?.burn;
    const burnFields = () => {
      if (!burn || burn.done) return;
      const tig = sim.clock.get - burn.tig;
      const sign = tig < 0 ? '-' : '+';
      const a = Math.abs(tig);
      add('TIG', [`${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(Math.floor(a % 60)).padStart(2, '0')}`, ''], tig > -30 && tig < 0 ? 'caution' : '');
      add('ΔV por ganar', this._fmtVel(burn.vg.length()), burn.firing ? 'good' : '');
    };
    if (ph === 'launch') {
      const sat = v.modules.saturn;
      add('Altitud', this._fmtAlt(Math.max(0, st.alt)));
      add('Velocidad', this._fmtVel(st.speed));
      add('Vertical', this._fmtRate(st.hdot));
      add('Aceleración', [st.gLoad.toFixed(2), 'g'], st.gLoad > 3.8 ? 'caution' : '');
      if (sat) add('Etapa', [{ SIC: 'S-IC', SIB: 'S-IB', SII: 'S-II', SIVB: 'S-IVB', SIVB_COAST: 'S-IVB', SIVB_TLI: 'S-IVB' }[sat.stage] ?? sat.stage, `${sat.enginesOn} mot.`], sat.thrust > 0 ? 'good' : '');
      if (st.alt > 60000 && Number.isFinite(st.apoAlt)) add('Apogeo', this._fmtAlt(st.apoAlt));
      if (st.dynPressure > 1000 && st.alt < 30000) add('Pres. dinámica', [(st.dynPressure / 47.88).toFixed(0), 'psf'], st.dynPressure > 30000 ? 'caution' : '');
    } else if (ph === 'entry') {
      add('Altitud', this._fmtAlt(Math.max(0, st.alt)));
      add('Velocidad', this._fmtVel(st.speed));
      add('Vertical', this._fmtRate(st.hdot));
      add('Carga', [st.gLoad.toFixed(1), 'g'], st.gLoad > 7 ? 'warn' : st.gLoad > 5 ? 'caution' : '');
      add('Comunicaciones', [st.inBlackout ? 'APAGÓN' : 'OK', ''], st.inBlackout ? 'caution' : 'good');
      const chutes = v.parts.mains ? 'PRINCIPALES' : v.parts.drogues ? 'ESTABILIZ.' : '—';
      add('Paracaídas', [chutes, ''], v.parts.mains ? 'good' : '');
    } else if (ph === 'docking') {
      const d = this._dockTel;
      add('Distancia', store.settings.units === 'metric' ? [d.range.toFixed(1), 'm'] : [(d.range / FT).toFixed(1), 'ft']);
      const closing = -d.rangeRate;
      add('Cierre', store.settings.units === 'metric' ? [closing.toFixed(2), 'm/s'] : [(closing / FT).toFixed(2), 'ft/s'], closing > 0.6 ? 'warn' : closing > 0.05 && closing < 0.35 ? 'good' : '');
      add('Lateral', [`${Math.hypot(d.lateral.y, d.lateral.z).toFixed(2)}`, 'm'], Math.hypot(d.lateral.y, d.lateral.z) < 0.3 ? 'good' : '');
      add('Desalineación', [d.misalign.toFixed(1), '°'], d.misalign < 10 ? 'good' : 'caution');
      const rcs = v.modules.csm ? v.modules.csm.smRcsKg / (4 * 153) : v.modules.lm ? (v.modules.lm.rcsKg.A + v.modules.lm.rcsKg.B) / 280 : 1;
      add('RCS', [`${Math.round(rcs * 100)}`, '%'], rcs < 0.3 ? 'caution' : '', rcs);
    } else if (ph === 'descent' || ph === 'ascent') {
      const lm = v.modules.lm;
      const h = st.landed ? 0 : st.altTerrain;
      add('Altitud', this._fmtAlt(h), h < 30 && !st.landed ? 'caution' : '');
      add('Vert.', this._fmtRate(st.hdot), st.hdot < -6 && h < 60 ? 'warn' : '');
      add('Horiz.', this._fmtVel(st.vHoriz));
      if (ph === 'descent' && lm) {
        const f = lm.dpsProp / (lm.dpsProp0 || 8200);
        add('Combustible', [`${(f * 100).toFixed(1)}`, '%'], f < 0.056 ? 'warn' : f < 0.1 ? 'caution' : '', f);
        const prog = sim.gnc.lgc.program;
        add('Programa', [`P${prog}`, ''], prog === '66' ? 'caution' : '');
      } else if (lm) {
        const f = lm.apsProp / 2353;
        add('APS', [`${(f * 100).toFixed(0)}`, '%'], '', f);
        if (Number.isFinite(st.periAlt)) add('Perilunio', this._fmtAlt(st.periAlt));
      }
    } else if (ph === 'lunar') {
      add('Altitud', this._fmtAlt(st.alt));
      add('Velocidad', this._fmtVel(st.speed));
      if (Number.isFinite(st.apoAlt)) add('Apolunio', this._fmtAlt(st.apoAlt));
      if (Number.isFinite(st.periAlt)) add('Perilunio', this._fmtAlt(st.periAlt), st.periAlt < 15000 ? 'caution' : '');
      add('Señal', [st.losEarth ? 'SIN SEÑAL' : 'OK', ''], st.losEarth ? 'caution' : 'good');
      burnFields();
    } else if (ph === 'cislunar') {
      const moonD = st.r.distanceTo(sim.dyn.moonPos) - R_MOON;
      add('Dist. Tierra', this._fmtDist(st.r.length() - R_EARTH));
      add('Dist. Luna', this._fmtDist(moonD));
      add('Velocidad', this._fmtVel(st.speed));
      burnFields();
    } else {
      add('Altitud', this._fmtAlt(st.alt));
      add('Velocidad', this._fmtVel(st.speed));
      if (Number.isFinite(st.apoAlt)) add('Apogeo', this._fmtAlt(st.apoAlt));
      if (Number.isFinite(st.periAlt)) add('Perigeo', this._fmtAlt(st.periAlt), st.periAlt < 100000 ? 'caution' : '');
      burnFields();
    }
    const q = tm['CM.TLM.QUALITY'];
    if (this.role === 'controller' && q !== undefined && q < 0.5) F.push({ lbl: 'Telemetría', val: q === 0 ? 'PÉRDIDA' : 'RUIDOSA', unit: '', cls: 'warn' });
    return { ph, F };
  }

  _renderTelemetry() {
    const { ph, F } = this._fields();
    const sig = ph + F.map((f) => f.lbl).join('|');
    if (sig !== this._tlmSig) {
      this._tlmSig = sig;
      clear(this.tlmEl).append(
        ...F.map(() => h('div', { class: 'tlm' }, h('div', { class: 'lbl' }), h('div', { class: 'val' }, h('span'), h('small')), h('div', { class: 'bar', hidden: true }, h('i')))),
      );
    }
    F.forEach((f, i) => {
      const el = this.tlmEl.children[i];
      const cls = `tlm ${f.cls}`;
      if (el.className !== cls) el.className = cls;
      el.children[0].textContent = f.lbl;
      // value and unit update in place (8 Hz): no new nodes per refresh
      const val = el.children[1];
      val.firstChild.textContent = f.val;
      val.lastChild.textContent = f.unit ?? '';
      val.lastChild.hidden = !f.unit;
      const bar = el.children[2];
      bar.hidden = f.bar === null || f.bar === undefined;
      if (!bar.hidden) bar.firstChild.style.width = `${Math.max(0, Math.min(1, f.bar)) * 100}%`;
    });
    this._renderInstrument(ph);
  }

  _renderInstrument(ph) {
    const show = ph === 'descent' || ph === 'docking';
    this.instrEl.hidden = !show;
    if (!show) return;
    if (!this.instrCanvas) {
      this.instrCanvas = h('canvas', { width: 180, height: 180, style: { width: '9rem', height: '9rem' } });
      this.instrTitle = h('div', { class: 'title' });
      this.instrLines = h('div');
      this.instrEl.append(this.instrTitle, this.instrCanvas, this.instrLines);
    }
    const g = this.instrCanvas.getContext('2d');
    const W = 180;
    g.clearRect(0, 0, W, W);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath();
    g.arc(W / 2, W / 2, W / 2 - 4, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(200,220,240,0.35)';
    g.lineWidth = 1;
    for (const r of [0.25, 0.5, 0.75]) {
      g.beginPath();
      g.arc(W / 2, W / 2, (W / 2 - 4) * r, 0, Math.PI * 2);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(W / 2, 6);
    g.lineTo(W / 2, W - 6);
    g.moveTo(6, W / 2);
    g.lineTo(W - 6, W / 2);
    g.stroke();
    const tm = this.sim.vehicle.tm;
    const st = this.sim.vehicle.state;
    if (ph === 'descent') {
      this.instrTitle.textContent = 'Indicador de cruce · velocidad horizontal';
      // cross-pointer: forward (up) / lateral (right) velocity, full scale 20 ft/s (200 above 500 ft)
      const fwd = tm['LM.GNC.XPTR_FWD_FPS'] ?? 0;
      const lat = tm['LM.GNC.XPTR_LAT_FPS'] ?? 0;
      const altFt = st.altTerrain / FT;
      const fs = altFt > 2000 ? 200 : 20;
      const x = W / 2 + Math.max(-1, Math.min(1, lat / fs)) * (W / 2 - 10);
      const y = W / 2 - Math.max(-1, Math.min(1, fwd / fs)) * (W / 2 - 10);
      g.strokeStyle = '#ffb000';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(x, 10);
      g.lineTo(x, W - 10);
      g.moveTo(10, y);
      g.lineTo(W - 10, y);
      g.stroke();
      g.fillStyle = Math.hypot(fwd, lat) < 4 ? '#6dffa0' : '#ffb000';
      g.beginPath();
      g.arc(x, y, 6, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(220,230,240,0.8)';
      g.font = '11px "Share Tech Mono"';
      g.fillText(`±${fs} ft/s`, 8, W - 8);
      const lgd = this.sim.gnc.lmGuidance;
      const prog = this.sim.gnc.lgc.program;
      const lpd = prog === '64' ? `LPD ${lgd.lpdAngle}° · ${lgd.lpdTime} s` : prog === '66' ? `ROD ${(lgd.rodCmd / FT).toFixed(1)} ft/s` : '';
      fill(this.instrLines,
        lpd ? h('div', { class: 'ln' }, h('span', null, prog === '64' ? 'Punto de alunizaje' : 'Descenso ordenado'), h('span', null, lpd)) : null,
        h('div', { class: 'ln' }, h('span', null, 'Luz de contacto'), h('span', { style: { color: tm['LM.GNC.CONTACT_LIGHT'] ? '#6dffa0' : '#55606b' } }, tm['LM.GNC.CONTACT_LIGHT'] ? 'ENCENDIDA' : 'apagada')),
      );
    } else {
      const d = this._dockTel;
      this.instrTitle.textContent = 'COAS · alineación con el blanco';
      const fs = d.range > 30 ? 6 : 1.5;
      const x = W / 2 + Math.max(-1, Math.min(1, d.lateral.y / fs)) * (W / 2 - 10);
      const y = W / 2 + Math.max(-1, Math.min(1, d.lateral.z / fs)) * (W / 2 - 10);
      g.strokeStyle = '#ff8a3d';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, y, 12, 0, Math.PI * 2);
      g.moveTo(x - 18, y);
      g.lineTo(x + 18, y);
      g.moveTo(x, y - 18);
      g.lineTo(x, y + 18);
      g.stroke();
      g.fillStyle = 'rgba(220,230,240,0.8)';
      g.font = '11px "Share Tech Mono"';
      g.fillText(`±${fs} m`, 8, W - 8);
      clear(this.instrLines).append(
        h('div', { class: 'ln' }, h('span', null, 'Ideal'), h('span', null, '0,1–0,3 m/s')),
      );
    }
  }

  // ---------------------------------------------------------------- touch

  _buildTouch() {
    const input = this.game.input;
    const wrap = h('div', { class: 'touch-ui hud-keep' });
    const stick = (side, axX, axY, label) => {
      const knob = h('i');
      const el = h('div', { class: `touch-stick ${side}` }, h('span', null, label), knob);
      let id = null;
      let cx = 0;
      let cy = 0;
      const set = (dx, dy) => {
        const r = el.clientWidth / 2;
        const mx = Math.max(-1, Math.min(1, dx / r));
        const my = Math.max(-1, Math.min(1, dy / r));
        knob.style.transform = `translate(${mx * r * 0.6}px, ${my * r * 0.6}px)`;
        input.setVirtualAxis(axX, mx);
        input.setVirtualAxis(axY, -my);
      };
      el.addEventListener('pointerdown', (e) => {
        id = e.pointerId;
        const b = el.getBoundingClientRect();
        cx = b.left + b.width / 2;
        cy = b.top + b.height / 2;
        el.setPointerCapture(id);
        set(e.clientX - cx, e.clientY - cy);
      });
      el.addEventListener('pointermove', (e) => e.pointerId === id && set(e.clientX - cx, e.clientY - cy));
      const up = (e) => {
        if (e.pointerId !== id) return;
        id = null;
        set(0, 0);
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      return el;
    };
    const hold = (label, action) => {
      const b = h('button', { class: 'btn btn-sm' }, label);
      b.addEventListener('pointerdown', () => input.virtualHold(action, true));
      for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, () => input.virtualHold(action, false));
      return b;
    };
    wrap.append(
      stick('left', 'yaw', 'pitch', 'ROTACIÓN'),
      stick('right', 'transY', 'transX', 'TRASLACIÓN'),
      h('div', { class: 'touch-btns' }, hold('↺ Alabeo', 'rollLeft'), hold('Alabeo ↻', 'rollRight'), hold('▲ Acel.', 'throttleUp'), hold('▼ Acel.', 'throttleDown')),
    );
    this.root.append(wrap);
  }

  // ---------------------------------------------------------------- frame

  update(dt) {
    const input = this.game.input;
    if (input.pressed('toggleHud')) {
      this.hidden = !this.hidden;
      this.root.classList.toggle('hidden-hud', this.hidden);
    }
    if (input.pressed('toggleChecklist')) this._toggleChecklist();
    if (input.pressed('help')) this._help();
    if (input.pressed('toggleLog')) this._toggleLog();
    if (input.pressed('procedures')) this._openProcedures();
    this.tracker?.update(dt);
    this._render();
    this._tlmAcc += dt;
    if (this._tlmAcc > 0.12) {
      this._tlmAcc = 0;
      try {
        this._dockTel = this.sim.dyn.bodies.size ? this.sim.dyn.dockingTelemetry?.() : null;
      } catch {
        this._dockTel = null;
      }
      this._renderTelemetry();
    }
  }

  _render() {
    const c = this.sim.clock;
    const t = c.get;
    const count = t < 0;
    this.clockLbl.textContent = count ? 'Cuenta atrás' : 'GET';
    this.clockVal.textContent = count ? MissionClock.formatT(t) : MissionClock.format(t);
    this.clockVal.classList.toggle('count', count);
    const w = c.effectiveWarp;
    const txt = `×${w >= 1000 ? `${w / 1000}k` : w}${c.warp > w ? '·' : ''}`;
    if (this.warpVal.textContent !== txt) this.warpVal.textContent = txt;
    this.warpVal.classList.toggle('fast', w > 1);
    this.warpVal.title = c.maxWarp < 10000 ? `Límite actual ×${c.maxWarp}` : '';
  }

  resize() {}

  dispose() {
    this._off.forEach((f) => f());
    this.tracker?.dispose();
    this._closeModal();
    this.helpModal?.close();
    clearTimeout(this._hintT);
    this.root.remove();
    for (const ax of ['pitch', 'yaw', 'roll', 'transX', 'transY', 'transZ']) this.game.input.setVirtualAxis(ax, 0);
  }
}

/** clear + append, skipping null/false children (Element.append would print "null"). */
function fill(el, ...kids) {
  clear(el);
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) el.append(k);
  return el;
}

function iconSVGEl(name) {
  const d = document.createElement('span');
  d.style.display = 'contents';
  d.innerHTML = iconSVG(name);
  return d.firstChild;
}
