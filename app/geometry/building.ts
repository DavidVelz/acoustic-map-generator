import * as THREE from "three";

/**
 * Crea una geometría de extrusión rectangular (sólida).
 * footprint: ancho total (m). Se genera un rectángulo centrado en el origen.
 */
export function createRectangleExtrudeGeometry(width: number, depth: number, buildingHeight: number): THREE.ExtrudeGeometry {
	const w = Math.max(0.001, width);
	const d = Math.max(0.001, depth);
	const hx = w / 2;
	const hz = d / 2;

	const points: [number, number][] = [
		[-hx, -hz],
		[hx, -hz],
		[hx, hz],
		[-hx, hz]
	];

	const shape = new THREE.Shape();
	shape.moveTo(points[0][0], points[0][1]);
	for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
	shape.closePath();

	const extrudeSettings: THREE.ExtrudeGeometryOptions = { steps: 1, depth: buildingHeight, bevelEnabled: false };
	const geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
	// export perimeter for PerimeterExtractor (outer loop)
	geom.userData = { type: "rect", perimeter: points, depth: buildingHeight };
	return geom;
}
