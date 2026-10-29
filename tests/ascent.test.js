import { test } from 'node:test';
import assert from 'node:assert';
import { Simulation } from '../src/sim/Simulation.js';

test('Saturn V reaches a ~100 nmi parking orbit on the historical timeline', async () => {
  const sim = new Simulation({ chapter: { id: 't', setup: { get: -20, config: 'SATURN_V', state: 'PAD_39A', csm: 'PRELAUNCH', lm: 'STOWED' } }, missionId: 'apollo11', role: 'astronaut' });
  await sim.init();
  const ev = {};
  sim.bus.on('vehicle:event', (e) => { ev[e.kind] ??= sim.clock.get; });
  sim.vehicle.parts.les = true;
  sim.clock.setLimit('dynamics', 1e9);
  const log = [];
  let maxQ = 0;
  while (sim.clock.get < 800) {
    const h = 0.05;
    sim.gnc.update(h); sim.saturn.update(h); sim.csm.update(h); sim.lm.update(h); sim.dyn.step(h); sim.clock.tick(h);
    if (sim.clock.get > 200 && !ev.LES_JETT) sim.vehicle.request('LES_JETT');
    const st = sim.vehicle.state;
    maxQ = Math.max(maxQ, st.dynPressure);
    if (Math.abs(sim.clock.get % 60) < 0.05) log.push(`${sim.clock.get.toFixed(0)}s alt ${(st.alt/1000).toFixed(1)}km v ${st.speed.toFixed(0)} hdot ${st.hdot.toFixed(0)} m ${(st.mass/1000).toFixed(0)}t ${sim.saturn.stage}`);
  }
  const st = sim.vehicle.state;
  console.log(log.join('\n'));
  console.log(ev, 'maxQ', maxQ.toFixed(0), 'alt', (st.alt/1000).toFixed(1), 'v', st.speed.toFixed(0), 'mode', sim.dyn.mode);
  assert.ok(ev.ORBIT_INSERTION, 'orbit insertion');
  assert.ok(st.alt > 160000 && st.alt < 220000, 'altitude ~185 km');
});
