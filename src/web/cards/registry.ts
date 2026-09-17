/**
 * Every card the Live page can show. Each comes in a glance size (one grid cell)
 * and a full size (two cells wide).
 */
import type { ComponentType } from 'react';
import { BalanceMeterCard, CarStatusCard, GripEventsCard } from './CarCards.tsx';
import { CornerStripCard, LastCornerCard, NextCornerCard } from './CornerCards.tsx';
import { DeltaPotentialCard, LapTrendCard, OneThingCard } from './DriverCards.tsx';
import { CornerGripCard } from './GripCard.tsx';
import type { CardSize } from './parts.tsx';
import { CornerSteeringCard } from './SteeringCard.tsx';

export type CardId =
  | 'last-corner'
  | 'next-corner'
  | 'corner-strip'
  | 'balance'
  | 'grip'
  | 'focus'
  | 'delta'
  | 'lap-trend'
  | 'car'
  | 'corner-steering'
  | 'corner-grip';

export type CardKind = 'insight' | 'timing' | 'hud';

export interface CardDefinition {
  id: CardId;
  letter: string;
  name: string;
  Component: ComponentType<{ size: CardSize }>;
  what: string;
  updates: string;
  kind: CardKind;
}

export const CARDS: CardDefinition[] = [
  {
    id: 'last-corner',
    letter: 'A',
    name: 'Last corner',
    Component: LastCornerCard,
    what: 'The corner you just drove: time against your best run through it, understeer or oversteer on entry, mid-corner and exit, throttle and brake as colour strips, braking and throttle points, grip events, and one thing to change.',
    updates: 'Once per corner, as you exit',
    kind: 'insight',
  },
  {
    id: 'next-corner',
    letter: 'B',
    name: 'Next corner',
    Component: NextCornerCard,
    what: 'The corner coming up, with your best run as the target: a countdown to where you braked, how slow you went, and the tip or habit for that corner.',
    updates: 'Continuously as you approach',
    kind: 'insight',
  },
  {
    id: 'corner-strip',
    letter: 'C',
    name: 'Corner by corner',
    Component: CornerStripCard,
    what: 'Time gained or lost in every corner so far this lap, against your reference lap. Shows where the delta is coming from.',
    updates: 'Once per corner',
    kind: 'insight',
  },
  {
    id: 'balance',
    letter: 'D',
    name: 'Balance now',
    Component: BalanceMeterCard,
    what: 'Whether the car is understeering or oversteering right now, against the steering it usually needs for the same corner and cornering force.',
    updates: 'Continuously while cornering',
    kind: 'insight',
  },
  {
    id: 'grip',
    letter: 'E',
    name: 'Grip this lap',
    Component: GripEventsCard,
    what: 'Lock-ups, wheelspin, slides, bottoming and wheels lifting this lap, and where they happened.',
    updates: 'Once per corner',
    kind: 'insight',
  },
  {
    id: 'focus',
    letter: 'F',
    name: 'Focus this lap',
    Component: OneThingCard,
    what: 'The single most valuable change from your last lap, highlighted as you approach that corner.',
    updates: 'Once per lap',
    kind: 'insight',
  },
  {
    id: 'delta',
    letter: 'G',
    name: 'Delta',
    Component: DeltaPotentialCard,
    what: 'Live delta to your reference, with the predicted lap, your best and the ideal lap made of your best corners.',
    updates: 'Continuously',
    kind: 'timing',
  },
  {
    id: 'lap-trend',
    letter: 'H',
    name: 'Lap trend',
    Component: LapTrendCard,
    what: 'Your recent laps against your best, and whether you are getting quicker.',
    updates: 'Once per lap',
    kind: 'timing',
  },
  {
    id: 'car',
    letter: 'I',
    name: 'Car',
    Component: CarStatusCard,
    what: 'Gear, speed, RPM, pedals, tyre temperatures and fuel. The game HUD already shows these, so the glance size only speaks up when a tyre is out of its window or fuel is low.',
    updates: 'Continuously',
    kind: 'hud',
  },
  {
    id: 'corner-steering',
    letter: 'J',
    name: 'Last corner steering',
    Component: CornerSteeringCard,
    what: 'Your line through the corner you just drove, drawn over your best run, with steering along the way as colour strips: blue for left, white for straight, red for right. A short, sharp peak of steering is a V line; a long, even hold is a U line.',
    updates: 'Once per corner, as you exit',
    kind: 'insight',
  },
  {
    id: 'corner-grip',
    letter: 'K',
    name: 'Last corner grip',
    Component: CornerGripCard,
    what: "How much of the car's grip you used through the corner you just drove, as the g-g diagram (friction circle) coaches use. The circle is the most grip you've shown at each speed, so wherever your trace cuts inside it, grip went unused. Shows where along the corner the biggest gap was, braking, off the pedals or on part throttle, against your best run.",
    updates: 'Once per corner, as you exit',
    kind: 'insight',
  },
];

export const CARD_BY_ID = new Map<CardId, CardDefinition>(CARDS.map((card) => [card.id, card]));

export const KIND_BADGES: Record<CardKind, { label: string; className: string }> = {
  insight: { label: 'Only in AMS2 Coach', className: 'badge-accent' },
  timing: { label: 'Timing', className: '' },
  hud: { label: 'Also on the game HUD', className: '' },
};
