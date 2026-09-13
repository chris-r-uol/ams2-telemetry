import type { LapSummary, SessionMeta } from '../../shared/model/types.ts';

export function isCoachable(lap: LapSummary): boolean {
  return lap.valid && lap.kind === 'flying' && lap.lapTime !== null;
}

export function bestLap(session: SessionMeta | null | undefined): LapSummary | null {
  let best: LapSummary | null = null;
  for (const lap of session?.laps ?? []) {
    if (isCoachable(lap) && (!best || lap.lapTime! < best.lapTime!)) best = lap;
  }
  return best;
}

export function bestSectors(laps: LapSummary[]): [number, number, number] {
  const best: [number, number, number] = [Infinity, Infinity, Infinity];
  for (const lap of laps) {
    if (!lap.valid) continue;
    lap.sectors.forEach((s, i) => {
      if (s !== null && s < best[i]) best[i] = s;
    });
  }
  return best;
}

export function gearLabel(gear: number): string {
  return gear < 0 ? 'R' : gear === 0 ? 'N' : String(gear);
}

const KIND_LABELS: Record<LapSummary['kind'], string> = {
  flying: 'Flying lap',
  out: 'Out lap',
  in: 'In lap',
  partial: 'Partial lap',
};

export function LapStatus({ lap, best = false }: { lap: LapSummary; best?: boolean }) {
  return (
    <span className="lap-status">
      {best && <span className="badge badge-good">{'★'} Best</span>}
      {lap.kind !== 'flying' && <span className="badge">{KIND_LABELS[lap.kind]}</span>}
      {!lap.valid && (
        <span className="badge badge-warning">
          <span aria-hidden="true">{'⚠'}</span> Invalid
        </span>
      )}
      {lap.valid && lap.kind === 'flying' && !best && <span className="badge">Clean</span>}
    </span>
  );
}

export function sessionTitle(session: SessionMeta): string {
  return [session.track.location, session.track.variation].filter(Boolean).join(' · ');
}

export function formatSessionDate(epochMs: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(epochMs);
}
