"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import PerimeterExtractor from "./Perimeter";
import AcousticCalculator from "./acoustics/AcousticCalculator";
import WaveEmitter from "./acoustics/WaveEmitter";
import { getBuildingConfig, defaultParams } from "./config";
import { buildThresholdColorscale } from "./acoustics/ColorMap";
import { createLShapeExtrudeGeometry } from "./geometry/building";

export default function Home() {
  const [config, setConfig] = useState(getBuildingConfig("L"));
  const [building, setBuilding] = useState(getBuildingConfig("L"));
  const [params, setParams] = useState(defaultParams);
  const [refreshKey, setRefreshKey] = useState(0);
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
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

  const outerGeom = useMemo(() => 
    finalLoop && finalLoop.length ? PerimeterExtractor.createLineGeometry(finalLoop) : new THREE.BufferGeometry(), 
    [finalLoop]
  );

  // índice del segmento que queremos marcar como fuente fuerte (0..N-1)
  const hotSegmentIndex = 2; // cambia este valor si quieres otra fachada
  const hotLwValue = 80;     // valor Lw en dB para la fachada "caliente"

  useEffect(() => {
    // Sincroniza LwBySegment con el número de segmentos de la figura L
    const n = finalLoop ? finalLoop.length : 0;
    if (!n) return;
    setBuilding(prev => {
      const cur = (prev as any).LwBySegment;
      if (Array.isArray(cur) && cur.length === n) {
        // si ya existe, asegurarnos de que el segmento caliente mantenga su valor
        const cloned = [...cur];
        if (cloned[hotSegmentIndex]) cloned[hotSegmentIndex] = { value: hotLwValue };
        return { ...prev, LwBySegment: cloned };
      }
      const minVal = 20, maxVal = 80;
      const newArr = new Array(n).fill(0).map((_, i) => {
        const existing = Array.isArray(cur) && cur[i] && typeof cur[i].value === "number"
          ? cur[i].value
          : Math.round(minVal + Math.random() * (maxVal - minVal));
        return { value: existing };
      });
      // forzar la fachada caliente
      if (hotSegmentIndex >= 0 && hotSegmentIndex < newArr.length) newArr[hotSegmentIndex].value = hotLwValue;
      return { ...prev, LwBySegment: newArr };
    });
  }, [finalLoop]);

  const heatmap = useMemo(() => {
    const main = finalLoop.map((point, i) => ({
      name: `segment-${i}`,
      p1: point,
      p2: finalLoop[(i + 1) % finalLoop.length]
    }));

    const LwObj: Record<string, number> = {};
    const segments = (building as any).LwBySegment || [];
    segments.forEach((lw: any, idx: number) => {
      LwObj[`segment-${idx}`] = lw?.value ?? 50;
    });

    const sampleSpacing = params?.sourceSpacing ?? Math.max(0.25, Math.min(1.0, config.footprint / 12));
    const perimeterSources = WaveEmitter.generateSources(finalLoop, main, sampleSpacing, 0.05, LwObj);

    return AcousticCalculator.compute({
      areaSize: config.areaSize,
      resolution: config.resolution,
      footprint: config.footprint,
      poly: finalLoop,
      main,
      sources: perimeterSources,
      Lw: LwObj as any,
      params
    });
  }, [config, finalLoop, building, params, refreshKey]);

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
        const colorscale = buildThresholdColorscale(heatmap.min, heatmap.max, overlayCfg);
        const Z_MIN = Math.floor(heatmap.min);
        const Z_MAX = Math.ceil(heatmap.max);

        const trace = {
          x: heatmap.x,
          y: heatmap.y,
          z: heatmap.z,
          type: "heatmap" as const,
          colorscale,
          zmin: Z_MIN,
          zmax: Z_MAX,
          zsmooth: "false",
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

  // restore facade controls (sliders) so user can adjust Lw per segment
  const heatmapControls = (
    <div style={{ position: "absolute", left: 12, top: 12, background: "rgba(0,0,0,0.65)", padding: 10, borderRadius: 8, color: "#fff", fontFamily: "sans-serif", zIndex: 1100 }}>
      <div style={{ fontSize: 12, marginBottom: 6, fontWeight: 600 }}>Ajustes (Lw por Segmento)</div>
      {(building as any).LwBySegment && Array.isArray((building as any).LwBySegment) && (building as any).LwBySegment.map((lw: any, idx: number) => (
        <div key={idx} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <label style={{ width: 56, fontSize: 12 }}>Seg {idx}</label>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={lw.value}
            onChange={(e) => {
              const v = Math.max(0, Number(e.target.value || 0));
              setBuilding(b => {
                const updated = [...(b as any).LwBySegment];
                updated[idx] = { value: v };
                return { ...b, LwBySegment: updated };
              });
            }}
            style={{ flex: 1 }}
          />
          <div style={{ width: 52, textAlign: "right", fontSize: 12 }}>{lw.value} dB</div>
        </div>
      ))}
      <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
        <button onClick={() => setRefreshKey(k => k + 1)} style={{ padding: "6px 10px", borderRadius: 6, background: "#007acc", color: "#fff", border: "none", cursor: "pointer" }}>Recalcular</button>
        <button onClick={() => { setBuilding(getBuildingConfig("L")); setParams(defaultParams); setRefreshKey(k => k + 1); }} style={{ padding: "6px 8px", borderRadius: 6, background: "#444", color: "#fff", border: "none", cursor: "pointer" }}>Reset</button>
      </div>
    </div>
  );

  // Perimeter line (drawn on top)
  return (
    <div style={{ width: "100vw", height: "100vh", margin: 0, padding: 0, background: "#222", overflow: "hidden" }}>
      {heatmapControls}

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

        <OrbitControls />
      </Canvas>
    </div>
  );
}
