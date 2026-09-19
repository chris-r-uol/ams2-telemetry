/**
 * Trail braking as "string theory": pedal against steering through the corner
 * you just drove. A string from the wheel to the brake pulls the brake off as the
 * lock goes on; one to the throttle lets it down as the lock comes off. The dashed
 * diagonal is that string. Your best run through the corner is drawn underneath.
 */
import { useId, useRef } from 'react';
import { stringTheory, type StringPoint, type StringTheory } from '../../shared/analysis/string-theory.ts';
import { useLive } from '../lib/live.ts';
import { fitsHeight, useElementSize } from '../lib/useElementSize.ts';
import { LiveCard, type CardSize } from './parts.tsx';

const pct = (share: number | null | undefined) => (share === null || share === undefined ? '–' : `${Math.round(share * 100)}%`);

interface Facts {
  brakeOff: string;
  heavy: string;
  flatOut: string;
  atLock: string;
}

function facts(s: StringTheory | null): Facts {
  return {
    brakeOff: !s?.entry ? 'No braking' : s.entry.brakeOffAt < 0.05 ? 'Before turning in' : `At ${pct(s.entry.brakeOffAt)} lock`,
    heavy: s?.entry ? pct(s.entry.heavyWithLock) : '–',
    flatOut: !s?.exit ? '–' : s.exit.flatOutAt === null ? 'Not by the exit' : `With ${pct(s.exit.flatOutAt)} lock on`,
    atLock: s?.exit ? pct(s.exit.throttleAtLock) : '–',
  };
}

/** The difference from your best run most worth knowing about, or a general pointer without one. */
function standout(run: StringTheory, best: StringTheory | null): string | null {
  const inRun = run.entry;
  const inBest = best?.entry ?? null;
  const outRun = run.exit;
  const outBest = best?.exit ?? null;
  if (inRun && inRun.heavyWithLock >= 0.5 && (!inBest || inRun.heavyWithLock - inBest.heavyWithLock >= 0.25)) {
    return `Still ${pct(inRun.heavyWithLock)} brake with half the lock on${inBest ? `, against ${pct(inBest.heavyWithLock)} on your best run` : ''}: that asks the front for too much at once.`;
  }
  if (inRun && inBest && inBest.brakeOffAt - inRun.brakeOffAt >= 0.2) {
    return `Your best run kept a little brake on until ${pct(inBest.brakeOffAt)} of the lock; you let go at ${pct(inRun.brakeOffAt)}.`;
  }
  if (inRun && !inBest && inRun.brakeOffAt < 0.05) {
    return 'The brake was off before you turned in. Easing off it as the lock goes on helps the front bite.';
  }
  if (outRun && outBest && outRun.flatOutAt === null && outBest.flatOutAt !== null) {
    return `Not flat out by the exit; your best run was, with ${pct(outBest.flatOutAt)} of the lock still on.`;
  }
  if (outRun && outBest && outRun.throttleAtLock - outBest.throttleAtLock >= 0.3) {
    return `${pct(outRun.throttleAtLock)} throttle with the lock still on, against ${pct(outBest.throttleAtLock)} on your best run: feed it in as you unwind.`;
  }
  if (outRun && outBest && outRun.flatOutAt !== null && outBest.flatOutAt !== null && outBest.flatOutAt - outRun.flatOutAt >= 0.25) {
    return `Your best run was flat out with ${pct(outBest.flatOutAt)} of the lock on; you waited until ${pct(outRun.flatOutAt)}.`;
  }
  return null;
}

export function TrailBrakingCard({ size }: { size: CardSize }) {
  const report = useLive((s) => s.insights?.lastCorner ?? null);
  const title = 'Trail braking';

  if (!report) {
    return (
      <LiveCard title={title} size={size}>
        <p className="muted">Shows how the brake and throttle traded off against the steering through each corner you drive.</p>
      </LiveCard>
    );
  }

  const p = report.profile;
  const run = stringTheory(p.steering ?? [], p.brake ?? [], p.throttle ?? []);
  const hasBest = (p.bestSteering ?? []).some((v) => v !== null) && (p.bestBrake ?? []).some((v) => v !== null);
  const best = hasBest ? stringTheory(p.bestSteering, p.bestBrake ?? [], p.bestThrottle ?? []) : null;
  if (!run) {
    return (
      <LiveCard title={title} size={size} meta={report.corner}>
        <p className="muted">Hardly any steering through {report.corner}, so there's nothing to trade off.</p>
      </LiveCard>
    );
  }

  const bestLabel = report.bestLap !== null ? `Best run, lap ${report.bestLap}` : 'Best run';
  const note = standout(run, best);
  const you = facts(run);
  const them = facts(best);
  const plots = (plotSize: number, fit = false) => (
    <div className="st-plots">
      <StringPlot phase="entry" run={run.entry?.points ?? []} best={best?.entry?.points ?? []} maxSize={plotSize} fit={fit} corner={report.corner} />
      <StringPlot phase="exit" run={run.exit?.points ?? []} best={best?.exit?.points ?? []} maxSize={plotSize} fit={fit} corner={report.corner} />
    </div>
  );
  const legend = (
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
        <span className="key st-key-string" aria-hidden="true" />
        The string
      </span>
    </p>
  );

  if (size === 'glance') {
    return (
      <LiveCard title={title} size={size} meta={report.corner} className="st-card">
        {plots(220, true)}
        {legend}
        <dl className="st-facts">
          <div>
            <dt>Brake off</dt>
            <dd>
              {you.brakeOff}
              {best && <span className="muted"> · best {them.brakeOff.toLowerCase()}</span>}
            </dd>
          </div>
          <div>
            <dt>Flat out</dt>
            <dd>
              {you.flatOut}
              {best && <span className="muted"> · best {them.flatOut.toLowerCase()}</span>}
            </dd>
          </div>
        </dl>
      </LiveCard>
    );
  }

  const rows: [string, keyof Facts][] = [
    ['Brake fully off', 'brakeOff'],
    ['Most brake with half the lock on', 'heavy'],
    ['Flat out', 'flatOut'],
    ['Most throttle at 80%+ lock', 'atLock'],
  ];
  return (
    <LiveCard title={title} size={size} meta={`${report.corner} · lap ${report.lap}`}>
      <div className="cl-split">
        <div>
          {plots(300)}
          {legend}
        </div>
        <div className="cl-side">
          <table className="pc-table">
            <caption className="visually-hidden">Brake and throttle against steering through {report.corner}</caption>
            <thead>
              <tr>
                <td />
                <th scope="col">You</th>
                {best && <th scope="col">{bestLabel}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, key]) => (
                <tr key={key}>
                  <th scope="row">{label}</th>
                  <td className="tabular">{you[key]}</td>
                  {best && <td className="tabular">{them[key]}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          {note && <p className="pc-note">{note}</p>}
          <p className="muted cl-hint">
            Imagine a string from the steering wheel to the brake pedal: as the lock goes on, it pulls the brake off, so
            the tyres are never asked to brake hard and turn hard at once. On the way out a second string lets the
            throttle down as the lock comes off. Tracing the dashed diagonal is trail braking done well.
          </p>
        </div>
      </div>
    </LiveCard>
  );
}

/**
 * Pedal against steering for one half of the corner. In: brake against lock going on (left to right).
 * Out: throttle against lock coming off, so the axis runs from full lock on the left to none on the right.
 */
function StringPlot({
  phase,
  run,
  best,
  maxSize,
  fit,
  corner,
}: {
  phase: 'entry' | 'exit';
  run: StringPoint[];
  best: StringPoint[];
  maxSize: number;
  /** Shrink to the height the card has left, in a Live grid cell. */
  fit: boolean;
  corner: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { width, height } = useElementSize(ref);
  const arrowId = `st-arrow-${phase}-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const pad = { left: 34, right: 10, top: 10, bottom: 34 };
  const tallest = fit && fitsHeight(ref.current) ? Math.max(100, height - pad.top - pad.bottom) : Infinity;
  const plot = Math.max(0, Math.min(maxSize, width - pad.left - pad.right, tallest));
  const entry = phase === 'entry';
  const x = (steer: number) => pad.left + (entry ? steer : 1 - steer) * plot;
  const y = (pedal: number) => pad.top + (1 - pedal) * plot;
  const path = (points: StringPoint[]) =>
    points.map((p, i) => `${i ? 'L' : 'M'}${x(p.steer).toFixed(1)},${y(p.pedal).toFixed(1)}`).join('');
  // The string: full pedal with no lock, none at full lock.
  const string = entry ? `M${x(0)},${y(1)}L${x(1)},${y(0)}` : `M${x(1)},${y(0)}L${x(0)},${y(1)}`;
  const pedal = entry ? 'Brake' : 'Throttle';
  const label = entry
    ? `Brake against steering into ${corner}, from the first touch of the brake to the most lock.`
    : `Throttle against steering out of ${corner}, from the most lock until flat out with the wheel straight.`;

  return (
    <figure className="st-plot">
      <figcaption className="st-plot-title">{entry ? 'In: brake as the lock goes on' : 'Out: throttle as the lock comes off'}</figcaption>
      <div ref={ref}>
        {plot > 40 && (
          <svg width={plot + pad.left + pad.right} height={plot + pad.top + pad.bottom} role="img" aria-label={label}>
            <defs>
              <marker id={arrowId} viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M0,0 L10,5 L0,10 z" className="gc-arrow" />
              </marker>
            </defs>
            <rect className="st-frame" x={pad.left} y={pad.top} width={plot} height={plot} />
            {[0.5].map((v) => (
              <g key={v}>
                <line className="cp-grid" x1={pad.left} x2={pad.left + plot} y1={y(v)} y2={y(v)} />
                <line className="cp-grid" x1={x(v)} x2={x(v)} y1={pad.top} y2={pad.top + plot} />
              </g>
            ))}
            <path className="st-string" d={string} />
            {best.length > 1 && <path className="gc-best" d={path(best)} />}
            {run.length > 1 && <path className="gc-own" d={path(run)} markerEnd={`url(#${arrowId})`} />}
            <text className="cp-axis" x={pad.left - 6} y={y(1)} textAnchor="end" dominantBaseline="middle">
              100%
            </text>
            <text className="cp-axis" x={pad.left - 6} y={y(0)} textAnchor="end" dominantBaseline="middle">
              0
            </text>
            <text
              className="cp-axis"
              x={pad.left - 22}
              y={pad.top + plot / 2}
              textAnchor="middle"
              transform={`rotate(-90 ${pad.left - 22} ${pad.top + plot / 2})`}
            >
              {pedal}
            </text>
            <text className="cp-axis" x={pad.left} y={pad.top + plot + 14} textAnchor="start">
              {entry ? 'No lock' : 'Most lock'}
            </text>
            <text className="cp-axis" x={pad.left + plot} y={pad.top + plot + 14} textAnchor="end">
              {entry ? 'Most lock' : 'No lock'}
            </text>
            <text className="cp-axis" x={pad.left + plot / 2} y={pad.top + plot + 28} textAnchor="middle">
              Steering
            </text>
          </svg>
        )}
      </div>
    </figure>
  );
}
