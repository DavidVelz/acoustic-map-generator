export type LwSide = { value: number };

export type BuildingType = "L" | "U" | "S";

export function getBuildingConfig(type: BuildingType = "L") {
	const segmentCounts: Record<BuildingType, number> = { L: 6, U: 8, S: 4 };
	const defaultLw = 30;
	const count = segmentCounts[type] ?? 6;
	return {
		areaSize: 90,   // aumentado: tamaño del "plate" (m)
		resolution: 70, // aumentado para mantener la densidad de la grilla
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
	// spread: control visual global (no es físico) para escalado de efectos
	spread: 50, // magnitud usada en visualización (sin unidad)
	maxRedDist: 2.0, // m, distancia máxima esperada para la banda roja por defecto
	powerFactor: 1.2, // factor multiplicador de potencia (unitless)
	weakSpotSpread: 0.3, // parámetros de ejemplo para "weak spots" (visual tuning)
	weakSpotRadius: 6.0,
	weakSpotBoost: 20,
	weakSpotDirX: 1,
	weakSpotDirZ: 0,

	// Prefiltros / suavizados globales (espacial, en celdas)
	preSmoothSize: 0,      // radio (celdas) de suavizado previo
	preSmoothSigma: 4.0,   // sigma del kernel gaussiano previo
	finalSmoothSize: 0,    // radio (celdas) de suavizado final
	finalSmoothSigma: 3.0, // sigma del kernel gaussiano final

	// Sampling controls
	cellSize: 1.0,        // tamaño de celda (m) si se usa para construir grilla
	sourceSpacing: 1,     // separación por defecto entre emisores sobre la fachada (m)

	// colorOverlay: parámetros que controlan mapeo y suavizado del overlay de colores
	colorOverlay: {
		// Umbrales (dB) operativos para posicionar colores en la escala
		redThreshold: 65,   // dB por encima de este valor aparece rojo
		yellowThreshold: 50, // dB donde aparece banda amarilla
		// yellowSpread: anchura (dB) alrededor de yellowThreshold que define transición amarillo->rojo/verde
		yellowSpread: 10.0,

		// overlaySmoothSize / overlaySmoothSigma: ajuste del suavizado espacial del overlay (celdas / sigma)
		overlaySmoothSize: 0,
		overlaySmoothSigma: 3.2,

		// Umbrales adicionales
		greenThreshold: 40, // dB, umbral aproximado para verde
		blueThreshold: 30,  // dB, umbral para cyan/azul claro

		// redRadius/redDecay: parámetros tácticos para la banda roja (visual/físico)
		redRadius: 7.0,  // m, referencia para visualización roja
		redDecay: 6.0,   // factor de caída (adimensional)

		// lateralSpreadFactor: escala contra segLen para sigma lateral (fracción del largo de segmento)
		lateralSpreadFactor: 100.15,

		// colorSpread: factores multiplicadores que amplían sigma lateral/longitudinal por banda
		//  keys: red|yellow|green|blue — multiplicadores unitless aplicados a sigmas base
		colorSpread: { red: 1.0, yellow: 20.8, green: 4.0, blue: 6.0 },

		// propagation: parámetros orientados a la forma y alcance por banda
		propagation: {
			// bandDecay: multiplicador aplicado a la pendiente de caída por banda (mayor => más rápido)
			bandDecay: { red: 1.0, yellow: 36, green: 0.35 },
			// bandMaxDist: alcance máximo (m) por banda
			bandMaxDist: { red: 2.0, yellow: 30, green: 12.0 },
			// lateralMultiplier: escala lateral adicional por banda
			lateralMultiplier: { red: 1.0, yellow: 33.25, green: 1.6, blue: 2.2 }
		},

		// Normalización de potencia: 'per_meter' reparte Lw por metro (útil para fachadas largas)
		normalize: "per_meter" as "per_meter" | "per_sample" | "none",

		// redSampleSpacing: spacing fino (m) para muestreo de la banda roja (reduce huecos visuales)
		redSampleSpacing: 0.12,

		// dotThreshold: tolerancia para test frontal (dot>threshold considera receptor frente a la fachada)
		dotThreshold: -0.18,

		// redFalloffScale: control de caída métrica adicional para limitar rojo fuera de zona cercana
		redFalloffScale: 1.2,

		// UI caps: valores por defecto utilizados por sliders de la UI
		redMaxDist: 2.0,
		yellowMaxDist: 156.0
	},

	// attenuation: parámetros de atenuación física y estabilidad numérica
	attenuation: {
		exponent: 2,    // exponente de caída (2 => inversa cuadrada / campo libre)
		minDist: 0.1,   // m, distancia mínima para evitar singularidades log10(0)
		epsilon: 1e-6,  // número pequeño para evitar divisiones por cero
		dirPower: 0.0,  // factor de directividad (0 => omnidireccional)
		applyDirectional: true // si se aplica término direccional (usa dirPower)
	}
} as const;
