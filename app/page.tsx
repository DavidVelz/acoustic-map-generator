"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { createRectangleExtrudeGeometry } from "./geometry/building";
import ControlsPanel from "./ControlsPanel";
import PerimeterExtractor from "./Perimeter";
import { defaultParams, getBuildingConfig } from "./config";
import useHeatmap from "./hooks/useHeatmap";
import usePlotlyTexture from "./hooks/usePlotlyTexture";

export default function Home() {
	const [config, setConfig] = useState(getBuildingConfig("L"));
	const [building, setBuilding] = useState(getBuildingConfig("L"));
	const [params, setParams] = useState(defaultParams);
	const [refreshKey, setRefreshKey] = useState(0);
	const [texture, setTexture] = useState<THREE.Texture | null>(null);

	// rectangle geometry: width = footprint (short side), depth = footprintDepth (long side)
	const rectMesh = useMemo(() => createRectangleExtrudeGeometry(config.footprint, (config as any).footprintDepth ?? config.footprint, config.buildingHeight), [config.footprint, (config as any).footprintDepth, config.buildingHeight]);

	// extract perimeter from rectangle
	const baseLoop = useMemo(() => PerimeterExtractor.extractBasePerimeter(rectMesh), [rectMesh]);

	const finalLoop = useMemo(() => baseLoop && baseLoop.length >= 3 ? baseLoop : [], [baseLoop]);

	// ensure building.LwBySegment length matches rectangle (4)
	useEffect(() => {
		const n = finalLoop ? finalLoop.length : 0;
		if (!n) return;
		setBuilding(prev => {
			const cur = (prev as any).LwBySegment || [];
			if (Array.isArray(cur) && cur.length === n) return prev;
			const defaultVal = 30;
			const newArr = new Array(n).fill(0).map((_, i) => ({ value: Array.isArray(cur) && cur[i] ? cur[i].value : defaultVal }));
			return { ...prev, LwBySegment: newArr };
		});
	}, [finalLoop]);

	// load external JSON once and populate building.LwBySegment (if present)
	useEffect(() => {
		(async () => {
			try {
				const res = await fetch("/data/sourceLevels.json");
				if (!res.ok) return;
				const j = await res.json();
				if (Array.isArray(j?.segments)) {
					// Determine conversion mode: 'Lw' => use values directly; 'Lp' => convert Lp->Lw
					const mode = (j.mode || "Lw").toString().toLowerCase();
					// constant 10*log10(4π) for geometric compensation at 1 m
					const FOUR_PI_CONST = 10 * Math.log10(4 * Math.PI);
					const dbPerMeter = (params as any)?.dbPerMeter ?? 0.5;

					// map segments to Lw values depending on mode
					const segs = j.segments.map((s: any) => {
						const v = Number(s?.value ?? 0);
						if (mode === "lp") {
							// approximate Lw that would produce Lp ≈ v at 1 m:
							// Lw ≈ Lp + 10*log10(4π) + dbPerMeter * 1
							const lw = v + FOUR_PI_CONST + dbPerMeter * 1.0;
							return { value: Number(lw) };
						}
						// default: treat as Lw
						return { value: Number(v) };
					});
					// ensure exactly 4 segments for rectangle building
					while (segs.length < 4) segs.push({ value: 0 });
					setBuilding((b: any) => ({ ...b, LwBySegment: segs.slice(0, 4) }));
				}
			} catch (e) {
				console.warn("No se pudo cargar data/sourceLevels.json", e);
			}
		})();
	}, []);

	// heatmap + texture hooks (unchanged)
	const heatmap = useHeatmap(config, building, params, finalLoop, rectMesh, refreshKey);
	const textureFromHook = usePlotlyTexture(heatmap, params, building);
	useEffect(() => { setTexture(textureFromHook); }, [textureFromHook]);

	// render
	return (
		<div style={{ width: "100vw", height: "100vh", margin: 0, padding: 0, background: "#222", overflow: "hidden" }}>
			<ControlsPanel building={building} setBuilding={setBuilding} params={params} setParams={setParams} setRefreshKey={setRefreshKey} setConfig={setConfig} />

			<Canvas camera={{ position: [30, 20, 30], fov: 45 }} style={{ width: "100%", height: "100%" }}>
				<hemisphereLight groundColor={0x444444} intensity={0.6} />
				<directionalLight position={[50, 50, 50]} intensity={0.8} />

				{/* heatmap plane */}
				<mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
					<planeGeometry args={[config.areaSize, config.areaSize, 1, 1]} />
					{texture ? <meshBasicMaterial map={texture} toneMapped={false} transparent={true} opacity={0.98} /> : <meshStandardMaterial color={0x222222} />}
				</mesh>

				{/* rectangle building */}
				{rectMesh && (
					<group position={[0, config.buildingHeight / 2, 0]} rotation={[Math.PI / 2, 0, 0]} renderOrder={1000}>
						<mesh geometry={rectMesh} castShadow receiveShadow renderOrder={1000}>
							<meshStandardMaterial color={0x999999} metalness={0.1} roughness={0.6} transparent={false} />
						</mesh>
					</group>
				)}

				<OrbitControls />
			</Canvas>
		</div>
	);
}
