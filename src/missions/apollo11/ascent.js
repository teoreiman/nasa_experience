// Apollo 11 — Lunar liftoff and rendezvous. The ENG ARM breaker broken off by a backpack (Aldrin's
// felt-tip pen), the P12 ascent on the APS from the descent stage, insertion into a 9 × 45 nmi orbit
// and, after the CSI/CDH/TPI sequence, the final approach and docking with Columbia.

import { Vector3 } from 'three';
import { GET } from '../../core/MissionClock.js';
import { NMI } from '../../core/constants.js';
import { basisQ } from '../common/states.js';
import { radio, procedure, grade, orbitText } from '../common/kit.js';

const TIG = GET(124, 22, 0);

export default {
  setup: {
    get: GET(124, 12),
    config: 'LM',
    state: 'PRE_ASCENT',
    station: 'LM',
    seat: 'CDR',
    csm: 'LUNAR_ORBIT',
    lm: 'PRE_ASCENT',
  },
  briefing: {
    summary:
      'Base Tranquilidad, 21 de julio de 1969. Tras 21 horas en la superficie, el Eagle debe despegar a la hora exacta para alcanzar al Columbia. ' +
      'Pero al volver de la caminata, la mochila de un astronauta rompió el disyuntor que arma el motor de ascenso. Arréglalo, despega con el P12 y acopla con Collins.',
    objectives: ['Resolver el disyuntor ENG ARM roto', 'Preparar el despegue (P12, ENG ARM ASC)', 'Despegar a las 124:22:00', 'Órbita de inserción y acoplamiento con el Columbia'],
    tips: ['El disyuntor está en el panel 16 (a la derecha del LMP)', 'STAGE (o ABORT STAGE) separa la etapa de ascenso: ese es el despegue', 'Para el acoplamiento usa la cámara exterior (C) y el panel de distancia'],
  },
  async run(ctx) {
    const sim = ctx.sim;
    const v = ctx.vehicle;
    const lm = ctx.lm;
    lm.trigger('ENG_ARM_CB_BROKEN');
    ctx.caption('DESPEGUE LUNAR', 'Base Tranquilidad · GET 124:12', 6);
    radio(ctx, 'CAPCOM', 'Eagle, Houston. We are 10 minutes from your liftoff time. You are cleared for takeoff.', 'Eagle, Houston. Faltan 10 minutos para su despegue. Tienen autorización para despegar.');
    radio(ctx, 'LMP', 'Roger. Understand. We are number one on the runway.', 'Recibido. Entendido: somos los primeros en la pista.');

    // ---- the broken breaker
    const obj1 = ctx.objective('cb', 'Arregla el disyuntor ENG ARM (panel 16)');
    await ctx.wait(6);
    ctx.highlight(['LM.CB.ENG_ARM']);
    await ctx.say('LMP', 'Houston, we have a problem with a circuit breaker. The engine arm breaker on panel 16 is broken off.', 'Houston, tenemos un problema con un disyuntor: el de ENG ARM del panel 16 está roto, sin la palanca.');
    const pick = await ctx.choice({
      id: 'a11.pen',
      title: 'Disyuntor ENG ARM roto',
      prompt: 'Sin ese disyuntor el motor de ascenso no se arma. La punta de plástico se rompió y no se puede empujar con el dedo. ¿Qué haces?',
      options: [
        { id: 'pen', label: 'Empujarlo con un rotulador de punta de fieltro (no conductor)' },
        { id: 'houston', label: 'Esperar a que Houston busque otra solución' },
        { id: 'screw', label: 'Empujarlo con un destornillador metálico' },
      ],
      timeout: 60,
      defaultOption: 'pen',
    });
    if (pick === 'screw') {
      ctx.penalty('screw', 40, 'Herramienta metálica en un panel eléctrico');
      await ctx.say('CAPCOM', 'Eagle, Houston. Negative on anything metal in that panel. Try something non-conductive.', 'Eagle, Houston. Negativo: nada metálico en ese panel. Prueben con algo que no conduzca.');
    } else if (pick === 'houston') {
      await ctx.say('CAPCOM', 'Eagle, Houston. We would rather you push it in. We can arm it from the ground if we need to, but push it in.', 'Eagle, Houston. Preferimos que lo empujen. Podríamos armarlo desde tierra, pero empújenlo.');
    }
    radio(ctx, 'LMP', 'Okay, I pushed it in with a felt-tip pen. It is in.', 'Listo: lo empujé con un rotulador. Está dentro.');
    lm.fixBreakerWithPen();
    ctx.clearHighlight();
    obj1.done();
    ctx.achievement('a11-pen');
    ctx.score('pen', pick === 'pen' ? 60 : pick === 'houston' ? 40 : 20, 60, 'Disyuntor ENG ARM');

    // ---- prep
    const obj2 = ctx.objective('prep', 'Prepara el despegue: MASTER ARM, ENG ARM ASC y P12');
    await procedure(ctx, 'liftoff', { title: 'Preparación del despegue', pick: [0, 1, 2, 3, 4], aiPace: [4, 7] });
    obj2.done();

    // ---- liftoff at TIG
    const obj3 = ctx.objective('liftoff', 'Despega a las 124:22:00 (STAGE / ABORT STAGE)');
    ctx.hint('A la hora del despegue: levanta la tapa de STAGE (panel 8) y muévelo a FIRE, o pulsa ABORT STAGE.', { durationS: 10 });
    if (ctx.t < TIG - 10) await ctx.waitGET(TIG - 10);
    radio(ctx, 'LMP', '9, 8, 7, 6, 5, abort stage, engine arm, ascent, proceed.', '9, 8, 7, 6, 5, separación de etapa, motor armado, ascenso, proceder.');
    ctx.spawn(async () => {
      await ctx.waitGET(TIG + 12);
      if (!lm.staged) {
        ctx.penalty('stageLate', 40, 'Despegue tardío');
        v.sw.set('LM.EXP.MASTER_ARM', 'ON', 'crew');
        v.sw.set('LM.ENG.ENG_ARM', 'ASC', 'crew');
        v.sw.setGuard('LM.EXP.STAGE', true, 'crew');
        v.sw.pulse('LM.EXP.STAGE', 'FIRE', 0.6, 'crew');
      }
    });
    await ctx.waitUntil(() => lm.staged && !v.state.landed);
    const tLift = ctx.t;
    obj3.done();
    ctx.score('liftoff', grade(Math.abs(tLift - TIG), 2, 30, 100), 100, `Despegue a ${(tLift - TIG).toFixed(0)} s del TIG`);
    ctx.achievement('a11-ascent');
    radio(ctx, 'LMP', 'That was beautiful. 26, 36 feet per second up. Be advised of the pitchover. Very smooth.', 'Precioso. 26, 36 pies por segundo hacia arriba. Atentos al cabeceo. Muy suave.');
    radio(ctx, 'CAPCOM', 'Roger. Eagle, Houston. One minute and you are looking good.', 'Recibido. Eagle, Houston: un minuto y se ven bien.');
    if (v.cmd && sim.gnc.lgc.program !== '12') sim.gnc.lgc.runProgram('12');

    // ---- insertion
    const obj4 = ctx.objective('orbit', 'Inserción en órbita lunar (9 × 45 nmi)');
    const ins = await ctx.waitUntil(() => !!sim.gnc.ascent?.done, { timeout: 900 });
    await ctx.wait(5);
    const st = v.state;
    if (!ins || !Number.isFinite(st.apoAlt) || st.periAlt < 5000) {
      ctx.fail('El Eagle no alcanzó una órbita estable.', { stats: { Órbita: orbitText(st) } });
      return;
    }
    obj4.done();
    ctx.score('orbit', grade(Math.abs(st.periAlt / NMI - 9.4) + Math.abs(st.apoAlt / NMI - 47.3) * 0.4, 2, 25, 100), 100, `Órbita ${orbitText(st)}`);
    await ctx.say('CAPCOM', 'Eagle, Houston. You are looking good. We show you in orbit.', `Eagle, Houston. Se ven bien: los vemos en órbita, ${orbitText(st)}.`);

    // ---- rendezvous (CSI, CDH, TPI happen during a time skip) and docking
    ctx.caption('3 HORAS Y MEDIA DESPUÉS', 'CSI · CDH · TPI: el Eagle alcanza al Columbia', 5);
    await ctx.view?.fade?.(true, 0.8);
    const up = st.r.clone().sub(sim.dyn.moonPos).normalize();
    const fwd = st.vRel.clone().addScaledVector(up, -st.vRel.dot(up)).normalize();
    // Eagle's +X (docking hatch) points at Columbia, 45 m ahead and a little above
    const toCSM = fwd.clone().multiplyScalar(0.9).addScaledVector(up, 0.44).normalize();
    v.state.q.copy(basisQ(toCSM, up.clone().negate()));
    v.state.w.set(0, 0, 0);
    const csmPos = st.r.clone().addScaledVector(toCSM, 45);
    sim.dyn.addBody({ id: 'COLUMBIA', config: 'CSM', r: csmPos, v: st.v.clone(), q: basisQ(toCSM.clone().negate(), up.clone().negate()), w: new Vector3(), label: 'Columbia' });
    ctx.view?.setCamera?.('exterior:chase');
    await ctx.view?.fade?.(false, 1.2);
    radio(ctx, 'CMP', 'Eagle, Columbia. I have you in sight. Come on up.', 'Eagle, aquí Columbia. Los tengo a la vista. Suban.');
    const obj5 = ctx.objective('dock', 'Acopla el Eagle con el Columbia');
    ctx.hint('I / K acercan y alejan el Eagle por su eje +X (la escotilla de arriba); J/L y U/O corrigen la deriva. Menos de 0,3 m/s.', { durationS: 12 });
    if (ctx.isController) sim.gnc.autopilot.set('DOCKING', { targetId: 'COLUMBIA' });
    let bounces = 0;
    ctx.on('vehicle:event', (e) => {
      if (e.kind === 'DOCK_BOUNCE') {
        bounces++;
        ctx.penalty(`bounce${bounces}`, 20, 'Rebote');
        ctx.alert('Rebote: demasiado rápido', 'caution');
      }
    });
    let cap = null;
    let assisted = false;
    const autodock = (c) => {
      if (c.gnc.autopilot.mode === 'DOCKING') return;
      assisted = !ctx.isController;
      c.gnc.autopilot.set('DOCKING', { targetId: 'COLUMBIA' });
      ctx.alert('Piloto automático de acoplamiento activado', 'info', 4);
    };
    ctx.on('vehicle:event', (e) => e.kind === 'DOCK_CAPTURE' && (cap = e));
    await ctx.crew({
      id: 'a11.rndz',
      title: 'ACOPLAMIENTO CON COLUMBIA',
      items: [
        { text: 'Alinear el Eagle con el Columbia (cruz del COAS)', check: () => (sim.dyn.dockingTelemetry?.('COLUMBIA')?.misalign ?? 90) < 8 || !!cap, do: autodock },
        { text: 'Acercarse a menos de 0,3 m/s', check: () => { const t = sim.dyn.dockingTelemetry?.('COLUMBIA'); return !!cap || (!!t && t.range < 5 && -t.rangeRate < 0.35); }, do: autodock },
        { text: 'Captura', check: () => !!cap || !!sim.dyn._captured, do: autodock },
      ],
      aiPace: [1, 2],
    });
    await ctx.waitUntil(() => !!cap || !!sim.dyn._captured);
    if (assisted) ctx.penalty('assist', 60, 'Acoplamiento con piloto automático');
    sim.gnc.autopilot.clear();
    radio(ctx, 'CMP', 'Capture. Retracting the probe.', 'Captura. Retraigo la sonda.');
    await ctx.wait(4);
    v.request('DOCK_HARD', { targetId: 'COLUMBIA' });
    await ctx.waitUntil(() => v.config === 'CSM_LMASC', { timeout: 30 });
    obj5.done();
    ctx.achievement('a11-rendezvous');
    ctx.score('dock', grade(Math.abs((cap?.closing ?? 0.2) - 0.15), 0.05, 0.45, 100), 100, `Cierre a ${(cap?.closing ?? 0).toFixed(2)} m/s`);
    await ctx.say('CAPCOM', 'Columbia, Houston. We show you docked. Welcome back.', 'Columbia, Houston. Los vemos acoplados. Bienvenidos.');
    ctx.complete({
      summary: `El Eagle volvió a la órbita (${orbitText(st)}) y se acopló con el Columbia. Armstrong y Aldrin pasan al CM con 22 kg de rocas lunares.`,
      stats: { 'Despegue': `${(tLift - TIG).toFixed(0)} s del TIG`, Cierre: `${(cap?.closing ?? 0).toFixed(2)} m/s`, Rebotes: bounces },
    });
  },
};
