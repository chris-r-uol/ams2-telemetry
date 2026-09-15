/**
 * Live page presets: named layouts of cards on a grid three cells wide and two
 * high, arranged in the app. Saved in this browser and kept in step across open
 * tabs, like settings.
 */
import { useSyncExternalStore } from 'react';
import { CARD_BY_ID, type CardId } from '../cards/registry.ts';

export const GRID_COLUMNS = 3;
export const GRID_ROWS = 2;

/** Glance cards take one cell; full cards take two side by side. */
export type SlotSize = 'glance' | 'full';

export interface Placement {
  card: CardId;
  size: SlotSize;
  /** Top-left cell, counted from 0. */
  row: number;
  col: number;
}

export interface Preset {
  id: string;
  name: string;
  placements: Placement[];
}

export interface PresetState {
  presets: Preset[];
  activeId: string;
}

type Position = Pick<Placement, 'size' | 'row' | 'col'>;

const KEY = 'ams2-coach:presets';

const glance = (card: CardId, row: number, col: number): Placement => ({ card, size: 'glance', row, col });
const full = (card: CardId, row: number, col: number): Placement => ({ card, size: 'full', row, col });

/** A starting point for the three ways of driving: change them freely. */
export const DEFAULT_PRESETS: Preset[] = [
  {
    id: 'focus',
    name: 'Focus',
    placements: [
      glance('delta', 0, 0),
      glance('next-corner', 0, 1),
      glance('last-corner', 0, 2),
      glance('focus', 1, 0),
      glance('car', 1, 2),
    ],
  },
  {
    id: 'optimisation',
    name: 'Optimisation',
    placements: [full('last-corner', 0, 0), glance('delta', 0, 2), full('corner-strip', 1, 0), glance('balance', 1, 2)],
  },
  {
    id: 'full',
    name: 'Full',
    placements: [
      full('last-corner', 0, 0),
      glance('next-corner', 0, 2),
      glance('grip', 1, 0),
      glance('lap-trend', 1, 1),
      glance('car', 1, 2),
    ],
  },
];

/** The grid cells a card covers. */
export function cellsOf(position: Position): [number, number][] {
  return position.size === 'full'
    ? [
        [position.row, position.col],
        [position.row, position.col + 1],
      ]
    : [[position.row, position.col]];
}

const sameAnchor = (a: Position, b: Position | undefined) => b !== undefined && a.row === b.row && a.col === b.col;

export function placementAt(preset: Preset, row: number, col: number): Placement | null {
  return preset.placements.find((p) => cellsOf(p).some(([r, c]) => r === row && c === col)) ?? null;
}

/** Whether a card of this size fits here, ignoring the card being changed. */
export function fits(preset: Preset, position: Position, ignore?: Position): boolean {
  return cellsOf(position).every(
    ([r, c]) =>
      r >= 0 &&
      r < GRID_ROWS &&
      c >= 0 &&
      c < GRID_COLUMNS &&
      preset.placements.every((p) => sameAnchor(p, ignore) || !cellsOf(p).some(([pr, pc]) => pr === r && pc === c)),
  );
}

/** Where a full card clicked into this cell would start: here, or one cell to the left. Null if there's no room. */
export function fullAnchor(preset: Preset, row: number, col: number, ignore?: Position): number | null {
  for (const start of [col, col - 1]) if (fits(preset, { size: 'full', row, col: start }, ignore)) return start;
  return null;
}

function defaultState(): PresetState {
  return { presets: structuredClone(DEFAULT_PRESETS), activeId: DEFAULT_PRESETS[0].id };
}

/** Accept only presets this version understands, so a bad save can't break the Live page. */
function sanitise(raw: unknown): PresetState {
  const input = (raw ?? {}) as { presets?: unknown; activeId?: unknown };
  const presets: Preset[] = [];
  for (const item of Array.isArray(input.presets) ? input.presets : []) {
    const candidate = (item ?? {}) as { id?: unknown; name?: unknown; placements?: unknown };
    if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string') continue;
    if (presets.some((p) => p.id === candidate.id)) continue;
    const preset: Preset = { id: candidate.id, name: candidate.name.slice(0, 40), placements: [] };
    for (const entry of Array.isArray(candidate.placements) ? candidate.placements : []) {
      const p = (entry ?? {}) as Record<string, unknown>;
      if (typeof p.card !== 'string' || !CARD_BY_ID.has(p.card as CardId)) continue;
      if ((p.size !== 'glance' && p.size !== 'full') || !Number.isInteger(p.row) || !Number.isInteger(p.col)) continue;
      const placement: Placement = { card: p.card as CardId, size: p.size, row: p.row as number, col: p.col as number };
      if (fits(preset, placement)) preset.placements.push(placement);
    }
    presets.push(preset);
  }
  if (presets.length === 0) return defaultState();
  const activeId = presets.some((p) => p.id === input.activeId) ? (input.activeId as string) : presets[0].id;
  return { presets, activeId };
}

function load(): PresetState {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? sanitise(JSON.parse(raw)) : defaultState();
  } catch {
    return defaultState();
  }
}

let current = load();
const listeners = new Set<() => void>();

function commit(next: PresetState): void {
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // storage unavailable (private window); the layout still works for this visit
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Keep several open dashboards (e.g. two monitors) in step.
window.addEventListener('storage', (event) => {
  if (event.key !== KEY) return;
  current = load();
  for (const listener of listeners) listener();
});

export function usePresets(): PresetState {
  return useSyncExternalStore(subscribe, () => current);
}

export function activePreset(state: PresetState): Preset {
  return state.presets.find((p) => p.id === state.activeId) ?? state.presets[0];
}

export function selectPreset(id: string): void {
  if (current.presets.some((p) => p.id === id) && current.activeId !== id) commit({ ...current, activeId: id });
}

function updatePreset(id: string, change: (preset: Preset) => Preset): void {
  commit({ ...current, presets: current.presets.map((p) => (p.id === id ? change(p) : p)) });
}

const newId = () => `preset-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** Add an empty preset and switch to it. */
export function addPreset(): string {
  const id = newId();
  const name = `Preset ${current.presets.length + 1}`;
  commit({ presets: [...current.presets, { id, name, placements: [] }], activeId: id });
  return id;
}

export function duplicatePreset(id: string): void {
  const source = current.presets.find((p) => p.id === id);
  if (!source) return;
  const copy: Preset = { id: newId(), name: `${source.name} copy`.slice(0, 40), placements: structuredClone(source.placements) };
  commit({ presets: [...current.presets, copy], activeId: copy.id });
}

export function renamePreset(id: string, name: string): void {
  updatePreset(id, (preset) => ({ ...preset, name: name.slice(0, 40) }));
}

export function deletePreset(id: string): void {
  if (current.presets.length <= 1) return;
  const index = current.presets.findIndex((p) => p.id === id);
  const presets = current.presets.filter((p) => p.id !== id);
  const activeId = current.activeId === id ? presets[Math.max(0, index - 1)].id : current.activeId;
  commit({ presets, activeId });
}

/** Put a card in the grid, optionally in place of another. Does nothing if it doesn't fit. */
export function placeCard(presetId: string, placement: Placement, replacing?: Position): void {
  updatePreset(presetId, (preset) => {
    const rest = preset.placements.filter((p) => !sameAnchor(p, replacing));
    if (!fits({ ...preset, placements: rest }, placement)) return preset;
    return { ...preset, placements: [...rest, placement] };
  });
}

export function removeCard(presetId: string, placement: Position): void {
  updatePreset(presetId, (preset) => ({ ...preset, placements: preset.placements.filter((p) => !sameAnchor(p, placement)) }));
}

/** Switch a card between glance and full. A full card moves one cell left if that's the only room. */
export function resizeCard(presetId: string, placement: Placement, size: SlotSize): void {
  updatePreset(presetId, (preset) => {
    const rest = preset.placements.filter((p) => !sameAnchor(p, placement));
    const col = size === 'full' ? fullAnchor({ ...preset, placements: rest }, placement.row, placement.col) : placement.col;
    if (col === null) return preset;
    return { ...preset, placements: [...rest, { ...placement, size, col }] };
  });
}
