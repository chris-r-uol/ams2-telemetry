import type { FlagColour, GameState, PitMode, RaceState, SessionState } from './constants.ts';

type Vec3 = [number, number, number];
type Quad = [number, number, number, number];

export interface PacketHeader {
  packetNumber: number;
  categoryPacketNumber: number;
  partialPacketIndex: number;
  partialPacketNumber: number;
  packetType: number;
  packetVersion: number;
}

/** Raw telemetry fields, in the game's own units (see layouts.ts / docs/protocol.md). */
export interface RawTelemetry {
  viewedParticipantIndex: number;
  unfilteredThrottle: number; // 0-255
  unfilteredBrake: number; // 0-255
  unfilteredSteering: number; // -127..127
  unfilteredClutch: number; // 0-255
  carFlags: number;
  oilTempCelsius: number;
  oilPressureKPa: number;
  waterTempCelsius: number;
  waterPressureKPa: number;
  fuelPressureKPa: number;
  fuelCapacity: number; // litres
  brake: number; // 0-255
  throttle: number; // 0-255
  clutch: number; // 0-255
  fuelLevel: number; // 0-1 fraction of capacity
  speed: number; // m/s
  rpm: number;
  maxRpm: number;
  steering: number; // -127..127
  gearNumGears: number; // low nibble gear, high nibble number of gears
  boostAmount: number;
  crashState: number;
  odometerKm: number;
  orientation: Vec3;
  localVelocity: Vec3;
  worldVelocity: Vec3;
  angularVelocity: Vec3;
  localAcceleration: Vec3; // m/s^2, car space
  worldAcceleration: Vec3;
  extentsCentre: Vec3;
  tyreFlags: Quad;
  terrain: Quad;
  tyreY: Quad;
  tyreRps: Quad;
  tyreTemp: Quad; // Celsius
  tyreHeightAboveGround: Quad;
  tyreWear: Quad; // 0-255
  brakeDamage: Quad;
  suspensionDamage: Quad;
  brakeTempCelsius: Quad;
  tyreTreadTemp: Quad;
  tyreLayerTemp: Quad;
  tyreCarcassTemp: Quad;
  tyreRimTemp: Quad;
  tyreInternalAirTemp: Quad;
  tyreTempLeft: Quad;
  tyreTempCenter: Quad;
  tyreTempRight: Quad;
  wheelLocalPositionY: Quad;
  rideHeight: Quad;
  suspensionTravel: Quad;
  suspensionVelocity: Quad;
  suspensionRideHeight: Quad;
  airPressure: Quad;
  engineSpeed: number;
  engineTorque: number;
  wings: [number, number];
  handBrake: number;
  aeroDamage: number;
  engineDamage: number;
  joyPad0: number;
  dPad: number;
  tyreCompound: [string, string, string, string];
  turboBoostPressure: number;
  fullPosition: Vec3; // world metres, full precision
  brakeBias: number; // 0-255
  tickCount?: number;
}

export interface TelemetryPacket extends RawTelemetry {
  /** -1 reverse, 0 neutral, 1.. forward gears. */
  gear: number;
  numGears: number;
}

export interface RawRaceData {
  worldFastestLapTime: number;
  personalFastestLapTime: number;
  personalFastestSector1Time: number;
  personalFastestSector2Time: number;
  personalFastestSector3Time: number;
  worldFastestSector1Time: number;
  worldFastestSector2Time: number;
  worldFastestSector3Time: number;
  trackLength: number;
  trackLocation: string;
  trackVariation: string;
  translatedTrackLocation: string;
  translatedTrackVariation: string;
  lapsTimeInEvent: number;
  enforcedPitStopLap: number;
}

export interface RacePacket extends RawRaceData {
  isTimedSession: boolean;
  /** Laps for lap-based sessions, otherwise minutes. */
  sessionLength: number;
}

export interface ParticipantsPacket {
  participantsChangedTimestamp: number;
  name: string[];
  nationality: number[];
  index: number[];
}

export interface RawParticipantInfo {
  worldPosition: Vec3;
  orientation: Vec3;
  currentLapDistance: number;
  racePosition: number;
  sector: number;
  highestFlag: number;
  pitModeSchedule: number;
  carIndex: number;
  raceState: number;
  currentLap: number;
  currentTime: number;
  currentSectorTime: number;
  mpParticipantIndex: number;
}

export interface ParticipantTiming {
  worldPosition: Vec3;
  /** heading, pitch, bank in radians. */
  orientation: Vec3;
  currentLapDistance: number;
  racePosition: number;
  isActive: boolean;
  sector: number;
  flagColour: FlagColour;
  flagReason: number;
  pitMode: PitMode;
  pitSchedule: number;
  carIndex: number;
  isHuman: boolean;
  raceState: RaceState;
  lapInvalidated: boolean;
  currentLap: number;
  currentTime: number;
  currentSectorTime: number;
  mpParticipantIndex: number;
  raw: RawParticipantInfo;
}

export interface TimingsPacket {
  numParticipants: number;
  participantsChangedTimestamp: number;
  eventTimeRemaining: number;
  splitTimeAhead: number;
  splitTimeBehind: number;
  splitTime: number;
  participants: ParticipantTiming[];
  localParticipantIndex: number;
  tickCount?: number;
}

export interface RawGameState {
  buildVersionNumber: number;
  gameState: number;
  ambientTemperature: number;
  trackTemperature: number;
  rainDensity: number;
  snowDensity: number;
  windSpeed: number;
  windDirectionX: number;
  windDirectionY: number;
}

export interface GameStatePacket extends Omit<RawGameState, 'gameState'> {
  gameState: GameState;
  sessionState: SessionState;
  rawGameState: number;
}

export interface ParticipantStats {
  fastestLapTime: number;
  lastLapTime: number;
  lastSectorTime: number;
  fastestSector1Time: number;
  fastestSector2Time: number;
  fastestSector3Time: number;
  participantOnlineRep: number;
  mpParticipantIndex: number;
}

export interface TimeStatsPacket {
  participantsChangedTimestamp: number;
  participants: ParticipantStats[];
}

export interface VehicleInfo {
  index: number;
  classIndex: number;
  name: string;
}

export interface ClassInfo {
  classIndex: number;
  name: string;
}

export type Ams2Packet =
  | { kind: 'telemetry'; header: PacketHeader; data: TelemetryPacket }
  | { kind: 'race'; header: PacketHeader; data: RacePacket }
  | { kind: 'participants'; header: PacketHeader; data: ParticipantsPacket }
  | { kind: 'timings'; header: PacketHeader; data: TimingsPacket }
  | { kind: 'gameState'; header: PacketHeader; data: GameStatePacket }
  | { kind: 'timeStats'; header: PacketHeader; data: TimeStatsPacket }
  | { kind: 'vehicleNames'; header: PacketHeader; data: { vehicles: VehicleInfo[] } }
  | { kind: 'classNames'; header: PacketHeader; data: { classes: ClassInfo[] } };

export type Ams2PacketKind = Ams2Packet['kind'];
