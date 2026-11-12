// Apollo 11 — One small step. GET 109:19: Armstrong is on the porch of the Eagle. Down the nine
// rungs, the first step onto the Sea of Tranquility (the original recording), the contingency sample,
// Aldrin coming out, the flag, the EASEP (seismometer and laser reflector, which still answers lasers
// from Earth), documented samples, and back up the ladder. The player walks the real collision terrain
// around the LM; without a view (headless runs) the same script plays itself.

import { GET } from '../../core/MissionClock.js';
import { radio, grade } from '../common/kit.js';

export default {
  setup: {
    get: GET(109, 19),
    config: 'LM',
    state: 'LUNAR_SURFACE_TRANQUILITY',
    station: 'LM',
    seat: 'CDR',
    csm: null,
    lm: 'LANDED',
    scene: 'eva',
  },
  speakers: { CAPCOM: 'Bruce McCandless' },
  briefing: {
    summary:
      '20 de julio de 1969, 22:51 en Houston. Seis horas y media después del alunizaje, Armstrong sale de rodillas por la escotilla del Eagle. ' +
      'Seiscientos millones de personas miran la imagen en blanco y negro de la cámara de la escalera. Tienes dos horas y media de oxígeno en la mochila y una lista de tareas en la muñeca.',
    objectives: ['Bajar por la escalera y dar el primer paso', 'Tomar la muestra de contingencia', 'Plantar la bandera', 'Desplegar el sismómetro y el retrorreflector láser', 'Recoger muestras de roca', 'Volver al Eagle'],
    tips: ['Camina con WASD o el joystick; Shift (o «Saltar») para el paso de canguro', 'Arrastra para girar la cámara; V cambia a la vista del visor; F saca fotos', 'Los anillos dorados marcan cada tarea: acércate y pulsa E (o el botón)'],
  },
  async run(ctx) {
    const eva = ctx.view?.eva ?? null;
    ctx.setWarpLimit(1);
    let tasks = 0;
    const t0 = ctx.t;
    /** A task: a marker on the ground that resolves when the player works it (or, headless, by itself). */
    const task = async (id, label, at, opts = {}) => {
      if (!eva) {
        await ctx.wait(opts.aiTime ?? 20);
        return;
      }
      await eva.addTarget({ id, label, e: at.e, n: at.n, ...opts });
    };
    ctx.caption('UN PEQUEÑO PASO', 'Mar de la Tranquilidad · 20 de julio de 1969 · GET 109:19', 6);
    radio(ctx, 'CDR', "Okay, Houston, I'm on the porch.", 'Bien, Houston, estoy en el porche.');
    radio(ctx, 'CAPCOM', 'Roger, Neil.', 'Recibido, Neil.');

    // ---- down the ladder
    const o1 = ctx.objective('ladder', 'Baja por la escalera y da el primer paso');
    if (eva) await eva.descendLadder();
    else await ctx.wait(8);
    await ctx.say('CDR', "I'm at the foot of the ladder. The LM footpads are only depressed in the surface about 1 or 2 inches.", 'Estoy al pie de la escalera. Las patas del LM apenas se hunden en la superficie una o dos pulgadas.');
    await ctx.say('CDR', "I'm going to step off the LM now.", 'Ahora voy a bajar del LM.');
    if (eva) {
      eva.controllable = true;
      eva.locked = true;
      ctx.hint('Pulsa E (o el botón) para dar el primer paso sobre la Luna.', { durationS: 10 });
      await eva.addTarget({ id: 'step', label: 'Dar el primer paso', e: eva.position.e, n: eva.position.n, radius: 3 });
      await eva.stepOff();
      eva.locked = false;
    }
    await ctx.say('CDR', "That's one small step for man, one giant leap for mankind.", 'Es un pequeño paso para el hombre, un gran salto para la humanidad.', { clip: 'a11_one_small_step', channel: 'ag', force: true, whoLabel: 'Neil Armstrong · grabación original' });
    o1.done();
    ctx.achievement('a11-step');
    ctx.score('step', 50, 50, 'El primer paso');
    radio(ctx, 'CDR', 'The surface is fine and powdery. I can kick it up loosely with my toe.', 'La superficie es fina y polvorienta. Puedo levantarla con la punta de la bota.');
    ctx.hint('Camina con WASD o el joystick izquierdo. Shift o «Saltar»: el paso de canguro a un sexto de gravedad.', { durationS: 10 });

    // ---- the contingency sample, in case the moonwalk had to end at once
    const o2 = ctx.objective('contingency', 'Toma la muestra de contingencia');
    await ctx.say('CAPCOM', 'Neil, this is Houston. Did you copy about the contingency sample? Over.', 'Neil, aquí Houston. ¿Copiaste lo de la muestra de contingencia? Cambio.');
    radio(ctx, 'CDR', "Rog. I'm going to get to that just as soon as I finish these picture series.", 'Recibido. Voy a hacerlo en cuanto termine esta serie de fotos.');
    await task('contingency', 'Tomar la muestra de contingencia', eva?.lmPoint(5.5, 2.5) ?? null, { aiTime: 25 });
    o2.done();
    tasks++;
    radio(ctx, 'CDR', 'This is very interesting. It is a very soft surface, but here and there where I plug with the contingency sample collector, I run into a very hard surface.', 'Esto es muy interesante. Es una superficie muy blanda, pero aquí y allá, donde clavo el colector, me topo con algo muy duro.');

    // ---- Aldrin comes out
    ctx.spawn(async () => {
      await ctx.say('LMP', "Okay. Now I want to back up and partially close the hatch, making sure not to lock it on my way out.", 'Bien. Ahora voy a retroceder y cerrar a medias la escotilla, cuidando de no trabarla al salir.');
      radio(ctx, 'CDR', 'A pretty good thought.', 'Buena idea.');
      if (eva) await eva.addCompanion();
      else await ctx.wait(8);
      await ctx.say('LMP', 'Beautiful view!', '¡Hermosa vista!');
      await ctx.say('CDR', "Isn't that something! Magnificent sight out here.", '¿No es algo increíble? Una vista magnífica.');
      await ctx.say('LMP', 'Magnificent desolation.', 'Magnífica desolación.');
    });

    // ---- the flag
    const o3 = ctx.objective('flag', 'Planta la bandera');
    const flagAt = eva?.lmPoint(10, -4);
    await task('flag', 'Plantar la bandera', flagAt, { aiTime: 30 });
    if (eva) eva.place('flag', flagAt.e, flagAt.n, eva.yaw + Math.PI / 2);
    o3.done();
    tasks++;
    ctx.score('flag', 60, 60, 'La bandera, plantada');
    await ctx.say('CAPCOM', 'Neil and Buzz, the President of the United States is in his office now and would like to say a few words to you. Over.', 'Neil y Buzz, el presidente de los Estados Unidos está en su despacho y quiere decirles unas palabras. Cambio.');
    radio(ctx, 'CDR', 'That would be an honor.', 'Sería un honor.');

    // ---- EASEP: the passive seismometer and the laser ranging retro-reflector
    const o4 = ctx.objective('easep', 'Despliega el sismómetro (PSEP) y el retrorreflector láser (LRRR)');
    const psepAt = eva?.lmPoint(16, 6);
    const lrrrAt = eva?.lmPoint(15, 10);
    await Promise.all([
      task('psep', 'Desplegar el sismómetro', psepAt, { aiTime: 30, color: 0x6dffa0 }).then(() => eva?.place('psep', psepAt.e, psepAt.n, 0)),
      task('lrrr', 'Colocar el retrorreflector láser', lrrrAt, { aiTime: 30, color: 0x6dffa0 }).then(() => eva?.place('lrrr', lrrrAt.e, lrrrAt.n, Math.PI)),
    ]);
    o4.done();
    tasks += 2;
    ctx.score('easep', 80, 80, 'Experimentos desplegados');
    radio(ctx, 'CAPCOM', 'Tranquility Base, Houston. We see the seismometer data. It is quite sensitive; we can see you walking around.', 'Base Tranquilidad, Houston. Vemos los datos del sismómetro. Es muy sensible: los vemos caminar.');

    // ---- documented samples
    const o5 = ctx.objective('samples', 'Recoge muestras de roca documentadas (3)');
    const rocks = eva ? [eva.lmPoint(8, 11), eva.lmPoint(-6, 9), eva.lmPoint(13, -10)] : [null, null, null];
    let got = 0;
    await Promise.all(
      rocks.map((at, i) =>
        task(`rock${i}`, 'Recoger la roca', at, { aiTime: 15 + i * 5, color: 0xcfe6ff, radius: 1.3 }).then(() => {
          got++;
          ctx.alert(`Muestra ${got} de 3 en la bolsa`, 'success', 3);
          ctx.game?.audio?.sfx?.('paper', { gain: 0.6 });
        }),
      ),
    );
    o5.done();
    tasks += 3;
    ctx.score('samples', 60, 60, 'Tres muestras documentadas');

    // ---- back to the LM
    await ctx.say('CAPCOM', "Neil and Buzz, we'd like to remind you we are about 10 minutes from the time to head back in.", 'Neil y Buzz, les recordamos que faltan unos 10 minutos para volver adentro.');
    const o6 = ctx.objective('back', 'Vuelve a la escalera del Eagle');
    await task('ingress', 'Subir al Eagle', eva ? { e: eva.ladder.e, n: eva.ladder.n } : null, { aiTime: 20, radius: 2.2 });
    o6.done();
    const minutes = (ctx.t - t0) / 60;
    ctx.score('time', grade(minutes, 12, 40, 50), 50, `Caminata en ${minutes.toFixed(0)} min de misión`);
    if (eva) ctx.score('walk', Math.min(40, Math.round(eva.stats.walked / 4)), 40, `${eva.stats.walked.toFixed(0)} m recorridos`);
    ctx.achievement('a11-eva');
    await ctx.say('CDR', 'Okay, Houston. We are back in the LM.', 'Bien, Houston. Estamos de vuelta en el LM.');
    await ctx.say('CAPCOM', 'Roger. Tranquility Base, you did a magnificent job.', 'Recibido. Base Tranquilidad, hicieron un trabajo magnífico.');
    ctx.complete({
      summary: `Caminata lunar completa: ${tasks} tareas, la bandera plantada y los experimentos funcionando. El retrorreflector que dejaste sigue devolviendo pulsos láser a la Tierra hoy.`,
      stats: { Tareas: tasks, ...(eva ? { Recorrido: `${eva.stats.walked.toFixed(0)} m`, Pasos: eva.stats.steps } : {}) },
    });
  },
};
