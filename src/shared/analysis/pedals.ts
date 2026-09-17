/**
 * How you use the pedals through a corner, not just where: how quickly the brake
 * reaches its peak, how gradually it comes off and how far it trails past turn-in;
 * how long from picking up the throttle to flat out, and whether it wavers, is fed
 * in while still adding steering, or lifts again before the exit.
 *
 * Uses the throttle pedal itself, so the game's own blips on downshifts don't count.
 */
import type { Corner } from './corners.ts';
import type { ResampledLap } from './resample.ts';

export const PEDALS = {
  brakeOn: 0.1,
  brakeOff: 0.05,
  /** Share of peak pressure that counts as at the peak. */
  atPeak: 0.9,
  /** Pressing harder again by this much while coming off the brake counts as re-applying. */
  reapply: 0.1,
  pickup: 0.25,
  full: 0.95,
  /** Backing off by this much from the most throttle so far counts as a hesitation. */
  hesitation: 0.15,
  /** Dropping below this after flat out counts as a lift. */
  lift: 0.85,
  /** Turn-in: steering reaches this share of the most used before the apex. */
  turnIn: 0.4,
  /** Braking this far past the apex still belongs to the corner, m. */
  pastApex: 50,
};

export interface BrakeTechnique {
  /** Where braking started, m. */
  start: number;
  /** Most pedal pressure, 0..1. */
  peak: number;
  /** Seconds from first touching the brake to 90% of the peak. */
  toPeak: number;
  /** Seconds from leaving 90% of the peak to fully off. */
  release: number;
  /** Where the brake came fully off, m. */
  off: number;
  /** Seconds still braking after turning in; negative when the brake was off that long before turning in. */
  trail: number | null;
  /** Times the pedal was pressed harder again on the way off it. */
  reapplied: number;
}

export interface ThrottleTechnique {
  /** Where the throttle was picked up after braking, m. */
  pickup: number | null;
  /** Seconds from pickup to flat out; null if not flat out by the exit. */
  toFull: number | null;
  /** Times the throttle was backed off before reaching flat out. */
  hesitations: number;
  /** Seconds feeding in throttle while still adding steering. */
  withLock: number;
  /** Lifts after reaching flat out, before the exit. */
  lifts: number;
}

export interface PedalTechnique {
  /** Where the steering turned in, m. */
  turnIn: number | null;
  /** Null when the corner was taken without braking. */
  brake: BrakeTechnique | null;
  throttle: ThrottleTechnique;
}

/** Centred moving average over ±radius points. */
function smoothed(values: number[], from: number, to: number, radius: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i++) {
    let sum = 0;
    let n = 0;
    for (let k = Math.max(from, i - radius); k <= Math.min(to, i + radius); k++) {
      sum += values[k];
      n++;
    }
    out.push(sum / n);
  }
  return out;
}

/** Pedal technique through one corner, from `from` metres to the corner's exit. */
export function cornerPedals(lap: ResampledLap, corner: Corner, from: number): PedalTechnique {
  const last = lap.d.length - 1;
  const index = (d: number) => Math.max(0, Math.min(last, Math.round(d / lap.step)));
  const first = index(from);
  const exit = index(corner.exit);
  const apex = index(corner.apex);
  const pedal = lap.throttleIn.length === lap.d.length ? lap.throttleIn : lap.throttle;
  const steer = smoothed(lap.steering, first, exit, 2).map(Math.abs);
  const steerAt = (i: number) => steer[i - first] ?? 0;
  const dt = (a: number, b: number) => lap.t[b] - lap.t[a];

  // Braking.
  let brake: BrakeTechnique | null = null;
  let brakeEnd = first;
  let start = -1;
  for (let i = first; i <= Math.min(apex, exit); i++) {
    if (lap.brake[i] >= PEDALS.brakeOn) {
      start = i;
      break;
    }
  }
  let turnIn: number | null = null;
  const turnFrom = start >= 0 ? start : first;
  let mostLock = 0;
  for (let i = turnFrom; i <= apex; i++) mostLock = Math.max(mostLock, steerAt(i));
  if (mostLock >= 0.02) {
    for (let i = turnFrom; i <= apex; i++) {
      if (steerAt(i) >= Math.max(0.02, PEDALS.turnIn * mostLock)) {
        turnIn = i;
        break;
      }
    }
  }

  if (start >= 0) {
    const limit = Math.min(exit, index(corner.apex + PEDALS.pastApex));
    let peak = 0;
    let peakAt = start;
    let end = limit;
    for (let i = start; i <= limit; i++) {
      if (lap.brake[i] > peak) {
        peak = lap.brake[i];
        peakAt = i;
      }
      if (i > peakAt && lap.brake[i] < PEDALS.brakeOff) {
        end = i;
        break;
      }
    }
    let reached = start;
    while (reached < end && lap.brake[reached] < PEDALS.atPeak * peak) reached++;
    let leaving = end;
    while (leaving > reached && lap.brake[leaving] < PEDALS.atPeak * peak) leaving--;
    let reapplied = 0;
    let lowest = Infinity;
    for (let i = leaving; i <= end; i++) {
      lowest = Math.min(lowest, lap.brake[i]);
      if (lap.brake[i] - lowest >= PEDALS.reapply) {
        reapplied++;
        lowest = lap.brake[i];
      }
    }
    brakeEnd = end;
    brake = {
      start: lap.d[start],
      peak,
      toPeak: dt(start, reached),
      release: dt(leaving, end),
      off: lap.d[end],
      trail: turnIn === null ? null : dt(turnIn, end),
      reapplied,
    };
  }

  // Throttle, after the brake is off.
  let pickup = -1;
  for (let i = brakeEnd; i <= exit; i++) {
    if (pedal[i] >= PEDALS.pickup && lap.brake[i] < PEDALS.brakeOn) {
      pickup = i;
      break;
    }
  }
  const throttle: ThrottleTechnique = { pickup: null, toFull: null, hesitations: 0, withLock: 0, lifts: 0 };
  if (pickup >= 0) {
    throttle.pickup = lap.d[pickup];
    let most = pedal[pickup];
    let full = -1;
    for (let i = pickup + 1; i <= exit; i++) {
      if (full < 0) {
        if (pedal[i] >= PEDALS.full) {
          full = i;
          throttle.toFull = dt(pickup, i);
          continue;
        }
        if (pedal[i] <= most - PEDALS.hesitation) {
          throttle.hesitations++;
          most = pedal[i];
        } else {
          most = Math.max(most, pedal[i]);
        }
        if (pedal[i] - pedal[i - 1] > 0.01 && steerAt(i) - steerAt(i - 1) > 0.003 && steerAt(i) >= 0.05) {
          throttle.withLock += dt(i - 1, i);
        }
      } else if (pedal[i] < PEDALS.lift && pedal[i - 1] >= PEDALS.lift) {
        throttle.lifts++;
      }
    }
  }

  return { turnIn: turnIn === null ? null : lap.d[turnIn], brake, throttle };
}

/** Share of a lap's time spent flat out on the throttle pedal. */
export function fullThrottleShare(lap: ResampledLap): number | null {
  const pedal = lap.throttleIn.length === lap.d.length ? lap.throttleIn : lap.throttle;
  let flat = 0;
  let total = 0;
  for (let i = 1; i < lap.t.length; i++) {
    const step = lap.t[i] - lap.t[i - 1];
    if (!(step > 0) || step > 1) continue;
    total += step;
    if (pedal[i] >= PEDALS.full) flat += step;
  }
  return total > 0 ? flat / total : null;
}
