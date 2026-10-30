// Onboard procedures ("the checklist book"): crew checklists per flight phase, condensed from the
// Apollo CSM/LM checklists and flight plans. Items use the MissionRunner checklist format, so the
// same data drives mission chapters (ctx.crew) and the free-flight procedure tracker:
//   { text, sw?: {id, pos} | [...], check?: (ctx) => bool, hint?, optional?, manual? }
// ctx (tracker / runner): { sim, vehicle, sw, tm, gnc, dyn, csm, lm, saturn }.

const sw = (id, pos) => ({ id, pos });
const prog = (agc, p) => (ctx) => ctx.gnc?.[agc]?.program === p;
// AI crew / "do it for me": key the program on the DSKY
const run = (agc, p) => (ctx) => ctx.gnc?.[agc]?.runProgram(p);

export const PROCEDURES = [
  // ------------------------------------------------------------------ launch
  {
    id: 'prelaunch',
    phase: 'Lanzamiento',
    station: 'CM',
    title: 'Configuración final de lanzamiento',
    when: (c) => c.dyn?.mode === 'PAD',
    items: [
      { text: 'EDS AUTO — AUTO', sw: sw('CM.LV.EDS_AUTO', 'AUTO'), hint: 'Detección automática de emergencias del Saturn V' },
      { text: '2 ENG OUT AUTO — AUTO', sw: sw('CM.LV.TWO_ENG_OUT_AUTO', 'AUTO') },
      { text: 'LV RATES AUTO — AUTO', sw: sw('CM.LV.LV_RATES_AUTO', 'AUTO') },
      { text: 'CMC — ON · IMU — ON', sw: [sw('CM.GN.CMC_PWR', 'ON'), sw('CM.GN.IMU_PWR', 'ON')], hint: 'Bahía inferior de equipos' },
      { text: 'SC CONT — CMC', sw: sw('CM.GNC.SC_CONT', 'CMC') },
      { text: 'CMC MODE — AUTO', sw: sw('CM.GNC.CMC_MODE', 'AUTO'), hint: 'Panel 1, sección de control de vuelo' },
      { text: 'FDAI SOURCE — CMC', sw: sw('CM.GNC.FDAI_SOURCE', 'CMC') },
      { text: 'SUIT COMPRESSOR 2 — AC2', sw: sw('CM.ECS.SUIT_COMPR_2', 'AC2') },
      { text: 'SECS ARM A y B — ARM', sw: [sw('CM.SEQ.SECS_ARM_A', 'ARM'), sw('CM.SEQ.SECS_ARM_B', 'ARM')], hint: 'Consola izquierda: arma la pirotecnia de separación' },
      { text: 'EMS MODE — NORMAL', sw: sw('CM.GNC.EMS_MODE', 'NORMAL') },
    ],
  },
  {
    id: 'ascent',
    phase: 'Lanzamiento',
    station: 'CM',
    title: 'Ascenso: vigilancia y torre de escape',
    when: (c) => c.dyn?.mode === 'ASCENT',
    items: [
      { text: 'Despegue: luz LIFTOFF, reloj en marcha', check: (c) => c.vehicle.state.liftoff },
      { text: 'Programa de alabeo y cabeceo (T+12 s)', check: (c) => c.sim.clock.get > 13 },
      { text: 'Máxima presión dinámica (≈T+1:22)', check: (c) => c.sim.clock.get > 83 },
      { text: 'Separación S-IC / ignición S-II', check: (c) => ['SII', 'SIVB', 'SIVB_COAST'].includes(c.saturn?.stage) || c.saturn?.variant === 'IB' && c.saturn?.stage !== 'SIB' },
      { text: 'TWR JETT 1 — FIRE (abrir la tapa con clic derecho)', sw: sw('CM.LV.TWR_JETT_1', 'FIRE'), check: (c) => !c.vehicle.parts.les, hint: '≈30 s después de encender el S-II. Panel 2' },
      { text: 'Ignición del S-IVB', check: (c) => ['SIVB', 'SIVB_COAST'].includes(c.saturn?.stage) },
      { text: 'Apagado del S-IVB: inserción en órbita', check: (c) => c.saturn?.stage === 'SIVB_COAST' },
    ],
  },
  {
    id: 'postinsertion',
    phase: 'Órbita terrestre',
    station: 'CM',
    title: 'Después de la inserción en órbita',
    when: (c) => c.saturn?.stage === 'SIVB_COAST' && c.vehicle.state.primary === 'EARTH',
    items: [
      { text: 'EDS AUTO — OFF', sw: sw('CM.LV.EDS_AUTO', 'OFF') },
      { text: '2 ENG OUT AUTO — OFF', sw: sw('CM.LV.TWO_ENG_OUT_AUTO', 'OFF') },
      { text: 'LV RATES AUTO — OFF', sw: sw('CM.LV.LV_RATES_AUTO', 'OFF') },
      { text: 'SECS ARM A y B — OFF', sw: [sw('CM.SEQ.SECS_ARM_A', 'OFF'), sw('CM.SEQ.SECS_ARM_B', 'OFF')] },
      { text: 'Verificar órbita (apogeo/perigeo en el HUD)', manual: true },
    ],
  },
  {
    id: 'tli',
    phase: 'Órbita terrestre',
    station: 'CM',
    title: 'Inyección translunar (TLI)',
    when: (c) => c.saturn?.stage === 'SIVB_COAST' || c.saturn?.stage === 'SIVB_TLI',
    items: [
      { text: 'Pedir a Houston el PAD de TLI (botón «Houston»)', check: (c) => c.saturn?.tb6 !== null && c.saturn?.tb6 !== undefined || c.saturn?.stage === 'SIVB_TLI', manual: false },
      { text: 'XLUNAR — INJECT (SAFE cancela el reencendido)', sw: sw('CM.LV.XLUNAR', 'INJECT') },
      { text: 'DSKY: V37 E 15 E (P15, monitor de TLI)', check: prog('cmc', '15'), do: run('cmc', '15'), hint: 'Teclas V 3 7 Intro 1 5 Intro' },
      { text: 'Reencendido del J-2 (TB6 + 9 min 38 s)', check: (c) => c.saturn?.stage === 'SIVB_TLI' || c.saturn?.done?.has('TLI_CUTOFF') },
      { text: 'Apagado: rumbo a la Luna', check: (c) => c.saturn?.done?.has('TLI_CUTOFF') },
    ],
  },
  {
    id: 'tde',
    phase: 'Translunar',
    station: 'CM',
    title: 'Transposición, acoplamiento y extracción',
    when: (c) => ['SIVB_STACK', 'CSM', 'CSM_LM_SIVB'].includes(c.vehicle.config) && c.vehicle.state.primary === 'EARTH',
    items: [
      { text: 'SECS ARM A y B — ARM', sw: [sw('CM.SEQ.SECS_ARM_A', 'ARM'), sw('CM.SEQ.SECS_ARM_B', 'ARM')] },
      { text: 'CSM/LV SEP — SEP (con tapa)', sw: sw('CM.LV.CSM_LV_SEP', 'SEP'), check: (c) => c.vehicle.config !== 'SIVB_STACK' },
      { text: 'Alejarse 15 m con traslación +X (I) y frenar (K)', manual: true },
      { text: 'Girar 180° en cabeceo (S/W) hasta ver el LM', manual: true },
      { text: 'DOCK PROBE — EXTEND', sw: sw('CM.DOCK.PROBE', 'EXTEND'), check: (c) => c.vehicle.config !== 'CSM' || c.sw.get('CM.DOCK.PROBE') === 'EXTEND' },
      { text: 'Aproximación a 0,1–0,3 m/s alineado con el COAS', check: (c) => c.vehicle.config === 'CSM_LM_SIVB' || c.dyn?._captured },
      { text: 'DOCK PROBE — RETRACT (cerrojos firmes)', check: (c) => c.vehicle.config === 'CSM_LM_SIVB' || c.vehicle.config === 'CSM_LM' },
      { text: 'S-IVB/LM SEP — SEP: extraer el LM', sw: sw('CM.LV.SIVB_LM_SEP', 'SEP'), check: (c) => c.vehicle.config === 'CSM_LM' },
    ],
  },
  // ------------------------------------------------------------------ SPS burns
  {
    id: 'sps',
    phase: 'Maniobras',
    station: 'CM',
    title: 'Encendido del SPS con el ordenador (P30 / P40)',
    when: (c) => c.vehicle.station === 'CM' && c.csm?.hasSM,
    items: [
      { text: 'Cargar el PAD de Houston (P30)', check: (c) => !!c.gnc?.cmc?.burn && !c.gnc.cmc.burn.done },
      { text: 'SC CONT — CMC · CMC MODE — AUTO', sw: [sw('CM.GNC.SC_CONT', 'CMC'), sw('CM.GNC.CMC_MODE', 'AUTO')] },
      { text: 'GMBL MOTORS PITCH 1 — START → ON', sw: sw('CM.SPS.GMBL_P1', 'ON'), hint: 'Subir a START (resorte) y dejar en ON' },
      { text: 'GMBL MOTORS YAW 1 — START → ON', sw: sw('CM.SPS.GMBL_Y1', 'ON') },
      { text: 'GMBL MOTORS PITCH 2 — START → ON', sw: sw('CM.SPS.GMBL_P2', 'ON') },
      { text: 'GMBL MOTORS YAW 2 — START → ON', sw: sw('CM.SPS.GMBL_Y2', 'ON') },
      { text: 'ΔV THRUST A — NORMAL (con tapa)', sw: sw('CM.SPS.DV_THRUST_A', 'NORMAL') },
      { text: 'ΔV THRUST B — NORMAL (con tapa)', sw: sw('CM.SPS.DV_THRUST_B', 'NORMAL') },
      { text: 'DSKY: V37 E 40 E (P40)', check: prog('cmc', '40'), do: run('cmc', '40'), hint: 'La nave gira sola a la actitud de encendido' },
      { text: 'A TIG−5 s, V99 parpadea: pulsar PRO', check: (c) => !!c.gnc?.cmc?.burn?.armed, do: (c) => c.gnc?.cmc?.onProceed(), hint: 'Tecla P con el ratón sobre el DSKY' },
      { text: 'Encendido y apagado automático (Vg → 0)', check: (c) => !!c.gnc?.cmc?.burn?.done },
      { text: 'ΔV THRUST A y B — OFF · GMBL MOTORS — OFF', sw: [sw('CM.SPS.DV_THRUST_A', 'OFF'), sw('CM.SPS.DV_THRUST_B', 'OFF'), sw('CM.SPS.GMBL_P1', 'OFF'), sw('CM.SPS.GMBL_Y1', 'OFF'), sw('CM.SPS.GMBL_P2', 'OFF'), sw('CM.SPS.GMBL_Y2', 'OFF')] },
    ],
  },
  {
    id: 'spsManual',
    phase: 'Maniobras',
    station: 'CM',
    title: 'Encendido manual del SPS (SCS)',
    when: (c) => c.vehicle.station === 'CM' && c.csm?.hasSM,
    items: [
      { text: 'Apuntar la nave a mano (FDAI) en la dirección del encendido', manual: true },
      { text: 'GMBL MOTORS (4) — ON', sw: [sw('CM.SPS.GMBL_P1', 'ON'), sw('CM.SPS.GMBL_Y1', 'ON'), sw('CM.SPS.GMBL_P2', 'ON'), sw('CM.SPS.GMBL_Y2', 'ON')] },
      { text: 'ΔV THRUST A y B — NORMAL', sw: [sw('CM.SPS.DV_THRUST_A', 'NORMAL'), sw('CM.SPS.DV_THRUST_B', 'NORMAL')] },
      { text: 'DIRECT ULLAGE — mantener 3 s (asienta el propelente)', manual: true },
      { text: 'THRUST ON — pulsar', check: (c) => !!c.tm['CM.SPS.THRUST'] || c.csm?.manualSps },
      { text: 'Para apagar: ΔV THRUST A y B — OFF', sw: [sw('CM.SPS.DV_THRUST_A', 'OFF'), sw('CM.SPS.DV_THRUST_B', 'OFF')] },
    ],
  },
  // ------------------------------------------------------------------ entry
  {
    id: 'entry',
    phase: 'Reentrada',
    station: 'CM',
    title: 'Separación CM/SM y reentrada',
    when: (c) => c.vehicle.state.primary === 'EARTH' && (c.csm?.hasSM === false || c.vehicle.state.alt < 2e6),
    items: [
      { text: 'SECS ARM A y B — ARM', sw: [sw('CM.SEQ.SECS_ARM_A', 'ARM'), sw('CM.SEQ.SECS_ARM_B', 'ARM')] },
      { text: 'CM/SM SEP 1 — SEP (con tapa)', sw: sw('CM.SEQ.CM_SM_SEP_1', 'SEP'), check: (c) => c.vehicle.config === 'CM' },
      { text: 'Orientar con el escudo térmico hacia adelante', manual: true },
      { text: 'EMS MODE — AUTO · EMS FUNCTION — ENTRY', sw: [sw('CM.GNC.EMS_MODE', 'AUTO'), sw('CM.GNC.EMS_FUNC', 'ENTRY')] },
      { text: 'ELS LOGIC — ON (con tapa) · ELS AUTO — AUTO', sw: [sw('CM.SEQ.ELS_LOGIC', 'ON'), sw('CM.SEQ.ELS_AUTO', 'AUTO')] },
      { text: 'Interfaz de reentrada (400.000 ft)', check: (c) => c.dyn?.mode === 'ENTRY' || c.vehicle.state.alt < 121920 },
      { text: 'Estabilizadores a 24.000 ft', check: (c) => c.vehicle.parts.drogues || c.vehicle.parts.mains },
      { text: 'Principales a 10.000 ft', check: (c) => c.vehicle.parts.mains },
      { text: 'Amerizaje', check: (c) => c.vehicle.state.splashed },
    ],
  },
  // ------------------------------------------------------------------ LM
  {
    id: 'pdi',
    phase: 'Alunizaje',
    station: 'LM',
    title: 'Preparación del descenso motorizado (P63)',
    when: (c) => c.vehicle.station === 'LM' && !c.vehicle.state.landed,
    items: [
      { text: 'ENG ARM — DES', sw: sw('LM.ENG.ENG_ARM', 'DES'), hint: 'Panel 1' },
      { text: 'GUID CONT — PGNS · MODE CONTROL PGNS — AUTO', sw: [sw('LM.GNC.GUID_CONT', 'PGNS'), sw('LM.GNC.MODE_CONTROL_PGNS', 'AUTO')] },
      { text: 'THR CONT — AUTO', sw: sw('LM.GNC.THR_CONT', 'AUTO') },
      { text: 'RNDZ RADAR — LGC (evita las alarmas 1202)', sw: sw('LM.RADAR.RR_MODE', 'LGC'), hint: 'En el Apolo 11 estaba en AUTO TRACK: robaba ciclos al ordenador' },
      { text: 'LDG ANT — AUTO', sw: sw('LM.RADAR.LDG_ANT', 'AUTO') },
      { text: 'DSKY: V37 E 63 E (P63, frenado)', check: prog('lgc', '63'), do: run('lgc', '63'), hint: 'Houston también puede iniciarlo' },
      { text: 'Ignición del DPS al 10 % y luego al 92,5 %', check: (c) => !!c.tm['LM.DPS.FIRING'] },
    ],
  },
  {
    id: 'landing',
    phase: 'Alunizaje',
    station: 'LM',
    title: 'Aproximación y aterrizaje (P64 / P66)',
    when: (c) => c.vehicle.station === 'LM' && !c.vehicle.state.landed,
    items: [
      { text: 'P64 a ~7.000 ft: la nave se endereza, se ve el terreno', check: (c) => ['64', '66'].includes(c.gnc?.lgc?.program) },
      { text: 'Redesignar con las flechas si el punto tiene rocas', manual: true, optional: true },
      { text: 'P66 por debajo de 150 ft: Inicio/Fin = ±1 ft/s de descenso', check: prog('lgc', '66') },
      { text: 'Anular la velocidad horizontal (cruz centrada)', manual: true },
      { text: 'LUZ DE CONTACTO', check: (c) => !!c.tm['LM.GNC.CONTACT_LIGHT'] },
      { text: 'ENGINE STOP — PUSHED', sw: sw('LM.ENG.STOP_CDR', 'PUSHED'), check: (c) => c.vehicle.state.landed },
    ],
  },
  {
    id: 'liftoff',
    phase: 'Superficie lunar',
    station: 'LM',
    title: 'Despegue lunar (P12)',
    when: (c) => c.vehicle.station === 'LM' && c.vehicle.state.landed,
    items: [
      { text: 'Verificar el disyuntor ENG ARM (panel 16) — IN', sw: sw('LM.CB.ENG_ARM', 'IN'), hint: 'En el Apolo 11 Aldrin lo empujó con un bolígrafo' },
      { text: 'MASTER ARM — ON', sw: sw('LM.EXP.MASTER_ARM', 'ON'), hint: 'Panel 8' },
      { text: 'ENG ARM — ASC', sw: sw('LM.ENG.ENG_ARM', 'ASC') },
      { text: 'MODE CONTROL PGNS — AUTO', sw: sw('LM.GNC.MODE_CONTROL_PGNS', 'AUTO') },
      { text: 'DSKY: V37 E 12 E (P12, ascenso)', check: prog('lgc', '12'), do: run('lgc', '12') },
      { text: 'STAGE — FIRE (separar la etapa de descenso)', sw: sw('LM.EXP.STAGE', 'FIRE'), check: (c) => c.vehicle.config === 'LM_ASC' },
      { text: 'Despegue: el APS empuja 15,6 kN', check: (c) => !c.vehicle.state.landed },
    ],
  },
];

// ------------------------------------------------------------------ LM activation, DPS burns, undocking

PROCEDURES.push(
  {
    id: 'lmActivation',
    phase: 'Módulo lunar',
    station: 'LM',
    title: 'Activación del módulo lunar',
    when: (c) => c.vehicle.station === 'LM' && !c.vehicle.state.landed,
    items: [
      { text: 'DES BAT 1 HV — ON', sw: sw('LM.EPS.DES_BAT_1_HV', 'ON'), hint: 'Panel 14, a la derecha del LMP' },
      { text: 'DES BAT 2 HV — ON', sw: sw('LM.EPS.DES_BAT_2_HV', 'ON') },
      { text: 'DES BAT 3 HV — ON', sw: sw('LM.EPS.DES_BAT_3_HV', 'ON') },
      { text: 'DES BAT 4 HV — ON', sw: sw('LM.EPS.DES_BAT_4_HV', 'ON') },
      { text: 'Bus del CDR por encima de 27 V', check: (c) => (c.tm['LM.EPS.CDR_BUS.V'] ?? 0) > 27 },
      { text: 'INVERTER — 1 (bus de corriente alterna)', sw: sw('LM.EPS.INV', '1') },
      { text: 'LGC en marcha: DSKY V35 E (prueba de luces)', check: (c) => !!c.gnc?.lgc?.powered && (c.gnc.lgc.dsky._lampTest ?? 0) > 0, do: (c) => { if (c.gnc?.lgc) c.gnc.lgc.dsky._lampTest = 5; }, hint: 'Teclas VERB 3 5 ENTR' },
      { text: 'AGS: ASA — ON · AEA — ON', sw: [sw('LM.AGS.ASA_PWR', 'ON'), sw('LM.AGS.AEA_PWR', 'ON')], hint: 'Panel 6: guía de aborto' },
      { text: 'RNDZ RADAR — LGC', sw: sw('LM.RADAR.RR_MODE', 'LGC') },
      { text: 'ED LOGIC PWR A y B — ON', sw: [sw('LM.EXP.ED_LOGIC_A', 'ON'), sw('LM.EXP.ED_LOGIC_B', 'ON')], hint: 'Panel 8: pirotecnia (tren, separación de etapas)' },
    ],
  },
  {
    id: 'dps',
    phase: 'Maniobras',
    station: 'LM',
    title: 'Encendido del DPS con el LGC (P40)',
    when: (c) => c.vehicle.station === 'LM' && !c.vehicle.state.landed && c.vehicle.config !== 'LM_ASC',
    items: [
      { text: 'Cargar el PAD de Houston (P30)', check: (c) => !!c.gnc?.lgc?.burn && !c.gnc.lgc.burn.done },
      { text: 'ENG ARM — DES', sw: sw('LM.ENG.ENG_ARM', 'DES'), hint: 'Panel 1' },
      { text: 'GUID CONT — PGNS', sw: sw('LM.GNC.GUID_CONT', 'PGNS') },
      { text: 'MODE CONTROL PGNS — AUTO', sw: sw('LM.GNC.MODE_CONTROL_PGNS', 'AUTO'), hint: 'Panel 3' },
      { text: 'THR CONT — AUTO', sw: sw('LM.GNC.THR_CONT', 'AUTO') },
      { text: 'DSKY: V37 E 40 E (P40)', check: prog('lgc', '40'), do: run('lgc', '40'), hint: 'La nave gira sola a la actitud del encendido' },
      { text: 'A TIG−5 s, V99 parpadea: pulsar PRO', check: (c) => !!c.gnc?.lgc?.burn?.armed, do: (c) => c.gnc?.lgc?.onProceed() },
      { text: 'Encendido: 10 % durante 5 s y luego empuje del PAD', check: (c) => !!c.gnc?.lgc?.burn?.firing || !!c.gnc?.lgc?.burn?.done },
      { text: 'Apagado automático (Vg → 0)', check: (c) => !!c.gnc?.lgc?.burn?.done },
      { text: 'ENG ARM — OFF', sw: sw('LM.ENG.ENG_ARM', 'OFF') },
    ],
  },
  {
    id: 'dpsManual',
    phase: 'Maniobras',
    station: 'LM',
    title: 'Encendido manual del DPS (sin ordenador)',
    when: (c) => c.vehicle.station === 'LM' && !c.vehicle.state.landed && c.vehicle.config !== 'LM_ASC',
    items: [
      { text: 'Orientar la nave a mano (ACA) con la referencia visual', manual: true },
      { text: 'ENG ARM — DES', sw: sw('LM.ENG.ENG_ARM', 'DES') },
      { text: 'THR CONT — MAN (TTCA al mínimo: 10 %)', sw: sw('LM.GNC.THR_CONT', 'MAN') },
      { text: 'EVENT TIMER — RESET y START', sw: sw('LM.MT.EVENT_TIMER', 'START') },
      { text: 'ENG START — pulsar', check: (c) => !!c.tm['LM.DPS.FIRING'] },
      { text: 'Al tiempo del PAD: ENG STOP', sw: sw('LM.ENG.STOP_CDR', 'PUSHED') },
      { text: 'ENG ARM — OFF', sw: sw('LM.ENG.ENG_ARM', 'OFF') },
    ],
  },
  {
    id: 'undock',
    phase: 'Órbita lunar',
    station: 'LM',
    title: 'Desacoplamiento y separación',
    when: (c) => c.vehicle.config === 'CSM_LM' || (c.vehicle.config === 'LM' && c.vehicle.state.primary === 'MOON' && !c.vehicle.state.landed),
    items: [
      { text: 'Tren de aterrizaje desplegado', check: (c) => !!c.vehicle.parts.lmGearDeployed },
      { text: 'MODE CONTROL PGNS — ATT HOLD', sw: sw('LM.GNC.MODE_CONTROL_PGNS', 'ATT_HOLD') },
      { text: 'Desacoplar (Columbia suelta los cerrojos)', check: (c) => c.vehicle.config === 'LM' },
      { text: 'Giro de inspección: guiñada lenta de 360° (A/D)', manual: true },
      { text: 'Separación: el CSM se aleja 2,5 ft/s', check: (c) => (c.dyn?.dockingTelemetry?.()?.range ?? 0) > 40 },
    ],
  },
  {
    id: 'docking',
    phase: 'Encuentro',
    title: 'Acoplamiento (frenado y alineación)',
    when: (c) => ['CSM', 'LM_ASC'].includes(c.vehicle.config) && c.dyn?.bodies?.size > 0,
    items: [
      { text: 'Apuntar al blanco: cruz del COAS centrada', manual: true },
      { text: 'Acercarse por debajo de 0,3 m/s (I / K)', check: (c) => { const t = c.dyn?.dockingTelemetry?.(); return !!t && t.range < 20 && -t.rangeRate < 0.35; } },
      { text: 'Anular la deriva lateral (J / L, U / O)', check: (c) => { const t = c.dyn?.dockingTelemetry?.(); return !!t && t.range < 8 && Math.hypot(t.lateral.y, t.lateral.z) < 0.35; } },
      { text: 'Captura', check: (c) => !!c.dyn?._captured || c.vehicle.config.startsWith('CSM_') },
      { text: 'Acoplamiento firme', check: (c) => c.vehicle.config.startsWith('CSM_') },
    ],
  },
);

// ------------------------------------------------------------------ Apollo 13 / Apollo 12 emergencies

PROCEDURES.push(
  {
    id: 'cmPowerDown',
    phase: 'Emergencia',
    station: 'CM',
    title: 'Apagado del Odyssey (CM)',
    when: (c) => c.vehicle.station === 'CM' && !!c.csm?.exploded,
    items: [
      { text: 'FC 1 REAC — CLOSE · FC 3 REAC — CLOSE', sw: [sw('CM.EPS.FC1_REAC', 'CLOSE'), sw('CM.EPS.FC3_REAC', 'CLOSE')], hint: 'Panel 3: es irreversible' },
      { text: 'Transferir la plataforma: anotar los ángulos del IMU (V16 N20)', manual: true },
      { text: 'CMC — OFF', sw: sw('CM.GN.CMC_PWR', 'OFF'), hint: 'Bahía inferior de equipos' },
      { text: 'IMU — OFF', sw: sw('CM.GN.IMU_PWR', 'OFF') },
      { text: 'OPTICS — OFF', sw: sw('CM.GN.OPTICS_PWR', 'OFF') },
      { text: 'FC 2 REAC — CLOSE', sw: sw('CM.EPS.FC2_REAC', 'CLOSE') },
      { text: 'SUIT COMPRESSOR 1 y 2 — OFF', sw: [sw('CM.ECS.SUIT_COMPR_1', 'OFF'), sw('CM.ECS.SUIT_COMPR_2', 'OFF')] },
      { text: 'CABIN FAN 1 y 2 — OFF', sw: [sw('CM.ECS.CABIN_FAN_1', 'OFF'), sw('CM.ECS.CABIN_FAN_2', 'OFF')] },
      { text: 'INVERTER 1 y 2 — OFF', sw: [sw('CM.EPS.INV1_PWR', 'OFF'), sw('CM.EPS.INV2_PWR', 'OFF')] },
    ],
  },
  {
    id: 'cmPowerUp',
    phase: 'Emergencia',
    station: 'CM',
    title: 'Reactivación del CM con baterías (Mattingly)',
    when: (c) => c.vehicle.station === 'CM' && !!c.csm?.poweredDown,
    items: [
      { text: 'MAIN BUS TIE BAT A/C — ON', sw: sw('CM.EPS.MAIN_BUS_TIE_AC', 'ON'), hint: 'Panel 3: las baterías alimentan el bus principal A' },
      { text: 'MAIN BUS TIE BAT B/C — ON', sw: sw('CM.EPS.MAIN_BUS_TIE_BC', 'ON') },
      { text: 'Buses principales por encima de 27 V', check: (c) => (c.tm['CM.EPS.MNA.V'] ?? 0) > 27 && (c.tm['CM.EPS.MNB.V'] ?? 0) > 27 },
      { text: 'INVERTER 1 — MNA (sólo uno)', sw: sw('CM.EPS.INV1_PWR', 'MNA') },
      { text: 'CMC — ON', sw: sw('CM.GN.CMC_PWR', 'ON') },
      { text: 'IMU — ON', sw: sw('CM.GN.IMU_PWR', 'ON') },
      { text: 'SUIT COMPRESSOR 1 — AC1', sw: sw('CM.ECS.SUIT_COMPR_1', 'AC1') },
      { text: 'CM RCS PRESS — ON (con tapa)', sw: sw('CM.RCS.CM_RCS_PRESS', 'ON'), hint: 'Presuriza los propulsores del CM para la reentrada' },
      { text: 'RCS TRNFR — CM', sw: sw('CM.RCS.RCS_TRNFR', 'CM') },
      { text: 'Consumo total por debajo de 45 A', check: (c) => (c.csm?.powerBudget?.().total ?? 99) < 45 },
    ],
  },
  {
    id: 'lightning',
    phase: 'Emergencia',
    station: 'CM',
    title: 'Recuperación tras el rayo (Apolo 12)',
    when: (c) => !!c.csm?.lightning,
    items: [
      { text: 'SCE — AUX («SCE a auxiliar»)', sw: sw('CM.EPS.SCE_PWR', 'AUX'), hint: 'Panel 2, abajo a la izquierda: devuelve la telemetría a Houston' },
      { text: 'MAIN A FC 1 — ON (reconectar)', sw: sw('CM.EPS.MNA_FC1', 'ON'), hint: 'Panel 3' },
      { text: 'MAIN A FC 2 — ON', sw: sw('CM.EPS.MNA_FC2', 'ON') },
      { text: 'MAIN B FC 2 — ON', sw: sw('CM.EPS.MNB_FC2', 'ON') },
      { text: 'MAIN B FC 3 — ON', sw: sw('CM.EPS.MNB_FC3', 'ON') },
      { text: 'AC BUS 1 INV 1 — ON · AC BUS 2 INV 2 — ON', sw: [sw('CM.EPS.AC1_INV1', 'ON'), sw('CM.EPS.AC2_INV2', 'ON')] },
      { text: 'MASTER ALARM — pulsar', sw: sw('CM.CW.MASTER_ALARM_1', 'PUSHED') },
    ],
  },
);

export function proceduresFor(ctx) {
  return PROCEDURES.filter((p) => !p.station || p.station === ctx.vehicle.station);
}

export function procedureById(id) {
  return PROCEDURES.find((p) => p.id === id) ?? null;
}
