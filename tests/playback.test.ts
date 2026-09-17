/**
 * Replaying a recording from the dashboard: it takes over from the game, can be
 * paused, keeps its sessions out of your saved ones, and hands back when stopped.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AnalysisService } from '../src/server/analysis-service.ts';
import { DemoSimulator } from '../src/server/demo/simulator.ts';
import { LiveCoach } from '../src/server/live-coach.ts';
import { Playback } from '../src/server/playback.ts';
import { linkRecordings, RecordingManager } from '../src/server/recordings.ts';
import { SessionManager } from '../src/server/session-manager.ts';
import { PacketRecorder } from '../src/server/sources/recorder.ts';
import { SessionStore } from '../src/server/storage.ts';
import { TelemetryHub } from '../src/server/telemetry/hub.ts';
import type { RecordingInfo, SessionMeta } from '../src/shared/model/types.ts';

const waitFor = async (check: () => boolean, timeoutMs = 15_000) => {
  const until = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > until) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

describe('replaying a recording from the dashboard', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ams2-coach-playback-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  // Two demo laps squeezed into a couple of seconds of recording.
  const recordingName = '2026-01-01-12-00-00_coachwood-park.ams2rec';
  const recorder = new PacketRecorder(join(dir, 'recordings', recordingName));
  let packet = 0;
  const recorded = new DemoSimulator((bytes) => recorder.write(bytes, Math.floor(packet++ / 4)), { seed: 7 });
  recorded.runLaps(2);
  recorded.runFor(2);
  await recorder.close();

  const hub = new TelemetryHub();
  const store = new SessionStore(join(dir, 'data'));
  const analysis = new AnalysisService(store);
  const manager = new SessionManager(hub, store, analysis, 'udp');
  const coach = new LiveCoach(manager, analysis);
  const recordings = new RecordingManager({
    dir: join(dir, 'recordings'),
    settingsFile: join(dir, 'data', 'settings.json'),
    appVersion: 'test',
    priming: () => hub.primingPackets(),
    context: () => ({ track: null, car: null, sessionId: manager.session?.id ?? null }),
  });
  const playback = new Playback({ source: 'udp', speed: 1, hub, manager, store, analysis, recordings });
  playback.setBase({ detail: () => 'game', close: () => {} });
  let changes = 0;
  playback.onChange(() => changes++);

  // The game, driven by hand: a saved session from before the replay.
  const game = new DemoSimulator((bytes) => playback.ingest(bytes), { seed: 3 });
  game.runLaps(1);
  game.runFor(2);
  const saved = manager.session!.id;
  let ticks = 0;
  manager.onTickProcessed(() => ticks++);

  it('takes over from the game and keeps the replay out of your saved sessions', async () => {
    await playback.startReplay(recordingName);
    expect(changes).toBe(1);
    expect(playback.status()).toMatchObject({ source: 'replay', paused: false, replay: { recording: recordingName } });
    expect(manager.session).toBeNull();
    expect(coach.insights().sessionId).toBeNull();

    // The game's packets are ignored meanwhile.
    const before = ticks;
    game.runFor(1);
    playback.setSpeed(4);
    await waitFor(() => playback.status().replay!.finished);
    const replayed = manager.session!;
    expect(ticks).toBeGreaterThan(before);
    expect(replayed.id).not.toBe(saved);
    expect(replayed.source).toBe('replay');
    expect(replayed.laps.length).toBeGreaterThanOrEqual(2);
    expect(store.isScratch(replayed.id)).toBe(true);
    expect(store.list().map((s) => s.id)).toContain(replayed.id);
    expect(store.loadLap(replayed.id, replayed.laps[0].lap)).not.toBeNull();
    expect(existsSync(join(dir, 'data', 'sessions', replayed.id))).toBe(false);
  });

  it('pauses and resumes', async () => {
    await playback.startReplay(recordingName);
    playback.setPaused(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const paused = ticks;
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(ticks).toBe(paused);
    expect(playback.status().paused).toBe(true);
    playback.setPaused(false);
    await waitFor(() => ticks > paused + 50);
  });

  it('hands back to the game when stopped, throwing the replay away', () => {
    const replayed = manager.session?.id;
    playback.stopReplay();
    expect(playback.status()).toMatchObject({ source: 'udp', replay: null });
    expect(store.list().some((s) => s.id === replayed || store.isScratch(s.id))).toBe(false);
    expect(store.get(saved)).not.toBeNull();

    game.runLaps(1);
    game.runFor(2);
    const next = manager.session!;
    expect(next.source).toBe('udp');
    expect(next.id).not.toBe(saved);
    expect(existsSync(join(dir, 'data', 'sessions', next.id))).toBe(true);
  });

  it("refuses a recording that doesn't exist", async () => {
    await expect(playback.startReplay('missing.ams2rec')).rejects.toMatchObject({ status: 404 });
  });
});

describe('recordings and sessions', () => {
  const recording = (overrides: Partial<RecordingInfo>): RecordingInfo => ({
    name: 'r.ams2rec',
    sizeBytes: 1,
    startedAt: 1_000_000,
    durationMs: 600_000,
    packets: 1,
    track: 'Monza Monza',
    car: null,
    active: false,
    sessionId: null,
    ...overrides,
  });
  const session = (id: string, startedAt: number, location = 'Monza'): SessionMeta =>
    ({ id, startedAt, track: { location, variation: 'Monza', length: 5793 } }) as SessionMeta;

  it('uses the session a recording names, or the one that started while it ran on the same track', () => {
    const sessions = [session('named', 0), session('during', 1_100_000), session('elsewhere', 1_050_000, 'Imola')];
    const [named, during, none] = linkRecordings(
      [
        recording({ sessionId: 'named' }),
        recording({}),
        recording({ startedAt: 5_000_000 }),
      ],
      sessions,
    );
    expect(named.sessionId).toBe('named');
    expect(during.sessionId).toBe('during');
    expect(none.sessionId).toBeNull();
  });
});
