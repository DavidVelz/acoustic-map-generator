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
		// Umbrales solicitados:
		// rojo > 70, amarillo > 50, verde > 40, azul claro 20..40, azul oscuro <20
		redThreshold: 70,
		yellowThreshold: 50,
		// ancho (dB) de la banda amarilla (se usa para posicionar stops de color)
		yellowSpread: 10.0,
		// Suavizado del overlay (aumentado para halos más suaves)
		overlaySmoothSize: 11,
		overlaySmoothSigma: 3.2,
		greenThreshold: 40,
		// azul claro / oscuro split
		blueThreshold: 20,
		redRadius: 12.0,
		redDecay: 6.0,
		// cuánto del largo del segmento se usa como sigma lateral (fracción del segLen)
		lateralSpreadFactor: 1.15,
		// factores que amplían la sigma lateral/longitudinal por banda de color (más anchos para verdes/azules)
		colorSpread: { red: 1.0, yellow: 2.8, green: 4.0, blue: 6.0 },
		// parámetros de propagación por banda: factor multiplicador del decay y distancia máxima
		propagation: {
			bandDecay: { red: 1.0, yellow: 0.6, green: 0.35 },
			bandMaxDist: { red: 2.0, yellow: 6.0, green: 12.0 },
			// multiplicador lateral adicional por banda (fine tune)
			lateralMultiplier: { red: 1.0, yellow: 1.25, green: 1.6, blue: 2.2 }
		},
		// normalización: 'per_meter' asegura igualdad entre fachadas de distinta longitud
		normalize: "per_meter" as "per_meter" | "per_sample" | "none",
		// spacing (m) usado por la banda roja para muestreo fino (reduce huecos)
		redSampleSpacing: 0.12,
		// tolerancia para front-side check (permite dot ligeramente negativo)
		dotThreshold: -0.18,
		// control de caída (métrica) para limitar/atenuar rojo fuera de la zona cercana
		redFalloffScale: 1.2,
		// UI-linked caps (used by the menu sliders "Red max dist" / "Yellow max dist")
		redMaxDist: 2.0,
		yellowMaxDist: 6.0
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
