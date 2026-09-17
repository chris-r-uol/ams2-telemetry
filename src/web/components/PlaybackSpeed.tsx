/**
 * Playback controls for the demo and replays: pause, speed (to get past the laps
 * the coach needs for calibrating) and, for a replay started from the dashboard,
 * stopping it to go back to the game. The game itself can't be paused or sped up,
 * so nothing shows while it's the source.
 */
import { useEffect, useId, useState } from 'react';
import { PLAYBACK_SPEEDS } from '../../shared/model/types.ts';
import { api, sendJson } from '../lib/api.ts';
import { useLive } from '../lib/live.ts';

export function PlaybackSpeed() {
  const speed = useLive((s) => s.status?.playbackSpeed ?? null);
  const paused = useLive((s) => s.status?.paused ?? false);
  const replay = useLive((s) => s.status?.replay ?? null);
  const [pendingSpeed, setPendingSpeed] = useState<number | null>(null);
  const [pendingPause, setPendingPause] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const labelId = useId();

  // Status arrives once a second; show the choice straight away until it catches up.
  useEffect(() => {
    if (pendingSpeed !== null && speed === pendingSpeed) setPendingSpeed(null);
  }, [speed, pendingSpeed]);
  useEffect(() => {
    if (pendingPause !== null && paused === pendingPause) setPendingPause(null);
  }, [paused, pendingPause]);

  if (speed === null) return null;
  const shownSpeed = pendingSpeed ?? speed;
  const shownPaused = pendingPause ?? paused;

  const send = async (path: string, method: 'PUT' | 'DELETE', body: unknown, undo: () => void) => {
    setError(null);
    try {
      await sendJson(path, method, body);
    } catch (err) {
      undo();
      setError((err as Error).message);
    }
  };
  const chooseSpeed = (next: number) => {
    setPendingSpeed(next);
    void send(api.sourceSpeed(), 'PUT', { speed: next }, () => setPendingSpeed(null));
  };
  const togglePause = () => {
    const next = !shownPaused;
    setPendingPause(next);
    void send(api.sourcePause(), 'PUT', { paused: next }, () => setPendingPause(null));
  };
  const stopReplay = () => void send(api.replay(), 'DELETE', {}, () => {});

  return (
    <div className="playback-speed">
      <span id={labelId}>
        {replay ? (
          <>
            Replay
            {replay.track && <span className="visually-hidden"> of {replay.track}</span>}
            {replay.finished && <span className="muted"> · finished</span>}
          </>
        ) : (
          'Playback'
        )}
      </span>
      <button
        type="button"
        className="btn btn-small playback-pause"
        aria-pressed={shownPaused}
        onClick={togglePause}
        disabled={replay?.finished}
      >
        <span aria-hidden="true">{shownPaused ? '▶' : '❚❚'}</span> {shownPaused ? 'Resume' : 'Pause'}
      </button>
      <div className="segmented" role="group" aria-labelledby={labelId}>
        {PLAYBACK_SPEEDS.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={shownSpeed === option}
            aria-label={`${option} times real time`}
            onClick={() => chooseSpeed(option)}
          >
            {option}×
          </button>
        ))}
      </div>
      {replay && (
        <button type="button" className="btn btn-small" onClick={stopReplay}>
          Stop replay
        </button>
      )}
      {error && (
        <span className="error-text" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
