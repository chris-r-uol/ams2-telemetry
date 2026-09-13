import { useRef, useState, type KeyboardEvent } from 'react';
import { formatLapTime, formatSectorTime, SESSION_LABELS, speedIn, speedLabel, temperatureIn, temperatureLabel } from '../../shared/format.ts';
import type { LapSummary, SessionMeta } from '../../shared/model/types.ts';
import { bestLap, bestSectors, formatSessionDate, isCoachable, LapStatus, sessionTitle } from '../components/laps.tsx';
import { Card, DeltaValue, EmptyState, Stat } from '../components/ui.tsx';
import { api, sendJson, useApi, type InsightsDto } from '../lib/api.ts';
import { useLive } from '../lib/live.ts';
import { href, navigate } from '../lib/router.ts';
import { useSettings } from '../lib/settings.ts';
import { useElementWidth } from '../lib/useElementWidth.ts';

export function SessionView({ id }: { id: string }) {
  const lapSerial = useLive((s) => s.lapSerial);
  const isLive = useLive((s) => s.session?.id === id);
  const refresh = isLive ? lapSerial : 0;
  const session = useApi<SessionMeta>(api.session(id), refresh);
  const insights = useApi<InsightsDto>(api.insights(id), refresh);
  const { units } = useSettings();
  const [selected, setSelected] = useState<number[]>([]);

  if (session.error) {
    return (
      <EmptyState title="Session not found">
        <p>{session.error}</p>
        <p>
          <a href={href({ name: 'sessions' })}>Back to all sessions</a>
        </p>
      </EmptyState>
    );
  }
  if (!session.data) {
    return (
      <p className="loading" role="status">
        Loading session…
      </p>
    );
  }

  const s = session.data;
  const best = bestLap(s);
  const sectors = bestSectors(s.laps);
  const consistency = insights.data?.insights.consistency ?? null;
  const toggle = (lap: number) =>
    setSelected((current) => (current.includes(lap) ? current.filter((l) => l !== lap) : [...current.slice(-1), lap]));
  const compareHref =
    selected.length === 2
      ? href({ name: 'compare', session: id, lap: selected[0], refSession: id, refLap: selected[1] })
      : null;
  const selectionText =
    selected.length === 0
      ? 'Select two laps to compare'
      : selected.length === 1
        ? `Lap ${selected[0]} selected. Pick one more.`
        : `Laps ${selected[0]} and ${selected[1]} selected`;

  const remove = async () => {
    if (!window.confirm(`Delete this session and its ${s.laps.length} laps? This can't be undone.`)) return;
    try {
      await sendJson(api.session(id), 'DELETE');
      navigate({ name: 'sessions' });
    } catch (err) {
      window.alert((err as Error).message);
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">
            {formatSessionDate(s.startedAt)} · {SESSION_LABELS[s.sessionType]}
            {isLive && <span className="badge badge-good">Live</span>}
          </p>
          <h1>{sessionTitle(s)}</h1>
          <p className="secondary">{[s.car, s.carClass].filter(Boolean).join(' · ') || 'Unknown car'}</p>
        </div>
        <div className="page-actions">
          <a className="btn is-primary" href={href({ name: 'coach', id })}>
            Coach this session
          </a>
          <a className="btn" href={href({ name: 'setup', session: id, lap: null, compare: null })}>
            Car setup
          </a>
          <a className="btn" href={api.sessionExport(id)} download>
            Download lap data
          </a>
          {!isLive && (
            <button type="button" className="btn" onClick={remove}>
              Delete session
            </button>
          )}
        </div>
      </header>

      <div className="stats-row">
        <Stat label="Best lap" value={formatLapTime(best?.lapTime)} detail={best ? `Lap ${best.lap}` : 'No clean laps yet'} />
        <Stat
          label="Ideal lap"
          value={formatLapTime(insights.data?.insights.idealLapTime)}
          detail="Your best run through every corner, combined"
        />
        <Stat
          label="Consistency"
          value={consistency ? `±${consistency.stdDev.toFixed(2)} s` : '–'}
          detail={consistency ? `Spread across ${consistency.laps} clean laps` : 'Needs two clean laps'}
        />
        <Stat label="Laps" value={s.laps.length} detail={`${s.laps.filter(isCoachable).length} clean flying laps`} />
      </div>

      <Card
        title="Lap times"
        description="Filled dots are clean flying laps; hollow dots are out, in or invalid laps. Click or press Enter on a dot to select it."
      >
        <LapTimeChart laps={s.laps} best={best} selected={selected} onToggle={toggle} />
      </Card>

      <Card
        title="All laps"
        actions={
          <div className="compare-actions">
            <span className="muted" aria-live="polite">
              {selectionText}
            </span>
            {compareHref ? (
              <a className="btn is-primary" href={compareHref}>
                Compare selected
              </a>
            ) : (
              <button type="button" className="btn" disabled>
                Compare selected
              </button>
            )}
          </div>
        }
      >
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">
                  <span className="visually-hidden">Select</span>
                </th>
                <th scope="col">Lap</th>
                <th scope="col" className="num">Time</th>
                <th scope="col" className="num">To best</th>
                <th scope="col" className="num">S1</th>
                <th scope="col" className="num">S2</th>
                <th scope="col" className="num">S3</th>
                <th scope="col" className="num">Top speed</th>
                <th scope="col" className="num">Fuel used</th>
                <th scope="col" className="num">Tyre temp</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {s.laps.map((lap) => {
                const isSelected = selected.includes(lap.lap);
                const avgTemp = lap.tyreTempAvg.reduce((a, b) => a + b, 0) / 4;
                return (
                  <tr key={lap.lap} aria-selected={isSelected}>
                    <td className="select-cell">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggle(lap.lap)}
                        aria-label={`Select lap ${lap.lap} for comparison`}
                        disabled={lap.lapTime === null}
                      />
                    </td>
                    <th scope="row" className="tabular">{lap.lap}</th>
                    <td className="num">{formatLapTime(lap.lapTime)}</td>
                    <td className="num">
                      {best && lap !== best && lap.lapTime !== null ? <DeltaValue seconds={lap.lapTime - best.lapTime!} /> : '—'}
                    </td>
                    {lap.sectors.map((sector, i) => (
                      <td key={i} className={`num ${sector !== null && sector === sectors[i] ? 'is-best-sector' : ''}`}>
                        {formatSectorTime(sector)}
                        {sector !== null && sector === sectors[i] && <span className="visually-hidden"> (best sector)</span>}
                      </td>
                    ))}
                    <td className="num">
                      {Math.round(speedIn(lap.topSpeed, units.speed))} {speedLabel(units.speed)}
                    </td>
                    <td className="num">{lap.fuelUsed !== null ? `${lap.fuelUsed.toFixed(2)} L` : '–'}</td>
                    <td className="num">
                      {avgTemp > 0 ? `${Math.round(temperatureIn(avgTemp, units.temperature))}${temperatureLabel(units.temperature)}` : '–'}
                    </td>
                    <td>
                      <LapStatus lap={lap} best={lap === best} />
                    </td>
                    <td>
                      {best && lap !== best && lap.lapTime !== null && (
                        <a href={href({ name: 'compare', session: id, lap: lap.lap, refSession: id, refLap: best.lap })}>
                          Compare with best<span className="visually-hidden"> (lap {lap.lap})</span>
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function niceStep(raw: number): number {
  const steps = [0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60];
  return steps.find((s) => s >= raw) ?? 60;
}

function shortTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return m > 0 ? `${m}:${s.toFixed(1).padStart(4, '0')}` : s.toFixed(1);
}

function LapTimeChart({
  laps,
  best,
  selected,
  onToggle,
}: {
  laps: LapSummary[];
  best: LapSummary | null;
  selected: number[];
  onToggle: (lap: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(containerRef);
  const [active, setActive] = useState<number | null>(null);
  const timed = laps.filter((l) => l.lapTime !== null);

  if (timed.length < 2 || width === 0) {
    return (
      <div ref={containerRef} className="laptime-chart">
        {timed.length < 2 && <p className="muted">The chart appears after two timed laps.</p>}
      </div>
    );
  }

  const clean = timed.filter(isCoachable);
  const basis = (clean.length >= 2 ? clean : timed).map((l) => l.lapTime!);
  const fastest = Math.min(...basis);
  const slowest = Math.max(...basis);
  const lo = fastest - 0.3;
  // Keep the scale useful: very slow laps (spins, pit stops) sit on the top edge instead of flattening everything.
  const hi = Math.min(Math.max(slowest, fastest + 1), fastest * 1.07) + 0.3;
  const height = 240;
  const pad = { left: 64, right: 24, top: 24, bottom: 36 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const first = timed[0].lap;
  const last = timed[timed.length - 1].lap;
  const xOf = (lap: number) => pad.left + (last === first ? plotW / 2 : ((lap - first) / (last - first)) * plotW);
  const yOf = (t: number) => pad.top + (1 - (Math.min(hi, Math.max(lo, t)) - lo) / (hi - lo)) * plotH;
  const tickStep = niceStep((hi - lo) / 4);
  const yTicks: number[] = [];
  for (let t = Math.ceil(lo / tickStep) * tickStep; t <= hi; t += tickStep) yTicks.push(t);
  const xEvery = Math.max(1, Math.ceil(timed.length / Math.max(2, Math.floor(plotW / 48))));
  const line = clean.map((l, i) => `${i ? 'L' : 'M'}${xOf(l.lap).toFixed(1)},${yOf(l.lapTime!).toFixed(1)}`).join('');
  const activeLap = timed.find((l) => l.lap === active) ?? null;

  const onKey = (event: KeyboardEvent, lap: number) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onToggle(lap);
    }
  };

  return (
    <div ref={containerRef} className="laptime-chart">
      <svg
        width={width}
        height={height}
        role="group"
        aria-label={`Lap times for ${timed.length} laps${best ? `, best ${formatLapTime(best.lapTime)} on lap ${best.lap}` : ''}. Every value is also in the table below.`}
      >
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={width - pad.right} y1={yOf(t)} y2={yOf(t)} className="lt-grid" />
            <text x={pad.left - 8} y={yOf(t)} textAnchor="end" dominantBaseline="middle" className="lt-axis-label">
              {shortTime(t)}
            </text>
          </g>
        ))}
        {timed.map((l, i) =>
          i % xEvery === 0 ? (
            <text key={l.lap} x={xOf(l.lap)} y={height - 12} textAnchor="middle" className="lt-axis-label">
              {i === 0 ? `Lap ${l.lap}` : l.lap}
            </text>
          ) : null,
        )}
        <path d={line} className="lt-line" />
        {timed.map((l) => {
          const x = xOf(l.lap);
          const y = yOf(l.lapTime!);
          const isSelected = selected.includes(l.lap);
          const isBest = l === best;
          const status = !l.valid ? 'invalid' : l.kind !== 'flying' ? `${l.kind} lap` : isBest ? 'best lap' : 'clean';
          return (
            <g
              key={l.lap}
              className={`lt-point ${isCoachable(l) ? '' : 'is-hollow'} ${isBest ? 'is-best' : ''}`}
              tabIndex={0}
              role="checkbox"
              aria-checked={isSelected}
              aria-label={`Lap ${l.lap}, ${formatLapTime(l.lapTime)}, ${status}`}
              onPointerEnter={() => setActive(l.lap)}
              onPointerLeave={() => setActive((a) => (a === l.lap ? null : a))}
              onFocus={() => setActive(l.lap)}
              onBlur={() => setActive((a) => (a === l.lap ? null : a))}
              onClick={() => onToggle(l.lap)}
              onKeyDown={(e) => onKey(e, l.lap)}
            >
              <circle cx={x} cy={y} r={14} className="lt-hit" />
              {isSelected && <circle cx={x} cy={y} r={10} className="lt-selected-ring" />}
              <circle cx={x} cy={y} r={5} className="lt-dot" />
              {l.lapTime! > hi && (
                <text x={x} y={pad.top - 10} textAnchor="middle" className="lt-label">
                  off scale
                </text>
              )}
            </g>
          );
        })}
        {best && (
          <text x={xOf(best.lap)} y={yOf(best.lapTime!) + 24} textAnchor="middle" className="lt-label">
            Best
          </text>
        )}
      </svg>
      {activeLap && (
        <div className="chart-tooltip" style={{ left: xOf(activeLap.lap), top: yOf(activeLap.lapTime!) }}>
          <strong>{formatLapTime(activeLap.lapTime)}</strong>
          <span>Lap {activeLap.lap}</span>
          {best && activeLap !== best && <DeltaValue seconds={activeLap.lapTime! - best.lapTime!} words />}
          <LapStatus lap={activeLap} best={activeLap === best} />
        </div>
      )}
    </div>
  );
}
