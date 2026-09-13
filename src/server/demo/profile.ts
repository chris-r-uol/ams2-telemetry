/**
 * Physics-lite lap generator for demo mode.
 *
 * Builds a speed profile with the classic forward/backward pass (grip-limited
 * cornering, braking and traction with a friction circle), then lets a "driver
 * plan" make human mistakes: braking early, slow apexes, late throttle,
 * coasting and the odd trip across the grass.
 */
import type { DemoTrack } from './track.ts';

export const G = 9.80665;
export const VMAX = 82;
export const MAX_RPM = 9000;
const GEAR_TOP = [0, 24, 35, 46, 57, 68, 84];

export interface CornerHabit {
  /** Fraction of available braking used (lower = brakes earlier and softer). */
  brake: number;
  /** Multiplier on the achievable apex speed. */
  apex: number;
  /** Metres after the apex before accelerating. */
  throttleDelay: number;
  /** Metres before the apex spent coasting with no pedal. */
  coast: number;
  /** Run wide over the grass on exit. */
  off: boolean;
  /** Chassis moments, applied when packets are emitted (they don't change the speed profile). */
  lockUp?: boolean;
  wheelspin?: boolean;
  snap?: boolean;
  kerb?: boolean;
}

export interface LapPlan {
  grip: number;
  power: number;
  pitExit: boolean;
  corners: CornerHabit[];
}

export interface DemoCorner {
  apexIndex: number;
}

export interface LapProfile {
  count: number;
  step: number;
  /** Time at each point; t[count] is the lap time. */
  t: Float64Array;
  v: Float64Array;
  throttle: Float64Array;
  brake: Float64Array;
  steering: Float64Array;
  gear: Int8Array;
  rpm: Float64Array;
  latG: Float64Array;
  lonG: Float64Array;
  off: Uint8Array;
  lapTime: number;
  invalidFrom: number | null;
}

const latLimit = (v: number) => G * (1.55 + 0.00032 * v * v);
const brakeLimit = (v: number) => G * (1.75 + 0.00028 * v * v);
const drag = (v: number) => 0.2 + 0.00055 * v * v;
const engine = (v: number, power: number) => Math.min(G * 0.9, (power * 400000) / (1300 * Math.max(v, 8)));

export function cornerSpeedLimit(kappa: number, grip: number): number {
  const denom = Math.abs(kappa) - G * grip * 0.00032;
  return denom <= 0 ? VMAX : Math.min(VMAX, Math.sqrt((G * grip * 1.55) / denom));
}

/** Signed circular offset from `from` to `to`, in points. */
export function circularOffset(to: number, from: number, count: number): number {
  let delta = (to - from) % count;
  if (delta > count / 2) delta -= count;
  if (delta < -count / 2) delta += count;
  return delta;
}

export function findDemoCorners(track: DemoTrack): { corners: DemoCorner[]; regionOf: Int16Array } {
  const n = track.x.length;
  const limit = track.curvature.map((k) => cornerSpeedLimit(k, 1));
  const win = Math.round(90 / track.step);
  const apexes: number[] = [];
  for (let i = 0; i < n; i++) {
    if (limit[i] >= VMAX * 0.8) continue;
    let isMin = true;
    for (let k = -win; k <= win && isMin; k++) {
      const j = (i + k + n) % n;
      if (limit[j] < limit[i] || (limit[j] === limit[i] && k < 0)) isMin = false;
    }
    if (isMin) apexes.push(i);
  }
  const regionOf = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    let best = 0;
    let bestDistance = Infinity;
    apexes.forEach((apex, c) => {
      const d = Math.abs(circularOffset(i, apex, n));
      if (d < bestDistance) {
        bestDistance = d;
        best = c;
      }
    });
    regionOf[i] = best;
  }
  return { corners: apexes.map((apexIndex) => ({ apexIndex })), regionOf };
}

export function computeLap(
  track: DemoTrack,
  corners: DemoCorner[],
  regionOf: Int16Array,
  plan: LapPlan,
): LapProfile {
  const n = track.x.length;
  const ds = track.step;
  const rel = (i: number) => circularOffset(i, corners[regionOf[i]].apexIndex, n) * ds;
  const habit = (i: number) => plan.corners[regionOf[i]];

  const v = new Float64Array(n);
  const off = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const h = habit(i);
    const r = rel(i);
    let lim = cornerSpeedLimit(track.curvature[i], plan.grip);
    if (Math.abs(r) < 90) lim *= h.apex;
    if (h.off && r > 10 && r < 110) {
      lim *= 0.78;
      if (r > 25 && r < 85) off[i] = 4;
    }
    v[i] = lim;
  }

  const frictionCircle = (i: number, speed: number) => {
    const lat = speed * speed * Math.abs(track.curvature[i]);
    return Math.sqrt(Math.max(0.1, 1 - (lat / (latLimit(speed) * plan.grip)) ** 2));
  };

  const decelCap = (i: number, speed: number) => {
    const h = habit(i);
    const r = rel(i);
    if (h.coast > 0 && r < 0 && r > -h.coast) return drag(speed) + 0.6;
    return brakeLimit(speed) * plan.grip * h.brake * frictionCircle(i, speed) + drag(speed);
  };

  const accelCap = (i: number, speed: number) => {
    const r = rel(i);
    if (r >= 0 && r < habit(i).throttleDelay) return 0;
    return engine(speed, plan.power) * frictionCircle(i, speed) - drag(speed);
  };

  for (let round = 0; round < 2; round++) {
    for (let j = 2 * n - 1; j >= 0; j--) {
      const i = j % n;
      const next = (i + 1) % n;
      const cap = Math.sqrt(v[next] * v[next] + 2 * ds * decelCap(i, v[next]));
      if (cap < v[i]) v[i] = cap;
    }
    for (let j = 0; j < 2 * n; j++) {
      const i = j % n;
      const next = (i + 1) % n;
      const cap = Math.sqrt(Math.max(0, v[i] * v[i] + 2 * ds * accelCap(i, v[i])));
      if (cap < v[next]) v[next] = cap;
    }
  }

  if (plan.pitExit) {
    // Leave the pit lane at the limiter, then accelerate away (forward only).
    const pitLane = Math.round(260 / ds);
    for (let i = 0; i < n - 1; i++) {
      if (i <= pitLane) v[i] = Math.min(v[i], 16.7);
      const cap = Math.sqrt(Math.max(0, v[i] * v[i] + 2 * ds * accelCap(i, v[i])));
      if (cap < v[i + 1]) v[i + 1] = cap;
      else if (i > pitLane) break;
    }
  }

  const t = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) t[i + 1] = t[i] + (2 * ds) / (v[i] + v[(i + 1) % n]);

  const throttle = new Float64Array(n);
  const brake = new Float64Array(n);
  const steering = new Float64Array(n);
  const gear = new Int8Array(n);
  const rpm = new Float64Array(n);
  const latG = new Float64Array(n);
  const lonG = new Float64Array(n);
  let invalidFrom: number | null = null;

  for (let i = 0; i < n; i++) {
    const speed = v[i];
    const accel = (v[(i + 1) % n] ** 2 - speed ** 2) / (2 * ds);
    const net = accel + drag(speed);
    throttle[i] = net > 0.05 ? Math.min(1, net / engine(speed, plan.power)) : 0;
    brake[i] = net < -0.6 ? Math.min(1, (-net - 0.4) / (brakeLimit(speed) * plan.grip)) : 0;
    latG[i] = (speed * speed * track.curvature[i]) / G;
    lonG[i] = accel / G;
    // Slow corners push (understeer grows with lateral g); fast corners stay close to neutral.
    const understeerGradient = speed < 35 ? 0.18 : 0.03;
    steering[i] = Math.max(
      -1,
      Math.min(1, (-(track.curvature[i] * 2.7) / 0.16) * (1 + understeerGradient * Math.abs(latG[i]))),
    );
    let g = 1;
    while (g < 6 && speed > GEAR_TOP[g] * 0.97) g++;
    gear[i] = g;
    rpm[i] = Math.min(MAX_RPM, Math.max(2600, (speed / GEAR_TOP[g]) * MAX_RPM * 0.99));
    if (off[i] && invalidFrom === null) invalidFrom = i * ds;
  }

  return {
    count: n,
    step: ds,
    t,
    v,
    throttle: smoothArray(throttle, 4),
    brake: smoothArray(brake, 3),
    steering: smoothArray(steering, 6),
    gear,
    rpm,
    latG,
    lonG,
    off,
    lapTime: t[n],
    invalidFrom,
  };
}

function smoothArray(values: Float64Array, radius: number): Float64Array {
  const n = values.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += values[(i + k + n) % n];
    out[i] = sum / (radius * 2 + 1);
  }
  return out;
}
