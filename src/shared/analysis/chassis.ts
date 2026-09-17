/**
 * Chassis analysis: balance (understeer / oversteer), sliding, wheel slip,
 * suspension travel, ride height, bottoming, bump stops, wheel lift and damper
 * velocity histograms, plus plain-language setup hints.
 *
 * AMS2 doesn't send "understeer" or "bottoming" as values, so they're derived
 * from steering, yaw rate, body velocities, wheel speeds, suspension travel and
 * ride height. Several units and sign conventions aren't documented for UDP, so
 * they're detected from the data itself (see `calibrate`).
 */
import type { LapSummary, LapTrace } from '../model/types.ts';
import type { Corner } from './corners.ts';

export const WHEELS = ['FL', 'FR', 'RL', 'RR'] as const;
export type Wheel = (typeof WHEELS)[number];
export type Quad<T> = [T, T, T, T];

const TRAVEL = ['travelFL', 'travelFR', 'travelRL', 'travelRR'] as const;
const DAMPER = ['damperFL', 'damperFR', 'damperRL', 'damperRR'] as const;
const RIDE = ['rideFL', 'rideFR', 'rideRL', 'rideRR'] as const;
const WHEEL_SPEED = ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'] as const;

/** Thresholds, in SI units. */
export const CHASSIS = {
  /** Below this speed (pit lane, spins) nothing is analysed, m/s. */
  minSpeed: 10,
  /** Ride height at or below this counts as bottoming, m. */
  bottoming: 0.003,
  /** A vertical jolt this big at the same moment makes bottoming a kerb or bump strike, g. */
  strikeG: 1,
  lockUpSlip: -0.15,
  wheelspinSlip: 0.12,
  /** Split between low- and high-speed damper movement, m/s. */
  damperKnee: 0.025,
  damperRange: 0.25,
  damperBin: 0.01,
  /** ±12% more/less steering than this car usually needs for the same corner and cornering force. */
  balance: 0.12,
  /** Body slip beyond this is a spin rather than driving, degrees. */
  spinSlipAngle: 25,
  /** Seconds left out before and after a spin, impact or trip off the track. */
  incidentBefore: 1,
  incidentAfter: 3,
} as const;

const G = 9.80665;

export interface ChassisLap {
  summary: LapSummary;
  trace: LapTrace;
}

export interface ChannelAvailability {
  suspension: boolean;
  dampers: boolean;
  rideHeight: boolean;
  wheelSpeed: boolean;
  yawRate: boolean;
  slipAngle: boolean;
  wheelContact: boolean;
}

export interface ChassisCalibration {
  /** Telemetry samples per second. */
  sampleRate: number | null;
  rideHeightUnit: 'm' | 'cm' | 'mm';
  /** Multiply raw travel by this so compression is positive. */
  travelSign: 1 | -1;
  /** Multiply raw damper velocity by this so bump (compression) is positive. */
  damperSign: 1 | -1;
  /** True if the game's "x" velocity turned out to be the longitudinal one. */
  velocityAxesSwapped: boolean;
  /** Steering fraction a neutral car needs per 1/m of path curvature: the geometric part. */
  steerPerCurvature: number | null;
  /** Extra steering fraction per g of cornering, as the tyres run at bigger slip angles: the understeer gradient. */
  steerPerG: number | null;
  steeringFit: number | null;
  /** AMS2 sends radians per second despite the "RPS" name. Detected from the rolling radius each would imply. */
  wheelSpeedUnit: 'rad/s' | 'rev/s';
  /** Rolling radius per wheel, m. */
  wheelRadius: Quad<number | null>;
  /** Horizontal acceleration beyond this is contact rather than cornering or braking, g. */
  impactG: number;
  /** Left-to-right wheel spacing, from how the wheels' speeds differ in corners, m (signed like yaw rate). */
  trackWidth: number | null;
  /** How sideways the car usually gets at the limit: 95th percentile body slip while cornering, degrees. */
  slideSlipAngle: number | null;
}

export type ChassisEventKind = 'lock-up' | 'wheelspin' | 'oversteer' | 'bottoming' | 'bump-stop' | 'wheel-lift';

export interface ChassisEvent {
  kind: ChassisEventKind;
  lap: number;
  distance: number;
  corner: string | null;
  wheel: Wheel | null;
  duration: number;
  /** Most extreme value: slip ratio, balance ratio, ride height (m) or travel (m). */
  peak: number;
  braking: boolean;
  speed: number;
  /** Bottoming with a sharp vertical jolt at the same moment: a kerb or bump strike, not the platform settling. */
  strike: boolean;
}

/** A spin, contact or trip off the track. Left out of calibration and setup patterns. */
export interface Incident {
  lap: number;
  distance: number;
  corner: string | null;
  duration: number;
}

export interface DamperHistogram {
  binWidth: number;
  /** Lower edge of the first bin, m/s. */
  from: number;
  /** Share of time in each bin (sums to 1). Values beyond the range fall in the end bins. */
  shares: number[];
  bump: number;
  rebound: number;
  fastBump: number;
  fastRebound: number;
  p95Bump: number;
  p95Rebound: number;
  samples: number;
}

export interface WheelSummary {
  wheel: Wheel;
  /** p98 − p2 of travel, m. */
  travelUsed: number | null;
  travelPeak: number | null;
  rideMin: number | null;
  rideLow: number | null;
  rideTypical: number | null;
  bumpStopSuspected: boolean;
  counts: Record<ChassisEventKind, number>;
  damper: DamperHistogram | null;
}

export type Verdict = 'understeer' | 'neutral' | 'oversteer';

export interface PhaseBalance {
  /** Extra steering as a share of what a neutral car would need. +0.2 = 20% more (understeer). */
  ratio: number | null;
  verdict: Verdict | null;
  samples: number;
}

export interface CornerBalance {
  cornerId: number;
  corner: string;
  entry: PhaseBalance;
  mid: PhaseBalance;
  exit: PhaseBalance;
  /** Typical peak body slip angle through the corner, degrees. */
  slipAngle: number | null;
  oversteerMoments: number;
  lockUps: number;
  wheelspin: number;
}

export interface PlatformSummary {
  /** Left-right travel difference per g of cornering, m/g. */
  frontRollPerG: number | null;
  rearRollPerG: number | null;
  /** Front-minus-rear compression per g of braking, m/g. */
  divePerG: number | null;
  /** Extra compression from ~70 km/h to top speed on straights, m. */
  frontAeroCompression: number | null;
  rearAeroCompression: number | null;
  /** RMS vertical acceleration on straights, g. */
  harshness: number | null;
  topSpeed: number | null;
}

/** What the feet are doing: trailing off the brake into a turn, neither pedal, some throttle or flat out. */
export type PedalPhase = 'trail-braking' | 'coasting' | 'part-throttle' | 'full-throttle';
export const PEDAL_PHASES: PedalPhase[] = ['trail-braking', 'coasting', 'part-throttle', 'full-throttle'];

export interface SpeedBand {
  /** m/s; `to` is null for the fastest band. */
  from: number;
  to: number | null;
}

/**
 * How the car handles at each speed and with each pedal. Balance that changes with speed
 * points at aerodynamics; balance that's the same at every speed is mechanical grip. Balance
 * that changes as you release the brake or add throttle points at brake bias, the differential
 * and damping.
 */
export interface HandlingSummary {
  bands: SpeedBand[];
  /** Balance while cornering, by pedal phase (rows, in PEDAL_PHASES order) and speed band (columns). */
  grid: PhaseBalance[][];
  /** All pedal phases together, per speed band. */
  bySpeed: PhaseBalance[];
  /** Corners whose slowest point falls in each band. */
  bandCorners: string[][];
  /**
   * Rear wheel slip against each wheel's own path, median while cornering, as a share:
   * on the power (+ spinning) and trailing the brake (− slowing). The inside wheel spinning far
   * more than the outside one means the differential is letting it; similar slip means it's locking them together.
   */
  rearSlip: {
    power: { inside: number; outside: number; samples: number } | null;
    braking: { inside: number; outside: number; samples: number } | null;
  };
}

export type HintArea = 'balance' | 'suspension' | 'dampers' | 'traction' | 'braking';

export interface SetupHint {
  id: string;
  area: HintArea;
  importance: 'high' | 'medium' | 'low';
  title: string;
  evidence: string;
  tryThis: string[];
}

export interface ChassisAnalysis {
  lapsAnalysed: number;
  availability: ChannelAvailability;
  calibration: ChassisCalibration;
  wheels: Quad<WheelSummary>;
  corners: CornerBalance[];
  events: ChassisEvent[];
  /** Spins, contact and trips off the track that were left out of everything else. */
  incidents: Incident[];
  platform: PlatformSummary;
  handling: HandlingSummary;
  hints: SetupHint[];
}

export interface ChassisLapSeries {
  lap: number;
  distance: number[];
  speed: (number | null)[];
  /** Extra steering as % of full lock: + understeer, − oversteer. */
  balance: (number | null)[];
  slipAngle: (number | null)[];
  /** mm, + compression. */
  travel: Quad<(number | null)[]>;
  /** mm. */
  ride: Quad<(number | null)[]>;
  /** %, − locking, + spinning. */
  wheelSlip: Quad<(number | null)[]>;
  events: ChassisEvent[];
}

interface DerivedLap {
  lap: LapSummary;
  n: number;
  t: number[];
  d: number[];
  speed: number[];
  brake: number[];
  throttle: number[];
  latG: number[];
  lonG: number[];
  vertG: number[] | null;
  need: number[];
  balance: number[];
  slipAngle: number[];
  wheelSlip: Quad<number[]>;
  travel: Quad<number[]>;
  damper: Quad<number[]>;
  ride: Quad<number[]>;
  grounded: Quad<boolean[]> | null;
  /** Inside a spin, contact or trip off the track, with a margin either side. */
  incident: boolean[];
}

// ---------------------------------------------------------------- helpers

function channel(trace: LapTrace, name: string): number[] | undefined {
  const values = (trace as unknown as Record<string, number[] | undefined>)[name];
  return values && values.length === trace.t.length ? values : undefined;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = Float64Array.from(values).sort();
  return sorted[Math.floor(sorted.length / 2)];
}

function percentile(sorted: Float64Array, p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];
}

function correlation(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i];
    my += ys[i];
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}

/**
 * Least-squares line through the middle 98% of points, so one spike (a kerb
 * strike, contact, a glitch) can't swing it. Null when there's too little data.
 */
function fitLine(xs: number[], ys: number[]): { slope: number; intercept: number } | null {
  if (xs.length < 100) return null;
  const bounds = (values: number[]) => {
    const sorted = Float64Array.from(values).sort();
    return [percentile(sorted, 0.01), percentile(sorted, 0.99)];
  };
  const [xLo, xHi] = bounds(xs);
  const [yLo, yHi] = bounds(ys);
  const keep = (i: number) => xs[i] >= xLo && xs[i] <= xHi && ys[i] >= yLo && ys[i] <= yHi;
  let n = 0;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < xs.length; i++) {
    if (!keep(i)) continue;
    n++;
    mx += xs[i];
    my += ys[i];
  }
  if (n < 80) return null;
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < xs.length; i++) {
    if (!keep(i)) continue;
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  if (sxx <= 1e-9) return null;
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx };
}

function spread(traces: LapTrace[], names: readonly string[]): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (const trace of traces) {
    for (const name of names) {
      const values = channel(trace, name);
      if (!values) continue;
      for (const v of values) {
        if (!Number.isFinite(v)) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
  }
  return hi >= lo ? hi - lo : 0;
}

/** Runs of consecutive samples passing `test`, tolerating single-sample dropouts. */
function findRuns(n: number, test: (i: number) => boolean, minSamples: number): [number, number][] {
  const runs: [number, number][] = [];
  let start = -1;
  let lastPass = -1;
  for (let i = 0; i < n; i++) {
    if (test(i)) {
      if (start < 0) start = i;
      lastPass = i;
    } else if (start >= 0 && i - lastPass > 1) {
      if (lastPass - start + 1 >= minSamples) runs.push([start, lastPass]);
      start = -1;
    }
  }
  if (start >= 0 && lastPass - start + 1 >= minSamples) runs.push([start, lastPass]);
  return runs;
}

const quad = <T>(make: (w: number) => T): Quad<T> => [make(0), make(1), make(2), make(3)];

function cornerAt(corners: Corner[], distance: number): Corner | null {
  return corners.find((c) => c.ranges.some(([from, to]) => distance >= from && distance < to)) ?? null;
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Angle between where the car points and where it's going, degrees. */
export function bodySlipAngle(vLat: number, vLon: number, velocityAxesSwapped: boolean): number {
  const sideways = velocityAxesSwapped ? vLon : vLat;
  const forwards = velocityAxesSwapped ? vLat : vLon;
  return (Math.abs(Math.atan2(sideways, Math.abs(forwards))) * 180) / Math.PI;
}

/**
 * Spins, contact and trips off the track, with a margin either side. They say
 * nothing about the setup, so they're left out of calibration and patterns.
 * Contact shows up as horizontal acceleration the car can't corner or brake with.
 */
export function incidentMask(tr: LapTrace, impactG: number, velocityAxesSwapped: boolean): boolean[] {
  const n = tr.t.length;
  const vLat = channel(tr, 'vLat');
  const vLon = channel(tr, 'vLon');
  const off = channel(tr, 'off');
  const trigger = new Array<boolean>(n).fill(false);
  for (let i = 0; i < n; i++) {
    if (Math.abs(tr.latG[i]) > impactG || Math.abs(tr.lonG[i]) > impactG || (off?.[i] ?? 0) >= 2) {
      trigger[i] = true;
    } else if (vLat && vLon && tr.speed[i] >= 5) {
      trigger[i] = bodySlipAngle(vLat[i], vLon[i], velocityAxesSwapped) > CHASSIS.spinSlipAngle;
    }
  }
  const mask = new Array<boolean>(n).fill(false);
  let until = -Infinity;
  for (let i = 0; i < n; i++) {
    if (trigger[i]) until = tr.t[i] + CHASSIS.incidentAfter;
    mask[i] = tr.t[i] <= until;
  }
  let from = Infinity;
  for (let i = n - 1; i >= 0; i--) {
    if (trigger[i]) from = tr.t[i] - CHASSIS.incidentBefore;
    if (tr.t[i] >= from) mask[i] = true;
  }
  return mask;
}

/** Distance ranges of a lap near a spin or contact, from `incidentMask`. */
export function incidentRanges(tr: LapTrace, impactG: number, velocityAxesSwapped: boolean): [number, number][] {
  const mask = incidentMask(tr, impactG, velocityAxesSwapped);
  const ranges: [number, number][] = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const last = ranges.at(-1);
    if (last && mask[i - 1]) last[1] = Math.max(last[1], tr.d[i]);
    else ranges.push([tr.d[i], tr.d[i]]);
  }
  return ranges;
}

/**
 * Steering a neutral car needs, as a × curvature + b × lateral g: the geometric part plus
 * the understeer gradient. Least squares through the origin, refitted without samples more
 * than three robust standard deviations off the line, so a few corners can't bend it.
 */
function fitSteering(
  kappa: number[],
  lateral: number[],
  steer: number[],
): { perCurvature: number; perG: number; r2: number } | null {
  const n = kappa.length;
  if (n < 150) return null;
  let keep = new Array<boolean>(n).fill(true);
  let a = 0;
  let b = 0;
  for (let pass = 0; pass < 4; pass++) {
    let skk = 0;
    let skg = 0;
    let sgg = 0;
    let sks = 0;
    let sgs = 0;
    for (let i = 0; i < n; i++) {
      if (!keep[i]) continue;
      skk += kappa[i] ** 2;
      skg += kappa[i] * lateral[i];
      sgg += lateral[i] ** 2;
      sks += kappa[i] * steer[i];
      sgs += lateral[i] * steer[i];
    }
    if (skk <= 0) return null;
    const det = skk * sgg - skg * skg;
    if (det > 0.02 * skk * sgg) {
      a = (sks * sgg - sgs * skg) / det;
      b = (sgs * skk - sks * skg) / det;
    } else {
      // Every corner at a similar speed: the two parts can't be told apart, so use curvature alone.
      a = sks / skk;
      b = 0;
    }
    const residuals: number[] = [];
    for (let i = 0; i < n; i++) if (keep[i]) residuals.push(Math.abs(steer[i] - a * kappa[i] - b * lateral[i]));
    const sigma = Math.max(1e-4, 1.4826 * (median(residuals) ?? 0));
    keep = kappa.map((k, i) => Math.abs(steer[i] - a * k - b * lateral[i]) <= 3 * sigma);
  }
  let count = 0;
  let mean = 0;
  for (let i = 0; i < n; i++) if (keep[i]) (mean += steer[i], count++);
  if (count < 150 || a === 0) return null;
  mean /= count;
  let res = 0;
  let tot = 0;
  for (let i = 0; i < n; i++) {
    if (!keep[i]) continue;
    res += (steer[i] - a * kappa[i] - b * lateral[i]) ** 2;
    tot += (steer[i] - mean) ** 2;
  }
  return { perCurvature: a, perG: b, r2: tot > 0 ? 1 - res / tot : 0 };
}

/** Steering a neutral car would need at this yaw rate and speed. NaN when it can't be judged. */
export function neutralSteering(cal: ChassisCalibration, yawRate: number, speed: number): number {
  if (cal.steerPerCurvature === null || !(speed >= 12)) return NaN;
  const geometric = cal.steerPerCurvature * (yawRate / speed);
  const needed = geometric + (cal.steerPerG ?? 0) * ((yawRate * speed) / G);
  // A gradient that would flip the steering direction is beyond anything the fit saw.
  return needed * geometric > 0 ? needed : NaN;
}

// ---------------------------------------------------------------- calibration

/** Work out units, signs, steering ratio and wheel radii from the session's own data. */
export function calibrate(laps: ChassisLap[]): { availability: ChannelAvailability; calibration: ChassisCalibration } {
  const traces = laps.map((l) => l.trace);
  let maxGrounded = 0;
  for (const trace of traces) for (const v of channel(trace, 'grounded') ?? []) maxGrounded = Math.max(maxGrounded, v);

  const availability: ChannelAvailability = {
    suspension: spread(traces, TRAVEL) > 0.001,
    dampers: spread(traces, DAMPER) > 0.005,
    rideHeight: spread(traces, RIDE) > 1e-4,
    wheelSpeed: spread(traces, WHEEL_SPEED) > 1,
    yawRate: spread(traces, ['yawRate']) > 0.02,
    slipAngle: spread(traces, ['vLon']) > 1 || spread(traces, ['vLat']) > 1,
    wheelContact: maxGrounded > 0,
  };

  // Sample rate
  const dts: number[] = [];
  for (const trace of traces) {
    for (let i = 1; i < trace.t.length; i += 5) {
      const dt = trace.t[i] - trace.t[i - 1];
      if (dt > 0 && dt < 0.5) dts.push(dt);
    }
  }
  const typicalDt = dts.length > 20 ? median(dts) : null;

  // Ride height unit, from typical magnitude (a car sits roughly 3–12 cm off the ground).
  const rides: number[] = [];
  for (const trace of traces) {
    for (const name of RIDE) {
      const values = channel(trace, name);
      if (!values) continue;
      for (let i = 0; i < values.length; i += 13) if (values[i] > 0) rides.push(values[i]);
    }
  }
  const typicalRide = median(rides) ?? 0;
  const rideHeightUnit = typicalRide > 20 ? 'mm' : typicalRide > 1.5 ? 'cm' : 'm';

  // Travel sign: braking compresses the front and extends the rear.
  const bucket = { brakeF: 0, brakeR: 0, brakeN: 0, throttleF: 0, throttleR: 0, throttleN: 0 };
  for (const trace of traces) {
    const t = TRAVEL.map((name) => channel(trace, name));
    if (t.some((v) => !v)) continue;
    for (let i = 0; i < trace.t.length; i += 2) {
      if (trace.speed[i] < 25 || Math.abs(trace.latG[i]) > 0.3) continue;
      const front = (t[0]![i] + t[1]![i]) / 2;
      const rear = (t[2]![i] + t[3]![i]) / 2;
      if (trace.brake[i] > 0.5) {
        bucket.brakeF += front;
        bucket.brakeR += rear;
        bucket.brakeN++;
      } else if (trace.throttle[i] > 0.9 && trace.brake[i] < 0.02) {
        bucket.throttleF += front;
        bucket.throttleR += rear;
        bucket.throttleN++;
      }
    }
  }
  let travelSign: 1 | -1 = 1;
  if (bucket.brakeN > 20 && bucket.throttleN > 20) {
    const score =
      (bucket.brakeF / bucket.brakeN - bucket.throttleF / bucket.throttleN) -
      (bucket.brakeR / bucket.brakeN - bucket.throttleR / bucket.throttleN);
    if (score < -1e-4) travelSign = -1;
  }

  // Damper sign: velocity should agree with the change in travel.
  let agreement = 0;
  for (const trace of traces) {
    for (let w = 0; w < 4; w++) {
      const travel = channel(trace, TRAVEL[w]);
      const damper = channel(trace, DAMPER[w]);
      if (!travel || !damper) continue;
      for (let i = 1; i < trace.t.length; i++) agreement += damper[i] * (travel[i] - travel[i - 1]) * travelSign;
    }
  }
  const damperSign: 1 | -1 = agreement < 0 ? -1 : 1;

  // Which local velocity axis is longitudinal?
  const speedSample: number[] = [];
  const lat: number[] = [];
  const lon: number[] = [];
  for (const trace of traces) {
    const vLat = channel(trace, 'vLat');
    const vLon = channel(trace, 'vLon');
    if (!vLat || !vLon) continue;
    for (let i = 0; i < trace.t.length; i += 17) {
      speedSample.push(trace.speed[i]);
      lat.push(Math.abs(vLat[i]));
      lon.push(Math.abs(vLon[i]));
    }
  }
  const velocityAxesSwapped = correlation(lat, speedSample) > correlation(lon, speedSample) + 0.1;

  // Contact shows up as acceleration far beyond what this car corners or brakes with.
  const horizontal: number[] = [];
  for (const trace of traces) {
    for (let i = 0; i < trace.t.length; i += 3) {
      if (trace.speed[i] >= CHASSIS.minSpeed) horizontal.push(Math.max(Math.abs(trace.latG[i]), Math.abs(trace.lonG[i])));
    }
  }
  const usualLimit = horizontal.length > 100 ? percentile(Float64Array.from(horizontal).sort(), 0.99) : 0;
  const impactG = Math.max(5, 2 * usualLimit);
  const incidents = traces.map((trace) => incidentMask(trace, impactG, velocityAxesSwapped));

  // Steering a neutral car needs, from steady cornering: off the brakes and without hard acceleration.
  let steerPerCurvature: number | null = null;
  let steerPerG: number | null = null;
  let steeringFit: number | null = null;
  if (availability.yawRate) {
    const kappa: number[] = [];
    const lateral: number[] = [];
    const steer: number[] = [];
    traces.forEach((trace, t) => {
      const yaw = channel(trace, 'yawRate');
      if (!yaw) return;
      for (let i = 0; i < trace.t.length; i += 2) {
        const v = trace.speed[i];
        if (v < 12 || Math.abs(yaw[i]) < 0.05 || trace.brake[i] > 0.05 || Math.abs(trace.lonG[i]) > 0.3) continue;
        if (incidents[t][i]) continue;
        kappa.push(yaw[i] / v);
        lateral.push((yaw[i] * v) / G);
        steer.push(trace.steering[i]);
      }
    });
    const fit = fitSteering(kappa, lateral, steer);
    if (fit && fit.r2 >= 0.4) {
      steerPerCurvature = fit.perCurvature;
      steerPerG = fit.perG;
      steeringFit = fit.r2;
    }
  }

  // Rolling radius per wheel, from straight-line running at speed. Full throttle is fine
  // there, because tyres barely slip once the car is quick.
  const ratios = quad<number[]>(() => []);
  if (availability.wheelSpeed) {
    traces.forEach((trace, t) => {
      for (let w = 0; w < 4; w++) {
        const spin = channel(trace, WHEEL_SPEED[w]);
        if (!spin) continue;
        for (let i = 0; i < trace.t.length; i += 3) {
          const rate = Math.abs(spin[i]);
          if (trace.speed[i] < 25 || rate < 1 || trace.brake[i] > 0.02 || incidents[t][i]) continue;
          if (Math.abs(trace.latG[i]) > 0.3 || Math.abs(trace.lonG[i]) > 0.3) continue;
          ratios[w].push(trace.speed[i] / rate);
        }
      }
    });
  }
  // Speed ÷ wheel speed is the radius if the game sends radians per second, or 2π × the
  // radius if it sends revolutions. Tyres are 15–60 cm, so only one reading fits.
  const plausibleRadius = (r: number | null) => r !== null && r > 0.15 && r < 0.6;
  const typicalRatio = median(ratios.flat());
  const wheelSpeedUnit: 'rad/s' | 'rev/s' =
    typicalRatio !== null && !plausibleRadius(typicalRatio) && plausibleRadius(typicalRatio / (2 * Math.PI))
      ? 'rev/s'
      : 'rad/s';
  const wheelRadius = quad<number | null>((w) => {
    const ratio = ratios[w].length >= 50 ? median(ratios[w]) : null;
    const radius = ratio === null ? null : wheelSpeedUnit === 'rev/s' ? ratio / (2 * Math.PI) : ratio;
    return plausibleRadius(radius) ? radius : null;
  });

  // In a corner the outside wheels travel further than the middle of the car. Rolling freely
  // (off the brakes, light throttle), that shows as a speed difference of yaw rate × track width.
  const measureTrack = (left: number, right: number): number | null => {
    const rl = wheelRadius[left];
    const rr = wheelRadius[right];
    if (!availability.yawRate || rl === null || rr === null) return null;
    const perUnit = wheelSpeedUnit === 'rev/s' ? 2 * Math.PI : 1;
    const widths: number[] = [];
    traces.forEach((trace, t) => {
      const wl = channel(trace, WHEEL_SPEED[left]);
      const wr = channel(trace, WHEEL_SPEED[right]);
      const yaw = channel(trace, 'yawRate');
      if (!wl || !wr || !yaw) return;
      for (let i = 0; i < trace.t.length; i += 2) {
        if (trace.speed[i] < 15 || Math.abs(yaw[i]) < 0.2 || trace.brake[i] > 0.02 || trace.throttle[i] > 0.3) continue;
        if (Math.abs(trace.lonG[i]) > 0.15 || incidents[t][i]) continue;
        widths.push(((Math.abs(wr[i]) * rr - Math.abs(wl[i]) * rl) * perUnit) / yaw[i]);
      }
    });
    const width = widths.length >= 100 ? median(widths) : null;
    return width !== null && Math.abs(width) > 1 && Math.abs(width) < 2.2 ? width : null;
  };
  // Front wheels first: on most cars they aren't driven, so they roll most freely.
  const trackWidth = measureTrack(0, 1) ?? measureTrack(2, 3);

  // How sideways the car usually gets at the limit, to tell a slide from a quick change of direction.
  const slips: number[] = [];
  if (availability.slipAngle && availability.yawRate) {
    traces.forEach((trace, t) => {
      const vLat = channel(trace, 'vLat');
      const vLon = channel(trace, 'vLon');
      const yaw = channel(trace, 'yawRate');
      if (!vLat || !vLon || !yaw) return;
      for (let i = 0; i < trace.t.length; i += 2) {
        if (trace.speed[i] < 12 || Math.abs(yaw[i]) < 0.1 || incidents[t][i]) continue;
        slips.push(bodySlipAngle(vLat[i], vLon[i], velocityAxesSwapped));
      }
    });
  }
  const slideSlipAngle = slips.length >= 200 ? percentile(Float64Array.from(slips).sort(), 0.95) : null;

  return {
    availability,
    calibration: {
      sampleRate: typicalDt ? 1 / typicalDt : null,
      rideHeightUnit,
      travelSign,
      damperSign,
      velocityAxesSwapped,
      steerPerCurvature,
      steerPerG,
      steeringFit,
      wheelSpeedUnit,
      wheelRadius,
      impactG,
      trackWidth,
      slideSlipAngle,
    },
  };
}

// ---------------------------------------------------------------- per lap

function deriveLap(lap: ChassisLap, availability: ChannelAvailability, cal: ChassisCalibration): DerivedLap {
  const tr = lap.trace;
  const n = tr.t.length;
  const nan = () => new Array<number>(n).fill(NaN);
  const rideScale = cal.rideHeightUnit === 'mm' ? 0.001 : cal.rideHeightUnit === 'cm' ? 0.01 : 1;
  const yaw = channel(tr, 'yawRate');
  const vLat = channel(tr, 'vLat');
  const vLon = channel(tr, 'vLon');
  const need = nan();
  const balance = nan();
  const slipAngle = nan();

  for (let i = 0; i < n; i++) {
    const v = tr.speed[i];
    if (v < 12) continue;
    if (availability.slipAngle && vLat && vLon) slipAngle[i] = bodySlipAngle(vLat[i], vLon[i], cal.velocityAxesSwapped);
    if (yaw) {
      const required = neutralSteering(cal, yaw[i], v);
      // Steering already the other way while the car isn't sliding: it's changing direction faster
      // than it can rotate, which says nothing about balance.
      const changingDirection =
        tr.steering[i] * required < 0 && cal.slideSlipAngle !== null && slipAngle[i] < cal.slideSlipAngle;
      if (Math.abs(required) >= 0.01 && !changingDirection) {
        need[i] = required;
        balance[i] = (tr.steering[i] - required) * Math.sign(required);
      }
    }
  }

  const wheelSlip = quad((w) => {
    const spin = channel(tr, WHEEL_SPEED[w]);
    const radius = cal.wheelRadius[w];
    const out = nan();
    if (!spin || radius === null) return out;
    const metresPerUnit = cal.wheelSpeedUnit === 'rev/s' ? 2 * Math.PI * radius : radius;
    // Each wheel's own path: in a corner the outside wheels travel further than the middle of the car.
    const offset = cal.trackWidth !== null ? (w % 2 === 0 ? -0.5 : 0.5) * cal.trackWidth : 0;
    for (let i = 0; i < n; i++) {
      const v = tr.speed[i];
      const ground = offset && yaw ? v + offset * yaw[i] : v;
      if (v >= 8 && ground > 1) out[i] = (metresPerUnit * Math.abs(spin[i]) - ground) / ground;
    }
    return out;
  });

  const scaled = (names: readonly string[], w: number, scale: number, ok: boolean) => {
    const values = channel(tr, names[w]);
    return ok && values ? values.map((v) => v * scale) : nan();
  };

  const groundedMask = channel(tr, 'grounded');
  const vertG = channel(tr, 'vertG');

  return {
    lap: lap.summary,
    n,
    t: tr.t,
    d: tr.d,
    speed: tr.speed,
    brake: tr.brake,
    throttle: tr.throttle,
    latG: tr.latG,
    lonG: tr.lonG,
    vertG: vertG ?? null,
    need,
    balance,
    slipAngle,
    wheelSlip,
    travel: quad((w) => scaled(TRAVEL, w, cal.travelSign, availability.suspension)),
    damper: quad((w) => scaled(DAMPER, w, cal.damperSign, availability.dampers)),
    ride: quad((w) => scaled(RIDE, w, rideScale, availability.rideHeight)),
    grounded:
      availability.wheelContact && groundedMask
        ? quad((w) => groundedMask.map((mask) => ((mask >> w) & 1) === 1))
        : null,
    incident: incidentMask(tr, cal.impactG, cal.velocityAxesSwapped),
  };
}

function detectEvents(
  dl: DerivedLap,
  corners: Corner[],
  sampleRate: number,
  ceilings: Quad<number | null>,
  slideSlipAngle: number | null,
): ChassisEvent[] {
  const events: ChassisEvent[] = [];
  const samples = (seconds: number) => Math.max(1, Math.round(seconds * sampleRate));
  const onTrack = (i: number) => dl.speed[i] >= CHASSIS.minSpeed;
  const add = (kind: ChassisEventKind, [start, end]: [number, number], wheel: number | null, peak: number, strike = false) => {
    if (dl.incident[start] || dl.incident[end]) return;
    events.push({
      kind,
      lap: dl.lap.lap,
      distance: dl.d[start],
      corner: cornerAt(corners, dl.d[start])?.name ?? null,
      wheel: wheel === null ? null : WHEELS[wheel],
      duration: dl.t[end] - dl.t[start] + 1 / sampleRate,
      peak,
      braking: dl.brake[start] > 0.3,
      speed: dl.speed[start],
      strike,
    });
  };
  // A sharp vertical jolt near a run, measured from the lap's usual level so gravity conventions don't matter.
  const vertical = dl.vertG;
  const verticalBase = vertical ? (median(vertical.filter((v, i) => i % 5 === 0 && Number.isFinite(v))) ?? 0) : 0;
  const jolt = ([start, end]: [number, number]) => {
    if (!vertical) return false;
    const reach = samples(0.1);
    for (let i = Math.max(0, start - reach); i <= Math.min(dl.n - 1, end + reach); i++) {
      if (Math.abs(vertical[i] - verticalBase) >= CHASSIS.strikeG) return true;
    }
    return false;
  };
  const extreme = (values: number[], [start, end]: [number, number], pick: (a: number, b: number) => number) => {
    let best = values[start];
    for (let i = start; i <= end; i++) if (Number.isFinite(values[i])) best = pick(best, values[i]);
    return best;
  };

  for (let w = 0; w < 4; w++) {
    const slip = dl.wheelSlip[w];
    for (const run of findRuns(dl.n, (i) => slip[i] < CHASSIS.lockUpSlip && dl.brake[i] > 0.2, samples(0.05))) {
      add('lock-up', run, w, extreme(slip, run, Math.min));
    }
    for (const run of findRuns(dl.n, (i) => slip[i] > CHASSIS.wheelspinSlip && dl.throttle[i] > 0.3, samples(0.08))) {
      add('wheelspin', run, w, extreme(slip, run, Math.max));
    }
    const ride = dl.ride[w];
    for (const run of findRuns(dl.n, (i) => onTrack(i) && ride[i] <= CHASSIS.bottoming, 1)) {
      add('bottoming', run, w, extreme(ride, run, Math.min), jolt(run));
    }
    const ceiling = ceilings[w];
    if (ceiling !== null) {
      const travel = dl.travel[w];
      for (const run of findRuns(dl.n, (i) => onTrack(i) && travel[i] >= ceiling, 1)) {
        add('bump-stop', run, w, extreme(travel, run, Math.max));
      }
    }
    const grounded = dl.grounded?.[w];
    if (grounded) {
      for (const run of findRuns(dl.n, (i) => dl.speed[i] >= 15 && !grounded[i], samples(0.1))) add('wheel-lift', run, w, 0);
    }
  }

  const ratio = (i: number) => dl.balance[i] / Math.abs(dl.need[i]);
  for (const run of findRuns(dl.n, (i) => Math.abs(dl.need[i]) >= 0.02 && ratio(i) < -0.35, samples(0.15))) {
    // Less steering than the car needs is only a slide if the car is also more sideways than usual.
    if (slideSlipAngle !== null) {
      let slip = 0;
      for (let i = run[0]; i <= run[1]; i++) if (Number.isFinite(dl.slipAngle[i])) slip = Math.max(slip, dl.slipAngle[i]);
      if (slip < slideSlipAngle) continue;
    }
    let peak = 0;
    for (let i = run[0]; i <= run[1]; i++) if (Number.isFinite(ratio(i))) peak = Math.min(peak, ratio(i));
    add('oversteer', run, null, peak);
  }
  return events;
}

// ---------------------------------------------------------------- session

const EMPTY_COUNTS = (): Record<ChassisEventKind, number> => ({
  'lock-up': 0,
  wheelspin: 0,
  oversteer: 0,
  bottoming: 0,
  'bump-stop': 0,
  'wheel-lift': 0,
});

function histogram(values: number[]): DamperHistogram | null {
  if (values.length < 200) return null;
  const { damperRange: range, damperBin: bin, damperKnee: knee } = CHASSIS;
  const bins = Math.round((2 * range) / bin);
  const counts = new Array<number>(bins).fill(0);
  const bumps: number[] = [];
  const rebounds: number[] = [];
  let fastBump = 0;
  let fastRebound = 0;
  for (const v of values) {
    counts[Math.max(0, Math.min(bins - 1, Math.floor((v + range) / bin)))]++;
    if (v > 0) {
      bumps.push(v);
      if (v > knee) fastBump++;
    } else if (v < 0) {
      rebounds.push(-v);
      if (-v > knee) fastRebound++;
    }
  }
  const total = values.length;
  const p95 = (list: number[]) => (list.length ? percentile(Float64Array.from(list).sort(), 0.95) : 0);
  return {
    binWidth: bin,
    from: -range,
    shares: counts.map((c) => c / total),
    bump: bumps.length / total,
    rebound: rebounds.length / total,
    fastBump: fastBump / total,
    fastRebound: fastRebound / total,
    p95Bump: p95(bumps),
    p95Rebound: p95(rebounds),
    samples: total,
  };
}

export function analyseChassis(allLaps: ChassisLap[], corners: Corner[]): ChassisAnalysis {
  const laps = allLaps.filter((l) => l.trace.t.length > 50 && l.summary.kind !== 'partial');
  const { availability, calibration } = calibrate(laps);
  const sampleRate = calibration.sampleRate ?? 60;
  const derived = laps.map((lap) => deriveLap(lap, availability, calibration));

  // Distributions per wheel (on track only).
  const travelValues = quad<number[]>(() => []);
  const rideValues = quad<number[]>(() => []);
  const damperValues = quad<number[]>(() => []);
  for (const dl of derived) {
    for (let i = 0; i < dl.n; i++) {
      if (dl.speed[i] < CHASSIS.minSpeed || dl.incident[i]) continue;
      for (let w = 0; w < 4; w++) {
        if (Number.isFinite(dl.travel[w][i])) travelValues[w].push(dl.travel[w][i]);
        if (Number.isFinite(dl.ride[w][i])) rideValues[w].push(dl.ride[w][i]);
        if (Number.isFinite(dl.damper[w][i])) damperValues[w].push(dl.damper[w][i]);
      }
    }
  }

  const travelSorted = travelValues.map((v) => Float64Array.from(v).sort());
  const rideSorted = rideValues.map((v) => Float64Array.from(v).sort());

  // A suspension free to move rarely piles samples up at one ceiling. A bump stop does.
  const ceilings = quad<number | null>((w) => {
    const sorted = travelSorted[w];
    if (sorted.length < 500) return null;
    const max = sorted[sorted.length - 1];
    const band = Math.max(0.0005, 0.01 * (max - percentile(sorted, 0.02)));
    let near = 0;
    for (let i = sorted.length - 1; i >= 0 && sorted[i] >= max - band; i--) near++;
    return near / sorted.length >= 0.002 ? max - band : null;
  });

  const events = derived.flatMap((dl) => detectEvents(dl, corners, sampleRate, ceilings, calibration.slideSlipAngle));
  const lead = Math.round(CHASSIS.incidentBefore * sampleRate);
  const incidents: Incident[] = derived.flatMap((dl) =>
    findRuns(dl.n, (i) => dl.incident[i], 1).map(([start, end]) => {
      // The window opens a moment before the spin or impact itself: report where it happened.
      const at = start === 0 ? start : Math.min(end, start + lead);
      return {
        lap: dl.lap.lap,
        distance: dl.d[at],
        corner: cornerAt(corners, dl.d[at])?.name ?? null,
        duration: dl.t[end] - dl.t[start],
      };
    }),
  );

  const wheels = quad<WheelSummary>((w) => {
    const counts = EMPTY_COUNTS();
    for (const e of events) if (e.wheel === WHEELS[w]) counts[e.kind]++;
    const t = travelSorted[w];
    const r = rideSorted[w];
    return {
      wheel: WHEELS[w],
      travelUsed: t.length > 100 ? percentile(t, 0.98) - percentile(t, 0.02) : null,
      travelPeak: t.length > 100 ? t[t.length - 1] : null,
      rideMin: r.length > 100 ? r[0] : null,
      rideLow: r.length > 100 ? percentile(r, 0.02) : null,
      rideTypical: r.length > 100 ? percentile(r, 0.5) : null,
      bumpStopSuspected: ceilings[w] !== null && counts['bump-stop'] >= 3,
      counts,
      damper: histogram(damperValues[w]),
    };
  });

  const cornerBalance = balanceByCorner(derived, corners, events);
  const platform = platformSummary(derived);
  const handling = handlingSummary(derived, corners, sampleRate);
  const analysis: ChassisAnalysis = {
    lapsAnalysed: laps.length,
    availability,
    calibration,
    wheels,
    corners: cornerBalance,
    events,
    incidents,
    platform,
    handling,
    hints: [],
  };
  analysis.hints = buildHints(analysis);
  return analysis;
}

/** 0 entry, 1 mid-corner (±15 m of the apex), 2 exit, -1 outside the corner. */
function phaseIndex(c: Corner, d: number): number {
  if (d >= c.entry && d < c.apex - 15) return 0;
  if (Math.abs(d - c.apex) <= 15) return 1;
  if (d > c.apex + 15 && d <= c.exit) return 2;
  return -1;
}

function phaseBalance(b: { extra: number; need: number; samples: number }): PhaseBalance {
  if (b.samples < 5 || b.need <= 0) return { ratio: null, verdict: null, samples: b.samples };
  const ratio = b.extra / b.need;
  return {
    ratio,
    verdict: ratio > CHASSIS.balance ? 'understeer' : ratio < -CHASSIS.balance ? 'oversteer' : 'neutral',
    samples: b.samples,
  };
}

export interface RunAnalysis {
  phases: { entry: PhaseBalance; mid: PhaseBalance; exit: PhaseBalance };
  slipAngle: number | null;
  events: ChassisEvent[];
  /** Distance of each sample and its balance ratio (+ understeer, NaN on straights). */
  d: number[];
  balance: number[];
}

/**
 * One run through one corner, straight from the raw trace: balance per phase,
 * peak slip angle and grip events. Used for mid-lap feedback, so it needs a
 * calibration from earlier laps.
 */
export function analyseRun(
  trace: LapTrace,
  corner: Corner,
  availability: ChannelAvailability,
  calibration: ChassisCalibration,
  lap: number,
): RunAnalysis {
  const indices: number[] = [];
  for (let i = 0; i < trace.t.length; i++) {
    if (trace.d[i] >= corner.entry - 5 && trace.d[i] <= corner.exit + 5) indices.push(i);
  }
  const slice = {} as Record<string, number[]>;
  for (const [key, values] of Object.entries(trace) as [string, number[] | undefined][]) {
    slice[key] = values && values.length === trace.t.length ? indices.map((i) => values[i]) : [];
  }
  const dl = deriveLap(
    { summary: { lap, kind: 'flying' } as LapSummary, trace: slice as unknown as LapTrace },
    availability,
    calibration,
  );
  const events =
    dl.n > 1
      ? detectEvents(dl, [corner], calibration.sampleRate ?? 60, [null, null, null, null], calibration.slideSlipAngle)
      : [];
  const buckets = [0, 1, 2].map(() => ({ extra: 0, need: 0, samples: 0 }));
  const balance = new Array<number>(dl.n).fill(NaN);
  let slip = 0;
  for (let i = 0; i < dl.n; i++) {
    if (Number.isFinite(dl.slipAngle[i])) slip = Math.max(slip, dl.slipAngle[i]);
    if (!Number.isFinite(dl.balance[i]) || dl.incident[i]) continue;
    balance[i] = dl.balance[i] / Math.abs(dl.need[i]);
    const phase = phaseIndex(corner, dl.d[i]);
    if (phase < 0) continue;
    buckets[phase].extra += dl.balance[i];
    buckets[phase].need += Math.abs(dl.need[i]);
    buckets[phase].samples++;
  }
  return {
    phases: { entry: phaseBalance(buckets[0]), mid: phaseBalance(buckets[1]), exit: phaseBalance(buckets[2]) },
    slipAngle: slip > 0 ? slip : null,
    events,
    d: dl.d,
    balance,
  };
}

function balanceByCorner(derived: DerivedLap[], corners: Corner[], events: ChassisEvent[]): CornerBalance[] {
  const flying = derived.filter((dl) => dl.lap.kind === 'flying');
  const source = flying.length ? flying : derived;
  const sums = corners.map(() => [0, 1, 2].map(() => ({ extra: 0, need: 0, samples: 0 })));
  const slipPeaks = corners.map(() => [] as number[]);

  for (const dl of source) {
    const lapPeak = corners.map(() => 0);
    for (let i = 0; i < dl.n; i++) {
      if (dl.incident[i]) continue;
      const d = dl.d[i];
      const ci = corners.findIndex((c) => c.ranges.some(([from, to]) => d >= from && d < to));
      if (ci < 0) continue;
      const c = corners[ci];
      if (Number.isFinite(dl.slipAngle[i])) lapPeak[ci] = Math.max(lapPeak[ci], dl.slipAngle[i]);
      if (!Number.isFinite(dl.balance[i])) continue;
      const phase = phaseIndex(c, d);
      if (phase < 0) continue;
      const bucket = sums[ci][phase];
      bucket.extra += dl.balance[i];
      bucket.need += Math.abs(dl.need[i]);
      bucket.samples++;
    }
    lapPeak.forEach((peak, ci) => {
      if (peak > 0) slipPeaks[ci].push(peak);
    });
  }

  return corners.map((c, ci) => ({
    cornerId: c.id,
    corner: c.name,
    entry: phaseBalance(sums[ci][0]),
    mid: phaseBalance(sums[ci][1]),
    exit: phaseBalance(sums[ci][2]),
    slipAngle: median(slipPeaks[ci]),
    oversteerMoments: events.filter((e) => e.kind === 'oversteer' && e.corner === c.name).length,
    lockUps: events.filter((e) => e.kind === 'lock-up' && e.corner === c.name).length,
    wheelspin: events.filter((e) => e.kind === 'wheelspin' && e.corner === c.name).length,
  }));
}

/** Slow, medium and fast corners: downforce at the top of the fast band is several times that in the slow one. */
export const SPEED_BANDS: SpeedBand[] = [
  { from: 0, to: 120 / 3.6 },
  { from: 120 / 3.6, to: 180 / 3.6 },
  { from: 180 / 3.6, to: null },
];

export function pedalPhase(brake: number, throttle: number): PedalPhase | null {
  if (brake > 0.05) return brake < 0.6 ? 'trail-braking' : null;
  if (throttle >= 0.95) return 'full-throttle';
  return throttle >= 0.1 ? 'part-throttle' : 'coasting';
}

function handlingSummary(derived: DerivedLap[], corners: Corner[], sampleRate: number): HandlingSummary {
  const bandOf = (v: number) => SPEED_BANDS.findIndex((b) => v >= b.from && (b.to === null || v < b.to));
  const empty = () => ({ extra: 0, need: 0, samples: 0 });
  const grid = PEDAL_PHASES.map(() => SPEED_BANDS.map(empty));
  const bySpeed = SPEED_BANDS.map(empty);
  const slip = {
    power: { inside: [] as number[], outside: [] as number[] },
    braking: { inside: [] as number[], outside: [] as number[] },
  };
  const flying = derived.filter((dl) => dl.lap.kind === 'flying');

  for (const dl of flying.length ? flying : derived) {
    for (let i = 0; i < dl.n; i++) {
      if (dl.incident[i]) continue;
      const phase = pedalPhase(dl.brake[i], dl.throttle[i]);
      if (phase === null) continue;
      // Real cornering only: on a straight or a gentle kink the steering needed is tiny, so any offset looks huge.
      const cornering = Math.abs(dl.need[i]) >= 0.03 && Math.abs(dl.latG[i]) >= 0.5;
      if (cornering && Number.isFinite(dl.balance[i])) {
        const band = bandOf(dl.speed[i]);
        const row = PEDAL_PHASES.indexOf(phase);
        for (const bucket of [grid[row][band], bySpeed[band]]) {
          bucket.extra += dl.balance[i];
          bucket.need += Math.abs(dl.need[i]);
          bucket.samples++;
        }
      }
      // Rear wheels in a proper corner: positive lateral g is a left turn, so the left wheel is inside.
      if (Math.abs(dl.latG[i]) < 0.5 || dl.speed[i] < 12) continue;
      const [inside, outside] = dl.latG[i] > 0 ? [2, 3] : [3, 2];
      const sIn = dl.wheelSlip[inside][i];
      const sOut = dl.wheelSlip[outside][i];
      if (!Number.isFinite(sIn) || !Number.isFinite(sOut)) continue;
      const target = dl.throttle[i] >= 0.5 && dl.brake[i] <= 0.05 ? slip.power : phase === 'trail-braking' ? slip.braking : null;
      if (!target) continue;
      target.inside.push(sIn);
      target.outside.push(sOut);
    }
  }

  // Half a second of cornering in a cell before it says anything.
  const minSamples = Math.max(5, Math.round(sampleRate * 0.5));
  const judge = (b: { extra: number; need: number; samples: number }) =>
    b.samples >= minSamples ? phaseBalance(b) : { ratio: null, verdict: null, samples: b.samples };
  const slipSummary = (s: { inside: number[]; outside: number[] }) =>
    s.inside.length >= minSamples * 2
      ? { inside: median(s.inside)!, outside: median(s.outside)!, samples: s.inside.length }
      : null;

  return {
    bands: SPEED_BANDS,
    grid: grid.map((row) => row.map(judge)),
    bySpeed: bySpeed.map(judge),
    bandCorners: SPEED_BANDS.map((_, b) => corners.filter((c) => bandOf(c.minSpeed) === b).map((c) => c.name)),
    rearSlip: { power: slipSummary(slip.power), braking: slipSummary(slip.braking) },
  };
}

function platformSummary(derived: DerivedLap[]): PlatformSummary {
  const roll = [
    { x: [] as number[], y: [] as number[] },
    { x: [] as number[], y: [] as number[] },
  ];
  const dive = { x: [] as number[], y: [] as number[] };
  const aero = [
    { x: [] as number[], y: [] as number[] },
    { x: [] as number[], y: [] as number[] },
  ];
  const vertical: number[] = [];
  const speeds: number[] = [];

  for (const dl of derived) {
    for (let i = 0; i < dl.n; i++) {
      const v = dl.speed[i];
      if (v < CHASSIS.minSpeed || dl.incident[i]) continue;
      speeds.push(v);
      const [fl, fr, rl, rr] = dl.travel.map((t) => t[i]);
      const lat = Math.abs(dl.latG[i]);
      const lon = dl.lonG[i];
      // A car can't sustain more than ~5 g; beyond that it's a strike or a glitch.
      if (lat > 5 || Math.abs(lon) > 5) continue;
      if (Number.isFinite(fl + fr + rl + rr)) {
        if (lat > 0.3 && Math.abs(lon) < 0.3) {
          roll[0].x.push(dl.latG[i]);
          roll[0].y.push(fl - fr);
          roll[1].x.push(dl.latG[i]);
          roll[1].y.push(rl - rr);
        }
        // Most braking overlaps some turning, so allow a little lateral g.
        if (lon < -0.3 && lat < 0.5) {
          dive.x.push(-lon);
          dive.y.push((fl + fr) / 2 - (rl + rr) / 2);
        }
        if (lat < 0.15 && Math.abs(lon) < 0.15 && v > 20) {
          aero[0].x.push(v * v);
          aero[0].y.push((fl + fr) / 2);
          aero[1].x.push(v * v);
          aero[1].y.push((rl + rr) / 2);
        }
      }
      if (dl.vertG && lat < 0.2 && Math.abs(lon) < 0.2 && v > 25 && Number.isFinite(dl.vertG[i])) vertical.push(dl.vertG[i]);
    }
  }

  const topSpeed = speeds.length ? percentile(Float64Array.from(speeds).sort(), 0.98) : null;
  const slope = (s: { x: number[]; y: number[] }) => {
    const fit = fitLine(s.x, s.y);
    return fit ? Math.abs(fit.slope) : null;
  };
  const aeroCompression = (s: { x: number[]; y: number[] }) => {
    const fit = fitLine(s.x, s.y);
    return fit && topSpeed !== null ? Math.max(0, fit.slope * (topSpeed ** 2 - 20 ** 2)) : null;
  };
  let harshness: number | null = null;
  if (vertical.length > 200) {
    const mean = vertical.reduce((a, b) => a + b, 0) / vertical.length;
    const rms = Math.sqrt(vertical.reduce((sum, v) => sum + (v - mean) ** 2, 0) / vertical.length);
    harshness = rms > 1e-4 ? rms : null;
  }

  return {
    frontRollPerG: slope(roll[0]),
    rearRollPerG: slope(roll[1]),
    divePerG: slope(dive),
    frontAeroCompression: aeroCompression(aero[0]),
    rearAeroCompression: aeroCompression(aero[1]),
    harshness,
    topSpeed,
  };
}

// ---------------------------------------------------------------- hints

function where(events: ChassisEvent[], topSpeed: number | null): string {
  const byCorner = new Map<string, number>();
  for (const e of events) if (e.corner) byCorner.set(e.corner, (byCorner.get(e.corner) ?? 0) + 1);
  const names = [...byCorner.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name]) => name);
  const braking = events.filter((e) => e.braking).length / events.length;
  const fast = topSpeed ? events.filter((e) => e.speed >= topSpeed * 0.85).length / events.length : 0;
  const at = names.length ? listNames(names) : 'several places';
  if (braking >= 0.5) return `under braking into ${at}`;
  if (fast >= 0.5) return `at high speed, near ${at}`;
  return `at ${at}`;
}

const mm = (metres: number) => `${Math.round(metres * 1000)} mm`;

export function buildHints(a: ChassisAnalysis): SetupHint[] {
  const hints: SetupHint[] = [];
  const laps = `${a.lapsAnalysed} ${a.lapsAnalysed === 1 ? 'lap' : 'laps'}`;
  const axles = [
    { key: 'front', name: 'front', wheels: ['FL', 'FR'] as Wheel[], label: 'front' },
    { key: 'rear', name: 'rear', wheels: ['RL', 'RR'] as Wheel[], label: 'rear' },
  ];
  const axleEvents = (kind: ChassisEventKind, wheels: Wheel[]) =>
    a.events.filter((e) => e.kind === kind && e.wheel !== null && wheels.includes(e.wheel));
  // A pattern has to show up on several laps: one spin or one wild kerb isn't the setup.
  const minLaps = Math.max(2, Math.ceil(a.lapsAnalysed * 0.25));
  const lapCount = (events: ChassisEvent[]) => new Set(events.map((e) => e.lap)).size;
  const repeats = (events: ChassisEvent[]) => events.length >= 3 && lapCount(events) >= minLaps;

  for (const axle of axles) {
    const bottoming = axleEvents('bottoming', axle.wheels);
    const settling = bottoming.filter((e) => !e.strike);
    if (repeats(settling)) {
      const lowest = Math.min(...settling.map((e) => e.peak));
      const context = where(settling, a.platform.topSpeed);
      const braking = context.startsWith('under braking');
      const fast = context.startsWith('at high speed');
      hints.push({
        id: `bottoming-${axle.key}`,
        area: 'suspension',
        importance: 'high',
        title: `The ${axle.name} is bottoming out`,
        evidence: `${axle.label[0].toUpperCase()}${axle.label.slice(1)} ride height dropped to ${mm(lowest)} on ${lapCount(settling)} of ${laps}, mostly ${context}.`,
        tryThis: braking
          ? [
              `Raise the ${axle.name} ride height a step.`,
              `Stiffer ${axle.name} springs or slow bump damping will reduce dive under braking.`,
              'To keep the car low for aerodynamics, add bump-stop (packer) range instead.',
            ]
          : fast
            ? [
                `Raise the ${axle.name} ride height a step.`,
                `Stiffer ${axle.name} springs will hold the car up against downforce.`,
                `Less wing at the ${axle.name} reduces the load pushing it down.`,
              ]
            : [
                `Raise the ${axle.name} ride height a step.`,
                `Soften ${axle.name} fast bump damping so the car rides over kerbs and bumps.`,
                'Or use less kerb at those corners.',
              ],
      });
    }

    const strikes = bottoming.filter((e) => e.strike);
    if (repeats(strikes)) {
      hints.push({
        id: `kerb-strikes-${axle.key}`,
        area: 'suspension',
        importance: 'low',
        title: `Kerbs or bumps are knocking the ${axle.name} onto the ground`,
        evidence: `The ${axle.name} touched down with a sharp jolt on ${lapCount(strikes)} of ${laps}, mostly ${where(strikes, a.platform.topSpeed)}. That's a strike, not the car running too low.`,
        tryThis: [
          `Soften ${axle.name} fast bump damping so the car rides over kerbs.`,
          `Raise the ${axle.name} ride height a little if you want to keep using those kerbs.`,
          'Or take less kerb there.',
        ],
      });
    }

    const stops = axleEvents('bump-stop', axle.wheels);
    if (repeats(stops) && a.wheels.some((w) => axle.wheels.includes(w.wheel) && w.bumpStopSuspected)) {
      hints.push({
        id: `bump-stop-${axle.key}`,
        area: 'suspension',
        importance: 'medium',
        title: `The ${axle.name} suspension is running out of travel`,
        evidence: `The ${axle.name} wheels reached the same maximum compression ${stops.length} times, mostly ${where(stops, a.platform.topSpeed)}. A flat limit like that is usually the bump stop.`,
        tryThis: [
          `Stiffer ${axle.name} springs reduce how far the suspension compresses.`,
          `More ${axle.name} ride height gives more travel before the bump stop.`,
          'Some setups run on the bump stops on purpose for aero stability. If the car feels good, you may not need to change it.',
        ],
      });
    }

    const lifts = axleEvents('wheel-lift', axle.wheels);
    if (repeats(lifts)) {
      hints.push({
        id: `wheel-lift-${axle.key}`,
        area: 'suspension',
        importance: 'medium',
        title: `A ${axle.name} wheel is leaving the ground`,
        evidence: `A ${axle.name} wheel lost contact ${lifts.length} times, mostly ${where(lifts, a.platform.topSpeed)}.`,
        tryThis: [
          `Soften the ${axle.name} anti-roll bar to keep the inside wheel planted.`,
          `Soften ${axle.name} fast bump damping so kerbs don't throw the car up.`,
          'Or take less kerb at those corners.',
        ],
      });
    }

    const locks = axleEvents('lock-up', axle.wheels);
    if (repeats(locks)) {
      hints.push({
        id: `lock-up-${axle.key}`,
        area: 'braking',
        importance: locks.length >= 6 ? 'high' : 'medium',
        title: `The ${axle.name} wheels are locking under braking`,
        evidence: `${locks.length} ${axle.name} lock-ups, mostly ${where(locks, a.platform.topSpeed).replace('under braking into', 'into')}.`,
        tryThis:
          axle.key === 'front'
            ? [
                'Move brake bias a step rearward.',
                'Reduce brake pressure, or raise ABS if the car has it.',
                'Ease off the pedal as speed falls. Less pressure is needed at low speed.',
              ]
            : [
                'Move brake bias a step forward.',
                'Soften rear rebound damping so the rear unloads more gently under braking.',
                'Downshift a little later, or reduce engine braking, so the rears aren’t overloaded.',
              ],
      });
    }

    const spins = axleEvents('wheelspin', axle.wheels);
    if (repeats(spins)) {
      hints.push({
        id: `wheelspin-${axle.key}`,
        area: 'traction',
        importance: spins.length >= 6 ? 'high' : 'medium',
        title: `The ${axle.name} wheels are spinning on exits`,
        evidence: `${spins.length} moments of ${axle.name} wheelspin, mostly ${where(spins, a.platform.topSpeed)}.`,
        tryThis: [
          `Soften the ${axle.name} anti-roll bar or springs for more mechanical grip.`,
          'Raise traction control, or reduce differential power lock, if the car allows it.',
          'Squeeze the throttle more progressively out of slow corners.',
        ],
      });
    }
  }

  const phases = [
    { key: 'mid', label: 'Mid-corner' },
    { key: 'entry', label: 'Corner-entry' },
    { key: 'exit', label: 'Corner-exit' },
  ] as const;
  const advice: Record<string, Record<'understeer' | 'oversteer', string[]>> = {
    mid: {
      understeer: [
        'Soften the front anti-roll bar, or stiffen the rear one.',
        'Add front wing (or take off rear wing) if it happens mainly in fast corners.',
        'Soften the front springs slightly.',
      ],
      oversteer: [
        'Stiffen the front anti-roll bar, or soften the rear one.',
        'Add rear wing if it happens mainly in fast corners.',
        'Soften the rear springs slightly.',
      ],
    },
    entry: {
      understeer: [
        'Move brake bias a step rearward.',
        'Soften front bump damping, or stiffen rear rebound damping.',
        'Trail-brake a little deeper so the front tyres stay loaded.',
      ],
      oversteer: [
        'Move brake bias a step forward.',
        'Stiffen front bump damping, or soften rear rebound damping.',
        'Reduce engine braking or differential coast lock if available.',
      ],
    },
    exit: {
      understeer: [
        'Soften front rebound damping, or stiffen rear bump damping.',
        'Soften the front anti-roll bar.',
        'Let the car finish rotating before going to full throttle.',
      ],
      oversteer: [
        'Soften rear bump damping or the rear anti-roll bar.',
        'Reduce differential power lock, or raise traction control.',
        'Stiffen front rebound damping so the front doesn’t lift as quickly.',
      ],
    },
  };
  for (const phase of phases) {
    const judged = a.corners.filter((c) => c[phase.key].verdict !== null);
    if (judged.length < 3) continue;
    for (const verdict of ['understeer', 'oversteer'] as const) {
      const matching = judged.filter((c) => c[phase.key].verdict === verdict);
      if (matching.length / judged.length < 0.4) continue;
      const typical = Math.abs(
        matching.reduce((sum, c) => sum + (c[phase.key].ratio ?? 0), 0) / matching.length,
      );
      hints.push({
        id: `${phase.key}-${verdict}`,
        area: 'balance',
        importance: 'medium',
        title: `${phase.label} ${verdict}`,
        evidence: `In ${matching.length} of ${judged.length} corners (${listNames(matching.slice(0, 5).map((c) => c.corner))}) you used about ${Math.round(typical * 100)}% ${verdict === 'understeer' ? 'more' : 'less'} steering than this car usually needs for the same corner and cornering force.`,
        tryThis: advice[phase.key][verdict],
      });
    }
  }

  const slides = a.events.filter((e) => e.kind === 'oversteer');
  if (repeats(slides)) {
    const onThrottle = slides.filter((e) => !e.braking).length >= slides.length / 2;
    hints.push({
      id: 'oversteer-moments',
      area: 'balance',
      importance: 'medium',
      title: 'Moments of sudden oversteer',
      evidence: `${slides.length} times the steering had to unwind sharply or go the other way to catch the rear, mostly ${onThrottle ? 'on the throttle' : 'while braking'} at ${listNames([...new Set(slides.map((e) => e.corner).filter((c): c is string => c !== null))].slice(0, 3))}.`,
      tryThis: onThrottle
        ? [
            'Soften the rear anti-roll bar or rear bump damping.',
            'Reduce differential power lock or raise traction control.',
            'Check rear tyre temperatures and pressures: hot rears lose grip suddenly.',
          ]
        : [
            'Move brake bias a step forward.',
            'Soften rear rebound damping.',
            'Brake in a straighter line before turning in.',
          ],
    });
  }

  // Balance that shifts with speed is aerodynamic: mechanical settings change it at every speed alike.
  const [slow, , fast] = a.handling.bySpeed;
  if (slow.ratio !== null && fast.ratio !== null && Math.abs(fast.ratio - slow.ratio) >= 0.25) {
    const tighter = fast.ratio > slow.ratio;
    hints.push({
      id: tighter ? 'aero-understeer' : 'aero-oversteer',
      area: 'balance',
      importance: 'medium',
      title: tighter ? 'Understeer grows with speed' : 'The car gets looser as speed rises',
      evidence: `In corners above 180 km/h you used ${Math.round(Math.abs(fast.ratio - slow.ratio) * 100)}% ${tighter ? 'more' : 'less'} steering, relative to what this car needs, than in corners below 120 km/h. A change with speed points at the aerodynamic balance rather than springs or anti-roll bars.`,
      tryThis: tighter
        ? ['Add front wing or take off rear wing.', 'Lower the front ride height or raise the rear a little, for more rake.']
        : ['Add rear wing or take off front wing.', 'Raise the front ride height or lower the rear a little, for less rake.'],
    });
  }

  const average = (row: PhaseBalance[]) => {
    const judged = row.filter((c) => c.ratio !== null);
    return judged.length ? judged.reduce((sum, c) => sum + c.ratio! * c.samples, 0) / judged.reduce((sum, c) => sum + c.samples, 0) : null;
  };
  const trail = average(a.handling.grid[PEDAL_PHASES.indexOf('trail-braking')]);
  const coast = average(a.handling.grid[PEDAL_PHASES.indexOf('coasting')]);
  if (trail !== null && coast !== null && trail <= -0.2 && trail <= coast - 0.15) {
    hints.push({
      id: 'trail-braking-oversteer',
      area: 'braking',
      importance: 'medium',
      title: 'The rear gets loose as you come off the brake',
      evidence: `While trailing the brake into corners you used ${Math.round(-trail * 100)}% less steering than this car needs, against ${Math.round(Math.abs(coast) * 100)}% ${coast < 0 ? 'less' : 'more'} once off both pedals.`,
      tryThis: [
        'Move brake bias a step forward.',
        'Add differential coast lock or preload, if the car allows it.',
        'Release the brake more gradually as you turn in.',
      ],
    });
  }

  const power = a.handling.rearSlip.power;
  if (power && power.inside >= 0.03 && power.inside >= 2 * Math.max(power.outside, 0.005)) {
    hints.push({
      id: 'inside-rear-spin',
      area: 'traction',
      importance: 'medium',
      title: 'The inside rear wheel spins on the power',
      evidence: `Accelerating through corners, the inside rear typically turns ${Math.round(power.inside * 1000) / 10}% faster than its path while the outside one is at ${Math.round(power.outside * 1000) / 10}%: drive is escaping through the unloaded wheel.`,
      tryThis: [
        'Add differential power lock or preload, if the car allows it.',
        'Soften the rear anti-roll bar to keep weight on the inside rear.',
        'Squeeze the throttle more gradually until the car straightens.',
      ],
    });
  }

  const uneven = a.wheels.filter((w) => w.damper && Math.abs(w.damper.bump - w.damper.rebound) >= 0.16);
  if (uneven.length) {
    hints.push({
      id: 'damper-balance',
      area: 'dampers',
      importance: 'low',
      title: 'Uneven bump and rebound movement',
      evidence: uneven
        .map((w) => `${w.wheel} spends ${Math.round(w.damper!.bump * 100)}% of its movement compressing and ${Math.round(w.damper!.rebound * 100)}% extending`)
        .join('; ')
        .concat('.'),
      tryThis: [
        'More time compressing usually means bump damping is stiff relative to rebound at that corner, and vice versa.',
        'Adjust one click at a time towards a more even split, then compare sessions.',
      ],
    });
  }

  const rank = { high: 0, medium: 1, low: 2 };
  return hints.sort((x, y) => rank[x.importance] - rank[y.importance]);
}

// ---------------------------------------------------------------- display

/** Distance-aligned series for one lap, ready for charts. */
export function chassisLapSeries(lap: ChassisLap, analysis: ChassisAnalysis, step = 2): ChassisLapSeries {
  const dl = deriveLap(lap, analysis.availability, analysis.calibration);
  const order: number[] = [];
  let last = -Infinity;
  for (let i = 0; i < dl.n; i++) {
    if (Number.isFinite(dl.d[i]) && dl.d[i] > last) {
      order.push(i);
      last = dl.d[i];
    }
  }
  const distance: number[] = [];
  const points: [number, number, number][] = [];
  if (order.length >= 2) {
    const end = dl.d[order[order.length - 1]];
    let j = 0;
    for (let p = 0; p * step <= end; p++) {
      const target = p * step;
      while (j < order.length - 2 && dl.d[order[j + 1]] < target) j++;
      const i0 = order[j];
      const i1 = order[j + 1];
      distance.push(target);
      points.push([i0, i1, Math.max(0, Math.min(1, (target - dl.d[i0]) / (dl.d[i1] - dl.d[i0])))]);
    }
  }
  const series = (values: number[], scale = 1) =>
    points.map(([i0, i1, f]) => {
      const a = values[i0];
      const b = values[i1];
      return Number.isFinite(a) && Number.isFinite(b) ? (a + (b - a) * f) * scale : null;
    });

  return {
    lap: lap.summary.lap,
    distance,
    speed: series(dl.speed),
    balance: series(dl.balance, 100),
    slipAngle: series(dl.slipAngle),
    travel: quad((w) => series(dl.travel[w], 1000)),
    ride: quad((w) => series(dl.ride[w], 1000)),
    wheelSlip: quad((w) => series(dl.wheelSlip[w], 100)),
    events: analysis.events.filter((e) => e.lap === lap.summary.lap),
  };
}
