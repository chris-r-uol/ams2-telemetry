/**
 * Encoders that produce byte-identical AMS2 UDP packets.
 *
 * Used by the demo simulator (so demo data flows through the real decoder) and
 * by the tests. Inputs use the raw game units documented in types.ts.
 */
import { MAX_PARTICIPANTS, PacketSize, PacketType, type PacketTypeId } from './constants.ts';
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
import { writeStruct, type Layout } from './struct.ts';
import type {
  ClassInfo,
  ParticipantStats,
  ParticipantsPacket,
  RawGameState,
  RawParticipantInfo,
  RawRaceData,
  RawTelemetry,
  VehicleInfo,
} from './types.ts';

export interface HeaderInput {
  packetNumber: number;
  categoryPacketNumber: number;
  partialPacketIndex?: number;
  partialPacketNumber?: number;
}

function packet(type: PacketTypeId, size: number, header: HeaderInput, layout: Layout, body: object) {
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  writeStruct(view, HEADER_LAYOUT, {
    partialPacketIndex: 1,
    partialPacketNumber: 1,
    ...header,
    packetType: type,
    packetVersion: 1,
  });
  writeStruct(view, layout, body);
  return { bytes, view };
}

export function encodeTelemetry(header: HeaderInput, data: Partial<RawTelemetry>): Uint8Array {
  return packet(PacketType.CarPhysics, PacketSize.TelemetryWithTick, header, TELEMETRY_LAYOUT, data).bytes;
}

export function encodeRace(header: HeaderInput, data: Partial<RawRaceData>): Uint8Array {
  return packet(PacketType.RaceDefinition, PacketSize.Race, header, RACE_LAYOUT, data).bytes;
}

export function encodeParticipants(header: HeaderInput, data: Partial<ParticipantsPacket>): Uint8Array {
  return packet(PacketType.Participants, PacketSize.Participants, header, PARTICIPANTS_LAYOUT, data).bytes;
}

export function encodeTimings(
  header: HeaderInput,
  data: {
    numParticipants: number;
    participantsChangedTimestamp?: number;
    eventTimeRemaining?: number;
    splitTimeAhead?: number;
    splitTimeBehind?: number;
    splitTime?: number;
    localParticipantIndex?: number;
    tickCount?: number;
    participants: Partial<RawParticipantInfo>[];
  },
): Uint8Array {
  const { bytes, view } = packet(PacketType.Timings, PacketSize.TimingsWithTick, header, TIMINGS_LAYOUT, data);
  data.participants.slice(0, MAX_PARTICIPANTS).forEach((p, i) => {
    writeStruct(view, PARTICIPANT_INFO_LAYOUT, p, TIMINGS_PARTICIPANTS_OFFSET + i * PARTICIPANT_INFO_SIZE);
  });
  return bytes;
}

export function encodeGameState(header: HeaderInput, data: Partial<RawGameState>): Uint8Array {
  return packet(PacketType.GameState, PacketSize.GameState, header, GAME_STATE_LAYOUT, data).bytes;
}

/** Pack game + session state enums the way mGameState stores them. */
export function packGameState(gameStateIndex: number, sessionStateIndex: number): number {
  return (gameStateIndex & 0x07) | ((sessionStateIndex & 0x07) << 4);
}

export function encodeTimeStats(
  header: HeaderInput,
  data: { participantsChangedTimestamp?: number; participants: Partial<ParticipantStats>[] },
): Uint8Array {
  const { bytes, view } = packet(PacketType.TimeStats, PacketSize.TimeStats, header, TIME_STATS_LAYOUT, data);
  data.participants.slice(0, MAX_PARTICIPANTS).forEach((p, i) => {
    writeStruct(view, PARTICIPANT_STATS_LAYOUT, p, TIME_STATS_OFFSET + i * PARTICIPANT_STATS_SIZE);
  });
  return bytes;
}

export function encodeVehicleNames(header: HeaderInput, vehicles: VehicleInfo[]): Uint8Array {
  const { bytes, view } = packet(
    PacketType.ParticipantVehicleNames,
    PacketSize.ParticipantVehicleNames,
    header,
    [],
    {},
  );
  vehicles.slice(0, 16).forEach((v, i) => {
    writeStruct(view, VEHICLE_INFO_LAYOUT, v, VEHICLE_INFO_OFFSET + i * VEHICLE_INFO_SIZE);
  });
  return bytes;
}

export function encodeClassNames(header: HeaderInput, classes: ClassInfo[]): Uint8Array {
  const { bytes, view } = packet(PacketType.ParticipantVehicleNames, PacketSize.VehicleClassNames, header, [], {});
  classes.slice(0, 60).forEach((c, i) => {
    writeStruct(view, CLASS_INFO_LAYOUT, c, CLASS_INFO_OFFSET + i * CLASS_INFO_SIZE);
  });
  return bytes;
}

/** Pack the bit fields of a participant timing entry. */
export function packParticipantInfo(input: {
  worldPosition: [number, number, number];
  heading?: number;
  currentLapDistance: number;
  racePosition: number;
  isActive?: boolean;
  sector: number;
  pitModeIndex?: number;
  flagColourIndex?: number;
  raceStateIndex: number;
  lapInvalidated?: boolean;
  currentLap: number;
  currentTime: number;
  currentSectorTime: number;
  carIndex?: number;
  isHuman?: boolean;
  mpParticipantIndex?: number;
}): Partial<RawParticipantInfo> {
  const [x, y, z] = input.worldPosition;
  const xInt = Math.floor(x);
  const zInt = Math.floor(z);
  const xExtra = Math.min(3, Math.floor((x - xInt) * 4));
  const zExtra = Math.min(3, Math.floor((z - zInt) * 4));
  return {
    worldPosition: [xInt, Math.round(y), zInt],
    orientation: [Math.round(((input.heading ?? 0) / Math.PI) * 32767), 0, 0],
    currentLapDistance: input.currentLapDistance,
    racePosition: (input.racePosition & 0x7f) | (input.isActive === false ? 0 : 0x80),
    sector: (input.sector & 0x07) | (zExtra << 4) | (xExtra << 6),
    highestFlag: (input.flagColourIndex ?? 0) << 2,
    pitModeSchedule: (input.pitModeIndex ?? 0) & 0x07,
    carIndex: ((input.carIndex ?? 0) & 0x7fff) | (input.isHuman ? 0x8000 : 0),
    raceState: (input.raceStateIndex & 0x7f) | (input.lapInvalidated ? 0x80 : 0),
    currentLap: input.currentLap,
    currentTime: input.currentTime,
    currentSectorTime: input.currentSectorTime,
    mpParticipantIndex: input.mpParticipantIndex ?? 0,
  };
}
