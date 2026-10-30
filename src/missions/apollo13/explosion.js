// Apollo 13 — "Houston, we've had a problem". GET 55:46, 330,000 km out: the TV show is over and
// Houston asks for a routine cryo stir. Sixteen seconds after the fans come on, the damaged wiring in
// O2 tank 2 ignites. Bang, master alarm, MAIN B undervolt, two fuel cells dead and oxygen venting.
// EECOM has to decide whether it is instrumentation or a real failure; the crew closes the
// reactant valves hoping to stop the leak.

import { Vector3 } from 'three';
import { GET } from '../../core/MissionClock.js';
import { apollo13State, basisQ } from '../common/states.js';
import { radio, grade } from '../common/kit.js';

export default {
  async setup() {
    const s = await apollo13State(GET(55, 50));
    const fwd = s.v.clone().normalize();
    return {
      get: s.get,
      config: 'CSM_LM',
      state: { r: s.r, v: s.v, q: basisQ(fwd, s.r.clone().normalize().negate()), w: new Vector3(0.0035, 0, 0), mode: 'SPACE' },
      station: 'CM',
      seat: 'CMP',
      csm: 'TLC',
      lm: 'STOWED',
      maxWarp: 10,
    };
  },
  briefing: {
    summary:
      '13 de abril de 1970, 21:07 en Houston. El Apolo 13 está a 330.000 km de la Tierra; la transmisión de televisión acaba de terminar y casi nadie la vio. ' +
      'Houston pide una tarea rutinaria: agitar los tanques criogénicos. Nadie sabe que el cableado del tanque de oxígeno 2 quedó dañado antes del vuelo.',
    objectives: ['Agitar los tanques criogénicos (ventiladores de O2 y H2)', 'Responder a la alarma maestra', 'Diagnosticar la falla', 'Cerrar las válvulas de reactivos de las pilas 1 y 3'],
    tips: ['Los ventiladores de los tanques están en el panel 2, sección CRYO', 'Mira los indicadores de presión de O2 y los de las pilas de combustible', 'MASTER ALARM apaga la alarma sonora'],
  },
  async run(ctx) {
    const v = ctx.vehicle;
    const csm = ctx.csm;
    csm.armA13();
    ctx.caption('HOUSTON, HEMOS TENIDO UN PROBLEMA', 'Apolo 13 · 13 de abril de 1970 · GET 55:50', 6);
    radio(ctx, 'PAO', 'This is Apollo Control at 55 hours 50 minutes. The television transmission has ended. Apollo 13 is 200,000 miles from Earth.', 'Aquí Control Apolo a las 55 horas 50 minutos. Terminó la transmisión de televisión. El Apolo 13 está a 320.000 km de la Tierra.');
    await ctx.wait(20);
    await ctx.say('CAPCOM', "13, we've got one more item for you, when you get a chance. We'd like you to stir up your cryo tanks.", 'Trece, tenemos una tarea más cuando puedan: queremos que agiten los tanques criogénicos.');
    radio(ctx, 'CMP', 'Okay. Stand by.', 'De acuerdo. Un momento.');

    // ---- the cryo stir
    const obj1 = ctx.objective('stir', 'Agita los tanques criogénicos');
    await ctx.crew({
      id: 'a13.stir',
      title: 'AGITAR LOS TANQUES CRIOGÉNICOS',
      items: [
        { text: 'H2 FANS 1 — ON', sw: { id: 'CM.CRYO.H2_FAN_1', pos: 'ON' }, hint: 'Panel 2, sección CRYO' },
        { text: 'H2 FANS 2 — ON', sw: { id: 'CM.CRYO.H2_FAN_2', pos: 'ON' } },
        { text: 'O2 FANS 1 — ON', sw: { id: 'CM.CRYO.O2_FAN_1', pos: 'ON' } },
        { text: 'O2 FANS 2 — ON', sw: { id: 'CM.CRYO.O2_FAN_2', pos: 'ON' } },
      ],
      aiPace: [3, 6],
    });
    obj1.done();
    await ctx.waitUntil(() => csm.exploded, { timeout: 60 });
    if (!csm.exploded) csm.trigger('O2_TANK2_EXPLOSION');
    const tBang = ctx.t;
    ctx.dropWarp();
    ctx.view?.shake?.(1.4, 1.2);
    ctx.view?.flash?.(0.15);
    await ctx.wait(3);
    await ctx.say('CMP', "Okay, Houston, we've had a problem here.", 'Bien, Houston, hemos tenido un problema aquí.', { clip: 'a13_houston_problem' });
    await ctx.say('CAPCOM', 'This is Houston. Say again, please.', 'Aquí Houston. Repitan, por favor.');
    await ctx.say('CDR', "Houston, we've had a problem. We've had a Main B Bus Undervolt.", 'Houston, hemos tenido un problema. Tenemos una subtensión en el bus principal B.');
    radio(ctx, 'CAPCOM', 'Roger. Main B undervolt.', 'Recibido. Subtensión en el bus principal B.');

    // ---- master alarm and a look at the panels
    const obj2 = ctx.objective('alarm', 'Responde a la alarma y revisa los paneles');
    const look = await ctx.crew({
      id: 'a13.look',
      title: 'QUÉ ESTÁ PASANDO',
      items: [
        { text: 'MASTER ALARM — pulsar', sw: { id: 'CM.CW.MASTER_ALARM_1', pos: 'PUSHED' }, check: (c) => !c.tm['CM.CW.MASTER_ALARM'] },
        { text: 'Presión de O2: tanque 2 a cero, tanque 1 bajando', manual: true, hint: 'Panel 2: indicadores CRYO O2 PRESS' },
        { text: 'Pilas de combustible: FC 1 y FC 3 sin flujo', manual: true, hint: 'Panel 3: banderas FC 1 / FC 3' },
      ],
      aiPace: [4, 8],
    });
    obj2.done();
    ctx.score('alarm', grade(look.time, 25, 120, 60), 60, 'Respuesta a la alarma');
    await ctx.say('CDR', 'And it looks to me, looking out the hatch, that we are venting something. We are venting something out into space.', 'Y por lo que veo desde la escotilla, estamos expulsando algo. Estamos expulsando algo al espacio.');
    radio(ctx, 'CAPCOM', 'Roger. We copy your venting.', 'Recibido. Copiamos que expulsan algo.');

    // ---- EECOM: instrumentation or real?
    const res = await ctx.ground({
      id: 'a13.eecom.diag',
      console: 'EECOM',
      kind: 'diagnose',
      title: '¿Instrumentación o falla real?',
      prompt: 'Tanque de O2 2: 0 psi y cantidad fuera de escala. Tanque 1: 880 psi y bajando. Pilas de combustible 1 y 3 sin reactivos. Bus B a 25 V. Hace un minuto todo estaba normal. ¿Qué le dices a FLIGHT?',
      options: [
        { id: 'real', label: 'Es real: perdimos dos pilas y un tanque de O2, y el otro tiene una fuga', correct: true, say: { who: 'EECOM', en: 'Flight, EECOM. We may have had an instrumentation problem, Flight... No. We have lost two fuel cells and O2 tank 2.', es: 'Flight, EECOM. Podría ser instrumentación… No. Perdimos dos pilas de combustible y el tanque de O2 número 2.', channel: 'loop' } },
        { id: 'instr', label: 'Probablemente sea un problema de instrumentación', correct: false, say: { who: 'FLIGHT', en: "Let's solve the problem, but let's not make it any worse by guessing.", es: 'Resolvamos el problema, pero no lo empeoremos adivinando.', channel: 'loop' } },
        { id: 'spike', label: 'Un pico eléctrico: reiniciar los buses y esperar', correct: false, say: { who: 'FLIGHT', en: 'EECOM, that does not explain the venting.', es: 'EECOM, eso no explica lo que están expulsando.', channel: 'loop' } },
      ],
      timeout: 60,
      aiDelay: 8,
      evidence: ['CM.CRYO.O2_2.P_PSI', 'CM.CRYO.O2_1.P_PSI', 'CM.EPS.FC1.ON_LINE', 'CM.EPS.FC3.ON_LINE'],
      score: { key: 'diag', points: 100 },
    });
    if (res.correct || res.ai) ctx.achievement('a13-diagnosis');

    // ---- close the reactant valves (Houston hopes it stops the leak)
    await ctx.say('CAPCOM', '13, we would like you to close the reac valves on fuel cell 3 and fuel cell 1.', 'Trece, queremos que cierren las válvulas de reactivos de la pila 3 y de la pila 1.');
    radio(ctx, 'CDR', 'Are you saying you want them both closed?', '¿Nos dicen que las cerremos las dos?');
    radio(ctx, 'CAPCOM', 'That is affirmative.', 'Afirmativo.');
    const obj3 = ctx.objective('reac', 'Cierra las válvulas de reactivos de las pilas 1 y 3');
    await ctx.crew({
      id: 'a13.reac',
      title: 'CERRAR REACTIVOS FC 1 Y FC 3',
      items: [
        { text: 'FC 3 REAC — CLOSE (irreversible)', sw: { id: 'CM.EPS.FC3_REAC', pos: 'CLOSE' }, hint: 'Panel 3: una vez cerrada, la pila no vuelve' },
        { text: 'FC 1 REAC — CLOSE', sw: { id: 'CM.EPS.FC1_REAC', pos: 'CLOSE' } },
      ],
      aiPace: [5, 9],
    });
    obj3.done();
    radio(ctx, 'CMP', 'Okay, they are closed.', 'Listo, cerradas.');
    await ctx.wait(30);
    const p1 = v.tm['CM.CRYO.O2_1.P_PSI'] ?? 0;
    await ctx.say('CAPCOM', 'Thirteen, we are still losing O2 tank 1. We would like you to start thinking about the LM lifeboat.', `Trece, el tanque de O2 número 1 sigue perdiendo (${Math.round(p1)} psi). Empiecen a pensar en el LM como bote salvavidas.`);
    radio(ctx, 'CDR', "Roger. We're thinking about the LM.", 'Recibido. Ya estamos pensando en el LM.');
    ctx.achievement('a13-problem');
    ctx.complete({
      summary: `El tanque de oxígeno 2 explotó a GET ${Math.floor(tBang / 3600)}:${String(Math.floor((tBang % 3600) / 60)).padStart(2, '0')}. El Odyssey perdió dos de sus tres pilas de combustible y el oxígeno del tanque 1 se escapa: en menos de dos horas el CM estará muerto. El Aquarius será el bote salvavidas.`,
      stats: { 'O2 tanque 1': `${Math.round(p1)} psi`, 'Pilas activas': [1, 2, 3].filter((n) => v.tm[`CM.EPS.FC${n}.ON_LINE`]).length, Distancia: `${Math.round(v.state.r.length() / 1000).toLocaleString('es')} km` },
    });
  },
};
