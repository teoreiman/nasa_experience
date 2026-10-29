// Lunar Module panel set (panels 1–16). Flight instruments sit where they are on LM-5/LM-7;
// every LM_SWITCHES control of each panel is laid out in engraved sections around them.

import { Panel } from '../../Panel.js';
import { LM_SWITCHES } from '../../../sim/lm/registry.js';
import { panelBackground, FDAI, DSKYWidget, Annunciator, MissionTimer, Lamp, EdgeMeter, DigitalReadout, PushButton, Label } from '../../widgets/index.js';
import { flowSections } from '../layout.js';

export const LM_PANEL_SPECS = [
  { id: 'LM_P1', name: 'Panel 1 — Comandante', width: 520, height: 500 },
  { id: 'LM_P2', name: 'Panel 2 — Piloto del LM', width: 520, height: 500 },
  { id: 'LM_P3', name: 'Panel 3 — Central (radar, motores, modos)', width: 1000, height: 300 },
  { id: 'LM_P4', name: 'Panel 4 — DSKY del LGC', width: 300, height: 330 },
  { id: 'LM_P5', name: 'Panel 5 — Inferior izquierdo', width: 300, height: 420 },
  { id: 'LM_P6', name: 'Panel 6 — Inferior derecho (AGS)', width: 300, height: 420 },
  { id: 'LM_P8', name: 'Panel 8 — Lateral izquierdo', width: 400, height: 500 },
  { id: 'LM_P11', name: 'Panel 11 — Disyuntores del comandante', width: 900, height: 400 },
  { id: 'LM_P12', name: 'Panel 12 — Comunicaciones', width: 400, height: 450 },
  { id: 'LM_P14', name: 'Panel 14 — Energía eléctrica', width: 400, height: 450 },
  { id: 'LM_P16', name: 'Panel 16 — Disyuntores del piloto del LM', width: 900, height: 400 },
];

export const LM_CW_LAMPS = [
  ['ASC_PRESS', 'ASC PRESS', 'red'], ['DES_REG', 'DES REG', 'red'], ['ASC_QTY', 'ASC QTY'], ['DES_QTY', 'DES QTY'],
  ['CO2_HI', 'CO2 HI', 'red'], ['CABIN', 'CABIN', 'red'], ['SUIT_FAN', 'SUIT/FAN', 'red'], ['GLYCOL', 'GLYCOL'],
  ['WATER_QTY', 'WATER QTY'], ['BATTERY', 'BATTERY'], ['INVERTER', 'INVERTER'], ['PRE_AMPS', 'PRE AMPS'],
  ['LGC', 'LGC', 'red'], ['ISS', 'ISS', 'red'], ['RCS_TCA', 'RCS TCA'], ['RCS_A_REG', 'RCS A REG'],
  ['RCS_B_REG', 'RCS B REG'], ['ENG_GMBL', 'ENG GMBL'], ['LDG_RDR', 'LDG RDR'], ['RNDZ_RDR', 'RNDZ RDR'],
].map(([k, legend, color]) => ({ key: `LM.CW.${k}`, legend, color: color ?? 'amber' }));

const EXPLICIT = new Set(['LM.ENG.ABORT', 'LM.ENG.ABORT_STAGE', 'LM.CW.MASTER_ALARM_CDR', 'LM.CW.MASTER_ALARM_LMP']);

function add(panel, w) {
  panel.add(w);
  return { x: w.x, y: w.y, w: w.w, h: w.h };
}

function defsFor(id) {
  return LM_SWITCHES.filter((d) => d.panel === id && !EXPLICIT.has(d.id));
}

export function buildLMPanels(ctx) {
  const bg = panelBackground('lm');
  const panels = LM_PANEL_SPECS.map((s) => new Panel({ ...s, ctx, background: bg }));
  const P = Object.fromEntries(panels.map((p) => [p.id, p]));
  const lgc = () => ctx.gnc?.lgc?.dsky;

  // P1 — CDR: FDAI, ALT/ALT RATE tapes, X-pointer, thrust, ABORT, master alarm
  const r1 = [];
  const p1 = P.LM_P1;
  r1.push(add(p1, new FDAI({ x: 12, y: 30, w: 150, h: 150, prefix: 'LM.FDAI1' })));
  r1.push(add(p1, new Label({ x: 12, y: 16, w: 150, h: 8, text: 'FDAI', size: 3.6 })));
  r1.push(add(p1, new EdgeMeter({ x: 172, y: 30, w: 20, h: 110, key: 'LM.GNC.ALT_FT', min: 0, max: 10000, label: 'ALT', unit: 'FT' })));
  r1.push(add(p1, new EdgeMeter({ x: 196, y: 30, w: 20, h: 110, key: 'LM.GNC.ALTRATE_FPS', min: -200, max: 200, label: 'ALT RT', unit: 'FT/S' })));
  r1.push(add(p1, new DigitalReadout({ x: 224, y: 36, w: 56, h: 16, key: 'LM.GNC.XPTR_FWD_FPS', digits: 4, label: 'FWD FT/S' })));
  r1.push(add(p1, new DigitalReadout({ x: 224, y: 66, w: 56, h: 16, key: 'LM.GNC.XPTR_LAT_FPS', digits: 4, label: 'LAT FT/S' })));
  r1.push(add(p1, new EdgeMeter({ x: 288, y: 30, w: 18, h: 80, key: 'LM.ENG.THRUST_PCT', min: 0, max: 100, label: 'THRUST', unit: '%' })));
  r1.push(add(p1, new Lamp({ x: 224, y: 92, w: 56, h: 13, key: 'LM.GNC.CONTACT_LIGHT', legend: 'LUNAR CONTACT', color: 'white' })));
  r1.push(add(p1, new Lamp({ x: 224, y: 110, w: 56, h: 13, key: 'LM.CW.DES_QTY', legend: 'DES QTY LOW LEVEL' })));
  r1.push(add(p1, new PushButton({ switchId: 'LM.CW.MASTER_ALARM_CDR', x: 316, y: 30, w: 34, h: 26, legend: 'MASTER ALARM', color: 'red', lampKey: 'LM.CW.MASTER_ALARM' })));
  r1.push(add(p1, new PushButton({ switchId: 'LM.ENG.ABORT', x: 360, y: 30, w: 34, h: 26, legend: 'ABORT', color: 'red', lampKey: 'LM.ENG.ABORT_CMD' })));
  r1.push(add(p1, new PushButton({ switchId: 'LM.ENG.ABORT_STAGE', x: 404, y: 30, w: 40, h: 26, legend: 'ABORT STAGE', color: 'red', lampKey: 'LM.ENG.ABORT_STAGE_CMD' })));
  flowSections(p1, defsFor('LM_P1'), r1);

  // P2 — LMP: FDAI 2, C&W, ECS & propellant gauges
  const r2 = [];
  const p2 = P.LM_P2;
  r2.push(add(p2, new FDAI({ x: 358, y: 30, w: 150, h: 150, prefix: 'LM.FDAI2' })));
  r2.push(add(p2, new Annunciator({ x: 12, y: 30, w: 220, h: 80, lamps: LM_CW_LAMPS, cols: 4 })));
  r2.push(add(p2, new Label({ x: 12, y: 20, w: 220, h: 7, text: 'CAUTION / WARNING', size: 3.2 })));
  r2.push(add(p2, new PushButton({ switchId: 'LM.CW.MASTER_ALARM_LMP', x: 242, y: 30, w: 34, h: 26, legend: 'MASTER ALARM', color: 'red', lampKey: 'LM.CW.MASTER_ALARM' })));
  const meters = [['LM.ECS.CABIN.P_PSI', 'CABIN', 0, 10, 'PSIA'], ['LM.ECS.SUIT.P_PSI', 'SUIT', 0, 10, 'PSIA'], ['LM.ECS.PPCO2_MMHG', 'PP CO2', 0, 30, 'MM HG'], ['LM.ECS.CABIN.T_F', 'TEMP', 0, 100, '°F'], ['LM.DPS.FUEL_QTY', 'DES', 0, 100, '%', 100], ['LM.APS.FUEL_QTY', 'ASC', 0, 100, '%', 100], ['LM.RCS.A.QTY', 'RCS A', 0, 100, '%', 100], ['LM.RCS.B.QTY', 'RCS B', 0, 100, '%', 100]];
  meters.forEach(([key, label, min, max, unit, scale], i) => r2.push(add(p2, new EdgeMeter({ x: 12 + i * 22, y: 118, w: 20, h: 60, key, label, min, max, unit, scale: scale ?? 1 }))));
  flowSections(p2, defsFor('LM_P2'), r2);

  // P3 — event timer + controls
  const r3 = [];
  r3.push(add(P.LM_P3, new MissionTimer({ x: 420, y: 18, w: 160, h: 24, key: 'LM.MT.EVENT', label: 'EVENT TIMER' })));
  flowSections(P.LM_P3, defsFor('LM_P3'), r3);

  // P4 — LGC DSKY
  add(P.LM_P4, new Label({ x: 40, y: 14, w: 220, h: 8, text: 'LGC — DSKY', size: 3.4 }));
  add(P.LM_P4, new DSKYWidget({ x: 30, y: 30, w: 240, h: 280, source: lgc }));

  // P5 — mission timer + engine start/stop
  const r5 = [];
  r5.push(add(P.LM_P5, new MissionTimer({ x: 60, y: 22, w: 180, h: 28, key: 'LM.MT.GET', label: 'MISSION TIMER' })));
  flowSections(P.LM_P5, defsFor('LM_P5'), r5);

  // P14 — EPS meters
  const r14 = [];
  [['LM.EPS.CDR_BUS.V', 'CDR BUS', 0, 40, 'VOLTS'], ['LM.EPS.LMP_BUS.V', 'LMP BUS', 0, 40, 'VOLTS'], ['LM.EPS.TOTAL_AMPS', 'CURRENT', 0, 100, 'AMPS'], ['LM.EPS.AC.V', 'AC', 0, 150, 'VAC']].forEach(([key, label, min, max, unit], i) =>
    r14.push(add(P.LM_P14, new EdgeMeter({ x: 14 + i * 24, y: 20, w: 22, h: 72, key, label, min, max, unit }))),
  );
  flowSections(P.LM_P14, defsFor('LM_P14'), r14);

  for (const id of ['LM_P6', 'LM_P8', 'LM_P11', 'LM_P12', 'LM_P16']) flowSections(P[id], defsFor(id), []);
  return panels;
}
