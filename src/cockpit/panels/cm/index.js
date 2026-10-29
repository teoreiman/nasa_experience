// Command Module panel set: MDC panels 1–3, side consoles and lower equipment bay.
// Instruments sit where they are on the Block II CM; every CM_SWITCHES control of each panel is
// laid out in engraved sections around them (flowSections).

import { Panel } from '../../Panel.js';
import { CM_SWITCHES } from '../../../sim/csm/registry.js';
import { panelBackground, FDAI, DSKYWidget, Annunciator, MissionTimer, Lamp, EdgeMeter, RoundGauge, DigitalReadout, PushButton, Label } from '../../widgets/index.js';
import { flowSections } from '../layout.js';

/** Panel ids and physical sizes (mm). */
export const CM_PANEL_SPECS = [
  { id: 'CM_P1', name: 'Panel 1 — Comandante (MDC izquierdo)', width: 640, height: 560 },
  { id: 'CM_P2', name: 'Panel 2 — Central (MDC)', width: 1100, height: 560 },
  { id: 'CM_P3', name: 'Panel 3 — Piloto del LM (MDC derecho)', width: 640, height: 560 },
  { id: 'CM_LEFT', name: 'Consola izquierda (paneles 5, 7, 8)', width: 700, height: 420 },
  { id: 'CM_RIGHT', name: 'Consola derecha (paneles 10–13, 275)', width: 700, height: 420 },
  { id: 'CM_LEB', name: 'Bahía inferior de equipos (DSKY 2, ópticas)', width: 900, height: 500 },
];

// Caution & warning panel (two blocks, authentic legends).
export const CM_CW_LAMPS = [
  ['FC_BUS_DISCONNECT', 'FC BUS DISCONNECT'], ['FC_1', 'FUEL CELL 1'], ['FC_2', 'FUEL CELL 2'], ['FC_3', 'FUEL CELL 3'],
  ['MAIN_BUS_A_UNDERVOLT', 'MAIN BUS A UNDERVOLT', 'red'], ['MAIN_BUS_B_UNDERVOLT', 'MAIN BUS B UNDERVOLT', 'red'], ['AC_BUS_1', 'AC BUS 1', 'red'], ['AC_BUS_2', 'AC BUS 2', 'red'],
  ['AC_BUS_1_OVERLOAD', 'AC BUS 1 OVERLOAD'], ['AC_BUS_2_OVERLOAD', 'AC BUS 2 OVERLOAD'], ['BAT_RELAY_BUS', 'BAT RLY BUS'], ['BAT_CHARGER', 'BATTERY CHARGER'],
  ['CRYO_PRESS', 'CRYO PRESS'], ['O2_FLOW_HI', 'O2 FLOW HI'], ['SUIT_COMPRESSOR', 'SUIT COMPRESSOR'], ['GLYCOL_TEMP_LOW', 'GLYCOL TEMP LOW'],
  ['CO2_PP_HI', 'CO2 PP HI', 'red'], ['SPS_PRESS', 'SPS PRESS'], ['SPS_FLANGE_TEMP_HI', 'SPS FLANGE TEMP HI'], ['CMC', 'CMC', 'red'],
  ['ISS', 'ISS'], ['BMAG_1_TEMP', 'BMAG 1 TEMP'], ['BMAG_2_TEMP', 'BMAG 2 TEMP'], ['UPLINK_ACTY', 'UPLINK ACTY'],
  ['SM_RCS_A', 'SM RCS A'], ['SM_RCS_B', 'SM RCS B'], ['SM_RCS_C', 'SM RCS C'], ['SM_RCS_D', 'SM RCS D'],
  ['CM_RCS_1', 'CM RCS 1'], ['CM_RCS_2', 'CM RCS 2'], ['PITCH_GMBL_1', 'PITCH GMBL 1'], ['YAW_GMBL_1', 'YAW GMBL 1'],
  ['PITCH_GMBL_2', 'PITCH GMBL 2'], ['YAW_GMBL_2', 'YAW GMBL 2'], ['CW', 'C/W'], ['MN_BUS_A', 'MN BUS A'],
].map(([k, legend, color]) => ({ key: `CM.CW.${k}`, legend, color: color ?? 'amber' }));

function add(panel, w) {
  panel.add(w);
  return { x: w.x, y: w.y, w: w.w, h: w.h };
}

function defsFor(id) {
  return CM_SWITCHES.filter((d) => d.panel === id && !(d.type === 'button' && /MASTER_ALARM/.test(d.id)));
}

/** @param {object} ctx PanelContext @returns {Panel[]} */
export function buildCMPanels(ctx) {
  const bg = panelBackground('cm');
  const panels = CM_PANEL_SPECS.map((s) => new Panel({ ...s, ctx, background: bg }));
  const [p1, p2, p3, left, right, leb] = panels;
  const cmc = () => ctx.gnc?.cmc?.dsky;

  // ---- Panel 1: FDAI 1, LV/abort lights, master alarm, g-meter, ΔV counter
  const r1 = [];
  r1.push(add(p1, new FDAI({ x: 18, y: 28, w: 148, h: 148, prefix: 'CM.FDAI1' })));
  r1.push(add(p1, new Label({ x: 18, y: 14, w: 148, h: 8, text: 'FDAI 1', size: 3.6 })));
  const lv = [['CM.LV.ENG1', 'ENG 1'], ['CM.LV.ENG2', 'ENG 2'], ['CM.LV.ENG3', 'ENG 3'], ['CM.LV.ENG4', 'ENG 4'], ['CM.LV.ENG5', 'ENG 5'], ['CM.LV.LIFTOFF', 'LIFTOFF'], ['CM.LV.NO_AUTO_ABORT', 'NO AUTO ABORT'], ['CM.LV.LV_GUID', 'LV GUID'], ['CM.LV.SII_SEP', 'S-II SEP'], ['CM.LV.LV_RATE', 'LV RATE'], ['CM.LV.ABORT', 'ABORT']];
  lv.forEach(([key, legend], i) => r1.push(add(p1, new Lamp({ x: 18 + (i % 4) * 37, y: 190 + Math.floor(i / 4) * 13, w: 35, h: 11, key, legend, color: legend === 'ABORT' ? 'red' : 'white' }))));
  r1.push(add(p1, new Label({ x: 18, y: 182, w: 148, h: 6, text: 'LAUNCH VEHICLE', size: 3 })));
  r1.push(add(p1, new PushButton({ switchId: 'CM.CW.MASTER_ALARM_1', x: 20, y: 236, w: 30, h: 24, legend: 'MASTER ALARM', color: 'red', lampKey: 'CM.CW.MASTER_ALARM' })));
  r1.push(add(p1, new RoundGauge({ x: 58, y: 234, w: 46, h: 46, key: 'CM.GNC.ACCEL_G', min: -2, max: 10, label: 'G', unit: 'ACCEL' })));
  r1.push(add(p1, new RoundGauge({ x: 110, y: 234, w: 46, h: 46, key: 'CM.ALT_KFT', min: 0, max: 50, label: 'ALT', unit: 'FT×1000' })));
  r1.push(add(p1, new DigitalReadout({ x: 22, y: 300, w: 64, h: 18, key: 'CM.EMS.DV_FPS', digits: 5, label: 'EMS ΔV' })));
  r1.push(add(p1, new DigitalReadout({ x: 96, y: 300, w: 64, h: 18, key: 'CM.EMS.RTG_NM', digits: 5, label: 'RANGE NM' })));
  r1.push(add(p1, new Lamp({ x: 22, y: 324, w: 36, h: 11, key: 'CM.EMS.LIGHT_05G', legend: '.05 G', color: 'white' })));
  r1.push(add(p1, new Lamp({ x: 62, y: 324, w: 46, h: 11, key: 'CM.SPS.THRUST', legend: 'SPS THRUST', color: 'white' })));
  flowSections(p1, defsFor('CM_P1'), r1);

  // ---- Panel 2: mission timer, C&W, master alarm, cryo meters, DSKY
  const r2 = [];
  r2.push(add(p2, new MissionTimer({ x: 470, y: 16, w: 160, h: 26, key: 'CM.MT.GET', label: 'MISSION ELAPSED TIME' })));
  r2.push(add(p2, new PushButton({ switchId: 'CM.CW.MASTER_ALARM_2', x: 420, y: 16, w: 34, h: 26, legend: 'MASTER ALARM', color: 'red', lampKey: 'CM.CW.MASTER_ALARM' })));
  r2.push(add(p2, new Label({ x: 380, y: 48, w: 340, h: 6, text: 'CAUTION / WARNING', size: 3.3 })));
  r2.push(add(p2, new Annunciator({ x: 380, y: 56, w: 340, h: 108, lamps: CM_CW_LAMPS, cols: 6 })));
  const cryo = [['CM.CRYO.H2_1.P_PSI', 'H2 1', 0, 400, 'PSI'], ['CM.CRYO.H2_2.P_PSI', 'H2 2', 0, 400, 'PSI'], ['CM.CRYO.O2_1.P_PSI', 'O2 1', 0, 1100, 'PSI'], ['CM.CRYO.O2_2.P_PSI', 'O2 2', 0, 1100, 'PSI'], ['CM.CRYO.H2_1.QTY', 'H2 1', 0, 100, 'QTY %', 100], ['CM.CRYO.H2_2.QTY', 'H2 2', 0, 100, 'QTY %', 100], ['CM.CRYO.O2_1.QTY', 'O2 1', 0, 100, 'QTY %', 100], ['CM.CRYO.O2_2.QTY', 'O2 2', 0, 100, 'QTY %', 100]];
  r2.push(add(p2, new Label({ x: 740, y: 18, w: 140, h: 6, text: 'CRYOGENIC TANKS', size: 3.3 })));
  cryo.forEach(([key, label, min, max, unit, scale], i) => r2.push(add(p2, new EdgeMeter({ x: 740 + i * 17.5, y: 26, w: 16, h: 60, key, label, min, max, unit, scale: scale ?? 1 }))));
  const ecs = [['CM.ECS.CABIN.P_PSI', 'CABIN', 0, 16, 'PSIA'], ['CM.ECS.SUIT.P_PSI', 'SUIT', 0, 16, 'PSIA'], ['CM.ECS.CABIN.T_F', 'TEMP', 40, 100, '°F'], ['CM.ECS.PPCO2_MMHG', 'PP CO2', 0, 30, 'MM HG'], ['CM.SPS.OX_QTY', 'SPS OX', 0, 100, '%', 100], ['CM.SPS.FUEL_QTY', 'SPS FUEL', 0, 100, '%', 100]];
  ecs.forEach(([key, label, min, max, unit, scale], i) => r2.push(add(p2, new EdgeMeter({ x: 900 + i * 17.5, y: 26, w: 16, h: 60, key, label, min, max, unit, scale: scale ?? 1 }))));
  r2.push(add(p2, new DSKYWidget({ x: 460, y: 344, w: 180, h: 200, source: cmc })));
  r2.push(add(p2, new Label({ x: 460, y: 334, w: 180, h: 6, text: 'DSKY — COMPUTER', size: 3.2 })));
  flowSections(p2, defsFor('CM_P2'), r2);

  // ---- Panel 3: EPS meters, FDAI 2
  const r3 = [];
  r3.push(add(p3, new Label({ x: 14, y: 14, w: 150, h: 6, text: 'DC / AC INDICATORS', size: 3.2 })));
  const eps = [['CM.EPS.MNA.V', 'MN A', 0, 45, 'VDC'], ['CM.EPS.MNB.V', 'MN B', 0, 45, 'VDC'], ['CM.EPS.IND_AMPS', 'DC AMPS', 0, 100, 'AMPS'], ['CM.EPS.AC1.V', 'AC 1', 0, 150, 'VAC'], ['CM.EPS.AC2.V', 'AC 2', 0, 150, 'VAC'], ['CM.EPS.FC1.AMPS', 'FC 1', 0, 100, 'AMPS'], ['CM.EPS.FC2.AMPS', 'FC 2', 0, 100, 'AMPS'], ['CM.EPS.FC3.AMPS', 'FC 3', 0, 100, 'AMPS']];
  eps.forEach(([key, label, min, max, unit], i) => r3.push(add(p3, new EdgeMeter({ x: 14 + i * 18.5, y: 22, w: 17, h: 64, key, label, min, max, unit }))));
  r3.push(add(p3, new FDAI({ x: 470, y: 24, w: 150, h: 150, prefix: 'CM.FDAI2' })));
  r3.push(add(p3, new Label({ x: 470, y: 12, w: 150, h: 8, text: 'FDAI 2', size: 3.6 })));
  flowSections(p3, defsFor('CM_P3'), r3);

  // ---- side consoles
  flowSections(left, defsFor('CM_LEFT'), []);
  flowSections(right, defsFor('CM_RIGHT'), []);

  // ---- LEB: DSKY 2 + master alarm 3
  const rl = [];
  rl.push(add(leb, new DSKYWidget({ x: 20, y: 40, w: 180, h: 200, source: cmc })));
  rl.push(add(leb, new Label({ x: 20, y: 28, w: 180, h: 8, text: 'DSKY 2 — LOWER EQUIPMENT BAY', size: 3.2 })));
  rl.push(add(leb, new PushButton({ switchId: 'CM.CW.MASTER_ALARM_3', x: 210, y: 40, w: 34, h: 26, legend: 'MASTER ALARM', color: 'red', lampKey: 'CM.CW.MASTER_ALARM' })));
  flowSections(leb, defsFor('CM_LEB'), rl);

  return panels;
}
