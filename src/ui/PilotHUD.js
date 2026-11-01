// Pilot view symbology (astronaut, camera 'pilot'): a full-screen canvas over the 3D view.
//   docking: the COAS reticle on our docking axis, the target port, the target's axis (the "standoff
//     cross": centred when the attitudes match) and the closing numbers — translate to put the port
//     in the circle, rotate to put the cross on the port, close slower than 0.3 m/s;
//   LM landing: the horizon, the flight-path marker (where the LM is going), the landing site the
//     computer is flying to, and big altitude / descent-rate / fuel readouts;
//   forward (CSM): boresight and attitude rates.

import { FT } from '../core/constants.js';

const AMBER = '#ffb000';
const GREEN = '#6dffa0';
const RED = '#ff5340';
const ICE = 'rgba(220, 235, 250, 0.92)';
const _p = { x: 0, y: 0 };
const _p2 = { x: 0, y: 0 };

export class PilotHUD {
  constructor({ game, sim, view, root }) {
    this.game = game;
    this.sim = sim;
    this.view = view;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'pilot-hud';
    this.canvas.hidden = true;
    root.prepend(this.canvas);
    this.g = this.canvas.getContext('2d');
    this._acc = 1;
    this._pts = [];
    this._pool = Array.from({ length: 49 }, () => ({ x: 0, y: 0 }));
  }

  update(dt) {
    const on = this.view?.cameraMode === 'pilot';
    if (this.canvas.hidden === on) this.canvas.hidden = !on;
    // the HUD hides what the symbology already shows (telemetry strip, small COAS)
    const kind = on ? this.view.pilotKind : null;
    if (kind !== this._kind) {
      this._kind = kind;
      const hud = this.canvas.parentElement;
      hud?.classList.toggle('pilot-dock', kind === 'dock');
      hud?.classList.toggle('pilot-land', kind === 'land');
    }
    if (!on) return;
    this._acc += dt;
    if (this._acc < 1 / 30) return;
    this._acc = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = this.game.width;
    const H = this.game.height;
    if (this.canvas.width !== Math.round(W * dpr) || this.canvas.height !== Math.round(H * dpr)) {
      this.canvas.width = Math.round(W * dpr);
      this.canvas.height = Math.round(H * dpr);
    }
    const g = this.g;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    if (kind === 'dock') this._dock(g, W, H);
    else if (kind === 'land') this._land(g, W, H);
    else this._forward(g, W, H);
  }

  // ---------------------------------------------------------------- docking

  _dock(g, W, H) {
    const tel = this.view._pilot?.tel;
    const cx = W / 2;
    const cy = H / 2;
    const R = Math.min(W, H) * 0.17;
    // COAS: lighted reticle, a circle and a cross with elevation ticks every degree-ish
    g.save();
    g.shadowColor = 'rgba(255, 120, 30, 0.6)';
    g.shadowBlur = 8;
    g.strokeStyle = 'rgba(255, 140, 50, 0.95)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.moveTo(cx - R * 1.6, cy);
    g.lineTo(cx - R * 0.12, cy);
    g.moveTo(cx + R * 0.12, cy);
    g.lineTo(cx + R * 1.6, cy);
    g.moveTo(cx, cy - R * 1.6);
    g.lineTo(cx, cy - R * 0.12);
    g.moveTo(cx, cy + R * 0.12);
    g.lineTo(cx, cy + R * 1.6);
    for (let i = -5; i <= 5; i++) {
      if (!i) continue;
      const y = cy + (i * R) / 3.5;
      const w = i % 2 ? 6 : 11;
      g.moveTo(cx - w, y);
      g.lineTo(cx + w, y);
    }
    g.stroke();
    g.restore();
    if (!tel) {
      this._caption(g, W, H, 'Sin blanco a la vista', '');
      return;
    }
    const v = this.view;
    // target port and the far end of the target's axis (centred on the port when nose to nose)
    const port = v.projectToScreen(tel.portB, _p);
    const ax = this._axisPoint(tel);
    const axis = ax ? v.projectToScreen(ax, _p2) : null;
    const closing = -tel.rangeRate;
    const lat = Math.hypot(tel.lateral.y, tel.lateral.z);
    const latOk = lat < 0.3 || (tel.range > 30 && lat < tel.range * 0.02);
    const attOk = tel.misalign < 3;
    if (port) {
      const inside = Math.hypot(port.x - cx, port.y - cy) < R;
      const col = latOk ? GREEN : AMBER;
      // translation cue: the line from our axis to the port
      if (!inside) {
        g.strokeStyle = 'rgba(255, 200, 80, 0.55)';
        g.setLineDash([6, 6]);
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(cx, cy);
        g.lineTo(port.x, port.y);
        g.stroke();
        g.setLineDash([]);
      }
      g.strokeStyle = col;
      g.lineWidth = 2.5;
      const s = 12;
      g.beginPath();
      g.moveTo(port.x, port.y - s);
      g.lineTo(port.x + s, port.y);
      g.lineTo(port.x, port.y + s);
      g.lineTo(port.x - s, port.y);
      g.closePath();
      g.stroke();
      this._tag(g, port.x + s + 6, port.y - s, 'PUERTO', col);
    } else {
      this._caption(g, W, H, 'El blanco quedó detrás: gira la nave', '');
    }
    if (axis && port) {
      // the standoff cross: rotate until it sits on the port
      const col = attOk ? GREEN : '#ff8a3d';
      g.strokeStyle = col;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(axis.x - 16, axis.y);
      g.lineTo(axis.x + 16, axis.y);
      g.moveTo(axis.x, axis.y - 16);
      g.lineTo(axis.x, axis.y + 16);
      g.stroke();
      g.beginPath();
      g.arc(axis.x, axis.y, 5, 0, Math.PI * 2);
      g.stroke();
    }
    // numbers
    const range = `${tel.range < 100 ? tel.range.toFixed(1) : Math.round(tel.range)} m`;
    const rate = `${closing >= 0 ? '' : '−'}${Math.abs(closing).toFixed(2)} m/s`;
    const rateCol = closing > 0.6 ? RED : closing > 0.32 ? AMBER : closing > 0.02 ? GREEN : ICE;
    const rows = [
      ['DISTANCIA', range, ICE],
      ['CIERRE', rate, rateCol],
      ['LATERAL', `${lat.toFixed(2)} m`, latOk ? GREEN : AMBER],
      ['ÁNGULO', `${tel.misalign.toFixed(1)}°`, attOk ? GREEN : AMBER],
    ];
    this._readouts(g, W, H, rows);
    // what to do next, in one line
    let tip = '';
    if (!port) tip = 'Gira hacia el blanco';
    else if (!attOk) tip = 'Gira (joystick izquierdo / WASD) hasta poner la cruz sobre el puerto';
    else if (!latOk) tip = 'Traslada (joystick derecho / IJKL-UO) para meter el puerto en el círculo';
    else if (closing < 0.03) tip = 'Alineado: avanza despacio (adelante, I / joystick derecho)';
    else if (closing > 0.32) tip = 'Demasiado rápido: frena (atrás, K)';
    else tip = 'Perfecto: mantén el cierre entre 0,1 y 0,3 m/s';
    this._caption(g, W, H, tip, '');
  }

  /** A point far along the target's docking axis, behind its port (its vanishing point on screen). */
  _axisPoint(tel) {
    const b = tel.target;
    if (!b?.q) return null;
    // target +X (rotated by its attitude) faces us: go the other way, deep into the target
    const q = b.q;
    const x = 1 - 2 * (q.y * q.y + q.z * q.z);
    const y = 2 * (q.x * q.y + q.w * q.z);
    const z = 2 * (q.x * q.z - q.w * q.y);
    const cam = this.view.camWorld;
    const p = (this._axW ??= cam.clone());
    return p.set(cam.x - x * 2000, cam.y - y * 2000, cam.z - z * 2000);
  }

  // ---------------------------------------------------------------- LM landing

  _land(g, W, H) {
    const v = this.view;
    const sim = this.sim;
    const veh = sim.vehicle;
    const st = veh.state;
    const cam = v.camWorld;
    const moon = sim.dyn.moonPos;
    // horizon: points of the local horizontal plane far away, all round
    const up = (this._up ??= cam.clone()).copy(cam).sub(moon).normalize();
    const e1 = (this._e1 ??= cam.clone()).set(-up.y, up.x, 0);
    if (e1.lengthSq() < 1e-9) e1.set(1, 0, 0);
    e1.normalize();
    const e2 = (this._e2 ??= cam.clone()).crossVectors(up, e1);
    const tmp = (this._tw ??= cam.clone());
    const pts = this._pts;
    pts.length = 0;
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      tmp.copy(cam).addScaledVector(e1, Math.cos(a) * 3e4).addScaledVector(e2, Math.sin(a) * 3e4);
      pts.push(v.projectToScreen(tmp, this._pool[i]));
    }
    g.strokeStyle = 'rgba(180, 230, 255, 0.55)';
    g.lineWidth = 1.5;
    g.beginPath();
    let pen = false;
    for (const p of pts) {
      if (!p || p.x < -W || p.x > 2 * W || p.y < -H || p.y > 2 * H) {
        pen = false;
        continue;
      }
      if (!pen) g.moveTo(p.x, p.y);
      else g.lineTo(p.x, p.y);
      pen = true;
    }
    g.stroke();

    // landing site the computer flies to (P63–P64; redesignate with the arrows / LPD)
    const site = sim.gnc?.lmGuidance?.site?.r;
    if (site && !st.landed) {
      const s = v.projectToScreen(site, _p);
      if (s && s.x > -40 && s.x < W + 40 && s.y > -40 && s.y < H + 40) {
        g.strokeStyle = AMBER;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(s.x, s.y - 11);
        g.lineTo(s.x + 11, s.y);
        g.lineTo(s.x, s.y + 11);
        g.lineTo(s.x - 11, s.y);
        g.closePath();
        g.stroke();
        this._tag(g, s.x + 15, s.y - 6, 'SITIO', AMBER);
      }
    }

    // flight-path marker: where the LM is heading (relative to the ground)
    const vs = st.vSurface;
    const speed = vs.length();
    if (speed > 0.4 && !st.landed) {
      tmp.copy(cam).addScaledVector(vs, 400 / speed);
      const f = v.projectToScreen(tmp, _p2);
      if (f) {
        const x = Math.max(16, Math.min(W - 16, f.x));
        const y = Math.max(16, Math.min(H - 16, f.y));
        const clamped = x !== f.x || y !== f.y;
        g.strokeStyle = clamped ? 'rgba(109, 255, 160, 0.5)' : GREEN;
        g.lineWidth = 2;
        g.beginPath();
        g.arc(x, y, 8, 0, Math.PI * 2);
        g.moveTo(x - 20, y);
        g.lineTo(x - 8, y);
        g.moveTo(x + 8, y);
        g.lineTo(x + 20, y);
        g.moveTo(x, y - 8);
        g.lineTo(x, y - 15);
        g.stroke();
      }
    }

    // big readouts
    const hFt = (st.landed ? 0 : st.altTerrain ?? st.alt) / FT;
    const vsFt = st.hdot / FT;
    const hv = st.vHoriz / FT;
    const lm = veh.modules.lm;
    const fuel = lm ? lm.dpsProp / (lm.dpsProp0 || 8200) : NaN;
    const prog = sim.gnc?.lgc?.program;
    const contact = !!veh.tm['LM.GNC.CONTACT_LIGHT'];
    const rows = [
      ['ALTITUD', hFt < 10000 ? `${Math.round(hFt)} ft` : `${(hFt / 1000).toFixed(1)}k ft`, hFt < 100 && !st.landed ? AMBER : ICE],
      ['VERTICAL', `${vsFt >= 0 ? '+' : ''}${vsFt.toFixed(1)} ft/s`, vsFt < -5 && hFt < 100 ? RED : vsFt < -3 && hFt < 50 ? AMBER : GREEN],
      ['HORIZONTAL', `${hv.toFixed(1)} ft/s`, hv > 5 && hFt < 100 ? AMBER : ICE],
      ['COMBUSTIBLE', Number.isFinite(fuel) ? `${(fuel * 100).toFixed(1)} %` : '—', fuel < 0.056 ? RED : fuel < 0.1 ? AMBER : ICE],
    ];
    this._readouts(g, W, H, rows);
    let tip = '';
    if (contact) tip = 'LUZ DE CONTACTO · apaga el motor';
    else if (prog === '66') tip = 'P66: inclina para matar la deriva (marcador verde al centro) · ROD ▲▼ para la velocidad de bajada';
    else if (prog === '64') tip = 'P64: el ordenador va al rombo · flechas para cambiar el sitio · ROD para tomar el mando';
    else if (prog === '63') tip = 'P63: frenado · el ordenador pilota; vigila el combustible';
    this._caption(g, W, H, tip, '', contact ? GREEN : null);
  }

  // ---------------------------------------------------------------- forward

  _forward(g, W, H) {
    const cx = W / 2;
    const cy = H / 2;
    g.strokeStyle = 'rgba(255, 176, 0, 0.8)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(cx - 26, cy);
    g.lineTo(cx - 8, cy);
    g.moveTo(cx + 8, cy);
    g.lineTo(cx + 26, cy);
    g.moveTo(cx, cy - 26);
    g.lineTo(cx, cy - 8);
    g.moveTo(cx, cy + 8);
    g.lineTo(cx, cy + 26);
    g.stroke();
    const w = this.sim.vehicle.state.w;
    const deg = 180 / Math.PI;
    this._readouts(g, W, H, [
      ['ALABEO', `${(w.x * deg).toFixed(2)}°/s`, ICE],
      ['CABECEO', `${(w.y * deg).toFixed(2)}°/s`, ICE],
      ['GUIÑADA', `${(w.z * deg).toFixed(2)}°/s`, ICE],
    ]);
  }

  // ---------------------------------------------------------------- drawing helpers

  _readouts(g, W, H, rows) {
    const phone = H < 500;
    // columns share the middle of the screen (clear of the clock and the tools on a phone)
    const colW = Math.min(phone ? 104 : 132, (W * (phone ? 0.5 : 0.56)) / rows.length);
    const x0 = W / 2 - (rows.length * colW) / 2;
    const y = Math.round(H * (phone ? 0.2 : 0.19));
    rows.forEach(([lbl, val, col], i) => {
      const x = x0 + i * colW + colW / 2;
      g.textAlign = 'center';
      g.font = `600 ${phone ? 9 : 11}px "Barlow Condensed", sans-serif`;
      g.fillStyle = 'rgba(200, 215, 230, 0.75)';
      g.fillText(lbl, x, y);
      g.font = `${Math.min(phone ? 16 : 22, Math.round(colW / 6.4))}px "Share Tech Mono", monospace`;
      g.fillStyle = col;
      g.shadowColor = 'rgba(0,0,0,0.85)';
      g.shadowBlur = 6;
      g.fillText(val, x, y + (phone ? 19 : 25));
      g.shadowBlur = 0;
    });
  }

  _caption(g, W, H, text, sub, color = null) {
    if (!text) return;
    const phone = H < 500;
    g.textAlign = 'center';
    g.font = `500 ${phone ? 12 : 15}px "Barlow", sans-serif`;
    const w = g.measureText(text).width + 24;
    const y = Math.round(H * (phone ? 0.69 : 0.72));
    g.fillStyle = 'rgba(3, 6, 10, 0.62)';
    g.fillRect(W / 2 - w / 2, y - (phone ? 15 : 19), w, phone ? 22 : 27);
    g.fillStyle = color ?? ICE;
    g.fillText(text, W / 2, y);
  }

  _tag(g, x, y, text, col) {
    g.textAlign = 'left';
    g.font = '600 10px "Barlow Condensed", sans-serif';
    g.fillStyle = col;
    g.fillText(text, x, y);
  }

  dispose() {
    this.canvas.remove();
  }
}
