// Training — Launch spectator. A Saturn V launch with a camera director: the mobile launcher deck at
// ignition, the umbilical tower, the press site, the chase camera through max-Q, the onboard camera
// at staging and the cockpit for orbit insertion. The crew still has to fly the checklists.

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
      'Un lanzamiento del Saturn V con director de cámaras: la plataforma del lanzador móvil en la ignición, la torre umbilical, el sitio de prensa a 5 km, la cámara de persecución en la máxima presión dinámica y la cámara a bordo en la separación del S-IC. ' +
      'La tripulación igual tiene que hacer sus listas.',
    objectives: ['Configurar la cabina', 'Disfrutar del despegue', 'Desechar la torre', 'Llegar a la órbita'],
    tips: ['V cambia de cámara cuando quieras', 'C vuelve a la cabina', 'La cámara a bordo muestra la separación de las etapas'],
  },
  async run(ctx) {
    ctx.caption('LANZAMIENTO LIBRE', 'El Saturn V desde todas las cámaras', 6);
    radio(ctx, 'PAO', 'This is Apollo Saturn launch control. T minus 3 minutes 30 seconds and counting.', 'Aquí control de lanzamiento del Apolo Saturno. T menos 3 minutos 30 segundos y contando.');
    const view = ctx.view;
    const cam = (mode) => {
      if (view?.availableCameras?.().includes(mode)) view.setCamera(mode);
    };
    const director = async () => {
      cam('pad:deck');
      await ctx.wait(7);
      cam('pad:tower');
      await ctx.wait(10);
      cam('pad:far');
      await ctx.waitGET(55);
      cam('exterior:chase');
      await ctx.waitUntil(() => ctx.saturn.done.has('SIC_SEP'));
      cam('onboard');
      await ctx.wait(40);
      cam('exterior:chase');
      await ctx.waitUntil(() => ctx.saturn.done.has('SII_SEP'));
      cam('cockpit');
    };
    ctx.spawn(async () => {
      if (ctx.t < -9) await ctx.waitGET(-9);
      await director();
    });
    const { st } = await runLaunch(ctx, { callsign: 'Apollo', es: 'Apolo' });
    ctx.achievement('tr-launch');
    ctx.complete({ summary: `En órbita: ${orbitText(st)}.`, stats: { Apogeo: `${(st.apoAlt / NMI).toFixed(1)} nmi`, Perigeo: `${(st.periAlt / NMI).toFixed(1)} nmi` } });
  },
};
