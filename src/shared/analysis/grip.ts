/**
 * How much of the car's grip you use: the g-g diagram (friction circle) coaches
 * draw, measured against the most grip you've shown at each speed this session.
 *
 * The limit comes from your own laps, never a tyre model: in each speed band, the
 * cornering, braking and accelerating g you reach or beat 2% of the time. Downforce
 * only adds grip as speed rises, so cornering and braking grip seen at one speed is
 * carried up to every faster band (a flat-out kink never asks for full grip, so it
 * can't teach the limit). In between, combined braking-and-turning or turning-and-
 * accelerating is limited by an ellipse through those three, the usual tyre
 * friction ellipse.
 *
 * Only moments where more grip could have been used count: not flat out (the engine
 * is the limit), and not while the car swings from one direction to the other (grip
 * has to pass through zero on the way).
 */
import type { LapTrace } from '../model/types.ts';
import type { Corner } from './corners.ts';
import { G_SMOOTHING, smoothInTime, valueAt, type ResampledLap } from './resample.ts';

export const GRIP = {
  /** Width of each speed band, m/s (36 km/h). */
  band: 10,
  /** Samples a band needs before its limit counts: two seconds at 60 Hz. */
  minSamples: 120,
  /** The limit is the g reached or beaten this share of the time in a band. */
  percentile: 0.98,
  /** g is averaged over this many seconds either side, taking out kerb and bump noise. */
  smoothing: G_SMOOTHING,
  /** Below this speed (m/s) nothing is measured or counted. */
  minSpeed: 8,
  /** Cornering at this share of the grip available counts as turning, when looking for changes of direction. */
  turning: 0.5,
  /** A change of direction takes at most this long, s. */
  directionChange: 1.5,
  /** Throttle at or above this, off the brake, is flat out. */
  flatOut: 0.95,
  brakeOn: 0.05,
  throttleOn: 0.1,
  /** Stretches below this share of the grip available are where grip was left. */
  gapBelow: 0.85,
  /** Shorter stretches aren't named as the biggest gap: twice the smoothing, and about how long the car takes to load up. */
  minGap: 0.4,
} as const;

export interface GripEnvelope {
  /** Width of each speed band, m/s. Band i covers i × band to (i + 1) × band. */
  band: number;
  /** Most grip shown in each band, g: cornering, braking, and accelerating. Null where there wasn't enough driving to tell. */
  lateral: (number | null)[];
  braking: (number | null)[];
  accelerating: (number | null)[];
}

/** Why a point doesn't count towards grip used. */
export type GripSkip = 'flat-out' | 'direction-change' | 'incident' | 'unknown';
export type GripPhaseName = 'braking' | 'coasting' | 'throttle';

export interface GripPhase {
  /** Time-weighted share of the grip available, or null if none of the run was in this phase. */
  use: number | null;
  seconds: number;
}

/** The stretch where the most grip went unused: time × grip left. */
export interface GripGap {
  from: number;
  to: number;
  seconds: number;
  use: number;
  phase: GripPhaseName;
}

export interface GripSummary {
  use: number | null;
  braking: GripPhase;
  coasting: GripPhase;
  throttle: GripPhase;
  gap: GripGap | null;
}

/** One run through a stretch of track, sampled every `step` metres from `from`. */
export interface GripRun {
  /** Sideways (+ left) and fore-aft (+ accelerating) g as shares of the grip available there: distance 1 from the centre is the limit. */
  lat: (number | null)[];
  lon: (number | null)[];
  /** Share of the grip available that was used, where it counts. */
  use: (number | null)[];
  skip: (GripSkip | null)[];
  summary: GripSummary;
}

/** The inputs a run needs, all sampled at the same points. */
export interface GripSamples {
  d: number[];
  t: number[];
  speed: number[];
  throttle: number[];
  brake: number[];
  latG: number[];
  lonG: number[];
}

function quantile(values: number[], p: number): number {
  const sorted = Float64Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
}

/**
 * The most grip you've shown at each speed, from whole laps. `exclude` marks
 * samples to leave out, such as spins and contact.
 */
export function gripEnvelope(traces: LapTrace[], exclude: (boolean[] | null)[] = []): GripEnvelope | null {
  const lateral: number[][] = [];
  const braking: number[][] = [];
  const accelerating: number[][] = [];
  const push = (list: number[][], band: number, g: number) => {
    while (list.length <= band) list.push([]);
    list[band].push(g);
  };

  traces.forEach((trace, t) => {
    const lat = smoothInTime(trace.latG, trace.t);
    const lon = smoothInTime(trace.lonG, trace.t);
    for (let i = 0; i < trace.t.length; i++) {
      if (trace.speed[i] < GRIP.minSpeed || exclude[t]?.[i]) continue;
      const g = Math.hypot(lat[i], lon[i]);
      if (!(g >= 0.1)) continue;
      const band = Math.floor(trace.speed[i] / GRIP.band);
      const angle = (Math.atan2(Math.abs(lat[i]), lon[i]) * 180) / Math.PI;
      if (angle >= 60 && angle <= 120) push(lateral, band, g);
      else if (angle >= 150) push(braking, band, g);
      else if (angle <= 30) push(accelerating, band, g);
    }
  });

  const bands = Math.max(lateral.length, braking.length, accelerating.length);
  const limitOf = (list: number[][]) =>
    Array.from({ length: bands }, (_, b) =>
      (list[b]?.length ?? 0) >= GRIP.minSamples ? quantile(list[b], GRIP.percentile) : null,
    );
  const carryUp = (values: (number | null)[]) => {
    let best: number | null = null;
    return values.map((v) => (best = v === null ? best : best === null ? v : Math.max(best, v)));
  };
  const envelope: GripEnvelope = {
    band: GRIP.band,
    lateral: carryUp(limitOf(lateral)),
    braking: carryUp(limitOf(braking)),
    accelerating: limitOf(accelerating),
  };
  if (envelope.lateral.every((v) => v === null)) return null;
  // Slower than any hard braking seen, tyres grip about as well braking as turning.
  envelope.braking = envelope.braking.map((v, b) => v ?? envelope.lateral[b]);
  return envelope;
}

/** A band's value at any speed, interpolated between band centres; the nearest known band where one side is missing. */
function atSpeed(values: (number | null)[], band: number, speed: number, nearest = false): number | null {
  if (values.length === 0) return null;
  const pos = Math.max(0, Math.min(values.length - 1, speed / band - 0.5));
  const i = Math.floor(pos);
  const f = pos - i;
  const a = values[i];
  const b = values[Math.min(values.length - 1, i + 1)];
  if (a !== null && b !== null) return a + (b - a) * f;
  if (a !== null || b !== null) return a ?? b;
  if (!nearest) return null;
  for (let k = 1; k < values.length; k++) {
    const found = values[i - k] ?? values[i + 1 + k];
    if (found !== undefined && found !== null) return found;
  }
  return null;
}

/** Cornering grip available at a speed, g. */
export function lateralLimit(envelope: GripEnvelope, speed: number): number | null {
  return atSpeed(envelope.lateral, envelope.band, speed);
}

/** Grip available in the direction of this acceleration at this speed, g, or null if unknown. */
export function gripLimit(envelope: GripEnvelope, latG: number, lonG: number, speed: number): number | null {
  const lateral = atSpeed(envelope.lateral, envelope.band, speed);
  if (lateral === null) return null;
  const foreAft =
    lonG < 0
      ? (atSpeed(envelope.braking, envelope.band, speed) ?? lateral)
      : Math.min(lateral, atSpeed(envelope.accelerating, envelope.band, speed, true) ?? lateral);
  const angle = Math.atan2(Math.abs(latG), Math.abs(lonG));
  return 1 / Math.hypot(Math.sin(angle) / lateral, Math.cos(angle) / foreAft);
}

/**
 * Points between turning hard one way and turning hard the other, within a
 * change of direction's time. Grip has to pass through zero there.
 */
export function directionChanges(envelope: GripEnvelope, s: Pick<GripSamples, 't' | 'speed' | 'latG'>): boolean[] {
  const n = s.t.length;
  const side = s.latG.map((lat, i) => {
    const limit = lateralLimit(envelope, s.speed[i]);
    return limit !== null && Math.abs(lat) >= GRIP.turning * limit ? Math.sign(lat) : 0;
  });
  const previous = new Array<number>(n);
  let last = -1;
  for (let i = 0; i < n; i++) {
    if (side[i] !== 0) last = i;
    previous[i] = last;
  }
  const mask = new Array<boolean>(n).fill(false);
  let next = -1;
  for (let i = n - 1; i >= 0; i--) {
    if (side[i] !== 0) next = i;
    const p = previous[i];
    if (side[i] === 0 && p >= 0 && next >= 0 && side[p] !== side[next] && s.t[next] - s.t[p] <= GRIP.directionChange) {
      mask[i] = true;
    }
  }
  return mask;
}

/** Runs are sent to the browser, where a thousandth of the grip is plenty. */
const thousandths = (v: number) => Math.round(v * 1000) / 1000;

function phaseOf(throttle: number, brake: number): GripPhaseName {
  return brake > GRIP.brakeOn ? 'braking' : throttle >= GRIP.throttleOn ? 'throttle' : 'coasting';
}

/**
 * Grip used along one run. The samples should already be smoothed like `smoothInTime`.
 * `incident` marks points near a spin or contact, which say nothing about how you drive.
 */
export function gripRun(envelope: GripEnvelope, s: GripSamples, incident: boolean[] = []): GripRun {
  const n = s.t.length;
  const changing = directionChanges(envelope, s);
  const lat: (number | null)[] = [];
  const lon: (number | null)[] = [];
  const use: (number | null)[] = [];
  const skip: (GripSkip | null)[] = [];
  for (let i = 0; i < n; i++) {
    const limit = s.speed[i] >= GRIP.minSpeed ? gripLimit(envelope, s.latG[i], s.lonG[i], s.speed[i]) : null;
    if (limit === null || !Number.isFinite(s.latG[i]) || !Number.isFinite(s.lonG[i])) {
      lat.push(null);
      lon.push(null);
      use.push(null);
      skip.push('unknown');
      continue;
    }
    lat.push(thousandths(s.latG[i] / limit));
    lon.push(thousandths(s.lonG[i] / limit));
    const flatOut = s.throttle[i] >= GRIP.flatOut && s.brake[i] <= GRIP.brakeOn;
    const reason: GripSkip | null = incident[i]
      ? 'incident'
      : flatOut
        ? 'flat-out'
        : changing[i]
          ? 'direction-change'
          : null;
    skip.push(reason);
    use.push(reason ? null : thousandths(Math.hypot(s.latG[i], s.lonG[i]) / limit));
  }
  return { lat, lon, use, skip, summary: summarise(s, use) };
}

function summarise(s: GripSamples, use: (number | null)[]): GripSummary {
  const n = s.t.length;
  // Time each point stands for: half the gap to each neighbour.
  const dt = s.t.map((_, i) => {
    const before = i > 0 ? s.t[i] - s.t[i - 1] : 0;
    const after = i < n - 1 ? s.t[i + 1] - s.t[i] : 0;
    return Math.max(0, (before + after) / 2);
  });
  const totals = {
    all: [0, 0],
    braking: [0, 0],
    coasting: [0, 0],
    throttle: [0, 0],
  };
  let gap: GripGap | null = null;
  let run: {
    start: number;
    end: number;
    lost: number;
    seconds: number;
    weighted: number;
    byPhase: Record<GripPhaseName, number>;
  } | null = null;
  let biggestLoss = 0;
  const close = () => {
    if (run && run.seconds >= GRIP.minGap && run.lost > biggestLoss) {
      biggestLoss = run.lost;
      const phase = (Object.entries(run.byPhase) as [GripPhaseName, number][]).reduce((a, b) =>
        b[1] > a[1] ? b : a,
      )[0];
      gap = {
        from: s.d[run.start],
        to: s.d[run.end],
        seconds: run.seconds,
        use: run.weighted / run.seconds,
        phase,
      };
    }
    run = null;
  };

  for (let i = 0; i < n; i++) {
    const u = use[i];
    if (u === null) {
      close();
      continue;
    }
    const capped = Math.min(1, u);
    const phase = phaseOf(s.throttle[i], s.brake[i]);
    totals.all[0] += capped * dt[i];
    totals.all[1] += dt[i];
    totals[phase][0] += capped * dt[i];
    totals[phase][1] += dt[i];
    if (capped < GRIP.gapBelow) {
      run ??= {
        start: i,
        end: i,
        lost: 0,
        seconds: 0,
        weighted: 0,
        byPhase: { braking: 0, coasting: 0, throttle: 0 },
      };
      run.end = i;
      run.lost += (1 - capped) * dt[i];
      run.seconds += dt[i];
      run.weighted += capped * dt[i];
      run.byPhase[phase] += dt[i];
    } else {
      close();
    }
  }
  close();

  const inPhase = ([used, seconds]: number[]): GripPhase => ({
    use: seconds > 0 ? used / seconds : null,
    seconds,
  });
  return {
    use: totals.all[1] > 0 ? totals.all[0] / totals.all[1] : null,
    braking: inPhase(totals.braking),
    coasting: inPhase(totals.coasting),
    throttle: inPhase(totals.throttle),
    gap,
  };
}

// ---------------------------------------------------------------- corners

/** Grip runs start a little before the braking zone, like the corner profile. */
export const CORNER_LEAD_IN = 40;
export const CORNER_STEP = 2;

/** Where a corner's grip run starts, metres. */
export function cornerStart(corner: Corner): number {
  return Math.max(0, corner.entry - CORNER_LEAD_IN);
}

/**
 * Grip used through a corner on a lap resampled by distance, every `CORNER_STEP`
 * metres from `cornerStart` to the exit. `incidents` are distance ranges near a
 * spin or contact.
 */
export function cornerGripRun(
  envelope: GripEnvelope,
  corner: Corner,
  lap: ResampledLap,
  incidents: [number, number][] = [],
): GripRun {
  const samples: GripSamples = { d: [], t: [], speed: [], throttle: [], brake: [], latG: [], lonG: [] };
  for (let d = cornerStart(corner); d <= corner.exit; d += CORNER_STEP) {
    samples.d.push(d);
    for (const channel of ['t', 'speed', 'throttle', 'brake', 'latG', 'lonG'] as const) {
      samples[channel].push(valueAt(lap, channel, d));
    }
  }
  const near = samples.d.map((d) => incidents.some(([from, to]) => d >= from - CORNER_STEP && d <= to + CORNER_STEP));
  return gripRun(envelope, samples, near);
}

/** Grip used through one corner across a session's clean laps. */
export interface CornerGripSummary {
  cornerId: number;
  corner: string;
  apex: number;
  laps: number;
  /** Medians over the laps. */
  use: number | null;
  braking: number | null;
  coasting: number | null;
  throttle: number | null;
  /** Your fastest run through the corner. */
  best: { lap: number; use: number | null } | null;
  /** Where the most grip was left most often: the phase most laps' biggest gap fell in, and its typical stretch. */
  usualGap: { phase: GripPhaseName; laps: number; from: number; to: number; use: number } | null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  return Number.isInteger(mid) ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[Math.floor(mid)];
}

export function summariseCornerGrip(
  corner: Corner,
  runs: { lap: number; run: GripRun }[],
  bestLap: number | null,
): CornerGripSummary {
  const medianOf = (pick: (s: GripSummary) => number | null) =>
    median(runs.map((r) => pick(r.run.summary)).filter((v): v is number => v !== null));
  const gaps = runs.map((r) => r.run.summary.gap).filter((g): g is GripGap => g !== null);
  const byPhase = new Map<GripPhaseName, GripGap[]>();
  for (const gap of gaps) byPhase.set(gap.phase, [...(byPhase.get(gap.phase) ?? []), gap]);
  const [phase, usual] = [...byPhase.entries()].reduce<[GripPhaseName | null, GripGap[]]>(
    (most, entry) => (entry[1].length > most[1].length ? entry : most),
    [null, []],
  );
  const best = runs.find((r) => r.lap === bestLap) ?? null;
  return {
    cornerId: corner.id,
    corner: corner.name,
    apex: corner.apex,
    laps: runs.length,
    use: medianOf((s) => s.use),
    braking: medianOf((s) => s.braking.use),
    coasting: medianOf((s) => s.coasting.use),
    throttle: medianOf((s) => s.throttle.use),
    best: best ? { lap: best.lap, use: best.run.summary.use } : null,
    usualGap:
      phase !== null
        ? {
            phase,
            laps: usual.length,
            from: median(usual.map((g) => g.from))!,
            to: median(usual.map((g) => g.to))!,
            use: median(usual.map((g) => g.use))!,
          }
        : null,
  };
}
