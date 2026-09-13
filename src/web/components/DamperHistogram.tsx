/**
 * Damper velocity histogram for one wheel: share of time at each damper speed,
 * rebound (extending) left of zero and bump (compressing) right of it.
 */
import { useRef, useState } from 'react';
import { CHASSIS, type DamperHistogram } from '../../shared/analysis/chassis.ts';
import { useElementWidth } from '../lib/useElementWidth.ts';

const HEIGHT = 160;
const PAD = { left: 6, right: 6, top: 22, bottom: 22 };

const percent = (share: number) => `${Math.round(share * 100)}%`;
const mmPerSecond = (metres: number) => Math.round(metres * 1000);

export function DamperHistogramChart({ title, histogram }: { title: string; histogram: DamperHistogram }) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref);
  const [active, setActive] = useState<number | null>(null);

  const bins = histogram.shares.length;
  const range = -histogram.from;
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const binW = plotW / bins;
  const maxShare = Math.max(0.001, ...histogram.shares);
  const xOf = (v: number) => PAD.left + ((v + range) / (2 * range)) * plotW;
  const knee = CHASSIS.damperKnee;
  const summary =
    `${title}: compressing ${percent(histogram.bump)} of the time (${percent(histogram.fastBump)} fast), ` +
    `extending ${percent(histogram.rebound)} (${percent(histogram.fastRebound)} fast).`;

  return (
    <figure className="histogram">
      <h3>{title}</h3>
      <div ref={ref} className="histogram-wrap">
        {width > 0 && (
          <svg width={width} height={HEIGHT} role="img" aria-label={summary}>
            <text className="hist-side" x={PAD.left} y={12}>
              Rebound {percent(histogram.rebound)}
            </text>
            <text className="hist-side" x={width - PAD.right} y={12} textAnchor="end">
              Bump {percent(histogram.bump)}
            </text>
            {[-knee, knee].map((k) => (
              <line key={k} className="hist-knee" x1={xOf(k)} x2={xOf(k)} y1={PAD.top} y2={PAD.top + plotH} />
            ))}
            {histogram.shares.map((share, i) => {
              const h = share > 0 ? Math.max(1, (share / maxShare) * plotH) : 0;
              const x = PAD.left + i * binW;
              return (
                <g
                  key={i}
                  onPointerEnter={() => setActive(i)}
                  onPointerLeave={() => setActive((a) => (a === i ? null : a))}
                >
                  <rect className="hist-hit" x={x} y={PAD.top} width={binW} height={plotH} />
                  {h > 0 && (
                    <rect
                      className={`hist-bar${active === i ? ' is-active' : ''}`}
                      x={x + 1}
                      y={PAD.top + plotH - h}
                      width={Math.max(1, binW - 2)}
                      height={h}
                      rx={1}
                    />
                  )}
                </g>
              );
            })}
            <line className="hist-axis" x1={PAD.left} x2={width - PAD.right} y1={PAD.top + plotH} y2={PAD.top + plotH} />
            <line className="hist-zero" x1={xOf(0)} x2={xOf(0)} y1={PAD.top - 4} y2={PAD.top + plotH} />
            {[-range, 0, range].map((v) => (
              <text
                key={v}
                className="hist-label"
                x={xOf(v)}
                y={HEIGHT - 6}
                textAnchor={v < 0 ? 'start' : v > 0 ? 'end' : 'middle'}
              >
                {v === 0 ? '0 mm/s' : `${v < 0 ? '−' : '+'}${Math.abs(mmPerSecond(v))}`}
              </text>
            ))}
          </svg>
        )}
        {active !== null && width > 0 && (
          <div className="chart-tooltip" style={{ left: PAD.left + (active + 0.5) * binW, top: PAD.top + 8 }}>
            <strong>{(histogram.shares[active] * 100).toFixed(1)}% of the time</strong>
            <span>
              {mmPerSecond(histogram.from + active * histogram.binWidth)} to{' '}
              {mmPerSecond(histogram.from + (active + 1) * histogram.binWidth)} mm/s
            </span>
          </div>
        )}
      </div>
      <figcaption className="hist-stats">
        Fast movement (over {mmPerSecond(knee)} mm/s): bump {percent(histogram.fastBump)}, rebound{' '}
        {percent(histogram.fastRebound)}. 95% of bump is under {mmPerSecond(histogram.p95Bump)} mm/s and of rebound
        under {mmPerSecond(histogram.p95Rebound)} mm/s.
      </figcaption>
    </figure>
  );
}
