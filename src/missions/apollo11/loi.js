// Apollo 11 — Lunar Orbit Insertion. Approaching the Moon on a hyperbola: Houston's LOI PAD, the
// GO before loss of signal, the six-minute SPS burn flown alone behind the Moon, and the anxious
// wait for acquisition of signal on the other side. RETRO prepares the abort PAD on the ground.

import { GET } from '../../core/MissionClock.js';
import { NMI } from '../../core/constants.js';
import { planLOI } from '../../sim/physics/targeting.js';
import { radio, houstonPad, flyBurn, grade, orbitText, warpHint, waitLOS, waitAOS } from '../common/kit.js';

export default {
  setup: {
    get: GET(75, 30),
    config: 'CSM_LM',
    state: 'PRE_LOI',
    station: 'CM',
    seat: 'CDR',
    csm: 'TLC',
    lm: 'STOWED',
  },
  briefing: {
    summary:
      'Tres días después de dejar la Tierra, Columbia y Eagle caen hacia la Luna a 2,5 km/s. Para quedarse en órbita, el SPS tiene que frenar casi 900 m/s ' +
      'detrás de la Luna, donde no hay radio con Houston. Si el motor falla, la trayectoria de retorno libre los devuelve a casa; si se pasa de tiempo, chocan contra la Luna.',
    objectives: ['Recibir el PAD de la LOI y el GO', 'Configurar el SPS (P30 / P40)', 'Encendido de ~6 minutos detrás de la Luna', 'Órbita de 60 × 170 nmi'],
    tips: ['En V99, PRO (tecla P sobre el DSKY) autoriza el encendido', 'Sin señal (LOS) no se oye a Houston', 'El ordenador apaga el motor solo cuando Vg llega a cero'],
  },
  async run(ctx) {
    const v = ctx.vehicle;
    ctx.caption('INSERCIÓN EN ÓRBITA LUNAR', 'Apolo 11 · GET 75:30', 6);
    radio(ctx, 'PAO', 'This is Apollo Control. Apollo 11 is now 9,000 miles from the Moon, approaching at 4,000 miles per hour.', 'Aquí Control Apolo. El Apolo 11 está a 15.000 km de la Luna y se acerca a 6.400 km/h.');

    // ---- PAD and GO
    const obj1 = ctx.objective('pad', 'Recibe el PAD de la LOI');
    const pad = await houstonPad(ctx, (c) => planLOI(c));
    obj1.done();
    ctx.spawn(() =>
      ctx.ground({
        id: 'a11.retro.abort',
        console: 'RETRO',
        kind: 'uplink',
        title: 'PAD de aborto',
        prompt: 'Si la LOI falla detrás de la Luna, la tripulación necesita un PAD de regreso directo (TEI-1). ¿Lo envías antes de la pérdida de señal?',
        options: [
          { id: 'send', label: 'Enviar el PAD de aborto TEI-1', correct: true, say: { who: 'RETRO', en: 'Flight, Retro. Abort PADs are up.', es: 'Flight, RETRO. Los PAD de aborto están enviados.', channel: 'loop' } },
          { id: 'skip', label: 'No hace falta', correct: false, say: { who: 'FLIGHT', en: 'Retro, we always send the abort PADs.', es: 'RETRO, siempre enviamos los PAD de aborto.', channel: 'loop' } },
        ],
        timeout: 45,
        aiDelay: 4,
        score: { key: 'retro', points: 40 },
      }),
    );
    warpHint(ctx);

    // ---- the burn (with the GO call before LOS)
    const obj2 = ctx.objective('burn', 'Encendido de la LOI detrás de la Luna');
    ctx.spawn(async () => {
      await ctx.waitUntil(() => v.state.losEarth || ctx.t > pad.tig - 600);
      if (!v.state.losEarth) {
        await ctx.say('CAPCOM', 'Apollo 11, this is Houston. All your systems are looking good going around the corner, and we will see you on the other side. Over.', 'Apolo 11, aquí Houston. Todos sus sistemas se ven bien al doblar la esquina; nos vemos al otro lado.');
        radio(ctx, 'CDR', 'Roger. Everything looks OK up here.', 'Recibido. Todo se ve bien aquí arriba.');
      }
      await waitLOS(ctx);
      ctx.alert('LOS: pérdida de señal detrás de la Luna', 'info', 6);
      radio(ctx, 'PAO', 'We have loss of signal. Apollo 11 is behind the Moon.', 'Perdimos la señal. El Apolo 11 está detrás de la Luna.');
    });
    const burn = await flyBurn(ctx, pad, { checklist: 'sps', replan: (c) => planLOI(c) });
    obj2.done();
    await ctx.wait(20);
    const st = v.state;
    const closed = st.primary === 'MOON' && Number.isFinite(st.apoAlt);
    if (!closed || st.periAlt < 15000) {
      ctx.fail(closed ? 'El perilunio quedó demasiado bajo: la órbita corta la superficie.' : 'El SPS no frenó lo suficiente: la nave no quedó en órbita lunar.', { stats: { Órbita: orbitText(st) } });
      return;
    }
    radio(ctx, 'CDR', 'Burn complete. We are in lunar orbit.', 'Encendido completo. Estamos en órbita lunar.', { channel: 'ic' });
    const apo = st.apoAlt / NMI;
    const peri = st.periAlt / NMI;
    ctx.score('orbit', grade(Math.abs(apo - 170) + Math.abs(peri - 60), 6, 60, 150), 150, `Órbita ${apo.toFixed(1)} × ${peri.toFixed(1)} nmi`);
    ctx.score('burn', burn.missed ? 40 : 100, 100, burn.missed ? 'Ignición retrasada' : 'Ignición puntual');
    ctx.achievement('a11-loi');

    // ---- acquisition of signal
    const obj3 = ctx.objective('aos', 'Espera la adquisición de señal (AOS)');
    await waitAOS(ctx);
    obj3.done();
    ctx.alert('AOS: señal adquirida', 'info', 5);
    await ctx.say('CAPCOM', 'Apollo 11, Apollo 11, this is Houston. Do you read? Over.', 'Apolo 11, Apolo 11, aquí Houston. ¿Nos copian?');
    await ctx.say('CDR', 'Read you loud and clear, Houston. It was like perfect.', 'Los recibimos fuerte y claro, Houston. Fue como perfecto.');
    await ctx.say('CAPCOM', 'Roger. We copy your burn status report. We are all breathing again.', `Recibido, copiamos el informe del encendido: ${orbitText(st)}. Todos respiramos de nuevo.`);
    radio(ctx, 'LMP', 'The view of the Moon out the window is magnificent. It looks like a giant plaster model.', 'La vista de la Luna por la ventana es magnífica. Parece una gigantesca maqueta de yeso.');
    await ctx.wait(10);
    ctx.complete({
      summary: `Columbia y Eagle en órbita lunar: ${orbitText(st)}. Al día siguiente, el Eagle bajará hacia el Mar de la Tranquilidad.`,
      stats: { Apolunio: `${apo.toFixed(1)} nmi`, Perilunio: `${peri.toFixed(1)} nmi`, 'SPS restante': `${(ctx.csm.spsProp / 1000).toFixed(1)} t` },
    });
  },
};
