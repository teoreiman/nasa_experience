// Apollo 11 — Powered descent. PDI at 102:33:05 (the crew keys P63 and PROceeds at V99), the
// braking phase with the 1202/1201 executive-overflow alarms (rendezvous radar left out of LGC),
// P64 approach with LPD redesignation, P66 rate-of-descent flying, the "60 / 30 seconds" fuel calls
// and "The Eagle has landed". GUIDO makes the alarm call in the controller role.

import { GET } from '../../core/MissionClock.js';
import { MISSION_EPOCH, FT } from '../../core/constants.js';
import { getInitialState } from '../../sim/physics/initialStates.js';
import { coast } from '../../sim/physics/targeting.js';
import { SITES, siteDir } from '../../sim/terrain/lunarTerrain.js';
import { radio, procedure, grade } from '../common/kit.js';

const PDI = GET(102, 33, 5);
const START = GET(102, 26, 30);

export default {
  setup() {
    // the PRE_PDI state is the perilune of the descent orbit at PDI: back up 6½ minutes
    const epochUTC = MISSION_EPOCH.apollo11;
    const s = getInitialState('PRE_PDI', { epochUTC, get: PDI });
    const b = coast(s.r, s.v, epochUTC + PDI * 1000, START - PDI);
    return {
      get: START,
      config: 'LM',
      state: { ...s, r: b.r, v: b.v },
      station: 'LM',
      seat: 'CDR',
      csm: null,
      lm: 'PRE_PDI',
      maxWarp: 4,
    };
  },
  briefing: {
    summary:
      '20 de julio de 1969. El Eagle cae hacia el Mar de la Tranquilidad a 15 km de altura. A las 102:33:05 el motor de descenso debe encenderse para frenar 2.000 m/s en 12 minutos. ' +
      'El ordenador dará alarmas que nadie había visto en vuelo, el punto de alunizaje está lleno de rocas y el combustible se acaba. Armstrong aterrizó con unos 45 segundos de margen.',
    objectives: ['Preparar el PDI y encender el DPS a tiempo (P63 + PRO)', 'Decidir sobre las alarmas 1202 / 1201', 'Aproximación (P64) y vuelo manual en P66', 'Alunizar suavemente antes del «bingo» de combustible'],
    tips: [
      'P63: teclea V37 E 63 E en el DSKY y pulsa PRO cuando parpadee V99',
      'Durante la alarma: RSET apaga la luz PROG y KEY REL recupera la pantalla',
      'En P66: Inicio / Fin = ±1 ft/s de descenso · W/A/S/D inclina el LM para anular la deriva',
      'Flechas en P64: redesignar el punto de alunizaje (LPD)',
    ],
  },
  async run(ctx) {
    const sim = ctx.sim;
    const v = ctx.vehicle;
    const lm = ctx.lm;
    const lgc = sim.gnc.lgc;
    const site = siteDir(SITES.TRANQUILITY);
    sim.gnc.lmGuidance.setSite(site);
    ctx.caption('DESCENSO MOTORIZADO', 'Eagle · Mar de la Tranquilidad · GET 102:26', 6);
    radio(ctx, 'CAPCOM', 'Eagle, Houston. If you read, you are GO for powered descent. Over.', 'Eagle, Houston. Si nos copian: tienen GO para el descenso motorizado.');
    radio(ctx, 'CMP', 'Eagle, this is Columbia. They just gave you a GO for powered descent.', 'Eagle, aquí Columbia. Acaban de darles GO para el descenso motorizado.');

    // ---- P63 selection is held until TIG; PRO at V99 lights the DPS
    let p63Selected = false;
    let pdiDone = false;
    ctx.on('agc:program', (e) => {
      if (e.agc !== 'LGC' || pdiDone) return;
      if (e.program === '63') {
        p63Selected = true;
        sim.gnc.lmGuidance.phase = null; // ignition waits for TIG and the crew's PRO
      }
    });
    const obj1 = ctx.objective('pdi', 'Prepara el PDI: P63 cargado antes de las 102:33:05');
    ctx.spawn(() =>
      procedure(ctx, 'pdi', {
        title: 'Preparación del descenso motorizado',
        pick: [0, 1, 2, 4, 5],
        aiPace: [4, 8],
      }),
    );
    await ctx.waitGET(PDI - 6);
    if (!p63Selected) {
      ctx.penalty('p63', 30, 'P63 cargado tarde');
      lgc.runProgram('63');
    }
    const d = lgc.dsky.display;
    lgc.dsky.monitor = null;
    d.verb = '99';
    d.noun = '62';
    d.flashVN = true;
    lgc.dsky._touch();
    ctx.hint('V99 parpadea: pulsa PRO en el DSKY para encender el motor de descenso.', { durationS: 8 });
    let pro = false;
    const offPro = ctx.on('dsky:proceed', (e) => e.agc === 'LGC' && (pro = true));
    if (ctx.isController) ctx.spawn(async () => { await ctx.wait(5); pro = true; });
    ctx.spawn(() =>
      ctx.crew({
        id: 'a11.pdipro',
        title: 'IGNICIÓN DEL PDI',
        items: [{ text: 'V99 parpadea: PRO para encender el DPS', check: () => pro, do: () => (pro = true), hint: 'Tecla PRO del DSKY (P con el ratón encima)' }],
        aiPace: [1, 2],
      }),
    );
    const proOk = await ctx.waitUntil(() => pro, { timeout: 20 });
    pro = true;
    offPro();
    if (!proOk) {
      ctx.penalty('pro', 30, 'PRO tardío: Aldrin lo pulsó');
      radio(ctx, 'LMP', 'Proceed.', 'Proceder.', { channel: 'ic' });
    }
    d.flashVN = false;
    pdiDone = true;
    const tPDI = ctx.t;
    sim.gnc.startDescent(site);
    // a late ignition lands long (Eagle came down 6 km beyond the target): the target slides downrange
    if (tPDI - PDI > 1) sim.gnc.lmGuidance.shiftSiteDownrange((tPDI - PDI) * v.state.vSurface.length());
    // AI crew (controller role) and the cadet level: the autopilot also flies P66 to touchdown
    const autoland = ctx.isController || ctx.difficulty === 'cadet';
    if (autoland) sim.gnc.autopilot.set('LANDING');
    obj1.done();
    ctx.score('pdi', grade(Math.abs(tPDI - PDI), 1, 20, 100), 100, `Ignición del PDI a ${(tPDI - PDI).toFixed(0)} s del TIG`);
    radio(ctx, 'LMP', 'Ignition. Ten percent.', 'Ignición. Diez por ciento.');
    await ctx.waitUntil(() => ctx.t > tPDI + 26);
    radio(ctx, 'LMP', 'Throttle up. Full thrust.', 'Aceleración. Empuje máximo.');

    // ---- 1202 / 1201 alarms when the rendezvous radar steals LGC cycles
    let alarms = 0;
    let aborted = false;
    if (v.tm['LM.RR.CYCLE_STEAL'] !== false) {
      sim.gnc.configure({ alarms: [[316, 1202], [352, 1202], [553, 1201], [578, 1202], [593, 1202]].map(([dt, code]) => ({ get: tPDI + dt, code })) });
    }
    ctx.on('agc:alarm', async ({ agc, code }) => {
      if (agc !== 'LGC') return;
      alarms++;
      ctx.dropWarp();
      if (alarms === 1) {
        ctx.hint('Alarma de programa: RSET apaga la luz PROG y KEY REL devuelve la pantalla del descenso.', { durationS: 10 });
        ctx.say('CDR', 'Program alarm.', 'Alarma de programa.', { wait: false });
        ctx.say('CDR', `It's a ${code}.`, `Es un ${code}.`, { wait: false });
        ctx.say('CDR', `Give us a reading on the ${code} program alarm.`, `Dennos una lectura sobre la alarma de programa ${code}.`, { wait: false });
        const res = await ctx.ground({
          id: 'a11.guido.1202',
          console: 'GUIDO',
          kind: 'decision',
          title: `Alarma ${code} en el LGC`,
          prompt: 'Alarma de desbordamiento del ejecutivo: el ordenador está sobrecargado, descarta tareas de baja prioridad y se reinicia… pero el guiado sigue funcionando. Si se repite muy seguido, no. ¿GO o NO GO?',
          options: [
            { id: 'go', label: 'GO: seguimos con esa alarma', correct: true, say: [{ who: 'GUIDO', en: "We're go on that alarm, Flight.", es: 'Seguimos GO con esa alarma, Flight.', channel: 'loop' }, { who: 'CAPCOM', en: "Roger. We got — we're GO on that alarm.", es: 'Recibido. Estamos… seguimos GO con esa alarma.' }] },
            { id: 'abort', label: 'NO GO: abortar el alunizaje', correct: false },
          ],
          timeout: 15,
          timeoutChoice: 'go',
          aiDelay: 6,
          evidence: ['LM.RR.CYCLE_STEAL'],
          score: { key: 'alarm', points: 80 },
        });
        if (res.choice === 'abort') aborted = true;
      } else if (code === 1201) {
        ctx.say('LMP', 'Program alarm. Same type: 1201.', 'Alarma de programa. Del mismo tipo: 1201.', { wait: false });
        ctx.say('CAPCOM', 'Roger, 1201 alarm. We are GO. Same type. We are GO.', 'Recibido, alarma 1201. Seguimos GO. Del mismo tipo. Seguimos GO.', { wait: false });
      } else {
        ctx.say('CAPCOM', `Roger. ${code}. We got it. We are GO.`, `Recibido, ${code}. Lo tenemos. Seguimos GO.`, { wait: false });
      }
    });
    // astronaut: the CDR can choose to abort when the first alarm shows (AI Houston answers GO)
    ctx.on('agc:alarm', async ({ agc }) => {
      if (agc !== 'LGC' || alarms !== 1 || ctx.isController) return;
      const c = await ctx.choice({
        id: 'a11.cdr.1202',
        title: 'Alarma 1202',
        prompt: 'Una alarma que nunca viste en el simulador, a 33.000 pies sobre la Luna. Houston está analizándola.',
        options: [
          { id: 'go', label: 'Seguir y esperar la lectura de Houston' },
          { id: 'abort', label: 'ABORTAR el descenso' },
        ],
        timeout: 12,
        defaultOption: 'go',
      });
      if (c === 'abort') aborted = true;
    });

    // ---- callouts and phase changes
    ctx.on('lm:phase', ({ phase }) => {
      if (phase === '64') {
        ctx.say('CAPCOM', 'Eagle, Houston. You are GO for landing. Over.', 'Eagle, Houston. Tienen GO para alunizar.', { wait: false });
        radio(ctx, 'LMP', 'Roger. Understand. GO for landing. 3000 feet.', 'Recibido. Entendido: GO para alunizar. 3.000 pies.');
        ctx.hint('P64: el LM se endereza y ves el terreno. Flechas: redesignar el punto. Inicio / Fin (ROD): pasar a P66.', { durationS: 10 });
      }
      if (phase === '66') {
        radio(ctx, 'CDR', 'Pretty rocky area.', 'Zona bastante rocosa.');
        ctx.hint('P66: Inicio / Fin ajustan la velocidad de descenso de a 1 ft/s; inclina el LM (W/A/S/D) para anular la deriva horizontal.', { durationS: 10 });
      }
    });
    let manualS = 0;
    ctx.every(0.5, () => {
      if (sim.gnc.lgc.program === '66' && v.controls.outOfDetent) manualS += 0.5;
    });
    const marks = [2000, 1000, 750, 600, 500, 400, 300, 220, 160, 100, 75, 60, 40, 30, 20];
    let mi = 0;
    ctx.every(0.25, () => {
      const st = v.state;
      const h = (st.altTerrain ?? st.alt) / FT;
      if (mi < marks.length && h < marks[mi] && sim.gnc.lmGuidance.phase && ['64', '66'].includes(sim.gnc.lgc.program)) {
        const rate = Math.abs(st.hdot / FT);
        const fwd = Math.abs(v.tm['LM.GNC.XPTR_FWD_FPS'] ?? 0);
        radio(ctx, 'LMP', `${marks[mi]} feet, down ${rate.toFixed(0)}${fwd > 1 ? `, ${fwd.toFixed(0)} forward` : ''}.`, `${marks[mi]} pies, bajando a ${rate.toFixed(0)}${fwd > 1 ? `, ${fwd.toFixed(0)} adelante` : ''}.`);
        while (mi < marks.length && h < marks[mi]) mi++;
      }
    });
    // ---- fuel: low level, 60 / 30 seconds to bingo
    let called60 = false;
    let called30 = false;
    let bingo = false;
    ctx.on('lm:lowLevel', () => {
      radio(ctx, 'LMP', 'Five percent. Quantity light.', 'Cinco por ciento. Luz de cantidad.');
      ctx.alert('DES QTY: bajo nivel de propelente', 'caution', 5);
    });
    ctx.every(0.5, () => {
      if (!lm.lowLevel || v.state.landed) return;
      const thrust = Math.max(0.1, v.cmd.dpsThrottle) * 45040;
      const left = lm.dpsProp / (thrust / (305 * 9.80665)) - 20;
      if (!called60 && left < 60) {
        called60 = true;
        ctx.say('CAPCOM', '60 seconds.', '60 segundos.', { wait: false, priority: true });
      }
      if (!called30 && left < 30) {
        called30 = true;
        ctx.say('CAPCOM', '30 seconds.', '30 segundos.', { wait: false, priority: true });
      }
      if (!bingo && left < 0) {
        bingo = true;
        ctx.alert('BINGO: aluniza YA o aborta', 'warning', 6);
        ctx.say('CAPCOM', 'Bingo.', 'Bingo.', { wait: false, priority: true });
      }
    });
    let contactCalled = false;
    ctx.every(0.2, () => {
      if (!contactCalled && v.tm['LM.GNC.CONTACT_LIGHT'] && !v.state.landed) {
        contactCalled = true;
        ctx.say('LMP', 'Contact light.', 'Luz de contacto.', { wait: false, priority: true });
      }
    });

    // ---- the descent checklist; "do it for me" on the flying items engages the autoland
    let assisted = false;
    const autoland2 = (c) => {
      if (c.gnc.autopilot.mode === 'LANDING') return;
      assisted = !ctx.isController;
      c.gnc.autopilot.set('LANDING');
      ctx.alert('Piloto automático de alunizaje activado', 'info', 4);
    };
    ctx.spawn(() =>
      ctx.crew({
        id: 'a11.descent',
        title: 'DESCENSO MOTORIZADO',
        items: [
          { text: 'P63: frenado con el DPS al 92,5 %', check: (c) => ['64', '66'].includes(c.gnc.lgc.program) || c.vehicle.state.landed },
          { text: 'P64 (≈7.000 ft): GO para alunizar, mira el terreno', check: (c) => ['64', '66'].includes(c.gnc.lgc.program) || c.vehicle.state.landed, hint: 'Flechas: redesignar el punto de alunizaje' },
          { text: 'P66: Inicio / Fin fijan la velocidad de descenso', check: (c) => c.gnc.lgc.program === '66' || c.vehicle.state.landed, do: autoland2, hint: 'Pulsa una vez Inicio o Fin para pasar a P66' },
          { text: 'Anular la deriva (W/A/S/D) y bajar a 1–3 ft/s', check: (c) => c.vehicle.state.landed || !!c.tm['LM.GNC.CONTACT_LIGHT'], do: autoland2 },
          { text: 'Luz de contacto: ENGINE STOP', check: (c) => c.vehicle.state.landed, do: autoland2 },
        ],
        aiPace: [1, 2],
      }),
    );

    // ---- wait for the outcome
    const obj2 = ctx.objective('land', 'Aluniza en el Mar de la Tranquilidad');
    const tdP = ctx.waitEvent('vehicle:event', (e) => e.kind === 'TOUCHDOWN');
    await ctx.waitUntil(() => aborted || v.state.landed);
    if (aborted && !v.state.landed) {
      obj2.fail();
      ctx.fail('Abortaste el alunizaje. Las alarmas 1202/1201 eran desbordamientos del ejecutivo: el ordenador descartaba tareas de baja prioridad y seguía guiando. Steve Bales y Jack Garman lo sabían y dijeron GO.');
      return;
    }
    const td = await tdP;
    if (td?.crash) {
      obj2.fail();
      ctx.fail(`El Eagle impactó contra la superficie a ${(td.vSpeed / FT).toFixed(1)} ft/s de velocidad vertical.`, { stats: { 'Vel. vertical': `${(td.vSpeed / FT).toFixed(1)} ft/s`, 'Vel. horizontal': `${(td.hSpeed / FT).toFixed(1)} ft/s`, Inclinación: `${(td.tilt ?? 0).toFixed(1)}°` } });
      return;
    }
    obj2.done();
    radio(ctx, 'CDR', 'Shutdown.', 'Apagado.');
    radio(ctx, 'LMP', 'Okay. Engine stop. ACA out of detent.', 'Bien. Motor parado. ACA fuera de retén.');
    await ctx.wait(3);
    await ctx.say('CDR', 'Houston, Tranquility Base here. The Eagle has landed.', 'Houston, aquí Base Tranquilidad. El Eagle ha alunizado.', { clip: 'a11_eagle_has_landed' });
    await ctx.say('CAPCOM', 'Roger, Twan— Tranquility, we copy you on the ground. You got a bunch of guys about to turn blue. We are breathing again. Thanks a lot.', 'Recibido, Tran… Tranquilidad, los copiamos en tierra. Tienen a un montón de gente aquí a punto de ponerse azul. Volvemos a respirar. Muchas gracias.');
    ctx.achievement('a11-landing');
    const fuel = (lm.dpsProp / lm.dpsProp0) * 100;
    const miss = Math.hypot(td?.local?.x ?? 0, td?.local?.y ?? 0);
    ctx.score('vspeed', grade(td.vSpeed / FT, 1.5, 7, 120), 120, `Contacto a ${(td.vSpeed / FT).toFixed(1)} ft/s`);
    ctx.score('hspeed', grade(td.hSpeed / FT, 0.5, 4, 60), 60, `Deriva ${(td.hSpeed / FT).toFixed(1)} ft/s`);
    ctx.score('fuel', grade(fuel, 7, 1, 80), 80, `Propelente restante ${fuel.toFixed(1)} %`);
    ctx.score('site', grade(miss, 300, 3000, 40), 40, `A ${Math.round(miss)} m del punto previsto`);
    if (alarms > 0) ctx.achievement('a11-1202');
    if (assisted) ctx.penalty('assist', 120, 'Alunizaje con piloto automático');
    if (manualS > 5 && !assisted) ctx.achievement('a11-manual');
    if (fuel > 6) ctx.achievement('a11-fuel');

    // ---- T1 stay / no stay
    await ctx.poll({
      id: 'a11.t1',
      title: 'T1: ¿STAY o NO STAY?',
      consoles: ['RETRO', 'FIDO', 'GUIDO', 'CONTROL', 'TELMU', 'GNC', 'EECOM', 'SURGEON'],
      intro: { en: 'Okay, all flight controllers, about 45 seconds to T1 stay/no stay.', es: 'Muy bien, controladores: unos 45 segundos para T1, STAY / NO STAY.' },
      outro: { en: 'CAPCOM, we are stay for T1.', es: 'CAPCOM, nos quedamos en T1.' },
      astronautSummary: { who: 'CAPCOM', en: 'Eagle, you are stay for T1.', es: 'Eagle, se quedan para T1: STAY.' },
    });
    ctx.complete({
      summary: `El Eagle está en la Luna, a ${Math.round(miss)} m del punto previsto, con ${fuel.toFixed(1)} % de propelente en el DPS. ${alarms ? `Sobreviviste a ${alarms} alarma(s) de programa.` : ''}`,
      stats: { 'Vel. vertical': `${(td.vSpeed / FT).toFixed(1)} ft/s`, 'Vel. horizontal': `${(td.hSpeed / FT).toFixed(1)} ft/s`, Propelente: `${fuel.toFixed(1)} %`, Alarmas: alarms, 'Vuelo manual (P66)': `${Math.round(manualS)} s` },
    });
  },
};
