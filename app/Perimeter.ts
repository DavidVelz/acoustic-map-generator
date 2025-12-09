import * as THREE from "three";

export default class PerimeterExtractor {
	// rotationX default matches the mesh rotation used in page.tsx (Math.PI/2)
	static getRotationMatrixX(rotationX = Math.PI / 2) {
		return new THREE.Matrix4().makeRotationX(rotationX);
	}

	static unique2D(points: number[][]) {
		const out: number[][] = [];
		for (const p of points) {
			if (!out.some(([x, z]) => Math.abs(x - p[0]) < 1e-6 && Math.abs(z - p[1]) < 1e-6)) out.push(p);
		}
		return out;
	}

	static sortClockwise(points: number[][]) {
		if (points.length === 0) return points;
		const center = points.reduce((acc, [x, z]) => [acc[0] + x / points.length, acc[1] + z / points.length], [0, 0]);
		points.sort((a, b) => Math.atan2(a[1] - center[1], a[0] - center[0]) - Math.atan2(b[1] - center[1], b[0] - center[0]));
		return points.reverse(); // sentido antihorario para normales correctas
	}

	// New: build edge loops from EdgesGeometry, return array of loops (each loop is array of [x,z])
	static buildEdgeLoops(geometry: THREE.ExtrudeGeometry, rotationX = Math.PI / 2): number[][][] {
		const edges = new THREE.EdgesGeometry(geometry);
		const verts = edges.attributes.position.array;
		const rot = this.getRotationMatrixX(rotationX);

		// map point string -> index
		const key = (v: THREE.Vector3) => `${v.x.toFixed(6)}|${v.z.toFixed(6)}`;

		const idxMap = new Map<string, number>();
		const points: THREE.Vector3[] = [];
		const adj = new Map<number, Set<number>>();

		function ensurePoint(v: THREE.Vector3) {
			const k = key(v);
			if (!idxMap.has(k)) {
				const idx = points.length;
				idxMap.set(k, idx);
				points.push(v.clone());
				adj.set(idx, new Set());
				return idx;
			}
			return idxMap.get(k)!;
		}

		for (let i = 0; i < verts.length; i += 6) {
			const v1 = new THREE.Vector3(verts[i], verts[i + 1], verts[i + 2]).applyMatrix4(rot);
			const v2 = new THREE.Vector3(verts[i + 3], verts[i + 4], verts[i + 5]).applyMatrix4(rot);
			const a = ensurePoint(v1);
			const b = ensurePoint(v2);
			adj.get(a)!.add(b);
			adj.get(b)!.add(a);
		}

		// Walk loops: find vertices with degree >0 and traverse until loop closes
		const visitedEdges = new Set<string>();
		const loops: number[][][] = [];

		for (let start = 0; start < points.length; start++) {
			const neigh = adj.get(start);
			if (!neigh || neigh.size === 0) continue;
			for (const n of neigh) {
				const edgeKey = `${start}-${n}`;
				if (visitedEdges.has(edgeKey)) continue;
				// traverse forward
				const loop: number[] = [];
				let prev = start;
				let curr = n;
				loop.push(prev);
				// limit iterations to avoid infinite loops
				let safety = points.length * 3;
				while (safety-- > 0) {
					visitedEdges.add(`${prev}-${curr}`);
					visitedEdges.add(`${curr}-${prev}`);
					loop.push(curr);
					// pick next neighbor of curr that's not prev
					const nbrs = Array.from(adj.get(curr)!);
					let next = -1;
					for (const candidate of nbrs) {
						if (candidate !== prev) { next = candidate; break; }
					}
					if (next === -1) break;
					prev = curr;
					curr = next;
					// closed?
					if (curr === loop[0]) break;
				}
				// convert loop indices to coords, ensure >2 points
				if (loop.length >= 3) {
					const coords = loop.map(i => [points[i].x, points[i].z] as number[]);
					// dedupe successive duplicates
					const uniq = this.unique2D(coords);
					if (uniq.length >= 3) loops.push(this.sortClockwise(uniq));
				}
			}
		}

		// if no loops found fallback to unique points
		if (loops.length === 0) {
			const fallback = points.map(p => [p.x, p.z]);
			return [this.sortClockwise(this.unique2D(fallback))];
		}

		// return loops (outer loop usually the longest)
		return loops;
	}

	// Return the longest loop (presumed outer perimeter)
	static extractPerimeterLoop(geometry: THREE.ExtrudeGeometry, rotationX = Math.PI / 2) {
		const loops = this.buildEdgeLoops(geometry, rotationX);
		if (!loops.length) return [];
		let best = loops[0];
		for (let i = 1; i < loops.length; i++) {
			if (loops[i].length > best.length) best = loops[i];
		}
		return best;
	}

	// Extract vertices projected to XZ after applying rotationX
	static extractAligned2DPerimeter(geometry: THREE.ExtrudeGeometry, rotationX = Math.PI / 2) {
		const rot = this.getRotationMatrixX(rotationX);
		const vertices = geometry.attributes.position.array;
		const poly: number[][] = [];
		for (let i = 0; i < vertices.length; i += 3) {
			const v = new THREE.Vector3(vertices[i], vertices[i + 1], vertices[i + 2]).applyMatrix4(rot);
			poly.push([v.x, v.z]);
		}
		return this.sortClockwise(this.unique2D(poly));
	}

	// Extract edge vertices (using EdgesGeometry) then project & dedupe
	static extractPerimeterEdges(geometry: THREE.ExtrudeGeometry, rotationX = Math.PI / 2) {
		const edges = new THREE.EdgesGeometry(geometry);
		const vertices = edges.attributes.position.array;
		const poly: number[][] = [];
		const rot = this.getRotationMatrixX(rotationX);
		for (let i = 0; i < vertices.length; i += 6) {
			const v1 = new THREE.Vector3(vertices[i], vertices[i + 1], vertices[i + 2]).applyMatrix4(rot);
			const v2 = new THREE.Vector3(vertices[i + 3], vertices[i + 4], vertices[i + 5]).applyMatrix4(rot);
			poly.push([v1.x, v1.z], [v2.x, v2.z]);
		}
		return this.sortClockwise(this.unique2D(poly));
	}

	// Extract corner (unique) points from geometry vertices (projected)
	static extractCornerPoints(geometry: THREE.ExtrudeGeometry, rotationX = Math.PI / 2) {
		const vertices = geometry.attributes.position.array;
		const rot = this.getRotationMatrixX(rotationX);
		const corners: number[][] = [];
		for (let i = 0; i < vertices.length; i += 3) {
			const v = new THREE.Vector3(vertices[i], vertices[i + 1], vertices[i + 2]).applyMatrix4(rot);
			corners.push([v.x, v.z]);
		}
		return this.sortClockwise(this.unique2D(corners));
	}

	// Create BufferGeometry line from perimeter points (closed)
	static createLineGeometry(perimeter: number[][]) {
		const pts = perimeter.map(([x, z]) => new THREE.Vector3(x, 0.1, z)); // elevate slightly above plane
		if (pts.length === 0) return new THREE.BufferGeometry();
		pts.push(pts[0].clone());
		return new THREE.BufferGeometry().setFromPoints(pts);
	}

	// Extract only base vertices (those at the lowest rotated Y) to get the true 2D perimeter
	static extractBasePerimeter(geometry: THREE.ExtrudeGeometry, rotationX = Math.PI / 2, eps = 1e-3) {
		// If the geometry carries an explicit perimeter (created when geometry was built), use it.
		// IMPORTANT: keep the original order of stored perimeter points (do NOT re-sort).
		const ud = (geometry as any).userData;
		const rot = this.getRotationMatrixX(rotationX);
		if (ud && Array.isArray(ud.perimeter) && ud.perimeter.length >= 3) {
			// use stored depth (extrusion depth) to place the shape base, if available
			const depth: number | undefined = (ud.depth !== undefined) ? Number(ud.depth) : undefined;
			const zBase = (typeof depth === "number" && !isNaN(depth)) ? -depth / 2 : 0;
			// transform each stored [x,y] (shape coords) into rotated XZ, preserving order
			const transformed: number[][] = (ud.perimeter as any[]).map((p: any) => {
				const sx = Number(p[0]) || 0;
				const sy = (p.length > 1) ? Number(p[1]) || 0 : 0;
				const v = new THREE.Vector3(sx, sy, zBase).applyMatrix4(rot);
				return [v.x, v.z];
			});
			// return in the original sequence (no unique/sort) — caller expects ordered boundary
			return transformed;
		}
		
		const vertices = geometry.attributes.position.array;
		const pts: { x: number; y: number; z: number }[] = [];

		// collect rotated vertices
		for (let i = 0; i < vertices.length; i += 3) {
			const v = new THREE.Vector3(vertices[i], vertices[i + 1], vertices[i + 2]).applyMatrix4(rot);
			pts.push({ x: v.x, y: v.y, z: v.z });
		}
		if (pts.length === 0) return [];

		// find minimal Y (this corresponds to the base after we position the mesh)
		let minY = Infinity;
		let maxY = -Infinity;
		for (const p of pts) {
			if (p.y < minY) minY = p.y;
			if (p.y > maxY) maxY = p.y;
		}

		// adaptive tolerance: small fraction of the Y-range or eps
		const tol = Math.max(eps, Math.abs(maxY - minY) * 1e-3);

		// --- New: build adjacency only from edges whose both endpoints are at base Y ---
		const edges = new THREE.EdgesGeometry(geometry);
		const verts = edges.attributes.position.array;

		const key = (x: number, z: number) => `${x.toFixed(6)}|${z.toFixed(6)}`;
		const idxMap = new Map<string, number>();
		const pointsXZ: { x: number; z: number }[] = [];
		const adj = new Map<number, Set<number>>();

		function ensurePointXZ(x: number, z: number) {
			const k = key(x, z);
			if (!idxMap.has(k)) {
				const idx = pointsXZ.length;
				idxMap.set(k, idx);
				pointsXZ.push({ x, z });
				adj.set(idx, new Set());
				return idx;
			}
			return idxMap.get(k)!;
		}

		// iterate edges and include only those with both endpoints near minY
		for (let i = 0; i < verts.length; i += 6) {
			const v1 = new THREE.Vector3(verts[i], verts[i + 1], verts[i + 2]).applyMatrix4(rot);
			const v2 = new THREE.Vector3(verts[i + 3], verts[i + 4], verts[i + 5]).applyMatrix4(rot);
			if (Math.abs(v1.y - minY) <= tol && Math.abs(v2.y - minY) <= tol) {
				const a = ensurePointXZ(v1.x, v1.z);
				const b = ensurePointXZ(v2.x, v2.z);
				adj.get(a)!.add(b);
				adj.get(b)!.add(a);
			}
		}

		// If adjacency is empty (no base edges), fallback to simple base vertex collection
		if (pointsXZ.length === 0) {
			// collect vertices close to minY (the base)
			const baseCoords: number[][] = [];
			for (const p of pts) {
				if (Math.abs(p.y - minY) <= tol) baseCoords.push([p.x, p.z]);
			}
			if (baseCoords.length < 3) return this.extractPerimeterLoop(geometry, rotationX);
			return this.sortClockwise(this.unique2D(baseCoords));
		}

		// Walk loops on base-edge graph
		const visitedEdges = new Set<string>();
		const loops: number[][][] = [];

		for (let start = 0; start < pointsXZ.length; start++) {
			const neigh = adj.get(start);
			if (!neigh || neigh.size === 0) continue;
			for (const n of neigh) {
				const edgeKey = `${start}-${n}`;
				if (visitedEdges.has(edgeKey)) continue;
				const loopIdx: number[] = [];
				let prev = start;
				let curr = n;
				loopIdx.push(prev);
				let safety = pointsXZ.length * 3;
				while (safety-- > 0) {
					visitedEdges.add(`${prev}-${curr}`);
					visitedEdges.add(`${curr}-${prev}`);
					loopIdx.push(curr);
					const nbrs = Array.from(adj.get(curr)!);
					let next = -1;
					for (const candidate of nbrs) {
						if (candidate !== prev) { next = candidate; break; }
					}
					if (next === -1) break;
					prev = curr;
					curr = next;
					if (curr === loopIdx[0]) break;
				}
				if (loopIdx.length >= 3) {
					const coords = loopIdx.map(i => [pointsXZ[i].x, pointsXZ[i].z] as number[]);
					const uniq = this.unique2D(coords);
					if (uniq.length >= 3) loops.push(this.sortClockwise(uniq));
				}
			}
		}

		// pick the longest loop (outer perimeter)
		if (loops.length === 0) {
			// as last resort, use unique base vertices
			const baseCoords: number[][] = [];
			for (const p of pts) {
				if (Math.abs(p.y - minY) <= tol) baseCoords.push([p.x, p.z]);
			}
			if (baseCoords.length < 3) return this.extractPerimeterLoop(geometry, rotationX);
			return this.sortClockwise(this.unique2D(baseCoords));
		}
		let best = loops[0];
		for (let i = 1; i < loops.length; i++) if (loops[i].length > best.length) best = loops[i];
		return best;
	}

	// Devuelve segmentos (fachadas) ordenados a partir del perímetro base (outer loop)
	// Cada segmento: { name: "segment-0", p1: [x,z], p2: [x,z] }
	static extractFacadesSegments(geometry: THREE.ExtrudeGeometry, rotationX = Math.PI / 2) {
		const loop = this.extractBasePerimeter(geometry, rotationX);
		if (!loop || loop.length < 2) {
			const loops = this.buildEdgeLoops(geometry, rotationX);
			if (!loops || loops.length === 0) return [];
			let best = loops[0];
			for (let i = 1; i < loops.length; i++) if (loops[i].length > best.length) best = loops[i];
			return best.map((pt, i) => {
				const a = pt;
				const b = best[(i + 1) % best.length];
				return { name: `segment-${i}`, p1: [a[0], a[1]] as [number, number], p2: [b[0], b[1]] as [number, number] };
			});
		}
		const segs: { name: string; p1: [number, number]; p2: [number, number] }[] = [];
		for (let i = 0; i < loop.length; i++) {
			const a = loop[i];
			const b = loop[(i + 1) % loop.length];
			segs.push({ name: `segment-${i}`, p1: [a[0], a[1]], p2: [b[0], b[1]] });
		}
		return segs;
	}

	/**
	 * createDefaultLwMap
	 * - Genera un mapa Lw por nombre de segmento.
	 * - Por defecto asigna `primaryDb` (por ejemplo 100 dB) al segmento indicado por `primaryIndex`
	 *   y `defaultForOthers` (por ejemplo 0 dB) al resto.
	 */
	static createDefaultLwMap(
		segments: { name: string }[],
		primaryDb = 100,
		defaultForOthers = 0,
		primaryIndex = 0
	): Record<string, number> {
		const map: Record<string, number> = {};
		if (!Array.isArray(segments) || segments.length === 0) return map;
		for (let i = 0; i < segments.length; i++) {
			const name = String(segments[i].name);
			map[name] = (i === primaryIndex) ? Number(primaryDb) : Number(defaultForOthers);
		}
		return map;
	}

	/**
	 * ensureLwMapDefaults
	 * - Rellena un LwMap existente para que tenga entradas para todos los segmentos.
	 * - No sobrescribe entradas ya presentes a menos que overwrite === true.
	 * - Útil cuando la UI inicializa sliders con valores distintos y quieres forzar los defaults.
	 */
	static ensureLwMapDefaults(
		lwMap: Record<string, number> | null | undefined,
		segments: { name: string }[],
		primaryDb = 100,
		defaultForOthers = 0,
		primaryIndex = 0,
		overwrite = false
	): Record<string, number> {
		const map: Record<string, number> = lwMap ? { ...lwMap } : {};
		for (let i = 0; i < segments.length; i++) {
			const name = String(segments[i].name);
			if (!Object.prototype.hasOwnProperty.call(map, name) || overwrite) {
				map[name] = (i === primaryIndex) ? Number(primaryDb) : Number(defaultForOthers);
			}
		}
		return map;
	}

	/**
	 * getSegmentWidth / extractFacadeWidth
	 * Calcula el ancho (longitud en metros) de una fachada (segmento) en el plano XZ.
	 * Acepta:
	 *  - un objeto segmento { p1: [x,z], p2: [x,z] }
	 *  - o dos puntos separados (p1, p2) como argumentos.
	 * Retorna la distancia euclidiana entre p1 y p2 (número positivo).
	 */
	static getSegmentWidth(segmentOrP1: { p1: [number, number]; p2: [number, number] } | [number, number], maybeP2?: [number, number]) {
		let p1: [number, number], p2: [number, number];
		if (Array.isArray(segmentOrP1) && maybeP2 && Array.isArray(maybeP2)) {
			p1 = segmentOrP1 as [number, number];
			p2 = maybeP2;
		} else if ((segmentOrP1 as any).p1 && (segmentOrP1 as any).p2) {
			p1 = (segmentOrP1 as any).p1;
			p2 = (segmentOrP1 as any).p2;
		} else {
			return 0;
		}
		const dx = p2[0] - p1[0];
		const dz = p2[1] - p1[1];
		return Math.hypot(dx, dz);
	}
}
