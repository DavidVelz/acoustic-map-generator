export type ColorGradientOptions = {
	redRadius?: number;
	redDecay?: number;
	// nuevos parámetros físicos y de muestreo
	maxDist?: number; // máximo alcance para rojo (m)
	dbPerMeter?: number; // dB/m atenuación adicional (atm./difusión)
	sampleSpacing?: number; // m entre emisores a lo largo de la fachada
	sigmaAlongFactor?: number; // factor para sigma a lo largo (sigma_along = segLen * factor)
	// opcional: pérdidas de fachada (Re' o similar) por nombre de segmento en dB
	facadeLossMap?: Record<string, number>;
};

export type Segment = {
	name: string;
	p1: number[];
	p2: number[];
};

export default class ColorGradientManager {
	private opts: Required<ColorGradientOptions>;

	constructor(options?: ColorGradientOptions) {
		this.opts = {
			redRadius: options?.redRadius ?? 2.0,
			redDecay: options?.redDecay ?? 8.0,
			maxDist: options?.maxDist ?? 2.0,
			dbPerMeter: options?.dbPerMeter ?? 0.5,
			sampleSpacing: options?.sampleSpacing ?? 0.25,
			sigmaAlongFactor: options?.sigmaAlongFactor ?? 0.25,
			facadeLossMap: options?.facadeLossMap ?? {}
		};
	}

	// Compute the shortest distance from point (px, pz) to segment (x1, z1)-(x2, z2)
	private pointToSegmentDist(px: number, pz: number, x1: number, z1: number, x2: number, z2: number): number {
		const dx = x2 - x1;
		const dz = z2 - z1;
		if (dx === 0 && dz === 0) {
			return Math.hypot(px - x1, pz - z1);
		}
		const t = ((px - x1) * dx + (pz - z1) * dz) / (dx * dx + dz * dz);
		const tClamped = Math.max(0, Math.min(1, t));
		const closestX = x1 + tClamped * dx;
		const closestZ = z1 + tClamped * dz;
		return Math.hypot(px - closestX, pz - closestZ);
	}

	/**
	 * computeGradientValue — modelo físico simplificado por fachada.
	 * - Muestrea fachadas en emisores.
	 * - Calcula Lp por muestra y aplica ponderación elíptica (perp + along).
	 * - Suma energía lineal y convierte a dB.
	 */
	computeGradientValue(
		px: number,
		pz: number,
		segments: Segment[],
		LwMap: Record<string, number>,
		isInsidePerimeter: boolean
	): number {
		if (isInsidePerimeter) return -Infinity;

		// parámetros desde opts
		const maxDist = this.opts.maxDist;
		const dbPerMeter = this.opts.dbPerMeter;
		const sampleSpacing = this.opts.sampleSpacing;
		const sigmaAlongFactor = this.opts.sigmaAlongFactor;
		const facadeLossMap = this.opts.facadeLossMap;

		// constante 10*log10(4π) para conversión de potencia a presión (simplificación)
		const FOUR_PI_CONST = 10 * Math.log10(4 * Math.PI);
		const minDist = 0.01;

		// centroid simple para orientar normales hacia afuera
		const center = (() => {
			let sx = 0, sz = 0, c = 0;
			for (const s of segments) {
				if (!s || !s.p1 || !s.p2) continue;
				const ax = s.p1[0], az = s.p1[1], bx = s.p2[0], bz = s.p2[1];
				sx += (ax + bx) * 0.5; sz += (az + bz) * 0.5; c++;
			}
			return c ? { x: sx / c, z: sz / c } : { x: 0, z: 0 };
		})();

		let totalE = 0; // energía lineal acumulada

		for (const seg of segments) {
			const Lw_seg = Number(LwMap[seg.name]);
			if (!Number.isFinite(Lw_seg) || Lw_seg <= 0) continue;

			const a = seg.p1, b = seg.p2;
			const dx = b[0] - a[0], dz = b[1] - a[1];
			const segLen = Math.hypot(dx, dz);
			if (segLen < 1e-6) continue;

			// tangente y normal (orientar normal hacia afuera)
			const tx = dx / segLen, tz = dz / segLen;
			let nx = -tz, nz = tx;
			const midX = (a[0] + b[0]) / 2, midZ = (a[1] + b[1]) / 2;
			if (((midX - center.x) * nx + (midZ - center.z) * nz) < 0) { nx = -nx; nz = -nz; }

			// muestreo a lo largo de la fachada
			const nSamples = Math.max(1, Math.ceil(segLen / sampleSpacing));
			const P_total = Math.pow(10, Lw_seg / 10); // energía lineal del segmento
			const P_per_sample = P_total / nSamples;

			// pérdida de transmisión de fachada (si existe)
			const facadeLoss = Number.isFinite(Number(facadeLossMap[seg.name])) ? Number(facadeLossMap[seg.name]) : 0;

			for (let s = 0; s < nSamples; s++) {
				const frac = (s + 0.5) / nSamples;
				const sx = a[0] + tx * segLen * frac;
				const sz = a[1] + tz * segLen * frac;

				const vrx = px - sx, vrz = pz - sz;
				const dist = Math.hypot(vrx, vrz);
				const perp = vrx * nx + vrz * nz;
				// solo contribuye si está hacia afuera y dentro de maxDist
				if (perp <= 0 || perp > maxDist) continue;

				const dClamp = Math.max(minDist, dist);
				// pérdida geométrica + constante
				const geomLoss = 20 * Math.log10(dClamp) + FOUR_PI_CONST;
				const atmosLoss = dbPerMeter * dClamp;

				// Lp por muestra (dB)
				const Lp_sample_db = 10 * Math.log10(Math.max(1e-12, P_per_sample)) - geomLoss - atmosLoss - facadeLoss;

				// ponderación elíptica: perpendicular + along (centro segment)
				// usar distancia perpendicular para la atenuación acústica (para cubrir toda la longitud)
				const distancePerp = Math.max(minDist, Math.abs(perp));
				// sigma perpendicular aumentado para cubrir anchura mayor (ajustable)
				const sigma_perp = Math.max(0.5, Math.max(maxDist * 0.9, segLen * 0.25));
				const w_perp = Math.exp(- (perp * perp) / (2 * sigma_perp * sigma_perp));
				const w_along = 1.0; // do not attenuate along the facade
				const weight = w_perp * w_along;

				// usar distancePerp (no euclidiana) para el cálculo acústico (evita caída a lo largo)
				const Lp_sample_db_adj = 10 * Math.log10(Math.max(1e-12, P_per_sample)) - (20 * Math.log10(distancePerp) + FOUR_PI_CONST) - (dbPerMeter * distancePerp) - facadeLoss;
				const E_sample = Math.pow(10, Lp_sample_db_adj / 10) * weight;
				totalE += E_sample;
			}
		}

		if (totalE <= 0) return -Infinity;
		const Lp_total_db = 10 * Math.log10(totalE);
		return Number.isFinite(Lp_total_db) ? Lp_total_db : -Infinity;
	}
}

// Nota: 'blue' en colorSpread se interpreta como cyan en la paleta (ajustado en ColorMap.ts)