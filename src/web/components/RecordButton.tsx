import { useEffect, useState } from 'react';
import { api, sendJson } from '../lib/api.ts';
import { useLive } from '../lib/live.ts';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** Start/stop a raw packet recording, with elapsed time while it runs. */
export function RecordButton() {
  const recording = useLive((s) => s.status?.recording ?? null);
  const online = useLive((s) => s.connection === 'open');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const active = recording !== null;

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);

  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      await sendJson(active ? api.recordingStop() : api.recordingStart(), 'POST');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="record">
      <button
        type="button"
        className={`btn record-btn${active ? ' is-recording' : ''}`}
        disabled={busy || !online}
        onClick={toggle}
      >
        <span className="record-dot" aria-hidden="true" />
        {active ? 'Stop recording' : 'Record telemetry'}
      </button>
      {recording && (
        <span className="record-meta tabular">
          <span className="visually-hidden">Recording for </span>
          {formatDuration(now - recording.startedAt)} · {formatBytes(recording.bytes)}
          {recording.auto ? ' · automatic' : ''}
        </span>
      )}
      {error && (
        <span className="error-text" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
