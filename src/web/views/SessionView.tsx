import { useRef, useState, type KeyboardEvent } from 'react';
import { summariseStints, type StintSummary } from '../../shared/analysis/stints.ts';
import { formatLapTime, formatSectorTime, SESSION_LABELS, speedIn, speedLabel, temperatureIn, temperatureLabel } from '../../shared/format.ts';
import type { LapSummary, SessionMeta } from '../../shared/model/types.ts';
import { CarPicker } from '../components/CarPicker.tsx';
import { bestLap, bestSectors, formatSessionDate, isCoachable, LapStatus, sessionTitle } from '../components/laps.tsx';
import { lapRange, StintCornersCard, StintsCard, stintName, stintNote } from '../components/Stints.tsx';
import { Card, DeltaValue, EmptyState, Stat } from '../components/ui.tsx';
import { api, sendJson, useApi, type InsightsDto, type StintsDto } from '../lib/api.ts';
import { useLive } from '../lib/live.ts';
import { useRecordings, useStartReplay } from '../lib/replay.ts';
import { href, navigate } from '../lib/router.ts';
import { useSettings } from '../lib/settings.ts';
import { useElementWidth } from '../lib/useElementWidth.ts';

export function SessionView({ id }: { id: string }) {
  const lapSerial = useLive((s) => s.lapSerial);
  const isLive = useLive((s) => s.session?.id === id);
  const refresh = isLive ? lapSerial : 0;
  const session = useApi<SessionMeta>(api.session(id), refresh);
  const insights = useApi<InsightsDto>(api.insights(id), refresh);
  const stintData = useApi<StintsDto>(api.stints(id), refresh);
  const recording = useRecordings().data?.recordings.find((r) => r.sessionId === id && !r.active) ?? null;
  const replay = useStartReplay();
  const replaying = useLive((s) => recording !== null && s.status?.replay?.recording === recording.name);
  const { units, mirrorMap } = useSettings();
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
  // Found from the lap list, so they're here straight away. What needs the telemetry follows in `stintData`.
  const stints = summariseStints(s.laps);
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
          <CarPicker session={s} onChange={session.reload} />
        </div>
        <div className="page-actions">
          <a className="btn is-primary" href={href({ name: 'coach', id })}>
            Coach this session
          </a>
          <a className="btn" href={href({ name: 'setup', session: id, lap: null, compare: null, stint: null, compareStint: null })}>
            Car setup
          </a>
          {recording &&
            (replaying ? (
              <a className="btn" href={href({ name: 'live' })}>
                Watch the replay
              </a>
            ) : (
              <button
                type="button"
                className="btn"
                disabled={replay.busy !== null}
                onClick={() => void replay.start(recording.name)}
              >
                Replay session
              </button>
            ))}
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
      {replay.error && (
        <p className="error-text" role="alert">
          {replay.error}
        </p>
      )}

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
        <Stat
          label="Laps"
          value={s.laps.length}
          detail={`${s.laps.filter(isCoachable).length} clean flying laps${stints.length > 1 ? `, in ${stints.length} stints` : ''}`}
        />
      </div>

      <Card
        title="Lap times"
        description={
          'Filled dots are clean flying laps; hollow dots are out, in or invalid laps. Click or press Enter on a dot to select it.' +
          (stints.length > 1 ? ' Each band is a stint, with a dashed line at its typical lap.' : '')
        }
      >
        <LapTimeChart laps={s.laps} stints={stints} best={best} selected={selected} onToggle={toggle} />
      </Card>

      {stints.length > 1 && (
        <>
          <StintsCard session={s} stints={stints} details={stintData.data?.stints ?? null} units={units} onNoteSaved={session.reload} />
          {stintData.data && <StintCornersCard session={s} data={stintData.data} units={units} mirror={mirrorMap} />}
        </>
      )}

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
            {stints.map((stint) => (
              <tbody key={stint.id}>
                {stints.length > 1 && (
                  <tr className="stint-row">
                    <th scope="rowgroup" colSpan={12}>
                      {stintName(stint)}
                      <span className="muted">
                        {' · '}
                        {lapRange(stint)}
                        {stint.typicalLap !== null && ` · typical lap ${formatLapTime(stint.typicalLap)}`}
                        {stintNote(s, stint) && ` · ${stintNote(s, stint)}`}
                      </span>
                    </th>
                  </tr>
                )}
                {s.laps.slice(stint.first, stint.last + 1).map((lap, k) => {
                  const isSelected = selected.includes(lap.lap);
                  const avgTemp = lap.tyreTempAvg.reduce((a, b) => a + b, 0) / 4;
                  return (
                    <tr key={stint.first + k} aria-selected={isSelected}>
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
            ))}
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
  stints,
  best,
  selected,
  onToggle,
}: {
  laps: LapSummary[];
  stints: StintSummary[];
  best: LapSummary | null;
  selected: number[];
  onToggle: (lap: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(containerRef);
  const [active, setActive] = useState<number | null>(null);
  // Placed by position in the session, so stints sit side by side even where lap numbers repeat.
  const timed = laps.map((lap, index) => ({ lap, index })).filter((e) => e.lap.lapTime !== null);

  if (timed.length < 2 || width === 0) {
    return (
      <div ref={containerRef} className="laptime-chart">
        {timed.length < 2 && <p className="muted">The chart appears after two timed laps.</p>}
      </div>
    );
  }

  const clean = timed.filter((e) => isCoachable(e.lap));
  const basis = (clean.length >= 2 ? clean : timed).map((e) => e.lap.lapTime!);
  const fastest = Math.min(...basis);
  const slowest = Math.max(...basis);
  const lo = fastest - 0.3;
  // Keep the scale useful: very slow laps (spins, pit stops) sit on the top edge instead of flattening everything.
  const hi = Math.min(Math.max(slowest, fastest + 1), fastest * 1.07) + 0.3;
  const banded = stints.length > 1;
  const height = banded ? 256 : 240;
  const pad = { left: 64, right: 24, top: banded ? 40 : 24, bottom: 36 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const first = timed[0].index;
  const last = timed[timed.length - 1].index;
  const slot = last === first ? plotW : plotW / (last - first);
  const xOf = (index: number) => pad.left + (last === first ? plotW / 2 : (index - first) * slot);
  const yOf = (t: number) => pad.top + (1 - (Math.min(hi, Math.max(lo, t)) - lo) / (hi - lo)) * plotH;
  const tickStep = niceStep((hi - lo) / 4);
  const yTicks: number[] = [];
  for (let t = Math.ceil(lo / tickStep) * tickStep; t <= hi; t += tickStep) yTicks.push(t);
  const xEvery = Math.max(1, Math.ceil(timed.length / Math.max(2, Math.floor(plotW / 48))));
  // One line per stint: a line joining two stints would draw the time in the garage as a trend.
  const lines = stints.map((stint) =>
    clean
      .filter((e) => e.index >= stint.first && e.index <= stint.last)
      .map((e, i) => `${i ? 'L' : 'M'}${xOf(e.index).toFixed(1)},${yOf(e.lap.lapTime!).toFixed(1)}`)
      .join(''),
  );
  const bands = banded
    ? stints
        .filter((stint) => stint.last >= first && stint.first <= last)
        .map((stint) => {
          const from = Math.max(pad.left - 12, xOf(Math.max(first, stint.first)) - slot / 2);
          const to = Math.min(width - pad.right + 12, xOf(Math.min(last, stint.last)) + slot / 2);
          return { stint, from, to };
        })
    : [];
  const activeEntry = timed.find((e) => e.index === active) ?? null;
  const bestEntry = timed.find((e) => e.lap === best) ?? null;

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
        aria-label={`Lap times for ${timed.length} laps${banded ? ` in ${stints.length} stints` : ''}${best ? `, best ${formatLapTime(best.lapTime)} on lap ${best.lap}` : ''}. Every value is also in the table below.`}
      >
        {bands.map(({ stint, from, to }) => (
          <g key={stint.id}>
            <rect x={from} y={pad.top - 20} width={to - from} height={plotH + 20} className={`lt-band${stint.id % 2 === 0 ? ' is-alternate' : ''}`} />
            <text x={from + 6} y={pad.top - 7} className="lt-label">
              {to - from >= 58 ? stintName(stint) : stint.id}
            </text>
          </g>
        ))}
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={width - pad.right} y1={yOf(t)} y2={yOf(t)} className="lt-grid" />
            <text x={pad.left - 8} y={yOf(t)} textAnchor="end" dominantBaseline="middle" className="lt-axis-label">
              {shortTime(t)}
            </text>
          </g>
        ))}
        {timed.map((e, i) =>
          i % xEvery === 0 ? (
            <text key={e.index} x={xOf(e.index)} y={height - 12} textAnchor="middle" className="lt-axis-label">
              {i === 0 ? `Lap ${e.lap.lap}` : e.lap.lap}
            </text>
          ) : null,
        )}
        {bands.map(({ stint, from, to }) =>
          stint.typicalLap !== null && stint.typicalLap <= hi ? (
            <line key={stint.id} x1={from + 4} x2={to - 4} y1={yOf(stint.typicalLap)} y2={yOf(stint.typicalLap)} className="lt-typical">
              <title>{`${stintName(stint)}: typical lap ${formatLapTime(stint.typicalLap)}`}</title>
            </line>
          ) : null,
        )}
        {lines.map((line, i) => (
          <path key={i} d={line} className="lt-line" />
        ))}
        {timed.map(({ lap: l, index }) => {
          const x = xOf(index);
          const y = yOf(l.lapTime!);
          const isSelected = selected.includes(l.lap);
          const isBest = l === best;
          const status = !l.valid ? 'invalid' : l.kind !== 'flying' ? `${l.kind} lap` : isBest ? 'best lap' : 'clean';
          return (
            <g
              key={index}
              className={`lt-point ${isCoachable(l) ? '' : 'is-hollow'} ${isBest ? 'is-best' : ''}`}
              tabIndex={0}
              role="checkbox"
              aria-checked={isSelected}
              aria-label={`Lap ${l.lap}, ${formatLapTime(l.lapTime)}, ${status}`}
              onPointerEnter={() => setActive(index)}
              onPointerLeave={() => setActive((a) => (a === index ? null : a))}
              onFocus={() => setActive(index)}
              onBlur={() => setActive((a) => (a === index ? null : a))}
              onClick={() => onToggle(l.lap)}
              onKeyDown={(e) => onKey(e, l.lap)}
            >
              <circle cx={x} cy={y} r={14} className="lt-hit" />
              {isSelected && <circle cx={x} cy={y} r={10} className="lt-selected-ring" />}
              <circle cx={x} cy={y} r={5} className="lt-dot" />
              {l.lapTime! > hi && (
                <text x={x} y={pad.top + 20} textAnchor="middle" className="lt-label">
                  off scale
                </text>
              )}
            </g>
          );
        })}
        {bestEntry && (
          <text x={xOf(bestEntry.index)} y={yOf(best!.lapTime!) + 24} textAnchor="middle" className="lt-label">
            Best
          </text>
        )}
      </svg>
      {activeEntry && (
        <div className="chart-tooltip" style={{ left: xOf(activeEntry.index), top: yOf(activeEntry.lap.lapTime!) }}>
          <strong>{formatLapTime(activeEntry.lap.lapTime)}</strong>
          <span>Lap {activeEntry.lap.lap}</span>
          {best && activeEntry.lap !== best && <DeltaValue seconds={activeEntry.lap.lapTime! - best.lapTime!} words />}
          <LapStatus lap={activeEntry.lap} best={activeEntry.lap === best} />
        </div>
      )}
    </div>
  );
}
