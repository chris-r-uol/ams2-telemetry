/**
 * Cards about corners: the one you just drove, the one coming up, and every
 * corner so far this lap.
 */
import { describeHabit, describeTip, shortAction, speedIn, speedLabel } from '../../shared/format.ts';
import { DeltaValue } from '../components/ui.tsx';
import { useLive } from '../lib/live.ts';
import { useSettings } from '../lib/settings.ts';
import { CornerProfileChart, EventList, LiveCard, PhaseStrip, roundMetres, toneOf, type CardSize } from './parts.tsx';

export function LastCornerCard({ size }: { size: CardSize }) {
  const report = useLive((s) => s.insights?.lastCorner ?? null);
  const { units } = useSettings();
  const title = 'Last corner';

  if (!report) {
    return (
      <LiveCard title={title} size={size}>
        <p className="muted">Shows each corner as soon as you've driven it, once there's a reference lap.</p>
      </LiveCard>
    );
  }

  const delta = report.vsBest ?? report.timeDelta;
  const against = report.vsBest !== null ? `vs your best run, lap ${report.bestLap}` : 'vs your reference lap';
  const accent = toneOf(delta);

  if (size === 'glance') {
    return (
      <LiveCard title={title} size={size} accent={accent}>
        <div className="lc-headline">
          <span className="lc-corner">{report.corner}</span>
          <DeltaValue seconds={delta} digits={2} className="lc-delta" />
        </div>
        <PhaseStrip phases={report.phases} size={size} />
        {report.tip && <p className="lc-cue">{shortAction(report.tip.kind)}</p>}
      </LiveCard>
    );
  }

  const unit = speedLabel(units.speed);
  const speed = (ms: number) => `${Math.round(speedIn(ms, units.speed))} ${unit}`;
  const speedChange = (ms: number, best: number | null) => {
    if (best === null) return '';
    const diff = Math.round(speedIn(ms - best, units.speed));
    return diff === 0 ? ', same as best' : ` (${diff > 0 ? '+' : '−'}${Math.abs(diff)})`;
  };
  const distance = (metres: number | null, positive: string, negative: string) =>
    metres === null
      ? '–'
      : Math.abs(metres) < 3
        ? 'Same as best'
        : `${Math.round(Math.abs(metres))} m ${metres > 0 ? positive : negative}`;
  const tip = report.tip ? describeTip(report.tip, units) : null;

  return (
    <LiveCard title={title} size={size} accent={accent} meta={`Lap ${report.lap}`}>
      <div className="lc-headline">
        <span className="lc-corner">{report.corner}</span>
        <span className="lc-delta-block">
          <DeltaValue seconds={delta} digits={2} words className="lc-delta" />
          <span className="muted">{against}</span>
        </span>
      </div>
      <PhaseStrip phases={report.phases} size={size} />
      <CornerProfileChart profile={report.profile} units={units} corner={report.corner} bestLap={report.bestLap} />
      <dl className="lc-facts">
        <div>
          <dt>Braking</dt>
          <dd>{distance(report.brakeEarlierBy, 'earlier', 'later')}</dd>
        </div>
        <div>
          <dt>Slowest point</dt>
          <dd>
            {speed(report.minSpeed)}
            {speedChange(report.minSpeed, report.bestMinSpeed)}
          </dd>
        </div>
        <div>
          <dt>Throttle</dt>
          <dd>{distance(report.throttleLaterBy, 'later', 'earlier')}</dd>
        </div>
        <div>
          <dt>Exit</dt>
          <dd>
            {speed(report.exitSpeed)}
            {speedChange(report.exitSpeed, report.bestExitSpeed)}
          </dd>
        </div>
        <div>
          <dt>Peak slip</dt>
          <dd>{report.slipAngle !== null ? `${report.slipAngle.toFixed(1)}°` : '–'}</dd>
        </div>
      </dl>
      {report.events.length > 0 && <EventList events={report.events} />}
      {tip ? (
        <div className="lc-tip">
          <strong>{tip.title}</strong>
          <p>{tip.detail}</p>
        </div>
      ) : (
        <p className="muted">No clear change to make here.</p>
      )}
    </LiveCard>
  );
}

export function NextCornerCard({ size }: { size: CardSize }) {
  const nextId = useLive((s) => s.frame?.coach?.nextCornerId ?? null);
  const toApex = useLive((s) => s.frame?.coach?.toApex ?? null);
  const brakeIn = useLive((s) => s.frame?.coach?.brakeIn ?? null);
  const plan = useLive((s) => s.insights?.plans.find((p) => p.cornerId === nextId) ?? null);
  const { units } = useSettings();
  const title = 'Next corner';

  if (!plan) {
    return (
      <LiveCard title={title} size={size}>
        <p className="muted">Shows the corner ahead once there's a lap to learn the corners from.</p>
      </LiveCard>
    );
  }

  const cue = plan.tip
    ? shortAction(plan.tip.kind)
    : plan.habit
      ? shortAction(plan.habit.kind)
      : plan.bestLap !== null
        ? 'Match your best run'
        : 'Clean run to set a target';
  const countdown =
    brakeIn !== null ? { label: 'Brake in', metres: brakeIn } : toApex !== null ? { label: 'Apex in', metres: toApex } : null;
  const close = brakeIn !== null ? brakeIn < 150 : toApex !== null && toApex < 200;

  const headline = (
    <div className="lc-headline">
      <span className="lc-corner">{plan.corner}</span>
      {countdown && (
        <span className="nc-countdown">
          <span className="nc-countdown-label">{countdown.label}</span>
          <strong className="tabular">{roundMetres(countdown.metres)}</strong>
        </span>
      )}
    </div>
  );

  if (size === 'glance') {
    return (
      <LiveCard title={title} size={size} accent={close ? 'attention' : null}>
        {headline}
        <p className="lc-cue">{cue}</p>
      </LiveCard>
    );
  }

  const window = 300;
  const unit = speedLabel(units.speed);
  const tip = plan.tip ? describeTip(plan.tip, units) : null;
  const habit = plan.habit ? describeHabit(plan.habit, units) : null;
  const bestRun =
    plan.bestLap === null
      ? 'No clean run through here yet.'
      : `Your best run (lap ${plan.bestLap}) ${
          plan.bestBrakePoint !== null ? `braked ${Math.round(plan.apex - plan.bestBrakePoint)} m before the apex and ` : ''
        }slowed to ${plan.bestMinSpeed !== null ? `${Math.round(speedIn(plan.bestMinSpeed, units.speed))} ${unit}` : '–'}.`;

  return (
    <LiveCard title={title} size={size} accent={close ? 'attention' : null}>
      {headline}
      {brakeIn !== null && (
        <div
          className="meter-track countdown-track"
          role="meter"
          aria-label="Progress towards your braking point"
          aria-valuemin={0}
          aria-valuemax={window}
          aria-valuenow={Math.round(window - Math.min(brakeIn, window))}
        >
          <div className="meter-fill" style={{ transform: `scaleX(${1 - Math.min(brakeIn, window) / window})` }} />
        </div>
      )}
      <p className="lc-cue">{cue}</p>
      <p className="secondary">{bestRun}</p>
      {(tip ?? habit) && (
        <div className="lc-tip">
          <strong>{(tip ?? habit)!.title}</strong>
          <p>{(tip ?? habit)!.detail}</p>
        </div>
      )}
    </LiveCard>
  );
}

export function CornerStripCard({ size }: { size: CardSize }) {
  const corners = useLive((s) => s.insights?.corners ?? null);
  const lap = useLive((s) => s.insights?.lap ?? null);
  const currentId = useLive((s) => s.frame?.coach?.currentCornerId ?? null);
  const nextId = useLive((s) => s.frame?.coach?.nextCornerId ?? null);
  const title = 'Corner by corner';

  if (!corners || corners.length === 0) {
    return (
      <LiveCard title={title} size={size}>
        <p className="muted">Shows time gained or lost in each corner once there's a reference lap.</p>
      </LiveCard>
    );
  }

  const measured = corners.filter((c) => c.done && c.timeDelta !== null);
  const total = measured.reduce((sum, c) => sum + c.timeDelta!, 0);

  return (
    <LiveCard title={title} size={size} meta={lap !== null && lap > 0 ? `Lap ${lap}` : undefined}>
      <ol className={`corner-chips is-${size}`}>
        {corners.map((c) => {
          const state = c.cornerId === currentId ? 'now' : c.done ? 'done' : c.cornerId === nextId ? 'next' : 'ahead';
          const tone = c.done ? toneOf(c.timeDelta) : null;
          return (
            <li
              key={c.cornerId}
              className={`corner-chip is-${state}${tone ? ` tone-${tone}` : ''}`}
              aria-current={state === 'now' ? 'step' : undefined}
            >
              <span className="chip-name">{c.corner}</span>
              <span className="chip-value">
                {c.done && c.timeDelta !== null ? (
                  <DeltaValue seconds={c.timeDelta} digits={2} />
                ) : state === 'now' ? (
                  'now'
                ) : state === 'next' ? (
                  'next'
                ) : (
                  '–'
                )}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="chip-total">
        Through the corners so far: <DeltaValue seconds={measured.length ? total : null} digits={2} words />
      </p>
    </LiveCard>
  );
}
