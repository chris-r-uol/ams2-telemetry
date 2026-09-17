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
import { analyseChassis, calibrate, type ChassisEvent, type ChassisEventKind } from '../src/shared/analysis/chassis.ts';

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
    expect(a.calibration.steerPerG).not.toBeNull();
    expect(a.calibration.wheelSpeedUnit).toBe('rad/s');
    for (const radius of a.calibration.wheelRadius) expect(radius!).toBeCloseTo(0.33, 2);
  });

  it('reads wheel speed sent as revolutions per second too', () => {
    const laps = [3, 4, 5].map((n) => store.loadLap(sessionId, n)!);
    const perRevolution = 1 / (2 * Math.PI);
    const asRevolutions = laps.map((lap) => ({
      summary: lap.summary,
      trace: {
        ...lap.trace,
        wheelFL: lap.trace.wheelFL.map((v) => v * perRevolution),
        wheelFR: lap.trace.wheelFR.map((v) => v * perRevolution),
        wheelRL: lap.trace.wheelRL.map((v) => v * perRevolution),
        wheelRR: lap.trace.wheelRR.map((v) => v * perRevolution),
      },
    }));
    const { calibration } = calibrate(asRevolutions);
    expect(calibration.wheelSpeedUnit).toBe('rev/s');
    for (const radius of calibration.wheelRadius) expect(radius!).toBeCloseTo(0.33, 2);
  });

  it("doesn't mistake a wheel's shorter path through a corner for a lock-up", () => {
    // The demo's wheels all turn at the car's speed. Real outside wheels travel further: give it a 1.5 m track.
    const halfTrack = 0.75;
    const withPaths = manager.session!.laps.map((summary) => {
      const { trace } = store.loadLap(sessionId, summary.lap)!;
      const path = (side: number) => (value: number, i: number) =>
        trace.speed[i] > 1 ? (value * Math.max(0, trace.speed[i] + side * trace.yawRate[i] * halfTrack)) / trace.speed[i] : value;
      return {
        summary,
        trace: {
          ...trace,
          wheelFL: trace.wheelFL.map(path(-1)),
          wheelFR: trace.wheelFR.map(path(1)),
          wheelRL: trace.wheelRL.map(path(-1)),
          wheelRR: trace.wheelRR.map(path(1)),
        },
      };
    });
    const result = analyseChassis(withPaths, detected);
    expect(result.calibration.trackWidth!).toBeCloseTo(1.5, 1);
    const count = (events: ChassisEvent[], kind: ChassisEventKind) => events.filter((e) => e.kind === kind).length;
    expect(count(result.events, 'lock-up')).toBe(count(a.events, 'lock-up'));
    expect(count(result.events, 'wheelspin')).toBe(count(a.events, 'wheelspin'));
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

  it('maps balance by speed and pedal, and the rear wheels through corners', () => {
    const h = a.handling;
    expect(h.grid).toHaveLength(4);
    expect(h.grid.every((row) => row.length === h.bands.length)).toBe(true);
    // The demo's slow corners understeer, most of all trailing the brake; the fast ones don't.
    expect(h.bySpeed[0].ratio!).toBeGreaterThan(h.bySpeed[2].ratio! + 0.05);
    expect(h.grid[0][0].verdict).toBe('understeer');
    expect(h.bandCorners.flat().length).toBe(detected.length);
    expect(h.rearSlip.power).not.toBeNull();
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

  it('leaves out contact and says so, instead of counting it as a setup problem', () => {
    const laps = manager.session!.laps.map((summary) => store.loadLap(sessionId, summary.lap)!);
    const hitAt = apexOf(demo.habits.lateBraking) - 120;
    const nearHit = (e: ChassisEvent) => Math.abs(e.distance - hitAt) < 150;
    const perLap = new Map<number, number>();
    for (const e of a.events) if (nearHit(e)) perLap.set(e.lap, (perLap.get(e.lap) ?? 0) + 1);
    const [target] = [...perLap.entries()].sort((x, y) => y[1] - x[1])[0];

    const trace = laps.find((lap) => lap.summary.lap === target)!.trace;
    const i = trace.d.findIndex((d) => d >= hitAt);
    for (let j = i; j < i + 3; j++) trace.latG[j] = 25;
    const from = trace.d[trace.t.findIndex((t) => t >= trace.t[i] - 1)];
    const to = trace.d[trace.t.findIndex((t) => t >= trace.t[i] + 3)];
    const inWindow = (e: ChassisEvent) => e.lap === target && e.distance >= from && e.distance <= to;
    expect(a.events.some(inWindow)).toBe(true);

    const result = analyseChassis(laps, detected);
    expect(result.incidents.filter((x) => x.lap === target)).toHaveLength(1);
    expect(result.events.some(inWindow)).toBe(false);
  });
});
