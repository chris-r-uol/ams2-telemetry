import { lapLength, valueAt, type ResampledLap } from './resample.ts';

/** Time difference along the lap: positive means `lap` is slower than `reference` at that point. */
export function deltaTrace(lap: ResampledLap, reference: ResampledLap): number[] {
  const n = Math.min(lap.t.length, reference.t.length);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = lap.t[i] - reference.t[i];
  return out;
}

/** Live delta for the car at `distance` after `lapTime` seconds. */
export function liveDelta(reference: ResampledLap, distance: number, lapTime: number): number | null {
  if (reference.t.length < 2 || distance < 0 || distance > lapLength(reference)) return null;
  return lapTime - valueAt(reference, 't', distance);
}

export function predictedLapTime(
  reference: ResampledLap,
  referenceLapTime: number,
  distance: number,
  lapTime: number,
): number | null {
  const delta = liveDelta(reference, distance, lapTime);
  return delta === null ? null : referenceLapTime + delta;
}
