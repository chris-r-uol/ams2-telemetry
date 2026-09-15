/**
 * Cards about the car: balance right now, grip events this lap, and a quiet
 * summary of what the game HUD already shows.
 */
import { WHEELS, type ChassisEventKind } from '../../shared/analysis/chassis.ts';
import { signedPercent, speedIn, speedLabel, temperatureIn, temperatureLabel } from '../../shared/format.ts';
import { gearLabel } from '../components/laps.tsx';
import { useLive } from '../lib/live.ts';
import { useSettings } from '../lib/settings.ts';
import { EVENT_ICONS, EventList, LiveCard, type CardSize } from './parts.tsx';

const RANGE = 0.6;

export function BalanceMeterCard({ size }: { size: CardSize }) {
  const balance = useLive((s) => s.frame?.coach?.balance ?? null);
  const ready = useLive((s) => s.insights?.balanceReady ?? false);
  const verdict = balance === null ? null : balance > 0.12 ? 'understeer' : balance < -0.12 ? 'oversteer' : 'neutral';
  const word = !ready
    ? 'Calibrating'
    : verdict === 'understeer'
      ? 'Understeer'
      : verdict === 'oversteer'
        ? 'Oversteer'
        : verdict === 'neutral'
          ? 'Neutral'
          : 'Straight';
  const position = balance === null ? 50 : 50 + (Math.max(-RANGE, Math.min(RANGE, balance)) / RANGE) * 50;
  const explanation = !ready
    ? 'Learns how this car steers during your first laps.'
    : balance === null
      ? 'Reads while you are cornering.'
      : `${signedPercent(balance)} steering compared with what the car needed.`;

  return (
    <LiveCard title="Balance now" size={size}>
      <p className={`bm-word is-${verdict ?? 'idle'}`}>{word}</p>
      <div
        className="bm-scale"
        role="meter"
        aria-label="Balance"
        aria-valuemin={-RANGE * 100}
        aria-valuemax={RANGE * 100}
        aria-valuenow={balance === null ? 0 : Math.round(balance * 100)}
        aria-valuetext={word}
      >
        <span className="bm-zone is-oversteer" />
        <span className="bm-zone is-neutral" />
        <span className="bm-zone is-understeer" />
        {balance !== null && <span className="bm-needle" style={{ left: `${position}%` }} />}
      </div>
      <div className="bm-ends" aria-hidden="true">
        <span>Oversteer</span>
        <span>Neutral</span>
        <span>Understeer</span>
      </div>
      {size === 'full' && <p className="muted">{explanation}</p>}
    </LiveCard>
  );
}

const GROUPS: { kinds: ChassisEventKind[]; label: string; icon: string }[] = [
  { kinds: ['lock-up'], label: 'Lock-ups', icon: EVENT_ICONS['lock-up'] },
  { kinds: ['wheelspin'], label: 'Wheelspin', icon: EVENT_ICONS.wheelspin },
  { kinds: ['oversteer'], label: 'Slides', icon: EVENT_ICONS.oversteer },
  { kinds: ['bottoming', 'bump-stop'], label: 'Bottoming', icon: EVENT_ICONS.bottoming },
  { kinds: ['wheel-lift'], label: 'Wheel lifts', icon: EVENT_ICONS['wheel-lift'] },
];

export function GripEventsCard({ size }: { size: CardSize }) {
  const events = useLive((s) => s.insights?.events ?? null);
  const ready = useLive((s) => s.insights?.gripReady ?? false);
  const lap = useLive((s) => s.insights?.lap ?? null);
  const list = events ?? [];
  const counts = GROUPS.map((g) => ({ ...g, count: list.filter((e) => g.kinds.includes(e.kind)).length }));
  const any = counts.some((c) => c.count > 0);

  return (
    <LiveCard title="Grip this lap" size={size} meta={lap !== null && lap > 0 ? `Lap ${lap}` : undefined}>
      {size === 'glance' ? (
        any ? (
          <ul className="grip-counts is-glance">
            {counts
              .filter((c) => c.count > 0)
              .map((c) => (
                <li key={c.label} className="grip-count has-events">
                  <span>
                    <span aria-hidden="true">{c.icon}</span> {c.label}
                  </span>
                  <strong className="tabular">{c.count}</strong>
                </li>
              ))}
          </ul>
        ) : (
          <p className="grip-clean">Clean so far</p>
        )
      ) : (
        <>
          <ul className="grip-counts">
            {counts.map((c) => (
              <li key={c.label} className={`grip-count ${c.count > 0 ? 'has-events' : 'is-zero'}`}>
                <span>
                  <span aria-hidden="true">{c.icon}</span> {c.label}
                </span>
                <strong className="tabular">{c.count}</strong>
              </li>
            ))}
          </ul>
          {any ? <EventList events={list} /> : <p className="muted">No lock-ups, wheelspin, slides or bottoming yet this lap.</p>}
          {!ready && <p className="muted">Lock-up and wheelspin checks start after a little straight-line running.</p>}
        </>
      )}
    </LiveCard>
  );
}

function MiniBar({ label, value }: { label: string; value: number }) {
  const fraction = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <span className="mini-bar">
      <span className="mini-bar-label">
        {label} <span className="visually-hidden">{Math.round(fraction * 100)}%</span>
      </span>
      <span className="mini-bar-track" aria-hidden="true">
        <span className="mini-bar-fill" style={{ transform: `scaleX(${fraction})` }} />
      </span>
    </span>
  );
}

export function CarStatusCard({ size }: { size: CardSize }) {
  const frame = useLive((s) => s.frame);
  const { units, tyreWindow } = useSettings();
  const title = 'Car';
  const hud = <span className="badge">Also on the game HUD</span>;

  if (!frame || !frame.receiving) {
    return (
      <LiveCard title={title} size={size} meta={hud}>
        <p className="muted">Waiting for the car.</p>
      </LiveCard>
    );
  }

  const [low, high] = tyreWindow;
  const tyres = WHEELS.map((wheel, i) => {
    const temp = frame.tyres.tempC[i];
    return { wheel, temp, state: temp <= 0 ? null : temp > high ? 'hot' : temp < low ? 'cold' : null };
  });
  const issues = tyres.filter((t) => t.state).map((t) => `${t.wheel} tyre ${t.state}`);
  if (frame.fuel.lapsRemaining !== null && frame.fuel.lapsRemaining < 2) {
    issues.push(`Fuel for ${frame.fuel.lapsRemaining.toFixed(1)} laps`);
  }
  const issueList = (
    <ul className="cs-issues">
      {issues.map((issue) => (
        <li key={issue} className="badge badge-warning">
          <span aria-hidden="true">{'▲'}</span> {issue}
        </li>
      ))}
    </ul>
  );

  if (size === 'glance') {
    return (
      <LiveCard title={title} size={size} meta={hud}>
        {issues.length ? issueList : <p className="cs-ok">Nothing needs attention</p>}
      </LiveCard>
    );
  }

  const temp = (c: number) => `${Math.round(temperatureIn(c, units.temperature))}${temperatureLabel(units.temperature)}`;
  return (
    <LiveCard title={title} size={size} meta={hud} className="car-status">
      <div className="cs-row">
        <span className="cs-gear" aria-label={`Gear ${gearLabel(frame.gear)}`}>
          {gearLabel(frame.gear)}
        </span>
        <span className="cs-speed tabular">
          {Math.round(speedIn(frame.speed, units.speed))} {speedLabel(units.speed)}
        </span>
        <MiniBar label="RPM" value={frame.maxRpm > 0 ? frame.rpm / frame.maxRpm : 0} />
        <MiniBar label="Throttle" value={frame.throttle} />
        <MiniBar label="Brake" value={frame.brake} />
      </div>
      <div className="cs-row cs-small">
        {tyres.map((t) => (
          <span key={t.wheel} className={t.state ? 'cs-flag' : undefined}>
            {t.wheel} {t.temp > 0 ? temp(t.temp) : '–'}
            {t.state === 'hot' && <span aria-hidden="true"> {'▲'}</span>}
          </span>
        ))}
        <span>
          Fuel {frame.fuel.litres.toFixed(1)} L
          {frame.fuel.lapsRemaining !== null ? ` · ${frame.fuel.lapsRemaining.toFixed(1)} laps` : ''}
        </span>
      </div>
      {issues.length > 0 && issueList}
    </LiveCard>
  );
}
