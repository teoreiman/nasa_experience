// Apollo 11 — Trans-Earth Injection. Columbia alone in lunar orbit (Eagle's ascent stage already
// jettisoned): Houston's TEI PAD, the 2½-minute SPS burn behind the Moon that decides whether the
// crew gets home, and the AOS call. RETRO judges the entry corridor of the new trajectory.

import { GET } from '../../core/MissionClock.js';
import { planTEI, fmtGET } from '../../sim/physics/targeting.js';
import { radio, houstonPad, flyBurn, grade, warpHint, waitLOS, waitAOS, entryPrediction } from '../common/kit.js';

export default {
  setup: {
    get: GET(135, 10),
    config: 'CSM',
    state: 'PRE_TEI',
    station: 'CM',
    seat: 'CDR',
    csm: { preset: 'LUNAR_ORBIT', consumables: { spsProp: 7600 } },
    lm: null,
  },
  briefing: {
    summary:
      'Columbia, sola de nuevo con sus tres tripulantes. El SPS —un único motor sin respaldo— tiene que funcionar una vez más detrás de la Luna: ' +
      '1.000 m/s de aceleración para caer de regreso hacia la Tierra y entrar en un corredor de reentrada de apenas dos grados.',
    objectives: ['Recibir el PAD de la TEI', 'Configurar el SPS (P30 / P40)', 'Encendido de ~2½ minutos detrás de la Luna', 'Ángulo de reentrada entre −5,5° y −7,5°'],
    tips: ['Houston tarda unos segundos en calcular la TEI', 'PRO en V99 autoriza el encendido', 'Tras la AOS Houston confirma el corredor de reentrada'],
  },
  async run(ctx) {
    const v = ctx.vehicle;
    ctx.caption('REGRESO A CASA', 'Apolo 11 · inyección transterrestre', 6);
    radio(ctx, 'CAPCOM', 'Apollo 11, Houston. We have your TEI PAD coming up.', 'Apolo 11, Houston. Les pasamos el PAD de la TEI.');
    await ctx.poll({
      id: 'a11.teipoll',
      title: 'GO / NO GO para la TEI',
      consoles: ['RETRO', 'FIDO', 'GUIDO', 'GNC', 'EECOM', 'INCO'],
      intro: { en: 'All flight, go/no-go for TEI.', es: 'Controladores: GO / NO GO para la TEI.' },
      outro: { en: 'CAPCOM, we are GO for TEI.', es: 'CAPCOM, tenemos GO para la TEI.' },
      astronautSummary: { who: 'CAPCOM', en: 'Apollo 11, Houston. You are GO for TEI.', es: 'Apolo 11, Houston. Tienen GO para la TEI.' },
    });
    const obj1 = ctx.objective('pad', 'Recibe el PAD de la TEI');
    const pad = await houstonPad(ctx, (c) => planTEI(c, { minLead: 600 }));
    obj1.done();
    warpHint(ctx);
    ctx.spawn(async () => {
      await waitLOS(ctx);
      ctx.alert('LOS: pérdida de señal detrás de la Luna', 'info', 6);
    });
    const obj2 = ctx.objective('burn', 'Encendido de la TEI');
    const burn = await flyBurn(ctx, pad, { checklist: 'sps', replan: (c) => planTEI(c, { minLead: 420 }) });
    obj2.done();
    radio(ctx, 'CDR', 'Shutdown. Good burn.', 'Apagado. Buen encendido.', { channel: 'ic' });
    ctx.score('burn', burn.missed ? 40 : 100, 100, burn.missed ? 'TEI con retraso' : 'TEI puntual');
    const pred = entryPrediction(ctx);
    const obj3 = ctx.objective('aos', 'Espera la AOS y la confirmación del corredor');
    await waitAOS(ctx);
    obj3.done();
    ctx.alert('AOS: señal adquirida', 'info', 5);
    await ctx.say('CAPCOM', 'Hello Apollo 11, Houston. How did it go? Over.', 'Hola, Apolo 11, aquí Houston. ¿Cómo salió? Cambio.');
    await ctx.say('CDR', 'Time to open up the LRL doors, Charlie.', 'Hora de abrir las puertas del laboratorio de recepción lunar, Charlie.');
    const gam = pred.gammaEI;
    const ok = Number.isFinite(gam) && gam < -5.3 && gam > -7.6;
    await ctx.say('CAPCOM', "Roger. We've got you coming home. It's well in the green.", ok ? `Recibido. Los tenemos volviendo a casa: reentrada a GET ${fmtGET(pred.tEI)} con γ ${gam.toFixed(2)}°, bien dentro del corredor.` : 'Recibido. Los tenemos volviendo; la corrección de medio curso ajustará el corredor.');
    ctx.score('corridor', Number.isFinite(gam) ? grade(Math.abs(gam + 6.5), 0.25, 2.2, 150) : 20, 150, Number.isFinite(gam) ? `γ de reentrada ${gam.toFixed(2)}°` : 'Fuera del corredor (MCC necesaria)');
    ctx.achievement('a11-tei');
    ctx.complete({
      summary: `Columbia vuelve a casa. ${Number.isFinite(gam) ? `Reentrada prevista a GET ${fmtGET(pred.tEI)} con γ ${gam.toFixed(2)}°.` : 'Hará falta una corrección de medio curso.'}`,
      stats: { 'γ de reentrada': Number.isFinite(gam) ? `${gam.toFixed(2)}°` : '—', 'SPS restante': `${(ctx.csm.spsProp / 1000).toFixed(2)} t`, 'Velocidad': `${(v.state.speed / 0.3048).toFixed(0)} ft/s` },
    });
  },
};
