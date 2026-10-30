// Apollo 11 — Entry and splashdown. Fifteen minutes out: CM/SM separation, P62/P63 entry attitude,
// the 11 km/s entry interface, three minutes of radio blackout, up to 6.5 g, drogues at 24,000 ft,
// mains at 10,000 ft and splashdown near the USS Hornet southwest of Hawaii.

import { GET } from '../../core/MissionClock.js';
import { MISSION_EPOCH, FT } from '../../core/constants.js';
import { entryApproach, basisQ, geoOf, geoDistanceKm } from '../common/states.js';
import { Vector3 } from 'three';
import { radio, procedure, grade } from '../common/kit.js';

const HORNET = { lat: 13.32, lon: -169.15 };
const EI = GET(195, 3, 6);
const START = GET(194, 47, 0);

export default {
  setup() {
    const epochUTC = MISSION_EPOCH.apollo11;
    // EI point calibrated so the CMC-guided entry splashes next to the Hornet
    const s = entryApproach({ epochUTC, getEI: EI, splash: HORNET, heading: 62, ei: { lat: 3.52, lon: 167.29 }, gammaDeg: -6.48, speed: 11032, atGET: START });
    const up = s.r.clone().normalize();
    return {
      get: START,
      config: 'CSM',
      state: { r: s.r, v: s.v, q: basisQ(s.v.clone().negate(), up), w: new Vector3(), mode: 'SPACE' },
      station: 'CM',
      seat: 'CDR',
      csm: 'ENTRY',
      lm: null,
    };
  },
  briefing: {
    summary:
      '24 de julio de 1969. El Columbia cae hacia la Tierra a 11 km/s. Separa el módulo de servicio, orienta el escudo térmico hacia adelante y prepara el EMS y el sistema de paracaídas. ' +
      'Después: plasma, tres minutos de apagón de radio, 6 g y el Pacífico. El USS Hornet espera a 1.500 km al suroeste de Hawái.',
    objectives: ['Separación CM/SM', 'Actitud de reentrada (P62) y EMS', 'Atravesar la reentrada (máx. 7 g)', 'Paracaídas y amerizaje cerca del Hornet'],
    tips: ['SECS ARM antes de CM/SM SEP', 'ELS LOGIC y ELS AUTO desplegarán los paracaídas solos', 'Con SC CONT en SCS, Q/E giran el vector de sustentación'],
  },
  async run(ctx) {
    const sim = ctx.sim;
    const v = ctx.vehicle;
    ctx.caption('REENTRADA Y AMERIZAJE', 'Apolo 11 · GET 194:47', 6);
    radio(ctx, 'CAPCOM', 'Apollo 11, Houston. You are GO for CM/SM separation.', 'Apolo 11, Houston. Tienen GO para la separación CM/SM.');

    // ---- separation and entry configuration (P62 orients the CM heat shield forward)
    ctx.on('agc:program', (e) => {
      if (e.agc === 'CMC' && (e.program === '62' || e.program === '63')) {
        const vel = v.state.v.clone();
        sim.gnc.autopilot.set('ATT_MANEUVER', { dir: vel.negate(), zRef: v.state.r.clone().normalize() });
      }
    });
    const obj1 = ctx.objective('sep', 'Separa el módulo de servicio y configura la reentrada');
    await procedure(ctx, 'entry', {
      title: 'Separación CM/SM y preparación de la reentrada',
      pick: [0, 1, 3, 4],
      extra: [{ text: 'DSKY: V37 E 62 E (P62: actitud de reentrada)', check: (c) => ['62', '63', '64'].includes(c.gnc?.cmc?.program), do: (c) => c.gnc.cmc.runProgram('62'), hint: 'El CMC gira el CM con el escudo térmico hacia adelante' }],
      aiPace: [4, 7],
    });
    obj1.done();
    radio(ctx, 'CDR', 'CM/SM sep. We are in entry attitude.', 'Separación CM/SM. Estamos en actitud de reentrada.');
    await ctx.say('CAPCOM', 'Apollo 11, Houston. You are looking great. We will see you after blackout.', 'Apolo 11, Houston. Todo se ve muy bien. Los vemos después del apagón.');

    // ---- entry
    const obj2 = ctx.objective('entry', 'Atraviesa la reentrada');
    // peak deceleration of the hypersonic entry (not the parachute opening or the splash)
    let maxG = 0;
    ctx.every(0.25, () => {
      if (!v.parts.drogues && !v.parts.mains && v.state.alt > 12000) maxG = Math.max(maxG, v.state.gLoad ?? 0);
    });
    await ctx.waitUntil(() => v.state.alt < 121920);
    sim.gnc.autopilot.clear();
    ctx.caption('INTERFAZ DE REENTRADA', '400.000 pies · 11 km/s', 4);
    radio(ctx, 'PAO', 'Apollo 11 has passed the entry interface. Blackout expected shortly.', 'El Apolo 11 cruzó la interfaz de reentrada. Se espera el apagón en breve.');
    await ctx.waitUntil(() => v.state.inBlackout || v.state.alt < 50000, { timeout: 200 });
    ctx.alert('APAGÓN DE RADIO: plasma alrededor del CM', 'info', 6);
    await ctx.waitUntil(() => !v.state.inBlackout && v.state.alt < 60000);
    ctx.say('CAPCOM', 'Apollo 11, Houston. Standing by.', 'Apolo 11, Houston. A la escucha.', { wait: false });
    radio(ctx, 'CDR', 'Roger, Houston. We are through the blackout.', 'Recibido, Houston. Salimos del apagón.');
    obj2.done();
    ctx.score('g', grade(maxG, 6.5, 11, 120), 120, `Carga máxima ${maxG.toFixed(1)} g`);

    // ---- parachutes (ELS, with a safety net when it is not armed)
    const obj3 = ctx.objective('chutes', 'Paracaídas: estabilizadores a 24.000 ft, principales a 10.000 ft');
    ctx.spawn(async () => {
      await ctx.waitUntil(() => v.state.alt < 20000 * FT);
      if (!v.parts.drogues && !v.parts.mains) {
        radio(ctx, 'CAPCOM', 'Apollo 11, no drogues. Deploy drogues manually.', 'Apolo 11: no vemos los estabilizadores. Despliéguenlos a mano.');
        ctx.hint('DROGUE DEPLOY (panel 2, con tapa) o ELS LOGIC + ELS AUTO.', { durationS: 8 });
      }
      await ctx.waitUntil(() => v.state.alt < 7000 * FT);
      if (!v.parts.mains) {
        radio(ctx, 'CAPCOM', 'Mains! Deploy the mains!', '¡Principales! ¡Desplieguen los principales!');
        ctx.highlight(['CM.SEQ.MAIN_DEPLOY']);
      }
      await ctx.waitUntil(() => v.state.alt < 3000 * FT);
      if (!v.parts.mains) {
        ctx.penalty('mains', 60, 'Principales desplegados tarde (manual de emergencia)');
        if (!v.parts.drogues) v.request('DROGUE_DEPLOY');
        v.request('MAIN_DEPLOY');
      }
    });
    await ctx.waitUntil(() => v.parts.mains);
    obj3.done();
    radio(ctx, 'RECOVERY', 'Apollo 11, Recovery. We have three good chutes.', 'Apolo 11, aquí Recuperación. Vemos tres paracaídas buenos.');
    await ctx.waitUntil(() => v.state.splashed);
    const geo = geoOf(v.state.r, ctx.clock.utcMs);
    const miss = geoDistanceKm(geo.lat, geo.lon, HORNET.lat, HORNET.lon);
    ctx.score('splash', grade(miss, 25, 400, 100), 100, `Amerizaje a ${miss.toFixed(0)} km del Hornet`);
    ctx.achievement('a11-splash');
    await ctx.say('RECOVERY', 'Apollo 11, Hornet. Welcome home.', 'Apolo 11, aquí el Hornet. Bienvenidos a casa.');
    await ctx.say('PAO', 'Apollo 11 is down. The flight lasted 195 hours, 18 minutes. Man has walked on the Moon and returned.', 'El Apolo 11 amerizó. 195 horas y 18 minutos de vuelo. El hombre caminó sobre la Luna y volvió.');
    ctx.complete({
      summary: `Amerizaje a ${miss.toFixed(0)} km del USS Hornet, con un máximo de ${maxG.toFixed(1)} g. «Misión cumplida, julio de 1969».`,
      stats: { 'Carga máxima': `${maxG.toFixed(1)} g`, 'Distancia al Hornet': `${miss.toFixed(0)} km`, Posición: `${Math.abs(geo.lat).toFixed(1)}° ${geo.lat >= 0 ? 'N' : 'S'} · ${Math.abs(geo.lon).toFixed(1)}° ${geo.lon >= 0 ? 'E' : 'O'}` },
    });
  },
};
