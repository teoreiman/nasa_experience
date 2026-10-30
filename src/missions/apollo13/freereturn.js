// Apollo 13 — Back to free return. The hybrid trajectory flown for the Fra Mauro landing no longer
// comes home by itself: without a burn the spacecraft would hit the atmosphere far too steeply.
// The SPS is behind the damaged service module, so the LM descent engine pushes the whole docked
// stack (GET 61:29:43, ~38 ft/s).

import { Vector3 } from 'three';
import { GET } from '../../core/MissionClock.js';
import { apollo13State, A13_EVENTS, basisQ } from '../common/states.js';
import { planFreeReturn, fmtGET } from '../../sim/physics/targeting.js';
import { radio, houstonPad, flyBurn, grade, entryPrediction } from '../common/kit.js';

const POWERED_DOWN_SWITCHES = {
  'CM.GN.CMC_PWR': 'OFF',
  'CM.GN.IMU_PWR': 'OFF',
  'CM.GN.OPTICS_PWR': 'OFF',
  'CM.EPS.INV1_PWR': 'OFF',
  'CM.EPS.INV2_PWR': 'OFF',
  'CM.ECS.SUIT_COMPR_1': 'OFF',
  'CM.ECS.CABIN_FAN_1': 'OFF',
};

export const A13_CM_DOWN = { preset: 'POWERED_DOWN', switches: POWERED_DOWN_SWITCHES };

export async function lifeboatSetup(atGET, extra = {}) {
  const s = await apollo13State(atGET);
  const fwd = s.v.clone().normalize();
  return {
    get: s.get,
    config: 'CSM_LM',
    state: { r: s.r, v: s.v, q: basisQ(fwd, s.r.clone().normalize().negate()), w: new Vector3(), mode: 'SPACE' },
    station: 'LM',
    seat: 'CDR',
    csm: A13_CM_DOWN,
    lm: 'LIFEBOAT',
    ...extra,
  };
}

export default {
  setup: () => lifeboatSetup(GET(61, 8)),
  briefing: {
    summary:
      'GET 61:08. Para alunizar en Fra Mauro, el Apolo 13 había abandonado la trayectoria de retorno libre: tal como va ahora, entraría en la atmósfera con un ángulo mortal. ' +
      'El SPS está detrás del módulo de servicio dañado y nadie se atreve a encenderlo. El motor de descenso del Aquarius empujará los 40.000 kg de la nave acoplada.',
    objectives: ['Elegir la maniobra (FIDO)', 'Recibir el PAD del retorno libre', 'Encendido del DPS (P40 en el LGC)', 'Ángulo de reentrada en el corredor'],
    tips: ['El DPS empuja desde el «techo» del LM: la nave acoplada es pesada y lenta', 'PRO en V99 autoriza el encendido', 'Houston confirmará la nueva hora de reentrada'],
  },
  async run(ctx) {
    ctx.caption('REGRESO LIBRE', 'Apolo 13 · GET 61:08', 6);
    const before = entryPrediction(ctx);
    await ctx.say('CAPCOM', 'Aquarius, Houston. We want a DPS burn at 61:30 to put you back on a free return.', `Aquarius, Houston. Queremos un encendido del DPS a las 61:30 para devolverlos al retorno libre. Ahora mismo entrarían ${Number.isFinite(before.gammaEI) ? `con γ ${before.gammaEI.toFixed(0)}°: imposible de sobrevivir` : 'fuera del corredor'}.`);
    await ctx.ground({
      id: 'a13.fido.fr',
      console: 'FIDO',
      kind: 'decision',
      title: 'Maniobra de retorno libre',
      prompt: 'La trayectoria híbrida no vuelve a la Tierra. Opciones: encendido corto del DPS ahora; esperar al paso por la Luna; o usar el SPS del Odyssey (detrás del módulo dañado).',
      options: [
        { id: 'dps', label: 'DPS ahora: 38 ft/s, nave acoplada', correct: true, say: { who: 'FIDO', en: 'Flight, FIDO. DPS burn at 61:30, 38 feet per second. That gets us a free return.', es: 'Flight, FIDO. Encendido del DPS a las 61:30, 38 pies/s. Eso nos devuelve al retorno libre.', channel: 'loop' } },
        { id: 'wait', label: 'Esperar al PC+2 detrás de la Luna', correct: false, say: { who: 'FLIGHT', en: "No, we want a free return now. We don't know how long the LM will hold.", es: 'No: queremos el retorno libre ya. No sabemos cuánto aguantará el LM.', channel: 'loop' } },
        { id: 'sps', label: 'Encender el SPS del Odyssey', correct: false, say: { who: 'FLIGHT', en: 'Negative. We do not know what the SPS looks like after that explosion.', es: 'Negativo. No sabemos cómo quedó el SPS después de la explosión.', channel: 'loop' } },
      ],
      timeout: 60,
      aiDelay: 4,
      score: { key: 'fido', points: 60 },
    });
    const obj1 = ctx.objective('pad', 'Recibe el PAD del retorno libre');
    const pad = await houstonPad(ctx, (c) => planFreeReturn(c, { lead: Math.max(240, A13_EVENTS.FREE_RETURN - c.get) }));
    obj1.done();
    const obj2 = ctx.objective('burn', 'Encendido del DPS');
    const burn = await flyBurn(ctx, pad, { checklist: 'dps', replan: (c) => planFreeReturn(c, { lead: 300 }) });
    obj2.done();
    radio(ctx, 'CDR', 'Shutdown. Good burn.', 'Apagado. Buen encendido.');
    await ctx.wait(20);
    const after = entryPrediction(ctx);
    const gam = after.gammaEI;
    const peri = after.perigeeKm;
    const back = Number.isFinite(peri) && peri < 5000;
    ctx.score('burn', burn.missed ? 30 : 80, 80, burn.missed ? 'Encendido con retraso' : 'Encendido puntual');
    // a free return brings the spacecraft back to the Earth; PC+2 and the midcourse corrections trim the corridor
    ctx.score('corridor', back ? grade(Math.abs(peri - 37), 60, 3000, 140) : 0, 140, back ? `Perigeo de regreso ${peri.toFixed(0)} km` : 'Sin regreso a la Tierra');
    if (back) ctx.achievement('a13-freereturn');
    await ctx.say('CAPCOM', 'Aquarius, Houston. You are on a free return trajectory.', back ? `Aquarius, Houston. Están en retorno libre: ${Number.isFinite(gam) ? `reentrada a GET ${fmtGET(after.tEI)} con γ ${gam.toFixed(2)}°` : `perigeo previsto a ${peri.toFixed(0)} km; el PC+2 afinará el corredor`}.` : 'Aquarius, Houston. Todavía no vuelven a la Tierra; haremos otra corrección.');
    ctx.complete({
      summary: back ? `Retorno libre restablecido con el motor de descenso del LM: la nave volverá a la Tierra (perigeo ${peri.toFixed(0)} km), aunque llegaría al océano Índico en 152 h, sin barcos esperando. Hará falta el PC+2.` : 'La nave sigue sin una trayectoria de regreso: Houston preparará otra corrección.',
      stats: { 'γ antes': Number.isFinite(before.gammaEI) ? `${before.gammaEI.toFixed(1)}°` : '—', 'Perigeo después': Number.isFinite(peri) ? `${peri.toFixed(0)} km` : '—', 'ΔV': `${(pad.dvTotal / 0.3048).toFixed(1)} ft/s` },
    });
  },
};
