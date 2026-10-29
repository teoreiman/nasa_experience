// CSM switch & signal registry. STUB written by the architect: contains the reserved contract IDs
// (see docs/ARCHITECTURE.md §6). The "csm" agent replaces/extends this with the complete panel set.

const TOGGLE2 = (id, a, b, def, extra = {}) => ({ id, type: 'toggle', positions: [a, b], default: def, ...extra });
const TOGGLE3 = (id, a, b, c, def, extra = {}) => ({ id, type: 'toggle', positions: [a, b, c], default: def, ...extra });
const MOM3 = (id, a, b, c, extra = {}) => ({ id, type: 'toggle', positions: [a, b, c], default: b, momentary: [a, c], rest: b, ...extra });
const BUTTON = (id, extra = {}) => ({ id, type: 'button', positions: ['OUT', 'PUSHED'], default: 'OUT', momentary: ['PUSHED'], rest: 'OUT', ...extra });
const CB = (id, extra = {}) => ({ id, type: 'cb', positions: ['IN', 'OUT'], default: 'IN', ...extra });

export const CM_SWITCHES = [
  // Launch vehicle / sequencer
  TOGGLE2('CM.LV.EDS_AUTO', 'AUTO', 'OFF', 'AUTO', { label: 'EDS AUTO', panel: 'CM_P1', group: 'LV' }),
  TOGGLE2('CM.LV.TWO_ENG_OUT_AUTO', 'AUTO', 'OFF', 'AUTO', { label: '2 ENG OUT AUTO', panel: 'CM_P1', group: 'LV' }),
  TOGGLE2('CM.LV.LV_RATES_AUTO', 'AUTO', 'OFF', 'AUTO', { label: 'LV RATES AUTO', panel: 'CM_P1', group: 'LV' }),
  { ...TOGGLE3('CM.LV.TWR_JETT_1', 'FIRE', 'AUTO', 'OFF', 'AUTO'), momentary: ['FIRE'], rest: 'AUTO', guarded: true, guardSafe: 'AUTO', label: 'TWR JETT 1', panel: 'CM_P2', group: 'LV' },
  { ...TOGGLE3('CM.LV.TWR_JETT_2', 'FIRE', 'AUTO', 'OFF', 'AUTO'), momentary: ['FIRE'], rest: 'AUTO', guarded: true, guardSafe: 'AUTO', label: 'TWR JETT 2', panel: 'CM_P2', group: 'LV' },
  { ...TOGGLE2('CM.LV.LV_GUID', 'IU', 'CMC', 'IU'), guarded: true, guardSafe: 'IU', label: 'LV GUID', panel: 'CM_P2', group: 'LV' },
  { ...TOGGLE2('CM.LV.LV_STAGE', 'STAGE', 'OFF', 'OFF'), momentary: ['STAGE'], rest: 'OFF', guarded: true, guardSafe: 'OFF', label: 'S-II/S-IVB LV STAGE', panel: 'CM_P2', group: 'LV' },
  TOGGLE2('CM.LV.XLUNAR', 'INJECT', 'SAFE', 'INJECT', { label: 'XLUNAR', panel: 'CM_P2', group: 'LV' }),
  { ...TOGGLE2('CM.LV.CSM_LV_SEP', 'SEP', 'OFF', 'OFF'), momentary: ['SEP'], rest: 'OFF', guarded: true, guardSafe: 'OFF', label: 'CSM/LV SEP', panel: 'CM_P2', group: 'LV' },
  { ...TOGGLE2('CM.LV.SIVB_LM_SEP', 'SEP', 'OFF', 'OFF'), momentary: ['SEP'], rest: 'OFF', guarded: true, guardSafe: 'OFF', label: 'S-IVB/LM SEP', panel: 'CM_P2', group: 'LV' },
  // Sequential events / ELS
  TOGGLE2('CM.SEQ.SECS_ARM_A', 'ARM', 'OFF', 'OFF', { label: 'SECS ARM A', panel: 'CM_LEFT', group: 'SEQ' }),
  TOGGLE2('CM.SEQ.SECS_ARM_B', 'ARM', 'OFF', 'OFF', { label: 'SECS ARM B', panel: 'CM_LEFT', group: 'SEQ' }),
  { ...TOGGLE2('CM.SEQ.CM_SM_SEP_1', 'SEP', 'OFF', 'OFF'), momentary: ['SEP'], rest: 'OFF', guarded: true, guardSafe: 'OFF', label: 'CM/SM SEP 1', panel: 'CM_P2', group: 'SEQ' },
  { ...TOGGLE2('CM.SEQ.CM_SM_SEP_2', 'SEP', 'OFF', 'OFF'), momentary: ['SEP'], rest: 'OFF', guarded: true, guardSafe: 'OFF', label: 'CM/SM SEP 2', panel: 'CM_P2', group: 'SEQ' },
  { ...TOGGLE2('CM.SEQ.LES_MOTOR_FIRE', 'FIRE', 'OFF', 'OFF'), momentary: ['FIRE'], rest: 'OFF', guarded: true, guardSafe: 'OFF', label: 'LES MOTOR FIRE', panel: 'CM_P2', group: 'SEQ' },
  { ...TOGGLE2('CM.SEQ.APEX_COVER_JETT', 'JETT', 'OFF', 'OFF'), momentary: ['JETT'], rest: 'OFF', guarded: true, guardSafe: 'OFF', label: 'APEX COVER JETT', panel: 'CM_P2', group: 'ELS' },
  { ...TOGGLE2('CM.SEQ.DROGUE_DEPLOY', 'DEPLOY', 'OFF', 'OFF'), momentary: ['DEPLOY'], rest: 'OFF', guarded: true, guardSafe: 'OFF', label: 'DROGUE DEPLOY', panel: 'CM_P2', group: 'ELS' },
  { ...TOGGLE2('CM.SEQ.MAIN_DEPLOY', 'DEPLOY', 'OFF', 'OFF'), momentary: ['DEPLOY'], rest: 'OFF', guarded: true, guardSafe: 'OFF', label: 'MAIN DEPLOY', panel: 'CM_P2', group: 'ELS' },
  TOGGLE2('CM.SEQ.ELS_AUTO', 'AUTO', 'MAN', 'AUTO', { label: 'ELS AUTO/MAN', panel: 'CM_P2', group: 'ELS' }),
  { ...TOGGLE2('CM.SEQ.ELS_LOGIC', 'ON', 'OFF', 'OFF'), guarded: true, guardSafe: 'OFF', label: 'ELS LOGIC', panel: 'CM_P2', group: 'ELS' },
  { ...TOGGLE2('CM.SEQ.MAIN_RELEASE', 'REL', 'OFF', 'OFF'), guarded: true, guardSafe: 'OFF', label: 'MAIN RELEASE', panel: 'CM_P2', group: 'ELS' },
  // GNC / SCS
  TOGGLE2('CM.GNC.SC_CONT', 'CMC', 'SCS', 'CMC', { label: 'SC CONT', panel: 'CM_P1', group: 'GNC' }),
  TOGGLE3('CM.GNC.CMC_MODE', 'AUTO', 'HOLD', 'FREE', 'HOLD', { label: 'CMC MODE', panel: 'CM_P1', group: 'GNC' }),
  TOGGLE2('CM.GNC.ATT_DEADBAND', 'MAX', 'MIN', 'MAX', { label: 'ATT DEADBAND', panel: 'CM_P1', group: 'GNC' }),
  TOGGLE2('CM.GNC.RATE', 'HIGH', 'LOW', 'LOW', { label: 'RATE', panel: 'CM_P1', group: 'GNC' }),
  TOGGLE3('CM.GNC.MAN_ATT_ROLL', 'ACCEL_CMD', 'RATE_CMD', 'MIN_IMP', 'RATE_CMD', { label: 'MAN ATT ROLL', panel: 'CM_P1', group: 'GNC' }),
  TOGGLE3('CM.GNC.MAN_ATT_PITCH', 'ACCEL_CMD', 'RATE_CMD', 'MIN_IMP', 'RATE_CMD', { label: 'MAN ATT PITCH', panel: 'CM_P1', group: 'GNC' }),
  TOGGLE3('CM.GNC.MAN_ATT_YAW', 'ACCEL_CMD', 'RATE_CMD', 'MIN_IMP', 'RATE_CMD', { label: 'MAN ATT YAW', panel: 'CM_P1', group: 'GNC' }),
  TOGGLE2('CM.GNC.TRANS_CONTR_PWR', 'ON', 'OFF', 'ON', { label: 'TRANS CONTR PWR', panel: 'CM_P1', group: 'GNC' }),
  TOGGLE3('CM.GNC.ROT_CONTR_PWR_NORMAL_1', 'AC_DC', 'AC', 'OFF', 'AC_DC', { label: 'ROT CONTR PWR NORMAL 1', panel: 'CM_P1', group: 'GNC' }),
  TOGGLE3('CM.GNC.EMS_MODE', 'AUTO', 'NORMAL', 'STBY', 'STBY', { label: 'EMS MODE', panel: 'CM_P1', group: 'EMS' }),
  { id: 'CM.GNC.EMS_FUNC', type: 'rotary', positions: ['OFF', 'DV', 'DV_SET', 'DV_TEST', 'RNG_SET', 'VHF_RNG', 'ENTRY', 'TEST_1', 'TEST_2', 'TEST_3', 'TEST_4', 'TEST_5'], default: 'OFF', label: 'EMS FUNCTION', panel: 'CM_P1', group: 'EMS' },
  // SPS
  { ...TOGGLE3('CM.SPS.GMBL_P1', 'START', 'ON', 'OFF', 'OFF'), momentary: ['START'], rest: 'ON', label: 'GMBL MOTORS PITCH 1', panel: 'CM_P1', group: 'SPS' },
  { ...TOGGLE3('CM.SPS.GMBL_P2', 'START', 'ON', 'OFF', 'OFF'), momentary: ['START'], rest: 'ON', label: 'GMBL MOTORS PITCH 2', panel: 'CM_P1', group: 'SPS' },
  { ...TOGGLE3('CM.SPS.GMBL_Y1', 'START', 'ON', 'OFF', 'OFF'), momentary: ['START'], rest: 'ON', label: 'GMBL MOTORS YAW 1', panel: 'CM_P1', group: 'SPS' },
  { ...TOGGLE3('CM.SPS.GMBL_Y2', 'START', 'ON', 'OFF', 'OFF'), momentary: ['START'], rest: 'ON', label: 'GMBL MOTORS YAW 2', panel: 'CM_P1', group: 'SPS' },
  { ...TOGGLE2('CM.SPS.DV_THRUST_A', 'NORMAL', 'OFF', 'OFF'), guarded: true, guardSafe: 'OFF', label: 'ΔV THRUST A', panel: 'CM_P1', group: 'SPS' },
  { ...TOGGLE2('CM.SPS.DV_THRUST_B', 'NORMAL', 'OFF', 'OFF'), guarded: true, guardSafe: 'OFF', label: 'ΔV THRUST B', panel: 'CM_P1', group: 'SPS' },
  BUTTON('CM.SPS.THRUST_ON', { label: 'THRUST ON', panel: 'CM_P1', group: 'SPS' }),
  TOGGLE3('CM.SPS.HE_VLV_1', 'OPEN', 'AUTO', 'CLOSE', 'AUTO', { label: 'SPS He VLV 1', panel: 'CM_P2', group: 'SPS' }),
  TOGGLE3('CM.SPS.HE_VLV_2', 'OPEN', 'AUTO', 'CLOSE', 'AUTO', { label: 'SPS He VLV 2', panel: 'CM_P2', group: 'SPS' }),
  // RCS
  MOM3('CM.RCS.SM_A_PRPLNT', 'OPEN', 'CENTER', 'CLOSE', { label: 'SM RCS A PRPLNT', panel: 'CM_P2', group: 'RCS', talkback: 'CM.RCS.SM_A_PRPLNT_TB' }),
  MOM3('CM.RCS.SM_B_PRPLNT', 'OPEN', 'CENTER', 'CLOSE', { label: 'SM RCS B PRPLNT', panel: 'CM_P2', group: 'RCS', talkback: 'CM.RCS.SM_B_PRPLNT_TB' }),
  MOM3('CM.RCS.SM_C_PRPLNT', 'OPEN', 'CENTER', 'CLOSE', { label: 'SM RCS C PRPLNT', panel: 'CM_P2', group: 'RCS', talkback: 'CM.RCS.SM_C_PRPLNT_TB' }),
  MOM3('CM.RCS.SM_D_PRPLNT', 'OPEN', 'CENTER', 'CLOSE', { label: 'SM RCS D PRPLNT', panel: 'CM_P2', group: 'RCS', talkback: 'CM.RCS.SM_D_PRPLNT_TB' }),
  { ...TOGGLE2('CM.RCS.CM_RCS_PRESS', 'ON', 'OFF', 'OFF'), guarded: true, guardSafe: 'OFF', label: 'CM RCS PRESS', panel: 'CM_P2', group: 'RCS' },
  TOGGLE2('CM.RCS.RCS_TRNFR', 'CM', 'SM', 'SM', { label: 'RCS TRNFR', panel: 'CM_P2', group: 'RCS' }),
  // EPS
  MOM3('CM.EPS.FC1_REAC', 'OPEN', 'CENTER', 'CLOSE', { label: 'FC 1 REAC', panel: 'CM_P3', group: 'EPS', talkback: 'CM.EPS.FC1_REAC_TB' }),
  MOM3('CM.EPS.FC2_REAC', 'OPEN', 'CENTER', 'CLOSE', { label: 'FC 2 REAC', panel: 'CM_P3', group: 'EPS', talkback: 'CM.EPS.FC2_REAC_TB' }),
  MOM3('CM.EPS.FC3_REAC', 'OPEN', 'CENTER', 'CLOSE', { label: 'FC 3 REAC', panel: 'CM_P3', group: 'EPS', talkback: 'CM.EPS.FC3_REAC_TB' }),
  ...['MNA', 'MNB'].flatMap((bus) =>
    [1, 2, 3].map((n) => MOM3(`CM.EPS.${bus}_FC${n}`, 'ON', 'CENTER', 'OFF', { label: `${bus === 'MNA' ? 'MAIN A' : 'MAIN B'} FC ${n}`, panel: 'CM_P3', group: 'EPS', talkback: `CM.EPS.${bus}_FC${n}_TB` })),
  ),
  TOGGLE2('CM.EPS.MAIN_BUS_TIE_AC', 'ON', 'OFF', 'OFF', { label: 'MAIN BUS TIE BAT A/C', panel: 'CM_P3', group: 'EPS' }),
  TOGGLE2('CM.EPS.MAIN_BUS_TIE_BC', 'ON', 'OFF', 'OFF', { label: 'MAIN BUS TIE BAT B/C', panel: 'CM_P3', group: 'EPS' }),
  TOGGLE2('CM.EPS.INV1_PWR', 'MNA', 'OFF', 'MNA', { label: 'INVERTER 1', panel: 'CM_P3', group: 'EPS' }),
  TOGGLE2('CM.EPS.INV2_PWR', 'MNB', 'OFF', 'MNB', { label: 'INVERTER 2', panel: 'CM_P3', group: 'EPS' }),
  TOGGLE3('CM.EPS.INV3_PWR', 'MNA', 'OFF', 'MNB', 'OFF', { label: 'INVERTER 3', panel: 'CM_P3', group: 'EPS' }),
  ...[1, 2].flatMap((ac) => [1, 2, 3].map((n) => MOM3(`CM.EPS.AC${ac}_INV${n}`, 'ON', 'CENTER', 'OFF', { label: `AC BUS ${ac} INV ${n}`, panel: 'CM_P3', group: 'EPS', talkback: `CM.EPS.AC${ac}_INV${n}_TB` }))),
  { id: 'CM.EPS.BAT_CHARGER', type: 'rotary', positions: ['OFF', 'A', 'B', 'C'], default: 'OFF', label: 'BATTERY CHARGER', panel: 'CM_P3', group: 'EPS' },
  { id: 'CM.EPS.DC_IND', type: 'rotary', positions: ['FC1', 'FC2', 'FC3', 'MNA', 'MNB', 'BAT_CHGR', 'BAT_A', 'BAT_B', 'BAT_C'], default: 'MNA', label: 'DC INDICATORS', panel: 'CM_P3', group: 'EPS' },
  { id: 'CM.EPS.AC_IND', type: 'rotary', positions: ['AC1', 'AC2'], default: 'AC1', label: 'AC INDICATORS', panel: 'CM_P3', group: 'EPS' },
  TOGGLE3('CM.EPS.SCE_PWR', 'NORM', 'OFF', 'AUX', 'NORM', { label: 'SCE POWER', panel: 'CM_P2', group: 'EPS', desc: 'Equipo acondicionador de señales (SCE): NORMAL / APAGADO / AUXILIAR' }),
  CB('CM.CB.MAIN_A_BAT_A', { label: 'MAIN A - BAT A', panel: 'CM_RIGHT', group: 'EPS' }),
  CB('CM.CB.MAIN_A_BAT_C', { label: 'MAIN A - BAT C', panel: 'CM_RIGHT', group: 'EPS' }),
  CB('CM.CB.MAIN_B_BAT_B', { label: 'MAIN B - BAT B', panel: 'CM_RIGHT', group: 'EPS' }),
  CB('CM.CB.MAIN_B_BAT_C', { label: 'MAIN B - BAT C', panel: 'CM_RIGHT', group: 'EPS' }),
  // Cryogenics
  ...['H2', 'O2'].flatMap((g) =>
    [1, 2].flatMap((n) => [
      TOGGLE3(`CM.CRYO.${g}_HTR_${n}`, 'AUTO', 'OFF', 'ON', 'AUTO', { label: `${g} HEATERS ${n}`, panel: 'CM_P2', group: 'CRYO' }),
      TOGGLE3(`CM.CRYO.${g}_FAN_${n}`, 'AUTO', 'OFF', 'ON', 'OFF', { label: `${g} FANS ${n}`, panel: 'CM_P2', group: 'CRYO' }),
    ]),
  ),
  // ECS
  TOGGLE3('CM.ECS.SUIT_COMPR_1', 'AC1', 'OFF', 'AC2', 'AC1', { label: 'SUIT COMPRESSOR 1', panel: 'CM_P2', group: 'ECS' }),
  TOGGLE3('CM.ECS.SUIT_COMPR_2', 'AC1', 'OFF', 'AC2', 'OFF', { label: 'SUIT COMPRESSOR 2', panel: 'CM_P2', group: 'ECS' }),
  TOGGLE2('CM.ECS.CABIN_FAN_1', 'ON', 'OFF', 'ON', { label: 'CABIN FAN 1', panel: 'CM_P2', group: 'ECS' }),
  TOGGLE2('CM.ECS.CABIN_FAN_2', 'ON', 'OFF', 'OFF', { label: 'CABIN FAN 2', panel: 'CM_P2', group: 'ECS' }),
  // Caution & warning
  BUTTON('CM.CW.MASTER_ALARM_1', { label: 'MASTER ALARM', panel: 'CM_P1', group: 'CW' }),
  BUTTON('CM.CW.MASTER_ALARM_2', { label: 'MASTER ALARM', panel: 'CM_P2', group: 'CW' }),
  BUTTON('CM.CW.MASTER_ALARM_3', { label: 'MASTER ALARM', panel: 'CM_LEB', group: 'CW' }),
  { ...TOGGLE3('CM.CW.LAMP_TEST', '1', 'OFF', '2', 'OFF'), momentary: ['1', '2'], rest: 'OFF', label: 'LAMP TEST', panel: 'CM_P2', group: 'CW' },
  TOGGLE3('CM.CW.MODE', 'NORMAL', 'BOOST', 'ACK', 'NORMAL', { label: 'C/W MODE', panel: 'CM_P2', group: 'CW' }),
  // Timers
  { ...TOGGLE3('CM.MT.EVENT_TIMER', 'START', 'STOP', 'RESET', 'STOP'), label: 'EVENT TIMER', panel: 'CM_P2', group: 'TIMER' },
  TOGGLE2('CM.MT.EVENT_TIMER_DIR', 'UP', 'DOWN', 'UP', { label: 'EVENT TIMER UP/DOWN', panel: 'CM_P2', group: 'TIMER' }),
  // Docking
  TOGGLE3('CM.DOCK.PROBE', 'EXTEND', 'OFF', 'RETRACT', 'OFF', { label: 'DOCKING PROBE', panel: 'CM_P2', group: 'DOCK' }),
  // Optics (LEB)
  TOGGLE3('CM.OPT.MODE', 'MAN', 'ZERO', 'CMC', 'MAN', { label: 'OPTICS MODE', panel: 'CM_LEB', group: 'OPT' }),
  BUTTON('CM.OPT.MARK', { label: 'MARK', panel: 'CM_LEB', group: 'OPT' }),
  BUTTON('CM.OPT.MARK_REJECT', { label: 'MARK REJECT', panel: 'CM_LEB', group: 'OPT' }),
];

export const CM_SIGNALS = [
  { key: 'CM.EPS.MNA.V', unit: 'V', min: 0, max: 45 },
  { key: 'CM.EPS.MNB.V', unit: 'V', min: 0, max: 45 },
  { key: 'CM.EPS.AC1.V', unit: 'V', min: 0, max: 150 },
  { key: 'CM.EPS.AC2.V', unit: 'V', min: 0, max: 150 },
  { key: 'CM.CRYO.O2_1.P_PSI', unit: 'psi', min: 0, max: 1050 },
  { key: 'CM.CRYO.O2_2.P_PSI', unit: 'psi', min: 0, max: 1050 },
  { key: 'CM.CRYO.O2_1.QTY', unit: 'frac', min: 0, max: 1 },
  { key: 'CM.CRYO.O2_2.QTY', unit: 'frac', min: 0, max: 1 },
  { key: 'CM.CW.MASTER_ALARM', unit: 'bool' },
];
