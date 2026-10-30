// Training — DSKY course. Verbs and nouns: "verb" is the action, "noun" the data. The trainee runs
// a lamp test, displays the mission clock (V16 N65), changes programs with V37, reads the IMU gimbal
// angles (V16 N20), clears an operator error with RSET and loads a burn into P30 then P40.

import { GET } from '../../core/MissionClock.js';
import { Vector3 } from 'three';
import { radio } from '../common/kit.js';

export default {
  setup: {
    get: GET(10, 0),
    config: 'CSM',
    state: 'EARTH_PARKING_ORBIT',
    station: 'CM',
    seat: 'CDR',
    csm: 'EARTH_ORBIT',
    lm: null,
    maxWarp: 1,
  },
  speakers: { CAPCOM: 'Instructor' },
  briefing: {
    summary:
      'El Apollo Guidance Computer tenía 4 KB de memoria de trabajo y un teclado de 19 teclas: el DSKY. Se le habla con «verbo» (qué hacer) y «nombre» (con qué datos). ' +
      'En este curso usarás los verbos y programas que se usan en las misiones.',
    objectives: ['Prueba de luces (V35)', 'Mostrar el reloj (V16 N65)', 'Cambiar de programa (V37)', 'Errores de operador y RSET'],
    tips: ['Pasa el ratón sobre el DSKY y usa el teclado: V = VERB, N = NOUN, Intro = ENTR, P = PRO', 'Los números de verbo y nombre tienen dos dígitos', 'Si te equivocas, CLR borra y RSET apaga OPR ERR'],
  },
  async run(ctx) {
    const sim = ctx.sim;
    const cmc = sim.gnc.cmc;
    const d = cmc.dsky.display;
    ctx.caption('CURSO DE DSKY', 'Verbos, nombres y programas', 6);
    let oprSeen = false;
    ctx.every(0.2, () => d.lights.oprErr && (oprSeen = true));
    const lessons = [
      { say: 'Verbo 35 enciende todas las luces y segmentos: así se comprueba que el DSKY funciona. Teclea VERB 3 5 ENTR.', items: [{ text: 'V35 E — prueba de luces', check: () => (cmc.dsky._lampTest ?? 0) > 0, do: () => (cmc.dsky._lampTest = 5) }] },
      { say: 'Verbo 16 muestra un dato y lo actualiza cada segundo. El nombre 65 es el reloj de la misión. Teclea VERB 1 6 NOUN 6 5 ENTR.', items: [{ text: 'V16 N65 E — reloj de la misión', check: () => cmc.dsky.monitor?.verb === '16' && cmc.dsky.monitor?.noun === '65', do: () => (cmc.dsky.monitor = { verb: '16', noun: '65' }) }] },
      { say: 'Verbo 37 cambia de programa: el número va en el campo de nombre. P30 carga una maniobra externa. Teclea VERB 3 7 ENTR 3 0 ENTR.', items: [{ text: 'V37 E 30 E — programa 30', check: () => cmc.program === '30', do: () => cmc.runProgram('30') }] },
      { say: 'Ahora vuelve al programa 00, el de reposo: VERB 3 7 ENTR 0 0 ENTR.', items: [{ text: 'V37 E 00 E — programa 00', check: () => cmc.program === '00', do: () => cmc.runProgram('00') }] },
      { say: 'El nombre 20 son los ángulos de la plataforma inercial: alabeo, cabeceo y guiñada, en centésimas de grado. Teclea VERB 1 6 NOUN 2 0 ENTR y gira la nave para verlos cambiar.', items: [{ text: 'V16 N20 E — ángulos del IMU', check: () => cmc.dsky.monitor?.noun === '20', do: () => (cmc.dsky.monitor = { verb: '16', noun: '20' }) }] },
      { say: 'Si tecleas algo que el ordenador no entiende se enciende OPR ERR. Prueba un verbo que no existe, por ejemplo VERB 7 7 ENTR, y luego apágalo con RSET.', items: [{ text: 'Provocar OPR ERR (V77 E)', check: () => oprSeen, do: () => { d.lights.oprErr = true; oprSeen = true; } }, { text: 'RSET — apagar OPR ERR', check: () => oprSeen && !d.lights.oprErr, do: () => (d.lights.oprErr = false) }] },
    ];
    let i = 0;
    let auto = 0;
    for (const l of lessons) {
      await ctx.say('CAPCOM', l.say, l.say);
      const r = await ctx.crew({ id: `tr.dsky.${i}`, title: `LECCIÓN ${i + 1}`, items: l.items, aiPace: [3, 5] });
      auto += r.autoUsed;
      ctx.score(`l${i}`, r.autoUsed ? 5 : 20, 20, `Lección ${i + 1}`);
      i++;
    }
    // final exam: a burn through P30 and P40 (no ignition in the simulator)
    await ctx.say('CAPCOM', 'Last one. Houston has loaded a maneuver for you. Select P40 and watch the computer turn the spacecraft to the burn attitude.', 'Última. Houston cargó una maniobra (P30). Selecciona P40 con VERB 3 7 ENTR 4 0 ENTR y mira cómo el ordenador gira la nave hacia la actitud del encendido.');
    const st = ctx.vehicle.state;
    cmc.loadBurn({ name: 'PRÁCTICA', tig: ctx.t + 3600, dvECI: new Vector3().copy(st.v).normalize().multiplyScalar(3), dvTotal: 3, burnTime: 1 });
    ctx.sw.set('CM.GNC.CMC_MODE', 'AUTO', 'script');
    const r = await ctx.crew({ id: 'tr.dsky.exam', title: 'EXAMEN: P40', items: [{ text: 'V37 E 40 E — programa 40', check: () => cmc.program === '40', do: () => cmc.runProgram('40') }, { text: 'V06 N40 en pantalla: tiempo al encendido, Vg y ΔV', check: () => cmc.dsky.monitor?.noun === '40' }], aiPace: [3, 5] });
    auto += r.autoUsed;
    await ctx.wait(10);
    cmc.burn = null;
    cmc.runProgram('00');
    ctx.score('exam', r.autoUsed ? 10 : 40, 40, 'Examen P40');
    radio(ctx, 'CAPCOM', 'Well done. You speak AGC now.', 'Bien hecho. Ya hablas el idioma del AGC.');
    ctx.achievement('tr-dsky');
    ctx.complete({ summary: `Curso completado: V35, V16 N65, V37, V16 N20, OPR ERR / RSET y P30 → P40.${auto ? ` Usaste ayuda ${auto} vez/veces.` : ''}`, stats: { Lecciones: lessons.length + 1, Ayudas: auto } });
  },
};
