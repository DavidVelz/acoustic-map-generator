import ISOModel, { SourceSimple } from "../lib/ISOModel";
import { getPerpAlong } from "./FacadeUtils";
import WaveEmitter from "./WaveEmitter";

export function getColorscale() {
  // Deep-blue -> cyan -> green -> yellow -> red
  return [
    [0.0, "#00224d"], // deep
    [0.20, "#00cccc"], // cyan
    [0.40, "#00cc66"], // green
    [0.70, "#ffff33"], // yellow
    [1.0,  "#ff0000"]  // red
  ] as [number, string][];
}

// New: build a smooth sampled colorscale avoiding sharp intermediate stops.
// Anchors: deepBlue, cyan, green, yellow, red. Sample densely to avoid stripes.
export function buildThresholdColorscale(zmin: number, zmax: number, thresholds: { redThreshold?: number; yellowThreshold?: number; greenThreshold?: number; blueThreshold?: number; yellowSpread?: number } | undefined) {
  if (zmax <= zmin || !thresholds) return getColorscale();

  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  const mapPos = (t: number) => {
    if (!Number.isFinite(t)) return NaN;
    if (zmax - zmin < 1e-6) {
      const approx = (t / 100);
      return Math.max(0.02, Math.min(0.98, approx));
    }
    const p = (t - zmin) / (zmax - zmin);
    return Math.max(0.02, Math.min(0.98, p));
  };

  const redT = thresholds.redThreshold ?? 70;
  const yellowT = thresholds.yellowThreshold ?? 50;
  const greenT = thresholds.greenThreshold ?? 40;
  // blueThreshold now positions cyan between deep and green (can be set via UI)
  const cyanT = Number.isFinite((thresholds as any).blueThreshold) ? (thresholds as any).blueThreshold : Math.max(0, greenT - 15);

  const C = {
    deepBlue: "#00224d",
    cyan: "#00cccc",
    green: "#00cc66",
    yellow: "#ffff33",
    red: "#ff0000"
  };

  // anchor positions (normalized)
  const pDeep = 0.0;
  const pCyan = mapPos(cyanT);
  const pGreen = mapPos(greenT);
  const pYellow = mapPos(yellowT);
  const pRed = mapPos(redT);

  // build anchor list and ensure monotonic increasing positions
  const anchors: { p: number; color: string }[] = [
    { p: pDeep, color: C.deepBlue },
    { p: pCyan, color: C.cyan },
    { p: pGreen, color: C.green },
    { p: pYellow, color: C.yellow },
    { p: pRed, color: C.red }
  ].filter(a => Number.isFinite(a.p)).sort((a, b) => a.p - b.p);

  // ensure anchors cover 0..1
  if (anchors.length === 0) return getColorscale();
  if (anchors[0].p > 0.0) anchors.unshift({ p: 0.0, color: C.deepBlue });
  if (anchors[anchors.length - 1].p < 1.0) anchors.push({ p: 1.0, color: anchors[anchors.length - 1].color });

  // helpers color conversion
  const hexToRgb = (hex: string) => {
    const h = hex.replace("#", "");
    const n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  };
  const rgbToHex = (r: number, g: number, b: number) =>
    "#" + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, "0")).join("");

  // interpolation between two hex colors
  const interpColor = (c1: string, c2: string, t: number) => {
    const a = hexToRgb(c1), b = hexToRgb(c2);
    return rgbToHex(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t);
  };

  // sample a dense colorscale to avoid banding
  const N = 128; // number of sampled stops (adjustable)
  const sampled: [number, string][] = [];
  for (let i = 0; i < N; i++) {
    const pos = i / (N - 1);
    // find anchor interval
    let a = anchors[0], b = anchors[anchors.length - 1];
    for (let k = 0; k < anchors.length - 1; k++) {
      if (pos >= anchors[k].p && pos <= anchors[k + 1].p) {
        a = anchors[k];
        b = anchors[k + 1];
        break;
      }
    }
    const span = Math.max(1e-9, b.p - a.p);
    const t = (pos - a.p) / span;
    const color = interpColor(a.color, b.color, t);
    sampled.push([clamp01(pos), color]);
  }

  // compact: remove consecutive near-duplicates and ensure monotonic unique positions
  const uniq: [number, string][] = [];
  let lastPos = -1;
  for (const [p, c] of sampled) {
    const pos = Math.max(0, Math.min(1, Number.isFinite(p) ? p : 0));
    if (pos <= lastPos + 1e-6) continue;
    uniq.push([pos, c]);
    lastPos = pos;
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
 * spreadCells: optional integer radius (in grid cells) to blur the resulting z-field so the gradient
 *              "expands" in all directions. Use 0 (default) to disable.
 * mask: optional same-shape boolean/number matrix. Cells with falsy/0 block contributions (blur respects máscara).
 * maskOptions: optional { invert?: boolean, mode?: 'source'|'receive'|'both' }
 *   - invert: treat mask values inverted (useful si la máscara está al revés).
 *   - mode:
 *       'source' (default): mask limits which cells act as sources (can spread to unmasked receivers).
 *       'receive': mask limits which cells can receive spread (
 *       'both': both source and receiver must be allowed by mask.
 */
export function applyColorAttenuation(
	z: number[][],
	dist: number[][],
	dbPerMeter = 0.5,
	spreadCells = 0,
	mask?: (number | boolean)[][],
	maskOptions?: { invert?: boolean; mode?: 'source' | 'receive' | 'both' },
) {
	const h = z.length;
	const w = z[0]?.length ?? 0;
	const out: number[][] = Array.from({ length: h }, () => new Array(w).fill(0));
	for (let j = 0; j < h; j++) {
		for (let i = 0; i < w; i++) {
			const d = (dist[j] && dist[j][i]) ? dist[j][i] : 0;
			out[j][i] = z[j][i] - dbPerMeter * d;
		}
	}
	// si se solicita difusión espacial, aplicar blur gaussiano en número de celdas
	if (spreadCells && spreadCells > 0) {
		const r = Math.round(spreadCells);
		if (mask) {
			return gaussianBlurMatrixMasked(out, r, mask, maskOptions);
		}
		return gaussianBlurMatrix(out, r);
	}
	return out;
}

// Añadido: difuminado gaussiano (separable) simple usando kernel gaussiano.
// radius: número de celdas (enteros). Si radius <= 0 devuelve la matriz sin cambios.
function gaussianBlurMatrix(src: number[][], radius: number) {
	if (radius <= 0) return src;
	const h = src.length;
	const w = src[0]?.length ?? 0;
	if (h === 0 || w === 0) return src;

	// construir kernel 1D gaussiano
	const sigma = Math.max(0.01, radius / 2);
	const r = Math.ceil(radius);
	const len = r * 2 + 1;
	const kernel: number[] = new Array(len);
	let sum = 0;
	for (let i = -r; i <= r; i++) {
		const v = Math.exp(-(i * i) / (2 * sigma * sigma));
		kernel[i + r] = v;
		sum += v;
	}
	for (let i = 0; i < len; i++) kernel[i] /= sum;

	// buffer temporal
	const temp: number[][] = Array.from({ length: h }, () => new Array(w).fill(0));
	const out: number[][] = Array.from({ length: h }, () => new Array(w).fill(0));

	// convolución separable: horizontal
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			let acc = 0;
			for (let k = -r; k <= r; k++) {
				const sx = Math.min(w - 1, Math.max(0, x + k)); // clamp bordes
				acc += src[y][sx] * kernel[k + r];
			}
			temp[y][x] = acc;
		}
	}
	// vertical
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			let acc = 0;
			for (let k = -r; k <= r; k++) {
				const sy = Math.min(h - 1, Math.max(0, y + k));
				acc += temp[sy][x] * kernel[k + r];
			}
			out[y][x] = acc;
		}
	}
	return out;
}

// Añadido/Modificado: blur gaussiano que respeta una máscara (misma forma que src).
// Ahora acepta opciones: invert y mode ('source'|'receive'|'both').
function gaussianBlurMatrixMasked(
	src: number[][],
	radius: number,
	mask: (number | boolean)[][],
	options?: { invert?: boolean; mode?: 'source' | 'receive' | 'both' }
) {
	if (radius <= 0) return src;
	const h = src.length;
	const w = src[0]?.length ?? 0;
	if (h === 0 || w === 0) return src;

	const invert = !!options?.invert;
	const mode = options?.mode ?? 'source';

	const sigma = Math.max(0.01, radius / 2);
	const r = Math.ceil(radius);
	const len = r * 2 + 1;
	const kernel: number[] = new Array(len);
	let sum = 0;
	for (let i = -r; i <= r; i++) {
		const v = Math.exp(-(i * i) / (2 * sigma * sigma));
		kernel[i + r] = v;
		sum += v;
	}
	for (let i = 0; i < len; i++) kernel[i] /= sum;

	// buffers
	const tempVal: number[][] = Array.from({ length: h }, () => new Array(w).fill(0));
	const tempW: number[][] = Array.from({ length: h }, () => new Array(w).fill(0));
	const out: number[][] = Array.from({ length: h }, () => new Array(w).fill(0));

	const isMasked = (yy: number, xx: number) => {
		if (!mask[yy] || typeof mask[yy][xx] === 'undefined') return false;
		return Boolean(mask[yy][xx]);
	};

	// horizontal pass: accumulate value*kernel*mask-source and weight sum kernel*mask-source
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			let acc = 0;
			let wacc = 0;
			for (let k = -r; k <= r; k++) {
				const sx = Math.min(w - 1, Math.max(0, x + k));
				// source mask evaluation (apply invert)
				let srcAllowed = isMasked(y, sx);
				if (invert) srcAllowed = !srcAllowed;
				// if mode === 'receive' we allow all sources (reception is limited later)
				if (mode === 'receive') srcAllowed = true;
				if (!srcAllowed) continue;
				const kv = kernel[k + r];
				acc += src[y][sx] * kv;
				wacc += kv;
			}
			tempVal[y][x] = acc;
			tempW[y][x] = wacc;
		}
	}

	// vertical pass: combine and normalize; respect receiver mask depending on mode
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			// receiver decision
			let destAllowed = isMasked(y, x);
			if (invert) destAllowed = !destAllowed;
			if (mode === 'source') {
				// allow all receivers
				destAllowed = true;
			}
			// if receiver not allowed and mode requires it, keep original value
			if (!destAllowed && (mode === 'receive' || mode === 'both')) {
				out[y][x] = src[y][x];
				continue;
			}
			let acc = 0;
			let wacc = 0;
			for (let k = -r; k <= r; k++) {
				const sy = Math.min(h - 1, Math.max(0, y + k));
				const kv = kernel[k + r];
				acc += tempVal[sy][x] * kv;
				wacc += tempW[sy][x] * kv;
			}
			out[y][x] = wacc > 0 ? acc / wacc : src[y][x];
		}
	}

	return out;
}

/**
 * Genera un mapa de Lp rojo alrededor de las fachadas usando un modelo simple pero físico:
 * - LwMap: mapa { segmentName: Lw_room_dB } (si falta, se puede usar `peak` como fallback)
 * - ReMap: opcional { segmentName: RePrime_dB } (pérdida de fachada). Lw_out = Lw_room - RePrime
 * - model: Lp_sample ≈ Lw_out - 20*log10(r) - 10*log10(4π) - dbPerMeter * r
 * - se suman energías (no máximos). Se aplica ponderación elíptica (perpendicular + along).
 */
export function generateRedGradient(
	gridX: number[],
	gridY: number[],
	segments: { name?: string; p1: number[]; p2: number[] }[],
	perimeter: number[][],
	options?: {
		LwMap?: Record<string, number>;
		ReMap?: Record<string, number>;
		maxDist?: number;        // m, default 2.0
		fallbackPeak?: number;   // dB, used if segment not in LwMap
		dbPerMeter?: number;     // dB per meter additional attenuation
		sampleSpacing?: number;  // meters between samples along facade
		sigmaAlongFactor?: number; // factor to compute sigma along = segLen * factor
	}
): number[][] {
	const h = gridY.length, w = gridX.length;
	const out: number[][] = Array.from({ length: h }, () => new Array(w).fill(0));

	const LwMap = options?.LwMap ?? {};
	const ReMap = options?.ReMap ?? {};
	const maxDist = options?.maxDist ?? 2.0;
	const fallbackPeak = options?.fallbackPeak ?? 100;
	const dbPerMeter = options?.dbPerMeter ?? 0.5;
	const sampleSpacing = options?.sampleSpacing ?? 0.25;
	const sigmaAlongFactor = options?.sigmaAlongFactor ?? 0.25;

	// constant term 10*log10(4*pi) ~ 10.99 dB
	const FOUR_PI_CONST = 10 * Math.log10(4 * Math.PI);

	// Simple point-in-polygon (ray-casting)
	function pointInPoly(x: number, z: number, poly: number[][]) {
		if (!poly || poly.length < 3) return false;
		let inside = false;
		for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
			const xi = poly[i][0], zi = poly[i][1];
			const xj = poly[j][0], zj = poly[j][1];
			const intersect = ((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / ((zj - zi) || 1e-12) + xi);
			if (intersect) inside = !inside;
		}
		return inside;
	}

	

	// compute approximate centroid to orient normals outward
	const center = (() => {
		let sx = 0, sz = 0, c = 0;
		for (const s of segments) {
			if (!s || !s.p1 || !s.p2) continue;
			const ax = s.p1[0], az = s.p1[1], bx = s.p2[0], bz = s.p2[1];
			sx += (ax + bx) * 0.5; sz += (az + bz) * 0.5; c++;
		}
		return c ? { x: sx / c, z: sz / c } : { x: 0, z: 0 };
	})();

	// For each grid point accumulate linear energy from all facade samples
	for (let j = 0; j < h; j++) {
		for (let i = 0; i < w; i++) {
			const px = gridX[i], pz = gridY[j];

			// Respect perimeter: skip interior points
			if (pointInPoly(px, pz, perimeter)) {
				out[j][i] = 0;
				continue;
			}

			let totalE = 0; // linear energy sum

			for (const seg of segments) {
				const segName = seg.name ?? "";
				// Lw inside room for this facade (dB). fallbackPeak if absent.
				const Lw_room = Number.isFinite(Number(LwMap[segName])) ? Number(LwMap[segName]) : fallbackPeak;
				// apply facade transmission loss if provided
				const Re = Number.isFinite(Number(ReMap[segName])) ? Number(ReMap[segName]) : 0;
				const Lw_out = Lw_room - Re;

				const a = seg.p1, b = seg.p2;
				const dx = b[0] - a[0], dz = b[1] - a[1];
				const segLen = Math.hypot(dx, dz);
				if (segLen < 1e-6) continue;

				// orient normal outward using centroid
				const tx = dx / segLen, tz = dz / segLen;
				let nx = -tz, nz = tx;
				const midX = (a[0] + b[0]) / 2, midZ = (a[1] + b[1]) / 2;
				if (((midX - center.x) * nx + (midZ - center.z) * nz) < 0) { nx = -nx; nz = -nz; }

				// number of discrete sources along facade
				const nSamples = Math.max(1, Math.ceil(segLen / sampleSpacing));
				const sampleLen = segLen / nSamples;
				const P_total_linear = Math.pow(10, Lw_out / 10); // linear power reference
				const P_per_sample = P_total_linear / nSamples;

				for (let s = 0; s < nSamples; s++) {
					const frac = (s + 0.5) / nSamples;
					const sx = a[0] + tx * segLen * frac;
					const sz = a[1] + tz * segLen * frac;

					const vrx = px - sx, vrz = pz - sz;
					const dist = Math.hypot(vrx, vrz);
					// signed perpendicular using computed normal
					const perp = vrx * nx + vrz * nz;
					if (perp <= 0 || perp > maxDist) continue; // only outside and within maxDist

					// geometric loss: 20*log10(r) + 10*log10(4π)
					const dClamp = Math.max(0.01, dist);
					const geomLoss = 20 * Math.log10(dClamp) + FOUR_PI_CONST;
					const atmosLoss = dbPerMeter * dClamp;
					const Lp_sample_db = 10 * Math.log10(Math.max(1e-12, P_per_sample)) - geomLoss - atmosLoss;

					// lateral (perp) gaussian
					const sigma_perp = Math.max(0.15, maxDist * 0.45);
					const w_perp = Math.exp(- (perp * perp) / (2 * sigma_perp * sigma_perp));
					// longitudinal gaussian centered at middle of segment
					const sigma_along = Math.max(0.5, segLen * sigmaAlongFactor);
					const along = (frac * segLen);
					const w_along = Math.exp(- Math.pow(along - segLen / 2, 2) / (2 * sigma_along * sigma_along));

					const weight = w_perp * w_along;
					const E_sample = Math.pow(10, Lp_sample_db / 10) * weight;
					totalE += E_sample;
				}
			}

			if (totalE > 0) {
				out[j][i] = 10 * Math.log10(totalE);
			} else {
				out[j][i] = -Infinity;
			}
		}
	}
	return out;
}

/**
 * generateRedHeatmapFromFacade
 * - Usar WaveEmitter para crear fuentes muestreadas sobre el perímetro/segmentos.
 * - Calcular dos mapas físicos (rojo estrecho, amarillo ancho) con ISOModel.computeGridLpFromSources.
 * - Mezclar energías lineales para obtener un resultado natural: rojo centrado + halo amarillo.
 *
 * Opciones relevantes:
 *  - redMaxDist, yellowMaxDist (m)
 *  - sampleSpacing (m)
 *  - dbPerMeter
 *  - redWeight, yellowWeight
 *  - applyYellowBlur: radio en celdas para suavizar halo
 */
export function generateRedHeatmapFromFacade(
	gridX: number[],
	gridY: number[],
	segments: { name?: string; p1: number[]; p2: number[] }[],
	perimeter: number[][],
	lwMap?: Record<string, number>,
	options?: {
		sampleSpacing?: number;
		outwardOffset?: number;
		redMaxDist?: number;
		yellowMaxDist?: number;
		dbPerMeter?: number;
		redWeight?: number;
		yellowWeight?: number;
		applyYellowBlur?: number; // blur radius in cells
	}
) {
	const w = gridX.length, h = gridY.length;
	const redMaxDist = options?.redMaxDist ?? 2.0;
	const yellowMaxDist = options?.yellowMaxDist ?? Math.max(4, redMaxDist * 3);
	const sampleSpacing = options?.sampleSpacing ?? 0.25;
	const outwardOffset = options?.outwardOffset ?? 0.02;
	const dbPerMeter = options?.dbPerMeter ?? 0.5;
	const redWeight = options?.redWeight ?? 1.0;
	const yellowWeight = options?.yellowWeight ?? 0.6;
	const applyYellowBlur = options?.applyYellowBlur ?? 2;

	// prepare segments/sources (unchanged)
	const segmentsWithNames = segments.map((seg, i) => ({
		name: typeof seg.name === "string" ? seg.name : `segment-${i}`,
		p1: seg.p1,
		p2: seg.p2
	}));
	const sources = WaveEmitter.generateSources(perimeter, segmentsWithNames, sampleSpacing, outwardOffset, lwMap)
		.map(s => ({ x: s.x, z: s.z, Lw: s.Lw, nx: s.nx, nz: s.nz })) as SourceSimple[];

	// compute red/yellow raw dB maps (unchanged)
	const redDb = ISOModel.computeGridLpFromSources(sources, gridX, gridY, { maxDist: redMaxDist, dbPerMeter, directivityCut: 1.0, Lw_isRoom: true });
	const yellowDb = ISOModel.computeGridLpFromSources(sources, gridX, gridY, { maxDist: yellowMaxDist, dbPerMeter, directivityCut: 0.8, Lw_isRoom: true });

	// helper: robust cell-inside test (use cell corners to avoid aliasing on edges)
	const cellHalfX = (gridX.length > 1) ? Math.abs(gridX[1] - gridX[0]) * 0.5 : 0.5;
	const cellHalfY = (gridY.length > 1) ? Math.abs(gridY[1] - gridY[0]) * 0.5 : 0.5;
	function pointInPolyLocal(x: number, z: number, poly: number[][]) {
		if (!poly || poly.length < 3) return false;
		let inside = false;
		for (let ii = 0, jj = poly.length - 1; ii < poly.length; jj = ii++) {
			const xi = poly[ii][0], zi = poly[ii][1];
			const xj = poly[jj][0], zj = poly[jj][1];
			const intersect = ((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / ((zj - zi) || 1e-12) + xi);
			if (intersect) inside = !inside;
		}
		return inside;
	}

	function isCellInsidePoly(cx: number, cz: number, halfX: number, halfZ: number, poly: number[][]) {
		const corners = [
			[cx - halfX, cz - halfZ],
			[cx - halfX, cz + halfZ],
			[cx + halfX, cz - halfZ],
			[cx + halfX, cz + halfZ]
		];
		for (const [x, z] of corners) if (pointInPolyLocal(x, z, poly)) return true;
		return false;
	}

	// Build linear maps but enforce perimeter mask and perpendicular caps
	let redLinear: number[][] = Array.from({ length: h }, () => new Array(w).fill(0));
	let yellowLinear: number[][] = Array.from({ length: h }, () => new Array(w).fill(0));

	for (let j = 0; j < h; j++) {
		for (let i = 0; i < w; i++) {
			const px = gridX[i], pz = gridY[j];

			// skip cells whose area intersects the perimeter
			if (isCellInsidePoly(px, pz, cellHalfX, cellHalfY, perimeter)) {
				redLinear[j][i] = 0;
				yellowLinear[j][i] = 0;
				continue;
			}

			// find the greatest positive perpendicular among segments (facade in front)
			let bestPerp = -Infinity;
			for (const seg of segmentsWithNames) {
				const p = getPerpAlong(px, pz, seg.p1, seg.p2).perp;
				if (p > bestPerp) bestPerp = p;
			}

			// if no facade faces this point, zero
			if (!(bestPerp > 0)) {
				redLinear[j][i] = 0;
				yellowLinear[j][i] = 0;
				continue;
			}

			// convert dB to linear only if within the perpendicular caps
			const rv = redDb[j][i];
			const yv = yellowDb[j][i];

			redLinear[j][i] = (bestPerp <= redMaxDist && rv > -Infinity) ? Math.pow(10, rv / 10) : 0;
			yellowLinear[j][i] = (bestPerp <= yellowMaxDist && yv > -Infinity) ? Math.pow(10, yv / 10) : 0;
		}
	}

	// optional: blur yellow linear map to make halo smooth
	if (applyYellowBlur && applyYellowBlur > 0) {
		yellowLinear = gaussianBlurMatrix(yellowLinear, applyYellowBlur);
	}

	// combine red + yellow linearly, with weights
	const out: number[][] = Array.from({ length: h }, () => new Array(w).fill(NaN));
	for (let j = 0; j < h; j++) {
		for (let i = 0; i < w; i++) {
			const rE = redLinear[j][i];
			const yE = yellowLinear[j][i];
			const combinedE = redWeight * rE + yellowWeight * yE;
			// Use NaN for empty cells so Plotly renders them as transparent/absent
			out[j][i] = combinedE > 0 ? 10 * Math.log10(combinedE) : NaN;
		}
	}

	return out;
}
