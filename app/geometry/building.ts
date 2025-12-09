import * as THREE from "three";

/**
 * Crea una geometría de extrusión cuadrada.
 * @param footprint El tamaño del lado del cuadrado.
 * @param buildingHeight La altura de la extrusión.
 * @returns Una THREE.ExtrudeGeometry.
 */
export function createSquareExtrudeGeometry(footprint: number, buildingHeight: number): THREE.ExtrudeGeometry {
	// Ahora genera un hexágono regular cuyo "diámetro" corresponde a `footprint`.
	const radius = Math.max(0.001, footprint) / 2;
	const sides = 6;
	const points: [number, number][] = [];
	for (let k = 0; k < sides; k++) {
		const ang = (k / sides) * Math.PI * 2;
		points.push([Math.cos(ang) * radius, Math.sin(ang) * radius]);
	}

	const shape = new THREE.Shape();
	shape.moveTo(points[0][0], points[0][1]);
	for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
	shape.closePath();

	const extrudeSettings: THREE.ExtrudeGeometryOptions = {
		steps: 1,
		depth: buildingHeight,
		bevelEnabled: false
	};

	const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
	geometry.userData = { perimeter: points, depth: buildingHeight, shape: "hexagon" };
	return geometry;
}

/**
 * Crea una geometría de extrusión en forma de L.
 * @param footprint El tamaño del bounding box de la forma.
 * @param buildingHeight La altura de la extrusión.
 * @returns Una THREE.ExtrudeGeometry.
 */
export function createLShapeExtrudeGeometry(footprint: number, buildingHeight: number): THREE.ExtrudeGeometry {
	const side = Math.max(0.001, footprint);
	const half = side / 2;

	// legWidth controla el grosor de las "patas" de la L (fracción del footprint)
	const legWidth = Math.max(0.05, side * 0.55);

	// Outer rectangle (full bounding box)
	const outer: [number, number][] = [
		[-half, -half],
		[half, -half],
		[half, half],
		[-half, half],
	];

	// Hole rectangle: elimina la esquina superior-derecha para formar la L
	// La esquina interna comienza a `-half + legWidth` tanto en X como en Y
	const holeX = -half + legWidth;
	const holeY = -half + legWidth;
	const hole: [number, number][] = [
		[holeX, holeY],
		[half, holeY],
		[half, half],
		[holeX, half],
	];

	const shape = new THREE.Shape();
	shape.moveTo(outer[0][0], outer[0][1]);
	for (let i = 1; i < outer.length; i++) shape.lineTo(outer[i][0], outer[i][1]);
	shape.closePath();

	// add hole as a Path so the result is an L (outer minus hole)
	const holePath = new THREE.Path();
	holePath.moveTo(hole[0][0], hole[0][1]);
	for (let i = 1; i < hole.length; i++) holePath.lineTo(hole[i][0], hole[i][1]);
	holePath.closePath();
	shape.holes.push(holePath);

	const extrudeSettings: THREE.ExtrudeGeometryOptions = {
		depth: buildingHeight,
		bevelEnabled: false,
		steps: 1
	};

	const geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
	// Provide the exterior perimeter in userData.perimeter so PerimeterExtractor
	// and other consumers obtain a consistent loop. Keep hole info as well.
	geom.userData = {
		type: "L",
		perimeter: outer, // exterior loop expected by PerimeterExtractor
		hole: hole,
		outer,
		depth: buildingHeight
	};
	return geom;
}

/**
 * Crea una geometría de extrusión en forma de U.
 * @param footprint El tamaño del bounding box de la forma.
 * @param buildingHeight La altura de la extrusión.
 * @returns Una THREE.ExtrudeGeometry.
 */
export function createUShapeExtrudeGeometry(footprint: number, buildingHeight: number): THREE.ExtrudeGeometry {
	const s = footprint / 2;
	const points: [number, number][] = [
		[-s, s],
		[-s, -s],
		[s, -s],
		[s, s],
		[s * 0.5, s],
		[s * 0.5, 0],
		[-s * 0.5, 0],
		[-s * 0.5, s],
	];

	const shape = new THREE.Shape();
	shape.moveTo(points[0][0], points[0][1]);
	for (let i = 1; i < points.length; i++) {
		shape.lineTo(points[i][0], points[i][1]);
	}
	shape.closePath();

	const extrudeSettings = {
		steps: 1,
		depth: buildingHeight,
		bevelEnabled: false,
	};

	const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
	geometry.userData = { perimeter: points, depth: buildingHeight };
	return geometry;
}

/**
 * Crea una geometría de extrusión en forma de "T".
 * footprint: anchura total de la T (m). El "alma" (stem) tendrá 40% de esa anchura por defecto.
 * buildingHeight: altura de la extrusión.
 * stemDepth: profundidad del alma respecto al centro del tramo superior (opcional).
 */
export function createTShapeExtrudeGeometry(footprint: number, buildingHeight: number, stemDepth = 0.5) {
	const w = Math.max(0.001, footprint);
	const half = w / 2;
	const stemWidth = Math.max(0.1, w * 0.4);
	const stemHalf = stemWidth / 2;
	const topHeight = Math.max(0.001, w * 0.25);

	// definir puntos en sentido horario alrededor de la forma de T
	const points: [number, number][] = [
		// barra superior (de izquierda a derecha)
		[-half, topHeight / 2],
		[half, topHeight / 2],
		[half, -topHeight / 2],
		[stemHalf, -topHeight / 2],
		[stemHalf, -half * stemDepth],
		[-stemHalf, -half * stemDepth],
		[-stemHalf, -topHeight / 2],
		[-half, -topHeight / 2]
	];

	const shape = new THREE.Shape();
	shape.moveTo(points[0][0], points[0][1]);
	for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
	shape.closePath();

	const extrudeSettings: THREE.ExtrudeGeometryOptions = { steps: 1, depth: buildingHeight, bevelEnabled: false };
	const geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
	geom.userData = { type: "T", perimeter: points, depth: buildingHeight };
	return geom;
}

/**
 * Crea una geometría de extrusión en forma de cruz/plus.
 * footprint: anchura total del brazo (m). armThickness es grosor del brazo.
 */
export function createCrossExtrudeGeometry(footprint: number, buildingHeight: number, armThickness = 0.3) {
	const w = Math.max(0.001, footprint);
	const half = w / 2;
	const t = Math.max(0.05, armThickness);

	// puntos describen una cruz hueca en contorno simple (forma sólida en contorno)
	const points: [number, number][] = [
		[-t, -half],
		[t, -half],
		[t, -t],
		[half, -t],
		[half, t],
		[t, t],
		[t, half],
		[-t, half],
		[-t, t],
		[-half, t],
		[-half, -t],
		[-t, -t]
	];

	const shape = new THREE.Shape();
	shape.moveTo(points[0][0], points[0][1]);
	for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
	shape.closePath();

	const extrudeSettings: THREE.ExtrudeGeometryOptions = { steps: 1, depth: buildingHeight, bevelEnabled: false };
	const geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
	geom.userData = { type: "cross", perimeter: points, depth: buildingHeight };
	return geom;
}

/**
 * Crea una geometría de extrusión arbitraria a partir de una lista de vértices 2D.
 * vertices: array de [x,z] en orden (si no está ordenado, resultado puede ser incorrecto).
 * buildingHeight: altura de extrusión.
 */
export function createPolygonExtrudeGeometry(vertices: [number, number][], buildingHeight: number) {
	if (!Array.isArray(vertices) || vertices.length < 3) {
		// fallback a un cuadrado pequeño
		return createTShapeExtrudeGeometry(1.0, buildingHeight);
	}

	const shape = new THREE.Shape();
	shape.moveTo(vertices[0][0], vertices[0][1]);
	for (let i = 1; i < vertices.length; i++) shape.lineTo(vertices[i][0], vertices[i][1]);
	shape.closePath();

	const extrudeSettings: THREE.ExtrudeGeometryOptions = { steps: 1, depth: buildingHeight, bevelEnabled: false };
	const geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
	geom.userData = { type: "polygon", perimeter: vertices, depth: buildingHeight };
	return geom;
}
