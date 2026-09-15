/**
 * The Live page's cards: pick a preset, or arrange one. The grid is three cells
 * wide and two high, so a whole preset fits on one screen. Glance cards take one
 * cell; full cards take two side by side.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { CARD_BY_ID, CARDS, KIND_BADGES, type CardId } from '../cards/registry.ts';
import {
  activePreset,
  addPreset,
  deletePreset,
  duplicatePreset,
  fits,
  fullAnchor,
  GRID_COLUMNS,
  GRID_ROWS,
  placeCard,
  placementAt,
  removeCard,
  renamePreset,
  resizeCard,
  selectPreset,
  usePresets,
  type Placement,
  type Preset,
  type PresetState,
  type SlotSize,
} from '../lib/presets.ts';

interface Slot {
  row: number;
  col: number;
  replacing: Placement | null;
}

export function PresetBoard() {
  const state = usePresets();
  const preset = activePreset(state);
  const [editing, setEditing] = useState(false);
  const [slot, setSlot] = useState<Slot | null>(null);

  // Number keys switch presets, like changing pages on a wheel.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement;
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable) return;
      if (document.querySelector('dialog[open]')) return;
      const index = Number(event.key) - 1;
      if (Number.isInteger(index) && index >= 0 && index < Math.min(9, state.presets.length)) {
        selectPreset(state.presets[index].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.presets]);

  return (
    <section className="preset-board" aria-label="Live cards">
      <PresetBar state={state} preset={preset} editing={editing} onEditing={setEditing} />
      <PresetGrid preset={preset} editing={editing} onPick={setSlot} />
      {slot && <CardPicker preset={preset} slot={slot} onClose={() => setSlot(null)} />}
    </section>
  );
}

function PresetBar({
  state,
  preset,
  editing,
  onEditing,
}: {
  state: PresetState;
  preset: Preset;
  editing: boolean;
  onEditing: (editing: boolean) => void;
}) {
  const nameId = useId();
  const remove = () => {
    if (window.confirm(`Delete the ${preset.name || 'untitled'} preset?`)) deletePreset(preset.id);
  };

  return (
    <div className="preset-bar">
      <div className="preset-tabs" role="group" aria-label="Presets">
        {state.presets.map((p, i) => (
          <button key={p.id} type="button" className="btn" aria-pressed={p.id === preset.id} onClick={() => selectPreset(p.id)}>
            {p.name.trim() || 'Untitled'}
            {i < 9 && (
              <kbd aria-hidden="true" title={`Press ${i + 1}`}>
                {i + 1}
              </kbd>
            )}
          </button>
        ))}
      </div>
      <div className="preset-actions">
        {editing && (
          <>
            <label className="preset-name-label" htmlFor={nameId}>
              Name
            </label>
            <input
              id={nameId}
              className="preset-name"
              value={preset.name}
              maxLength={40}
              onChange={(e) => renamePreset(preset.id, e.target.value)}
            />
            <button type="button" className="btn" onClick={() => duplicatePreset(preset.id)}>
              Duplicate
            </button>
            <button type="button" className="btn" onClick={remove} disabled={state.presets.length <= 1}>
              Delete
            </button>
          </>
        )}
        <button
          type="button"
          className="btn"
          onClick={() => {
            addPreset();
            onEditing(true);
          }}
        >
          New preset
        </button>
        <button type="button" className="btn" aria-pressed={editing} onClick={() => onEditing(!editing)}>
          {editing ? 'Done' : 'Edit layout'}
        </button>
      </div>
    </div>
  );
}

/** Stretch the grid to the bottom of the window on wide screens, so the preset fills one screen. */
function useFillHeight(ref: RefObject<HTMLElement | null>, deps: unknown[]): number | undefined {
  const [height, setHeight] = useState<number>();
  useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      if (window.innerWidth < 900) {
        setHeight(undefined);
        return;
      }
      const top = el.getBoundingClientRect().top + window.scrollY;
      setHeight(Math.max(420, Math.floor(window.innerHeight - top - 16)));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, deps);
  return height;
}

function PresetGrid({ preset, editing, onPick }: { preset: Preset; editing: boolean; onPick: (slot: Slot) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const height = useFillHeight(ref, [editing]);
  const items = [];

  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLUMNS; col++) {
      const placement = placementAt(preset, row, col);
      const area = { gridRow: row + 1, gridColumn: `${col + 1} / span ${placement?.size === 'full' ? 2 : 1}` };
      if (placement) {
        if (placement.row !== row || placement.col !== col) continue;
        const card = CARD_BY_ID.get(placement.card)!;
        items.push(
          <div key={`${row}-${col}`} className={`preset-slot is-${placement.size}`} style={area}>
            <card.Component size={placement.size} />
            {editing && (
              <SlotTools
                preset={preset}
                placement={placement}
                name={card.name}
                onChange={() => onPick({ row, col, replacing: placement })}
              />
            )}
          </div>,
        );
      } else if (editing) {
        items.push(
          <button
            key={`${row}-${col}`}
            type="button"
            className="slot-empty"
            style={area}
            onClick={() => onPick({ row, col, replacing: null })}
          >
            <span aria-hidden="true">+</span> Add a card
            <span className="visually-hidden">
              {' '}
              in row {row + 1}, column {col + 1}
            </span>
          </button>,
        );
      }
    }
  }

  return (
    <div ref={ref} className={`preset-grid${editing ? ' is-editing' : ''}`} style={{ height }}>
      {items}
      {!editing && preset.placements.length === 0 && (
        <p className="preset-empty">
          This preset is empty. Choose <strong>Edit layout</strong> to add cards.
        </p>
      )}
    </div>
  );
}

function SlotTools({
  preset,
  placement,
  name,
  onChange,
}: {
  preset: Preset;
  placement: Placement;
  name: string;
  onChange: () => void;
}) {
  const canFull = placement.size === 'full' || fullAnchor(preset, placement.row, placement.col, placement) !== null;
  const setSize = (size: SlotSize) => {
    if (size !== placement.size) resizeCard(preset.id, placement, size);
  };

  return (
    <div className="slot-tools">
      <span className="slot-tools-name">{name}</span>
      <div className="segmented" role="group" aria-label={`${name} size`}>
        <button type="button" aria-pressed={placement.size === 'glance'} onClick={() => setSize('glance')}>
          Glance
        </button>
        <button type="button" aria-pressed={placement.size === 'full'} disabled={!canFull} onClick={() => setSize('full')}>
          Full
          {!canFull && <span className="visually-hidden"> (needs the cell beside it free)</span>}
        </button>
      </div>
      <button type="button" className="btn btn-small" onClick={onChange}>
        Change<span className="visually-hidden"> {name}</span>
      </button>
      <button type="button" className="btn btn-small" onClick={() => removeCard(preset.id, placement)}>
        Remove<span className="visually-hidden"> {name}</span>
      </button>
    </div>
  );
}

function CardPicker({ preset, slot, onClose }: { preset: Preset; slot: Slot; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const ignore = slot.replacing ?? undefined;
  const glanceFits = fits(preset, { size: 'glance', row: slot.row, col: slot.col }, ignore);
  const fullCol = fullAnchor(preset, slot.row, slot.col, ignore);

  // Removing the dialog from the page ends the modal, so there's no close() on cleanup: closing
  // fires a close event, which would clear the picker straight after it opens.
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const choose = (card: CardId, size: SlotSize) => {
    const col = size === 'full' ? fullCol : slot.col;
    if (col === null) return;
    placeCard(preset.id, { card, size, row: slot.row, col }, ignore);
    onClose();
  };

  return (
    <dialog ref={ref} className="card-picker" aria-labelledby={titleId} onClose={onClose}>
      <div className="card-picker-head">
        <h2 id={titleId}>{slot.replacing ? 'Change card' : 'Add a card'}</h2>
        <button type="button" className="btn btn-small" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="muted">
        Row {slot.row + 1}, column {slot.col + 1}. Glance cards take this cell; full cards take this cell and the one
        beside it.
        {fullCol === null && ' There isn’t room for a full card here.'}
      </p>
      <ul className="card-picker-list">
        {CARDS.map((card) => {
          const current = slot.replacing?.card === card.id;
          return (
            <li key={card.id} className={current ? 'is-current' : undefined}>
              <div className="card-picker-text">
                <strong>{card.name}</strong> <span className={`badge ${KIND_BADGES[card.kind].className}`}>{KIND_BADGES[card.kind].label}</span>
                {current && <span className="badge">Here now</span>}
                <p className="secondary">{card.what}</p>
              </div>
              <div className="card-picker-sizes">
                <button type="button" className="btn" disabled={!glanceFits} onClick={() => choose(card.id, 'glance')}>
                  Glance<span className="visually-hidden"> {card.name}</span>
                </button>
                <button type="button" className="btn" disabled={fullCol === null} onClick={() => choose(card.id, 'full')}>
                  Full<span className="visually-hidden"> {card.name}</span>
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </dialog>
  );
}
