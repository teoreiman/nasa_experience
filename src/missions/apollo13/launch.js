// Apollo 13 — Launch. The count, liftoff and ascent as Apollo 11, until T+5:30 when pogo
// oscillations shut down the S-II centre engine two minutes early. The IU flies the four outboard
// J-2s 34 s longer and the S-IVB 9 s longer; BOOSTER has to call it right.

import { GET } from '../../core/MissionClock.js';
import { NMI } from '../../core/constants.js';
import { radio, orbitText } from '../common/kit.js';
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
      '11 de abril de 1970, 13:13 hora de Florida. Lovell, Swigert y Haise en el Saturn V SA-508. A los cinco minutos y medio, unas oscilaciones «pogo» de 68 g en el motor central del S-II lo apagan solo. ' +
      'El ordenador del Instrument Unit compensa quemando más tiempo los otros cuatro. ¿Seguimos?',
    objectives: ['Configurar la cabina para el lanzamiento', 'Desechar la torre de escape', 'Decidir sobre el motor central del S-II', 'Inserción en órbita'],
    tips: ['El apagado del motor central es un aviso, no un aborto: el IU recalcula', 'La cámara a bordo (V) muestra el S-II'],
  },
  async run(ctx) {
    const sat = ctx.saturn;
    ctx.caption('APOLO 13', 'Complejo 39A — 11 de abril de 1970', 6);
    radio(ctx, 'PAO', 'This is Apollo Saturn launch control. T minus 3 minutes 30 seconds and counting.', 'Aquí control de lanzamiento del Apolo Saturno. T menos 3 minutos 30 segundos y contando.');
    let decision = null;
    const during = async () => {
      await ctx.waitUntil(() => sat.done.has('SII_CECO'));
      if (ctx.t > 420) return;
      ctx.dropWarp();
      ctx.alert('S-II: apagado del motor central (pogo) 2 minutos antes de tiempo', 'caution', 7);
      await ctx.say('CDR', 'Houston, we have had an inboard out on the S-II.', 'Houston, se nos apagó el motor central del S-II.');
      const res = await ctx.ground({
        id: 'a13.booster.ceco',
        console: 'BOOSTER',
        kind: 'diagnose',
        title: 'Motor central del S-II apagado',
        prompt: 'El motor 5 del S-II se apagó a T+5:30 (oscilaciones pogo). Los otros cuatro J-2 están bien y el IU alarga sus encendidos. La capacidad de llegar a la órbita se mantiene. ¿Qué recomiendas?',
        options: [
          { id: 'go', label: 'Seguimos GO: el IU compensa con los cuatro exteriores y el S-IVB', correct: true, say: [{ who: 'BOOSTER', en: 'Flight, Booster. We lost the center engine. The rest are good, we are GO.', es: 'Flight, BOOSTER. Perdimos el motor central; los demás están bien. Seguimos GO.', channel: 'loop' }, { who: 'CAPCOM', en: 'Thirteen, Houston. We confirm the center engine out. Everything else is GO.', es: 'Trece, Houston. Confirmamos el motor central apagado. Todo lo demás está GO.' }] },
          { id: 'abort', label: 'Abortar en modo 2 (a la deriva al Atlántico)', correct: false, say: { who: 'FLIGHT', en: 'Negative, Booster. We still have orbit capability.', es: 'Negativo, BOOSTER: todavía podemos llegar a la órbita.', channel: 'loop' } },
          { id: 'mode4', label: 'Modo 4: insertar con el SPS', correct: false, say: { who: 'FLIGHT', en: 'Not needed, Booster. The S-IVB has the margin.', es: 'No hace falta, BOOSTER: el S-IVB tiene margen.', channel: 'loop' } },
        ],
        timeout: 25,
        aiDelay: 4,
        evidence: ['SAT.SII.ENGINES'],
        score: { key: 'ceco', points: 80 },
      });
      decision = res.choice;
      radio(ctx, 'CDR', 'Roger. The other four are burning fine.', 'Recibido. Los otros cuatro van bien.');
    };
    const { st, cfgTime } = await runLaunch(ctx, { callsign: 'Thirteen', es: 'Trece', target: { apo: 100.3, peri: 98.0 }, during });
    ctx.achievement('a13-launch');
    await ctx.say('PAO', 'This is Apollo Control. Despite the early centre engine cutoff, Apollo 13 is in a good parking orbit.', 'Aquí Control Apolo. Pese al apagado prematuro del motor central, el Apolo 13 está en una buena órbita de aparcamiento.');
    ctx.complete({
      summary: `El Apolo 13 está en órbita: ${orbitText(st)}. ${decision === 'go' || decision === null ? 'El IU compensó el motor perdido, como esperaba BOOSTER.' : 'Por suerte FLIGHT no siguió la recomendación de abortar.'}`,
      stats: { Apogeo: `${(st.apoAlt / NMI).toFixed(1)} nmi`, Perigeo: `${(st.periAlt / NMI).toFixed(1)} nmi`, 'Configuración de cabina': `${Math.round(cfgTime)} s` },
    });
  },
};
