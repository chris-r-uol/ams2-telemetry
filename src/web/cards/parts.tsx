/**
 * Building blocks shared by the live cards.
 */
import { useRef, type ReactNode } from 'react';
import type { ChassisEventKind, PhaseBalance, Wheel } from '../../shared/analysis/chassis.ts';
import { signedPercent, speedIn, speedLabel, type Units } from '../../shared/format.ts';
import type { CornerProfile, LiveEvent } from '../../shared/model/types.ts';
import { useElementWidth } from '../lib/useElementWidth.ts';

/** Glance: one or two big things, for focus mode. Detail: the fuller version. */
export type CardSize = 'glance' | 'detail';
export type Accent = 'faster' | 'slower' | 'attention' | null;

export function toneOf(seconds: number | null | undefined, threshold = 0.02): Accent {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return null;
  return seconds > threshold ? 'slower' : seconds < -threshold ? 'faster' : null;
}

/** Distances shown while driving are rounded to 10 m so the number doesn't flicker. */
export function roundMetres(metres: number): string {
  return `${Math.max(0, Math.round(metres / 10) * 10)} m`;
}

export function LiveCard({
  title,
  size,
  accent = null,
  meta,
  className = '',
  children,
}: {
  title: string;
  size: CardSize;
  accent?: Accent;
  meta?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`card live-card is-${size}${accent ? ` accent-${accent}` : ''}${className ? ` ${className}` : ''}`}>
      <header className="live-card-head">
        <h2>{title}</h2>
        {meta !== undefined && meta !== null && <span className="live-card-meta">{meta}</span>}
      </header>
      {children}
    </section>
  );
}

export const WHEEL_WORDS: Record<Wheel, string> = {
  FL: 'front left',
  FR: 'front right',
  RL: 'rear left',
  RR: 'rear right',
};

export const EVENT_LABELS: Record<ChassisEventKind, string> = {
  'lock-up': 'Lock-up',
  wheelspin: 'Wheelspin',
  oversteer: 'Oversteer slide',
  bottoming: 'Bottoming',
  'bump-stop': 'Bump stop',
  'wheel-lift': 'Wheel lift',
};

export const EVENT_ICONS: Record<ChassisEventKind, string> = {
  'lock-up': '◉',
  wheelspin: '↻',
  oversteer: '↺',
  bottoming: '▁',
  'bump-stop': '▔',
  'wheel-lift': '⤒',
};

/** Repeats of the same event on the same wheel in the same corner share a line, newest first. */
export function EventList({ events, limit = 5 }: { events: LiveEvent[]; limit?: number }) {
  const groups = new Map<string, { event: LiveEvent; count: number; latest: number }>();
  events.forEach((event, index) => {
    const key = `${event.lap}-${event.kind}-${event.wheel ?? ''}-${event.corner ?? ''}`;
    const group = groups.get(key);
    if (group) {
      group.count++;
      group.latest = index;
    } else {
      groups.set(key, { event, count: 1, latest: index });
    }
  });
  const rows = [...groups.entries()].sort((a, b) => b[1].latest - a[1].latest).slice(0, limit);

  return (
    <ul className="event-list">
      {rows.map(([key, { event: e, count }]) => (
        <li key={key}>
          <span className="event-icon" aria-hidden="true">
            {EVENT_ICONS[e.kind]}
          </span>
          <span>
            <strong>{EVENT_LABELS[e.kind]}</strong>
            {e.wheel ? `, ${WHEEL_WORDS[e.wheel]}` : ''}
            {e.corner ? ` at ${e.corner}` : ''}
            {count > 1 && (
              <span className="muted tabular">
                <span aria-hidden="true"> ×{count}</span>
                <span className="visually-hidden">, {count} times</span>
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

const VERDICT_WORDS = { understeer: 'Understeer', neutral: 'Neutral', oversteer: 'Oversteer' } as const;

export function PhaseStrip({
  phases,
  size,
}: {
  phases: { entry: PhaseBalance; mid: PhaseBalance; exit: PhaseBalance } | null;
  size: CardSize;
}) {
  const items: [string, PhaseBalance | null][] = [
    ['Entry', phases?.entry ?? null],
    ['Mid', phases?.mid ?? null],
    ['Exit', phases?.exit ?? null],
  ];
  return (
    <ol className={`phase-strip is-${size}`} aria-label="Balance through the corner">
      {items.map(([name, phase]) => {
        const verdict = phase?.verdict ?? null;
        return (
          <li key={name} className={`phase is-${verdict ?? 'unknown'}`}>
            <span className="phase-name">{name}</span>
            <span className="phase-verdict">{verdict ? VERDICT_WORDS[verdict] : '–'}</span>
            {size === 'detail' && phase?.ratio != null && (
              <span className="phase-amount tabular">{signedPercent(phase.ratio)} steering</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Speed through one corner (this run against your best run) with a balance
 * band underneath: where the car understeered, stayed neutral or oversteered.
 */
export function CornerProfileChart({
  profile,
  units,
  corner,
  bestLap,
}: {
  profile: CornerProfile;
  units: Units;
  corner: string;
  bestLap: number | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref);

  const n = profile.speed.length;
  const toUnit = (v: number | null) => (v === null ? null : speedIn(v, units.speed));
  const own = profile.speed.map(toUnit);
  const best = profile.bestSpeed.map(toUnit);
  const ownValues = own.filter((v): v is number => v !== null);
  const bestValues = best.filter((v): v is number => v !== null);
  const values = [...ownValues, ...bestValues];
  const hasBalance = profile.balance.some((v) => v !== null);

  const pad = { left: 58, right: 12, top: 34 };
  const plotH = 100;
  const bandTop = pad.top + plotH + 10;
  const bandH = 12;
  const height = bandTop + bandH + 20;
  const plotW = Math.max(10, width - pad.left - pad.right);
  const lo = values.length ? Math.floor(Math.min(...values) / 10) * 10 : 0;
  const hi = values.length ? Math.max(lo + 10, Math.ceil(Math.max(...values) / 10) * 10) : 10;
  const x = (i: number) => pad.left + (n > 1 ? (i / (n - 1)) * plotW : 0);
  const xAt = (d: number) => x((d - profile.from) / profile.step);
  const y = (v: number) => pad.top + (1 - (v - lo) / (hi - lo)) * plotH;
  const cell = n > 1 ? plotW / (n - 1) : plotW;
  const inPlot = (px: number) => px >= pad.left && px <= pad.left + plotW;
  const line = (series: (number | null)[]) => {
    let path = '';
    let pen = false;
    series.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      path += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return path;
  };
  const classify = (r: number | null) => (r === null ? null : r > 0.12 ? 'understeer' : r < -0.12 ? 'oversteer' : 'neutral');
  const anchor = (px: number) => (px < pad.left + 60 ? 'start' : px > pad.left + plotW - 60 ? 'end' : 'middle');
  // Within a few metres the two lines sit on top of each other, so they share one label.
  const brakedTogether =
    profile.brakeAt !== null &&
    profile.bestBrakeAt !== null &&
    bestValues.length > 0 &&
    Math.abs(profile.brakeAt - profile.bestBrakeAt) <= 3 * profile.step;
  const markers = (
    brakedTogether
      ? [{ d: profile.brakeAt!, text: 'You braked where your best run did', className: 'cp-marker-own', row: 1 }]
      : [
          profile.bestBrakeAt !== null && bestValues.length
            ? { d: profile.bestBrakeAt, text: 'Best run brakes', className: 'cp-marker-best', row: 0 }
            : null,
          profile.brakeAt !== null ? { d: profile.brakeAt, text: 'You braked', className: 'cp-marker-own', row: 1 } : null,
        ]
  ).filter((m): m is { d: number; text: string; className: string; row: number } => m !== null);

  const unit = speedLabel(units.speed);
  const summary =
    `Speed through ${corner}: slowest ${ownValues.length ? Math.round(Math.min(...ownValues)) : '–'} ${unit}` +
    (bestValues.length ? ` against ${Math.round(Math.min(...bestValues))} ${unit} on your best run.` : '.');

  return (
    <figure className="corner-profile">
      <div ref={ref}>
        {width > 0 && n > 2 && values.length > 0 && (
          <svg width={width} height={height} role="img" aria-label={summary}>
            {[lo, (lo + hi) / 2, hi].map((v) => (
              <g key={v}>
                <line className="cp-grid" x1={pad.left} x2={pad.left + plotW} y1={y(v)} y2={y(v)} />
                <text className="cp-axis" x={pad.left - 8} y={y(v)} textAnchor="end" dominantBaseline="middle">
                  {Math.round(v)}
                </text>
              </g>
            ))}
            {markers.map((m) => {
              const px = xAt(m.d);
              if (!inPlot(px)) return null;
              return (
                <g key={m.text} className={m.className}>
                  <line x1={px} x2={px} y1={pad.top - 4} y2={pad.top + plotH} />
                  <text x={px} y={11 + m.row * 13} textAnchor={anchor(px)}>
                    {m.text}
                  </text>
                </g>
              );
            })}
            {bestValues.length > 0 && <path className="cp-best" d={line(best)} />}
            <path className="cp-own" d={line(own)} />
            <text className="cp-axis" x={pad.left - 8} y={bandTop + bandH / 2} textAnchor="end" dominantBaseline="middle">
              Balance
            </text>
            {hasBalance ? (
              profile.balance.map((r, i) => {
                const verdict = classify(r);
                return verdict ? (
                  <rect key={i} className={`cp-band is-${verdict}`} x={x(i) - cell / 2} y={bandTop} width={cell + 0.5} height={bandH} />
                ) : null;
              })
            ) : (
              <text className="cp-axis" x={pad.left} y={bandTop + bandH / 2} dominantBaseline="middle">
                Appears once steering has been calibrated
              </text>
            )}
            {inPlot(xAt(profile.apex)) && (
              <text className="cp-axis" x={xAt(profile.apex)} y={height - 4} textAnchor="middle">
                Apex
              </text>
            )}
          </svg>
        )}
      </div>
      <figcaption className="cp-legend">
        <span className="legend-item">
          <span className="key key-own" aria-hidden="true" />
          This run ({unit})
        </span>
        {bestValues.length > 0 && (
          <span className="legend-item">
            <span className="key key-reference" aria-hidden="true" />
            Best run{bestLap ? `, lap ${bestLap}` : ''}
          </span>
        )}
        <span className="legend-item">
          <span className="swatch swatch-understeer" aria-hidden="true" />
          Understeer
        </span>
        <span className="legend-item">
          <span className="swatch swatch-neutral" aria-hidden="true" />
          Neutral
        </span>
        <span className="legend-item">
          <span className="swatch swatch-oversteer" aria-hidden="true" />
          Oversteer
        </span>
      </figcaption>
    </figure>
  );
}
