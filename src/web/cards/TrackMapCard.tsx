/**
 * The track map with your car on it, for the Live grid. It scales to whatever
 * cell it's given, so both sizes show the same map.
 */
import { useMemo } from 'react';
import type { LapFeedback } from '../../shared/model/types.ts';
import { TrackMap, type MapSegment } from '../components/TrackMap.tsx';
import { api, useApi, type LiveReferenceDto } from '../lib/api.ts';
import { useLive } from '../lib/live.ts';
import { useSettings } from '../lib/settings.ts';
import { LiveCard, type CardSize } from './parts.tsx';

/** The reference lap the map is drawn from, refetched when the session or reference changes. */
export function useLiveReference(): LiveReferenceDto | null {
  const sessionId = useLive((s) => s.frame?.sessionId ?? null);
  const referenceKey = useLive((s) => `${s.frame?.referenceSource}:${s.frame?.referenceLap}:${s.frame?.referenceLapTime}`);
  const reference = useApi<LiveReferenceDto | null>(sessionId ? api.liveReference() : null, `${sessionId}:${referenceKey}`);
  return reference.data ?? null;
}

/** Corners that cost time last lap, marked on the map. */
export function useCostlyCorners(reference: LiveReferenceDto | null, feedback: LapFeedback | null): MapSegment[] | undefined {
  return useMemo(() => {
    if (!reference || !feedback) return undefined;
    return feedback.tips
      .map((tip) => ({ corner: reference.corners.find((c) => c.id === tip.cornerId)!, timeDelta: tip.timeLost }))
      .filter((s) => s.corner && s.timeDelta > 0);
  }, [reference, feedback]);
}

/** The map itself with the car's live position. */
export function LiveTrackMap({ reference, segments }: { reference: LiveReferenceDto | null; segments?: MapSegment[] }) {
  const x = useLive((s) => s.frame?.x ?? 0);
  const z = useLive((s) => s.frame?.z ?? 0);
  const { mirrorMap } = useSettings();
  return (
    <TrackMap
      x={reference?.resampled.x ?? []}
      z={reference?.resampled.z ?? []}
      step={reference?.resampled.step ?? 2}
      car={{ x, z }}
      corners={reference?.corners}
      segments={segments}
      mirror={mirrorMap}
      title="Track map with your car's current position"
    />
  );
}

export function TrackMapCard({ size }: { size: CardSize }) {
  const reference = useLiveReference();
  const feedback = useLive((s) => s.feedback);
  const segments = useCostlyCorners(reference, feedback);

  return (
    <LiveCard title="Track map" size={size} className="map-live-card">
      <div className="tm-fill">
        <LiveTrackMap reference={reference} segments={segments} />
      </div>
      {segments && segments.length > 0 && (
        <p className="cp-legend">
          <span className="legend-item">
            <span className="key tm-key-slower" aria-hidden="true" />
            Cost the most time last lap
          </span>
        </p>
      )}
    </LiveCard>
  );
}
