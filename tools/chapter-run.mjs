#!/usr/bin/env node
// Headless chapter runner: plays a chapter script to the end at high time acceleration and reports
// the outcome. The controller role uses the AI crew; the astronaut role presses "do it" on every
// checklist item and takes the first option of every decision.
//
//   node tools/chapter-run.mjs a11-tli [--role astronaut|controller] [--warp 1000] [--max 40000] [--log]
//   node tools/chapter-run.mjs all      (every campaign chapter, controller role where available)

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const args = process.argv.slice(2);
const opt = (name, def = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const flag = (name) => args.includes(`--${name}`);

const { loadChapter, MISSIONS } = await import('../src/missions/registry.js');
const { Simulation } = await import('../src/sim/Simulation.js');
const { MissionRunner } = await import('../src/missions/MissionRunner.js');

async function runChapter(id, role, { warp = 1000, maxReal = 40000, log = false } = {}) {
  const t0 = Date.now();
  const errors = [];
  const origErr = console.error;
  console.error = (...a) => {
    errors.push(a.map((x) => (x?.stack ?? String(x))).join(' '));
    if (log) origErr(...a);
  };
  const lines = [];
  let result = null;
  let sim = null;
  try {
    const { mission, chapter } = await loadChapter(id);
    const roles = chapter.roles ?? ['astronaut'];
    if (!roles.includes(role)) role = roles[0];
    sim = new Simulation({ chapter, missionId: mission.id, role });
    await sim.init();
    const runner = new MissionRunner({ game: null, sim, view: null, chapter, mission, role });
    sim.runner = runner;
    const bus = sim.bus;
    bus.on('mission:end', (r) => (result = r));
    let speaking = 0;
    bus.on('mission:say', (l) => {
      speaking++;
      lines.push(`[${(sim.clock.get / 3600).toFixed(3)}h] ${l.who}: ${l.es ?? l.en}`);
      if (log) console.log(lines.at(-1));
    });
    bus.on('mission:sayEnd', () => (speaking = Math.max(0, speaking - 1)));
    bus.on('mission:objective', (o) => log && console.log(`   objective ${o.id} ${o.state}: ${o.text}`));
    bus.on('mission:alert', (a) => log && console.log(`   alert: ${a.text}`));
    bus.on('mission:choice', (c) => setTimeout(() => c.resolve(c.options[0].id), 0));
    bus.on('mission:groundTask', (t) => setTimeout(() => t.resolve(t.options[0].id), 0));
    let checklist = null;
    bus.on('mission:checklist', (c) => (checklist = c.state === 'active' && c.mode === 'player' ? c : checklist?.id === c.id ? null : checklist));
    runner.start();
    const dt = 0.05;
    let real = 0;
    let lastAuto = 0;
    while (!result && real < maxReal) {
      // a player listens to the radio at (nearly) real time
      sim.clock.setWarp(speaking ? 5 : warp);
      sim.step(dt);
      runner.frame(dt);
      real += dt;
      if (role === 'astronaut' && checklist && real - lastAuto > 1.5) {
        lastAuto = real;
        const next = checklist.items.find((i) => !i.done && !i.optional) ?? checklist.items.find((i) => !i.done);
        if (next) bus.emit('mission:checklistAuto', { checklistId: checklist.id, itemId: next.id });
      }
      await new Promise((r) => setImmediate(r));
    }
    runner.cancel('harness');
  } catch (err) {
    errors.push(String(err?.stack ?? err));
  } finally {
    console.error = origErr;
  }
  const out = {
    id,
    role,
    ok: !!result?.success && !errors.length,
    success: result?.success ?? null,
    reason: result?.reason ?? (result ? '' : 'timeout'),
    grade: result?.grade,
    score: result ? `${result.score.total}/${result.score.max}` : null,
    get: sim ? (sim.clock.get / 3600).toFixed(3) + ' h' : null,
    seconds: ((Date.now() - t0) / 1000).toFixed(1),
    summary: result?.summary,
    stats: result?.stats,
    errors: errors.slice(0, 5),
  };
  if (!out.ok) out.lastLines = lines.slice(-12);
  sim?.dispose();
  return out;
}

const target = args[0] ?? 'all';
const role = opt('role', 'controller');
const warp = Number(opt('warp', '1000'));
const maxReal = Number(opt('max', '40000'));
const ids = target === 'all' ? MISSIONS.flatMap((m) => m.chapters.map((c) => c.id)) : target.split(',');
const results = [];
for (const id of ids) {
  const r = await runChapter(id, role, { warp, maxReal, log: flag('log') });
  results.push(r);
  console.log(JSON.stringify(r, null, 2));
}
if (ids.length > 1) {
  console.log('\nSUMMARY');
  for (const r of results) console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.id.padEnd(16)} ${r.role.padEnd(10)} ${String(r.grade ?? '-').padEnd(3)} ${r.score ?? ''} ${r.reason ?? ''}`);
}
process.exit(results.every((r) => r.ok) ? 0 : 1);
