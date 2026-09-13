/**
 * Mid-lap coaching against the demo car: corner reports as each corner is
 * finished, plans for the corners ahead, live balance and grip events.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AnalysisService } from '../src/server/analysis-service.ts';
import { DemoSimulator } from '../src/server/demo/simulator.ts';
import { LiveCoach } from '../src/server/live-coach.ts';
import { SessionManager } from '../src/server/session-manager.ts';
import { SessionStore } from '../src/server/storage.ts';
import { TelemetryHub } from '../src/server/telemetry/hub.ts';
import type { CornerReport } from '../src/shared/model/types.ts';

describe('live coach on the demo car', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ams2-coach-live-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const hub = new TelemetryHub();
  const store = new SessionStore(dir);
  const analysis = new AnalysisService(store);
  const manager = new SessionManager(hub, store, analysis, 'demo');
  const coach = new LiveCoach(manager, analysis);
  const reports: CornerReport[] = [];
  coach.onInsights((insights) => {
    if (insights.lastCorner && reports.at(-1) !== insights.lastCorner) reports.push(insights.lastCorner);
  });
  const demo = new DemoSimulator((bytes) => hub.ingest(bytes), { seed: 11 });

  // Four laps to learn from, then most of the way round lap 5.
  demo.runLaps(4);
  const balanceReadings: number[] = [];
  for (let i = 0; i < 140; i++) {
    demo.runFor(0.5);
    const reading = coach.frame().balance;
    if (reading !== null) balanceReadings.push(reading);
  }
  const insights = coach.insights();
  const apexOf = (corner: number) => demo.corners[corner].apexIndex * demo.track.step;
  const nameOf = (corner: number) =>
    manager.corners.reduce((best, c) => (Math.abs(c.apex - apexOf(corner)) < Math.abs(best.apex - apexOf(corner)) ? c : best)).name;

  it('reports each corner of the lap as it is finished', () => {
    expect(insights.lap).toBe(5);
    const done = insights.corners.filter((c) => c.done);
    expect(done.length).toBeGreaterThanOrEqual(5);
    expect(done.every((c) => c.timeDelta !== null)).toBe(true);
    const last = insights.lastCorner!;
    expect(last.lap).toBe(5);
    expect(last.bestLap).not.toBeNull();
    expect(last.phases).not.toBeNull();
    expect(last.profile.speed.length).toBeGreaterThan(20);
    expect(last.profile.balance.some((v) => v !== null)).toBe(true);
  });

  it('keeps a plan for the corners ahead, built from your best runs', () => {
    expect(insights.plans).toHaveLength(manager.corners.length);
    expect(insights.plans.every((p) => p.bestLap !== null)).toBe(true);
    expect(insights.plans.some((p) => p.bestBrakePoint !== null)).toBe(true);
    const frame = coach.frame();
    expect(frame.nextCornerId).not.toBeNull();
    expect(frame.toApex!).toBeGreaterThan(0);
  });

  it('spots the front lock-up this lap as it happens', () => {
    // planFor(4) locks a front wheel braking into the demo's late-braking corner.
    const lockUps = insights.events.filter((e) => e.kind === 'lock-up');
    expect(lockUps.length).toBeGreaterThanOrEqual(1);
    expect(lockUps.every((e) => e.wheel === 'FL' && e.corner === nameOf(demo.habits.lateBraking))).toBe(true);
  });

  it('reads live balance while cornering, including understeer', () => {
    expect(balanceReadings.length).toBeGreaterThan(10);
    expect(balanceReadings.some((v) => v > 0.12)).toBe(true);
  });

  it('reports the snap oversteer at the last corner once the lap ends', () => {
    // Lap 5 also has the snap-oversteer habit on the corner just before the line.
    demo.runLaps(1);
    demo.runFor(2);
    const snap = reports.find((r) => r.lap === 5 && r.corner === nameOf(demo.habits.coasting));
    expect(snap, 'report for the last corner of lap 5').toBeDefined();
    expect(snap!.phases?.exit.verdict === 'oversteer' || snap!.events.some((e) => e.kind === 'oversteer')).toBe(true);
    expect(coach.insights().lap).toBe(6);
  });
});
