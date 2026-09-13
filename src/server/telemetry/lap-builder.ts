/**
 * Slices the tick stream into laps.
 *
 * Lap boundaries come from the game's lap counter. The official lap time comes
 * from the time-stats packet when it arrives in time, otherwise it is
 * estimated from the lap clock to within one tick.
 */
import { emptyTrace, type LapKind, type LapSummary, type LapTrace, type Quad } from '../../shared/model/types.ts';
import type { Tick } from './hub.ts';

export interface CompletedLap {
  summary: LapSummary;
  trace: LapTrace;
}

interface LapInProgress {
  lap: number;
  startedAt: number;
  trace: LapTrace;
  startedAtLine: boolean;
  startedInPit: boolean;
  enteredPit: boolean;
  invalid: boolean;
  lastT: number;
  lastD: number;
  sector: number | null;
  splits: number[];
  topSpeed: number;
  tyreTempSum: Quad;
  tyrePressureSum: Quad;
  tyreSamples: number;
  tyreWear: Quad;
  fuelStart: number | null;
  fuelEnd: number | null;
  offTrackCount: number;
  wasOff: boolean;
}

function pushSample(tr: LapTrace, t: number, d: number, tick: Tick): void {
  tr.t.push(t);
  tr.d.push(d);
  tr.speed.push(tick.speed);
  tr.throttle.push(tick.throttle);
  tr.brake.push(tick.brake);
  tr.steering.push(tick.steering);
  tr.gear.push(tick.gear);
  tr.rpm.push(tick.rpm);
  tr.x.push(tick.x);
  tr.z.push(tick.z);
  tr.latG.push(tick.latG);
  tr.lonG.push(tick.lonG);
  tr.off.push(tick.offWheels);
}

const LEAVING_PITS = new Set(['inPit', 'drivingOutOfPits', 'inGarage', 'drivingOutOfGarage']);
const ENTERING_PITS = new Set(['drivingIntoPits', 'inPit']);
const OFFICIAL_TIME_TOLERANCE = 0.75;

export class LapBuilder {
  trackLength = 0;

  private current: LapInProgress | null = null;
  private pending: { lap: LapInProgress; estimate: number; official: number | null } | null = null;
  private recentOfficial: number | null = null;
  private tickInterval = 1 / 60;

  get lap(): number | null {
    return this.current?.lap ?? null;
  }

  /** Smoothed distance into the current lap, metres. */
  get distance(): number {
    const d = this.current?.lastD ?? 0;
    return Number.isFinite(d) ? Math.max(0, d) : 0;
  }

  /** True when the current lap started at the line from the circuit (so a delta makes sense). */
  get isTimedLap(): boolean {
    return !!this.current && this.current.startedAtLine && !this.current.startedInPit;
  }

  get sectorNumber(): number {
    return Math.min(3, (this.current?.splits.length ?? 0) + 1);
  }

  get currentInvalid(): boolean {
    return this.current?.invalid ?? false;
  }

  reset(): void {
    this.current = null;
    this.pending = null;
    this.recentOfficial = null;
  }

  officialLapTime(time: number): void {
    if (!(time > 0)) return;
    if (this.pending) {
      if (Math.abs(time - this.pending.estimate) < OFFICIAL_TIME_TOLERANCE) this.pending.official = time;
    } else {
      // Time stats can arrive just before the timing packet that bumps the lap counter.
      this.recentOfficial = time;
    }
  }

  push(tick: Tick): CompletedLap | null {
    let completed = this.flushPending(tick);
    const cur = this.current;

    if (cur && tick.lap === cur.lap) {
      if (tick.lapTime + 1 < cur.lastT) this.current = this.begin(tick); // lap clock reset (restart)
      this.append(this.current!, tick);
      return completed;
    }

    if (cur && tick.lap === cur.lap + 1 && cur.trace.t.length > 0) {
      if (this.pending) completed = this.finalise(this.pending.lap, this.pending.official ?? this.pending.estimate);
      const estimate = Math.max(cur.lastT, cur.lastT + this.tickInterval - Math.max(0, tick.lapTime));
      const official =
        this.recentOfficial !== null && Math.abs(this.recentOfficial - estimate) < OFFICIAL_TIME_TOLERANCE
          ? this.recentOfficial
          : null;
      this.pending = { lap: cur, estimate, official };
      this.recentOfficial = null;
    }

    this.current = this.begin(tick);
    this.append(this.current, tick);
    return completed;
  }

  private flushPending(tick: Tick): CompletedLap | null {
    const p = this.pending;
    if (!p) return null;
    if (p.official !== null || tick.lapTime > OFFICIAL_TIME_TOLERANCE || tick.lap !== p.lap.lap + 1) {
      this.pending = null;
      return this.finalise(p.lap, p.official ?? p.estimate);
    }
    return null;
  }

  private begin(tick: Tick): LapInProgress {
    return {
      lap: tick.lap,
      startedAt: tick.at,
      trace: emptyTrace(),
      startedAtLine: false,
      startedInPit: false,
      enteredPit: false,
      invalid: false,
      lastT: -Infinity,
      lastD: -Infinity,
      sector: null,
      splits: [],
      topSpeed: 0,
      tyreTempSum: [0, 0, 0, 0],
      tyrePressureSum: [0, 0, 0, 0],
      tyreSamples: 0,
      tyreWear: [0, 0, 0, 0],
      fuelStart: null,
      fuelEnd: null,
      offTrackCount: 0,
      wasOff: false,
    };
  }

  private append(lap: LapInProgress, tick: Tick): void {
    const t = tick.lapTime;
    const first = lap.trace.t.length === 0;
    if (first) {
      // Just after the line the game can still report last lap's distance for a moment.
      if (this.trackLength > 0 && tick.lapDistance > this.trackLength * 0.5 && t < 5) return;
      lap.startedAtLine = t < 3 && tick.lapDistance < 150;
      lap.startedInPit = LEAVING_PITS.has(tick.pitMode);
      lap.fuelStart = tick.fuelLitres;
    } else if (!lap.startedInPit && ENTERING_PITS.has(tick.pitMode)) {
      lap.enteredPit = true;
    }
    lap.invalid ||= tick.lapInvalidated;

    if (t <= lap.lastT) return; // duplicate or paused
    if (!first) {
      const dt = t - lap.lastT;
      if (dt > 0 && dt < 0.5) this.tickInterval = this.tickInterval * 0.9 + dt * 0.1;
    }

    // The game only sends whole metres, and at speed the car covers more than a
    // metre per tick. Dead-reckon from speed, then keep the estimate inside the
    // metre the game reported so it can never drift.
    const whole = tick.lapDistance;
    let d = first ? whole : lap.lastD + tick.speed * (t - lap.lastT);
    if (!(d >= whole)) d = whole;
    else if (d > whole + 0.999) d = whole + 0.999;
    if (d < lap.lastD && lap.lastD - d < 2) d = lap.lastD;

    if (lap.sector === null || t < 1) {
      lap.sector = tick.sector;
    } else if (tick.sector !== lap.sector) {
      lap.splits.push(t);
      lap.sector = tick.sector;
    }

    if (first && lap.startedAtLine && t > 0) {
      // The game's lap clock and lap distance both start at the line: anchor the trace there.
      pushSample(lap.trace, 0, 0, tick);
    }
    pushSample(lap.trace, t, d, tick);

    lap.topSpeed = Math.max(lap.topSpeed, tick.speed);
    for (let w = 0; w < 4; w++) {
      lap.tyreTempSum[w] += tick.tyreTempC[w];
      lap.tyrePressureSum[w] += tick.tyrePressureKPa[w];
    }
    lap.tyreSamples++;
    lap.tyreWear = tick.tyreWear;
    lap.fuelEnd = tick.fuelLitres;
    const isOff = tick.offWheels >= 2;
    if (isOff && !lap.wasOff) lap.offTrackCount++;
    lap.wasOff = isOff;
    lap.lastT = t;
    lap.lastD = d;
  }

  private finalise(lap: LapInProgress, lapTime: number): CompletedLap {
    const tr = lap.trace;
    const n = tr.t.length;
    if (n > 0 && this.trackLength > 0 && lap.startedAtLine && lap.lastD > this.trackLength - 150 && lapTime > lap.lastT) {
      // Close the trace exactly on the line so distance-based comparisons line up.
      for (const values of Object.values(tr)) values.push(values[n - 1]);
      tr.t[n] = lapTime;
      tr.d[n] = Math.max(this.trackLength, tr.d[n - 1]);
    }

    const kind: LapKind = lap.startedInPit ? 'out' : lap.enteredPit ? 'in' : lap.startedAtLine ? 'flying' : 'partial';
    const [s1, s2] = lap.splits;
    const sectors: LapSummary['sectors'] =
      lap.splits.length === 2 && s2 > s1 && lapTime > s2 ? [s1, s2 - s1, lapTime - s2] : [null, null, null];
    const samples = Math.max(1, lap.tyreSamples);

    return {
      trace: tr,
      summary: {
        lap: lap.lap,
        lapTime: lapTime > 0 ? lapTime : null,
        sectors,
        valid: !lap.invalid,
        kind,
        startedAt: lap.startedAt,
        topSpeed: lap.topSpeed,
        fuelUsed:
          lap.fuelStart !== null && lap.fuelEnd !== null && lap.fuelStart >= lap.fuelEnd
            ? lap.fuelStart - lap.fuelEnd
            : null,
        tyreTempAvg: lap.tyreTempSum.map((v) => v / samples) as Quad,
        tyrePressureAvg: lap.tyrePressureSum.map((v) => v / samples) as Quad,
        tyreWear: lap.tyreWear,
        offTrackCount: lap.offTrackCount,
        sampleCount: tr.t.length,
      },
    };
  }
}
