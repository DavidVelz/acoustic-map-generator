/**
 * useHeatmap
 *
 * Hook que encapsula la generación del mapa de calor (matriz Z) a partir de:
 *  - config: configuración general (areaSize, resolution, etc.)
 *  - building: objeto con LwBySegment (niveles por segmento)
 *  - params: parámetros visuales y de muestreo (colorOverlay, sampleSpacing, etc.)
 *  - finalLoop: perímetro final extraído de la geometría (array de [x,z])
 *  - lShapeMesh: geometría THREE.ExtrudeGeometry usada para extraer segmentos
 *  - refreshKey: token para forzar recalculo desde la UI
 *
 * Resultado devuelto (forma):
 *  { x: number[], y: number[], z: number[][], min: number, max: number }
 *  - x,y: coordenadas de la grilla (centros de celda)
 *  - z: matriz [rows=y.length][cols=x.length] con niveles en dB o NaN para celdas vacías
 *  - min/max: valores numéricos (NaN si no hay datos)
 *
 * Notas de comportamiento:
 *  - Internamente extrae segmentos de fachada con PerimeterExtractor.extractFacadesSegments(lShapeMesh).
 *  - Construye gridX/gridY centrados en el área (areaSize/resolution).
 *  - Llama a generateRedHeatmapFromFacade(...) que aplica el modelo físico (rojo estrecho + halo amarillo).
 *  - Calcula min/max ignorando valores no finitos.
 *
 * Recomendaciones:
 *  - Mantener `resolution` y `sourceSpacing` balanceados: mayor resolución y menor spacing aumentan coste.
 *  - Pasar params.colorOverlay.overlaySmoothSize para controlar blur del halo amarillo.
 *  - Usar refreshKey para invalidar la memoización cuando la UI cambia sliders.
 */
import { useMemo } from "react";
import PerimeterExtractor from "../Perimeter";
import { generateRedHeatmapFromFacade } from "../acoustics/ColorMap";

export default function useHeatmap(config: any, building: any, params: any, finalLoop: number[][], lShapeMesh: any, refreshKey: any) {
	return useMemo(() => {
		// 1) validación rápida: si no hay perímetro suficiente, devolver estructura vacía
		if (!finalLoop || finalLoop.length < 3) return { x: [], y: [], z: [[]], min: NaN, max: NaN };

		// 2) extraer segmentos de fachada (cada segmento = { p1, p2, name? })
		const segments = PerimeterExtractor.extractFacadesSegments(lShapeMesh);

		// 3) construir mapa Lw por segmento a partir de building.LwBySegment
		const lwMap: Record<string, number> = {};
		if (Array.isArray((building as any).LwBySegment)) {
			const arr = (building as any).LwBySegment;
			for (let i = 0; i < arr.length; i++) lwMap[`segment-${i}`] = Number(arr[i]?.value ?? 0);
		}

		// 4) construir la grilla (gridX, gridY) centrada en 0 con tamaño areaSize
		const res = Number(config.resolution ?? 60);
		const area = Number(config.areaSize ?? 120);
		const dx = area / Math.max(1, res);
		const half = area / 2;
		const gridX = Array.from({ length: res }, (_, idx) => -half + dx * (idx + 0.5));
		const gridY = Array.from({ length: res }, (_, idx) => -half + dx * (idx + 0.5));

		// 5) opciones para generateRedHeatmapFromFacade tomadas desde params (con fallback)
		const overlayCfg = (params as any)?.colorOverlay ?? {};
		const opts = {
			sampleSpacing: params.sourceSpacing ?? (params as any)?.cellSize ?? 1,
			outwardOffset: 0.02,
			redMaxDist: overlayCfg?.redMaxDist ?? 2.0,
			yellowMaxDist: overlayCfg?.yellowMaxDist ?? (overlayCfg?.redMaxDist ?? 2.0) * 3,
			dbPerMeter:  0.5,
			redWeight: params.redWeight ?? 1.0,
			yellowWeight: params.yellowWeight ?? 0.6,
			applyYellowBlur: overlayCfg?.overlaySmoothSize ?? 2
		};

		// 6) llamar a la función principal que retorna la matriz Z en dB (o NaN)
		const zmat = generateRedHeatmapFromFacade(gridX, gridY, segments, finalLoop, lwMap, opts);

		// 7) calcular min/max de la matriz ignorando entradas no finitas (NaN/-Infinity)
		let zmin = Infinity, zmax = -Infinity;
		for (let j = 0; j < zmat.length; j++) {
			for (let i = 0; i < zmat[j].length; i++) {
				const v = zmat[j][i];
				if (!Number.isFinite(v)) continue;
				if (v < zmin) zmin = v;
				if (v > zmax) zmax = v;
			}
		}
		if (zmin === Infinity) { zmin = NaN; zmax = NaN; }

		// 8) devolver estructura lista para render (Plotly / textura)
		return { x: gridX, y: gridY, z: zmat, min: zmin, max: zmax };
	}, [config, building, params, finalLoop, lShapeMesh, refreshKey]);
}
