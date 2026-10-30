// Apollo 8 — Earthrise. Fourth revolution: Borman rolls the spacecraft and, coming around the limb,
// Anders sees the Earth rising over the lunar horizon. The player has to orient the CM, look out of
// the window and take the photograph (AS8-14-2383) while the Earth is still close to the horizon.
// Closes with the Christmas Eve message.

import { GET } from '../../core/MissionClock.js';
import { R_MOON, R_EARTH } from '../../core/constants.js';
import { radio, warpHint, waitLOS, waitAOS } from '../common/kit.js';

export default {
  setup: {
    get: GET(75, 30),
    config: 'CSM',
    state: 'A8_LUNAR_ORBIT',
    station: 'CM',
    seat: 'CDR',
    csm: 'LUNAR_ORBIT',
    lm: null,
  },
  briefing: {
    summary:
      'Cuarta vuelta a la Luna, 24 de diciembre de 1968. Al salir de detrás del borde, la Tierra va a asomar sobre el horizonte lunar. ' +
      'Nadie la había visto así. Gira la nave, mira por la ventana y toma la foto antes de que la Tierra suba demasiado.',
    objectives: ['Pasar por la cara oculta', 'Orientar la nave hacia el horizonte', 'Fotografiar la salida de la Tierra', 'El mensaje de Nochebuena'],
    tips: ['Mueve la vista con el ratón (o arrastra) para mirar por las ventanas', 'La Tierra aparece por encima del borde de la Luna al recuperar la señal', 'F o el botón de la lista toma la foto'],
  },
  async run(ctx) {
    const sim = ctx.sim;
    const v = ctx.vehicle;
    ctx.caption('SALIDA DE LA TIERRA', 'Apolo 8 · cuarta órbita lunar', 6);
    warpHint(ctx);
    const obj1 = ctx.objective('far', 'Pasa por la cara oculta');
    await waitLOS(ctx);
    ctx.alert('LOS: cara oculta de la Luna', 'info', 5);
    radio(ctx, 'CDR', 'Okay, we are going to roll the spacecraft.', 'Bien, vamos a girar la nave.', { channel: 'ic' });
    await waitAOS(ctx);
    obj1.done();
    ctx.dropWarp();

    // ---- the Earth over the horizon: angle above the lunar limb seen from the spacecraft
    const earthInfo = () => {
      const st = v.state;
      const toEarth = st.r.clone().negate();
      const dE = toEarth.length();
      toEarth.normalize();
      const toMoon = sim.dyn.moonPos.clone().sub(st.r);
      const dM = toMoon.length();
      toMoon.normalize();
      const limb = Math.asin(Math.min(1, R_MOON / dM));
      const sep = Math.acos(Math.max(-1, Math.min(1, toEarth.dot(toMoon))));
      const look = ctx.view?.lookInfo?.();
      const inView = look ? Math.acos(Math.max(-1, Math.min(1, look.dir.dot(toEarth)))) * (180 / Math.PI) < look.fov * 0.45 : true;
      return { elev: ((sep - limb) * 180) / Math.PI, inView, size: ((2 * Math.atan(R_EARTH / dE)) * 180) / Math.PI };
    };
    ctx.say('LMP', 'Oh my God! Look at that picture over there! Here is the Earth coming up. Wow, is that pretty!', '¡Dios mío! ¡Miren esa imagen de allá! ¡Ahí sale la Tierra! ¡Qué hermosa!', { wait: false });
    radio(ctx, 'CDR', 'Hey, don\'t take that, it\'s not scheduled.', 'Eh, no saques esa, no está en el plan.');
    radio(ctx, 'LMP', 'You got a color film, Jim? Hand me that roll of color quick, would you?', '¿Tienes película a color, Jim? Pásame ese rollo a color, rápido.');
    const obj2 = ctx.objective('photo', 'Fotografía la salida de la Tierra');
    ctx.hint('Mira hacia la Tierra sobre el horizonte lunar (ratón) y toma la foto con el botón «Hecho» de la lista.', { durationS: 12 });
    const stopTask = ctx.every(1, () => {
      const e = earthInfo();
      ctx.task(`La Tierra está ${e.elev.toFixed(1)}° sobre el horizonte lunar${e.inView ? ' · en el visor' : ''}`);
    });
    let shot = null;
    for (let attempt = 0; attempt < 6 && !shot; attempt++) {
      await ctx.crew({
        id: `a8.photo.${attempt}`,
        title: 'LA FOTO DE ANDERS',
        items: [{ text: 'Encuadrar la Tierra sobre el horizonte y disparar la Hasselblad', manual: true }],
        aiPace: [8, 12],
      });
      const e = earthInfo();
      const url = (await ctx.view?.capture?.()) ?? null;
      if (e.inView || ctx.isController) {
        shot = { url, e };
        ctx.bus.emit('mission:photo', { url, title: 'Salida de la Tierra', caption: `AS8-14-2383 · ${e.elev.toFixed(1)}° sobre el horizonte · 24 dic 1968` });
      } else {
        ctx.alert('La Tierra no está en el encuadre: gira la vista hacia ella', 'caution', 5);
        if (url) ctx.bus.emit('mission:photo', { url, title: 'Foto fallida', caption: 'La Tierra quedó fuera de cuadro', durationS: 4 });
      }
    }
    stopTask();
    ctx.task('');
    obj2.done();
    const elev = shot?.e.elev ?? 30;
    ctx.score('photo', shot ? Math.round(Math.max(0, Math.min(1, (25 - elev) / 22)) * 150) + 50 : 0, 200, shot ? `La Tierra a ${elev.toFixed(1)}° del horizonte` : 'Sin foto');
    if (shot && elev < 12) ctx.achievement('a8-earthrise');
    radio(ctx, 'CMP', 'Oh man, that is great!', '¡Uf, eso es genial!');

    // ---- Christmas Eve
    await ctx.wait(40);
    await ctx.say('PAO', 'This is Apollo Control. The crew is preparing for a television transmission from lunar orbit on Christmas Eve.', 'Aquí Control Apolo. La tripulación prepara una transmisión de televisión desde la órbita lunar en Nochebuena.');
    await ctx.say('CDR', 'And from the crew of Apollo 8, we close with good night, good luck, a Merry Christmas, and God bless all of you, all of you on the good Earth.', 'Y de parte de la tripulación del Apolo 8, nos despedimos con buenas noches, buena suerte, feliz Navidad y que Dios los bendiga a todos, a todos ustedes en la buena Tierra.', { clip: 'a08_merry_christmas' });
    ctx.complete({
      summary: shot ? `La foto de la salida de la Tierra, con el planeta ${elev.toFixed(1)}° sobre el horizonte lunar. Esa imagen cambió cómo la humanidad se ve a sí misma.` : 'La Tierra ya estaba demasiado alta para la foto. Anders tuvo más suerte.',
      stats: { 'Altura de la Tierra': `${elev.toFixed(1)}°`, Fotos: shot ? 1 : 0 },
    });
  },
};
