import type { FlagColour, GameState, PitMode, SessionState } from '../protocol/constants.ts';
import type { ChassisEventKind, PhaseBalance, Wheel } from '../analysis/chassis.ts';
import type { CoachTip } from '../analysis/coach.ts';
import type { GripRun } from '../analysis/grip.ts';
import type { PedalTechnique } from '../analysis/pedals.ts';
import type { Habit } from '../analysis/session.ts';

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
  'wheelFL', // wheel rotation as sent (AMS2: rad/s, negative going forwards)
  'wheelFR',
  'wheelRL',
  'wheelRR',
  'grounded', // bit per wheel (FL=1, FR=2, RL=4, RR=8) when touching the ground
  'kerb', // bit per wheel (FL=1, FR=2, RL=4, RR=8) on a kerb or the painted edge. Laps saved before this existed won't have it.
  'throttleIn', // the throttle pedal itself, 0..1, without the game's blips and cuts. Laps saved before this existed won't have it.
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
  /** Where `car` came from. AMS2 doesn't name the player's car, so usually it's you, or your last choice. */
  carSource?: 'game' | 'chosen' | 'remembered';
  /** Cars the game named in this session, offered when you pick yours. */
  vehicles?: string[];
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
  coach: LiveCoachFrame | null;
}

/** A chassis event spotted during the current lap. */
export interface LiveEvent {
  kind: ChassisEventKind;
  wheel: Wheel | null;
  corner: string | null;
  distance: number;
  lap: number;
}

/** Speed and balance through one corner, sampled every `step` metres from `from`. */
export interface CornerProfile {
  from: number;
  step: number;
  speed: (number | null)[];
  bestSpeed: (number | null)[];
  /** Extra steering as a share of what the car needed: + understeer, − oversteer. */
  balance: (number | null)[];
  /** Pedal positions, 0 to 1: the throttle pedal itself, without the game's blips. This run and your best run. */
  throttle: (number | null)[];
  brake: (number | null)[];
  bestThrottle: (number | null)[];
  bestBrake: (number | null)[];
  /** Steering, −1 full left to 1 full right: this run and your best run through the corner. */
  steering: (number | null)[];
  bestSteering: (number | null)[];
  /** World position along each line, metres. */
  x: (number | null)[];
  z: (number | null)[];
  bestX: (number | null)[];
  bestZ: (number | null)[];
  apex: number;
  brakeAt: number | null;
  bestBrakeAt: number | null;
}

/** Grip used through a corner, on the same points as its profile: this run and your best run. */
export interface CornerGrip {
  run: GripRun;
  best: GripRun | null;
}

/** How the corner you just drove went, sent as soon as you pass its exit. */
export interface CornerReport {
  lap: number;
  cornerId: number;
  corner: string;
  /** Seconds from the braking zone to the exit, against the reference lap (+ slower). */
  timeDelta: number | null;
  /** The same, against your best run through this corner this session. */
  vsBest: number | null;
  bestLap: number | null;
  phases: { entry: PhaseBalance; mid: PhaseBalance; exit: PhaseBalance } | null;
  minSpeed: number;
  bestMinSpeed: number | null;
  /** Metres: + braked earlier than your best run. */
  brakeEarlierBy: number | null;
  /** Metres: + back on the throttle later than your best run. */
  throttleLaterBy: number | null;
  exitSpeed: number;
  bestExitSpeed: number | null;
  slipAngle: number | null;
  events: LiveEvent[];
  tip: CoachTip | null;
  profile: CornerProfile;
  /** Null until a lap has shown how much grip the car has. */
  grip: CornerGrip | null;
  /** How the brake and throttle were used: this run and your best run through the corner. */
  pedals: { run: PedalTechnique; best: PedalTechnique | null };
}

/** Share of the lap spent flat out, for the last complete lap and your best lap this session. */
export interface LapPedals {
  lap: number;
  fullThrottle: number | null;
  bestLap: number | null;
  bestFullThrottle: number | null;
}

/** What to aim for in a corner: your best run, and anything to work on. */
export interface CornerPlan {
  cornerId: number;
  corner: string;
  entry: number;
  apex: number;
  exit: number;
  bestLap: number | null;
  bestBrakePoint: number | null;
  bestMinSpeed: number | null;
  tip: CoachTip | null;
  habit: Habit | null;
}

export interface CornerProgress {
  cornerId: number;
  corner: string;
  timeDelta: number | null;
  done: boolean;
}

/** Mid-lap coaching state, sent whenever it changes (a corner finished, a lap started). */
export interface LiveInsights {
  sessionId: string | null;
  lap: number;
  balanceReady: boolean;
  gripReady: boolean;
  corners: CornerProgress[];
  lastCorner: CornerReport | null;
  events: LiveEvent[];
  plans: CornerPlan[];
  idealLapTime: number | null;
  lapPedals: LapPedals | null;
}

/** Fast-changing coaching values sent with every live frame. */
export interface LiveCoachFrame {
  /** Smoothed balance while cornering: + understeer, − oversteer (share of needed steering). */
  balance: number | null;
  currentCornerId: number | null;
  nextCornerId: number | null;
  toApex: number | null;
  /** Metres until your best run's braking point for the next corner. */
  brakeIn: number | null;
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
  /** The saved session this recording captured, if known. */
  sessionId: string | null;
}

/** A recording replayed from the dashboard. It takes over from the game until it's stopped. */
export interface ReplayStatus {
  recording: string;
  track: string | null;
  sessionId: string | null;
  finished: boolean;
}

export interface SourceStatus {
  source: SourceKind;
  detail: string;
  /** Demo or replay speed, which the dashboard can change. Null when the game is the source. */
  playbackSpeed: number | null;
  /** The demo or replay is paused. */
  paused: boolean;
  replay: ReplayStatus | null;
  packetsPerSecond: number;
  packetCounts: Record<string, number>;
  lastPacketAt: number | null;
  recording: RecordingStatus | null;
}

/** Speeds the dashboard offers for the demo and replays. */
export const PLAYBACK_SPEEDS = [1, 2, 4] as const;

export type ServerMessage =
  | {
      type: 'hello';
      version: string;
      status: SourceStatus;
      session: SessionMeta | null;
      feedback: LapFeedback | null;
      insights: LiveInsights | null;
    }
  | { type: 'frame'; frame: LiveFrame }
  | { type: 'insights'; insights: LiveInsights }
  | { type: 'session'; session: SessionMeta }
  | { type: 'lap'; sessionId: string; summary: LapSummary; feedback: LapFeedback }
  | { type: 'status'; status: SourceStatus };
