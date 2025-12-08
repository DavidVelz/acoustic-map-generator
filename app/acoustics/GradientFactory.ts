import ISOModel from "../lib/ISOModel";

export type ColorBand = "red" | "yellow" | "green" | "blue";
type Segment = { name: string; p1: number[]; p2: number[] };

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
	let nx = -tz, nz = tx;

	// orient normal robustly (centroid + probe using params.poly if available)
	if (params.center && Number.isFinite(params.center.x) && Number.isFinite(params.center.y)) {
		const midx = ax + vx * 0.5, midy = az + vz * 0.5;
		const vxToCent = midx - (params.center.x ?? 0);
		const vyToCent = midy - (params.center.y ?? 0);
		if ((nx * vxToCent + nz * vyToCent) > 0) { nx = -nx; nz = -nz; }
	}
	// robust probe test using polygon if provided
	if (params.poly && Array.isArray(params.poly) && params.poly.length) {
		const midx = ax + vx * 0.5, midy = az + vz * 0.5;
		const probeStep = Math.max(0.05, (params.cellSize ?? 1) * 0.35);
		const testOutX = midx + nx * probeStep, testOutY = midy + nz * probeStep;
		if (pointInPolygon(testOutX, testOutY, params.poly)) { nx = -nx; nz = -nz; }
	}

	// front-side relax threshold (allow slightly oblique points)
	const dotThreshold = Number(params.dotThreshold ?? params.dotThreshold ?? -0.18);

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

	// --- RED: denser sampling + per_meter normalization + sigma escalada con segLen ---
	if (band === "red") {
		const redSampleSpacing = Math.max(0.05, Number(params.redSampleSpacing ?? 0.12));
		const nRed = Math.max(1, Math.min(1024, Math.ceil(segLen / redSampleSpacing)));
		const sampleLenRed = segLen / nRed;
		const LwPerSampleDbRed = (normalize === "none")
			? Lw_room
			: (10 * Math.log10(Math.pow(10, Lw_room / 10) / Math.max(1e-12, segLen) * sampleLenRed));

		// sigma proportional a la longitud del segmento para que el rojo cubra todo el ancho/largo de la fachada
		const sigmaBase = Math.max(0.3, segLen * 0.18);

		for (let s = 0; s < nRed; s++) {
			const frac = (s + 0.5) / nRed;
			const sx = ax + vx * frac, sz = az + vz * frac;
			if (debugEmit) params.__emitPoints!.push({ seg: seg.name, sampleIndex: s, pos: [sx, sz], segLen, sampleLen: sampleLenRed, LwPerSampleDb: LwPerSampleDbRed });
			for (let j = 0; j < h; j++) {
				for (let i = 0; i < w; i++) {
					const rx = xs[i], rz = ys[j];
					const vrx = rx - sx, vrz = rz - sz;
					const rnorm = Math.hypot(vrx, vrz);
					if (rnorm > 1e-6) {
						const dot = (vrx * nx + vrz * nz) / rnorm;
						if (dot <= dotThreshold) continue;
					}
					const lp = ISOModel.computeLpOutAtPoint({ Lw_room: LwPerSampleDbRed, RePrime, Df_room: 6, Df_out: 0, distanceM: Math.max(0.01, rnorm), atmospheric: 0 });
					if (!Number.isFinite(lp)) continue;
					const sigma = Math.max(sigmaBase, 0.5);
					const wshape = Math.exp(- (rnorm * rnorm) / (2 * sigma * sigma));
					const fall = rnorm > (params.redMaxDist ?? 2.0) ? Math.exp(-(rnorm - (params.redMaxDist ?? 2.0)) / Math.max(0.1, params.redFalloffScale ?? 1.2)) : 1;
					const lpAdj = lp + 10 * Math.log10(wshape * fall + 1e-12);
					energy[j][i] += Math.pow(10, lpAdj / 10);
				}
			}
		}
		return energy;
	}

	// --- existing linear band processing (unchanged) ---
	// Extract colorSpread from params or provide default values
	const colorSpread: Record<ColorBand, number> = params.colorSpread ?? {
		red: 1.2,
		yellow: 2.0,
		green: 2.5,
		blue: 3.0
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
					if (dot <= 0) continue;
				}
				const lp = ISOModel.computeLpOutAtPoint({ Lw_room: LwPerSampleDb, RePrime, Df_room: 6, Df_out: 0, distanceM: Math.max(0.01, rnorm), atmospheric: 0 });
				if (!Number.isFinite(lp)) continue;
				const spread = colorSpread[band] ?? 2.0;
				const bandMax = (propagation.bandMaxDist && propagation.bandMaxDist[band]) ?? (band === "yellow" ? 6 : (band === "green" ? 12 : 18));
				const lateralSigma = Math.max(0.3, spread);
				const lateralWeight = Math.exp(- (rnorm * rnorm) / (2 * lateralSigma * lateralSigma));
				const longAtt = Math.exp(- rnorm / Math.max(0.1, bandMax * 0.7));
				const lpAdj = lp + 10 * Math.log10(lateralWeight * longAtt + 1e-12);
				const e = Math.pow(10, lpAdj / 10);
				energy[j][i] += e;
			}
		}
	}
	return energy;
}

// Replaced linearEnergyForSample / applyLinearForSegment implementation
function linearEnergyForSample(
	seg: Segment,
	Lw_room: number,
	RePrime: number,
	xs: number[], ys: number[],
	params: GradientParams,
	band: ColorBand
) {
	const h = ys.length, w = xs.length;
	const energy: number[][] = Array.from({ length: h }, () => new Array(w).fill(0));
	const ax = seg.p1[0], az = seg.p1[1], bx = seg.p2[0], bz = seg.p2[1];
	const vx = bx - ax, vz = bz - az;
	const segLen = Math.hypot(vx, vz);
	if (segLen <= 1e-9) return energy;

	// unit tangent and normal
	const tx = vx / segLen, tz = vz / segLen;
	let nx = -tz, nz = tx;
	// orient normal outward if centroid provided (best-effort)
	if (params.center && Number.isFinite(params.center.x) && Number.isFinite(params.center.y)) {
		const midx = ax + vx * 0.5, midy = az + vz * 0.5;
		const vxToCent = midx - (params.center.x ?? 0), vyToCent = midy - (params.center.y ?? 0);
		if ((nx * vxToCent + nz * vyToCent) > 0) { nx = -nx; nz = -nz; }
	}

	const sampleSpacing = params.sourceSpacing ?? Math.max(0.25, (params.cellSize ?? 1) * 0.5);
	const nSamples = Math.max(1, Math.min(256, Math.ceil(segLen / sampleSpacing)));
	const sampleLen = segLen / nSamples;
	// per-meter normalization preferred
	const normalize = params.normalize ?? "per_meter";
	const LwPerSampleDbFn = (() => {
		if (normalize === "none") return () => Lw_room;
		// per_meter: total power / meter * sample length -> dB
		return () => {
			const P_total = Math.pow(10, Lw_room / 10);
			const P_per_m = P_total / Math.max(1e-12, segLen);
			const P_sample = P_per_m * sampleLen;
			return 10 * Math.log10(Math.max(1e-12, P_sample));
		};
	})();

	const spread = (params.colorSpread && params.colorSpread[band]) ?? (band === "yellow" ? 2 : (band === "green" ? 4 : 6));
	const bandMax = (params.propagation && params.propagation.bandMaxDist && params.propagation.bandMaxDist[band]) ?? (band === "yellow" ? 6 : (band === "green" ? 12 : 18));
	const lateralSigmaBase = Math.max(0.3, spread);

	// Edge taper helper (reuse approximate taper)
	const edgeTaper = (tClamped: number) => {
		if (segLen <= 0) return 0;
		const atStart = tClamped / Math.max(1e-6, segLen);
		const atEnd = (segLen - tClamped) / Math.max(1e-6, segLen);
		const raw = Math.min(atStart, atEnd);
		return Math.pow(Math.max(0, Math.min(1, raw * 2)), 1 + 2 * (params.lateralTaper ?? 0.25));
	};

	for (let s = 0; s < nSamples; s++) {
		const frac = (s + 0.5) / nSamples;
		const sx = ax + vx * frac;
		const sz = az + vz * frac;
		const tClamped = frac * segLen;
		const LwPerSampleDb = LwPerSampleDbFn();

		// debug emit
		if (params.debugEmit && Array.isArray(params.__emitPoints)) {
			params.__emitPoints.push({ seg: seg.name, sampleIndex: s, pos: [sx, sz], segLen, sampleLen, LwPerSampleDb });
		}

		for (let j = 0; j < h; j++) {
			for (let i = 0; i < w; i++) {
				const rx = xs[i], rz = ys[j];
				const vrx = rx - sx, vrz = rz - sz;
				// decompose into along / lateral relative to tangent/normal
				const along = vrx * tx + vrz * tz;            // positive = in front along tangent
				const lateral = Math.abs(vrx * nx + vrz * nz); // perpendicular distance

				// Allow some contribution even for slightly negative along (oblique behind) — front-side tolerated elsewhere
				// compute effective distance for ISO attenuation (use true distance)
				const dist = Math.hypot(along, lateral);
				if (dist <= 0) continue;

				// ISO Lp_out based on per-sample Lw and radial distance (we model propagation physically)
				const lp = ISOModel.computeLpOutAtPoint({ Lw_room: LwPerSampleDb, RePrime, Df_room: 6, Df_out: 0, distanceM: Math.max(0.01, dist), atmospheric: 0 });
				if (!Number.isFinite(lp)) continue;

				// lateral gaussian weighting (ensures band width)
				const lateralSigma = Math.max(0.25, lateralSigmaBase * (params.lateralSpreadFactor ?? 1.0));
				const lateralWeight = Math.exp(- (lateral * lateral) / (2 * lateralSigma * lateralSigma));

				// longitudinal attenuation: prefer forward along positive direction; but allow both
				const alongClamped = Math.max(0, along); // preferentially propagate forward
				const longAtt = Math.exp(- alongClamped / Math.max(0.1, bandMax * 0.7));

				// edge taper reduces contribution near segment ends
				const wEdge = Math.max(0.001, edgeTaper(tClamped));

				// combine: physical lp -> linear energy * lateral * long * edge
				const lpAdj = lp + 10 * Math.log10(Math.max(1e-12, lateralWeight * longAtt * wEdge));
				const e = Math.pow(10, lpAdj / 10);
				energy[j][i] += e;
			}
		}
	}

	return energy;
}

export default { generateSegmentBandEnergy };
