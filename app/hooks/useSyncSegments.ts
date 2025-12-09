import { useEffect, useCallback } from "react";
import { getBuildingConfig } from "../config";

export default function useSyncSegments(
	building: any,
	setBuilding: (b: any) => void,
	setConfig?: (c: any) => void,
	setRefreshKey?: (fn: (k: number) => number) => void
) {
	// mapa sugerido de segmentos por tipo (coherente con getBuildingConfig)
	const shapeSegCountMap: Record<string, number> = { L: 6, U: 8, S: 4, HEX: 6, T: 8, CROSS: 12, POLY: 8 };

	useEffect(() => {
		if (!building) return;
		const shapeType = (building as any).shapeType ?? "S";
		const segCount = shapeSegCountMap[shapeType] ?? 4;
		const existing = (building as any).LwBySegment;
		let needInit = false;
		if (!Array.isArray(existing) || existing.length !== segCount) needInit = true;
		else {
			for (let i = 0; i < existing.length; i++) {
				if (typeof existing[i]?.value !== "number") { needInit = true; break; }
			}
		}
		if (needInit) {
			const arr = Array.from({ length: segCount }, (_, i) => ({ value: i === 0 ? 100 : 0 }));
			setBuilding((b: any) => ({ ...b, shapeType: (b && b.shapeType) ? b.shapeType : shapeType, LwBySegment: arr }));
			if (setConfig) {
				setConfig((c: any) => ({ ...(c || {}), shapeType: (building && building.shapeType) ? building.shapeType : shapeType }));
			}
		}
	}, [building, setBuilding, setConfig]);

	const changeBuildingType = useCallback((type: string) => {
		const segCount = shapeSegCountMap[type] ?? 6;
		const arr = Array.from({ length: segCount }, (_, i) => ({ value: i === 0 ? 100 : 0 }));
		setBuilding((b: any) => ({ ...b, shapeType: type, LwBySegment: arr }));
		if (setConfig) setConfig((c: any) => ({ ...(c || {}), shapeType: type }));
		if (setRefreshKey) setRefreshKey(k => k + 1);
	}, [setBuilding, setConfig, setRefreshKey]);

	return { changeBuildingType };
}
