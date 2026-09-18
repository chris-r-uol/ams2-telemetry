/**
 * Whole-session coaching: ideal lap, consistency, and recurring habits.
 */
import type { LapSummary } from '../model/types.ts';
import { tipsForCorner, type CoachTip, type TipKind } from './coach.ts';
import { detectCorners, type Corner } from './corners.ts';
import { cornerMetrics, type CornerMetrics } from './metrics.ts';
import type { ResampledLap } from './resample.ts';

export interface AnalysedLap {
  summary: LapSummary;
  resampled: ResampledLap;
}

export interface CornerInsight {
  corner: Corner;
  bestTime: number;
  bestLap: number;
  meanTime: number;
  stdDev: number;
  /** Time the best lap left on the table in this corner vs the best-ever run through it. */
  potential: number;
}

export interface Habit {
  kind: TipKind;
  cornerId: number;
  corner: string;
  count: number;
  outOf: number;
  averageAmount: number;
  averageTimeLost: number;
}

export interface SessionInsights {
  lapsAnalysed: number;
  bestLap: { lap: number; time: number } | null;
  /** Sum of your best run through every corner. */
  idealLapTime: number | null;
  /** Sum of best game sector times. */
  theoreticalBestFromSectors: number | null;
  consistency: { meanTime: number; stdDev: number; laps: number } | null;
  corners: CornerInsight[];
  /** Where the best lap can still improve, biggest gain first. */
  focus: CoachTip[];
  habits: Habit[];
}

/** Laps worth learning from: complete, valid, flying laps with telemetry. */
export function coachableLaps(laps: readonly AnalysedLap[]): AnalysedLap[] {
  return laps.filter(
    (l) => l.summary.valid && l.summary.kind === 'flying' && l.summary.lapTime !== null && l.resampled.t.length > 50,
  );
}

/**
 * `incidents` are distance ranges of each lap near a spin or contact, by lap number. A run
 * through a corner that overlaps one is left out of habits and the corner's typical time,
 * and a lap with one is left out of consistency: being hit isn't a habit, and one spin
 * would swamp the average. Running wide isn't an incident here: that is a habit.
 */
export function analyseSession(
  allLaps: AnalysedLap[],
  cornersOverride?: Corner[],
  incidents: Map<number, [number, number][]> = new Map(),
): SessionInsights {
  const laps = coachableLaps(allLaps);
  const empty: SessionInsights = {
    lapsAnalysed: laps.length,
    bestLap: null,
    idealLapTime: null,
    theoreticalBestFromSectors: theoreticalBestFromSectors(allLaps.map((l) => l.summary)),
    consistency: null,
    corners: [],
    focus: [],
    habits: [],
  };
  if (laps.length === 0) return empty;

  const best = laps.reduce((a, b) => (b.summary.lapTime! < a.summary.lapTime! ? b : a));
  const corners = cornersOverride ?? detectCorners(best.resampled);
  const metrics: CornerMetrics[][] = laps.map((l) => corners.map((c) => cornerMetrics(l.resampled, c)));
  const disturbed = laps.map((l) => {
    const ranges = incidents.get(l.summary.lap) ?? [];
    return corners.map((c) => ranges.some(([from, to]) => c.ranges.some(([a, b]) => from < b && to > a)));
  });

  const cornerInsights: CornerInsight[] = corners.map((corner, ci) => {
    const times = metrics.map((m) => m[ci].segmentTime);
    const clean = times.filter((_, li) => !disturbed[li][ci]);
    const typical = clean.length ? clean : times;
    // Your best run through the corner is a clean one, if there is one.
    let bestIndex = -1;
    times.forEach((t, i) => {
      if ((clean.length === 0 || !disturbed[i][ci]) && (bestIndex < 0 || t < times[bestIndex])) bestIndex = i;
    });
    const bestLapIndex = laps.indexOf(best);
    return {
      corner,
      bestTime: times[bestIndex],
      bestLap: laps[bestIndex].summary.lap,
      meanTime: mean(typical),
      stdDev: stdDev(typical),
      potential: Math.max(0, times[bestLapIndex] - times[bestIndex]),
    };
  });

  const bestIndex = laps.indexOf(best);
  const focus = corners
    .map((corner, ci) => {
      const refIndex = metrics.findIndex((m) => m[ci].segmentTime === cornerInsights[ci].bestTime);
      if (refIndex === bestIndex) return null;
      const tips = tipsForCorner(
        corner,
        metrics[bestIndex][ci],
        metrics[refIndex][ci],
        cornerInsights[ci].potential,
        laps[refIndex].summary.lap,
      );
      return tips[0] ?? null;
    })
    .filter((t): t is CoachTip => t !== null)
    .sort((a, b) => b.timeLost - a.timeLost);

  const withoutIncidents = laps.filter((l) => !(incidents.get(l.summary.lap)?.length ?? 0));
  const lapTimes = (withoutIncidents.length >= 2 ? withoutIncidents : laps)
    .map((l) => l.summary.lapTime!)
    .filter((t) => t <= best.summary.lapTime! * 1.07);

  return {
    lapsAnalysed: laps.length,
    bestLap: { lap: best.summary.lap, time: best.summary.lapTime! },
    idealLapTime: best.summary.lapTime! - cornerInsights.reduce((sum, c) => sum + c.potential, 0),
    theoreticalBestFromSectors: empty.theoreticalBestFromSectors,
    consistency: lapTimes.length >= 2 ? { meanTime: mean(lapTimes), stdDev: stdDev(lapTimes), laps: lapTimes.length } : null,
    corners: cornerInsights,
    focus,
    habits: findHabits(laps, corners, metrics, cornerInsights, disturbed),
  };
}

function findHabits(
  laps: AnalysedLap[],
  corners: Corner[],
  metrics: CornerMetrics[][],
  insights: CornerInsight[],
  disturbed: boolean[][],
): Habit[] {
  if (laps.length < 3) return [];
  const habits: Habit[] = [];
  corners.forEach((corner, ci) => {
    const refIndex = metrics.findIndex((m) => m[ci].segmentTime === insights[ci].bestTime);
    const byKind = new Map<TipKind, CoachTip[]>();
    let judged = 0;
    laps.forEach((_, li) => {
      if (li === refIndex || disturbed[li][ci]) return;
      judged++;
      const timeLost = metrics[li][ci].segmentTime - metrics[refIndex][ci].segmentTime;
      for (const tip of tipsForCorner(corner, metrics[li][ci], metrics[refIndex][ci], timeLost)) {
        if (tip.kind === 'general') continue;
        byKind.set(tip.kind, [...(byKind.get(tip.kind) ?? []), tip]);
      }
    });
    const outOf = judged;
    if (outOf < 2) return;
    for (const [kind, tips] of byKind) {
      if (tips.length >= Math.max(2, Math.ceil(outOf * 0.4))) {
        habits.push({
          kind,
          cornerId: corner.id,
          corner: corner.name,
          count: tips.length,
          outOf,
          averageAmount: mean(tips.map((t) => t.amount)),
          averageTimeLost: mean(tips.map((t) => t.timeLost)),
        });
      }
    }
  });
  return habits.sort((a, b) => b.count * b.averageTimeLost - a.count * a.averageTimeLost);
}

export function theoreticalBestFromSectors(laps: LapSummary[]): number | null {
  const best: [number, number, number] = [Infinity, Infinity, Infinity];
  for (const lap of laps) {
    if (!lap.valid) continue;
    lap.sectors.forEach((s, i) => {
      if (s !== null && s > 0 && s < best[i]) best[i] = s;
    });
  }
  return best.every(Number.isFinite) ? best[0] + best[1] + best[2] : null;
}

export function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

export function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1));
}
