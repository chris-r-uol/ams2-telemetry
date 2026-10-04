/**
 * Stints on the Session page: the runs between visits to the pits or garage, side
 * by side, with what changed before each and how each corner went. Comparing two
 * stints is comparing two setups on the same day.
 */
import { useId, useState, type ReactNode } from 'react';
import type { StintSummary } from '../../shared/analysis/stints.ts';
import {
  formatLapTime,
  formatSectorTime,
  pressureIn,
  pressureLabel,
  speedIn,
  speedLabel,
  temperatureIn,
  temperatureLabel,
  type Units,
} from '../../shared/format.ts';
import type { Quad, SessionMeta } from '../../shared/model/types.ts';
import { api, sendJson, useApi, type AnalysedLapDto, type StintDto, type StintsDto } from '../lib/api.ts';
import { href } from '../lib/router.ts';
import { TrackMap, type MapSegment } from './TrackMap.tsx';
import { Card, DeltaValue } from './ui.tsx';

export const stintName = (stint: { id: number }) => `Stint ${stint.id}`;

/** "laps 6–12", by the game's lap numbers. */
export function lapRange(stint: { laps: number[] }): string {
  const first = stint.laps[0];
  const last = stint.laps[stint.laps.length - 1];
  return first === last ? `lap ${first}` : `laps ${first}–${last}`;
}

/** What you wrote down as changed before the stint, if anything. */
export const stintNote = (session: SessionMeta, stint: { first: number }) => session.stintNotes?.[stint.first] ?? '';

/** "Stint 2 · laps 6–12 · rear wing +2", for pickers and headings. */
export function stintTitle(session: SessionMeta, stint: StintSummary): string {
  return [stintName(stint), lapRange(stint), stintNote(session, stint)].filter(Boolean).join(' · ');
}

/** +3 or −0.25, with a true minus sign. A difference that is neither better nor worse in itself. */
function signed(value: number, digits = 0): string {
  const rounded = Number(value.toFixed(digits));
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : '±'}${Math.abs(rounded).toFixed(digits)}`;
}

/** Front left and front right over rear left and rear right, as the car sits. */
function Wheels({ values, format, what }: { values: Quad | null; format: (v: number) => string; what: string }) {
  if (!values) return <>–</>;
  const [fl, fr, rl, rr] = values.map(format);
  return (
    <span className="wheel-quad tabular" role="img" aria-label={`${what}: front left ${fl}, front right ${fr}, rear left ${rl}, rear right ${rr}`}>
      <span>{fl}</span>
      <span>{fr}</span>
      <span>{rl}</span>
      <span>{rr}</span>
    </span>
  );
}

function NoteInput({ session, stint, onSaved }: { session: SessionMeta; stint: StintSummary; onSaved: () => void }) {
  const saved = stintNote(session, stint);
  const [value, setValue] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (value.trim() === saved) return;
    try {
      await sendJson(api.stintNote(session.id, stint.first), 'PUT', { note: value });
      setError(null);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <>
      <input
        className="stint-note"
        type="text"
        value={value}
        maxLength={120}
        placeholder="e.g. rear wing +2"
        aria-label={`What changed before ${stintName(stint).toLowerCase()}`}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
      {error && (
        <span className="error-text" role="alert">
          {error}
        </span>
      )}
    </>
  );
}

interface Row {
  label: string;
  hint?: string;
  cell: (stint: StintSummary, base: StintSummary | null) => ReactNode;
}

/** A time with how much quicker or slower it is than the stint it's set against. */
function timeCell(format: (seconds: number | null) => string, value: number | null, base: number | null | undefined): ReactNode {
  if (value === null) return '–';
  return (
    <>
      <span className="tabular">{format(value)}</span>
      {base !== null && base !== undefined && (
        <span className="stint-change">
          <DeltaValue seconds={value - base} />
        </span>
      )}
    </>
  );
}

/** A figure with its signed difference: more or less, not better or worse. */
function figureCell(value: number | null, base: number | null | undefined, digits: number, unit: string): ReactNode {
  if (value === null) return '–';
  // The difference between the figures as shown, so 283 against 282 never reads as no change.
  const shown = (v: number) => Number(v.toFixed(digits));
  return (
    <>
      <span className="tabular">
        {value.toFixed(digits)} {unit}
      </span>
      {base !== null && base !== undefined && (
        <span className="stint-change tabular muted">{signed(shown(value) - shown(base), digits)}</span>
      )}
    </>
  );
}

export function StintsCard({
  session,
  stints,
  details,
  units,
  onNoteSaved,
}: {
  session: SessionMeta;
  stints: StintSummary[];
  /** Ideal laps come from the telemetry, so they arrive after the rest. */
  details: StintDto[] | null;
  units: Units;
  onNoteSaved: () => void;
}) {
  const [against, setAgainst] = useState<'previous' | number>('previous');
  const pickerId = useId();
  const baseOf = (stint: StintSummary): StintSummary | null => {
    const base = against === 'previous' ? stints[stint.id - 2] : stints.find((s) => s.id === against);
    return base && base !== stint ? base : null;
  };
  const idealOf = (stint: StintSummary | null) => details?.find((d) => d.id === stint?.id)?.idealLapTime ?? null;
  const speed = (ms: number | null) => (ms === null ? null : speedIn(ms, units.speed));
  const sector = (i: number): Row => ({
    label: `Sector ${i + 1}`,
    hint: 'Typical',
    cell: (s, base) => timeCell(formatSectorTime, s.typicalSectors[i], base?.typicalSectors[i]),
  });

  const rows: Row[] = [
    {
      label: 'Laps',
      hint: "Pace laps are the clean laps within 5% of the stint's best",
      cell: (s) => (
        <>
          <span className="tabular">{s.laps.length}</span>
          <span className="stint-change muted">
            {s.cleanLaps} clean, {s.paceLaps} at pace
          </span>
        </>
      ),
    },
    { label: 'Best lap', cell: (s, base) => timeCell(formatLapTime, s.bestLap?.time ?? null, base?.bestLap?.time) },
    {
      label: 'Typical lap',
      hint: 'The middle of the pace laps, so a warm-up lap or one mistake leaves it alone',
      cell: (s, base) => timeCell(formatLapTime, s.typicalLap, base?.typicalLap),
    },
    {
      label: 'Spread',
      hint: 'Lap to lap, over the pace laps',
      cell: (s) => (s.spread === null ? '–' : <span className="tabular">±{s.spread.toFixed(2)} s</span>),
    },
    {
      label: 'Ideal lap',
      hint: "The stint's best run through every corner, combined",
      cell: (s, base) => (details ? timeCell(formatLapTime, idealOf(s), idealOf(base)) : <span className="muted">…</span>),
    },
    sector(0),
    sector(1),
    sector(2),
    {
      label: 'Top speed',
      hint: 'Typical',
      cell: (s, base) => figureCell(speed(s.topSpeed), speed(base?.topSpeed ?? null), 0, speedLabel(units.speed)),
    },
    { label: 'Fuel per lap', cell: (s, base) => figureCell(s.fuelPerLap, base?.fuelPerLap, 2, 'L') },
    {
      label: `Tyre temperature (${temperatureLabel(units.temperature)})`,
      hint: 'Fronts over rears',
      cell: (s) => (
        <Wheels values={s.tyreTemp} what="Tyre temperature" format={(v) => String(Math.round(temperatureIn(v, units.temperature)))} />
      ),
    },
    {
      label: `Tyre pressure (${pressureLabel(units.pressure)})`,
      hint: 'Fronts over rears',
      cell: (s) => (
        <Wheels
          values={s.tyrePressure}
          what="Tyre pressure"
          format={(v) => pressureIn(v, units.pressure).toFixed(units.pressure === 'kpa' ? 0 : units.pressure === 'bar' ? 2 : 1)}
        />
      ),
    },
    {
      label: 'Car setup',
      cell: (s, base) => (
        <a
          href={href({
            name: 'setup',
            session: session.id,
            lap: null,
            compare: base ? session.id : null,
            stint: s.id,
            compareStint: base?.id ?? null,
          })}
        >
          Balance and grip<span className="visually-hidden"> for {stintName(s).toLowerCase()}</span>
        </a>
      ),
    },
  ];

  return (
    <Card
      title="Stints"
      description="Runs between visits to the pits or garage. Change the setup in between, and the difference shows here."
      actions={
        <div className="field stint-against">
          <label htmlFor={pickerId}>Show changes against</label>
          <select id={pickerId} value={String(against)} onChange={(e) => setAgainst(e.target.value === 'previous' ? 'previous' : Number(e.target.value))}>
            <option value="previous">The stint before</option>
            {stints.map((s) => (
              <option key={s.id} value={s.id}>
                {stintName(s)}
              </option>
            ))}
          </select>
        </div>
      }
    >
      <div className="table-wrap">
        <table className="data stint-table">
          <thead>
            <tr>
              <td />
              {stints.map((s) => (
                <th key={s.id} scope="col">
                  {stintName(s)}
                  <span className="stint-laps">{lapRange(s)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">
                What changed
                <span className="stint-hint">Your note, saved with the session</span>
              </th>
              {stints.map((s) => (
                <td key={s.id}>
                  <NoteInput key={`${s.first}:${stintNote(session, s)}`} session={session} stint={s} onSaved={onNoteSaved} />
                </td>
              ))}
            </tr>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">
                  {row.label}
                  {row.hint && <span className="stint-hint">{row.hint}</span>}
                </th>
                {stints.map((s) => (
                  <td key={s.id}>{row.cell(s, baseOf(s))}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Metres between two braking points, in words. */
function brakingDifference(a: number | null, b: number | null): string {
  if (a === null || b === null) return '–';
  const later = Math.round(a - b);
  return later === 0 ? 'Same place' : `${Math.abs(later)} m ${later > 0 ? 'later' : 'earlier'}`;
}

export function StintCornersCard({
  session,
  data,
  units,
  mirror,
}: {
  session: SessionMeta;
  data: StintsDto;
  units: Units;
  mirror: boolean;
}) {
  // Only stints with a pace lap have corners to show.
  const measured = data.stints.filter((s) => s.paceLaps > 0);
  const [chosen, setChosen] = useState<number | null>(null);
  const [chosenBase, setChosenBase] = useState<number | null>(null);
  const stintId = useId();
  const baseId = useId();
  const stint = measured.find((s) => s.id === chosen) ?? measured[measured.length - 1] ?? null;
  const others = measured.filter((s) => s !== stint);
  const base = others.find((s) => s.id === chosenBase) ?? others.findLast((s) => stint !== null && s.id < stint.id) ?? others[0] ?? null;
  // The corners were found on the session's best lap, so the map is drawn from it.
  const bestLap = data.stints.reduce<{ lap: number; time: number } | null>(
    (best, s) => (s.bestLap && (!best || s.bestLap.time < best.time) ? s.bestLap : best),
    null,
  );
  const path = useApi<AnalysedLapDto>(bestLap ? api.lap(session.id, bestLap.lap) : null);

  if (!stint || !base) return null;

  const rows = data.corners.map((corner, i) => {
    const a = stint.corners[i];
    const b = base.corners[i];
    const both = a?.typicalTime != null && b?.typicalTime != null;
    return { corner, a, b, timeDelta: both ? a.typicalTime! - b.typicalTime! : null };
  });
  const total = (s: StintDto) => s.corners.reduce((sum, c) => sum + (c.typicalTime ?? 0), 0);
  const segments: MapSegment[] = rows
    .filter((r): r is typeof r & { timeDelta: number } => r.timeDelta !== null)
    .map((r) => ({ corner: r.corner, timeDelta: r.timeDelta }));
  const speed = (ms: number | null | undefined) => (ms === null || ms === undefined ? '–' : String(Math.round(speedIn(ms, units.speed))));
  const name = stintName(stint);
  const baseName = stintName(base);
  const option = (s: StintDto) => (
    <option key={s.id} value={s.id}>
      {stintTitle(session, s)}
    </option>
  );

  return (
    <Card
      title="Corner by corner between stints"
      description={`Typical time through each corner over the laps each stint's pace is taken from: ${name.toLowerCase()} against ${baseName.toLowerCase()}.`}
    >
      <div className="compare-pickers" role="group" aria-label="Stints to compare">
        <div className="field">
          <label htmlFor={stintId}>Stint</label>
          <select id={stintId} value={stint.id} onChange={(e) => setChosen(Number(e.target.value))}>
            {measured.map(option)}
          </select>
        </div>
        <div className="field">
          <label htmlFor={baseId}>Against</label>
          <select id={baseId} value={base.id} onChange={(e) => setChosenBase(Number(e.target.value))}>
            {others.map(option)}
          </select>
        </div>
      </div>

      <div className="stint-compare">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Corner</th>
                {[stint, base].map((s) => (
                  <th key={s.id} scope="col" className="num">
                    {stintName(s)}
                    <span className="stint-laps">
                      {s.paceLaps} pace {s.paceLaps === 1 ? 'lap' : 'laps'}
                    </span>
                  </th>
                ))}
                <th scope="col" className="num">
                  Difference
                </th>
                <th scope="col" className="num">
                  Slowest point ({speedLabel(units.speed)})
                </th>
                <th scope="col" className="num">
                  Braking
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ corner, a, b, timeDelta }) => (
                <tr key={corner.id}>
                  <th scope="row" className="corner-row-name">
                    {corner.name}
                  </th>
                  <td className="num">{a?.typicalTime != null ? `${a.typicalTime.toFixed(3)} s` : '–'}</td>
                  <td className="num">{b?.typicalTime != null ? `${b.typicalTime.toFixed(3)} s` : '–'}</td>
                  <td className="num">
                    <DeltaValue seconds={timeDelta} />
                  </td>
                  <td className="num">
                    {speed(a?.minSpeed)} <span className="muted">/ {speed(b?.minSpeed)}</span>
                  </td>
                  <td className="num">{brakingDifference(a?.brakePoint ?? null, b?.brakePoint ?? null)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">All corners</th>
                <td className="num">{formatLapTime(total(stint))}</td>
                <td className="num">{formatLapTime(total(base))}</td>
                <td className="num">
                  <DeltaValue seconds={total(stint) - total(base)} />
                </td>
                <td colSpan={2} className="muted">
                  {name} first, {baseName.toLowerCase()} after the slash
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {path.data && (
          <div>
            <TrackMap
              x={path.data.resampled.x}
              z={path.data.resampled.z}
              step={path.data.resampled.step}
              corners={data.corners}
              segments={segments}
              mirror={mirror}
              title={`Track map. Against ${baseName.toLowerCase()}, ${name.toLowerCase()} was slower through ${segments.filter((s) => s.timeDelta >= 0.02).length} corners and faster through ${segments.filter((s) => s.timeDelta <= -0.02).length}.`}
            />
            <p className="map-legend">
              <span className="legend-item">
                <span className="key key-slower" aria-hidden="true" />
                Slower than {baseName.toLowerCase()} (+)
              </span>
              <span className="legend-item">
                <span className="key key-faster" aria-hidden="true" />
                Faster ({'−'})
              </span>
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
