/**
 * Chassis analysis against the demo car, whose driver bottoms out in a bumpy
 * braking zone, locks a front wheel, spins the rears, snaps into oversteer and
 * lifts a wheel over a kerb at known corners.
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
import { analyseChassis, type ChassisEventKind } from '../src/shared/analysis/chassis.ts';

describe('chassis analysis on the demo car', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ams2-coach-chassis-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const hub = new TelemetryHub();
  const store = new SessionStore(dir);
  const analysis = new AnalysisService(store);
  const manager = new SessionManager(hub, store, analysis, 'demo');
  const demo = new DemoSimulator((bytes) => hub.ingest(bytes), { seed: 11 });
  demo.runLaps(8);
  demo.runFor(2);

  const sessionId = manager.session!.id;
  const a = analysis.chassis(sessionId)!.analysis;
  const detected = analysis.chassis(sessionId)!.corners;
  const lapLength = demo.track.length;
  const apexOf = (corner: number) => demo.corners[corner].apexIndex * demo.track.step;
  const cornerName = (corner: number) =>
    detected.reduce((best, c) => (Math.abs(c.apex - apexOf(corner)) < Math.abs(best.apex - apexOf(corner)) ? c : best)).name;
  /** Events within `before` metres before, or `after` metres past, a demo corner's apex (wrapping at the line). */
  const eventsNear = (kind: ChassisEventKind, corner: number, before: number, after: number) =>
    a.events.filter((e) => {
      if (e.kind !== kind) return false;
      const past = (e.distance - apexOf(corner) + lapLength) % lapLength;
      return past <= after || lapLength - past <= before;
    });

  it('finds every chassis channel and works out units and directions', () => {
    expect(a.availability).toEqual({
      suspension: true,
      dampers: true,
      rideHeight: true,
      wheelSpeed: true,
      yawRate: true,
      slipAngle: true,
      wheelContact: true,
    });
    expect(a.calibration.rideHeightUnit).toBe('cm');
    expect(a.calibration.travelSign).toBe(1);
    expect(a.calibration.damperSign).toBe(1);
    expect(a.calibration.velocityAxesSwapped).toBe(false);
    expect(a.calibration.steerPerCurvature).not.toBeNull();
    for (const radius of a.calibration.wheelRadius) expect(radius!).toBeCloseTo(0.33, 2);
  });

  it('spots the front bottoming out and hitting the bump stops in the bumpy braking zone', () => {
    const bottoming = a.events.filter((e) => e.kind === 'bottoming');
    expect(bottoming.length).toBeGreaterThanOrEqual(3);
    expect(bottoming.every((e) => e.wheel === 'FL' || e.wheel === 'FR')).toBe(true);
    // Outside-front bottoming while trail braking elsewhere is realistic; the bumpy zone should still be the worst.
    const perCorner = new Map<string, number>();
    for (const e of bottoming) perCorner.set(e.corner ?? '?', (perCorner.get(e.corner ?? '?') ?? 0) + 1);
    const worst = [...perCorner.entries()].sort((x, y) => y[1] - x[1])[0][0];
    expect(worst).toBe(cornerName(demo.habits.lateBraking));
    expect(a.wheels[0].bumpStopSuspected || a.wheels[1].bumpStopSuspected).toBe(true);
    expect(a.wheels[2].bumpStopSuspected || a.wheels[3].bumpStopSuspected).toBe(false);
    expect(a.hints.some((h) => h.id === 'bottoming-front')).toBe(true);
  });

  it('finds lock-ups, wheelspin, oversteer and wheel lift where the driver causes them', () => {
    const lockUps = eventsNear('lock-up', demo.habits.lateBraking, 230, 0);
    expect(lockUps.length).toBeGreaterThanOrEqual(3);
    expect(lockUps.every((e) => e.wheel === 'FL')).toBe(true);
    expect(eventsNear('wheelspin', demo.habits.lateThrottle, 0, 120).length).toBeGreaterThanOrEqual(2);
    expect(eventsNear('oversteer', demo.habits.coasting, 0, 80).length).toBeGreaterThanOrEqual(2);
    expect(eventsNear('wheel-lift', demo.habits.slowApex, 30, 30).length).toBeGreaterThanOrEqual(2);
  });

  it('reads understeer in the slow corners', () => {
    expect(a.corners.filter((c) => c.mid.verdict === 'understeer').length).toBeGreaterThanOrEqual(3);
  });

  it('builds damper histograms and platform figures', () => {
    for (const wheel of a.wheels) {
      expect(wheel.damper).not.toBeNull();
      expect(wheel.damper!.shares.reduce((sum, v) => sum + v, 0)).toBeCloseTo(1, 5);
      expect(wheel.damper!.bump + wheel.damper!.rebound).toBeLessThanOrEqual(1);
    }
    expect(a.platform.frontRollPerG!).toBeGreaterThan(0.012);
    expect(a.platform.frontRollPerG!).toBeLessThan(0.03);
    expect(a.platform.divePerG!).toBeGreaterThan(0.01);
    expect(a.platform.harshness).not.toBeNull();
  });

  it('gives distance-aligned series for a single lap', () => {
    const series = analysis.chassisLap(sessionId, 4)!;
    expect(series.distance.length).toBeGreaterThan(2000);
    expect(series.travel[0]).toHaveLength(series.distance.length);
    expect(series.ride[3]).toHaveLength(series.distance.length);
    expect(series.balance.some((v) => v !== null && v > 0)).toBe(true);
  });

  it('copes with laps saved before chassis channels existed', () => {
    const stored = store.loadLap(sessionId, 3)!;
    const legacy = Object.fromEntries(
      Object.entries(stored.trace).filter(([key]) => !/^(travel|damper|ride|wheel)|^(yawRate|vLat|vLon|vertG|grounded)$/.test(key)),
    );
    const result = analyseChassis([{ summary: stored.summary, trace: legacy as typeof stored.trace }], []);
    expect(Object.values(result.availability).some(Boolean)).toBe(false);
    expect(result.events).toHaveLength(0);
  });
});
