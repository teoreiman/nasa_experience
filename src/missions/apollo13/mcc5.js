// Apollo 13 — MCC-5, flown by hand. The entry angle is drifting shallow (the LM's sublimator vents
// push the stack) and the guidance computer is powered down to save amps. Lovell holds the attitude
// with the Earth's terminator in the COAS crosshair, Haise and Swigert time the burn: ~14 s of DPS at
// 10 % throttle, started and stopped by hand.

import { GET } from '../../core/MissionClock.js';
import { Quaternion, Vector3 } from 'three';
import { planMCC, fmtGET, contextFromSim } from '../../sim/physics/targeting.js';
import { GNCHost } from '../../sim/gnc/GNCHost.js';
import { DEG } from '../../core/constants.js';
import { radio, grade, entryPrediction } from '../common/kit.js';
import { lifeboatSetup } from './freereturn.js';

export default {
  setup: () => lifeboatSetup(GET(104, 58), { maxWarp: 10 }),
  briefing: {
    summary:
      'GET 105:00. La trayectoria se está volviendo demasiado rasante: con −5,6° el Odyssey rebotaría en la atmósfera. El ordenador del LM está apagado para ahorrar energía, así que la corrección MCC-5 se vuela a mano: ' +
      'orientar la nave con el terminador terrestre en la cruz del COAS y encender el motor de descenso unos segundos con el reloj de eventos.',
    objectives: ['Orientar la nave (agujas del FDAI centradas)', 'Armar el DPS en manual (THR CONT MAN)', 'Encender y apagar a mano en el tiempo del PAD', 'Ángulo de reentrada entre −6° y −7°'],
    tips: ['Las agujas de error del FDAI muestran cuánto falta para la actitud', 'ENG START enciende; ENG STOP (botón) apaga', 'El reloj de eventos ayuda a contar los segundos'],
  },
  async run(ctx) {
    const sim = ctx.sim;
    const v = ctx.vehicle;
    const lm = ctx.lm;
    ctx.caption('CORRECCIÓN MANUAL', 'Apolo 13 · MCC-5 · GET 105:00', 6);
    const before = entryPrediction(ctx);
    await ctx.say('CAPCOM', 'Aquarius, Houston. Your entry angle is shallowing. We want a midcourse correction, MCC-5, and you are going to fly it manually.', `Aquarius, Houston. El ángulo de reentrada se está volviendo rasante (${Number.isFinite(before.gammaEI) ? before.gammaEI.toFixed(2) + '°' : 'fuera del corredor'}). Queremos la corrección MCC-5 y la van a volar a mano.`);

    // ---- the PAD: direction from the RTCC, burn time at 10 % throttle
    const c = contextFromSim(sim);
    const pad = await planMCC({ ...c, thrust: 4504, propKg: lm.dpsProp }, { entryGamma: -6.5 });
    const dir = pad.dvECI.clone().normalize();
    const accel = 4504 / Math.max(1000, v.state.mass);
    const burnS = pad.dvTotal / accel;
    const tig = Math.max(ctx.t + 600, GET(105, 18, 28));
    ctx.pad({ name: 'MCC-5', tig, dvTotal: pad.dvTotal, burnTime: burnS, engine: 'DPS 10 %', notes: 'Actitud manual con el terminador en el COAS · encendido y apagado manuales' });
    await ctx.say('CAPCOM', `MCC-5 PAD: TIG ${fmtGET(tig)}, delta-V ${(pad.dvTotal / 0.3048).toFixed(1)} feet per second, burn time ${Math.round(burnS)} seconds at 10 percent.`, `PAD de la MCC-5: TIG ${fmtGET(tig)}, ΔV ${(pad.dvTotal / 0.3048).toFixed(1)} pies/s, ${Math.round(burnS)} s al 10 %.`);

    // ---- attitude: the FDAI needles show the burn attitude (the terminator in the COAS)
    const target = GNCHost.attitudeFor(dir, v.state.r.clone().normalize().negate(), new Quaternion());
    v.cmd.fdaiTarget = target;
    const axis = new Vector3();
    const errDeg = () => {
      axis.set(1, 0, 0).applyQuaternion(v.state.q);
      return Math.acos(Math.max(-1, Math.min(1, axis.dot(dir)))) / DEG;
    };
    const stopTask = ctx.every(1, () => ctx.task(`Error de actitud: ${errDeg().toFixed(1)}° · ${v.tm['LM.DPS.FIRING'] ? 'DPS ENCENDIDO' : `TIG en ${Math.max(0, Math.round(tig - ctx.t))} s`}`));
    const obj1 = ctx.objective('att', 'Orienta la nave: agujas del FDAI centradas (menos de 3°)');
    ctx.hint('Gira con W/S, A/D y Q/E hasta centrar las agujas amarillas del FDAI. El empuje del DPS sale por el «techo» (+X) del LM.', { durationS: 12 });
    let assisted = false;
    await ctx.crew({
      id: 'a13.mcc5.att',
      title: 'ACTITUD CON EL TERMINADOR EN EL COAS',
      items: [
        { text: 'MODE CONTROL PGNS — OFF (ordenador apagado)', sw: { id: 'LM.GNC.MODE_CONTROL_PGNS', pos: 'OFF' } },
        { text: 'Centrar las agujas: terminador en la cruz del COAS', check: () => errDeg() < 3, do: () => { assisted = !ctx.isController; sim.gnc.autopilot.set('ATT_MANEUVER', { dir, zRef: v.state.r.clone().normalize().negate() }); } },
      ],
      aiPace: [3, 5],
    });
    obj1.done();

    // ---- the manual burn
    const obj2 = ctx.objective('burn', `Encendido manual: ${Math.round(burnS)} s al 10 %`);
    const dv0 = v.state.v.clone();
    let tOn = null;
    let tOff = null;
    ctx.on('switch:changed', ({ id, value }) => {
      if (id === 'LM.ENG.START' && value === 'PUSHED' && tOn === null && ctx.t > tig - 30) tOn = ctx.t;
    });
    await ctx.crew({
      id: 'a13.mcc5.burn',
      title: 'MCC-5: ENCENDIDO MANUAL DEL DPS',
      items: [
        { text: 'ENG ARM — DES', sw: { id: 'LM.ENG.ENG_ARM', pos: 'DES' } },
        { text: 'THR CONT — MAN (TTCA al mínimo: 10 %)', sw: { id: 'LM.GNC.THR_CONT', pos: 'MAN' } },
        { text: 'ENG STOP — soltar (afuera)', check: (cc) => !cc.sw.is('LM.ENG.STOP_CDR', 'PUSHED') && !cc.sw.is('LM.ENG.STOP_LMP', 'PUSHED'), do: (cc) => { cc.sw.set('LM.ENG.STOP_CDR', 'OUT', 'crew'); cc.sw.set('LM.ENG.STOP_LMP', 'OUT', 'crew'); } },
      ],
      aiPace: [3, 5],
    });
    if (ctx.t < tig - 10) await ctx.waitGET(tig - 10);
    radio(ctx, 'LMP', 'Ten seconds.', 'Diez segundos.', { channel: 'ic' });
    v.controls.ttca = 0;
    await ctx.crew({
      id: 'a13.mcc5.on',
      title: 'IGNICIÓN',
      items: [{ text: `A las ${fmtGET(tig)}: ENG START`, check: () => !!lm.dpsFiring || tOn !== null, do: () => { lm.manualStart = true; tOn = ctx.t; } }],
      aiPace: [9, 11],
    });
    if (tOn === null) tOn = ctx.t;
    radio(ctx, 'CDR', 'Ignition.', 'Ignición.', { channel: 'ic' });
    await ctx.crew({
      id: 'a13.mcc5.off',
      title: 'APAGADO',
      items: [{ text: `Tras ${Math.round(burnS)} s: ENG STOP`, sw: { id: 'LM.ENG.STOP_CDR', pos: 'PUSHED' }, check: () => !lm.dpsFiring && ctx.t > tOn + 2, do: () => { lm.manualStart = false; } }],
      aiPace: [burnS - 0.5, burnS + 0.5],
    });
    tOff = ctx.t;
    lm.manualStart = false;
    sim.gnc.autopilot.clear();
    v.cmd.fdaiTarget = null;
    stopTask();
    ctx.task('');
    obj2.done();
    radio(ctx, 'CDR', 'Shutdown.', 'Apagado.', { channel: 'ic' });
    const gained = v.state.v.clone().sub(dv0).length();
    await ctx.wait(30);
    const after = entryPrediction(ctx);
    const gam = after.gammaEI;
    if (!Number.isFinite(gam) || gam > -4.6 || gam < -9) {
      ctx.fail(Number.isFinite(gam) ? `Con γ ${gam.toFixed(2)}° la reentrada no es sobrevivible.` : 'La nave ya no entra en la atmósfera: rebotaría al espacio.', { stats: { 'ΔV aplicado': `${(gained / 0.3048).toFixed(1)} ft/s`, 'Encendido': `${(tOff - tOn).toFixed(1)} s` } });
      return;
    }
    if (assisted) ctx.penalty('assist', 40, 'Actitud con piloto automático');
    ctx.score('corridor', grade(Math.abs(gam + 6.5), 0.2, 1.6, 150), 150, `γ de reentrada ${gam.toFixed(2)}°`);
    ctx.score('timing', grade(Math.abs(tOn - tig), 2, 60, 50), 50, `Ignición a ${(tOn - tig).toFixed(0)} s del TIG`);
    if (gam < -6 && gam > -7) ctx.achievement('a13-terminator');
    await ctx.say('CAPCOM', 'Aquarius, Houston. Nice burn. You are right in the corridor.', `Aquarius, Houston. Buen encendido: γ ${gam.toFixed(2)}°, reentrada a GET ${fmtGET(after.tEI)}.`);
    ctx.complete({
      summary: `MCC-5 volada a mano: ${(tOff - tOn).toFixed(1)} s de DPS, ${(gained / 0.3048).toFixed(1)} ft/s. Ángulo de reentrada ${Number.isFinite(before.gammaEI) ? before.gammaEI.toFixed(2) : '—'}° → ${gam.toFixed(2)}°.`,
      stats: { 'γ antes': Number.isFinite(before.gammaEI) ? `${before.gammaEI.toFixed(2)}°` : '—', 'γ después': `${gam.toFixed(2)}°`, 'ΔV': `${(gained / 0.3048).toFixed(1)} ft/s`, 'Encendido': `${(tOff - tOn).toFixed(1)} s` },
    });
  },
};
