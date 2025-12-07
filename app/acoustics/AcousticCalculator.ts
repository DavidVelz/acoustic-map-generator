import WaveEmitter, { Source } from "./WaveEmitter";
import Attenuation, { AttenuationOptions } from "./Attenuation";
import GaussianSmoother from "./GaussianSmoother";
import { applyColorAttenuation } from "./ColorMap";
import ISOModel from "../lib/ISOModel";
import { buildAllFacades } from "./FacadeUtils";

// Simple point-in-polygon test (ray casting algorithm)
function pointInPolygon(x: number, y: number, poly: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

type ComputeCfg = {
  areaSize: number;
  resolution: number;
  footprint: number;
  poly?: number[][];
  main?: { name: string; p1: number[]; p2: number[] }[];
  Lw: Record<string, number>;
  sources?: Source[];
  params?: {
    preSmoothSize?: number;
    preSmoothSigma?: number;
    finalSmoothSize?: number;
    finalSmoothSigma?: number;
    attenuation?: AttenuationOptions;
    spread?: number;
    colorAttenuationFactor?: number;
    cellSize?: number;       // meters per grid cell (preferred)
    sourceSpacing?: number;  // spacing for perimeter sources (m)
    // ISO-related optional overrides
    Df_room?: number;
    Df_out?: number;
    Rmap?: Record<string, number>; // R per segment if available
    Lp_in_map?: Record<string, number>; // optional Lp_in by room to compute Lw_room
  };
};

export default class AcousticCalculator {
  // (now GaussianSmoother provides kernel & convolution helpers)

  // core compute method (refactor de computeLpGrid)
  static compute(cfg: ComputeCfg) {
    const area = cfg.areaSize;
    const halfArea = area / 2;
    const xs: number[] = [], ys: number[] = [];
    // grid
    if (cfg.params?.cellSize && cfg.params.cellSize > 0) {
      const step = cfg.params.cellSize;
      const n = Math.max(3, Math.floor(area / step) + 1); // number of samples along axis
      for (let i = 0; i < n; i++) {
        xs.push(-halfArea + i * step);
        ys.push(-halfArea + i * step);
      }
    } else {
      const resArg = Math.max(3, Math.floor(cfg.resolution));
      for (let i = 0; i < resArg; i++) {
        xs.push(-halfArea + (i / (resArg - 1)) * area);
        ys.push(-halfArea + (i / (resArg - 1)) * area);
      }
    }
    const res = xs.length;

    const main = cfg.main ?? [];
    // build facade elements map
    const facadeMap = buildAllFacades(main as any, (cfg as any).buildingHeight ?? 10, cfg.params?.Rmap);

    // precompute Re' per facade
    const RePrimeMap: Record<string, number> = {};
    for (const seg of main as any) {
      const elems = facadeMap[seg.name] || [];
      RePrimeMap[seg.name] = ISOModel.computeFacadeRePrime(elems);
    }

    // compute centroid of perimeter (used previously; kept for fallback)
    let centroidX = 0, centroidY = 0;
    if (cfg.poly && cfg.poly.length) {
      for (const p of cfg.poly) { centroidX += p[0]; centroidY += p[1]; }
      centroidX /= cfg.poly.length; centroidY /= cfg.poly.length;
    }

    // compute Lp_out per grid cell using ISO simplified formula:
    // use NaN as mask marker for arrays, but overlay baseline uses -Infinity for comparisons
    const output: number[][] = Array.from({ length: res }, () => new Array(res).fill(NaN));
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const px = xs[i], pz = ys[j];
        // skip if inside perimeter polygon
        if (cfg.poly && cfg.poly.length >= 3) {
          // simple point-in-polygon test
          let inside = false;
          for (let a = 0, b = cfg.poly.length - 1; a < cfg.poly.length; b = a++) {
            const xi = cfg.poly[a][0], zi = cfg.poly[a][1];
            const xj = cfg.poly[b][0], zj = cfg.poly[b][1];
            const intersect = ((zi > pz) !== (zj > pz)) && (px < (xj - xi) * (pz - zi) / ((zj - zi) || 1e-12) + xi);
            if (intersect) inside = !inside;
          }
          if (inside) { output[j][i] = NaN; continue; }
        }

        // find nearest segment (by perpendicular distance)
        let bestSeg: any = null, bestDist = Infinity;
        for (const seg of main as any) {
          const ax = seg.p1[0], az = seg.p1[1];
          const bx = seg.p2[0], bz = seg.p2[1];
          const vx = bx - ax, vz = bz - az;
          const wx = px - ax, wz = pz - az;
          const len2 = vx * vx + vz * vz;
          const t = len2 > 0 ? Math.max(0, Math.min(1, (wx * vx + wz * vz) / len2)) : 0;
          const cx = ax + vx * t, cz = az + vz * t;
          const d = Math.hypot(px - cx, pz - cz);
          if (d < bestDist) { bestDist = d; bestSeg = { seg, cx, cz, t }; }
        }
        if (!bestSeg) { output[j][i] = NaN; continue; }

        // Lw_room: prefer cfg.Lw for the segment (user-provided level of power); fallback: try Lp_in_map -> compute Lw_room
        const segName = bestSeg.seg.name;
        let Lw_room = Number(cfg.Lw?.[segName] ?? NaN);
        if (!Number.isFinite(Lw_room) && cfg.params?.Lp_in_map && Number.isFinite(cfg.params.Lp_in_map[segName])) {
          Lw_room = ISOModel.computeLwRoomFromLpIn(cfg.params.Lp_in_map[segName], (facadeMap[segName]?.reduce((s,e)=>s+e.area,0)||1));
        }
        if (!Number.isFinite(Lw_room)) {
          // fallback nominal
          Lw_room = 60;
        }

        const RePrime = RePrimeMap[segName] ?? 30;
        const Df_room = cfg.params?.Df_room ?? 1; // Default value or fallback
        const Df_out = cfg.params?.Df_out ?? 1;   // Default value or fallback
        const lpOut = ISOModel.computeLpOutAtPoint({
          Lw_room,
          RePrime,
          Df_room,
          Df_out,
          distanceM: Math.max(0.01, bestDist),
          atmospheric: 0
        });
        output[j][i] = lpOut;
      }
    }

    // smoothing pipeline (pre/final) using GaussianSmoother
    const preSize = cfg.params?.preSmoothSize ?? 3;
    const preSigma = cfg.params?.preSmoothSigma ?? 1.2;
    let smoothed = GaussianSmoother.apply(output, preSize, preSigma);

    const finalSize = cfg.params?.finalSmoothSize ?? 3;
    const finalSigma = cfg.params?.finalSmoothSigma ?? 0.8;
    smoothed = GaussianSmoother.apply(smoothed, finalSize, finalSigma);

    // --- Per-facade strong-signal overlay using centralized params ---
    const overlayParams = (cfg.params && (cfg.params as any).colorOverlay) || {};
    const defaultRedRadius = Number(overlayParams.redRadius ?? 15.0);
    const defaultRedDecay = Number(overlayParams.redDecay ?? 12.0);
    const lateralTaper = Number((overlayParams as any).lateralTaper ?? 0.25);
    // control de difusión a lo largo del segmento (fracción del segLen)
    const lateralSpreadFactor = Number((overlayParams as any).lateralSpreadFactor ?? 0.8);

    // helper: project point onto a segment and return t (meters), closest coords and segLen
    const projectOnSegment = (px: number, pz: number, ax: number, az: number, bx: number, bz: number) => {
      const vx = bx - ax, vz = bz - az;
      const segLen = Math.hypot(vx, vz);
      if (segLen <= 1e-9) return { segLen: 0, tParam: 0, tClamped: 0, closestX: ax, closestZ: az };
      const wx = px - ax, wz = pz - az;
      const tRaw = (wx * vx + wz * vz) / (segLen * segLen);
      const tClampedFrac = Math.max(0, Math.min(1, tRaw));
      const closestX = ax + vx * tClampedFrac;
      const closestZ = az + vz * tClampedFrac;
      const tParam = tRaw * segLen;
      const tClamped = tClampedFrac * segLen;
      return { segLen, tParam, tClamped, closestX, closestZ };
    };

    // edge taper
    const edgeTaperWeight = (tClamped: number, segLen: number, lateralTaperVal: number) => {
      if (segLen <= 0) return 0;
      const atStart = tClamped / Math.max(1e-6, segLen);
      const atEnd = (segLen - tClamped) / Math.max(1e-6, segLen);
      const raw = Math.min(atStart, atEnd);
      if (lateralTaperVal <= 1e-6) return raw > 0.15 ? 1 : 0;
      return Math.pow(Math.max(0, Math.min(1, raw * 2)), 1 + 2 * lateralTaperVal);
    };

    // overlay baseline: copy smoothed but replace non-finite with -Infinity for comparison logic
    let overlay: number[][] = smoothed.map(row => row.map(v => Number.isFinite(v) ? v : -Infinity));

    // parameters to make "hot" facades stronger when Lw high
    const globalHotBoost = (overlayParams as any).hotBoost ?? 1.0;

    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const px = xs[i], pz = ys[j];
        if (cfg.poly && cfg.poly.length && pointInPolygon(px, pz, cfg.poly)) continue; // outside only

        let bestValue = overlay[j][i];

        if (cfg.main && cfg.main.length) {
          for (const seg of cfg.main) {
            const lwValRaw = (cfg.Lw as any)[seg.name];
            const lw = Number.isFinite(lwValRaw) ? Number(lwValRaw) : 0;
            if (!(lw > 0)) continue;

            const ax = seg.p1[0], az = seg.p1[1];
            const bx = seg.p2[0], bz = seg.p2[1];

            const proj = projectOnSegment(px, pz, ax, az, bx, bz);
            const { segLen, tClamped, closestX, closestZ } = proj;

            // --- REPLACED: robust outward-normal & probe (was centroid-based) ---
            // tangent unit
            const tx = segLen > 1e-9 ? (bx - ax) / segLen : 1;
            const tz = segLen > 1e-9 ? (bz - az) / segLen : 0;
            // nominal normal (rotate tangent)
            let nx = -tz, nz = tx;
            // robust test: probe a small step on both sides of the facade to detect interior side
            const probeStep = Math.max(0.05, (cfg.params?.cellSize ?? 1) * 0.35);
            const testOutX = closestX + nx * probeStep;
            const testOutZ = closestZ + nz * probeStep;
            const testInX = closestX - nx * probeStep;
            const testInZ = closestZ - nz * probeStep;
            let outIsInside = false, inIsInside = false;
            if (cfg.poly && cfg.poly.length) {
              outIsInside = pointInPolygon(testOutX, testOutZ, cfg.poly);
              inIsInside = pointInPolygon(testInX, testInZ, cfg.poly);
            }
            // If OUT probe is inside and IN is outside, flip normal so OUT points outward
            if (outIsInside && !inIsInside) { nx = -nx; nz = -nz; }
            // If both probes are inside (ambiguous for concave/holes), fall back to centroid test
            if (outIsInside && inIsInside && cfg.poly && cfg.poly.length) {
              const vxToCentroid = closestX - centroidX;
              const vzToCentroid = closestZ - centroidY;
              const dotCent = nx * vxToCentroid + nz * vzToCentroid;
              if (dotCent < 0) { nx = -nx; nz = -nz; }
            }
            // Final probe: if the outward probe (closest + normal) STILL lies inside polygon, skip this facade contribution
            const finalProbeX = closestX + nx * probeStep;
            const finalProbeZ = closestZ + nz * probeStep;
            if (cfg.poly && cfg.poly.length && pointInPolygon(finalProbeX, finalProbeZ, cfg.poly)) continue;
            // --- END REPLACED ---

            const offX = px - closestX, offZ = pz - closestZ;
            const distFront = Math.hypot(offX, offZ);
            const tangentialAbs = Math.abs(offX * tx + offZ * tz);

            // derive per-segment redRadius and decay; scale with segment length so narrow segments don't overreach
            let redRadius = Math.max(defaultRedRadius, segLen * 0.6);
            let redDecay = defaultRedDecay;
            if ((overlayParams as any).hotSegment === seg.name) {
              redRadius *= 1.6 * globalHotBoost;
              redDecay = Math.max(2.0, redDecay * 0.5);
            }

            // lateral tolerance: allow some tangential offset proportional to cellSize
            const lateralTol = Math.max(1e-6, (cfg.params?.cellSize ?? 1) * 0.6);
            if (tangentialAbs > Math.max(lateralTol, segLen * 0.6) && distFront > redRadius) continue;

            // frontal check using oriented normal
            const perp = offX * nx + offZ * nz;
            if (perp <= 0) continue;

            if (distFront > redRadius && distFront > (overlayParams?.blueRadius ?? 20)) continue;

            // lateral gaussian weight (allows smooth falloff across the segment width)
            const lateralSigma = Math.max((cfg.params?.cellSize ?? 1) * 0.5, segLen * lateralSpreadFactor);
            // tangentialAbs = distancia a lo largo del segmento desde el punto más cercano
            let lateralWeight = Math.exp(- (tangentialAbs * tangentialAbs) / (2 * lateralSigma * lateralSigma));
            // ENSANCHAR: aplicar exponente < 1 para hacer la campana más ancha (más cobertura lateral)
            lateralWeight = Math.pow(lateralWeight, 0.6);
            // evitar que sea demasiado pequeño: establecer umbral mínimo
            const combinedLateralWeight = Math.max(0.08, lateralWeight);

            // compute taper and frontal weight
            const wEdge = edgeTaperWeight(tClamped, segLen, lateralTaper);
            const wFront = Math.max(0, 1 - distFront / Math.max(1e-6, redRadius));

            // contribution: prefer linear decay from Lw (strong visual red) but mix with inverse-distance log
            const linContrib = Math.max(0, lw - redDecay * distFront);
            const logContrib = lw - 20 * Math.log10(Math.max(distFront, 0.01));
            // añadir refuerzo según nivel de fuente (fuentes más potentes "empujan" más color)
            const sourceBoost = 1 + Math.max(0, (lw - 60) / 40); // ~1..2.5 para lw 60..160
            const baseComb = (0.6 * linContrib + 0.4 * logContrib) * wEdge * wFront * combinedLateralWeight;
            let contribution = baseComb * sourceBoost;
            // asegurar que muy cerca de la fachada la contribución no quede por debajo de un valor razonable
            if (distFront < Math.max(0.1, (cfg.params?.cellSize ?? 1) * 0.5)) {
              contribution = Math.max(contribution, Math.min(lw, lw - redDecay * 0.15));
            }
            // clamp al nivel source
            contribution = Math.min(lw, contribution);

            if (contribution > bestValue) bestValue = contribution;
          }
        }

        overlay[j][i] = Math.max(overlay[j][i], bestValue);
      }
    }

    // Apply Gaussian smoothing to the overlay to create smooth concentric gradients
    const overlaySmoothSize = Math.max(1, Number(overlayParams.overlaySmoothSize ?? 9));
    const overlaySmoothSigma = Math.max(0.1, Number(overlayParams.overlaySmoothSigma ?? 3.0));
    const smoothedOverlay = GaussianSmoother.apply(overlay.map(row => row.map(v => Number.isFinite(v) ? v : NaN)), overlaySmoothSize, overlaySmoothSigma);

    // Prepare finalSmooth as a copy of the last smoothed grid
    let finalSmooth: number[][] = smoothed.map(row => row.slice());

    // Blend: outside perimeter use smoothed overlay, inside keep original finalSmooth
    // mask: true = outside
    const mask: boolean[][] = Array.from({ length: res }, () => new Array(res).fill(false));
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) mask[j][i] = (cfg.poly && cfg.poly.length) ? !pointInPolygon(xs[i], ys[j], cfg.poly) : true;

    finalSmooth = smoothedOverlay.map((row, j) => row.map((val, i) => mask[j][i] ? (Number.isFinite(val) ? val : finalSmooth[j][i]) : finalSmooth[j][i]));

    // recompute final min/max
    const flatFinal = finalSmooth.flat().filter(v => Number.isFinite(v));
    const finalMin = flatFinal.length ? Math.min(...flatFinal) : 0;
    const finalMax = flatFinal.length ? Math.max(...flatFinal) : 0;

    // Convert non-finite (NaN) to null so Plotly treats them as missing and respects transparent bg
    const zForPlot = finalSmooth.map(row => row.map(v => Number.isFinite(v) ? v : null));
    return { x: xs, y: ys, z: zForPlot, min: finalMin, max: finalMax, poly: cfg.poly ?? [] };
  }
}
