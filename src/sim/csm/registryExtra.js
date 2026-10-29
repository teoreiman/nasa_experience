// Extended CM control set: remaining MDC controls plus the circuit-breaker panels
// (left console panels 5/8, right console 225/226/229/275, LEB). Appended to CM_SWITCHES.

const T2 = (id, a, b, def, label, panel, group, desc = '') => ({ id, type: 'toggle', positions: [a, b], default: def, label, panel, group, desc });
const T3 = (id, a, b, c, def, label, panel, group, desc = '') => ({ id, type: 'toggle', positions: [a, b, c], default: def, label, panel, group, desc });
const MOM = (id, label, panel, group, desc, talkback) => ({ id, type: 'toggle', positions: ['OPEN', 'CENTER', 'CLOSE'], default: 'CENTER', momentary: ['OPEN', 'CLOSE'], rest: 'CENTER', label, panel, group, desc, talkback });
const ROT = (id, positions, def, label, panel, group, desc = '') => ({ id, type: 'rotary', positions, default: def, label, panel, group, desc });
const CB = (name, label, panel, group) => ({ id: `CM.CB.${name}`, type: 'cb', positions: ['IN', 'OUT'], default: 'IN', label, panel, group, desc: `Disyuntor: ${label}` });

export const CM_EXTRA_SWITCHES = [
  // panel 1 — SCS / attitude reference / SPS
  T3('CM.GNC.BMAG_MODE_ROLL', 'ATT1_RATE2', 'RATE2', 'RATE1', 'RATE2', 'BMAG MODE ROLL', 'CM_P1', 'SCS', 'Fuente de giróscopos BMAG para alabeo'),
  T3('CM.GNC.BMAG_MODE_PITCH', 'ATT1_RATE2', 'RATE2', 'RATE1', 'RATE2', 'BMAG MODE PITCH', 'CM_P1', 'SCS', 'Fuente de giróscopos BMAG para cabeceo'),
  T3('CM.GNC.BMAG_MODE_YAW', 'ATT1_RATE2', 'RATE2', 'RATE1', 'RATE2', 'BMAG MODE YAW', 'CM_P1', 'SCS', 'Fuente de giróscopos BMAG para guiñada'),
  T3('CM.GNC.FDAI_SCALE', '5_5', '50_15', '50_1', '50_15', 'FDAI SCALE', 'CM_P1', 'FDAI', 'Escala de las agujas del FDAI'),
  T3('CM.GNC.FDAI_SELECT', '1', 'BOTH', '2', 'BOTH', 'FDAI SELECT', 'CM_P1', 'FDAI', 'Qué FDAI se alimenta'),
  T3('CM.GNC.FDAI_SOURCE', 'CMC', 'ATT_SET', 'GDC', 'CMC', 'FDAI SOURCE', 'CM_P1', 'FDAI', 'Referencia de actitud del FDAI'),
  T2('CM.GNC.ATT_SET', 'IMU', 'GDC', 'IMU', 'ATT SET', 'CM_P1', 'FDAI', 'Referencia de los diales ATT SET'),
  T2('CM.GNC.LIMIT_CYCLE', 'ON', 'OFF', 'OFF', 'LIMIT CYCLE', 'CM_P1', 'SCS', 'Ciclo límite del piloto automático SCS'),
  T3('CM.GNC.ROT_CONTR_PWR_NORMAL_2', 'AC_DC', 'AC', 'OFF', 'AC_DC', 'ROT CONTR NORMAL 2', 'CM_P1', 'GNC', 'Alimentación del controlador de rotación 2'),
  T3('CM.GNC.ROT_CONTR_PWR_DIRECT_1', 'MNA_MNB', 'OFF', 'MNB', 'OFF', 'ROT CONTR DIRECT 1', 'CM_P1', 'GNC', 'Modo directo del controlador de rotación'),
  T3('CM.GNC.ROT_CONTR_PWR_DIRECT_2', 'MNA_MNB', 'OFF', 'MNB', 'OFF', 'ROT CONTR DIRECT 2', 'CM_P1', 'GNC', 'Modo directo del controlador de rotación'),
  T2('CM.GNC.SCS_TVC_PITCH', 'AUTO', 'RATE_CMD', 'AUTO', 'SCS TVC PITCH', 'CM_P1', 'SPS', 'Control del vector de empuje en cabeceo'),
  T2('CM.GNC.SCS_TVC_YAW', 'AUTO', 'RATE_CMD', 'AUTO', 'SCS TVC YAW', 'CM_P1', 'SPS', 'Control del vector de empuje en guiñada'),
  T3('CM.SPS.TVC_SERVO_PWR_1', 'AC1_MNA', 'OFF', 'AC2_MNB', 'OFF', 'TVC SERVO PWR 1', 'CM_P1', 'SPS', 'Servos de cardán del SPS (sistema 1)'),
  T3('CM.SPS.TVC_SERVO_PWR_2', 'AC1_MNA', 'OFF', 'AC2_MNB', 'OFF', 'TVC SERVO PWR 2', 'CM_P1', 'SPS', 'Servos de cardán del SPS (sistema 2)'),
  T2('CM.GNC.EMS_ROLL', 'ON', 'OFF', 'OFF', 'EMS ROLL', 'CM_P1', 'EMS', 'Indicador de alabeo del EMS'),
  T2('CM.GNC.EMS_05G', 'ON', 'OFF', 'OFF', '.05 G', 'CM_P1', 'EMS', 'Activa la detección de 0,05 g'),
  T2('CM.SPS.DIRECT_ULLAGE', 'ULLAGE', 'OFF', 'OFF', 'DIRECT ULLAGE', 'CM_P1', 'SPS', 'RCS +X directo para asentar el propelente'),
  T2('CM.SPS.THRUST_DIRECT_ON', 'ON', 'NORMAL', 'NORMAL', 'THRUST ON DIRECT', 'CM_P1', 'SPS', 'Encendido directo del SPS'),
  T2('CM.GNC.ACCEL_RESET', 'RESET', 'OFF', 'OFF', 'G-METER RESET', 'CM_P1', 'GNC', 'Reinicia el acelerómetro'),
  // panel 2 — RCS
  ...['A', 'B', 'C', 'D'].flatMap((q) => [1, 2, 3, 4].map((j) => T3(`CM.RCS.AUTO_${q}${j}`, 'MNA', 'OFF', 'MNB', 'MNA', `${q}/${j}`, 'CM_P2', 'AUTO RCS SELECT', `Habilita el propulsor ${j} del cuadrante ${q} del RCS del SM`))),
  ...['A', 'B', 'C', 'D'].flatMap((q) => [
    MOM(`CM.RCS.SM_${q}_HE1`, `${q} He 1`, 'CM_P2', 'SM RCS HELIUM', `Válvula de helio 1 del cuadrante ${q}`, `CM.RCS.SM_${q}_HE1_TB`),
    MOM(`CM.RCS.SM_${q}_HE2`, `${q} He 2`, 'CM_P2', 'SM RCS HELIUM', `Válvula de helio 2 del cuadrante ${q}`, `CM.RCS.SM_${q}_HE2_TB`),
  ]),
  ...['A', 'B', 'C', 'D'].map((q) => T2(`CM.RCS.SM_HEATERS_${q}`, 'PRIM', 'OFF', 'PRIM', `SM RCS HTRS ${q}`, 'CM_P2', 'RCS', `Calentadores del cuadrante ${q}`)),
  ROT('CM.RCS.IND', ['SM_A', 'SM_B', 'SM_C', 'SM_D', 'CM_1', 'CM_2'], 'SM_A', 'RCS INDICATORS', 'CM_P2', 'RCS', 'Selector de indicadores de RCS'),
  // panel 2 — ECS
  T2('CM.ECS.GLY_EVAP_STEAM', 'AUTO', 'MAN', 'AUTO', 'GLY EVAP STEAM', 'CM_P2', 'ECS', 'Presión de vapor del evaporador de glicol'),
  T2('CM.ECS.GLY_EVAP_H2O', 'AUTO', 'ON', 'AUTO', 'GLY EVAP H2O', 'CM_P2', 'ECS', 'Flujo de agua al evaporador'),
  T3('CM.ECS.CABIN_TEMP', 'AUTO', 'MAN', 'OFF', 'AUTO', 'CABIN TEMP', 'CM_P2', 'ECS', 'Control de temperatura de cabina'),
  T2('CM.ECS.SEC_COOLANT', 'ON', 'OFF', 'OFF', 'SEC COOLANT', 'CM_P2', 'ECS', 'Lazo secundario de refrigeración'),
  T3('CM.ECS.RAD_FLOW', 'AUTO', 'MAN', 'OFF', 'AUTO', 'RAD FLOW CONT', 'CM_P2', 'ECS', 'Control de flujo de los radiadores'),
  ROT('CM.ECS.GLY_PUMP', ['OFF', 'AC1', 'AC2'], 'AC1', 'GLYCOL PUMP', 'CM_P2', 'ECS', 'Bomba de glicol'),
  T2('CM.ECS.SURGE_TANK', 'ON', 'OFF', 'ON', 'SURGE TANK O2', 'CM_P2', 'ECS', 'Tanque de compensación de O2'),
  T2('CM.ECS.H2O_ACCUM', 'AUTO', 'MAN', 'AUTO', 'H2O ACCUM', 'CM_P2', 'ECS', 'Acumulador de agua'),
  T3('CM.CRYO.PRESS_IND', 'SURGE', '1', '2', '1', 'O2 PRESS IND', 'CM_P2', 'CRYO', 'Selector del indicador de presión de O2'),
  // panel 3 — EPS
  ...[1, 2, 3].map((n) => T3(`CM.EPS.FC${n}_PURGE`, 'H2', 'OFF', 'O2_H2', 'OFF', `FC ${n} PURGE`, 'CM_P3', 'FUEL CELL', `Purga de la pila de combustible ${n}`)),
  ...[1, 2, 3].map((n) => T2(`CM.EPS.FC${n}_RAD`, 'NORM', 'BYPASS', 'NORM', `FC ${n} RAD`, 'CM_P3', 'FUEL CELL', `Radiador de la pila ${n}`)),
  ...[1, 2, 3].map((n) => T2(`CM.EPS.FC${n}_HTR`, 'ON', 'OFF', 'ON', `FC ${n} HTR`, 'CM_P3', 'FUEL CELL', `Calentador de la pila ${n}`)),
  T2('CM.EPS.AC1_RESET', 'RESET', 'OFF', 'OFF', 'AC1 OVLD RESET', 'CM_P3', 'AC POWER', 'Rearma la sobrecarga del bus AC 1'),
  T2('CM.EPS.AC2_RESET', 'RESET', 'OFF', 'OFF', 'AC2 OVLD RESET', 'CM_P3', 'AC POWER', 'Rearma la sobrecarga del bus AC 2'),
  T2('CM.EPS.NONESS_BUS', 'MNA', 'OFF', 'MNA', 'NONESS BUS', 'CM_P3', 'DC POWER', 'Bus no esencial'),
  T2('CM.EPS.FLOAT_BAG', 'ON', 'OFF', 'OFF', 'UPRIGHT SYS', 'CM_P3', 'DC POWER', 'Sistema de bolsas de enderezamiento'),
  // panel 3 — comm
  T3('CM.COMM.SBAND_MODE', 'PM', 'OFF', 'FM', 'PM', 'S BAND MODE', 'CM_P3', 'S-BAND', 'Modo de la banda S'),
  T3('CM.COMM.SBAND_VOICE', 'VOICE', 'OFF', 'RELAY', 'VOICE', 'S BAND VOICE', 'CM_P3', 'S-BAND', 'Voz por banda S'),
  T3('CM.COMM.PWR_AMPL', 'PRIM', 'OFF', 'SEC', 'PRIM', 'PWR AMPL', 'CM_P3', 'S-BAND', 'Amplificador de potencia'),
  T2('CM.COMM.PWR_AMPL_HIGH', 'HIGH', 'LOW', 'HIGH', 'AMPL HIGH/LOW', 'CM_P3', 'S-BAND', 'Potencia alta / baja'),
  ROT('CM.COMM.SBAND_ANT', ['OMNI_A', 'OMNI_B', 'OMNI_C', 'OMNI_D', 'HGA'], 'OMNI_B', 'S BAND ANT', 'CM_P3', 'S-BAND', 'Selección de antena'),
  T3('CM.COMM.HGA_TRACK', 'AUTO', 'MAN', 'REACQ', 'MAN', 'HGA TRACK', 'CM_P3', 'HIGH GAIN ANT', 'Seguimiento de la antena de alta ganancia'),
  T2('CM.COMM.HGA_PWR', 'POWER', 'OFF', 'OFF', 'HGA PWR', 'CM_P3', 'HIGH GAIN ANT', 'Alimentación de la antena HGA'),
  T3('CM.COMM.VHF_AM_A', 'DUPLEX', 'OFF', 'SIMPLEX', 'SIMPLEX', 'VHF AM A', 'CM_P3', 'VHF', 'Radio VHF A'),
  T3('CM.COMM.VHF_AM_B', 'DUPLEX', 'OFF', 'SIMPLEX', 'OFF', 'VHF AM B', 'CM_P3', 'VHF', 'Radio VHF B'),
  T2('CM.COMM.VHF_BEACON', 'ON', 'OFF', 'OFF', 'VHF BEACON', 'CM_P3', 'VHF', 'Radiobaliza VHF (recuperación)'),
  T2('CM.COMM.UP_TLM', 'ACCEPT', 'BLOCK', 'ACCEPT', 'UP TLM CMC', 'CM_P3', 'TLM', 'Acepta o bloquea el enlace de subida al ordenador'),
  T2('CM.COMM.PCM_RATE', 'HIGH', 'LOW', 'HIGH', 'PCM BIT RATE', 'CM_P3', 'TLM', 'Velocidad de telemetría'),
  T3('CM.COMM.TAPE', 'RECORD', 'OFF', 'PLAY', 'OFF', 'DSE TAPE', 'CM_P3', 'TLM', 'Grabadora de datos'),
  // left console — lighting & audio
  ROT('CM.LTG.FLOOD', ['OFF', 'DIM', 'BRIGHT'], 'DIM', 'FLOOD', 'CM_LEFT', 'LIGHTING', 'Luces de cabina'),
  ROT('CM.LTG.INTEGRAL', ['OFF', 'LOW', 'MED', 'HIGH'], 'MED', 'INTEGRAL', 'CM_LEFT', 'LIGHTING', 'Iluminación integral de los paneles'),
  ROT('CM.LTG.NUMERICS', ['OFF', 'LOW', 'MED', 'HIGH'], 'MED', 'NUMERICS', 'CM_LEFT', 'LIGHTING', 'Brillo de los displays numéricos'),
  T2('CM.LTG.FLOOD_FIXED', 'FIXED', 'DIM', 'FIXED', 'FLOOD FIXED', 'CM_LEFT', 'LIGHTING', 'Luces de emergencia'),
  T3('CM.AUDIO.CDR_SBAND', 'T_R', 'OFF', 'RCV', 'T_R', 'S BAND', 'CM_LEFT', 'CDR AUDIO', 'Audio de la banda S (comandante)'),
  T3('CM.AUDIO.CDR_VHF', 'T_R', 'OFF', 'RCV', 'T_R', 'VHF AM', 'CM_LEFT', 'CDR AUDIO', 'Audio VHF (comandante)'),
  T3('CM.AUDIO.CDR_INTERCOM', 'T_R', 'OFF', 'RCV', 'T_R', 'INTERCOM', 'CM_LEFT', 'CDR AUDIO', 'Intercomunicador (comandante)'),
  T3('CM.AUDIO.CDR_MODE', 'ICOM_PTT', 'PTT', 'VOX', 'PTT', 'MODE', 'CM_LEFT', 'CDR AUDIO', 'Modo de transmisión'),
  // right console — audio & ECS
  T3('CM.AUDIO.LMP_SBAND', 'T_R', 'OFF', 'RCV', 'T_R', 'S BAND', 'CM_RIGHT', 'LMP AUDIO', 'Audio de la banda S (piloto del LM)'),
  T3('CM.AUDIO.LMP_VHF', 'T_R', 'OFF', 'RCV', 'T_R', 'VHF AM', 'CM_RIGHT', 'LMP AUDIO', 'Audio VHF (piloto del LM)'),
  T3('CM.AUDIO.LMP_INTERCOM', 'T_R', 'OFF', 'RCV', 'T_R', 'INTERCOM', 'CM_RIGHT', 'LMP AUDIO', 'Intercomunicador (piloto del LM)'),
  T2('CM.ECS.CABIN_PRESS_REL', 'BOOST_ENTRY', 'NORMAL', 'BOOST_ENTRY', 'CABIN PRESS RELIEF', 'CM_RIGHT', 'ECS VALVES', 'Válvula de alivio de presión'),
  T2('CM.ECS.DIRECT_O2', 'OPEN', 'CLOSE', 'CLOSE', 'DIRECT O2', 'CM_RIGHT', 'ECS VALVES', 'Oxígeno directo a la cabina'),
  T3('CM.ECS.SUIT_CKT_RETURN', 'OPEN', 'AUTO', 'CLOSE', 'AUTO', 'SUIT CKT RETURN', 'CM_RIGHT', 'ECS VALVES', 'Retorno del circuito de trajes'),
  // LEB — G&N
  T2('CM.GN.IMU_PWR', 'ON', 'OFF', 'ON', 'IMU PWR', 'CM_LEB', 'G&N POWER', 'Alimentación de la plataforma inercial'),
  T2('CM.GN.CMC_PWR', 'ON', 'OFF', 'ON', 'COMPUTER PWR', 'CM_LEB', 'G&N POWER', 'Alimentación del ordenador de guiado'),
  T2('CM.GN.OPTICS_PWR', 'ON', 'OFF', 'ON', 'OPTICS PWR', 'CM_LEB', 'G&N POWER', 'Alimentación del sextante y el telescopio'),
  T2('CM.GN.COND_LAMPS', 'ON', 'OFF', 'ON', 'COND LAMPS', 'CM_LEB', 'G&N POWER', 'Luces de condición del G&N'),
  T3('CM.OPT.SPEED', 'HI', 'MED', 'LO', 'MED', 'OPTICS SPEED', 'CM_LEB', 'OPT', 'Velocidad de movimiento de las ópticas'),
  T2('CM.OPT.COUPLING', 'DIRECT', 'RESOLVED', 'RESOLVED', 'OPTICS COUPLING', 'CM_LEB', 'OPT', 'Acoplamiento del control óptico'),
  T2('CM.OPT.ZERO', 'ZERO', 'OFF', 'OFF', 'OPTICS ZERO', 'CM_LEB', 'OPT', 'Pone a cero las ópticas'),
  T3('CM.GN.SYS_TEST_L', '1', '2', '3', '1', 'SYS TEST L', 'CM_LEB', 'SYSTEMS TEST', 'Selector del medidor de pruebas'),
  T3('CM.GN.SYS_TEST_R', 'A', 'B', 'C', 'A', 'SYS TEST R', 'CM_LEB', 'SYSTEMS TEST', 'Selector del medidor de pruebas'),
];

const CB_GROUPS = {
  CM_LEFT: {
    SCS: ['SCS ELEC MNA', 'SCS ELEC MNB', 'SCS AC1', 'SCS AC2', 'ECA PITCH MNA', 'ECA PITCH MNB', 'ECA YAW MNA', 'ECA YAW MNB', 'ECA ROLL MNA', 'ECA ROLL MNB', 'BMAG 1', 'BMAG 2', 'GDC', 'FDAI 1', 'FDAI 2', 'RHC 1', 'RHC 2', 'THC'],
    SPS: ['PITCH 1', 'PITCH 2', 'YAW 1', 'YAW 2', 'PILOT VLV A', 'PILOT VLV B', 'GAUGING AC1', 'GAUGING AC2', 'TVC AC1', 'TVC AC2', 'He VLV 1', 'He VLV 2'],
    RCS: ['LOGIC MNA', 'LOGIC MNB', 'SM HTR A', 'SM HTR B', 'SM HTR C', 'SM HTR D', 'CM HTR', 'JET A1', 'JET B1', 'JET C1', 'JET D1', 'TRNFR'],
    'ELS / SEQ': ['ELS A', 'ELS B', 'SECS LOGIC A', 'SECS LOGIC B', 'SECS ARM A', 'SECS ARM B', 'PYRO A', 'PYRO B', 'FLOAT BAG 1', 'FLOAT BAG 2', 'FLOAT BAG 3', 'EDS 1', 'EDS 2', 'EDS 3'],
    'LIGHTING CB': ['FLOOD 1', 'FLOOD 2', 'INTEGRAL MNA', 'INTEGRAL MNB', 'C/W LAMPS', 'MSN TIMER MNA', 'MSN TIMER MNB', 'EVENT TIMER'],
  },
  CM_RIGHT: {
    'EPS MAIN': ['FC 1 MNA', 'FC 1 MNB', 'FC 2 MNA', 'FC 2 MNB', 'FC 3 MNA', 'FC 3 MNB', 'BAT A ENTRY', 'BAT B ENTRY', 'BAT C ENTRY', 'BAT CHGR MNA', 'BAT CHGR MNB', 'BAT RLY BUS A', 'BAT RLY BUS B'],
    INVERTERS: ['INV 1 MNA', 'INV 2 MNB', 'INV 3 MNA', 'INV 3 MNB', 'AC1 PH A', 'AC1 PH B', 'AC1 PH C', 'AC2 PH A', 'AC2 PH B', 'AC2 PH C'],
    'CRYO CB': ['O2 FAN 1 AC1', 'O2 FAN 2 AC2', 'H2 FAN 1 AC1', 'H2 FAN 2 AC2', 'O2 HTR 1', 'O2 HTR 2', 'H2 HTR 1', 'H2 HTR 2', 'QTY AMPL 1', 'QTY AMPL 2'],
    'ECS CB': ['SUIT COMPR 1', 'SUIT COMPR 2', 'CABIN FAN 1', 'CABIN FAN 2', 'GLY PUMP 1', 'GLY PUMP 2', 'RAD MNA', 'RAD MNB', 'WASTE H2O', 'POT H2O HTR'],
    'COMM CB': ['PWR AMPL 1', 'PWR AMPL 2', 'HGA', 'VHF AM A', 'VHF AM B', 'BEACON', 'PCM', 'DSE', 'TV CAMERA', 'AUDIO CDR', 'AUDIO LMP', 'C-BAND'],
  },
  CM_LEB: {
    'G&N CB': ['IMU MNA', 'IMU MNB', 'IMU HTR MNA', 'IMU HTR MNB', 'COMPUTER MNA', 'COMPUTER MNB', 'OPTICS MNA', 'OPTICS MNB', 'PWR SERVO AMPL', 'DSKY 1', 'DSKY 2'],
    'INSTRUMENTS': ['SIG COND MNA', 'SIG COND MNB', 'C/W MNA', 'C/W MNB', 'ESS INST MNA', 'ESS INST MNB', 'NONESS INST', 'SCE MNA', 'SCE MNB'],
  },
};

for (const [panel, groups] of Object.entries(CB_GROUPS)) {
  for (const [group, labels] of Object.entries(groups)) {
    for (const l of labels) CM_EXTRA_SWITCHES.push(CB(`${group.replace(/[^A-Z0-9]+/g, '_')}_${l.replace(/[^A-Z0-9]+/g, '_')}`, l, panel, group));
  }
}
