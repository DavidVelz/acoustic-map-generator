export type Source = { x: number; z: number; nx: number; nz: number; Lw: number };

/**
 * WaveEmitter: genera sources muestreadas sobre el perímetro (polyLoop)
 * y asigna Lw por cercanía a los segmentos "main".
 */
export default class WaveEmitter {
  static generateSources(
    polyLoop: number[][],
    mainSegments: { name: string; p1: number[]; p2: number[] }[],
    sampleSpacing = 0.5,
    outwardOffset = 0.05,
    lwMap?: Record<string, number> // new: { north, south, east, west } OR { segment-0, segment-1, ... }
  ): Source[] {
    if (!polyLoop || !polyLoop.length) return [];
    const center = polyLoop.reduce((acc, [x, z]) => [acc[0] + x / polyLoop.length, acc[1] + z / polyLoop.length], [0, 0]);

    const sources: Source[] = [];
    for (let k = 0; k < polyLoop.length; k++) {
      const a = polyLoop[k];
      const b = polyLoop[(k + 1) % polyLoop.length];
      const vx = b[0] - a[0], vz = b[1] - a[1];
      const lenEdge = Math.hypot(vx, vz) || 1;
      const ux = vx / lenEdge, uz = vz / lenEdge;
      let nx = -uz, nz = ux;
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
      if ((mx - center[0]) * nx + (mz - center[1]) * nz < 0) { nx = -nx; nz = -nz; }

      let lwForEdge = 50;
      if (lwMap) {
        // Try to find matching segment from mainSegments
        const segmentName = mainSegments && mainSegments[k] ? mainSegments[k].name : `segment-${k}`;
        if ((lwMap as any)[segmentName] !== undefined) {
          lwForEdge = Number((lwMap as any)[segmentName]) || lwForEdge;
        }
      }

      const samples = Math.max(1, Math.ceil(lenEdge / sampleSpacing));
      for (let sIdx = 0; sIdx <= samples; sIdx++) {
        const t = sIdx / samples;
        const sx = a[0] + ux * lenEdge * t + nx * outwardOffset;
        const sz = a[1] + uz * lenEdge * t + nz * outwardOffset;
        sources.push({ x: sx, z: sz, nx, nz, Lw: lwForEdge });
      }
    }
    return sources;
  }
}
