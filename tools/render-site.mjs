#!/usr/bin/env node
// Render review previews of the five approved mockup sections and character comparison with headless Chrome over CDP.
// Dependency-free: Node >= 22 (native fetch + WebSocket). No server, no npm installs.
//
//   node tools/render-previews.mjs [--dpr=1] [--keep-profile]
//
// Env: CHROME_PATH overrides the Chrome binary.
// Output: mockups/previews/{slug}-desktop.png, {slug}-mobile.png,
//         {slug}-fullpage.png (desktop, when taller than viewport, capped at 6500px),
//         {slug}-beat{N}.png (desktop, one clip per .rv-stage beat), report.json
// Exit code: 0 ok, 1 required screenshot(s) failed, 2 Chrome/CDP setup failure.

import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE_URL = process.env.SITE_URL || 'http://127.0.0.1:8099/';
const OUT_DIR = path.join(ROOT, '.tmp', 'site-previews');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ARGS = new Set(process.argv.slice(2));
const DPR = Number((process.argv.find((a) => a.startsWith('--dpr=')) || '--dpr=1').split('=')[1]) || 1;
const KEEP_PROFILE = ARGS.has('--keep-profile');

const EXPECTED = ['1-opening', '2-schedule', '4-stats', '5-gallery', '6-reveal'];
const EXTRA_PAGES = [{ slug: 'character-comparison', file: path.join(ROOT, 'mockups', 'character-comparison.html') }];
const VIEWPORTS = {
  desktop: { width: 1440, height: 900, mobile: false },
  mobile: { width: 390, height: 844, mobile: true },
};
const FULLPAGE_MAX = 6500;
const BEAT_SELECTOR = '.rv-stage';
const T = {
  endpoint: 20000, // wait for DevToolsActivePort
  cdp: 15000, // any single CDP command
  load: 20000, // Page.loadEventFired
  fonts: 6000, // document.fonts.ready
  settle: 1200, // after fonts, let reduced-motion final states apply
  scrollStep: 250, // per scroll step (trigger IntersectionObserver beats)
  shutdownGraceful: 5000,
  shutdownTerm: 3000,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[previews]', ...a);
const warn = (...a) => console.error('[previews] WARN', ...a);
const fail = (...a) => console.error('[previews] ERROR', ...a);

function withTimeout(promise, ms, label) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`timeout after ${ms}ms: ${label}`)), ms); }),
  ]).finally(() => clearTimeout(t));
}

// ---------------------------------------------------------------- CDP client
class CDP {
  constructor(wsUrl, label) {
    this.label = label;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.ws = new WebSocket(wsUrl);
    this.ws.addEventListener('message', (ev) => this.#onMessage(ev));
    this.ws.addEventListener('close', () => {
      for (const { reject } of this.pending.values()) reject(new Error(`CDP socket closed (${this.label})`));
      this.pending.clear();
    });
  }
  open() {
    return withTimeout(new Promise((res, rej) => {
      this.ws.addEventListener('open', () => res(), { once: true });
      this.ws.addEventListener('error', () => rej(new Error(`WebSocket error connecting ${this.label}`)), { once: true });
    }), T.cdp, `open ${this.label}`);
  }
  #onMessage(ev) {
    let msg;
    try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString()); } catch { return; }
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject, method } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(`${method}: ${msg.error.message}${msg.error.data ? ' ' + msg.error.data : ''}`));
      else resolve(msg.result);
    } else if (msg.method) {
      for (const fn of this.listeners.get(msg.method) || []) { try { fn(msg.params); } catch {} }
    }
  }
  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }
  once(method, ms) {
    return withTimeout(new Promise((res) => {
      const fn = (p) => { this.listeners.set(method, (this.listeners.get(method) || []).filter((f) => f !== fn)); res(p); };
      this.on(method, fn);
    }), ms, `${this.label} event ${method}`);
  }
  send(method, params = {}, ms = T.cdp) {
    const id = ++this.id;
    const p = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject, method }));
    this.ws.send(JSON.stringify({ id, method, params }));
    return withTimeout(p, ms, `${this.label} ${method}`);
  }
  async evaluate(expression, ms = T.cdp) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, ms);
    if (r.exceptionDetails) throw new Error(`evaluate failed: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result.value;
  }
  close() { try { this.ws.close(); } catch {} }
}

// ---------------------------------------------------------------- Chrome lifecycle
async function launchChrome(profileDir) {
  if (!existsSync(CHROME)) throw new Error(`Chrome not found at "${CHROME}". Set CHROME_PATH to override.`);
  await rm(profileDir, { recursive: true, force: true });
  await mkdir(profileDir, { recursive: true });
  const flags = [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profileDir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-background-networking', '--disable-sync', '--disable-default-apps',
    '--disable-features=Translate,BackForwardCache,MediaRouter', '--hide-scrollbars',
    '--mute-audio', '--autoplay-policy=user-gesture-required', '--password-store=basic',
    '--use-mock-keychain', 'about:blank',
  ];
  const child = spawn(CHROME, flags, { stdio: ['ignore', 'pipe', 'pipe'], detached: false });
  const stderrTail = [];
  const keep = (d) => { stderrTail.push(...String(d).split('\n').filter(Boolean)); stderrTail.splice(0, Math.max(0, stderrTail.length - 40)); };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  const exited = new Promise((res) => child.once('exit', (code, sig) => res({ code, sig })));
  let spawnErr = null;
  child.once('error', (e) => { spawnErr = e; });
  log(`spawned Chrome pid=${child.pid} profile=${path.relative(ROOT, profileDir)}`);

  // Bounded wait for the DevToolsActivePort file (port=0 → Chrome picks a free port).
  const portFile = path.join(profileDir, 'DevToolsActivePort');
  const deadline = Date.now() + T.endpoint;
  let port = null;
  while (Date.now() < deadline) {
    if (spawnErr) throw new Error(`spawn failed: ${spawnErr.message}`);
    if (child.exitCode !== null) break;
    try {
      const [p] = (await readFile(portFile, 'utf8')).split('\n');
      if (/^\d+$/.test(p.trim())) { port = Number(p.trim()); break; }
    } catch {}
    await sleep(100);
  }
  if (!port) {
    const e = new Error(`DevTools endpoint not available within ${T.endpoint}ms (exitCode=${child.exitCode}). Chrome output tail:\n  ${stderrTail.join('\n  ') || '(none)'}`);
    e.child = child; e.exited = exited;
    throw e;
  }
  const base = `http://127.0.0.1:${port}`;
  let version = null;
  for (let i = 0; i < 20 && !version; i++) {
    try { version = await withTimeout(fetch(`${base}/json/version`).then((r) => r.json()), 2000, 'json/version'); }
    catch { await sleep(150); }
  }
  if (!version) { const e = new Error(`GET ${base}/json/version never answered`); e.child = child; e.exited = exited; throw e; }
  log(`CDP ready ${base} (${version.Browser})`);
  return { child, exited, base, version, stderrTail };
}

async function shutdownChrome(ctx) {
  if (!ctx?.child) return;
  const { child, exited } = ctx;
  if (child.exitCode !== null || child.signalCode !== null) return;
  // 1) graceful: Browser.close over the browser websocket
  try {
    if (ctx.version?.webSocketDebuggerUrl) {
      const b = new CDP(ctx.version.webSocketDebuggerUrl, 'browser');
      await b.open();
      b.send('Browser.close', {}, 2000).catch(() => {});
      await withTimeout(exited, T.shutdownGraceful, 'graceful exit');
      b.close();
      log(`Chrome pid=${child.pid} exited gracefully`);
      return;
    }
  } catch (e) { warn(`graceful close failed: ${e.message}`); }
  // 2) SIGTERM, 3) SIGKILL — only the pid we spawned, never pattern-kill.
  for (const [sig, ms] of [['SIGTERM', T.shutdownTerm], ['SIGKILL', 2000]]) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try { process.kill(child.pid, sig); } catch {}
    try { await withTimeout(exited, ms, sig); log(`Chrome pid=${child.pid} exited after ${sig}`); return; } catch {}
  }
  warn(`Chrome pid=${child.pid} may still be running; kill it manually: kill -9 ${child.pid}`);
}

// ---------------------------------------------------------------- page rendering
async function newPage(base) {
  const r = await withTimeout(fetch(`${base}/json/new?about:blank`, { method: 'PUT' }), T.cdp, 'json/new');
  if (!r.ok) throw new Error(`PUT /json/new → HTTP ${r.status}`);
  const t = await r.json();
  const cdp = new CDP(t.webSocketDebuggerUrl, `target ${t.id.slice(0, 8)}`);
  await cdp.open();
  return { cdp, targetId: t.id };
}
async function closePage(base, page) {
  page.cdp.close();
  try { await withTimeout(fetch(`${base}/json/close/${page.targetId}`), 3000, 'json/close'); } catch {}
}

const METRICS_JS = `(() => {
  const de = document.documentElement, b = document.body;
  const vw = de.clientWidth;
  const imgs = [...document.images];
  const missing = imgs.filter(i => i.complete && i.naturalWidth === 0).map(i => i.getAttribute('src'));
  const pending = imgs.filter(i => !i.complete).map(i => i.getAttribute('src'));
  const offenders = [];
  if (de.scrollWidth > vw) {
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width && r.right > vw + 1) {
        offenders.push({ el: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : ''), right: Math.round(r.right) });
        if (offenders.length >= 12) break;
      }
    }
  }
  return {
    title: document.title,
    scrollWidth: de.scrollWidth, clientWidth: vw, clientHeight: de.clientHeight,
    documentHeight: Math.max(de.scrollHeight, b ? b.scrollHeight : 0, de.offsetHeight),
    horizontalOverflow: de.scrollWidth > vw,
    overflowOffenders: offenders,
    images: { total: imgs.length, missing, pending },
    fonts: { status: document.fonts.status, loaded: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family + ' ' + f.weight) .filter((v, i, a) => a.indexOf(v) === i) },
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
})()`;

async function renderOne(base, file, slug, vpName, report) {
  const vp = VIEWPORTS[vpName];
  const entry = { viewport: `${vp.width}x${vp.height}`, dpr: DPR, shots: {}, console: [], exceptions: [], failedRequests: [], errors: [] };
  report.pages[slug].views[vpName] = entry;
  const page = await newPage(base);
  const { cdp } = page;
  const reqUrls = new Map();
  cdp.on('Runtime.consoleAPICalled', (p) => {
    if (['error', 'warning', 'assert'].includes(p.type)) {
      entry.console.push({ type: p.type, text: p.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 500) });
    }
  });
  cdp.on('Runtime.exceptionThrown', (p) => {
    const d = p.exceptionDetails;
    entry.exceptions.push({ text: (d.exception?.description || d.text || '').slice(0, 800), url: d.url, line: d.lineNumber, col: d.columnNumber });
  });
  cdp.on('Log.entryAdded', (p) => {
    if (p.entry.level === 'error' || p.entry.level === 'warning') entry.console.push({ type: `log:${p.entry.source}:${p.entry.level}`, text: `${p.entry.text} ${p.entry.url || ''}`.trim().slice(0, 500) });
  });
  cdp.on('Network.requestWillBeSent', (p) => reqUrls.set(p.requestId, p.request.url));
  cdp.on('Network.loadingFailed', (p) => {
    const url = reqUrls.get(p.requestId) || '?';
    entry.failedRequests.push({ url, error: p.errorText, local: url.startsWith('file:'), type: p.type });
  });
  cdp.on('Network.responseReceived', (p) => {
    if (p.response.status >= 400) entry.failedRequests.push({ url: p.response.url, error: `HTTP ${p.response.status}`, local: p.response.url.startsWith('file:'), type: p.type });
  });

  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Network.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: DPR, mobile: vp.mobile });
    if (vp.mobile) await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await cdp.send('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });

    const loaded = cdp.once('Page.loadEventFired', T.load);
    const nav = await cdp.send('Page.navigate', { url: SITE_URL });
    if (nav.errorText) throw new Error(`navigate: ${nav.errorText}`);
    await loaded;

    entry.fontsReady = await cdp.evaluate(
      `Promise.race([document.fonts.ready.then(() => 'ready'), new Promise(r => setTimeout(() => r('timeout'), ${T.fonts}))])`,
      T.fonts + 2000,
    );
    if (entry.fontsReady !== 'ready') warn(`${slug}/${vpName}: document.fonts.ready timed out after ${T.fonts}ms (offline? web fonts fall back)`);

    // Scroll through the page so IntersectionObserver-driven beats (typewriter, slam, date)
    // fire; with reduced motion they jump straight to their final populated state.
    await cdp.evaluate(`(async () => {
      const h = Math.min(document.documentElement.scrollHeight, 20000), step = Math.max(200, innerHeight * 0.6);
      for (let y = 0; y <= h; y += step) { scrollTo(0, y); await new Promise(r => setTimeout(r, ${T.scrollStep})); }
      scrollTo(0, 0); await new Promise(r => setTimeout(r, 200));
    })()`, 60000);
    await sleep(T.settle);

    // Dismiss the "Press A" gate so the site is in its presented state.
    await cdp.evaluate(`(() => { const b = document.querySelector('.start-gate__button'); if (b) b.click(); return !!b; })()`);
    await sleep(1200);

    entry.metrics = await cdp.evaluate(METRICS_JS);
    entry.siteState = await cdp.evaluate(`(() => {
      const q = (s) => document.querySelector(s), qa = (s) => [...document.querySelectorAll(s)];
      return {
        sections: ['opening','dailyLife','stats','gallery','reveal'].map(k => { const e = document.getElementById(k); return k + ':' + (e ? e.children.length : 'MISSING'); }),
        openingText: (q('[data-opening-line]') || {}).textContent || 'MISSING',
        galleryItems: qa('.ac-gallery__item').length,
        statTickets: qa('.ac-stats__ticket').length,
        timelineItems: qa('.ac-timeline__item').length,
        revealBeats: qa('[data-reveal-beat]').length,
        portraitLoaded: !!q('.ac-portrait__img') && q('.ac-portrait__img').complete && q('.ac-portrait__img').naturalWidth > 0,
        startGateGone: !q('#start-gate') || q('#start-gate').classList.contains('is-dismissed') || getComputedStyle(q('#start-gate')).display === 'none',
        leakTokens: /\\{name\\}|\\{son\\}|\\{venue\\}|\\{years\\}|\\{startDate\\}|undefined|NaN/.test(document.body.innerText),
        dateYearLeak: /October 4th,?\\s*\\d{4}/.test(document.body.innerText),
        text: document.body.innerText.slice(0, 400)
      };
    })()`);
    // re-evaluate typewriter population for the record
    entry.textState = await cdp.evaluate(`({
      opLine: document.getElementById('op-line')?.textContent || null,
      rvLine: document.getElementById('rv-line')?.textContent || null,
    })`);

    const shoot = async (name, params) => {
      const out = path.join(OUT_DIR, `${slug}-${name}.png`);
      try {
        const r = await cdp.send('Page.captureScreenshot', { format: 'png', ...params }, 60000);
        const buf = Buffer.from(r.data, 'base64');
        if (buf.length < 1000) throw new Error(`suspiciously small PNG (${buf.length} bytes)`);
        await writeFile(out, buf);
        entry.shots[name] = { file: path.relative(ROOT, out), bytes: buf.length, ok: true, ...(params.clip ? { clip: params.clip } : {}) };
        log(`OK   ${path.relative(ROOT, out)} (${buf.length} B)`);
      } catch (e) {
        entry.shots[name] = { file: path.relative(ROOT, out), ok: false, error: e.message };
        entry.errors.push(`screenshot ${name}: ${e.message}`);
        fail(`${slug} ${name}: ${e.message}`);
      }
    };

    await cdp.evaluate('scrollTo(0, 0)');
    await shoot(vpName, {}); // viewport shot

    if (vpName === 'desktop') {
      const docH = entry.metrics.documentHeight;
      if (docH > vp.height + 1) {
        const h = Math.min(docH, FULLPAGE_MAX);
        entry.fullpageTruncated = docH > FULLPAGE_MAX;
        if (entry.fullpageTruncated) warn(`${slug}: document ${docH}px > ${FULLPAGE_MAX}px; fullpage truncated (see beat clips)`);
        await shoot('fullpage', { captureBeyondViewport: true, clip: { x: 0, y: 0, width: vp.width, height: h, scale: 1 } });
      }
      const beats = await cdp.evaluate(`[...document.querySelectorAll(${JSON.stringify(BEAT_SELECTOR)})].map(s => {
        const r = s.getBoundingClientRect();
        return { label: s.querySelector('.rv-beat')?.textContent?.trim() || s.id || null, x: 0, y: Math.round(r.top + scrollY), width: document.documentElement.clientWidth, height: Math.round(r.height) };
      })`);
      entry.beats = beats.map((b, i) => ({ n: i + 1, label: b.label, y: b.y, height: b.height }));
      for (let i = 0; i < beats.length; i++) {
        const b = beats[i];
        if (!b.height) { entry.errors.push(`beat ${i + 1} has zero height`); continue; }
        await shoot(`beat${i + 1}`, { captureBeyondViewport: true, clip: { x: 0, y: b.y, width: b.width, height: b.height, scale: 1 } });
      }
    }
  } catch (e) {
    entry.errors.push(e.message);
    fail(`${slug}/${vpName}: ${e.message}`);
  } finally {
    await closePage(base, page);
  }
}

// ---------------------------------------------------------------- main
async function main() {
  const [major] = process.versions.node.split('.').map(Number);
  if (major < 22 || typeof WebSocket !== 'function' || typeof fetch !== 'function') {
    fail(`Node ${process.versions.node} lacks native fetch/WebSocket; use Node >= 22 (tested target: 26).`);
    return 2;
  }
  // Single production page served over HTTP (content/site.json needs http, not file://).
  const pages = EXPECTED.map((slug) => ({ slug, url: SITE_URL }));
  await mkdir(OUT_DIR, { recursive: true });

  const profileDir = path.join(ROOT, '.tmp', `chrome-previews-${process.pid}`);
  const report = { generatedAt: new Date().toISOString(), chrome: CHROME, node: process.version, reducedMotion: 'reduce', fullpageMax: FULLPAGE_MAX, pages: {}, summary: {} };
  let ctx = null;
  let setupFailed = false;
  const onSignal = async (sig) => { warn(`received ${sig}, shutting down Chrome`); await shutdownChrome(ctx); process.exit(130); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    ctx = await launchChrome(profileDir);
    report.chromeVersion = ctx.version.Browser;
    for (const page of pages) {
      const { slug } = page;
      report.pages[slug] = { source: page.url || 'index.html', views: {} };
      for (const vpName of Object.keys(VIEWPORTS)) {
        log(`render ${slug} @ ${vpName}`);
        await renderOne(ctx.base, null, slug, vpName, report);
      }
    }
  } catch (e) {
    setupFailed = true;
    fail(e.message);
    fail('Hints: confirm Chrome path, that the sandbox allows spawning Chrome and binding 127.0.0.1, and that .tmp/ is writable.');
    if (e.child) ctx = { child: e.child, exited: e.exited };
    report.setupError = e.message;
  } finally {
    await shutdownChrome(ctx);
    if (!KEEP_PROFILE) await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }

  // summary
  const failedShots = [], issues = [];
  for (const [slug, pg] of Object.entries(report.pages)) {
    for (const vpName of Object.keys(VIEWPORTS)) {
      const v = pg.views[vpName];
      if (!v) { failedShots.push(`${slug}-${vpName} (not rendered)`); continue; }
      if (!v.shots[vpName]?.ok) failedShots.push(`${slug}-${vpName}`);
      for (const [n, s] of Object.entries(v.shots)) if (!s.ok && n !== vpName) failedShots.push(`${slug}-${n}`);
      if (vpName === 'desktop' && v.metrics && v.metrics.documentHeight > VIEWPORTS.desktop.height + 1 && !v.shots.fullpage?.ok) {
        if (!failedShots.includes(`${slug}-fullpage`)) failedShots.push(`${slug}-fullpage`);
      }
      const m = v.metrics;
      if (m?.horizontalOverflow) issues.push(`${slug}/${vpName}: horizontal overflow scrollWidth=${m.scrollWidth} > clientWidth=${m.clientWidth}`);
      if (m?.images.missing.length) issues.push(`${slug}/${vpName}: missing images ${m.images.missing.join(', ')}`);
      const localFails = v.failedRequests.filter((r) => r.local);
      if (localFails.length) issues.push(`${slug}/${vpName}: failed local requests ${localFails.map((r) => r.url.replace(pathToFileURL(ROOT).href, '')).join(', ')}`);
      if (v.exceptions.length) issues.push(`${slug}/${vpName}: ${v.exceptions.length} runtime exception(s): ${v.exceptions[0].text.split('\n')[0]}`);
      const errs = v.console.filter((c) => c.type === 'error' || c.type === 'assert');
      if (errs.length) issues.push(`${slug}/${vpName}: ${errs.length} console error(s): ${errs[0].text}`);
      if (v.errors.length) issues.push(`${slug}/${vpName}: ${v.errors.join('; ')}`);
    }
  }
  for (const s of EXPECTED) if (!report.pages[s]) failedShots.push(`${s} (section missing)`);
  report.summary = { ok: !setupFailed && failedShots.length === 0, failedShots, issues };
  await writeFile(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  log(`report → ${path.relative(ROOT, path.join(OUT_DIR, 'report.json'))}`);
  for (const i of issues) warn(i);
  if (setupFailed) return 2;
  if (failedShots.length) { fail(`required screenshots failed: ${failedShots.join(', ')}`); return 1; }
  log(`done: ${Object.keys(report.pages).length} pages, ${issues.length} issue(s) noted in report.json`);
  return 0;
}

main().then((code) => { process.exitCode = code; }, (e) => { fail(e.stack || e.message); process.exitCode = 2; });
