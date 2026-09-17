/**
 * Gearing, track use and pedal technique, on laps built to show each thing.
 */
import { describe, expect, it } from 'vitest';
import type { Corner } from '../src/shared/analysis/corners.ts';
import { analyseGearing, heldGears } from '../src/shared/analysis/gearing.ts';
import { cornerPedals, fullThrottleShare } from '../src/shared/analysis/pedals.ts';
import { resampleByDistance } from '../src/shared/analysis/resample.ts';
import { analyseTrackUse } from '../src/shared/analysis/track-use.ts';
import { emptyTrace, type LapSummary, type LapTrace } from '../src/shared/model/types.ts';

const RATE = 60;
const summary = (lap: number, overrides: Partial<LapSummary> = {}): LapSummary =>
  ({ lap, kind: 'flying', valid: true, lapTime: 60, ...overrides }) as LapSummary;

type Sample = Partial<Record<keyof LapTrace, number>>;

/** A trace from a function of time: each call returns the channels at that moment; distance follows speed. */
function build(seconds: number, at: (t: number) => Sample): LapTrace {
  const trace = emptyTrace();
  let d = 0;
  for (let i = 0; i < seconds * RATE; i++) {
    const t = i / RATE;
    const s = at(t);
    const speed = s.speed ?? 30;
    for (const key of Object.keys(trace) as (keyof LapTrace)[]) {
      if (key === 't') trace.t.push(t);
      else if (key === 'd') trace.d.push(d);
      else trace[key].push(s[key] ?? (key === 'speed' ? speed : 0));
    }
    d += speed / RATE;
  }
  return trace;
}

const corner = (overrides: Partial<Corner>): Corner => ({
  id: 1,
  name: 'T1',
  apex: 200,
  entry: 100,
  exit: 300,
  ranges: [[100, 300]],
  minSpeed: 20,
  direction: 'left',
  ...overrides,
});

describe('gearing', () => {
  const LIMIT = 8000;
  // Accelerating flat out through the gears: each gear spans 10 m/s, and the next gear pulls less.
  const ratio = (gear: number) => 8000 / (10 + gear * 10);
  const accelerate = (shiftAt: number, pullAfter: number) =>
    build(12, (t) => {
      const speed = 12 + t * 4;
      let gear = Math.max(1, Math.min(5, Math.floor((speed - 10) / 10) + 1));
      // Change up at `shiftAt` of the limit rather than at it.
      if ((speed * ratio(gear)) / LIMIT < shiftAt && gear > 1 && (speed * ratio(gear - 1)) / LIMIT < 1) gear--;
      const sinceShift = (speed - 10) % 10;
      return {
        speed,
        gear,
        rpm: speed * ratio(gear),
        throttle: 1,
        lonG: sinceShift < 3 ? pullAfter : 0.4,
      };
    });

  it('keeps the gear held through the neutral blip of a shift', () => {
    const trace = build(1, (t) => ({ gear: t < 0.4 ? 2 : t < 0.46 ? 0 : 3 }));
    const held = heldGears(trace);
    expect(new Set(held)).toEqual(new Set([2, 3]));
    expect(held.filter((g) => g === 0)).toHaveLength(0);
  });

  it('says change up sooner when the next gear pulls harder', () => {
    const laps = [1, 2, 3].map((lap) => ({ summary: summary(lap), trace: accelerate(0.8, 0.6) }));
    const result = analyseGearing(laps, []);
    expect(result.gears.map((g) => g.gear)).toEqual([1, 2, 3, 4, 5]);
    const upshift = result.upshifts.find((u) => u.from === 2)!;
    expect(upshift.count).toBe(3);
    expect(upshift.pullChange).toBeGreaterThan(0.1);
    expect(upshift.verdict).toBe('earlier');
  });

  it('finds the rev limiter holding a gear', () => {
    const trace = build(4, (t) => ({ speed: 50, gear: 4, rpm: t < 1 ? 7000 : LIMIT, throttle: 1 }));
    const lead = build(4, () => ({ speed: 30, gear: 3, rpm: LIMIT * 0.9, throttle: 1 }));
    const result = analyseGearing([{ summary: summary(1), trace }, { summary: summary(2), trace: lead }], [corner({ entry: 500 })]);
    expect(result.limiterHits).toHaveLength(1);
    expect(result.limiterHits[0]).toMatchObject({ lap: 1, gear: 4, before: 'T1' });
    expect(result.limiterHits[0].seconds).toBeGreaterThan(2.5);
  });

  it('flags downshifts that rev past the limit', () => {
    const trace = build(3, (t) => ({
      speed: 30,
      brake: 1,
      gear: t < 1 ? 4 : 3,
      rpm: t < 1 ? 7000 : t < 1.2 ? LIMIT * 1.05 : 7500,
      throttle: 0,
    }));
    const flat = build(5, () => ({ throttle: 1, rpm: LIMIT, gear: 2 }));
    const result = analyseGearing([{ summary: summary(1), trace }, { summary: summary(2), trace: flat }], []);
    expect(result.downshifts).toEqual([expect.objectContaining({ from: 4, to: 3, count: 1, overRevs: 1 })]);
  });
});

describe('track use', () => {
  // A left-hand arc of radius 100 m. Laps run at an offset from the middle (+ is left, towards the inside).
  const arc = (offset: (d: number) => number, kerb: (d: number) => number = () => 0): LapTrace =>
    build(400 / 30, (t) => {
      const d = t * 30;
      const angle = d / 100;
      const r = 100 - offset(d);
      return { speed: 30, x: r * Math.cos(angle), z: r * Math.sin(angle), latG: 0.9, kerb: kerb(d) };
    });
  const T1 = corner({ entry: 60, apex: 200, exit: 340 });

  it('measures how far from the kerb each lap stayed', () => {
    const reference = arc(() => 0);
    // Lap 2 touches the inside kerb (left wheels) 3 m inside the reference line at the apex.
    const onKerb = arc(
      (d) => (Math.abs(d - 200) < 15 ? 3 : 0),
      (d) => (Math.abs(d - 200) < 5 ? 1 | 4 : 0),
    );
    const laps = [
      { summary: summary(1), trace: reference },
      { summary: summary(2), trace: onKerb },
    ];
    const result = analyseTrackUse(laps, [T1], 1, new Map([[1, 1]]));
    const apex = result.corners[0].apex!;
    expect(apex.side).toBe('left');
    expect(apex.kerbLaps).toBe(1);
    expect(apex.best?.kerb).toBe(false);
    expect(apex.best?.gap).toBeCloseTo(3, 0);
    expect(result.corners[0].turnIn?.side).toBe('right');
  });

  it("can't measure laps saved before kerb contact was recorded", () => {
    const old = arc(() => 0);
    (old as Partial<LapTrace>).kerb = undefined;
    expect(analyseTrackUse([{ summary: summary(1), trace: old }], [T1], 1).lapsAnalysed).toBe(0);
  });
});

describe('pedal technique', () => {
  const T1 = corner({ entry: 0, apex: 200, exit: 400 });
  // Brake from 1 s: full within 0.2 s, held, then eased off from 3 s to 4 s while turning in from 3.2 s.
  // Throttle picked up at 5 s, backed off once, flat out at 6.5 s.
  const lap = resampleByDistance(
    build(12, (t) => ({
      speed: 40,
      brake: t < 1 ? 0 : t < 1.2 ? (t - 1) / 0.2 : t < 3 ? 1 : t < 4 ? 1 - (t - 3) : 0,
      throttle: t > 3 && t < 4 ? 0.8 : 0,
      throttleIn: t < 5 ? 0 : t < 5.5 ? 0.5 : t < 5.8 ? 0.3 : t < 6.5 ? 0.7 : 1,
      steering: t < 3.2 ? 0 : t < 5 ? -0.3 : 0.1,
    })),
  );

  it('times the brake application, release and trail', () => {
    const p = cornerPedals(lap, T1, 0);
    // At 90% of the peak by 1.18 s; below 90% from 3.1 s and off (under 5%) at 3.95 s; turned in at 3.2 s.
    expect(p.brake!.toPeak).toBeCloseTo(0.18, 1);
    expect(p.brake!.release).toBeCloseTo(0.85, 1);
    expect(p.brake!.trail).toBeCloseTo(0.75, 1);
    expect(p.brake!.reapplied).toBe(0);
  });

  it("reads the pedal, not the game's blip, and finds the hesitation", () => {
    const p = cornerPedals(lap, T1, 0);
    expect(p.throttle.pickup).toBeGreaterThan(40 * 5 - 5);
    expect(p.throttle.toFull).toBeCloseTo(1.5, 1);
    expect(p.throttle.hesitations).toBe(1);
    expect(fullThrottleShare(lap)).toBeCloseTo(5.5 / 12, 1);
  });
});
