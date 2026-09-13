import { useId, type ReactNode } from 'react';
import type { PressureUnit, SpeedUnit, TemperatureUnit } from '../../shared/format.ts';
import { Card } from '../components/ui.tsx';
import { useLive } from '../lib/live.ts';
import { updateSettings, useSettings, type ThemeSetting } from '../lib/settings.ts';

function Segmented<T extends string | number>({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const id = useId();
  return (
    <div className="setting">
      <span id={id} className="setting-label">
        {label}
      </span>
      <div className="segmented" role="group" aria-labelledby={id}>
        {options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            aria-pressed={option.value === value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {hint && <span className="setting-hint">{hint}</span>}
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: ReactNode; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className="setting">
      <label className="check">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span>
          {label}
          {hint && (
            <>
              <br />
              <span className="setting-hint">{hint}</span>
            </>
          )}
        </span>
      </label>
    </div>
  );
}

export function SettingsView() {
  const settings = useSettings();
  const status = useLive((s) => s.status);
  const version = useLive((s) => s.version);
  const connection = useLive((s) => s.connection);
  const lowId = useId();
  const highId = useId();
  const [low, high] = settings.tyreWindow;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Settings</h1>
          <p className="secondary">Saved in this browser. Open dashboards on other monitors update too.</p>
        </div>
      </header>

      <div className="settings-grid">
        <Card title="Display">
          <Segmented<ThemeSetting>
            label="Theme"
            value={settings.theme}
            options={[
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' },
              { value: 'system', label: 'Match system' },
            ]}
            onChange={(theme) => updateSettings({ theme })}
          />
          <Segmented<number>
            label="Text and UI size"
            hint="Bigger is easier to read from the driving seat."
            value={settings.textScale}
            options={[
              { value: 1, label: '100%' },
              { value: 1.15, label: '115%' },
              { value: 1.3, label: '130%' },
              { value: 1.5, label: '150%' },
            ]}
            onChange={(textScale) => updateSettings({ textScale })}
          />
          <Toggle
            label="Mirror the track map"
            hint="Turn this on if corners appear on the wrong side."
            checked={settings.mirrorMap}
            onChange={(mirrorMap) => updateSettings({ mirrorMap })}
          />
          <Toggle
            label="Announce completed laps"
            hint="For screen readers: lap time, delta and the top tip, once per lap."
            checked={settings.announceLaps}
            onChange={(announceLaps) => updateSettings({ announceLaps })}
          />
        </Card>

        <Card title="Units">
          <Segmented<SpeedUnit>
            label="Speed"
            value={settings.units.speed}
            options={[
              { value: 'kmh', label: 'km/h' },
              { value: 'mph', label: 'mph' },
            ]}
            onChange={(speed) => updateSettings({ units: { ...settings.units, speed } })}
          />
          <Segmented<TemperatureUnit>
            label="Temperature"
            value={settings.units.temperature}
            options={[
              { value: 'c', label: '°C' },
              { value: 'f', label: '°F' },
            ]}
            onChange={(temperature) => updateSettings({ units: { ...settings.units, temperature } })}
          />
          <Segmented<PressureUnit>
            label="Tyre pressure"
            value={settings.units.pressure}
            options={[
              { value: 'psi', label: 'psi' },
              { value: 'bar', label: 'bar' },
              { value: 'kpa', label: 'kPa' },
            ]}
            onChange={(pressure) => updateSettings({ units: { ...settings.units, pressure } })}
          />
          <div className="setting">
            <span className="setting-label">Tyre temperature window (°C)</span>
            <div className="inline-fields">
              <div className="field">
                <label htmlFor={lowId}>Cold below</label>
                <input
                  id={lowId}
                  type="number"
                  inputMode="numeric"
                  min={20}
                  max={high - 1}
                  value={low}
                  onChange={(e) => updateSettings({ tyreWindow: [Number(e.target.value), high] })}
                />
              </div>
              <div className="field">
                <label htmlFor={highId}>Hot above</label>
                <input
                  id={highId}
                  type="number"
                  inputMode="numeric"
                  min={low + 1}
                  max={150}
                  value={high}
                  onChange={(e) => updateSettings({ tyreWindow: [low, Number(e.target.value)] })}
                />
              </div>
            </div>
            <span className="setting-hint">Windows vary by car and compound. Tyres outside it are labelled Cold or Hot.</span>
          </div>
        </Card>

        <Card title="Automobilista 2 setup">
          <ol className="steps">
            <li>
              In the game, open <strong>Options → System</strong>.
            </li>
            <li>
              <strong>UDP Frequency</strong>: 1 (the fastest rate).
            </li>
            <li>
              <strong>UDP Protocol Version</strong>: Project CARS 2.
            </li>
            <li>
              Run this app on the same PC (or any computer on your network) and open the dashboard on your second
              monitor.
            </li>
          </ol>
          <p className="setting-hint" style={{ marginTop: '0.75rem' }}>
            The game broadcasts on UDP port 5606. Other tools like SimHub or CrewChief can listen at the same time.
          </p>
        </Card>

        <Card title="Connection">
          <dl className="diagnostics">
            <dt>Dashboard</dt>
            <dd>{connection === 'open' ? 'Connected to the server' : connection === 'connecting' ? 'Connecting…' : 'Disconnected, retrying'}</dd>
            <dt>Source</dt>
            <dd>{status?.detail ?? '–'}</dd>
            <dt>Packets per second</dt>
            <dd className="tabular">{status?.packetsPerSecond ?? 0}</dd>
            <dt>Last packet</dt>
            <dd>{status?.lastPacketAt ? new Date(status.lastPacketAt).toLocaleTimeString() : 'None yet'}</dd>
            <dt>Recording</dt>
            <dd>
              {status?.recording
                ? `On: ${status.recording.name}`
                : 'Off. Use Record telemetry on the Live or Sessions page.'}
            </dd>
            <dt>Packets by type</dt>
            <dd>
              {status && Object.keys(status.packetCounts).length > 0
                ? Object.entries(status.packetCounts)
                    .map(([kind, count]) => `${kind} ${count.toLocaleString()}`)
                    .join(' · ')
                : '–'}
            </dd>
            <dt>Version</dt>
            <dd>{version ?? '–'}</dd>
          </dl>
        </Card>
      </div>
    </div>
  );
}
