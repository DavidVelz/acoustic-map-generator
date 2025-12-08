import WaveEmitter from "../acoustics/WaveEmitter";
import AcousticCalculator from "../acoustics/AcousticCalculator";
import { getBuildingConfig } from "../config";

/**
 * buildHeatmap
 * Parámetros:
 *  - finalLoop: array de puntos del perímetro ([[x,z],...])
 *  - config: building config (areaSize, resolution, footprint, ...)
 *  - building: objeto con LwBySegment (valores por segmento)
 *  - params: parámetros visuales / cálculos
 *  - refreshKey: cualquier token para forzar recálculo (no usado internamente, pero pasado por compatibilidad)
 *
 * Devuelve: resultado de AcousticCalculator.compute ({ x,y,z,min,max,poly })
 */
export function buildHeatmap(finalLoop: number[][], config: any, building: any, params: any, refreshKey?: any) {
	const main = (finalLoop || []).map((point: number[], i: number) => ({
		name: `segment-${i}`,
		p1: point,
		p2: finalLoop[(i + 1) % finalLoop.length]
	}));

	// construir objeto Lw por segmento
	const LwObj: Record<string, number> = {};
	const segments = (building as any).LwBySegment || [];
	segments.forEach((lw: any, idx: number) => {
		LwObj[`segment-${idx}`] = lw?.value ?? 50;
	});

	// Si exactamente una fachada tiene Lw>0, aplicar presets visuales (como antes)
	const nonZeroIndices = segments
		.map((s: any, i: number) => ({ idx: i, v: Number(s?.value || 0) }))
		.filter((p: { v: number; idx: number }) => Number.isFinite(p.v) && p.v > 0)
		.map((p: { idx: number; v: number }) => p.idx);
	let paramsForCalc = params;
	if (nonZeroIndices.length === 1) {
		paramsForCalc = {
			...(params || {}),
			colorOverlay: {
				...(params && (params as any).colorOverlay),
				overlaySmoothSize: 13,
				overlaySmoothSigma: 3.6,
				lateralSpreadFactor: 1.5,
				colorSpread: { ...(params && (params as any).colorOverlay?.colorSpread), yellow: 3.4, green: 5.0, blue: 8.0 },
				redMaxDist: 2.0,
				yellowMaxDist: 6.0
			}
		};
	}

	const sampleSpacing = paramsForCalc?.sourceSpacing ?? Math.max(0.25, Math.min(1.0, (config?.footprint ?? 16) / 12));
	const perimeterSources = WaveEmitter.generateSources(finalLoop, main, sampleSpacing, 0.05, LwObj);

	return AcousticCalculator.compute({
		areaSize: config.areaSize,
		resolution: config.resolution,
		footprint: config.footprint,
		poly: finalLoop,
		main,
		sources: perimeterSources,
		Lw: LwObj as any,
		params: paramsForCalc
	});
}

export default { buildHeatmap };
