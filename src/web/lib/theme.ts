import { useSyncExternalStore } from 'react';
import { useSettings } from './settings.ts';

export interface ChartColors {
  lap: string;
  reference: string;
  throttle: string;
  brake: string;
  grid: string;
  axis: string;
  ink: string;
  ink2: string;
  muted: string;
  surface: string;
  good: string;
  bad: string;
  goodWash: string;
  badWash: string;
  font: string;
}

/** Canvas charts can't use CSS variables directly, so read the resolved tokens. */
export function readChartColors(): ChartColors {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string) => style.getPropertyValue(name).trim();
  return {
    lap: v('--lap'),
    reference: v('--reference'),
    throttle: v('--throttle'),
    brake: v('--brake'),
    grid: v('--grid'),
    axis: v('--axis'),
    ink: v('--ink'),
    ink2: v('--ink-2'),
    muted: v('--ink-muted'),
    surface: v('--surface'),
    good: v('--good'),
    bad: v('--bad'),
    goodWash: v('--good-wash'),
    badWash: v('--bad-wash'),
    font: v('--font-sans'),
  };
}

const queries = ['(prefers-color-scheme: dark)', '(prefers-contrast: more)'].map((q) => window.matchMedia(q));

function subscribe(listener: () => void): () => void {
  for (const q of queries) q.addEventListener('change', listener);
  return () => {
    for (const q of queries) q.removeEventListener('change', listener);
  };
}

/** Changes whenever the resolved colours could have changed, so charts can rebuild. */
export function useThemeKey(): string {
  const { theme, textScale } = useSettings();
  const media = useSyncExternalStore(subscribe, () => queries.map((q) => (q.matches ? 1 : 0)).join(''));
  return `${theme}:${media}:${textScale}`;
}
