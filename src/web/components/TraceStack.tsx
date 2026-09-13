/**
 * Stacked telemetry traces against lap distance (speed, throttle, brake, …),
 * with a shared crosshair, synced zoom, corner markers and a table view.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { Corner } from '../../shared/analysis/corners.ts';
import { readChartColors, useThemeKey, type ChartColors } from '../lib/theme.ts';

export interface TracePanel {
  id: string;
  title: string;
  /** Plot height in CSS pixels (the x-axis adds 32px on the last panel). */
  height: number;
  lap: (number | null)[];
  reference?: (number | null)[];
  range?: [number, number];
  format: (value: number) => string;
  /** 'delta' draws one line with gained/lost fills either side of zero. */
  kind?: 'line' | 'step' | 'delta';
}

export interface TraceStackProps {
  distance: number[];
  panels: TracePanel[];
  lapLabel: string;
  referenceLabel?: string | null;
  corners?: Corner[];
  /** Live position marker, read on every redraw. */
  markerRef?: { current: number | null };
  /** Bump to push new data into the existing charts without rebuilding them. */
  dataVersion?: number;
  onHover?: (distance: number | null) => void;
  caption: string;
  tableStep?: number;
  actions?: ReactNode;
}

export const formatDistance = (metres: number) =>
  metres >= 1000 ? `${(metres / 1000).toFixed(2)} km` : `${Math.round(metres)} m`;

const HINT = 'Point at the chart to read values. Drag to zoom, double-click to reset.';

function fit(values: (number | null)[], n: number): (number | null)[] {
  if (values.length === n) return values;
  const out = values.slice(0, n);
  while (out.length < n) out.push(null);
  return out;
}

function panelData(panel: TracePanel, distance: number[]): uPlot.AlignedData {
  const n = distance.length;
  if (panel.kind === 'delta' || !panel.reference) return [distance, fit(panel.lap, n)] as uPlot.AlignedData;
  return [distance, fit(panel.reference, n), fit(panel.lap, n)] as uPlot.AlignedData;
}

function deltaFill(u: uPlot, colors: ChartColors): CanvasGradient | string {
  const { top, height } = u.bbox;
  if (!height) return colors.badWash;
  const stop = Math.min(1, Math.max(0, (u.valToPos(0, 'y', true) - top) / height));
  const gradient = u.ctx.createLinearGradient(0, top, 0, top + height);
  gradient.addColorStop(0, colors.badWash);
  gradient.addColorStop(stop, colors.badWash);
  gradient.addColorStop(stop, colors.goodWash);
  gradient.addColorStop(1, colors.goodWash);
  return gradient;
}

function drawOverlays(
  u: uPlot,
  colors: ChartColors,
  corners: Corner[],
  showLabels: boolean,
  marker: number | null,
  isDelta: boolean,
): void {
  const ctx = u.ctx;
  const { left, top, width, height } = u.bbox;
  const px = window.devicePixelRatio || 1;
  ctx.save();
  ctx.lineWidth = px;
  if (isDelta) {
    const y = Math.round(u.valToPos(0, 'y', true)) + 0.5;
    ctx.strokeStyle = colors.axis;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(left + width, y);
    ctx.stroke();
  }
  ctx.font = `600 ${11 * px}px ${colors.font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  let lastLabelRight = -Infinity;
  for (const corner of corners) {
    const x = Math.round(u.valToPos(corner.apex, 'x', true)) + 0.5;
    if (x < left || x > left + width) continue;
    ctx.strokeStyle = colors.grid;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, top + height);
    ctx.stroke();
    const labelWidth = ctx.measureText(corner.name).width;
    // Skip a label that would collide with its neighbour; zooming in reveals it.
    if (showLabels && x - labelWidth / 2 > lastLabelRight + 6 * px) {
      ctx.fillStyle = colors.muted;
      ctx.fillText(corner.name, x, top + 2 * px);
      lastLabelRight = x + labelWidth / 2;
    }
  }
  if (marker !== null) {
    const x = Math.round(u.valToPos(marker, 'x', true));
    if (x >= left && x <= left + width) {
      ctx.strokeStyle = colors.lap;
      ctx.lineWidth = 2 * px;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, top + height);
      ctx.stroke();
    }
  }
  ctx.restore();
}

export function TraceStack(props: TraceStackProps) {
  const { distance, panels, lapLabel, referenceLabel, caption, tableStep = 100, actions, dataVersion = 0 } = props;
  const themeKey = useThemeKey();
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRefs = useRef<(HTMLDivElement | null)[]>([]);
  const charts = useRef<uPlot[]>([]);
  const readoutRef = useRef<HTMLParagraphElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const [showTable, setShowTable] = useState(false);

  const panelKey = panels.map((p) => `${p.id}:${p.kind ?? 'line'}:${p.reference ? 'ref' : ''}:${p.height}`).join('|');
  const hasReference = panels.some((p) => p.reference && p.kind !== 'delta');

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const colors = readChartColors();
    const px = window.devicePixelRatio || 1;
    const font = `${12}px ${colors.font}`;
    const width = Math.max(240, container.clientWidth);
    const sync = uPlot.sync(`trace-${Math.random().toString(36).slice(2)}`);
    const created: uPlot[] = [];
    let propagating = false;

    const updateReadout = (u: uPlot) => {
      const el = readoutRef.current;
      const current = latest.current;
      const idx = u.cursor.idx;
      if (!el) return;
      if (idx === null || idx === undefined) {
        el.textContent = HINT;
        current.onHover?.(null);
        return;
      }
      const parts: HTMLElement[] = [];
      const add = (label: string, value: string) => {
        const item = document.createElement('span');
        item.className = 'readout-item';
        const strong = document.createElement('strong');
        strong.textContent = value;
        const small = document.createElement('span');
        small.textContent = label;
        item.append(strong, small);
        parts.push(item);
      };
      add('distance', formatDistance(current.distance[idx]));
      for (const panel of current.panels) {
        const lapValue = panel.lap[idx];
        const refValue = panel.reference?.[idx];
        const show = (v: number | null | undefined) => (v === null || v === undefined ? '–' : panel.format(v));
        if (panel.kind === 'delta' || refValue === undefined) add(panel.title, show(lapValue));
        else add(panel.title, `${show(lapValue)} / ${show(refValue)}`);
      }
      el.replaceChildren(...parts);
      current.onHover?.(current.distance[idx]);
    };

    panels.forEach((panel, i) => {
      const target = plotRefs.current[i];
      if (!target) return;
      const isLast = i === panels.length - 1;
      const paths = panel.kind === 'step' ? uPlot.paths.stepped?.({ align: 1 }) : undefined;
      const series: uPlot.Series[] = [{}];
      if (panel.kind === 'delta') {
        series.push({ stroke: colors.ink2, width: 2, fill: (u) => deltaFill(u, colors), fillTo: 0, points: { show: false } });
      } else {
        if (panel.reference) series.push({ stroke: colors.reference, width: 2, paths, points: { show: false } });
        series.push({ stroke: colors.lap, width: 2, paths, points: { show: false } });
      }
      const axisBase = {
        stroke: colors.muted,
        font,
        grid: { stroke: colors.grid, width: 1 },
        ticks: { stroke: colors.axis, width: 1, size: 4 },
      };
      const range: uPlot.Scale['range'] =
        panel.kind === 'delta'
          ? (_u, min, max) => {
              const m = Math.max(0.1, Math.abs(min ?? 0), Math.abs(max ?? 0)) * 1.1;
              return [-m, m];
            }
          : panel.range
            ? () => panel.range!
            : undefined;

      const chart = new uPlot(
        {
          width,
          height: panel.height + (isLast ? 32 : 0),
          // Bottom padding keeps the lowest tick label from being clipped.
          padding: [8, 12, isLast ? 0 : 8, 0],
          legend: { show: false },
          cursor: {
            sync: { key: sync.key },
            drag: { x: true, y: false, setScale: true },
            points: { size: 8, width: 2, stroke: colors.surface },
          },
          scales: { x: { time: false }, y: range ? { range } : {} },
          axes: [
            { ...axisBase, size: isLast ? 32 : 0, values: isLast ? (_u, v) => v.map(formatDistance) : () => [] },
            {
              ...axisBase,
              size: 72,
              space: 22,
              ...(panel.kind === 'delta' ? { incrs: [0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10] } : {}),
              values: (_u, v) => v.map((value) => panel.format(value)),
            },
          ],
          series,
          hooks: {
            draw: [
              (u) =>
                drawOverlays(
                  u,
                  colors,
                  latest.current.corners ?? [],
                  i === 0,
                  latest.current.markerRef?.current ?? null,
                  panel.kind === 'delta',
                ),
            ],
            setCursor: [(u) => updateReadout(u)],
            setScale: [
              (u, key) => {
                if (key !== 'x' || propagating) return;
                propagating = true;
                const { min, max } = u.scales.x;
                for (const other of created) {
                  if (other !== u && min !== undefined && max !== undefined) other.setScale('x', { min, max });
                }
                propagating = false;
              },
            ],
          },
        },
        panelData(panel, latest.current.distance),
        target,
      );
      sync.sub(chart);
      created.push(chart);
    });
    void px;
    charts.current = created;
    if (readoutRef.current) readoutRef.current.textContent = HINT;

    const observer = new ResizeObserver(() => {
      const w = Math.max(240, container.clientWidth);
      for (const chart of created) if (chart.width !== w) chart.setSize({ width: w, height: chart.height });
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      for (const chart of created) {
        sync.unsub(chart);
        chart.destroy();
      }
      charts.current = [];
    };
    // Rebuild only when the panel structure or theme changes; data flows in below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeKey, panelKey]);

  useEffect(() => {
    charts.current.forEach((chart, i) => {
      const panel = panels[i];
      if (panel) chart.setData(panelData(panel, distance));
    });
  }, [dataVersion, distance, panels]);

  const tableRows: number[] = [];
  if (showTable) {
    let next = 0;
    distance.forEach((d, i) => {
      if (d >= next) {
        tableRows.push(i);
        next = Math.floor(d / tableStep) * tableStep + tableStep;
      }
    });
  }

  return (
    <figure className="trace">
      <div className="trace-toolbar">
        <div className="trace-legend" aria-label="Legend">
          <span className="legend-item">
            <span className="key key-lap" aria-hidden="true" />
            {lapLabel}
          </span>
          {hasReference && referenceLabel && (
            <span className="legend-item">
              <span className="key key-reference" aria-hidden="true" />
              {referenceLabel}
            </span>
          )}
        </div>
        <div className="trace-actions">
          {actions}
          <button type="button" className="btn btn-small" aria-pressed={showTable} onClick={() => setShowTable((s) => !s)}>
            {showTable ? 'Show chart' : 'Show as table'}
          </button>
        </div>
      </div>
      <p className="trace-readout" ref={readoutRef} aria-hidden="true" />
      <div ref={containerRef} className="trace-plots" hidden={showTable} aria-hidden="true">
        {panels.map((panel, i) => (
          <div key={panel.id} className="trace-panel">
            <span className="trace-panel-title">{panel.title}</span>
            <div
              ref={(el) => {
                plotRefs.current[i] = el;
              }}
            />
          </div>
        ))}
      </div>
      <figcaption className="visually-hidden">{caption}</figcaption>
      {showTable && (
        <div className="table-wrap trace-table">
          <table className="data">
            <caption>
              {caption}. One row every {tableStep} m.
            </caption>
            <thead>
              <tr>
                <th scope="col">Distance</th>
                {panels.flatMap((p) =>
                  p.reference && p.kind !== 'delta'
                    ? [
                        <th key={`${p.id}-lap`} scope="col" className="num">
                          {p.title} · {lapLabel}
                        </th>,
                        <th key={`${p.id}-ref`} scope="col" className="num">
                          {p.title} · {referenceLabel}
                        </th>,
                      ]
                    : [
                        <th key={p.id} scope="col" className="num">
                          {p.title}
                        </th>,
                      ],
                )}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((i) => (
                <tr key={i}>
                  <th scope="row">{formatDistance(distance[i])}</th>
                  {panels.flatMap((p) => {
                    const cell = (v: number | null | undefined, key: string) => (
                      <td key={key} className="num">
                        {v === null || v === undefined ? '–' : p.format(v)}
                      </td>
                    );
                    return p.reference && p.kind !== 'delta'
                      ? [cell(p.lap[i], `${p.id}-lap`), cell(p.reference[i], `${p.id}-ref`)]
                      : [cell(p.lap[i], p.id)];
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </figure>
  );
}
