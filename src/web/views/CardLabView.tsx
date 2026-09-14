/**
 * Card lab: candidate cards for the Live page, running on live data, each in
 * a glance size (focus mode) and a detail size (optimisation and full modes).
 */
import type { ComponentType } from 'react';
import { BalanceMeterCard, CarStatusCard, GripEventsCard } from '../cards/CarCards.tsx';
import { CornerStripCard, LastCornerCard, NextCornerCard } from '../cards/CornerCards.tsx';
import { DeltaPotentialCard, LapTrendCard, OneThingCard } from '../cards/DriverCards.tsx';
import type { CardSize } from '../cards/parts.tsx';
import { ConnectionBadge } from '../components/ui.tsx';
import { useLive } from '../lib/live.ts';

interface LabCard {
  letter: string;
  name: string;
  Component: ComponentType<{ size: CardSize }>;
  what: string;
  updates: string;
  kind: 'insight' | 'timing' | 'hud';
  suggested: string;
}

const CARDS: LabCard[] = [
  {
    letter: 'A',
    name: 'Last corner',
    Component: LastCornerCard,
    what: 'The corner you just drove: time against your best run through it, understeer or oversteer on entry, mid-corner and exit, braking and throttle points, grip events, and one thing to change.',
    updates: 'Once per corner, as you exit',
    kind: 'insight',
    suggested: 'Focus (glance), optimisation and full (detail)',
  },
  {
    letter: 'B',
    name: 'Next corner',
    Component: NextCornerCard,
    what: 'The corner coming up, with your best run as the target: a countdown to where you braked, how slow you went, and the tip or habit for that corner.',
    updates: 'Continuously as you approach',
    kind: 'insight',
    suggested: 'Focus (glance), optimisation (detail)',
  },
  {
    letter: 'C',
    name: 'Corner by corner',
    Component: CornerStripCard,
    what: 'Time gained or lost in every corner so far this lap, against your reference lap. Shows where the delta is coming from.',
    updates: 'Once per corner',
    kind: 'insight',
    suggested: 'Optimisation and full',
  },
  {
    letter: 'D',
    name: 'Balance now',
    Component: BalanceMeterCard,
    what: 'Whether the car is understeering or oversteering right now, against the steering it usually needs for the same corner and cornering force.',
    updates: 'Continuously while cornering',
    kind: 'insight',
    suggested: 'Optimisation and full',
  },
  {
    letter: 'E',
    name: 'Grip this lap',
    Component: GripEventsCard,
    what: 'Lock-ups, wheelspin, slides, bottoming and wheels lifting this lap, and where they happened.',
    updates: 'Once per corner',
    kind: 'insight',
    suggested: 'Optimisation (glance), full (detail)',
  },
  {
    letter: 'F',
    name: 'Focus this lap',
    Component: OneThingCard,
    what: 'The single most valuable change from your last lap, highlighted as you approach that corner.',
    updates: 'Once per lap',
    kind: 'insight',
    suggested: 'Focus (glance)',
  },
  {
    letter: 'G',
    name: 'Delta',
    Component: DeltaPotentialCard,
    what: 'Live delta to your reference, with the predicted lap, your best and the ideal lap made of your best corners.',
    updates: 'Continuously',
    kind: 'timing',
    suggested: 'Every mode',
  },
  {
    letter: 'H',
    name: 'Lap trend',
    Component: LapTrendCard,
    what: 'Your recent laps against your best, and whether you are getting quicker.',
    updates: 'Once per lap',
    kind: 'timing',
    suggested: 'Full',
  },
  {
    letter: 'I',
    name: 'Car',
    Component: CarStatusCard,
    what: 'Gear, speed, RPM, pedals, tyre temperatures and fuel in one quiet row. The game HUD already shows these, so the glance size only speaks up when a tyre is out of its window or fuel is low.',
    updates: 'Continuously',
    kind: 'hud',
    suggested: 'Glance in every mode; detail only in full',
  },
];

const KIND_BADGES: Record<LabCard['kind'], { label: string; className: string }> = {
  insight: { label: 'Only in AMS2 Coach', className: 'badge-accent' },
  timing: { label: 'Timing', className: '' },
  hud: { label: 'Also on the game HUD', className: '' },
};

export function CardLabView() {
  const hasSession = useLive((s) => s.session !== null);

  return (
    <div className="page lab">
      <header className="page-header">
        <div>
          <h1>Card lab</h1>
          <p className="secondary lab-intro">
            Candidate cards for the Live page, running on live data. Each comes in two sizes: <strong>glance</strong>, for
            focus mode, and <strong>detail</strong>, for optimisation and full modes. Pick which cards belong in each
            mode and where they should sit.
          </p>
        </div>
        <ConnectionBadge />
      </header>

      {!hasSession && (
        <p className="lab-hint">
          No session yet, so the cards are empty. Drive a few laps, or restart with <code>npm run demo</code> to watch
          them fill in.
        </p>
      )}

      {CARDS.map((card) => (
        <article key={card.letter} className="lab-item" aria-labelledby={`lab-${card.letter}`}>
          <div className="lab-item-head">
            <span className="lab-letter" aria-hidden="true">
              {card.letter}
            </span>
            <h2 id={`lab-${card.letter}`}>
              <span className="visually-hidden">Card {card.letter}: </span>
              {card.name}
            </h2>
            <span className={`badge ${KIND_BADGES[card.kind].className}`}>{KIND_BADGES[card.kind].label}</span>
          </div>
          <div className="lab-notes">
            <p>{card.what}</p>
            <p className="muted">
              Updates: {card.updates} · My suggestion: {card.suggested}
            </p>
          </div>
          <div className="lab-sizes">
            <div>
              <p className="lab-size-label">Glance size</p>
              <card.Component size="glance" />
            </div>
            <div>
              <p className="lab-size-label">Detail size</p>
              <card.Component size="detail" />
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
