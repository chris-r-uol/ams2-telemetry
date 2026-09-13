/**
 * Car setup: understeer/oversteer, sliding, suspension, ride height, dampers
 * and roll/pitch figures, with suggestions for what to change.
 */
import { useId, useMemo, useState, type ReactNode } from 'react';
import type {
  ChassisAnalysis,
  ChassisEvent,
  ChassisEventKind,
  ChassisLapSeries,
  PhaseBalance,
  SetupHint,
  Wheel,
  WheelSummary,
} from '../../shared/analysis/chassis.ts';
import type { Corner } from '../../shared/analysis/corners.ts';
import { formatLapTime, speedIn, speedLabel, type Units } from '../../shared/format.ts';
import type { SessionMeta } from '../../shared/model/types.ts';
import { DamperHistogramChart } from '../components/DamperHistogram.tsx';
import { bestLap, formatSessionDate, sessionTitle } from '../components/laps.tsx';
import { TraceStack, type TraceMarker, type TracePanel } from '../components/TraceStack.tsx';
import { Card, EmptyState, Stat } from '../components/ui.tsx';
import { api, useApi, type ChassisDto } from '../lib/api.ts';
import { useLive } from '../lib/live.ts';
import { navigate, type Route } from '../lib/router.ts';
import { useSettings } from '../lib/settings.ts';

type SetupRoute = Extract<Route, { name: 'setup' }>;

const WHEEL_NAMES: Record<Wheel, string> = {
  FL: 'Front left',
  FR: 'Front right',
  RL: 'Rear left',
  RR: 'Rear right',
};

const EVENT_LABELS: Record<ChassisEventKind, string> = {
  'lock-up': 'Lock-up',
  wheelspin: 'Wheelspin',
  oversteer: 'Oversteer moment',
  bottoming: 'Bottoming',
  'bump-stop': 'Bump stop',
  'wheel-lift': 'Wheel lift',
};

const PER_LAP_LABELS: Record<ChassisEventKind, string> = {
  bottoming: 'Bottoming per lap',
  'bump-stop': 'Bump-stop hits per lap',
  'wheel-lift': 'Wheel lifts per lap',
  'lock-up': 'Lock-ups per lap',
  wheelspin: 'Wheelspin moments per lap',
  oversteer: 'Oversteer moments per lap',
};

const IMPORTANCE: Record<SetupHint['importance'], { label: string; className: string }> = {
  high: { label: 'Important', className: 'badge-bad' },
  medium: { label: 'Worth trying', className: 'badge-warning' },
  low: { label: 'Minor', className: '' },
};

const mm = (metres: number | null | undefined, digits = 0) =>
  metres === null || metres === undefined || !Number.isFinite(metres) ? '–' : `${(metres * 1000).toFixed(digits)} mm`;
const perG = (metres: number | null | undefined) =>
  metres === null || metres === undefined ? '–' : `${(metres * 1000).toFixed(1)} mm/g`;
const percent = (share: number) => `${Math.round(share * 100)}%`;
const whole = (v: number) => `${Math.round(v)}`;

function toMarkers(events: ChassisEvent[], kinds: ChassisEventKind[]): TraceMarker[] {
  return events
    .filter((e) => kinds.includes(e.kind))
    .map((e) => ({ distance: e.distance, label: `${EVENT_LABELS[e.kind]}${e.wheel ? ` (${e.wheel})` : ''}` }));
}

function Picker({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
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

export function SetupView({ route }: { route: SetupRoute }) {
  const { units } = useSettings();
  const lapSerial = useLive((s) => s.lapSerial);
  const liveId = useLive((s) => s.session?.id ?? null);
  const sessions = useApi<SessionMeta[]>(api.sessions(), lapSerial);
  const list = sessions.data ?? [];
  const session = list.find((s) => s.id === route.session) ?? list[0] ?? null;
  const isLive = session !== null && session.id === liveId;
  const refresh = isLive ? lapSerial : 0;
  const chassis = useApi<ChassisDto>(session ? api.chassis(session.id) : null, refresh);
  const sameTrack = session
    ? list.filter(
        (s) =>
          s.id !== session.id &&
          s.track.location === session.track.location &&
          s.track.variation === session.track.variation,
      )
    : [];
  const other = sameTrack.find((s) => s.id === route.compare) ?? null;
  const otherChassis = useApi<ChassisDto>(other ? api.chassis(other.id) : null);
  const timed = session?.laps.filter((l) => l.lapTime !== null) ?? [];
  const lap = route.lap ?? bestLap(session)?.lap ?? timed.at(-1)?.lap ?? null;
  const series = useApi<ChassisLapSeries>(session && lap !== null ? api.chassisLap(session.id, lap) : null, refresh);

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
      <EmptyState title="No sessions yet">
        <p>Drive some laps and the car's balance, suspension and dampers will be analysed here.</p>
      </EmptyState>
    );
  }

  const go = (patch: Partial<SetupRoute>) =>
    navigate({ name: 'setup', session: session.id, lap, compare: other?.id ?? null, ...patch });
  const analysis = chassis.data?.analysis ?? null;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">
            {formatSessionDate(session.startedAt)}
            {session.car && ` · ${session.car}`}
            {isLive && <span className="badge badge-good">Live</span>}
          </p>
          <h1>Car setup</h1>
          <p className="secondary">{sessionTitle(session)}</p>
        </div>
      </header>

      <div className="compare-pickers" role="group" aria-label="What to analyse">
        <Picker
          label="Session"
          value={session.id}
          options={list.map((s) => ({ value: s.id, label: `${sessionTitle(s)} · ${formatSessionDate(s.startedAt)}` }))}
          onChange={(id) => go({ session: id, lap: null, compare: null })}
        />
        <Picker
          label="Lap to plot"
          value={String(lap ?? '')}
          options={timed.map((l) => ({ value: String(l.lap), label: `Lap ${l.lap} · ${formatLapTime(l.lapTime)}` }))}
          onChange={(value) => go({ lap: Number(value) })}
        />
        <Picker
          label="Compare with another setup"
          value={other?.id ?? ''}
          options={[
            { value: '', label: sameTrack.length ? 'None' : 'No other sessions at this track' },
            ...sameTrack.map((s) => ({ value: s.id, label: `${formatSessionDate(s.startedAt)}${s.car ? ` · ${s.car}` : ''}` })),
          ]}
          onChange={(value) => go({ compare: value || null })}
        />
      </div>

      {chassis.error && (
        <p className="error-text" role="alert">
          {chassis.error}
        </p>
      )}
      {!analysis && !chassis.error && (
        <p className="loading" role="status">
          Analysing chassis data…
        </p>
      )}
      {analysis && (
        <SetupBody
          analysis={analysis}
          corners={chassis.data?.corners ?? []}
          series={series.data}
          units={units}
          session={session}
          other={other}
          otherAnalysis={otherChassis.data?.analysis ?? null}
        />
      )}
    </div>
  );
}

function SetupBody({
  analysis,
  corners,
  series,
  units,
  session,
  other,
  otherAnalysis,
}: {
  analysis: ChassisAnalysis;
  corners: Corner[];
  series: ChassisLapSeries | null;
  units: Units;
  session: SessionMeta;
  other: SessionMeta | null;
  otherAnalysis: ChassisAnalysis | null;
}) {
  if (analysis.lapsAnalysed === 0) {
    return (
      <EmptyState title="No complete laps yet">
        <p>Chassis analysis starts after your first full lap.</p>
      </EmptyState>
    );
  }
  if (!Object.values(analysis.availability).some(Boolean)) {
    return (
      <EmptyState title="There's no chassis data in this session">
        <p>
          Suspension, ride height, wheel speed and yaw values are all empty. Sessions saved before this page existed
          won't have them.
        </p>
        <p>
          If this session is new, record some raw telemetry (Sessions page, Record telemetry) and share the file so the
          decoding can be checked against the real game.
        </p>
      </EmptyState>
    );
  }
  return (
    <>
      <DataCard analysis={analysis} />
      <HintsCard hints={analysis.hints} />
      <BalanceCard analysis={analysis} corners={corners} series={series} units={units} />
      <SuspensionCard analysis={analysis} corners={corners} series={series} />
      <DampersCard analysis={analysis} />
      <PlatformCard analysis={analysis} units={units} />
      {other && otherAnalysis && (
        <ComparisonCard analysis={analysis} session={session} other={other} otherAnalysis={otherAnalysis} />
      )}
    </>
  );
}

function DataCard({ analysis }: { analysis: ChassisAnalysis }) {
  const { availability: av, calibration: cal } = analysis;
  const items: { label: string; ok: boolean; missing: string }[] = [
    {
      label: 'Understeer and oversteer',
      ok: cal.steerPerCurvature !== null,
      missing: av.yawRate ? 'needs more steady cornering to calibrate' : 'yaw rate not sent',
    },
    { label: 'Sliding (slip angle)', ok: av.slipAngle, missing: 'body velocity not sent' },
    {
      label: 'Wheel lock and wheelspin',
      ok: av.wheelSpeed && cal.wheelRadius.some((r) => r !== null),
      missing: av.wheelSpeed ? 'needs some straight-line running to calibrate' : 'wheel speeds not sent',
    },
    { label: 'Suspension travel', ok: av.suspension, missing: 'not sent' },
    { label: 'Damper speed', ok: av.dampers, missing: 'not sent' },
    {
      label: av.rideHeight ? `Ride height (sent in ${cal.rideHeightUnit})` : 'Ride height',
      ok: av.rideHeight,
      missing: 'not sent',
    },
    { label: 'Wheels touching the ground', ok: av.wheelContact, missing: 'not sent' },
  ];
  return (
    <Card
      title="Data from the game"
      description={`${analysis.lapsAnalysed} ${analysis.lapsAnalysed === 1 ? 'lap' : 'laps'} analysed`}
    >
      <ul className="availability">
        {items.map((item) => (
          <li key={item.label} className={item.ok ? '' : 'is-missing'}>
            <span aria-hidden="true">{item.ok ? '✓' : '✕'}</span>
            <span>
              {item.label}: {item.ok ? 'available' : item.missing}
            </span>
          </li>
        ))}
      </ul>
      <div className="calibration-notes">
        {cal.sampleRate !== null && (
          <p>
            {Math.round(cal.sampleRate)} samples per second.
            {cal.sampleRate < 100 &&
              ' Dampers can move faster than that, so the fast bump and rebound figures are approximate.'}
          </p>
        )}
        <p>
          Understeer and oversteer are measured against how much steering this car needs in gentle corners, worked out
          from your own laps. Units and directions are detected from the data too.
        </p>
      </div>
    </Card>
  );
}

function HintsCard({ hints }: { hints: SetupHint[] }) {
  return (
    <Card
      title="What the data suggests"
      description="Patterns from your laps, not guarantees. Change one thing at a time, then compare the sessions."
    >
      {hints.length === 0 ? (
        <p className="muted">Nothing stands out yet. Patterns need a few laps to show up.</p>
      ) : (
        <ul className="hint-list">
          {hints.map((hint) => (
            <li key={hint.id} className={`hint is-${hint.importance}`}>
              <div className="hint-head">
                <span className={`badge ${IMPORTANCE[hint.importance].className}`}>{IMPORTANCE[hint.importance].label}</span>
                <strong>{hint.title}</strong>
              </div>
              <p>{hint.evidence}</p>
              <p className="hint-try">Things to try:</p>
              <ul>
                {hint.tryThis.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function VerdictBadge({ phase }: { phase: PhaseBalance }) {
  if (phase.verdict === null || phase.ratio === null) return <span className="muted">–</span>;
  const amount = `${phase.ratio > 0 ? '+' : phase.ratio < 0 ? '−' : ''}${Math.abs(Math.round(phase.ratio * 100))}%`;
  if (phase.verdict === 'neutral') {
    return (
      <span className="badge">
        Neutral <span className="tabular">{amount}</span>
      </span>
    );
  }
  return (
    <span className={`badge badge-${phase.verdict}`}>
      {phase.verdict === 'understeer' ? 'Understeer' : 'Oversteer'} <span className="tabular">{amount}</span>
    </span>
  );
}

function BalanceCard({
  analysis,
  corners,
  series,
  units,
}: {
  analysis: ChassisAnalysis;
  corners: Corner[];
  series: ChassisLapSeries | null;
  units: Units;
}) {
  const calibrated = analysis.calibration.steerPerCurvature !== null;
  const hasSlip = analysis.availability.slipAngle;
  const markers = useMemo(() => (series ? toMarkers(series.events, ['oversteer', 'lock-up', 'wheelspin']) : []), [series]);
  const panels = useMemo<TracePanel[]>(() => {
    if (!series) return [];
    const list: TracePanel[] = [];
    if (calibrated) {
      list.push({
        id: 'balance',
        title: 'Balance (% of steering lock): above zero understeer, below zero oversteer',
        height: 150,
        kind: 'delta',
        fills: ['--lap-wash', '--brake-wash'],
        lap: series.balance,
        format: (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v))}%`,
      });
    }
    if (hasSlip) {
      list.push({ id: 'slip', title: 'Slip angle (degrees)', height: 90, lap: series.slipAngle, format: (v) => `${v.toFixed(1)}°` });
    }
    list.push({
      id: 'speed',
      title: `Speed (${speedLabel(units.speed)})`,
      height: 90,
      lap: series.speed.map((v) => (v === null ? null : speedIn(v, units.speed))),
      format: whole,
    });
    return list;
  }, [series, calibrated, hasSlip, units.speed]);

  return (
    <Card
      title="Balance and grip"
      description={
        calibrated
          ? 'How much steering you used compared with what the car needed'
          : 'The balance trace appears once there is enough steady cornering to calibrate against'
      }
    >
      {series && panels.length > 0 && (
        <>
          <TraceStack
            distance={series.distance}
            panels={panels}
            lapLabel={`Lap ${series.lap}`}
            corners={corners}
            markers={markers}
            caption={`Balance, slip angle and speed for lap ${series.lap}, with lock-ups, wheelspin and oversteer moments marked`}
          />
          <p className="map-legend">
            {calibrated && (
              <>
                <span className="legend-item">
                  <span className="swatch swatch-understeer" aria-hidden="true" />
                  Understeer: more steering than the car needed
                </span>
                <span className="legend-item">
                  <span className="swatch swatch-oversteer" aria-hidden="true" />
                  Oversteer: less steering, or opposite lock
                </span>
              </>
            )}
            <span className="legend-item">
              <span aria-hidden="true">{'▼'}</span> Event: point at it to see what happened
            </span>
          </p>
        </>
      )}

      {analysis.corners.length > 0 && (
        <div className="table-wrap setup-table">
          <table className="data">
            <caption>
              Balance through each corner across your clean laps. Percentages compare the steering you used with the
              steering the car needed there: +20% means a fifth more than needed.
            </caption>
            <thead>
              <tr>
                <th scope="col">Corner</th>
                <th scope="col">Entry</th>
                <th scope="col">Mid-corner</th>
                <th scope="col">Exit</th>
                <th scope="col" className="num">Peak slip angle</th>
                <th scope="col" className="num">Oversteer moments</th>
                <th scope="col" className="num">Lock-ups</th>
                <th scope="col" className="num">Wheelspin</th>
              </tr>
            </thead>
            <tbody>
              {analysis.corners.map((c) => (
                <tr key={c.cornerId}>
                  <th scope="row" className="corner-row-name">
                    {c.corner}
                  </th>
                  <td>
                    <VerdictBadge phase={c.entry} />
                  </td>
                  <td>
                    <VerdictBadge phase={c.mid} />
                  </td>
                  <td>
                    <VerdictBadge phase={c.exit} />
                  </td>
                  <td className="num">{c.slipAngle !== null ? `${c.slipAngle.toFixed(1)}°` : '–'}</td>
                  <td className="num">{c.oversteerMoments}</td>
                  <td className="num">{c.lockUps}</td>
                  <td className="num">{c.wheelspin}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function SuspensionCard({
  analysis,
  corners,
  series,
}: {
  analysis: ChassisAnalysis;
  corners: Corner[];
  series: ChassisLapSeries | null;
}) {
  const av = analysis.availability;
  const markers = useMemo(
    () => (series ? toMarkers(series.events, ['bottoming', 'bump-stop', 'wheel-lift']) : []),
    [series],
  );
  const panels = useMemo<TracePanel[]>(() => {
    if (!series) return [];
    const list: TracePanel[] = [];
    if (av.suspension) {
      list.push(
        { id: 'travel-front', title: 'Front suspension compression (mm)', height: 110, lap: series.travel[0], reference: series.travel[1], format: whole },
        { id: 'travel-rear', title: 'Rear suspension compression (mm)', height: 110, lap: series.travel[2], reference: series.travel[3], format: whole },
      );
    }
    if (av.rideHeight) {
      list.push(
        { id: 'ride-front', title: 'Front ride height (mm)', height: 110, lap: series.ride[0], reference: series.ride[1], format: whole },
        { id: 'ride-rear', title: 'Rear ride height (mm)', height: 110, lap: series.ride[2], reference: series.ride[3], format: whole },
      );
    }
    return list;
  }, [series, av.suspension, av.rideHeight]);

  if (!av.suspension && !av.rideHeight) return null;

  return (
    <Card title="Suspension and ride height" description="Where the car compresses, bottoms out, hits the bump stops or lifts a wheel">
      {series && panels.length > 0 && (
        <TraceStack
          distance={series.distance}
          panels={panels}
          lapLabel="Left wheels"
          referenceLabel="Right wheels"
          corners={corners}
          markers={markers}
          caption={`Suspension compression and ride height for each wheel on lap ${series.lap}, with bottoming, bump-stop and wheel-lift events marked`}
        />
      )}
      <div className="table-wrap setup-table">
        <table className="data">
          <caption>Every lap in the session</caption>
          <thead>
            <tr>
              <th scope="col">Wheel</th>
              <th scope="col" className="num">Travel used</th>
              <th scope="col" className="num">Lowest ride height</th>
              <th scope="col" className="num">Bottoming</th>
              <th scope="col" className="num">Bump stop</th>
              <th scope="col" className="num">Wheel lift</th>
              <th scope="col" className="num">Lock-ups</th>
              <th scope="col" className="num">Wheelspin</th>
            </tr>
          </thead>
          <tbody>
            {analysis.wheels.map((w) => (
              <tr key={w.wheel}>
                <th scope="row">{WHEEL_NAMES[w.wheel]}</th>
                <td className="num">{mm(w.travelUsed)}</td>
                <td className="num">{mm(w.rideMin, 1)}</td>
                <td className="num">{w.counts.bottoming}</td>
                <td className="num">
                  {w.counts['bump-stop']}
                  {w.bumpStopSuspected && <span className="visually-hidden"> (bump stop contact likely)</span>}
                </td>
                <td className="num">{w.counts['wheel-lift']}</td>
                <td className="num">{w.counts['lock-up']}</td>
                <td className="num">{w.counts.wheelspin}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="setting-hint">
        Travel used is the range the suspension covers on track, ignoring the most extreme 2% at each end. Bottoming
        means ride height reached {mm(0.003)} or less.
      </p>
    </Card>
  );
}

function DamperTable({ wheels }: { wheels: WheelSummary[] }) {
  const first = wheels[0].damper!;
  const rows = first.shares.map((_, i) => i).filter((i) => wheels.some((w) => (w.damper?.shares[i] ?? 0) > 0));
  return (
    <div className="table-wrap trace-table">
      <table className="data">
        <caption>Share of time at each damper speed. Negative is rebound (extending), positive is bump (compressing).</caption>
        <thead>
          <tr>
            <th scope="col">Damper speed (mm/s)</th>
            {wheels.map((w) => (
              <th key={w.wheel} scope="col" className="num">
                {w.wheel}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((i) => {
            const from = first.from + i * first.binWidth;
            return (
              <tr key={i}>
                <th scope="row" className="tabular">
                  {Math.round(from * 1000)} to {Math.round((from + first.binWidth) * 1000)}
                </th>
                {wheels.map((w) => (
                  <td key={w.wheel} className="num">
                    {((w.damper?.shares[i] ?? 0) * 100).toFixed(1)}%
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DampersCard({ analysis }: { analysis: ChassisAnalysis }) {
  const [asTable, setAsTable] = useState(false);
  const wheels = analysis.wheels.filter((w) => w.damper !== null);
  if (wheels.length === 0) return null;
  return (
    <Card
      title="Damper movement"
      description="How often each damper moves at each speed. Left of zero is rebound (extending), right is bump (compressing)."
      actions={
        <button type="button" className="btn btn-small" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>
          {asTable ? 'Show charts' : 'Show as table'}
        </button>
      }
    >
      {asTable ? (
        <DamperTable wheels={wheels} />
      ) : (
        <div className="histograms">
          {wheels.map((w) => (
            <DamperHistogramChart key={w.wheel} title={WHEEL_NAMES[w.wheel]} histogram={w.damper!} />
          ))}
        </div>
      )}
      <p className="setting-hint">
        Similar shapes either side of zero usually mean bump and rebound are balanced. Fast movement, beyond the thin
        lines, comes from bumps and kerbs and is controlled by fast bump and fast rebound.
      </p>
    </Card>
  );
}

function PlatformCard({ analysis, units }: { analysis: ChassisAnalysis; units: Units }) {
  const p = analysis.platform;
  if (!analysis.availability.suspension) return null;
  const from = `${Math.round(speedIn(20, units.speed))} ${speedLabel(units.speed)}`;
  return (
    <Card
      title="Roll, dive and aero"
      description="Most useful compared between setups: stiffer springs or anti-roll bars make these numbers smaller."
    >
      <div className="stats-row">
        <Stat label="Front roll" value={perG(p.frontRollPerG)} detail="Left–right compression difference per g of cornering" />
        <Stat label="Rear roll" value={perG(p.rearRollPerG)} detail="Left–right compression difference per g of cornering" />
        <Stat label="Dive under braking" value={perG(p.divePerG)} detail="Front compression relative to the rear, per g" />
        <Stat
          label="Aero squat, front / rear"
          value={`${mm(p.frontAeroCompression)} / ${mm(p.rearAeroCompression)}`}
          detail={`Extra compression from ${from} to top speed on the straights`}
        />
        {p.harshness !== null && (
          <Stat label="Ride harshness" value={`${p.harshness.toFixed(2)} g`} detail="Vertical vibration on the straights. Higher means a stiffer ride." />
        )}
      </div>
    </Card>
  );
}

function ComparisonCard({
  analysis,
  session,
  other,
  otherAnalysis,
}: {
  analysis: ChassisAnalysis;
  session: SessionMeta;
  other: SessionMeta;
  otherAnalysis: ChassisAnalysis;
}) {
  const perLap = (a: ChassisAnalysis, kind: ChassisEventKind) =>
    a.lapsAnalysed ? a.events.filter((e) => e.kind === kind).length / a.lapsAnalysed : null;
  const corners = (a: ChassisAnalysis, verdict: 'understeer' | 'oversteer') =>
    a.corners.filter((c) => c.mid.verdict === verdict).length;
  const lowest = (a: ChassisAnalysis, wheels: number[]) => {
    const values = wheels.map((w) => a.wheels[w].rideMin).filter((v): v is number => v !== null);
    return values.length ? Math.min(...values) : null;
  };

  interface Row {
    label: string;
    a: number | null;
    b: number | null;
    show: (v: number) => ReactNode;
    change?: (v: number) => string;
  }
  const rows: Row[] = [
    {
      label: 'Best lap',
      a: bestLap(session)?.lapTime ?? null,
      b: bestLap(other)?.lapTime ?? null,
      show: formatLapTime,
      change: (v) => `${v.toFixed(3)} s`,
    },
    ...(['bottoming', 'bump-stop', 'wheel-lift', 'lock-up', 'wheelspin', 'oversteer'] as ChassisEventKind[]).map(
      (kind): Row => ({ label: PER_LAP_LABELS[kind], a: perLap(analysis, kind), b: perLap(otherAnalysis, kind), show: (v) => v.toFixed(1) }),
    ),
    {
      label: 'Corners with mid-corner understeer',
      a: corners(analysis, 'understeer'),
      b: corners(otherAnalysis, 'understeer'),
      show: (v) => String(Math.round(v)),
    },
    {
      label: 'Corners with mid-corner oversteer',
      a: corners(analysis, 'oversteer'),
      b: corners(otherAnalysis, 'oversteer'),
      show: (v) => String(Math.round(v)),
    },
    { label: 'Lowest front ride height', a: lowest(analysis, [0, 1]), b: lowest(otherAnalysis, [0, 1]), show: (v) => mm(v, 1) },
    { label: 'Lowest rear ride height', a: lowest(analysis, [2, 3]), b: lowest(otherAnalysis, [2, 3]), show: (v) => mm(v, 1) },
    { label: 'Front roll', a: analysis.platform.frontRollPerG, b: otherAnalysis.platform.frontRollPerG, show: perG },
    { label: 'Rear roll', a: analysis.platform.rearRollPerG, b: otherAnalysis.platform.rearRollPerG, show: perG },
    { label: 'Dive under braking', a: analysis.platform.divePerG, b: otherAnalysis.platform.divePerG, show: perG },
    { label: 'Ride harshness', a: analysis.platform.harshness, b: otherAnalysis.platform.harshness, show: (v) => `${v.toFixed(2)} g` },
    ...analysis.wheels.map(
      (w, i): Row => ({
        label: `${WHEEL_NAMES[w.wheel]} time compressing`,
        a: w.damper?.bump ?? null,
        b: otherAnalysis.wheels[i].damper?.bump ?? null,
        show: percent,
        change: (v) => `${Math.round(v * 100)} pts`,
      }),
    ),
  ];

  return (
    <Card title="Compared with another setup" description={`This session against ${formatSessionDate(other.startedAt)}`}>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Measure</th>
              <th scope="col" className="num">This session</th>
              <th scope="col" className="num">{formatSessionDate(other.startedAt)}</th>
              <th scope="col" className="num">Difference</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const diff = row.a !== null && row.b !== null ? row.a - row.b : null;
              return (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  <td className="num">{row.a !== null ? row.show(row.a) : '–'}</td>
                  <td className="num">{row.b !== null ? row.show(row.b) : '–'}</td>
                  <td className="num">
                    {diff === null
                      ? '–'
                      : `${diff > 0 ? '+' : diff < 0 ? '−' : '±'}${row.change ? row.change(Math.abs(diff)) : row.show(Math.abs(diff))}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
