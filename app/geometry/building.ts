import * as THREE from "three";

/**
 * Crea una geometría de extrusión cuadrada.
 * @param footprint El tamaño del lado del cuadrado.
 * @param buildingHeight La altura de la extrusión.
 * @returns Una THREE.ExtrudeGeometry.
 */
export function createSquareExtrudeGeometry(footprint: number, buildingHeight: number): THREE.ExtrudeGeometry {
  const s = footprint / 2;
  const points: [number, number][] = [
    [-s, -s],
    [s, -s],
    [s, s],
    [-s, s],
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
 * Crea una geometría de extrusión en forma de L.
 * @param footprint El tamaño del bounding box de la forma.
 * @param buildingHeight La altura de la extrusión.
 * @returns Una THREE.ExtrudeGeometry.
 */
export function createLShapeExtrudeGeometry(footprint: number, buildingHeight: number): THREE.ExtrudeGeometry {
  const side = Math.max(0.001, footprint);
  const half = side / 2;

  const shape = new THREE.Shape();
  shape.moveTo(-half, -half);
  shape.lineTo(half, -half);
  shape.lineTo(half, half);
  shape.lineTo(-half, half);
  shape.closePath();

  const extrudeSettings: THREE.ExtrudeGeometryOptions = {
    depth: buildingHeight,
    bevelEnabled: false,
    curveSegments: 8,
    steps: 1,
  };

  const geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  // mover el eje para que la base esté en y=0 y la altura se eleve en +Y si es necesario
  geom.translate(0, 0, 0); // mantener centrado; page.tsx posiciona el mesh después
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
