export type LwSide = { value: number };

export type BuildingType = "L" | "U" | "S";

export function getBuildingConfig(type: BuildingType = "L") {
	const segmentCounts: Record<BuildingType, number> = { L: 6, U: 8, S: 4 };
	const defaultLw = 30;
	const count = segmentCounts[type] ?? 6;
	return {
		areaSize: 120,
		resolution: 60,
		measureH: 2.0,
		footprint: 16.0,
		buildingHeight: 13.0,
		id: 1,
		pos: { x: 0, z: 0 },
		size: 4,
		LwBySegment: Array.from({ length: count }, (_, i) => ({ value: defaultLw })) as LwSide[],
	};
}

export const buildingConfig = getBuildingConfig("L");

export const defaultParams = {
	spread: 100, // Reducido para un gradiente más controlado
	maxRedDist: 12.0,
	powerFactor: 1.2,
	weakSpotSpread: 0.3,
	weakSpotRadius: 6.0,
	weakSpotBoost: 20,
	weakSpotDirX: 1,
	weakSpotDirZ: 0,
	// --- new control variables ---
	// Suavizado intenso para un efecto de halo difuso
	preSmoothSize: 15,
	preSmoothSigma: 4.0,
	finalSmoothSize: 11,
	finalSmoothSigma: 3.0,
	// --- sampling controls (new) ---
	// grid cell size in meters (1.0 m para un grid más grueso)
	cellSize: 1.0,
	// spacing along facades for source sampling (m)
	sourceSpacing: 1,
	// Color/umbral centralizado para overlay (en dB / metros)
	colorOverlay: {
		redThreshold: 90,    // Umbral para rojo (mapear a Lw alto)
		yellowThreshold: 75, // Umbral para amarillo
		yellowSpread: 8.0,   // Spread para la transición a verde
		overlaySmoothSize: 7,    // Suavizado más pronunciado similar al referente
		overlaySmoothSigma: 2.0,
		greenThreshold: 60,  // Umbral para verde
		redRadius: 12.0,
		redDecay: 6.0,
		// cuánto del largo del segmento se usa como sigma lateral (fracción del segLen)
		lateralSpreadFactor: 1.0
	},
	// Atenuación: omnidireccional para crear el halo
	attenuation: {
		exponent: 2,
		minDist: 0.1,
		epsilon: 1e-6,
		dirPower: 0.0, // Omnidireccional para un efecto de halo
		applyDirectional: true // Se mantiene true, pero dirPower=0 lo anula
	}
} as const;
