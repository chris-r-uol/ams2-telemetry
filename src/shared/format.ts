import type { CoachTip } from './analysis/coach.ts';
import type { SessionState } from './protocol/constants.ts';

export type SpeedUnit = 'kmh' | 'mph';
export type TemperatureUnit = 'c' | 'f';
export type PressureUnit = 'psi' | 'kpa' | 'bar';

export interface Units {
  speed: SpeedUnit;
  temperature: TemperatureUnit;
  pressure: PressureUnit;
}

export const DEFAULT_UNITS: Units = { speed: 'kmh', temperature: 'c', pressure: 'psi' };

export const speedIn = (ms: number, unit: SpeedUnit) => (unit === 'mph' ? ms * 2.2369363 : ms * 3.6);
export const speedLabel = (unit: SpeedUnit) => (unit === 'mph' ? 'mph' : 'km/h');
export const temperatureIn = (c: number, unit: TemperatureUnit) => (unit === 'f' ? c * 1.8 + 32 : c);
export const temperatureLabel = (unit: TemperatureUnit) => (unit === 'f' ? '°F' : '°C');
export const pressureIn = (kpa: number, unit: PressureUnit) =>
  unit === 'psi' ? kpa * 0.1450377 : unit === 'bar' ? kpa / 100 : kpa;
export const pressureLabel = (unit: PressureUnit) => (unit === 'psi' ? 'psi' : unit === 'bar' ? 'bar' : 'kPa');

export function formatSpeed(ms: number, unit: SpeedUnit): string {
  return `${Math.round(speedIn(ms, unit))} ${speedLabel(unit)}`;
}

const MINUS = '−';

/** 1:42.315 */
export function formatLapTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return '-:--.---';
  const totalMs = Math.round(seconds * 1000);
  const minutes = Math.floor(totalMs / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${minutes}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

/** 32.451, or 1:02.345 when over a minute. */
export function formatSectorTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return '--.---';
  return seconds >= 60 ? formatLapTime(seconds) : seconds.toFixed(3);
}

/** +0.234 / −0.180, using a true minus sign so the width doesn't jump. */
export function formatDelta(seconds: number | null | undefined, digits = 3): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  const rounded = Number(seconds.toFixed(digits));
  const sign = rounded > 0 ? '+' : rounded < 0 ? MINUS : '±';
  return `${sign}${Math.abs(rounded).toFixed(digits)}`;
}

/** Words for screen readers and for anyone who doesn't want to decode a sign. */
export function describeDelta(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return 'no reference yet';
  if (Math.abs(seconds) < 0.0005) return 'level with reference';
  return `${Math.abs(seconds).toFixed(2)} seconds ${seconds > 0 ? 'slower' : 'faster'}`;
}

export const SESSION_LABELS: Record<SessionState, string> = {
  invalid: 'No session',
  practice: 'Practice',
  test: 'Test',
  qualify: 'Qualifying',
  formationLap: 'Formation lap',
  race: 'Race',
  timeAttack: 'Time trial',
};

export interface TipText {
  title: string;
  detail: string;
}

/** Human wording for a coaching tip. */
export function describeTip(tip: CoachTip, units: Units): TipText {
  const c = tip.corner;
  const metres = `${Math.round(tip.amount)} m`;
  const speed = `${Math.max(1, Math.round(speedIn(tip.amount, units.speed)))} ${speedLabel(units.speed)}`;
  const ref = tip.referenceLap ? `lap ${tip.referenceLap}` : 'your reference';
  switch (tip.kind) {
    case 'brake-later':
      return {
        title: `Brake later into ${c}`,
        detail: `You started braking ${metres} earlier than ${ref} without carrying any extra speed through the corner.`,
      };
    case 'brake-earlier':
      return {
        title: `Brake a touch earlier into ${c}`,
        detail: `You braked ${metres} later than ${ref}, but the car was slower at the apex. Braking a little earlier protects the exit.`,
      };
    case 'carry-speed':
      return {
        title: `Carry more speed through ${c}`,
        detail: `Minimum speed was ${speed} lower than ${ref}. Release the brake sooner and let the car roll into the apex.`,
      };
    case 'over-driving':
      return {
        title: `Don't over-drive ${c}`,
        detail: `You were quicker at the apex, but ${speed} slower on the exit. Slow in, fast out.`,
      };
    case 'throttle-earlier':
      return {
        title: `Get back on the throttle sooner out of ${c}`,
        detail: `Throttle pickup came ${metres} later than ${ref}.`,
      };
    case 'exit-speed':
      return {
        title: `Improve your exit from ${c}`,
        detail: `Exit speed was ${speed} lower than ${ref}. Open the steering before going to full throttle.`,
      };
    case 'coasting':
      return {
        title: `Stop coasting in ${c}`,
        detail: `${metres} with neither pedal applied. Blend the brake release straight into throttle.`,
      };
    case 'track-limits':
      return {
        title: `Stay on the track at ${c}`,
        detail: `Two or more wheels left the racing surface here.`,
      };
    case 'general':
      return {
        title: `Find time in ${c}`,
        detail: `No single cause stood out. Compare the speed and pedal traces for this corner.`,
      };
  }
}
