// Apollo 11 — "The Eagle has wings". Armstrong and Aldrin finish the LM checks, undock from
// Columbia, turn the Eagle for Collins's inspection, separate, and fly the Descent Orbit Insertion
// with the DPS (P40 in the LGC) that lowers the perilune to 50,000 ft for the powered descent.

import { GET } from '../../core/MissionClock.js';
import { NMI, DEG } from '../../core/constants.js';
import { planDOI } from '../../sim/physics/targeting.js';
import { radio, procedure, houstonPad, flyBurn, grade, orbitText, warpHint } from '../common/kit.js';

export default {
  setup: {
    get: GET(100, 5),
    config: 'CSM_LM',
    state: 'PRE_UNDOCK',
    station: 'LM',
    seat: 'CDR',
    csm: { preset: 'LUNAR_ORBIT', consumables: { spsProp: 7900 } },
    lm: 'ACTIVATED',
  },
  briefing: {
    summary:
      '20 de julio de 1969, 13ª órbita lunar. Armstrong y Aldrin ya están en el Eagle. Termina las comprobaciones, desacopla del Columbia, ' +
      'gira el LM para que Collins lo inspeccione y, detrás de la Luna, enciende el motor de descenso 30 segundos para bajar el perilunio a 15 km.',
    objectives: ['Comprobaciones finales del LM', 'Desacoplar del Columbia', 'Giro de inspección de 360°', 'Inserción en órbita de descenso (DOI) con el DPS'],
    tips: ['Q/E, W/S y A/D giran el LM', 'La DOI es un encendido de P40 en el LGC: ENG ARM DES, PGNS AUTO y PRO en V99', 'Mira al Columbia alejarse con la cámara exterior (C)'],
  },
  async run(ctx) {
    const sim = ctx.sim;
    const v = ctx.vehicle;
    ctx.caption('EL EAGLE TIENE ALAS', 'Apolo 11 · órbita lunar · GET 100:05', 6);
    radio(ctx, 'CAPCOM', 'Apollo 11, Houston. We are GO for undocking.', 'Apolo 11, Houston. Tenemos GO para el desacoplamiento.');

    // ---- LM checks
    const obj1 = ctx.objective('checks', 'Comprobaciones finales del Eagle');
    await procedure(ctx, 'lmActivation', { title: 'Comprobaciones del LM antes del desacoplamiento', pick: [5, 7, 9], aiPace: [3, 5] });
    obj1.done();

    // ---- undocking
    const obj2 = ctx.objective('undock', 'Desacopla del Columbia');
    await ctx.crew({
      id: 'a11.undock',
      title: 'DESACOPLAMIENTO',
      items: [
        { text: 'Tren de aterrizaje desplegado y bloqueado', check: (c) => !!c.vehicle.parts.lmGearDeployed },
        { text: 'MODE CONTROL PGNS — ATT HOLD', sw: { id: 'LM.GNC.MODE_CONTROL_PGNS', pos: 'ATT_HOLD' }, hint: 'Panel 3' },
        { text: 'Avisar a Columbia: «listos para desacoplar»', manual: true },
      ],
      aiPace: [3, 5],
    });
    v.request('UNDOCK', { label: 'Columbia' });
    await ctx.waitUntil(() => v.config === 'LM');
    obj2.done();
    ctx.say('CDR', 'The Eagle has wings.', 'El Eagle tiene alas.', { wait: false });
    ctx.achievement('a11-wings');

    // ---- inspection turn
    const obj3 = ctx.objective('inspect', 'Gira el Eagle 360° para la inspección de Collins');
    ctx.hint('Gira despacio sobre cualquier eje (A/D o Q/E) hasta completar una vuelta entera.', { durationS: 10 });
    let turned = 0;
    let skipped = false;
    const stopAcc = ctx.every(0.25, () => (turned += v.state.w.length() * 0.25));
    if (ctx.isController) v.controls.rhc.set(0, 0, 0.35);
    await ctx.crew({
      id: 'a11.inspect',
      title: 'GIRO DE INSPECCIÓN',
      items: [{ text: 'Girar el Eagle una vuelta completa (360°)', check: () => turned > 330 * DEG, do: () => { skipped = true; turned = 7; }, aiPassive: true, hint: 'Mantén A/D o Q/E: el giro se acumula' }],
      aiPace: [1, 2],
      aiWait: 600,
    });
    stopAcc();
    v.controls.rhc.set(0, 0, 0);
    const okTurn = !skipped;
    if (okTurn) {
      obj3.done();
      ctx.score('inspect', 60, 60, 'Giro de inspección');
    } else {
      obj3.fail();
      ctx.score('inspect', 0, 60, 'Sin giro de inspección');
    }
    await ctx.say('CMP', 'I think you have got a fine-looking flying machine there, Eagle, despite the fact you are upside down.', 'Creo que tienen una máquina voladora preciosa, Eagle, aunque estén cabeza abajo.');
    radio(ctx, 'CDR', 'Somebody is upside down.', 'Alguien está cabeza abajo.');

    // ---- separation burn by Columbia (2.5 ft/s radially)
    await ctx.wait(20);
    for (const b of sim.dyn.bodies.values()) {
      if (b.config === 'CSM') {
        const up = b.r.clone().sub(sim.dyn.moonPos).normalize();
        b.v.addScaledVector(up, -0.76);
      }
    }
    radio(ctx, 'CMP', 'Separation burn complete. See you later.', 'Encendido de separación completo. Nos vemos luego.');
    warpHint(ctx);

    // ---- DOI
    const obj4 = ctx.objective('doi', 'Inserción en órbita de descenso (DOI) con el DPS');
    await ctx.wait(240);
    const pad = await houstonPad(ctx, (c) => planDOI(c));
    const burn = await flyBurn(ctx, pad, { checklist: 'dps', replan: (c) => planDOI(c) });
    await ctx.wait(15);
    const st = v.state;
    const periFt = st.periAlt / 0.3048;
    obj4.done();
    if (st.periAlt < 3000) {
      ctx.fail('El perilunio quedó por debajo del terreno: la órbita de descenso choca con la Luna.', { stats: { Órbita: orbitText(st) } });
      return;
    }
    ctx.score('doi', grade(Math.abs(periFt - 50000), 2500, 25000, 150), 150, `Perilunio ${Math.round(periFt).toLocaleString('es')} ft`);
    ctx.score('burn', burn.missed ? 30 : 80, 80, burn.missed ? 'DOI con retraso' : 'DOI puntual');
    await ctx.say('CAPCOM', 'Eagle, Houston. We see a good DOI. You are GO for powered descent at the next pass.', 'Eagle, Houston. Vemos una buena DOI. En la próxima pasada tendrán GO para el descenso motorizado.');
    ctx.complete({
      summary: `El Eagle vuela solo en una órbita de ${orbitText(st)}. Desde aquí empezará el descenso motorizado hacia el Mar de la Tranquilidad.`,
      stats: { Perilunio: `${Math.round(periFt).toLocaleString('es')} ft`, Apolunio: `${(st.apoAlt / NMI).toFixed(1)} nmi`, 'DPS restante': `${Math.round((ctx.lm.dpsProp / ctx.lm.dpsProp0) * 100)} %` },
    });
  },
};
