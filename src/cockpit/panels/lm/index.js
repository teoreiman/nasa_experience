// LM panel set builder. STUB by the architect; the "lmpanels" agent implements every panel with
// authentic layouts (docs/ARCHITECTURE.md §9.3). Panel ids/sizes are a contract with the cabins agent.

import { Panel } from '../../Panel.js';

export const LM_PANEL_SPECS = [
  { id: 'LM_P1', name: 'Panel 1 — Comandante', width: 520, height: 500 },
  { id: 'LM_P2', name: 'Panel 2 — Piloto del LM', width: 520, height: 500 },
  { id: 'LM_P3', name: 'Panel 3 — Central (radar, motores, modos)', width: 1000, height: 300 },
  { id: 'LM_P4', name: 'Panel 4 — DSKY del LGC', width: 300, height: 330 },
  { id: 'LM_P5', name: 'Panel 5 — Inferior izquierdo (encendido/parada)', width: 300, height: 420 },
  { id: 'LM_P6', name: 'Panel 6 — Inferior derecho (AGS / DEDA)', width: 300, height: 420 },
  { id: 'LM_P8', name: 'Panel 8 — Lateral izquierdo (pirotécnicos, audio)', width: 400, height: 500 },
  { id: 'LM_P11', name: 'Panel 11 — Disyuntores del comandante', width: 900, height: 400 },
  { id: 'LM_P12', name: 'Panel 12 — Comunicaciones (LMP)', width: 400, height: 450 },
  { id: 'LM_P14', name: 'Panel 14 — Energía eléctrica (EPS)', width: 400, height: 450 },
  { id: 'LM_P16', name: 'Panel 16 — Disyuntores del piloto del LM', width: 900, height: 400 },
];

/** @param {object} ctx PanelContext @returns {Panel[]} */
export function buildLMPanels(ctx) {
  return LM_PANEL_SPECS.map((s) => new Panel({ ...s, ctx }));
}
