"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { createLShapeExtrudeGeometry, createUShapeExtrudeGeometry, createSquareExtrudeGeometry } from "./geometry/building";
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
	// const [showEmit, setShowEmit] = useState(false);
	// const [emitPoints, setEmitPoints] = useState<any[]>([]);
	const hiddenDivRef = useRef<HTMLDivElement | null>(null);

	// crear geometría según config.shapeType (por defecto 'L')
	const lShapeMesh = useMemo(() => {
		const shapeType = (config as any).shapeType ?? "L";
		if (shapeType === "U") return createUShapeExtrudeGeometry(config.footprint, config.buildingHeight);
		if (shapeType === "S") return createSquareExtrudeGeometry(config.footprint, config.buildingHeight);
		// por defecto L
		return createLShapeExtrudeGeometry(config.footprint, config.buildingHeight);
	}, [config.footprint, config.buildingHeight, (config as any).shapeType]);

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

	// ahora delegamos en el hook
	const heatmap = useHeatmap(config, building, params, finalLoop, lShapeMesh, refreshKey);

	// obtener textura usando hook (internamente crea contenedor Plotly y carga THREE.Texture)
	const textureFromHook = usePlotlyTexture(heatmap, params, building);
	// mantener textura en estado para compatibilidad con el JSX existente
	useEffect(() => { setTexture(textureFromHook); }, [textureFromHook]);

 	// Perimeter line (drawn on top)
 	return (
 		<div style={{ width: "100vw", height: "100vh", margin: 0, padding: 0, background: "#222", overflow: "hidden" }}>
			<ControlsPanel
				building={building}
				setBuilding={setBuilding}
				params={params}
				setParams={setParams}
				setRefreshKey={setRefreshKey}
				setConfig={setConfig} // nuevo prop
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
