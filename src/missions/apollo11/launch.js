// Apollo 11 — Launch. SAMPLE written by the architect to demonstrate the dual-role mission API;
// the "a11" mission agent expands it into the full chapter (real countdown, Mode I–IV aborts,
// tower jettison, S-II/S-IVB staging monitoring, orbit insertion checklist, scoring).

import { GET } from '../../core/MissionClock.js';

export default {
  setup: {
    get: -GET(0, 2),
    config: 'SATURN_V',
    state: 'PAD_39A',
    station: 'CM',
    seat: 'CDR',
    csm: 'PRELAUNCH',
    lm: 'STOWED',
    maxWarp: 10,
  },
  briefing: {
    summary:
      'Cabo Kennedy, 16 de julio de 1969. Armstrong, Collins y Aldrin esperan en la cima de 110 metros de Saturn V. ' +
      'Tu trabajo: completar las últimas comprobaciones, vigilar el ascenso y desechar la torre de escape a tiempo.',
    objectives: ['Completar la lista previa al lanzamiento', 'Desechar la torre de escape (TWR JETT)', 'Alcanzar la órbita terrestre'],
  },
  async run(ctx) {
    ctx.caption('APOLO 11', 'Complejo de lanzamiento 39A — 16 de julio de 1969', 6);
    const obj1 = ctx.objective('prelaunch', 'Completa la lista de comprobación previa al lanzamiento');
    await ctx.crew({
      id: 'a11.prelaunch',
      title: 'LISTA FINAL DE LANZAMIENTO',
      station: 'CM',
      items: [
        { text: 'EDS AUTO — AUTO', sw: { id: 'CM.LV.EDS_AUTO', pos: 'AUTO' } },
        { text: 'SC CONT — CMC', sw: { id: 'CM.GNC.SC_CONT', pos: 'CMC' } },
        { text: 'CMC MODE — AUTO', sw: { id: 'CM.GNC.CMC_MODE', pos: 'AUTO' }, hint: 'Panel 1, sección de control de vuelo' },
        { text: 'SUIT COMPRESSOR 2 — AC2', sw: { id: 'CM.ECS.SUIT_COMPR_2', pos: 'AC2' } },
      ],
      aiPace: [2, 4],
    });
    obj1.done();
    await ctx.poll({
      id: 'a11.launchpoll',
      title: 'GO / NO GO para el lanzamiento',
      consoles: ['BOOSTER', 'RETRO', 'FIDO', 'GUIDO', 'SURGEON', 'EECOM', 'GNC'],
      intro: { en: 'Okay, all flight controllers, go/no-go for launch.', es: 'Muy bien, controladores: GO / NO GO para el lanzamiento.' },
      outro: { en: 'Launch control, Houston is go for launch.', es: 'Control de lanzamiento, Houston está GO para el lanzamiento.' },
      astronautSummary: { who: 'LCC', en: 'Apollo 11, this is launch control. Good luck and Godspeed.', es: 'Apolo 11, aquí control de lanzamiento. Buena suerte y que Dios os acompañe.' },
    });
    await ctx.waitGET(-10);
    ctx.say('LCC', 'T minus 10, 9, ignition sequence start, 6, 5, 4, 3, 2, 1, zero. All engines running. Liftoff! We have a liftoff.',
      'T menos 10, 9, inicio de la secuencia de ignición, 6, 5, 4, 3, 2, 1, cero. Todos los motores funcionando. ¡Despegue! Tenemos despegue.',
      { clip: 'a11_countdown_liftoff', wait: false });
    await ctx.waitEvent('vehicle:event', (e) => e.kind === 'LIFTOFF');
    ctx.say('CDR', 'Liftoff. The clock is running.', 'Despegue. El reloj está en marcha.', { wait: false });
    ctx.say('CAPCOM', 'Roger, liftoff. Tower cleared.', 'Recibido, despegue. Torre superada.', { wait: false });
    await ctx.waitEvent('vehicle:event', (e) => e.kind === 'SII_IGNITION');
    const obj2 = ctx.objective('twr', 'Desecha la torre de escape: TWR JETT 1 o 2 en FIRE');
    ctx.hint('Levanta la tapa protectora del interruptor TWR JETT (clic derecho / pulsación larga) y muévelo a FIRE.');
    await ctx.crew({
      id: 'a11.twr',
      title: 'DESECHO DE LA TORRE (LET)',
      items: [{ text: 'TWR JETT 1 — FIRE', sw: { id: 'CM.LV.TWR_JETT_1', pos: 'FIRE' }, check: (c) => !c.vehicle.parts.les }],
      aiPace: [20, 25],
    });
    obj2.done();
    ctx.say('CAPCOM', 'Tower jettison confirmed.', 'Desecho de la torre confirmado.', { wait: false });
    ctx.score('twr', 100, 100, 'Torre desechada');
    await ctx.waitEvent('vehicle:event', (e) => e.kind === 'ORBIT_INSERTION');
    ctx.say('CAPCOM', 'Apollo 11, Houston. You are confirmed in orbit.', 'Apolo 11, Houston. Confirmado: estáis en órbita.');
    ctx.complete({ summary: 'El Apolo 11 está en una órbita de aparcamiento de 100 millas náuticas.' });
  },
};
