import ISOModel, { SourceSimple } from "../lib/ISOModel";
import { getPerpAlong } from "./FacadeUtils";
import WaveEmitter from "./WaveEmitter";

/**
 * getColorscale
 *
 * Devuelve una paleta base de anclas (posición normalizada [0..1], color hex) que se usa
 * como referencia para construir rampas de color muestreadas para Plotly.
 * La paleta incluye: azul oscuro -> cyan -> verde -> amarillo -> rojo.
 *
 * No realiza cálculo alguno, solo devuelve los anclajes por defecto.
 */
export function getColorscale() {
	// Azul oscuro -> cyan -> verde -> amarillo -> rojo
	return [
		[0.0, "#00224d"], // azul oscuro
		[0.20, "#00cccc"], // cyan
		[0.40, "#00cc66"], // verde
		[0.70, "#ffff33"], // amarillo
		[1.0,  "#ff0000"]  // rojo
	] as [number, string][];
}

/**
 * buildThresholdColorscale(zmin, zmax, thresholds)
 *
 * Construye y devuelve un colorscale muestreado y suave (lista de [pos,color]) para Plotly
 * basado en:
 *  - zmin / zmax: rango de datos real de la malla de niveles (dB).
 *  - thresholds: umbrales configurables { redThreshold, yellowThreshold, greenThreshold, blueThreshold, yellowSpread }.
 *
 * Comportamiento resumido:
 *  - Mapea los umbrales a posiciones normalizadas dentro de [0..1] (con pequeño margen para evitar extremos).
 *  - Inserta anclas para deepBlue, cyan, green, yellow y red (cyan posicionado por blueThreshold).
 *  - Aplica una corrección mínima de separación entre anclas para evitar franjas duras.
 *  - Muestrea densamente la rampa (N pasos) interpolando colores entre anclas para generar una gradiente continua.
 *
 * Retorna: array [ [pos,color], ... ] apto para Plotly (pos en [0..1], color en "#rrggbb").
 */
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
  // blueThreshold positions cyan between deep and green
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

  // build anchor list (keep cyan) and sort
  let anchors: { p: number; color: string }[] = [
    { p: pDeep, color: C.deepBlue },
    { p: pCyan, color: C.cyan },
    { p: pGreen, color: C.green },
    { p: pYellow, color: C.yellow },
    { p: pRed, color: C.red }
  ].filter(a => Number.isFinite(a.p)).sort((a, b) => a.p - b.p);

  // Asegurar que los anclajes cubran 0..1
  if (anchors.length === 0) return getColorscale();
  if (anchors[0].p > 0.0) anchors.unshift({ p: 0.0, color: C.deepBlue });
  if (anchors[anchors.length - 1].p < 1.0) anchors.push({ p: 1.0, color: anchors[anchors.length - 1].color });

  // --- IMPORTANTE: evitar que los anclajes queden demasiado juntos (previene bandas duras) ---
  const minGap = 1e-2; // separación mínima normalizada entre anclajes (ajustable)
  // pase hacia adelante: forzar la separación mínima
  for (let i = 1; i < anchors.length; i++) {
    const prev = anchors[i - 1].p;
    if (anchors[i].p < prev + minGap) anchors[i].p = prev + minGap;
  }
  // pase hacia atrás: forzar la separación mínima desde el final
  for (let i = anchors.length - 2; i >= 0; i--) {
    const next = anchors[i + 1].p;
    if (anchors[i].p > next - minGap) anchors[i].p = next - minGap;
  }
  // clamp to [0,1]
  anchors = anchors.map(a => ({ p: clamp01(a.p), color: a.color }));

  // helpers: conversión entre hex <-> rgb
  const hexToRgb = (hex: string) => {
    const h = hex.replace("#", "");
    const n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  };
  const rgbToHex = (r: number, g: number, b: number) =>
    "#" + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, "0")).join("");
  
  // Interpolación entre dos colores hex
  const interpColor = (c1: string, c2: string, t: number) => {
    const a = hexToRgb(c1), b = hexToRgb(c2);
    return rgbToHex(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t);
  };

  // muestreo denso de la rampa para evitar bandas (banding)
  const N = 128;
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

  // compactar: eliminar duplicados cercanos y asegurar posiciones únicas y monótonas
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
 * applyColorAttenuation
 *
 * Aplica una atenuación simple en dB por metro a una matriz z usando una matriz de distancias.
 * Ambas matrices deben tener la misma forma [filas][columnas].
 * Devuelve una nueva matriz (no muta la entrada).
 *
 * Parámetros:
 *  - dbPerMeter: dB por metro a restar (ej. 0.5 .. 2.0).
 *  - spreadCells: radio entero (en celdas) para aplicar blur gaussiano y expandir el gradiente.
 *    Use 0 (por defecto) para desactivar.
 *  - mask: matriz opcional del mismo tamaño que limita dónde se aplica la difusión.
 *  - maskOptions: { invert?: boolean, mode?: 'source'|'receive'|'both' }.
 *      - invert: invertir la interpretación de la máscara.
 *      - mode:
 *         'source' (por defecto): la máscara limita qué celdas actúan como fuentes.
 *         'receive': la máscara limita qué celdas pueden recibir difusión.
 *         'both': ambas condiciones deben cumplirse.
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

/**
 * gaussianBlurMatrix(src, radius)
 *
 * Convolución separable 2D usando un kernel gaussiano 1D para suavizar la matriz numérica.
 * - radius: radio en celdas (entero). Si radius <= 0 devuelve la matriz original.
 * Implementación eficiente separable: primero horizontal, luego vertical.
 *
 * Retorna: nueva matriz suavizada.
 */
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

/**
 * gaussianBlurMatrixMasked(src, radius, mask, options)
 *
 * Versión del blur gaussiano que respeta una máscara:
 * - mask: matriz booleana/num que indica celdas válidas.
 * - options:
 *    - invert: invertir la interpretación de la máscara.
 *    - mode: 'source'|'receive'|'both' controla si la máscara filtra emisores, receptores o ambos.
 *
 * El algoritmo acumula valores y pesos (normaliza por la suma de pesos válidos) para evitar fugas.
 * Retorna: nueva matriz suavizada respetando la máscara.
 */
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

	// pase horizontal: acumular value*kernel para fuentes permitidas y sumar pesos válidos
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			let acc = 0;
			let wacc = 0;
			for (let k = -r; k <= r; k++) {
				const sx = Math.min(w - 1, Math.max(0, x + k));
				// evaluación de máscara para la fuente (aplica 'invert' si procede)
				let srcAllowed = isMasked(y, sx);
				if (invert) srcAllowed = !srcAllowed;
				// si mode === 'receive' permitimos todas las fuentes aquí (la recepción se evalúa luego)
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
	// pase vertical: combinar y normalizar; respetar máscara del receptor según el modo
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
 * generateRedGradient(...)
 *
 * Genera un mapa simple de Lp (dB) a partir de emisores discretos colocados sobre las fachadas.
 * - Ley usada: Lp_sample ≈ Lw_out - 20·log10(r) - 10·log10(4π) - dbPerMeter·r.
 * - Cada segmento se discretiza en emisores (sampleSpacing) y se aplica un kernel elíptico
 *   con sigma perpendicular y sigma longitudinal.
 * - Se suman energías lineales y se devuelve la matriz en dB (o -Infinity si no hay contribución).
 *
 * Parámetros principales:
 *  - gridX, gridY: vectores de coordenadas de la grilla (centros de celda).
 *  - segments: lista de segmentos {name,p1,p2}.
 *  - LwMap: niveles por segmento (dB).
 *  - ReMap: pérdidas de transmisión por fachada (dB).
 *  - maxDist, dbPerMeter, sampleSpacing, sigmaAlongFactor: parámetros de muestreo/atenuación.
 *
 * Retorna: matriz [rows][cols] con Lp estimado en dB (o -Infinity si no aplicable).
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

	// termino constante 10*log10(4*pi) ~ 10.99 dB
	const FOUR_PI_CONST = 10 * Math.log10(4 * Math.PI);

	// Punto-en-polígono simple (algoritmo del rayo)
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

	// Calcular centróide aproximado para orientar normales hacia el exterior
	const center = (() => {
		let sx = 0, sz = 0, c = 0;
		for (const s of segments) {
			if (!s || !s.p1 || !s.p2) continue;
			const ax = s.p1[0], az = s.p1[1], bx = s.p2[0], bz = s.p2[1];
			sx += (ax + bx) * 0.5; sz += (az + bz) * 0.5; c++;
		}
		return c ? { x: sx / c, z: sz / c } : { x: 0, z: 0 };
	})();

	// Para cada punto de la grilla acumular energía lineal de todas las muestras sobre fachadas
	for (let j = 0; j < h; j++) {
		for (let i = 0; i < w; i++) {
			const px = gridX[i], pz = gridY[j];

			// Respetar perímetro: omitir puntos interiores
			if (pointInPoly(px, pz, perimeter)) {
				out[j][i] = 0;
				continue;
			}

			let totalE = 0; // suma de energía lineal

			for (const seg of segments) {
				const segName = seg.name ?? "";
				// Lw dentro de la sala para esta fachada (dB). Si falta, usar fallbackPeak.
				const Lw_room = Number.isFinite(Number(LwMap[segName])) ? Number(LwMap[segName]) : fallbackPeak;
				// aplicar pérdida de transmisión de fachada si está provista
				const Re = Number.isFinite(Number(ReMap[segName])) ? Number(ReMap[segName]) : 0;
				const Lw_out = Lw_room - Re;

				const a = seg.p1, b = seg.p2;
				const dx = b[0] - a[0], dz = b[1] - a[1];
				const segLen = Math.hypot(dx, dz);
				if (segLen < 1e-6) continue;

				// orientar la normal hacia el exterior usando el centróide (heurística)
				const tx = dx / segLen, tz = dz / segLen;
				let nx = -tz, nz = tx;
				const midX = (a[0] + b[0]) / 2, midZ = (a[1] + b[1]) / 2;
				if (((midX - center.x) * nx + (midZ - center.z) * nz) < 0) { nx = -nx; nz = -nz; }

				// número de emisores discretos a lo largo de la fachada
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

					// geometric loss: 20*log10(dClamp) + FOUR_PI_CONST;
					const dClamp = Math.max(0.01, dist);
					const geomLoss = 20 * Math.log10(dClamp) + FOUR_PI_CONST;
					const atmosLoss = dbPerMeter * dClamp;
					const Lp_sample_db = 10 * Math.log10(Math.max(1e-12, P_per_sample)) - geomLoss - atmosLoss;

					// gaussiana lateral (perpendicular)
					const sigma_perp = Math.max(0.15, maxDist * 0.45);
					const w_perp = Math.exp(- (perp * perp) / (2 * sigma_perp * sigma_perp));
					// gaussiana longitudinal centrada en la mitad del segmento
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
 * generateRedHeatmapFromFacade(...)
 *
 * Genera un heatmap combinado (rojo estrecho + halo amarillo) muestreando emisores sobre el perímetro.
 * Documentación y comentarios en español arriba.
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
	// redMaxDist: alcance corto típico para la banda roja; mantener pequeño por defecto
	const redMaxDist = options?.redMaxDist ?? 2.0;
	// Aumentar yellowMaxDist para producir un halo amarillo más amplio por defecto.
	// Si el usuario pasa options.yellowMaxDist se utilizará ese valor.
	const yellowMaxDist = options?.yellowMaxDist ?? Math.max(12, redMaxDist * 8);

	const sampleSpacing = options?.sampleSpacing ?? 0.25;
	const outwardOffset = options?.outwardOffset ?? 0.02;
	const dbPerMeter = options?.dbPerMeter ?? 0.5;
	// Hacer la contribución amarilla más visible y suave por defecto:
	const redWeight = options?.redWeight ?? 1.0;
	const yellowWeight = options?.yellowWeight ?? 1.0;
	// applyYellowBlur controla el suavizado espacial (en celdas) del mapa amarillo.
	// Aumentar el valor por defecto para crear un halo más ancho y suave.
	const applyYellowBlur = options?.applyYellowBlur ?? 12;

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
