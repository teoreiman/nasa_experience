// Pointer/touch interaction with PanelMeshes: raycast → panel mm → widget handlers, hover
// tooltips and cursors. Empty-space drags are reported to onLook(dx, dy) so the view can turn the
// head; wheel/pinch to onZoom(factor). Long-press (450 ms) = secondary action (switch guards).

import * as THREE from 'three';

export class PanelInteractor {
  constructor({ game, camera, panelMeshes, onLook, onZoom, enabled = true }) {
    this.game = game;
    this.camera = camera;
    this.panelMeshes = panelMeshes;
    this.onLook = onLook;
    this.onZoom = onZoom;
    this.enabled = enabled;
    this.ray = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.hoverPanel = null;
    this.active = null; // { pm, pointerId }
    this.look = null;
    this.touches = new Map();
    this.tip = document.createElement('div');
    this.tip.className = 'panel-tooltip';
    this.tip.style.cssText = 'position:fixed;z-index:60;pointer-events:none;max-width:320px;padding:6px 9px;background:rgba(8,12,18,0.92);border:1px solid rgba(255,176,0,0.6);color:#eef;font:13px Barlow, sans-serif;white-space:pre-line;border-radius:3px;display:none';
    document.body.append(this.tip);
    const c = game.canvas;
    this._down = (e) => this.down(e);
    this._move = (e) => this.move(e);
    this._up = (e) => this.up(e);
    this._wheel = (e) => this.wheel(e);
    this._ctx = (e) => e.preventDefault();
    c.addEventListener('pointerdown', this._down);
    window.addEventListener('pointermove', this._move);
    window.addEventListener('pointerup', this._up);
    window.addEventListener('pointercancel', this._up);
    c.addEventListener('wheel', this._wheel, { passive: false });
    c.addEventListener('contextmenu', this._ctx);
    this.keyWidgetHover = false;
  }

  _pick(clientX, clientY) {
    const r = this.game.canvas.getBoundingClientRect();
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    const meshes = [];
    for (const pm of this.panelMeshes) if (pm.group.visible) meshes.push(...pm.meshes);
    const hit = this.ray.intersectObjects(meshes, false)[0];
    if (!hit) return null;
    const pm = hit.object.userData.panelMesh;
    const mm = pm.hitToMm(hit);
    return { pm, ...mm, hit };
  }

  down(e) {
    if (!this.enabled || e.target !== this.game.canvas) return;
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.touches.size === 2) {
      // start pinch
      const [a, b] = [...this.touches.values()];
      this.pinch = Math.hypot(a.x - b.x, a.y - b.y);
      this._cancelPress();
      this.active?.pm.panel.pointerCancel();
      this.active = null;
      this.look = null;
      return;
    }
    const p = this._pick(e.clientX, e.clientY);
    const opts = { button: e.button, pointerType: e.pointerType, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey };
    if (p && e.button !== 1) {
      const w = p.pm.panel.hitTest(p.x, p.y);
      if (w) {
        if (e.pointerType === 'touch') {
          // wait to distinguish tap vs long-press
          this.pending = { p, e: { clientX: e.clientX, clientY: e.clientY }, id: e.pointerId };
          this.pressTimer = setTimeout(() => {
            if (!this.pending) return;
            const q = this.pending.p;
            q.pm.panel.pointerDown(q.x, q.y, { ...opts, button: 2, longPress: true });
            q.pm.panel.pointerUp(q.x, q.y, opts);
            q.pm.update(0, true);
            this.pending = null;
          }, 450);
          return;
        }
        const res = p.pm.panel.pointerDown(p.x, p.y, opts);
        if (res.handled) {
          this.active = { pm: p.pm, id: e.pointerId };
          p.pm.update(0, true);
          return;
        }
      }
    }
    this.look = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: 0 };
  }

  _cancelPress() {
    clearTimeout(this.pressTimer);
    this.pending = null;
  }

  move(e) {
    if (!this.enabled) return;
    if (this.touches.has(e.pointerId)) this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.touches.size === 2 && this.pinch) {
      const [a, b] = [...this.touches.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      this.onZoom?.(this.pinch / d);
      this.pinch = d;
      return;
    }
    if (this.pending && Math.hypot(e.clientX - this.pending.e.clientX, e.clientY - this.pending.e.clientY) > 12) {
      // turned into a drag → look
      this._cancelPress();
      this.look = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: 0 };
    }
    if (this.look && this.look.id === e.pointerId) {
      const dx = e.clientX - this.look.x;
      const dy = e.clientY - this.look.y;
      this.look.x = e.clientX;
      this.look.y = e.clientY;
      this.onLook?.(dx, dy);
      this.tip.style.display = 'none';
      return;
    }
    if (this.active) {
      const p = this._pick(e.clientX, e.clientY);
      if (p && p.pm === this.active.pm) p.pm.panel.pointerMove(p.x, p.y, { pointerType: e.pointerType });
      return;
    }
    if (e.pointerType === 'touch') return;
    const p = this._pick(e.clientX, e.clientY);
    const prev = this.hoverPanel;
    if (prev && (!p || p.pm !== prev)) {
      prev.panel.hoverAt(null);
    }
    this.hoverPanel = p?.pm ?? null;
    const w = p ? p.pm.panel.hoverAt(p.x, p.y) : null;
    this.hoverWidget = w;
    this.game.canvas.style.cursor = w ? (p.pm.panel.cursorAt(p.x, p.y) ?? 'pointer') : 'grab';
    const tip = w?.tooltipText?.();
    if (tip) {
      this.tip.textContent = tip;
      this.tip.style.display = 'block';
      this.tip.style.left = `${Math.min(window.innerWidth - 330, e.clientX + 16)}px`;
      this.tip.style.top = `${Math.min(window.innerHeight - 90, e.clientY + 18)}px`;
    } else this.tip.style.display = 'none';
  }

  up(e) {
    this.touches.delete(e.pointerId);
    if (this.touches.size < 2) this.pinch = null;
    if (this.pending && this.pending.id === e.pointerId) {
      clearTimeout(this.pressTimer);
      const q = this.pending.p;
      this.pending = null;
      q.pm.panel.pointerDown(q.x, q.y, { button: 0, pointerType: 'touch' });
      const pm = q.pm;
      setTimeout(() => {
        pm.panel.pointerUp(q.x, q.y, { pointerType: 'touch' });
        pm.update(0, true);
      }, 120);
      pm.update(0, true);
      return;
    }
    if (this.active && this.active.id === e.pointerId) {
      const p = this._pick(e.clientX, e.clientY);
      this.active.pm.panel.pointerUp(p?.x ?? 0, p?.y ?? 0, { pointerType: e.pointerType });
      this.active.pm.update(0, true);
      this.active = null;
    }
    if (this.look && this.look.id === e.pointerId) this.look = null;
  }

  wheel(e) {
    if (!this.enabled) return;
    e.preventDefault();
    const p = this._pick(e.clientX, e.clientY);
    if (p && p.pm.panel.wheel(p.x, p.y, e.deltaY)) {
      p.pm.update(0, true);
      return;
    }
    this.onZoom?.(e.deltaY > 0 ? 1.1 : 0.9);
  }

  /** Route keyboard to a hovered widget that accepts keys (DSKY). @returns {boolean} captured */
  routeKeys(input) {
    const w = this.hoverWidget;
    const wants = !!(w && w.onKey !== Object.getPrototypeOf(Object.getPrototypeOf(w)).onKey && w.constructor.name === 'DSKYWidget');
    input.captureKeys = wants;
    if (!wants) return false;
    for (const ev of input.lastKeyEvents) {
      if (this.hoverPanel.panel.key(ev)) this.hoverPanel.update(0, true);
    }
    return true;
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) {
      this.tip.style.display = 'none';
      this.game.input.captureKeys = false;
      this.game.canvas.style.cursor = '';
    }
  }

  dispose() {
    const c = this.game.canvas;
    c.removeEventListener('pointerdown', this._down);
    window.removeEventListener('pointermove', this._move);
    window.removeEventListener('pointerup', this._up);
    window.removeEventListener('pointercancel', this._up);
    c.removeEventListener('wheel', this._wheel);
    c.removeEventListener('contextmenu', this._ctx);
    this.tip.remove();
    this.game.input.captureKeys = false;
    c.style.cursor = '';
  }
}
