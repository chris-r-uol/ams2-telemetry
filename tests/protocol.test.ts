import { describe, expect, it } from 'vitest';
import { PacketSize } from '../src/shared/protocol/constants.ts';
import { decodePacket } from '../src/shared/protocol/decode.ts';
import {
  encodeClassNames,
  encodeGameState,
  encodeRace,
  encodeTelemetry,
  encodeTimeStats,
  encodeTimings,
  encodeVehicleNames,
  packGameState,
  packParticipantInfo,
} from '../src/shared/protocol/encode.ts';
import * as layouts from '../src/shared/protocol/layouts.ts';
import { fieldByteLength, layoutEnd, type Layout } from '../src/shared/protocol/struct.ts';

const header = { packetNumber: 42, categoryPacketNumber: 7 };

function assertNoOverlap(name: string, layout: Layout, size: number) {
  const sorted = [...layout].sort((a, b) => a.offset - b.offset);
  let end = 0;
  for (const field of sorted) {
    expect(field.offset, `${name}.${field.name} overlaps the previous field`).toBeGreaterThanOrEqual(end);
    end = field.offset + fieldByteLength(field);
  }
  expect(end, `${name} overruns ${size} bytes`).toBeLessThanOrEqual(size);
}

describe('packet layouts', () => {
  it('have no overlapping fields and fit their packet sizes', () => {
    assertNoOverlap('header', layouts.HEADER_LAYOUT, 12);
    assertNoOverlap('telemetry', layouts.TELEMETRY_LAYOUT, PacketSize.TelemetryWithTick);
    assertNoOverlap('race', layouts.RACE_LAYOUT, PacketSize.Race);
    assertNoOverlap('participants', layouts.PARTICIPANTS_LAYOUT, PacketSize.Participants);
    assertNoOverlap('timings', layouts.TIMINGS_LAYOUT, PacketSize.TimingsWithTick);
    assertNoOverlap('participantInfo', layouts.PARTICIPANT_INFO_LAYOUT, layouts.PARTICIPANT_INFO_SIZE);
    assertNoOverlap('gameState', layouts.GAME_STATE_LAYOUT, PacketSize.GameState);
    assertNoOverlap('participantStats', layouts.PARTICIPANT_STATS_LAYOUT, layouts.PARTICIPANT_STATS_SIZE);
    assertNoOverlap('vehicleInfo', layouts.VEHICLE_INFO_LAYOUT, layouts.VEHICLE_INFO_SIZE);
    assertNoOverlap('classInfo', layouts.CLASS_INFO_LAYOUT, layouts.CLASS_INFO_SIZE);
  });

  it('matches the documented struct sizes', () => {
    expect(layoutEnd(layouts.TELEMETRY_LAYOUT, false)).toBe(555);
    expect(layoutEnd(layouts.TELEMETRY_LAYOUT)).toBe(PacketSize.TelemetryWithTick);
    expect(layoutEnd(layouts.TIMINGS_LAYOUT, false)).toBe(PacketSize.Timings);
    expect(layouts.TIMINGS_PARTICIPANTS_OFFSET + 32 * layouts.PARTICIPANT_INFO_SIZE).toBe(1057);
    expect(layouts.TIME_STATS_OFFSET + 32 * layouts.PARTICIPANT_STATS_SIZE).toBe(PacketSize.TimeStats);
    expect(layouts.VEHICLE_INFO_OFFSET + 16 * layouts.VEHICLE_INFO_SIZE).toBe(PacketSize.ParticipantVehicleNames);
    expect(layouts.CLASS_INFO_OFFSET + 60 * layouts.CLASS_INFO_SIZE).toBe(PacketSize.VehicleClassNames);
  });
});

describe('telemetry packet', () => {
  it('round-trips values through encode/decode', () => {
    const bytes = encodeTelemetry(header, {
      viewedParticipantIndex: 3,
      throttle: 255,
      brake: 128,
      steering: -64,
      speed: 61.25,
      rpm: 7450,
      maxRpm: 8500,
      gearNumGears: (6 << 4) | 4,
      fuelLevel: 0.5,
      fuelCapacity: 100,
      tyreTemp: [80, 81, 85, 86],
      airPressure: [175, 176, 180, 181],
      fullPosition: [-512.5, 12.25, 1033.75],
      tyreCompound: ['Slick Soft', 'Slick Soft', 'Slick Soft', 'Slick Soft'],
      brakeBias: 140,
      tickCount: 123456,
    });
    expect(bytes.byteLength).toBe(PacketSize.TelemetryWithTick);

    const packet = decodePacket(bytes);
    expect(packet?.kind).toBe('telemetry');
    if (packet?.kind !== 'telemetry') return;
    const t = packet.data;
    expect(packet.header).toMatchObject({ packetNumber: 42, categoryPacketNumber: 7, packetType: 0 });
    expect(t.viewedParticipantIndex).toBe(3);
    expect(t.throttle).toBe(255);
    expect(t.brake).toBe(128);
    expect(t.steering).toBe(-64);
    expect(t.speed).toBeCloseTo(61.25, 5);
    expect(t.rpm).toBe(7450);
    expect(t.gear).toBe(4);
    expect(t.numGears).toBe(6);
    expect(t.tyreTemp).toEqual([80, 81, 85, 86]);
    expect(t.airPressure).toEqual([175, 176, 180, 181]);
    expect(t.fullPosition[0]).toBeCloseTo(-512.5, 3);
    expect(t.fullPosition[2]).toBeCloseTo(1033.75, 3);
    expect(t.tyreCompound[0]).toBe('Slick Soft');
    expect(t.brakeBias).toBe(140);
    expect(t.tickCount).toBe(123456);
  });

  it('decodes reverse gear from the 0xF nibble', () => {
    const packet = decodePacket(encodeTelemetry(header, { gearNumGears: (5 << 4) | 0x0f }));
    expect(packet?.kind === 'telemetry' && packet.data.gear).toBe(-1);
  });

  it('accepts the shorter PC2-era packet without a tick count', () => {
    const short = encodeTelemetry(header, { rpm: 5000 }).slice(0, PacketSize.Telemetry);
    const packet = decodePacket(short);
    expect(packet?.kind).toBe('telemetry');
    if (packet?.kind !== 'telemetry') return;
    expect(packet.data.rpm).toBe(5000);
    expect(packet.data.tickCount).toBeUndefined();
  });

  it('rejects truncated packets instead of throwing', () => {
    expect(decodePacket(encodeTelemetry(header, {}).slice(0, 200))).toBeNull();
    expect(decodePacket(new Uint8Array(4))).toBeNull();
  });
});

describe('timings packet', () => {
  it('packs and unpacks participant bit fields', () => {
    const bytes = encodeTimings(header, {
      numParticipants: 2,
      localParticipantIndex: 1,
      eventTimeRemaining: 900,
      participants: [
        packParticipantInfo({
          worldPosition: [0, 0, 0],
          currentLapDistance: 10,
          racePosition: 2,
          sector: 1,
          raceStateIndex: 2,
          currentLap: 1,
          currentTime: 1,
          currentSectorTime: 1,
        }),
        packParticipantInfo({
          worldPosition: [-120.75, 4, 350.5],
          currentLapDistance: 2345,
          racePosition: 1,
          sector: 2,
          raceStateIndex: 2,
          lapInvalidated: true,
          pitModeIndex: 2,
          flagColourIndex: 6,
          currentLap: 5,
          currentTime: 71.5,
          currentSectorTime: 20.25,
          isHuman: true,
        }),
      ],
      tickCount: 99,
    });
    expect(bytes.byteLength).toBe(PacketSize.TimingsWithTick);
    const packet = decodePacket(bytes);
    expect(packet?.kind).toBe('timings');
    if (packet?.kind !== 'timings') return;
    const me = packet.data.participants[1];
    expect(packet.data.numParticipants).toBe(2);
    expect(packet.data.localParticipantIndex).toBe(1);
    expect(packet.data.tickCount).toBe(99);
    expect(me.currentLapDistance).toBe(2345);
    expect(me.racePosition).toBe(1);
    expect(me.isActive).toBe(true);
    expect(me.sector).toBe(2);
    expect(me.raceState).toBe('racing');
    expect(me.lapInvalidated).toBe(true);
    expect(me.pitMode).toBe('inPit');
    expect(me.flagColour).toBe('yellow');
    expect(me.isHuman).toBe(true);
    expect(me.currentLap).toBe(5);
    expect(me.currentTime).toBeCloseTo(71.5, 5);
    expect(me.worldPosition[0]).toBeCloseTo(-120.75, 5);
    expect(me.worldPosition[2]).toBeCloseTo(350.5, 5);
    expect(packet.data.participants[0].lapInvalidated).toBe(false);
  });

  it('reads pit mode and car index the way AMS2 packs them', () => {
    // Raw values from an AMS2 recording: leaving the garage, the player's car index and an AI car's.
    const base = packParticipantInfo({
      worldPosition: [0, 0, 0],
      currentLapDistance: 58,
      racePosition: 1,
      sector: 1,
      raceStateIndex: 2,
      currentLap: 1,
      currentTime: -1,
      currentSectorTime: -1,
    });
    const decode = (pitModeSchedule: number, carIndex: number) => {
      const packet = decodePacket(
        encodeTimings(header, {
          numParticipants: 1,
          participantsChangedTimestamp: 1,
          eventTimeRemaining: 0,
          splitTimeAhead: -1,
          splitTimeBehind: -1,
          localParticipantIndex: 0,
          participants: [{ ...base, pitModeSchedule, carIndex }],
          tickCount: 1,
        }),
      );
      if (packet?.kind !== 'timings') throw new Error('expected a timings packet');
      return packet.data.participants[0];
    };
    expect([4, 5, 3, 0].map((raw) => decode(raw, 0xffff).pitMode)).toEqual([
      'inGarage',
      'drivingOutOfGarage',
      'drivingOutOfPits',
      'none',
    ]);
    expect(decode(0, 0xffff)).toMatchObject({ isHuman: true, carIndex: 0x7fff });
    expect(decode(0, 356)).toMatchObject({ isHuman: false, carIndex: 356 });
  });
});

describe('other packets', () => {
  it('decodes game and session state from the packed byte', () => {
    const packet = decodePacket(
      encodeGameState(header, { gameState: packGameState(2, 3), ambientTemperature: 21, trackTemperature: 33 }),
    );
    expect(packet?.kind).toBe('gameState');
    if (packet?.kind !== 'gameState') return;
    expect(packet.data.gameState).toBe('playing');
    expect(packet.data.sessionState).toBe('qualify');
    expect(packet.data.trackTemperature).toBe(33);
  });

  it('decodes race definition strings and session length', () => {
    const packet = decodePacket(
      encodeRace(header, {
        trackLocation: 'Interlagos',
        trackVariation: 'GP',
        trackLength: 4309,
        lapsTimeInEvent: 0x8000 | 6,
      }),
    );
    expect(packet?.kind).toBe('race');
    if (packet?.kind !== 'race') return;
    expect(packet.data.trackLocation).toBe('Interlagos');
    expect(packet.data.trackVariation).toBe('GP');
    expect(packet.data.trackLength).toBeCloseTo(4309);
    expect(packet.data.isTimedSession).toBe(true);
    expect(packet.data.sessionLength).toBe(30);
  });

  it('decodes time stats per participant', () => {
    const packet = decodePacket(
      encodeTimeStats(header, { participants: [{}, { lastLapTime: 101.234, fastestLapTime: 100.5 }] }),
    );
    expect(packet?.kind).toBe('timeStats');
    if (packet?.kind !== 'timeStats') return;
    expect(packet.data.participants[1].lastLapTime).toBeCloseTo(101.234, 3);
    expect(packet.data.participants[1].fastestLapTime).toBeCloseTo(100.5, 3);
  });

  it('tells vehicle-name packets and class-name packets apart by length', () => {
    const vehicles = decodePacket(encodeVehicleNames(header, [{ index: 0, classIndex: 3, name: 'Formula Vee' }]));
    expect(vehicles?.kind).toBe('vehicleNames');
    if (vehicles?.kind === 'vehicleNames') expect(vehicles.data.vehicles[0]).toEqual({ index: 0, classIndex: 3, name: 'Formula Vee' });

    const classes = decodePacket(encodeClassNames(header, [{ classIndex: 3, name: 'F-Vee' }]));
    expect(classes?.kind).toBe('classNames');
    if (classes?.kind === 'classNames') expect(classes.data.classes[0]).toEqual({ classIndex: 3, name: 'F-Vee' });
  });
});
