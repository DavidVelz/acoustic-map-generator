import WaveEmitter, { Source } from "./WaveEmitter";
import Attenuation, { AttenuationOptions } from "./Attenuation";
import GaussianSmoother from "./GaussianSmoother";
import { applyColorAttenuation } from "./ColorMap";
import ISOModel from "../lib/ISOModel";
import { buildAllFacades } from "./FacadeUtils";
import { defaultParams } from "../config";
import { generateSegmentBandEnergy, pointInPolygon } from "./GradientFactory";

// Helper function for edge tapering
function edgeTaperWeight(pos: number, segLen: number, taper: number = 0.25): number {
  // pos: position along segment (meters), segLen: total segment length (meters), taper: fraction of length to taper at each end
  if (segLen <= 0) return 1;
  const taperLen = Math.max(0, Math.min(segLen * taper, segLen / 2));
  if (taperLen === 0) return 1;
  if (pos < taperLen) {
    // Start taper
    return pos / taperLen;
  } else if (pos > segLen - taperLen) {
    // End taper
    return (segLen - pos) / taperLen;
  }
  return 1;
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

    // --- Per-facade strong-signal overlay using band-specific gradient generator ---
    const overlayParams = (cfg.params && (cfg.params as any).colorOverlay) || {};
    const globalHotBoost = (overlayParams as any).hotBoost ?? 1.0;

    const h = res, w = res;
    const energyGrid: number[][] = Array.from({ length: h }, () => new Array(w).fill(0));

    const redThreshold = Number(overlayParams.redThreshold ?? 70);

    // Use GradientFactory per segment and per band
    for (const seg of main ?? []) {
      const segName = seg.name;
      const lwValRaw = Number(cfg.Lw?.[segName]);
      const Lw_room = Number.isFinite(lwValRaw) ? lwValRaw : NaN;
      if (!Number.isFinite(Lw_room)) continue;
      const RePrime = RePrimeMap[segName] ?? 30;

      // decide bands
      const bands: ("red"|"yellow"|"green"|"blue")[] = ["blue","green"];
      const yellowT = Number(overlayParams.yellowThreshold ?? 50);
      if (Lw_room >= yellowT) bands.push("yellow");
      if (Lw_room >= redThreshold) bands.push("red");

      for (const band of bands) {
        const bandEnergy = generateSegmentBandEnergy(seg as any, band as any, Lw_room, RePrime, xs, ys, {
          cellSize: cfg.params?.cellSize,
          sourceSpacing: cfg.params?.sourceSpacing,
          redMaxDist: overlayParams.redMaxDist,
          redFalloffScale: overlayParams.redFalloffScale,
          lateralTaper: overlayParams.lateralTaper,
          colorSpread: overlayParams.colorSpread,
          propagation: overlayParams.propagation,
          // nuevos parámetros de calibración
          normalize: (overlayParams && (overlayParams as any).normalize) ?? (cfg.params && (cfg.params as any).normalize) ?? "per_meter",
          redSampleSpacing: (overlayParams && (overlayParams as any).redSampleSpacing) ?? 0.12,
          dotThreshold: (overlayParams && (overlayParams as any).dotThreshold) ?? -0.18,
          poly: cfg.poly ?? null,
          center: { x: centroidX, y: centroidY },
          debugEmit: overlayParams && (overlayParams as any).debugEmit,
          __emitPoints: (overlayParams && (overlayParams as any).__emitPoints) || []
        });
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
          const v = bandEnergy[j][i];
          if (Number.isFinite(v) && v > 0) energyGrid[j][i] += v;
        }
      }
    }

    // convert to dB and continue as before
    const sourceLpGrid: number[][] = energyGrid.map(row => row.map(e => e > 0 ? 10 * Math.log10(e) : NaN));

    // overlay: combine base smoothed (dB) + source-driven (we have energyGrid linear)
    // convert base smoothed (dB) into linear energy and sum with energyGrid, then back to dB
    const combinedEnergy: number[][] = Array.from({ length: h }, (_, j) => new Array(w).fill(0));
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const baseDb = smoothed[j][i];
        const baseEnergy = Number.isFinite(baseDb) ? Math.pow(10, baseDb / 10) : 0;
        const srcEnergy = Number.isFinite(energyGrid[j][i]) ? energyGrid[j][i] : 0;
        combinedEnergy[j][i] = baseEnergy + srcEnergy;
      }
    }
    // convert back to dB grid (NaN when zero)
    let overlay: number[][] = combinedEnergy.map(row => row.map(e => e > 0 ? 10 * Math.log10(e) : NaN));

    // --- END REPLACED ---

    // parameters to make "hot" facades stronger when Lw high
    // const globalHotBoost = (overlayParams as any).hotBoost ?? 1.0; // Removed duplicate declaration

    // Define default values for redRadius and redDecay
    const defaultRedRadius = 2.5;
    const defaultRedDecay = 6.0;
    const lateralSpreadFactor = 0.18;
    const lateralTaper = overlayParams.lateralTaper ?? 0.25;

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

            // Fix: define cellSize from params with fallback
            const cellSize = cfg.params?.cellSize ?? 1;

            // Helper: project point (px, pz) onto segment (ax, az)-(bx, bz)
            function projectOnSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
              const vx = bx - ax, vz = bz - az;
              const wx = px - ax, wz = pz - az;
              const segLen = Math.hypot(vx, vz);
              const len2 = vx * vx + vz * vz;
              const t = len2 > 0 ? (wx * vx + wz * vz) / len2 : 0;
              const tClamped = Math.max(0, Math.min(1, t));
              const closestX = ax + vx * tClamped;
              const closestZ = az + vz * tClamped;
              return {
                segLen,
                tClamped,
                closestX,
                closestZ,
                tFrac: t // unclamped
              };
            }
            
                        const proj = projectOnSegment(px, pz, ax, az, bx, bz);
                        const { segLen, tClamped, closestX, closestZ, tFrac } = proj;
            // Allow larger fractional tolerance around segment ends to blend corners better
            const tFracTol = 0.08; // ~8% tolerance along segment
            if (tFrac < -tFracTol || tFrac > 1 + tFracTol) continue;
            // If projection is slightly outside [0..1] (near a corner), keep contribution but reduce its strength smoothly
            const nearEndBlend = (tFrac < 0 || tFrac > 1) ? Math.max(0.18, 1 - Math.abs(tFrac < 0 ? tFrac : tFrac - 1) / tFracTol) : 1.0;

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
            const lateralSigma = Math.max(cellSize * 0.25, segLen * lateralSpreadFactor);
            let lateralWeight = Math.exp(- (tangentialAbs * tangentialAbs) / (2 * lateralSigma * lateralSigma));
            lateralWeight = Math.pow(lateralWeight, 0.95);
            // along-segment gaussian: favor points close to the middle of the segment so halos span the face
            const centerOffset = Math.abs(tClamped - (segLen * 0.5)); // meters from center
            const alongSigma = Math.max(segLen * 0.25, cellSize * 0.5);
            const alongWeight = Math.exp(- (centerOffset * centerOffset) / (2 * alongSigma * alongSigma));
            // combine lateral + along weights, apply near-end blending to soften corners
            const combinedLateralWeight = Math.max(0.002, lateralWeight * Math.pow(alongWeight, 0.95) * nearEndBlend);

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

    // CAP: ensure final map does not exceed supplied Lw values.
    // If the user set all segment Lw/Lp below a threshold (e.g. <50), no cell should show higher.
    const suppliedLwVals = Object.values(cfg.Lw || {}).map(v => Number(v)).filter(Number.isFinite);
    if (suppliedLwVals.length) {
      const maxSuppliedLw = Math.max(...suppliedLwVals);
      if (Number.isFinite(maxSuppliedLw)) {
        for (let y = 0; y < finalSmooth.length; y++) {
          for (let x = 0; x < finalSmooth[y].length; x++) {
            if (Number.isFinite(finalSmooth[y][x])) {
              finalSmooth[y][x] = Math.min(finalSmooth[y][x], maxSuppliedLw);
            }
          }
        }
      }
    }

    // recompute final min/max after cap
    const flatFinalAfterCap = finalSmooth.flat().filter(v => Number.isFinite(v));
    const finalMinAfter = flatFinalAfterCap.length ? Math.min(...flatFinalAfterCap) : finalMin;
    const finalMaxAfter = flatFinalAfterCap.length ? Math.max(...flatFinalAfterCap) : finalMax;

    // Convert non-finite (NaN) to null so Plotly treats them as missing and respects transparent bg
    const zForPlot = finalSmooth.map(row => row.map(v => Number.isFinite(v) ? v : null));
    return { x: xs, y: ys, z: zForPlot, min: finalMinAfter, max: finalMaxAfter, poly: cfg.poly ?? [] };
  }
}
