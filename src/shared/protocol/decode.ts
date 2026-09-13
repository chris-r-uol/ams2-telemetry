import {
  enumName,
  FLAG_COLOURS,
  GAME_STATES,
  HEADER_SIZE,
  MAX_PARTICIPANTS,
  PacketSize,
  PacketType,
  PIT_MODES,
  RACE_STATES,
  SESSION_STATES,
  CLASSES_PER_PACKET,
  VEHICLES_PER_PACKET,
} from './constants.ts';
import {
  CLASS_INFO_LAYOUT,
  CLASS_INFO_OFFSET,
  CLASS_INFO_SIZE,
  GAME_STATE_LAYOUT,
  HEADER_LAYOUT,
  PARTICIPANT_INFO_LAYOUT,
  PARTICIPANT_INFO_SIZE,
  PARTICIPANT_STATS_LAYOUT,
  PARTICIPANT_STATS_SIZE,
  PARTICIPANTS_LAYOUT,
  RACE_LAYOUT,
  TELEMETRY_LAYOUT,
  TIME_STATS_LAYOUT,
  TIME_STATS_OFFSET,
  TIMINGS_LAYOUT,
  TIMINGS_PARTICIPANTS_OFFSET,
  VEHICLE_INFO_LAYOUT,
  VEHICLE_INFO_OFFSET,
  VEHICLE_INFO_SIZE,
} from './layouts.ts';
import { PacketTooShortError, readStruct } from './struct.ts';
import type {
  Ams2Packet,
  ClassInfo,
  GameStatePacket,
  PacketHeader,
  ParticipantStats,
  ParticipantTiming,
  ParticipantsPacket,
  RacePacket,
  RawGameState,
  RawParticipantInfo,
  RawRaceData,
  RawTelemetry,
  TelemetryPacket,
  TimeStatsPacket,
  TimingsPacket,
  VehicleInfo,
} from './types.ts';

function toView(input: Uint8Array | ArrayBuffer): DataView {
  if (input instanceof Uint8Array) return new DataView(input.buffer, input.byteOffset, input.byteLength);
  return new DataView(input);
}

export function decodeHeader(view: DataView): PacketHeader {
  return readStruct<PacketHeader>(view, HEADER_LAYOUT);
}

export function decodeTelemetry(view: DataView): TelemetryPacket {
  const raw = readStruct<RawTelemetry>(view, TELEMETRY_LAYOUT);
  const gearNibble = raw.gearNumGears & 0x0f;
  return {
    ...raw,
    gear: gearNibble === 0x0f ? -1 : gearNibble,
    numGears: raw.gearNumGears >> 4,
  };
}

export function decodeRace(view: DataView): RacePacket {
  const raw = readStruct<RawRaceData>(view, RACE_LAYOUT);
  const isTimedSession = (raw.lapsTimeInEvent & 0x8000) !== 0;
  const value = raw.lapsTimeInEvent & 0x7fff;
  return {
    ...raw,
    isTimedSession,
    // Timed sessions are quantised to 5-minute blocks.
    sessionLength: isTimedSession ? value * 5 : value,
  };
}

export function decodeParticipants(view: DataView): ParticipantsPacket {
  return readStruct<ParticipantsPacket>(view, PARTICIPANTS_LAYOUT);
}

const QUANT = 32768;

export function decodeParticipantInfo(raw: RawParticipantInfo): ParticipantTiming {
  // The two top bit pairs of sSector add quarter-metre precision to x and z.
  const xExtra = ((raw.sector >> 6) & 3) / 4;
  const zExtra = ((raw.sector >> 4) & 3) / 4;
  return {
    worldPosition: [raw.worldPosition[0] + xExtra, raw.worldPosition[1], raw.worldPosition[2] + zExtra],
    orientation: [
      (raw.orientation[0] / QUANT) * Math.PI,
      (raw.orientation[1] / QUANT) * (Math.PI / 2),
      (raw.orientation[2] / QUANT) * Math.PI,
    ],
    currentLapDistance: raw.currentLapDistance,
    racePosition: raw.racePosition & 0x7f,
    isActive: (raw.racePosition & 0x80) !== 0,
    sector: raw.sector & 0x07,
    flagColour: enumName(FLAG_COLOURS, raw.highestFlag >> 2),
    flagReason: raw.highestFlag & 0x03,
    pitMode: enumName(PIT_MODES, raw.pitModeSchedule >> 2),
    pitSchedule: raw.pitModeSchedule & 0x03,
    carIndex: raw.carIndex & 0x7f,
    isHuman: (raw.carIndex & 0x80) !== 0,
    raceState: enumName(RACE_STATES, raw.raceState & 0x7f),
    lapInvalidated: (raw.raceState & 0x80) !== 0,
    currentLap: raw.currentLap,
    currentTime: raw.currentTime,
    currentSectorTime: raw.currentSectorTime,
    mpParticipantIndex: raw.mpParticipantIndex,
    raw,
  };
}

export function decodeTimings(view: DataView): TimingsPacket {
  const head = readStruct<Omit<TimingsPacket, 'participants'>>(view, TIMINGS_LAYOUT);
  const participants: ParticipantTiming[] = [];
  for (let i = 0; i < MAX_PARTICIPANTS; i++) {
    const raw = readStruct<RawParticipantInfo>(
      view,
      PARTICIPANT_INFO_LAYOUT,
      TIMINGS_PARTICIPANTS_OFFSET + i * PARTICIPANT_INFO_SIZE,
    );
    participants.push(decodeParticipantInfo(raw));
  }
  return { ...head, participants };
}

export function decodeGameState(view: DataView): GameStatePacket {
  const raw = readStruct<RawGameState>(view, GAME_STATE_LAYOUT);
  return {
    ...raw,
    gameState: enumName(GAME_STATES, raw.gameState & 0x07),
    sessionState: enumName(SESSION_STATES, (raw.gameState >> 4) & 0x07),
    rawGameState: raw.gameState,
  };
}

export function decodeTimeStats(view: DataView): TimeStatsPacket {
  const head = readStruct<{ participantsChangedTimestamp: number }>(view, TIME_STATS_LAYOUT);
  const participants: ParticipantStats[] = [];
  for (let i = 0; i < MAX_PARTICIPANTS; i++) {
    participants.push(
      readStruct<ParticipantStats>(view, PARTICIPANT_STATS_LAYOUT, TIME_STATS_OFFSET + i * PARTICIPANT_STATS_SIZE),
    );
  }
  return { ...head, participants };
}

export function decodeVehicleNames(view: DataView): VehicleInfo[] {
  return Array.from({ length: VEHICLES_PER_PACKET }, (_, i) =>
    readStruct<VehicleInfo>(view, VEHICLE_INFO_LAYOUT, VEHICLE_INFO_OFFSET + i * VEHICLE_INFO_SIZE),
  );
}

export function decodeClassNames(view: DataView): ClassInfo[] {
  return Array.from({ length: CLASSES_PER_PACKET }, (_, i) =>
    readStruct<ClassInfo>(view, CLASS_INFO_LAYOUT, CLASS_INFO_OFFSET + i * CLASS_INFO_SIZE),
  );
}

/**
 * Decode one UDP datagram. Returns null for packets that are too short,
 * unknown, or not useful (weather/vehicle-name placeholders the game never sends).
 */
export function decodePacket(input: Uint8Array | ArrayBuffer): Ams2Packet | null {
  const view = toView(input);
  if (view.byteLength < HEADER_SIZE) return null;
  const header = decodeHeader(view);
  try {
    switch (header.packetType) {
      case PacketType.CarPhysics:
        return { kind: 'telemetry', header, data: decodeTelemetry(view) };
      case PacketType.RaceDefinition:
        return { kind: 'race', header, data: decodeRace(view) };
      case PacketType.Participants:
        return { kind: 'participants', header, data: decodeParticipants(view) };
      case PacketType.Timings:
        return { kind: 'timings', header, data: decodeTimings(view) };
      case PacketType.GameState:
        return { kind: 'gameState', header, data: decodeGameState(view) };
      case PacketType.TimeStats:
        return { kind: 'timeStats', header, data: decodeTimeStats(view) };
      case PacketType.ParticipantVehicleNames:
        // The last partial packet of this group carries class names instead of vehicles.
        return view.byteLength >= PacketSize.VehicleClassNames
          ? { kind: 'classNames', header, data: { classes: decodeClassNames(view) } }
          : { kind: 'vehicleNames', header, data: { vehicles: decodeVehicleNames(view) } };
      default:
        return null;
    }
  } catch (error) {
    if (error instanceof PacketTooShortError) return null;
    throw error;
  }
}
