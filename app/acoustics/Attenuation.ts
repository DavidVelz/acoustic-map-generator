export type AttenuationOptions = {
	exponent?: number;
	minDist?: number;
	epsilon?: number;
	dirPower?: number;
	applyDirectional?: boolean;
	spread?: number;
};

/**
 * Calcula la contribución energética de una fuente acústica.
 * @param Lw Potencia acústica de la fuente (dB).
 * @param dist Distancia desde la fuente (m).
 * @param dot Producto escalar direccional (coseno).
 * @param opts Opciones de atenuación.
 * @returns Energía recibida en el punto.
 */
const Attenuation = {
	contribution(Lw: number, dist: number, dot: number, opts: AttenuationOptions = {}) {
		const exp = opts.exponent ?? 2;
		const minDist = opts.minDist ?? 0.001;
		const epsilon = opts.epsilon ?? 1e-6;
		const dirPower = opts.dirPower ?? 1.0;
		const applyDirectional = opts.applyDirectional ?? true;
		const spread = opts.spread ?? 1.0;

		// Atenuación por distancia (inverse-power law)
		const d = Math.max(dist, minDist);
		let energy = Math.pow(10, Lw / 10) / (4 * Math.PI * Math.pow(d / spread, exp) + epsilon);

		// Atenuación direccional (coseno elevado a dirPower)
		if (applyDirectional && dirPower > 0) {
			const cosTheta = Math.max(0, dot);
			energy *= Math.pow(cosTheta, dirPower);
		}

		return energy;
	}
};

export default Attenuation;
