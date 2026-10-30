// Apollo 8 — Behind the Moon. Nobody had ever been there: the first lunar orbit insertion, flown by
// Borman, Lovell and Anders in silence on the far side while the world waited for the AOS.

import { GET } from '../../core/MissionClock.js';
import { NMI } from '../../core/constants.js';
import { planLOI } from '../../sim/physics/targeting.js';
import { radio, houstonPad, flyBurn, grade, orbitText, warpHint, waitLOS, waitAOS } from '../common/kit.js';

export default {
  setup: {
    get: GET(68, 50),
    config: 'CSM',
    state: 'A8_PRE_LOI',
    station: 'CM',
    seat: 'CDR',
    csm: 'TLC',
    lm: null,
  },
  briefing: {
    summary:
      '24 de diciembre de 1968. Por primera vez, seres humanos van a pasar por detrás de la Luna. El SPS tiene que frenar 4 minutos sin contacto con la Tierra; si no enciende, la trayectoria los trae de vuelta; si se pasa, no vuelven. ' +
      'Houston sabrá cómo salió sólo cuando el Apolo 8 reaparezca por el otro borde.',
    objectives: ['Recibir el PAD de la LOI', 'GO antes de la pérdida de señal', 'Encendido del SPS detrás de la Luna', 'Órbita lunar de 60 × 170 nmi'],
    tips: ['PRO en V99 autoriza el encendido', 'Mira por la ventana: la cara oculta nunca había sido vista por ojos humanos'],
  },
  async run(ctx) {
    const v = ctx.vehicle;
    ctx.caption('DETRÁS DE LA LUNA', 'Apolo 8 · 24 de diciembre de 1968', 6);
    radio(ctx, 'PAO', 'This is Apollo Control. Apollo 8 is 2,200 miles from the Moon and accelerating.', 'Aquí Control Apolo. El Apolo 8 está a 3.500 km de la Luna y acelerando.');
    const obj1 = ctx.objective('pad', 'Recibe el PAD de la LOI');
    const pad = await houstonPad(ctx, (c) => planLOI(c, { apoKm: 313 }));
    obj1.done();
    warpHint(ctx);
    ctx.spawn(async () => {
      await ctx.waitUntil(() => v.state.losEarth || ctx.t > pad.tig - 400);
      if (!v.state.losEarth) {
        await ctx.say('CAPCOM', 'Apollo 8, Houston. One minute to LOS. All systems GO. Safe journey, guys.', 'Apolo 8, Houston. Un minuto para la pérdida de señal. Todos los sistemas GO. Buen viaje, muchachos.');
        radio(ctx, 'LMP', 'Thanks a lot, troops.', 'Muchas gracias, gente.');
        radio(ctx, 'CMP', 'We will see you on the other side.', 'Nos vemos del otro lado.');
      }
      await waitLOS(ctx);
      ctx.alert('LOS: los primeros humanos detrás de la Luna', 'info', 7);
    });
    const obj2 = ctx.objective('burn', 'Encendido de la LOI');
    const burn = await flyBurn(ctx, pad, { checklist: 'sps', replan: (c) => planLOI(c, { apoKm: 313 }) });
    obj2.done();
    await ctx.wait(20);
    const st = v.state;
    if (st.primary !== 'MOON' || !Number.isFinite(st.apoAlt) || st.periAlt < 15000) {
      ctx.fail('El Apolo 8 no quedó en una órbita lunar estable.', { stats: { Órbita: orbitText(st) } });
      return;
    }
    radio(ctx, 'CDR', 'Burn complete.', 'Encendido completo.', { channel: 'ic' });
    radio(ctx, 'LMP', 'Look at that! The far side.', '¡Miren eso! La cara oculta.', { channel: 'ic' });
    const apo = st.apoAlt / NMI;
    const peri = st.periAlt / NMI;
    ctx.score('orbit', grade(Math.abs(apo - 169) + Math.abs(peri - 60.5), 6, 60, 150), 150, `Órbita ${apo.toFixed(1)} × ${peri.toFixed(1)} nmi`);
    ctx.score('burn', burn.missed ? 40 : 100, 100, burn.missed ? 'Ignición retrasada' : 'Ignición puntual');
    const obj3 = ctx.objective('aos', 'Espera la adquisición de señal');
    await waitAOS(ctx);
    obj3.done();
    ctx.alert('AOS: señal adquirida', 'info', 5);
    await ctx.say('CAPCOM', 'Apollo 8, Houston. Over.', 'Apolo 8, Houston. Cambio.');
    await ctx.say('CMP', 'Go ahead, Houston, Apollo 8. Burn complete. Our orbit 169.1 by 60.5.', `Adelante, Houston, aquí Apolo 8. Encendido completo. Nuestra órbita: ${apo.toFixed(1)} por ${peri.toFixed(1)}.`);
    await ctx.say('CAPCOM', 'Apollo 8, Houston. Roger. 169.1 by 60.5. Good to hear your voice.', 'Apolo 8, Houston. Recibido. Qué bueno oír su voz.');
    radio(ctx, 'CMP', 'The Moon is essentially gray, no color; looks like plaster of Paris or sort of a grayish beach sand.', 'La Luna es esencialmente gris, sin color; parece yeso, o una arena de playa grisácea.');
    ctx.achievement('a8-loi');
    ctx.complete({
      summary: `Apolo 8 en órbita lunar: ${orbitText(st)}. Borman, Lovell y Anders fueron los primeros en ver la cara oculta de la Luna con sus propios ojos.`,
      stats: { Apolunio: `${apo.toFixed(1)} nmi`, Perilunio: `${peri.toFixed(1)} nmi` },
    });
  },
};
