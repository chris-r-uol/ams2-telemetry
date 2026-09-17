/**
 * Grip used through the corner you just drove: the g-g diagram (friction circle)
 * coaches draw, scaled so the circle is the most grip you've shown at each speed.
 * A trace that runs round the circle is using the car; where it cuts inside, grip
 * was left unused.
 */
import { useId, useRef } from 'react';
import type { GripGap, GripPhase, GripRun } from '../../shared/analysis/grip.ts';
import type { CornerProfile } from '../../shared/model/types.ts';
import { useLive } from '../lib/live.ts';
import { useElementWidth } from '../lib/useElementWidth.ts';
import { LiveCard, type CardSize } from './parts.tsx';

/** Grip left at which a strip reaches full colour. */
const FULL_GAP = 0.4;
/** Points beyond the limit are drawn no further out than this. */
const EXTENT = 1.25;

const percent = (share: number | null | undefined) =>
  share === null || share === undefined ? '–' : `${Math.round(share * 100)}%`;

const PHASE_WORDS: Record<GripGap['phase'], string> = {
  braking: 'braking',
  coasting: 'off the pedals',
  throttle: 'on part throttle',
};

function where(from: number, to: number, apex: number): string {
  const [a, b] = [from - apex, to - apex].map((m) => Math.round(m / 5) * 5);
  if (a === b) return a === 0 ? 'at the apex' : `${Math.abs(a)} m ${a < 0 ? 'before' : 'after'} the apex`;
  if (b <= 0) return `${Math.abs(a)}–${Math.abs(b)} m before the apex`;
  if (a >= 0) return `${a}–${b} m after the apex`;
  return `from ${Math.abs(a)} m before to ${b} m after the apex`;
}

function describeGap(gap: GripGap, apex: number): string {
  const words = PHASE_WORDS[gap.phase];
  return `${words[0].toUpperCase()}${words.slice(1)}, ${where(gap.from, gap.to, apex)}`;
}

export function CornerGripCard({ size }: { size: CardSize }) {
  const report = useLive((s) => s.insights?.lastCorner ?? null);
  const title = 'Last corner grip';

  if (!report) {
    return (
      <LiveCard title={title} size={size}>
        <p className="muted">Shows how much of the car's grip you used through each corner as soon as you've driven it.</p>
      </LiveCard>
    );
  }
  // Reports sent before grip was measured have none.
  if (!report.grip) {
    return (
      <LiveCard title={title} size={size} meta={report.corner}>
        <p className="muted">Learning how much grip the car has. Shows after your first full lap.</p>
      </LiveCard>
    );
  }

  const { run, best } = report.grip;
  const profile = report.profile;
  const bestLabel = report.bestLap !== null ? `Best run, lap ${report.bestLap}` : 'Best run';
  const gap = run.summary.gap;
  const summary =
    `Grip used through ${report.corner}: ${percent(run.summary.use)} of the most you've shown` +
    (best ? `, against ${percent(best.summary.use)} on your best run.` : '.') +
    (gap ? ` Most grip left ${describeGap(gap, profile.apex).toLowerCase()}, ${percent(gap.use)} for ${gap.seconds.toFixed(1)} s.` : '');

  if (size === 'glance') {
    return (
      <LiveCard title={title} size={size} meta={report.corner}>
        <div className="gc-split">
          <GripCircle run={run} best={best} summary={summary} maxSize={200} />
          <div className="gc-side">
            <p className="gc-hero">
              <span className="gc-hero-value tabular">{percent(run.summary.use)}</span>
              <span className="gc-hero-label">grip used</span>
            </p>
            {best && <p className="muted gc-best-line">Best run {percent(best.summary.use)}</p>}
            {gap ? (
              <p className="gc-cue">
                <span className="gc-cue-label">Most grip left</span>
                {describeGap(gap, profile.apex)}
              </p>
            ) : (
              <p className="muted">No big gaps.</p>
            )}
          </div>
        </div>
        <GripLegend best={best !== null} bestLabel={bestLabel} />
      </LiveCard>
    );
  }

  const rows: [string, (s: GripRun['summary']) => GripPhase | { use: number | null; seconds: null }][] = [
    ['Whole corner', (s) => ({ use: s.use, seconds: null })],
    ['Braking', (s) => s.braking],
    ['Off the pedals', (s) => s.coasting],
    ['Part throttle', (s) => s.throttle],
  ];
  const cell = (phase: GripPhase | { use: number | null; seconds: null }) =>
    phase.use === null || (phase.seconds !== null && phase.seconds < 0.05)
      ? '–'
      : `${percent(phase.use)}${phase.seconds !== null ? ` · ${phase.seconds.toFixed(1)} s` : ''}`;
  const contact = run.skip.some((s) => s === 'incident');

  return (
    <LiveCard title={title} size={size} meta={`${report.corner} · lap ${report.lap}`}>
      <div className="cl-split">
        <div>
          <GripCircle run={run} best={best} summary={summary} maxSize={320} />
          <GripLegend best={best !== null} bestLabel={bestLabel} />
        </div>
        <div className="cl-side">
          <GripRugs run={run} best={best} profile={profile} />
          <table className="gc-table">
            <caption className="visually-hidden">Grip used in each part of the corner, and for how long</caption>
            <thead>
              <tr>
                <td />
                <th scope="col">You</th>
                {best && <th scope="col">{bestLabel}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, pick]) => (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  <td className="tabular">{cell(pick(run.summary))}</td>
                  {best && <td className="tabular">{cell(pick(best.summary))}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          {gap && (
            <p className="gc-gap">
              <strong>Most grip left:</strong> {describeGap(gap, profile.apex).toLowerCase()}, using {percent(gap.use)} for{' '}
              {gap.seconds.toFixed(1)} s.
            </p>
          )}
          {contact && <p className="muted gc-note">Contact or a spin here isn't counted.</p>}
          <p className="muted cl-hint">
            The circle is the most grip you've shown at each speed this session, braking, turning or both at once.
            Flat out and swinging from one direction to the other don't count: the engine is the limit there, and grip
            has to pass through zero.
          </p>
        </div>
      </div>
    </LiveCard>
  );
}

function GripLegend({ best, bestLabel }: { best: boolean; bestLabel: string }) {
  return (
    <p className="cp-legend">
      <span className="legend-item">
        <span className="key key-own" aria-hidden="true" />
        This run
      </span>
      {best && (
        <span className="legend-item">
          <span className="key key-reference" aria-hidden="true" />
          {bestLabel}
        </span>
      )}
      <span className="legend-item">
        <span className="key gc-key-skip" aria-hidden="true" />
        Not counted
      </span>
    </p>
  );
}

/** The g-g diagram: sideways against fore-aft g, each as a share of the grip available at that moment. */
function GripCircle({
  run,
  best,
  summary,
  maxSize,
}: {
  run: GripRun;
  best: GripRun | null;
  summary: string;
  maxSize: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref);
  const arrowId = `gc-arrow-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const padX = 40;
  const padY = 18;
  const plot = Math.max(0, Math.min(maxSize, width - padX * 2));
  const radius = plot / 2 / EXTENT;
  const cx = padX + plot / 2;
  const cy = padY + plot / 2;
  const svgWidth = plot + padX * 2;
  const svgHeight = plot + padY * 2;
  // Left turns on the left, accelerating up, braking down.
  const project = (lat: number, lon: number): [number, number] => {
    const r = Math.hypot(lat, lon);
    const k = r > EXTENT ? EXTENT / r : 1;
    return [cx - lat * k * radius, cy - lon * k * radius];
  };
  /** Counted points only, or every point. */
  const pathOf = (r: GripRun, countedOnly: boolean) => {
    let d = '';
    let pen = false;
    r.lat.forEach((lat, i) => {
      const lon = r.lon[i];
      if (lat === null || lon === null || (countedOnly && r.use[i] === null)) {
        pen = false;
        return;
      }
      const [x, y] = project(lat, lon);
      d += `${pen ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const diagonal = radius * Math.SQRT1_2;

  return (
    <figure className="grip-circle">
      <div ref={ref}>
        {radius > 10 && (
          <svg width={svgWidth} height={svgHeight} role="img" aria-label={summary}>
            <defs>
              <marker id={arrowId} viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M0,0 L10,5 L0,10 z" className="gc-arrow" />
              </marker>
            </defs>
            <circle className="gc-limit" cx={cx} cy={cy} r={radius} />
            <circle className="gc-half" cx={cx} cy={cy} r={radius / 2} />
            <line className="gc-axis" x1={cx - radius * EXTENT} x2={cx + radius * EXTENT} y1={cy} y2={cy} />
            <line className="gc-axis" x1={cx} x2={cx} y1={cy - radius * EXTENT} y2={cy + radius * EXTENT} />
            {best && <path className="gc-best" d={pathOf(best, true)} />}
            <path className="gc-own-all" d={pathOf(run, false)} markerEnd={`url(#${arrowId})`} />
            <path className="gc-own" d={pathOf(run, true)} />
            <text className="cp-axis gc-label" x={cx + diagonal + 4} y={cy - diagonal - 4}>
              100%
            </text>
            <text className="cp-axis gc-label" x={cx + radius / 2 + 3} y={cy + 12}>
              50%
            </text>
            <text className="cp-axis" x={cx} y={padY - 6} textAnchor="middle">
              Accelerating
            </text>
            <text className="cp-axis" x={cx} y={svgHeight - 3} textAnchor="middle">
              Braking
            </text>
            <text className="cp-axis" x={padX - 6} y={cy} textAnchor="end" dominantBaseline="middle">
              Left
            </text>
            <text className="cp-axis" x={svgWidth - padX + 6} y={cy} dominantBaseline="middle">
              Right
            </text>
          </svg>
        )}
      </div>
    </figure>
  );
}

/** Where along the corner grip was left, you above your best run. */
function GripRugs({ run, best, profile }: { run: GripRun; best: GripRun | null; profile: CornerProfile }) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref);
  const hatchId = `gc-hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const rows = [
    { label: 'You', run },
    ...(best ? [{ label: 'Best', run: best }] : []),
  ];

  const n = Math.max(...rows.map((row) => row.run.use.length));
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
  const summary = `Grip left along the corner: ${rows
    .map((row) => `${row.label}, ${percent(row.run.summary.use)} used overall`)
    .join('; ')}.`;

  return (
    <figure className="steer-rugs">
      <div ref={ref}>
        {width > 0 && n > 1 && (
          <svg width={width} height={height} role="img" aria-label={summary}>
            <defs>
              <pattern id={hatchId} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line className="gc-hatch" x1="0" y1="0" x2="0" y2="5" />
              </pattern>
            </defs>
            {rows.map((row, r) => (
              <g key={row.label}>
                <text className="cp-axis" x={labelWidth - 8} y={rowTop(r) + bandHeight / 2} textAnchor="end" dominantBaseline="middle">
                  {row.label}
                </text>
                {row.run.use.map((u, i) => {
                  const skip = row.run.skip[i];
                  if (skip === 'unknown') return null;
                  const props = { x: x(i) - cell / 2, y: rowTop(r), width: cell + 0.5, height: bandHeight };
                  if (u === null) return <rect key={i} {...props} fill={`url(#${hatchId})`} />;
                  const left = Math.max(0, 1 - u);
                  return left > 0 ? (
                    <rect key={i} {...props} className="gc-left" fillOpacity={Math.min(1, left / FULL_GAP)} />
                  ) : null;
                })}
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
          Grip left <span className="ramp-label">none</span>{' '}
          <span className="ramp gc-ramp" aria-hidden="true" /> <span className="ramp-label">{percent(FULL_GAP)}+</span>
        </span>
        <span className="legend-item">
          <span className="swatch gc-swatch-skip" aria-hidden="true" />
          Not counted
        </span>
      </figcaption>
    </figure>
  );
}
