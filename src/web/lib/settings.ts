import { useSyncExternalStore } from 'react';
import { DEFAULT_UNITS, type Units } from '../../shared/format.ts';

export type ThemeSetting = 'dark' | 'light' | 'system';

export interface Settings {
  theme: ThemeSetting;
  /** Multiplier on all text and UI size, for reading from across the desk. */
  textScale: number;
  units: Units;
  /** Flip the track map left-right if it appears mirrored for your game install. */
  mirrorMap: boolean;
  /** Announce completed laps to screen readers. */
  announceLaps: boolean;
  /** Tyre temperature window, °C. Outside it the tyre gets flagged. */
  tyreWindow: [number, number];
}

const KEY = 'ams2-coach:settings';

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  textScale: 1,
  units: DEFAULT_UNITS,
  mirrorMap: false,
  announceLaps: true,
  tyreWindow: [80, 100],
};

function load(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...raw, units: { ...DEFAULT_SETTINGS.units, ...(raw.units ?? {}) } };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

let current = load();
const listeners = new Set<() => void>();

export function applyDocumentSettings(settings: Settings = current): void {
  const root = document.documentElement;
  if (settings.theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = settings.theme;
  root.style.setProperty('--text-scale', String(settings.textScale));
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // storage unavailable (private window); settings still apply for this visit
  }
  applyDocumentSettings(current);
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
  applyDocumentSettings(current);
  for (const listener of listeners) listener();
});

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, () => current);
}
