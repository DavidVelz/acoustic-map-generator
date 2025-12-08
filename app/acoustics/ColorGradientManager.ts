import { pointInPolygon } from "./GradientFactory";

export type ColorGradientOptions = {
  redThreshold?: number;
  yellowThreshold?: number;
  greenThreshold?: number;
  yellowSpread?: number;
  redRadius?: number;
  redDecay?: number;
  overlaySmoothSize?: number;
  overlaySmoothSigma?: number;
  directionalConeAngle?: number;
  lateralSpreadFactor?: number; // NEW: cuánto se extiende lateralmente respecto al segmento
  colorSpread?: { red?: number; yellow?: number; green?: number; blue?: number }; // optional tuning
};

export type Segment = {
  name: string;
  p1: number[];
  p2: number[];
};

export default class ColorGradientManager {
  private opts: Required<ColorGradientOptions>;
  private center?: { x: number; z: number };



  // Compute the shortest distance from point (px, pz) to segment (x1, z1)-(x2, z2)
  private pointToSegmentDist(px: number, pz: number, x1: number, z1: number, x2: number, z2: number): number {
    const dx = x2 - x1;
    const dz = z2 - z1;
    if (dx === 0 && dz === 0) {
      // Segment is a point
      return Math.hypot(px - x1, pz - z1);
    }
    // Project point onto segment, clamp to segment
    const t = ((px - x1) * dx + (pz - z1) * dz) / (dx * dx + dz * dz);
    const tClamped = Math.max(0, Math.min(1, t));
    const closestX = x1 + tClamped * dx;
    const closestZ = z1 + tClamped * dz;
    return Math.hypot(px - closestX, pz - closestZ);
  }

  constructor(options?: ColorGradientOptions) {
    this.opts = {
      redThreshold: options?.redThreshold ?? 60,
      yellowThreshold: options?.yellowThreshold ?? 50,
      greenThreshold: options?.greenThreshold ?? 40,
      yellowSpread: options?.yellowSpread ?? 5.0,
      redRadius: options?.redRadius ?? 2.0,
      redDecay: options?.redDecay ?? 8.0,
      overlaySmoothSize: options?.overlaySmoothSize ?? 5,
      overlaySmoothSigma: options?.overlaySmoothSigma ?? 1.2,
      directionalConeAngle: options?.directionalConeAngle ?? 70,
      lateralSpreadFactor: options?.lateralSpreadFactor ?? 0.25, // fraction of segment length allowed either side (25%)
      colorSpread: options?.colorSpread ?? { red: 1, yellow: 2.8, green: 4, blue: 6 }
    };
  }

  // compute centroid of polygon (simple average of vertices)
  private computeCentroid(poly: number[][]) {
    if (!poly || poly.length === 0) return { x: 0, z: 0 };
    let sx = 0, sz = 0;
    for (const p of poly) { sx += p[0]; sz += p[1]; }
    return { x: sx / poly.length, z: sz / poly.length };
  }

  /**
   * computeGradientValue:
   * - calcula contribución de todos los segmentos en la celda (px,pz)
   * - usa distancia perpendicular pura y una ponderación lateral (gaussiana)
   * - no excluye rigidamente esquinas; reduce huecos por solapamiento
   */
  computeGradientValue(
    px: number,
    pz: number,
    segments: Segment[],
    LwMap: Record<string, number>,
    isInsidePerimeter: boolean
  ): number {
    if (isInsidePerimeter) return -Infinity;

    let maxContribution = -Infinity;

    for (const seg of segments) {
      const lw = LwMap[seg.name];
      if (lw == null || isNaN(lw) || lw <= 0) continue;

      const a = seg.p1, b = seg.p2;

      // 1. Vector tangente del segmento (normalizado)
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const segLen = Math.hypot(dx, dz);
      if (segLen < 1e-6) continue;

      const tx = dx / segLen, tz = dz / segLen; // tangente unitaria

      // 2. Normal perpendicular (rotación 90° CCW del tangente)
      let nx = -tz, nz = tx;

      // 3. Verificar orientación: la normal debe apuntar hacia afuera
      const midX = (a[0] + b[0]) / 2, midZ = (a[1] + b[1]) / 2;
      if (midX * nx + midZ * nz < 0) { nx = -nx; nz = -nz; }

      // 4. Proyectar el punto sobre el eje del segmento (componente paralela)
      const vecX = px - a[0], vecZ = pz - a[1];
      const tParam = (vecX * tx + vecZ * tz); // posición a lo largo del segmento

      // 5. ESTRICTO: solo aplicar si está EXACTAMENTE frente al segmento (sin extensión)
      // Tolerancia mínima para evitar que gradientes crucen esquinas
      const tolerance = segLen * 0.05; // 5% del segmento
      if (tParam < -tolerance || tParam > segLen + tolerance) continue;

      // 6. Calcular punto sobre el segmento más cercano al punto
      const clampedT = Math.max(0, Math.min(segLen, tParam));
      const projX = a[0] + tx * clampedT;
      const projZ = a[1] + tz * clampedT;

      // 7. Vector desde punto proyectado hacia el punto receptor
      const offX = px - projX, offZ = pz - projZ;

      // 8. Distancia perpendicular FIRMADA (proyección sobre normal)
      const perpDist = offX * nx + offZ * nz;

      // 9. Solo aplicar si está hacia afuera (perpDist > 0) y dentro del radio
      if (perpDist <= 0 || perpDist > this.opts.redRadius) continue;

      // 10. NUEVA RESTRICCIÓN: verificar que no estamos cerca de otra fachada
      // (esto evita que el gradiente "envuelva" esquinas)
      let tooCloseToOtherFacade = false;
      for (const otherSeg of segments) {
        if (otherSeg.name === seg.name) continue; // skip mismo segmento
        const oa = otherSeg.p1, ob = otherSeg.p2;
        // distancia al otro segmento
        const distToOther = this.pointToSegmentDist(px, pz, oa[0], oa[1], ob[0], ob[1]);
        // si estamos MUY cerca de otra fachada, no aplicar este gradiente
        if (distToOther < perpDist * 0.3) { // 30% de la distancia perpendicular
          tooCloseToOtherFacade = true;
          break;
        }
      }
      if (tooCloseToOtherFacade) continue;

      // 11. Contribución LINEAL PURA: solo función de perpDist
      const contribution = Math.max(0, lw - this.opts.redDecay * perpDist);

      if (contribution > maxContribution) {
        maxContribution = contribution;
      }
    }

    return maxContribution;
  }

  /**
   * applyGradient:
   * - aplica computeGradientValue a toda la rejilla (xs x ys)
   * - no suaviza acá (se controla desde caller con overlaySmoothSize)
   */
  applyGradient(
    xs: number[],
    ys: number[],
    baseGrid: number[][],
    segments: Segment[],
    LwMap: Record<string, number>,
    polyLoop: number[][]
  ): number[][] {
    // compute and store centroid once so orientation uses polygon center (avoids normal flips)
    this.center = this.computeCentroid(polyLoop);
    const resX = xs.length;
    const resY = ys.length;

    const overlay: number[][] = Array.from({ length: resY }, (_, j) => baseGrid[j].slice());

    for (let j = 0; j < resY; j++) {
      for (let i = 0; i < resX; i++) {
        const px = xs[i], pz = ys[j];
        const isInside = pointInPolygon(px, pz, polyLoop);
        const gradValue = this.computeGradientValue(px, pz, segments, LwMap, isInside);
        // Add logic here if needed, or remove the incomplete 'if' statement
        // Example: overlay[j][i] = gradValue;
        overlay[j][i] = gradValue;
      }
    }
    return overlay;
  }
}