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

/**
	 * helper: compute perp signed (positive outside) and along distance and normalized t
	 */
export function getPerpAlong(px: number, pz: number, a: number[], b: number[]) {
	const dx = b[0] - a[0], dz = b[1] - a[1];
	const segLen = Math.hypot(dx, dz);
	if (segLen < 1e-8) return { perp: -Infinity, along: 0, segLen: 0, tx: 0, tz: 0, nx: 0, nz: 0 };
	const tx = dx / segLen, tz = dz / segLen;
	let nx = -tz, nz = tx;
	const vecX = px - a[0], vecZ = pz - a[1];
	const tRaw = (vecX * tx + vecZ * tz);
	const clamped = Math.max(0, Math.min(segLen, tRaw));
	const projX = a[0] + tx * clamped;
	const projZ = a[1] + tz * clamped;
	const offX = px - projX, offZ = pz - projZ;
	const perp = offX * nx + offZ * nz;
	return { perp, along: clamped, t: clamped / segLen, segLen, tx, tz, nx, nz };
}

export default { buildFacadeElementsForSegment, buildAllFacades, getPerpAlong };
