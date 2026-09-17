/**
 * Replaying a recording from the dashboard: it takes over the Live page until
 * it's stopped, and the replayed laps aren't saved again.
 */
import { useState } from 'react';
import type { RecordingInfo, RecordingStatus } from '../../shared/model/types.ts';
import { api, sendJson, useApi } from './api.ts';
import { useLive } from './live.ts';
import { navigate } from './router.ts';

export interface RecordingsDto {
  active: RecordingStatus | null;
  autoRecord: boolean;
  recordings: RecordingInfo[];
}

/** The recordings folder, refreshed when a recording starts or stops. */
export function useRecordings() {
  const activeName = useLive((s) => s.status?.recording?.name ?? null);
  return useApi<RecordingsDto>(api.recordings(), activeName);
}

/** Start replaying a recording and go to the Live page to watch it. */
export function useStartReplay(): { start: (recording: string) => Promise<void>; busy: string | null; error: string | null } {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const start = async (recording: string) => {
    setBusy(recording);
    setError(null);
    try {
      await sendJson(api.replay(), 'POST', { recording });
      navigate({ name: 'live' });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return { start, busy, error };
}
