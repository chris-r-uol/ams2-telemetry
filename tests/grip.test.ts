/**
 * Grip used: the limit learned from your own laps, the friction ellipse between
 * braking and cornering, and what does and doesn't count against you.
 */
import { describe, expect, it } from 'vitest';
import {
  directionChanges,
  GRIP,
  gripEnvelope,
  gripLimit,
  gripRun,
  lateralLimit,
  type GripSamples,
} from '../src/shared/analysis/grip.ts';
import { resampleByDistance } from '../src/shared/analysis/resample.ts';
import { emptyTrace, type LapTrace } from '../src/shared/model/types.ts';

const RATE = 60;

/** A trace built from stretches of steady driving: seconds, speed, lateral and fore-aft g, pedals. */
function drive(stretches: { s: number; v: number; lat?: number; lon?: number; throttle?: number; brake?: number }[]): LapTrace {
  const trace = emptyTrace();
  let t = 0;
  let d = 0;
  for (const part of stretches) {
    for (let i = 0; i < Math.round(part.s * RATE); i++) {
      trace.t.push(t);
      trace.d.push(d);
      trace.speed.push(part.v);
      trace.latG.push(part.lat ?? 0);
      trace.lonG.push(part.lon ?? 0);
      trace.throttle.push(part.throttle ?? 0);
      trace.brake.push(part.brake ?? 0);
      t += 1 / RATE;
      d += part.v / RATE;
    }
  }
  return trace;
}

function samplesOf(trace: LapTrace): GripSamples {
  const { d, t, speed, throttle, brake, latG, lonG } = trace;
  return { d, t, speed, throttle, brake, latG, lonG };
}

describe('grip limit', () => {
  const lap = drive([
    { s: 5, v: 25, lat: 1.5 }, // slow corner, band 2
    { s: 5, v: 55, lat: -2.2 }, // fast corner, band 5
    { s: 5, v: 65, lon: -2.4, brake: 1 }, // hard braking, band 6
    { s: 5, v: 85, lat: 0.5, throttle: 1 }, // flat-out kink, band 8
    { s: 5, v: 35, lon: 0.9, throttle: 1 }, // accelerating, band 3
  ]);
  const envelope = gripEnvelope([lap])!;

  it('takes each speed band from your own driving', () => {
    expect(envelope.lateral[2]).toBeCloseTo(1.5, 5);
    expect(envelope.lateral[5]).toBeCloseTo(2.2, 5);
    expect(envelope.braking[6]).toBeCloseTo(2.4, 5);
    expect(envelope.accelerating[3]).toBeCloseTo(0.9, 5);
  });

  it("carries grip up to faster speeds, so a flat-out kink doesn't lower the limit", () => {
    expect(envelope.lateral[8]).toBeCloseTo(2.2, 5);
    expect(envelope.lateral[3]).toBeCloseTo(1.5, 5);
  });

  it('assumes braking grips like cornering below any hard braking seen', () => {
    expect(envelope.braking[2]).toBeCloseTo(1.5, 5);
  });

  it('limits combined braking and turning with the friction ellipse', () => {
    const speed = 5.5 * GRIP.band; // centre of band 5
    const angle = Math.PI / 4;
    const expected = 1 / Math.hypot(Math.sin(angle) / 2.2, Math.cos(angle) / envelope.braking[5]!);
    expect(gripLimit(envelope, -1, -1, speed)).toBeCloseTo(expected, 5);
    expect(gripLimit(envelope, 2, 0, speed)).toBeCloseTo(2.2, 5);
  });

  it('leaves out spins and contact', () => {
    const crash = drive([
      { s: 5, v: 25, lat: 1.5 },
      { s: 3, v: 25, lat: 6 },
    ]);
    const mask = crash.t.map((_, i) => i >= 5 * RATE);
    expect(lateralLimit(gripEnvelope([crash], [mask])!, 25)).toBeCloseTo(1.5, 5);
    expect(lateralLimit(gripEnvelope([crash])!, 25)).toBeGreaterThan(5);
  });
});

describe('grip used', () => {
  const envelope = gripEnvelope([
    drive([
      { s: 5, v: 25, lat: 2 },
      { s: 5, v: 25, lon: -2, brake: 1 },
      { s: 5, v: 25, lon: 1, throttle: 1 },
    ]),
  ])!;

  it('finds a quick change of direction but not a slow unwind', () => {
    const quick = drive([
      { s: 1, v: 25, lat: 1.8 },
      { s: 0.2, v: 25, lat: 0.4 },
      { s: 0.2, v: 25, lat: -0.4 },
      { s: 1, v: 25, lat: -1.8 },
    ]);
    const changing = directionChanges(envelope, quick);
    expect(changing.slice(RATE, RATE * 1.4).every(Boolean)).toBe(true);
    expect(changing.filter(Boolean)).toHaveLength(Math.round(RATE * 0.4));

    const slow = drive([
      { s: 1, v: 25, lat: 1.8 },
      { s: 3, v: 25, lat: 0.2 },
      { s: 1, v: 25, lat: -1.8 },
    ]);
    expect(directionChanges(envelope, slow).some(Boolean)).toBe(false);
  });

  it("doesn't count flat out, and finds where the most grip was left", () => {
    const run = drive([
      { s: 1, v: 25, throttle: 1, lon: 0.3 }, // flat out: not counted
      { s: 1, v: 25, lon: -1.8, brake: 1 }, // 90%
      { s: 1, v: 25, lat: 1.2 }, // off the pedals at 60%
      { s: 1, v: 25, lat: 1.9, throttle: 0.4 }, // 95%
    ]);
    const result = gripRun(envelope, samplesOf(run));
    expect(result.skip.slice(0, RATE).every((s) => s === 'flat-out')).toBe(true);
    expect(result.use[RATE + 10]).toBeCloseTo(0.9, 5);
    expect(result.lat[2 * RATE + 10]).toBeCloseTo(0.6, 5);

    const { summary } = result;
    expect(summary.braking.use).toBeCloseTo(0.9, 2);
    expect(summary.coasting.use).toBeCloseTo(0.6, 2);
    expect(summary.coasting.seconds).toBeCloseTo(1, 1);
    expect(summary.use).toBeCloseTo((0.9 + 0.6 + 0.95) / 3, 2);
    expect(summary.gap?.phase).toBe('coasting');
    expect(summary.gap?.use).toBeCloseTo(0.6, 2);
    expect(summary.gap!.from).toBeCloseTo(2 * 25, 0);
    expect(summary.gap!.to).toBeGreaterThan(3 * 25 - 1);
  });

  it('skips points marked as contact', () => {
    const run = drive([{ s: 1, v: 25, lat: 1 }]);
    const result = gripRun(envelope, samplesOf(run), run.t.map(() => true));
    expect(result.skip.every((s) => s === 'incident')).toBe(true);
    expect(result.summary.use).toBeNull();
  });
});

describe('resampling g', () => {
  it('averages over a moment, so one bump sample is not taken as the value at that point', () => {
    const trace = drive([{ s: 2, v: 30, lat: 1 }]);
    trace.latG[60] = 4;
    const resampled = resampleByDistance(trace, 0.5);
    const peak = Math.max(...resampled.latG);
    expect(peak).toBeLessThan(1.4);
    expect(peak).toBeGreaterThan(1);
  });
});
