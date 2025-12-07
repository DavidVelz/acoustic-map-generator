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
 * default export: agrupación de utilidades (comodín)
 */
export default {
	computeFacadeRePrime,
	aGeo,
	aAtmospheric,
	computeLwRoomFromLpIn,
	computeLpOutAtPoint
};
