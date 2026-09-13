import type { FlagColour, GameState, PitMode, SessionState } from '../protocol/constants.ts';
import type { CoachTip } from '../analysis/coach.ts';

export type Quad = [number, number, number, number];
export type SourceKind = 'udp' | 'demo' | 'replay';

/**
 * Columnar per-lap telemetry, one entry per telemetry tick.
 * Columnar arrays keep stored laps small and are what uPlot wants anyway.
 */
export const TRACE_CHANNELS = [
  't', // lap time, s
  'd', // lap distance, m
  'speed', // m/s
  'throttle', // 0..1
  'brake', // 0..1
  'steering', // -1 (left) .. 1 (right)
  'gear', // -1 reverse, 0 neutral
  'rpm',
  'x', // world metres
  'z', // world metres
  'latG', // lateral acceleration, g
  'lonG', // longitudinal acceleration, g (+ accelerating)
  'off', // number of wheels on an off-track surface
  // Chassis channels (see analysis/chassis.ts). Laps saved before these existed won't have them.
  'steerIn', // driver's unfiltered steering input, -1..1
  'yawRate', // rad/s
  'vLat', // local x velocity, m/s
  'vLon', // local z velocity, m/s
  'vertG', // local vertical acceleration, g
  'pitch', // rad
  'roll', // rad
  'travelFL', // suspension travel, m, as sent
  'travelFR',
  'travelRL',
  'travelRR',
  'damperFL', // suspension velocity, m/s, as sent
  'damperFR',
  'damperRL',
  'damperRR',
  'rideFL', // ride height, as sent (AMS2 documents cm)
  'rideFR',
  'rideRL',
  'rideRR',
  'wheelFL', // wheel rotation, rev/s
  'wheelFR',
  'wheelRL',
  'wheelRR',
  'grounded', // bit per wheel (FL=1, FR=2, RL=4, RR=8) when touching the ground
] as const;

export type TraceChannel = (typeof TRACE_CHANNELS)[number];
export type LapTrace = Record<TraceChannel, number[]>;

export function emptyTrace(): LapTrace {
  return Object.fromEntries(TRACE_CHANNELS.map((c) => [c, [] as number[]])) as unknown as LapTrace;
}

export type LapKind = 'flying' | 'out' | 'in' | 'partial';

export interface LapSummary {
  /** Game lap number, 1-based. */
  lap: number;
  /** Official lap time from the game, seconds. */
  lapTime: number | null;
  sectors: [number | null, number | null, number | null];
  valid: boolean;
  kind: LapKind;
  startedAt: number;
  topSpeed: number;
  fuelUsed: number | null;
  tyreTempAvg: Quad;
  tyrePressureAvg: Quad;
  tyreWear: Quad;
  offTrackCount: number;
  sampleCount: number;
}

export interface TrackInfo {
  location: string;
  variation: string;
  length: number;
}

export interface SessionMeta {
  id: string;
  startedAt: number;
  updatedAt: number;
  source: SourceKind;
  track: TrackInfo;
  car: string;
  carClass: string;
  driver: string;
  sessionType: SessionState;
  laps: LapSummary[];
}

export interface StoredLap {
  sessionId: string;
  summary: LapSummary;
  trace: LapTrace;
}

export interface TyreState {
  tempC: Quad;
  pressureKPa: Quad;
  wear: Quad;
  brakeTempC: Quad;
  compound: string;
}

export interface FuelState {
  litres: number;
  capacity: number;
  perLap: number | null;
  lapsRemaining: number | null;
}

/** Snapshot pushed to the browser ~20 times a second. */
export interface LiveFrame {
  at: number;
  source: SourceKind;
  /** Packets have arrived within the last couple of seconds. */
  receiving: boolean;
  gameState: GameState;
  sessionState: SessionState;
  sessionId: string | null;
  track: TrackInfo | null;
  car: string;

  lap: number;
  lapTime: number;
  lapDistance: number;
  sector: number;
  lapInvalid: boolean;
  pitMode: PitMode;
  position: number;
  numParticipants: number;
  flag: FlagColour;

  delta: number | null;
  predictedLapTime: number | null;
  referenceLap: number | null;
  referenceLapTime: number | null;
  /** 'session' = best valid lap this session; 'all-time' = your stored best for this track and car. */
  referenceSource: 'session' | 'all-time' | null;
  lastLapTime: number | null;
  bestLapTime: number | null;

  speed: number;
  rpm: number;
  maxRpm: number;
  gear: number;
  throttle: number;
  brake: number;
  clutch: number;
  steering: number;
  x: number;
  z: number;

  fuel: FuelState;
  tyres: TyreState;
  weather: { ambientC: number; trackC: number; rain: number };
}

/** Coaching feedback produced when a lap completes. */
export interface LapFeedback {
  sessionId: string;
  lap: number;
  lapTime: number | null;
  valid: boolean;
  personalBest: boolean;
  referenceLap: number | null;
  referenceLapTime: number | null;
  referenceSource: 'session' | 'all-time' | null;
  deltaToReference: number | null;
  tips: CoachTip[];
}

export interface RecordingStatus {
  name: string;
  startedAt: number;
  packets: number;
  /** Uncompressed bytes captured so far. */
  bytes: number;
  /** Started by "record every session" rather than by hand. */
  auto: boolean;
}

export interface RecordingInfo {
  name: string;
  sizeBytes: number;
  startedAt: number;
  durationMs: number | null;
  packets: number | null;
  track: string | null;
  car: string | null;
  active: boolean;
}

export interface SourceStatus {
  source: SourceKind;
  detail: string;
  packetsPerSecond: number;
  packetCounts: Record<string, number>;
  lastPacketAt: number | null;
  recording: RecordingStatus | null;
}

export type ServerMessage =
  | { type: 'hello'; version: string; status: SourceStatus; session: SessionMeta | null; feedback: LapFeedback | null }
  | { type: 'frame'; frame: LiveFrame }
  | { type: 'session'; session: SessionMeta }
  | { type: 'lap'; sessionId: string; summary: LapSummary; feedback: LapFeedback }
  | { type: 'status'; status: SourceStatus };
