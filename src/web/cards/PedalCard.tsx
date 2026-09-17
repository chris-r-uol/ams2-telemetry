/**
 * Brake and throttle technique through the corner you just drove, against your
 * best run: how quickly the brake reaches its peak, how it comes off and trails
 * into the turn, and how the throttle goes back in. Uses the pedal itself, so the
 * game's blips on downshifts don't show.
 */
import { useRef } from 'react';
import type { PedalTechnique } from '../../shared/analysis/pedals.ts';
import type { CornerProfile } from '../../shared/model/types.ts';
import { useLive } from '../lib/live.ts';
import { useElementWidth } from '../lib/useElementWidth.ts';
import { LiveCard, type CardSize } from './parts.tsx';

type Series = (number | null)[];

const seconds = (v: number | null | undefined) => (v === null || v === undefined ? '–' : `${v.toFixed(2)} s`);

function trail(p: PedalTechnique | null): string {
  const t = p?.brake?.trail;
  if (!p?.brake) return 'No braking';
  if (t === null || t === undefined) return '–';
  if (Math.abs(t) < 0.05) return 'Off at turn-in';
  return t > 0 ? `${t.toFixed(2)} s past turn-in` : `Off ${(-t).toFixed(2)} s before`;
}

interface Row {
  label: string;
  value: (p: PedalTechnique | null) => string;
}

const ROWS: { group: string; rows: Row[] }[] = [
  {
    group: 'Brake',
    rows: [
      { label: 'To peak pressure', value: (p) => (p?.brake ? seconds(p.brake.toPeak) : '–') },
      { label: 'Release', value: (p) => (p?.brake ? seconds(p.brake.release) : '–') },
      { label: 'Trail', value: trail },
    ],
  },
  {
    group: 'Throttle',
    rows: [
      { label: 'Pickup to flat out', value: (p) => (!p || p.throttle.pickup === null ? '–' : p.throttle.toFull === null ? 'Not flat out' : seconds(p.throttle.toFull)) },
      { label: 'Backed off', value: (p) => (p ? String(p.throttle.hesitations) : '–') },
      { label: 'While adding lock', value: (p) => (p ? seconds(p.throttle.withLock) : '–') },
    ],
  },
];

/** The difference from your best run most worth knowing about, in words. */
function standout(run: PedalTechnique, best: PedalTechnique | null): string | null {
  if (!best) return null;
  const toFull = run.throttle.toFull !== null && best.throttle.toFull !== null ? run.throttle.toFull - best.throttle.toFull : null;
  if (toFull !== null && toFull >= 0.4) return `From pickup, flat out took ${toFull.toFixed(1)} s longer than on your best run.`;
  if (run.throttle.pickup !== null && run.throttle.toFull === null && best.throttle.toFull !== null) {
    return 'Not flat out by the exit, where your best run was.';
  }
  const runTrail = run.brake?.trail;
  const bestTrail = best.brake?.trail;
  if (runTrail != null && bestTrail != null && bestTrail - runTrail >= 0.2) {
    return `Your best run kept a little brake on ${(bestTrail - runTrail).toFixed(1)} s further into the turn.`;
  }
  if (run.brake && best.brake && run.brake.toPeak - best.brake.toPeak >= 0.08) {
    return `Reaching peak brake pressure took ${(run.brake.toPeak - best.brake.toPeak).toFixed(2)} s longer than on your best run.`;
  }
  if (run.throttle.withLock >= 0.2 && run.throttle.withLock - best.throttle.withLock >= 0.1) {
    return `Throttle went in while you were still adding steering for ${run.throttle.withLock.toFixed(1)} s.`;
  }
  if (run.brake && best.brake && Math.abs(run.brake.release - best.brake.release) >= 0.25) {
    const quicker = run.brake.release < best.brake.release;
    return `You came off the brake ${Math.abs(run.brake.release - best.brake.release).toFixed(1)} s ${quicker ? 'more abruptly' : 'more gradually'} than on your best run.`;
  }
  return null;
}

export function PedalCard({ size }: { size: CardSize }) {
  const report = useLive((s) => s.insights?.lastCorner ?? null);
  const lapPedals = useLive((s) => s.insights?.lapPedals ?? null);
  const title = 'Brake and throttle';

  if (!report) {
    return (
      <LiveCard title={title} size={size}>
        <p className="muted">Shows how you used the brake and throttle through each corner as soon as you've driven it.</p>
      </LiveCard>
    );
  }
  // Reports sent before pedal technique was measured have none.
  const pedals = report.pedals ?? null;
  if (!pedals) {
    return (
      <LiveCard title={title} size={size} meta={report.corner}>
        <p className="muted">Waiting for the next corner.</p>
      </LiveCard>
    );
  }

  const bestLabel = report.bestLap !== null ? `Best, lap ${report.bestLap}` : 'Best';
  const note = standout(pedals.run, pedals.best);
  const table = (
    <table className="pc-table">
      <caption className="visually-hidden">Brake and throttle through {report.corner}, against your best run</caption>
      <thead>
        <tr>
          <td />
          <th scope="col">You</th>
          {pedals.best && <th scope="col">{bestLabel}</th>}
        </tr>
      </thead>
      {ROWS.map(({ group, rows }) => (
        <tbody key={group}>
          <tr className="pc-group">
            <th scope="colgroup" colSpan={pedals.best ? 3 : 2}>
              {group}
            </th>
          </tr>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <td className="tabular">{row.value(pedals.run)}</td>
              {pedals.best && <td className="tabular">{row.value(pedals.best)}</td>}
            </tr>
          ))}
        </tbody>
      ))}
    </table>
  );
  const lapLine =
    lapPedals && lapPedals.fullThrottle !== null ? (
      <p className="pc-lap">
        Flat out for <strong className="tabular">{Math.round(lapPedals.fullThrottle * 100)}%</strong> of lap {lapPedals.lap}
        {lapPedals.bestFullThrottle !== null && lapPedals.bestLap !== lapPedals.lap && (
          <span className="muted">
            {' '}
            · best lap {lapPedals.bestLap}: {Math.round(lapPedals.bestFullThrottle * 100)}%
          </span>
        )}
      </p>
    ) : null;

  if (size === 'glance') {
    return (
      <LiveCard title={title} size={size} meta={report.corner}>
        {table}
        {note && <p className="pc-note">{note}</p>}
        {lapLine}
      </LiveCard>
    );
  }

  return (
    <LiveCard title={title} size={size} meta={`${report.corner} · lap ${report.lap}`}>
      <div className="cl-split">
        <PedalTraces profile={report.profile} run={pedals.run} best={pedals.best} bestLabel={bestLabel} corner={report.corner} />
        <div className="cl-side">
          {table}
          {note && <p className="pc-note">{note}</p>}
          {lapLine}
          <p className="muted cl-hint">
            Look for a quick brake, a gradual release into the turn, and a smooth, full throttle as the steering unwinds.
          </p>
        </div>
      </div>
    </LiveCard>
  );
}

/** Brake and throttle along the corner, this run over your best run. */
function PedalTraces({
  profile,
  run,
  best,
  bestLabel,
  corner,
}: {
  profile: CornerProfile;
  run: PedalTechnique;
  best: PedalTechnique | null;
  bestLabel: string;
  corner: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref);
  const panels: { label: string; own: Series; best: Series }[] = [
    { label: 'Brake', own: profile.brake ?? [], best: profile.bestBrake ?? [] },
    { label: 'Throttle', own: profile.throttle ?? [], best: profile.bestThrottle ?? [] },
  ];
  const hasBest = panels.some((p) => p.best.some((v) => v !== null));
  const n = Math.max(...panels.map((p) => p.own.length));
  const pad = { left: 58, right: 8, top: 16 };
  const panelH = 72;
  const gap = 18;
  const plotW = Math.max(10, width - pad.left - pad.right);
  const x = (i: number) => pad.left + (n > 1 ? (i / (n - 1)) * plotW : 0);
  const xAt = (d: number) => x((d - profile.from) / profile.step);
  const top = (p: number) => pad.top + p * (panelH + gap);
  const height = top(panels.length) + 4;
  const y = (p: number, v: number) => top(p) + (1 - v) * panelH;
  const line = (p: number, series: Series) => {
    let path = '';
    let pen = false;
    series.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      path += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(p, v).toFixed(1)}`;
      pen = true;
    });
    return path;
  };
  const inPlot = (px: number) => px >= pad.left && px <= pad.left + plotW;
  const markers = [
    run.turnIn !== null ? { d: run.turnIn, text: 'You turn in', className: 'cp-marker-own' } : null,
    best?.turnIn != null && run.turnIn !== null && Math.abs(best.turnIn - run.turnIn) > 6
      ? { d: best.turnIn, text: 'Best turns in', className: 'cp-marker-best' }
      : null,
  ].filter((m): m is { d: number; text: string; className: string } => m !== null);
  const summary =
    `Brake and throttle through ${corner}.` +
    (run.brake ? ` Brake at peak in ${run.brake.toPeak.toFixed(2)} seconds, off over ${run.brake.release.toFixed(2)} seconds.` : ' No braking.') +
    (run.throttle.toFull !== null ? ` Flat out ${run.throttle.toFull.toFixed(1)} seconds after picking up the throttle.` : '');

  return (
    <figure className="corner-profile">
      <div ref={ref}>
        {width > 0 && n > 2 && (
          <svg width={width} height={height} role="img" aria-label={summary}>
            {panels.map((panel, p) => (
              <g key={panel.label}>
                {[0, 1].map((v) => (
                  <line key={v} className="cp-grid" x1={pad.left} x2={pad.left + plotW} y1={y(p, v)} y2={y(p, v)} />
                ))}
                <text className="cp-axis" x={pad.left - 8} y={top(p) + panelH / 2} textAnchor="end" dominantBaseline="middle">
                  {panel.label}
                </text>
                <text className="cp-axis" x={pad.left - 8} y={y(p, 1)} textAnchor="end" dominantBaseline="middle">
                  100%
                </text>
                {hasBest && <path className="cp-best" d={line(p, panel.best)} />}
                <path className="cp-own" d={line(p, panel.own)} />
              </g>
            ))}
            {markers.map((m, k) => {
              const px = xAt(m.d);
              if (!inPlot(px)) return null;
              return (
                <g key={m.text} className={m.className}>
                  <line x1={px} x2={px} y1={pad.top - 2} y2={top(panels.length) - gap} strokeDasharray="4 3" />
                  <text x={px + (k === 0 ? 4 : -4)} y={10} textAnchor={k === 0 ? 'start' : 'end'}>
                    {m.text}
                  </text>
                </g>
              );
            })}
            {inPlot(xAt(profile.apex)) && (
              <text className="cp-axis" x={xAt(profile.apex)} y={height} textAnchor="middle">
                Apex
              </text>
            )}
          </svg>
        )}
      </div>
      <figcaption className="cp-legend">
        <span className="legend-item">
          <span className="key key-own" aria-hidden="true" />
          This run
        </span>
        {hasBest && (
          <span className="legend-item">
            <span className="key key-reference" aria-hidden="true" />
            {bestLabel.replace('Best', 'Best run')}
          </span>
        )}
      </figcaption>
    </figure>
  );
}
