// Apollo 11 — Translunar Injection. Parking orbit over the Pacific: Houston's TLI GO, the crew sets
// XLUNAR INJECT and P15, the IU starts Time Base 6 and relights the J-2 for ~5 minutes, then
// Houston confirms the trajectory to the Moon. FIDO picks the opportunity in the controller role.

import { GET } from '../../core/MissionClock.js';
import { NMI } from '../../core/constants.js';
import { planTLI, contextFromSim, fmtGET } from '../../sim/physics/targeting.js';
import { procedure, radio, warpHint } from '../common/kit.js';

export default {
  setup: {
    get: GET(2, 16),
    config: 'SIVB_STACK',
    state: 'EARTH_PARKING_ORBIT',
    station: 'CM',
    seat: 'CDR',
    csm: 'EARTH_ORBIT',
    lm: 'STOWED',
  },
  briefing: {
    summary:
      'Segunda órbita alrededor de la Tierra. Houston ya tiene los números: el S-IVB se volverá a encender sobre el Pacífico para acelerar de 7,8 a 10,8 km/s. ' +
      'Configura el CM para la inyección, vigila la secuencia del TB6 y el encendido de 5 minutos 47 segundos del J-2.',
    objectives: ['Recibir el GO para la TLI', 'XLUNAR en INJECT y P15 en el ordenador', 'Encendido del S-IVB', 'Confirmar la trayectoria a la Luna'],
    tips: ['Tecla . acelera el tiempo; se frena sola antes de la ignición', 'Durante el encendido mira por la ventana: la Tierra se aleja', 'XLUNAR en SAFE cancelaría la TLI'],
  },
  async run(ctx) {
    const sim = ctx.sim;
    const sat = ctx.saturn;
    ctx.caption('INYECCIÓN TRANSLUNAR', 'Apolo 11 · segunda órbita terrestre', 6);
    radio(ctx, 'CAPCOM', 'Apollo 11, Houston. We are working on your TLI numbers.', 'Apolo 11, Houston. Estamos calculando los datos de la TLI.');

    // the RTCC solution is ready before FIDO's call (the opportunity must not slip while talking)
    const plan = await planTLI(contextFromSim(sim), { revs: 0.9 });
    // FIDO chooses the opportunity (AI in astronaut mode)
    await ctx.ground({
      id: 'a11.fido.tli',
      console: 'FIDO',
      kind: 'decision',
      title: 'Oportunidad de TLI',
      prompt: 'El RTCC tiene dos soluciones: la primera oportunidad sobre el Pacífico (TB6 dentro de unos 20 minutos) o una órbita más tarde. La primera conserva el plan de vuelo.',
      options: [
        { id: 'first', label: 'Primera oportunidad (plan de vuelo)', correct: true, say: { who: 'FIDO', en: 'Flight, FIDO. We are go for the first opportunity.', es: 'Flight, FIDO. Vamos con la primera oportunidad.', channel: 'loop' } },
        { id: 'second', label: 'Esperar una órbita', correct: false, say: { who: 'FLIGHT', en: 'FIDO, we have no reason to slip. First opportunity.', es: 'FIDO, no hay motivo para retrasarla. Primera oportunidad.', channel: 'loop' } },
      ],
      timeout: 40,
      aiDelay: 1,
      score: { key: 'fido', points: 40 },
    });
    sat.startTB6({ c3: plan.c3, tb6: Math.max(plan.tb6, ctx.t + 30) });
    ctx.pad({ name: 'TLI', tig: sat.tliIgnitionGET ?? plan.tig, dvTotal: plan.dvTotal, burnTime: plan.burnTime, engine: 'S-IVB', notes: `TB6 a GET ${fmtGET(sat.tb6 ?? plan.tb6)}. ${plan.notes}` });
    await ctx.say('CAPCOM', 'Apollo 11, this is Houston. You are GO for TLI. Over.', `Apolo 11, aquí Houston. Tienen GO para la TLI. TB6 a GET ${fmtGET(sat.tb6 ?? plan.tb6)}, ignición a ${fmtGET(sat.tliIgnitionGET ?? plan.tig)}.`);
    radio(ctx, 'CDR', 'Roger, we are GO for TLI.', 'Recibido: GO para la TLI.');

    const obj1 = ctx.objective('config', 'Configura el CM para la TLI: XLUNAR INJECT y P15');
    const r = await procedure(ctx, 'tli', { pick: [1, 2], aiPace: [3, 6] });
    obj1.done();
    ctx.score('config', r.autoUsed ? 40 : 80, 80, 'Configuración para la TLI');
    warpHint(ctx);

    // ---- TB6 → ignition
    const obj2 = ctx.objective('tb6', 'Secuencia del TB6: ignición del J-2 a los 9 min 38 s');
    const tb6 = sat.tb6 ?? plan.tb6;
    const tig = sat.tliIgnitionGET ?? plan.tig;
    if (ctx.t < tb6) await ctx.waitGET(tb6);
    ctx.alert('TB6: el IU inicia la secuencia de reencendido', 'info', 5);
    radio(ctx, 'PAO', 'Time base 6 has started. The S-IVB is preparing for its second burn.', 'Comenzó la base de tiempo 6: el S-IVB se prepara para su segundo encendido.');
    if (ctx.t < tig - 100) {
      await ctx.waitGET(tig - 100);
      radio(ctx, 'CAPCOM', 'Apollo 11, Houston. Slightly less than 2 minutes to ignition and everything is GO.', 'Apolo 11, Houston. Menos de 2 minutos para la ignición y todo está GO.');
    }
    if (ctx.t < tig - 1) await ctx.waitGET(tig - 1);
    await ctx.waitUntil(() => sat.stage === 'SIVB_TLI' || sat.done.has('TLI_IGNITION') || sat.done.has('TLI_CUTOFF') || sat.tb6 === null);
    obj2.done();
    radio(ctx, 'CDR', 'Ignition.', 'Ignición.');
    radio(ctx, 'CAPCOM', 'Roger, we confirm ignition, and the thrust is GO.', 'Recibido, confirmamos ignición; el empuje es GO.');
    const obj3 = ctx.objective('burn', 'Encendido de la TLI (~5 min 47 s)');
    ctx.spawn(async () => {
      await ctx.wait(120);
      if (sat.stage === 'SIVB_TLI') radio(ctx, 'CAPCOM', 'Apollo 11, Houston. You are GO at 3.', 'Apolo 11, Houston. Siguen GO a los 3 minutos.');
    });
    let inhibited = sat.tb6 === null && !sat.done.has('TLI_CUTOFF');
    ctx.on('saturn:tliInhibit', () => (inhibited = true));
    await ctx.waitUntil(() => inhibited || sat.done.has('TLI_CUTOFF'));
    if (inhibited) {
      obj3.fail();
      ctx.fail('La TLI fue cancelada (XLUNAR en SAFE): el Apolo 11 sigue en órbita terrestre.');
      return;
    }
    obj3.done();
    ctx.achievement('a11-tli');
    ctx.score('burn', 100, 100, 'Encendido del S-IVB');
    radio(ctx, 'CDR', 'Hey Houston, Apollo 11. That Saturn gave us a magnificent ride.', 'Oye Houston, aquí Apolo 11. Ese Saturn nos dio una cabalgata magnífica.');
    await ctx.say('CAPCOM', 'Roger, 11. We will pass that on. And it looks like you are well on your way now.', 'Recibido, 11. Se lo diremos. Y parece que ya están bien encaminados.');

    // ---- trajectory check
    const obj4 = ctx.objective('traj', 'Houston confirma la trayectoria');
    await ctx.wait(60);
    const st = ctx.vehicle.state;
    obj4.done();
    const peri = plan.perilune / NMI;
    ctx.complete({
      summary: `Apolo 11 rumbo a la Luna a ${(st.speed / 1000).toFixed(2)} km/s. Perilunio previsto ${peri.toFixed(0)} nmi a GET ${fmtGET(plan.arrivalGET)}; las correcciones de medio curso lo dejarán en 60 nmi.`,
      stats: { 'Velocidad tras la TLI': `${(st.speed / 0.3048).toFixed(0)} ft/s`, 'Encendido': `${Math.round(plan.burnTime)} s`, 'Llegada a la Luna': fmtGET(plan.arrivalGET) },
    });
  },
};
