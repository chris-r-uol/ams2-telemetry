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
  lockUpSlip: -0.15,
  wheelspinSlip: 0.12,
  /** Split between low- and high-speed damper movement, m/s. */
  damperKnee: 0.025,
  damperRange: 0.25,
  damperBin: 0.01,
  /** ±12% more/less steering than the car needs in gentle corners. */
  balance: 0.12,
} as const;

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
  /** Steering fraction the car needs per 1/m of path curvature in gentle corners. */
  steerPerCurvature: number | null;
  steeringFit: number | null;
  /** Rolling radius per wheel, m. */
  wheelRadius: Quad<number | null>;
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
  platform: PlatformSummary;
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

  // Steering needed per unit of path curvature, fitted in gentle, steady corners.
  let steerPerCurvature: number | null = null;
  let steeringFit: number | null = null;
  if (availability.yawRate) {
    const kappa: number[] = [];
    const steer: number[] = [];
    for (const trace of traces) {
      const yaw = channel(trace, 'yawRate');
      if (!yaw) continue;
      for (let i = 0; i < trace.t.length; i += 2) {
        const v = trace.speed[i];
        const g = Math.abs(trace.latG[i]);
        if (v < 12 || Math.abs(yaw[i]) < 0.05 || g < 0.1 || g > 0.6 || trace.brake[i] > 0.05) continue;
        kappa.push(yaw[i] / v);
        steer.push(trace.steering[i]);
      }
    }
    const fit = (keep: (i: number) => boolean) => {
      let sxy = 0;
      let sxx = 0;
      for (let i = 0; i < kappa.length; i++) {
        if (!keep(i)) continue;
        sxy += kappa[i] * steer[i];
        sxx += kappa[i] ** 2;
      }
      return sxx > 0 ? sxy / sxx : 0;
    };
    if (kappa.length >= 150) {
      const first = fit(() => true);
      let ss = 0;
      for (let i = 0; i < kappa.length; i++) ss += (steer[i] - first * kappa[i]) ** 2;
      const sigma = Math.sqrt(ss / kappa.length);
      const inlier = (i: number) => Math.abs(steer[i] - first * kappa[i]) <= 3 * sigma;
      const k = fit(inlier);
      let res = 0;
      let tot = 0;
      let count = 0;
      let mean = 0;
      for (let i = 0; i < kappa.length; i++) if (inlier(i)) (mean += steer[i], count++);
      mean /= Math.max(1, count);
      for (let i = 0; i < kappa.length; i++) {
        if (!inlier(i)) continue;
        res += (steer[i] - k * kappa[i]) ** 2;
        tot += (steer[i] - mean) ** 2;
      }
      const r2 = tot > 0 ? 1 - res / tot : 0;
      if (count >= 150 && r2 >= 0.4 && k !== 0) {
        steerPerCurvature = k;
        steeringFit = r2;
      }
    }
  }

  // Rolling radius per wheel, from gentle straight-line running.
  const wheelRadius = quad<number | null>((w) => {
    if (!availability.wheelSpeed) return null;
    const radii: number[] = [];
    for (const trace of traces) {
      const rps = channel(trace, WHEEL_SPEED[w]);
      if (!rps) continue;
      for (let i = 0; i < trace.t.length; i += 3) {
        const spin = Math.abs(rps[i]);
        // Straights at speed: full throttle is fine there, because tyres barely slip once the car is quick.
        if (trace.speed[i] < 25 || spin < 1 || trace.brake[i] > 0.02) continue;
        if (Math.abs(trace.latG[i]) > 0.3 || Math.abs(trace.lonG[i]) > 0.3) continue;
        radii.push(trace.speed[i] / (2 * Math.PI * spin));
      }
    }
    const r = radii.length >= 50 ? median(radii) : null;
    return r !== null && r > 0.15 && r < 0.6 ? r : null;
  });

  return {
    availability,
    calibration: {
      sampleRate: typicalDt ? 1 / typicalDt : null,
      rideHeightUnit,
      travelSign,
      damperSign,
      velocityAxesSwapped,
      steerPerCurvature,
      steeringFit,
      wheelRadius,
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
    if (cal.steerPerCurvature !== null && yaw) {
      const required = cal.steerPerCurvature * (yaw[i] / v);
      if (Math.abs(required) >= 0.01) {
        need[i] = required;
        balance[i] = (tr.steering[i] - required) * Math.sign(required);
      }
    }
    if (availability.slipAngle && vLat && vLon) {
      const sideways = cal.velocityAxesSwapped ? vLon[i] : vLat[i];
      const forwards = cal.velocityAxesSwapped ? vLat[i] : vLon[i];
      slipAngle[i] = (Math.abs(Math.atan2(sideways, Math.abs(forwards))) * 180) / Math.PI;
    }
  }

  const wheelSlip = quad((w) => {
    const rps = channel(tr, WHEEL_SPEED[w]);
    const radius = cal.wheelRadius[w];
    const out = nan();
    if (!rps || radius === null) return out;
    for (let i = 0; i < n; i++) {
      const v = tr.speed[i];
      if (v >= 8) out[i] = (2 * Math.PI * radius * Math.abs(rps[i]) - v) / v;
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
  };
}

function detectEvents(
  dl: DerivedLap,
  corners: Corner[],
  sampleRate: number,
  ceilings: Quad<number | null>,
): ChassisEvent[] {
  const events: ChassisEvent[] = [];
  const samples = (seconds: number) => Math.max(1, Math.round(seconds * sampleRate));
  const onTrack = (i: number) => dl.speed[i] >= CHASSIS.minSpeed;
  const add = (kind: ChassisEventKind, [start, end]: [number, number], wheel: number | null, peak: number) => {
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
    });
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
      add('bottoming', run, w, extreme(ride, run, Math.min));
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
      if (dl.speed[i] < CHASSIS.minSpeed) continue;
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

  const events = derived.flatMap((dl) => detectEvents(dl, corners, sampleRate, ceilings));

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
  const analysis: ChassisAnalysis = {
    lapsAnalysed: laps.length,
    availability,
    calibration,
    wheels,
    corners: cornerBalance,
    events,
    platform,
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
  const events = dl.n > 1 ? detectEvents(dl, [corner], calibration.sampleRate ?? 60, [null, null, null, null]) : [];
  const buckets = [0, 1, 2].map(() => ({ extra: 0, need: 0, samples: 0 }));
  const balance = new Array<number>(dl.n).fill(NaN);
  let slip = 0;
  for (let i = 0; i < dl.n; i++) {
    if (Number.isFinite(dl.slipAngle[i])) slip = Math.max(slip, dl.slipAngle[i]);
    if (!Number.isFinite(dl.balance[i])) continue;
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
      if (v < CHASSIS.minSpeed) continue;
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

  for (const axle of axles) {
    const bottoming = axleEvents('bottoming', axle.wheels);
    if (bottoming.length >= 3) {
      const lowest = Math.min(...bottoming.map((e) => e.peak));
      const context = where(bottoming, a.platform.topSpeed);
      const braking = context.startsWith('under braking');
      const fast = context.startsWith('at high speed');
      hints.push({
        id: `bottoming-${axle.key}`,
        area: 'suspension',
        importance: 'high',
        title: `The ${axle.name} is bottoming out`,
        evidence: `${axle.label[0].toUpperCase()}${axle.label.slice(1)} ride height dropped to ${mm(lowest)} ${bottoming.length} times across ${laps}, mostly ${context}.`,
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

    const stops = axleEvents('bump-stop', axle.wheels);
    if (stops.length >= 3 && a.wheels.some((w) => axle.wheels.includes(w.wheel) && w.bumpStopSuspected)) {
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
    if (lifts.length >= 3) {
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
    if (locks.length >= 3) {
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
    if (spins.length >= 3) {
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
        evidence: `In ${matching.length} of ${judged.length} corners (${listNames(matching.slice(0, 5).map((c) => c.corner))}) you used about ${Math.round(typical * 100)}% ${verdict === 'understeer' ? 'more' : 'less'} steering than the car needs in gentle corners.`,
        tryThis: advice[phase.key][verdict],
      });
    }
  }

  const slides = a.events.filter((e) => e.kind === 'oversteer');
  if (slides.length >= 3) {
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
