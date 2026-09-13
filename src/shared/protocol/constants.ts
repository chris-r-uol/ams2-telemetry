/**
 * Constants for the "Project CARS 2" UDP protocol, which Automobilista 2 speaks
 * (Options -> System -> UDP Protocol Version: Project CARS 2).
 *
 * Sources: SMS_UDP_Definitions.hpp (Slightly Mad Studios, PC2 patch 5) and the
 * bit-field decoding used by CrewChief V4. See docs/protocol.md.
 */

export const DEFAULT_UDP_PORT = 5606;
export const HEADER_SIZE = 12;

export const PacketType = {
  CarPhysics: 0,
  RaceDefinition: 1,
  Participants: 2,
  Timings: 3,
  GameState: 4,
  WeatherState: 5,
  VehicleNames: 6,
  TimeStats: 7,
  ParticipantVehicleNames: 8,
} as const;

export type PacketTypeId = (typeof PacketType)[keyof typeof PacketType];

export const PACKET_TYPE_NAMES: Record<number, string> = {
  0: 'telemetry',
  1: 'race',
  2: 'participants',
  3: 'timings',
  4: 'gameState',
  5: 'weather',
  6: 'vehicleNames',
  7: 'timeStats',
  8: 'participantVehicleNames',
};

/**
 * Packet sizes. AMS2 appends a 4-byte tick counter to the telemetry and timings
 * packets compared with the original PC2 header, so both lengths are accepted.
 */
export const PacketSize = {
  Telemetry: 556,
  TelemetryWithTick: 559,
  Race: 308,
  Participants: 1136,
  Timings: 1059,
  TimingsWithTick: 1063,
  GameState: 24,
  TimeStats: 1040,
  ParticipantVehicleNames: 1164,
  VehicleClassNames: 1452,
} as const;

export const PARTICIPANTS_PER_PACKET = 16;
export const MAX_PARTICIPANTS = 32;
export const VEHICLES_PER_PACKET = 16;
export const CLASSES_PER_PACKET = 60;

/** Low 3 bits of mGameState. */
export const GAME_STATES = [
  'exited',
  'frontEnd',
  'playing',
  'paused',
  'menuTimeTicking',
  'restarting',
  'replay',
  'frontEndReplay',
] as const;
export type GameState = (typeof GAME_STATES)[number];

/** mGameState >> 4. */
export const SESSION_STATES = [
  'invalid',
  'practice',
  'test',
  'qualify',
  'formationLap',
  'race',
  'timeAttack',
] as const;
export type SessionState = (typeof SESSION_STATES)[number];

/** sRaceState & 0x7f. The top bit flags an invalidated lap. */
export const RACE_STATES = [
  'invalid',
  'notStarted',
  'racing',
  'finished',
  'disqualified',
  'retired',
  'dnf',
] as const;
export type RaceState = (typeof RACE_STATES)[number];

export const PIT_MODES = [
  'none',
  'drivingIntoPits',
  'inPit',
  'drivingOutOfPits',
  'inGarage',
  'drivingOutOfGarage',
] as const;
export type PitMode = (typeof PIT_MODES)[number];

export const FLAG_COLOURS = [
  'none',
  'green',
  'blue',
  'whiteSlowCar',
  'whiteFinalLap',
  'red',
  'yellow',
  'doubleYellow',
  'blackAndWhite',
  'blackOrangeCircle',
  'black',
  'chequered',
] as const;
export type FlagColour = (typeof FLAG_COLOURS)[number];

export const CarFlag = {
  Headlight: 1 << 0,
  EngineActive: 1 << 1,
  EngineWarning: 1 << 2,
  SpeedLimiter: 1 << 3,
  Abs: 1 << 4,
  Handbrake: 1 << 5,
} as const;

export const TyreFlag = {
  Attached: 1 << 0,
  Inflated: 1 << 1,
  OnGround: 1 << 2,
} as const;

/**
 * Terrain material ids (from the PC2 shared memory enum) that count as "off the
 * racing surface" for excursion detection. AMS2 inherits this list; treat it as
 * best effort rather than an official track-limits signal.
 */
export const OFF_TRACK_TERRAIN = new Set<number>([
  6, // grassy berms
  7, // grass
  8, // gravel
  9, // bumpy gravel
  15, // sand
  16, // bumpy sand
  17, // dirt
  18, // bumpy dirt
  22, // dirt bank
  24, // dry verge
  26, // grasscrete
  27, // long grass
  28, // slope grass
  42, // rough sand medium
  43, // rough sand heavy
]);

export function enumName<T extends readonly string[]>(names: T, index: number): T[number] {
  return names[index] ?? names[0];
}
