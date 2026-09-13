/**
 * End to end without the game: the demo simulator's UDP packets go through the
 * real decoder, lap builder, storage and coaching analysis.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AnalysisService } from '../src/server/analysis-service.ts';
import { DemoSimulator } from '../src/server/demo/simulator.ts';
import { SessionManager } from '../src/server/session-manager.ts';
import { SessionStore } from '../src/server/storage.ts';
import { TelemetryHub } from '../src/server/telemetry/hub.ts';
import type { LapFeedback } from '../src/shared/model/types.ts';

describe('demo → decoder → laps → coaching', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ams2-coach-test-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const hub = new TelemetryHub();
  const store = new SessionStore(dir);
  const analysis = new AnalysisService(store);
  const manager = new SessionManager(hub, store, analysis, 'demo');
  const feedback: LapFeedback[] = [];
  manager.onLap((_summary, f) => feedback.push(f));

  const demo = new DemoSimulator((bytes) => hub.ingest(bytes), { seed: 11 });
  demo.runLaps(8);
  demo.runFor(2); // let the final lap settle

  const session = () => manager.session!;

  it('records every lap with the simulated lap time', () => {
    const laps = session().laps;
    expect(laps).toHaveLength(8);
    expect(laps[0].kind).toBe('out');
    expect(laps.slice(1).every((l) => l.kind === 'flying')).toBe(true);
    laps.forEach((lap, i) => expect(lap.lapTime!).toBeCloseTo(demo.completedLaps[i].lapTime, 2));
  });

  it('knows the track, car and session type', () => {
    expect(session().track.location).toBe('Coachwood Park');
    expect(session().car).toBe('Demo GT3');
    expect(session().carClass).toBe('GT3');
    expect(session().sessionType).toBe('practice');
  });

  it('flags the lap with an off-track excursion as invalid', () => {
    const offLap = session().laps[5];
    expect(offLap.valid).toBe(false);
    expect(offLap.offTrackCount).toBeGreaterThan(0);
    expect(session().laps[4].valid).toBe(true);
  });

  it('splits sector times that add up to the lap time', () => {
    const lap = session().laps[3];
    expect(lap.sectors.every((s) => s !== null && s > 10)).toBe(true);
    const total = lap.sectors.reduce((sum, s) => sum! + s!, 0)!;
    expect(total).toBeCloseTo(lap.lapTime!, 3);
  });

  it('persists laps and reads them back', () => {
    const reopened = new SessionStore(dir);
    expect(reopened.get(session().id)?.laps).toHaveLength(8);
    const stored = reopened.loadLap(session().id, 3);
    expect(stored?.trace.t.length).toBeGreaterThan(1000);
  });

  it('detects roughly the corners the circuit was built with', () => {
    const result = analysis.insights(session().id)!;
    expect(Math.abs(result.corners.length - demo.corners.length)).toBeLessThanOrEqual(2);
    expect(result.insights.idealLapTime!).toBeLessThanOrEqual(result.insights.bestLap!.time);
  });

  it('spots the driver’s recurring late-braking habit', () => {
    const { insights, corners } = analysis.insights(session().id)!;
    const apex = demo.corners[demo.habits.lateBraking].apexIndex * demo.track.step;
    const corner = corners.find((c) => Math.abs(c.apex - apex) < 80);
    expect(corner, 'late-braking corner detected').toBeDefined();
    expect(insights.habits.some((h) => h.cornerId === corner!.id && h.kind === 'brake-later')).toBe(true);
  });

  it('gives post-lap tips once there is a reference', () => {
    expect(feedback).toHaveLength(8);
    expect(feedback.slice(2).some((f) => f.tips.length > 0)).toBe(true);
  });

  it('compares any two laps with a delta that ends at the lap time difference', () => {
    const laps = session().laps;
    const result = analysis.compare(session().id, 3, session().id, 4)!;
    const expected = laps[2].lapTime! - laps[3].lapTime!;
    expect(result.comparison.totalDelta).toBeCloseTo(expected, 2);
  });
});
