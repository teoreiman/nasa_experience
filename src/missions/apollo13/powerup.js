// Apollo 13 — Bringing the Odyssey back to life. The CM has been cold and dark for three days; its
// three entry batteries are all the power left for the end of the flight. Ken Mattingly and the
// engineers on the ground wrote a power-up sequence that never exceeds the amps budget. Then the
// crew jettisons the service module and sees the damage for the first time.

import { GET } from '../../core/MissionClock.js';
import { A13_EVENTS } from '../common/states.js';
import { radio, procedure, grade } from '../common/kit.js';
import { lifeboatSetup } from './freereturn.js';

const BUDGET = 45;

export default {
  setup: () => lifeboatSetup(GET(137, 10), { station: 'CM', seat: 'CMP', maxWarp: 10 }),
  briefing: {
    summary:
      'GET 137:10. Ken Mattingly —que se quedó en tierra por una sospecha de sarampión— pasó días en el simulador escribiendo cómo despertar al Odyssey con tres baterías de reentrada. ' +
      'Cada interruptor gasta amperios: sigue el procedimiento sin pasar de 45 A, y después separa el módulo de servicio para ver qué explotó.',
    objectives: ['Conectar las baterías a los buses principales', 'Encender ordenador, plataforma y ventilación sin pasar de 45 A', 'Presurizar el RCS del CM', 'Separar el módulo de servicio y fotografiarlo'],
    tips: ['El consumo aparece arriba de la pantalla', 'Enciende sólo lo que pide la lista: cada sistema extra gasta batería', 'La separación del SM necesita SECS ARM'],
  },
  async run(ctx) {
    const v = ctx.vehicle;
    const csm = ctx.csm;
    ctx.caption('REACTIVAR EL ODYSSEY', 'Apolo 13 · GET 137:10', 6);
    await ctx.say('CAPCOM', 'Odyssey, Houston. We have the power-up procedure for you. It is a long one; take your time.', 'Odyssey, Houston. Tenemos el procedimiento de reactivación. Es largo: tómense su tiempo.');
    radio(ctx, 'CMP', 'Roger. Ready to copy. It is cold in here.', 'Recibido, listos para copiar. Hace frío aquí dentro.');
    let peak = 0;
    const stopTask = ctx.every(1, () => {
      const amps = csm.powerBudget().total;
      peak = Math.max(peak, amps);
      ctx.task(`Consumo del CM: ${amps.toFixed(1)} A · límite ${BUDGET} A · batería A ${csm.bat.A.toFixed(1)} Ah`);
      if (amps > BUDGET && !v.tm['CM.CW.MAIN_BUS_A_UNDERVOLT']) ctx.alert(`Te pasaste del presupuesto: ${amps.toFixed(0)} A`, 'caution', 3);
    });
    const obj1 = ctx.objective('power', 'Reactiva el CM siguiendo el procedimiento de Mattingly');
    const r = await procedure(ctx, 'cmPowerUp', { title: 'Reactivación del Odyssey', pick: [0, 1, 2, 3, 4, 5, 6, 7, 8], aiPace: [6, 12] });
    obj1.done();
    ctx.score('budget', grade(peak, BUDGET, BUDGET + 20, 150), 150, `Pico de consumo ${peak.toFixed(0)} A`);
    ctx.score('procedure', r.autoUsed ? 40 : 80, 80, 'Procedimiento de reactivación');
    if (peak <= BUDGET) ctx.achievement('a13-powerup');
    await ctx.say('CAPCOM', 'Odyssey, Houston. We see your power-up. It looks good.', 'Odyssey, Houston. Vemos la reactivación. Se ve bien.');

    // ---- service module jettison
    const obj2 = ctx.objective('smjett', 'Separa el módulo de servicio');
    if (ctx.t < A13_EVENTS.SM_JETT - 300) {
      ctx.hint('Acelera el tiempo hasta la separación del SM (138:01:48).', { durationS: 8 });
      await ctx.waitGET(A13_EVENTS.SM_JETT - 300);
    }
    await ctx.say('CAPCOM', 'Odyssey, Houston. You are GO for SM jettison.', 'Odyssey, Houston. Tienen GO para separar el módulo de servicio.');
    await ctx.crew({
      id: 'a13.smjett',
      title: 'SEPARACIÓN DEL MÓDULO DE SERVICIO',
      items: [
        { text: 'SECS ARM A y B — ARM', sw: [{ id: 'CM.SEQ.SECS_ARM_A', pos: 'ARM' }, { id: 'CM.SEQ.SECS_ARM_B', pos: 'ARM' }] },
        { text: 'CM/SM SEP 1 — SEP (con tapa)', sw: { id: 'CM.SEQ.CM_SM_SEP_1', pos: 'SEP' }, check: (c) => c.vehicle.config === 'CM_LM' || c.vehicle.config === 'CM' },
      ],
      aiPace: [4, 8],
    });
    obj2.done();
    stopTask();
    ctx.task('');
    ctx.view?.setCamera?.('exterior:wide');
    await ctx.wait(20);
    await ctx.say('CDR', 'And there is one whole side of that spacecraft missing!', '¡Le falta todo un costado a esa nave!');
    radio(ctx, 'CAPCOM', 'Is that right?', '¿En serio?');
    await ctx.say('CDR', 'Right by the high-gain antenna, the whole panel is blown out, almost from the base to the engine.', 'Justo al lado de la antena de alta ganancia: el panel entero voló, casi desde la base hasta el motor.');
    radio(ctx, 'LMP', 'It is really a mess.', 'Es un desastre.');
    ctx.complete({
      summary: `El Odyssey despertó con un pico de ${peak.toFixed(0)} A (límite ${BUDGET} A) y el módulo de servicio quedó atrás: la tripulación vio por primera vez el panel 4 arrancado por la explosión.`,
      stats: { 'Pico de consumo': `${peak.toFixed(0)} A`, 'Batería A': `${csm.bat.A.toFixed(1)} Ah`, Configuración: v.config },
    });
  },
};
