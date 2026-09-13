/**
 * Byte layouts for every AMS2 / Project CARS 2 UDP packet.
 *
 * Offsets are absolute from the start of the packet (the 12-byte header is
 * included) except for the per-participant/per-vehicle sub-structs, which are
 * relative to the start of each array entry.
 *
 * The telemetry and timings structs are declared with #pragma pack(1) in the
 * original header; the others use natural alignment (hence the gaps).
 */
import { num, optional, str, type Layout } from './struct.ts';

export const HEADER_LAYOUT: Layout = [
  num('packetNumber', 'u32', 0),
  num('categoryPacketNumber', 'u32', 4),
  num('partialPacketIndex', 'u8', 8),
  num('partialPacketNumber', 'u8', 9),
  num('packetType', 'u8', 10),
  num('packetVersion', 'u8', 11),
];

/** eCarPhysics (0): telemetry for the car currently being viewed. */
export const TELEMETRY_LAYOUT: Layout = [
  num('viewedParticipantIndex', 'i8', 12),
  num('unfilteredThrottle', 'u8', 13),
  num('unfilteredBrake', 'u8', 14),
  num('unfilteredSteering', 'i8', 15),
  num('unfilteredClutch', 'u8', 16),
  num('carFlags', 'u8', 17),
  num('oilTempCelsius', 'i16', 18),
  num('oilPressureKPa', 'u16', 20),
  num('waterTempCelsius', 'i16', 22),
  num('waterPressureKPa', 'u16', 24),
  num('fuelPressureKPa', 'u16', 26),
  num('fuelCapacity', 'u8', 28),
  num('brake', 'u8', 29),
  num('throttle', 'u8', 30),
  num('clutch', 'u8', 31),
  num('fuelLevel', 'f32', 32),
  num('speed', 'f32', 36),
  num('rpm', 'u16', 40),
  num('maxRpm', 'u16', 42),
  num('steering', 'i8', 44),
  num('gearNumGears', 'u8', 45),
  num('boostAmount', 'u8', 46),
  num('crashState', 'u8', 47),
  num('odometerKm', 'f32', 48),
  num('orientation', 'f32', 52, 3),
  num('localVelocity', 'f32', 64, 3),
  num('worldVelocity', 'f32', 76, 3),
  num('angularVelocity', 'f32', 88, 3),
  num('localAcceleration', 'f32', 100, 3),
  num('worldAcceleration', 'f32', 112, 3),
  num('extentsCentre', 'f32', 124, 3),
  num('tyreFlags', 'u8', 136, 4),
  num('terrain', 'u8', 140, 4),
  num('tyreY', 'f32', 144, 4),
  num('tyreRps', 'f32', 160, 4),
  num('tyreTemp', 'u8', 176, 4),
  num('tyreHeightAboveGround', 'f32', 180, 4),
  num('tyreWear', 'u8', 196, 4),
  num('brakeDamage', 'u8', 200, 4),
  num('suspensionDamage', 'u8', 204, 4),
  num('brakeTempCelsius', 'i16', 208, 4),
  num('tyreTreadTemp', 'u16', 216, 4),
  num('tyreLayerTemp', 'u16', 224, 4),
  num('tyreCarcassTemp', 'u16', 232, 4),
  num('tyreRimTemp', 'u16', 240, 4),
  num('tyreInternalAirTemp', 'u16', 248, 4),
  num('tyreTempLeft', 'u16', 256, 4),
  num('tyreTempCenter', 'u16', 264, 4),
  num('tyreTempRight', 'u16', 272, 4),
  num('wheelLocalPositionY', 'f32', 280, 4),
  num('rideHeight', 'f32', 296, 4),
  num('suspensionTravel', 'f32', 312, 4),
  num('suspensionVelocity', 'f32', 328, 4),
  num('suspensionRideHeight', 'u16', 344, 4),
  num('airPressure', 'u16', 352, 4),
  num('engineSpeed', 'f32', 360),
  num('engineTorque', 'f32', 364),
  num('wings', 'u8', 368, 2),
  num('handBrake', 'u8', 370),
  num('aeroDamage', 'u8', 371),
  num('engineDamage', 'u8', 372),
  num('joyPad0', 'u32', 373),
  num('dPad', 'u8', 377),
  str('tyreCompound', 378, 40, 4),
  num('turboBoostPressure', 'f32', 538),
  num('fullPosition', 'f32', 542, 3),
  num('brakeBias', 'u8', 554),
  optional(num('tickCount', 'u32', 555)),
];

/** eRaceDefinition (1): track and personal/world records. */
export const RACE_LAYOUT: Layout = [
  num('worldFastestLapTime', 'f32', 12),
  num('personalFastestLapTime', 'f32', 16),
  num('personalFastestSector1Time', 'f32', 20),
  num('personalFastestSector2Time', 'f32', 24),
  num('personalFastestSector3Time', 'f32', 28),
  num('worldFastestSector1Time', 'f32', 32),
  num('worldFastestSector2Time', 'f32', 36),
  num('worldFastestSector3Time', 'f32', 40),
  num('trackLength', 'f32', 44),
  str('trackLocation', 48, 64),
  str('trackVariation', 112, 64),
  str('translatedTrackLocation', 176, 64),
  str('translatedTrackVariation', 240, 64),
  num('lapsTimeInEvent', 'u16', 304),
  num('enforcedPitStopLap', 'i8', 306),
];

/** eParticipants (2): names, up to 16 per packet. */
export const PARTICIPANTS_LAYOUT: Layout = [
  num('participantsChangedTimestamp', 'u32', 12),
  str('name', 16, 64, 16),
  num('nationality', 'u32', 1040, 16),
  num('index', 'u16', 1104, 16),
];

/** eTimings (3) header fields. */
export const TIMINGS_LAYOUT: Layout = [
  num('numParticipants', 'i8', 12),
  num('participantsChangedTimestamp', 'u32', 13),
  num('eventTimeRemaining', 'f32', 17),
  num('splitTimeAhead', 'f32', 21),
  num('splitTimeBehind', 'f32', 25),
  num('splitTime', 'f32', 29),
  num('localParticipantIndex', 'u16', 1057),
  optional(num('tickCount', 'u32', 1059)),
];

export const TIMINGS_PARTICIPANTS_OFFSET = 33;
export const PARTICIPANT_INFO_SIZE = 32;

/** One sParticipantInfo entry inside the timings packet (relative offsets). */
export const PARTICIPANT_INFO_LAYOUT: Layout = [
  num('worldPosition', 'i16', 0, 3),
  num('orientation', 'i16', 6, 3),
  num('currentLapDistance', 'u16', 12),
  num('racePosition', 'u8', 14),
  num('sector', 'u8', 15),
  num('highestFlag', 'u8', 16),
  num('pitModeSchedule', 'u8', 17),
  num('carIndex', 'u16', 18),
  num('raceState', 'u8', 20),
  num('currentLap', 'u8', 21),
  num('currentTime', 'f32', 22),
  num('currentSectorTime', 'f32', 26),
  num('mpParticipantIndex', 'u16', 30),
];

/** eGameState (4). */
export const GAME_STATE_LAYOUT: Layout = [
  num('buildVersionNumber', 'u16', 12),
  num('gameState', 'u8', 14),
  num('ambientTemperature', 'i8', 15),
  num('trackTemperature', 'i8', 16),
  num('rainDensity', 'u8', 17),
  num('snowDensity', 'u8', 18),
  num('windSpeed', 'i8', 19),
  num('windDirectionX', 'i8', 20),
  num('windDirectionY', 'i8', 21),
];

/** eTimeStats (7) header. */
export const TIME_STATS_LAYOUT: Layout = [num('participantsChangedTimestamp', 'u32', 12)];
export const TIME_STATS_OFFSET = 16;
export const PARTICIPANT_STATS_SIZE = 32;

export const PARTICIPANT_STATS_LAYOUT: Layout = [
  num('fastestLapTime', 'f32', 0),
  num('lastLapTime', 'f32', 4),
  num('lastSectorTime', 'f32', 8),
  num('fastestSector1Time', 'f32', 12),
  num('fastestSector2Time', 'f32', 16),
  num('fastestSector3Time', 'f32', 20),
  num('participantOnlineRep', 'u32', 24),
  num('mpParticipantIndex', 'u16', 28),
];

/** eParticipantVehicleNames (8), vehicle entries. Natural alignment: 2 bytes padding after index. */
export const VEHICLE_INFO_OFFSET = 12;
export const VEHICLE_INFO_SIZE = 72;
export const VEHICLE_INFO_LAYOUT: Layout = [
  num('index', 'u16', 0),
  num('classIndex', 'u32', 4),
  str('name', 8, 64),
];

/** eParticipantVehicleNames (8), final partial packet: class names. */
export const CLASS_INFO_OFFSET = 12;
export const CLASS_INFO_SIZE = 24;
export const CLASS_INFO_LAYOUT: Layout = [num('classIndex', 'u32', 0), str('name', 4, 20)];
