/**
 * GaussianSmoother: Aplica suavizado gaussiano a una matriz 2D.
 */
export default class GaussianSmoother {
  /**
   * Crea un kernel gaussiano 2D.
   * @param size Tamaño del kernel (se fuerza impar).
   * @param sigma Desviación estándar.
   */
  static createKernel(size: number, sigma: number): number[][] {
    const kIn = Math.max(1, Math.floor(size));
    const k = (kIn % 2 === 0) ? kIn + 1 : kIn; // force odd
    const s = Math.max(0.0001, sigma);
    const half = Math.floor(k / 2);
    const kernel: number[][] = [];
    let sum = 0;
    for (let y = -half; y <= half; y++) {
      const row: number[] = [];
      for (let x = -half; x <= half; x++) {
        const v = Math.exp(-(x * x + y * y) / (2 * s * s));
        row.push(v);
        sum += v;
      }
      kernel.push(row);
    }
    // Normalizar
    for (let y = 0; y < kernel.length; y++)
      for (let x = 0; x < kernel[y].length; x++)
        kernel[y][x] /= sum;
    return kernel;
  }

  /**
   * Aplica el kernel gaussiano a una matriz 2D.
   * Ignora celdas no finitas (NaN / Infinity / -Infinity) al acumular,
   * y normaliza por la suma de pesos válidos para evitar introducción de -Infinity/NaN.
   * @param data Matriz de entrada [rows][cols].
   * @param size Tamaño del kernel.
   * @param sigma Desviación estándar.
   */
  static apply(data: number[][], size: number, sigma: number): number[][] {
    const h = data.length;
    if (!h) return [];
    const w = data[0].length;
    const kernel = GaussianSmoother.createKernel(size, sigma);
    const kh = kernel.length, kw = kernel[0].length;
    const halfH = Math.floor(kh / 2), halfW = Math.floor(kw / 2);
    // Use NaN as mask marker (Plotly and JSON handle null/NaN better than -Infinity)
    const out: number[][] = Array.from({ length: h }, () => new Array(w).fill(NaN));

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const centerVal = data[y][x];
        // If center is explicitly marked as invalid, keep marker (do not attempt to smooth inside)
        if (!Number.isFinite(centerVal)) {
          out[y][x] = NaN;
          continue;
        }
        let sum = 0;
        let sumK = 0;
        for (let j = 0; j < kh; j++) {
          const yy = y + j - halfH;
          if (yy < 0 || yy >= h) continue;
          for (let i = 0; i < kw; i++) {
            const xx = x + i - halfW;
            if (xx < 0 || xx >= w) continue;
            const neighborVal = data[yy][xx];
            // IGNORAR vecinos no finitos (p. ej. NaN usados como máscara)
            if (!Number.isFinite(neighborVal)) continue;
            const k = kernel[j][i];
            sum += neighborVal * k;
            sumK += k;
          }
        }
        out[y][x] = sumK > 0 ? (sum / sumK) : centerVal; // si no hay vecinos válidos, conservar valor central
      }
    }
    return out;
  }
}
