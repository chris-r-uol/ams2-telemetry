/**
 * How much of the track you use through each corner: the outside edge on the way
 * in, the inside at the apex and the outside again on the way out.
 *
 * The game doesn't send where the track edges are, but it does say when a wheel is
 * on a kerb or the painted edge. Wherever a wheel touched one on any lap, that's
 * where the edge is, measured sideways from your best lap's line. Other laps are
 * then measured against it: how far the car stayed from that edge.
 */
import type { LapSummary, LapTrace } from '../model/types.ts';
import type { Corner } from './corners.ts';
import { resampleByDistance, type ResampledLap } from './resample.ts';

export const TRACK_USE = {
  step: 2,
  /** The apex zone reaches this far either side of the slowest point, m. */
  apexZone: 20,
  /** A kerb touch marks the edge this far along the track either side, m. */
  edgeReach: 8,
  /** Laps that must have touched a kerb in a zone before its edge counts as known. */
  minEdgeLaps: 1,
};

type Side = 'left' | 'right';
const SIDE_WHEELS: Record<Side, number> = { left: 1 | 4, right: 2 | 8 };

export interface TrackUseZone {
  /** Which side of the car the edge is on. */
  side: Side;
  /** Clean laps with a wheel on that edge's kerb in this part of the corner. */
  kerbLaps: number;
  /** Median closest approach to the edge over clean laps, m; 0 when on the kerb. Null where no lap has shown where the edge is. */
  gap: number | null;
  /** The same for your best run through the corner. */
  best: { kerb: boolean; gap: number | null } | null;
}

export interface CornerTrackUse {
  cornerId: number;
  corner: string;
  laps: number;
  bestLap: number | null;
  turnIn: TrackUseZone | null;
  apex: TrackUseZone | null;
  exit: TrackUseZone | null;
  /** Clean laps with two or more wheels off the track in the corner. */
  offTrackLaps: number;
}

export interface TrackUseAnalysis {
  /** Laps recorded with kerb contact. Laps saved before it existed can't be measured. */
  lapsAnalysed: number;
  corners: CornerTrackUse[];
}

export interface TrackUseLap {
  summary: LapSummary;
  trace: LapTrace;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  return Number.isInteger(mid) ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[Math.floor(mid)];
}

/** Sideways offset of a lap from the reference line at each point: + to the left of the direction of travel. */
function offsetsFrom(reference: ResampledLap, lap: ResampledLap): number[] {
  const n = Math.min(reference.x.length, lap.x.length);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 3);
    const b = Math.min(reference.x.length - 1, i + 3);
    const tx = reference.x[b] - reference.x[a];
    const tz = reference.z[b] - reference.z[a];
    const length = Math.hypot(tx, tz) || 1;
    // x to the right and z up, so the left-hand normal is (−tz, tx).
    out[i] = ((lap.x[i] - reference.x[i]) * -tz + (lap.z[i] - reference.z[i]) * tx) / length;
  }
  return out;
}

export function analyseTrackUse(
  laps: TrackUseLap[],
  corners: Corner[],
  referenceLap: number | null,
  cornerBestLaps: Map<number, number> = new Map(),
  trackLength?: number,
): TrackUseAnalysis {
  const measured = laps.filter(
    (l) => l.summary.kind !== 'partial' && l.trace.t.length > 50 && l.trace.kerb?.length === l.trace.t.length,
  );
  const reference = measured.find((l) => l.summary.lap === referenceLap) ?? null;
  if (!reference || corners.length === 0) return { lapsAnalysed: measured.length, corners: [] };

  const step = TRACK_USE.step;
  const resampled = measured.map((l) => resampleByDistance(l.trace, step, trackLength));
  const ref = resampled[measured.indexOf(reference)];
  const offsets = resampled.map((lap) => offsetsFrom(ref, lap));
  const n = ref.x.length;
  const reach = Math.round(TRACK_USE.edgeReach / step);

  // Edges: the furthest the car's centre has been towards each side while a wheel on that side was on a kerb.
  const edges: Record<Side, number[]> = { left: new Array(n).fill(NaN), right: new Array(n).fill(NaN) };
  resampled.forEach((lap, l) => {
    for (let i = 0; i < Math.min(n, lap.kerb.length); i++) {
      for (const side of ['left', 'right'] as Side[]) {
        if ((lap.kerb[i] & SIDE_WHEELS[side]) === 0) continue;
        const o = offsets[l][i];
        for (let k = Math.max(0, i - reach); k <= Math.min(n - 1, i + reach); k++) {
          const current = edges[side][k];
          if (Number.isNaN(current) || (side === 'left' ? o > current : o < current)) edges[side][k] = o;
        }
      }
    }
  });

  const clean = measured.map((l, i) => ({ l, i })).filter(({ l }) => l.summary.kind === 'flying' && l.summary.valid);
  const index = (d: number) => Math.max(0, Math.min(n - 1, Math.round(d / step)));

  return {
    lapsAnalysed: measured.length,
    corners: corners.map((corner) => {
      const bestLap = cornerBestLaps.get(corner.id) ?? null;
      // Which way the best line turns in each part of the corner, so chicanes get the right edges.
      const turning = (from: number, to: number): Side | null => {
        let sum = 0;
        for (let i = index(from); i <= index(to); i++) sum += reference.trace.latG.length ? latAt(ref, i) : 0;
        return sum > 0 ? 'left' : sum < 0 ? 'right' : null;
      };
      const opposite = (side: Side | null): Side | null => (side === 'left' ? 'right' : side === 'right' ? 'left' : null);
      const zones = {
        turnIn: { from: corner.entry, to: corner.apex - TRACK_USE.apexZone, side: opposite(turning(corner.entry, corner.apex)) },
        apex: {
          from: corner.apex - TRACK_USE.apexZone,
          to: corner.apex + TRACK_USE.apexZone,
          side: turning(corner.apex - TRACK_USE.apexZone, corner.apex + TRACK_USE.apexZone),
        },
        exit: { from: corner.apex + TRACK_USE.apexZone, to: corner.exit, side: opposite(turning(corner.apex, corner.exit)) },
      };

      const measure = (lapIndex: number, zone: { from: number; to: number; side: Side }) => {
        const lap = resampled[lapIndex];
        let kerb = false;
        let gap = Infinity;
        for (let i = index(zone.from); i <= index(zone.to) && i < lap.kerb.length; i++) {
          if (lap.kerb[i] & SIDE_WHEELS[zone.side]) kerb = true;
          const edge = edges[zone.side][i];
          if (Number.isNaN(edge)) continue;
          const o = offsets[lapIndex][i];
          gap = Math.min(gap, Math.max(0, zone.side === 'left' ? edge - o : o - edge));
        }
        return { kerb, gap: kerb ? 0 : Number.isFinite(gap) ? gap : null };
      };

      const zone = (z: { from: number; to: number; side: Side | null }): TrackUseZone | null => {
        if (z.side === null || z.to <= z.from) return null;
        const side = z.side;
        const runs = clean.map(({ i }) => measure(i, { ...z, side }));
        const bestIndex = measured.findIndex((l) => l.summary.lap === bestLap);
        return {
          side,
          kerbLaps: runs.filter((r) => r.kerb).length,
          gap: median(runs.map((r) => r.gap).filter((g): g is number => g !== null)),
          best: bestIndex >= 0 ? measure(bestIndex, { ...z, side }) : null,
        };
      };

      const offTrackLaps = clean.filter(({ i }) => {
        const lap = resampled[i];
        for (let k = index(corner.entry); k <= index(corner.exit) && k < lap.off.length; k++) if (lap.off[k] >= 2) return true;
        return false;
      }).length;

      return {
        cornerId: corner.id,
        corner: corner.name,
        laps: clean.length,
        bestLap,
        turnIn: zone(zones.turnIn),
        apex: zone(zones.apex),
        exit: zone(zones.exit),
        offTrackLaps,
      };
    }),
  };
}

function latAt(lap: ResampledLap, i: number): number {
  return lap.latG[Math.min(i, lap.latG.length - 1)] ?? 0;
}
