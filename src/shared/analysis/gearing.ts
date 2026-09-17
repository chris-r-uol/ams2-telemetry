/**
 * Gearing and shifting, from your own laps: how fast each gear runs out, where
 * you upshift and whether the next gear pulled harder, where the rev limiter
 * holds the car back, how hard downshifts rev the engine, and which gear each
 * corner is taken in.
 *
 * The game reports neutral for a moment during every shift and the odd one-sample
 * glitch, so a gear only counts once it has been held briefly. Everything is
 * compared at the same speed, so drag and gradient cancel out.
 */
import type { LapSummary, LapTrace } from '../model/types.ts';
import type { ChassisEvent } from './chassis.ts';
import type { Corner } from './corners.ts';

export const GEARING = {
  /** A gear has to be held this long to count, s. */
  holdGear: 0.05,
  /** Acceleration is compared over these windows either side of an upshift, s. */
  beforeShift: [-0.45, -0.1] as const,
  afterShift: [0.35, 0.7] as const,
  /** Full throttle. */
  fullThrottle: 0.95,
  /** Shifts at or above this share of the limiter are as late as they can be. */
  atLimiter: 0.97,
  /** A difference in pull across a shift smaller than this is noise, g. */
  pullNoise: 0.02,
  /** On the limiter: flat out, revs this close to the limit and not rising for this long. */
  limiterShare: 0.985,
  limiterHold: 0.3,
  /** A downshift that revs past this share of the limit is an over-rev. */
  overRev: 1,
  /** A rear lock-up this soon after a downshift is blamed on it, s. */
  downshiftLockWindow: 0.5,
  /** Shifts of one kind needed before a verdict. */
  minShifts: 3,
};

export interface GearRatio {
  gear: number;
  /** Road speed per 1,000 rpm, m/s. */
  speedPer1000: number;
  /** Speed at the rev limit, m/s. */
  speedAtLimiter: number | null;
}

export interface UpshiftSummary {
  from: number;
  to: number;
  count: number;
  /** Medians at the moment of the shift. */
  rpm: number;
  speed: number;
  /** How much harder the higher gear pulled just after the shift than the lower one just before, g (median). */
  pullChange: number | null;
  /** Earlier: the higher gear pulls harder, so change up sooner. Later: the lower gear still pulls harder and there were revs to spare. */
  verdict: 'earlier' | 'later' | 'right' | null;
}

export interface DownshiftSummary {
  from: number;
  to: number;
  count: number;
  /** Highest revs just after the shift, as a share of the rev limit (median and worst). */
  peakShare: number;
  worstShare: number;
  overRevs: number;
  /** Rear lock-ups straight after one of these downshifts. */
  rearLockUps: number;
}

export interface LimiterHit {
  lap: number;
  distance: number;
  gear: number;
  seconds: number;
  /** The corner this happened on the way to. */
  before: string | null;
}

export interface CornerGear {
  cornerId: number;
  corner: string;
  /** Lowest gear used in the corner, with how many clean laps used it and their median time through the corner. */
  choices: { gear: number; laps: number; time: number }[];
  bestLap: number | null;
  bestGear: number | null;
}

export interface GearingAnalysis {
  lapsAnalysed: number;
  /** Rev limit, from the highest revs reached flat out. */
  limiter: number | null;
  gears: GearRatio[];
  upshifts: UpshiftSummary[];
  downshifts: DownshiftSummary[];
  limiterHits: LimiterHit[];
  corners: CornerGear[];
}

export interface GearingLap {
  summary: LapSummary;
  trace: LapTrace;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  return Number.isInteger(mid) ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[Math.floor(mid)];
}

function quantile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = Float64Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
}

/** The gear actually engaged: neutral during a shift and one-sample glitches keep the last gear held. */
export function heldGears(tr: LapTrace): number[] {
  const out = new Array<number>(tr.t.length);
  let held = tr.gear[0] ?? 0;
  let candidate = held;
  let since = tr.t[0] ?? 0;
  for (let i = 0; i < tr.t.length; i++) {
    const g = tr.gear[i];
    if (g !== candidate) {
      candidate = g;
      since = tr.t[i];
    }
    if (candidate !== held && candidate > 0 && tr.t[i] - since >= GEARING.holdGear) held = candidate;
    out[i] = held;
  }
  return out;
}

function meanIn(tr: LapTrace, at: number, [from, to]: readonly [number, number], ok: (i: number) => boolean): number | null {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < tr.t.length; i++) {
    const dt = tr.t[i] - at;
    if (dt < from) continue;
    if (dt > to) break;
    if (!ok(i)) return null;
    sum += tr.lonG[i];
    n++;
  }
  return n >= 3 ? sum / n : null;
}

export function analyseGearing(
  laps: GearingLap[],
  corners: Corner[],
  events: ChassisEvent[] = [],
  cornerBestLaps: Map<number, number> = new Map(),
): GearingAnalysis {
  const usable = laps.filter((l) => l.summary.kind !== 'partial' && l.trace.t.length > 50);
  const gearsOf = usable.map((l) => heldGears(l.trace));

  // Rev limit: the top of the revs reached flat out.
  const flatOutRpm: number[] = [];
  for (const { trace } of usable) {
    for (let i = 0; i < trace.t.length; i++) if (trace.throttle[i] >= GEARING.fullThrottle) flatOutRpm.push(trace.rpm[i]);
  }
  const limiter = flatOutRpm.length > 200 ? quantile(flatOutRpm, 0.999) : null;

  // Ratios: revs per unit speed while driving in gear.
  const ratios = new Map<number, number[]>();
  usable.forEach(({ trace }, l) => {
    for (let i = 0; i < trace.t.length; i += 3) {
      const g = gearsOf[l][i];
      if (g < 1 || g !== trace.gear[i] || trace.speed[i] < 10 || trace.throttle[i] < 0.3) continue;
      (ratios.get(g) ?? ratios.set(g, []).get(g)!).push(trace.rpm[i] / trace.speed[i]);
    }
  });
  const gears: GearRatio[] = [...ratios.entries()]
    .filter(([, values]) => values.length >= 30)
    .sort((a, b) => a[0] - b[0])
    .map(([gear, values]) => {
      const perSpeed = median(values)!;
      return { gear, speedPer1000: 1000 / perSpeed, speedAtLimiter: limiter !== null ? limiter / perSpeed : null };
    });

  // Shifts.
  const ups = new Map<string, { from: number; to: number; rpm: number[]; speed: number[]; pull: number[] }>();
  const downs = new Map<string, { from: number; to: number; share: number[]; lockUps: number }>();
  const limiterHits: LimiterHit[] = [];
  const rearLocks = events.filter((e) => e.kind === 'lock-up' && (e.wheel === 'RL' || e.wheel === 'RR'));

  usable.forEach(({ summary, trace: tr }, l) => {
    const held = gearsOf[l];
    for (let i = 1; i < tr.t.length; i++) {
      const from = held[i - 1];
      const to = held[i];
      if (from === to || from < 1 || to < 1) continue;
      // The moment the old gear was let go: the last sample actually in it.
      let last = i - 1;
      while (last > 0 && tr.gear[last] !== from) last--;
      const at = tr.t[last];
      if (to > from) {
        // Only upshifts made flat out: the game cuts the throttle itself for the moment of the shift.
        let wasFlat = false;
        for (let k = last; k >= 0 && at - tr.t[k] <= 0.4; k--) wasFlat ||= tr.throttle[k] >= GEARING.fullThrottle;
        if (!wasFlat) continue;
        const before = meanIn(tr, at, GEARING.beforeShift, (k) => tr.throttle[k] >= GEARING.fullThrottle && tr.brake[k] < 0.05);
        const after = meanIn(tr, at, GEARING.afterShift, (k) => tr.throttle[k] >= GEARING.fullThrottle && tr.brake[k] < 0.05);
        const key = `${from}-${to}`;
        const bucket = ups.get(key) ?? ups.set(key, { from, to, rpm: [], speed: [], pull: [] }).get(key)!;
        bucket.rpm.push(tr.rpm[last]);
        bucket.speed.push(tr.speed[last]);
        if (before !== null && after !== null) bucket.pull.push(after - before);
      } else if (limiter !== null) {
        let peak = 0;
        for (let k = i; k < tr.t.length && tr.t[k] - at <= 0.4; k++) peak = Math.max(peak, tr.rpm[k]);
        const key = `${from}-${to}`;
        const bucket = downs.get(key) ?? downs.set(key, { from, to, share: [], lockUps: 0 }).get(key)!;
        bucket.share.push(peak / limiter);
        if (
          rearLocks.some(
            (e) =>
              e.lap === summary.lap &&
              e.distance >= tr.d[last] - 5 &&
              e.distance <= tr.d[last] + tr.speed[last] * GEARING.downshiftLockWindow,
          )
        ) {
          bucket.lockUps++;
        }
      }
    }

    // Limiter: flat out, revs pinned and not climbing, so the car can't go any faster in this gear.
    if (limiter === null) return;
    let start = -1;
    const flush = (end: number) => {
      if (start < 0) return;
      const seconds = tr.t[end] - tr.t[start];
      if (seconds >= GEARING.limiterHold) {
        const d = tr.d[start];
        const ahead = corners.filter((c) => c.entry >= d).sort((a, b) => a.entry - b.entry)[0] ?? corners[0] ?? null;
        limiterHits.push({ lap: summary.lap, distance: d, gear: held[start], seconds, before: ahead?.name ?? null });
      }
      start = -1;
    };
    for (let i = 0; i < tr.t.length; i++) {
      const pinned = tr.throttle[i] >= GEARING.fullThrottle && tr.rpm[i] >= GEARING.limiterShare * limiter && held[i] >= 1;
      if (pinned && start < 0) start = i;
      else if (!pinned) flush(i - 1);
    }
    flush(tr.t.length - 1);
  });

  const upshifts: UpshiftSummary[] = [...ups.values()]
    .sort((a, b) => a.from - b.from || a.to - b.to)
    .map((u) => {
      const rpm = median(u.rpm)!;
      const pullChange = u.pull.length >= GEARING.minShifts ? median(u.pull) : null;
      let verdict: UpshiftSummary['verdict'] = null;
      if (pullChange !== null && limiter !== null) {
        if (pullChange > GEARING.pullNoise) verdict = 'earlier';
        else if (pullChange < -GEARING.pullNoise && rpm < GEARING.atLimiter * limiter) verdict = 'later';
        else verdict = 'right';
      }
      return { from: u.from, to: u.to, count: u.rpm.length, rpm, speed: median(u.speed)!, pullChange, verdict };
    });

  const downshifts: DownshiftSummary[] = [...downs.values()]
    .sort((a, b) => b.from - a.from || b.to - a.to)
    .map((d) => ({
      from: d.from,
      to: d.to,
      count: d.share.length,
      peakShare: median(d.share)!,
      worstShare: Math.max(...d.share),
      overRevs: d.share.filter((s) => s > GEARING.overRev).length,
      rearLockUps: d.lockUps,
    }));

  // Lowest gear through each corner on clean laps, and how long those runs took.
  const clean = usable
    .map((lap, l) => ({ lap, gears: gearsOf[l] }))
    .filter(({ lap }) => lap.summary.kind === 'flying' && lap.summary.valid);
  const cornerGears: CornerGear[] = corners.map((corner) => {
    const byGear = new Map<number, { laps: number; times: number[] }>();
    let bestGear: number | null = null;
    const bestLap = cornerBestLaps.get(corner.id) ?? null;
    for (const { lap, gears: held } of clean) {
      const tr = lap.trace;
      let lowest = Infinity;
      let tIn = NaN;
      let tOut = NaN;
      for (let i = 0; i < tr.t.length; i++) {
        const d = tr.d[i];
        if (d < corner.entry || d > corner.exit) continue;
        if (Number.isNaN(tIn)) tIn = tr.t[i];
        tOut = tr.t[i];
        if (held[i] >= 1) lowest = Math.min(lowest, held[i]);
      }
      if (!Number.isFinite(lowest) || Number.isNaN(tIn)) continue;
      const entry = byGear.get(lowest) ?? byGear.set(lowest, { laps: 0, times: [] }).get(lowest)!;
      entry.laps++;
      entry.times.push(tOut - tIn);
      if (lap.summary.lap === bestLap) bestGear = lowest;
    }
    return {
      cornerId: corner.id,
      corner: corner.name,
      choices: [...byGear.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([gear, g]) => ({ gear, laps: g.laps, time: median(g.times)! })),
      bestLap,
      bestGear,
    };
  });

  return {
    lapsAnalysed: usable.length,
    limiter,
    gears,
    upshifts,
    downshifts,
    limiterHits,
    corners: cornerGears,
  };
}
