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
import * as THREE from "three";
import PerimeterExtractor from "../Perimeter";
import { generateRedHeatmapFromFacade } from "../acoustics/ColorMap";
import { Segment } from "../acoustics/ColorGradientManager";
import { Config, Building, Params, HeatmapResult, Segment as TypesSegment } from "../types";

export default function useHeatmap(
	config: Config,
	building: Building,
	params: Params,
	finalLoop: number[][],
	lShapeMesh: unknown,
	refreshKey: unknown
): HeatmapResult {
	return useMemo(() => {
		// 1) validación rápida: si no hay perímetro suficiente, devolver estructura vacía
		if (!finalLoop || finalLoop.length < 3) return { x: [], y: [], z: [[]], min: NaN, max: NaN, hover: [[]] };

		// 2) extraer segmentos de fachada (cada segmento = { p1, p2, name? })
		const segments = PerimeterExtractor.extractFacadesSegments(lShapeMesh as THREE.ExtrudeGeometry) as Segment[];

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
		const overlayCfg = params?.colorOverlay ?? {};
		const opts = {
			sampleSpacing: params.sourceSpacing ?? params?.cellSize ?? 1,
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

		// --- NUEVO: construir matriz de hover (tooltip) ---
		// helper: distancia punto->segmento
		const pointToSegmentDist = (x: number, z: number, x1: number, z1: number, x2: number, z2: number) => {
			const dxs = x2 - x1, dzs = z2 - z1;
			if (dxs === 0 && dzs === 0) return Math.hypot(x - x1, z - z1);
			const t = ((x - x1) * dxs + (z - z1) * dzs) / (dxs * dxs + dzs * dzs);
			const tc = Math.max(0, Math.min(1, t));
			const cx = x1 + tc * dxs, cz = z1 + tc * dzs;
			return Math.hypot(x - cx, z - cz);
		};

		const hover: string[][] = Array.from({ length: zmat.length }, () => new Array(zmat[0]?.length ?? 0).fill(""));

		for (let j = 0; j < zmat.length; j++) {
			for (let i = 0; i < zmat[j].length; i++) {
				const Lp = zmat[j][i];
				const px = gridX[i], pz = gridY[j];

				// calcular distancia mínima a cualquier segmento (perpendicular mínima)
				let minD = Infinity;
				for (const seg of segments) {
					const d = pointToSegmentDist(px, pz, seg.p1[0], seg.p1[1], seg.p2[0], seg.p2[1]);
					if (d < minD) minD = d;
				}

				if (!Number.isFinite(Lp) || !Number.isFinite(minD)) {
					hover[j][i] = "Sin datos";
					continue;
				}

				// potencia/energía estimada en unidades relativas: E ~ 10^(Lp/10)
				const potenciaRel = Math.pow(10, Lp / 10);

				// Tooltip en español (HTML): distancia a fachada (m), nivel Lp (dB) y potencia estimada (relativa)
				// Usar <br> para saltos de línea — Plotly muestra HTML en hovertext.
				hover[j][i] =
					`Distancia a fachada: ${minD.toFixed(2)} m<br>` +
					`Nivel (Lp): ${Lp.toFixed(1)} dB<br>` +
					`Potencia estimada (rel): ${potenciaRel.toExponential(3)}`;
			}
		}

		// 8) devolver estructura lista para render (Plotly / textura) incluyendo hover
		return { x: gridX, y: gridY, z: zmat, min: zmin, max: zmax, hover };
	}, [config, building, params, finalLoop, lShapeMesh, refreshKey]);
}
