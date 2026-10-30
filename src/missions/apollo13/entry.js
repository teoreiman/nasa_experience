// Apollo 13 — Entry. An hour before entry the crew says goodbye to Aquarius, the lifeboat that kept
// them alive for four days. Then the shallowest-margin entry of the program and a radio blackout
// that lasted a minute and a half longer than expected, before "Okay, Joe" and three good chutes over
// the South Pacific.

import { Vector3 } from 'three';
import { GET } from '../../core/MissionClock.js';
import { FT } from '../../core/constants.js';
import { apollo13State, basisQ, geoOf, geoDistanceKm } from '../common/states.js';
import { radio, procedure, grade } from '../common/kit.js';

const IWO_JIMA = { lat: -21.63, lon: -165.37 };

export default {
  async setup() {
    const s = await apollo13State(GET(141, 20));
    const up = s.r.clone().normalize();
    return {
      get: s.get,
      config: 'CM_LM',
      state: { r: s.r, v: s.v, q: basisQ(s.v.clone().negate(), up), w: new Vector3(), mode: 'SPACE' },
      station: 'CM',
      seat: 'CDR',
      csm: 'ENTRY',
      lm: 'LIFEBOAT',
      maxWarp: 10,
    };
  },
  briefing: {
    summary:
      '17 de abril de 1970. El módulo de servicio ya quedó atrás. Queda despedirse del Aquarius, que mantuvo vivos a tres hombres durante cuatro días, y entrar en la atmósfera con un escudo térmico que estuvo días a temperaturas bajo cero. ' +
      'Nadie sabe si sobrevivió al frío. El apagón de radio durará más de lo esperado.',
    objectives: ['Separar el LM Aquarius', 'Configurar la reentrada (EMS, ELS, P62)', 'Atravesar el apagón de radio', 'Paracaídas y amerizaje'],
    tips: ['El LM se separa desde el túnel: el botón de la lista lo hace por ti', 'ELS LOGIC y ELS AUTO despliegan los paracaídas'],
  },
  async run(ctx) {
    const sim = ctx.sim;
    const v = ctx.vehicle;
    ctx.csm.hasSM = false;
    ctx.csm.poweredDown = false;
    ctx.caption('REENTRADA', 'Apolo 13 · GET 141:20', 6);

    // ---- farewell, Aquarius
    const obj1 = ctx.objective('lmjett', 'Separa el LM Aquarius');
    await ctx.say('CAPCOM', 'Okay, Odyssey. You are GO for LM jettison.', 'Bien, Odyssey. Tienen GO para separar el LM.');
    await ctx.crew({
      id: 'a13.lmjett',
      title: 'SEPARACIÓN DEL LM',
      items: [
        { text: 'Escotilla del túnel cerrada y presión comprobada', manual: true },
        { text: 'LM JETT: soltar el Aquarius', check: (c) => c.vehicle.config === 'CM', do: (c) => c.vehicle.request('LM_JETT', { label: 'Aquarius' }) },
      ],
      aiPace: [5, 8],
    });
    await ctx.waitUntil(() => v.config === 'CM');
    obj1.done();
    await ctx.say('CAPCOM', 'Farewell, Aquarius, and we thank you.', 'Adiós, Aquarius, y gracias.');
    ctx.achievement('a13-farewell');

    // ---- entry configuration
    ctx.on('agc:program', (e) => {
      if (e.agc === 'CMC' && (e.program === '62' || e.program === '63')) sim.gnc.autopilot.set('ATT_MANEUVER', { dir: v.state.v.clone().negate(), zRef: v.state.r.clone().normalize() });
    });
    const obj2 = ctx.objective('cfg', 'Configura la reentrada');
    await procedure(ctx, 'entry', {
      title: 'Preparación de la reentrada',
      pick: [3, 4],
      extra: [{ text: 'DSKY: V37 E 62 E (P62: actitud de reentrada)', check: (c) => ['62', '63', '64'].includes(c.gnc?.cmc?.program), do: (c) => c.gnc.cmc.runProgram('62') }],
      aiPace: [4, 7],
    });
    obj2.done();

    // ---- entry and the long blackout
    const obj3 = ctx.objective('entry', 'Atraviesa la reentrada');
    let maxG = 0;
    ctx.every(0.25, () => {
      if (!v.parts.drogues && !v.parts.mains && v.state.alt > 12000) maxG = Math.max(maxG, v.state.gLoad ?? 0);
    });
    await ctx.waitUntil(() => v.state.alt < 121920);
    sim.gnc.autopilot.clear();
    ctx.caption('INTERFAZ DE REENTRADA', '400.000 pies', 4);
    await ctx.waitUntil(() => v.state.inBlackout || v.state.alt < 50000, { timeout: 200 });
    const tB = ctx.t;
    ctx.alert('APAGÓN DE RADIO', 'info', 6);
    radio(ctx, 'PAO', 'We are in the blackout period. We expect about 3 minutes.', 'Estamos en el apagón. Esperamos unos 3 minutos.');
    await ctx.waitUntil(() => !v.state.inBlackout && v.state.alt < 60000);
    const tAOS = ctx.t;
    await ctx.wait(30);
    ctx.say('CAPCOM', 'Odyssey, Houston. Standing by. Over.', 'Odyssey, Houston. A la escucha. Cambio.', { wait: false, force: true });
    await ctx.wait(20);
    await ctx.say('CMP', 'Okay, Joe.', 'Bien, Joe.');
    radio(ctx, 'CAPCOM', 'Okay. We read you, Jack.', 'Bien. Te escuchamos, Jack.');
    obj3.done();
    ctx.score('g', grade(maxG, 6.5, 11, 100), 100, `Carga máxima ${maxG.toFixed(1)} g`);

    // ---- chutes
    const obj4 = ctx.objective('chutes', 'Paracaídas y amerizaje');
    ctx.spawn(async () => {
      await ctx.waitUntil(() => v.state.alt < 3000 * FT);
      if (!v.parts.mains) {
        ctx.penalty('mains', 60, 'Principales desplegados tarde');
        if (!v.parts.drogues) v.request('DROGUE_DEPLOY');
        v.request('MAIN_DEPLOY');
      }
    });
    await ctx.waitUntil(() => v.parts.mains);
    radio(ctx, 'CAPCOM', 'Odyssey, Houston. We show you on the mains. It really looks great.', 'Odyssey, Houston. Los vemos con los principales. Se ve realmente bien.');
    await ctx.waitUntil(() => v.state.splashed);
    obj4.done();
    const geo = geoOf(v.state.r, ctx.clock.utcMs);
    const miss = geoDistanceKm(geo.lat, geo.lon, IWO_JIMA.lat, IWO_JIMA.lon);
    ctx.achievement('a13-home');
    await ctx.say('RECOVERY', 'Odyssey, this is Iwo Jima. We have you in sight. Welcome home.', 'Odyssey, aquí el Iwo Jima. Los tenemos a la vista. Bienvenidos a casa.');
    await ctx.say('PAO', 'Apollo 13 is home. A successful failure.', 'El Apolo 13 está en casa. Un fracaso exitoso.');
    ctx.complete({
      summary: `Amerizaje en el Pacífico Sur tras ${Math.round(ctx.t / 3600)} horas de vuelo. Máximo de ${maxG.toFixed(1)} g y ${Math.round(tAOS - tB)} s de apagón de radio.`,
      stats: { 'Carga máxima': `${maxG.toFixed(1)} g`, 'Distancia al Iwo Jima': `${miss.toFixed(0)} km`, Posición: `${Math.abs(geo.lat).toFixed(1)}° ${geo.lat >= 0 ? 'N' : 'S'} · ${Math.abs(geo.lon).toFixed(1)}° ${geo.lon >= 0 ? 'E' : 'O'}` },
    });
  },
};
