/**
 * Decodes raw UDP packets and merges them into one stream of "ticks" for the
 * car being viewed, plus the slower-changing session context (track, car,
 * game state, weather).
 */
import {
  KERB_TERRAIN,
  OFF_TRACK_TERRAIN,
  PARTICIPANTS_PER_PACKET,
  TyreFlag,
  type FlagColour,
  type GameState,
  type PitMode,
  type RaceState,
  type SessionState,
} from '../../shared/protocol/constants.ts';
import { decodePacket } from '../../shared/protocol/decode.ts';
import type { ParticipantTiming, TelemetryPacket, TimingsPacket } from '../../shared/protocol/types.ts';
import type { Quad, TrackInfo } from '../../shared/model/types.ts';

const G = 9.80665;

const PRIMING_ORDER: readonly string[] = ['gameState', 'race', 'participants', 'vehicleNames', 'classNames', 'timeStats'];

/** One merged telemetry + timing sample for the viewed car, in app units. */
export interface Tick {
  at: number;
  viewedIndex: number;
  lap: number;
  lapTime: number;
  /** Whole metres, as sent by the game. */
  lapDistance: number;
  sector: number;
  lapInvalidated: boolean;
  pitMode: PitMode;
  raceState: RaceState;
  position: number;
  flag: FlagColour;
  speed: number;
  throttle: number;
  brake: number;
  clutch: number;
  steering: number;
  gear: number;
  numGears: number;
  rpm: number;
  maxRpm: number;
  x: number;
  y: number;
  z: number;
  latG: number;
  lonG: number;
  offWheels: number;
  /** Bit per wheel (FL=1, FR=2, RL=4, RR=8) on a kerb or the painted edge. */
  kerbMask: number;
  steeringInput: number;
  /** The throttle pedal itself, 0..1: `throttle` also includes the game's own blips on downshifts and cuts on upshifts. */
  throttleInput: number;
  yawRate: number;
  vLat: number;
  vLon: number;
  vertG: number;
  pitch: number;
  roll: number;
  suspensionTravel: Quad;
  damperVelocity: Quad;
  rideHeight: Quad;
  wheelRps: Quad;
  /** Bit n set when wheel n (FL, FR, RL, RR) is touching the ground. */
  groundedMask: number;
  fuelLitres: number;
  fuelCapacity: number;
  tyreTempC: Quad;
  tyrePressureKPa: Quad;
  tyreWear: Quad;
  brakeTempC: Quad;
  compound: string;
}

export interface SessionContext {
  track: TrackInfo | null;
  car: string;
  carClass: string;
  /** Every car the game has named. AMS2 doesn't say which one is the player's. */
  vehicles: string[];
  driver: string;
  gameState: GameState;
  sessionState: SessionState;
  ambientC: number;
  trackC: number;
  rain: number;
  numParticipants: number;
}

const quad = (values: number[], scale = 1): Quad => [
  values[0] * scale,
  values[1] * scale,
  values[2] * scale,
  values[3] * scale,
];

/**
 * AMS2's header documents tyre pressure as PSI, while PC2-era data looks like
 * kPa. Racing pressures are ~20-40 psi or ~140-280 kPa, so size tells them apart.
 */
function pressureScale(values: number[]): number {
  const max = Math.max(...values);
  return max > 0 && max < 70 ? 6.894757 : 1;
}

export function toTick(t: TelemetryPacket, p: ParticipantTiming, viewedIndex: number, at: number): Tick {
  let offWheels = 0;
  let kerbMask = 0;
  t.terrain.forEach((material, w) => {
    if (OFF_TRACK_TERRAIN.has(material)) offWheels++;
    if (KERB_TERRAIN.has(material)) kerbMask |= 1 << w;
  });
  return {
    at,
    viewedIndex,
    lap: p.currentLap,
    lapTime: p.currentTime,
    lapDistance: p.currentLapDistance,
    sector: p.sector,
    lapInvalidated: p.lapInvalidated,
    pitMode: p.pitMode,
    raceState: p.raceState,
    position: p.racePosition,
    flag: p.flagColour,
    speed: t.speed,
    throttle: t.throttle / 255,
    brake: t.brake / 255,
    clutch: t.clutch / 255,
    steering: t.steering / 127,
    gear: t.gear,
    numGears: t.numGears,
    rpm: t.rpm,
    maxRpm: t.maxRpm,
    x: t.fullPosition[0],
    y: t.fullPosition[1],
    z: t.fullPosition[2],
    latG: t.localAcceleration[0] / G,
    lonG: -t.localAcceleration[2] / G,
    offWheels,
    kerbMask,
    steeringInput: t.unfilteredSteering / 127,
    throttleInput: t.unfilteredThrottle / 255,
    yawRate: t.angularVelocity[1],
    vLat: t.localVelocity[0],
    vLon: t.localVelocity[2],
    vertG: t.localAcceleration[1] / G,
    pitch: t.orientation[0],
    roll: t.orientation[2],
    suspensionTravel: quad(t.suspensionTravel),
    damperVelocity: quad(t.suspensionVelocity),
    rideHeight: quad(t.rideHeight),
    wheelRps: quad(t.tyreRps),
    groundedMask: t.tyreFlags.reduce((mask, flags, w) => mask | ((flags & TyreFlag.OnGround ? 1 : 0) << w), 0),
    fuelLitres: t.fuelLevel * t.fuelCapacity,
    fuelCapacity: t.fuelCapacity,
    tyreTempC: quad(t.tyreTemp),
    tyrePressureKPa: quad(t.airPressure, pressureScale(t.airPressure)),
    tyreWear: quad(t.tyreWear, 1 / 255),
    brakeTempC: quad(t.brakeTempCelsius),
    compound: t.tyreCompound[0] ?? '',
  };
}

export class TelemetryHub {
  readonly context: SessionContext = {
    track: null,
    car: '',
    carClass: '',
    vehicles: [],
    driver: '',
    gameState: 'playing',
    sessionState: 'invalid',
    ambientC: 0,
    trackC: 0,
    rain: 0,
    numParticipants: 0,
  };
  readonly packetCounts: Record<string, number> = {};
  lastPacketAt: number | null = null;

  /** Latest copy of each slow-changing packet, so a recording started mid-session stands alone. */
  private readonly latestRaw = new Map<string, Uint8Array>();
  private timings: TimingsPacket | null = null;
  private viewedIndex = 0;
  private lastOfficialLapTime = -1;
  private readonly names = new Map<number, string>();
  private readonly vehicles = new Map<number, { name: string; classIndex: number }>();
  private readonly classes = new Map<number, string>();
  private readonly tickListeners = new Set<(tick: Tick) => void>();
  private readonly lapTimeListeners = new Set<(lapTime: number) => void>();
  private rateCount = 0;
  private rateWindowStart = 0;
  private rate = 0;

  onTick(listener: (tick: Tick) => void): () => void {
    this.tickListeners.add(listener);
    return () => this.tickListeners.delete(listener);
  }

  /** Fires when the game reports a new "last lap time" for the viewed car. */
  onOfficialLapTime(listener: (lapTime: number) => void): () => void {
    this.lapTimeListeners.add(listener);
    return () => this.lapTimeListeners.delete(listener);
  }

  /** Forget everything learned from the packets so far, before a different feed takes over. */
  reset(): void {
    Object.assign(this.context, {
      track: null,
      car: '',
      carClass: '',
      vehicles: [],
      driver: '',
      gameState: 'playing',
      sessionState: 'invalid',
      ambientC: 0,
      trackC: 0,
      rain: 0,
      numParticipants: 0,
    } satisfies SessionContext);
    this.lastPacketAt = null;
    this.latestRaw.clear();
    this.timings = null;
    this.viewedIndex = 0;
    this.lastOfficialLapTime = -1;
    this.names.clear();
    this.vehicles.clear();
    this.classes.clear();
  }

  /** Track, names, game state and time stats as last received, in a sensible replay order. */
  primingPackets(): Uint8Array[] {
    const rank = (key: string) => PRIMING_ORDER.indexOf(key.slice(0, key.indexOf(':')) as (typeof PRIMING_ORDER)[number]);
    return [...this.latestRaw.entries()]
      .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
      .map(([, bytes]) => bytes);
  }

  get packetsPerSecond(): number {
    return this.lastPacketAt !== null && Date.now() - this.lastPacketAt < 2000 ? this.rate : 0;
  }

  ingest(bytes: Uint8Array, at: number = Date.now()): void {
    this.trackRate(at);
    const packet = decodePacket(bytes);
    if (!packet) {
      this.count('unrecognised');
      return;
    }
    this.count(packet.kind);
    this.lastPacketAt = at;
    if (PRIMING_ORDER.includes(packet.kind)) {
      this.latestRaw.set(`${packet.kind}:${packet.header.partialPacketIndex}`, bytes.slice());
    }
    const ctx = this.context;

    switch (packet.kind) {
      case 'race': {
        const r = packet.data;
        const location = r.translatedTrackLocation || r.trackLocation;
        const variation = r.translatedTrackVariation || r.trackVariation;
        if (location && r.trackLength > 0) ctx.track = { location, variation, length: r.trackLength };
        break;
      }
      case 'gameState':
        ctx.gameState = packet.data.gameState;
        ctx.sessionState = packet.data.sessionState;
        ctx.ambientC = packet.data.ambientTemperature;
        ctx.trackC = packet.data.trackTemperature;
        ctx.rain = packet.data.rainDensity / 255;
        break;
      case 'participants': {
        const base = Math.max(0, packet.header.partialPacketIndex - 1) * PARTICIPANTS_PER_PACKET;
        packet.data.name.forEach((name, i) => {
          if (name) this.names.set(base + i, name);
        });
        this.refreshNames();
        break;
      }
      case 'vehicleNames':
        for (const v of packet.data.vehicles) if (v.name) this.vehicles.set(v.index, v);
        this.refreshNames();
        break;
      case 'classNames':
        for (const c of packet.data.classes) if (c.name) this.classes.set(c.classIndex, c.name);
        this.refreshNames();
        break;
      case 'timings': {
        const carIndex = packet.data.participants[this.viewedIndex]?.carIndex;
        const carChanged = carIndex !== this.timings?.participants[this.viewedIndex]?.carIndex;
        this.timings = packet.data;
        ctx.numParticipants = Math.max(0, packet.data.numParticipants);
        if (carChanged) this.refreshNames();
        break;
      }
      case 'timeStats': {
        const stats = packet.data.participants[this.viewedIndex];
        if (stats && stats.lastLapTime > 0 && Math.abs(stats.lastLapTime - this.lastOfficialLapTime) > 1e-4) {
          this.lastOfficialLapTime = stats.lastLapTime;
          for (const listener of this.lapTimeListeners) listener(stats.lastLapTime);
        }
        break;
      }
      case 'telemetry': {
        const index = packet.data.viewedParticipantIndex;
        if (index >= 0 && index !== this.viewedIndex) {
          this.viewedIndex = index;
          this.refreshNames();
        }
        const participant = this.timings?.participants[this.viewedIndex];
        if (!participant) break;
        const tick = toTick(packet.data, participant, this.viewedIndex, at);
        for (const listener of this.tickListeners) listener(tick);
        break;
      }
    }
  }

  private refreshNames(): void {
    // Vehicles are keyed by the index in each participant's timing entry. AMS2 fills it in
    // for AI cars but not for the player, so the player's car usually stays unknown.
    const carIndex = this.timings?.participants[this.viewedIndex]?.carIndex;
    const vehicle = carIndex === undefined ? undefined : this.vehicles.get(carIndex);
    this.context.driver = this.names.get(this.viewedIndex) ?? '';
    this.context.car = vehicle?.name ?? '';
    this.context.carClass = vehicle ? (this.classes.get(vehicle.classIndex) ?? '') : '';
    this.context.vehicles = [...new Set([...this.vehicles.values()].map((v) => v.name))].sort();
  }

  private count(kind: string): void {
    this.packetCounts[kind] = (this.packetCounts[kind] ?? 0) + 1;
  }

  private trackRate(at: number): void {
    this.rateCount++;
    const elapsed = at - this.rateWindowStart;
    if (elapsed >= 1000) {
      this.rate = Math.round((this.rateCount * 1000) / elapsed);
      this.rateCount = 0;
      this.rateWindowStart = at;
    }
  }
}
