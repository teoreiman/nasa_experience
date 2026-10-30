// Building blocks shared by the mission chapters: onboard procedures as crew checklists, Houston
// maneuver PADs, computer-flown burns with a retry when the crew misses the ignition, radio
// callouts on vehicle events and small scoring helpers.

import { procedureById } from './procedures.js';
import { contextFromSim, fmtGET, predictEntry } from '../../sim/physics/targeting.js';
import { NMI, FT } from '../../core/constants.js';

/** Fire-and-forget radio line. */
export const radio = (ctx, who, en, es, o = {}) => ctx.say(who, en, es, { wait: false, ...o });

/** Onboard procedure (missions/common/procedures.js) run as a crew checklist. `pick` keeps only
 *  those item indices; `extra` items are appended. */
export function procedure(ctx, id, { title, pick = null, extra = [], aiPace = [2, 4], ai = false } = {}) {
  const p = procedureById(id);
  const base = pick ? pick.map((i) => p.items[i]) : p.items;
  return ctx.crew({ id: `${ctx.chapter.id}.${id}`, title: (title ?? p.title).toUpperCase(), station: p.station, items: [...base, ...extra], aiPace, ai });
}

/** Linear score between `good` (full points) and `bad` (zero) for a value (either direction). */
export function grade(value, good, bad, max) {
  const t = (value - bad) / (good - bad);
  return Math.round(Math.max(0, Math.min(1, t)) * max);
}

const engineName = (e) => ({ SPS: 'SPS', DPS: 'motor de descenso', APS: 'motor de ascenso', SIVB: 'S-IVB' })[e] ?? e;

/** Houston computes `planFn(rtccContext)` (an async planner) and reads the PAD up. The burn is
 *  loaded into the active computer (P30). Returns the PAD. */
export async function houstonPad(ctx, planFn, { who = 'CAPCOM', intro = true, load = true } = {}) {
  const sim = ctx.sim;
  if (intro) radio(ctx, who, 'Stand by for your maneuver PAD.', 'Esperen, les pasamos el PAD de la maniobra.');
  ctx.alert('Houston calcula la maniobra (RTCC)…', 'info', 4);
  // real time while the RTCC computes: a TIG must not slip by under time acceleration
  ctx.clock.setLimit('rtcc', 1);
  let pad;
  try {
    pad = await planFn(contextFromSim(sim));
  } finally {
    ctx.clock.clearLimit('rtcc');
  }
  if (!pad) return null;
  const c = contextFromSim(sim);
  if (load) sim.gnc.activeComputer.loadBurn(pad);
  ctx.pad({ ...pad, engine: pad.engine ?? c.engine });
  const fps = (pad.dvTotal / FT).toFixed(1);
  await ctx.say(who, `${pad.name} PAD: TIG ${fmtGET(pad.tig)}, delta-V ${fps} feet per second, burn time ${Math.round(pad.burnTime)} seconds.`, `PAD de ${pad.name}: TIG ${fmtGET(pad.tig)}, ΔV ${fps} pies/s, ${Math.round(pad.burnTime)} s de encendido con el ${engineName(pad.engine ?? c.engine)}.`);
  return pad;
}

/**
 * Fly a computer-controlled burn already loaded (P30) through its checklist ('sps' or 'dps').
 * The crew (or AI) runs the procedure; if the ignition is missed by 30 s Houston re-plans once with
 * `replan` and the burn is retried. Resolves to { pad, missed, residual } after cutoff.
 */
export async function flyBurn(ctx, pad, { checklist = 'sps', replan = null, title = null, extra = [] } = {}) {
  const sim = ctx.sim;
  let comp = sim.gnc.activeComputer;
  let missed = 0;
  let cutoff = null;
  const offCut = ctx.on('agc:cutoff', (e) => (cutoff = e));
  // AI crew (controller role): the computer flies the burn and the crew PROs at V99
  if (ctx.isController) sim.gnc.autopilot.set('BURN');
  ctx.spawn(() => procedure(ctx, checklist, { title: title ?? `${pad.name}: ${procedureById(checklist).title}`, extra }));
  for (;;) {
    // missed: never armed by TIG+30 s, or "firing" with no thrust (engine not configured) for 20 s
    await ctx.waitUntil(() => {
      const b = comp.burn;
      if (!b || b.done) return true;
      if (!b.armed && !b.firing && ctx.t > b.tig + 30) return true;
      return b.firing && ctx.t > b.tig + 20 && b.gained < 0.3;
    });
    if (!comp.burn || comp.burn.done) break;
    // missed: Houston re-plans and this time the computer flies it (the crew only monitors)
    missed++;
    ctx.penalty(`missedBurn${missed}`, 25, 'Ignición perdida');
    configureEngine(ctx, checklist === 'dps' ? 'DPS' : 'SPS');
    ctx.alert('No hubo ignición: Houston recalcula y el ordenador volará el encendido', 'caution', 6);
    radio(ctx, 'CAPCOM', 'We saw no ignition. Stand by for a new PAD; the computer will fly it.', 'No vimos la ignición. Esperen un PAD nuevo; esta vez lo vuela el ordenador.');
    const np = replan ? await houstonPad(ctx, replan, { intro: false }) : null;
    comp = sim.gnc.activeComputer;
    if (np) pad = np;
    else comp.loadBurn({ ...pad, tig: ctx.t + 120 });
    comp.runProgram('40');
    sim.gnc.autopilot.set('BURN');
    if (missed > 3) break;
  }
  if (sim.gnc.autopilot.mode === 'BURN') sim.gnc.autopilot.clear();
  offCut();
  return { pad, missed, residual: cutoff?.residual ?? 0 };
}

/** Put the engine switches in the burn configuration (used when the crew misses a step). */
export function configureEngine(ctx, engine) {
  const sw = ctx.sw;
  if (engine === 'SPS') {
    for (const id of ['CM.SPS.GMBL_P1', 'CM.SPS.GMBL_Y1', 'CM.SPS.GMBL_P2', 'CM.SPS.GMBL_Y2']) sw.set(id, 'ON', 'crew');
    for (const id of ['CM.SPS.DV_THRUST_A', 'CM.SPS.DV_THRUST_B']) {
      sw.setGuard(id, true, 'crew');
      sw.set(id, 'NORMAL', 'crew');
    }
  } else {
    sw.set('LM.ENG.ENG_ARM', 'DES', 'crew');
    sw.set('LM.GNC.MODE_CONTROL_PGNS', 'AUTO', 'crew');
    sw.set('LM.GNC.THR_CONT', 'AUTO', 'crew');
  }
}

/** Standard radio callouts for the ascent and the big events. */
export function ascentCallouts(ctx) {
  ctx.on('vehicle:event', (e) => {
    switch (e.kind) {
      case 'TOWER_CLEAR':
        radio(ctx, 'CAPCOM', 'Roger, tower cleared.', 'Recibido, torre superada.');
        break;
      case 'SIC_CECO':
        radio(ctx, 'CAPCOM', 'Inboard cutoff.', 'Apagado del motor central.');
        break;
      case 'SIC_SEP':
        radio(ctx, 'CDR', 'Staging. And ignition.', 'Separación. E ignición.');
        radio(ctx, 'CAPCOM', 'We confirm good thrust on all five.', 'Confirmamos buen empuje en los cinco.');
        break;
      case 'LES_JETT':
        radio(ctx, 'CAPCOM', 'We confirm tower jettison. Mode 2.', 'Confirmamos el desecho de la torre. Modo 2.');
        break;
      case 'SII_CECO':
        radio(ctx, 'CAPCOM', 'Inboard cutoff on the S-II.', 'Apagado central del S-II.');
        break;
      case 'SII_SEP':
        radio(ctx, 'CDR', 'Staging, and the S-IVB is lit.', 'Separación; el S-IVB encendido.');
        break;
      case 'SIVB_CUTOFF':
        radio(ctx, 'CDR', 'Shutdown.', 'Apagado.');
        break;
      default:
        break;
    }
  });
}

/** Orbit summary text from the vehicle state. */
export function orbitText(st) {
  const A = st.primary === 'MOON' ? 'apolunio' : 'apogeo';
  const P = st.primary === 'MOON' ? 'perilunio' : 'perigeo';
  if (!Number.isFinite(st.apoAlt)) return `${P} ${(st.periAlt / NMI).toFixed(1)} nmi (trayectoria abierta)`;
  return `${A} ${(st.apoAlt / NMI).toFixed(1)} nmi · ${P} ${(st.periAlt / NMI).toFixed(1)} nmi`;
}

/** Entry prediction from the current state (γ at EI). */
export function entryPrediction(ctx) {
  return predictEntry(contextFromSim(ctx.sim));
}

/** Time-warp hint once. */
export function warpHint(ctx, text = 'Pulsa . (punto) para acelerar el tiempo; el reloj se detiene solo antes de cada encendido.') {
  ctx.hint(text, { durationS: 10 });
}

/** Wait until the vehicle is in contact with Earth again (after LOS behind the Moon). */
export function waitAOS(ctx) {
  return ctx.waitUntil(() => !ctx.vehicle.state.losEarth);
}

/** Wait until LOS (behind the Moon). */
export function waitLOS(ctx) {
  return ctx.waitUntil(() => ctx.vehicle.state.losEarth);
}
