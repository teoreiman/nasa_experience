// Training — Landing practice in the LM Mission Simulator. Pick the scenario: the full powered
// descent from PDI, the approach from the high gate (P64, 7,000 ft) or just the last 300 ft in P66.
// Scored on touchdown rates, fuel and distance to the target; the autopilot can land for you.

import { Vector3, Quaternion } from 'three';
import { GET } from '../../core/MissionClock.js';
import { FT } from '../../core/constants.js';
import { SITES, siteDir } from '../../sim/terrain/lunarTerrain.js';
import { GNCHost } from '../../sim/gnc/GNCHost.js';
import { radio, grade } from '../common/kit.js';

const PDI = GET(102, 33, 5);

export default {
  setup: {
    get: PDI,
    config: 'LM',
    state: 'PRE_PDI',
    station: 'LM',
    seat: 'CDR',
    csm: null,
    lm: 'PRE_PDI',
    maxWarp: 4,
  },
  speakers: { CAPCOM: 'Instructor' },
  briefing: {
    summary:
      'Simulador del módulo lunar (LMS) en Cabo Kennedy. Armstrong voló cientos de aproximaciones aquí antes del Apolo 11. ' +
      'Elige el escenario y aluniza en el Mar de la Tranquilidad: menos de 3 ft/s de velocidad vertical, casi sin deriva y con combustible de sobra.',
    objectives: ['Elegir el escenario', 'Volar la aproximación', 'Alunizar suavemente', 'Apagar el motor'],
    tips: ['P66: Inicio / Fin cambian la velocidad de descenso de a 1 ft/s', 'W/A/S/D inclinan el LM para anular la deriva', 'El botón «Ayuda» de la lista activa el piloto automático (resta puntos)'],
  },
  async run(ctx) {
    const sim = ctx.sim;
    const v = ctx.vehicle;
    const lm = ctx.lm;
    const g = sim.gnc.lmGuidance;
    const site = siteDir(SITES.TRANQUILITY);
    g.setSite(site);
    ctx.caption('PRÁCTICA DE ALUNIZAJE', 'Simulador del módulo lunar', 5);
    const scen = await ctx.choice({
      id: 'tr.land.scen',
      title: 'Escenario',
      prompt: '¿Desde dónde quieres empezar?',
      options: [
        { id: 'p66', label: 'Los últimos 300 pies (P66, 1 minuto)' },
        { id: 'p64', label: 'Desde la puerta alta (P64, 7.000 ft, 3 minutos)' },
        { id: 'pdi', label: 'Descenso completo desde el PDI (12 minutos)' },
      ],
      timeout: 60,
      defaultOption: 'p66',
    });
    v.sw.set('LM.ENG.ENG_ARM', 'DES', 'script');
    v.sw.set('LM.GNC.MODE_CONTROL_PGNS', 'AUTO', 'script');
    v.sw.set('LM.RADAR.RR_MODE', 'LGC', 'script');
    if (scen === 'pdi') {
      // the state was the PDI point when the chapter started: a late ignition lands long
      sim.gnc.startDescent(site);
      if (ctx.t - PDI > 1) g.shiftSiteDownrange((ctx.t - PDI) * v.state.vSurface.length());
    } else {
      // place the LM on the approach to the site (moon-fixed frame, westward like Apollo 11)
      const st = v.state;
      const moonPos = sim.dyn.moonPos;
      const sitePos = g._sitePos().clone();
      const up = sitePos.clone().sub(moonPos).normalize();
      const hM = new Vector3().crossVectors(moonPos, sim.dyn.moonVel).normalize();
      const fwd = new Vector3().crossVectors(hM, up).normalize().negate();
      const ground = sim.dyn.terrainHeightAt(sitePos.clone().sub(moonPos)) ?? 0;
      const [h, back, vf, vd, fuel] = scen === 'p64' ? [2150, 7600, 150, 30, 0.3] : [92, 75, 6, 1.8, 0.12];
      st.r.copy(sitePos).addScaledVector(up, ground + h).addScaledVector(fwd, -back);
      const rRel = st.r.clone().sub(moonPos);
      const omega = new Vector3(0, 0, (2 * Math.PI) / (27.321661 * 86400));
      st.v.copy(sim.dyn.moonVel).add(new Vector3().crossVectors(omega, rRel)).addScaledVector(fwd, vf).addScaledVector(up, -vd);
      const thrustDir = scen === 'p64' ? up.clone().multiplyScalar(0.75).addScaledVector(fwd, -0.66).normalize() : up.clone();
      st.q.copy(GNCHost.attitudeFor(thrustDir, fwd, new Quaternion()));
      st.w.set(0, 0, 0);
      lm.dpsProp = lm.dpsProp0 * fuel;
      g.t0 = ctx.t - 420;
      g.t64 = 0;
      sim.gnc.lgc.runProgram(scen === 'p64' ? '64' : '66');
      g.setPhase(scen === 'p64' ? '64' : '66');
      if (scen === 'p66') g.rodCmd = -vd;
    }
    const autoland = ctx.isController || ctx.difficulty === 'cadet';
    if (autoland) sim.gnc.autopilot.set('LANDING');
    let assisted = false;
    const help = (c) => {
      if (c.gnc.autopilot.mode === 'LANDING') return;
      assisted = !ctx.isController;
      c.gnc.autopilot.set('LANDING');
    };
    // callouts
    const marks = [2000, 1000, 500, 300, 200, 100, 75, 50, 30, 20, 10];
    let mi = 0;
    ctx.every(0.25, () => {
      const h = (v.state.altTerrain ?? v.state.alt) / FT;
      while (mi < marks.length && h < marks[mi]) {
        if (h > marks[mi] - 40 || marks[mi] <= 100) radio(ctx, 'LMP', `${marks[mi]} feet, down ${Math.abs(v.state.hdot / FT).toFixed(0)}.`, `${marks[mi]} pies, bajando a ${Math.abs(v.state.hdot / FT).toFixed(0)}.`);
        mi++;
      }
    });
    ctx.spawn(() =>
      ctx.crew({
        id: 'tr.land',
        title: 'ALUNIZAJE',
        items: [
          { text: 'P66: velocidad de descenso con Inicio / Fin', check: (c) => c.gnc.lgc.program === '66' || c.vehicle.state.landed, do: help },
          { text: 'Anular la deriva horizontal (W/A/S/D)', check: (c) => c.vehicle.state.landed || !!c.tm['LM.GNC.CONTACT_LIGHT'], do: help },
          { text: 'Contacto: ENGINE STOP', check: (c) => c.vehicle.state.landed, do: help },
        ],
        aiPace: [1, 2],
      }),
    );
    let td = null;
    ctx.on('vehicle:event', (e) => e.kind === 'TOUCHDOWN' && (td = e));
    await ctx.waitUntil(() => !!td || lm.dpsProp <= 0, { timeout: 1200 });
    if (!td) await ctx.waitUntil(() => !!td, { timeout: 120 });
    if (!td || td.crash) {
      ctx.fail(td ? `Impacto a ${(td.vSpeed / FT).toFixed(1)} ft/s vertical, ${(td.hSpeed / FT).toFixed(1)} ft/s de deriva.` : 'Sin combustible antes de tocar la superficie.', { stats: td ? { 'Vel. vertical': `${(td.vSpeed / FT).toFixed(1)} ft/s`, Deriva: `${(td.hSpeed / FT).toFixed(1)} ft/s` } : {} });
      return;
    }
    radio(ctx, 'LMP', 'Contact light. Engine stop.', 'Luz de contacto. Motor parado.');
    const fuel = (lm.dpsProp / lm.dpsProp0) * 100;
    const miss = Math.hypot(td.local?.x ?? 0, td.local?.y ?? 0);
    ctx.score('vspeed', grade(td.vSpeed / FT, 1.5, 7, 100), 100, `Contacto a ${(td.vSpeed / FT).toFixed(1)} ft/s`);
    ctx.score('hspeed', grade(td.hSpeed / FT, 0.5, 4, 60), 60, `Deriva ${(td.hSpeed / FT).toFixed(1)} ft/s`);
    ctx.score('fuel', grade(fuel, scen === 'p66' ? 9 : 7, 1, 40), 40, `Combustible ${fuel.toFixed(1)} %`);
    if (assisted) ctx.penalty('assist', 100, 'Piloto automático');
    if (!assisted && !autoland) ctx.achievement('tr-land');
    ctx.complete({ summary: `Alunizaje a ${(td.vSpeed / FT).toFixed(1)} ft/s con ${fuel.toFixed(1)} % de combustible, a ${Math.round(miss)} m del blanco.`, stats: { Escenario: scen.toUpperCase(), 'Vel. vertical': `${(td.vSpeed / FT).toFixed(1)} ft/s`, Deriva: `${(td.hSpeed / FT).toFixed(1)} ft/s`, Combustible: `${fuel.toFixed(1)} %` } });
  },
};
