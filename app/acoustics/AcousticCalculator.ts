import WaveEmitter, { Source } from "./WaveEmitter";
import Attenuation, { AttenuationOptions } from "./Attenuation";
import GaussianSmoother from "./GaussianSmoother";
import { applyColorAttenuation } from "./ColorMap";
import ISOModel from "../lib/ISOModel";
import { buildAllFacades } from "./FacadeUtils";
import { defaultParams } from "../config";
import { generateSegmentBandEnergy, pointInPolygon } from "./GradientFactory";

// Función auxiliar para atenuar los extremos de un segmento (taper en los bordes)
// pos: posición a lo largo del segmento (metros), segLen: longitud total del segmento (metros)
// taper: fracción del segmento usada para el taper en cada extremo (valor por defecto 0.25 = 25%)
function edgeTaperWeight(pos: number, segLen: number, taper: number = 0.25): number {
  if (segLen <= 0) return 1;
  const taperLen = Math.max(0, Math.min(segLen * taper, segLen / 2));
  if (taperLen === 0) return 1;
  if (pos < taperLen) {
    // Entrada: rampa desde 0..1
    return pos / taperLen;
  } else if (pos > segLen - taperLen) {
    // Salida: rampa decreciente 1..0
    return (segLen - pos) / taperLen;
  }
  return 1;
}

type ComputeCfg = {
  areaSize: number;
  resolution: number;
  footprint: number;
  poly?: number[][]; // perímetro en planta (array de [x,z])
  main?: { name: string; p1: number[]; p2: number[] }[]; // segmentos/fachadas
  Lw: Record<string, number>; // niveles Lw por segmento
  sources?: Source[];
  params?: {
    preSmoothSize?: number;
    preSmoothSigma?: number;
    finalSmoothSize?: number;
    finalSmoothSigma?: number;
    attenuation?: AttenuationOptions;
    spread?: number;
    colorAttenuationFactor?: number;
    cellSize?: number;       // tamaño de celda en metros (preferible)
    sourceSpacing?: number;  // separación entre emisores en perímetro (m)
    // Opciones relacionadas a ISO (sobrescribir si es necesario)
    Df_room?: number;
    Df_out?: number;
    Rmap?: Record<string, number>; // parámetros R por segmento si están disponibles
    Lp_in_map?: Record<string, number>; // Lp_in por sala para calcular Lw_room si se dispone
    invertNormals?: boolean;
  };
};

/**
 * AcousticCalculator
 *
 * Clase utilitaria (métodos estáticos) para generar un mapa en planta de niveles sonoros (Lp, dB)
 * a partir de:
 *  - lista de fachadas/segmentos (`main`),
 *  - perímetro (`poly`) que define interior/exterior,
 *  - niveles por fachada (`Lw`) y parámetros opcionales en `params`.
 *
 * Resultado:
 *  - { x: number[], y: number[], z: (number|null)[][], min: number, max: number, poly: number[][] }
 *    x,y: ejes de la grilla (metros), z: matriz de niveles en dB (null = celda ausente para Plotly),
 *    min/max: extremos útiles para normalizar la paleta.
 *
 * Notas de diseño y unidades:
 *  - Distancias en metros; niveles en dB. Internamente se suman energías lineales (10^(dB/10)).
 *  - `cellSize` (si se proporciona) fija el tamaño de celda; si no, se usa `resolution` para distribuir celdas.
 *
 * Flujo principal (compute):
 *  1) Construcción de la grilla (xs, ys).
 *  2) Extracción de elementos de fachada (buildAllFacades) y cálculo de pérdidas Re' (ISOModel).
 *  3) Cálculo base Lp_out por celda con ISOModel (usando Lw_room y Re').
 *  4) Suavizados pre/final con GaussianSmoother (si se configuran).
 *  5) Generación de overlay por fachada (bandas: blue/green/yellow/red) mediante generateSegmentBandEnergy.
 *  6) Combinación lineal de energía base + energía por fachadas; conversión a dB.
 *  7) Suavizado visual final y retorno del resultado listo para render.
 *
 * Recomendaciones:
 *  - Para visualización interactiva usar cellSize ~ 0.5..1.0 m y sourceSpacing 0.1..0.5 m.
 *  - Si se necesita mayor fidelidad reducir cellSize y sourceSpacing (a costa de CPU).
 *  - El modelo es aproximado; no sustituye cálculos normativos por bandas de octava/tercio.
 */
export default class AcousticCalculator {
  /**
   * compute(cfg: ComputeCfg)
   *
   * Parámetros resumidos en `cfg`:
   *  - areaSize, resolution: definición del área a muestrear.
   *  - poly?: perímetro en planta (array de [x,z]) para enmascaramiento interior.
   *  - main?: array de segmentos con { name, p1, p2 }.
   *  - Lw: mapa { segmentName: Lw_dB } con niveles por fachada.
   *  - params?: opciones físicas y visuales (ver tipo ComputeCfg).
   *
   * Devuelve: objeto con ejes x,y, matriz z (dB o null), min/max y poly.
   */
  static compute(cfg: ComputeCfg) {
    const area = cfg.areaSize;
    const halfArea = area / 2;
    const xs: number[] = [], ys: number[] = [];
    // Construcción de la grilla: si se proporciona cellSize usamos ese paso; si no, usamos resolution.
    if (cfg.params?.cellSize && cfg.params.cellSize > 0) {
      const step = cfg.params.cellSize;
      const n = Math.max(3, Math.floor(area / step) + 1); // número de muestras por eje
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
    // Construye el mapa de elementos de fachada (se usan para calcular Re' y áreas)
    const facadeMap = buildAllFacades(main as any, (cfg as any).buildingHeight ?? 10, cfg.params?.Rmap);

    // Precalcula Re' (pérdida de fachada) por segmento mediante ISOModel
    const RePrimeMap: Record<string, number> = {};
    for (const seg of main as any) {
      const elems = facadeMap[seg.name] || [];
      RePrimeMap[seg.name] = ISOModel.computeFacadeRePrime(elems);
    }

    // Cálculo del centróide del perímetro (usado como heurística fallback para orientar normales)
    let centroidX = 0, centroidY = 0;
    if (cfg.poly && cfg.poly.length) {
      for (const p of cfg.poly) { centroidX += p[0]; centroidY += p[1]; }
      centroidX /= cfg.poly.length; centroidY /= cfg.poly.length;
    }

    // Cálculo base Lp_out por celda (simplificación ISO)
    const output: number[][] = Array.from({ length: res }, () => new Array(res).fill(NaN));
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const px = xs[i], pz = ys[j];
        // Si el punto está dentro del perímetro, lo marcamos como NaN (no válido / interior)
        if (cfg.poly && cfg.poly.length >= 3) {
          let inside = false;
          for (let a = 0, b = cfg.poly.length - 1; a < cfg.poly.length; b = a++) {
            const xi = cfg.poly[a][0], zi = cfg.poly[a][1];
            const xj = cfg.poly[b][0], zj = cfg.poly[b][1];
            const intersect = ((zi > pz) !== (zj > pz)) && (px < (xj - xi) * (pz - zi) / ((zj - zi) || 1e-12) + xi);
            if (intersect) inside = !inside;
          }
          if (inside) { output[j][i] = NaN; continue; }
        }

        // Buscar el segmento más cercano mediante distancia perpendicular
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

        // Determinar Lw_room: preferencia por cfg.Lw; si no existe usar Lp_in_map para calcular Lw; si no, fallback
        const segName = bestSeg.seg.name;
        let Lw_room = Number(cfg.Lw?.[segName] ?? NaN);
        if (!Number.isFinite(Lw_room) && cfg.params?.Lp_in_map && Number.isFinite(cfg.params.Lp_in_map[segName])) {
          Lw_room = ISOModel.computeLwRoomFromLpIn(cfg.params.Lp_in_map[segName], (facadeMap[segName]?.reduce((s, e) => s + e.area, 0) || 1));
        }
        if (!Number.isFinite(Lw_room)) {
          Lw_room = 60; // valor nominal por defecto si no hay datos
        }

        const RePrime = RePrimeMap[segName] ?? 30;
        const Df_room = cfg.params?.Df_room ?? 1;
        const Df_out = cfg.params?.Df_out ?? 1;
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

    // Suavizados pre y final sobre la grilla base usando GaussianSmoother
    const preSize = cfg.params?.preSmoothSize ?? 0;
    const preSigma = cfg.params?.preSmoothSigma ?? 1.2;
    let smoothed = GaussianSmoother.apply(output, preSize, preSigma);

    const finalSize = cfg.params?.finalSmoothSize ?? 0;
    const finalSigma = cfg.params?.finalSmoothSigma ?? 0.8;
    smoothed = GaussianSmoother.apply(smoothed, finalSize, finalSigma);

    // --- Overlay por fachadas: generación de energía por bandas (blue/green/yellow/red) ---
    const overlayParams = (cfg.params && (cfg.params as any).colorOverlay) || {};
    const globalHotBoost = (overlayParams as any).hotBoost ?? 1.0;

    const h = res, w = res;
    const energyGrid: number[][] = Array.from({ length: h }, () => new Array(w).fill(0));

    const redThreshold = Number(overlayParams.redThreshold ?? 70);

    // Por cada segmento: generar energía por banda y acumular (suma lineal en energía)
    for (const seg of main ?? []) {
      const segName = seg.name;
      const lwValRaw = Number(cfg.Lw?.[segName]);
      const Lw_room = Number.isFinite(lwValRaw) ? lwValRaw : NaN;
      if (!Number.isFinite(Lw_room)) continue;
      const RePrime = RePrimeMap[segName] ?? 30;

      // decidir qué bandas generar para este segmento según Lw_room
      const bands: ("red" | "yellow" | "green" | "blue")[] = ["blue", "green"];
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
          normalize: (overlayParams && (overlayParams as any).normalize) ?? (cfg.params && (cfg.params as any).normalize) ?? "per_meter",
          redSampleSpacing: (overlayParams && (overlayParams as any).redSampleSpacing) ?? 0.12,
          dotThreshold: (overlayParams && (overlayParams as any).dotThreshold) ?? -0.18,
          invertNormals: cfg.params?.invertNormals ?? false,
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

    // convertir energía sumada a dB para la capa de fuentes (opcional uso futuro)
    const sourceLpGrid: number[][] = energyGrid.map(row => row.map(e => e > 0 ? 10 * Math.log10(e) : NaN));

    // Combinar la grilla base suavizada (en dB) con la energía de fuentes (en lineal): convertir base a energía, sumar y volver a dB
    const combinedEnergy: number[][] = Array.from({ length: h }, (_, j) => new Array(w).fill(0));
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const baseDb = smoothed[j][i];
        const baseEnergy = Number.isFinite(baseDb) ? Math.pow(10, baseDb / 10) : 0;
        const srcEnergy = Number.isFinite(energyGrid[j][i]) ? energyGrid[j][i] : 0;
        combinedEnergy[j][i] = baseEnergy + srcEnergy;
      }
    }
    // volver a dB, usando NaN cuando no hay energía
    let overlay: number[][] = combinedEnergy.map(row => row.map(e => e > 0 ? 10 * Math.log10(e) : NaN));

    // --- REEMPLAZADO: ajuste por segmento, normal robusta, suavizados finales y recorte ---

    // parámetros para hacer más "fuertes" las fachadas con Lw alto
    // const globalHotBoost = (overlayParams as any).hotBoost ?? 1.0; // Eliminada declaración duplicada

    // Definir valores por defecto para redRadius y redDecay
    const defaultRedRadius = 2.5;
    const defaultRedDecay = 6.0;
    const lateralSpreadFactor = 0.18;
    const lateralTaper = overlayParams.lateralTaper ?? 0.25;

    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const px = xs[i], pz = ys[j];
        if (cfg.poly && cfg.poly.length && pointInPolygon(px, pz, cfg.poly)) continue; // fuera del perímetro

        let bestValue = overlay[j][i];

        if (cfg.main && cfg.main.length) {
          for (const seg of cfg.main) {
            const lwValRaw = (cfg.Lw as any)[seg.name];
            const lw = Number.isFinite(lwValRaw) ? Number(lwValRaw) : 0;
            if (!(lw > 0)) continue;

            const ax = seg.p1[0], az = seg.p1[1];
            const bx = seg.p2[0], bz = seg.p2[1];

            // Obtener cellSize desde params con fallback
            const cellSize = cfg.params?.cellSize ?? 1;

            // Función auxiliar: proyectar punto (px,pz) sobre el segmento (ax,az)-(bx,bz)
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
                tFrac: t // fracción no recortada
              };
            }

            const proj = projectOnSegment(px, pz, ax, az, bx, bz);
            const { segLen, tClamped, closestX, closestZ, tFrac } = proj;
            // Permitir mayor tolerancia en extremos para suavizar esquinas
            const tFracTol = 0.08; // ~8% de tolerancia a lo largo del segmento
            if (tFrac < -tFracTol || tFrac > 1 + tFracTol) continue;
            // Si la proyección queda ligeramente fuera [0..1], mantener contribución pero suavizarla
            const nearEndBlend = (tFrac < 0 || tFrac > 1) ? Math.max(0.18, 1 - Math.abs(tFrac < 0 ? tFrac : tFrac - 1) / tFracTol) : 1.0;

            // --- REEMPLAZADO: normal robusta hacia el exterior mediante sondas ---
            // tangente unitaria
            const tx = segLen > 1e-9 ? (bx - ax) / segLen : 1;
            const tz = segLen > 1e-9 ? (bz - az) / segLen : 0;
            // normal nominal (rotación de la tangente)
            let nx = -tz, nz = tx;
            // prueba robusta: sondar ambos lados del segmento para detectar interior/exterior
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
            // Si la sonda exterior está dentro y la interior fuera, invertir la normal
            if (outIsInside && !inIsInside) { nx = -nx; nz = -nz; }
            // Si ambas sondas quedan dentro (ambigüedad), usar centroide como heurística
            if (outIsInside && inIsInside && cfg.poly && cfg.poly.length) {
              const vxToCentroid = closestX - centroidX;
              const vzToCentroid = closestZ - centroidY;
              const dotCent = nx * vxToCentroid + nz * vzToCentroid;
              if (dotCent < 0) { nx = -nx; nz = -nz; }
            }
            // Sonda final: si el punto hacia el exterior sigue dentro del polígono, omitimos esta contribución
            const finalProbeX = closestX + nx * probeStep;
            const finalProbeZ = closestZ + nz * probeStep;
            if (cfg.poly && cfg.poly.length && pointInPolygon(finalProbeX, finalProbeZ, cfg.poly)) {
              // Registro de validación de normales (en español)
              console.log(
                `[NORMAL MAL] Segmento: ${seg.name} | Punto: (${closestX.toFixed(2)}, ${closestZ.toFixed(2)}) | Normal: (${nx.toFixed(2)}, ${nz.toFixed(2)}) => MAL ORIENTADA`
              );
              continue;
            } else {
              // Registro de validación de normales (en español)
              console.log(
                `[NORMAL BIEN] Segmento: ${seg.name} | Punto: (${closestX.toFixed(2)}, ${closestZ.toFixed(2)}) | Normal: (${nx.toFixed(2)}, ${nz.toFixed(2)}) => BIEN ORIENTADA`
              );
            }
            // --- FIN normal robusta ---

            const offX = px - closestX, offZ = pz - closestZ;
            const distFront = Math.hypot(offX, offZ);
            const tangentialAbs = Math.abs(offX * tx + offZ * tz);

            // Derivar redRadius y redDecay por segmento (escalado por longitud)
            let redRadius = Math.max(defaultRedRadius, segLen * 0.6);
            let redDecay = defaultRedDecay;
            if ((overlayParams as any).hotSegment === seg.name) {
              redRadius *= 1.6 * globalHotBoost;
              redDecay = Math.max(2.0, redDecay * 0.5);
            }

            // Tolerancia lateral: permitir cierto offset tangencial proporcional a cellSize
            const lateralTol = Math.max(1e-6, (cfg.params?.cellSize ?? 1) * 0.6);
            if (tangentialAbs > Math.max(lateralTol, segLen * 0.6) && distFront > redRadius) continue;

            // Comprobación frontal usando la normal orientada
            const perp = offX * nx + offZ * nz;
            if (perp <= 0) continue;


            if (distFront > redRadius && distFront > (overlayParams?.blueRadius ?? 20)) continue;

            // Peso gaussiano lateral (suavizado a lo ancho del segmento)
            const lateralSigma = Math.max(cellSize * 0.25, segLen * lateralSpreadFactor);
            let lateralWeight = Math.exp(- (tangentialAbs * tangentialAbs) / (2 * lateralSigma * lateralSigma));
            lateralWeight = Math.pow(lateralWeight, 0.95);
            // Peso longitudinal centrado en la mitad del segmento
            const centerOffset = Math.abs(tClamped - (segLen * 0.5)); // metros desde el centro
            const alongSigma = Math.max(segLen * 0.25, cellSize * 0.5);
            const alongWeight = Math.exp(- (centerOffset * centerOffset) / (2 * alongSigma * alongSigma));
            // Combinar pesos y aplicar suavizado en extremos
            const combinedLateralWeight = Math.max(0.002, lateralWeight * Math.pow(alongWeight, 0.95) * nearEndBlend);

            // Cálculo de taper y peso frontal
            const wEdge = edgeTaperWeight(tClamped, segLen, lateralTaper);
            const wFront = Math.max(0, 1 - distFront / Math.max(1e-6, redRadius));

            // Contribución: mezcla entre decaimiento lineal y logarítmico
            const linContrib = Math.max(0, lw - redDecay * distFront);
            const logContrib = lw - 20 * Math.log10(Math.max(distFront, 0.01));
            // Refuerzo según nivel de fuente (fuentes más potentes generan halos más extendidos)
            const sourceBoost = 1 + Math.max(0, (lw - 60) / 40); // ~1..2.5 para lw 60..160
            const baseComb = (0.6 * linContrib + 0.4 * logContrib) * wEdge * wFront * combinedLateralWeight;
            let contribution = baseComb * sourceBoost;
            // Asegurar contribución mínima muy cerca de la fachada
            if (distFront < Math.max(0.1, (cfg.params?.cellSize ?? 1) * 0.5)) {
              contribution = Math.max(contribution, Math.min(lw, lw - redDecay * 0.15));
            }
            // Limitar por el nivel de fuente
            contribution = Math.min(lw, contribution);

            if (contribution > bestValue) bestValue = contribution;
          }
        }

        overlay[j][i] = Math.max(overlay[j][i], bestValue);
      }
    }

    // Aplicar suavizado gaussiano al overlay para generar gradientes concéntricos suaves
    const overlaySmoothSize = Math.max(1, Number(overlayParams.overlaySmoothSize ?? 9));
    const overlaySmoothSigma = Math.max(0.1, Number(overlayParams.overlaySmoothSigma ?? 3.0));
    const smoothedOverlay = GaussianSmoother.apply(overlay.map(row => row.map(v => Number.isFinite(v) ? v : NaN)), overlaySmoothSize, overlaySmoothSigma);

    // Preparar finalSmooth como copia del último suavizado base
    let finalSmooth: number[][] = smoothed.map(row => row.slice());

    // Mezcla: fuera del perímetro usar el overlay suavizado; dentro mantener finalSmooth original
    // mask: true = fuera (área visible)
    const mask: boolean[][] = Array.from({ length: res }, () => new Array(res).fill(false));
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) mask[j][i] = (cfg.poly && cfg.poly.length) ? !pointInPolygon(xs[i], ys[j], cfg.poly) : true;

    finalSmooth = smoothedOverlay.map((row, j) => row.map((val, i) => mask[j][i] ? (Number.isFinite(val) ? val : finalSmooth[j][i]) : finalSmooth[j][i]));

    // Recalcular min/max finales
    const flatFinal = finalSmooth.flat().filter(v => Number.isFinite(v));
    const finalMin = flatFinal.length ? Math.min(...flatFinal) : 0;
    const finalMax = flatFinal.length ? Math.max(...flatFinal) : 0;

    // LÍMITE (CAP): asegurar que el mapa final no exceda los valores Lw suministrados.
    // Si el usuario establece todos los Lw/Lp de los segmentos por debajo de un umbral (p. ej. <50),
    // ninguna celda debe mostrar un valor superior.
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

    // Recalcular min/max después del recorte
    const flatFinalAfterCap = finalSmooth.flat().filter(v => Number.isFinite(v));
    const finalMinAfter = flatFinalAfterCap.length ? Math.min(...flatFinalAfterCap) : finalMin;
    const finalMaxAfter = flatFinalAfterCap.length ? Math.max(...flatFinalAfterCap) : finalMax;

    // Convertir valores no finitos (NaN) a null para que Plotly los trate como transparentes
    const zForPlot = finalSmooth.map(row => row.map(v => Number.isFinite(v) ? v : null));
    return { x: xs, y: ys, z: zForPlot, min: finalMinAfter, max: finalMaxAfter, poly: cfg.poly ?? [] };
  }
}

