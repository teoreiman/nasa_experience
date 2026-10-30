// Training — Entry practice. The CM two minutes before the entry interface at 11 km/s. Fly it by hand
// in SCS: roll the lift vector up to stay in the atmosphere without exceeding the g limit, then let the
// ELS bring the chutes out. Too shallow skips back into space; too steep crushes the crew.

import { GET } from '../../core/MissionClock.js';
import { FT } from '../../core/constants.js';
import { radio, procedure, grade } from '../common/kit.js';

export default {
  setup: {
    get: GET(194, 59),
    config: 'CM',
    state: 'PRE_ENTRY',
    station: 'CM',
    seat: 'CDR',
    csm: 'ENTRY',
    lm: null,
    maxWarp: 4,
  },
  speakers: { CAPCOM: 'Instructor' },
  briefing: {
    summary:
      'Simulador de reentrada. El módulo de mando entra a 11 km/s en un corredor de apenas 2°: demasiado rasante y rebota al espacio; demasiado empinado y la desaceleración mata. ' +
      'El CM sustenta un poco porque su centro de masa está desplazado: girándolo (alabeo) se apunta esa sustentación arriba o abajo.',
    objectives: ['Configurar EMS y paracaídas', 'Control manual (SC CONT en SCS)', 'Mantener la carga por debajo de 7 g sin rebotar', 'Amerizaje'],
    tips: ['Q / E: alabeo · sustentación arriba = alarga la reentrada, abajo = la acorta', 'Si la altitud empieza a subir después de los 6 g, gira la sustentación hacia abajo', 'El botón «Ayuda» devuelve el control al CMC'],
  },
  async run(ctx) {
    const v = ctx.vehicle;
    ctx.caption('PRÁCTICA DE REENTRADA', 'El corredor y el EMS', 5);
    let assisted = false;
    await procedure(ctx, 'entry', {
      title: 'Preparación de la reentrada',
      pick: [3, 4],
      extra: [{ text: 'SC CONT — SCS (control manual)', sw: { id: 'CM.GNC.SC_CONT', pos: 'SCS' } }],
      aiPace: [3, 5],
    });
    if (ctx.isController) ctx.sw.set('CM.GNC.SC_CONT', 'CMC', 'crew');
    radio(ctx, 'CAPCOM', 'You have manual control. Lift vector up at entry interface.', 'Tienes el control manual. Sustentación arriba en la interfaz de reentrada.');
    let maxG = 0;
    let skipped = false;
    let minAltAfterEI = Infinity;
    ctx.every(0.25, () => {
      const st = v.state;
      if (!v.parts.drogues && st.alt > 12000) maxG = Math.max(maxG, st.gLoad ?? 0);
      if (st.alt < 100000) minAltAfterEI = Math.min(minAltAfterEI, st.alt);
      if (minAltAfterEI < 70000 && st.alt > 125000) skipped = true;
    });
    ctx.spawn(() =>
      ctx.crew({
        id: 'tr.entry.fly',
        title: 'REENTRADA MANUAL',
        items: [
          { text: 'Interfaz de reentrada: sustentación arriba', check: (c) => c.vehicle.state.alt < 121920, do: (c) => { assisted = true; c.sw.set('CM.GNC.SC_CONT', 'CMC', 'crew'); } },
          { text: 'Máximo de g: no pasar de 7', check: (c) => c.vehicle.state.alt < 40000, do: (c) => { assisted = true; c.sw.set('CM.GNC.SC_CONT', 'CMC', 'crew'); } },
          { text: 'Estabilizadores y principales', check: (c) => !!c.vehicle.parts.mains },
        ],
        aiPace: [1, 2],
      }),
    );
    await ctx.waitUntil(() => skipped || v.state.splashed || v.parts.mains);
    if (skipped) {
      ctx.fail('Rebote: la nave salió de la atmósfera. Demasiado rasante (o demasiada sustentación arriba).', { stats: { 'Carga máxima': `${maxG.toFixed(1)} g` } });
      return;
    }
    if (maxG > 12) {
      ctx.fail(`Desaceleración de ${maxG.toFixed(1)} g: insoportable para la tripulación.`);
      return;
    }
    ctx.spawn(async () => {
      await ctx.waitUntil(() => v.state.alt < 3000 * FT);
      if (!v.parts.mains) {
        v.request('DROGUE_DEPLOY');
        v.request('MAIN_DEPLOY');
      }
    });
    await ctx.waitUntil(() => v.state.splashed);
    ctx.score('g', grade(maxG, 6, 10, 150), 150, `Carga máxima ${maxG.toFixed(1)} g`);
    if (assisted && !ctx.isController) ctx.penalty('assist', 60, 'Guiado del CMC');
    if (maxG < 7 && !assisted) ctx.achievement('tr-entry');
    radio(ctx, 'RECOVERY', 'Splashdown. Good entry.', 'Amerizaje. Buena reentrada.');
    ctx.complete({ summary: `Reentrada con un máximo de ${maxG.toFixed(1)} g${assisted ? ' (con ayuda del CMC)' : ''}.`, stats: { 'Carga máxima': `${maxG.toFixed(1)} g` } });
  },
};
