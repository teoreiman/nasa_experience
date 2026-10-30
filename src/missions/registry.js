// Campaign registry: missions, crews and chapters (metadata + lazy loaders).
// Chapter modules default-export a chapter definition (see docs/ARCHITECTURE.md §10):
//   { id, setup: {...}, run: async (ctx) => {...}, briefing?: {...}, speakers?: {...} }
// Metadata here is what menus show before loading a chapter.

import { GET } from '../core/MissionClock.js';
import { FREE_MISSION } from './free/index.js';

export const ROLES = {
  astronaut: { id: 'astronaut', name: 'Astronauta', desc: 'Vuela la misión desde la cabina, en primera persona.' },
  controller: { id: 'controller', name: 'Controlador de vuelo', desc: 'Dirige la misión desde el Control de Misión en Houston, en primera persona.' },
};

const A11_CREW = { CDR: 'Neil Armstrong', CMP: 'Michael Collins', LMP: 'Edwin "Buzz" Aldrin' };
const A13_CREW = { CDR: 'Jim Lovell', CMP: 'Jack Swigert', LMP: 'Fred Haise' };
const A12_CREW = { CDR: 'Pete Conrad', CMP: 'Richard Gordon', LMP: 'Alan Bean' };
const A8_CREW = { CDR: 'Frank Borman', CMP: 'Jim Lovell', LMP: 'William Anders' };

const both = ['astronaut', 'controller'];

export const MISSIONS = [
  {
    id: 'apollo11',
    name: 'Apolo 11',
    tagline: 'El primer alunizaje tripulado',
    date: '16–24 de julio de 1969',
    crew: A11_CREW,
    callsigns: { CSM: 'Columbia', LM: 'Eagle' },
    hardware: 'Saturn V SA-506 · CSM-107 Columbia · LM-5 Eagle',
    patch: 'apollo11',
    campaign: true,
    chapters: [
      { id: 'a11-launch', order: 1, title: 'Lanzamiento', subtitle: 'Del Complejo 39A a la órbita terrestre', getStart: -GET(0, 15), roles: both, controllerRole: 'BOOSTER', minutes: 20, load: () => import('./apollo11/launch.js') },
      { id: 'a11-tli', order: 2, title: 'Inyección translunar', subtitle: 'Alineación del IMU y encendido del S-IVB hacia la Luna', getStart: GET(2, 20), roles: both, controllerRole: 'FIDO', minutes: 20, load: () => import('./apollo11/tli.js') },
      { id: 'a11-tde', order: 3, title: 'Transposición y acoplamiento', subtitle: 'Extraer al Eagle del S-IVB', getStart: GET(3, 15), roles: both, controllerRole: 'GNC', minutes: 15, load: () => import('./apollo11/tde.js') },
      { id: 'a11-loi', order: 4, title: 'Inserción en órbita lunar', subtitle: 'El encendido del SPS detrás de la Luna', getStart: GET(75, 30), roles: both, controllerRole: 'RETRO', minutes: 20, load: () => import('./apollo11/loi.js') },
      { id: 'a11-undock', order: 5, title: 'El Eagle tiene alas', subtitle: 'Separación y órbita de descenso', getStart: GET(100, 5), roles: both, controllerRole: 'TELMU', minutes: 15, load: () => import('./apollo11/undock.js') },
      { id: 'a11-landing', order: 6, title: 'Descenso motorizado', subtitle: 'Alarmas 1202, rocas y 30 segundos de combustible', getStart: GET(102, 20), roles: both, controllerRole: 'GUIDO', minutes: 25, load: () => import('./apollo11/landing.js') },
      { id: 'a11-eva', order: 7, title: 'Un pequeño paso', subtitle: 'Caminata lunar en el Mar de la Tranquilidad', getStart: GET(109, 10), roles: ['astronaut'], controllerRole: 'SURGEON', minutes: 20, scene: 'eva', load: () => import('./apollo11/eva.js') },
      { id: 'a11-ascent', order: 8, title: 'Despegue lunar y encuentro', subtitle: 'Un disyuntor roto y la cita con Columbia', getStart: GET(124, 5), roles: both, controllerRole: 'CONTROL', minutes: 20, load: () => import('./apollo11/ascent.js') },
      { id: 'a11-tei', order: 9, title: 'Regreso a casa', subtitle: 'Inyección transterrestre', getStart: GET(135, 10), roles: both, controllerRole: 'RETRO', minutes: 15, load: () => import('./apollo11/tei.js') },
      { id: 'a11-entry', order: 10, title: 'Reentrada y amerizaje', subtitle: '11 km/s hacia el Pacífico', getStart: GET(194, 45), roles: both, controllerRole: 'RETRO', minutes: 20, load: () => import('./apollo11/entry.js') },
    ],
  },
  {
    id: 'apollo13',
    name: 'Apolo 13',
    tagline: 'Un fracaso exitoso',
    date: '11–17 de abril de 1970',
    crew: A13_CREW,
    callsigns: { CSM: 'Odyssey', LM: 'Aquarius' },
    hardware: 'Saturn V SA-508 · CSM-109 Odyssey · LM-7 Aquarius',
    patch: 'apollo13',
    campaign: true,
    chapters: [
      { id: 'a13-launch', order: 1, title: 'Lanzamiento', subtitle: 'El motor central del S-II se apaga antes de tiempo', getStart: -GET(0, 10), roles: both, controllerRole: 'BOOSTER', minutes: 20, load: () => import('./apollo13/launch.js') },
      { id: 'a13-explosion', order: 2, title: 'Houston, hemos tenido un problema', subtitle: 'Agitar los tanques criogénicos', getStart: GET(55, 40), roles: both, controllerRole: 'EECOM', minutes: 25, load: () => import('./apollo13/explosion.js') },
      { id: 'a13-lifeboat', order: 3, title: 'Aquarius, bote salvavidas', subtitle: 'Encender el LM antes de que muera el Odyssey', getStart: GET(56, 30), roles: both, controllerRole: 'TELMU', minutes: 25, load: () => import('./apollo13/lifeboat.js') },
      { id: 'a13-freereturn', order: 4, title: 'Regreso libre', subtitle: 'Encendido del DPS para volver a una trayectoria de retorno', getStart: GET(61, 0), roles: both, controllerRole: 'FIDO', minutes: 15, load: () => import('./apollo13/freereturn.js') },
      { id: 'a13-pc2', order: 5, title: 'PC+2', subtitle: 'Rodeando la cara oculta de la Luna', getStart: GET(77, 0), roles: both, controllerRole: 'RETRO', minutes: 20, load: () => import('./apollo13/pc2.js') },
      { id: 'a13-co2', order: 6, title: 'El problema del CO₂', subtitle: 'Un cuadrado en un agujero redondo', getStart: GET(83, 0), roles: both, controllerRole: 'EECOM', minutes: 20, load: () => import('./apollo13/co2.js') },
      { id: 'a13-mcc5', order: 7, title: 'Corrección manual', subtitle: 'Volar con el terminador terrestre en el COAS', getStart: GET(104, 50), roles: both, controllerRole: 'GNC', minutes: 15, load: () => import('./apollo13/mcc5.js') },
      { id: 'a13-powerup', order: 8, title: 'Reactivar el Odyssey', subtitle: 'Un procedimiento de encendido con amperios contados', getStart: GET(137, 0), roles: both, controllerRole: 'EECOM', minutes: 25, load: () => import('./apollo13/powerup.js') },
      { id: 'a13-entry', order: 9, title: 'Reentrada', subtitle: 'El apagón de radio más largo', getStart: GET(142, 10), roles: both, controllerRole: 'RETRO', minutes: 15, load: () => import('./apollo13/entry.js') },
    ],
  },
  {
    id: 'apollo12',
    name: 'Apolo 12',
    tagline: 'Rayos en el lanzamiento',
    date: '14 de noviembre de 1969',
    crew: A12_CREW,
    callsigns: { CSM: 'Yankee Clipper', LM: 'Intrepid' },
    hardware: 'Saturn V SA-507 · CSM-108 Yankee Clipper · LM-6 Intrepid',
    patch: 'apollo12',
    special: true,
    chapters: [
      { id: 'a12-lightning', order: 1, title: 'SCE a AUX', subtitle: 'Dos rayos golpean al Saturn V en pleno ascenso', getStart: -GET(0, 5), roles: both, controllerRole: 'EECOM', minutes: 15, load: () => import('./apollo12/lightning.js') },
    ],
  },
  {
    id: 'apollo8',
    name: 'Apolo 8',
    tagline: 'Los primeros en rodear la Luna',
    date: '21–27 de diciembre de 1968',
    crew: A8_CREW,
    callsigns: { CSM: 'Apollo 8' },
    hardware: 'Saturn V SA-503 · CSM-103',
    patch: 'apollo8',
    special: true,
    chapters: [
      { id: 'a08-loi', order: 1, title: 'Detrás de la Luna', subtitle: 'La primera inserción en órbita lunar', getStart: GET(68, 50), roles: both, controllerRole: 'RETRO', minutes: 15, load: () => import('./apollo8/loi.js') },
      { id: 'a08-earthrise', order: 2, title: 'Salida de la Tierra', subtitle: 'La fotografía que cambió al mundo', getStart: GET(75, 30), roles: ['astronaut'], controllerRole: 'FAO', minutes: 10, load: () => import('./apollo8/earthrise.js') },
    ],
  },
  {
    id: 'training',
    name: 'Entrenamiento',
    tagline: 'Simuladores de Houston y Cabo Kennedy',
    date: 'Centro de Naves Tripuladas',
    crew: A11_CREW,
    hardware: 'Simuladores CMS y LMS',
    patch: 'training',
    training: true,
    chapters: [
      { id: 'tr-cockpit', order: 1, title: 'Recorrido por la cabina', subtitle: 'Paneles, interruptores e indicadores del CM', getStart: GET(10, 0), roles: ['astronaut'], minutes: 10, load: () => import('./training/cockpit.js') },
      { id: 'tr-dsky', order: 2, title: 'Curso de DSKY', subtitle: 'Verbos, nombres y programas del ordenador de guiado', getStart: GET(10, 0), roles: ['astronaut'], minutes: 10, load: () => import('./training/dsky.js') },
      { id: 'tr-docking', order: 3, title: 'Práctica de acoplamiento', subtitle: 'Sonda, cono y COAS', getStart: GET(3, 20), roles: ['astronaut'], minutes: 10, load: () => import('./training/docking.js') },
      { id: 'tr-landing', order: 4, title: 'Práctica de alunizaje', subtitle: 'Elige lugar y dificultad', getStart: GET(102, 33), roles: ['astronaut'], minutes: 15, load: () => import('./training/landing.js') },
      { id: 'tr-entry', order: 5, title: 'Práctica de reentrada', subtitle: 'El corredor de reentrada y el EMS', getStart: GET(194, 48), roles: ['astronaut'], minutes: 10, load: () => import('./training/entry.js') },
      { id: 'tr-launch', order: 6, title: 'Lanzamiento libre', subtitle: 'Mira despegar un Saturn V desde todas las cámaras', getStart: -GET(0, 1), roles: both, controllerRole: 'BOOSTER', minutes: 15, load: () => import('./training/launch.js') },
      { id: 'tr-mocr', order: 7, title: 'Recorrido por el Control de Misión', subtitle: 'Las consolas de la sala MOCR', getStart: GET(10, 0), roles: ['controller'], controllerRole: 'FLIGHT', minutes: 10, load: () => import('./training/mocr.js') },
    ],
  },
];

export function getMission(id) {
  if (id === 'free') return FREE_MISSION;
  return MISSIONS.find((m) => m.id === id) ?? null;
}

export function findChapter(chapterId) {
  for (const m of MISSIONS) {
    const c = m.chapters.find((ch) => ch.id === chapterId);
    if (c) return { mission: m, meta: c };
  }
  return null;
}

/** Loads and merges a chapter module with its registry metadata. */
export async function loadChapter(chapterId) {
  if (chapterId.startsWith('free:')) {
    const { buildFreeChapter } = await import('./free/index.js');
    return { mission: FREE_MISSION, chapter: await buildFreeChapter(chapterId) };
  }
  const found = findChapter(chapterId);
  if (!found) throw new Error(`Capítulo desconocido: ${chapterId}`);
  const mod = await found.meta.load();
  const def = mod.default;
  const chapter = { ...found.meta, ...def, id: chapterId, missionId: found.mission.id };
  // setup may be async (states generated by flying the real trajectory)
  const setup = typeof def.setup === 'function' ? await def.setup() : def.setup;
  chapter.setup = { get: found.meta.getStart, ...(setup ?? {}) };
  return { mission: found.mission, chapter };
}

/** Scene that plays a chapter: 'eva' for the lunar surface walk, 'play' for everything else. */
export function chapterScene(chapterId) {
  return findChapter(chapterId)?.meta.scene ?? 'play';
}

/** No level gating: every chapter is playable from the start (free choice, like a sandbox). */
export function isUnlocked() {
  return true;
}
