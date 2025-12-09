import React from "react";
import { getBuildingConfig, defaultParams } from "./config";
import useSyncSegments from "./hooks/useSyncSegments";

type Props = {
  building: any;
  setBuilding: (b: any) => void;
  params: any;
  setParams: (p: any) => void;
  setRefreshKey: (fn: (k: number) => number) => void;
  setConfig?: (c: any) => void;
};

export default function ControlsPanel({ building, setBuilding, params, setParams, setRefreshKey, setConfig }: Props) {
	// usar hook para sincronizar segmentos e intercambio de figuras
	const { changeBuildingType } = useSyncSegments(building, setBuilding, setConfig, setRefreshKey);

	// número actual de fachadas (segments)
	const segCount = Array.isArray((building as any)?.LwBySegment) ? (building as any).LwBySegment.length : 0;
	const currentShape = (building && (building as any).shapeType) ?? "L";

    return (
    <div style={{ position: "absolute", left: 12, top: 12, background: "rgba(0,0,0,0.75)", padding: 12, borderRadius: 8, color: "#fff", fontFamily: "sans-serif", zIndex: 1100, width: 360 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>Ajustes (Lw por Segmento)</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select value={currentShape} onChange={(e) => changeBuildingType(e.target.value)} style={{ padding: "4px 6px", borderRadius: 4 }}>
            <option value="L">L</option>
            <option value="U">U</option>
            <option value="S">S</option>
            <option value="HEX">HEX</option>
            <option value="T">T</option>
            <option value="CROSS">CROSS</option>
            <option value="POLY">POLY</option>
          </select>
          <div style={{ fontSize: 12, color: "#ddd" }}>{segCount} fachadas</div>
        </div>
      </div>

      {(building as any).LwBySegment && Array.isArray((building as any).LwBySegment) && (building as any).LwBySegment.map((lw: any, idx: number) => (
        <div key={idx} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <label style={{ width: 48, fontSize: 12 }}>Seg {idx}</label>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={lw.value}
            onChange={(e) => {
              const v = Math.max(0, Number(e.target.value || 0));
              setBuilding((b: any) => {
                const updated = [...(b as any).LwBySegment];
                updated[idx] = { value: v };
                return { ...b, LwBySegment: updated };
              });
            }}
            style={{ flex: 1 }}
          />
          <div style={{ width: 44, textAlign: "right", fontSize: 12 }}>{lw.value} dB</div>
        </div>
      ))}

      <div style={{ height: 8 }} />
      <div style={{ fontSize: 13, marginBottom: 6, fontWeight: 700 }}>Ajustes del overlay (visual)</div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <label style={{ width: 140, fontSize: 12 }}>Smooth size</label>
        <input type="range" min={0} max={21} step={1} value={params.colorOverlay?.overlaySmoothSize ?? (defaultParams as any).colorOverlay.overlaySmoothSize}
          onChange={(e) => { const v = Number(e.target.value || 0); setParams((p:any) => ({ ...p, colorOverlay: { ...p.colorOverlay, overlaySmoothSize: v } })); setRefreshKey(k => k + 1); }} style={{ flex: 1 }} />
        <div style={{ width: 36, textAlign: "right", fontSize: 11 }}>{(params.colorOverlay?.overlaySmoothSize ?? (defaultParams as any).colorOverlay.overlaySmoothSize)}</div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <label style={{ width: 140, fontSize: 12 }}>Smooth sigma</label>
        <input type="range" min={0} max={6.0} step={0.1} value={params.colorOverlay?.overlaySmoothSigma ?? (defaultParams as any).colorOverlay.overlaySmoothSigma}
          onChange={(e) => { const v = Number(e.target.value || 0); setParams((p:any) => ({ ...p, colorOverlay: { ...p.colorOverlay, overlaySmoothSigma: v } })); setRefreshKey(k => k + 1); }} style={{ flex: 1 }} />
        <div style={{ width: 36, textAlign: "right", fontSize: 11 }}>{(params.colorOverlay?.overlaySmoothSigma ?? (defaultParams as any).colorOverlay.overlaySmoothSigma).toFixed(1)}</div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <label style={{ width: 140, fontSize: 12 }}>Lateral spread</label>
        <input type="range" min={0.2} max={3.0} step={0.05} value={params.colorOverlay?.lateralSpreadFactor ?? (defaultParams as any).colorOverlay.lateralSpreadFactor}
          onChange={(e) => { const v = Number(e.target.value || 0.9); setParams((p:any) => ({ ...p, colorOverlay: { ...p.colorOverlay, lateralSpreadFactor: v } })); setRefreshKey(k => k + 1); }} style={{ flex: 1 }} />
        <div style={{ width: 44, textAlign: "right", fontSize: 11 }}>{(params.colorOverlay?.lateralSpreadFactor ?? (defaultParams as any).colorOverlay.lateralSpreadFactor).toFixed(2)}</div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 11 }}>Yellow spread</label>
          <input type="range" min={1} max={6} step={0.1} value={(params.colorOverlay?.colorSpread as any)?.yellow ?? (defaultParams as any).colorOverlay.colorSpread.yellow}
            onChange={(e) => { const v = Number(e.target.value || 1.6); setParams((p:any) => ({ ...p, colorOverlay: { ...p.colorOverlay, colorSpread: { ...p.colorOverlay.colorSpread, yellow: v } } })); setRefreshKey(k => k + 1); }} style={{ width: "100%" }} />
          <div style={{ textAlign: "right", fontSize: 11 }}>{((params.colorOverlay?.colorSpread as any)?.yellow ?? (defaultParams as any).colorOverlay.colorSpread.yellow).toFixed(1)}</div>
        </div>
        <div style={{ width: 8 }} />
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 11 }}>Green spread</label>
          <input type="range" min={1} max={8} step={0.1} value={(params.colorOverlay?.colorSpread as any)?.green ?? (defaultParams as any).colorOverlay.colorSpread.green}
            onChange={(e) => { const v = Number(e.target.value || 2.1); setParams((p:any) => ({ ...p, colorOverlay: { ...p.colorOverlay, colorSpread: { ...p.colorOverlay.colorSpread, green: v } } })); setRefreshKey(k => k + 1); }} style={{ width: "100%" }} />
          <div style={{ textAlign: "right", fontSize: 11 }}>{((params.colorOverlay?.colorSpread as any)?.green ?? (defaultParams as any).colorOverlay.colorSpread.green).toFixed(1)}</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 11 }}>Blue spread</label>
          <input type="range" min={1} max={12} step={0.2} value={(params.colorOverlay?.colorSpread as any)?.blue ?? (defaultParams as any).colorOverlay.colorSpread.blue}
            onChange={(e) => { const v = Number(e.target.value || 2.6); setParams((p:any) => ({ ...p, colorOverlay: { ...p.colorOverlay, colorSpread: { ...p.colorOverlay.colorSpread, blue: v } } })); setRefreshKey(k => k + 1); }} style={{ width: "100%" }} />
          <div style={{ textAlign: "right", fontSize: 11 }}>{((params.colorOverlay?.colorSpread as any)?.blue ?? (defaultParams as any).colorOverlay.colorSpread.blue).toFixed(1)}</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
        <label style={{ width: 140, fontSize: 12 }}>Red max dist (m)</label>
        <input type="range" min={0.5} max={6.0} step={0.1} value={(params.colorOverlay as any).redMaxDist ?? 2.0}
          onChange={(e) => { const v = Number(e.target.value || 2.0); setParams((p:any) => ({ ...p, colorOverlay: { ...p.colorOverlay, redMaxDist: v } })); setRefreshKey(k => k + 1); }} style={{ flex: 1 }} />
        <div style={{ width: 36, textAlign: "right", fontSize: 11 }}>{((params.colorOverlay as any).redMaxDist ?? 2.0).toFixed(1)}</div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center" }}>
        <label style={{ width: 140, fontSize: 12 }}>Yellow max dist (m)</label>
        <input type="range" min={1} max={12.0} step={0.1} value={(params.colorOverlay as any).yellowMaxDist ?? 6.0}
          onChange={(e) => { const v = Number(e.target.value || 6.0); setParams((p:any) => ({ ...p, colorOverlay: { ...p.colorOverlay, yellowMaxDist: v } })); setRefreshKey(k => k + 1); }} style={{ flex: 1 }} />
        <div style={{ width: 36, textAlign: "right", fontSize: 11 }}>{((params.colorOverlay as any).yellowMaxDist ?? 6.0).toFixed(1)}</div>
      </div>

      {/* Dot threshold (normal / halo relax) */}
      <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
        <label style={{ width: 140, fontSize: 12 }}>Dot threshold</label>
        <input
          type="range"
          min={-1}
          max={1}
          step={0.01}
          value={(params.colorOverlay as any).dotThreshold ?? ((defaultParams as any).colorOverlay.dotThreshold ?? -0.18)}
          onChange={(e) => {
            const v = Number(e.target.value || 0);
            setParams((p:any) => ({ ...p, colorOverlay: { ...p.colorOverlay, dotThreshold: v } }));
            setRefreshKey(k => k + 1);
          }}
          style={{ flex: 1 }}
        />
        <div style={{ width: 48, textAlign: "right", fontSize: 11 }}>{((params.colorOverlay as any).dotThreshold ?? ((defaultParams as any).colorOverlay.dotThreshold ?? -0.18)).toFixed(2)}</div>
      </div>

      {/* Invert normals (debug/test) */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <label style={{ width: 140, fontSize: 12 }}>
          <input
            type="checkbox"
            checked={!!params.invertNormals}
            onChange={(e) => {
              const v = e.target.checked;
              setParams((p:any) => ({ ...p, invertNormals: v }));
              setRefreshKey(k => k + 1);
            }}
            style={{ marginRight: 8 }}
          />
          Invertir normales
        </label>
        <div style={{ fontSize: 11, color: "#ddd" }}>{params.invertNormals ? "ON" : "OFF"}</div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <button onClick={() => setRefreshKey(k => k + 1)} style={{ padding: "6px 10px", borderRadius: 6, background: "#007acc", color: "#fff", border: "none", cursor: "pointer" }}>Recalcular</button>
        <button onClick={() => { setBuilding(getBuildingConfig("L")); setParams(defaultParams); setRefreshKey(k => k + 1); }} style={{ padding: "6px 8px", borderRadius: 6, background: "#444", color: "#fff", border: "none", cursor: "pointer" }}>Reset</button>
        <button onClick={() => {
          setParams((p:any) => ({
            ...p,
            colorOverlay: {
              ...p.colorOverlay,
              overlaySmoothSize: 13,
              overlaySmoothSigma: 3.6,
              lateralSpreadFactor: 1.5,
              colorSpread: { ...p.colorOverlay.colorSpread, yellow: 3.4, green: 5.0, blue: 8.0 },
              redMaxDist: 2.0,
              yellowMaxDist: 6.0
            }
          }));
          setTimeout(() => setRefreshKey(k => k + 1), 50);
        }} style={{ padding: "6px 10px", borderRadius: 6, background: "#d9534f", color: "#fff", border: "none", cursor: "pointer" }}>Apply Referente</button>
      </div>

      {/* emit points debug control removed */}
    </div>
  );
}
