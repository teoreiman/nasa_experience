// Section-flow layout used by the CM/LM panel builders: instruments are placed at fixed positions
// (as on the real panels) and every registry control of the panel is laid out in engraved
// sections around them, so every control always exists and works.

import { SectionFrame, ToggleSwitch, RotarySwitch, CircuitBreaker, PushButton, Talkback } from '../widgets/index.js';

const CELL = {
  toggle: [17, 30],
  rotary: [32, 34],
  cb: [13, 19],
  button: [20, 17],
};

function cellFor(defs) {
  let w = 0;
  let h = 0;
  for (const d of defs) {
    const [cw, ch] = CELL[d.type] ?? CELL.toggle;
    w = Math.max(w, cw);
    h = Math.max(h, ch + (d.talkback ? 10 : 0));
  }
  return [w, h];
}

function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Lay out `defs` (registry entries) on `panel` avoiding `reserved` rects. */
export function flowSections(panel, defs, reserved, area = { x: 10, y: 12, w: panel.width - 20, h: panel.height - 20 }) {
  const groups = new Map();
  for (const d of defs) {
    const g = d.group ?? 'MISC';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(d);
  }
  // largest scale that fits: the controls fill the panel (bigger, easier to read and to click)
  for (let scale = 1.75; scale > 0.45; scale -= 0.05) {
    const placed = [];
    let x = area.x;
    let y = area.y;
    let rowH = 0;
    let ok = true;
    for (const [title, list] of groups) {
      const [cw0, ch0] = cellFor(list);
      const cw = cw0 * scale;
      const ch = ch0 * scale;
      const maxCols = Math.max(1, Math.floor((area.w - 8) / cw));
      const cols = Math.min(list.length, Math.max(1, Math.min(maxCols, list.length > 10 ? Math.ceil(list.length / Math.ceil(list.length / 12)) : list.length)));
      const rows = Math.ceil(list.length / cols);
      const w = cols * cw + 8;
      const h = rows * ch + 10;
      let guard = 0;
      for (;;) {
        if (x + w > area.x + area.w) {
          x = area.x;
          y += rowH + 5;
          rowH = 0;
        }
        const r = { x, y, w, h };
        const hit = reserved.find((q) => overlaps(r, { x: q.x - 3, y: q.y - 3, w: q.w + 6, h: q.h + 6 }));
        if (!hit) break;
        x = hit.x + hit.w + 6;
        if (++guard > 50) break;
      }
      if (y + h > area.y + area.h) {
        ok = false;
        break;
      }
      placed.push({ title, list, x, y, w, h, cw, ch, cols });
      x += w + 5;
      rowH = Math.max(rowH, h);
    }
    if (!ok) continue;
    for (const s of placed) {
      panel.add(new SectionFrame({ x: s.x, y: s.y + 2, w: s.w, h: s.h - 2, title: s.title }));
      s.list.forEach((d, i) => {
        const cx = s.x + 4 + (i % s.cols) * s.cw;
        const cy = s.y + 7 + Math.floor(i / s.cols) * s.ch;
        addControl(panel, d, cx, cy, s.cw, s.ch, scale);
      });
    }
    return true;
  }
  console.warn(`[panels] ${panel.id}: controls did not fit`);
  return false;
}

function addControl(panel, d, x, y, cw, ch, scale) {
  let top = y;
  if (d.talkback) {
    panel.add(new Talkback({ x: x + cw / 2 - 4.5 * scale, y: top, w: 9 * scale, h: 9 * scale, key: d.talkback }));
    top += 10 * scale;
  }
  const label = d.label;
  if (d.type === 'cb') panel.add(new CircuitBreaker({ switchId: d.id, x, y: top, w: cw - 1, h: ch - (top - y) - 1, label }));
  else if (d.type === 'rotary') panel.add(new RotarySwitch({ switchId: d.id, x, y: top, w: cw - 1, h: ch - (top - y), label }));
  else if (d.type === 'button')
    panel.add(new PushButton({ switchId: d.id, x: x + 1, y: top + 1, w: cw - 3, h: Math.min(16, ch - (top - y) - 3), legend: label, color: /ALARM|ABORT/.test(d.id) ? 'red' : 'white', lampKey: d.lampKey }));
  else panel.add(new ToggleSwitch({ switchId: d.id, x, y: top, w: cw - 1, h: ch - (top - y), label }));
}
