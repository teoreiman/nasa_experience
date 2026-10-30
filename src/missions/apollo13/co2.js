// Apollo 13 — "A square peg in a round hole". Three men breathing in a LM built for two: its round
// lithium hydroxide canisters are saturated and the CO2 climbs. The CM has plenty of canisters, but
// they are square. On the ground, Ed Smylie's team invents an adapter from what is on board; the
// crew builds it following Houston's instructions read up over the radio.

import { GET } from '../../core/MissionClock.js';
import { radio, grade } from '../common/kit.js';
import { lifeboatSetup } from './freereturn.js';

const STEPS = [
  {
    prompt: 'Primer paso: el cartucho cuadrado de LiOH del CM. ¿Cómo lo preparas?',
    options: [
      ['ok', 'Cubrir la cara de salida con cartón recortado de una tapa del manual'],
      ['x1', 'Quitarle el filtro para que pase más aire'],
      ['x2', 'Meterlo entero en la abertura redonda del LM'],
    ],
    say: ['CAPCOM', 'Take the cardboard cover off the LM procedures book and cut it to fit the canister.', 'Tomen la tapa de cartón del libro de procedimientos del LM y recórtenla a la medida del cartucho.'],
  },
  {
    prompt: 'Ahora hay que encerrar el cartucho. ¿Qué usas?',
    options: [
      ['ok', 'Una bolsa de plástico de las prendas de refrigeración (LCG), alrededor del cartucho'],
      ['x1', 'Un traje espacial vacío'],
      ['x2', 'Nada: el aire de la cabina basta'],
    ],
    say: ['CAPCOM', 'Put the bag around the canister, with the cardboard at the bottom.', 'Pongan la bolsa alrededor del cartucho, con el cartón abajo.'],
  },
  {
    prompt: '¿Con qué sellas la bolsa contra el cartucho?',
    options: [
      ['ok', 'Cinta adhesiva gris («duct tape»), varias vueltas'],
      ['x1', 'Velcro'],
      ['x2', 'Cordones de las botas'],
    ],
    say: ['CAPCOM', 'Tape it all the way around. Use plenty of gray tape.', 'Séllenla con cinta todo alrededor. Usen mucha cinta gris.'],
  },
  {
    prompt: 'Falta la circulación del aire. ¿Qué conectas?',
    options: [
      ['ok', 'La manguera de un traje al hueco de la bolsa: el ventilador del traje empuja el aire por el cartucho'],
      ['x1', 'La manguera del agua'],
      ['x2', 'Nada: el CO2 se mueve solo'],
    ],
    say: ['CAPCOM', 'Cut a hole in the bag and tape the suit hose into it. Then turn the suit fan on.', 'Hagan un agujero en la bolsa y peguen ahí la manguera del traje. Después enciendan el ventilador del traje.'],
  },
];

export default {
  setup: () => lifeboatSetup(GET(82, 55), { lm: { preset: 'LIFEBOAT', consumables: { co2: 7.0, lioh: 0.05 } }, maxWarp: 10 }),
  briefing: {
    summary:
      'GET 83:00. Los cartuchos de hidróxido de litio del LM están saturados y el dióxido de carbono sube: a partir de 15 mmHg la tripulación empieza a perder el conocimiento. ' +
      'En Houston, un equipo arma un adaptador con bolsas, cartón y cinta para usar los cartuchos cuadrados del CM en el agujero redondo del LM. Constrúyelo siguiendo las instrucciones.',
    objectives: ['Proponer la solución (EECOM)', 'Construir el adaptador paso a paso', 'Conectar la manguera y el ventilador del traje', 'Bajar el CO2 por debajo de 4 mmHg'],
    tips: ['El indicador de CO2 parcial (PPCO2) está en el panel 2', 'Cada error cuesta tiempo y el CO2 sigue subiendo', 'Se puede acelerar el tiempo ×10'],
  },
  async run(ctx) {
    const v = ctx.vehicle;
    const lm = ctx.lm;
    ctx.caption('EL PROBLEMA DEL CO₂', 'Apolo 13 · GET 83:00', 6);
    let maxCO2 = 0;
    ctx.every(5, () => {
      maxCO2 = Math.max(maxCO2, lm.co2);
      ctx.task(`CO₂ en la cabina: ${lm.co2.toFixed(1)} mmHg (peligro: 15)`);
      if (lm.co2 > 15) ctx.fail('El CO₂ superó los 15 mmHg: la tripulación perdió el conocimiento.', { stats: { 'CO₂ máximo': `${lm.co2.toFixed(1)} mmHg` } });
    });
    await ctx.wait(15);
    if (lm.co2 > 7.6) lm.caution('CO2_HI');
    radio(ctx, 'LMP', 'Houston, Aquarius. We have a CO2 light.', 'Houston, aquí Aquarius. Tenemos la luz de CO2.');
    await ctx.ground({
      id: 'a13.eecom.co2',
      console: 'EECOM',
      kind: 'decision',
      title: 'Cartuchos cuadrados, agujero redondo',
      prompt: 'Los cartuchos redondos del LM están saturados. El CM tiene cartuchos de sobra, pero son cuadrados. El CM está apagado. ¿Qué propones?',
      options: [
        { id: 'adapter', label: 'Un adaptador con lo que hay a bordo: bolsas, cartón, cinta y una manguera', correct: true, say: { who: 'EECOM', en: 'Flight, Crew Systems has a procedure: we can rig the CM canisters with what they have on board.', es: 'Flight, Sistemas de Tripulación tiene un procedimiento: se pueden adaptar los cartuchos del CM con lo que tienen a bordo.', channel: 'loop' } },
        { id: 'cm', label: 'Encender el sistema ambiental del CM', correct: false, say: { who: 'FLIGHT', en: 'We cannot power the CM up. We need those batteries for entry.', es: 'No podemos encender el CM: necesitamos esas baterías para la reentrada.', channel: 'loop' } },
        { id: 'wait', label: 'Que la tripulación se mueva poco y esperar', correct: false, say: { who: 'FLIGHT', en: 'That buys us hours, not days.', es: 'Eso nos da horas, no días.', channel: 'loop' } },
      ],
      timeout: 60,
      aiDelay: 6,
      score: { key: 'eecom', points: 50 },
    });
    await ctx.say('CAPCOM', 'Aquarius, Houston. We have a procedure for you to rig the command module canisters. Get a pencil and some paper.', 'Aquarius, Houston. Tenemos un procedimiento para adaptar los cartuchos del módulo de mando. Busquen lápiz y papel.');

    // ---- the build
    const obj = ctx.objective('build', 'Construye el adaptador de LiOH');
    let mistakes = 0;
    for (let i = 0; i < STEPS.length; i++) {
      const s = STEPS[i];
      await ctx.say(s.say[0], s.say[1], s.say[2]);
      for (;;) {
        const pick = await ctx.choice({
          id: `a13.co2.${i}`,
          title: `Adaptador · paso ${i + 1} de ${STEPS.length}`,
          prompt: s.prompt,
          options: s.options.map(([id, label]) => ({ id, label })),
          timeout: 90,
          defaultOption: 'ok',
        });
        if (pick === 'ok') break;
        mistakes++;
        ctx.alert('Eso no va a funcionar: vuelve a intentarlo', 'caution', 4);
        await ctx.wait(240);
      }
      await ctx.wait(120);
    }
    lm.installCO2Adapter();
    obj.done();
    radio(ctx, 'CMP', 'Okay, the first one is hooked up and the fan is on.', 'Listo: el primero está conectado y el ventilador funciona.');
    ctx.score('build', grade(mistakes, 0, 4, 140), 140, `${mistakes} error(es) en la construcción`);

    // ---- does it work?
    const obj2 = ctx.objective('co2', 'Espera a que el CO2 baje de 4 mmHg');
    await ctx.waitUntil(() => lm.co2 < 4, { timeout: 3 * 3600 });
    obj2.done();
    v.tm['LM.CW.CO2_HI'] = false;
    await ctx.say('CAPCOM', 'Aquarius, we see the CO2 coming down. Nice job.', `Aquarius, vemos el CO2 bajando: ${lm.co2.toFixed(1)} mmHg. Buen trabajo.`);
    radio(ctx, 'LMP', 'It looks like it is working.', 'Parece que funciona.');
    ctx.achievement('a13-co2');
    ctx.score('co2', grade(maxCO2, 8, 14, 80), 80, `CO2 máximo ${maxCO2.toFixed(1)} mmHg`);
    ctx.complete({
      summary: `El «buzón» de cartón, bolsas y cinta funciona: el CO2 bajó a ${lm.co2.toFixed(1)} mmHg. Máximo alcanzado: ${maxCO2.toFixed(1)} mmHg.`,
      stats: { 'CO2 máximo': `${maxCO2.toFixed(1)} mmHg`, Errores: mistakes },
    });
  },
};
