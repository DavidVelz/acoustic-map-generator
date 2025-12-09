/**
 * usePlotlyTexture
 *
 * Propósito:
 *  - Generar una THREE.Texture a partir de un mapa de calor (heatmap) renderizado con Plotly.
 *  - El hook crea un contenedor DOM oculto, dibuja el heatmap con Plotly, solicita un PNG (transparent)
 *    y carga el PNG como textura Three.js.
 *
 * Entradas:
 *  - heatmap: { x: number[], y: number[], z: number[][], min: number, max: number }
 *      Matriz y ejes generados por useHeatmap (o pipeline equivalente).
 *  - params: objeto de parámetros (especialmente params.colorOverlay) usado para construir la escala de color.
 *  - building: objeto que contiene LwBySegment (usado como fallback para zmin/zmax si el heatmap es degenerado).
 *
 * Salida:
 *  - THREE.Texture | null
 *      Una textura lista para asignarse a un material. Null si aún no está disponible o si hay error.
 *
 * Notas:
 *  - El hook sincroniza y limpia recursos: elimina el contenedor oculto y libera la textura al desmontar.
 *  - El tamaño del contenedor oculto es cuadrado y coincide con las dimensiones solicitadas a Plotly (1600x1600)
 *    para evitar deformaciones en la textura.
 *  - buildThresholdColorscale se usa para calcular colorscale basado en umbrales provistos en params.
 *
 * Limitaciones / recomendaciones:
 *  - Plotly es cargado dinámicamente (bundle grande). Evitar llamadas frecuentes a este hook sin memoización.
 *  - Si necesitas texturas de diferente tamaño, sincroniza PLOT_IMG_SIZE con los parámetros de toImage().
 */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { buildThresholdColorscale } from "../acoustics/ColorMap";

export default function usePlotlyTexture(heatmap: any, params: any, building: any) {
	const hiddenDivRef = useRef<HTMLDivElement | null>(null);
	const [texture, setTexture] = useState<THREE.Texture | null>(null);

	useEffect(() => {
		let mounted = true;
		let plotly: any = null;
		let container = hiddenDivRef.current;

		// Ensure we have a hidden, square DOM container for Plotly render.
		// Using a square container that matches the output PNG avoids stretching.
		if (!container) {
			container = document.createElement("div");
			document.body.appendChild(container);
			hiddenDivRef.current = container;
			container.style.position = "absolute";
			container.style.left = "-20000px";
			container.style.top = "-20000px";
			const PLOT_IMG_SIZE = 1600;
			container.style.width = `${PLOT_IMG_SIZE}px`;
			container.style.height = `${PLOT_IMG_SIZE}px`;
		}

		// Async block: import Plotly, render the heatmap and convert to PNG -> THREE.Texture
		(async () => {
			try {
				// Dynamic import of Plotly bundle (heavy)
				const mod = await import("plotly.js-dist-min");
				plotly = (mod && (mod as any).default) ? (mod as any).default : mod;

				// Build colorscale from params thresholds
				const overlayCfg = (params && (params as any).colorOverlay) || undefined;
				const colorscale = buildThresholdColorscale(heatmap.min, heatmap.max, overlayCfg);

				// Robust z-range: prefer heatmap.min/max, fallback to Lw sliders with padding
				let Z_MIN = Number.isFinite(heatmap.min) ? Math.floor(heatmap.min) : NaN;
				let Z_MAX = Number.isFinite(heatmap.max) ? Math.ceil(heatmap.max) : NaN;
				if (!Number.isFinite(Z_MIN) || !Number.isFinite(Z_MAX) || Z_MIN >= Z_MAX) {
					const segs = (building as any).LwBySegment || [];
					const lwVals = Array.isArray(segs) ? segs.map((s: any) => Number(s?.value ?? NaN)).filter(Number.isFinite) : [];
					const lwMin = lwVals.length ? Math.min(...lwVals) : 0;
					const lwMax = lwVals.length ? Math.max(...lwVals) : 80;
					const pad = Math.max(4, Math.ceil((lwMax - lwMin) * 0.25));
					Z_MIN = Math.floor(Math.min(lwMin, (heatmap.min || lwMin)) - pad);
					Z_MAX = Math.ceil(Math.max(lwMax, (heatmap.max || lwMax)) + pad);
				}
				if (Z_MIN >= Z_MAX) { Z_MIN = (heatmap.min || 0) - 10; Z_MAX = (heatmap.max || 0) + 10; }

				// Plotly trace and layout (transparent background)
				const trace = {
					x: heatmap.x,
					y: heatmap.y,
					z: heatmap.z,
					type: "heatmap" as const,
					colorscale,
					zmin: Z_MIN,
					zmax: Z_MAX,
					zsmooth: "best",
					showscale: false,
					hoverinfo: "skip"
				};

				const layout = {
					margin: { l: 20, r: 20, t: 20, b: 20 },
					xaxis: { visible: false },
					yaxis: { visible: false },
					paper_bgcolor: "rgba(0,0,0,0)",
					plot_bgcolor: "rgba(0,0,0,0)"
				};

				// Render Plotly into the hidden container
				await plotly.newPlot(container, [trace], layout, { staticPlot: false, displayModeBar: false });

				// Request PNG image (transparent) at desired size
				const dataUrl = await plotly.toImage(container, { format: "png", width: 1600, height: 1600, scale: 1 });

				if (!mounted) return;

				// Load PNG into THREE.Texture asynchronously
				const loader = new THREE.TextureLoader();
				loader.load(dataUrl, (tex) => {
					tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
					tex.minFilter = THREE.LinearFilter;
					tex.magFilter = THREE.LinearFilter;
					tex.flipY = false;
					tex.needsUpdate = true;
					setTexture(tex);
					// attempt to purge Plotly internals for the container
					try { if (plotly && plotly.purge) plotly.purge(container); } catch (e) {}
				});
			} catch (e) {
				// Log Plotly errors; caller may decide how to react
				console.error("Plotly error", e);
			}
		})();

		// Cleanup: remove hidden container and dispose texture on unmount
		return () => {
			mounted = false;
			if (hiddenDivRef.current) {
				try { hiddenDivRef.current.remove(); } catch(e){ }
				hiddenDivRef.current = null;
			}
			if (texture) {
				try { texture.dispose(); } catch(e) {}
			}
		};
	}, [heatmap, params, building]);

	// Return the generated THREE.Texture (or null while generating)
	return texture;
}
