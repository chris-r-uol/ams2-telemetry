import type { LapTrace } from '../model/types.ts';

export const RESAMPLED_CHANNELS = [
  't',
  'speed',
  'throttle',
  'brake',
  'steering',
  'gear',
  'rpm',
  'x',
  'z',
  'latG',
  'lonG',
  'off',
  'kerb',
  'throttleIn',
] as const;

export type ResampledChannel = (typeof RESAMPLED_CHANNELS)[number];

/** A lap re-expressed on a fixed distance grid, so laps line up point for point. */
export type ResampledLap = { step: number; d: number[] } & Record<ResampledChannel, number[]>;

/** Channels that hold discrete values and must not be interpolated. */
const STEPPED = new Set<ResampledChannel>(['gear', 'off', 'kerb']);

/** Averaged over a moment first: single g samples carry kerb and bump noise, and a 2 m grid would pick them at random. */
const SMOOTHED = new Set<ResampledChannel>(['latG', 'lonG']);

/** Seconds either side that g is averaged over. */
export const G_SMOOTHING = 0.1;

/** Centred moving average over ±`half` seconds. Works for any spacing, as long as time doesn't go backwards. O(n). */
export function smoothInTime(values: number[], t: number[], half: number = G_SMOOTHING): number[] {
  const n = values.length;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + (Number.isFinite(values[i]) ? values[i] : 0);
  const out = new Array<number>(n);
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < n; i++) {
    while (lo < i && t[i] - t[lo] > half) lo++;
    if (hi < i) hi = i;
    while (hi < n - 1 && t[hi + 1] - t[i] <= half) hi++;
    out[i] = (prefix[hi + 1] - prefix[lo]) / (hi - lo + 1);
  }
  return out;
}

export const DEFAULT_STEP_METRES = 2;

/**
 * Resample a time-based trace onto a distance grid (default every 2 m).
 * Samples that go backwards in distance (lap-start glitches, reversing) are ignored.
 */
export function resampleByDistance(trace: LapTrace, step = DEFAULT_STEP_METRES, length?: number): ResampledLap {
  const out = { step, d: [] as number[] } as ResampledLap;
  for (const channel of RESAMPLED_CHANNELS) out[channel] = [];

  const order: number[] = [];
  let lastD = -Infinity;
  for (let i = 0; i < trace.d.length; i++) {
    const d = trace.d[i];
    if (Number.isFinite(d) && d > lastD) {
      order.push(i);
      lastD = d;
    }
  }
  if (order.length < 2) return out;

  const source: Partial<Record<ResampledChannel, number[]>> = {};
  for (const channel of RESAMPLED_CHANNELS) {
    const values = trace[channel];
    source[channel] = SMOOTHED.has(channel) && values?.length === trace.t.length ? smoothInTime(values, trace.t) : values;
  }
  // Laps saved before the pedal itself was recorded: the game's throttle, without its blips while braking.
  if (source.throttleIn?.length !== trace.t.length) {
    source.throttleIn = trace.throttle.map((v, i) => ((trace.brake[i] ?? 0) > 0.1 ? 0 : v));
  }

  const end = length ?? trace.d[order[order.length - 1]];
  const points = Math.floor(end / step) + 1;
  let j = 0;
  for (let p = 0; p < points; p++) {
    const target = p * step;
    while (j < order.length - 2 && trace.d[order[j + 1]] < target) j++;
    const i0 = order[j];
    const i1 = order[j + 1];
    const d0 = trace.d[i0];
    const d1 = trace.d[i1];
    const f = Math.max(0, Math.min(1, (target - d0) / (d1 - d0)));
    out.d.push(target);
    for (const channel of RESAMPLED_CHANNELS) {
      const values = source[channel];
      const a = values?.[i0] ?? 0;
      const b = values?.[i1] ?? 0;
      out[channel].push(STEPPED.has(channel) ? (f < 0.5 ? a : b) : a + (b - a) * f);
    }
  }
  return out;
}

/** Linearly interpolate a channel at an arbitrary distance. */
export function valueAt(lap: ResampledLap, channel: ResampledChannel, distance: number): number {
  const values = lap[channel];
  if (values.length === 0) return NaN;
  const pos = distance / lap.step;
  if (pos <= 0) return values[0];
  if (pos >= values.length - 1) return values[values.length - 1];
  const i = Math.floor(pos);
  const f = pos - i;
  return values[i] + (values[i + 1] - values[i]) * f;
}

export function lapLength(lap: ResampledLap): number {
  return lap.d.length ? lap.d[lap.d.length - 1] : 0;
}

/** Centered moving average with a radius in samples. O(n). */
export function smooth(values: number[], radius: number): number[] {
  if (radius <= 0 || values.length === 0) return values.slice();
  const prefix = new Float64Array(values.length + 1);
  for (let i = 0; i < values.length; i++) prefix[i + 1] = prefix[i] + values[i];
  return values.map((_, i) => {
    const lo = Math.max(0, i - radius);
    const hi = Math.min(values.length - 1, i + radius);
    return (prefix[hi + 1] - prefix[lo]) / (hi - lo + 1);
  });
}
