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
export function buildThresholdColorscale(zmin: number, zmax: number, thresholds: { redThreshold?: number; yellowThreshold?: number; greenThreshold?: number; yellowSpread?: number } | undefined) {
  // fallback to default colorscale if inputs invalid
  if (zmax <= zmin || !thresholds) return getColorscale();

  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const toNorm = (v: number) => clamp((v - zmin) / (zmax - zmin));

  const redT = thresholds.redThreshold ?? 90;
  const yellowT = thresholds.yellowThreshold ?? 75;
  const greenT = thresholds.greenThreshold ?? 60;
  const blueT = Math.min(greenT - 10, (zmin + (zmax - zmin) * 0.15)); // zona azul por debajo del verde

  // base colors (tuned to referencia)
  const C = {
    deepBlue: "#00224d",
    cyan: "#00cccc",
    green: "#00cc66",
    yellow: "#ffff33",
    orange: "#ff8c00",
    red: "#ff0000"
  };

  // If thresholds lie outside the available z-range, fall back to a distributed scale
  // This prevents color stops collapsing when thresholds > zmax or < zmin.
  const thresholdsOutOfRange = (redT <= zmin || redT >= zmax) || (greenT <= zmin || greenT >= zmax) || (yellowT <= zmin || yellowT >= zmax);
  if (thresholdsOutOfRange) {
    // evenly distribute stops across [0..1] with smooth interpolation
    const stopsEven: [number, string][] = [
      [0.0, C.deepBlue],
      [0.18, C.cyan],
      [0.38, C.green],
      [0.58, C.yellow],
      [0.76, C.orange],
      [1.0, C.red]
    ];
    // interpolate small intermediate steps for smoothness
    const interp = (c1: string, c2: string, t: number) => {
      const hexToRgb = (hex: string) => {
        const h = hex.replace("#", "");
        const n = parseInt(h, 16);
        return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
      };
      const rgbToHex = (r: number, g: number, b: number) =>
        "#" + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, "0")).join("");
      const a = hexToRgb(c1), b = hexToRgb(c2);
      return rgbToHex(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t);
    };

    const smoothStops: [number, string][] = [];
    for (let i = 0; i < stopsEven.length - 1; i++) {
      const [p1, c1] = stopsEven[i];
      const [p2, c2] = stopsEven[i + 1];
      smoothStops.push([p1, c1]);
      for (let k = 1; k <= 2; k++) {
        const t = k / 3;
        smoothStops.push([p1 + (p2 - p1) * t, interp(c1, c2, t)]);
      }
    }
    smoothStops.push(stopsEven[stopsEven.length - 1]);
    // ensure monotonic & unique
    const uniq: [number, string][] = [];
    let last = -1;
    for (const [p, c] of smoothStops) {
      const pos = Math.max(0, Math.min(1, Number.isFinite(p) ? p : 0));
      if (pos <= last) continue;
      uniq.push([pos, c]);
      last = pos;
    }
    return uniq.length >= 2 ? uniq : getColorscale();
  }

  // compute normalized stops using thresholds (thresholds are in absolute dB)
  const stops: [number, string][] = [
    [0.0, C.deepBlue],
    [toNorm(blueT), C.deepBlue],
    [toNorm(greenT), C.green],
    [toNorm((greenT + yellowT) / 2), C.cyan],
    [toNorm(yellowT), C.yellow],
    [toNorm((yellowT + redT) / 2), C.orange],
    [toNorm(redT), C.red],
    [1.0, C.red]
  ];

  // interpolate extra steps for smoother transitions
  const interp = (c1: string, c2: string, t: number) => {
    const hexToRgb = (hex: string) => {
      const h = hex.replace("#", "");
      const n = parseInt(h, 16);
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    };
    const rgbToHex = (r: number, g: number, b: number) =>
      "#" + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, "0")).join("");
    const a = hexToRgb(c1), b = hexToRgb(c2);
    return rgbToHex(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t);
  };

  const smoothStops: [number, string][] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const [p1, c1] = stops[i];
    const [p2, c2] = stops[i + 1];
    smoothStops.push([p1, c1]);
    // add 2 intermediate colors
    for (let k = 1; k <= 2; k++) {
      const t = k / 3;
      smoothStops.push([p1 + (p2 - p1) * t, interp(c1, c2, t)]);
    }
  }
  smoothStops.push(stops[stops.length - 1]);

  // ensure monotonic increasing and unique colors per stop
  const uniq: [number, string][] = [];
  let last = -1;
  for (const [p, c] of smoothStops) {
    const pos = Math.max(0, Math.min(1, Number.isFinite(p) ? p : 0));
    if (pos < last) continue;
    if (pos === last) continue;
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
