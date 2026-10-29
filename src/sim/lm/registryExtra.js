// Extended LM control set (panels 1–16) with authentic placards and the breaker panels 11 & 16.

const T2 = (id, a, b, def, label, panel, group, desc = '') => ({ id, type: 'toggle', positions: [a, b], default: def, label, panel, group, desc });
const T3 = (id, a, b, c, def, label, panel, group, desc = '') => ({ id, type: 'toggle', positions: [a, b, c], default: def, label, panel, group, desc });
const ROT = (id, positions, def, label, panel, group, desc = '') => ({ id, type: 'rotary', positions, default: def, label, panel, group, desc });
const CB = (name, label, panel, group) => ({ id: `LM.CB.${name}`, type: 'cb', positions: ['IN', 'OUT'], default: 'IN', label, panel, group, desc: `Disyuntor: ${label}` });

export const LM_EXTRA_SWITCHES = [
  // P1 — CDR flight displays
  T2('LM.GNC.RATE_ERR_MON', 'LDG_RDR_CMPTR', 'RNDZ_RDR', 'LDG_RDR_CMPTR', 'RATE/ERR MON', 'LM_P1', 'FLIGHT DISPLAYS', 'Fuente de las agujas de error'),
  T2('LM.GNC.ATT_MON', 'PGNS', 'AGS', 'PGNS', 'ATTITUDE MON', 'LM_P1', 'FLIGHT DISPLAYS', 'Fuente del FDAI'),
  T2('LM.GNC.ALT_RATE_SCALE', 'X1', 'X10', 'X1', 'ALT RATE SCALE', 'LM_P1', 'FLIGHT DISPLAYS', 'Escala del indicador de velocidad vertical'),
  T2('LM.GNC.XPTR_SCALE', 'LO_MULT', 'HI_MULT', 'HI_MULT', 'X-PTR SCALE', 'LM_P1', 'FLIGHT DISPLAYS', 'Escala del indicador de cruz'),
  T2('LM.ENG.GMBL_TRIM', 'ON', 'OFF', 'ON', 'ENG GMBL TRIM', 'LM_P1', 'ENGINE', 'Ajuste de cardán del DPS'),
  // P2 — LMP flight displays, RCS, ECS
  T2('LM.RCS.ASC_FEED_A', 'OPEN', 'CLOSE', 'CLOSE', 'ASC He / FEED A', 'LM_P2', 'RCS SYS A/B', 'Interconexión de alimentación desde la etapa de ascenso (A)'),
  T2('LM.RCS.ASC_FEED_B', 'OPEN', 'CLOSE', 'CLOSE', 'ASC He / FEED B', 'LM_P2', 'RCS SYS A/B', 'Interconexión de alimentación desde la etapa de ascenso (B)'),
  T2('LM.RCS.MAIN_SOV_A', 'OPEN', 'CLOSE', 'OPEN', 'MAIN SOV A', 'LM_P2', 'RCS SYS A/B', 'Válvula principal del sistema A'),
  T2('LM.RCS.MAIN_SOV_B', 'OPEN', 'CLOSE', 'OPEN', 'MAIN SOV B', 'LM_P2', 'RCS SYS A/B', 'Válvula principal del sistema B'),
  T2('LM.RCS.XFEED', 'OPEN', 'CLOSE', 'CLOSE', 'RCS XFEED', 'LM_P2', 'RCS SYS A/B', 'Alimentación cruzada entre sistemas'),
  ...['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4'].map((q) => T2(`LM.RCS.ISOL_${q}`, 'OPEN', 'CLOSE', 'OPEN', `THRUSTER PAIR ${q}`, 'LM_P2', 'THRUSTER PAIR', `Válvula de aislamiento del par ${q}`)),
  ROT('LM.ECS.TEMP_MON', ['RCS', 'ECS', 'GLYCOL', 'SUIT', 'CABIN'], 'CABIN', 'TEMP/PRESS MON', 'LM_P2', 'ECS', 'Selector del indicador de temperatura y presión'),
  // P3 — radar, heaters, lighting, mode control
  T2('LM.RADAR.LR_TEST', 'ALT_TEST', 'OFF', 'OFF', 'LDG RDR TEST', 'LM_P3', 'RADAR', 'Prueba del radar de alunizaje'),
  T2('LM.RADAR.RR_TEST', 'TEST', 'OFF', 'OFF', 'RNDZ RDR TEST', 'LM_P3', 'RADAR', 'Prueba del radar de encuentro'),
  ROT('LM.RADAR.TEST_MON', ['ALT_XMTR', 'VEL_XMTR', 'AGC', 'MOTOR_V', 'ANT_TEMP'], 'AGC', 'TEST/MONITOR', 'LM_P3', 'RADAR', 'Selector de prueba del radar'),
  T3('LM.GNC.SLEW_RATE', 'HI', 'LO', 'OFF', 'LO', 'SLEW RATE', 'LM_P3', 'RADAR', 'Velocidad de orientación del radar'),
  ROT('LM.GNC.TEMP_PRESS_MON', ['RCS_A', 'RCS_B', 'DPS', 'APS'], 'DPS', 'TEMP/PRESS MON', 'LM_P3', 'PROPULSION', 'Selector de propulsión'),
  T2('LM.HTR.RCS_SYS_A', 'ON', 'OFF', 'ON', 'RCS SYS A HTR', 'LM_P3', 'HEATERS', 'Calentadores RCS A'),
  T2('LM.HTR.RCS_SYS_B', 'ON', 'OFF', 'ON', 'RCS SYS B HTR', 'LM_P3', 'HEATERS', 'Calentadores RCS B'),
  T2('LM.HTR.LR', 'ON', 'OFF', 'ON', 'LDG RDR HTR', 'LM_P3', 'HEATERS', 'Calentador del radar'),
  T2('LM.HTR.S_BAND', 'ON', 'OFF', 'ON', 'S BAND ANT HTR', 'LM_P3', 'HEATERS', 'Calentador de antena'),
  ROT('LM.LTG.FLOOD', ['OFF', 'DIM', 'BRIGHT'], 'DIM', 'FLOOD', 'LM_P3', 'LIGHTING', 'Luces de cabina'),
  ROT('LM.LTG.INTEGRAL', ['OFF', 'LOW', 'MED', 'HIGH'], 'MED', 'INTEGRAL', 'LM_P3', 'LIGHTING', 'Iluminación de paneles'),
  T2('LM.LTG.ANUN_NUM', 'BRIGHT', 'DIM', 'BRIGHT', 'ANUN/NUM', 'LM_P3', 'LIGHTING', 'Brillo de anunciadores'),
  T2('LM.LTG.DOCK', 'ON', 'OFF', 'OFF', 'DOCKING LTS', 'LM_P3', 'LIGHTING', 'Luces de acoplamiento'),
  // P5 / P6
  T2('LM.MT.MISSION_TIMER', 'START', 'STOP', 'START', 'MISSION TIMER', 'LM_P5', 'TIMERS', 'Reloj de misión'),
  T3('LM.MT.EVENT_DIR', 'UP', 'DOWN', 'RESET', 'UP', 'EVENT TIMER', 'LM_P5', 'TIMERS', 'Sentido del cronómetro'),
  T2('LM.LTG.UTIL', 'ON', 'OFF', 'OFF', 'UTILITY LT', 'LM_P5', 'LIGHTING', 'Luz utilitaria'),
  T2('LM.AGS.ASA_PWR', 'ON', 'OFF', 'OFF', 'ABORT SENSOR ASSY', 'LM_P6', 'AGS', 'Sensor de la guía de aborto'),
  T2('LM.AGS.AEA_PWR', 'ON', 'OFF', 'OFF', 'AEA', 'LM_P6', 'AGS', 'Electrónica de la guía de aborto'),
  T3('LM.AGS.STATUS', 'OPERATE', 'STANDBY', 'OFF', 'OFF', 'AGS STATUS', 'LM_P6', 'AGS', 'Estado del AGS'),
  // P8 — explosive devices, audio
  T2('LM.EXP.DES_PRPLNT_ISOL', 'FIRE', 'OFF', 'OFF', 'DES PRPLNT ISOL VLV', 'LM_P8', 'EXPLOSIVE DEVICES', 'Abre el aislamiento de propelente del DPS'),
  T2('LM.EXP.ASC_He_PRESS', 'FIRE', 'OFF', 'OFF', 'ASC He PRESS', 'LM_P8', 'EXPLOSIVE DEVICES', 'Presuriza la etapa de ascenso'),
  T2('LM.EXP.DES_He_PRESS', 'FIRE', 'OFF', 'OFF', 'DES START He PRESS', 'LM_P8', 'EXPLOSIVE DEVICES', 'Presuriza la etapa de descenso'),
  T2('LM.EXP.ED_LOGIC_A', 'ON', 'OFF', 'OFF', 'ED LOGIC PWR A', 'LM_P8', 'EXPLOSIVE DEVICES', 'Lógica de pirotecnia A'),
  T2('LM.EXP.ED_LOGIC_B', 'ON', 'OFF', 'OFF', 'ED LOGIC PWR B', 'LM_P8', 'EXPLOSIVE DEVICES', 'Lógica de pirotecnia B'),
  T3('LM.AUDIO.CDR_SBAND', 'T_R', 'OFF', 'RCV', 'T_R', 'S BAND', 'LM_P8', 'CDR AUDIO', 'Audio de banda S'),
  T3('LM.AUDIO.CDR_VHF_A', 'T_R', 'OFF', 'RCV', 'T_R', 'VHF A', 'LM_P8', 'CDR AUDIO', 'Audio VHF A'),
  T3('LM.AUDIO.CDR_ICS', 'T_R', 'OFF', 'RCV', 'T_R', 'ICS', 'LM_P8', 'CDR AUDIO', 'Intercomunicador'),
  // P12 — comm
  T3('LM.COMM.SBAND_MODE', 'PM', 'OFF', 'FM', 'PM', 'S BAND MODE', 'LM_P12', 'S-BAND', 'Modo de banda S'),
  T2('LM.COMM.SBAND_XMTR', 'PRIM', 'SEC', 'PRIM', 'XMTR/RCVR', 'LM_P12', 'S-BAND', 'Transmisor'),
  T2('LM.COMM.PWR_AMPL', 'PRIM', 'OFF', 'PRIM', 'PWR AMPL', 'LM_P12', 'S-BAND', 'Amplificador'),
  ROT('LM.COMM.ANT', ['FWD', 'AFT', 'SLEW'], 'FWD', 'S BAND ANT', 'LM_P12', 'S-BAND', 'Antena'),
  T3('LM.COMM.VHF_A', 'XMTR', 'OFF', 'RCVR', 'OFF', 'VHF A', 'LM_P12', 'VHF', 'Radio VHF A'),
  T3('LM.COMM.VHF_B', 'XMTR', 'OFF', 'RCVR', 'OFF', 'VHF B', 'LM_P12', 'VHF', 'Radio VHF B'),
  T2('LM.COMM.TLM_RATE', 'HIGH', 'LOW', 'HIGH', 'TLM PCM', 'LM_P12', 'TLM', 'Velocidad de telemetría'),
  T3('LM.AUDIO.LMP_SBAND', 'T_R', 'OFF', 'RCV', 'T_R', 'S BAND', 'LM_P12', 'LMP AUDIO', 'Audio de banda S'),
  T3('LM.AUDIO.LMP_ICS', 'T_R', 'OFF', 'RCV', 'T_R', 'ICS', 'LM_P12', 'LMP AUDIO', 'Intercomunicador'),
  // P14 — EPS selectors
  ROT('LM.EPS.DC_IND', ['CDR_BUS', 'LMP_BUS', 'BAT_1', 'BAT_2', 'BAT_3', 'BAT_4', 'BAT_5', 'BAT_6', 'CSM'], 'CDR_BUS', 'EPS DC MON', 'LM_P14', 'EPS', 'Selector del voltímetro / amperímetro'),
  T2('LM.EPS.ED_BAT_A', 'ON', 'OFF', 'ON', 'ED BAT A', 'LM_P14', 'EPS', 'Batería de pirotecnia A'),
  T2('LM.EPS.ED_BAT_B', 'ON', 'OFF', 'ON', 'ED BAT B', 'LM_P14', 'EPS', 'Batería de pirotecnia B'),
  T2('LM.EPS.CROSS_TIE', 'BAL_LOADS', 'OFF', 'OFF', 'CROSS TIE', 'LM_P14', 'EPS', 'Interconexión de buses CDR/LMP'),
];

const CB_GROUPS = {
  LM_P11: {
    'FLIGHT DISPLAYS': ['FDAI', 'X-PTR', 'ALT/RNG', 'THRUST/WT', 'EVENT TMR', 'MSN TMR', 'TAPE METER'],
    'STAB/CONT': ['ATCA', 'ATCA PGNS', 'ATCA AGS', 'AELD', 'ABORT STAGE', 'DECA', 'GIMBAL', 'TTCA', 'RCS A ISOL', 'RCS QUAD 1', 'RCS QUAD 2'],
    'PROPULSION': ['DES He REG 1', 'DES He REG 2', 'DES ISOL', 'DES PRPLNT QTY', 'ASC He REG', 'APS ENG ARM', 'ASC FEED'],
    'CDR BUS EPS': ['DC BUS VOLT', 'INV 1', 'AC BUS A', 'BAT FEED 1', 'BAT FEED 2', 'XLUNAR BUS TIE', 'CROSS TIE BAL'],
  },
  LM_P16: {
    'LMP STAB/CONT': ['ENG ARM', 'ASA', 'AEA', 'ATCA', 'RCS B ISOL', 'RCS QUAD 3', 'RCS QUAD 4', 'DES ENG OVRD'],
    'LMP INSTRUMENTS': ['SIG SENSOR', 'PCMTEA', 'C/W PWR', 'SBD', 'LTG ANUN', 'LTG FLOOD', 'TRACK LT'],
    'ECS': ['SUIT FAN 1', 'SUIT FAN 2', 'SUIT FAN dP', 'CABIN FAN', 'GLY PUMP 1', 'GLY PUMP 2', 'CO2 SENSOR', 'H2O SEP', 'CABIN REPRESS'],
    'LMP BUS EPS': ['DC BUS VOLT', 'INV 2', 'AC BUS B', 'BAT FEED 3', 'BAT FEED 4', 'ASC ECA', 'DES ECA'],
    'COMM': ['S BAND PA', 'S BAND XCVR', 'VHF A', 'VHF B', 'PMP', 'DISPLAY', 'SE AUDIO'],
  },
};

for (const [panel, groups] of Object.entries(CB_GROUPS)) {
  for (const [group, labels] of Object.entries(groups)) {
    for (const l of labels) {
      const id = group === 'LMP STAB/CONT' && l === 'ENG ARM' ? 'ENG_ARM' : `${group.replace(/[^A-Z0-9]+/g, '_')}_${l.replace(/[^A-Z0-9]+/g, '_')}`;
      LM_EXTRA_SWITCHES.push(CB(id, l, panel, group));
    }
  }
}
