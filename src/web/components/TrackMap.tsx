/**
 * Track map drawn from a lap's own x/z positions. Corners are labelled, and
 * when a comparison is given each corner's stretch of track is coloured by
 * time gained or lost, with the signed value printed beside the label.
 */
import { useMemo } from 'react';
import type { Corner } from '../../shared/analysis/corners.ts';
import { formatDelta } from '../../shared/format.ts';

export interface MapSegment {
  corner: Corner;
  timeDelta: number;
}

interface TrackMapProps {
  x: number[];
  z: number[];
  /** Metres between points in x/z. */
  step: number;
  title: string;
  car?: { x: number; z: number } | null;
  markerDistance?: number | null;
  corners?: Corner[];
  segments?: MapSegment[];
  mirror?: boolean;
}

const SIZE = 1000;
const PAD = 120;
const SEGMENT_THRESHOLD = 0.02;
const LABEL_OFFSETS = [46, 96, 146];
const LABEL_CLEARANCE = 66;

type Point = [number, number];

export function TrackMap({ x, z, step, title, car, markerDistance, corners = [], segments, mirror = false }: TrackMapProps) {
  const geometry = useMemo(() => {
    if (x.length < 10) return null;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < x.length; i++) {
      minX = Math.min(minX, x[i]);
      maxX = Math.max(maxX, x[i]);
      minZ = Math.min(minZ, z[i]);
      maxZ = Math.max(maxZ, z[i]);
    }
    const scale = (SIZE - PAD * 2) / Math.max(maxX - minX, maxZ - minZ, 1);
    const width = (maxX - minX) * scale + PAD * 2;
    const height = (maxZ - minZ) * scale + PAD * 2;
    const project = (px: number, pz: number): Point => {
      const sx = PAD + (px - minX) * scale;
      return [mirror ? width - sx : sx, PAD + (maxZ - pz) * scale];
    };
    const indexAt = (d: number) => Math.max(0, Math.min(x.length - 1, Math.round(d / step)));
    const pointAt = (d: number) => project(x[indexAt(d)], z[indexAt(d)]);
    const pathFor = (from: number, to: number) => {
      const a = indexAt(from);
      const b = indexAt(to);
      let d = '';
      for (let i = a; i <= b; i += i + 2 <= b ? 2 : 1) {
        const [sx, sy] = project(x[i], z[i]);
        d += `${i === a ? 'M' : 'L'}${sx.toFixed(1)},${sy.toFixed(1)}`;
      }
      return d;
    };
    // Label candidates on the side of the track facing away from the circuit's middle.
    const labelCandidates = (d: number): Point[] => {
      const i = indexAt(d);
      const [ax, ay] = project(x[Math.max(0, i - 5)], z[Math.max(0, i - 5)]);
      const [bx, by] = project(x[Math.min(x.length - 1, i + 5)], z[Math.min(x.length - 1, i + 5)]);
      const [px, py] = project(x[i], z[i]);
      const len = Math.hypot(bx - ax, by - ay) || 1;
      let nx = -(by - ay) / len;
      let ny = (bx - ax) / len;
      if (Math.hypot(px + nx - width / 2, py + ny - height / 2) < Math.hypot(px - nx - width / 2, py - ny - height / 2)) {
        nx = -nx;
        ny = -ny;
      }
      return LABEL_OFFSETS.map((offset) => [px + nx * offset, py + ny * offset]);
    };
    return { width, height, project, pathFor, pointAt, labelCandidates, outline: `${pathFor(0, (x.length - 1) * step)}Z` };
  }, [x, z, step, mirror]);

  if (!geometry) {
    return (
      <div className="track-map-empty" role="img" aria-label={`${title}: no lap recorded yet`}>
        The map appears after your first complete lap.
      </div>
    );
  }

  const { width, height, project, pathFor, pointAt, labelCandidates, outline } = geometry;
  const segmentFor = new Map(segments?.map((s) => [s.corner.id, s]));
  const marker = markerDistance !== null && markerDistance !== undefined ? pointAt(markerDistance) : null;
  const carPoint = car && (car.x !== 0 || car.z !== 0) ? project(car.x, car.z) : null;
  const [sx, sy] = pointAt(0);

  // Step labels further out when they would collide with one already placed.
  const placed: Point[] = [];
  const labels = corners.map((corner) => {
    const candidates = labelCandidates(corner.apex);
    const position =
      candidates.find((c) => placed.every((p) => Math.hypot(p[0] - c[0], p[1] - c[1]) >= LABEL_CLEARANCE)) ??
      candidates[candidates.length - 1];
    placed.push(position);
    return { corner, position };
  });

  return (
    <svg className="track-map" viewBox={`0 0 ${width.toFixed(0)} ${height.toFixed(0)}`} role="img" aria-label={title}>
      <title>{title}</title>
      <path d={outline} className="map-outline" />
      {segments
        ?.filter((s) => Math.abs(s.timeDelta) >= SEGMENT_THRESHOLD)
        .flatMap((s) =>
          s.corner.ranges.map(([from, to], k) => (
            <path
              key={`${s.corner.id}-${k}`}
              d={pathFor(from, to)}
              className={`map-segment ${s.timeDelta > 0 ? 'is-slower' : 'is-faster'}`}
            />
          )),
        )}
      <circle cx={sx} cy={sy} r={9} className="map-start" />
      {labels.map(({ corner, position: [lx, ly] }) => {
        const segment = segmentFor.get(corner.id);
        const showDelta = segment && Math.abs(segment.timeDelta) >= SEGMENT_THRESHOLD;
        return (
          <g key={corner.id} className="map-label">
            <text x={lx} y={showDelta ? ly - 14 : ly} textAnchor="middle" dominantBaseline="middle">
              {corner.name}
            </text>
            {showDelta && (
              <text x={lx} y={ly + 16} textAnchor="middle" dominantBaseline="middle" className="map-label-delta">
                {formatDelta(segment.timeDelta, 2)}
              </text>
            )}
          </g>
        );
      })}
      {marker && <circle cx={marker[0]} cy={marker[1]} r={12} className="map-marker" />}
      {carPoint && <circle cx={carPoint[0]} cy={carPoint[1]} r={15} className="map-car" />}
    </svg>
  );
}
