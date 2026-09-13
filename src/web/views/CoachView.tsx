import { useId } from 'react';
import { describeHabit, describeTip, formatLapTime } from '../../shared/format.ts';
import type { SessionMeta } from '../../shared/model/types.ts';
import { formatSessionDate, isCoachable, sessionTitle } from '../components/laps.tsx';
import { Card, DeltaValue, EmptyState, Stat } from '../components/ui.tsx';
import { api, useApi, type InsightsDto } from '../lib/api.ts';
import { useLive } from '../lib/live.ts';
import { href, navigate } from '../lib/router.ts';
import { useSettings } from '../lib/settings.ts';

function consistencyWords(stdDev: number): string {
  if (stdDev < 0.15) return 'Very consistent';
  if (stdDev < 0.35) return 'Consistent';
  if (stdDev < 0.7) return 'Some lap-to-lap variation';
  return 'Big lap-to-lap swings';
}

export function CoachView({ id }: { id: string | null }) {
  const lapSerial = useLive((s) => s.lapSerial);
  const liveId = useLive((s) => s.session?.id ?? null);
  const sessions = useApi<SessionMeta[]>(api.sessions(), lapSerial);
  const { units } = useSettings();
  const pickerId = useId();

  const list = sessions.data ?? [];
  const session = id ? (list.find((s) => s.id === id) ?? null) : (list[0] ?? null);
  const isLive = session !== null && session.id === liveId;
  const insights = useApi<InsightsDto>(session ? api.insights(session.id) : null, isLive ? lapSerial : 0);

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
        Loading…
      </p>
    );
  }
  if (list.length === 0) {
    return (
      <EmptyState title="No sessions to coach yet">
        <p>Drive some laps. The coach looks for where your best lap can improve and for habits that repeat.</p>
      </EmptyState>
    );
  }
  if (!session) {
    return (
      <EmptyState title="Session not found">
        <p>
          <a href={href({ name: 'sessions' })}>Choose a session</a>
        </p>
      </EmptyState>
    );
  }

  const ins = insights.data?.insights ?? null;
  const cleanLaps = session.laps.filter(isCoachable).length;
  const potential = ins?.bestLap && ins.idealLapTime !== null ? ins.bestLap.time - ins.idealLapTime : 0;
  const maxPotential = Math.max(0.001, ...(ins?.corners.map((c) => c.potential) ?? [0]));

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">
            {formatSessionDate(session.startedAt)}
            {session.car && ` · ${session.car}`}
            {isLive && <span className="badge badge-good">Live</span>}
          </p>
          <h1>Coach</h1>
          <p className="secondary">{sessionTitle(session)}</p>
        </div>
        <div className="field">
          <label htmlFor={pickerId}>Session</label>
          <select id={pickerId} value={session.id} onChange={(e) => navigate({ name: 'coach', id: e.target.value })}>
            {list.map((s) => (
              <option key={s.id} value={s.id}>
                {sessionTitle(s)} · {formatSessionDate(s.startedAt)}
              </option>
            ))}
          </select>
        </div>
      </header>

      {!ins ? (
        <p className="loading" role="status">
          Analysing laps…
        </p>
      ) : ins.lapsAnalysed < 2 ? (
        <EmptyState title="Keep driving">
          <p>
            The coach needs at least two clean flying laps to compare. This session has {cleanLaps}{' '}
            {cleanLaps === 1 ? 'clean lap' : 'clean laps'} so far.
          </p>
        </EmptyState>
      ) : (
        <>
          <div className="stats-row">
            <Stat label="Best lap" value={formatLapTime(ins.bestLap?.time)} detail={ins.bestLap ? `Lap ${ins.bestLap.lap}` : undefined} />
            <Stat
              label="Ideal lap"
              value={formatLapTime(ins.idealLapTime)}
              detail={potential > 0.005 ? `${potential.toFixed(2)} s available from your own best corners` : 'Your best lap is already your ideal'}
            />
            <Stat label="Best sectors combined" value={formatLapTime(ins.theoreticalBestFromSectors)} detail="From the game's sector splits" />
            <Stat
              label="Consistency"
              value={ins.consistency ? `±${ins.consistency.stdDev.toFixed(2)} s` : '–'}
              detail={ins.consistency ? `${consistencyWords(ins.consistency.stdDev)} over ${ins.consistency.laps} laps` : undefined}
            />
          </div>

          <div className="coach-grid">
            <Card title="Where your best lap can improve" description="Against your fastest run through each corner this session">
              {ins.focus.length > 0 ? (
                <ol className="tips">
                  {ins.focus.slice(0, 5).map((tip) => {
                    const text = describeTip(tip, units);
                    return (
                      <li key={`${tip.cornerId}-${tip.kind}`} className="tip">
                        <div className="tip-head">
                          <strong>{text.title}</strong>
                          <DeltaValue seconds={tip.timeLost} digits={2} />
                        </div>
                        <p>{text.detail}</p>
                        {ins.bestLap && tip.referenceLap && (
                          <p>
                            <a
                              href={href({
                                name: 'compare',
                                session: session.id,
                                lap: ins.bestLap.lap,
                                refSession: session.id,
                                refLap: tip.referenceLap,
                              })}
                            >
                              Compare lap {ins.bestLap.lap} with lap {tip.referenceLap}
                            </a>
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="muted">Your best lap was also your best run through every corner. Nicely done.</p>
              )}
            </Card>

            <Card title="Habits" description="Patterns that keep repeating across your laps">
              {ins.habits.length > 0 ? (
                <ul className="habit-list">
                  {ins.habits.slice(0, 6).map((habit) => {
                    const text = describeHabit(habit, units);
                    return (
                      <li key={`${habit.cornerId}-${habit.kind}`} className="habit">
                        <strong>{text.title}</strong>
                        <div className="habit-count">
                          <span className="habit-bar" aria-hidden="true">
                            <span style={{ width: `${(habit.count / habit.outOf) * 100}%` }} />
                          </span>
                          {habit.count} of {habit.outOf} laps
                        </div>
                        <p className="secondary">{text.detail}</p>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="muted">No repeating patterns yet. They show up after a few more laps, or you're very consistent.</p>
              )}
            </Card>

            <Card title="Corner by corner" className="span-all" description="Time through each corner across all clean laps">
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th scope="col">Corner</th>
                      <th scope="col" className="num">Best run</th>
                      <th scope="col" className="num">Average</th>
                      <th scope="col" className="num">Spread</th>
                      <th scope="col">Left on the table by your best lap</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ins.corners.map((c) => (
                      <tr key={c.corner.id}>
                        <th scope="row" className="corner-row-name">
                          {c.corner.name}
                        </th>
                        <td className="num">
                          {c.bestTime.toFixed(3)} s <span className="muted">lap {c.bestLap}</span>
                        </td>
                        <td className="num">{c.meanTime.toFixed(3)} s</td>
                        <td className="num">±{c.stdDev.toFixed(3)} s</td>
                        <td>
                          {c.potential >= 0.005 ? (
                            <>
                              <span className="potential-bar" style={{ width: `${(c.potential / maxPotential) * 8}rem` }} aria-hidden="true" />
                              <DeltaValue seconds={c.potential} />
                            </>
                          ) : (
                            <span className="muted">Best lap was best here</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
