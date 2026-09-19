/**
 * Regenerates the README screenshots from real recordings.
 *
 *   npm run screenshots [-- <folder of .ams2rec files>]   (default: test_data)
 *
 * Every recording becomes a saved session in a private data folder, as if it had
 * just been driven, so your real sessions are never touched. The session pages come
 * from those; the Live page comes from replaying the recording with the most laps.
 *
 * Drives your installed Google Chrome through playwright-core (no browser download).
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { AnalysisService } from '../src/server/analysis-service.ts';
import { SessionManager } from '../src/server/session-manager.ts';
import { readRecording } from '../src/server/sources/replay.ts';
import { SessionStore } from '../src/server/storage.ts';
import { TelemetryHub } from '../src/server/telemetry/hub.ts';
import type { RecordingInfo, SessionMeta } from '../src/shared/model/types.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT = join(ROOT, 'docs', 'images');
const PORT = 8617;
const BASE = `http://127.0.0.1:${PORT}`;

type Theme = 'dark' | 'light';
type Size = 'glance' | 'full';
type Placement = { card: string; size: Size; row: number; col: number };

const glance = (card: string, row: number, col: number): Placement => ({ card, size: 'glance', row, col });
const full = (card: string, row: number, col: number): Placement => ({ card, size: 'full', row, col });

/** The three starting presets, plus one with the newer cards, so between them every card appears. */
const PRESETS = [
  {
    id: 'focus',
    name: 'Focus',
    placements: [glance('delta', 0, 0), glance('next-corner', 0, 1), glance('last-corner', 0, 2), glance('focus', 1, 0), glance('car', 1, 2)],
  },
  {
    id: 'optimisation',
    name: 'Optimisation',
    placements: [full('last-corner', 0, 0), glance('delta', 0, 2), full('corner-strip', 1, 0), glance('balance', 1, 2)],
  },
  {
    id: 'full',
    name: 'Full',
    placements: [full('last-corner', 0, 0), glance('next-corner', 0, 2), glance('grip', 1, 0), glance('lap-trend', 1, 1), glance('car', 1, 2)],
  },
  {
    id: 'technique',
    name: 'Technique',
    placements: [full('corner-steering', 0, 0), glance('corner-grip', 0, 2), full('pedals', 1, 0), glance('track-map', 1, 2)],
  },
  {
    id: 'braking',
    name: 'Braking',
    placements: [full('trail-braking', 0, 0), glance('trail-braking', 0, 2), glance('pedals', 1, 0), glance('corner-steering', 1, 1), glance('last-corner', 1, 2)],
  },
];

// ---------------------------------------------------------------- data

const source = resolve(process.argv[2] ?? join(ROOT, 'test_data'));
const recordings = existsSync(source) ? readdirSync(source).filter((f) => f.endsWith('.ams2rec')).sort() : [];
if (recordings.length === 0) {
  console.error(`\n  ✖ No .ams2rec recordings in ${source}. Pass a folder: npm run screenshots -- <folder>\n`);
  process.exit(1);
}

const dataDir = mkdtempSync(join(tmpdir(), 'ams2-coach-shots-'));
const recordingsDir = join(dataDir, 'recordings');
mkdirSync(recordingsDir, { recursive: true });

console.log(`Turning ${recordings.length} recordings into sessions…`);
const store = new SessionStore(dataDir);
for (const name of recordings) {
  const file = join(source, name);
  // Linked rather than copied: the recordings list and Replay buttons only need them to be there.
  symlinkSync(file, join(recordingsDir, name));
  const hub = new TelemetryHub();
  // They were driven in the game: file them as such.
  const manager = new SessionManager(hub, store, new AnalysisService(store), 'udp');
  const ids = new Set<string>();
  manager.onSession((session) => ids.add(session.id));
  // Date each session from its recording's name (UTC), as if it had just been driven.
  const stamp = name.match(/^(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})_/);
  const startedAt = stamp ? Date.UTC(+stamp[1], +stamp[2] - 1, +stamp[3], +stamp[4], +stamp[5], +stamp[6]) : Date.now();
  let lastMs = 0;
  for await (const { offsetMs, bytes } of readRecording(file)) {
    hub.ingest(bytes, startedAt + offsetMs);
    lastMs = offsetMs;
  }
  for (const id of ids) {
    const meta = store.get(id);
    if (meta && meta.laps.length) store.saveSession({ ...meta, startedAt, updatedAt: startedAt + lastMs });
  }
}

// ---------------------------------------------------------------- server and browser

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${BASE}/api/status`)).ok) return;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  throw new Error('Server did not start');
}

async function getJson<T>(path: string): Promise<T> {
  return (await (await fetch(`${BASE}${path}`)).json()) as T;
}

/** Poll until `check` passes, giving up after `seconds`. */
async function until(what: string, check: () => Promise<boolean>, seconds = 360): Promise<void> {
  const deadline = Date.now() + seconds * 1000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Gave up waiting for ${what}`);
    await sleep(100);
  }
}

async function send(path: string, method: string, body: unknown = {}): Promise<void> {
  const res = await fetch(`${BASE}${path}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
}

console.log('Building the dashboard…');
const { build } = await import('vite');
await build({ configFile: join(ROOT, 'vite.config.ts'), logLevel: 'warn' });
mkdirSync(OUT, { recursive: true });

// Listens for the game on its own UDP port, so it can run next to a real one. Nothing is sent there.
const server = spawn(
  process.execPath,
  [
    '--disable-warning=ExperimentalWarning',
    join(ROOT, 'src', 'server', 'index.ts'),
    '--port', String(PORT),
    '--udp-port', String(PORT),
    '--data', dataDir,
    '--recordings', recordingsDir,
  ],
  { stdio: ['ignore', 'inherit', 'inherit'] },
);

const browser = await chromium.launch({ channel: 'chrome', headless: true });

async function open(
  path: string,
  options: { width?: number; height?: number; theme?: Theme; preset?: string; scale?: number } = {},
): Promise<{ context: BrowserContext; page: Page }> {
  const { width = 1680, height = 1050, theme = 'dark', preset = 'focus', scale = 2 } = options;
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, colorScheme: theme });
  await context.addInitScript(
    ([t, presets, active]) => {
      localStorage.setItem('ams2-coach:settings', JSON.stringify({ theme: t }));
      localStorage.setItem('ams2-coach:presets', JSON.stringify({ presets, activeId: active }));
    },
    [theme, PRESETS, preset] as const,
  );
  const page = await context.newPage();
  await page.goto(`${BASE}/${path}`);
  return { context, page };
}

async function capture(page: Page, name: string): Promise<void> {
  const file = join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  ✓ ${file}`);
}

/** Screenshot a single card, found by its heading. */
async function captureCard(page: Page, heading: string, name: string): Promise<void> {
  const file = join(OUT, `${name}.png`);
  // Unpin the header so it can't sit on top of the card being captured.
  await page.addStyleTag({ content: '.app-header { position: static !important; }' });
  const card = page.locator('section.card', { has: page.getByRole('heading', { name: heading, exact: true }) });
  await card.scrollIntoViewIfNeeded();
  await sleep(500);
  await card.screenshot({ path: file });
  console.log(`  ✓ ${file}`);
}

try {
  await waitForServer();
  const sessions = await getJson<SessionMeta[]>('/api/sessions');
  const clean = (s: SessionMeta) => s.laps.filter((l) => l.valid && l.kind === 'flying' && l.lapTime !== null);
  const session = sessions.reduce((a, b) => (clean(b).length > clean(a).length ? b : a));
  const laps = clean(session);
  const best = laps.reduce((a, b) => (b.lapTime! < a.lapTime! ? b : a));
  const other = [...laps].sort((a, b) => a.lapTime! - b.lapTime!).find((l) => l.lap !== best.lap)!;
  console.log(`Session pages from ${session.id}: best lap ${best.lap}, compared with lap ${other.lap}`);

  const detail = await open(`#/sessions/${session.id}`, { height: 1000 });
  await detail.page.waitForSelector('.laptime-chart svg');
  await sleep(800);
  await capture(detail.page, 'session');
  await detail.context.close();

  const compare = await open(`#/compare/${session.id}/${other.lap}/${session.id}/${best.lap}`, { height: 1100 });
  await compare.page.waitForSelector('.trace-panel .u-over');
  await sleep(1000);
  // Point at the first chicane's braking zone, so the readout shows.
  const over = await compare.page.locator('.trace-panel').nth(1).locator('.u-over').boundingBox();
  if (over) await compare.page.mouse.move(over.x + over.width * 0.15, over.y + over.height * 0.45);
  await sleep(400);
  await capture(compare.page, 'compare');
  await compare.context.close();

  const coach = await open(`#/coach/${session.id}`, { height: 1050 });
  await coach.page.waitForSelector('.habit-list, .tips');
  await sleep(800);
  await capture(coach.page, 'coach');
  await coach.context.close();

  const setup = await open(`#/setup/${session.id}/${best.lap}`, { height: 1200 });
  await setup.page.waitForSelector('.hint-list');
  await setup.page.waitForSelector('.trace-panel .u-over');
  await setup.page.waitForSelector('.grip-setup .grip-circle svg');
  await setup.page.waitForSelector('table.track-use');
  await sleep(1200);
  await captureCard(setup.page, 'What the data suggests', 'setup-hints');
  await captureCard(setup.page, 'Balance and grip', 'setup-balance');
  await captureCard(setup.page, 'Handling by speed and pedal', 'setup-handling');
  await captureCard(setup.page, 'Grip used', 'setup-grip');
  await captureCard(setup.page, 'Track use', 'setup-track-use');
  await captureCard(setup.page, 'Gearing and shifts', 'setup-gearing');
  await captureCard(setup.page, 'Damper movement', 'setup-dampers');
  await setup.context.close();

  const list = await open('#/sessions', { height: 1000 });
  await list.page.waitForSelector('.recording-file');
  await captureCard(list.page, 'Raw telemetry recordings', 'recordings');
  await list.context.close();

  // The Live page, from a replay of the session's recording.
  const { recordings: listed } = await getJson<{ recordings: RecordingInfo[] }>('/api/recordings');
  const recording = listed.find((r) => r.sessionId === session.id) ?? listed[0];
  console.log(`Replaying ${basename(recording.name)} for the Live page…`);
  await send('/api/replay', 'POST', { recording: recording.name });
  await send('/api/source/speed', 'PUT', { speed: 4 });

  const control = await open('#/live', { preset: 'focus' });
  const lap = () => control.page.evaluate(() => Number(document.querySelector('.strip-facts dd')?.textContent) || 0);
  const lastCorner = () =>
    control.page.evaluate(
      () => document.querySelector('.live-card:has(.phase-strip) .lc-corner')?.textContent ?? null,
    );
  // Several laps in, so every card has a best run to compare with, on a clean lap; then real time from the lap's last corner.
  await until('lap 8', async () => (await lap()) >= 8 && (await lastCorner()) === 'T6');
  await send('/api/source/speed', 'PUT', { speed: 1 });

  const shots = await Promise.all([
    open('#/live', { preset: 'optimisation' }).then((s) => ({ ...s, name: 'live-dark' })),
    open('#/live', { preset: 'focus' }).then((s) => ({ ...s, name: 'live-focus' })),
    open('#/live', { preset: 'full' }).then((s) => ({ ...s, name: 'live-full' })),
    open('#/live', { preset: 'technique' }).then((s) => ({ ...s, name: 'live-technique' })),
    open('#/live', { preset: 'braking' }).then((s) => ({ ...s, name: 'live-braking' })),
    open('#/live', { preset: 'full', theme: 'light' }).then((s) => ({ ...s, name: 'live-light' })),
    open('#/live', { preset: 'focus', width: 390, height: 844, scale: 3 }).then((s) => ({ ...s, name: 'live-phone' })),
  ]);
  // Wait for the first corner after the line, so the corner cards all show the same one.
  await until('the first corner', async () => (await lastCorner()) === 'T1', 60);
  await sleep(1500);
  for (const shot of shots) await capture(shot.page, shot.name);
  await Promise.all([...shots.map((s) => s.context.close()), control.context.close()]);
  await send('/api/replay', 'DELETE');
} finally {
  await browser.close();
  server.kill();
  rmSync(dataDir, { recursive: true, force: true });
}
