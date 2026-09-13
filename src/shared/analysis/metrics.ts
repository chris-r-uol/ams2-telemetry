import type { Corner } from './corners.ts';
import { valueAt, type ResampledLap } from './resample.ts';

export interface CornerMetrics {
  /** Seconds spent in the corner's segment. */
  segmentTime: number;
  /** Distance where braking started, or null if the corner was taken with a lift. */
  brakePoint: number | null;
  /** Peak brake pressure, 0..1. */
  brakePeak: number;
  entrySpeed: number;
  minSpeed: number;
  minSpeedAt: number;
  /** Distance where the throttle was picked up again after the slowest point. */
  throttlePoint: number | null;
  fullThrottlePoint: number | null;
  exitSpeed: number;
  /** Metres with neither pedal applied between braking and throttle pickup. */
  coastDistance: number;
  offTrack: boolean;
}

const BRAKE_ON = 0.1;
const THROTTLE_PICKUP = 0.25;
const FULL_THROTTLE = 0.95;
const PEDAL_OFF = 0.05;

export function segmentTime(lap: ResampledLap, corner: Corner): number {
  let total = 0;
  for (const [from, to] of corner.ranges) total += valueAt(lap, 't', to) - valueAt(lap, 't', from);
  return total;
}

export function cornerMetrics(lap: ResampledLap, corner: Corner): CornerMetrics {
  const n = lap.t.length;
  const step = lap.step;
  const idx = (d: number) => Math.max(0, Math.min(n - 1, Math.round(d / step)));

  const entryIdx = idx(corner.entry);
  const exitIdx = idx(corner.exit);

  let minIdx = idx(corner.apex - 60);
  for (let i = minIdx; i <= idx(corner.apex + 60); i++) if (lap.speed[i] < lap.speed[minIdx]) minIdx = i;

  let brakeIdx = -1;
  let brakePeak = 0;
  for (let i = entryIdx; i <= minIdx; i++) {
    if (brakeIdx < 0 && lap.brake[i] > BRAKE_ON) brakeIdx = i;
    brakePeak = Math.max(brakePeak, lap.brake[i]);
  }

  let entrySpeed = 0;
  for (let i = entryIdx; i <= (brakeIdx >= 0 ? brakeIdx : minIdx); i++) entrySpeed = Math.max(entrySpeed, lap.speed[i]);

  let throttleIdx = -1;
  let fullThrottleIdx = -1;
  const searchEnd = Math.max(exitIdx, idx(corner.apex + 250));
  for (let i = minIdx; i <= searchEnd; i++) {
    if (throttleIdx < 0 && lap.throttle[i] > THROTTLE_PICKUP && lap.brake[i] < BRAKE_ON) throttleIdx = i;
    if (fullThrottleIdx < 0 && lap.throttle[i] >= FULL_THROTTLE) fullThrottleIdx = i;
    if (throttleIdx >= 0 && fullThrottleIdx >= 0) break;
  }

  let coast = 0;
  const coastFrom = brakeIdx >= 0 ? brakeIdx : entryIdx;
  const coastTo = throttleIdx >= 0 ? throttleIdx : exitIdx;
  for (let i = coastFrom; i <= coastTo; i++) {
    if (lap.throttle[i] < PEDAL_OFF && lap.brake[i] < PEDAL_OFF) coast += step;
  }

  let offTrack = false;
  for (const [from, to] of corner.ranges) {
    for (let i = idx(from); i <= idx(to) && !offTrack; i++) if (lap.off[i] >= 2) offTrack = true;
  }

  return {
    segmentTime: segmentTime(lap, corner),
    brakePoint: brakeIdx >= 0 ? brakeIdx * step : null,
    brakePeak,
    entrySpeed,
    minSpeed: lap.speed[minIdx],
    minSpeedAt: minIdx * step,
    throttlePoint: throttleIdx >= 0 ? throttleIdx * step : null,
    fullThrottlePoint: fullThrottleIdx >= 0 ? fullThrottleIdx * step : null,
    exitSpeed: lap.speed[exitIdx],
    coastDistance: coast,
    offTrack,
  };
}
