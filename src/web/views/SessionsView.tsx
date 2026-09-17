import { useId, useState } from 'react';
import { formatLapTime, SESSION_LABELS } from '../../shared/format.ts';
import type { SessionMeta } from '../../shared/model/types.ts';
import { bestLap, formatSessionDate, isCoachable, sessionTitle } from '../components/laps.tsx';
import { Card, EmptyState } from '../components/ui.tsx';
import { RecordingsCard } from '../components/RecordingsCard.tsx';
import { api, useApi } from '../lib/api.ts';
import { useLive } from '../lib/live.ts';
import { useRecordings, useStartReplay } from '../lib/replay.ts';
import { href } from '../lib/router.ts';

const SOURCE_LABELS: Record<SessionMeta['source'], string> = {
  udp: 'Game',
  demo: 'Demo',
  replay: 'Replay',
};

export function SessionsView() {
  const lapSerial = useLive((s) => s.lapSerial);
  const liveId = useLive((s) => s.session?.id ?? null);
  const sessions = useApi<SessionMeta[]>(api.sessions(), lapSerial);
  const recordings = useRecordings();
  const replay = useStartReplay();
  const replaying = useLive((s) => s.status?.replay?.recording ?? null);
  const [track, setTrack] = useState('all');
  const filterId = useId();

  if (sessions.error) {
    return (
      <EmptyState title="Couldn't load sessions">
        <p className="error-text">{sessions.error}</p>
      </EmptyState>
    );
  }
  if (!sessions.data) {
    return (
      <p className="loading" role="status">
        Loading sessions…
      </p>
    );
  }

  const list = sessions.data;
  if (list.length === 0) {
    return (
      <div className="page">
        <EmptyState title="No sessions yet">
          <p>Every lap you drive is saved automatically. Head out on track and your sessions will appear here.</p>
        </EmptyState>
        <RecordingsCard />
      </div>
    );
  }

  const tracks = [...new Set(list.map(sessionTitle))].sort();
  const recordingFor = new Map(
    (recordings.data?.recordings ?? [])
      .filter((r) => r.sessionId !== null && !r.active)
      .map((r) => [r.sessionId!, r.name]),
  );
  const shown = track === 'all' ? list : list.filter((s) => sessionTitle(s) === track);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Sessions</h1>
          <p className="secondary">
            {list.length} {list.length === 1 ? 'session' : 'sessions'} saved on this computer
          </p>
        </div>
      </header>

      <div className="filters">
        <div className="field">
          <label htmlFor={filterId}>Track</label>
          <select id={filterId} value={track} onChange={(e) => setTrack(e.target.value)}>
            <option value="all">All tracks</option>
            {tracks.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>

      <Card
        title={track === 'all' ? 'All sessions' : track}
        description={`${shown.length} shown, newest first. Sessions you recorded can be replayed on the Live page.`}
      >
        {replay.error && (
          <p className="error-text" role="alert">
            {replay.error}
          </p>
        )}
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Track</th>
                <th scope="col">Date</th>
                <th scope="col">Car</th>
                <th scope="col">Session</th>
                <th scope="col" className="num">Laps</th>
                <th scope="col" className="num">Best lap</th>
                <th scope="col">Source</th>
                <th scope="col">
                  <span className="visually-hidden">Replay</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((session) => {
                const best = bestLap(session);
                return (
                  <tr key={session.id}>
                    <th scope="row">
                      <a href={href({ name: 'session', id: session.id })}>{sessionTitle(session)}</a>{' '}
                      {session.id === liveId && <span className="badge badge-good">Live</span>}
                    </th>
                    <td>{formatSessionDate(session.startedAt)}</td>
                    <td>{session.car || '–'}</td>
                    <td>{SESSION_LABELS[session.sessionType]}</td>
                    <td className="num">
                      {session.laps.length}
                      <span className="muted"> ({session.laps.filter(isCoachable).length} clean)</span>
                    </td>
                    <td className="num">{formatLapTime(best?.lapTime)}</td>
                    <td>{SOURCE_LABELS[session.source]}</td>
                    <td>
                      {recordingFor.has(session.id) &&
                        (replaying === recordingFor.get(session.id) ? (
                          <span className="badge badge-good">Replaying</span>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-small"
                            disabled={replay.busy !== null}
                            onClick={() => void replay.start(recordingFor.get(session.id)!)}
                          >
                            Replay<span className="visually-hidden"> {sessionTitle(session)}, {formatSessionDate(session.startedAt)}</span>
                          </button>
                        ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <RecordingsCard />
    </div>
  );
}
