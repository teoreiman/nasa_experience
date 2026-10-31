// Flight director overlay for the manually piloted Saturn V ascent (game mode "CMC takeover"):
// a fixed nose marker in the centre of the screen and the guidance diamond the pilot must keep it
// on, a q·α structural-load meter, pitch / heading readouts, warnings, and the MANUAL / AUTO
// buttons. Reads SaturnV state (manualTheta/Psi, guideTheta/Psi, qAlpha) every frame.

import { h } from '../core/dom.js';
import { QALPHA_LIMIT } from '../sim/physics/SaturnV.js';

const D = Math.PI / 180;
const SCALE = 9; // px per degree of error at the default size

export class FlightDirector {
  constructor({ game, sim, root }) {
    this.game = game;
    this.sim = sim;
    this.canvas = h('canvas', { class: 'fd-canvas' });
    this.msg = h('div', { class: 'fd-msg' });
    this.read = h('div', { class: 'fd-read' });
    this.btn = h('button', { class: 'btn btn-sm fd-btn', on: { click: () => this.toggle() } }, 'Piloto manual');
    this.help = h('div', { class: 'fd-help' }, game.input.isTouch ? 'Joystick izquierdo: lleva la mira al rombo' : 'W / S cabeceo · A / D rumbo · P automático');
    this.el = h('div', { class: 'hud-fd', hidden: true }, this.canvas, this.read, this.msg, this.help);
    this.btnWrap = h('div', { class: 'fd-btn-wrap', hidden: true }, this.btn);
    root.append(this.el, this.btnWrap);
    this.g = this.canvas.getContext('2d');
    this.t = 0;
    this._acc = 1;
    this._size = 0;
  }

  get sat() {
    return this.sim.vehicle.modules.saturn;
  }

  /** Powered ascent with the Saturn V still attached. */
  get flying() {
    const sat = this.sat;
    const v = this.sim.vehicle;
    return !!sat && v.isAttached('saturn') && v.state.liftoff && !sat.brokenUp && ['SIC', 'SIB', 'SII', 'SIVB'].includes(sat.stage);
  }

  toggle() {
    const sat = this.sat;
    if (!sat || !this.flying) return;
    sat.manual = !sat.manual;
    this.sim.bus.emit('saturn:manual', { manual: sat.manual, get: this.sim.clock.get });
    this.game.audio?.sfx?.(sat.manual ? 'uiConfirm' : 'uiBack');
  }

  update(dt) {
    const sat = this.sat;
    const show = this.flying;
    this.btnWrap.hidden = !show;
    if (!show) {
      this.el.hidden = true;
      return;
    }
    if (this.game.input.pressed('pilotToggle')) this.toggle();
    this.btn.textContent = sat.manual ? 'Ceder a la computadora (P)' : 'Tomar el control manual (P)';
    this.btn.classList.toggle('on', !sat.manual);
    this.el.hidden = !sat.manual;
    if (!sat.manual) return;
    this.t += dt;
    this._acc += dt;
    if (this._acc < 1 / 40) return;
    this._acc = 0;
    this._draw();
  }

  _draw() {
    const sat = this.sat;
    const st = this.sim.vehicle.state;
    const c = this.canvas;
    const css = Math.round(Math.min(290, Math.max(170, Math.min(window.innerWidth, window.innerHeight) * 0.5)));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this._size !== css) {
      this._size = css;
      c.width = css * dpr;
      c.height = css * dpr;
      c.style.width = `${css}px`;
      c.style.height = `${css}px`;
    }
    const g = this.g;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, css, css);
    const cx = css / 2;
    const cy = css / 2;
    const R = css * 0.4;
    const sc = (SCALE * css) / 300;
    const eTh = (sat.guideTheta - sat.manualTheta) / D; // + → the guide is further over (nose must go down)
    let ePs = (sat.guidePsi - sat.manualPsi) / D;
    ePs *= Math.sin(Math.max(0.25, sat.manualTheta));
    const err = Math.hypot(eTh, ePs);
    const qa = sat.qAlpha;
    const load = qa / QALPHA_LIMIT;
    const danger = load > 0.85 || sat.overloadT > 0;
    // ring + error scale
    g.lineWidth = 1.5;
    g.strokeStyle = danger && Math.floor(this.t * 6) % 2 ? 'rgba(255,90,70,0.9)' : 'rgba(170,220,255,0.45)';
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = 'rgba(170,220,255,0.22)';
    for (const r of [2, 5]) {
      g.beginPath();
      g.arc(cx, cy, r * sc, 0, Math.PI * 2);
      g.stroke();
    }
    for (let a = 0; a < 360; a += 30) {
      const s = Math.sin(a * D);
      const k = Math.cos(a * D);
      g.beginPath();
      g.moveTo(cx + s * R, cy - k * R);
      g.lineTo(cx + s * (R - 8), cy - k * (R - 8));
      g.stroke();
    }
    // target diamond: up = nose up (less pitch-over), right = heading to the right
    let dx = ePs * sc;
    let dy = eTh * sc; // guide further over → diamond below the nose
    const dl = Math.hypot(dx, dy);
    const clamped = dl > R - 10;
    if (clamped) {
      dx *= (R - 10) / dl;
      dy *= (R - 10) / dl;
    }
    const tx = cx + dx;
    const ty = cy + dy;
    const good = err < 2;
    g.fillStyle = good ? '#6dffa0' : err < 5 ? '#ffd27a' : '#ff6a50';
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 2;
    if (clamped) {
      const ang = Math.atan2(dy, dx);
      g.save();
      g.translate(tx, ty);
      g.rotate(ang);
      g.beginPath();
      g.moveTo(10, 0);
      g.lineTo(-8, -9);
      g.lineTo(-8, 9);
      g.closePath();
      g.fill();
      g.stroke();
      g.restore();
    } else {
      g.beginPath();
      g.moveTo(tx, ty - 11);
      g.lineTo(tx + 11, ty);
      g.lineTo(tx, ty + 11);
      g.lineTo(tx - 11, ty);
      g.closePath();
      g.fill();
      g.stroke();
    }
    // fixed nose marker (W symbol)
    g.strokeStyle = '#ffb000';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(cx - 26, cy);
    g.lineTo(cx - 12, cy);
    g.lineTo(cx - 6, cy + 8);
    g.lineTo(cx, cy);
    g.lineTo(cx + 6, cy + 8);
    g.lineTo(cx + 12, cy);
    g.lineTo(cx + 26, cy);
    g.stroke();
    // q·α meter on the right edge
    const bx = css - 16;
    const by = cy - R * 0.8;
    const bh = R * 1.6;
    g.fillStyle = 'rgba(8,12,18,0.6)';
    g.fillRect(bx - 6, by, 12, bh);
    const f = Math.min(1, load);
    g.fillStyle = load > 0.85 ? '#ff5340' : load > 0.6 ? '#ffb000' : '#6dffa0';
    g.fillRect(bx - 5, by + bh * (1 - f), 10, bh * f);
    g.strokeStyle = 'rgba(255,255,255,0.5)';
    g.lineWidth = 1;
    g.strokeRect(bx - 6, by, 12, bh);
    g.strokeStyle = '#ff5340';
    g.beginPath();
    g.moveTo(bx - 9, by + 1);
    g.lineTo(bx + 9, by + 1);
    g.stroke();
    g.save();
    g.translate(bx - 14, cy);
    g.rotate(-Math.PI / 2);
    g.fillStyle = 'rgba(220,235,255,0.75)';
    g.font = '600 11px "Barlow Condensed", sans-serif';
    g.textAlign = 'center';
    g.fillText('CARGA q·α', 0, 0);
    g.restore();
    // readouts
    const th = sat.manualTheta / D;
    const gt = sat.guideTheta / D;
    const stage = sat.stage === 'SIC' ? 'S-IC' : sat.stage === 'SII' ? 'S-II' : sat.stage === 'SIVB' ? 'S-IVB' : sat.stage;
    this.read.textContent = `${stage} · cabeceo ${(90 - th).toFixed(1)}° (guía ${(90 - gt).toFixed(1)}°) · rumbo ${(72 + sat.manualPsi / D).toFixed(1)}° · α ${sat.alpha.toFixed(1)}°`;
    let m = '';
    let cls = '';
    if (danger) {
      m = '¡CARGA ESTRUCTURAL! VUELVE A LA GUÍA';
      cls = 'warn';
    } else if (err > 6) {
      m = eTh > 0 ? '▼ BAJA LA NARIZ' : '▲ SUBE LA NARIZ';
      if (Math.abs(ePs) > Math.abs(eTh)) m = ePs > 0 ? 'GIRA A LA DERECHA ▶' : '◀ GIRA A LA IZQUIERDA';
      cls = 'caution';
    } else if (good) {
      m = st.dynPressure > 20000 ? 'MÁXIMA PRESIÓN · MANTÉN LA GUÍA' : 'EN LA GUÍA';
      cls = 'good';
    }
    if (this.msg.textContent !== m) this.msg.textContent = m;
    this.msg.className = `fd-msg ${cls}`;
    this.help.hidden = this.sim.clock.get > 45;
  }

  dispose() {
    this.el.remove();
    this.btnWrap.remove();
  }
}

/** Entry director for a hand-flown entry (SC CONT on SCS): lift-vector dial with the guidance bank,
 *  g-meter with the 6.5 g corridor limit, and skip-out / overload warnings. */
export class EntryDirector {
  constructor({ game, sim, root }) {
    this.game = game;
    this.sim = sim;
    this.canvas = h('canvas', { class: 'fd-canvas' });
    this.msg = h('div', { class: 'fd-msg' });
    this.read = h('div', { class: 'fd-read' });
    this.help = h('div', { class: 'fd-help' }, game.input.isTouch ? 'Botones de alabeo: lleva la flecha a la guía' : 'Q / E: alabeo · lleva la flecha naranja a la guía');
    this.el = h('div', { class: 'hud-fd entry', hidden: true }, this.canvas, this.read, this.msg, this.help);
    root.append(this.el);
    this.g = this.canvas.getContext('2d');
    this.t = 0;
    this._acc = 1;
    this._size = 0;
    this.peakG = 0;
  }

  get active() {
    const v = this.sim.vehicle;
    const st = v.state;
    return v.config === 'CM' && st.primary === 'EARTH' && st.alt < 140000 && st.alt > 9000 && !v.parts.drogues && !st.splashed && v.sw.get('CM.GNC.SC_CONT') !== 'CMC' && this.sim.gnc?.autopilot?.mode !== 'ENTRY';
  }

  /** The bank the CMC's entry law would command now (rad). */
  guideBank() {
    const st = this.sim.vehicle.state;
    return st.gLoad > 5.5 ? 0 : st.hdot > 30 ? Math.PI * 0.6 : Math.PI * 0.25;
  }

  update(dt) {
    const show = this.active;
    this.el.hidden = !show;
    if (!show) return;
    this.t += dt;
    this._acc += dt;
    if (this._acc < 1 / 30) return;
    this._acc = 0;
    this._draw();
  }

  _draw() {
    const v = this.sim.vehicle;
    const st = v.state;
    const c = this.canvas;
    const css = Math.round(Math.min(250, Math.max(160, Math.min(window.innerWidth, window.innerHeight) * 0.44)));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this._size !== css) {
      this._size = css;
      c.width = css * dpr;
      c.height = css * dpr;
      c.style.width = `${css}px`;
      c.style.height = `${css}px`;
    }
    const g = this.g;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, css, css);
    const cx = css / 2 - 10;
    const cy = css / 2;
    const R = css * 0.36;
    const bank = v.cmd.entryBank ?? 0;
    const target = this.guideBank();
    let err = Math.atan2(Math.sin(target - bank), Math.cos(target - bank));
    const gl = st.gLoad || 0;
    this.peakG = Math.max(this.peakG, gl);
    // dial
    g.lineWidth = 1.5;
    g.strokeStyle = 'rgba(170,220,255,0.45)';
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = 'rgba(170,220,255,0.6)';
    g.font = '600 11px "Barlow Condensed", sans-serif';
    g.textAlign = 'center';
    g.fillText('ARRIBA', cx, cy - R - 6);
    g.fillText('ABAJO', cx, cy + R + 14);
    // capsule silhouette (heat shield toward the airflow)
    g.fillStyle = 'rgba(220,230,240,0.25)';
    g.beginPath();
    g.moveTo(cx - 16, cy + 10);
    g.lineTo(cx + 16, cy + 10);
    g.lineTo(cx + 6, cy - 12);
    g.lineTo(cx - 6, cy - 12);
    g.closePath();
    g.fill();
    const arrow = (ang, color, w, len) => {
      const x = cx + Math.sin(ang) * len;
      const y = cy - Math.cos(ang) * len;
      g.strokeStyle = color;
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(x, y);
      g.stroke();
      g.fillStyle = color;
      g.beginPath();
      g.arc(x, y, w + 2, 0, Math.PI * 2);
      g.fill();
    };
    arrow(target, 'rgba(109,255,160,0.75)', 4, R - 4);
    arrow(bank, '#ffb000', 3, R - 14);
    // g-meter
    const bx = css - 14;
    const by = cy - R;
    const bh = R * 2;
    const f = Math.min(1, gl / 10);
    g.fillStyle = 'rgba(8,12,18,0.6)';
    g.fillRect(bx - 6, by, 12, bh);
    g.fillStyle = gl > 7.5 ? '#ff5340' : gl > 5 ? '#ffb000' : '#6dffa0';
    g.fillRect(bx - 5, by + bh * (1 - f), 10, bh * f);
    g.strokeStyle = 'rgba(255,255,255,0.5)';
    g.lineWidth = 1;
    g.strokeRect(bx - 6, by, 12, bh);
    const mark = (gv, color) => {
      const y = by + bh * (1 - gv / 10);
      g.strokeStyle = color;
      g.beginPath();
      g.moveTo(bx - 10, y);
      g.lineTo(bx + 8, y);
      g.stroke();
    };
    mark(7.5, '#ff5340');
    mark(5, '#ffb000');
    g.fillStyle = 'rgba(220,235,255,0.8)';
    g.fillText(`${gl.toFixed(1)} g`, bx - 2, by + bh + 14);
    this.read.textContent = `alt ${Math.round(st.alt / 0.3048).toLocaleString('es-AR')} ft · ${Math.round(st.speed / 0.3048).toLocaleString('es-AR')} ft/s · ${st.hdot >= 0 ? '+' : ''}${Math.round(st.hdot / 0.3048)} ft/s · pico ${this.peakG.toFixed(1)} g`;
    let m = '';
    let cls = '';
    if (gl > 7.5) {
      m = 'DEMASIADAS G · SUSTENTACIÓN ARRIBA';
      cls = 'warn';
    } else if (st.hdot > 30 && st.alt > 55000) {
      m = 'REBOTANDO · SUSTENTACIÓN ABAJO';
      cls = 'warn';
    } else if (Math.abs(err) > 0.35) {
      m = err > 0 ? 'ALABEA ↻' : '↺ ALABEA';
      cls = 'caution';
    } else {
      m = 'EN EL CORREDOR';
      cls = 'good';
    }
    if (this.msg.textContent !== m) this.msg.textContent = m;
    this.msg.className = `fd-msg ${cls}`;
    void err;
  }

  dispose() {
    this.el.remove();
  }
}
