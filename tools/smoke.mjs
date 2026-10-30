#!/usr/bin/env node
// Headless smoke test in the installed Edge/Chrome (playwright-core, no browser download).
// Starts a Vite dev server, opens a URL, waits, optionally interacts, screenshots, and reports
// console errors / page errors as JSON. Runs are serialised machine-wide with a lock file because
// the dev machine has little RAM.
//
//   node tools/smoke.mjs --url "/?play=a11-launch&role=astronaut" --wait 8000 --shot tools/screenshots/launch.png
//   --viewport 1280x720 | --mobile (844x390 landscape, touch) | --until "window.__APOLO_READY__"
//   --eval "js expression" (printed) | --click "css selector" | --keys "KeyC,Period" | --hold "KeyW:1500"
//   --steps '[{"wait":2000},{"click":"#x"},{"keys":"KeyC"},{"shot":"a.png"},{"eval":"1+1"}]'
//   --browser msedge|chrome | --timeout 90000 | --base http://localhost:5173 (reuse a running server)

import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { mkdirSync, openSync, closeSync, unlinkSync, statSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const opt = (name, def = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const flag = (name) => args.includes(`--${name}`);

const url = opt('url', '/');
const waitMs = Number(opt('wait', '5000'));
const shot = opt('shot');
const timeout = Number(opt('timeout', '90000'));
const browserChannel = opt('browser', process.platform === 'win32' ? 'msedge' : 'chrome');
const angle = process.platform === 'win32' ? 'd3d11' : process.platform === 'darwin' ? 'metal' : 'gl';
const [vw, vh] = (opt('viewport', '1280x720')).split('x').map(Number);
const mobile = flag('mobile');

const lockPath = resolve(tmpdir(), 'proyecto-apolo-smoke.lock');
async function acquireLock() {
  const start = Date.now();
  for (;;) {
    try {
      closeSync(openSync(lockPath, 'wx'));
      return;
    } catch {
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > 240000) unlinkSync(lockPath);
      } catch {}
      if (Date.now() - start > 300000) throw new Error('smoke lock timeout');
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}
const releaseLock = () => {
  try {
    if (existsSync(lockPath)) unlinkSync(lockPath);
  } catch {}
};

const report = { url, consoleErrors: [], pageErrors: [], warnings: [], evals: [], screenshots: [], ok: false };
let server = null;
let browser = null;

async function main() {
  await acquireLock();
  process.on('exit', releaseLock);
  let base = opt('base');
  if (!base) {
    server = await createServer({ root, logLevel: 'error', server: { port: Number(opt('port', '5179')), strictPort: false, host: '127.0.0.1' } });
    await server.listen();
    base = server.resolvedUrls.local[0].replace(/\/$/, '');
  }
  browser = await chromium.launch({
    channel: browserChannel,
    headless: true,
    args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', `--use-angle=${angle}`, '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  });
  const context = await browser.newContext(
    mobile
      ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36' }
      : { viewport: { width: vw, height: vh } },
  );
  const page = await context.newPage();
  page.on('console', (m) => {
    const t = m.type();
    if (t === 'error') report.consoleErrors.push(m.text());
    else if (t === 'warning') report.warnings.push(m.text());
  });
  page.on('pageerror', (e) => report.pageErrors.push(String(e?.stack ?? e)));
  await page.goto(base + url, { timeout, waitUntil: 'load' });
  const until = opt('until', 'window.__APOLO_READY__ === true');
  await page.waitForFunction(until, null, { timeout }).catch(() => report.warnings.push(`until-timeout: ${until}`));
  report.gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'n/a';
  });
  const steps = opt('steps') ? JSON.parse(opt('steps')) : [];
  if (!steps.length) {
    steps.push({ wait: waitMs });
    if (opt('click')) steps.push({ click: opt('click') }, { wait: 1000 });
    if (opt('keys')) steps.push({ keys: opt('keys') }, { wait: 1000 });
    if (opt('hold')) steps.push({ hold: opt('hold') });
    if (opt('eval')) steps.push({ eval: opt('eval') });
    if (shot) steps.push({ shot });
  }
  for (const s of steps) {
    if (s.wait) await page.waitForTimeout(s.wait);
    if (s.click) await page.click(s.click, { timeout: 10000 }).catch((e) => report.warnings.push(`click ${s.click}: ${e.message}`));
    if (s.tap) await page.touchscreen.tap(s.tap[0], s.tap[1]);
    if (s.mouse) await page.mouse.click(s.mouse[0], s.mouse[1], { button: s.button ?? 'left' });
    if (s.keys) for (const k of s.keys.split(',')) await page.keyboard.press(k.trim());
    if (s.hold) {
      const [k, ms] = s.hold.split(':');
      await page.keyboard.down(k);
      await page.waitForTimeout(Number(ms));
      await page.keyboard.up(k);
    }
    if (s.eval) report.evals.push(await page.evaluate(s.eval).catch((e) => `EVAL ERROR: ${e.message}`));
    if (s.shot) {
      const p = resolve(root, s.shot);
      mkdirSync(dirname(p), { recursive: true });
      await page.screenshot({ path: p });
      report.screenshots.push(p);
    }
  }
  report.fps = await page.evaluate(() => window.__game?.fps?.toFixed?.(1) ?? null).catch(() => null);
  report.ok = report.pageErrors.length === 0 && report.consoleErrors.length === 0;
}

main()
  .catch((err) => {
    report.fatal = String(err?.stack ?? err);
  })
  .finally(async () => {
    await browser?.close().catch(() => {});
    await server?.close().catch(() => {});
    releaseLock();
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.ok ? 0 : 1);
  });
