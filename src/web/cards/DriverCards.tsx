/**
 * Cards about the lap as a whole: delta and potential, the one thing to work
 * on, and the recent lap trend.
 */
import { useRef } from 'react';
import { mean } from '../../shared/analysis/session.ts';
import { describeTip, formatDelta, formatLapTime, shortAction } from '../../shared/format.ts';
import type { LapSummary } from '../../shared/model/types.ts';
import { bestLap } from '../components/laps.tsx';
import { DeltaValue } from '../components/ui.tsx';
import { useLive } from '../lib/live.ts';
import { useSettings } from '../lib/settings.ts';
import { useElementWidth } from '../lib/useElementWidth.ts';
import { LiveCard, roundMetres, toneOf, type CardSize } from './parts.tsx';

export function DeltaPotentialCard({ size }: { size: CardSize }) {
  const delta = useLive((s) => s.frame?.delta ?? null);
  const predicted = useLive((s) => s.frame?.predictedLapTime ?? null);
  const best = useLive((s) => s.frame?.bestLapTime ?? null);
  const ideal = useLive((s) => s.insights?.idealLapTime ?? null);
  const withinReach = best !== null && ideal !== null ? best - ideal : null;

  return (
    <LiveCard title="Delta" size={size} accent={toneOf(delta, 0.05)}>
      <div className={size === 'full' ? 'dp-split' : undefined}>
        <div className="dp-hero">
          <DeltaValue seconds={delta} digits={2} words />
        </div>
        {size === 'full' && (
          <dl className="dp-facts">
            <div>
              <dt>Predicted</dt>
              <dd>{formatLapTime(predicted)}</dd>
            </div>
            <div>
              <dt>Session best</dt>
              <dd>{formatLapTime(best)}</dd>
            </div>
            <div>
              <dt>Ideal lap</dt>
              <dd>
                {formatLapTime(ideal)}
                {withinReach !== null && withinReach > 0.005 && (
                  <span className="muted"> · {withinReach.toFixed(2)} s within reach</span>
                )}
              </dd>
            </div>
          </dl>
        )}
      </div>
    </LiveCard>
  );
}

export function OneThingCard({ size }: { size: CardSize }) {
  const feedback = useLive((s) => s.feedback);
  const nextId = useLive((s) => s.frame?.coach?.nextCornerId ?? null);
  const toApex = useLive((s) => s.frame?.coach?.toApex ?? null);
  const { units } = useSettings();
  const title = 'Focus this lap';
  const tip = feedback?.tips[0] ?? null;

  if (!feedback || !tip) {
    return (
      <LiveCard title={title} size={size}>
        <p className="muted">After a clean lap, the single most valuable change appears here.</p>
      </LiveCard>
    );
  }

  const approaching = nextId === tip.cornerId && toApex !== null && toApex < 600;
  const text = describeTip(tip, units);

  return (
    <LiveCard
      title={title}
      size={size}
      accent={approaching ? 'attention' : null}
      meta={approaching ? `${tip.corner} in ${roundMetres(toApex!)}` : `From lap ${feedback.lap}`}
    >
      <p className="ot-action">
        {shortAction(tip.kind)} <span className="ot-corner">at {tip.corner}</span>
      </p>
      {tip.timeLost >= 0.01 && <p className="ot-worth">Worth about {tip.timeLost.toFixed(2)} s</p>}
      {size === 'full' && (
        <>
          <p className="secondary">{text.detail}</p>
          {feedback.tips.length > 1 && (
            <ul className="ot-more">
              {feedback.tips.slice(1).map((t) => (
                <li key={`${t.cornerId}-${t.kind}`}>
                  {describeTip(t, units).title}
                  {t.timeLost >= 0.01 && <span className="muted"> · {t.timeLost.toFixed(2)} s</span>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </LiveCard>
  );
}

function barPath(x0: number, x1: number, top: number, base: number): string {
  const r = Math.min(4, (x1 - x0) / 2, Math.max(0, base - top));
  return `M${x0},${base}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x1 - r}Q${x1},${top} ${x1},${top + r}V${base}Z`;
}

function LapBars({ laps, best }: { laps: LapSummary[]; best: LapSummary }) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref);
  const height = 130;
  const pad = { left: 8, right: 8, top: 20, bottom: 22 };
  const plotW = Math.max(10, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;
  const base = pad.top + plotH;
  const deltas = laps.map((l) => l.lapTime! - best.lapTime!);
  const cap = Math.min(3, Math.max(0.5, ...deltas));
  const slot = plotW / laps.length;
  const barW = Math.min(24, slot - 6);

  return (
    <div ref={ref} className="lap-bars">
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`Last ${laps.length} laps against your best: ${laps
            .map((l, i) => `lap ${l.lap} ${formatDelta(deltas[i], 2)}${l.valid ? '' : ' invalid'}`)
            .join(', ')}.`}
        >
          <line className="lap-bars-base" x1={pad.left} x2={pad.left + plotW} y1={base} y2={base} />
          {laps.map((lap, i) => {
            const cx = pad.left + slot * (i + 0.5);
            const value = deltas[i];
            const h = (Math.min(value, cap) / cap) * plotH;
            const isBest = lap.lap === best.lap;
            const last = i === laps.length - 1;
            return (
              <g key={lap.lap}>
                <title>{`Lap ${lap.lap}: ${formatLapTime(lap.lapTime)} (${isBest ? 'best' : formatDelta(value, 2)})${lap.valid ? '' : ', invalid'}`}</title>
                {isBest ? (
                  <circle className="lap-best-dot" cx={cx} cy={base - 5} r={5} />
                ) : (
                  <path className={`lap-bar${lap.valid ? '' : ' is-invalid'}`} d={barPath(cx - barW / 2, cx + barW / 2, base - Math.max(2, h), base)} />
                )}
                {(last || isBest) && (
                  <text className="lap-bars-value" x={cx} y={isBest ? base - 14 : base - Math.max(2, h) - 5} textAnchor="middle">
                    {isBest ? 'Best' : formatDelta(value, 2)}
                  </text>
                )}
                <text className="lap-bars-label" x={cx} y={height - 6} textAnchor="middle">
                  {lap.lap}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

export function LapTrendCard({ size }: { size: CardSize }) {
  const session = useLive((s) => s.session);
  const best = bestLap(session);
  const laps = (session?.laps ?? []).filter((l) => l.lapTime !== null && l.kind === 'flying').slice(-10);
  const title = 'Lap trend';

  if (!best || laps.length < 2) {
    return (
      <LiveCard title={title} size={size}>
        <p className="muted">Appears after two flying laps.</p>
      </LiveCard>
    );
  }

  const valid = laps.filter((l) => l.valid).map((l) => l.lapTime! - best.lapTime!);
  const recent = valid.slice(-3);
  const before = valid.slice(-6, -3);
  const trend = before.length >= 2 && recent.length >= 2 ? mean(recent) - mean(before) : null;
  const trendText =
    trend === null
      ? 'The trend appears after six clean laps.'
      : Math.abs(trend) < 0.05
        ? 'Holding steady over the last three laps'
        : trend < 0
          ? `Improving by ${Math.abs(trend).toFixed(2)} s over the last three laps`
          : `Dropping off by ${trend.toFixed(2)} s over the last three laps`;
  const last = laps[laps.length - 1];

  return (
    <LiveCard title={title} size={size}>
      <p className="lt-last">
        {last.lap === best.lap ? (
          'Last lap was your best'
        ) : (
          <>
            Last lap <DeltaValue seconds={last.lapTime! - best.lapTime!} digits={2} words />
          </>
        )}
      </p>
      <p className="lt-trend">{trendText}</p>
      {size === 'full' && <LapBars laps={laps} best={best} />}
    </LiveCard>
  );
}
