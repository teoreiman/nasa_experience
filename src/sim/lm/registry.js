// LM switch & signal registry. STUB by the architect with the reserved contract IDs
// (docs/ARCHITECTURE.md §7). The "lm" agent replaces/extends this with the complete panel set.

const T2 = (id, a, b, def, extra = {}) => ({ id, type: 'toggle', positions: [a, b], default: def, ...extra });
const T3 = (id, a, b, c, def, extra = {}) => ({ id, type: 'toggle', positions: [a, b, c], default: def, ...extra });
const MOM3 = (id, a, b, c, extra = {}) => ({ id, type: 'toggle', positions: [a, b, c], default: b, momentary: [a, c], rest: b, ...extra });
const BUTTON = (id, extra = {}) => ({ id, type: 'button', positions: ['OUT', 'PUSHED'], default: 'OUT', momentary: ['PUSHED'], rest: 'OUT', ...extra });
const LATCH = (id, extra = {}) => ({ id, type: 'button', positions: ['OUT', 'PUSHED'], default: 'OUT', ...extra });
const CB = (id, extra = {}) => ({ id, type: 'cb', positions: ['IN', 'OUT'], default: 'IN', ...extra });

export const LM_SWITCHES = [
  T2('LM.GNC.GUID_CONT', 'PGNS', 'AGS', 'PGNS', { label: 'GUID CONT', panel: 'LM_P1', group: 'GNC' }),
  T3('LM.GNC.MODE_SEL', 'LDG_RADAR', 'PGNS', 'AGS', 'PGNS', { label: 'MODE SEL', panel: 'LM_P1', group: 'GNC' }),
  T3('LM.GNC.MODE_CONTROL_PGNS', 'AUTO', 'ATT_HOLD', 'OFF', 'OFF', { label: 'PGNS MODE CONTROL', panel: 'LM_P3', group: 'GNC' }),
  T3('LM.GNC.MODE_CONTROL_AGS', 'AUTO', 'ATT_HOLD', 'OFF', 'OFF', { label: 'AGS MODE CONTROL', panel: 'LM_P3', group: 'GNC' }),
  T2('LM.GNC.THR_CONT', 'AUTO', 'MAN', 'AUTO', { label: 'THR CONT', panel: 'LM_P1', group: 'GNC' }),
  T2('LM.GNC.MAN_THROT', 'CDR', 'LMP', 'CDR', { label: 'MAN THROT', panel: 'LM_P1', group: 'GNC' }),
  T2('LM.GNC.ATT_TRANSL', '4_JETS', '2_JETS', '4_JETS', { label: 'ATT/TRANSL', panel: 'LM_P1', group: 'GNC' }),
  T2('LM.GNC.BAL_CPL', 'ON', 'OFF', 'ON', { label: 'BAL CPL', panel: 'LM_P1', group: 'GNC' }),
  T2('LM.GNC.DEADBAND', 'MIN', 'MAX', 'MIN', { label: 'DEADBAND', panel: 'LM_P3', group: 'GNC' }),
  T2('LM.GNC.ENG_GMBL', 'ENABLE', 'OFF', 'ENABLE', { label: 'ENG GMBL', panel: 'LM_P1', group: 'GNC' }),
  T3('LM.ENG.ENG_ARM', 'ASC', 'OFF', 'DES', 'OFF', { label: 'ENG ARM', panel: 'LM_P1', group: 'PROP' }),
  T2('LM.ENG.DES_ENG_CMD_OVRD', 'ON', 'OFF', 'OFF', { label: 'DES ENG CMD OVRD', panel: 'LM_P1', group: 'PROP' }),
  BUTTON('LM.ENG.START', { label: 'ENG START', panel: 'LM_P5', group: 'PROP' }),
  LATCH('LM.ENG.STOP_CDR', { label: 'ENG STOP', panel: 'LM_P5', group: 'PROP' }),
  LATCH('LM.ENG.STOP_LMP', { label: 'ENG STOP', panel: 'LM_P6', group: 'PROP' }),
  LATCH('LM.ENG.ABORT', { label: 'ABORT', panel: 'LM_P1', group: 'PROP' }),
  { ...LATCH('LM.ENG.ABORT_STAGE'), guarded: true, guardSafe: 'OUT', label: 'ABORT STAGE', panel: 'LM_P1', group: 'PROP' },
  BUTTON('LM.ENG.PLUS_X', { label: '+X TRANSL', panel: 'LM_P5', group: 'PROP' }),
  T2('LM.EXP.MASTER_ARM', 'ON', 'OFF', 'OFF', { label: 'MASTER ARM', panel: 'LM_P8', group: 'EXP' }),
  { ...T2('LM.EXP.LDG_GEAR_DEPLOY', 'FIRE', 'OFF', 'OFF'), momentary: ['FIRE'], rest: 'OFF', guarded: true, guardSafe: 'OFF', label: 'LDG GEAR DEPLOY', panel: 'LM_P8', group: 'EXP' },
  { ...T2('LM.EXP.STAGE', 'FIRE', 'OFF', 'OFF'), momentary: ['FIRE'], rest: 'OFF', guarded: true, guardSafe: 'OFF', label: 'STAGE', panel: 'LM_P8', group: 'EXP' },
  T3('LM.RADAR.LDG_ANT', 'AUTO', 'DESCENT', 'HOVER', 'AUTO', { label: 'LDG ANT', panel: 'LM_P3', group: 'RADAR' }),
  T3('LM.RADAR.RR_MODE', 'LGC', 'AUTO_TRACK', 'SLEW', 'LGC', { label: 'RNDZ RADAR', panel: 'LM_P3', group: 'RADAR' }),
  BUTTON('LM.CW.MASTER_ALARM_CDR', { label: 'MASTER ALARM', panel: 'LM_P1', group: 'CW' }),
  BUTTON('LM.CW.MASTER_ALARM_LMP', { label: 'MASTER ALARM', panel: 'LM_P2', group: 'CW' }),
  ...[1, 2, 3, 4].flatMap((n) => [
    MOM3(`LM.EPS.DES_BAT_${n}_HV`, 'ON', 'CENTER', 'OFF', { label: `DES BAT ${n} HV`, panel: 'LM_P14', group: 'EPS', talkback: `LM.EPS.DES_BAT_${n}_HV_TB` }),
    MOM3(`LM.EPS.DES_BAT_${n}_LV`, 'ON', 'CENTER', 'OFF', { label: `DES BAT ${n} LV`, panel: 'LM_P14', group: 'EPS', talkback: `LM.EPS.DES_BAT_${n}_LV_TB` }),
  ]),
  ...[5, 6].flatMap((n) => [
    MOM3(`LM.EPS.ASC_BAT_${n}_NORM`, 'ON', 'CENTER', 'OFF', { label: `ASC BAT ${n} NORMAL`, panel: 'LM_P14', group: 'EPS', talkback: `LM.EPS.ASC_BAT_${n}_NORM_TB` }),
    MOM3(`LM.EPS.ASC_BAT_${n}_BACKUP`, 'ON', 'CENTER', 'OFF', { label: `ASC BAT ${n} BACKUP`, panel: 'LM_P14', group: 'EPS', talkback: `LM.EPS.ASC_BAT_${n}_BACKUP_TB` }),
  ]),
  T3('LM.EPS.INV', '1', 'OFF', '2', 'OFF', { label: 'INVERTER', panel: 'LM_P14', group: 'EPS' }),
  T3('LM.EPS.CSM_LM_XFER', 'LM_TO_CSM', 'OFF', 'CSM_TO_LM', 'OFF', { label: 'CSM/LM PWR XFER', panel: 'LM_P14', group: 'EPS' }),
  T2('LM.ECS.CO2_CANISTER', 'PRIM', 'SEC', 'PRIM', { label: 'CO2 CANISTER SEL', panel: 'LM_P2', group: 'ECS' }),
  T2('LM.ECS.SUIT_FAN', '1', '2', '1', { label: 'SUIT FAN', panel: 'LM_P2', group: 'ECS' }),
  { ...T3('LM.MT.EVENT_TIMER', 'START', 'STOP', 'RESET', 'STOP'), label: 'EVENT TIMER', panel: 'LM_P3', group: 'TIMER' },
  CB('LM.CB.ENG_ARM', { label: 'ENG ARM', panel: 'LM_P16', group: 'STAB/CONT' }),
];

export const LM_SIGNALS = [
  { key: 'LM.EPS.CDR_BUS.V', unit: 'V', min: 0, max: 40 },
  { key: 'LM.EPS.LMP_BUS.V', unit: 'V', min: 0, max: 40 },
  { key: 'LM.ECS.PPCO2_MMHG', unit: 'mmHg', min: 0, max: 30 },
  { key: 'LM.DPS.FUEL_QTY', unit: 'frac', min: 0, max: 1 },
  { key: 'LM.CW.MASTER_ALARM', unit: 'bool' },
];
