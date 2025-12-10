/**
 * Opciones para el generador de gradientes por fachada.
 *
 * Propiedades (unidades / significado):
 *  - redRadius?: number
 *      Radio operativo para la "banda roja" (m). Controla distancia lateral típica.
 *  - redDecay?: number
 *      Parámetro de caída (dB) de la banda roja (adimensional, mayor => caída más rápida).
 *  - maxDist?: number
 *      Distancia máxima (m) que se considera para contribuciones frontales (por defecto ~2 m).
 *  - dbPerMeter?: number
 *      Atenuación extra por metro (dB/m) para simular pérdidas atmosféricas/escenario.
 *  - sampleSpacing?: number
 *      Espaciado (m) entre emisores discretos a lo largo de la fachada.
 *  - sigmaAlongFactor?: number
 *      Factor multiplicador para sigma a lo largo del segmento (sigma_along = segLen * factor).
 *  - facadeLossMap?: Record<string, number>
 *      Mapa opcional { segmentName: Re_dB } con pérdidas de fachada por segmento (dB).
 */
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
	// factor adicional que escala la sigma lateral (mayor => halo más ancho)
	lateralSpreadFactor?: number;
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
			facadeLossMap: options?.facadeLossMap ?? {},
			// por defecto ampliar la sigma lateral 1.5x; subir si quieres halos más anchos
			lateralSpreadFactor: options?.lateralSpreadFactor ?? 1.5
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
	 * computeGradientValue
	 *
	 * Calcula el nivel Lp (dB) en la posición (px,pz) producido por las fachadas.
	 *
	 * Parámetros:
	 *  - px, pz: coordenadas del receptor en planta (m).
	 *  - segments: array de segmentos [{ name, p1:[x,z], p2:[x,z] }, ...].
	 *  - LwMap: mapa { segmentName: Lw_dB } con nivel interior por segmento (dB).
	 *  - isInsidePerimeter: boolean que indica si el punto está dentro del perímetro (si true devuelve -Infinity).
	 *
	 * Comportamiento / variables intermedias clave:
	 *  - FOUR_PI_CONST: constante 10*log10(4π) usada en pérdida geométrica.
	 *  - sampleSpacing: separa la fachada en emisores puntuales; influencia resolución y coste.
	 *  - sigma_perp / sigma_along: controlan la forma elíptica del kernel (ancho lateral y extensión longitudinal).
	 *  - P_per_sample: energía lineal por muestra (normalización 'per_meter' o por muestra asumida fuera).
	 *
	 * Retorna:
	 *  - Lp_total_db: nivel en dB si hay contribución; -Infinity si no hay contribuciones.
	 */
	computeGradientValue(
		px: number,
		pz: number,
		segments: Segment[],
		LwMap: Record<string, number>,
		isInsidePerimeter: boolean,
		perimeter?: number[][],            // <-- nuevo opcional: perímetro (array [x,z])
		cellSize?: number,                 // <-- nuevo opcional: tamaño de celda (m) para pruebas de esquina/buffer
		band?: "red" | "yellow" | "green" | "blue" // <-- opcional: banda actual (permite ajustar anchura)
	): number {
		// Si el usuario ya indicó interior explícitamente, respetarlo.
		// Además, si se suministra `perimeter`, comprobar también si el punto está dentro o muy cercano al perímetro
		const halfCell = (cellSize && cellSize > 0) ? (cellSize * 0.5) : (this.opts.sampleSpacing * 0.5);

		// Punto-en-polígono (ray-casting)
		const pointInPoly = (x: number, z: number, poly?: number[][]) => {
			if (!poly || poly.length < 3) return false;
			let inside = false;
			for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
				const xi = poly[i][0], zi = poly[i][1];
				const xj = poly[j][0], zj = poly[j][1];
				const intersect = ((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / ((zj - zi) || 1e-12) + xi);
				if (intersect) inside = !inside;
			}
			return inside;
		};

		// Distancia mínima punto->segmento
		const pointToSegmentDist = (x: number, z: number, x1: number, z1: number, x2: number, z2: number) => {
			const dx = x2 - x1, dz = z2 - z1;
			if (dx === 0 && dz === 0) return Math.hypot(x - x1, z - z1);
			const t = ((x - x1) * dx + (z - z1) * dz) / (dx * dx + dz * dz);
			const tc = Math.max(0, Math.min(1, t));
			const cx = x1 + tc * dx, cz = z1 + tc * dz;
			return Math.hypot(x - cx, z - cz);
		};

		// Determina si el punto está dentro o muy cercano al perímetro (evita huecos junto a fachadas)
		const isInsideOrNearPerimeter = (x: number, z: number, poly?: number[][], buf = halfCell) => {
			if (!poly || poly.length < 3) return false;
			// 1) Si cualquier esquina de la celda está dentro del polígono -> considerar interior
			const corners = [
				[x - buf, z - buf],
				[x - buf, z + buf],
				[x + buf, z - buf],
				[x + buf, z + buf]
			];
			for (const [cx, cz] of corners) if (pointInPoly(cx, cz, poly)) return true;
			// 2) Si el punto está dentro el polígono directamente
			if (pointInPoly(x, z, poly)) return true;
			// 3) Chequear distancia mínima al borde del polígono; si está a menos de buf => considerarlo dentro (elimina huecos)
			let minD = Infinity;
			for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
				const x1 = poly[j][0], z1 = poly[j][1];
				const x2 = poly[i][0], z2 = poly[i][1];
				const d = pointToSegmentDist(x, z, x1, z1, x2, z2);
				if (d < minD) minD = d;
				if (minD <= buf) return true;
			}
			return false;
		};

		// si el llamador indicó interior explícito lo respetamos; si hay perímetro suministrado también lo evaluamos
		if (isInsidePerimeter) return -Infinity;
		if (perimeter && isInsideOrNearPerimeter(px, pz, perimeter, halfCell)) return -Infinity;

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
				// sigma lateral escalada por lateralSpreadFactor para ampliar el halo amarillo/verde
				// Ajuste de anchuras por banda:
				// - yellow: ampliar mucho el halo lateral y longitudinal
				// - green: estrechar lateral y longitudinal
				// - red/blue: usar factor por defecto
				const bandLateralMultiplier = (() => {
					if (!band) return this.opts.lateralSpreadFactor;
					switch (band) {
						case "yellow": return Math.max(1.0, this.opts.lateralSpreadFactor * 2.0);
						case "green": return Math.max(0.3, this.opts.lateralSpreadFactor * 0.4);
						default: return this.opts.lateralSpreadFactor;
					}
				})();
				const bandAlongMultiplier = (() => {
					if (!band) return 1.0;
					switch (band) {
						case "yellow": return 1.4;
						case "green": return 0.5;
						default: return 1.0;
					}
				})();

				// sigma lateral: escalar por multiplicador de banda (mayor => halo más ancho)
				const sigma_perp = Math.max(0.5, Math.max(maxDist * bandLateralMultiplier, segLen * 0.25));
				const w_perp = Math.exp(- (perp * perp) / (2 * sigma_perp * sigma_perp));
				// sigma longitudinal: escalar según banda para extender/reducir halo a lo largo del segmento
				const sigma_along = Math.max(0.01, sigmaAlongFactor * segLen * bandAlongMultiplier);
				const w_along = Math.exp(- (dist * dist) / (2 * sigma_along * sigma_along));
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