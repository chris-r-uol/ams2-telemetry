import { useCallback, useId, useMemo, useState, type ReactNode } from 'react';
import type { Corner } from '../../shared/analysis/corners.ts';
import { describeTip, formatDelta, formatLapTime, speedIn, speedLabel } from '../../shared/format.ts';
import type { LapSummary, SessionMeta } from '../../shared/model/types.ts';
import { bestLap, formatSessionDate, LapStatus, sessionTitle } from '../components/laps.tsx';
import { TraceStack, type TracePanel } from '../components/TraceStack.tsx';
import { TrackMap, type MapSegment } from '../components/TrackMap.tsx';
import { Card, DeltaValue, EmptyState, Stat } from '../components/ui.tsx';
import { api, useApi, type CompareDto } from '../lib/api.ts';
import { navigate, type Route } from '../lib/router.ts';
import { useSettings } from '../lib/settings.ts';

type CompareRoute = Extract<Route, { name: 'compare' }>;

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: ReactNode;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function lapOptions(session: SessionMeta | null) {
  const best = bestLap(session);
  return (session?.laps ?? [])
    .filter((l) => l.lapTime !== null)
    .map((l) => ({
      value: String(l.lap),
      label: `Lap ${l.lap} · ${formatLapTime(l.lapTime)}${l === best ? ' · best' : ''}${!l.valid ? ' · invalid' : l.kind !== 'flying' ? ` · ${l.kind} lap` : ''}`,
    }));
}

function inCorner(distance: number, corner: Corner): boolean {
  return corner.ranges.some(([from, to]) => distance >= from && distance < to);
}

/** "14 m earlier" style difference between two distances; `a - b > 0` reads as `positive`. */
function distanceDifference(a: number | null, b: number | null, positive: string, negative: string, missing: string): string {
  if (a === null || b === null) return missing;
  const diff = a - b;
  if (Math.abs(diff) < 3) return 'Same';
  return `${Math.round(Math.abs(diff))} m ${diff > 0 ? positive : negative}`;
}

export function CompareView({ route }: { route: CompareRoute }) {
  const sessions = useApi<SessionMeta[]>(api.sessions());
  const { units, mirrorMap } = useSettings();
  const [hover, setHover] = useState<number | null>(null);
  const onHover = useCallback((distance: number | null) => setHover(distance), []);

  const list = sessions.data ?? [];
  const session = list.find((s) => s.id === route.session) ?? list[0] ?? null;
  const timed = (s: SessionMeta | null) => s?.laps.filter((l) => l.lapTime !== null) ?? [];
  const lap = route.lap ?? timed(session).at(-1)?.lap ?? null;
  const refSession = list.find((s) => s.id === route.refSession) ?? session;
  const refBest = bestLap(refSession);
  const refLap =
    route.refLap ??
    (refBest && !(refSession === session && refBest.lap === lap)
      ? refBest.lap
      : (timed(refSession).find((l) => l.lap !== lap)?.lap ?? null));
  const ready = session !== null && refSession !== null && lap !== null && refLap !== null;
  const compare = useApi<CompareDto>(ready ? api.compare(session.id, lap, refSession.id, refLap) : null);

  const view = useMemo(() => {
    const data = compare.data;
    if (!data) return null;
    const n = data.comparison.delta.length;
    const a = data.lap.resampled;
    const b = data.reference.resampled;
    const speed = (values: number[]) => values.slice(0, n).map((v) => speedIn(v, units.speed));
    const percent = (values: number[]) => values.slice(0, n).map((v) => v * 100);
    const whole = (v: number) => `${Math.round(v)}`;
    const panels: TracePanel[] = [
      { id: 'delta', title: 'Time difference (s), above zero is slower', height: 110, kind: 'delta', lap: data.comparison.delta, format: (v) => formatDelta(v, 2) },
      { id: 'speed', title: `Speed (${speedLabel(units.speed)})`, height: 170, lap: speed(a.speed), reference: speed(b.speed), format: whole },
      { id: 'throttle', title: 'Throttle (%)', height: 72, lap: percent(a.throttle), reference: percent(b.throttle), range: [0, 100], format: whole },
      { id: 'brake', title: 'Brake (%)', height: 72, lap: percent(a.brake), reference: percent(b.brake), range: [0, 100], format: whole },
      { id: 'steering', title: 'Steering (%, left is negative)', height: 84, lap: percent(a.steering), reference: percent(b.steering), range: [-100, 100], format: whole },
      { id: 'gear', title: 'Gear', height: 64, kind: 'step', lap: a.gear.slice(0, n), reference: b.gear.slice(0, n), format: whole },
    ];
    const segments: MapSegment[] = data.comparison.corners.map((c) => ({ corner: c.corner, timeDelta: c.timeDelta }));
    return { distance: b.d.slice(0, n), panels, segments };
  }, [compare.data, units.speed]);

  if (sessions.error) {
    return (
      <EmptyState title="Couldn't load sessions">
        <p className="error-text">{sessions.error}</p>
      </EmptyState>
    );
  }
  if (!sessions.data) {
    return (
      <p className="loading" role="status">
        Loading…
      </p>
    );
  }
  if (!session) {
    return (
      <EmptyState title="Nothing to compare yet">
        <p>Drive a couple of laps and come back to line them up against each other.</p>
      </EmptyState>
    );
  }

  const go = (patch: Partial<CompareRoute>) =>
    navigate({ name: 'compare', session: session.id, lap, refSession: refSession?.id ?? null, refLap, ...patch });
  const sameTrack = list.filter(
    (s) => s.track.location === session.track.location && s.track.variation === session.track.variation,
  );
  const data = compare.data;
  const lapSummary: LapSummary | null = data?.lap.summary ?? null;
  const refSummary: LapSummary | null = data?.reference.summary ?? null;
  const worst = data?.comparison.corners.reduce<(typeof data.comparison.corners)[number] | null>(
    (w, c) => (c.timeDelta > (w?.timeDelta ?? 0.005) ? c : w),
    null,
  );

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Compare laps</h1>
          <p className="secondary">{sessionTitle(session)}</p>
        </div>
      </header>

      <div className="compare-pickers" role="group" aria-label="Laps to compare">
        <Select
          label="Session"
          value={session.id}
          options={list.map((s) => ({ value: s.id, label: `${sessionTitle(s)} · ${formatSessionDate(s.startedAt)}` }))}
          onChange={(id) => go({ session: id, lap: null, refSession: id, refLap: null })}
        />
        <Select
          label={
            <span className="picker-key">
              <span className="key key-lap" aria-hidden="true" />
              Lap
            </span>
          }
          value={String(lap ?? '')}
          options={lapOptions(session)}
          onChange={(value) => go({ lap: Number(value) })}
        />
        <Select
          label="Reference session"
          value={refSession?.id ?? ''}
          options={sameTrack.map((s) => ({ value: s.id, label: `${formatSessionDate(s.startedAt)}${s.car ? ` · ${s.car}` : ''}` }))}
          onChange={(id) => go({ refSession: id, refLap: null })}
        />
        <Select
          label={
            <span className="picker-key">
              <span className="key key-reference" aria-hidden="true" />
              Reference lap
            </span>
          }
          value={String(refLap ?? '')}
          options={lapOptions(refSession)}
          onChange={(value) => go({ refLap: Number(value) })}
        />
        <button
          type="button"
          className="btn"
          onClick={() => go({ session: refSession?.id ?? session.id, lap: refLap, refSession: session.id, refLap: lap })}
          disabled={!ready}
        >
          Swap
        </button>
      </div>

      {compare.error && (
        <p className="error-text" role="alert">
          {compare.error}
        </p>
      )}
      {!ready && (
        <EmptyState title="Pick two laps">
          <p>This session needs at least two timed laps to compare.</p>
        </EmptyState>
      )}

      {data && view && lapSummary && refSummary && (
        <>
          <div className="stats-row">
            <Stat label={`Lap ${lapSummary.lap}`} value={formatLapTime(lapSummary.lapTime)} detail={<LapStatus lap={lapSummary} />} />
            <Stat label={`Reference, lap ${refSummary.lap}`} value={formatLapTime(refSummary.lapTime)} detail={<LapStatus lap={refSummary} />} />
            <Stat
              label="Difference"
              value={<DeltaValue seconds={(lapSummary.lapTime ?? 0) - (refSummary.lapTime ?? 0)} words />}
              detail="Whole lap, lap minus reference"
            />
            <Stat
              label="Biggest loss"
              value={worst ? worst.corner.name : 'None'}
              detail={worst ? <DeltaValue seconds={worst.timeDelta} words /> : 'No corner lost time'}
            />
          </div>

          <div className="compare-grid">
            <Card title="Telemetry" description="Your chosen lap against the reference, by distance around the lap">
              <TraceStack
                distance={view.distance}
                panels={view.panels}
                lapLabel={`Lap ${lapSummary.lap}`}
                referenceLabel={`Reference lap ${refSummary.lap}`}
                corners={data.corners}
                onHover={onHover}
                caption={`Lap ${lapSummary.lap} compared with reference lap ${refSummary.lap}: time difference, speed, throttle, brake, steering and gear by distance`}
              />
            </Card>

            <div className="sticky-side">
              <Card title="Where the time went" description="Corners marked by time gained or lost">
                <TrackMap
                  x={data.reference.resampled.x}
                  z={data.reference.resampled.z}
                  step={data.reference.resampled.step}
                  corners={data.corners}
                  segments={view.segments}
                  markerDistance={hover}
                  mirror={mirrorMap}
                  title={`Track map. ${view.segments.filter((s) => s.timeDelta >= 0.02).length} corners lost time and ${view.segments.filter((s) => s.timeDelta <= -0.02).length} gained time.`}
                />
                <p className="map-legend">
                  <span className="legend-item">
                    <span className="key key-slower" aria-hidden="true" />
                    Lost time (+)
                  </span>
                  <span className="legend-item">
                    <span className="key key-faster" aria-hidden="true" />
                    Gained time ({'−'})
                  </span>
                </p>
              </Card>
            </div>

            <Card title="Corner by corner" className="span-all" description="Lap values first, reference after the slash">
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th scope="col">Corner</th>
                      <th scope="col" className="num">Time</th>
                      <th scope="col" className="num">Braking</th>
                      <th scope="col" className="num">Slowest point</th>
                      <th scope="col" className="num">Back on throttle</th>
                      <th scope="col" className="num">Exit speed</th>
                      <th scope="col">What to try</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.comparison.corners.map((c) => {
                      const speed = (v: number) => `${Math.round(speedIn(v, units.speed))}`;
                      const tip = c.tips[0];
                      return (
                        <tr key={c.corner.id} className={hover !== null && inCorner(hover, c.corner) ? 'is-highlighted' : ''}>
                          <th scope="row" className="corner-row-name">
                            {c.corner.name}
                          </th>
                          <td className="num">
                            <DeltaValue seconds={c.timeDelta} />
                          </td>
                          <td className="num">
                            {distanceDifference(c.reference.brakePoint, c.lap.brakePoint, 'earlier', 'later', 'No braking')}
                          </td>
                          <td className="num">
                            {speed(c.lap.minSpeed)} <span className="muted">/ {speed(c.reference.minSpeed)} {speedLabel(units.speed)}</span>
                          </td>
                          <td className="num">
                            {distanceDifference(c.lap.throttlePoint, c.reference.throttlePoint, 'later', 'earlier', '–')}
                          </td>
                          <td className="num">
                            {speed(c.lap.exitSpeed)} <span className="muted">/ {speed(c.reference.exitSpeed)} {speedLabel(units.speed)}</span>
                          </td>
                          <td>{tip ? describeTip(tip, units).title : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
