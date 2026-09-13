/**
 * Turns corner-by-corner differences into specific, ranked driving advice.
 *
 * Every tip is relative to a reference you have actually driven (your best lap,
 * or your best run through that corner), so the advice is always achievable.
 */
import type { Corner } from './corners.ts';
import { deltaTrace } from './delta.ts';
import { cornerMetrics, type CornerMetrics } from './metrics.ts';
import type { ResampledLap } from './resample.ts';

export type TipKind =
  | 'brake-later'
  | 'brake-earlier'
  | 'carry-speed'
  | 'over-driving'
  | 'throttle-earlier'
  | 'exit-speed'
  | 'coasting'
  | 'track-limits'
  | 'general';

export interface CoachTip {
  kind: TipKind;
  cornerId: number;
  corner: string;
  /** Seconds lost through this corner compared with the reference. */
  timeLost: number;
  /** Size of the difference behind the tip: metres for distances, m/s for speeds. */
  amount: number;
  /** Lap number the reference for this corner came from, when known. */
  referenceLap?: number | null;
}

export interface CornerComparison {
  corner: Corner;
  lap: CornerMetrics;
  reference: CornerMetrics;
  /** Positive: slower than reference through this corner. */
  timeDelta: number;
  tips: CoachTip[];
}

export interface LapComparison {
  delta: number[];
  totalDelta: number;
  corners: CornerComparison[];
}

/** Differences smaller than these are treated as noise. */
export const THRESHOLDS = {
  timeLost: 0.03, // s
  brakeMetres: 8,
  throttleMetres: 10,
  speed: 0.83, // m/s, 3 km/h
  coastMetres: 15,
  general: 0.08, // s
} as const;

export function tipsForCorner(
  corner: Corner,
  lap: CornerMetrics,
  reference: CornerMetrics,
  timeDelta: number,
  referenceLap: number | null = null,
): CoachTip[] {
  const tips: CoachTip[] = [];
  const tip = (kind: TipKind, amount: number) =>
    tips.push({ kind, cornerId: corner.id, corner: corner.name, timeLost: timeDelta, amount, referenceLap });

  if (lap.offTrack && !reference.offTrack) tip('track-limits', 0);
  if (timeDelta < THRESHOLDS.timeLost) return tips;

  // Positive: braked earlier (further from the apex) than the reference.
  const brakeEarlierBy =
    lap.brakePoint !== null && reference.brakePoint !== null ? reference.brakePoint - lap.brakePoint : 0;
  const minSpeedDiff = lap.minSpeed - reference.minSpeed;
  const exitSpeedDiff = lap.exitSpeed - reference.exitSpeed;
  const throttleLaterBy =
    lap.throttlePoint !== null && reference.throttlePoint !== null ? lap.throttlePoint - reference.throttlePoint : 0;

  if (brakeEarlierBy >= THRESHOLDS.brakeMetres && minSpeedDiff <= THRESHOLDS.speed * 0.75) {
    tip('brake-later', brakeEarlierBy);
  } else if (brakeEarlierBy <= -THRESHOLDS.brakeMetres && minSpeedDiff <= -THRESHOLDS.speed) {
    tip('brake-earlier', -brakeEarlierBy);
  }

  if (minSpeedDiff >= THRESHOLDS.speed * 0.66 && exitSpeedDiff <= -THRESHOLDS.speed) {
    tip('over-driving', exitSpeedDiff * -1);
  } else if (minSpeedDiff <= -THRESHOLDS.speed && !tips.some((t) => t.kind === 'brake-earlier')) {
    tip('carry-speed', -minSpeedDiff);
  }

  if (throttleLaterBy >= THRESHOLDS.throttleMetres) tip('throttle-earlier', throttleLaterBy);

  if (
    exitSpeedDiff <= -THRESHOLDS.speed &&
    !tips.some((t) => t.kind === 'carry-speed' || t.kind === 'over-driving' || t.kind === 'throttle-earlier')
  ) {
    tip('exit-speed', -exitSpeedDiff);
  }

  if (lap.coastDistance - reference.coastDistance >= THRESHOLDS.coastMetres) tip('coasting', lap.coastDistance);

  if (tips.length === 0 && timeDelta >= THRESHOLDS.general) tip('general', 0);
  return tips;
}

export function compareLaps(
  lap: ResampledLap,
  reference: ResampledLap,
  corners: Corner[],
  referenceLap: number | null = null,
): LapComparison {
  const delta = deltaTrace(lap, reference);
  const cornerComparisons = corners.map((corner) => {
    const lapMetrics = cornerMetrics(lap, corner);
    const refMetrics = cornerMetrics(reference, corner);
    const timeDelta = lapMetrics.segmentTime - refMetrics.segmentTime;
    return {
      corner,
      lap: lapMetrics,
      reference: refMetrics,
      timeDelta,
      tips: tipsForCorner(corner, lapMetrics, refMetrics, timeDelta, referenceLap),
    };
  });
  return {
    delta,
    totalDelta: delta.length ? delta[delta.length - 1] : 0,
    corners: cornerComparisons,
  };
}

/** The single most useful tip per corner, biggest time loss first. */
export function topTips(corners: CornerComparison[], limit = 3): CoachTip[] {
  return corners
    .filter((c) => c.tips.length > 0)
    .sort((a, b) => b.timeDelta - a.timeDelta)
    .slice(0, limit)
    .map((c) => c.tips[0]);
}
