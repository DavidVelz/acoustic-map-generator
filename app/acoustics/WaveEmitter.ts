export type Source = { x: number; z: number; nx: number; nz: number; Lw: number };

/**
 * WaveEmitter: genera sources muestreadas sobre el perímetro (polyLoop)
 * y asigna Lw por cercanía a los segmentos "main".
 */
export default class WaveEmitter {
  static generateSources(
    polyLoop: number[][],
    mainSegments: { name: string; p1: number[]; p2: number[] }[],
    sampleSpacing = 0,
    outwardOffset = 0,
    lwMap?: Record<string, number> // new: { north, south, east, west } OR { segment-0, segment-1, ... }
  ): Source[] {
    if ((!polyLoop || !polyLoop.length) && (!mainSegments || !mainSegments.length)) return [];

    // If lwMap not provided, build default: segment-0 = 100 dB, others 0 dB.
    if (!lwMap) {
      lwMap = {};
      const n = (Array.isArray(mainSegments) && mainSegments.length) ? mainSegments.length : (polyLoop ? polyLoop.length : 0);
      for (let i = 0; i < n; i++) {
        lwMap[`segment-${i}`] = (i === 0) ? 100 : 0;
      }
    }
    // Normalize lwMap values to numbers (avoid undefined / non-numeric)
    for (const k of Object.keys(lwMap)) {
      const v = (lwMap as any)[k];
      (lwMap as any)[k] = Number.isFinite(Number(v)) ? Number(v) : 0;
    }

    // compute centroid robustly (from polyLoop if available, else from mainSegments midpoints)
    let center: [number, number] = [0, 0];
    if (polyLoop && polyLoop.length) {
      center = polyLoop.reduce<[number, number]>((acc, [x, z]) => [acc[0] + x, acc[1] + z], [0, 0]);
      center[0] /= polyLoop.length; center[1] /= polyLoop.length;
    } else if (mainSegments && mainSegments.length) {
      let sx = 0, sz = 0, c = 0;
      for (const s of mainSegments) {
        const mx = (s.p1[0] + s.p2[0]) / 2, mz = (s.p1[1] + s.p2[1]) / 2;
        sx += mx; sz += mz; c++;
      }
      if (c) { center = [sx / c, sz / c]; }
    }

    // helper: point-to-segment distance (kept for potential fallback use)
    const pointToSegmentDist = (px: number, pz: number, a: number[], b: number[]) => {
      const x1 = a[0], z1 = a[1], x2 = b[0], z2 = b[1];
      const dx = x2 - x1, dz = z2 - z1;
      if (dx === 0 && dz === 0) return Math.hypot(px - x1, pz - z1);
      const t = ((px - x1) * dx + (pz - z1) * dz) / (dx * dx + dz * dz);
      const tc = Math.max(0, Math.min(1, t));
      const cx = x1 + tc * dx, cz = z1 + tc * dz;
      return Math.hypot(px - cx, pz - cz);
    };

    // helper: find nearest main segment name by midpoint distance to segment
    const findNearestMainSegmentName = (mx: number, mz: number) => {
      if (!mainSegments || !mainSegments.length) return undefined;
      let best = mainSegments[0].name;
      let bestD = Infinity;
      for (const seg of mainSegments) {
        const d = pointToSegmentDist(mx, mz, seg.p1, seg.p2);
        if (d < bestD) { bestD = d; best = seg.name; }
      }
      return best;
    };

    const sources: Source[] = [];

    // If mainSegments provided, treat each facade as the source (sample along each segment)
    if (Array.isArray(mainSegments) && mainSegments.length > 0) {
      for (let k = 0; k < mainSegments.length; k++) {
        const seg = mainSegments[k];
        const a = seg.p1;
        const b = seg.p2;
        const vx = b[0] - a[0], vz = b[1] - a[1];
        const lenEdge = Math.hypot(vx, vz) || 1;
        const ux = vx / lenEdge, uz = vz / lenEdge;

        // compute outward normal using centroid
        let nx = -uz, nz = ux;
        const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
        if ((mx - center[0]) * nx + (mz - center[1]) * nz < 0) { nx = -nx; nz = -nz; }
        const nlen = Math.hypot(nx, nz) || 1;
        nx /= nlen; nz /= nlen;

        // samples along the entire facade segment
        const samples = Math.max(1, Math.ceil(lenEdge / sampleSpacing));
        // Determine Lw for this facade (by segment name)
        let lwForEdge = 0;
        const segmentName = seg.name ?? `segment-${k}`;
        if ((lwMap as any)[segmentName] !== undefined) {
          lwForEdge = Number((lwMap as any)[segmentName]) || lwForEdge;
        } else {
          const absNx = Math.abs(nx), absNz = Math.abs(nz);
          let dirKey = '';
          if (absNx > absNz) dirKey = nx > 0 ? 'east' : 'west'; else dirKey = nz > 0 ? 'north' : 'south';
          if ((lwMap as any)[dirKey] !== undefined) {
            lwForEdge = Number((lwMap as any)[dirKey]) || lwForEdge;
          }
        }

        for (let sIdx = 0; sIdx < samples; sIdx++) {
          const t = (sIdx + 0.5) / samples;
          const sx = a[0] + ux * lenEdge * t + nx * outwardOffset;
          const sz = a[1] + uz * lenEdge * t + nz * outwardOffset;
          sources.push({ x: sx, z: sz, nx, nz, Lw: lwForEdge });
        }
      }
      return sources;
    }

    // Fallback: if no mainSegments provided, sample along the polyLoop edges (previous behavior)
    for (let k = 0; k < polyLoop.length; k++) {
      const a = polyLoop[k];
      const b = polyLoop[(k + 1) % polyLoop.length];
      const vx = b[0] - a[0], vz = b[1] - a[1];
      const lenEdge = Math.hypot(vx, vz) || 1;
      const ux = vx / lenEdge, uz = vz / lenEdge;
      // normal and orientation using centroid
      let nx = -uz, nz = ux;
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
      if ((mx - center[0]) * nx + (mz - center[1]) * nz < 0) { nx = -nx; nz = -nz; }
      // normalize normal (safety)
      const nlen2 = Math.hypot(nx, nz) || 1;
      nx /= nlen2; nz /= nlen2;

      // determine samples count (n subsegments) and sample at subsegment centers to avoid vertex duplicates
      const samples = Math.max(1, Math.ceil(lenEdge / sampleSpacing));
      // Determine Lw for this edge once (by nearest main segment to midpoint)
      let lwForEdge = 0; // default to 0 unless map provides otherwise
      const segmentName = findNearestMainSegmentName(mx, mz) ?? `segment-${k}`;
      if ((lwMap as any)[segmentName] !== undefined) {
        lwForEdge = Number((lwMap as any)[segmentName]) || lwForEdge;
      } else {
        // fallback: try directional keys if present (north/south/east/west) based on normal direction
        const absNx = Math.abs(nx), absNz = Math.abs(nz);
        let dirKey = '';
        if (absNx > absNz) dirKey = nx > 0 ? 'east' : 'west'; else dirKey = nz > 0 ? 'north' : 'south';
        if ((lwMap as any)[dirKey] !== undefined) {
          lwForEdge = Number((lwMap as any)[dirKey]) || lwForEdge;
        }
      }

      for (let sIdx = 0; sIdx < samples; sIdx++) {
        // sample at subsegment center to avoid sampling vertices repeatedly
        const t = (sIdx + 0.5) / samples;
        const sx = a[0] + ux * lenEdge * t + nx * outwardOffset;
        const sz = a[1] + uz * lenEdge * t + nz * outwardOffset;
        sources.push({ x: sx, z: sz, nx, nz, Lw: lwForEdge });
      }
    }
    return sources;
  }
}
