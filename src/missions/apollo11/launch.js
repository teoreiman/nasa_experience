// Apollo 11 — Launch. Final countdown from T−3:30 (the count holds at T−1:00 if the cockpit is not
// configured), the GO/NO-GO poll, liftoff, the ascent with the abort-mode callouts, tower jettison
// flown by the crew and insertion into the 100 nmi parking orbit, then the post-insertion checklist.

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
      'Cabo Kennedy, 16 de julio de 1969, 9:32 de la mañana. Armstrong, Collins y Aldrin esperan en la cima de 110 metros del Saturn V SA-506. ' +
      'Termina la configuración de la cabina antes de T−1:00 (si no, la cuenta se detiene), vigila el ascenso, desecha la torre de escape a tiempo y llega a la órbita de 100 millas náuticas.',
    objectives: ['Configurar la cabina para el lanzamiento', 'Desechar la torre de escape (TWR JETT)', 'Inserción en órbita de 100 nmi', 'Lista posterior a la inserción'],
    tips: ['Clic derecho (o pulsación larga) abre las tapas protectoras de los interruptores', 'V cambia de cámara: prueba la torre y la cámara a bordo', 'B abre el manual de procedimientos'],
  },
  async run(ctx) {
    ctx.caption('APOLO 11', 'Complejo de lanzamiento 39A — 16 de julio de 1969', 6);
    radio(ctx, 'PAO', 'This is Apollo Saturn launch control. T minus 3 minutes 30 seconds and counting. All going well.', 'Aquí control de lanzamiento del Apolo Saturno. T menos 3 minutos 30 segundos y contando. Todo marcha bien.');
    const t0 = ctx.t;
    const { st, cfgTime, errA, errP } = await runLaunch(ctx, { callsign: 'Apollo 11', es: 'Apolo 11' });
    ctx.achievement('a11-launch');
    if (errA + errP < 4) ctx.achievement('a11-orbit-precise');
    await ctx.say('PAO', 'This is Apollo Control. Apollo 11 is in a near-perfect parking orbit. Next stop: the translunar injection.', 'Aquí Control Apolo. El Apolo 11 está en una órbita de aparcamiento casi perfecta. Próxima parada: la inyección translunar.');
    ctx.complete({
      summary: `El Apolo 11 está en órbita terrestre: ${orbitText(st)}. Configuración de cabina en ${Math.round(cfgTime)} s.`,
      stats: { Apogeo: `${(st.apoAlt / NMI).toFixed(1)} nmi`, Perigeo: `${(st.periAlt / NMI).toFixed(1)} nmi`, 'Tiempo de cuenta': `${Math.round(ctx.t - t0)} s` },
    });
  },
};
