// CM panel set builder. STUB by the architect; the "cmpanels" agent implements every panel with
// authentic layouts (docs/ARCHITECTURE.md §9.3). Panel ids/sizes are a contract with the cabins agent.

import { Panel } from '../../Panel.js';

/** Panel ids and physical sizes (mm). */
export const CM_PANEL_SPECS = [
  { id: 'CM_P1', name: 'Panel 1 — Comandante (MDC izquierdo)', width: 640, height: 560 },
  { id: 'CM_P2', name: 'Panel 2 — Central (MDC)', width: 1100, height: 560 },
  { id: 'CM_P3', name: 'Panel 3 — Piloto del LM (MDC derecho)', width: 640, height: 560 },
  { id: 'CM_LEFT', name: 'Consola izquierda (paneles 5, 7, 8)', width: 700, height: 420 },
  { id: 'CM_RIGHT', name: 'Consola derecha (paneles 10–13, 275)', width: 700, height: 420 },
  { id: 'CM_LEB', name: 'Bahía inferior de equipos (DSKY 2, ópticas, 100–122)', width: 900, height: 500 },
];

/** @param {object} ctx PanelContext @returns {Panel[]} */
export function buildCMPanels(ctx) {
  return CM_PANEL_SPECS.map((s) => new Panel({ ...s, ctx }));
}
