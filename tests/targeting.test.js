import { test } from 'node:test';
import assert from 'node:assert';
import { Simulation } from '../src/sim/Simulation.js';
import { planTLI, contextFromSim } from '../src/sim/physics/targeting.js';
import { R_MOON } from '../src/core/constants.js';

test('Houston TLI plan flown by the S-IVB reaches the Moon at the planned perilune', async () => {
  const sim = new Simulation({ chapter: { id: 't', setup: { get: 2 * 3600 + 10 * 60, config: 'SIVB_STACK', state: 'EARTH_PARKING_ORBIT', csm: 'EARTH_ORBIT', lm: 'STOWED' } }, missionId: 'apollo11', role: 'controller' });
  await sim.init();
  const plan = await planTLI(contextFromSim(sim));
  assert.ok(plan.perilune > 50e3 && plan.perilune < 400e3, `planned perilune ${plan.perilune}`);
  sim.saturn.startTB6({ c3: plan.c3, tb6: plan.tb6 });
  sim.clock.setLimit('dynamics', 1e9);
  let cut = false;
  sim.bus.on('vehicle:event', (e) => e.kind === 'TLI_CUTOFF' && (cut = true));
  while (!cut && sim.clock.get < plan.tig + 1200) sim.step(0.1);
  assert.ok(cut, 'TLI cutoff');
  const st = sim.vehicle.state;
  let minD = Infinity;
  sim.clock.setWarp(10000);
  while (sim.clock.get < plan.arrivalGET + 3 * 3600) {
    sim.step(0.2);
    minD = Math.min(minD, st.r.distanceTo(sim.dyn.moonPos));
  }
  const peri = minD - R_MOON;
  console.log('planned', (plan.perilune / 1e3).toFixed(0), 'km · flown', (peri / 1e3).toFixed(0), 'km');
  assert.ok(Math.abs(peri - plan.perilune) < 150e3, 'flown perilune close to the plan');
});
