// Apollo 13 — PC+2. The free return swings the crew around the far side of the Moon (254 km, the
// farthest humans have ever been from Earth) and would land them in the Indian Ocean after 152 h.
// Two hours after pericynthion, a 4½-minute DPS burn at full throttle speeds the return up to a
// Pacific splashdown at ~142 h.

import { GET } from '../../core/MissionClock.js';
import { A13_EVENTS } from '../common/states.js';
import { planReturn, fmtGET } from '../../sim/physics/targeting.js';
import { radio, houstonPad, flyBurn, grade, entryPrediction, warpHint, waitLOS, waitAOS } from '../common/kit.js';
import { lifeboatSetup } from './freereturn.js';

export default {
  setup: () => lifeboatSetup(GET(76, 50)),
  briefing: {
    summary:
      'GET 76:50. El Apolo 13 cae hacia la cara oculta de la Luna. Pasará a 254 km sobre ella y a 400.171 km de la Tierra: el récord de distancia de la humanidad. ' +
      'Dos horas después del perilunio (PC+2), el motor de descenso debe encenderse 4 minutos y medio a máxima potencia para adelantar el regreso diez horas.',
    objectives: ['Rodear la cara oculta de la Luna', 'Recibir el PAD del PC+2', 'Encendido del DPS al 100 % (~4½ min)', 'Regreso al Pacífico en ~142 h'],
    tips: ['Detrás de la Luna no hay radio', 'Mira por la ventana: la cara oculta y la Tierra saliendo', 'El PC+2 es largo: la nave acoplada pesa 40 toneladas'],
  },
  async run(ctx) {
    ctx.caption('PC+2', 'Apolo 13 · rodeando la cara oculta · GET 76:50', 6);
    radio(ctx, 'CAPCOM', 'Aquarius, Houston. You are going around the corner. We will see you on the other side.', 'Aquarius, Houston. Van a doblar la esquina. Nos vemos del otro lado.');
    warpHint(ctx);
    const obj1 = ctx.objective('farside', 'Rodea la cara oculta de la Luna');
    await waitLOS(ctx);
    ctx.alert('LOS: detrás de la Luna', 'info', 5);
    radio(ctx, 'LMP', 'Look at that. The far side of the Moon.', 'Miren eso. La cara oculta de la Luna.', { channel: 'ic' });
    radio(ctx, 'CMP', 'Get some pictures, Fred.', 'Saca fotos, Fred.', { channel: 'ic' });
    await waitAOS(ctx);
    obj1.done();
    ctx.alert('AOS: señal adquirida', 'info', 5);
    ctx.score('farside', 40, 40, 'Paso por la cara oculta');
    await ctx.say('CAPCOM', 'Aquarius, Houston. Welcome back. Your S-IVB just hit the Moon; the Apollo 12 seismometer is ringing.', 'Aquarius, Houston. Bienvenidos. Su S-IVB acaba de impactar en la Luna: el sismómetro del Apolo 12 está vibrando.');

    // ---- PC+2
    const obj2 = ctx.objective('pad', 'Recibe el PAD del PC+2');
    const pad = await houstonPad(ctx, (c) => planReturn(c, { tigGET: Math.max(c.get + 900, A13_EVENTS.PC2), eiGET: A13_EVENTS.EI, entryGamma: -6.5, name: 'PC+2' }).then((p) => ({ ...p, throttle: 0.925 })));
    obj2.done();
    await ctx.poll({
      id: 'a13.pc2poll',
      title: 'GO / NO GO para el PC+2',
      consoles: ['RETRO', 'FIDO', 'GUIDO', 'CONTROL', 'TELMU', 'EECOM'],
      intro: { en: 'All flight, go/no-go for the PC plus 2 burn.', es: 'Controladores: GO / NO GO para el encendido PC+2.' },
      outro: { en: 'CAPCOM, Aquarius is GO for PC plus 2.', es: 'CAPCOM, Aquarius tiene GO para el PC+2.' },
      astronautSummary: { who: 'CAPCOM', en: 'Aquarius, you are GO for PC plus 2.', es: 'Aquarius, tienen GO para el PC+2.' },
    });
    const obj3 = ctx.objective('burn', 'Encendido del PC+2 (DPS al 100 %)');
    const burn = await flyBurn(ctx, pad, { checklist: 'dps', replan: (c) => planReturn(c, { tigGET: c.get + 600, eiGET: A13_EVENTS.EI, name: 'PC+2' }).then((p) => ({ ...p, throttle: 0.925 })) });
    obj3.done();
    radio(ctx, 'CDR', 'Shutdown. That was a good burn.', 'Apagado. Fue un buen encendido.');
    await ctx.wait(20);
    const after = entryPrediction(ctx);
    const gam = after.gammaEI;
    ctx.score('burn', burn.missed ? 40 : 100, 100, burn.missed ? 'PC+2 con retraso' : 'PC+2 puntual');
    ctx.score('time', Number.isFinite(after.tEI) ? grade(Math.abs(after.tEI - A13_EVENTS.EI) / 3600, 0.5, 8, 100) : 0, 100, Number.isFinite(after.tEI) ? `Reentrada a GET ${fmtGET(after.tEI)}` : 'Sin reentrada');
    ctx.achievement('a13-pc2');
    await ctx.say('CAPCOM', 'Aquarius, Houston. That was a good burn. You are coming home to the Pacific.', Number.isFinite(after.tEI) ? `Aquarius, Houston. Buen encendido: vuelven al Pacífico, reentrada a GET ${fmtGET(after.tEI)}${Number.isFinite(gam) ? ` con γ ${gam.toFixed(2)}°` : ''}.` : 'Aquarius, Houston. Haremos una corrección más.');
    ctx.complete({
      summary: `PC+2 completado. ${Number.isFinite(after.tEI) ? `Reentrada prevista a GET ${fmtGET(after.tEI)} en el Pacífico Sur, donde espera el USS Iwo Jima.` : ''} Ahora el problema es otro: el aire del LM.`,
      stats: { 'ΔV': `${(pad.dvTotal / 0.3048).toFixed(0)} ft/s`, 'Encendido': `${Math.round(pad.burnTime)} s`, 'DPS restante': `${Math.round((ctx.lm.dpsProp / ctx.lm.dpsProp0) * 100)} %` },
    });
  },
};
