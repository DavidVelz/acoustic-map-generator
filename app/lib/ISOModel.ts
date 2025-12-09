import WaveEmitter from "../acoustics/WaveEmitter";

export type FacadeElement = { area: number; R: number }; // area (m2), R (dB)

/**
 * computeFacadeRePrime
 * Re' = -10 * log10( (1/Sf) * sum_j Sj * 10^{-Rj/10} )
 * elements: lista de {area, R}
 */
export function computeFacadeRePrime(elements: FacadeElement[]) {
	const Sf = Math.max(1e-6, elements.reduce((s, e) => s + Math.max(0, e.area), 0));
	let sum = 0;
	for (const e of elements) {
		const Sj = Math.max(0, e.area);
		const Rj = Number.isFinite(e.R) ? e.R : 30;
		sum += Sj * Math.pow(10, -Rj / 10);
	}
	return -10 * Math.log10(Math.max(1e-12, sum / Sf));
}

/**
 * aGeo
 * Atenuación geométrica (campo semi-libre sobre suelo reflectante)
 * A_geo ≈ 8 + 20·log10(r)
 */
export function aGeo(distanceM: number) {
	const r = Math.max(0.01, distanceM);
	return 8 + 20 * Math.log10(r);
}

/**
 * aAtmospheric
 * Placeholder para absorción atmosférica (frecuencias cortas ≈ 0)
 */
export function aAtmospheric(distanceM: number, _freqHz?: number) {
	return 0;
}

/**
 * computeLwRoomFromLpIn
 * Estimación simple de Lw_room a partir de Lp_in y área equivalente Aeq
 * Lw_room ≈ Lp_in + 10·log10(Aeq)
 */
export function computeLwRoomFromLpIn(Lp_in: number, Aeq: number) {
	const A = Math.max(1e-6, Aeq);
	return Lp_in + 10 * Math.log10(A);
}

/**
 * computeLpOutAtPoint
 * Lp_out = Lw_room - Re' - Df_room - Df_out - A_geo - A_atm
 */
export function computeLpOutAtPoint(opts: {
	Lw_room: number;
	RePrime: number;
	Df_room?: number;
	Df_out?: number;
	distanceM: number;
	atmospheric?: number;
}) {
	const Df_room = opts.Df_room ?? 6;
	const Df_out = opts.Df_out ?? 0;
	const A_geo = aGeo(opts.distanceM);
	const A_atm = Number.isFinite(opts.atmospheric ?? 0) ? (opts.atmospheric ?? 0) : aAtmospheric(opts.distanceM);
	return opts.Lw_room - opts.RePrime - Df_room - Df_out - A_geo - A_atm;
}

/**
 * SourceSimple: tipo ligero usado por las utilidades de grid
 * - x,z: posición
 * - Lw: nivel de potencia sonora de la fuente (dB) — puede ser Lw_room o Lw_out según uso
 * - nx,nz: normal unitaria apuntando hacia fuera (opcional, se usa para directividad simple)
 */
export type SourceSimple = { x: number; z: number; Lw: number; nx?: number; nz?: number };

/**
 * computeLpFromSource
 * - Calcula Lp (dB) en un punto receptor desde una fuente puntual simple.
 * - Se usa computeLpOutAtPoint internamente para modelar propagación básica.
 * - Opciones:
 *    RePrime: pérdida de fachada (dB) aplicada a Lw_room si Lw_isRoom === true
 *    Lw_isRoom: si true trata Lw como Lw_room y aplica RePrime; si false Lw ya es Lw_out
 *    dbPerMeter: atenuación adicional por metro (dB/m)
 *    directivityCosineCut: si se suministra, multiplica energía por max(0, dot)^cut (cut >=1)
 */
export function computeLpFromSource(
	source: SourceSimple,
	receptorX: number,
	receptorZ: number,
	opts?: {
		RePrime?: number;
		Lw_isRoom?: boolean;
		dbPerMeter?: number;
		directivityCut?: number; // exponente aplicado a dot (>=1)
		Df_room?: number;
		Df_out?: number;
		atmospheric?: number;
	}
) {
	const RePrime = opts?.RePrime ?? 0;
	const Lw_isRoom = opts?.Lw_isRoom ?? true;
	const dbPerMeter = Number.isFinite(opts?.dbPerMeter) ? (opts!.dbPerMeter as number) : 0.5;
	const directivityCut = Number.isFinite(opts?.directivityCut) ? (opts!.directivityCut as number) : 1.0;

	const vx = receptorX - source.x;
	const vz = receptorZ - source.z;
	const dist = Math.hypot(vx, vz);
	if (dist < 1e-6) {
		// receptor prácticamente en la fuente: usar distancia mínima 0.01 m
		// y considerar máxima contribución
	}

	// Lw_room -> Lw_out si corresponde
	const Lw_out_db = Lw_isRoom ? (source.Lw - RePrime) : source.Lw;

	// usar computeLpOutAtPoint para estimar Lp sin directividad
	const lp_base = computeLpOutAtPoint({
		Lw_room: Lw_out_db,
		RePrime: 0, // ya restado si Lw_isRoom
		Df_room: opts?.Df_room,
		Df_out: opts?.Df_out,
		distanceM: Math.max(0.01, dist),
		atmospheric: opts?.atmospheric
	});

	// aplicar atenuación adicional proporcional a la distancia (dB/m)
	const atmosExtra = dbPerMeter * Math.max(0, dist);
	const lp_after_atm = lp_base - atmosExtra;

	// directividad simple: si fuente define normal, penalizar según ángulo receptor-normal
	let directivityWeight = 1.0;
	if (typeof source.nx === "number" && typeof source.nz === "number") {
		const nlen = Math.hypot(source.nx, source.nz) || 1;
		const nx = source.nx / nlen, nz = source.nz / nlen;
		const rlen = Math.hypot(vx, vz) || 1;
		const rx = vx / rlen, rz = vz / rlen;
		let dot = nx * rx + nz * rz; // cos(theta) between normal and direction to receptor
		// mantener en [0,1]
		dot = Math.max(0, Math.min(1, dot));
		// elevar a exponente para hacer directividad más marcada
		directivityWeight = Math.pow(dot, Math.max(1, directivityCut));
		// evitar cero absoluto (muy direccional) — mínimo pequeño
		directivityWeight = Math.max(1e-4, directivityWeight);
	}

	// convertir lp_after_atm a energía lineal y multiplicar por directivityWeight
	const E = Math.pow(10, lp_after_atm / 10) * directivityWeight;
	// devolver como objeto para quien quiera combinar energías
	return { Lp_db: 10 * Math.log10(E), energyLinear: E, distanceM: dist };
}

/**
 * computeGridLpFromSources
 * - sources: array de SourceSimple (x,z,Lw[,nx,nz])
 * - xs, ys: arrays de coordenadas (xs length = w, ys length = h)
 * - options:
 *    Lw_isRoom: si true trata Lw como Lw_room y aplica ReMap[segment] cuando se suministre (no implementa matching por nombre aquí)
 *    ReMap: opcional map de pérdidas por fuente (si no, se usa 0)
 *    maxDist: distancia máxima en metros para considerar contribución (default 20)
 *    dbPerMeter: atenuación adicional por metro
 *    directivityCut: exponente de directividad
 *    perSourceMask?: optional same-size boolean mask to allow sources only in some cells (not implemented here)
 *
 * Returns: matrix [h][w] de Lp (dB). Celdas sin contribución -> -Infinity.
 */
export function computeGridLpFromSources(
	sources: SourceSimple[],
	xs: number[],
	ys: number[],
	options?: {
		ReMap?: Record<string, number>; // no usado por defecto, incluye si haces mapping fuera
		maxDist?: number;
		dbPerMeter?: number;
		directivityCut?: number;
		Lw_isRoom?: boolean;
	}
) {
	const h = ys.length;
	const w = xs.length;
	const out: number[][] = Array.from({ length: h }, () => new Array(w).fill(-Infinity));
	const maxDist = options?.maxDist ?? 50;
	const dbPerMeter = Number.isFinite(options?.dbPerMeter ?? 0.5) ? (options!.dbPerMeter as number) : 0.5;
	const directivityCut = options?.directivityCut ?? 1.0;
	const Lw_isRoom = options?.Lw_isRoom ?? true;

	// accumulate linear energy per cell
	const energyGrid: number[][] = Array.from({ length: h }, () => new Array(w).fill(0));

	for (let j = 0; j < h; j++) {
		for (let i = 0; i < w; i++) {
			const rx = xs[i], rz = ys[j];
			let totalE = 0;
			for (const s of sources) {
				const vx = rx - s.x, vz = rz - s.z;
				const dist = Math.hypot(vx, vz);
				if (dist > maxDist) continue;

				const res = computeLpFromSource(s, rx, rz, {
					RePrime: 0,
					Lw_isRoom: Lw_isRoom,
					dbPerMeter,
					directivityCut
				});
				if (!Number.isFinite(res.energyLinear) || res.energyLinear <= 0) continue;
				totalE += res.energyLinear;
			}
			if (totalE > 0) {
				out[j][i] = 10 * Math.log10(totalE);
			}
		}
	}
	return out;
}

// Agrupar como export por defecto para preservar la interfaz previa
export default {
	computeFacadeRePrime,
	aGeo,
	aAtmospheric,
	computeLwRoomFromLpIn,
	computeLpOutAtPoint,
	computeLpFromSource,
	computeGridLpFromSources
};
