// Free flight (sandbox): pick a launch vehicle and a starting point, then fly anything — with the
// whole simulation running and Houston on call for maneuver PADs. Chapter ids: "free:<vehicle>:<start>".

import { Vector3 } from 'three';
import { translunarState, basisQ } from '../common/states.js';
import { GET } from '../../core/MissionClock.js';
import { MISSION_EPOCH, R_MOON, NMI } from '../../core/constants.js';
import { SITES, siteDir } from '../../sim/terrain/lunarTerrain.js';
import { planTLI, planMCC, planLOI, planTEI, planCircularize, planApsis, planDeorbit, planDOI, contextFromSim, fmtGET } from '../../sim/physics/targeting.js';

export const FREE_VEHICLES = [
  {
    id: 'saturnv',
    name: 'Saturn V',
    sub: 'Apolo · CSM Columbia + LM Eagle',
    desc: 'El cohete más poderoso que voló jamás: tres etapas, 110,6 m y 7,5 millones de libras de empuje. Puede llevarte a la Luna y traerte de vuelta.',
    specs: [['Altura', '110,6 m'], ['Masa al despegue', '2.900 t'], ['Empuje', '34 MN (5 × F-1)'], ['Etapas', 'S-IC · S-II · S-IVB']],
    favorite: true,
    starts: ['pad', 'orbit', 'tde', 'tlc', 'lunar', 'pdi', 'surface', 'entry'],
  },
  {
    id: 'saturnib',
    name: 'Saturn IB',
    sub: 'Skylab / ASTP · CSM en órbita terrestre',
    desc: 'El hermano menor: dos etapas, ocho motores H-1 y la misma S-IVB. En la plataforma 39B sobre su pedestal «milkstool».',
    specs: [['Altura', '68 m (+ 39 m de pedestal)'], ['Masa al despegue', '590 t'], ['Empuje', '7,1 MN (8 × H-1)'], ['Etapas', 'S-IB · S-IVB']],
    starts: ['pad', 'orbit'],
  },
];

export const FREE_STARTS = {
  pad: { title: 'En la plataforma', sub: 'T−2:30 · cuenta final', icon: 'rocket' },
  orbit: { title: 'Órbita terrestre', sub: '100 nmi · listo para la TLI', icon: 'globe' },
  tde: { title: 'Tras la TLI', sub: 'Transposición y acoplamiento', icon: 'camera' },
  tlc: { title: 'Rumbo a la Luna', sub: 'Costa translunar · CSM + LM', icon: 'next' },
  lunar: { title: 'Órbita lunar', sub: '60 nmi · CSM + LM acoplados', icon: 'globe' },
  pdi: { title: 'Descenso lunar', sub: 'LM a 50.000 ft · antes del PDI', icon: 'next' },
  surface: { title: 'En la superficie', sub: 'Base Tranquilidad · listo para despegar', icon: 'home' },
  entry: { title: 'Reentrada', sub: 'Módulo de mando · 11 km/s', icon: 'next' },
};

async function setupFor(vehicle, start) {
  if (vehicle === 'saturnib') {
    if (start === 'pad') return { get: -150, config: 'SATURN_IB', state: 'PAD_39B_IB', station: 'CM', seat: 'CDR', csm: 'PRELAUNCH', lm: null, maxWarp: 10 };
    return {
      get: GET(1, 20),
      config: 'CSM',
      state: 'IB_EARTH_ORBIT',
      station: 'CM',
      csm: 'EARTH_ORBIT',
      lm: null,
      bodies: [(sim) => {
        const st = sim.vehicle.state;
        const fwd = st.v.clone().normalize();
        return { id: 'SIVB', config: 'SIVB', r: st.r.clone().addScaledVector(fwd, 120), v: st.v.clone(), q: basisQ(fwd, st.r.clone().normalize().negate()), label: 'S-IVB' };
      }],
    };
  }
  switch (start) {
    case 'pad':
      return { get: -150, config: 'SATURN_V', state: 'PAD_39A', station: 'CM', seat: 'CDR', csm: 'PRELAUNCH', lm: 'STOWED', maxWarp: 10 };
    case 'orbit':
      return { get: GET(1, 45), config: 'SIVB_STACK', state: 'EARTH_PARKING_ORBIT', station: 'CM', csm: 'EARTH_ORBIT', lm: 'STOWED' };
    case 'tde': {
      const s = await translunarState(GET(3, 18));
      const fwd = s.v.clone().normalize();
      const down = s.r.clone().normalize().negate();
      // CSM 24 m ahead of the S-IVB, turned around facing the LM in the SLA
      const csmR = s.r.clone().addScaledVector(fwd, 30);
      return {
        get: s.get,
        config: 'CSM',
        state: { r: csmR, v: s.v.clone(), q: basisQ(fwd.clone().negate(), down), w: new Vector3(), mode: 'SPACE' },
        station: 'CM',
        csm: 'TLC',
        lm: 'STOWED',
        bodies: [{ id: 'SIVB_LM', config: 'SIVB_LM', r: s.r.clone(), v: s.v.clone(), q: basisQ(fwd, down), label: 'S-IVB / Eagle' }],
      };
    }
    case 'tlc': {
      const s = await translunarState(GET(26, 0));
      const fwd = s.v.clone().normalize();
      return { get: s.get, config: 'CSM_LM', state: { r: s.r, v: s.v, q: basisQ(fwd, s.r.clone().normalize().negate()), w: new Vector3(0, 0.0052, 0), mode: 'SPACE' }, station: 'CM', csm: 'TLC', lm: 'STOWED' };
    }
    case 'lunar':
      return { get: GET(100, 0), config: 'CSM_LM', state: 'LUNAR_ORBIT', station: 'CM', csm: 'LUNAR_ORBIT', lm: 'ACTIVATED' };
    case 'pdi':
      return { get: GET(102, 33), config: 'LM', state: 'PRE_PDI', station: 'LM', seat: 'CDR', csm: null, lm: 'PRE_PDI', maxWarp: 4 };
    case 'surface':
      return { get: GET(124, 10), config: 'LM', state: 'LUNAR_SURFACE_TRANQUILITY', station: 'LM', seat: 'CDR', csm: null, lm: 'PRE_ASCENT' };
    case 'entry':
      return { get: GET(195, 1), config: 'CM', state: 'PRE_ENTRY', station: 'CM', csm: 'ENTRY', lm: null };
    default:
      return { get: GET(1, 45), config: 'SIVB_STACK', state: 'EARTH_PARKING_ORBIT', station: 'CM', csm: 'EARTH_ORBIT', lm: 'STOWED' };
  }
}

/** Houston services available right now. */
export function availableServices(sim) {
  const v = sim.vehicle;
  const st = v.state;
  const sat = v.modules.saturn && v.isAttached('saturn') ? v.modules.saturn : null;
  const csm = v.modules.csm;
  const lm = v.modules.lm;
  const hasSM = !!csm?.hasSM && v.isAttached('csm');
  const out = [];
  const closed = Number.isFinite(st.apoAlt);
  if (sat && sat.stage === 'SIVB_COAST' && st.primary === 'EARTH' && !sat.done.has('TLI_CUTOFF') && sat.variant === 'V') out.push(['tli', 'Inyección translunar (TLI)', 'Houston calcula la hora del TB6 y el corte del S-IVB']);
  if (sat?.stage === 'SIVB_COAST' && (sat.tb6 !== null)) out.push(['tliStop', 'Cancelar la TLI (XLUNAR SAFE)', 'Detiene la secuencia de reencendido']);
  if (v.station === 'CM' && hasSM && !sat) {
    if (st.primary === 'EARTH' && st.alt > 3e7) out.push(['mcc', 'Corrección de medio curso', 'Ajusta la llegada a la Luna o el corredor de reentrada']);
    if (st.primary === 'MOON' && !closed) out.push(['loi', 'Inserción en órbita lunar (LOI)', 'Frenado detrás de la Luna, 60 × 170 nmi']);
    if (st.primary === 'MOON' && !closed && st.alt > 40000) out.push(['mcc', 'Corrección de medio curso', 'Ajusta el perilunio']);
    if (closed) out.push(['circ', 'Circularizar la órbita', 'Encendido en el próximo apoápside']);
    if (closed) out.push(['raise', 'Elevar el apoápside +100 km', 'Encendido en el próximo periápside']);
    if (st.primary === 'MOON' && closed) out.push(['tei', 'Inyección transterrestre (TEI)', 'Volver a casa: Houston busca el encendido']);
    if (st.primary === 'EARTH' && closed && st.apoAlt < 3e6) out.push(['deorbit', 'Desorbitar para reentrar', 'Perigeo a 20 km de altura']);
  }
  if (v.config === 'CSM_LM' || v.config === 'CSM_LMASC') {
    if (v.station === 'CM' && lm) out.push(['toLM', 'Pasar al módulo lunar', 'Flotar por el túnel al LM']);
    if (v.station === 'LM') out.push(['toCM', 'Volver al módulo de mando', '']);
    out.push(['undock', 'Desacoplar', 'Libera los cerrojos del túnel']);
  }
  if (v.station === 'LM' && lm && st.primary === 'MOON' && !st.landed) {
    if (closed && st.periAlt > 30000) out.push(['doi', 'Inserción en órbita de descenso (DOI)', 'Baja el perilunio a 50.000 ft']);
    if (st.alt < 40000 && v.config === 'LM' && !sim.gnc.lmGuidance.phase) out.push(['pdi', 'Iniciar el descenso motorizado (P63)', 'Hacia la Base Tranquilidad']);
  }
  if (v.station === 'LM' && st.landed) out.push(['ascent', 'Despegue lunar (P12)', 'Prepara el ordenador para el ascenso']);
  if (v.station === 'CM' && st.primary === 'EARTH' && csm && hasSM && st.alt < 2e6 && !closed) out.push(['cmsep', 'Preparar la reentrada', 'Recordatorio: separar el SM antes de la interfaz']);
  out.push(['status', 'Informe de estado', 'Houston lee la trayectoria y los consumibles']);
  return out;
}

export async function buildFreeChapter(chapterId) {
  const [, vehicleId = 'saturnv', startId = 'pad'] = chapterId.split(':');
  const vehicle = FREE_VEHICLES.find((x) => x.id === vehicleId) ?? FREE_VEHICLES[0];
  const start = FREE_STARTS[startId] ?? FREE_STARTS.pad;
  const setup = await setupFor(vehicle.id, startId);
  return {
    id: chapterId,
    missionId: 'free',
    free: true,
    vehicle: vehicle.id,
    start: startId,
    order: 0,
    title: `${vehicle.name} · ${start.title}`,
    subtitle: start.sub,
    minutes: '∞',
    roles: ['astronaut'],
    controllerRole: null,
    setup,
    briefing: {
      summary: `${vehicle.desc} Vuelo libre: no hay guion. Todos los sistemas funcionan, el tiempo es tuyo y Houston calcula las maniobras cuando se las pidas.`,
      objectives: ['Volar a tu manera', 'Pedir PADs a Houston con el botón «Houston»', 'Seguir los procedimientos del manual de a bordo'],
      tips: ['Tecla . para acelerar el tiempo (se frena solo antes de cada encendido)', 'C: cabina / exterior · V: siguiente cámara', 'El botón con el libro abre el manual de procedimientos'],
    },
    async run(ctx) {
      const sim = ctx.sim;
      const v = ctx.vehicle;
      ctx.caption('VUELO LIBRE', `${vehicle.name} · ${start.title}`, 5);
      ctx.flag('free', true);
      const stats = { maxAlt: 0, maxSpeed: 0, events: new Set() };
      ctx.every(2, () => {
        const st = v.state;
        if (st.primary === 'EARTH') stats.maxAlt = Math.max(stats.maxAlt, st.alt);
        stats.maxSpeed = Math.max(stats.maxSpeed, st.speed);
      });
      const say = (who, en, es, o = {}) => ctx.say(who, en, es, { wait: false, ...o });
      // ---- radio calls on milestones
      ctx.on('vehicle:event', (e) => {
        stats.events.add(e.kind);
        switch (e.kind) {
          case 'LIFTOFF':
            say('LCC', 'Liftoff! We have liftoff!', '¡Despegue! ¡Tenemos despegue!');
            say('CAPCOM', 'Roger, liftoff. The clock is running.', 'Recibido, despegue. El reloj está en marcha.');
            break;
          case 'TOWER_CLEAR':
            say('CAPCOM', 'Tower cleared.', 'Torre superada.');
            break;
          case 'SIC_SEP':
          case 'SIB_SEP':
            say('CAPCOM', 'Staging. Good ignition.', 'Separación de etapa. Buena ignición.');
            break;
          case 'LES_JETT':
            say('CAPCOM', 'Tower jettison confirmed.', 'Confirmado: torre desechada.');
            break;
          case 'ORBIT_INSERTION':
            say('CAPCOM', 'You are confirmed GO for orbit.', 'Confirmado: GO para la órbita.');
            ctx.achievement('free-orbit');
            break;
          case 'TLI_IGNITION':
            say('CAPCOM', 'We confirm ignition and the thrust is GO.', 'Confirmamos ignición; el empuje es GO.');
            break;
          case 'TLI_CUTOFF':
            if (!e.inhibited) {
              say('CAPCOM', 'Houston. We show cutoff and we copy the numbers. You are well on your way now.', 'Houston. Vemos el apagado y copiamos los datos. Ya están bien encaminados.');
              ctx.achievement('free-tli');
            }
            break;
          case 'DOCK_CAPTURE':
            say('CDR', 'Capture.', 'Captura.');
            break;
          case 'DOCK_HARD':
            say('CAPCOM', 'Roger, hard dock. Nice job.', 'Recibido, acoplamiento firme. Buen trabajo.');
            ctx.achievement('free-dock');
            break;
          case 'TOUCHDOWN':
            if (e.crash) {
              ctx.alert('Impacto contra la superficie lunar', 'warning');
              ctx.fail('El módulo lunar se estrelló.', { stats: { 'Vel. vertical': `${(e.vSpeed / 0.3048).toFixed(1)} ft/s` } });
            } else {
              ctx.say('CDR', 'Houston, Tranquility Base here. The Eagle has landed.', 'Houston, aquí Base Tranquilidad. El Eagle ha alunizado.', { clip: 'a11_eagle_has_landed', wait: false });
              ctx.achievement('free-landing');
            }
            break;
          case 'SPLASHDOWN':
            say('RECOVERY', 'Splashdown! We have a visual on the spacecraft.', '¡Amerizaje! Tenemos contacto visual con la nave.');
            ctx.achievement('free-splash');
            ctx.complete({ summary: `Amerizaje. Altitud máxima ${(stats.maxAlt / 1000).toFixed(0)} km · velocidad máxima ${(stats.maxSpeed / 1000).toFixed(2)} km/s.`, stats: { Eventos: stats.events.size } });
            break;
          default:
            break;
        }
      });
      ctx.on('dynamics:mode', ({ mode }) => {
        if (mode === 'ENTRY') say('CAPCOM', 'We have entry interface. See you on the other side of blackout.', 'Interfaz de reentrada. Nos vemos al otro lado del apagón.');
      });
      // ---- Houston services
      let busy = false;
      const loadPad = (padObj, engineName) => {
        const comp = sim.gnc.activeComputer;
        comp.loadBurn({ ...padObj, dvECI: padObj.dvECI });
        ctx.pad({ ...padObj, dv: undefined });
        const n = padObj.dvTotal / 0.3048;
        say('CAPCOM', `${padObj.name} PAD: TIG ${fmtGET(padObj.tig)}, delta-V ${n.toFixed(1)} feet per second, ${engineName}. Loaded in your computer.`, `PAD de ${padObj.name}: TIG ${fmtGET(padObj.tig)}, ΔV ${n.toFixed(1)} pies/s con el ${engineName}. Cargado en el ordenador.`);
        ctx.hint('Haz la lista «Encendido del SPS con el ordenador (P30 / P40)»: motores de cardán, ΔV THRUST, V37E40E y PRO en V99.', { durationS: 12 });
      };
      ctx.on('free:service', async ({ id }) => {
        if (busy) return;
        busy = true;
        const c = contextFromSim(sim);
        try {
          if (id === 'status') {
            const st = v.state;
            const R0 = st.primary === 'MOON' ? 'perilunio' : 'perigeo';
            const A0 = st.primary === 'MOON' ? 'apolunio' : 'apogeo';
            say('CAPCOM', 'Houston with a status update.', `Informe de Houston: ${A0} ${Number.isFinite(st.apoAlt) ? (st.apoAlt / NMI).toFixed(1) + ' nmi' : 'abierto (trayectoria de escape)'}, ${R0} ${(st.periAlt / NMI).toFixed(1)} nmi, velocidad ${(st.speed / 0.3048).toFixed(0)} pies/s.`);
          } else if (id === 'tli') {
            say('CAPCOM', 'Roger, stand by for TLI numbers.', 'Recibido, esperen los datos de la TLI.');
            ctx.alert('Houston calcula la TLI…', 'info', 4);
            const p = await planTLI(c);
            sim.saturn.startTB6({ c3: p.c3, tb6: p.tb6 });
            v.sw.set('CM.LV.XLUNAR', 'INJECT', 'script');
            ctx.pad({ name: 'TLI', tig: p.tig, dvTotal: p.dvTotal, burnTime: p.burnTime, engine: 'S-IVB', notes: `TB6 a GET ${fmtGET(p.tb6)}. ${p.notes}` });
            say('CAPCOM', `Apollo, Houston. You are GO for TLI. TB6 at ${fmtGET(p.tb6)}.`, `Apolo, Houston. Tienen GO para la TLI. El TB6 empieza a GET ${fmtGET(p.tb6)}; ignición 9 minutos 38 segundos después.`);
          } else if (id === 'tliStop') {
            sim.saturn.inhibitTLI('crew');
            v.sw.set('CM.LV.XLUNAR', 'SAFE', 'script');
            say('CAPCOM', 'Roger, TLI inhibited.', 'Recibido: TLI inhibida.');
          } else if (id === 'mcc') {
            ctx.alert('Houston calcula la corrección…', 'info', 4);
            const p = await planMCC(c, { periluneKm: 110 });
            loadPad(p, 'SPS');
          } else if (id === 'loi') {
            ctx.alert('Houston calcula la LOI…', 'info', 4);
            const p = await planLOI(c);
            if (p) loadPad(p, 'SPS');
            else say('CAPCOM', 'Negative, no LOI solution from here.', 'Negativo: desde aquí no hay solución de LOI.');
          } else if (id === 'tei') {
            ctx.alert('Houston calcula la TEI…', 'info', 5);
            const p = await planTEI(c);
            loadPad(p, 'SPS');
          } else if (id === 'circ') {
            const p = await planCircularize(c);
            if (p) loadPad(p, c.engine);
          } else if (id === 'raise') {
            const st = v.state;
            const p = await planApsis(c, st.apoAlt / 1000 + 100);
            if (p) loadPad(p, c.engine);
          } else if (id === 'deorbit') {
            const p = await planDeorbit(c);
            loadPad(p, 'SPS');
          } else if (id === 'doi') {
            const p = await planDOI(c);
            loadPad(p, 'DPS');
          } else if (id === 'pdi') {
            sim.gnc.startDescent(siteDir(SITES.TRANQUILITY));
            say('CAPCOM', 'Eagle, Houston. You are GO for powered descent.', 'Eagle, Houston. Tienen GO para el descenso motorizado.');
          } else if (id === 'ascent') {
            sim.gnc.lgc.runProgram('12');
            say('CAPCOM', 'Roger, you are cleared for takeoff.', 'Recibido, tienen autorización para despegar. Armen el motor de ascenso y separen la etapa.');
          } else if (id === 'toLM') {
            v.setStation('LM');
          } else if (id === 'toCM') {
            v.setStation('CM');
          } else if (id === 'undock') {
            v.request('UNDOCK', { label: v.station === 'LM' ? 'Columbia' : 'Eagle' });
            say('CAPCOM', 'Roger, we copy the undocking.', 'Recibido, copiamos el desacoplamiento.');
          } else if (id === 'cmsep') {
            ctx.hint('Lista «Separación CM/SM y reentrada»: SECS ARM, CM/SM SEP, EMS en ENTRY, ELS en AUTO.', { durationS: 12 });
          }
        } catch (err) {
          console.error('[free] service failed', err);
          ctx.alert('Houston no pudo calcular esa maniobra', 'caution');
        } finally {
          busy = false;
        }
      });
      ctx.on('free:end', () => ctx.complete({ summary: `Vuelo libre terminado. Altitud máxima sobre la Tierra ${(stats.maxAlt / 1000).toFixed(0)} km · velocidad máxima ${(stats.maxSpeed / 1000).toFixed(2)} km/s · ${stats.events.size} eventos.` }));
      // greeting
      await ctx.wait(2);
      if (startId === 'pad') say('LCC', 'This is Kennedy launch control. The countdown is proceeding.', 'Aquí control de lanzamiento de Kennedy. La cuenta atrás continúa.');
      else say('CAPCOM', 'Houston standing by. Call us when you need numbers.', 'Houston a la escucha. Llamen cuando necesiten datos.');
      await ctx.waitUntil(() => false); // free flight never ends by itself (cancelled on exit)
    },
  };
}

export const FREE_MISSION = {
  id: 'free',
  name: 'Vuelo libre',
  tagline: 'Elige tu cohete y vuela a tu manera',
  date: 'Sandbox',
  patch: 'training',
  free: true,
  chapters: [],
};

void MISSION_EPOCH;
void R_MOON;
