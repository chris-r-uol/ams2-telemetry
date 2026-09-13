/**
 * Regenerates the README screenshots from demo mode.
 *
 *   npm run screenshots
 *
 * Drives your installed Google Chrome through playwright-core (no browser
 * download). Starts its own demo server on a private data folder, so your real
 * sessions are never touched.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import type { SessionMeta } from '../src/shared/model/types.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT = join(ROOT, 'docs', 'images');
const PORT = 8617;
const BASE = `http://127.0.0.1:${PORT}`;

type Theme = 'dark' | 'light';

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${BASE}/api/status`)).ok) return;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  throw new Error('Demo server did not start');
}

async function getJson<T>(path: string): Promise<T> {
  return (await (await fetch(`${BASE}${path}`)).json()) as T;
}

console.log('Building the dashboard…');
const { build } = await import('vite');
await build({ configFile: join(ROOT, 'vite.config.ts'), logLevel: 'warn' });

mkdirSync(OUT, { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), 'ams2-coach-shots-'));
const server = spawn(
  process.execPath,
  [
    '--disable-warning=ExperimentalWarning',
    join(ROOT, 'src', 'server', 'index.ts'),
    '--source', 'demo',
    '--prefill', '7',
    '--speed', '2',
    '--port', String(PORT),
    '--data', dataDir,
    '--recordings', join(dataDir, 'recordings'),
  ],
  { stdio: ['ignore', 'inherit', 'inherit'] },
);

const browser = await chromium.launch({ channel: 'chrome', headless: true });

async function open(
  path: string,
  options: { width?: number; height?: number; theme?: Theme; glance?: boolean; scale?: number } = {},
): Promise<{ context: BrowserContext; page: Page }> {
  const { width = 1440, height = 960, theme = 'dark', glance = false, scale = 2 } = options;
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
    colorScheme: theme,
  });
  await context.addInitScript(
    ([t, g]) => {
      localStorage.setItem('ams2-coach:settings', JSON.stringify({ theme: t }));
      localStorage.setItem('ams2-coach:glance', g ? '1' : '0');
    },
    [theme, glance] as const,
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

async function post(path: string): Promise<void> {
  await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
}

try {
  await waitForServer();
  const [session] = await getJson<SessionMeta[]>('/api/sessions');
  const clean = session.laps.filter((l) => l.valid && l.kind === 'flying' && l.lapTime !== null);
  const best = clean.reduce((a, b) => (b.lapTime! < a.lapTime! ? b : a));
  const lastClean = [...clean].reverse().find((l) => l.lap !== best.lap)!;

  console.log('Recording a live lap (about 30 seconds)…');
  const liveDark = await open('#/live');
  const liveLight = await open('#/live', { theme: 'light' });
  const livePhone = await open('#/live', { width: 390, height: 844, scale: 3 });
  await sleep(30_000);
  await capture(liveDark.page, 'live-dark');
  await capture(liveLight.page, 'live-light');
  await capture(livePhone.page, 'live-phone');
  await Promise.all([liveDark.context.close(), liveLight.context.close(), livePhone.context.close()]);

  const glance = await open('#/live', { glance: true, height: 900 });
  await sleep(3000);
  await capture(glance.page, 'live-glance');
  await glance.context.close();

  const compare = await open(`#/compare/${session.id}/${lastClean.lap}/${session.id}/${best.lap}`, { height: 1080 });
  await compare.page.waitForSelector('.trace-panel .u-over');
  await sleep(1000);
  const over = await compare.page.locator('.trace-panel').nth(1).locator('.u-over').boundingBox();
  if (over) await compare.page.mouse.move(over.x + over.width * 0.968, over.y + over.height * 0.45);
  await sleep(400);
  await capture(compare.page, 'compare');
  await compare.context.close();

  const coach = await open(`#/coach/${session.id}`, { height: 1000 });
  await coach.page.waitForSelector('.habit-list, .tips');
  await sleep(800);
  await capture(coach.page, 'coach');
  await coach.context.close();

  const setup = await open(`#/setup/${session.id}/${lastClean.lap}`, { height: 1200 });
  await setup.page.waitForSelector('.hint-list');
  await setup.page.waitForSelector('.trace-panel .u-over');
  await sleep(1200);
  await captureCard(setup.page, 'What the data suggests', 'setup-hints');
  await captureCard(setup.page, 'Balance and grip', 'setup-balance');
  await captureCard(setup.page, 'Damper movement', 'setup-dampers');
  await setup.context.close();

  console.log('Recording a few seconds of raw telemetry…');
  await post('/api/recordings/start');
  await sleep(6000);
  await post('/api/recordings/stop');
  const sessions = await open('#/sessions', { height: 1000 });
  await sessions.page.waitForSelector('.recording-file');
  await captureCard(sessions.page, 'Raw telemetry recordings', 'recordings');
  await sessions.context.close();

  const detail = await open(`#/sessions/${session.id}`, { height: 900 });
  await detail.page.waitForSelector('.laptime-chart svg');
  await sleep(800);
  await capture(detail.page, 'session');
  await detail.context.close();
} finally {
  await browser.close();
  server.kill();
  rmSync(dataDir, { recursive: true, force: true });
}
