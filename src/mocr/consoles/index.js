// MOCR console panels. STUB by the architect; the "mocrdata" agent implements every console
// (CRT telemetry pages, display-request keyboards, comm keysets, event lights, GO/NO GO buttons,
// ground-task UI) and the front wall displays (docs/ARCHITECTURE.md §12).

import { Panel } from '../../cockpit/Panel.js';
import { MOCR_CONSOLES } from '../../missions/MissionRunner.js';

export const CONSOLE_PANEL_SIZE = { width: 1500, height: 700 }; // mm, angled desk + CRT bezel area

/** @returns {Panel} */
export function buildConsolePanel(consoleId, ctx) {
  return new Panel({ id: `MOCR_${consoleId}`, name: consoleId, ...CONSOLE_PANEL_SIZE, ctx, background: '#8f8a7c' });
}

/** Front-wall projection displays: [{ id, name, width, height, panel }] */
export function buildWallDisplays(ctx) {
  return [];
}

export { MOCR_CONSOLES };
