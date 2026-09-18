/**
 * Coaching that shouldn't be thrown by one-offs: tyre warnings against where the
 * tyres usually run, and habits that leave out being hit or spinning.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AnalysisService } from '../src/server/analysis-service.ts';
import { DemoSimulator } from '../src/server/demo/simulator.ts';
import { SessionManager } from '../src/server/session-manager.ts';
import { SessionStore } from '../src/server/storage.ts';
import { TelemetryHub } from '../src/server/telemetry/hub.ts';
import { analyseSession, type AnalysedLap } from '../src/shared/analysis/session.ts';
import type { LapSummary, LiveFrame, SessionMeta } from '../src/shared/model/types.ts';
import type { Settings } from '../src/web/lib/settings.ts';
import { tyreReadings, usualTyreTemps } from '../src/web/lib/tyres.ts';

// The settings module needs a browser; only these two fields matter here.
const DEFAULT_SETTINGS = { tyreWindowMode: 'auto', tyreWindow: [80, 100] } as Settings;

describe('tyre temperatures', () => {
  const lap = (kind: LapSummary['kind'], temp: number) => ({ kind, tyreTempAvg: [temp, temp, temp + 4, temp + 4] }) as LapSummary;
  const session = { laps: [lap('out', 45), lap('flying', 70), lap('flying', 72), lap('flying', 71)] } as SessionMeta;
  const frame = (temps: number[]) => ({ tyres: { tempC: temps } }) as unknown as LiveFrame;

  it('learns where each tyre usually runs from flying laps only', () => {
    expect(usualTyreTemps(session.laps)).toEqual([71, 71, 75, 75]);
    expect(usualTyreTemps(session.laps.slice(0, 2))).toEqual([null, null, null, null]);
  });

  it('flags a tyre well away from its usual temperature, not one that runs cooler than a textbook window', () => {
    const readings = tyreReadings(frame([71, 50, 95, 75]), session, DEFAULT_SETTINGS);
    expect(readings.map((r) => r.state)).toEqual(['ok', 'cold', 'hot', 'ok']);
    const fixed = tyreReadings(frame([71, 50, 95, 75]), session, { ...DEFAULT_SETTINGS, tyreWindowMode: 'fixed' });
    expect(fixed.map((r) => r.state)).toEqual(['cold', 'cold', 'ok', 'cold']);
  });

  it("doesn't flag anything before there are two flying laps to learn from", () => {
    const early = { laps: session.laps.slice(0, 2) } as SessionMeta;
    expect(tyreReadings(frame([40, 40, 40, 40]), early, DEFAULT_SETTINGS).every((r) => r.state === 'ok')).toBe(true);
  });
});

describe('habits leave out contact and spins', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ams2-coach-habits-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const hub = new TelemetryHub();
  const store = new SessionStore(dir);
  const analysis = new AnalysisService(store);
  const manager = new SessionManager(hub, store, analysis, 'demo');
  new DemoSimulator((bytes) => hub.ingest(bytes), { seed: 11 }).runLaps(7);
  const session = manager.session!;
  const laps = session.laps.map((l) => analysis.lap(session.id, l.lap)).filter((l): l is AnalysedLap => l !== null);
  const before = analyseSession(laps);

  it('drops a corner run that was disturbed from its habits and typical time', () => {
    const habit = before.habits[0];
    expect(habit).toBeDefined();
    const corner = before.corners.find((c) => c.corner.id === habit.cornerId)!.corner;
    // Say one of the other laps was hit in that corner.
    const clean = laps.filter((l) => l.summary.valid && l.summary.kind === 'flying');
    const hitLap = clean.find((l) => l.summary.lap !== before.corners.find((c) => c.corner.id === corner.id)!.bestLap)!;
    const incidents = new Map([[hitLap.summary.lap, [[corner.apex - 20, corner.apex + 20] as [number, number]]]]);
    const after = analyseSession(laps, undefined, incidents);

    const judged = (insights: typeof before) => insights.habits.filter((h) => h.cornerId === corner.id);
    for (const h of judged(after)) expect(h.outOf).toBe(habit.outOf - 1);
    expect(after.corners.find((c) => c.corner.id === corner.id)!.meanTime).not.toBe(
      before.corners.find((c) => c.corner.id === corner.id)!.meanTime,
    );
    expect(after.consistency!.laps).toBe(before.consistency!.laps - 1);
  });
});
