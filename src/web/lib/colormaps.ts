/**
 * Colour scales for rugs. Viridis (throttle) and plasma (brake) are matplotlib's
 * perceptually uniform scales, which stay in order in greyscale and for the
 * common kinds of colour blindness. Steering uses a diverging blue–white–red
 * scale (ColorBrewer RdBu), trimmed so both ends stay visible on dark cards.
 * Evenly spaced stops, interpolated between.
 */
const STOPS = {
  viridis: ['#440154', '#482878', '#3e4a89', '#31688e', '#26828e', '#1f9e89', '#35b779', '#6dcd59', '#b4de2c', '#fde725'],
  plasma: ['#0d0887', '#47039f', '#7301a8', '#9c179e', '#bd3786', '#d8576b', '#ed7953', '#fa9e3b', '#fdc926', '#f0f921'],
  steering: ['#2166ac', '#4393c3', '#92c5de', '#d1e5f0', '#f7f7f7', '#fddbc7', '#f4a582', '#d6604d', '#b2182b'],
} as const;

export type ColourScale = keyof typeof STOPS;

const toRgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const RGB: Record<ColourScale, number[][]> = {
  viridis: STOPS.viridis.map(toRgb),
  plasma: STOPS.plasma.map(toRgb),
  steering: STOPS.steering.map(toRgb),
};

/** Colour at a position along the scale, 0 to 1. For steering, 0 is full left, 0.5 straight and 1 full right. */
export function colourAt(scale: ColourScale, position: number): string {
  const stops = RGB[scale];
  const at = Math.max(0, Math.min(1, position)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(at));
  const f = at - i;
  const [r, g, b] = stops[i].map((channel, k) => Math.round(channel + (stops[i + 1][k] - channel) * f));
  return `rgb(${r} ${g} ${b})`;
}

/** The whole scale as a CSS gradient, for legends. */
export function colourGradient(scale: ColourScale): string {
  const stops = STOPS[scale];
  return `linear-gradient(to right, ${stops.map((hex, i) => `${hex} ${Math.round((i / (stops.length - 1)) * 100)}%`).join(', ')})`;
}
