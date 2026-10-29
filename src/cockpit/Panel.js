// Panel framework shared by the CM/LM cockpits and the MOCR consoles.
//
// A Panel is a flat instrument panel in millimetres (origin top-left, +x right, +y down) holding
// Widgets. It renders itself into its own offscreen canvas at `pxPerMm`, redrawing only the
// regions of widgets whose `signature()` changed, and reports those dirty rectangles so a 3D view
// can re-upload just the affected texture tiles. The same panel can be drawn at any scale into an
// external 2D context (flat/zoomed 2D view) with renderTo().
//
// Interaction is in panel millimetres: views convert screen/ray hits to (x, y) mm and call
// pointerDown/Move/Up, wheel, key. Touch is supported through the same calls: views pass
// { pointerType: 'touch', longPress } so widgets can map long-press to the secondary action
// (e.g. close a switch guard), which on desktop is the right mouse button.
//
// PanelContext (panel.ctx) is provided by the view that builds the panel:
//   { sw, tm, bus, clock, audio, vehicle, sim, gnc, role, station, settings, input }

let _widgetSeq = 0;
const HIDDEN = '\u0000hidden';

export class Widget {
  /**
   * @param {object} o
   * @param {string} [o.id]
   * @param {number} o.x @param {number} o.y @param {number} o.w @param {number} o.h  (mm)
   * @param {string} [o.switchId] SwitchBoard id this widget operates (used by highlights/hints)
   * @param {string} [o.signal]   telemetry key it displays
   * @param {string} [o.label] @param {string} [o.tooltip] Spanish tooltip
   */
  constructor(o = {}) {
    this.id = o.id ?? `w${++_widgetSeq}`;
    this.x = o.x ?? 0;
    this.y = o.y ?? 0;
    this.w = o.w ?? 10;
    this.h = o.h ?? 10;
    this.switchId = o.switchId ?? null;
    this.signal = o.signal ?? null;
    this.label = o.label ?? null;
    this.tooltip = o.tooltip ?? null;
    this.interactive = o.interactive ?? false;
    this.margin = o.margin ?? 2; // mm drawn outside the rect (shadows, levers)
    this.visible = o.visible ?? true;
    this.panel = null;
    this._sig = undefined;
  }

  get ctx() {
    return this.panel?.ctx;
  }

  get sw() {
    return this.panel?.ctx?.sw;
  }

  get tm() {
    return this.panel?.ctx?.tm;
  }

  contains(x, y) {
    return x >= this.x && y >= this.y && x <= this.x + this.w && y <= this.y + this.h;
  }

  bounds() {
    const m = this.margin;
    return { x: this.x - m, y: this.y - m, w: this.w + 2 * m, h: this.h + 2 * m };
  }

  /** Primitive (string/number/boolean) describing the visual state. A change triggers a redraw.
   *  Static widgets return a constant. Quantise analog values (e.g. needle to 0.25 % of scale). */
  signature() {
    return 0;
  }

  /** @param {CanvasRenderingContext2D} g context already scaled to millimetres, origin = panel top-left
   *  @param {number} t panel time in seconds (blinking) */
  draw(g, t) {}

  /** @returns {boolean} true if handled. e: { x, y, lx, ly, button, shift, ctrl, alt, pointerType, longPress } */
  onPointerDown(e) {
    return false;
  }

  onPointerUp(e) {}

  onPointerMove(e) {}

  /** @returns {boolean} handled */
  onWheel(e) {
    return false;
  }

  /** Keyboard while hovered (e.g. DSKY). @returns {boolean} handled */
  onKey(e) {
    return false;
  }

  /** CSS cursor while hovered; may depend on e.ly (upper/lower half → up/down arrows). */
  cursor(e) {
    return this.interactive ? 'pointer' : null;
  }

  tooltipText() {
    return this.tooltip ?? this.label ?? null;
  }

  update(dt) {}

  /** Ask the panel to redraw this widget on the next render even if the signature is unchanged. */
  invalidate() {
    this._sig = undefined;
  }
}

function intersects(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function union(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

export class Panel {
  /**
   * @param {object} o
   * @param {string} o.id      e.g. 'CM_P1', 'LM_P2', 'MOCR_EECOM'
   * @param {string} o.name    Spanish display name
   * @param {number} o.width   mm
   * @param {number} o.height  mm
   * @param {object} o.ctx     PanelContext
   * @param {string|Function} [o.background] fill colour or (g, panel, rectMm) => void
   */
  constructor({ id, name, width, height, ctx, background = '#7f8487', widgets = [], meta = {} }) {
    this.id = id;
    this.name = name ?? id;
    this.width = width;
    this.height = height;
    this.ctx = ctx;
    this.background = background;
    this.meta = meta; // free-form (e.g. 3D placement hints)
    this.widgets = [];
    this.byId = new Map();
    this.highlights = new Set();
    this.hover = null;
    this.capture = null;
    this.time = 0;
    this.canvas = null;
    this.g = null;
    this.pxPerMm = 0;
    this._allDirty = true;
    this._extraDirty = [];
    this.addAll(widgets);
  }

  add(w) {
    w.panel = this;
    this.widgets.push(w);
    this.byId.set(w.id, w);
    this._extraDirty.push(w.bounds());
    return w;
  }

  addAll(ws) {
    for (const w of ws) this.add(w);
    return this;
  }

  widgetById(id) {
    return this.byId.get(id) ?? null;
  }

  widgetsForSwitch(switchId) {
    return this.widgets.filter((w) => w.switchId === switchId);
  }

  /** Allocate (or reuse) the offscreen canvas at the given resolution. */
  getCanvas(pxPerMm) {
    if (this.canvas && this.pxPerMm === pxPerMm) return this.canvas;
    this.pxPerMm = pxPerMm;
    const c = this.canvas ?? document.createElement('canvas');
    c.width = Math.max(1, Math.round(this.width * pxPerMm));
    c.height = Math.max(1, Math.round(this.height * pxPerMm));
    this.canvas = c;
    this.g = c.getContext('2d');
    this.markAllDirty();
    return c;
  }

  markAllDirty() {
    this._allDirty = true;
  }

  markDirty(rectOrWidget) {
    this._extraDirty.push(rectOrWidget instanceof Widget ? rectOrWidget.bounds() : rectOrWidget);
  }

  setHighlights(ids) {
    const next = new Set(ids ?? []);
    for (const w of this.widgets) {
      const was = this._isHighlighted(w, this.highlights);
      const now = this._isHighlighted(w, next);
      if (was !== now) this._extraDirty.push(w.bounds());
    }
    this.highlights = next;
  }

  _isHighlighted(w, set = this.highlights) {
    return set.size > 0 && (set.has(w.id) || (w.switchId && set.has(w.switchId)));
  }

  update(dt) {
    this.time += dt;
    for (const w of this.widgets) w.update(dt);
  }

  _sigOf(w) {
    if (!w.visible) return HIDDEN;
    let s = w.signature();
    if (this.hover === w) s = `${s}|h`;
    if (this._isHighlighted(w)) s = `${s}|H${Math.floor(this.time * 4) % 4}`;
    return s;
  }

  drawBackground(g, rect) {
    if (typeof this.background === 'function') this.background(g, this, rect);
    else {
      g.fillStyle = this.background;
      g.fillRect(rect.x, rect.y, rect.w, rect.h);
    }
  }

  /** Pulsing outline drawn over highlighted widgets (checklist hints). */
  drawHighlight(g, w) {
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 6);
    const b = w.bounds();
    g.save();
    g.strokeStyle = `rgba(255, 196, 0, ${0.55 + 0.45 * pulse})`;
    g.lineWidth = 1.2 + pulse * 0.8;
    g.shadowColor = 'rgba(255, 180, 0, 0.9)';
    g.shadowBlur = 4;
    g.strokeRect(b.x + 0.6, b.y + 0.6, b.w - 1.2, b.h - 1.2);
    g.restore();
  }

  _drawRegion(g, rect) {
    g.save();
    g.beginPath();
    g.rect(rect.x, rect.y, rect.w, rect.h);
    g.clip();
    this.drawBackground(g, rect);
    for (const w of this.widgets) {
      if (w.visible && intersects(w.bounds(), rect)) {
        g.save();
        w.draw(g, this.time);
        g.restore();
      }
    }
    for (const w of this.widgets) if (w.visible && this._isHighlighted(w) && intersects(w.bounds(), rect)) this.drawHighlight(g, w);
    g.restore();
  }

  /**
   * Redraw changed regions into the panel's own canvas (call getCanvas first).
   * @returns {{x:number,y:number,w:number,h:number}[]} dirty rectangles in canvas pixels
   */
  render() {
    if (!this.g) return [];
    let rects = this._extraDirty;
    this._extraDirty = [];
    for (const w of this.widgets) {
      const sig = this._sigOf(w);
      if (sig !== w._sig) {
        if (w._sig !== HIDDEN || sig !== HIDDEN) rects.push(w.bounds());
        w._sig = sig;
      }
    }
    if (this._allDirty) {
      rects = [{ x: 0, y: 0, w: this.width, h: this.height }];
      this._allDirty = false;
    } else if (rects.length > 1) {
      // merge overlapping rectangles; fall back to a full redraw when fragmented
      const merged = [];
      for (const r of rects) {
        let cur = r;
        for (let i = merged.length - 1; i >= 0; i--) {
          if (intersects(merged[i], cur)) {
            cur = union(merged[i], cur);
            merged.splice(i, 1);
          }
        }
        merged.push(cur);
      }
      rects = merged.length > 48 ? [{ x: 0, y: 0, w: this.width, h: this.height }] : merged;
    }
    if (!rects.length) return rects;
    const s = this.pxPerMm;
    const g = this.g;
    const out = [];
    for (const r of rects) {
      const x0 = Math.max(0, Math.floor(r.x * s));
      const y0 = Math.max(0, Math.floor(r.y * s));
      const x1 = Math.min(this.canvas.width, Math.ceil((r.x + r.w) * s));
      const y1 = Math.min(this.canvas.height, Math.ceil((r.y + r.h) * s));
      if (x1 <= x0 || y1 <= y0) continue;
      const mm = { x: x0 / s, y: y0 / s, w: (x1 - x0) / s, h: (y1 - y0) / s };
      g.setTransform(s, 0, 0, s, 0, 0);
      this._drawRegion(g, mm);
      out.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    return out;
  }

  /** Full redraw into an external context at `scale` px/mm with an optional offset (flat 2D view). */
  renderTo(g, scale, ox = 0, oy = 0) {
    g.save();
    g.setTransform(scale, 0, 0, scale, ox, oy);
    this._drawRegion(g, { x: 0, y: 0, w: this.width, h: this.height });
    g.restore();
  }

  hitTest(x, y) {
    for (let i = this.widgets.length - 1; i >= 0; i--) {
      const w = this.widgets[i];
      if (w.visible && w.interactive && w.contains(x, y)) return w;
    }
    return null;
  }

  _event(w, x, y, o = {}) {
    return {
      x,
      y,
      lx: w ? x - w.x : 0,
      ly: w ? y - w.y : 0,
      button: o.button ?? 0,
      shift: !!o.shift,
      ctrl: !!o.ctrl,
      alt: !!o.alt,
      pointerType: o.pointerType ?? 'mouse',
      longPress: !!o.longPress,
    };
  }

  /** @returns {Widget|null} the widget under the point (updates hover) */
  hoverAt(x, y) {
    const w = x === null ? null : this.hitTest(x, y);
    if (w !== this.hover) this.hover = w;
    return w;
  }

  pointerDown(x, y, o = {}) {
    const w = this.hitTest(x, y);
    if (!w) return { widget: null, handled: false };
    const handled = !!w.onPointerDown(this._event(w, x, y, o));
    if (handled) this.capture = w;
    return { widget: w, handled };
  }

  pointerMove(x, y, o = {}) {
    const w = this.capture ?? this.hoverAt(x, y);
    if (w) w.onPointerMove(this._event(w, x, y, o));
    return w;
  }

  pointerUp(x, y, o = {}) {
    const w = this.capture;
    this.capture = null;
    if (w) w.onPointerUp(this._event(w, x, y, o));
    return w;
  }

  /** Cancel an active capture (pointer left the panel, view changed). */
  pointerCancel() {
    const w = this.capture;
    this.capture = null;
    if (w) w.onPointerUp(this._event(w, w.x, w.y, { cancelled: true }));
  }

  wheel(x, y, deltaY) {
    const w = this.hitTest(x, y);
    return w ? !!w.onWheel({ ...this._event(w, x, y), deltaY }) : false;
  }

  key(e) {
    return this.hover ? !!this.hover.onKey(e) : false;
  }

  cursorAt(x, y) {
    const w = this.hitTest(x, y);
    return w ? w.cursor(this._event(w, x, y)) : null;
  }

  dispose() {
    this.widgets.length = 0;
    this.byId.clear();
    if (this.canvas) {
      this.canvas.width = this.canvas.height = 1;
      this.canvas = null;
      this.g = null;
    }
  }
}
