// MOCR console keyboard shelf (the sloped module row under the three CRTs): display-request keys
// (one row per CRT), the comm keyset (voice loops), event lights, and the response module with the
// GO / NO GO keys and the 1–4 message-response keys that answer `mission:groundTask` / polls.
// Built on the shared Panel/Widget framework so it renders through PanelMesh and is clicked or
// tapped through PanelInteractor exactly like the spacecraft panels.
//
//   buildConsolePanel(consoleId, ctx) → Panel     ctx: PanelContext + { mocr } (see MOCRView)
//   CONSOLE_PANEL_SIZE                            mm

import { Panel, Widget } from '../../cockpit/Panel.js';
import { MOCR_CONSOLES } from '../../missions/MissionRunner.js';
import { PAGES, CONSOLE_PAGES } from './pages.js';

export const CONSOLE_PANEL_SIZE = { width: 1400, height: 300 }; // mm

const KEY_COLORS = {
  white: ['#f4f1e6', '#fffdf2'],
  amber: ['#ffb43a', '#ffd27a'],
  green: ['#46e07c', '#a8ffc4'],
  red: ['#ff4b3a', '#ff9a8a'],
  blue: ['#6fb4ff', '#bfe0ff'],
};

function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Square lighted pushbutton with an engraved legend (MOCR "keyset" key). */
class LitKey extends Widget {
  constructor(o) {
    super({ ...o, interactive: true, margin: 1.5 });
    this.legend = o.legend; // string, '\n' for two lines
    this.color = o.color ?? 'white';
    this.isLit = o.lit ?? (() => false);
    this.isBlink = o.blink ?? (() => false);
    this.onPress = o.onPress ?? null;
    this.pressed = false;
    this.font = o.font ?? 7.2;
  }

  signature() {
    const b = this.isBlink() ? (Math.floor(this.panel.time * 3) % 2 ? 'b1' : 'b0') : '';
    return `${this.isLit() ? 1 : 0}${b}${this.pressed ? 'p' : ''}${this.legend}`;
  }

  draw(g) {
    const { x, y, w, h } = this;
    const lit = this.isLit() || (this.isBlink() && Math.floor(this.panel.time * 3) % 2 === 0);
    const [c0, c1] = KEY_COLORS[this.color] ?? KEY_COLORS.white;
    // bezel
    g.fillStyle = '#1b1d1f';
    rr(g, x - 1.2, y - 1.2, w + 2.4, h + 2.4, 2.2);
    g.fill();
    const d = this.pressed ? 0.7 : 0;
    if (lit) {
      const grd = g.createLinearGradient(x, y, x, y + h);
      grd.addColorStop(0, c1);
      grd.addColorStop(1, c0);
      g.fillStyle = grd;
      g.shadowColor = c0;
      g.shadowBlur = 6;
    } else {
      const grd = g.createLinearGradient(x, y, x, y + h);
      grd.addColorStop(0, '#d9d6cc');
      grd.addColorStop(1, '#a9a69c');
      g.fillStyle = grd;
    }
    rr(g, x + d, y + d, w - d * 2, h - d * 2, 1.6);
    g.fill();
    g.shadowBlur = 0;
    if (!lit) {
      // translucent coloured cap of an unlit key
      g.fillStyle = this.color === 'white' ? 'rgba(255,255,255,0.05)' : this.color === 'green' ? 'rgba(40,120,70,0.35)' : this.color === 'red' ? 'rgba(140,30,25,0.35)' : this.color === 'amber' ? 'rgba(150,100,20,0.3)' : 'rgba(40,80,140,0.3)';
      rr(g, x + d, y + d, w - d * 2, h - d * 2, 1.6);
      g.fill();
    }
    g.fillStyle = lit ? 'rgba(20,16,8,0.92)' : 'rgba(25,25,25,0.85)';
    g.font = `600 ${this.font}px "Barlow Condensed", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const lines = String(this.legend).split('\n');
    lines.forEach((l, i) => g.fillText(l, x + w / 2, y + h / 2 + (i - (lines.length - 1) / 2) * this.font * 1.05));
  }

  onPointerDown() {
    this.pressed = true;
    this.ctx?.audio?.sfx?.('button', { gain: 0.8 });
    this.onPress?.();
    return true;
  }

  onPointerUp() {
    this.pressed = false;
  }

  tooltipText() {
    return this.tooltip ?? this.legend.replace('\n', ' ');
  }
}

/** Small round status lamp. */
class StatusLamp extends Widget {
  constructor(o) {
    super({ ...o, margin: 2 });
    this.isOn = o.on;
    this.color = o.color ?? 'amber';
    this.legend = o.legend;
  }

  signature() {
    return this.isOn() ? 1 : 0;
  }

  draw(g) {
    const { x, y, w, h } = this;
    const cx = x + w / 2;
    const cy = y + h * 0.36;
    const r = Math.min(w, h) * 0.3;
    const on = this.isOn();
    const [c0, c1] = KEY_COLORS[this.color] ?? KEY_COLORS.amber;
    g.fillStyle = '#151617';
    g.beginPath();
    g.arc(cx, cy, r + 1.4, 0, Math.PI * 2);
    g.fill();
    const grd = g.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
    grd.addColorStop(0, on ? c1 : '#5a5650');
    grd.addColorStop(1, on ? c0 : '#2c2a27');
    g.fillStyle = grd;
    if (on) {
      g.shadowColor = c0;
      g.shadowBlur = 7;
    }
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
    g.shadowBlur = 0;
    g.fillStyle = '#e9e5d8';
    g.font = '600 5.6px "Barlow Condensed", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(this.legend, cx, y + h - 3.2);
  }

  tooltipText() {
    return this.tooltip ?? this.legend;
  }
}

/** Engraved section legend + frame line. */
class Engraving extends Widget {
  constructor(o) {
    super({ ...o, margin: 0.5 });
    this.text = o.text;
    this.size = o.size ?? 6;
    this.frame = o.frame ?? false;
  }

  draw(g) {
    const { x, y, w, h } = this;
    if (this.frame) {
      g.strokeStyle = 'rgba(235,232,220,0.55)';
      g.lineWidth = 0.6;
      g.strokeRect(x, y, w, h);
    }
    g.font = `700 ${this.size}px "Barlow Condensed", sans-serif`;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    const tw = g.measureText(this.text).width;
    if (this.frame) {
      g.fillStyle = '#4c5354';
      g.fillRect(x + 4, y - this.size / 2 - 0.5, tw + 4, this.size + 1);
    }
    g.fillStyle = '#ecebe2';
    g.fillText(this.text, x + 6, this.frame ? y : y + h / 2);
  }
}

/** Console nameplate: black plate with white engraved position name. */
class Nameplate extends Widget {
  constructor(o) {
    super({ ...o, margin: 1 });
    this.text = o.text;
  }

  draw(g) {
    const { x, y, w, h } = this;
    const grd = g.createLinearGradient(x, y, x, y + h);
    grd.addColorStop(0, '#2b2d2e');
    grd.addColorStop(1, '#141516');
    g.fillStyle = grd;
    rr(g, x, y, w, h, 2);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.lineWidth = 0.6;
    g.stroke();
    g.fillStyle = '#f2f0e6';
    g.font = `700 ${h * 0.62}px "Barlow Condensed", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(this.text, x + w / 2, y + h / 2 + 0.5);
  }
}

function background(g, panel, rect) {
  // grey-blue enamel with a subtle texture, darker toward the front edge
  const grd = g.createLinearGradient(0, 0, 0, panel.height);
  grd.addColorStop(0, '#6d7778');
  grd.addColorStop(1, '#596163');
  g.fillStyle = grd;
  g.fillRect(rect.x, rect.y, rect.w, rect.h);
  g.fillStyle = 'rgba(0,0,0,0.22)';
  g.fillRect(rect.x, panel.height - 10, rect.w, 10);
}

export const LOOPS = [
  { id: 'AG', legend: 'A/G', tip: 'Aire-tierra: la voz de la tripulación y del CAPCOM' },
  { id: 'FLIGHT', legend: 'FLIGHT\nLOOP', tip: 'Lazo del director de vuelo: todos los controladores' },
  { id: 'MOCR', legend: 'MOCR\nDYN', tip: 'Lazo dinámico de la sala' },
  { id: 'BACK', legend: 'STAFF\nSUPPORT', tip: 'Sala de apoyo de tu disciplina' },
  { id: 'NET', legend: 'NET-\nWORK', tip: 'Coordinación con la red de estaciones' },
  { id: 'PAO', legend: 'PAO', tip: 'Comentario de Asuntos Públicos' },
];

/**
 * @param {string} consoleId
 * @param {object} ctx PanelContext + { mocr: { pageOf(i), setPage(i, id), loops: Set, toggleLoop(id),
 *   task(): object|null, answer(idOrIndex), alarm(): boolean, los(): boolean, ack() } }
 */
export function buildConsolePanel(consoleId, ctx) {
  const { width, height } = CONSOLE_PANEL_SIZE;
  const panel = new Panel({ id: `MOCR_${consoleId}`, name: consoleId, width, height, ctx, background });
  const m = ctx.mocr;
  const def = CONSOLE_PAGES[consoleId] ?? CONSOLE_PAGES.FLIGHT;
  const add = (w) => panel.add(w);

  // ---- display request keyboard: one row of page keys per CRT
  add(new Engraving({ x: 14, y: 18, w: 510, h: 254, text: 'DISPLAY REQUEST', frame: true }));
  for (let crt = 0; crt < 3; crt++) {
    const y = 34 + crt * 78;
    add(new Engraving({ x: 18, y: y + 2, w: 40, h: 46, text: `CRT ${crt + 1}`, size: 7 }));
    def.keys.forEach((pageId, i) => {
      add(
        new LitKey({
          x: 62 + i * 57,
          y,
          w: 50,
          h: 48,
          legend: PAGES[pageId]?.name ?? pageId,
          color: 'white',
          lit: () => m.pageOf(crt) === pageId,
          onPress: () => m.setPage(crt, pageId),
          tooltip: `Mostrar «${PAGES[pageId]?.name ?? pageId}» en la pantalla ${crt + 1}`,
        }),
      );
    });
  }

  // ---- comm keyset + event lights
  add(new Engraving({ x: 540, y: 18, w: 330, h: 140, text: 'COMM KEYSET', frame: true }));
  LOOPS.forEach((l, i) => {
    add(
      new LitKey({
        x: 552 + (i % 3) * 104,
        y: 32 + Math.floor(i / 3) * 60,
        w: 92,
        h: 50,
        legend: l.legend,
        color: 'amber',
        lit: () => m.loops.has(l.id),
        onPress: () => m.toggleLoop(l.id),
        tooltip: `${l.tip} (escuchar / dejar de escuchar)`,
        font: 8.4,
      }),
    );
  });
  add(new Engraving({ x: 540, y: 180, w: 330, h: 92, text: 'EVENT LIGHTS', frame: true }));
  const lamps = [
    ['MSTR\nALM', 'red', () => m.alarm(), 'Alarma maestra a bordo'],
    ['LOS', 'amber', () => m.los(), 'Pérdida de señal'],
    ['TLM', 'amber', () => m.tlmBad(), 'Telemetría degradada'],
    ['MSG', 'blue', () => !!m.task(), 'Mensaje esperando respuesta en esta consola'],
    ['POLL', 'green', () => m.polling(), 'Encuesta GO / NO GO en curso'],
  ];
  lamps.forEach(([legend, color, on, tip], i) => {
    add(new StatusLamp({ x: 552 + i * 62, y: 194, w: 56, h: 72, legend: legend.replace('\n', ' '), color, on, tooltip: tip }));
  });

  // ---- nameplate + response module
  add(new Nameplate({ x: 896, y: 16, w: 488, h: 46, text: consoleId.replace('_', ' ') }));
  add(new Engraving({ x: 890, y: 84, w: 500, h: 188, text: 'STATUS · MSG RESPONSE', frame: true }));
  const hasYesNo = () => {
    const t = m.task();
    return !!t && t.options?.some((o) => o.id === 'GO') && t.options?.some((o) => o.id === 'NOGO');
  };
  add(
    new LitKey({
      x: 904,
      y: 102,
      w: 116,
      h: 74,
      legend: 'GO',
      color: 'green',
      font: 18,
      lit: () => m.lastAnswer === 'GO',
      blink: () => hasYesNo(),
      onPress: () => m.answer('GO'),
      tooltip: 'GO: todo en orden en tu consola',
    }),
  );
  add(
    new LitKey({
      x: 1030,
      y: 102,
      w: 116,
      h: 74,
      legend: 'NO GO',
      color: 'red',
      font: 16,
      lit: () => m.lastAnswer === 'NOGO',
      blink: () => hasYesNo(),
      onPress: () => m.answer('NOGO'),
      tooltip: 'NO GO: hay un problema que impide continuar',
    }),
  );
  for (let i = 0; i < 4; i++) {
    add(
      new LitKey({
        x: 1160 + (i % 2) * 108,
        y: 102 + Math.floor(i / 2) * 78,
        w: 96,
        h: 66,
        legend: `${i + 1}`,
        color: 'white',
        font: 20,
        blink: () => {
          const t = m.task();
          return !!t && !hasYesNo() && i < (t.options?.length ?? 0);
        },
        onPress: () => m.answer(i),
        tooltip: `Respuesta ${i + 1} del mensaje (pantalla central)`,
      }),
    );
  }
  add(
    new LitKey({
      x: 904,
      y: 190,
      w: 242,
      h: 64,
      legend: consoleId === 'CAPCOM' ? 'PUSH TO TALK' : 'ACK',
      color: 'blue',
      font: 12,
      blink: () => m.ackPending?.(),
      onPress: () => m.ack(),
      tooltip: consoleId === 'CAPCOM' ? 'Hablar con la tripulación' : 'Acusar recibo',
    }),
  );
  return panel;
}

/** Front-wall projection displays are built by src/mocr/wall.js (kept for the contract). */
export function buildWallDisplays() {
  return [];
}

export { MOCR_CONSOLES };
