/**
 * Mid-lap coaching. Reports each corner the moment you've driven it (time,
 * balance, grip events, what to change), keeps a plan for the corners ahead
 * from your best runs, and tracks balance while you're cornering.
 */
import {
  analyseRun,
  bodySlipAngle,
  calibrate,
  neutralSteering,
  type ChannelAvailability,
  type ChassisCalibration,
  type RunAnalysis,
} from '../shared/analysis/chassis.ts';
import { tipsForCorner } from '../shared/analysis/coach.ts';
import type { Corner } from '../shared/analysis/corners.ts';
import { cornerMetrics } from '../shared/analysis/metrics.ts';
import { lapLength, resampleByDistance, valueAt, type ResampledLap } from '../shared/analysis/resample.ts';
import { coachableLaps, type AnalysedLap } from '../shared/analysis/session.ts';
import type {
  CornerPlan,
  CornerProfile,
  CornerReport,
  LapFeedback,
  LapSummary,
  LapTrace,
  LiveCoachFrame,
  LiveEvent,
  LiveInsights,
} from '../shared/model/types.ts';
import type { AnalysisService } from './analysis-service.ts';
import type { SessionManager } from './session-manager.ts';
import type { Tick } from './telemetry/hub.ts';

/** Laps kept for calibrating steering and wheel radius. */
const CALIBRATION_LAPS = 6;
/** Per-tick smoothing of the live balance reading (~0.1 s at 60 Hz). */
const BALANCE_SMOOTHING = 0.15;
/** Ticks without cornering before the balance reading clears. */
const STRAIGHT_TICKS = 20;
const PROFILE_STEP = 2;

export class LiveCoach {
  private readonly manager: SessionManager;
  private readonly analysis: AnalysisService;
  private readonly listeners = new Set<(insights: LiveInsights) => void>();
  private recentLaps: { summary: LapSummary; trace: LapTrace }[] = [];
  private calibration: { availability: ChannelAvailability; calibration: ChassisCalibration } | null = null;
  private sessionId: string | null = null;
  private lap = -1;
  private done = new Set<number>();
  private previous: { lap: number; done: Set<number> } | null = null;
  private reports: CornerReport[] = [];
  private events: LiveEvent[] = [];
  private lastCorner: CornerReport | null = null;
  private plans: CornerPlan[] = [];
  private idealLapTime: number | null = null;
  private balance: number | null = null;
  private straightTicks = 0;

  constructor(manager: SessionManager, analysis: AnalysisService) {
    this.manager = manager;
    this.analysis = analysis;
    manager.onSession((session) => {
      if (session.id !== this.sessionId) this.resetSession(session.id);
    });
    manager.onTickProcessed((tick) => this.handleTick(tick));
    manager.onLap((summary, feedback, trace) => this.handleLap(summary, feedback, trace));
  }

  onInsights(listener: (insights: LiveInsights) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  insights(): LiveInsights {
    return {
      sessionId: this.sessionId,
      lap: this.lap,
      balanceReady: this.calibration?.calibration.steerPerCurvature != null,
      gripReady: this.calibration?.calibration.wheelRadius.some((r) => r !== null) ?? false,
      corners: this.manager.corners.map((c) => ({
        cornerId: c.id,
        corner: c.name,
        timeDelta: this.reports.find((r) => r.cornerId === c.id)?.timeDelta ?? null,
        done: this.done.has(c.id),
      })),
      lastCorner: this.lastCorner,
      events: this.events,
      plans: this.plans,
      idealLapTime: this.idealLapTime,
    };
  }

  frame(): LiveCoachFrame {
    const d = this.manager.lapDistance;
    const length = this.manager.session?.track.length ?? 0;
    const ahead = (x: number) => (x >= d ? x - d : length > 0 ? x + length - d : null);
    const upcoming = this.plans.find((p) => p.apex > d + 5 && !this.done.has(p.cornerId));
    const next = upcoming ?? this.plans[0] ?? null;
    const wrapped = next !== null && upcoming === undefined;
    let brakeIn: number | null = null;
    if (next?.bestBrakePoint != null) {
      brakeIn = wrapped ? ahead(next.bestBrakePoint) : next.bestBrakePoint > d ? next.bestBrakePoint - d : null;
    }
    return {
      balance: this.balance,
      currentCornerId: this.plans.find((p) => d >= p.entry && d <= p.exit)?.cornerId ?? null,
      nextCornerId: next?.cornerId ?? null,
      toApex: next ? (wrapped ? ahead(next.apex) : next.apex - d) : null,
      brakeIn,
    };
  }

  private resetSession(sessionId: string): void {
    this.sessionId = sessionId;
    this.recentLaps = [];
    this.calibration = null;
    this.lap = -1;
    this.done = new Set();
    this.previous = null;
    this.reports = [];
    this.events = [];
    this.lastCorner = null;
    this.plans = [];
    this.idealLapTime = null;
    this.balance = null;
    this.emit();
  }

  private handleTick(tick: Tick): void {
    if (tick.lap !== this.lap) {
      this.previous = this.lap >= 0 ? { lap: this.lap, done: this.done } : null;
      this.lap = tick.lap;
      this.done = new Set();
      this.reports = [];
      this.events = [];
      this.emit();
    }
    this.updateBalance(tick);

    const d = this.manager.lapDistance;
    const trace = this.manager.currentTrace;
    if (!trace) return;
    for (const corner of this.manager.corners) {
      // Report once, just after the exit. Don't report corners far behind if we joined mid-lap.
      if (this.done.has(corner.id) || d < corner.exit || d - corner.exit > 150) continue;
      this.done.add(corner.id);
      this.report(corner, trace, tick.lap, true);
    }
  }

  private handleLap(summary: LapSummary, feedback: LapFeedback, trace: LapTrace): void {
    // A corner just before the line can finish after the lap counter has already ticked over.
    const previous = this.previous;
    if (previous && previous.lap === summary.lap && trace.d.length) {
      const lastD = trace.d[trace.d.length - 1];
      for (const corner of this.manager.corners) {
        if (previous.done.has(corner.id) || corner.apex >= lastD) continue;
        previous.done.add(corner.id);
        this.report(corner, trace, summary.lap, false);
      }
    }

    if (summary.kind !== 'partial') {
      this.recentLaps = [...this.recentLaps, { summary, trace }].slice(-CALIBRATION_LAPS);
      this.calibration = calibrate(this.recentLaps);
    }
    this.rebuildPlans(feedback);
    this.emit();
  }

  private updateBalance(tick: Tick): void {
    const cal = this.calibration?.calibration ?? null;
    const need = cal ? neutralSteering(cal, tick.yawRate, tick.speed) : NaN;
    // Steering already the other way without a slide is a change of direction, not balance.
    const changingDirection =
      cal !== null &&
      cal.slideSlipAngle !== null &&
      tick.steering * need < 0 &&
      bodySlipAngle(tick.vLat, tick.vLon, cal.velocityAxesSwapped) < cal.slideSlipAngle;
    if (!(Math.abs(need) >= 0.03) || changingDirection) {
      if (++this.straightTicks > STRAIGHT_TICKS) this.balance = null;
      return;
    }
    this.straightTicks = 0;
    const ratio = Math.max(-1, Math.min(1, ((tick.steering - need) * Math.sign(need)) / Math.abs(need)));
    this.balance = this.balance === null ? ratio : this.balance + (ratio - this.balance) * BALANCE_SMOOTHING;
  }

  /** Your fastest run through a corner this session, from braking zone to exit. */
  private bestRun(corner: Corner, excludeLap: number): { lap: AnalysedLap; time: number } | null {
    let best: { lap: AnalysedLap; time: number } | null = null;
    for (const lap of coachableLaps(this.manager.analysedLaps)) {
      if (lap.summary.lap === excludeLap) continue;
      const time = through(lap.resampled, corner);
      if (Number.isFinite(time) && (!best || time < best.time)) best = { lap, time };
    }
    return best;
  }

  private report(corner: Corner, trace: LapTrace, lap: number, current: boolean): void {
    const run = resampleByDistance(trace);
    if (run.t.length < 10 || lapLength(run) < corner.exit) return;
    const runTime = through(run, corner);
    const reference = this.manager.reference?.resampled ?? null;
    const timed = current ? this.manager.timedLap : true;
    const best = this.bestRun(corner, lap);
    const metrics = cornerMetrics(run, corner);
    const bestMetrics = best ? cornerMetrics(best.lap.resampled, corner) : null;
    const vsBest = best ? runTime - best.time : null;
    const [tip] =
      bestMetrics && vsBest !== null ? tipsForCorner(corner, metrics, bestMetrics, vsBest, best!.lap.summary.lap) : [];
    const chassis = this.calibration
      ? analyseRun(trace, corner, this.calibration.availability, this.calibration.calibration, lap)
      : null;
    const events: LiveEvent[] = (chassis?.events ?? []).map((e) => ({
      kind: e.kind,
      wheel: e.wheel,
      corner: corner.name,
      distance: e.distance,
      lap,
    }));

    const report: CornerReport = {
      lap,
      cornerId: corner.id,
      corner: corner.name,
      timeDelta: reference && timed ? runTime - through(reference, corner) : null,
      vsBest,
      bestLap: best?.lap.summary.lap ?? null,
      phases: chassis && this.calibration?.calibration.steerPerCurvature != null ? chassis.phases : null,
      minSpeed: metrics.minSpeed,
      bestMinSpeed: bestMetrics?.minSpeed ?? null,
      brakeEarlierBy:
        metrics.brakePoint !== null && bestMetrics?.brakePoint != null ? bestMetrics.brakePoint - metrics.brakePoint : null,
      throttleLaterBy:
        metrics.throttlePoint !== null && bestMetrics?.throttlePoint != null
          ? metrics.throttlePoint - bestMetrics.throttlePoint
          : null,
      exitSpeed: metrics.exitSpeed,
      bestExitSpeed: bestMetrics?.exitSpeed ?? null,
      slipAngle: chassis?.slipAngle ?? null,
      events,
      tip: tip ?? null,
      profile: profileFor(corner, run, best?.lap.resampled ?? null, chassis, metrics.brakePoint, bestMetrics?.brakePoint ?? null),
    };

    if (current) {
      this.reports.push(report);
      this.events = [...this.events, ...events];
    }
    this.lastCorner = report;
    this.emit();
  }

  private rebuildPlans(feedback: LapFeedback): void {
    const session = this.sessionId ? this.analysis.insights(this.sessionId) : null;
    this.idealLapTime = session?.insights.idealLapTime ?? null;
    const habits = session?.insights.habits ?? [];
    const focus = session?.insights.focus ?? [];
    this.plans = this.manager.corners.map((corner) => {
      const best = this.bestRun(corner, -1);
      const bestMetrics = best ? cornerMetrics(best.lap.resampled, corner) : null;
      return {
        cornerId: corner.id,
        corner: corner.name,
        entry: corner.entry,
        apex: corner.apex,
        exit: corner.exit,
        bestLap: best?.lap.summary.lap ?? null,
        bestBrakePoint: bestMetrics?.brakePoint ?? null,
        bestMinSpeed: bestMetrics?.minSpeed ?? null,
        tip: feedback.tips.find((t) => t.cornerId === corner.id) ?? focus.find((t) => t.cornerId === corner.id) ?? null,
        habit: habits.find((h) => h.cornerId === corner.id) ?? null,
      };
    });
  }

  private emit(): void {
    if (this.listeners.size === 0) return;
    const insights = this.insights();
    for (const listener of this.listeners) listener(insights);
  }
}

/** Seconds from a corner's braking zone to its exit. */
function through(lap: ResampledLap, corner: Corner): number {
  return valueAt(lap, 't', corner.exit) - valueAt(lap, 't', corner.entry);
}

function profileFor(
  corner: Corner,
  run: ResampledLap,
  best: ResampledLap | null,
  chassis: RunAnalysis | null,
  brakeAt: number | null,
  bestBrakeAt: number | null,
): CornerProfile {
  const from = Math.max(0, corner.entry - 40);
  const speed: (number | null)[] = [];
  const bestSpeed: (number | null)[] = [];
  const balance: (number | null)[] = [];
  const throttle: (number | null)[] = [];
  const brake: (number | null)[] = [];
  const steering: (number | null)[] = [];
  const bestSteering: (number | null)[] = [];
  const x: (number | null)[] = [];
  const z: (number | null)[] = [];
  const bestX: (number | null)[] = [];
  const bestZ: (number | null)[] = [];
  const pedal = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null);
  const finite = (value: number) => (Number.isFinite(value) ? value : null);
  let j = 0;
  for (let d = from; d <= corner.exit; d += PROFILE_STEP) {
    speed.push(valueAt(run, 'speed', d));
    bestSpeed.push(best ? valueAt(best, 'speed', d) : null);
    throttle.push(pedal(valueAt(run, 'throttle', d)));
    brake.push(pedal(valueAt(run, 'brake', d)));
    steering.push(finite(valueAt(run, 'steering', d)));
    bestSteering.push(best ? finite(valueAt(best, 'steering', d)) : null);
    x.push(finite(valueAt(run, 'x', d)));
    z.push(finite(valueAt(run, 'z', d)));
    bestX.push(best ? finite(valueAt(best, 'x', d)) : null);
    bestZ.push(best ? finite(valueAt(best, 'z', d)) : null);
    if (chassis && chassis.d.length) {
      while (j < chassis.d.length - 1 && Math.abs(chassis.d[j + 1] - d) <= Math.abs(chassis.d[j] - d)) j++;
      const value = chassis.balance[j];
      balance.push(Math.abs(chassis.d[j] - d) <= 4 && Number.isFinite(value) ? value : null);
    } else {
      balance.push(null);
    }
  }
  return {
    from,
    step: PROFILE_STEP,
    speed,
    bestSpeed,
    balance,
    throttle,
    brake,
    steering,
    bestSteering,
    x,
    z,
    bestX,
    bestZ,
    apex: corner.apex,
    brakeAt,
    bestBrakeAt,
  };
}
