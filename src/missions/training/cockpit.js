// Training — Cockpit tour. The Command Module simulator in Houston, parked in Earth orbit: the
// instructor points out each kind of control and the trainee operates it (alarm, FDAI, timers,
// guarded switches, breakers, rotaries, lighting, the DSKY), with no clock running against them.

import { GET } from '../../core/MissionClock.js';
import { DEG } from '../../core/constants.js';
import { radio } from '../common/kit.js';

export default {
  setup: {
    get: GET(10, 0),
    config: 'CSM',
    state: 'EARTH_PARKING_ORBIT',
    station: 'CM',
    seat: 'CDR',
    csm: 'EARTH_ORBIT',
    lm: null,
    maxWarp: 1,
  },
  speakers: { CAPCOM: 'Instructor' },
  briefing: {
    summary:
      'Simulador del módulo de mando, Centro de Naves Tripuladas de Houston. Más de 500 interruptores, 71 luces y 24 instrumentos. ' +
      'El instructor te enseña a usar cada tipo de control. Sin prisa: aquí no hay reloj.',
    objectives: ['Alarma maestra', 'FDAI y controles de actitud', 'Interruptores con tapa y disyuntores', 'Selectores giratorios, luces y DSKY'],
    tips: ['Clic: mover un interruptor · clic derecho: abrir o cerrar su tapa', 'La rueda del ratón gira los selectores', 'El control a usar se resalta en amarillo'],
  },
  async run(ctx) {
    const v = ctx.vehicle;
    const csm = ctx.csm;
    ctx.caption('RECORRIDO POR LA CABINA', 'Simulador del módulo de mando', 6);
    await ctx.say('CAPCOM', 'Welcome to the command module simulator. Let us start with the most important light in the spacecraft.', 'Bienvenido al simulador del módulo de mando. Empecemos por la luz más importante de la nave.');
    csm.caution('CRYO_PRESS');
    let turned = 0;
    ctx.every(0.25, () => (turned += v.state.w.length() * 0.25));
    const steps = [
      { title: 'ALARMA MAESTRA', say: 'Cuando algo falla suena el tono y se enciende MASTER ALARM. Púlsalo para apagar la alarma; la luz de precaución queda encendida para que veas qué pasó.', item: { text: 'MASTER ALARM — pulsar', sw: { id: 'CM.CW.MASTER_ALARM_1', pos: 'PUSHED' }, check: (c) => !c.tm['CM.CW.MASTER_ALARM'] } },
      { title: 'FDAI', say: 'La «bola ocho» (FDAI) muestra la actitud de la nave. Gira con W/S (cabeceo), A/D (guiñada) y Q/E (alabeo) y mira cómo se mueve.', item: { text: 'Girar la nave más de 20°', check: () => turned > 20 * DEG, do: () => (turned = 1) } },
      { title: 'RELOJ DE EVENTOS', say: 'El reloj de eventos sirve para contar los segundos de un encendido. Ponlo en marcha.', item: { text: 'EVENT TIMER — START', sw: { id: 'CM.MT.EVENT_TIMER', pos: 'START' } } },
      { title: 'INTERRUPTORES CON TAPA', say: 'Los interruptores peligrosos tienen una tapa roja. Clic derecho para abrirla, clic para mover el interruptor. Prueba con el ΔV THRUST A: ponlo en NORMAL y luego vuelve a OFF.', item: [{ text: 'ΔV THRUST A — NORMAL (abrir la tapa)', sw: { id: 'CM.SPS.DV_THRUST_A', pos: 'NORMAL' } }, { text: 'ΔV THRUST A — OFF (y cerrar la tapa)', sw: { id: 'CM.SPS.DV_THRUST_A', pos: 'OFF' } }] },
      { title: 'DISYUNTORES', say: 'Los disyuntores protegen los circuitos. Se sacan tirando y se meten empujando. Saca y vuelve a meter el de la batería A al bus principal A.', item: [{ text: 'MAIN A – BAT A — OUT', sw: { id: 'CM.CB.MAIN_A_BAT_A', pos: 'OUT' } }, { text: 'MAIN A – BAT A — IN', sw: { id: 'CM.CB.MAIN_A_BAT_A', pos: 'IN' } }] },
      { title: 'SELECTORES GIRATORIOS', say: 'Los selectores giratorios se mueven con la rueda del ratón o con clic. Pon el EMS FUNCTION en ENTRY y luego en OFF.', item: [{ text: 'EMS FUNCTION — ENTRY', sw: { id: 'CM.GNC.EMS_FUNC', pos: 'ENTRY' } }, { text: 'EMS FUNCTION — OFF', sw: { id: 'CM.GNC.EMS_FUNC', pos: 'OFF' } }] },
      { title: 'LUCES', say: 'Las luces de la cabina están en la consola izquierda. Ponlas al máximo.', item: { text: 'FLOOD — BRIGHT', sw: { id: 'CM.LTG.FLOOD', pos: 'BRIGHT' } } },
      { title: 'DSKY', say: 'El DSKY es el teclado del ordenador de guiado. Verbo 35 prueba todas sus luces: teclea VERB 3 5 ENTR.', item: { text: 'DSKY: V35 E (prueba de luces)', check: (c) => (c.gnc.cmc.dsky._lampTest ?? 0) > 0, do: (c) => (c.gnc.cmc.dsky._lampTest = 5) } },
    ];
    let n = 0;
    for (const s of steps) {
      await ctx.say('CAPCOM', s.say, s.say);
      const r = await ctx.crew({ id: `tr.cockpit.${n}`, title: s.title, items: [].concat(s.item), aiPace: [2, 4] });
      ctx.score(`step${n}`, r.autoUsed ? 5 : 15, 15, s.title.toLowerCase());
      n++;
    }
    csm._clear?.('CRYO_PRESS');
    radio(ctx, 'CAPCOM', 'That is the cockpit. You are ready for the DSKY course.', 'Esa es la cabina. Ya estás listo para el curso del DSKY.');
    ctx.achievement('tr-cockpit');
    ctx.complete({ summary: 'Recorrido completo: alarmas, actitud, temporizadores, tapas, disyuntores, selectores, luces y el DSKY.', stats: { Pasos: steps.length } });
  },
};
