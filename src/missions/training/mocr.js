// Training — Tour of the Mission Operations Control Room (MOCR 2, Building 30, Houston). The
// Flight Director introduces each console and asks the new controller a question about its job.

import { GET } from '../../core/MissionClock.js';
import { radio } from '../common/kit.js';

const TOUR = [
  ['FLIGHT', 'El director de vuelo manda en la sala: todas las decisiones pasan por él.', '¿Quién tiene la última palabra sobre la misión en curso?', [['flight', 'El director de vuelo (FLIGHT)', true], ['capcom', 'El CAPCOM', false], ['crew', 'El comandante de la tripulación', false]]],
  ['CAPCOM', 'El CAPCOM es un astronauta y el único que habla con la tripulación.', '¿Por qué el CAPCOM siempre es un astronauta?', [['astro', 'Porque entiende la cabina y la tripulación confía en su voz', true], ['rank', 'Porque tiene más rango que FLIGHT', false], ['radio', 'Porque es el único con licencia de radio', false]]],
  ['BOOSTER', 'BOOSTER vigila el Saturn V durante el ascenso y la TLI.', '¿Cuándo trabaja más BOOSTER?', [['launch', 'En el lanzamiento y la inyección translunar', true], ['entry', 'En la reentrada', false], ['landing', 'En el alunizaje', false]]],
  ['FIDO', 'FIDO (Flight Dynamics Officer) calcula la trayectoria y las maniobras.', '¿Qué decide FIDO?', [['traj', 'Las maniobras y la trayectoria', true], ['food', 'El menú de la tripulación', false], ['comm', 'Las antenas de comunicación', false]]],
  ['RETRO', 'RETRO prepara las maniobras de regreso a la Tierra y los abortos.', '¿Qué maniobra es de RETRO?', [['tei', 'La inyección transterrestre (TEI)', true], ['tli', 'La TLI', false], ['dock', 'El acoplamiento', false]]],
  ['GUIDO', 'GUIDO vigila los ordenadores de guiado (CMC, LGC y AGS).', '¿Quién dijo «GO» con las alarmas 1202 del Apolo 11?', [['guido', 'GUIDO (Steve Bales)', true], ['eecom', 'EECOM', false], ['surgeon', 'SURGEON', false]]],
  ['EECOM', 'EECOM se ocupa de la electricidad, el ambiente y las comunicaciones del CSM.', '¿Qué consola diagnosticó la explosión del Apolo 13 y el rayo del Apolo 12?', [['eecom', 'EECOM', true], ['inco', 'INCO', false], ['booster', 'BOOSTER', false]]],
  ['GNC', 'GNC vigila los sistemas de guiado, navegación y control del CSM, incluido el SPS.', '¿Qué motor vigila GNC?', [['sps', 'El SPS del módulo de servicio', true], ['f1', 'Los F-1 del Saturn V', false], ['aps', 'El motor de ascenso del LM', false]]],
  ['TELMU', 'TELMU es el EECOM del módulo lunar.', '¿Qué nave vigila TELMU?', [['lm', 'El módulo lunar', true], ['csm', 'El módulo de mando', false], ['sivb', 'El S-IVB', false]]],
  ['SURGEON', 'El médico de vuelo sigue el pulso y la respiración de cada astronauta.', '¿Qué datos ve SURGEON?', [['bio', 'Pulso, respiración y electrocardiogramas', true], ['fuel', 'El combustible restante', false], ['alt', 'La altitud', false]]],
];

export default {
  setup: {
    get: GET(10, 0),
    config: 'CSM',
    state: 'EARTH_PARKING_ORBIT',
    station: 'CM',
    csm: 'EARTH_ORBIT',
    lm: null,
    maxWarp: 1,
  },
  briefing: {
    summary:
      'Edificio 30, Houston. La Sala de Control de Operaciones de la Misión: cuatro filas de consolas, pantallas gigantes y café frío. ' +
      'El director de vuelo te presenta cada puesto antes de tu primer turno.',
    objectives: ['Conocer las consolas del MOCR', 'Responder qué hace cada controlador'],
    tips: ['Las preguntas aparecen en la consola: elige con el ratón', 'Usa T para ver la nave por televisión'],
  },
  async run(ctx) {
    ctx.caption('CONTROL DE MISIÓN', 'Edificio 30 · Houston', 6);
    await ctx.say('FLIGHT', 'Welcome to the MOCR. Let me show you around before your first shift.', 'Bienvenido al MOCR. Te muestro la sala antes de tu primer turno.', { channel: 'loop' });
    let right = 0;
    for (const [console, intro, q, opts] of TOUR) {
      await ctx.say('FLIGHT', intro, intro, { channel: 'loop' });
      const res = await ctx.ground({
        id: `tr.mocr.${console}`,
        console,
        kind: 'report',
        title: console,
        prompt: q,
        options: opts.map(([id, label, correct]) => ({ id, label, correct })),
        timeout: 60,
        aiDelay: 1,
        score: { key: console, points: 10 },
      });
      if (res.correct) right++;
    }
    radio(ctx, 'FLIGHT', 'That is the room. Welcome to the team.', 'Esa es la sala. Bienvenido al equipo.', { channel: 'loop' });
    ctx.achievement('tr-mocr');
    ctx.complete({ summary: `Recorrido completo: ${right} de ${TOUR.length} respuestas correctas.`, stats: { Aciertos: `${right}/${TOUR.length}` } });
  },
};
