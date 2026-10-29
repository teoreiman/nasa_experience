import { test } from 'node:test';
import assert from 'node:assert';
import { Simulation } from '../src/sim/Simulation.js';
import { SITES, siteDir } from '../src/sim/terrain/lunarTerrain.js';

test('LM powered descent (P63→P64→P66 autopilot) lands softly near Tranquility Base', async () => {
  const sim = new Simulation({ chapter: { id: 't', setup: { get: 102 * 3600 + 33 * 60 + 5, config: 'LM', state: 'PRE_PDI', station: 'LM', csm: null, lm: 'PRE_PDI' } }, missionId: 'apollo11', role: 'controller' });
  await sim.init();
  let td = null;
  const phases = [];
  sim.bus.on('vehicle:event', (e) => e.kind === 'TOUCHDOWN' && (td = e));
  sim.bus.on('lm:phase', (e) => phases.push([e.phase, Math.round(sim.clock.get - 368585), Math.round(sim.vehicle.state.altTerrain)]));
  sim.gnc.autopilot.set('LANDING');
  sim.gnc.startDescent(siteDir(SITES.TRANQUILITY));
  const t0 = sim.clock.get;
  const log = [];
  while (!td && sim.clock.get - t0 < 1100) {
    const h = 0.1;
    sim.vehicle.sw.update(h);
    sim.gnc.update(h);
    sim.lm.update(h);
    sim.dyn.step(h);
    sim.clock.tick(h);
    const st = sim.vehicle.state;
    if (Math.round((sim.clock.get - t0) * 10) % 600 === 0) log.push(`${(sim.clock.get - t0).toFixed(0)}s h=${(st.altTerrain / 0.3048).toFixed(0)}ft hdot=${(st.hdot / 0.3048).toFixed(0)} vh=${(st.vHoriz / 0.3048).toFixed(0)} thr=${sim.vehicle.cmd.dpsThrottle.toFixed(2)} fuel=${(sim.lm.dpsProp / 82).toFixed(0)}% range=${(sim.gnc.lmGuidance.rangeToSite() / 1000).toFixed(1)}km`);
  }
  console.log(log.join('\n'));
  console.log(phases, td && { ...td, local: undefined, x: td.local.x.toFixed(0), y: td.local.y.toFixed(0) }, 'time', (sim.clock.get - t0).toFixed(0), 'fuel', (sim.lm.dpsProp / 82).toFixed(1));
  assert.ok(td, 'touchdown');
  assert.ok(!td.crash, 'soft landing');
});
