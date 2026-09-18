import type { ReactNode } from 'react';
import { formatDelta } from '../../shared/format.ts';
import { useLive } from '../lib/live.ts';

/** A signed time difference that never relies on colour: sign, icon and (optionally visible) words. */
export function DeltaValue({
  seconds,
  digits = 3,
  words = false,
  className = '',
}: {
  seconds: number | null | undefined;
  digits?: number;
  words?: boolean;
  className?: string;
}) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) {
    return <span className={`delta ${className}`}>{'—'}</span>;
  }
  const rounded = Number(seconds.toFixed(digits));
  const tone = rounded > 0 ? 'is-slower' : rounded < 0 ? 'is-faster' : '';
  const word = rounded > 0 ? 'slower' : rounded < 0 ? 'faster' : 'level';
  return (
    <span className={`delta ${tone} ${className}`}>
      <span className="delta-icon" aria-hidden="true">
        {rounded > 0 ? '▲' : rounded < 0 ? '▼' : '●'}
      </span>
      <span className="delta-number">{formatDelta(seconds, digits)}</span>
      <span className={words ? 'delta-words' : 'visually-hidden'}> {word}</span>
    </span>
  );
}

export function ConnectionBadge() {
  const connection = useLive((s) => s.connection);
  const receiving = useLive((s) => s.frame?.receiving ?? false);
  const gameState = useLive((s) => s.frame?.gameState ?? null);
  const source = useLive((s) => s.status?.source ?? null);
  const paused = useLive((s) => s.status?.paused ?? false);

  if (connection !== 'open') {
    return (
      <span className="badge badge-bad" role="status">
        <span aria-hidden="true">{'○'}</span>
        {connection === 'connecting' ? 'Connecting…' : 'Server offline, retrying'}
      </span>
    );
  }
  if (paused) {
    return (
      <span className="badge" role="status">
        <span aria-hidden="true">{'❚❚'}</span>
        {source === 'demo' ? 'Demo paused' : 'Replay paused'}
      </span>
    );
  }
  if (!receiving) {
    return (
      <span className="badge badge-warning" role="status">
        <span aria-hidden="true">{'◌'}</span>
        {source === 'udp' ? 'Waiting for Automobilista 2' : 'Waiting for data'}
      </span>
    );
  }
  const label =
    gameState === 'paused'
      ? 'Paused'
      : gameState === 'replay' || gameState === 'frontEndReplay'
        ? 'Watching a replay (not recording)'
        : source === 'demo'
          ? 'Live · demo driver'
          : source === 'replay'
            ? 'Live · replaying a recording'
            : 'Live';
  return (
    <span className="badge badge-good" role="status">
      <span aria-hidden="true">{'●'}</span>
      {label}
    </span>
  );
}

export function Stat({ label, value, detail, className = '' }: { label: string; value: ReactNode; detail?: ReactNode; className?: string }) {
  return (
    <div className={`stat ${className}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {detail !== undefined && <div className="stat-detail">{detail}</div>}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <h2>{title}</h2>
      {children && <div className="empty-state-body">{children}</div>}
    </div>
  );
}

export function Card({
  title,
  description,
  actions,
  children,
  className = '',
  id,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section className={`card ${className}`} aria-labelledby={headingId}>
      <div className="card-header">
        <div>
          <h2 id={headingId}>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
