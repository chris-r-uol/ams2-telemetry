/**
 * Loads stored laps, resamples them onto a distance grid and runs the coaching
 * analysis, with small caches so the UI can click around freely.
 */
import { compareLaps, type LapComparison } from '../shared/analysis/coach.ts';
import { detectCorners, type Corner } from '../shared/analysis/corners.ts';
import { DEFAULT_STEP_METRES, resampleByDistance, type ResampledLap } from '../shared/analysis/resample.ts';
import { analyseSession, type AnalysedLap, type SessionInsights } from '../shared/analysis/session.ts';
import type { SessionMeta, StoredLap, TrackInfo } from '../shared/model/types.ts';
import type { SessionStore } from './storage.ts';

export interface Reference {
  source: 'session' | 'all-time';
  sessionId: string;
  lap: number;
  lapTime: number;
  resampled: ResampledLap;
}

export interface InsightsResult {
  insights: SessionInsights;
  corners: Corner[];
}

export interface ComparisonResult {
  lap: AnalysedLap;
  reference: AnalysedLap;
  corners: Corner[];
  comparison: LapComparison;
}

const LAP_CACHE_LIMIT = 150;

export function analyseStoredLap(stored: StoredLap, track: TrackInfo): AnalysedLap {
  const complete = stored.summary.kind !== 'partial' && stored.summary.lapTime !== null;
  return {
    summary: stored.summary,
    resampled: resampleByDistance(stored.trace, DEFAULT_STEP_METRES, complete ? track.length : undefined),
  };
}

export class AnalysisService {
  private readonly store: SessionStore;
  private readonly laps = new Map<string, AnalysedLap>();
  private readonly insightCache = new Map<string, { updatedAt: number; lapCount: number; result: InsightsResult }>();
  private liveSession: () => SessionMeta | null = () => null;

  constructor(store: SessionStore) {
    this.store = store;
  }

  setLiveSessionProvider(provider: () => SessionMeta | null): void {
    this.liveSession = provider;
  }

  session(id: string): SessionMeta | null {
    const live = this.liveSession();
    return live && live.id === id ? live : this.store.get(id);
  }

  remember(sessionId: string, lap: AnalysedLap): void {
    this.put(`${sessionId}:${lap.summary.lap}`, lap);
  }

  forget(sessionId: string): void {
    for (const key of [...this.laps.keys()]) if (key.startsWith(`${sessionId}:`)) this.laps.delete(key);
    this.insightCache.delete(sessionId);
  }

  lap(sessionId: string, lapNumber: number): AnalysedLap | null {
    const key = `${sessionId}:${lapNumber}`;
    const cached = this.laps.get(key);
    if (cached) {
      this.put(key, cached);
      return cached;
    }
    const session = this.session(sessionId);
    const stored = session ? this.store.loadLap(sessionId, lapNumber) : null;
    if (!session || !stored) return null;
    const analysed = analyseStoredLap(stored, session.track);
    this.put(key, analysed);
    return analysed;
  }

  insights(sessionId: string): InsightsResult | null {
    const session = this.session(sessionId);
    if (!session) return null;
    const cached = this.insightCache.get(sessionId);
    if (cached && cached.updatedAt === session.updatedAt && cached.lapCount === session.laps.length) return cached.result;
    const laps = session.laps
      .map((summary) => this.lap(sessionId, summary.lap))
      .filter((lap): lap is AnalysedLap => lap !== null);
    const insights = analyseSession(laps);
    const result = { insights, corners: insights.corners.map((c) => c.corner) };
    this.insightCache.set(sessionId, { updatedAt: session.updatedAt, lapCount: session.laps.length, result });
    return result;
  }

  compare(sessionId: string, lapNumber: number, refSessionId: string, refLapNumber: number): ComparisonResult | null {
    const lap = this.lap(sessionId, lapNumber);
    const reference = this.lap(refSessionId, refLapNumber);
    if (!lap || !reference) return null;
    // Reuse the session's corner numbering so T4 means the same corner everywhere.
    const sessionCorners = this.insights(refSessionId)?.corners ?? [];
    const corners = sessionCorners.length ? sessionCorners : detectCorners(reference.resampled);
    return {
      lap,
      reference,
      corners,
      comparison: compareLaps(lap.resampled, reference.resampled, corners, refLapNumber),
    };
  }

  bestReference(track: TrackInfo, car: string, excludeSessionId?: string): Reference | null {
    const best = this.store.bestLap(track, car, excludeSessionId);
    if (!best || best.summary.lapTime === null) return null;
    const lap = this.lap(best.session.id, best.summary.lap);
    if (!lap) return null;
    return {
      source: 'all-time',
      sessionId: best.session.id,
      lap: best.summary.lap,
      lapTime: best.summary.lapTime,
      resampled: lap.resampled,
    };
  }

  private put(key: string, value: AnalysedLap): void {
    this.laps.delete(key);
    this.laps.set(key, value);
    while (this.laps.size > LAP_CACHE_LIMIT) {
      const oldest = this.laps.keys().next().value;
      if (oldest === undefined) break;
      this.laps.delete(oldest);
    }
  }
}
