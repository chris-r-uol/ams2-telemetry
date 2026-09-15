/**
 * Card lab: every Live card running on live data, in its glance size (one grid
 * cell) and its full size (two cells wide). Presets on the Live page are built
 * from these.
 */
import { CARDS, KIND_BADGES } from '../cards/registry.ts';
import { ConnectionBadge } from '../components/ui.tsx';
import { useLive } from '../lib/live.ts';

export function CardLabView() {
  const hasSession = useLive((s) => s.session !== null);

  return (
    <div className="page lab">
      <header className="page-header">
        <div>
          <h1>Card lab</h1>
          <p className="secondary lab-intro">
            Every card for the Live page, running on live data. Each comes in two sizes: <strong>glance</strong>, one
            cell of the Live grid, and <strong>full</strong>, two cells wide. Arrange them into presets on the Live page
            with <strong>Edit layout</strong>.
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
        <article key={card.id} className="lab-item" aria-labelledby={`lab-${card.letter}`}>
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
            <p className="muted">Updates: {card.updates}</p>
          </div>
          <div className="lab-sizes">
            <div>
              <p className="lab-size-label">Glance size (1 × 1)</p>
              <card.Component size="glance" />
            </div>
            <div>
              <p className="lab-size-label">Full size (2 × 1)</p>
              <card.Component size="full" />
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
