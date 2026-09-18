/**
 * Whether each tyre is cold or hot. Working temperatures differ by car, compound
 * and which layer of the tyre the game reports, so by default a tyre is compared
 * with where it usually runs this session: its median average over flying laps.
 * A tyre well below that is still warming up (an out lap, after a spin or a safety
 * car); well above it is overheating. A fixed range can be set instead.
 */
import type { LapSummary, LiveFrame, SessionMeta } from '../../shared/model/types.ts';
import type { Settings } from './settings.ts';

/** How far from its usual temperature a tyre has to be before it's flagged, °C. */
export const TYRE_MARGIN = 15;
/** Flying laps needed before the usual temperatures count. */
const MIN_LAPS = 2;

export type TyreState = 'cold' | 'hot' | 'ok' | null;

export interface TyreReading {
  temp: number;
  state: TyreState;
  /** The window the tyre was judged against, °C, or null while it's still being learned. */
  window: [number, number] | null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  return Number.isInteger(mid) ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[Math.floor(mid)];
}

/** Each tyre's usual running temperature this session, °C, or null until there are enough flying laps. */
export function usualTyreTemps(laps: readonly LapSummary[]): [number | null, number | null, number | null, number | null] {
  const flying = laps.filter((l) => l.kind === 'flying' && l.tyreTempAvg.every((t) => t > 0));
  return [0, 1, 2, 3].map((w) => (flying.length >= MIN_LAPS ? median(flying.map((l) => l.tyreTempAvg[w])) : null)) as [
    number | null,
    number | null,
    number | null,
    number | null,
  ];
}

export function tyreReadings(frame: LiveFrame, session: SessionMeta | null, settings: Settings): TyreReading[] {
  const usual = settings.tyreWindowMode === 'fixed' ? null : usualTyreTemps(session?.laps ?? []);
  return frame.tyres.tempC.map((temp, w) => {
    const middle = usual?.[w] ?? null;
    const window: [number, number] | null = usual
      ? middle === null
        ? null
        : [middle - TYRE_MARGIN, middle + TYRE_MARGIN]
      : settings.tyreWindow;
    if (temp <= 0 || window === null) return { temp, state: temp <= 0 ? null : 'ok', window };
    return { temp, state: temp < window[0] ? 'cold' : temp > window[1] ? 'hot' : 'ok', window };
  });
}
