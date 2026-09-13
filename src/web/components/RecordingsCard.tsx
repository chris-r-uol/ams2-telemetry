import { useId, useState } from 'react';
import type { RecordingInfo, RecordingStatus } from '../../shared/model/types.ts';
import { api, sendJson, useApi } from '../lib/api.ts';
import { useLive } from '../lib/live.ts';
import { formatSessionDate } from './laps.tsx';
import { formatBytes, formatDuration, RecordButton } from './RecordButton.tsx';
import { Card } from './ui.tsx';

interface RecordingsDto {
  active: RecordingStatus | null;
  autoRecord: boolean;
  recordings: RecordingInfo[];
}

export function RecordingsCard() {
  const activeName = useLive((s) => s.status?.recording?.name ?? null);
  const { data, error, reload } = useApi<RecordingsDto>(api.recordings(), activeName);
  const [actionError, setActionError] = useState<string | null>(null);
  const autoId = useId();

  const run = async (action: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await action();
      reload();
    } catch (err) {
      setActionError((err as Error).message);
    }
  };

  const remove = (recording: RecordingInfo) => {
    if (!window.confirm(`Delete the recording ${recording.name}? This can't be undone.`)) return;
    void run(() => sendJson(api.recording(recording.name), 'DELETE'));
  };

  return (
    <Card
      title="Raw telemetry recordings"
      id="recordings"
      description="Every packet the game sent, exactly as it arrived. Replay one on any computer, or share it to get help with a problem."
      actions={<RecordButton />}
    >
      <div className="setting">
        <label className="check" htmlFor={autoId}>
          <input
            id={autoId}
            type="checkbox"
            checked={data?.autoRecord ?? false}
            disabled={!data}
            onChange={(e) => void run(() => sendJson(api.recordingSettings(), 'PUT', { autoRecord: e.target.checked }))}
          />
          <span>
            Record every session automatically
            <br />
            <span className="setting-hint">
              One file per session, roughly 40 MB per hour of driving. Stops by itself after 30 seconds without
              data.
            </span>
          </span>
        </label>
      </div>

      {(actionError ?? error) && (
        <p className="error-text" role="alert">
          {actionError ?? error}
        </p>
      )}

      {data && data.recordings.length === 0 && (
        <p className="muted">No recordings yet. Press Record telemetry before you head out, then download the file here.</p>
      )}

      {data && data.recordings.length > 0 && (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Recording</th>
                <th scope="col">Started</th>
                <th scope="col" className="num">Length</th>
                <th scope="col" className="num">File size</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.recordings.map((recording) => {
                const title = [recording.track, recording.car].filter(Boolean).join(' · ') || 'Unknown track';
                return (
                  <tr key={recording.name}>
                    <th scope="row">
                      <div>{title}</div>
                      <div className="recording-file muted">{recording.name}</div>
                    </th>
                    <td>{formatSessionDate(recording.startedAt)}</td>
                    <td className="num">{recording.durationMs !== null ? formatDuration(recording.durationMs) : '–'}</td>
                    <td className="num">{formatBytes(recording.sizeBytes)}</td>
                    <td>
                      {recording.active ? (
                        <span className="badge badge-bad">
                          <span aria-hidden="true">{'●'}</span> Recording
                        </span>
                      ) : (
                        <span className="row-actions">
                          <a className="btn btn-small" href={api.recording(recording.name)} download>
                            Download<span className="visually-hidden"> {title} recording</span>
                          </a>
                          <button type="button" className="btn btn-small" onClick={() => remove(recording)}>
                            Delete<span className="visually-hidden"> {title} recording</span>
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="setting-hint recording-hint">
        Files are saved in the <code>recordings</code> folder. Replay one with{' '}
        <code>npm run replay -- recordings/&lt;file&gt;</code>.
      </p>
    </Card>
  );
}
