export function getColorscale() {
  // Deep-blue -> cyan -> green -> yellow -> orange -> red (fallback)
  return [
    [0.0, "#00224d"],
    [0.2, "#00539a"],
    [0.4, "#00cccc"],
    [0.55, "#00cc66"],
    [0.70, "#ffff33"],
    [0.85, "#ff8c00"],
    [1.0, "#ff0000"]
  ] as [number, string][];
}

// New: build colorscale from thresholds and data range so red/yellow/green/blue
// appear at the configured decibel levels and are normalized into [0..1] for Plotly.
export function buildThresholdColorscale(zmin: number, zmax: number, thresholds: { redThreshold?: number; yellowThreshold?: number; greenThreshold?: number; blueThreshold?: number; yellowSpread?: number } | undefined) {
  if (zmax <= zmin || !thresholds) return getColorscale();
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  const mapPos = (t: number) => {
    if (!Number.isFinite(t)) return NaN;
    // if z-range degenerate, map into [0.02..0.98] proportionally to absolute dB range 0..100
    if (zmax - zmin < 1e-6) {
      const approx = (t / 100);
      return Math.max(0.02, Math.min(0.98, approx));
    }
    // map threshold into normalized position with soft clamp away from edges
    const p = (t - zmin) / (zmax - zmin);
    return Math.max(0.02, Math.min(0.98, p));
  };

  const redT = thresholds.redThreshold ?? 70;
  const yellowT = thresholds.yellowThreshold ?? 50;
  const greenT = thresholds.greenThreshold ?? 40;
  const blueT = Number.isFinite((thresholds as any).blueThreshold) ? (thresholds as any).blueThreshold : Math.max(0, greenT - 20);
  const yellowSpread = Number((thresholds as any).yellowSpread ?? 10);

  const C = {
    deepBlue: "#00224d",
    cyan: "#00cccc",
    green: "#00cc66",
    yellow: "#ffff33",
    orange: "#ff8c00",
    red: "#ff0000"
  };

  // compute normalized positions (soft-clamped)
  const pBlue = mapPos(blueT);
  const pGreen = mapPos(greenT);
  const pYellowLo = mapPos(yellowT - yellowSpread * 0.5);
  const pYellow = mapPos(yellowT);
  const pYellowHi = mapPos(yellowT + yellowSpread * 0.5);
  const pRed = mapPos(redT);

  const stops: [number, string][] = [
    [0.0, C.deepBlue],
  ];
  if (!Number.isNaN(pBlue)) stops.push([clamp01(pBlue), C.cyan]);
  if (!Number.isNaN(pGreen)) stops.push([clamp01(pGreen), C.green]);
  if (!Number.isNaN(pYellowLo)) stops.push([clamp01(pYellowLo), C.cyan]);
  if (!Number.isNaN(pYellow)) stops.push([clamp01(pYellow), C.yellow]);
  if (!Number.isNaN(pYellowHi)) stops.push([clamp01(pYellowHi), C.orange]);
  if (!Number.isNaN(pRed)) stops.push([clamp01(pRed), C.red]);
  // top color: if red exists use red, else orange
  const topColor = (!Number.isNaN(pRed)) ? C.red : C.orange;
  stops.push([1.0, topColor]);

  // interpolate additional intermediate stops for smooth gradient
  const hexToRgb = (hex: string) => {
    const h = hex.replace("#", "");
    const n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  };
  const rgbToHex = (r: number, g: number, b: number) =>
    "#" + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, "0")).join("");
  const interp = (c1: string, c2: string, t: number) => {
    const a = hexToRgb(c1), b = hexToRgb(c2);
    return rgbToHex(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t);
  };

  const smoothStops: [number, string][] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const [p1, c1] = stops[i];
    const [p2, c2] = stops[i + 1];
    smoothStops.push([p1, c1]);
    for (let k = 1; k <= 4; k++) {
      const t = k / 5;
      smoothStops.push([p1 + (p2 - p1) * t, interp(c1, c2, t)]);
    }
  }
  smoothStops.push(stops[stops.length - 1]);

  // unique & monotonic
  const uniq: [number, string][] = [];
  let last = -1;
  for (const [p, c] of smoothStops) {
    const pos = Math.max(0, Math.min(1, Number.isFinite(p) ? p : 0));
    if (pos <= last) continue;
    uniq.push([pos, c]);
    last = pos;
  }
  if (uniq.length < 2) return getColorscale();
  return uniq;
}

/**
 * Apply simple dB-per-meter attenuation to a z-matrix using a given distance grid.
 * z and dist must share the same shape [rows][cols].
 * Returns a new matrix (does not mutate input).
 *
 * dbPerMeter: how many dB to subtract per meter of distance (e.g. 0.5 .. 2.0)
 */
export function applyColorAttenuation(z: number[][], dist: number[][], dbPerMeter = 0.5) {
  const h = z.length;
  const w = z[0]?.length ?? 0;
  const out: number[][] = Array.from({ length: h }, () => new Array(w).fill(0));
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const d = (dist[j] && dist[j][i]) ? dist[j][i] : 0;
      out[j][i] = z[j][i] - dbPerMeter * d;
    }
  }
  return out;
}
