"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { buildThresholdColorscale } from "./acoustics/ColorMap";
import { createLShapeExtrudeGeometry } from "./geometry/building";
import ControlsPanel from "./ControlsPanel";
import { generateRedHeatmapFromFacade } from "./acoustics/ColorMap";
import PerimeterExtractor from "./Perimeter";
import { defaultParams, getBuildingConfig } from "./config";

export default function Home() {
	const [config, setConfig] = useState(getBuildingConfig("L"));
	const [building, setBuilding] = useState(getBuildingConfig("L"));
	const [params, setParams] = useState(defaultParams);
	const [refreshKey, setRefreshKey] = useState(0);
	const [texture, setTexture] = useState<THREE.Texture | null>(null);
	// const [showEmit, setShowEmit] = useState(false);
	// const [emitPoints, setEmitPoints] = useState<any[]>([]);
	const hiddenDivRef = useRef<HTMLDivElement | null>(null);

	const lShapeMesh = useMemo(() => createLShapeExtrudeGeometry(config.footprint, config.buildingHeight), [config.footprint, config.buildingHeight]);

	const baseLoop = useMemo(() => PerimeterExtractor.extractBasePerimeter(lShapeMesh), [lShapeMesh]);

	const finalLoop = useMemo(() => {
		if (baseLoop && baseLoop.length >= 3) return baseLoop;
		const loops = PerimeterExtractor.buildEdgeLoops(lShapeMesh);
		if (!loops || loops.length === 0) return [];
		let best = loops[0];
		for (let i = 1; i < loops.length; i++) if (loops[i].length > best.length) best = loops[i];
		return best;
	}, [lShapeMesh, baseLoop]);

	// Ensure building.LwBySegment matches the current number of perimeter segments (finalLoop)
	useEffect(() => {
		const n = finalLoop ? finalLoop.length : 0;
		if (!n) return;
		setBuilding(prev => {
			const cur = (prev as any).LwBySegment || [];
			if (Array.isArray(cur) && cur.length === n) return prev;
			const defaultVal = 30;
			const newArr = new Array(n).fill(0).map((_, i) => {
				const existing = Array.isArray(cur) && cur[i] && typeof cur[i].value === "number" ? cur[i].value : defaultVal;
				return { value: existing };
			});
			return { ...prev, LwBySegment: newArr };
		});
	}, [finalLoop]);

	const outerGeom = useMemo(() => 
		finalLoop && finalLoop.length ? PerimeterExtractor.createLineGeometry(finalLoop) : new THREE.BufferGeometry(), 
		[finalLoop]
	);

	const heatmap = useMemo(() => {
		// Antes: return buildHeatmap(finalLoop, config, building, params, refreshKey);
		// Ahora: generar grilla y llamar a generateRedHeatmapFromFacade directamente
		if (!finalLoop || finalLoop.length < 3) return { x: [], y: [], z: [[]], min: NaN, max: NaN };

		// construir segments a partir de la geometría (nombres segment-0..)
		const segments = PerimeterExtractor.extractFacadesSegments(lShapeMesh);

		// construir lwMap desde building.LwBySegment si existe
		const lwMap: Record<string, number> = {};
		if (Array.isArray((building as any).LwBySegment)) {
			const arr = (building as any).LwBySegment;
			for (let i = 0; i < arr.length; i++) {
				lwMap[`segment-${i}`] = Number(arr[i]?.value ?? 0);
			}
		}

		// grid según config
		const res = Number(config.resolution ?? 60);
		const area = Number(config.areaSize ?? 120);
		const dx = area / Math.max(1, res);
		const half = area / 2;
		const gridX = Array.from({ length: res }, (_, idx) => -half + dx * (idx + 0.5));
		const gridY = Array.from({ length: res }, (_, idx) => -half + dx * (idx + 0.5));

		// opciones tomadas desde params (fallbacks seguros)
		const overlayCfg = (params as any)?.colorOverlay ?? {};
		const opts = {
			sampleSpacing: params.sourceSpacing ?? (params as any)?.cellSize ?? 1,
			outwardOffset: 0.02,
			redMaxDist: overlayCfg?.redMaxDist ?? 2.0,
			yellowMaxDist: overlayCfg?.yellowMaxDist ?? (overlayCfg?.redMaxDist ?? 2.0) * 3,
			dbPerMeter:  0.5,
			redWeight: 1.0,
			yellowWeight: 0.6,
			applyYellowBlur: overlayCfg?.overlaySmoothSize ?? 2
		};

		const zmat = generateRedHeatmapFromFacade(gridX, gridY, segments, finalLoop, lwMap, opts);

		// compute min/max ignoring -Infinity
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

		return { x: gridX, y: gridY, z: zmat, min: zmin, max: zmax };
	}, [config, finalLoop, building, params, refreshKey, lShapeMesh]);

	useEffect(() => {
		let mounted = true;
		let plotly: any = null;
		let container = hiddenDivRef.current;
		
		if (!container) {
			container = document.createElement("div");
			document.body.appendChild(container);
			hiddenDivRef.current = container;
			container.style.position = "absolute";
			container.style.left = "-20000px";
			container.style.top = "-20000px";
			container.style.width = "1200px";
			container.style.height = "800px";
		}

		(async () => {
			try {
				const mod = await import("plotly.js-dist-min");
				plotly = (mod && (mod as any).default) ? (mod as any).default : mod;

				const overlayCfg = (params && (params as any).colorOverlay) || undefined;
				// Build robust z-range (avoid zmin===zmax or NaN which collapses colors)
				const colorscale = buildThresholdColorscale(heatmap.min, heatmap.max, overlayCfg);
				let Z_MIN = Number.isFinite(heatmap.min) ? Math.floor(heatmap.min) : NaN;
				let Z_MAX = Number.isFinite(heatmap.max) ? Math.ceil(heatmap.max) : NaN;
				if (!Number.isFinite(Z_MIN) || !Number.isFinite(Z_MAX) || Z_MIN >= Z_MAX) {
					// fallback to Lw sliders range (if available) with margin
					const segs = (building as any).LwBySegment || [];
					const lwVals = Array.isArray(segs) ? segs.map((s: any) => Number(s?.value ?? NaN)).filter(Number.isFinite) : [];
					const lwMin = lwVals.length ? Math.min(...lwVals) : 0;
					const lwMax = lwVals.length ? Math.max(...lwVals) : 80;
					const pad = Math.max(4, Math.ceil((lwMax - lwMin) * 0.25));
					Z_MIN = Math.floor(Math.min(lwMin, (heatmap.min || lwMin)) - pad);
					Z_MAX = Math.ceil(Math.max(lwMax, (heatmap.max || lwMax)) + pad);
				}
				// safety final
				if (Z_MIN >= Z_MAX) { Z_MIN = (heatmap.min || 0) - 10; Z_MAX = (heatmap.max || 0) + 10; }

				const trace = {
					x: heatmap.x,
					y: heatmap.y,
					z: heatmap.z,
					type: "heatmap" as const,
					colorscale,
					zmin: Z_MIN,
					zmax: Z_MAX,
					// use 'best' interpolation so Plotly doesn't quantize the colors harshly
					zsmooth: "best",
					showscale: false,
					hoverinfo: "skip"
				};

				// <- IMPORTANT: transparent background so masked cells are not white
				const layout = {
					margin: { l: 20, r: 20, t: 20, b: 20 },
					xaxis: { visible: false },
					yaxis: { visible: false },
					paper_bgcolor: "rgba(0,0,0,0)",
					plot_bgcolor: "rgba(0,0,0,0)"
				};

				await plotly.newPlot(container, [trace], layout, { staticPlot: false, displayModeBar: false });
				// ask plotly to render PNG with transparent background
				const dataUrl = await plotly.toImage(container, { format: "png", width: 1600, height: 1600, scale: 1 });
				
				if (!mounted) return;
				
				const loader = new THREE.TextureLoader();
				loader.load(dataUrl, (tex) => {
					tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
					tex.minFilter = THREE.LinearFilter;
					tex.magFilter = THREE.LinearFilter;
					tex.flipY = false;
					tex.needsUpdate = true;
					setTexture(tex);
					try { if (plotly && plotly.purge) plotly.purge(container); } catch (e) {}
				});
			} catch (e) {
				console.error("Plotly error", e);
			}
		})();

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
	}, [heatmap, params]);

 	// Perimeter line (drawn on top)
 	return (
 		<div style={{ width: "100vw", height: "100vh", margin: 0, padding: 0, background: "#222", overflow: "hidden" }}>
			<ControlsPanel
				building={building}
				setBuilding={setBuilding}
				params={params}
				setParams={setParams}
				setRefreshKey={setRefreshKey}
			/>
 
			<Canvas camera={{ position: [30, 20, 30], fov: 45 }} style={{ width: "100%", height: "100%" }}>
				<hemisphereLight groundColor={0x444444} intensity={0.6} />
				<directionalLight position={[50, 50, 50]} intensity={0.8} />

				{/* ground heatmap plane: now placed at y=0 so the building rests on it */}
				<mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
					<planeGeometry args={[config.areaSize, config.areaSize, 1, 1]} />
					{texture
						? <meshBasicMaterial map={texture} toneMapped={false} transparent={true} opacity={0.98} />
						: <meshStandardMaterial color={0x222222} />}
				</mesh>

				{/* Building edges (wireframe) — positioned so base sits on the plane (buildingHeight/2) */}
				{lShapeMesh && (
					<group position={[0, config.buildingHeight / 2, 0]} rotation={[Math.PI / 2, 0, 0]} renderOrder={1000}>
						{/* Filled, opaque extrusion (non-transparent) */}
						<mesh geometry={lShapeMesh} castShadow receiveShadow renderOrder={1000}>
							<meshStandardMaterial color={0x999999} metalness={0.1} roughness={0.6} transparent={false} />
						</mesh>

						{/* Wireframe on top for crisp edges */}
						<primitive
							object={new (THREE as any).LineSegments(
								new (THREE as any).EdgesGeometry(lShapeMesh),
								new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 1, transparent: true, opacity: 0.95 })
							)}
						/>
					</group>
				)}

				{/* Perimeter line drawn slightly above the plane to be clearly visible */}
				{outerGeom && (outerGeom as any).attributes && (
					<group position={[0, 0.01, 0]} renderOrder={9999}>
						<primitive
							object={new (THREE as any).LineLoop(
								outerGeom,
								new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2, transparent: true, opacity: 0.95 })
							)}
						/>
					</group>
				)}

				{/* debug emit points removed */}

				<OrbitControls />
			</Canvas>
		</div>
	);
}
