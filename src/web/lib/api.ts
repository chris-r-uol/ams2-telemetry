import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChassisAnalysis } from '../../shared/analysis/chassis.ts';
import type { CoachTip, LapComparison } from '../../shared/analysis/coach.ts';
import type { Corner } from '../../shared/analysis/corners.ts';
import type { CornerGripSummary, GripEnvelope, GripRun } from '../../shared/analysis/grip.ts';
import type { ResampledLap } from '../../shared/analysis/resample.ts';
import type { SessionInsights } from '../../shared/analysis/session.ts';
import type { LapSummary, SessionMeta, SourceStatus } from '../../shared/model/types.ts';

export interface AnalysedLapDto {
  summary: LapSummary;
  resampled: ResampledLap;
}

export interface InsightsDto {
  insights: SessionInsights;
  corners: Corner[];
}

export interface CompareDto {
  lap: AnalysedLapDto;
  reference: AnalysedLapDto;
  corners: Corner[];
  comparison: LapComparison;
}

export interface ChassisDto {
  analysis: ChassisAnalysis;
  corners: Corner[];
}

export interface GripDto {
  envelope: GripEnvelope | null;
  lapsAnalysed: number;
  corners: CornerGripSummary[];
}

export interface GripLapDto {
  lap: number;
  corners: {
    cornerId: number;
    corner: string;
    apex: number;
    from: number;
    step: number;
    bestLap: number | null;
    run: GripRun;
    best: GripRun | null;
  }[];
}

export interface LiveReferenceDto {
  source: 'session' | 'all-time';
  sessionId: string;
  lap: number;
  lapTime: number;
  resampled: ResampledLap;
  corners: Corner[];
}

export type { CoachTip, SessionMeta, SourceStatus };

export const api = {
  sessions: () => '/api/sessions',
  session: (id: string) => `/api/sessions/${encodeURIComponent(id)}`,
  lap: (id: string, lap: number) => `/api/sessions/${encodeURIComponent(id)}/laps/${lap}`,
  insights: (id: string) => `/api/sessions/${encodeURIComponent(id)}/insights`,
  compare: (session: string, lap: number, refSession: string, refLap: number) =>
    `/api/compare?${new URLSearchParams({ session, lap: String(lap), refSession, refLap: String(refLap) })}`,
  liveReference: () => '/api/live/reference',
  sessionExport: (id: string) => `/api/sessions/${encodeURIComponent(id)}/export`,
  recordings: () => '/api/recordings',
  recording: (name: string) => `/api/recordings/${encodeURIComponent(name)}`,
  recordingStart: () => '/api/recordings/start',
  recordingStop: () => '/api/recordings/stop',
  recordingSettings: () => '/api/recordings/settings',
  sessionCar: (id: string) => `/api/sessions/${encodeURIComponent(id)}/car`,
  sourceSpeed: () => '/api/source/speed',
  sourcePause: () => '/api/source/pause',
  replay: () => '/api/replay',
  chassis: (id: string) => `/api/sessions/${encodeURIComponent(id)}/chassis`,
  chassisLap: (id: string, lap: number) => `/api/sessions/${encodeURIComponent(id)}/chassis/laps/${lap}`,
  grip: (id: string) => `/api/sessions/${encodeURIComponent(id)}/grip`,
  gearing: (id: string) => `/api/sessions/${encodeURIComponent(id)}/gearing`,
  trackUse: (id: string) => `/api/sessions/${encodeURIComponent(id)}/track-use`,
  gripLap: (id: string, lap: number) => `/api/sessions/${encodeURIComponent(id)}/grip/laps/${lap}`,
};

export async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

/** Send a change to the server. Always JSON: the server rejects anything else. */
export function sendJson<T>(path: string, method: 'POST' | 'PUT' | 'DELETE', body: unknown = {}): Promise<T> {
  return getJson<T>(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

export interface ApiResult<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Fetch JSON for a path. While refetching, the previous data stays on screen
 * (no skeleton flash). Pass `null` to skip fetching.
 */
export function useApi<T>(path: string | null, refreshKey: unknown = 0): ApiResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [nonce, setNonce] = useState(0);
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    if (path === null) {
      setData(null);
      setLoading(false);
      return;
    }
    if (lastPath.current !== path) setData(null);
    lastPath.current = path;
    const controller = new AbortController();
    setLoading(true);
    getJson<T>(path, { signal: controller.signal })
      .then((value) => {
        setData(value);
        setError(null);
      })
      .catch((err: Error) => {
        if (err.name !== 'AbortError') setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path, refreshKey, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload };
}
