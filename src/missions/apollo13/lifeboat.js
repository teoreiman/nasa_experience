// Apollo 13 — Aquarius, lifeboat. The last oxygen tank is bleeding into space and the Odyssey has
// minutes left. Lovell and Haise float into the LM and power it up from cold while Swigert keeps the
// CM's platform alive long enough to hand its alignment over (the gimbal-angle arithmetic Houston
// double-checked), then shuts the Odyssey down.

import { Vector3 } from 'three';
import { GET } from '../../core/MissionClock.js';
import { apollo13State, basisQ } from '../common/states.js';
import { radio, procedure, grade } from '../common/kit.js';

const fmt = (x) => (((x % 360) + 360) % 360).toFixed(1).padStart(5, '0');

export default {
  async setup() {
    const s = await apollo13State(GET(56, 40));
    const fwd = s.v.clone().normalize();
    return {
      get: s.get,
      config: 'CSM_LM',
      state: { r: s.r, v: s.v, q: basisQ(fwd, s.r.clone().normalize().negate()), w: new Vector3(), mode: 'SPACE' },
      station: 'CM',
      seat: 'CDR',
      csm: 'TLC',
      lm: 'STOWED',
      maxWarp: 5,
    };
  },
  briefing: {
    summary:
      'GET 56:40. Al Odyssey le quedan unos 25 minutos de oxígeno para su última pila de combustible. El módulo lunar Aquarius está frío y apagado, ' +
      'pensado para dos hombres durante dos días. Enciéndelo, transfiere la alineación de la plataforma inercial antes de que el CM muera y deja que Swigert apague el Odyssey.',
    objectives: ['Pasar al LM y encender las baterías', 'Poner en marcha el LGC', 'Transferir la alineación del IMU (ángulos del CM → LM)', 'Apagar el Odyssey'],
    tips: ['Las baterías de descenso están en el panel 14 del LMP', 'Si el Odyssey se apaga antes de la transferencia, la alineación se pierde', 'El tiempo se puede acelerar ×5 como máximo'],
  },
  async run(ctx) {
    const sim = ctx.sim;
    const v = ctx.vehicle;
    const csm = ctx.csm;
    // the state after the explosion: tank 2 gone, FC 1 & 3 dead, tank 1 venting fast
    csm.exploded = true;
    csm.o2[1] = { p: 0, qty: 0, leak: 0 };
    // ≈420 psi and falling: FC 2 starves at 120 psi in about 25 minutes
    csm.o2[0] = { p: 420, qty: 0.46, leak: 1 / (80 * 60) };
    for (const i of [0, 2]) {
      csm.fc[i].reac = false;
      csm.fc[i].failed = true;
    }
    v.parts.smDamaged = true;
    ctx.caption('AQUARIUS, BOTE SALVAVIDAS', 'Apolo 13 · GET 56:40', 6);
    await ctx.say('CAPCOM', 'Thirteen, Houston. We want you to get over into the LM and get it powered up.', 'Trece, Houston. Queremos que pasen al LM y lo enciendan.');
    radio(ctx, 'CDR', 'Okay. Fred and I are going into the LM.', 'Bien. Fred y yo vamos al LM.');
    await ctx.wait(4);
    v.setStation('LM');
    const tStart = ctx.t;
    let cmDead = false;
    let cmDeadAt = null;
    let poweringDown = false;
    ctx.every(1, () => {
      if (!cmDead && !poweringDown && !sim.gnc.cmc.powered && ctx.t > tStart + 10) {
        cmDead = true;
        cmDeadAt = ctx.t;
        ctx.alert('El Odyssey se quedó sin energía', 'warning', 6);
      }
    });

    // ---- LM power-up
    const obj1 = ctx.objective('power', 'Enciende el Aquarius: baterías, inversor y LGC');
    const r1 = await procedure(ctx, 'lmActivation', { title: 'Encendido de emergencia del LM', pick: [0, 1, 2, 3, 4, 5, 6], aiPace: [5, 10] });
    obj1.done();
    radio(ctx, 'LMP', 'Houston, Aquarius. We have the LM powered up.', 'Houston, aquí Aquarius. El LM está encendido.');
    ctx.score('power', grade(r1.time, 240, 900, 100), 100, `LM encendido en ${Math.round(r1.time / 60)} min`);

    // ---- platform alignment transfer
    const obj2 = ctx.objective('align', 'Transfiere la alineación del IMU del Odyssey al Aquarius');
    let aligned = false;
    if (cmDead) {
      obj2.fail();
      ctx.penalty('align', 80, 'Alineación perdida: el CM murió antes');
      await ctx.say('CAPCOM', 'Aquarius, the CM platform is gone. We will have to align on the Sun and the Moon later.', 'Aquarius, la plataforma del CM se perdió. Tendremos que alinear con el Sol y la Luna más adelante.');
    } else {
      const [r, p, y] = sim.gnc.gimbals('CM');
      await ctx.say('CMP', `Okay, Aquarius. CM gimbal angles: roll ${fmt(r)}, pitch ${fmt(p)}, yaw ${fmt(y)}.`, `Aquarius, ángulos del CM: alabeo ${fmt(r)}, cabeceo ${fmt(p)}, guiñada ${fmt(y)}.`);
      const right = `${fmt(r + 180)} · ${fmt(360 - p)} · ${fmt(-y)}`;
      const pick = await ctx.choice({
        id: 'a13.math',
        title: 'Transferencia de alineación',
        prompt: `El LM está acoplado de frente al CM: su alabeo está girado 180° y sus ejes de cabeceo y guiñada invertidos. Ángulos del CM: ${fmt(r)} · ${fmt(p)} · ${fmt(y)}. ¿Qué ángulos cargas en el LGC (alabeo · cabeceo · guiñada)?`,
        options: [
          { id: 'b', label: `${fmt(r)} · ${fmt(360 - p)} · ${fmt(y + 180)}` },
          { id: 'ok', label: right },
          { id: 'c', label: `${fmt(r + 180)} · ${fmt(p)} · ${fmt(y)}` },
        ],
        timeout: 120,
        defaultOption: 'ok',
      });
      if (pick === 'ok') {
        ctx.score('math', 80, 80, 'Ángulos correctos');
        ctx.achievement('a13-math');
        radio(ctx, 'CAPCOM', 'Aquarius, Houston. We checked your arithmetic. It is good.', 'Aquarius, Houston. Revisamos sus cuentas: están bien.');
      } else {
        ctx.score('math', 20, 80, 'Ángulos corregidos por Houston');
        await ctx.say('CAPCOM', 'Aquarius, Houston. Check your numbers: roll plus 180, pitch 360 minus, yaw negative.', `Aquarius, Houston. Revisen las cuentas: alabeo +180, cabeceo 360 − P, guiñada negativa. Son ${right}.`);
      }
      if (!sim.gnc.cmc.powered) {
        obj2.fail();
        ctx.penalty('align', 60, 'El CM se apagó durante la transferencia');
      } else {
        sim.gnc.lgc.refsmmat.copy(sim.gnc.cmc.refsmmat);
        aligned = true;
        obj2.done();
        radio(ctx, 'LMP', 'Platform is aligned. Aquarius is ready.', 'Plataforma alineada. Aquarius está listo.');
      }
    }

    // ---- Odyssey power down (Swigert, in the CM)
    const obj3 = ctx.objective('down', 'Swigert apaga el Odyssey');
    poweringDown = true;
    await ctx.say('CAPCOM', 'Okay, Jack, we want to power down the CM now.', 'Bien, Jack: ahora hay que apagar el CM.');
    await procedure(ctx, 'cmPowerDown', { title: 'Apagado del Odyssey (Swigert)', pick: [0, 2, 3, 4, 5, 6, 7, 8], aiPace: [3, 6], ai: true });
    csm.poweredDown = true;
    obj3.done();
    const o2left = Math.round((csm.o2[0].qty ?? 0) * 145);
    radio(ctx, 'CMP', 'Odyssey is powered down.', 'El Odyssey está apagado.');
    if (aligned) ctx.achievement('a13-lifeboat');
    ctx.score('o2', grade(o2left, 25, 0, 60), 60, `O2 restante en el CM: ${o2left} kg`);
    await ctx.say('PAO', 'This is Apollo Control. The crew is now using the lunar module as a lifeboat.', 'Aquí Control Apolo. La tripulación usa ahora el módulo lunar como bote salvavidas.');
    ctx.complete({
      summary: `Aquarius encendido en ${Math.max(1, Math.round(r1.time / 60))} min${aligned ? ', con la alineación del IMU transferida' : ''}. El Odyssey duerme: sus baterías de reentrada quedan intactas para el final del viaje.${cmDeadAt ? ' (El CM se quedó sin energía antes de terminar.)' : ''}`,
      stats: { 'Encendido del LM': `${Math.round(r1.time / 60)} min`, 'Alineación transferida': aligned ? 'Sí' : 'No', 'O2 restante en el CM': `${o2left} kg` },
    });
  },
};
