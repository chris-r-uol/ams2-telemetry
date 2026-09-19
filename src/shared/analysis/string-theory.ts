/**
 * "String theory" for trail braking: imagine a string from the steering wheel to
 * the brake pedal, so turning in pulls the brake off, and one from the wheel to the
 * throttle, so unwinding the lock lets the throttle down. The tyre's grip is shared
 * between turning and braking or accelerating, so as one goes up the other should
 * come down.
 *
 * Plotted as pedal against steering (as a share of the most lock used in the corner),
 * a driver doing that traces the diagonal: full brake at no lock falling to no brake
 * at full lock on the way in, and no throttle at full lock rising to full throttle
 * with the wheel straight on the way out.
 */

type Series = (number | null)[];

export const STRING = {
  brakeOn: 0.1,
  brakeOff: 0.05,
  flatOut: 0.95,
  /** Lock beyond this share counts as "a lot of lock" for heavy braking on the way in. */
  heavyLock: 0.5,
  /** Lock beyond this share counts as "still at full lock" for throttle on the way out. */
  fullLock: 0.8,
  /** Least steering, as a share of full lock, for a corner to be worth reading. */
  minLock: 0.03,
};

export interface StringPoint {
  /** Steering as a share of the most used in the corner, 0..1. */
  steer: number;
  /** Brake on the way in, throttle on the way out, 0..1. */
  pedal: number;
}

export interface StringEntry {
  points: StringPoint[];
  /** Share of the lock on when the brake came fully off: 0 if it was off before turning in, 1 if it stayed on to full lock. */
  brakeOffAt: number;
  /** Most brake used with at least half the lock on. */
  heavyWithLock: number;
  /** Average distance from the string, as a share of full pedal. */
  offString: number;
}

export interface StringExit {
  points: StringPoint[];
  /** Share of the lock still on when the throttle reached flat out; null if not flat out by the exit. */
  flatOutAt: number | null;
  /** Most throttle used with 80% or more of the lock still on. */
  throttleAtLock: number;
  offString: number;
}

export interface StringTheory {
  /** The most steering used, −1..1 scale, as an absolute value. */
  lock: number;
  entry: StringEntry | null;
  exit: StringExit | null;
}

/** Rolling median over five points, so a quick correction isn't read as the corner's lock. */
function smoothed(values: Series): Series {
  return values.map((v, i) => {
    if (v === null) return null;
    const window = values
      .slice(Math.max(0, i - 2), i + 3)
      .filter((w): w is number => w !== null)
      .map(Math.abs)
      .sort((a, b) => a - b);
    return window[Math.floor(window.length / 2)];
  });
}

const offString = (points: StringPoint[], ideal: (steer: number) => number) =>
  points.length ? points.reduce((sum, p) => sum + Math.abs(p.pedal - ideal(p.steer)), 0) / points.length : 0;

/** Trail braking and throttle against steering through one corner, from series sampled along it. */
export function stringTheory(steering: Series, brake: Series, throttle: Series): StringTheory | null {
  const steer = smoothed(steering);
  let lockAt = -1;
  let lock = 0;
  steer.forEach((v, i) => {
    if (v !== null && v > lock) {
      lock = v;
      lockAt = i;
    }
  });
  if (lockAt < 0 || lock < STRING.minLock) return null;
  const share = (i: number) => Math.min(1, (steer[i] ?? 0) / lock);
  const n = steer.length;

  // In: from the first touch of the brake to the most lock.
  let entry: StringEntry | null = null;
  const brakeFrom = brake.findIndex((b, i) => i <= lockAt && b !== null && b >= STRING.brakeOn);
  if (brakeFrom >= 0) {
    const points: StringPoint[] = [];
    let peak = 0;
    let peakAt = brakeFrom;
    for (let i = brakeFrom; i <= lockAt; i++) {
      const b = brake[i];
      if (b === null || steer[i] === null) continue;
      points.push({ steer: share(i), pedal: b });
      if (b > peak) {
        peak = b;
        peakAt = i;
      }
    }
    let offAt = lockAt;
    for (let i = peakAt; i <= lockAt; i++) {
      if ((brake[i] ?? 0) < STRING.brakeOff) {
        offAt = i;
        break;
      }
    }
    const brakeOffAt = (brake[offAt] ?? 0) < STRING.brakeOff ? share(offAt) : 1;
    entry = {
      points,
      brakeOffAt,
      heavyWithLock: Math.max(0, ...points.filter((p) => p.steer >= STRING.heavyLock).map((p) => p.pedal)),
      offString: offString(points, (s) => peak * (1 - s)),
    };
  }

  // Out: from the most lock until flat out with the wheel straight, or the end of the corner.
  const points: StringPoint[] = [];
  let flatOutAt: number | null = null;
  for (let i = lockAt; i < n; i++) {
    const t = throttle[i];
    if (t === null || steer[i] === null) continue;
    const s = share(i);
    points.push({ steer: s, pedal: t });
    if (flatOutAt === null && t >= STRING.flatOut) flatOutAt = s;
    if (t >= STRING.flatOut && s < 0.1) break;
  }
  const exit: StringExit | null = points.length
    ? {
        points,
        flatOutAt,
        throttleAtLock: Math.max(0, ...points.filter((p) => p.steer >= STRING.fullLock).map((p) => p.pedal)),
        offString: offString(points, (s) => 1 - s),
      }
    : null;

  return { lock, entry, exit };
}
