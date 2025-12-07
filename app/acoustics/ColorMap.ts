export function getColorscale() {
  // Deep-blue -> cyan -> green -> yellow -> orange -> red
  return [
    [0.0, "#001f7a"], // deep blue
    [0.15, "#0047ab"], // strong blue
    [0.30, "#00ffff"], // cyan
    [0.45, "#00ff66"], // green-cyan
    [0.60, "#00ff00"], // green
    [0.75, "#ffff00"], // yellow
    [0.90, "#ffa500"], // orange
    [1.0, "#ff0000"]   // red
  ] as [number, string][];
}

// New: build colorscale from thresholds and data range so red/yellow/green/blue
// appear at the configured decibel levels and are normalized into [0..1] for Plotly.
export function buildThresholdColorscale(zmin: number, zmax: number, thresholds: { redThreshold?: number; yellowThreshold?: number; greenThreshold?: number; yellowSpread?: number } | undefined) {
  // fallback to default colorscale if inputs invalid
  if (zmax <= zmin || !thresholds) return getColorscale();

  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const toNorm = (v: number) => clamp((v - zmin) / (zmax - zmin));

  const redT = thresholds.redThreshold ?? 65;
  const yellowT = thresholds.yellowThreshold ?? 55;
  const greenT = thresholds.greenThreshold ?? 45;
  const blueT = 35; // Umbral para el azul

  // Colores base para la escala
  const C = {
    deepBlue: "#00539a",
    green: "#00ff00",
    yellow: "#ffff00",
    red: "#ff0000"
  };

  // Helper para mezclar colores
  const hexToRgb = (hex: string) => {
    const h = hex.replace("#", "");
    const bigint = parseInt(h, 16);
    return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 };
  };
  const rgbToHex = (r: number, g: number, b: number) => "#" + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  const mix = (c1: string, c2: string, t: number) => {
    const rgb1 = hexToRgb(c1);
    const rgb2 = hexToRgb(c2);
    return rgbToHex(rgb1.r + (rgb2.r - rgb1.r) * t, rgb1.g + (rgb2.g - rgb1.g) * t, rgb1.b + (rgb2.b - rgb1.b) * t);
  };

  // Escala de colores con transiciones suaves
  const replicaColorscale: [number, string][] = [
    [0.0, C.deepBlue],
    [toNorm(blueT), C.deepBlue],
    [toNorm(greenT), C.green],
    [toNorm(yellowT), C.yellow],
    [toNorm(redT), C.red],
    [1.0, C.red]
  ];

  // Interpolar para crear un gradiente más suave
  const smoothScale: [number, string][] = [];
  for (let i = 0; i < replicaColorscale.length - 1; i++) {
    const [p1, c1] = replicaColorscale[i];
    const [p2, c2] = replicaColorscale[i + 1];
    smoothScale.push([p1, c1]);
    // Añadir 3 pasos intermedios para suavizar la transición
    for (let j = 1; j <= 3; j++) {
      const t = j / 4;
      smoothScale.push([p1 + (p2 - p1) * t, mix(c1, c2, t)]);
    }
  }
  smoothScale.push(replicaColorscale[replicaColorscale.length - 1]);


  // ensure monotonic positions and remove duplicates (Plotly requires sorted ascending)
  const uniqStops: [number, string][] = [];
  let lastPos = -1;
  for (const [pos, col] of smoothScale) {
    const p = Math.max(0, Math.min(1, Number.isFinite(pos) ? pos : 0));
    if (p < lastPos) continue;
    if (p === lastPos && uniqStops.length > 0) continue; // Evitar duplicados en la misma posición
    uniqStops.push([p, col]);
    lastPos = p;
  }

  // if somehow only one stop remains, fallback
  if (uniqStops.length < 2) return getColorscale();
  return uniqStops;
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
