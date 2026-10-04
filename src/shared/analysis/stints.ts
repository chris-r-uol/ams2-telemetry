/**
 * Stints: the runs a session falls into between visits to the pits or garage. A
 * setup change happens in one of those breaks, so comparing stints is comparing
 * setups on the same day, at the same track.
 *
 * The breaks are found from the lap list alone, so this works on every saved
 * session: an out lap, the lap after an in lap, the lap count going back, or
 * time unaccounted for between laps with the tyres changed or cooled. A pause
 * leaves a gap too, but the tyres come back as they were, so it isn't a break.
 */
import type { LapSummary, Quad } from '../model/types.ts';
import type { Corner } from './corners.ts';
import { cornerMetrics } from './metrics.ts';
import { coachableLaps, stdDev, type AnalysedLap } from './session.ts';

export const STINTS = {
  /** Seconds unaccounted for between two laps before it can be a break, not a hesitation at the line. */
  gap: 20,
  /** Average tyre temperature this much lower than on the lap before means the tyres were changed or left to cool, °C. */
  cooled: 8,
  /** Wear this much lower than on the lap before means new tyres (wear is sent in steps of about 0.004). */
  wearReset: 0.002,
  /**
   * Clean laps within this multiple of the stint's best are its pace laps. A warm-up lap
   * or a slow lap after a mistake isn't the pace, and with three or four laps in a stint
   * one of them would drag a plain median a long way.
   */
  paceWindow: 1.05,
} as const;

/** Positions of a stint's first and last lap in the session's lap list. */
export interface StintRange {
  first: number;
  last: number;
}

export interface StintSummary extends StintRange {
  /** 1-based, in the order driven. */
  id: number;
  /** The game's lap numbers, in order. */
  laps: number[];
  startedAt: number;
  /** Complete, valid flying laps. */
  cleanLaps: number;
  /** Clean laps within 5% of the stint's best: the ones its pace is taken from. */
  paceLaps: number;
  bestLap: { lap: number; time: number } | null;
  /** Median pace lap: the pace the stint ran at, whatever its one best lap was. */
  typicalLap: number | null;
  /** Standard deviation of the pace laps. Needs two. */
  spread: number | null;
  bestSectors: [number | null, number | null, number | null];
  /** Medians over the pace laps. */
  typicalSectors: [number | null, number | null, number | null];
  /** Median top speed, m/s. */
  topSpeed: number | null;
  /** Median fuel used per flying lap, litres. */
  fuelPerLap: number | null;
  /** Medians of each clean lap's average, by wheel. */
  tyreTemp: Quad | null;
  tyrePressure: Quad | null;
}

/** How one corner went over a stint's pace laps. */
export interface StintCorner {
  cornerId: number;
  corner: string;
  /** Runs through the corner that were measured. */
  runs: number;
  /** Median time through the corner's segment, s. Segments tile the lap, so these add up to a typical lap. */
  typicalTime: number | null;
  bestTime: number | null;
  /** Medians over the same runs, m/s. */
  minSpeed: number | null;
  exitSpeed: number | null;
  /** Median braking point, metres into the lap. Null when most runs didn't brake. */
  brakePoint: number | null;
}

const mean4 = (q: Quad) => (q[0] + q[1] + q[2] + q[3]) / 4;

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function tyresReset(prev: LapSummary, lap: LapSummary): boolean {
  return (
    mean4(lap.tyreWear) < mean4(prev.tyreWear) - STINTS.wearReset ||
    mean4(lap.tyreTempAvg) < mean4(prev.tyreTempAvg) - STINTS.cooled
  );
}

function startsStint(laps: readonly LapSummary[], i: number, stintFirst: number): boolean {
  const prev = laps[i - 1];
  const lap = laps[i];
  // The lap count went back: the session was restarted.
  if (lap.lap <= prev.lap) return true;
  if (lap.kind === 'out') return true;
  // Came in at the end of the last lap. A lap that began its stint in the garage can be
  // labelled an in lap too (the car is put there a moment after the lap starts): it doesn't end the stint.
  if (prev.kind === 'in' && i - 1 !== stintFirst) return true;
  // A break the game didn't label. The first lap of a stint often has time unaccounted for as well,
  // sat in the garage before leaving, but the lap after it doesn't start on fresher tyres.
  const gap = prev.lapTime === null ? 0 : (lap.startedAt - prev.startedAt) / 1000 - prev.lapTime;
  return gap > STINTS.gap && tyresReset(prev, lap);
}

export function detectStints(laps: readonly LapSummary[]): StintRange[] {
  const ranges: StintRange[] = [];
  let first = 0;
  for (let i = 1; i <= laps.length; i++) {
    if (i === laps.length || startsStint(laps, i, first)) {
      ranges.push({ first, last: i - 1 });
      first = i;
    }
  }
  return laps.length ? ranges : [];
}

const isClean = (lap: LapSummary) => lap.valid && lap.kind === 'flying' && lap.lapTime !== null;

function medianQuad(quads: Quad[]): Quad | null {
  // Laps saved without tyre data read zero.
  const used = quads.filter((q) => q.some((v) => v > 0));
  if (used.length === 0) return null;
  return [0, 1, 2, 3].map((w) => median(used.map((q) => q[w]))!) as Quad;
}

/** Each stint of a session, with its pace and running figures from the lap summaries. */
export function summariseStints(laps: readonly LapSummary[]): StintSummary[] {
  return detectStints(laps).map(({ first, last }, index) => {
    const own = laps.slice(first, last + 1);
    const clean = own.filter(isClean);
    const best = clean.reduce<LapSummary | null>((a, b) => (!a || b.lapTime! < a.lapTime! ? b : a), null);
    const paced = best ? clean.filter((l) => l.lapTime! <= best.lapTime! * STINTS.paceWindow) : [];
    const times = paced.map((l) => l.lapTime!);
    const sector = (from: LapSummary[], i: number) => from.map((l) => l.sectors[i]).filter((s): s is number => s !== null && s > 0);
    const fuel = own.filter((l) => l.kind === 'flying' && l.fuelUsed !== null && l.fuelUsed > 0).map((l) => l.fuelUsed!);
    return {
      id: index + 1,
      first,
      last,
      laps: own.map((l) => l.lap),
      startedAt: own[0].startedAt,
      cleanLaps: clean.length,
      paceLaps: paced.length,
      bestLap: best ? { lap: best.lap, time: best.lapTime! } : null,
      typicalLap: median(times),
      spread: times.length >= 2 ? stdDev(times) : null,
      bestSectors: [0, 1, 2].map((i) => {
        const s = sector(clean, i);
        return s.length ? Math.min(...s) : null;
      }) as StintSummary['bestSectors'],
      typicalSectors: [0, 1, 2].map((i) => median(sector(paced, i))) as StintSummary['typicalSectors'],
      topSpeed: median(clean.map((l) => l.topSpeed)),
      fuelPerLap: median(fuel),
      tyreTemp: medianQuad(clean.map((l) => l.tyreTempAvg)),
      tyrePressure: medianQuad(clean.map((l) => l.tyrePressureAvg)),
    };
  });
}

/**
 * How each corner went over a stint's pace laps. `incidents` are distance ranges of each
 * lap near a spin or contact, by lap number: a run through a corner that overlaps one is
 * left out, as long as a clean run remains.
 */
export function stintCorners(
  laps: readonly AnalysedLap[],
  corners: Corner[],
  incidents: Map<number, [number, number][]> = new Map(),
): StintCorner[] {
  const clean = coachableLaps(laps);
  const best = Math.min(...clean.map((l) => l.summary.lapTime!));
  const paced = clean.filter((l) => l.summary.lapTime! <= best * STINTS.paceWindow);
  return corners.map((corner) => {
    const all = paced.map((lap) => ({
      metrics: cornerMetrics(lap.resampled, corner),
      disturbed: (incidents.get(lap.summary.lap) ?? []).some(([from, to]) => corner.ranges.some(([a, b]) => from < b && to > a)),
    }));
    const undisturbed = all.filter((r) => !r.disturbed);
    const runs = (undisturbed.length ? undisturbed : all).map((r) => r.metrics);
    const times = runs.map((m) => m.segmentTime).filter(Number.isFinite);
    const braked = runs.map((m) => m.brakePoint).filter((d): d is number => d !== null);
    return {
      cornerId: corner.id,
      corner: corner.name,
      runs: runs.length,
      typicalTime: median(times),
      bestTime: times.length ? Math.min(...times) : null,
      minSpeed: median(runs.map((m) => m.minSpeed)),
      exitSpeed: median(runs.map((m) => m.exitSpeed)),
      brakePoint: braked.length * 2 > runs.length ? median(braked) : null,
    };
  });
}
