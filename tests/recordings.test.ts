import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DemoSimulator } from '../src/server/demo/simulator.ts';
import { RecordingManager, type RecordingContext } from '../src/server/recordings.ts';
import { readRecording } from '../src/server/sources/replay.ts';
import { TelemetryHub } from '../src/server/telemetry/hub.ts';
import { decodePacket } from '../src/shared/protocol/decode.ts';

describe('raw telemetry recordings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ams2-coach-rec-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const hub = new TelemetryHub();
  let sink = (bytes: Uint8Array) => hub.ingest(bytes);
  const demo = new DemoSimulator((bytes) => sink(bytes), { seed: 5 });
  const context: RecordingContext = { track: 'Coachwood Park Grand Prix', car: 'Demo GT3', sessionId: 'session-a' };
  const settingsFile = join(dir, 'settings.json');
  const manager = new RecordingManager({
    dir,
    settingsFile,
    appVersion: 'test',
    priming: () => hub.primingPackets(),
    context: () => context,
  });

  it('starts mid-session with the track and names already in the file', async () => {
    demo.runFor(12);
    manager.start();
    sink = (bytes) => {
      manager.write(bytes, Date.now());
      hub.ingest(bytes);
    };
    demo.runFor(1);
    sink = (bytes) => hub.ingest(bytes);
    const info = await manager.stop();

    expect(info?.packets).toBeGreaterThan(100);
    expect(info?.track).toBe('Coachwood Park Grand Prix');
    const kinds: string[] = [];
    for await (const packet of readRecording(join(dir, info!.name))) kinds.push(decodePacket(packet.bytes)?.kind ?? 'unknown');
    expect(kinds.length).toBe(info!.packets);
    expect(kinds.indexOf('race')).toBeGreaterThanOrEqual(0);
    expect(kinds.indexOf('race')).toBeLessThan(kinds.indexOf('telemetry'));
    expect(kinds.indexOf('vehicleNames')).toBeLessThan(kinds.indexOf('telemetry'));
  });

  it('lists recordings and refuses to delete one that is still running', async () => {
    manager.start();
    const running = manager.status!;
    expect(manager.delete(running.name)).toBe(false);
    expect(manager.list().find((r) => r.name === running.name)?.active).toBe(true);
    await manager.stop();
    expect(manager.delete(running.name)).toBe(true);
    expect(existsSync(join(dir, running.name))).toBe(false);
  });

  it('records each session into its own file when automatic recording is on', async () => {
    const before = manager.list().length;
    await manager.setAutoRecord(true);
    expect(manager.status?.auto).toBe(true);
    const first = manager.status!.name;

    context.sessionId = 'session-b';
    await manager.sessionChanged('session-b');
    expect(manager.status?.name).not.toBe(first);

    await manager.setAutoRecord(false);
    expect(manager.status).toBeNull();
    expect(manager.list().length).toBe(before + 2);
    expect(JSON.parse(readFileSync(settingsFile, 'utf8')).autoRecord).toBe(false);
  });
});
