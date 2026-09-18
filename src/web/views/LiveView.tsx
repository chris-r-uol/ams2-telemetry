/**
 * The second-monitor view: a preset of live cards that fits on one screen, with
 * the track map, car details, traces and recent laps below. Components subscribe
 * to only the live values they show, so a 20 Hz stream doesn't re-render the
 * whole page.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  formatLapTime,
  formatSectorTime,
  pressureIn,
  pressureLabel,
  SESSION_LABELS,
  speedIn,
  speedLabel,
  temperatureIn,
  temperatureLabel,
  type Units,
} from '../../shared/format.ts';
import type { FlagColour } from '../../shared/protocol/constants.ts';
import type { FuelState, LiveFrame, SessionMeta } from '../../shared/model/types.ts';
import { bestLap, bestSectors, gearLabel, LapStatus } from '../components/laps.tsx';
import { PresetBoard } from '../components/PresetBoard.tsx';
import { RecordButton } from '../components/RecordButton.tsx';
import { TraceStack, type TracePanel } from '../components/TraceStack.tsx';
import { LiveTrackMap, useCostlyCorners, useLiveReference } from '../cards/TrackMapCard.tsx';
import { Card, DeltaValue, EmptyState } from '../components/ui.tsx';
import type { LiveReferenceDto } from '../lib/api.ts';
import { getLive, getTrail, subscribeLive, useLive } from '../lib/live.ts';
import { href } from '../lib/router.ts';
import { useSettings, type Settings } from '../lib/settings.ts';
import { tyreReadings } from '../lib/tyres.ts';

const FLAG_LABELS: Partial<Record<FlagColour, string>> = {
  blue: 'Blue flag',
  yellow: 'Yellow flag',
  doubleYellow: 'Double yellow flag',
  red: 'Red flag',
  whiteSlowCar: 'Slow car ahead',
  whiteFinalLap: 'Final lap',
  blackAndWhite: 'Black and white flag',
  blackOrangeCircle: 'Mechanical flag',
  black: 'Black flag',
  chequered: 'Chequered flag',
};

export function LiveView() {
  const settings = useSettings();
  const sessionId = useLive((s) => s.frame?.sessionId ?? null);
  const receiving = useLive((s) => s.frame?.receiving ?? false);
  const session = useLive((s) => s.session);
  const source = useLive((s) => s.status?.source ?? null);
  const reference = useLiveReference();

  if (!sessionId) {
    return <WaitingForGame receiving={receiving} source={source} />;
  }

  return (
    <div className="live">
      <SessionStrip session={session} />
      <PresetBoard />
      <section aria-labelledby="live-more-title">
        <h2 id="live-more-title" className="live-more-title">
          Track, car and traces
        </h2>
        <div className="live-grid">
          <MapCard reference={reference} />
          <CarCard settings={settings} />
          <LiveTraceCard reference={reference} units={settings.units} />
          <RecentLaps session={session} />
        </div>
      </section>
    </div>
  );
}

function WaitingForGame({ receiving, source }: { receiving: boolean; source: string | null }) {
  if (receiving) {
    return (
      <EmptyState title="Connected. Get out on track">
        <p>Telemetry is arriving. A session starts as soon as you're driving.</p>
      </EmptyState>
    );
  }
  return (
    <EmptyState title="Waiting for Automobilista 2">
      {source === 'udp' ? (
        <>
          <p>Turn on UDP telemetry in the game, then head out on track:</p>
          <ol className="steps">
            <li>
              In AMS2 open <strong>Options → System</strong>.
            </li>
            <li>
              Set <strong>UDP Frequency</strong> to <strong>1</strong> (fastest).
            </li>
            <li>
              Set <strong>UDP Protocol Version</strong> to <strong>Project CARS 2</strong>.
            </li>
            <li>Drive. This page updates automatically.</li>
          </ol>
          <p className="muted">
            No game handy? Restart with <code>npm run demo</code> to watch a simulated driver.
          </p>
        </>
      ) : (
        <p>Waiting for the first packets…</p>
      )}
    </EmptyState>
  );
}

function SessionStrip({ session }: { session: SessionMeta | null }) {
  const lap = useLive((s) => s.frame?.lap ?? 0);
  const lapTime = useLive((s) => s.frame?.lapTime ?? 0);
  const sector = useLive((s) => s.frame?.sector ?? 1);
  const position = useLive((s) => s.frame?.position ?? 0);
  const participants = useLive((s) => s.frame?.numParticipants ?? 0);
  const pitMode = useLive((s) => s.frame?.pitMode ?? 'none');
  const flag = useLive((s) => s.frame?.flag ?? 'none');
  const gameState = useLive((s) => s.frame?.gameState ?? 'playing');
  const flagLabel = FLAG_LABELS[flag];

  return (
    <div className="live-strip">
      <div className="live-strip-title">
        <h1>{session?.track.location ?? 'Live session'}</h1>
        <p className="secondary">
          {[session?.track.variation, session?.car, session ? SESSION_LABELS[session.sessionType] : null]
            .filter(Boolean)
            .join(' · ')}
          {session && (!session.car || session.carSource === 'remembered') && (
            <>
              {session.car ? ' (assumed) · ' : ' · '}
              <a href={href({ name: 'session', id: session.id })}>{session.car ? 'Change car' : 'Set your car'}</a>
            </>
          )}
        </p>
      </div>
      <dl className="strip-facts">
        <div>
          <dt>Lap</dt>
          <dd className="tabular">{lap || '–'}</dd>
        </div>
        <div>
          <dt>Lap time</dt>
          <dd className="tabular">{lapTime > 0 ? formatLapTime(lapTime) : '–'}</dd>
        </div>
        <div>
          <dt>Sector</dt>
          <dd className="tabular">{sector}</dd>
        </div>
        {participants > 1 && (
          <div>
            <dt>Position</dt>
            <dd className="tabular">
              {position} / {participants}
            </dd>
          </div>
        )}
      </dl>
      <div className="strip-badges">
        {gameState === 'paused' && <span className="badge">Paused</span>}
        {pitMode !== 'none' && <span className="badge badge-accent">In the pit lane</span>}
        {flagLabel && (
          <span className="badge badge-warning">
            <span aria-hidden="true">{'⚑'}</span> {flagLabel}
          </span>
        )}
      </div>
      <div className="strip-actions">
        <RecordButton />
      </div>
    </div>
  );
}

function MapCard({ reference }: { reference: LiveReferenceDto | null }) {
  const feedback = useLive((s) => s.feedback);
  const segments = useCostlyCorners(reference, feedback);
  return (
    <Card title="Track" className="map-card" description={segments?.length ? 'Marked corners cost the most time last lap' : undefined}>
      <LiveTrackMap reference={reference} segments={segments} />
    </Card>
  );
}

function Meter({ label, value, max, display, className = '' }: { label: string; value: number; max: number; display: string; className?: string }) {
  const fraction = Math.max(0, Math.min(1, max > 0 ? value / max : 0));
  return (
    <div className={`meter ${className}`}>
      <div className="meter-head">
        <span>{label}</span>
        <span className="tabular">{display}</span>
      </div>
      <div className="meter-track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)}>
        <div className="meter-fill" style={{ transform: `scaleX(${fraction})` }} />
      </div>
    </div>
  );
}

function SteeringMeter({ value }: { value: number }) {
  const clamped = Math.max(-1, Math.min(1, value));
  return (
    <div className="meter meter-steering">
      <div className="meter-head">
        <span>Steering</span>
        <span className="tabular">
          {Math.abs(clamped) < 0.02 ? 'Straight' : `${Math.round(Math.abs(clamped) * 100)}% ${clamped < 0 ? 'left' : 'right'}`}
        </span>
      </div>
      <div className="meter-track steering-track" aria-hidden="true">
        <div
          className="steering-fill"
          style={{ left: clamped < 0 ? `${50 + clamped * 50}%` : '50%', width: `${Math.abs(clamped) * 50}%` }}
        />
      </div>
    </div>
  );
}

const WHEELS = [
  ['FL', 'Front left'],
  ['FR', 'Front right'],
  ['RL', 'Rear left'],
  ['RR', 'Rear right'],
] as const;

function Tyres({ frame, settings }: { frame: LiveFrame; settings: Settings }) {
  const { units } = settings;
  const session = useLive((s) => s.session);
  const readings = tyreReadings(frame, session, settings);
  return (
    <div className="tyres" role="group" aria-label="Tyres">
      {WHEELS.map(([short, name], i) => {
        const { temp, state } = readings[i];
        const pressure = pressureIn(frame.tyres.pressureKPa[i], units.pressure);
        return (
          <div key={short} className={`tyre ${state ? `is-${state}` : ''}`}>
            <div className="tyre-name">
              <abbr title={name}>{short}</abbr>
            </div>
            <div className="tyre-temp tabular">
              {temp > 0 ? `${Math.round(temperatureIn(temp, units.temperature))}${temperatureLabel(units.temperature)}` : '–'}
            </div>
            <div className="tyre-meta tabular">
              {pressure > 0 ? `${pressure.toFixed(units.pressure === 'kpa' ? 0 : units.pressure === 'bar' ? 2 : 1)} ${pressureLabel(units.pressure)}` : '–'}
              {' · '}
              {Math.round(frame.tyres.wear[i] * 100)}% worn
            </div>
            {state === 'cold' && <span className="badge badge-accent">Cold</span>}
            {state === 'hot' && (
              <span className="badge badge-warning">
                <span aria-hidden="true">{'▲'}</span> Hot
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Fuel({ fuel }: { fuel: FuelState }) {
  return (
    <dl className="fuel">
      <div>
        <dt>Fuel</dt>
        <dd className="tabular">{fuel.capacity > 0 ? `${fuel.litres.toFixed(1)} L` : '–'}</dd>
      </div>
      <div>
        <dt>Per lap</dt>
        <dd className="tabular">{fuel.perLap !== null ? `${fuel.perLap.toFixed(2)} L` : '–'}</dd>
      </div>
      <div>
        <dt>Laps left</dt>
        <dd className="tabular">{fuel.lapsRemaining !== null ? fuel.lapsRemaining.toFixed(1) : '–'}</dd>
      </div>
    </dl>
  );
}

function CarCard({ settings }: { settings: Settings }) {
  const frame = useLive((s) => s.frame);
  if (!frame) return null;
  const { units } = settings;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <Card title="Car" className="car-card">
      <div className="car-top">
        <div className="gear">
          <span className="gear-value" aria-label={`Gear ${gearLabel(frame.gear)}`}>
            {gearLabel(frame.gear)}
          </span>
          <span className="stat-label">Gear</span>
        </div>
        <div className="speed">
          <span className="speed-value tabular">{Math.round(speedIn(frame.speed, units.speed))}</span>
          <span className="stat-label">{speedLabel(units.speed)}</span>
        </div>
        <Meter label="RPM" value={frame.rpm} max={frame.maxRpm} display={String(Math.round(frame.rpm))} className="meter-rpm" />
      </div>
      <div className="pedals">
        <Meter label="Throttle" value={frame.throttle} max={1} display={pct(frame.throttle)} className="meter-throttle" />
        <Meter label="Brake" value={frame.brake} max={1} display={pct(frame.brake)} className="meter-brake" />
        <SteeringMeter value={frame.steering} />
      </div>
      <Tyres frame={frame} settings={settings} />
      <Fuel fuel={frame.fuel} />
    </Card>
  );
}

function LiveTraceCard({ reference, units }: { reference: LiveReferenceDto | null; units: Units }) {
  const markerRef = useRef<number | null>(null);
  const [version, setVersion] = useState(0);
  const lapSeries = useRef({ lap: -1, filled: -1, speed: [] as (number | null)[], throttle: [] as (number | null)[], brake: [] as (number | null)[] });

  const referenceSeries = useMemo(() => {
    if (!reference) return null;
    const r = reference.resampled;
    return {
      speed: r.speed.map((v) => speedIn(v, units.speed)),
      throttle: r.throttle.map((v) => v * 100),
      brake: r.brake.map((v) => v * 100),
    };
  }, [reference, units.speed]);

  useEffect(() => {
    if (!reference) return;
    const n = reference.resampled.d.length;
    const step = reference.resampled.step;
    const series = lapSeries.current;
    const reset = (lap: number) => {
      series.lap = lap;
      series.filled = -1;
      series.speed = new Array(n).fill(null);
      series.throttle = new Array(n).fill(null);
      series.brake = new Array(n).fill(null);
    };
    reset(-1);
    let lastUpdate = 0;
    // Fill the reference's distance grid from live frames, ~8 times a second.
    return subscribeLive(() => {
      const now = performance.now();
      if (now - lastUpdate < 125) return;
      lastUpdate = now;
      const frame = getLive().frame;
      const trail = getTrail();
      if (!frame || trail.d.length < 2) return;
      if (trail.lap !== series.lap) reset(trail.lap);
      const td = trail.d;
      let j = 0;
      for (let gi = series.filled + 1; gi < n; gi++) {
        const gd = gi * step;
        if (gd > td[td.length - 1]) break;
        if (gd < td[0]) continue;
        while (j < td.length - 2 && td[j + 1] < gd) j++;
        const f = Math.max(0, Math.min(1, (gd - td[j]) / (td[j + 1] - td[j] || 1)));
        const lerp = (a: number[]) => a[j] + (a[j + 1] - a[j]) * f;
        series.speed[gi] = speedIn(lerp(trail.speed), units.speed);
        series.throttle[gi] = lerp(trail.throttle) * 100;
        series.brake[gi] = lerp(trail.brake) * 100;
        series.filled = gi;
      }
      markerRef.current = frame.lapDistance;
      setVersion((v) => v + 1);
    });
  }, [reference, units.speed]);

  if (!reference || !referenceSeries) {
    return (
      <Card title="This lap vs reference" className="trace-card">
        <p className="muted">Traces appear once you have a reference lap.</p>
      </Card>
    );
  }

  const s = lapSeries.current;
  const unit = speedLabel(units.speed);
  const panels: TracePanel[] = [
    { id: 'speed', title: `Speed (${unit})`, height: 150, lap: s.speed, reference: referenceSeries.speed, format: (v) => `${Math.round(v)}` },
    { id: 'throttle', title: 'Throttle (%)', height: 64, lap: s.throttle, reference: referenceSeries.throttle, range: [0, 100], format: (v) => `${Math.round(v)}` },
    { id: 'brake', title: 'Brake (%)', height: 64, lap: s.brake, reference: referenceSeries.brake, range: [0, 100], format: (v) => `${Math.round(v)}` },
  ];
  const refName = reference.source === 'all-time' ? 'All-time best' : `Session best · lap ${reference.lap}`;

  return (
    <Card title="This lap vs reference" className="trace-card" description="Speed and pedals against distance, updating as you drive">
      <TraceStack
        distance={reference.resampled.d}
        panels={panels}
        lapLabel="This lap"
        referenceLabel={refName}
        corners={reference.corners}
        markerRef={markerRef}
        dataVersion={version}
        caption={`Speed, throttle and brake for the current lap compared with ${refName}`}
      />
    </Card>
  );
}

function RecentLaps({ session }: { session: SessionMeta | null }) {
  if (!session || session.laps.length === 0) return null;
  const best = bestLap(session);
  const sectors = bestSectors(session.laps);
  const laps = session.laps.slice(-8).reverse();
  return (
    <Card
      title="Recent laps"
      className="laps-card"
      actions={
        <a className="btn btn-small" href={href({ name: 'session', id: session.id })}>
          All laps
        </a>
      }
    >
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Lap</th>
              <th scope="col" className="num">Time</th>
              <th scope="col" className="num">To best</th>
              <th scope="col" className="num">S1</th>
              <th scope="col" className="num">S2</th>
              <th scope="col" className="num">S3</th>
              <th scope="col">Status</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {laps.map((lap) => (
              <tr key={lap.lap}>
                <th scope="row" className="tabular">{lap.lap}</th>
                <td className="num">{formatLapTime(lap.lapTime)}</td>
                <td className="num">
                  {best && lap !== best && lap.lapTime !== null ? <DeltaValue seconds={lap.lapTime - best.lapTime!} /> : '—'}
                </td>
                {lap.sectors.map((s, i) => (
                  <td key={i} className={`num ${s !== null && s === sectors[i] ? 'is-best-sector' : ''}`}>
                    {formatSectorTime(s)}
                    {s !== null && s === sectors[i] && <span className="visually-hidden"> (best sector)</span>}
                  </td>
                ))}
                <td>
                  <LapStatus lap={lap} best={lap === best} />
                </td>
                <td>
                  {best && lap !== best && lap.lapTime !== null && (
                    <a href={href({ name: 'compare', session: session.id, lap: lap.lap, refSession: session.id, refLap: best.lap })}>
                      Compare<span className="visually-hidden"> lap {lap.lap} with best</span>
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
