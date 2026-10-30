// Apollo 11 — Transposition, Docking and Extraction. Half an hour after TLI: CSM/LV separation, the
// CSM backs away, turns 180° and docks with the Eagle inside the S-IVB adapter, then pulls the LM
// out. Scored on closing speed, alignment and RCS propellant. The AI crew flies it in the
// controller role (GNC watches the RCS).

import { Vector3 } from 'three';
import { GET } from '../../core/MissionClock.js';
import { translunarState, basisQ } from '../common/states.js';
import { radio, grade } from '../common/kit.js';

export default {
  async setup() {
    const s = await translunarState(GET(3, 15));
    const fwd = s.v.clone().normalize();
    const down = s.r.clone().normalize().negate();
    return {
      get: s.get,
      config: 'SIVB_STACK',
      state: { r: s.r, v: s.v, q: basisQ(fwd, down), w: new Vector3(), mode: 'SPACE' },
      station: 'CM',
      seat: 'CDR',
      csm: 'TLC',
      lm: 'STOWED',
      maxWarp: 5,
    };
  },
  briefing: {
    summary:
      'A 3 horas de vuelo y ya a 9.000 km de la Tierra. El Eagle viaja plegado dentro del adaptador del S-IVB. ' +
      'Separa el CSM, aléjate unos 20 metros, gira 180° y acopla con el módulo lunar a menos de 0,3 m/s. Luego extrae al Eagle.',
    objectives: ['Separación CSM/LV', 'Girar el CSM y extender la sonda', 'Acoplar con el Eagle', 'Extraer el LM del S-IVB'],
    tips: ['I / K: traslación adelante / atrás · J / L y U / O: lateral', 'W/S cabeceo, A/D guiñada, Q/E alabeo', 'El panel de acoplamiento muestra distancia, velocidad de cierre y deriva'],
  },
  async run(ctx) {
    const sim = ctx.sim;
    const v = ctx.vehicle;
    const sat = ctx.saturn;
    if (sat) {
      for (const k of ['TLI_IGNITION', 'TLI_CUTOFF']) sat.done.add(k);
      sat.sivbProp = 4500;
    }
    const rcs0 = ctx.csm.smRcsKg;
    const tStart = ctx.t;
    ctx.caption('TRANSPOSICIÓN Y ACOPLAMIENTO', 'Apolo 11 · GET 3:15', 6);
    await ctx.say('CAPCOM', 'Apollo 11, Houston. You are GO for separation.', 'Apolo 11, Houston. Tienen GO para la separación.');

    // ---- separation
    const obj1 = ctx.objective('sep', 'Separa el CSM del S-IVB (CSM/LV SEP)');
    await ctx.crew({
      id: 'a11.sep',
      title: 'SEPARACIÓN CSM/LV',
      items: [
        { text: 'SECS ARM A y B — ARM', sw: [{ id: 'CM.SEQ.SECS_ARM_A', pos: 'ARM' }, { id: 'CM.SEQ.SECS_ARM_B', pos: 'ARM' }], hint: 'Consola izquierda' },
        { text: 'CSM/LV SEP — SEP (con tapa)', sw: { id: 'CM.LV.CSM_LV_SEP', pos: 'SEP' }, check: (c) => c.vehicle.config !== 'SIVB_STACK', hint: 'Panel 2: abre la tapa con clic derecho' },
      ],
      aiPace: [3, 5],
    });
    obj1.done();
    radio(ctx, 'CMP', 'SEP. The SLA panels are away.', 'Separación. Los paneles del adaptador se abren.');

    // ---- transposition and approach
    const tel = () => sim.dyn.dockingTelemetry?.();
    let capture = null;
    let bounces = 0;
    ctx.on('vehicle:event', (e) => {
      if (e.kind === 'DOCK_BOUNCE') {
        bounces++;
        ctx.alert(`Rebote: demasiado rápido (${e.closing.toFixed(2)} m/s)`, 'caution');
        ctx.penalty(`bounce${bounces}`, 25, 'Rebote en el acoplamiento');
        radio(ctx, 'CMP', 'Too fast. Backing off.', 'Demasiado rápido. Me alejo y vuelvo a intentar.', { channel: 'ic' });
      }
      if (e.kind === 'DOCK_CAPTURE') capture = e;
    });
    const obj2 = ctx.objective('dock', 'Gira 180°, extiende la sonda y acopla con el Eagle');
    // "do it for me" on a flying item: the docking autopilot takes over (scored as assisted)
    let assisted = false;
    const autopilot = (c) => {
      if (c.gnc.autopilot.mode === 'DOCKING') return;
      assisted = true;
      c.sw.set('CM.DOCK.PROBE', 'EXTEND', 'crew');
      c.gnc.autopilot.set('DOCKING', {});
      ctx.alert('Piloto automático de acoplamiento activado', 'info', 4);
    };
    if (ctx.isController) {
      // AI crew: back off ~15 m, stop, then the docking autopilot turns around and closes in
      ctx.spawn(async () => {
        await ctx.wait(3);
        v.controls.thc.set(1, 0, 0);
        await ctx.wait(9);
        v.controls.thc.set(0, 0, 0);
        await ctx.wait(45);
        v.controls.thc.set(-1, 0, 0);
        await ctx.wait(9);
        v.controls.thc.set(0, 0, 0);
        v.sw.set('CM.DOCK.PROBE', 'EXTEND', 'crew');
        sim.gnc.autopilot.set('DOCKING', {});
      });
    }
    await ctx.crew({
      id: 'a11.dock',
      title: 'TRANSPOSICIÓN Y ACOPLAMIENTO',
      items: [
        { text: 'Alejarse ~20 m con traslación +X (I) y frenar (K)', check: () => (tel()?.range ?? 0) > 14 || !!capture, do: autopilot, hint: 'La distancia aparece en el panel de acoplamiento' },
        { text: 'Girar 180° en cabeceo hasta ver el Eagle (S/W)', check: () => (tel()?.misalign ?? 180) < 20 || !!capture, do: autopilot },
        { text: 'DOCK PROBE — EXTEND', sw: { id: 'CM.DOCK.PROBE', pos: 'EXTEND' }, check: (c) => c.sw.get('CM.DOCK.PROBE') === 'EXTEND' || !!capture },
        { text: 'Aproximación a 0,1–0,3 m/s, cruz del COAS centrada', check: () => { const t = tel(); return !!capture || (!!t && t.range < 6 && -t.rangeRate < 0.4 && Math.hypot(t.lateral.y, t.lateral.z) < 0.5); }, do: autopilot },
        { text: 'Captura (pestillos de la sonda)', check: () => !!capture, do: autopilot },
      ],
      ai: ctx.isController,
      aiPace: [1, 2],
    });
    if (!capture) await ctx.waitUntil(() => !!capture || !!sim.dyn._captured || v.config !== 'CSM');
    sim.gnc.autopilot.clear();
    radio(ctx, 'CMP', 'Capture.', 'Captura.');
    const closing = capture?.closing ?? 0.2;
    const lateral = capture?.lateral ?? 0.1;
    if (assisted && !ctx.isController) ctx.penalty('assist', 80, 'Acoplamiento con piloto automático');
    ctx.score('closing', grade(Math.abs(closing - 0.15), 0.05, 0.45, 120), 120, `Velocidad de cierre ${closing.toFixed(2)} m/s`);
    ctx.score('align', grade(lateral, 0.05, 0.3, 60), 60, `Desalineación lateral ${(lateral * 100).toFixed(0)} cm`);
    await ctx.crew({
      id: 'a11.retract',
      title: 'ACOPLAMIENTO FIRME',
      items: [{ text: 'DOCK PROBE — RETRACT (12 cerrojos)', sw: { id: 'CM.DOCK.PROBE', pos: 'RETRACT' }, check: (c) => c.vehicle.config !== 'CSM' }],
      aiPace: [3, 5],
    });
    obj2.done();
    await ctx.say('CAPCOM', 'Roger, hard dock. Nice going.', 'Recibido: acoplamiento firme. Bien hecho.');
    if (closing < 0.3 && !bounces) ctx.achievement('a11-dock');

    // ---- extraction
    const obj3 = ctx.objective('extract', 'Extrae al Eagle del S-IVB (S-IVB/LM SEP)');
    radio(ctx, 'CMP', 'Tunnel pressurized. Ready for LM ejection.', 'Túnel presurizado. Listos para extraer el LM.', { channel: 'ic' });
    await ctx.crew({
      id: 'a11.extract',
      title: 'EXTRACCIÓN DEL LM',
      items: [{ text: 'S-IVB/LM SEP — SEP (con tapa)', sw: { id: 'CM.LV.SIVB_LM_SEP', pos: 'SEP' }, check: (c) => c.vehicle.config === 'CSM_LM' }],
      aiPace: [5, 8],
    });
    obj3.done();
    radio(ctx, 'CDR', 'We have the LM. Eagle is out.', 'Tenemos al LM. El Eagle está fuera.');
    // the S-IVB backs off for its "slingshot" past the Moon into solar orbit
    await ctx.wait(10);
    for (const b of sim.dyn.bodies.values()) if (b.config === 'SIVB') b.v.addScaledVector(b.v.clone().normalize(), -1.2);
    await ctx.say('CAPCOM', 'Apollo 11, Houston. The S-IVB will vent and go into its slingshot. You have a good spacecraft.', 'Apolo 11, Houston. El S-IVB ventilará sus tanques para su maniobra de «honda» lejos de ustedes. Tienen una buena nave.');
    const used = rcs0 - ctx.csm.smRcsKg;
    ctx.score('rcs', grade(used, 25, 90, 70), 70, `RCS usado: ${used.toFixed(0)} kg`);
    ctx.complete({
      summary: `Columbia y Eagle acoplados, rumbo a la Luna. Cierre a ${closing.toFixed(2)} m/s, ${bounces} rebote(s), ${used.toFixed(0)} kg de RCS.`,
      stats: { 'Velocidad de cierre': `${closing.toFixed(2)} m/s`, 'RCS usado': `${used.toFixed(0)} kg`, Tiempo: `${Math.round(ctx.t - tStart)} s` },
    });
  },
};
