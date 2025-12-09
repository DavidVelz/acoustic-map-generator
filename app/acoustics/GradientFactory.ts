import ISOModel from "../lib/ISOModel";




export type ColorBand = "red" | "yellow" | "green" | "blue";
export type Segment = { name: string; p1: number[]; p2: number[] };

export type GradientParams = {
	cellSize?: number;
	sourceSpacing?: number;
	redMaxDist?: number;
	redFalloffScale?: number;
	redSampleSpacing?: number;
	lateralTaper?: number;
	colorSpread?: Record<ColorBand, number>;
	propagation?: any;
	// optional behaviour flags:
	normalize?: "per_sample" | "per_meter" | "none";
	debugEmit?: boolean;
	// if debugEmit true, caller may provide an array to collect points:
	__emitPoints?: any[];
	// optional centroid for outward normal (used elsewhere)
	center?: { x: number; y: number } | null;
	// --- nuevos controles ---
	dotThreshold?: number;
	// optional polygon for normal orientation
	poly?: number[][] | null;
	lateralSpreadFactor?: number;

	invertNormals?: boolean;
};

// Simple point-in-polygon (ray-casting) — misma versión que en AcousticCalculator pero local
export function pointInPolygon(x: number, y: number, poly: number[][]): boolean {
	if (!poly || poly.length < 3) return false;
	let inside = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const xi = poly[i][0], yi = poly[i][1];
		const xj = poly[j][0], yj = poly[j][1];
		const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-12) + xi);
		if (intersect) inside = !inside;
	}
	return inside;
}

/**
 * computeFacadeRePrime
 * - elements: array de { area: number, R: number } para cada elemento de la fachada (muros, ventanas, puertas...)
 * - totalArea: opcional, si se conoce el área total de la fachada; si no se suministra se calcula sumando areas
 * 
 * Retorna R'_e en dB (number). Si los datos son insuficientes devuelve NaN.
 *
 * Fórmula:
 *   R'_e = -10 * log10( sum_j (S_j * 10^{-R_j/10}) / S_fachada )
 */
export function computeFacadeRePrime(
	elements: { area: number; R: number }[] | undefined | null,
	totalArea?: number
): number {
	if (!Array.isArray(elements) || elements.length === 0) return NaN;
	let Ssum = 0;
	let weighted = 0;
	for (const el of elements) {
		const S = Number(el?.area) || 0;
		const R = Number(el?.R);
		if (S <= 0 || !Number.isFinite(R)) continue;
		Ssum += S;
		weighted += S * Math.pow(10, -R / 10);
	}
	const Sfachada = (typeof totalArea === "number" && totalArea > 0) ? totalArea : Ssum;
	if (Sfachada <= 0 || weighted <= 0) return NaN;
	const RePrime = -10 * Math.log10(weighted / Sfachada);
	return RePrime;
}

/**
 * generateSegmentBandEnergy
 * - seg: segment geometry
 * - band: "red" | "yellow" | "green" | "blue"
 * - Lw_room: segment Lw (dB)
 * - RePrime: facade Re' for ISO
 * - xs, ys: grid coordinates (xs length = w, ys length = h)
 * - params: tunables
 *
 * Returns: energy[h][w] (linear scale)
 */
export function generateSegmentBandEnergy(
	seg: Segment,
	band: ColorBand,
	Lw_room: number,
	RePrime: number,
	xs: number[], ys: number[],
	params: GradientParams = {}
) {
	const h = ys.length, w = xs.length;
	const energy: number[][] = Array.from({ length: h }, () => new Array(w).fill(0));
	const ax = seg.p1[0], az = seg.p1[1], bx = seg.p2[0], bz = seg.p2[1];
	const vx = bx - ax, vz = bz - az;
	const segLen = Math.hypot(vx, vz);
	if (segLen <= 1e-9) return energy;

	// normalization mode: por defecto 'per_meter' para homogeneidad
	const normalize = params.normalize ?? "per_meter";

	// debug emit init
	const debugEmit = Boolean(params.debugEmit);
	if (debugEmit && !Array.isArray(params.__emitPoints)) params.__emitPoints = [];

	// normals: compute tangent & candidate normal
	const tx = vx / segLen, tz = vz / segLen;
	// Normal siempre hacia afuera (no usar centroide ni polygon test)
	const nx = -tz, nz = tx;

	// front-side relax threshold (allow slightly oblique points)
	const dotThreshold = Number(params.dotThreshold ?? -1.0); // Permitir ángulos más amplios

	// color band processing
	const sampleSpacing = params.sourceSpacing ?? Math.max(0.25, (params.cellSize ?? 1) * 0.5);
	const nSamples = Math.max(1, Math.min(256, Math.ceil(segLen / sampleSpacing)));
	const sampleLen = segLen / nSamples;

	// compute base per-sample function (used by linear bands)
	let baseLwPerSampleDb: (idx?: number) => number;
	if (normalize === "none") {
		baseLwPerSampleDb = () => Lw_room;
	} else {
		// per_meter default: compute power per meter and assign by sample length
		baseLwPerSampleDb = () => {
			const P_total = Math.pow(10, Lw_room / 10);
			const P_per_m = P_total / Math.max(1e-12, segLen);
			const P_sample = P_per_m * sampleLen;
			return 10 * Math.log10(Math.max(1e-12, P_sample));
		};
	}

	// --- RED: denser sampling + per_meter normalization + eliptic kernel (mejora de forma) ---
	if (band === "red") {
		const redSampleSpacing = Math.max(0.05, Number(params.redSampleSpacing ?? 0.12));
		const nRed = Math.max(1, Math.min(2048, Math.ceil(segLen / redSampleSpacing)));
		const sampleLenRed = segLen / nRed;
		const LwPerSampleDbRed = (normalize === "none")
			? Lw_room
			: (10 * Math.log10(Math.pow(10, Lw_room / 10) / Math.max(1e-12, segLen) * sampleLenRed));

		// parámetros ajustables desde params
		const lateralFactor = Number(params.lateralSpreadFactor ?? 0.18);
		const sigmaPerpRed = Math.max(0.12, segLen * Math.max(0.02, lateralFactor * 0.12));   // base estrecha
		const sigmaPerpYellow = Math.max(0.6, segLen * Math.max(0.08, lateralFactor * 0.6));  // halo amarillo más ancho
		const maxRed = Number(params.redMaxDist ?? 2.0);
		const fallScale = Math.max(0.1, Number(params.redFalloffScale ?? 1.2));
		const dotT = Number(params.dotThreshold ?? -1.0);

		const redPeakFactor = 1.0;
		const yellowPeakFactor = 0.55;

		for (let s = 0; s < nRed; s++) {
			const frac = (s + 0.5) / nRed;
			const sx = ax + vx * frac, sz = az + vz * frac;
			if (debugEmit) params.__emitPoints!.push({ seg: seg.name, sampleIndex: s, pos: [sx, sz], segLen, sampleLen: sampleLenRed, LwPerSampleDb: LwPerSampleDbRed });

			// usar tangente y normal ya calculadas arriba (tx,tz,nx,nz)
			const tx_s = tx, tz_s = tz;
			let nx_s = nx, nz_s = nz;

			for (let j = 0; j < h; j++) {
				for (let i = 0; i < w; i++) {
					const rx = xs[i], rz = ys[j];

					// vector desde sample hacia receptor
					const vrx = rx - sx, vrz = rz - sz;
					const rnorm = Math.hypot(vrx, vrz);
					if (rnorm < 1e-9) continue;

					// perpendicular signed (positivo hacia afuera)
					const perp = vrx * nx_s + vrz * nz_s;
					if (perp <= 0) continue; // solo el exterior

					// control angular (opcional)
					const dot = (vrx * nx_s + vrz * nz_s) / rnorm;
					if (dot <= dotT) continue;

					// usar SOLO la distancia perpendicular para la atenuación acústica
					const distancePerp = Math.max(0.01, Math.abs(perp));

					// calcular Lp usando la distancia perpendicular (uniforme a lo largo)
					const lp = ISOModel.computeLpOutAtPoint({
						Lw_room: LwPerSampleDbRed,
						RePrime,
						Df_room: 6,
						Df_out: 0,
						distanceM: distancePerp,
						atmospheric: 0
					});
					if (!Number.isFinite(lp)) continue;

					// pesos perpendiculares (rojo estrecho, amarillo más ancho)
					const sigma_perp_red = Math.max(0.25, Math.max(maxRed * 0.6, segLen * 0.12));
					const w_perp_red = Math.exp(- (perp * perp) / (2 * sigma_perp_red * sigma_perp_red));
					const w_red = w_perp_red * redPeakFactor;

					const sigma_perp_yellow = Math.max(0.6, Math.max(maxRed * 1.2, segLen * 0.25));
					const w_perp_yellow = Math.exp(- (perp * perp) / (2 * sigma_perp_yellow * sigma_perp_yellow));
					const w_yellow = w_perp_yellow * yellowPeakFactor;

					// suavizado fuera de maxRed
					let fall = 1;
					if (perp > maxRed) fall = Math.exp(-(perp - maxRed) / fallScale);

					// convertir lp a energía lineal y aplicar pesos
					const linearBase = Math.pow(10, lp / 10);
					energy[j][i] += linearBase * Math.max(0, w_red * fall);
					energy[j][i] += linearBase * Math.max(0, w_yellow * fall * 0.75);
				}
			}
		}
		return energy;
	}

	// --- existing linear band processing (unchanged) ---
	// Extract colorSpread from params or provide default values
	// colorSpread keys: red / yellow / green / blue (blue acts as cyan in the overlay)
	const colorSpread: Record<ColorBand, number> = params.colorSpread ?? {
		red: 1.2,
		yellow: 2.0,
		green: 2.5,
		blue: 3.0 // 'blue' = cyan hue in the palette
	};

	// Extract propagation from params or provide default empty object
	const propagation = params.propagation ?? {};

	for (let s = 0; s < nSamples; s++) {
		const frac = (s + 0.5) / nSamples;
		const sx = ax + vx * frac;
		const sz = az + vz * frac;
		const LwPerSampleDb = baseLwPerSampleDb(s);
		if (debugEmit) {
			params.__emitPoints!.push({ seg: seg.name, sampleIndex: s, pos: [sx, sz], segLen, sampleLen, LwPerSampleDb });
		}
		for (let j = 0; j < h; j++) {
			for (let i = 0; i < w; i++) {
				const rx = xs[i], rz = ys[j];
				const vrx = rx - sx, vrz = rz - sz;
				const rnorm = Math.hypot(vrx, vrz);
				if (rnorm > 1e-6) {
					const dot = (vrx * nx + vrz * nz) / rnorm;
					if (dot <= dotThreshold) continue;
				}
				const lp = ISOModel.computeLpOutAtPoint({ Lw_room: LwPerSampleDb, RePrime, Df_room: 6, Df_out: 0, distanceM: Math.max(0.01, rnorm), atmospheric: 0 });
				if (!Number.isFinite(lp)) continue;
				const spread = colorSpread[band] ?? 2.0;
				const bandMax = (propagation.bandMaxDist && propagation.bandMaxDist[band]) ?? (band === "yellow" ? 6 : (band === "green" ? 12 : 18));
				const lateralSigma = Math.max(0.3, spread);
				const lateralWeight = Math.exp(- (rnorm * rnorm) / (2 * lateralSigma * lateralSigma));
				const longAtt = Math.exp(- rnorm / Math.max(0.1, bandMax * 1.2)); // antes era 0.7, ahora 1.2 para que decaiga más lento
				const lpAdj = lp + 10 * Math.log10(lateralWeight * longAtt + 1e-12);
				const e = Math.pow(10, lpAdj / 10);
				energy[j][i] += e;
			}
		}
	}
	console.log(
		`[SEGMENTO] ${seg.name} | p1: (${ax.toFixed(2)}, ${az.toFixed(2)}) | p2: (${bx.toFixed(2)}, ${bz.toFixed(2)}) | normal: (${nx.toFixed(2)}, ${nz.toFixed(2)}) | segLen: ${segLen.toFixed(2)}`
	);
	return energy;
}

export default { generateSegmentBandEnergy, computeFacadeRePrime };
