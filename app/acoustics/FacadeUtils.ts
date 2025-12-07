import { FacadeElement } from "../lib/ISOModel";


export type Segment = { name: string; p1: [number, number]; p2: [number, number] };

/**
 * buildFacadeElementsForSegment
 * - calcula elementos de fachada a partir de un segmento y la altura del edificio.
 * - Rmap permite pasar un R específico por segmento.
 */
export function buildFacadeElementsForSegment(seg: Segment, buildingHeight: number, Rmap?: Record<string, number>): FacadeElement[] {
	const ax = seg.p1[0], az = seg.p1[1];
	const bx = seg.p2[0], bz = seg.p2[1];
	const segLen = Math.hypot(bx - ax, bz - az);
	const height = Math.max(0.1, buildingHeight || 3);
	const area = Math.max(0.0001, segLen * height);
	const Rval = (Rmap && typeof Rmap[seg.name] === "number") ? Rmap[seg.name] : 30; // default R = 30 dB
	return [{ area, R: Rval }];
}

/**
 * buildAllFacades
 * - devuelve un mapa segmentName -> FacadeElement[]
 */
export function buildAllFacades(segments: Segment[], buildingHeight: number, Rmap?: Record<string, number>) {
	const out: Record<string, FacadeElement[]> = {};
	for (const s of segments) out[s.name] = buildFacadeElementsForSegment(s, buildingHeight, Rmap);
	return out;
}

export default { buildFacadeElementsForSegment, buildAllFacades };
