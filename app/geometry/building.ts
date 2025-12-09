import * as THREE from "three";

/**
 * Crea una geometría de extrusión cuadrada.
 * @param footprint El tamaño del lado del cuadrado.
 * @param buildingHeight La altura de la extrusión.
 * @returns Una THREE.ExtrudeGeometry.
 */
export function createSquareExtrudeGeometry(footprint: number, buildingHeight: number): THREE.ExtrudeGeometry {
	// Reuse the L-shape generator so callers of createSquareExtrudeGeometry get an "L".
	// This keeps perimeter/userData consistent for PerimeterExtractor.
	return createLShapeExtrudeGeometry(footprint, buildingHeight);
}

/**
 * Crea una geometría de extrusión en forma de L.
 * @param footprint El tamaño del bounding box de la forma.
 * @param buildingHeight La altura de la extrusión.
 * @returns Una THREE.ExtrudeGeometry.
 */
export function createLShapeExtrudeGeometry(footprint: number, buildingHeight: number): THREE.ExtrudeGeometry {
	// footprint: tamaño del bounding box total de la L
	const side = Math.max(0.001, footprint);
	const half = side / 2;

	// legWidth controla el grosor de las "patas" de la L (fracción del footprint)
	// ajustable para obtener diferentes proporciones de la L
	const legFraction = 0.45; // 45% por defecto
	const legWidth = Math.max(0.05, side * legFraction);

	// Construir una única polilínea concava que describe la L sólida (no usar hole)
	// Orden CCW alrededor del contorno de la L:
	//  P0: bottom-left
	//  P1: bottom-right
	//  P2: right, un poco arriba (define grosor horizontal)
	//  P3: inner corner (donde se une la pata vertical)
	//  P4: up to top along inner x
	//  P5: top-left
	const pts: [number, number][] = [
		[-half, -half],                       // P0
		[ half, -half],                       // P1
		[ half, -half + legWidth],            // P2
		[-half + legWidth, -half + legWidth], // P3 (inner corner)
		[-half + legWidth,  half],            // P4
		[-half,  half]                        // P5
	];

	const shape = new THREE.Shape();
	shape.moveTo(pts[0][0], pts[0][1]);
	for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
	shape.closePath();

	const extrudeSettings: THREE.ExtrudeGeometryOptions = {
		depth: buildingHeight,
		bevelEnabled: false,
		steps: 1
	};

	const geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);

	// Proveer perimeter esperado por PerimeterExtractor (la ruta exterior concava)
	geom.userData = {
		type: "L",
		perimeter: pts,
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
		// fallback: devolver una L para consistencia (usar createLShapeExtrudeGeometry)
		return createLShapeExtrudeGeometry(1.0, buildingHeight);
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
