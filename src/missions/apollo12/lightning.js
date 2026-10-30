// Apollo 12 — "SCE to AUX". Launch in the rain, 14 November 1969. At T+36.5 s and T+52 s lightning
// strikes the Saturn V: the fuel cells drop off line, every warning light comes on and the telemetry
// in Houston turns to garbage. A 24-year-old EECOM, John Aaron, remembers the pattern from a test a
// year before: put the Signal Conditioning Equipment on its auxiliary supply.

import { GET } from '../../core/MissionClock.js';
import { NMI } from '../../core/constants.js';
import { radio, procedure, orbitText } from '../common/kit.js';
import { runLaunch } from '../common/launch.js';

export default {
  setup: {
    get: -GET(0, 3, 30),
    config: 'SATURN_V',
    state: 'PAD_39A',
    station: 'CM',
    seat: 'CDR',
    csm: 'PRELAUNCH',
    lm: 'STOWED',
    maxWarp: 10,
  },
  briefing: {
    summary:
      '14 de noviembre de 1969: lluvia y nubes bajas sobre el Cabo. Conrad, Gordon y Bean despegan igual. El Saturn V, con su columna de gases ionizados, se convierte en un pararrayos de 3.000 metros. ' +
      'Dos descargas en 16 segundos: todo se apaga en la cabina y la telemetría de Houston es basura. Alguien tiene que acordarse de un interruptor que casi nadie conoce.',
    objectives: ['Lanzamiento', 'Sobrevivir a los rayos', 'SCE a AUX: recuperar la telemetría', 'Reconectar las pilas de combustible y llegar a la órbita'],
    tips: ['SCE POWER está en el panel 2, abajo: NORM / OFF / AUX', 'Las pilas se reconectan con los interruptores MAIN A/B FC del panel 3'],
  },
  async run(ctx) {
    const sim = ctx.sim;
    const v = ctx.vehicle;
    const csm = ctx.csm;
    ctx.caption('APOLO 12', 'Complejo 39A — 14 de noviembre de 1969 · lluvia', 6);
    radio(ctx, 'PAO', 'This is Apollo Saturn launch control. We are under a cloud cover with rain, and we are proceeding with the count.', 'Aquí control de lanzamiento del Apolo Saturno. Tenemos nubes y lluvia, y seguimos con la cuenta.');
    let sceAt = null;
    let strikeAt = null;
    const during = async () => {
      // ---- first strike
      await ctx.waitGET(36.5);
      strikeAt = ctx.t;
      csm.trigger('LIGHTNING_STRIKE');
      v.request('LIGHTNING_STRIKE', { source: 'weather' });
      ctx.dropWarp();
      radio(ctx, 'CDR', 'What the hell was that?', '¿Qué demonios fue eso?', { channel: 'ic' });
      radio(ctx, 'CDR', 'I lost a whole bunch of stuff. I don\'t know what happened here. We had everything in the world drop out.', 'Perdí un montón de cosas, no sé qué pasó. Se nos cayó todo.');
      // ---- second strike
      await ctx.waitGET(52);
      csm.trigger('LIGHTNING_STRIKE');
      v.request('LIGHTNING_STRIKE', { source: 'weather' });
      radio(ctx, 'CDR', 'Fuel cells are off line, the AC buses are dead, the platform is gone.', 'Las pilas están fuera de línea, los buses de alterna muertos, la plataforma se perdió.');
      // ---- EECOM: John Aaron
      const res = await ctx.ground({
        id: 'a12.eecom.sce',
        console: 'EECOM',
        kind: 'diagnose',
        title: 'Telemetría basura',
        prompt: 'Los voltajes de los buses, las corrientes de las pilas y las presiones dan valores absurdos, saltando sin sentido. Un año antes, en una prueba en Kennedy, viste ese mismo patrón cuando el SCE perdía alimentación. ¿Qué pides?',
        options: [
          { id: 'sce', label: '«Prueben SCE a AUX» (alimentación auxiliar del acondicionador de señales)', correct: true, say: { who: 'EECOM', en: 'Flight, EECOM. Try SCE to Aux.', es: 'Flight, EECOM. Prueben SCE a AUX.', channel: 'loop' } },
          { id: 'abort', label: 'Abortar: perdimos la energía eléctrica', correct: false, say: { who: 'FLIGHT', en: 'The booster is fine and the crew is talking. We are not aborting on bad data.', es: 'El cohete va bien y la tripulación habla. No abortamos por datos dudosos.', channel: 'loop' } },
          { id: 'wait', label: 'Esperar a que los datos se arreglen solos', correct: false, say: { who: 'FLIGHT', en: 'EECOM, I need something better than that.', es: 'EECOM, necesito algo mejor que eso.', channel: 'loop' } },
        ],
        timeout: 40,
        aiDelay: 6,
        evidence: ['CM.EPS.MNA.V', 'CM.EPS.MNB.V', 'CM.TLM.QUALITY'],
        score: { key: 'sce', points: 100 },
      });
      await ctx.say('CAPCOM', 'Apollo 12, Houston. Try SCE to Auxiliary. Over.', 'Apolo 12, Houston. Prueben SCE a auxiliar. Cambio.');
      radio(ctx, 'CDR', 'Try FCE to Auxiliary. What the hell is that?', '¿FCE a auxiliar? ¿Qué demonios es eso?');
      radio(ctx, 'CAPCOM', 'SCE. SCE to Auxiliary.', 'SCE. SCE a auxiliar.');
      ctx.hint('SCE POWER, panel 2 abajo a la izquierda: muévelo a AUX.', { durationS: 10 });
      await ctx.crew({
        id: 'a12.sce',
        title: 'SCE A AUX',
        items: [{ text: 'SCE POWER — AUX', sw: { id: 'CM.EPS.SCE_PWR', pos: 'AUX' }, hint: 'Alan Bean lo encontró de memoria' }],
        aiPace: [6, 10],
      });
      sceAt = ctx.t;
      radio(ctx, 'LMP', 'SCE is in Aux.', 'SCE en auxiliar.');
      await ctx.say('CAPCOM', 'Apollo 12, Houston. We have got good data now.', 'Apolo 12, Houston. Ahora tenemos buenos datos.');
    };
    const { st } = await runLaunch(ctx, { callsign: 'Apollo 12', es: 'Apolo 12', during, postInsertion: false, boosterCall: false });
    if (sceAt === null) await ctx.waitUntil(() => sceAt !== null);

    // ---- in orbit: reconnect the fuel cells, then realign the platform
    const obj = ctx.objective('fc', 'Reconecta las pilas de combustible y los inversores');
    await procedure(ctx, 'lightning', { title: 'Reconexión después del rayo', pick: [1, 2, 3, 4, 5, 6], aiPace: [3, 6] });
    await ctx.waitUntil(() => !csm.lightning, { timeout: 120 });
    obj.done();
    ctx.score('fc', csm.lightning ? 30 : 100, 100, csm.lightning ? 'Pilas sin reconectar' : 'Sistema eléctrico recuperado');
    v.tm['CM.GNC.IMU.FAILED'] = false;
    sim.gnc.imuFailed = false;
    await ctx.say('CDR', "I'm not sure we didn't get hit by lightning.", 'No estoy seguro de que no nos haya caído un rayo.');
    radio(ctx, 'CAPCOM', 'Roger. We had a couple of cosmic strikes, I think.', 'Recibido. Creo que tuvimos un par de descargas cósmicas.');
    radio(ctx, 'CDR', 'Okay, we will realign the platform with the stars. We are in orbit and everything is fine.', 'Bien: realinearemos la plataforma con las estrellas. Estamos en órbita y todo está bien.');
    ctx.achievement('a12-sce');
    ctx.complete({
      summary: `El Apolo 12 está en órbita (${orbitText(st)}) después de dos rayos. ${sceAt !== null && strikeAt !== null ? `«SCE a AUX» devolvió la telemetría ${Math.round(sceAt - strikeAt)} s después de la primera descarga.` : ''} John Aaron se convirtió en leyenda.`,
      stats: { Apogeo: `${(st.apoAlt / NMI).toFixed(1)} nmi`, Perigeo: `${(st.periAlt / NMI).toFixed(1)} nmi`, 'SCE a AUX': sceAt !== null ? `T+${Math.round(sceAt)} s` : '—' },
    });
  },
};
