/**
 * AMS2 doesn't tell telemetry apps which car you're driving, so you say. Suggestions
 * are the cars the game named in the session, but any name can be typed.
 */
import { useId, useState, type FormEvent } from 'react';
import type { SessionMeta } from '../../shared/model/types.ts';
import { api, sendJson } from '../lib/api.ts';

export function CarPicker({ session, onChange }: { session: SessionMeta; onChange?: (session: SessionMeta) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const listId = useId();
  const hintId = useId();
  const suggestions = session.vehicles ?? [];

  const start = () => {
    setValue(session.car);
    setError(null);
    setEditing(true);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const updated = await sendJson<SessionMeta>(api.sessionCar(session.id), 'PUT', { car: value });
      setEditing(false);
      onChange?.(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <p className="car-line secondary">
        <span>{session.car ? [session.car, session.carClass].filter(Boolean).join(' · ') : 'Car not known'}</span>
        {session.carSource === 'remembered' && <span className="muted">(assumed from your last choice)</span>}
        <button type="button" className="btn btn-small" onClick={start}>
          {session.car ? 'Change car' : 'Set car'}
        </button>
      </p>
    );
  }

  return (
    <form className="car-form" onSubmit={save}>
      <div className="field">
        <label htmlFor={inputId}>Car you drove</label>
        <input
          id={inputId}
          list={suggestions.length ? listId : undefined}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={80}
          autoComplete="off"
          aria-describedby={hintId}
          required
          autoFocus
        />
        {suggestions.length > 0 && (
          <datalist id={listId}>
            {suggestions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        )}
      </div>
      <button type="submit" className="btn is-primary" disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </button>
      <button type="button" className="btn" onClick={() => setEditing(false)}>
        Cancel
      </button>
      <p id={hintId} className="car-form-hint muted">
        The game doesn't say which car you're driving.
        {suggestions.length > 0 && ' The suggestions are the cars in this session.'} Your choice is also assumed for new
        sessions until you change it.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
