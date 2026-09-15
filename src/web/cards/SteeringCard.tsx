/**
 * Steering through the corner you just drove, against your best run: the line
 * each took, seen from above, and how much steering each used along the way.
 * A short, sharp peak of steering is a V line; a long, even hold is a U line.
 */
import { useId, useRef } from 'react';
import type { CornerProfile } from '../../shared/model/types.ts';
import { colourAt, colourGradient } from '../lib/colormaps.ts';
import { useLive } from '../lib/live.ts';
import { useSettings } from '../lib/settings.ts';
import { useElementWidth } from '../lib/useElementWidth.ts';
import { LiveCard, type CardSize } from './parts.tsx';

type Series = (number | null)[];
type Point = [number, number];

interface SteeringShape {
  /** −1 full left to 1 full right. */
  peak: number;
  /** Metres from the apex: negative before it, positive after. */
  peakFromApex: number;
  /** Metres spent at 80% or more of the peak, turning the same way. */
  held: number;
}

/** Rolling median over five samples (about 10 m), so a momentary correction doesn't count as the line's peak. */
function smooth(values: Series): Series {
  return values.map((v, i) => {
    if (v === null) return null;
    const window = values.slice(Math.max(0, i - 2), i + 3).filter((w): w is number => w !== null).sort((a, b) => a - b);
    return window[Math.floor(window.length / 2)];
  });
}

function steeringShape(raw: Series, profile: CornerProfile): SteeringShape | null {
  const values = smooth(raw);
  let peak = 0;
  let peakIndex = -1;
  values.forEach((v, i) => {
    if (v !== null && Math.abs(v) > Math.abs(peak)) {
      peak = v;
      peakIndex = i;
    }
  });
  if (peakIndex < 0 || Math.abs(peak) < 0.02) return null;
  const near = values.filter((v) => v !== null && Math.sign(v) === Math.sign(peak) && Math.abs(v) >= 0.8 * Math.abs(peak));
  return { peak, peakFromApex: profile.from + peakIndex * profile.step - profile.apex, held: near.length * profile.step };
}

const percent = (v: number) => `${Math.round(Math.abs(v) * 100)}%`;
const where = (metres: number) =>
  Math.abs(metres) < 5 ? 'at the apex' : `${Math.round(Math.abs(metres))} m ${metres < 0 ? 'before' : 'after'} the apex`;

function describe(shape: SteeringShape | null): string {
  if (!shape) return 'no clear steering';
  return `${percent(shape.peak)} ${shape.peak < 0 ? 'left' : 'right'} ${where(shape.peakFromApex)}, held near that for ${Math.round(shape.held)} m`;
}

export function CornerSteeringCard({ size }: { size: CardSize }) {
  const report = useLive((s) => s.insights?.lastCorner ?? null);
  const { mirrorMap } = useSettings();
  const title = 'Last corner steering';

  if (!report) {
    return (
      <LiveCard title={title} size={size}>
        <p className="muted">Shows your line and steering through each corner as soon as you've driven it, once there's a reference lap.</p>
      </LiveCard>
    );
  }

  const profile = report.profile;
  // Profiles sent before this card existed have no steering or line.
  const hasBest = (profile.bestSteering ?? []).some((v) => v !== null);
  const own = steeringShape(profile.steering ?? [], profile);
  const best = hasBest ? steeringShape(profile.bestSteering ?? [], profile) : null;
  const bestLabel = report.bestLap !== null ? `Best run, lap ${report.bestLap}` : 'Best run';

  const map = (
    <CornerLineMap profile={profile} bestLabel={bestLabel} mirror={mirrorMap} maxHeight={size === 'full' ? 260 : 150} />
  );
  const rugs = <SteeringRugs profile={profile} corner={report.corner} own={own} best={best} bestLabel={bestLabel} />;

  if (size === 'glance') {
    return (
      <LiveCard title={title} size={size} meta={report.corner}>
        {map}
        {rugs}
      </LiveCard>
    );
  }

  return (
    <LiveCard title={title} size={size} meta={`${report.corner} · lap ${report.lap}`}>
      <div className="cl-split">
        {map}
        <div className="cl-side">
          {rugs}
          <dl className="cl-facts">
            <div>
              <dt>You</dt>
              <dd>{describe(own)}</dd>
            </div>
            {hasBest && (
              <div>
                <dt>{bestLabel}</dt>
                <dd>{describe(best)}</dd>
              </div>
            )}
          </dl>
          <p className="muted cl-hint">
            A short, sharp peak of steering is a V line: a late, tight turn with more braking and accelerating in a
            straight line. A long, even hold is a U line: a rounder arc carrying more speed.
          </p>
        </div>
      </div>
    </LiveCard>
  );
}

/** Both lines through the corner from above, oriented like the track map. */
function CornerLineMap({
  profile,
  bestLabel,
  mirror,
  maxHeight,
}: {
  profile: CornerProfile;
  bestLabel: string;
  mirror: boolean;
  maxHeight: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref);
  const arrowId = `cl-arrow-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const pointsOf = (xs: Series | undefined, zs: Series | undefined) =>
    (xs ?? []).map((px, i): Point | null => {
      const pz = zs?.[i];
      return px !== null && pz !== null && pz !== undefined ? [px, pz] : null;
    });
  const own = pointsOf(profile.x, profile.z);
  const best = pointsOf(profile.bestX, profile.bestZ);
  const all = [...own, ...best].filter((p): p is Point => p !== null);
  const hasBest = best.some((p) => p !== null);

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [px, pz] of all) {
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
    minZ = Math.min(minZ, pz);
    maxZ = Math.max(maxZ, pz);
  }
  const pad = 14;
  const spanX = Math.max(1, maxX - minX);
  const spanZ = Math.max(1, maxZ - minZ);
  const scale = width > pad * 2 ? Math.min((width - pad * 2) / spanX, (maxHeight - pad * 2) / spanZ) : 0;
  const drawnWidth = spanX * scale;
  const height = spanZ * scale + pad * 2;
  const left = (width - drawnWidth) / 2;
  const project = ([px, pz]: Point): Point => {
    const sx = (px - minX) * scale;
    return [left + (mirror ? drawnWidth - sx : sx), pad + (maxZ - pz) * scale];
  };
  const pathOf = (series: (Point | null)[]) => {
    let d = '';
    let pen = false;
    for (const point of series) {
      if (!point) {
        pen = false;
        continue;
      }
      const [sx, sy] = project(point);
      d += `${pen ? 'L' : 'M'}${sx.toFixed(1)},${sy.toFixed(1)}`;
      pen = true;
    }
    return d;
  };
  const apexIndex = Math.round((profile.apex - profile.from) / profile.step);
  const apex = own[apexIndex] ?? best[apexIndex] ?? null;
  const start = own.find((p) => p !== null) ?? null;

  return (
    <figure className="corner-line">
      <div ref={ref}>
        {all.length < 3 ? (
          <p className="muted">No position data for this corner.</p>
        ) : (
          scale > 0 && (
            <svg width={width} height={height} role="img" aria-label="Your line through the corner, seen from above, drawn over your best run's">
              <defs>
                <marker id={arrowId} viewBox="0 0 10 10" refX="6" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                  <path d="M0,0 L10,5 L0,10 z" className="cl-arrow" />
                </marker>
              </defs>
              {hasBest && <path className="cl-best" d={pathOf(best)} />}
              <path className="cl-own" d={pathOf(own)} markerEnd={`url(#${arrowId})`} />
              {start && <circle className="cl-start" cx={project(start)[0]} cy={project(start)[1]} r={3.5} />}
              {apex && (
                <g>
                  <circle className="cl-apex" cx={project(apex)[0]} cy={project(apex)[1]} r={5} />
                  <text className="cp-axis" x={project(apex)[0] + 9} y={project(apex)[1] - 7}>
                    Apex
                  </text>
                </g>
              )}
            </svg>
          )
        )}
      </div>
      <figcaption className="cp-legend">
        <span className="legend-item">
          <span className="key key-own" aria-hidden="true" />
          Your line
        </span>
        {hasBest && (
          <span className="legend-item">
            <span className="key key-reference" aria-hidden="true" />
            {bestLabel}
          </span>
        )}
      </figcaption>
    </figure>
  );
}

/** Steering along the corner as colour strips, you above your best run, on one shared scale. */
function SteeringRugs({
  profile,
  corner,
  own,
  best,
  bestLabel,
}: {
  profile: CornerProfile;
  corner: string;
  own: SteeringShape | null;
  best: SteeringShape | null;
  bestLabel: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref);
  const rows = [
    { label: 'You', values: profile.steering ?? [] },
    { label: 'Best', values: profile.bestSteering ?? [] },
  ].filter((row) => row.values.some((v) => v !== null));

  if (rows.length === 0) {
    return <p className="muted">No steering data for this corner.</p>;
  }

  const n = Math.max(...rows.map((row) => row.values.length));
  // One scale for both strips, set by your best run's peak (rounded up to 5%). Full colour means as much steering
  // as your best run needed; anything more (a correction, a slide) stays at full colour instead of washing out the rest.
  const limit = Math.max(0.05, Math.ceil(Math.abs((best ?? own)?.peak ?? 0.1) * 20) / 20);
  const labelWidth = 44;
  const bandHeight = 16;
  const gap = 6;
  const plotWidth = Math.max(10, width - labelWidth - 4);
  const x = (i: number) => labelWidth + (n > 1 ? (i / (n - 1)) * plotWidth : 0);
  const cell = n > 1 ? plotWidth / (n - 1) : plotWidth;
  const rowTop = (row: number) => row * (bandHeight + gap);
  const bottom = rowTop(rows.length) - gap;
  const height = bottom + 20;
  const apexX = x((profile.apex - profile.from) / profile.step);
  const tone = (v: number) => colourAt('steering', (Math.max(-limit, Math.min(limit, v)) / limit + 1) / 2);
  const summary = `Steering through ${corner}. You: ${describe(own)}.${rows.length > 1 ? ` ${bestLabel}: ${describe(best)}.` : ''}`;

  return (
    <figure className="steer-rugs">
      <div ref={ref}>
        {width > 0 && n > 1 && (
          <svg width={width} height={height} role="img" aria-label={summary}>
            {rows.map((row, r) => (
              <g key={row.label}>
                <text className="cp-axis" x={labelWidth - 8} y={rowTop(r) + bandHeight / 2} textAnchor="end" dominantBaseline="middle">
                  {row.label}
                </text>
                {row.values.map((v, i) =>
                  v === null ? null : (
                    <rect key={i} x={x(i) - cell / 2} y={rowTop(r)} width={cell + 0.5} height={bandHeight} fill={tone(v)} />
                  ),
                )}
                <rect className="cp-rug-track" x={labelWidth - cell / 2} y={rowTop(r)} width={plotWidth + cell} height={bandHeight} />
              </g>
            ))}
            {apexX >= labelWidth && apexX <= labelWidth + plotWidth && (
              <g>
                <line className="steer-apex" x1={apexX} x2={apexX} y1={bottom} y2={bottom + 5} />
                <text className="cp-axis" x={apexX} y={height - 2} textAnchor="middle">
                  Apex
                </text>
              </g>
            )}
          </svg>
        )}
      </div>
      <figcaption className="cp-legend">
        <span className="legend-item">
          Steering <span className="ramp-label">{percent(limit)}+ left</span>{' '}
          <span className="ramp" style={{ backgroundImage: colourGradient('steering') }} aria-hidden="true" />{' '}
          <span className="ramp-label">{percent(limit)}+ right</span>
        </span>
      </figcaption>
    </figure>
  );
}
