/**
 * Stints: finding the breaks in a session, the figures for each run, and each
 * stint's setup analysis measured on the session's yardstick.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AnalysisService } from '../src/server/analysis-service.ts';
import { DemoSimulator } from '../src/server/demo/simulator.ts';
import { SessionManager } from '../src/server/session-manager.ts';
import { SessionStore } from '../src/server/storage.ts';
import { TelemetryHub, type Tick } from '../src/server/telemetry/hub.ts';
import { LapBuilder } from '../src/server/telemetry/lap-builder.ts';
import { detectStints, summariseStints } from '../src/shared/analysis/stints.ts';
import type { LapSummary, SessionMeta } from '../src/shared/model/types.ts';
import { PacketType, type PitMode } from '../src/shared/protocol/constants.ts';
import { encodeGameState, packGameState } from '../src/shared/protocol/encode.ts';

type LapSpec = Partial<LapSummary> & {
  /** Seconds unaccounted for before the lap starts. */
  idle?: number;
};

type Tyres = Pick<LapSummary, 'tyreTempAvg' | 'tyreWear'>;
const WARM: Tyres = { tyreTempAvg: [80, 78, 82, 80], tyreWear: [0.03, 0.03, 0.03, 0.03] };
const FRESH: Tyres = { tyreTempAvg: [55, 54, 57, 56], tyreWear: [0, 0, 0, 0] };

/** Laps back to back: each starts when the one before ended, plus any `idle` seconds. */
function laps(specs: LapSpec[]): LapSummary[] {
  let at = 1_000_000;
  let number = 0;
  return specs.map(({ idle = 0, ...overrides }) => {
    at += idle * 1000;
    const summary: LapSummary = {
      lap: number + 1,
      lapTime: 90,
      sectors: [30, 30, 30],
      valid: true,
      kind: 'flying',
      startedAt: at,
      topSpeed: 70,
      fuelUsed: 2.5,
      tyreTempAvg: [...WARM.tyreTempAvg],
      tyrePressureAvg: [190, 190, 195, 195],
      tyreWear: [...WARM.tyreWear],
      offTrackCount: 0,
      sampleCount: 5400,
      ...overrides,
    };
    number = summary.lap;
    at += (summary.lapTime ?? 0) * 1000;
    return summary;
  });
}

const ranges = (list: LapSummary[]) => detectStints(list).map((s) => [s.first, s.last]);

describe('finding stints', () => {
  it('starts a stint at every out lap', () => {
    expect(ranges(laps([{ kind: 'out' }, {}, {}, { kind: 'out', idle: 90 }, {}]))).toEqual([
      [0, 2],
      [3, 4],
    ]);
  });

  it('ends a stint with the in lap', () => {
    expect(ranges(laps([{}, {}, { kind: 'in' }, {}, {}]))).toEqual([
      [0, 2],
      [3, 4],
    ]);
  });

  it('keeps a stint together when its first lap, from the garage, was labelled an in lap', () => {
    // The lap after it has time unaccounted for too (sat in the garage), but not fresher tyres.
    const session = laps([{}, {}, { kind: 'in', idle: 28, ...FRESH }, { idle: 190, tyreTempAvg: [70, 68, 72, 70], tyreWear: [0.01, 0.01, 0.01, 0.01] }, {}]);
    expect(ranges(session)).toEqual([
      [0, 1],
      [2, 4],
    ]);
  });

  it("finds a break the game didn't label, from the gap and the fresh tyres", () => {
    expect(ranges(laps([{}, {}, {}, { idle: 66, ...FRESH }, {}]))).toEqual([
      [0, 2],
      [3, 4],
    ]);
  });

  it("doesn't split at a pause: the tyres come back as they were", () => {
    expect(ranges(laps([{}, {}, { idle: 240 }, {}]))).toEqual([[0, 3]]);
  });

  it('starts a stint when the lap count goes back', () => {
    expect(ranges(laps([{}, {}, {}, { lap: 1 }, {}]))).toEqual([
      [0, 2],
      [3, 4],
    ]);
  });

  it('has nothing to say about a session with no laps', () => {
    expect(detectStints([])).toEqual([]);
  });
});

describe('figures for a stint', () => {
  const [first, second] = summariseStints(
    laps([
      { kind: 'out', lapTime: 120 },
      { lapTime: 91, topSpeed: 71 },
      { lapTime: 90, topSpeed: 72, sectors: [29.5, 30.5, 30] },
      { lapTime: 100, topSpeed: 60 },
      { lapTime: 90.4, topSpeed: 73 },
      { lapTime: 89, valid: false },
      { kind: 'out', lapTime: 118, idle: 200, ...FRESH },
      { lapTime: 89.2 },
    ]),
  );

  it('takes the pace from clean laps close to the best, not the warm-up or the mistake', () => {
    expect(first.laps).toEqual([1, 2, 3, 4, 5, 6]);
    expect(first.cleanLaps).toBe(4);
    expect(first.paceLaps).toBe(3);
    expect(first.bestLap).toEqual({ lap: 3, time: 90 });
    expect(first.typicalLap).toBe(90.4);
    expect(first.spread).toBeCloseTo(0.503, 2);
    expect(first.bestSectors).toEqual([29.5, 30, 30]);
  });

  it('gives typical running figures, by wheel for the tyres', () => {
    expect(first.topSpeed).toBe(71.5);
    expect(first.fuelPerLap).toBe(2.5);
    expect(first.tyreTemp).toEqual([80, 78, 82, 80]);
    expect(first.tyrePressure).toEqual([190, 190, 195, 195]);
  });

  it('handles a stint with one clean lap', () => {
    expect(second.laps).toEqual([7, 8]);
    expect(second.bestLap?.time).toBe(89.2);
    expect(second.typicalLap).toBe(89.2);
    expect(second.spread).toBeNull();
  });
});

describe('the lap that leaves the garage', () => {
  const tick = (lap: number, lapTime: number, lapDistance: number, pitMode: PitMode = 'none') =>
    ({
      at: 0,
      lap,
      lapTime,
      lapDistance,
      sector: 1,
      lapInvalidated: false,
      pitMode,
      speed: 40,
      fuelLitres: 30,
      offWheels: 0,
      tyreTempC: [60, 60, 60, 60],
      tyrePressureKPa: [180, 180, 180, 180],
      tyreWear: [0, 0, 0, 0],
      suspensionTravel: [0, 0, 0, 0],
      damperVelocity: [0, 0, 0, 0],
      rideHeight: [0, 0, 0, 0],
      wheelRps: [0, 0, 0, 0],
    }) as unknown as Tick;

  /** Drive a lap that passes through these pit modes, and return how it was labelled. */
  function kindOf(modes: [number, PitMode][]): string | undefined {
    const builder = new LapBuilder();
    builder.trackLength = 4000;
    for (let t = 0; t < 80; t += 0.5) {
      const mode = modes.findLast(([from]) => t >= from)?.[1] ?? 'none';
      builder.push(tick(5, t, Math.min(3999, t * 50), mode));
    }
    let done = null;
    for (let t = 0; t < 2 && !done; t += 0.25) done = builder.push(tick(6, t, t * 50));
    return done?.summary.kind;
  }

  it('is an out lap when the car is put in the garage just after the lap began', () => {
    expect(kindOf([[0.5, 'inGarage'], [20, 'drivingOutOfGarage'], [30, 'none']])).toBe('out');
  });

  it('is still an in lap when the car reaches the garage at the end of it', () => {
    expect(kindOf([[60, 'drivingIntoPits'], [70, 'inGarage']])).toBe('in');
  });
});

describe('a session with three setups', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ams2-coach-stints-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const hub = new TelemetryHub();
  const store = new SessionStore(dir);
  const analysis = new AnalysisService(store);
  const manager = new SessionManager(hub, store, analysis, 'demo');
  // Four-lap stints: an out lap, then three flying laps on each setup.
  const demo = new DemoSimulator((bytes) => hub.ingest(bytes), { seed: 11, stintLaps: 4 });
  demo.runLaps(12);
  demo.runFor(2);
  const id = manager.session!.id;
  const result = analysis.stints(id)!;
  const [base, wing, soft] = result.stints;

  it('splits into a stint for each visit to the garage', () => {
    expect(result.stints.map((s) => s.laps)).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7, 8],
      [9, 10, 11, 12],
    ]);
    expect(result.stints.every((s) => s.cleanLaps === 3 && s.bestLap !== null)).toBe(true);
  });

  it('gives each stint its pace and its ideal lap', () => {
    for (const stint of result.stints) {
      expect(stint.typicalLap!).toBeGreaterThanOrEqual(stint.bestLap!.time);
      expect(stint.idealLapTime!).toBeLessThanOrEqual(stint.bestLap!.time);
    }
  });

  it('measures every corner in every stint, adding up to about a typical lap', () => {
    expect(result.corners.length).toBeGreaterThan(5);
    for (const stint of result.stints) {
      expect(stint.corners.map((c) => c.corner)).toEqual(result.corners.map((c) => c.name));
      expect(stint.corners.every((c) => c.runs === stint.paceLaps && c.typicalTime! > 0 && c.minSpeed! > 0)).toBe(true);
      const total = stint.corners.reduce((sum, c) => sum + c.typicalTime!, 0);
      expect(Math.abs(total - stint.typicalLap!)).toBeLessThan(1);
    }
  });

  it('shows the wing costing speed on the straights', () => {
    expect(wing.topSpeed!).toBeLessThan(base.topSpeed! - 0.5);
  });

  it('measures each stint on the session’s calibration, so more push reads as more understeer', () => {
    const whole = analysis.chassis(id)!.analysis;
    const push = (stint: number) => {
      const chassis = analysis.chassis(id, stint)!.analysis;
      expect(chassis.calibration).toEqual(whole.calibration);
      const ratios = chassis.corners.map((c) => c.mid.ratio).filter((r): r is number => r !== null);
      return ratios.reduce((a, b) => a + b, 0) / ratios.length;
    };
    expect(analysis.chassis(id, 2)!.analysis.lapsAnalysed).toBe(4);
    expect(push(2)).toBeGreaterThan(push(1) + 0.03);
    expect(push(3)).toBeLessThan(push(1) - 0.03);
  });

  it('shows the stiffer anti-roll bars as less roll', () => {
    const roll = (stint: number) => analysis.chassis(id, stint)!.analysis.platform.frontRollPerG!;
    expect(roll(3)).toBeLessThan(roll(1) * 0.9);
  });

  it('narrows the other setup analyses to a stint too', () => {
    expect(analysis.insights(id, 2)!.insights.lapsAnalysed).toBe(3);
    expect(analysis.insights(id, 2)!.corners).toEqual(result.corners);
    expect(analysis.grip(id, 2)!.lapsAnalysed).toBe(3);
    expect(analysis.grip(id, 2)!.envelope).toEqual(analysis.grip(id)!.envelope);
    expect(analysis.gearing(id, 2)).not.toBeNull();
    expect(analysis.trackUse(id, 2)).not.toBeNull();
    expect(analysis.chassis(id, 4)).toBeNull();
  });

  it('keeps a note of what changed before a stint', () => {
    expect(manager.setStintNote(id, 4, 'Rear wing +2')!.stintNotes).toEqual({ 4: 'Rear wing +2' });
    expect(new SessionStore(dir).get(id)!.stintNotes).toEqual({ 4: 'Rear wing +2' });
    // Lap 3 doesn't start a stint.
    expect(manager.setStintNote(id, 2, 'nope')).toBeNull();
    expect(manager.setStintNote(id, 4, '')!.stintNotes).toBeUndefined();
  });
});

describe('restarting the session from the menu', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ams2-coach-restart-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const hub = new TelemetryHub();
  const store = new SessionStore(dir);
  const manager = new SessionManager(hub, store, new AnalysisService(store), 'demo');
  const sessions: SessionMeta[] = [];
  manager.onSession((session) => {
    if (!sessions.some((s) => s.id === session.id)) sessions.push(session);
  });

  const first = new DemoSimulator((bytes) => hub.ingest(bytes), { seed: 3 });
  first.runLaps(3);
  first.runFor(2); // let the final lap settle
  const firstId = manager.session!.id;

  // Back to the menus, where the game already counts from lap 1 again, then out on track.
  let inMenus = true;
  hub.ingest(encodeGameState({ packetNumber: 1, categoryPacketNumber: 1 }, { gameState: packGameState(1, 1) }));
  const again = new DemoSimulator((bytes) => {
    if (inMenus && bytes[10] === PacketType.GameState) return;
    hub.ingest(bytes);
  }, { seed: 4 });
  again.runFor(3);
  inMenus = false;
  again.runLaps(2);
  again.runFor(2);

  it('starts a new session instead of writing over the first laps', () => {
    expect(sessions).toHaveLength(2);
    expect(manager.session!.id).not.toBe(firstId);
    expect(manager.session!.laps.map((l) => l.lap)).toEqual([1, 2]);
    expect(store.get(firstId)!.laps.map((l) => l.lap)).toEqual([1, 2, 3]);
  });

  it('leaves the first session’s telemetry as it was driven', () => {
    const before = store.get(firstId)!.laps[1];
    const stored = store.loadLap(firstId, 2)!;
    expect(stored.summary.lapTime).toBe(before.lapTime);
    expect(stored.trace.t.length).toBe(before.sampleCount);
  });
});
