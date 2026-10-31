// Shared Saturn V launch flow: terminal count with a hold at T−1:00 until the cockpit is configured
// and the GO/NO-GO poll is done, liftoff, historical ascent callouts, the BOOSTER call, crew tower
// jettison after S-II ignition, orbit insertion and the post-insertion checklist. Missions add their
// own drama through `during(ctx)` (spawned at liftoff).

import { NMI, DEG } from '../../core/constants.js';
import { procedure, radio, ascentCallouts, grade, orbitText } from './kit.js';

/**
 * @param {object} ctx
 * @param {{ callsign: string, es: string, target?: {apo: number, peri: number}, during?: Function,
 *   pollConsoles?: string[], boosterCall?: boolean, postInsertion?: boolean }} o
 * @returns {Promise<{ st: object, cfgTime: number, errA: number, errP: number }>}
 */
export async function runLaunch(ctx, o) {
  const sat = ctx.saturn;
  const { callsign, es } = o;
  const target = o.target ?? { apo: 100.4, peri: 98.9 };
  ascentCallouts(ctx);

  // ---- who flies the Saturn V: the Instrument Unit (as in 1969) or the player, by hand
  let manualUsed = false;
  let lostT = 0;
  if (ctx.isAstronaut && sat) {
    const pick = await ctx.choice({
      id: `${ctx.chapter.id}.pilot`,
      title: '¿Quién pilota el Saturn V?',
      prompt:
        'En 1969 la Unidad de Instrumentos guió el cohete sola. Puedes dejarlo así o tomar el control y llevar el Saturn V a la órbita con tus manos: ' +
        'mantén la mira sobre el rombo de la guía de vuelo, sobre todo en la máxima presión dinámica (≈ 1 min 20 s), o la estructura no aguantará.',
      options: [
        { id: 'manual', label: 'Lo piloto yo', hint: ctx.game?.input?.isTouch ? 'Joystick izquierdo · llevas la mira al rombo' : 'W / S cabeceo · A / D rumbo · P cede el control' },
        { id: 'iu', label: 'Que lo guíe la computadora (histórico)', hint: 'Durante el ascenso puedes tomar el control con P' },
      ],
      timeout: 45,
      defaultOption: 'iu',
    });
    if (pick === 'manual') {
      sat.manual = true;
      manualUsed = true;
      ctx.hint('Tras el despegue, sigue el rombo: mantén la mira encima y vigila la barra de carga q·α.', { durationS: 9 });
    }
  }
  ctx.on('saturn:manual', ({ manual }) => {
    if (manual) manualUsed = true;
    ctx.alert(manual ? 'Control manual: llevas tú el Saturn V' : 'La Unidad de Instrumentos vuelve a guiar el cohete', 'info', 4);
  });
  ctx.on('saturn:breakup', () => {
    ctx.view?.flash?.(0.6);
    ctx.view?.shake?.(4, 3);
    ctx.audio?.sfx?.('bang', { gain: 1.5 });
    ctx.alert('FALLA ESTRUCTURAL · el Saturn V se partió por la carga aerodinámica', 'warning', 8);
    ctx.say('CDR', 'Abort! Abort!', '¡Aborto! ¡Aborto!', { channel: 'ag', force: true, wait: false });
    ctx.spawn(async () => {
      await ctx.waitReal(3);
      ctx.fail('El Saturn V se partió: el ángulo de ataque fue demasiado grande en plena máxima presión dinámica (q·α por encima del límite estructural). Mantén la mira sobre el rombo, sobre todo entre los 50 s y los 100 s.');
    });
  });

  // ---- cockpit configuration and the poll (the count holds at T−1:00 until both are done)
  const obj1 = ctx.objective('prelaunch', 'Configura la cabina para el lanzamiento');
  let ready = false;
  ctx.spawn(async () => {
    await ctx.waitGET(-60);
    if (ready) return;
    ctx.clock.hold = true;
    ctx.alert('CUENTA DETENIDA en T−1:00', 'caution', 6);
    radio(ctx, 'LCC', `We are holding at T minus 1 minute. ${callsign}, report when you are ready.`, `Detenemos la cuenta en T menos 1 minuto. ${es}, avisen cuando estén listos.`);
    ctx.penalty('hold', 15, 'Cuenta detenida');
    await ctx.waitUntil(() => ready);
    ctx.clock.hold = false;
    radio(ctx, 'LCC', 'Resuming the count. T minus 60 seconds and counting.', 'Reanudamos la cuenta. T menos 60 segundos y contando.');
  });
  const res = await procedure(ctx, 'prelaunch', { title: 'Lista final de lanzamiento', pick: [0, 1, 2, 4, 5, 7], aiPace: [3, 6] });
  obj1.done();
  ctx.score('prelaunch', grade(res.time, 60, 170, 100), 100, 'Configuración de cabina');
  await ctx.poll({
    id: `${ctx.chapter.id}.launchpoll`,
    title: 'GO / NO GO para el lanzamiento',
    consoles: o.pollConsoles ?? ['BOOSTER', 'RETRO', 'FIDO', 'GUIDO', 'SURGEON', 'EECOM', 'GNC', 'CAPCOM'],
    intro: { en: 'Okay, all flight controllers, go/no-go for launch.', es: 'Muy bien, controladores: GO / NO GO para el lanzamiento.' },
    outro: { en: 'Launch control, Houston is go for launch.', es: 'Control de lanzamiento, Houston está GO para el lanzamiento.' },
    astronautSummary: { who: 'LCC', en: `${callsign}, this is launch control. Good luck and Godspeed.`, es: `${es}, aquí control de lanzamiento. Buena suerte y que Dios los acompañe.` },
  });
  ready = true;

  // ---- terminal count
  ctx.spawn(async () => {
    if (ctx.t < -50) {
      await ctx.waitGET(-50);
      radio(ctx, 'PAO', 'T minus 50 seconds. Launch vehicle power transfer is complete.', 'T menos 50 segundos. Transferencia de energía del lanzador completa: el Saturn V ya funciona con sus baterías.');
    }
    if (ctx.t < -17) {
      await ctx.waitGET(-17);
      radio(ctx, 'PAO', 'Guidance is internal.', 'El guiado ya es interno.');
    }
  });
  if (ctx.t < -10) await ctx.waitGET(-10);
  ctx.say('LCC', 'T minus 10, 9, ignition sequence start, 6, 5, 4, 3, 2, 1, zero. All engines running. Liftoff! We have a liftoff.',
    'T menos 10, 9, inicio de la secuencia de ignición, 6, 5, 4, 3, 2, 1, cero. Todos los motores funcionando. ¡Despegue! Tenemos despegue.',
    { clip: 'a11_countdown_liftoff', wait: false });
  await ctx.waitUntil(() => ctx.vehicle.state.liftoff);
  radio(ctx, 'CDR', 'Liftoff. The clock is running.', 'Despegue. El reloj está en marcha.');
  if (o.during) ctx.spawn(o.during);
  if (sat.manual) {
    ctx.spawn(async () => {
      await ctx.wait(7);
      if (sat.manual && ctx.view?.cameraMode === 'cockpit') ctx.view?.setCamera?.('exterior:chase');
    });
  }
  // a hand-flown ascent that wanders far from the guide cannot reach orbit any more
  ctx.every(1, () => {
    if (!sat.manual || sat.brokenUp || sat.done.has('SIVB_CUTOFF')) {
      lostT = 0;
      return;
    }
    const err = Math.abs(sat.manualTheta - sat.guideTheta) / DEG;
    lostT = err > 25 ? lostT + 1 : Math.max(0, lostT - 2);
    if (lostT === 6) ctx.alert('Te alejas de la trayectoria: vuelve al rombo o pulsa P para ceder el control', 'caution', 6);
    if (lostT >= 18) ctx.fail('Perdimos la trayectoria: el Saturn V se alejó demasiado de la guía y ya no puede llegar a la órbita.');
  });

  // ---- ascent callouts (historical timeline)
  ctx.spawn(async () => {
    const at = async (t, who, en, txt) => {
      if (ctx.t < t) await ctx.waitGET(t);
      radio(ctx, who, en, txt);
    };
    await at(13, 'CDR', 'Roll and pitch program.', 'Programa de alabeo y cabeceo.');
    await at(44, 'CDR', 'Roll is complete.', 'Alabeo completo.');
    await at(66, 'CAPCOM', 'Mark. Mode 1 Bravo.', 'Marca. Modo 1 Bravo.');
    await at(84, 'PAO', 'Maximum dynamic pressure.', 'Máxima presión dinámica.');
    await at(122, 'CAPCOM', 'Mode 1 Charlie.', 'Modo 1 Charlie.');
    await at(500, 'CAPCOM', `${callsign}, Houston. You are GO for staging. S-IVB to orbit capability.`, `${es}, Houston. GO para la separación. El S-IVB ya puede llevarlos a órbita.`);
  });
  if (o.boosterCall !== false) {
    ctx.spawn(async () => {
      await ctx.waitGET(95);
      await ctx.ground({
        id: `${ctx.chapter.id}.booster.sic`,
        console: 'BOOSTER',
        kind: 'report',
        title: 'Rendimiento del S-IC',
        prompt: 'FLIGHT pide el estado de la primera etapa: cinco F-1 a empuje nominal, trayectoria en el centro del corredor.',
        options: [
          { id: 'nominal', label: 'S-IC nominal, Flight', correct: true, say: { who: 'BOOSTER', en: 'Flight, Booster. S-IC is nominal.', es: 'Flight, BOOSTER. El S-IC va nominal.', channel: 'loop' } },
          { id: 'abort', label: 'Recomiendo abortar', correct: false, say: { who: 'FLIGHT', en: 'Negative, Booster, all parameters are good.', es: 'Negativo, BOOSTER: todos los parámetros están bien.', channel: 'loop' } },
        ],
        timeout: 25,
        aiDelay: 1,
        score: { key: 'booster', points: 30 },
      });
    });
  }

  // ---- tower jettison by the crew after S-II ignition
  await ctx.waitUntil(() => sat.done.has('SII_IGNITION'));
  const tIgn = ctx.t;
  const obj2 = ctx.objective('twr', 'Desecha la torre de escape: TWR JETT 1 en FIRE');
  ctx.hint('Unos 30 s después del encendido del S-II: levanta la tapa del TWR JETT (clic derecho) y muévelo a FIRE.', { durationS: 10 });
  ctx.spawn(async () => {
    await ctx.waitGET(tIgn + 50);
    if (ctx.vehicle.parts.les) radio(ctx, 'CAPCOM', `${callsign}, Houston. Tower jettison.`, `${es}, Houston. Desechen la torre.`);
    await ctx.waitGET(tIgn + 110);
    if (ctx.vehicle.parts.les) {
      ctx.penalty('twrLate', 40, 'Torre desechada tarde (automático)');
      ctx.sw.setGuard('CM.LV.TWR_JETT_2', true, 'crew');
      ctx.sw.pulse('CM.LV.TWR_JETT_2', 'FIRE', 0.6, 'crew');
    }
  });
  await ctx.crew({
    id: `${ctx.chapter.id}.twr`,
    title: 'DESECHO DE LA TORRE (LET)',
    items: [{ text: 'TWR JETT 1 — FIRE', sw: { id: 'CM.LV.TWR_JETT_1', pos: 'FIRE' }, check: (c) => !c.vehicle.parts.les, hint: 'Panel 2: levanta la tapa (clic derecho) y mueve a FIRE' }],
    aiPace: [28, 34],
  });
  obj2.done();
  ctx.score('twr', grade(Math.abs(ctx.t - tIgn - 32), 6, 70, 100), 100, `Torre desechada a T+${Math.floor(ctx.t / 60)}:${String(Math.floor(ctx.t % 60)).padStart(2, '0')}`);

  // ---- orbit insertion
  const obj3 = ctx.objective('orbit', 'Inserción en la órbita de aparcamiento (100 nmi)');
  await ctx.waitUntil(() => sat.done.has('ORBIT_INSERTION'));
  obj3.done();
  await ctx.wait(4);
  const st = ctx.vehicle.state;
  if (manualUsed && st.periAlt / NMI < 70) {
    ctx.fail(`La órbita quedó demasiado baja (perigeo ${(st.periAlt / NMI).toFixed(0)} nmi): la atmósfera nos frenaría en unas horas. Hay que seguir la guía hasta el apagado del S-IVB.`);
    return { st, cfgTime: res.time, errA: 99, errP: 99 };
  }
  const errA = Math.abs(st.apoAlt / NMI - target.apo);
  const errP = Math.abs(st.periAlt / NMI - target.peri);
  ctx.score('orbit', grade(errA + errP, 2, 30, 150), 150, `Órbita ${orbitText(st)}`);
  if (manualUsed) {
    const avg = sat.trackErr.sum / Math.max(1, sat.trackErr.t);
    ctx.score('piloting', grade(avg, 0.8, 8, 150), 150, `Pilotaje manual · error medio ${avg.toFixed(1)}°`);
    if (sat.manual) {
      ctx.achievement('manual-ascent');
      if (avg < 1) ctx.achievement('manual-ace');
    }
  }
  ctx.say('CAPCOM', `${callsign}, Houston. You are confirmed GO for orbit.`, `${es}, Houston. Confirmado: tienen GO para la órbita.`, { wait: false });
  ctx.say('CDR', 'Roger. Shutdown. We are in orbit.', 'Recibido. Apagado. Estamos en órbita.', { wait: false });
  if (o.postInsertion !== false) {
    const obj4 = ctx.objective('post', 'Lista posterior a la inserción');
    await procedure(ctx, 'postinsertion', { pick: [0, 1, 2, 3], aiPace: [3, 5] });
    obj4.done();
    ctx.score('post', 50, 50, 'Lista posterior a la inserción');
  }
  return { st, cfgTime: res.time, errA, errP };
}
