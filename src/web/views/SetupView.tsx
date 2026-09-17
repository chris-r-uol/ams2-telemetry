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
  Incident,
  PhaseBalance,
  SetupHint,
  Wheel,
  WheelSummary,
} from '../../shared/analysis/chassis.ts';
import type { Corner } from '../../shared/analysis/corners.ts';
import { PEDAL_PHASES, type PedalPhase, type SpeedBand } from '../../shared/analysis/chassis.ts';
import type { GearingAnalysis } from '../../shared/analysis/gearing.ts';
import type { CornerGripSummary, GripEnvelope } from '../../shared/analysis/grip.ts';
import type { TrackUseAnalysis, TrackUseZone } from '../../shared/analysis/track-use.ts';
import { formatLapTime, speedIn, speedLabel, type Units } from '../../shared/format.ts';
import type { SessionMeta } from '../../shared/model/types.ts';
import { DamperHistogramChart } from '../components/DamperHistogram.tsx';
import { bestLap, formatSessionDate, sessionTitle } from '../components/laps.tsx';
import { describeGap, GripDetail, percent as gripPercent } from '../cards/GripCard.tsx';
import { TraceStack, type TraceMarker, type TracePanel } from '../components/TraceStack.tsx';
import { Card, EmptyState, Stat } from '../components/ui.tsx';
import { api, useApi, type ChassisDto, type GripDto, type GripLapDto } from '../lib/api.ts';
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
  const grip = useApi<GripDto>(session ? api.grip(session.id) : null, refresh);
  const gearing = useApi<GearingAnalysis>(session ? api.gearing(session.id) : null, refresh);
  const trackUse = useApi<TrackUseAnalysis>(session ? api.trackUse(session.id) : null, refresh);
  const gripLap = useApi<GripLapDto>(session && lap !== null ? api.gripLap(session.id, lap) : null, refresh);

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
          grip={grip.data}
          gripLap={gripLap.data}
          gearing={gearing.data}
          trackUse={trackUse.data}
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
  grip,
  gripLap,
  gearing,
  trackUse,
  units,
  session,
  other,
  otherAnalysis,
}: {
  analysis: ChassisAnalysis;
  corners: Corner[];
  series: ChassisLapSeries | null;
  grip: GripDto | null;
  gripLap: GripLapDto | null;
  gearing: GearingAnalysis | null;
  trackUse: TrackUseAnalysis | null;
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
      <HandlingCard analysis={analysis} units={units} />
      <GripCard grip={grip} gripLap={gripLap} units={units} />
      <TrackUseCard trackUse={trackUse} />
      <GearingCard gearing={gearing} units={units} />
      <SuspensionCard analysis={analysis} corners={corners} series={series} />
      <DampersCard analysis={analysis} />
      <PlatformCard analysis={analysis} units={units} />
      {other && otherAnalysis && (
        <ComparisonCard analysis={analysis} session={session} other={other} otherAnalysis={otherAnalysis} />
      )}
    </>
  );
}

function describeIncidents(incidents: Incident[]): string {
  const places = incidents.slice(0, 3).map((i) => `lap ${i.lap}${i.corner ? ` at ${i.corner}` : ''}`);
  if (incidents.length > 3) return `${places.join(', ')} and ${incidents.length - 3} more`;
  return places.length > 1 ? `${places.slice(0, -1).join(', ')} and ${places[places.length - 1]}` : places[0];
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
      label: av.wheelSpeed ? `Wheel lock and wheelspin (wheel speed sent in ${cal.wheelSpeedUnit})` : 'Wheel lock and wheelspin',
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
          Understeer and oversteer are measured against the steering this car usually needs for the same corner and
          cornering force, worked out from your own laps. Units and directions are detected from the data too.
        </p>
        {analysis.incidents.length > 0 && (
          <p>
            Left out {analysis.incidents.length === 1 ? 'one moment' : `${analysis.incidents.length} moments`} with a
            spin, contact or a trip off the track ({describeIncidents(analysis.incidents)}), so they don't count as
            setup problems.
          </p>
        )}
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

function GripCard({ grip, gripLap, units }: { grip: GripDto | null; gripLap: GripLapDto | null; units: Units }) {
  const [chosen, setChosen] = useState<number | null>(null);
  const summaries = grip?.corners ?? [];
  // Start on the corner where the most grip goes unused.
  const lowest = summaries.reduce<CornerGripSummary | null>(
    (low, c) => (c.use !== null && (low?.use == null || c.use < low.use) ? c : low),
    null,
  );
  const cornerId = summaries.some((c) => c.cornerId === chosen) ? chosen : (lowest?.cornerId ?? null);
  const detail = gripLap?.corners.find((c) => c.cornerId === cornerId) ?? null;
  const pickerLabel = useId();

  return (
    <Card
      title="Grip used"
      description="How much of the car's grip you used in each corner, against the most you showed at each speed in this session"
    >
      {!grip ? (
        <p className="loading" role="status">
          Measuring grip…
        </p>
      ) : !grip.envelope || summaries.length === 0 ? (
        <p className="muted">Grip used appears after a clean flying lap.</p>
      ) : (
        <div className="grip-setup">
          <div className="grip-corner-picker">
            <span id={pickerLabel}>Corner</span>
            <div className="segmented" role="group" aria-labelledby={pickerLabel}>
              {summaries.map((c) => (
                <button key={c.cornerId} type="button" aria-pressed={c.cornerId === cornerId} onClick={() => setChosen(c.cornerId)}>
                  {c.corner}
                </button>
              ))}
            </div>
          </div>

          {detail ? (
            <GripDetail
              corner={detail.corner}
              run={detail.run}
              best={detail.bestLap === gripLap?.lap ? null : detail.best}
              runLabel={`Lap ${gripLap?.lap}`}
              legendLabel={`Lap ${gripLap?.lap}`}
              bestLabel={`Best run, lap ${detail.bestLap}`}
              span={detail}
            >
              {detail.bestLap === gripLap?.lap && (
                <p className="muted gc-note">This lap is your best run through {detail.corner}.</p>
              )}
            </GripDetail>
          ) : (
            <p className="muted">Pick a complete lap above to see its run through this corner.</p>
          )}

          <div className="table-wrap setup-table">
            <table className="data">
              <caption>
                Grip used in each corner, as the median over your {grip.lapsAnalysed} clean{' '}
                {grip.lapsAnalysed === 1 ? 'lap' : 'laps'}. Flat out, quick changes of direction and contact aren't
                counted.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Corner</th>
                  <th scope="col" className="num">
                    Grip used
                  </th>
                  <th scope="col" className="num">
                    Best run
                  </th>
                  <th scope="col" className="num">
                    Braking
                  </th>
                  <th scope="col" className="num">
                    Off the pedals
                  </th>
                  <th scope="col" className="num">
                    Part throttle
                  </th>
                  <th scope="col">Where grip is usually left</th>
                </tr>
              </thead>
              <tbody>
                {summaries.map((c) => (
                  <tr key={c.cornerId} className={c.cornerId === cornerId ? 'is-highlighted' : ''}>
                    <th scope="row" className="corner-row-name">
                      <button type="button" className="link-button" onClick={() => setChosen(c.cornerId)}>
                        {c.corner}
                      </button>
                    </th>
                    <td className="num">{gripPercent(c.use)}</td>
                    <td className="num">{c.best ? `${gripPercent(c.best.use)} (lap ${c.best.lap})` : '–'}</td>
                    <td className="num">{gripPercent(c.braking)}</td>
                    <td className="num">{gripPercent(c.coasting)}</td>
                    <td className="num">{gripPercent(c.throttle)}</td>
                    <td>
                      {c.usualGap
                        ? `${describeGap(c.usualGap, c.apex)} (${c.usualGap.laps} of ${c.laps} ${c.laps === 1 ? 'lap' : 'laps'})`
                        : '–'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <GripLimits envelope={grip.envelope} units={units} />
        </div>
      )}
    </Card>
  );
}

/** The most grip shown in each speed band: what 100% means on the circle. */
function GripLimits({ envelope, units }: { envelope: GripEnvelope; units: Units }) {
  const unit = speedLabel(units.speed);
  const g = (v: number | null) => (v === null ? '–' : `${v.toFixed(2)} g`);
  const bands = envelope.lateral
    .map((lateral, i) => ({
      from: i * envelope.band,
      to: (i + 1) * envelope.band,
      lateral,
      braking: envelope.braking[i] ?? null,
      accelerating: envelope.accelerating[i] ?? null,
    }))
    .filter((b) => b.lateral !== null || b.braking !== null || b.accelerating !== null);
  return (
    <div className="table-wrap setup-table">
      <table className="data">
        <caption>
          The most grip you showed at each speed: 100% on the circle. Downforce only adds grip, so cornering and
          braking at a higher speed are never below what you showed slower. Where you never braked hard, braking is
          taken to match cornering.
        </caption>
        <thead>
          <tr>
            <th scope="col">Speed ({unit})</th>
            <th scope="col" className="num">
              Cornering
            </th>
            <th scope="col" className="num">
              Braking
            </th>
            <th scope="col" className="num">
              Accelerating
            </th>
          </tr>
        </thead>
        <tbody>
          {bands.map((b) => (
            <tr key={b.from}>
              <th scope="row" className="tabular">
                {Math.round(speedIn(b.from, units.speed))}–{Math.round(speedIn(b.to, units.speed))}
              </th>
              <td className="num">{g(b.lateral)}</td>
              <td className="num">{g(b.braking)}</td>
              <td className="num">{g(b.accelerating)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const PHASE_LABELS: Record<PedalPhase, string> = {
  'trail-braking': 'Trailing the brake',
  coasting: 'Off both pedals',
  'part-throttle': 'Part throttle',
  'full-throttle': 'Flat out',
};

function bandLabel(band: SpeedBand, units: Units): string {
  const speed = (ms: number) => Math.round(speedIn(ms, units.speed));
  const unit = speedLabel(units.speed);
  if (band.from === 0 && band.to !== null) return `Under ${speed(band.to)} ${unit}`;
  if (band.to === null) return `Over ${speed(band.from)} ${unit}`;
  return `${speed(band.from)}–${speed(band.to)} ${unit}`;
}

const slipPercent = (share: number) => `${share > 0 ? '+' : share < 0 ? '−' : ''}${(Math.abs(share) * 100).toFixed(1)}%`;

function HandlingCard({ analysis, units }: { analysis: ChassisAnalysis; units: Units }) {
  const h = analysis.handling;
  // Sessions analysed before this existed have no handling summary.
  if (!h || analysis.calibration.steerPerCurvature === null) return null;
  const { power, braking } = h.rearSlip;
  return (
    <Card
      title="Handling by speed and pedal"
      description="Balance through corners at each speed and with each pedal, compared with the steering this car usually needs"
    >
      <div className="table-wrap">
        <table className="data handling-grid">
          <caption>
            A balance that shifts with speed points at the aerodynamics; one that's the same at every speed is mechanical
            grip. A change as you come off the brake or feed in the throttle points at brake bias, the differential and
            damping. Heavy braking in a straight line isn't included.
          </caption>
          <thead>
            <tr>
              <th scope="col">Pedal</th>
              {h.bands.map((band, b) => (
                <th scope="col" key={b}>
                  {bandLabel(band, units)}
                  {h.bandCorners[b].length > 0 && <span className="muted handling-corners"> ({h.bandCorners[b].join(', ')})</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PEDAL_PHASES.map((phase, r) => (
              <tr key={phase}>
                <th scope="row">{PHASE_LABELS[phase]}</th>
                {h.grid[r].map((cell, b) => (
                  <td key={b}>
                    <VerdictBadge phase={cell} />
                  </td>
                ))}
              </tr>
            ))}
            <tr className="handling-total">
              <th scope="row">All cornering</th>
              {h.bySpeed.map((cell, b) => (
                <td key={b}>
                  <VerdictBadge phase={cell} />
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      {(power || braking) && (
        <>
          <h3 className="setup-subhead">Rear wheels through corners</h3>
          <div className="stats-row">
            {power && (
              <Stat
                label="On the power, inside / outside"
                value={`${slipPercent(power.inside)} / ${slipPercent(power.outside)}`}
                detail="How much faster each rear wheel turns than its own path. The inside one spinning far more means drive escapes through it; similar values mean the differential is holding them together."
              />
            )}
            {braking && (
              <Stat
                label="Trailing the brake, inside / outside"
                value={`${slipPercent(braking.inside)} / ${slipPercent(braking.outside)}`}
                detail="How much slower each rear wheel turns than its path. The inside one slowing far more is a sign of the rear getting light and loose on entry."
              />
            )}
          </div>
        </>
      )}
    </Card>
  );
}

const ordinal = (gear: number) => `${gear}${gear === 1 ? 'st' : gear === 2 ? 'nd' : gear === 3 ? 'rd' : 'th'}`;

function GearingCard({ gearing, units }: { gearing: GearingAnalysis | null; units: Units }) {
  if (!gearing || gearing.gears.length === 0) return null;
  const unit = speedLabel(units.speed);
  const speed = (ms: number | null) => (ms === null ? '–' : `${Math.round(speedIn(ms, units.speed))}`);
  const limiter = gearing.limiter;
  const verdicts = { earlier: 'Change up sooner', later: 'Change up later', right: 'About right' } as const;
  const hitsByGear = new Map<number, { count: number; before: Map<string, number> }>();
  for (const hit of gearing.limiterHits) {
    const entry = hitsByGear.get(hit.gear) ?? hitsByGear.set(hit.gear, { count: 0, before: new Map() }).get(hit.gear)!;
    entry.count++;
    if (hit.before) entry.before.set(hit.before, (entry.before.get(hit.before) ?? 0) + 1);
  }
  const topGear = gearing.gears[gearing.gears.length - 1]?.gear ?? null;

  return (
    <Card
      title="Gearing and shifts"
      description={`Ratios, shift points and the rev limiter across ${gearing.lapsAnalysed} ${gearing.lapsAnalysed === 1 ? 'lap' : 'laps'}${limiter !== null ? `, with the limit at about ${Math.round(limiter).toLocaleString()} rpm` : ''}`}
    >
      <div className="table-wrap">
        <table className="data">
          <caption>
            Upshifts made flat out. <strong>Pull after the shift</strong> compares acceleration just after the change with
            just before it, at almost the same speed: if the higher gear pulls harder, changing up sooner is quicker.
          </caption>
          <thead>
            <tr>
              <th scope="col">Gear</th>
              <th scope="col" className="num">
                {unit} per 1,000 rpm
              </th>
              <th scope="col" className="num">
                At the limiter ({unit})
              </th>
              <th scope="col">Upshift</th>
              <th scope="col" className="num">
                Pull after the shift
              </th>
              <th scope="col">Shift point</th>
            </tr>
          </thead>
          <tbody>
            {gearing.gears.map((g) => {
              const up = gearing.upshifts.find((u) => u.from === g.gear && u.to === g.gear + 1) ?? null;
              return (
                <tr key={g.gear}>
                  <th scope="row">{ordinal(g.gear)}</th>
                  <td className="num">{(speedIn(g.speedPer1000, units.speed)).toFixed(1)}</td>
                  <td className="num">{speed(g.speedAtLimiter)}</td>
                  <td>
                    {up
                      ? `${Math.round(up.rpm).toLocaleString()} rpm${limiter ? ` (${Math.round((up.rpm / limiter) * 100)}%)` : ''}, ${speed(up.speed)} ${unit} · ${up.count}×`
                      : g.gear === topGear
                        ? 'Top gear'
                        : '–'}
                  </td>
                  <td className="num">
                    {up?.pullChange != null ? `${up.pullChange > 0 ? '+' : up.pullChange < 0 ? '−' : ''}${Math.abs(up.pullChange).toFixed(2)} g` : '–'}
                  </td>
                  <td>{up?.verdict ? verdicts[up.verdict] : '–'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {gearing.downshifts.length > 0 && (
        <div className="table-wrap setup-table">
          <table className="data">
            <caption>
              Downshifts: how high the revs flare straight after each one. Over 100% is past the rev limit, which can lock
              the rear wheels on entry.
            </caption>
            <thead>
              <tr>
                <th scope="col">Downshift</th>
                <th scope="col" className="num">
                  Times
                </th>
                <th scope="col" className="num">
                  Typical revs
                </th>
                <th scope="col" className="num">
                  Highest
                </th>
                <th scope="col" className="num">
                  Over the limit
                </th>
                <th scope="col" className="num">
                  Rear lock-ups after
                </th>
              </tr>
            </thead>
            <tbody>
              {gearing.downshifts.map((d) => (
                <tr key={`${d.from}-${d.to}`}>
                  <th scope="row">
                    {ordinal(d.from)} to {ordinal(d.to)}
                  </th>
                  <td className="num">{d.count}</td>
                  <td className="num">{Math.round(d.peakShare * 100)}%</td>
                  <td className="num">{Math.round(d.worstShare * 100)}%</td>
                  <td className="num">{d.overRevs}</td>
                  <td className="num">{d.rearLockUps}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="setup-subhead">On the rev limiter</h3>
      {hitsByGear.size === 0 ? (
        <p className="muted">The engine never sat on the rev limiter flat out.</p>
      ) : (
        <ul className="plain-list">
          {[...hitsByGear.entries()]
            .sort((a, b) => b[1].count - a[1].count)
            .map(([gear, entry]) => (
              <li key={gear}>
                <strong>
                  {ordinal(gear)} gear, {entry.count} {entry.count === 1 ? 'time' : 'times'}
                </strong>
                {entry.before.size > 0 &&
                  `, before ${[...entry.before.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .map(([corner, n]) => `${corner}${n > 1 ? ` (${n})` : ''}`)
                    .join(', ')}`}
                .{' '}
                {gear === topGear
                  ? 'Top gear running out: a longer final drive or top gear would carry more speed down that straight, unless a slipstream took you there.'
                  : 'Held in gear up to the limit: change up, or a longer gear would carry more speed.'}
              </li>
            ))}
        </ul>
      )}

      {gearing.corners.some((c) => c.choices.length > 0) && (
        <div className="table-wrap setup-table">
          <table className="data">
            <caption>
              The lowest gear used in each corner on clean laps, with the median time through the corner for each choice.
            </caption>
            <thead>
              <tr>
                <th scope="col">Corner</th>
                <th scope="col">Gears used</th>
                <th scope="col">Best run</th>
              </tr>
            </thead>
            <tbody>
              {gearing.corners.map((c) => (
                <tr key={c.cornerId}>
                  <th scope="row" className="corner-row-name">
                    {c.corner}
                  </th>
                  <td>
                    {c.choices
                      .map((ch) => `${ordinal(ch.gear)} on ${ch.laps} ${ch.laps === 1 ? 'lap' : 'laps'} (${ch.time.toFixed(2)} s)`)
                      .join(' · ') || '–'}
                  </td>
                  <td>{c.bestGear !== null ? `${ordinal(c.bestGear)}, lap ${c.bestLap}` : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function TrackUseCell({ zone, laps }: { zone: TrackUseZone | null; laps: number }) {
  if (!zone) return <span className="muted">–</span>;
  const side = zone.side === 'left' ? 'left' : 'right';
  const best = zone.best
    ? zone.best.kerb
      ? 'on the kerb'
      : zone.best.gap === null
        ? 'edge unknown'
        : zone.best.gap < 0.05
          ? 'at the edge'
          : `${zone.best.gap.toFixed(1)} m in`
    : null;
  return (
    <span className="track-use-cell">
      <span>
        Kerb on{' '}
        <strong className="tabular">
          {zone.kerbLaps} of {laps}
        </strong>{' '}
        <span className="muted">({side})</span>
      </span>
      <span className="tabular">{zone.gap === null ? 'Edge not found yet' : zone.gap < 0.05 ? 'Right at the edge' : `Typically ${zone.gap.toFixed(1)} m in`}</span>
      {best && <span className="muted">Best run: {best}</span>}
    </span>
  );
}

function TrackUseCard({ trackUse }: { trackUse: TrackUseAnalysis | null }) {
  if (!trackUse) return null;
  return (
    <Card title="Track use" description="How close to the edges each corner is driven: out wide to turn in, tight at the apex, out wide on the exit">
      {trackUse.lapsAnalysed === 0 || trackUse.corners.length === 0 ? (
        <p className="muted">
          Needs laps driven with this version: it uses which wheels touch the kerbs, which older laps don't record.
        </p>
      ) : (
        <div className="table-wrap">
          <table className="data track-use">
            <caption>
              The game doesn't send where the track edges are, so an edge is wherever a wheel touched a kerb or the painted
              edge on any lap. Distances are how far the car stayed from that edge on your clean laps. Where no lap touched
              a kerb, the edge can't be measured.
            </caption>
            <thead>
              <tr>
                <th scope="col">Corner</th>
                <th scope="col">Turn-in, outside</th>
                <th scope="col">Apex, inside</th>
                <th scope="col">Exit, outside</th>
                <th scope="col" className="num">
                  Off track
                </th>
              </tr>
            </thead>
            <tbody>
              {trackUse.corners.map((c) => (
                <tr key={c.cornerId}>
                  <th scope="row" className="corner-row-name">
                    {c.corner}
                  </th>
                  <td>
                    <TrackUseCell zone={c.turnIn} laps={c.laps} />
                  </td>
                  <td>
                    <TrackUseCell zone={c.apex} laps={c.laps} />
                  </td>
                  <td>
                    <TrackUseCell zone={c.exit} laps={c.laps} />
                  </td>
                  <td className="num">
                    {c.offTrackLaps} of {c.laps}
                  </td>
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
