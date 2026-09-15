/**
 * Speed up the demo or a replayed recording, to get past the laps the coach
 * needs for calibrating. The game itself can't be sped up, so this only shows
 * for those sources.
 */
import { useEffect, useId, useState } from 'react';
import { PLAYBACK_SPEEDS } from '../../shared/model/types.ts';
import { api, sendJson } from '../lib/api.ts';
import { useLive } from '../lib/live.ts';

export function PlaybackSpeed() {
  const speed = useLive((s) => s.status?.playbackSpeed ?? null);
  const [pending, setPending] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const labelId = useId();

  // Status arrives once a second; show the choice straight away until it catches up.
  useEffect(() => {
    if (pending !== null && speed === pending) setPending(null);
  }, [speed, pending]);

  if (speed === null) return null;
  const shown = pending ?? speed;

  const choose = async (next: number) => {
    setPending(next);
    setError(null);
    try {
      await sendJson(api.sourceSpeed(), 'PUT', { speed: next });
    } catch (err) {
      setPending(null);
      setError((err as Error).message);
    }
  };

  return (
    <div className="playback-speed">
      <span id={labelId}>Playback</span>
      <div className="segmented" role="group" aria-labelledby={labelId}>
        {PLAYBACK_SPEEDS.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={shown === option}
            aria-label={`${option} times real time`}
            onClick={() => void choose(option)}
          >
            {option}×
          </button>
        ))}
      </div>
      {error && (
        <span className="error-text" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
