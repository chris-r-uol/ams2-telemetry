/**
 * Demo mode: a simulated driver lapping Coachwood Park.
 *
 * It emits genuine AMS2 UDP packets (encoded with the same layouts the decoder
 * uses), so everything downstream (decoding, lap building, coaching, the UI)
 * runs exactly as it would with the real game. Handy on a Mac with no AMS2.
 */
import { CarFlag, PacketType } from '../../shared/protocol/constants.ts';
import {
  encodeClassNames,
  encodeGameState,
  encodeParticipants,
  encodeRace,
  encodeTelemetry,
  encodeTimeStats,
  encodeTimings,
  encodeVehicleNames,
  packGameState,
  packParticipantInfo,
  type HeaderInput,
} from '../../shared/protocol/encode.ts';
import {
  computeLap,
  findDemoCorners,
  G,
  MAX_RPM,
  type CornerHabit,
  type DemoCorner,
  type LapPlan,
  type LapProfile,
} from './profile.ts';
import { buildDemoTrack, type DemoTrack } from './track.ts';

export interface DemoOptions {
  seed?: number;
  /** Real-time multiplier used by start(). */
  speed?: number;
  tickRate?: number;
}

interface Sample {
  d: number;
  speed: number;
  throttle: number;
  brake: number;
  steering: number;
  gear: number;
  rpm: number;
  latG: number;
  lonG: number;
  off: number;
  x: number;
  z: number;
  heading: number;
}

export interface DemoHabits {
  lateBraking: number;
  lateThrottle: number;
  slowApex: number;
  coasting: number;
  offTrack: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COMPOUND = 'Slick Medium';

export class DemoSimulator {
  readonly track: DemoTrack;
  readonly corners: DemoCorner[];
  /** Which corner each recurring mistake happens at (index into `corners`). */
  readonly habits: DemoHabits;
  readonly completedLaps: { lap: number; lapTime: number; valid: boolean }[] = [];

  private readonly emit: (bytes: Uint8Array) => void;
  private readonly speed: number;
  private readonly tickRate: number;
  private readonly rng: () => number;
  private readonly regionOf: Int16Array;
  private profile: LapProfile;
  private lapIndex = 0;
  private lapTime = 0;
  private sessionTime = 0;
  private odometer = 0;
  private sector = 0;
  private sectorStart = 0;
  private invalid = false;
  private lastLapTime = -1;
  private fastestLapTime = -1;
  private lastSectorTime = -1;
  private fuel = 62;
  private readonly tyreTemp = [38, 38, 36, 36];
  private readonly brakeTemp = [120, 120, 100, 100];
  private readonly wear = [0, 0, 0, 0];
  private packetNumber = 0;
  private readonly categoryNumbers = new Array<number>(9).fill(0);
  private nextSlowPacketsAt = 0;
  private nextNamesAt = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(emit: (bytes: Uint8Array) => void, options: DemoOptions = {}) {
    this.emit = emit;
    this.speed = options.speed ?? 1;
    this.tickRate = options.tickRate ?? 60;
    this.rng = mulberry32(options.seed ?? 20260913);
    this.track = buildDemoTrack();
    const found = findDemoCorners(this.track);
    this.corners = found.corners;
    this.regionOf = found.regionOf;
    this.habits = this.chooseHabitCorners();
    this.profile = computeLap(this.track, this.corners, this.regionOf, this.planFor(0));
  }

  /** Stream packets in real time (scaled by `speed`). */
  start(): void {
    if (this.timer) return;
    const dt = 1 / this.tickRate;
    let last = performance.now();
    let owed = 0;
    this.timer = setInterval(() => {
      const now = performance.now();
      owed += ((now - last) / 1000) * this.speed;
      last = now;
      for (let steps = 0; owed >= dt && steps < 5000; steps++) {
        this.step(dt);
        owed -= dt;
      }
    }, 1000 / this.tickRate);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Simulate instantly until `laps` more laps have been completed. */
  runLaps(laps: number): void {
    const target = this.lapIndex + laps;
    while (this.lapIndex < target) this.step(1 / this.tickRate);
  }

  runFor(seconds: number): void {
    for (let i = 0; i < seconds * this.tickRate; i++) this.step(1 / this.tickRate);
  }

  private step(dt: number): void {
    this.sessionTime += dt;
    this.lapTime += dt;
    if (this.lapTime >= this.profile.lapTime) this.completeLap();

    const s = this.sampleAt(this.lapTime);
    this.odometer += s.speed * dt;

    const sector = s.d < this.track.sectorEnds[0] ? 0 : s.d < this.track.sectorEnds[1] ? 1 : 2;
    if (sector !== this.sector) {
      this.lastSectorTime = this.lapTime - this.sectorStart;
      this.sectorStart = this.lapTime;
      this.sector = sector;
      this.emitTimeStats();
    }
    if (this.profile.invalidFrom !== null && s.d >= this.profile.invalidFrom) this.invalid = true;

    this.updateCar(dt, s);
    if (this.sessionTime >= this.nextSlowPacketsAt) {
      this.emitGameState();
      this.emitRace();
      this.nextSlowPacketsAt = this.sessionTime + 5;
    }
    if (this.sessionTime >= this.nextNamesAt) {
      this.emitNames();
      this.nextNamesAt = this.sessionTime + 10;
    }
    this.emitTelemetry(s);
    this.emitTimings(s);
  }

  private completeLap(): void {
    const finished = this.profile;
    this.completedLaps.push({ lap: this.lapIndex + 1, lapTime: finished.lapTime, valid: !this.invalid });
    this.lapTime -= finished.lapTime;
    this.lastLapTime = finished.lapTime;
    this.lastSectorTime = finished.lapTime - this.sectorStart;
    if (!this.invalid && this.lapIndex > 0 && (this.fastestLapTime < 0 || finished.lapTime < this.fastestLapTime)) {
      this.fastestLapTime = finished.lapTime;
    }
    this.sector = 0;
    this.sectorStart = 0;
    this.invalid = false;
    this.lapIndex++;
    this.profile = computeLap(this.track, this.corners, this.regionOf, this.planFor(this.lapIndex));
    this.emitTimeStats();
  }

  private chooseHabitCorners(): DemoHabits {
    const n = this.track.x.length;
    const count = this.corners.length;
    const ideal = computeLap(this.track, this.corners, this.regionOf, {
      grip: 1,
      power: 1,
      pitExit: false,
      corners: this.corners.map(() => ({ brake: 1, apex: 1, throttleDelay: 0, coast: 0, off: false })),
    });
    const drops = this.corners.map((corner, k) => {
      const prev = this.corners[(k - 1 + count) % count];
      let max = 0;
      for (let i = prev.apexIndex; i !== corner.apexIndex; i = (i + 1) % n) max = Math.max(max, ideal.v[i]);
      return max - ideal.v[corner.apexIndex];
    });
    const straightAfter = this.corners.map((c, k) => (this.corners[(k + 1) % count].apexIndex - c.apexIndex + n) % n);
    const taken = new Set<number>();
    const pick = (score: number[]) => {
      let best = -1;
      score.forEach((s, i) => {
        if (!taken.has(i) && (best < 0 || s > score[best])) best = i;
      });
      if (best >= 0) taken.add(best);
      return best;
    };
    return {
      lateBraking: pick(drops),
      lateThrottle: pick(straightAfter),
      slowApex: pick(drops.map((d) => -Math.abs(d - 10))),
      coasting: pick(drops),
      offTrack: pick(straightAfter.map((s) => -s)),
    };
  }

  private planFor(lap: number): LapPlan {
    const r = this.rng;
    const corners: CornerHabit[] = this.corners.map(() => ({
      brake: 0.93 + 0.07 * r(),
      apex: 0.975 + 0.025 * r(),
      throttleDelay: 6 * r(),
      coast: 0,
      off: false,
    }));
    if (lap === 0) {
      return { grip: 0.84, power: 0.8, pitExit: true, corners: corners.map((c) => ({ ...c, brake: 0.7, apex: 0.94 })) };
    }
    const set = (index: number, change: Partial<CornerHabit>) => {
      if (index >= 0) Object.assign(corners[index], change);
    };
    // Recurring habits, so the coach has something real to find.
    set(this.habits.lateBraking, r() < 0.75 ? { brake: 0.72 + 0.1 * r() } : { brake: 0.99 });
    set(this.habits.lateThrottle, r() < 0.7 ? { throttleDelay: 22 + 25 * r() } : { throttleDelay: 2 });
    set(this.habits.slowApex, r() < 0.6 ? { apex: 0.92 + 0.04 * r() } : { apex: 0.998 });
    set(this.habits.coasting, r() < 0.55 ? { coast: 30 + 25 * r() } : {});
    if (lap === 5) set(this.habits.offTrack, { off: true });
    const warm = Math.min(1, lap / 4);
    return { grip: 0.955 + 0.04 * warm + 0.006 * (r() - 0.5), power: 1, pitExit: false, corners };
  }

  private sampleAt(lapTime: number): Sample {
    const p = this.profile;
    const n = p.count;
    let lo = 0;
    let hi = n;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (p.t[mid] <= lapTime) lo = mid;
      else hi = mid;
    }
    const i = lo;
    const j = (i + 1) % n;
    const f = Math.max(0, Math.min(1, (lapTime - p.t[i]) / (p.t[i + 1] - p.t[i])));
    const lerp = (values: ArrayLike<number>) => values[i] + (values[j] - values[i]) * f;
    return {
      d: (i + f) * p.step,
      speed: lerp(p.v),
      throttle: lerp(p.throttle),
      brake: lerp(p.brake),
      steering: lerp(p.steering),
      gear: p.gear[i],
      rpm: lerp(p.rpm),
      latG: lerp(p.latG),
      lonG: lerp(p.lonG),
      off: p.off[i],
      x: lerp(this.track.x),
      z: lerp(this.track.z),
      heading: this.track.heading[i],
    };
  }

  private updateCar(dt: number, s: Sample): void {
    const load = Math.abs(s.latG) + Math.abs(s.lonG) * 0.7;
    for (let w = 0; w < 4; w++) {
      const front = w < 2;
      const left = w % 2 === 0;
      // Positive latG (left turn) loads the right-hand tyres; braking loads the fronts.
      const share = 0.25 + (left ? -1 : 1) * s.latG * 0.07 + (front ? -1 : 1) * s.lonG * 0.05;
      const heat = 1.6 * (0.35 + load * 4 * Math.max(0.05, share)) * (0.6 + s.speed / 80);
      this.tyreTemp[w] += dt * (heat - 0.045 * (this.tyreTemp[w] - 22));
      this.brakeTemp[w] += dt * (s.brake * s.speed * (front ? 4.5 : 3) - 0.1 * (this.brakeTemp[w] - 30));
      this.wear[w] = Math.min(1, this.wear[w] + dt * 0.00009 * (0.4 + load));
    }
    this.fuel = Math.max(0, this.fuel - dt * (0.003 + 0.045 * s.throttle));
  }

  private header(type: number, partial?: [number, number]): HeaderInput {
    this.categoryNumbers[type]++;
    return {
      packetNumber: ++this.packetNumber,
      categoryPacketNumber: this.categoryNumbers[type],
      partialPacketIndex: partial?.[0] ?? 1,
      partialPacketNumber: partial?.[1] ?? 1,
    };
  }

  private emitTelemetry(s: Sample): void {
    const wheelRps = s.speed / (2 * Math.PI * 0.33);
    this.emit(
      encodeTelemetry(this.header(PacketType.CarPhysics), {
        viewedParticipantIndex: 0,
        unfilteredThrottle: s.throttle * 255,
        unfilteredBrake: s.brake * 255,
        unfilteredSteering: s.steering * 127,
        carFlags: CarFlag.EngineActive,
        oilTempCelsius: 104,
        oilPressureKPa: 430,
        waterTempCelsius: 86,
        waterPressureKPa: 140,
        fuelPressureKPa: 380,
        fuelCapacity: 100,
        brake: s.brake * 255,
        throttle: s.throttle * 255,
        fuelLevel: this.fuel / 100,
        speed: s.speed,
        rpm: s.rpm,
        maxRpm: MAX_RPM,
        steering: s.steering * 127,
        gearNumGears: (6 << 4) | s.gear,
        odometerKm: this.odometer / 1000,
        orientation: [0, s.heading, 0],
        localVelocity: [0, 0, -s.speed],
        worldVelocity: [Math.cos(s.heading) * s.speed, 0, Math.sin(s.heading) * s.speed],
        localAcceleration: [s.latG * G, 0, -s.lonG * G],
        tyreFlags: [7, 7, 7, 7],
        terrain: s.off ? [7, 7, 7, 7] : [0, 0, 0, 0],
        tyreRps: [wheelRps, wheelRps, wheelRps, wheelRps],
        tyreTemp: [0, 1, 2, 3].map((w) => Math.round(this.tyreTemp[w])) as [number, number, number, number],
        tyreWear: [0, 1, 2, 3].map((w) => this.wear[w] * 255) as [number, number, number, number],
        brakeTempCelsius: [0, 1, 2, 3].map((w) => this.brakeTemp[w]) as [number, number, number, number],
        tyreTreadTemp: [0, 1, 2, 3].map((w) => this.tyreTemp[w] + 273.15) as [number, number, number, number],
        airPressure: [0, 1, 2, 3].map((w) => 138 + this.tyreTemp[w] * 0.5) as [number, number, number, number],
        engineSpeed: (s.rpm * Math.PI) / 30,
        tyreCompound: [COMPOUND, COMPOUND, COMPOUND, COMPOUND],
        fullPosition: [s.x, 0, s.z],
        brakeBias: 142,
        tickCount: Math.round(this.sessionTime * 1000),
      }),
    );
  }

  private emitTimings(s: Sample): void {
    this.emit(
      encodeTimings(this.header(PacketType.Timings), {
        numParticipants: 1,
        participantsChangedTimestamp: 1,
        eventTimeRemaining: Math.max(0, 3600 - this.sessionTime),
        splitTimeAhead: -1,
        splitTimeBehind: -1,
        localParticipantIndex: 0,
        tickCount: Math.round(this.sessionTime * 1000),
        participants: [
          packParticipantInfo({
            worldPosition: [s.x, 0, s.z],
            heading: s.heading,
            currentLapDistance: Math.floor(s.d),
            racePosition: 1,
            sector: this.sector + 1,
            raceStateIndex: 2,
            lapInvalidated: this.invalid,
            pitModeIndex: this.lapIndex === 0 && s.d < 260 ? 3 : 0,
            currentLap: this.lapIndex + 1,
            currentTime: this.lapTime,
            currentSectorTime: this.lapTime - this.sectorStart,
            isHuman: true,
          }),
        ],
      }),
    );
  }

  private emitTimeStats(): void {
    this.emit(
      encodeTimeStats(this.header(PacketType.TimeStats), {
        participantsChangedTimestamp: 1,
        participants: [
          {
            fastestLapTime: this.fastestLapTime,
            lastLapTime: this.lastLapTime,
            lastSectorTime: this.lastSectorTime,
            fastestSector1Time: -1,
            fastestSector2Time: -1,
            fastestSector3Time: -1,
          },
        ],
      }),
    );
  }

  private emitGameState(): void {
    this.emit(
      encodeGameState(this.header(PacketType.GameState), {
        buildVersionNumber: 1,
        gameState: packGameState(2, 1), // playing, practice
        ambientTemperature: 21,
        trackTemperature: 29,
        rainDensity: 0,
      }),
    );
  }

  private emitRace(): void {
    const t = this.track;
    this.emit(
      encodeRace(this.header(PacketType.RaceDefinition), {
        worldFastestLapTime: -1,
        personalFastestLapTime: this.fastestLapTime,
        trackLength: t.length,
        trackLocation: t.location,
        trackVariation: t.variation,
        translatedTrackLocation: t.location,
        translatedTrackVariation: t.variation,
        lapsTimeInEvent: 0x8000 | 12,
        enforcedPitStopLap: -1,
      }),
    );
  }

  private emitNames(): void {
    this.emit(encodeParticipants(this.header(PacketType.Participants), { name: ['You'], nationality: [0], index: [0] }));
    this.emit(
      encodeVehicleNames(this.header(PacketType.ParticipantVehicleNames, [1, 2]), [
        { index: 0, classIndex: 1, name: 'Demo GT3' },
      ]),
    );
    this.emit(encodeClassNames(this.header(PacketType.ParticipantVehicleNames, [2, 2]), [{ classIndex: 1, name: 'GT3' }]));
  }
}
