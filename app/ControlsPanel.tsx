import React from "react";
import { getBuildingConfig, defaultParams } from "./config";

type Props = {
  building: any;
  setBuilding: (b: any) => void;
  params: any;
  setParams: (p: any) => void;
  setRefreshKey: (fn: (k: number) => number) => void;
  setConfig?: (c: any) => void;
};

export default function ControlsPanel({ building, setBuilding, params, setParams, setRefreshKey }: Props) {
	// number of segments (rectangle -> 4)
	const segCount = Array.isArray((building as any)?.LwBySegment) ? (building as any).LwBySegment.length : 0;

	// Input mode: 'Lw' (default) or 'Lp' (if Lp, UI shows/edits Lp values but we store Lw)
	const inputMode = (params && (params as any).inputMode) ? (params as any).inputMode : "Lw";

	// constants for conversion Lp <-> Lw (approximate, reference distance = 1 m)
	const FOUR_PI_CONST = 10 * Math.log10(4 * Math.PI);
	const dbPerMeter = (params as any)?.dbPerMeter ?? 0.5;
	const lpToLw = (lp: number) => lp + FOUR_PI_CONST + dbPerMeter * 1.0;
	const lwToLp = (lw: number) => lw - (FOUR_PI_CONST + dbPerMeter * 1.0);

	return (
		<div style={{ position: "absolute", left: 12, top: 12, background: "rgba(0,0,0,0.75)", padding: 12, borderRadius: 8, color: "#fff", fontFamily: "sans-serif", zIndex: 1100, width: 360 }}>
			<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
				<div style={{ fontSize: 13, fontWeight: 700 }}>
					Ajustes — Rectángulo ({segCount} lados)
				</div>
				<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
					<label style={{ fontSize: 12, marginRight: 6 }}>Input mode</label>
					<select value={inputMode} onChange={(e) => { const mode = e.target.value; setParams((p:any) => ({ ...p, inputMode: mode })); }} style={{ padding: "4px 6px", borderRadius: 4 }}>
						<option value="Lw">Lw (dB)</option>
						<option value="Lp">Lp (dB)</option>
					</select>
				</div>
			</div>

			{(building as any).LwBySegment && Array.isArray((building as any).LwBySegment) && (building as any).LwBySegment.map((entry: any, idx: number) => {
				// displayedValue: if editing in Lp mode, show computed Lp; else show Lw
				const storedLw = Number(entry?.value ?? 0);
				const displayedValue = inputMode === "Lp" ? Number(lwToLp(storedLw).toFixed(1)) : storedLw;
				const minVal = inputMode === "Lp" ? -20 : 0;
				const maxVal = inputMode === "Lp" ? 120 : 120;
				return (
				<div key={idx} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
					<label style={{ width: 48, fontSize: 12 }}>Seg {idx}</label>
					<input
						type="range"
						min={minVal}
						max={maxVal}
						step={inputMode === "Lp" ? 0.1 : 1}
						value={displayedValue}
						onChange={(e) => {
							const v = Number(e.target.value || 0);
							// convert to stored Lw if necessary
							const newLw = inputMode === "Lp" ? lpToLw(v) : v;
							setBuilding((b: any) => {
								const updated = [...(b as any).LwBySegment];
								updated[idx] = { value: Number(newLw) };
								return { ...b, LwBySegment: updated };
							});
						}}
						style={{ flex: 1 }}
					/>
					<div style={{ width: 64, textAlign: "right", fontSize: 12 }}>
						{displayedValue}{' '}{inputMode === "Lp" ? 'Lp' : 'Lw'}
					</div>
				</div>
			)})}

			<div style={{ display: "flex", gap: 8, marginTop: 6 }}>
				<button onClick={() => setRefreshKey(k => k + 1)} style={{ padding: "6px 10px", borderRadius: 6, background: "#007acc", color: "#fff", border: "none", cursor: "pointer" }}>Recalcular</button>
				<button onClick={() => { setBuilding(getBuildingConfig("L")); setParams(defaultParams); setRefreshKey(k => k + 1); }} style={{ padding: "6px 8px", borderRadius: 6, background: "#444", color: "#fff", border: "none", cursor: "pointer" }}>Reset</button>
				<button onClick={async () => {
					try {
						const res = await fetch("/data/sourceLevels.json");
						if (!res.ok) return;
						const j = await res.json();
						if (Array.isArray(j?.segments)) {
							// determine mode and convert LP->Lw if necessary
							const mode = (j.mode || "Lw").toString().toLowerCase();
							const FOUR_PI_CONST = 10 * Math.log10(4 * Math.PI);
							const dbPerMeter = (params as any)?.dbPerMeter ?? 0.5;
							const segs = j.segments.map((s: any) => {
								const v = Number(s?.value ?? 0);
								if (mode === "lp") {
									const lw = v + FOUR_PI_CONST + dbPerMeter * 1.0;
									return { value: Number(lw) };
								}
								return { value: Number(v) };
							});
							while (segs.length < 4) segs.push({ value: 0 });
							setBuilding((b: any) => ({ ...b, LwBySegment: segs.slice(0, 4) }));
							setRefreshKey(k => k + 1);
						}
					} catch(e) { console.warn(e); }
				}} style={{ padding: "6px 10px", borderRadius: 6, background: "#d9534f", color: "#fff", border: "none", cursor: "pointer" }}>Cargar JSON</button>
			</div>
		</div>
	);
}
