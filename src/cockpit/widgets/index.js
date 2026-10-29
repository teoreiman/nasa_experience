// Instrument & control widgets for the Panel framework (millimetre units, canvas 2D).
// Interactive widgets drive SwitchBoard ids through ctx.sw with source 'user'.
// Mouse: left click upper/lower half (toggles) or left/right half (rotaries); right click or
// touch long-press toggles a switch guard. Display widgets read ctx.tm keys.

import { Widget } from '../Panel.js';

const FONT = '"Barlow Condensed", "Arial Narrow", sans-serif';
const MONO = '"Share Tech Mono", monospace';

function text(g, s, x, y, size = 3, color = '#f2f2ee', align = 'center', weight = 600) {
  g.font = `${weight} ${size}px ${FONT}`;
  g.fillStyle = color;
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.fillText(s, x, y);
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

const sfx = (w, name) => w.ctx?.audio?.sfx?.(name);

function posLabel(p) {
  return String(p).replace(/_/g, ' ');
}

// ------------------------------------------------------------------ background

const _noise = new Map();
function noisePattern(g, base) {
  let c = _noise.get(base);
  if (!c) {
    c = document.createElement('canvas');
    c.width = c.height = 128;
    const n = c.getContext('2d');
    n.fillStyle = base;
    n.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 2400; i++) {
      const v = Math.random() < 0.5 ? 255 : 0;
      n.fillStyle = `rgba(${v},${v},${v},${Math.random() * 0.05})`;
      n.fillRect(Math.random() * 128, Math.random() * 128, 1.5, 1.5);
    }
    _noise.set(base, c);
  }
  return g.createPattern(c, 'repeat');
}

/** Panel background painter: style 'cm' (dark grey), 'lm' (light grey), 'mocr' (beige). */
export function panelBackground(style = 'cm') {
  const base = style === 'lm' ? '#8d9195' : style === 'mocr' ? '#a39b86' : '#5e6265';
  return (g, panel, rect) => {
    g.save();
    g.fillStyle = base;
    g.fillRect(rect.x, rect.y, rect.w, rect.h);
    g.scale(0.25, 0.25);
    g.fillStyle = noisePattern(g, base);
    g.fillRect(rect.x * 4, rect.y * 4, rect.w * 4, rect.h * 4);
    g.restore();
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.lineWidth = 1.2;
    g.strokeRect(0.6, 0.6, panel.width - 1.2, panel.height - 1.2);
    for (const [x, y] of [[6, 6], [panel.width - 6, 6], [6, panel.height - 6], [panel.width - 6, panel.height - 6]]) screw(g, x, y);
  };
}

function screw(g, x, y) {
  const grd = g.createRadialGradient(x - 0.6, y - 0.6, 0.2, x, y, 2.2);
  grd.addColorStop(0, '#d7d7d2');
  grd.addColorStop(1, '#55575a');
  g.fillStyle = grd;
  g.beginPath();
  g.arc(x, y, 2.1, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#333';
  g.lineWidth = 0.4;
  g.beginPath();
  g.moveTo(x - 1.4, y);
  g.lineTo(x + 1.4, y);
  g.stroke();
}

// ------------------------------------------------------------------ decor

export class SectionFrame extends Widget {
  constructor(o) {
    super({ margin: 1, ...o });
    this.title = o.title ?? '';
  }

  draw(g) {
    g.strokeStyle = 'rgba(240,240,235,0.85)';
    g.lineWidth = 0.45;
    const tw = this.title ? Math.min(this.w - 6, this.title.length * 2.1 + 6) : 0;
    const cx = this.x + this.w / 2;
    g.beginPath();
    g.moveTo(cx - tw / 2, this.y);
    g.lineTo(this.x + 1.5, this.y);
    g.lineTo(this.x + 1.5, this.y + this.h);
    g.lineTo(this.x + this.w - 1.5, this.y + this.h);
    g.lineTo(this.x + this.w - 1.5, this.y);
    g.lineTo(cx + tw / 2, this.y);
    g.stroke();
    if (this.title) text(g, this.title, cx, this.y, 3.3, '#f4f4ef', 'center', 700);
  }
}

export class Label extends Widget {
  constructor(o) {
    super({ margin: 0.5, ...o });
    this.text = o.text;
    this.size = o.size ?? 3;
    this.color = o.color ?? '#f2f2ee';
    this.align = o.align ?? 'center';
  }

  draw(g) {
    const x = this.align === 'left' ? this.x : this.align === 'right' ? this.x + this.w : this.x + this.w / 2;
    text(g, this.text, x, this.y + this.h / 2, this.size, this.color, this.align);
  }
}

// ------------------------------------------------------------------ toggle switch

export class ToggleSwitch extends Widget {
  /** o: { switchId, x, y, w=14, h=26, label } — positions top→bottom from the switch def */
  constructor(o) {
    super({ w: 14, h: 26, interactive: true, margin: 2, ...o });
  }

  get def() {
    return this.sw?.def(this.switchId);
  }

  signature() {
    const sw = this.sw;
    return `${sw?.get(this.switchId)}|${sw?.isGuardOpen(this.switchId)}|${this._down ? 1 : 0}`;
  }

  draw(g) {
    const d = this.def;
    if (!d) return;
    const n = d.positions.length;
    const idx = d.positions.indexOf(this.sw.get(this.switchId));
    const cx = this.x + this.w / 2;
    const cy = this.y + this.h * 0.42;
    // position legends
    const legendY = (i) => (n === 2 ? (i === 0 ? cy - 7.2 : cy + 7.2) : [cy - 7.6, cy + 0.2, cy + 7.6][i]);
    d.positions.forEach((p, i) => {
      if (n === 3 && i === 1 && /^(CENTER|OFF|NORMAL)$/.test(p) === false && p.length > 5) return;
      text(g, posLabel(p).slice(0, 8), cx + 6.5, legendY(i), 2.1, '#e9e9e4', 'left', 600);
    });
    // base nut
    const grd = g.createRadialGradient(cx - 0.8, cy - 0.8, 0.3, cx, cy, 3.4);
    grd.addColorStop(0, '#e8e8e8');
    grd.addColorStop(0.6, '#8a8c8f');
    grd.addColorStop(1, '#3d3f42');
    g.fillStyle = '#1b1c1e';
    g.beginPath();
    g.arc(cx, cy, 3.8, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = grd;
    g.beginPath();
    g.arc(cx, cy, 3.0, 0, Math.PI * 2);
    g.fill();
    // lever (bat handle) in perspective
    const dir = n === 2 ? (idx === 0 ? -1 : 1) : idx - 1;
    const len = dir === 0 ? 1.6 : 7.2;
    const tipY = cy + dir * len;
    g.strokeStyle = 'rgba(0,0,0,0.45)';
    g.lineWidth = 2.6;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(cx + 0.8, cy + 0.8);
    g.lineTo(cx + 1.6, tipY + 1.2);
    g.stroke();
    const lg = g.createLinearGradient(cx - 1.4, 0, cx + 1.4, 0);
    lg.addColorStop(0, '#9a9c9f');
    lg.addColorStop(0.45, '#ffffff');
    lg.addColorStop(1, '#6b6d70');
    g.strokeStyle = lg;
    g.lineWidth = 2.2;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx, tipY);
    g.stroke();
    g.fillStyle = '#f4f4f4';
    g.beginPath();
    g.arc(cx, tipY, dir === 0 ? 1.9 : 1.6, 0, Math.PI * 2);
    g.fill();
    // guard
    if (d.guarded) {
      const open = this.sw.isGuardOpen(this.switchId);
      const red = /SEP|FIRE|JETT|DEPLOY|ABORT|STAGE|MOTOR/.test(this.switchId);
      g.fillStyle = red ? 'rgba(185,40,30,0.92)' : 'rgba(25,25,27,0.92)';
      g.strokeStyle = 'rgba(0,0,0,0.8)';
      g.lineWidth = 0.4;
      if (open) {
        roundRect(g, cx - 5, this.y - 1.5, 10, 3.2, 0.8);
        g.fill();
        g.stroke();
      } else {
        roundRect(g, cx - 5, cy - 9, 10, 18, 1.2);
        g.globalAlpha = 0.82;
        g.fill();
        g.globalAlpha = 1;
        g.stroke();
      }
    }
    if (this.label) {
      const lines = wrap(this.label, 9);
      lines.forEach((l, i) => text(g, l, cx, this.y + this.h - 4.2 + (i - (lines.length - 1)) * 3.1 + 1.6, 2.5, '#ffffff', 'center', 600));
    }
  }

  cursor(e) {
    return e.ly < this.h * 0.42 ? 'n-resize' : 's-resize';
  }

  onPointerDown(e) {
    const sw = this.sw;
    const d = this.def;
    if (!d) return false;
    if (d.guarded && (e.button === 2 || e.longPress)) {
      sw.setGuard(this.switchId, !sw.isGuardOpen(this.switchId), 'user');
      sfx(this, sw.isGuardOpen(this.switchId) ? 'guardOpen' : 'guardClose');
      return true;
    }
    if (d.guarded && !sw.isGuardOpen(this.switchId)) {
      sw.setGuard(this.switchId, true, 'user');
      sfx(this, 'guardOpen');
      return true;
    }
    const up = e.ly < this.h * 0.42;
    if (sw.step(this.switchId, up ? -1 : 1, 'user')) sfx(this, 'toggle');
    this._down = true;
    return true;
  }

  onPointerUp() {
    this._down = false;
    const d = this.def;
    if (d?.momentary) {
      setTimeout(() => this.sw?.release(this.switchId), 180);
    }
  }

  tooltipText() {
    const d = this.def;
    if (!d) return null;
    return `${d.label} — ${posLabel(this.sw.get(this.switchId))}${d.desc ? `\n${d.desc}` : ''}${d.guarded ? `\nTapa: ${this.sw.isGuardOpen(this.switchId) ? 'abierta' : 'cerrada'} (clic derecho / mantener pulsado)` : ''}`;
  }
}

function wrap(s, n) {
  const words = String(s).split(/\s+/);
  const out = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > n && cur) {
      out.push(cur);
      cur = w;
    } else cur = (cur + ' ' + w).trim();
  }
  if (cur) out.push(cur);
  return out.slice(0, 3);
}

// ------------------------------------------------------------------ rotary

export class RotarySwitch extends Widget {
  constructor(o) {
    super({ w: 30, h: 32, interactive: true, margin: 2, ...o });
  }

  get def() {
    return this.sw?.def(this.switchId);
  }

  signature() {
    return this.sw?.get(this.switchId);
  }

  draw(g) {
    const d = this.def;
    if (!d) return;
    const cx = this.x + this.w / 2;
    const cy = this.y + this.h * 0.47;
    const n = d.positions.length;
    const span = Math.min(300, n * 34) * (Math.PI / 180);
    const a0 = -Math.PI / 2 - span / 2;
    const ang = (i) => (n === 1 ? -Math.PI / 2 : a0 + (span * i) / (n - 1));
    d.positions.forEach((p, i) => {
      const a = ang(i);
      g.strokeStyle = '#f0f0ea';
      g.lineWidth = 0.35;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * 7, cy + Math.sin(a) * 7);
      g.lineTo(cx + Math.cos(a) * 8.6, cy + Math.sin(a) * 8.6);
      g.stroke();
      text(g, posLabel(p).slice(0, 7), cx + Math.cos(a) * 11.6, cy + Math.sin(a) * 10.8, 1.9, '#eeeeea');
    });
    const idx = d.positions.indexOf(this.sw.get(this.switchId));
    const grd = g.createRadialGradient(cx - 1.5, cy - 1.5, 0.5, cx, cy, 6.5);
    grd.addColorStop(0, '#4a4b4e');
    grd.addColorStop(1, '#0c0c0d');
    g.fillStyle = 'rgba(0,0,0,0.4)';
    g.beginPath();
    g.arc(cx + 0.8, cy + 0.8, 6.3, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = grd;
    g.beginPath();
    g.arc(cx, cy, 6, 0, Math.PI * 2);
    g.fill();
    const a = ang(Math.max(0, idx));
    g.save();
    g.translate(cx, cy);
    g.rotate(a + Math.PI / 2);
    g.fillStyle = '#1d1d1f';
    roundRect(g, -2, -7.2, 4, 14.4, 1.6);
    g.fill();
    g.fillStyle = '#ffffff';
    g.fillRect(-0.35, -7, 0.7, 4.5);
    g.restore();
    if (this.label) text(g, this.label.slice(0, 18), cx, this.y + this.h - 1.8, 2.4, '#fff', 'center', 700);
  }

  cursor(e) {
    return e.lx < this.w / 2 ? 'w-resize' : 'e-resize';
  }

  onPointerDown(e) {
    if (this.sw.step(this.switchId, e.lx < this.w / 2 ? -1 : 1, 'user')) sfx(this, 'rotary');
    return true;
  }

  onWheel(e) {
    if (this.sw.step(this.switchId, e.deltaY > 0 ? 1 : -1, 'user')) sfx(this, 'rotary');
    return true;
  }

  tooltipText() {
    const d = this.def;
    return d ? `${d.label} — ${posLabel(this.sw.get(this.switchId))}${d.desc ? `\n${d.desc}` : ''}` : null;
  }
}

// ------------------------------------------------------------------ circuit breaker

export class CircuitBreaker extends Widget {
  constructor(o) {
    super({ w: 11, h: 16, interactive: true, margin: 1, ...o });
  }

  signature() {
    return `${this.sw?.get(this.switchId)}|${this.sw?.isBroken(this.switchId)}`;
  }

  draw(g) {
    const out = this.sw.get(this.switchId) === 'OUT';
    const broken = this.sw.isBroken(this.switchId);
    const cx = this.x + this.w / 2;
    const cy = this.y + 5;
    g.fillStyle = '#202123';
    g.beginPath();
    g.arc(cx, cy, 3.6, 0, Math.PI * 2);
    g.fill();
    if (out) {
      g.fillStyle = '#f4f4f0';
      g.fillRect(cx - 2.3, cy - 1.6, 4.6, 1.6);
    }
    if (broken) {
      g.fillStyle = '#3a3a3a';
      g.fillRect(cx - 1, cy - 1, 2, 2);
      g.strokeStyle = '#999';
      g.lineWidth = 0.4;
      g.beginPath();
      g.moveTo(cx - 2, cy - 2);
      g.lineTo(cx + 2, cy + 1);
      g.stroke();
    } else {
      const grd = g.createRadialGradient(cx - 0.8, cy - 0.8 - (out ? 1.2 : 0), 0.2, cx, cy - (out ? 1.2 : 0), 2.8);
      grd.addColorStop(0, '#5b5c60');
      grd.addColorStop(1, '#0a0a0b');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(cx, cy - (out ? 1.4 : 0), 2.7, 0, Math.PI * 2);
      g.fill();
    }
    if (this.label) wrap(this.label, 7).forEach((l, i) => text(g, l, cx, this.y + 11 + i * 2.5, 1.9, '#ffffff'));
  }

  onPointerDown() {
    const sw = this.sw;
    const next = sw.get(this.switchId) === 'IN' ? 'OUT' : 'IN';
    if (sw.set(this.switchId, next, 'user')) sfx(this, next === 'IN' ? 'cbIn' : 'cbOut');
    else if (sw.isBroken(this.switchId)) this.ctx?.bus?.emit('panel:brokenBreaker', { id: this.switchId });
    return true;
  }

  tooltipText() {
    const d = this.sw.def(this.switchId);
    return d ? `Disyuntor ${d.label} — ${this.sw.get(this.switchId) === 'IN' ? 'cerrado (IN)' : 'abierto (OUT)'}${this.sw.isBroken(this.switchId) ? '\n¡Roto! No se puede empujar con el dedo.' : ''}${d.desc ? `\n${d.desc}` : ''}` : null;
  }
}

// ------------------------------------------------------------------ pushbutton (lighted)

export class PushButton extends Widget {
  /** o: { switchId, legend, lampKey (tm), color: 'red'|'amber'|'white'|'green' } */
  constructor(o) {
    super({ w: 16, h: 14, interactive: true, margin: 1.5, ...o });
    this.legend = o.legend ?? o.label ?? '';
    this.lampKey = o.lampKey ?? null;
    this.color = o.color ?? 'white';
  }

  signature() {
    return `${this.sw?.get(this.switchId)}|${this.lampKey ? !!this.tm?.[this.lampKey] : 0}|${this._down ? 1 : 0}`;
  }

  draw(g) {
    const pressed = this._down || this.sw?.get(this.switchId) === 'PUSHED';
    const lit = this.lampKey ? !!this.tm[this.lampKey] : false;
    const cols = { red: ['#5a1410', '#ff3b2a'], amber: ['#4e3a10', '#ffb43a'], white: ['#3a3b3d', '#f4f6ff'], green: ['#10331a', '#59ff8a'] }[this.color];
    const o = pressed ? 0.5 : 0;
    g.fillStyle = '#111';
    roundRect(g, this.x, this.y, this.w, this.h, 1.2);
    g.fill();
    g.fillStyle = lit ? cols[1] : cols[0];
    if (lit) {
      g.shadowColor = cols[1];
      g.shadowBlur = 4;
    }
    roundRect(g, this.x + 1 + o, this.y + 1 + o, this.w - 2, this.h - 2, 1);
    g.fill();
    g.shadowBlur = 0;
    const lines = wrap(this.legend, 8);
    lines.forEach((l, i) => text(g, l, this.x + this.w / 2 + o, this.y + this.h / 2 + (i - (lines.length - 1) / 2) * 3 + o, 2.4, lit ? '#1a0a00' : '#d8d8d0', 'center', 700));
  }

  onPointerDown() {
    this._down = true;
    const d = this.sw?.def(this.switchId);
    if (d) {
      if (d.momentary) this.sw.set(this.switchId, 'PUSHED', 'user');
      else this.sw.set(this.switchId, this.sw.get(this.switchId) === 'PUSHED' ? 'OUT' : 'PUSHED', 'user');
    }
    sfx(this, 'button');
    return true;
  }

  onPointerUp() {
    this._down = false;
    const d = this.sw?.def(this.switchId);
    if (d?.momentary) this.sw.release(this.switchId);
  }

  tooltipText() {
    const d = this.sw?.def(this.switchId);
    return d ? `${d.label}${d.desc ? `\n${d.desc}` : ''}` : this.legend;
  }
}

// ------------------------------------------------------------------ indicators

export class Lamp extends Widget {
  constructor(o) {
    super({ w: 18, h: 9, margin: 1, ...o });
    this.key = o.key;
    this.legend = o.legend ?? '';
    this.color = o.color ?? 'amber';
  }

  signature() {
    return !!(this.tm?.[this.key] || this.tm?.['CW.LAMP_TEST']);
  }

  draw(g) {
    const on = this.signature();
    const c = this.color === 'red' ? ['#3b0d0b', '#ff4433'] : this.color === 'green' ? ['#0d2612', '#59ff8a'] : this.color === 'white' ? ['#2d2e30', '#f2f4ff'] : ['#3a2a0b', '#ffbb33'];
    g.fillStyle = '#0d0d0e';
    g.fillRect(this.x, this.y, this.w, this.h);
    g.fillStyle = on ? c[1] : c[0];
    if (on) {
      g.shadowColor = c[1];
      g.shadowBlur = 3;
    }
    g.fillRect(this.x + 0.6, this.y + 0.6, this.w - 1.2, this.h - 1.2);
    g.shadowBlur = 0;
    const lines = wrap(this.legend, 11);
    lines.forEach((l, i) => text(g, l, this.x + this.w / 2, this.y + this.h / 2 + (i - (lines.length - 1) / 2) * 2.6, 2.1, on ? '#140800' : 'rgba(200,190,170,0.55)', 'center', 700));
  }
}

/** Grid of caution & warning legends. lamps: [{key, legend, color}] */
export class Annunciator extends Widget {
  constructor(o) {
    super({ margin: 1, ...o });
    this.lamps = o.lamps;
    this.cols = o.cols ?? 4;
  }

  signature() {
    const tm = this.tm;
    let s = tm?.['CW.LAMP_TEST'] ? 'T' : '';
    for (const l of this.lamps) s += tm?.[l.key] ? '1' : '0';
    return s;
  }

  draw(g) {
    const rows = Math.ceil(this.lamps.length / this.cols);
    const cw = this.w / this.cols;
    const ch = this.h / rows;
    g.fillStyle = '#080809';
    g.fillRect(this.x - 1, this.y - 1, this.w + 2, this.h + 2);
    const test = !!this.tm['CW.LAMP_TEST'];
    this.lamps.forEach((l, i) => {
      const x = this.x + (i % this.cols) * cw;
      const y = this.y + Math.floor(i / this.cols) * ch;
      const on = test || !!this.tm[l.key];
      const lit = l.color === 'red' ? '#ff4b38' : '#ffc13a';
      g.fillStyle = on ? lit : '#24201a';
      if (on) {
        g.shadowColor = lit;
        g.shadowBlur = 3;
      }
      g.fillRect(x + 0.5, y + 0.5, cw - 1, ch - 1);
      g.shadowBlur = 0;
      wrap(l.legend, 10).forEach((t, j, arr) => text(g, t, x + cw / 2, y + ch / 2 + (j - (arr.length - 1) / 2) * 2.4, 2.0, on ? '#1a0800' : 'rgba(170,160,140,0.5)', 'center', 700));
    });
  }
}

export class Talkback extends Widget {
  constructor(o) {
    super({ w: 9, h: 9, margin: 1, ...o });
    this.key = o.key;
  }

  signature() {
    return this.tm?.[this.key] ?? 'GRAY';
  }

  draw(g) {
    const v = this.signature();
    const cx = this.x + this.w / 2;
    const cy = this.y + this.h / 2;
    g.fillStyle = '#0b0b0c';
    g.beginPath();
    g.arc(cx, cy, 4.2, 0, Math.PI * 2);
    g.fill();
    g.save();
    g.beginPath();
    g.arc(cx, cy, 3.4, 0, Math.PI * 2);
    g.clip();
    if (v === 'BARBER' || v === 'CLOSED' || v === false) {
      g.fillStyle = '#eee';
      g.fillRect(cx - 4, cy - 4, 8, 8);
      g.strokeStyle = '#111';
      g.lineWidth = 1.1;
      for (let k = -8; k < 8; k += 2.2) {
        g.beginPath();
        g.moveTo(cx + k, cy - 4);
        g.lineTo(cx + k + 8, cy + 4);
        g.stroke();
      }
    } else {
      g.fillStyle = '#8d8f92';
      g.fillRect(cx - 4, cy - 4, 8, 8);
    }
    g.restore();
  }

  tooltipText() {
    return `Indicador: ${this.signature() === 'GRAY' || this.signature() === 'OPEN' || this.signature() === true ? 'gris (abierto / conectado)' : 'rayado (cerrado / desconectado)'}`;
  }
}

/** Vertical edgewise meter. */
export class EdgeMeter extends Widget {
  constructor(o) {
    super({ w: 14, h: 46, margin: 1, ...o });
    this.key = o.key;
    this.min = o.min ?? 0;
    this.max = o.max ?? 100;
    this.scale = o.scale ?? 1;
    this.unit = o.unit ?? '';
  }

  value() {
    const v = this.tm?.[this.key];
    return typeof v === 'number' && Number.isFinite(v) ? v * this.scale : this.min;
  }

  signature() {
    return Math.round(((this.value() - this.min) / (this.max - this.min)) * 300);
  }

  draw(g) {
    const { x, y, w, h } = this;
    g.fillStyle = '#0c0c0d';
    g.fillRect(x, y, w, h);
    const fx = x + 2;
    const fy = y + 6;
    const fw = w - 4;
    const fh = h - 12;
    g.fillStyle = '#e9e6db';
    g.fillRect(fx, fy, fw, fh);
    g.strokeStyle = '#111';
    g.lineWidth = 0.3;
    for (let i = 0; i <= 10; i++) {
      const yy = fy + fh - (fh * i) / 10;
      g.beginPath();
      g.moveTo(fx, yy);
      g.lineTo(fx + (i % 5 === 0 ? fw * 0.55 : fw * 0.3), yy);
      g.stroke();
      if (i % 5 === 0) text(g, String(Math.round(this.min + ((this.max - this.min) * i) / 10)), fx + fw - 2.2, yy, 2, '#111');
    }
    const t = Math.max(0, Math.min(1, (this.value() - this.min) / (this.max - this.min)));
    const py = fy + fh - fh * t;
    g.fillStyle = '#d02010';
    g.beginPath();
    g.moveTo(fx, py);
    g.lineTo(fx + fw * 0.6, py - 1.2);
    g.lineTo(fx + fw * 0.6, py + 1.2);
    g.fill();
    if (this.label) text(g, this.label, x + w / 2, y + 2.8, 2.1, '#fff', 'center', 700);
    if (this.unit) text(g, this.unit, x + w / 2, y + h - 2.8, 1.9, '#ddd');
  }

  tooltipText() {
    return `${this.label ?? this.key}: ${this.value().toFixed(1)} ${this.unit}`;
  }
}

export class RoundGauge extends Widget {
  constructor(o) {
    super({ w: 34, h: 34, margin: 1, ...o });
    this.key = o.key;
    this.min = o.min ?? 0;
    this.max = o.max ?? 100;
    this.unit = o.unit ?? '';
  }

  value() {
    const v = this.tm?.[this.key];
    return typeof v === 'number' && Number.isFinite(v) ? v : this.min;
  }

  signature() {
    return Math.round(((this.value() - this.min) / (this.max - this.min)) * 400);
  }

  draw(g) {
    const cx = this.x + this.w / 2;
    const cy = this.y + this.h / 2;
    const r = this.w / 2 - 1;
    g.fillStyle = '#0b0b0c';
    g.beginPath();
    g.arc(cx, cy, r + 1, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#151618';
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
    const a0 = Math.PI * 0.75;
    const a1 = Math.PI * 2.25;
    g.strokeStyle = '#eee';
    g.lineWidth = 0.35;
    for (let i = 0; i <= 10; i++) {
      const a = a0 + ((a1 - a0) * i) / 10;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * r * 0.78, cy + Math.sin(a) * r * 0.78);
      g.lineTo(cx + Math.cos(a) * r * 0.92, cy + Math.sin(a) * r * 0.92);
      g.stroke();
      if (i % 2 === 0) text(g, String(Math.round(this.min + ((this.max - this.min) * i) / 10)), cx + Math.cos(a) * r * 0.6, cy + Math.sin(a) * r * 0.6, 2, '#eee');
    }
    const t = Math.max(0, Math.min(1, (this.value() - this.min) / (this.max - this.min)));
    const a = a0 + (a1 - a0) * t;
    g.strokeStyle = '#ffffff';
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(a) * r * 0.85, cy + Math.sin(a) * r * 0.85);
    g.stroke();
    g.fillStyle = '#333';
    g.beginPath();
    g.arc(cx, cy, 1.6, 0, Math.PI * 2);
    g.fill();
    if (this.label) text(g, this.label, cx, cy + r * 0.42, 2.2, '#fff', 'center', 700);
    if (this.unit) text(g, this.unit, cx, cy + r * 0.62, 1.8, '#bbb');
  }

  tooltipText() {
    return `${this.label ?? this.key}: ${this.value().toFixed(1)} ${this.unit}`;
  }
}

// ------------------------------------------------------------------ seven segment / timers

const SEG = { '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcfgd', '-': 'g', '+': 'g', ' ': '' };

/** Draw a 7-segment digit (EL green) at x,y with height h. */
export function drawDigit(g, ch, x, y, h, color = '#7dff9c', dim = 'rgba(60,255,120,0.06)') {
  const w = h * 0.55;
  const t = h * 0.12;
  const segs = {
    a: [x + t, y, w - 2 * t, t],
    b: [x + w - t, y + t, t, h / 2 - 1.5 * t],
    c: [x + w - t, y + h / 2 + 0.5 * t, t, h / 2 - 1.5 * t],
    d: [x + t, y + h - t, w - 2 * t, t],
    e: [x, y + h / 2 + 0.5 * t, t, h / 2 - 1.5 * t],
    f: [x, y + t, t, h / 2 - 1.5 * t],
    g: [x + t, y + h / 2 - t / 2, w - 2 * t, t],
  };
  const on = SEG[ch] ?? '';
  for (const [k, r] of Object.entries(segs)) {
    g.fillStyle = on.includes(k) ? color : dim;
    g.fillRect(r[0], r[1], r[2], r[3]);
  }
  if (ch === '+') {
    g.fillStyle = color;
    g.fillRect(x + w / 2 - t / 2, y + h / 2 - w / 2 + t, t, w - 2 * t);
  }
}

export class MissionTimer extends Widget {
  constructor(o) {
    super({ w: 80, h: 20, margin: 1, ...o });
    this.key = o.key ?? 'CM.MT.GET';
  }

  signature() {
    const v = this.tm?.[this.key];
    return Number.isFinite(v) ? Math.floor(v) : 'off';
  }

  draw(g) {
    const v = this.tm[this.key];
    g.fillStyle = '#0a0d0b';
    g.fillRect(this.x, this.y, this.w, this.h);
    let s = '   :  :  ';
    if (Number.isFinite(v)) {
      const t = Math.abs(v);
      const hh = Math.floor(t / 3600);
      const mm = Math.floor((t % 3600) / 60);
      const ss = Math.floor(t % 60);
      s = `${String(hh).padStart(3, '0')}${String(mm).padStart(2, '0')}${String(ss).padStart(2, '0')}`;
    }
    const dh = this.h * 0.62;
    let x = this.x + 3;
    const digits = s.replace(/:/g, '');
    for (let i = 0; i < 7; i++) {
      drawDigit(g, digits[i] ?? ' ', x, this.y + (this.h - dh) / 2, dh);
      x += dh * 0.72;
      if (i === 2 || i === 4) x += dh * 0.25;
    }
    if (this.label) text(g, this.label, this.x + this.w / 2, this.y - 2.5, 2.4, '#fff', 'center', 700);
  }
}

// ------------------------------------------------------------------ DSKY

const DSKY_KEYS = [
  ['VERB', 0, 0], ['+', 1, 0], ['7', 2, 0], ['8', 3, 0], ['9', 4, 0], ['CLR', 5, 0],
  ['NOUN', 0, 1], ['-', 1, 1], ['4', 2, 1], ['5', 3, 1], ['6', 4, 1], ['PRO', 5, 1],
  ['', 0, 2], ['0', 1, 2], ['1', 2, 2], ['2', 3, 2], ['3', 4, 2], ['KEY REL', 5, 2],
  ['ENTR', 6, 0.5], ['RSET', 6, 1.5],
];

export class DSKYWidget extends Widget {
  /** o: { source: () => dsky } (gnc.cmc.dsky or gnc.lgc.dsky) w≈180 h≈200 */
  constructor(o) {
    super({ w: 180, h: 200, interactive: true, margin: 1, ...o });
    this.source = o.source;
    this._pressed = null;
  }

  get dsky() {
    return this.source?.();
  }

  signature() {
    const d = this.dsky;
    const flash = d?.display.flashVN ? Math.floor((this.panel?.time ?? 0) * 1.6) % 2 : 0;
    return `${d?.version}|${flash}|${this._pressed}`;
  }

  _keyRect(c, r) {
    const kx = this.x + 6;
    const ky = this.y + this.h * 0.56;
    const kw = (this.w - 12) / 7;
    const kh = (this.h * 0.42) / 3;
    return [kx + c * kw + 1, ky + r * kh + 1, kw - 2, kh - 2];
  }

  draw(g) {
    const d = this.dsky?.display;
    const { x, y, w, h } = this;
    g.fillStyle = '#2b2c2f';
    roundRect(g, x, y, w, h, 3);
    g.fill();
    // status lamps (left)
    const lamps = [
      ['UPLINK ACTY', 'uplinkActy'], ['TEMP', 'temp'], ['NO ATT', 'noAtt'], ['GIMBAL LOCK', 'gimbalLock'], ['STBY', 'stby'], ['PROG', 'prog'],
      ['KEY REL', 'keyRel'], ['RESTART', 'restart'], ['OPR ERR', 'oprErr'], ['TRACKER', 'tracker'], ['', 'x1'], ['ALT', 'alt'], ['', 'x2'], ['VEL', 'vel'],
    ];
    const lw = (w * 0.44 - 6) / 2;
    const lh = (h * 0.5 - 6) / 7;
    lamps.forEach(([lbl, k], i) => {
      const lx = x + 4 + (i % 2) * lw;
      const ly = y + 4 + Math.floor(i / 2) * lh;
      const on = d?.lights?.[k];
      const warn = k === 'temp' || k === 'gimbalLock' || k === 'prog' || k === 'restart' || k === 'tracker' || k === 'alt' || k === 'vel';
      g.fillStyle = on ? (warn ? '#ffbf38' : '#f4f4f0') : '#3b3a36';
      g.fillRect(lx + 0.6, ly + 0.6, lw - 1.2, lh - 1.2);
      if (lbl) text(g, lbl, lx + lw / 2, ly + lh / 2, 2.2, on ? '#1b1200' : 'rgba(190,185,170,0.45)', 'center', 700);
    });
    // EL display (right)
    const ex = x + w * 0.47;
    const ey = y + 4;
    const ew = w * 0.53 - 4;
    const eh = h * 0.5 - 6;
    g.fillStyle = '#0a0f0b';
    g.fillRect(ex, ey, ew, eh);
    const green = '#7dff9c';
    const flashOff = d?.flashVN && Math.floor((this.panel?.time ?? 0) * 1.6) % 2;
    g.fillStyle = d?.compActy ? green : 'rgba(60,255,120,0.08)';
    g.fillRect(ex + 3, ey + 3, 13, 11);
    if (d?.compActy) text(g, 'COMP', ex + 9.5, ey + 6.6, 2.2, '#0a1a0a', 'center', 700);
    if (d?.compActy) text(g, 'ACTY', ex + 9.5, ey + 10.4, 2.2, '#0a1a0a', 'center', 700);
    const lab = (t, lx, ly) => {
      g.fillStyle = green;
      g.fillRect(lx, ly, 15, 3.4);
      text(g, t, lx + 7.5, ly + 1.8, 2.2, '#0a1a0a', 'center', 700);
    };
    lab('PROG', ex + ew - 19, ey + 2);
    lab('VERB', ex + 3, ey + 18);
    lab('NOUN', ex + ew - 19, ey + 18);
    const dig = (s, lx, ly, hh) => {
      for (let i = 0; i < s.length; i++) drawDigit(g, s[i], lx + i * hh * 0.7, ly, hh);
    };
    dig(d?.prog ?? '  ', ex + ew - 19, ey + 6.5, 8);
    if (!flashOff) {
      dig(d?.verb ?? '  ', ex + 4, ey + 22.5, 8);
      dig(d?.noun ?? '  ', ex + ew - 19, ey + 22.5, 8);
    }
    const regs = [d?.r1, d?.r2, d?.r3];
    regs.forEach((r, i) => {
      const ly = ey + 34 + i * ((eh - 37) / 3);
      g.fillStyle = 'rgba(125,255,156,0.5)';
      g.fillRect(ex + 3, ly - 1.4, ew - 6, 0.4);
      dig((r ?? '      ').padEnd(6, ' '), ex + 5, ly, (eh - 37) / 3 - 3);
    });
    // keys
    for (const [k, c, r] of DSKY_KEYS) {
      if (!k) continue;
      const [kx, ky, kw, kh] = this._keyRect(c, r);
      const p = this._pressed === k;
      g.fillStyle = '#121214';
      roundRect(g, kx, ky, kw, kh, 1.2);
      g.fill();
      g.fillStyle = p ? '#3a3a3e' : '#2a2a2e';
      roundRect(g, kx + 0.6, ky + 0.6 + (p ? 0.5 : 0), kw - 1.2, kh - 1.4, 1);
      g.fill();
      const lines = k === 'KEY REL' ? ['KEY', 'REL'] : [k];
      lines.forEach((l, i) => text(g, l, kx + kw / 2, ky + kh / 2 + (i - (lines.length - 1) / 2) * 3.4, k.length === 1 ? 6 : 3.1, '#f4f4f0', 'center', 700));
    }
  }

  _keyAt(lx, ly) {
    for (const [k, c, r] of DSKY_KEYS) {
      if (!k) continue;
      const [kx, ky, kw, kh] = this._keyRect(c, r);
      if (lx + this.x >= kx && lx + this.x <= kx + kw && ly + this.y >= ky && ly + this.y <= ky + kh) return k;
    }
    return null;
  }

  onPointerDown(e) {
    const k = this._keyAt(e.lx, e.ly);
    if (!k) return false;
    this._pressed = k;
    this.dsky?.press(k);
    sfx(this, 'dskyKey');
    return true;
  }

  onPointerUp() {
    if (this._pressed) this.dsky?.release?.(this._pressed);
    this._pressed = null;
  }

  onKey(e) {
    const map = { KeyV: 'VERB', KeyN: 'NOUN', Enter: 'ENTR', NumpadEnter: 'ENTR', Backspace: 'CLR', Delete: 'CLR', KeyP: 'PRO', KeyR: 'RSET', KeyK: 'KEY REL', Equal: '+', NumpadAdd: '+', Minus: '-', NumpadSubtract: '-' };
    let k = map[e.code];
    if (!k && /^(Digit|Numpad)[0-9]$/.test(e.code)) k = e.code.slice(-1);
    if (!k) return false;
    this.dsky?.press(k);
    sfx(this, 'dskyKey');
    this.invalidate();
    return true;
  }

  cursor(e) {
    return this._keyAt(e.lx, e.ly) ? 'pointer' : null;
  }

  tooltipText() {
    return 'DSKY — teclado y pantalla del ordenador de guiado.\nTeclado: V=VERB, N=NOUN, números, Enter=ENTR, Retroceso=CLR, P=PRO, R=RSET, K=KEY REL (con el ratón encima).';
  }
}

// ------------------------------------------------------------------ FDAI

export class FDAI extends Widget {
  /** o: { prefix: 'CM.FDAI1' } */
  constructor(o) {
    super({ w: 130, h: 130, margin: 1, ...o });
    this.prefix = o.prefix;
  }

  _att() {
    const tm = this.tm;
    const p = this.prefix;
    return [tm?.[`${p}.ROLL`] ?? 0, tm?.[`${p}.PITCH`] ?? 0, tm?.[`${p}.YAW`] ?? 0, tm?.[`${p}.RATE_ROLL`] ?? 0, tm?.[`${p}.RATE_PITCH`] ?? 0, tm?.[`${p}.RATE_YAW`] ?? 0, tm?.[`${p}.ERR_ROLL`] ?? 0, tm?.[`${p}.ERR_PITCH`] ?? 0, tm?.[`${p}.ERR_YAW`] ?? 0];
  }

  signature() {
    return this._att().map((v) => Math.round(v * 4)).join(',');
  }

  draw(g) {
    const [roll, pitch, yaw, rr, rp, ry, er, ep, ey] = this._att();
    const cx = this.x + this.w / 2;
    const cy = this.y + this.h / 2;
    const R = this.w * 0.38;
    g.fillStyle = '#141516';
    roundRect(g, this.x, this.y, this.w, this.h, 4);
    g.fill();
    // ball
    g.save();
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.clip();
    const D = Math.PI / 180;
    const cr = Math.cos(roll * D), sr = Math.sin(roll * D);
    const cp = Math.cos(pitch * D), sp = Math.sin(pitch * D);
    const cyw = Math.cos(yaw * D), syw = Math.sin(yaw * D);
    // rotate a sphere point (lat, lon) by attitude → screen
    const proj = (lat, lon) => {
      let X = Math.cos(lat) * Math.cos(lon);
      let Y = Math.cos(lat) * Math.sin(lon);
      let Z = Math.sin(lat);
      // yaw about Z, pitch about Y, roll about X (viewer looks along +X)
      [X, Y] = [X * cyw + Y * syw, -X * syw + Y * cyw];
      [X, Z] = [X * cp + Z * sp, -X * sp + Z * cp];
      [Y, Z] = [Y * cr - Z * sr, Y * sr + Z * cr];
      return [X, cx + Y * R, cy - Z * R];
    };
    // hemispheres: sky (white/light grey) and ground (dark)
    g.fillStyle = '#2a2a2c';
    g.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    g.fillStyle = '#d9d7cf';
    for (let lat = 0; lat < 90; lat += 6) {
      for (let lon = 0; lon < 360; lon += 10) {
        const pts = [proj(lat * D, lon * D), proj((lat + 6) * D, lon * D), proj((lat + 6) * D, (lon + 10) * D), proj(lat * D, (lon + 10) * D)];
        if (pts.every((p) => p[0] < 0)) continue;
        g.beginPath();
        pts.forEach(([, px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
        g.fill();
      }
    }
    // grid lines
    g.lineWidth = 0.45;
    for (let lat = -60; lat <= 60; lat += 30) {
      g.strokeStyle = lat >= 0 ? '#333' : '#bbb';
      g.beginPath();
      let pen = false;
      for (let lon = 0; lon <= 360; lon += 5) {
        const [f, px, py] = proj(lat * D, lon * D);
        if (f > 0) {
          pen ? g.lineTo(px, py) : g.moveTo(px, py);
          pen = true;
        } else pen = false;
      }
      g.stroke();
    }
    for (let lon = 0; lon < 360; lon += 30) {
      g.strokeStyle = '#777';
      g.beginPath();
      let pen = false;
      for (let lat = -90; lat <= 90; lat += 5) {
        const [f, px, py] = proj(lat * D, lon * D);
        if (f > 0) {
          pen ? g.lineTo(px, py) : g.moveTo(px, py);
          pen = true;
        } else pen = false;
      }
      g.stroke();
      const [f, px, py] = proj(4 * D, lon * D);
      if (f > 0.3) text(g, String(lon / 10).padStart(2, '0'), px, py, 3.2, '#222', 'center', 700);
    }
    g.restore();
    // bezel + aircraft symbol
    g.strokeStyle = '#000';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = '#ffa01e';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(cx - 14, cy);
    g.lineTo(cx - 4, cy);
    g.moveTo(cx + 4, cy);
    g.lineTo(cx + 14, cy);
    g.moveTo(cx, cy - 4);
    g.lineTo(cx, cy + 4);
    g.stroke();
    // error needles
    g.strokeStyle = '#f2d230';
    g.lineWidth = 0.9;
    g.beginPath();
    g.moveTo(cx + er * R * 0.6, cy - R * 0.8);
    g.lineTo(cx + er * R * 0.6, cy - R * 0.35);
    g.moveTo(cx - R * 0.8, cy + ep * R * 0.6);
    g.lineTo(cx - R * 0.35, cy + ep * R * 0.6);
    g.moveTo(cx + ey * R * 0.6, cy + R * 0.8);
    g.lineTo(cx + ey * R * 0.6, cy + R * 0.35);
    g.stroke();
    // rate scales
    const bar = (x0, y0, horiz, v) => {
      g.fillStyle = '#e6e6e0';
      if (horiz) g.fillRect(x0 - R * 0.7, y0, R * 1.4, 1);
      else g.fillRect(x0, y0 - R * 0.7, 1, R * 1.4);
      g.fillStyle = '#ffffff';
      if (horiz) g.fillRect(x0 + v * R * 0.7 - 1.2, y0 - 2.2, 2.4, 3.4);
      else g.fillRect(x0 - 2.2, y0 + v * R * 0.7 - 1.2, 3.4, 2.4);
    };
    bar(cx, this.y + 5, true, rr);
    bar(this.x + this.w - 6, cy, false, rp);
    bar(cx, this.y + this.h - 6, true, ry);
    text(g, 'R', this.x + 6, this.y + 6, 3, '#ddd');
    text(g, `${roll.toFixed(0).padStart(3, '0')} ${pitch.toFixed(0).padStart(3, '0')} ${yaw.toFixed(0).padStart(3, '0')}`, cx, this.y + this.h - 11.5, 3, '#9fb', 'center', 600);
  }

  tooltipText() {
    const [r, p, y] = this._att();
    return `FDAI (bola de actitud) — alabeo ${r.toFixed(1)}°, cabeceo ${p.toFixed(1)}°, guiñada ${y.toFixed(1)}°`;
  }
}

export class DigitalReadout extends Widget {
  /** Numeric readout of a tm key (green EL digits). o: { key, digits, scale, decimals } */
  constructor(o) {
    super({ w: 44, h: 16, margin: 1, ...o });
    this.key = o.key;
    this.digits = o.digits ?? 5;
    this.scale = o.scale ?? 1;
    this.fn = o.fn ?? null;
  }

  val() {
    const v = this.fn ? this.fn(this.tm, this.ctx) : this.tm?.[this.key];
    return Number.isFinite(v) ? v * this.scale : NaN;
  }

  signature() {
    return Math.round(this.val());
  }

  draw(g) {
    const v = this.val();
    g.fillStyle = '#0a0d0b';
    g.fillRect(this.x, this.y, this.w, this.h);
    const s = Number.isFinite(v) ? (v < 0 ? '-' : '+') + String(Math.min(10 ** this.digits - 1, Math.round(Math.abs(v)))).padStart(this.digits, '0') : ' '.repeat(this.digits + 1);
    const dh = this.h * 0.64;
    for (let i = 0; i < s.length; i++) drawDigit(g, s[i], this.x + 2 + i * dh * 0.7, this.y + (this.h - dh) / 2, dh);
    if (this.label) text(g, this.label, this.x + this.w / 2, this.y - 2.4, 2.3, '#fff', 'center', 700);
  }
}
