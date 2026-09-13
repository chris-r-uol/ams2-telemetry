/**
 * "Coachwood Park": a fictional ~4 km circuit used by demo mode.
 *
 * The layout is a closed Catmull-Rom spline through hand-placed control
 * points, resampled to ~1 m spacing with heading and curvature per point.
 */

export interface DemoTrack {
  location: string;
  variation: string;
  length: number;
  /** Metres between consecutive points (the loop closes exactly). */
  step: number;
  x: number[];
  z: number[];
  heading: number[];
  /** Signed curvature, 1/m. Positive turns left (anticlockwise seen from above). */
  curvature: number[];
  sectorEnds: [number, number];
}

type Point = [number, number];

// Metres. Driven in this order; the start/finish line is the first point.
const CONTROL_POINTS: Point[] = [
  [0, 0],
  [420, 0],
  [820, 0],
  [925, 30],
  [950, 110],
  [900, 190],
  [770, 260],
  [610, 300],
  [530, 380],
  [560, 500],
  [700, 565],
  [900, 585],
  [1120, 565],
  [1400, 525],
  [1520, 560],
  [1560, 650],
  [1500, 720],
  [1370, 705],
  [1210, 760],
  [1090, 860],
  [950, 885],
  [800, 960],
  [590, 985],
  [320, 965],
  [190, 905],
  [150, 820],
  [60, 760],
  [-80, 700],
  [-175, 560],
  [-195, 380],
  [-160, 200],
  [-95, 60],
  [-40, 8],
];

function catmullRom(p0: Point, p1: Point, p2: Point, p3: Point, u: number): Point {
  // Centripetal parameterisation avoids cusps and self-intersections.
  const knot = (a: Point, b: Point) => Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])) || 1e-6;
  const t0 = 0;
  const t1 = t0 + knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const t = t1 + (t2 - t1) * u;
  const mix = (a: Point, b: Point, ta: number, tb: number): Point => {
    const w = (t - ta) / (tb - ta);
    return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w];
  };
  const a1 = mix(p0, p1, t0, t1);
  const a2 = mix(p1, p2, t1, t2);
  const a3 = mix(p2, p3, t2, t3);
  const b1 = mix(a1, a2, t0, t2);
  const b2 = mix(a2, a3, t1, t3);
  return mix(b1, b2, t1, t2);
}

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export function buildDemoTrack(): DemoTrack {
  const pts = CONTROL_POINTS;
  const n = pts.length;
  const dense: Point[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    for (let s = 0; s < 300; s++) dense.push(catmullRom(p0, p1, p2, p3, s / 300));
  }

  const cumulative = [0];
  for (let i = 1; i <= dense.length; i++) {
    const a = dense[i - 1];
    const b = dense[i % dense.length];
    cumulative.push(cumulative[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const length = cumulative[cumulative.length - 1];
  const count = Math.floor(length);
  const step = length / count;

  const x: number[] = [];
  const z: number[] = [];
  let j = 0;
  for (let i = 0; i < count; i++) {
    const target = i * step;
    while (cumulative[j + 1] < target) j++;
    const f = (target - cumulative[j]) / (cumulative[j + 1] - cumulative[j] || 1);
    const a = dense[j];
    const b = dense[(j + 1) % dense.length];
    x.push(a[0] + (b[0] - a[0]) * f);
    z.push(a[1] + (b[1] - a[1]) * f);
  }

  const heading = x.map((_, i) => {
    const k = (i + 1) % count;
    return Math.atan2(z[k] - z[i], x[k] - x[i]);
  });
  const raw = heading.map((h, i) => wrapAngle(h - heading[(i - 1 + count) % count]) / step);

  // Smooth curvature (wrap-aware) so the speed profile has no spikes.
  const radius = 8;
  const curvature = raw.map((_, i) => {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += raw[(i + k + count) % count];
    return sum / (radius * 2 + 1);
  });

  return {
    location: 'Coachwood Park',
    variation: 'Grand Prix',
    length,
    step,
    x,
    z,
    heading,
    curvature,
    sectorEnds: [Math.round(length * 0.34), Math.round(length * 0.68)],
  };
}
