// Training — Docking practice. The CSM already turned around, 40 m from the LM in the S-IVB adapter:
// extend the probe, line up the COAS and close at 0.1–0.3 m/s. Scored on closing speed, lateral
// offset and RCS propellant; the autopilot can take over ("Ayuda") at a cost.

import { GET } from '../../core/MissionClock.js';
import { radio, grade } from '../common/kit.js';

export default {
  setup: {
    get: GET(3, 20),
    config: 'CSM',
    state: 'TRAINING_DOCKING',
    station: 'CM',
    seat: 'CDR',
    csm: 'TLC',
    lm: 'STOWED',
    maxWarp: 2,
  },
  speakers: { CAPCOM: 'Instructor' },
  briefing: {
    summary:
      'Simulador de acoplamiento. El CSM ya hizo la transposición: el Eagle está a unos 40 metros, dentro del adaptador del S-IVB. ' +
      'Extiende la sonda, centra el blanco en el COAS y acércate despacio: más de 0,6 m/s y rebotas; menos de 0,1 m/s y los pestillos no enganchan.',
    objectives: ['Extender la sonda', 'Alinearse con el blanco', 'Acercarse a 0,1–0,3 m/s', 'Captura y acoplamiento firme'],
    tips: ['I / K: adelante / atrás · J / L: izquierda / derecha · U / O: arriba / abajo', 'Corrige la deriva lateral antes de los últimos 5 metros', 'El panel de acoplamiento muestra distancia, velocidad y desalineación'],
  },
  async run(ctx) {
    const sim = ctx.sim;
    const rcs0 = ctx.csm.smRcsKg;
    ctx.caption('PRÁCTICA DE ACOPLAMIENTO', 'Sonda, cono y COAS', 5);
    radio(ctx, 'CAPCOM', 'Okay, you have the LM about 40 meters ahead. Take your time.', 'Bien: tienes el LM unos 40 metros delante. Tómate tu tiempo.');
    let capture = null;
    let bounces = 0;
    ctx.on('vehicle:event', (e) => {
      if (e.kind === 'DOCK_CAPTURE') capture = e;
      if (e.kind === 'DOCK_BOUNCE') {
        bounces++;
        ctx.alert(`Rebote a ${e.closing.toFixed(2)} m/s`, 'caution');
        ctx.penalty(`bounce${bounces}`, 20, 'Rebote');
      }
    });
    let assisted = false;
    const autopilot = (c) => {
      if (c.gnc.autopilot.mode === 'DOCKING') return;
      assisted = !ctx.isController;
      c.sw.set('CM.DOCK.PROBE', 'EXTEND', 'crew');
      c.gnc.autopilot.set('DOCKING', {});
    };
    const tel = () => sim.dyn.dockingTelemetry?.();
    await ctx.crew({
      id: 'tr.dock',
      title: 'ACOPLAMIENTO',
      items: [
        { text: 'DOCK PROBE — EXTEND', sw: { id: 'CM.DOCK.PROBE', pos: 'EXTEND' } },
        { text: 'Centrar el blanco en el COAS (desalineación < 3°)', check: () => !!capture || (tel()?.misalign ?? 90) < 3, do: autopilot },
        { text: 'Acercarse por debajo de 0,3 m/s', check: () => { const t = tel(); return !!capture || (!!t && t.range < 5 && -t.rangeRate < 0.35); }, do: autopilot },
        { text: 'Captura', check: () => !!capture, do: autopilot },
      ],
      aiPace: [1, 2],
    });
    await ctx.waitUntil(() => !!capture || !!sim.dyn._captured);
    sim.gnc.autopilot.clear();
    await ctx.crew({ id: 'tr.dock.hard', title: 'ACOPLAMIENTO FIRME', items: [{ text: 'DOCK PROBE — RETRACT', sw: { id: 'CM.DOCK.PROBE', pos: 'RETRACT' }, check: (c) => c.vehicle.config !== 'CSM' }], aiPace: [2, 3] });
    const closing = capture?.closing ?? 0.2;
    const lateral = capture?.lateral ?? 0.1;
    const used = rcs0 - ctx.csm.smRcsKg;
    ctx.score('closing', grade(Math.abs(closing - 0.15), 0.05, 0.45, 100), 100, `Cierre a ${closing.toFixed(2)} m/s`);
    ctx.score('lateral', grade(lateral, 0.05, 0.3, 60), 60, `Desalineación ${(lateral * 100).toFixed(0)} cm`);
    ctx.score('rcs', grade(used, 15, 70, 40), 40, `RCS ${used.toFixed(0)} kg`);
    if (assisted) ctx.penalty('assist', 80, 'Piloto automático');
    if (closing < 0.2 && !assisted && !bounces) ctx.achievement('tr-dock');
    radio(ctx, 'CAPCOM', 'Hard dock. Nice job.', 'Acoplamiento firme. Buen trabajo.');
    ctx.complete({ summary: `Acoplado a ${closing.toFixed(2)} m/s con ${(lateral * 100).toFixed(0)} cm de desalineación, ${bounces} rebote(s) y ${used.toFixed(0)} kg de RCS.`, stats: { Cierre: `${closing.toFixed(2)} m/s`, Desalineación: `${(lateral * 100).toFixed(0)} cm`, RCS: `${used.toFixed(0)} kg` } });
  },
};
