import { lapLength, smooth, valueAt, type ResampledLap } from './resample.ts';

export interface Corner {
  /** 1-based, in lap order. */
  id: number;
  name: string;
  /** Distance of minimum speed on the reference lap, metres. */
  apex: number;
  /** Where the corner's segment begins (just before braking), metres. */
  entry: number;
  /** Where exit speed is measured, metres. */
  exit: number;
  /** Distance ranges that make up this corner's timing segment. They tile the whole lap. */
  ranges: [number, number][];
  minSpeed: number;
  direction: 'left' | 'right' | null;
}

export interface CornerDetectionOptions {
  /** Minimum speed drop into a corner to count it, m/s. Default ~9 km/h. */
  minDrop?: number;
  /** Half-width of the local-minimum window, metres. */
  window?: number;
}

const BRAKE_ON = 0.1;

/**
 * Find corners on a reference lap by looking for significant local minima in
 * speed. Flat-out kinks are ignored on purpose: there's nothing to coach there.
 */
export function detectCorners(reference: ResampledLap, options: CornerDetectionOptions = {}): Corner[] {
  const n = reference.speed.length;
  const step = reference.step;
  const length = lapLength(reference);
  if (n < 50) return [];

  const minDrop = options.minDrop ?? 2.5;
  const win = Math.max(1, Math.round((options.window ?? 60) / step));
  const lookBack = Math.round(500 / step);
  const lookAhead = Math.round(300 / step);
  const speed = smooth(reference.speed, Math.round(8 / step));

  let apexes: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    let isMin = true;
    for (let k = Math.max(0, i - win); k <= Math.min(n - 1, i + win); k++) {
      if (speed[k] < speed[i] || (speed[k] === speed[i] && k < i)) {
        isMin = false;
        break;
      }
    }
    if (!isMin) continue;
    const before = maxIn(speed, Math.max(0, i - lookBack), i);
    const after = maxIn(speed, i, Math.min(n - 1, i + lookAhead));
    if (before - speed[i] >= minDrop && after - speed[i] >= minDrop * 0.5) apexes.push(i);
  }

  // Merge dips that never recover in between (one corner with two slow points).
  apexes = apexes.reduce<number[]>((kept, i) => {
    const prev = kept[kept.length - 1];
    if (prev !== undefined && maxIn(speed, prev, i) - Math.max(speed[prev], speed[i]) < minDrop * 0.5) {
      if (speed[i] < speed[prev]) kept[kept.length - 1] = i;
      return kept;
    }
    kept.push(i);
    return kept;
  }, []);

  if (apexes.length === 0) return [];

  // Segment boundaries: shortly before each corner's braking point.
  const boundaries = apexes.map((apex, k) => {
    const prevApex = k === 0 ? 0 : apexes[k - 1];
    const peak = argMaxIn(speed, prevApex, apex);
    let brake = -1;
    for (let i = peak; i <= apex; i++) {
      if (reference.brake[i] > BRAKE_ON) {
        brake = i;
        break;
      }
    }
    const anchor = brake >= 0 ? brake : peak;
    const boundary = Math.max(k === 0 ? 0 : prevApex + 1, anchor - Math.round(30 / step));
    return boundary * step;
  });

  return apexes.map((apexIndex, k) => {
    const entry = boundaries[k];
    const nextBoundary = k < apexes.length - 1 ? boundaries[k + 1] : length;
    const ranges: [number, number][] =
      k < apexes.length - 1
        ? [[entry, nextBoundary]]
        : boundaries[0] > 0
          ? [
              [entry, length],
              [0, boundaries[0]],
            ]
          : [[entry, length]];
    const apex = apexIndex * step;
    const steer = meanIn(reference.steering, apexIndex - Math.round(20 / step), apexIndex + Math.round(20 / step));
    return {
      id: k + 1,
      name: `T${k + 1}`,
      apex,
      entry,
      exit: Math.min(apex + 120, Math.max(apex + step, nextBoundary - step)),
      ranges,
      minSpeed: valueAt(reference, 'speed', apex),
      direction: Math.abs(steer) < 0.02 ? null : steer < 0 ? 'left' : 'right',
    };
  });
}

function maxIn(values: number[], from: number, to: number): number {
  let max = -Infinity;
  for (let i = Math.max(0, from); i <= Math.min(values.length - 1, to); i++) max = Math.max(max, values[i]);
  return max;
}

function argMaxIn(values: number[], from: number, to: number): number {
  let best = from;
  for (let i = from; i <= to; i++) if (values[i] > values[best]) best = i;
  return best;
}

function meanIn(values: number[], from: number, to: number): number {
  const lo = Math.max(0, from);
  const hi = Math.min(values.length - 1, to);
  let sum = 0;
  for (let i = lo; i <= hi; i++) sum += values[i];
  return hi >= lo ? sum / (hi - lo + 1) : 0;
}
