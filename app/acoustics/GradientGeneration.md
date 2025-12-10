# Documentación: generación de gradientes / heatmap acústico (detalle paso a paso)

Este documento describe con detalle el flujo completo —desde las entradas hasta el tooltip— de cómo se generan los gradientes/halos sobre la planta utilizando las funciones del módulo `app/acoustics`. Toda la explicación está en español y usa las mismas variables / nombres de función que el código.

---

## 1) Resumen general (alto nivel)
Entrada principal:
- Geometría perímetro (`finalLoop`) y segmentos de fachada (extraídos por `PerimeterExtractor`).
- Mapa de niveles por fachada `Lw` (por segmento) — normalmente `building.LwBySegment`.
- Parámetros visuales y físicos (`params`, `colorOverlay`, `cellSize`, `sourceSpacing`, etc).

Salida:
- Matrices `x[]`, `y[]` (coordenadas de la grilla) y `z[row][col]` en dB (niveles Lp).
- Matriz `hover[row][col]` con texto HTML para tooltip (distancia a fachada, Lp, potencia relativa).

Punto de entrada en el front-end:
- Hook `useHeatmap` arma la grilla y llama a `generateRedHeatmapFromFacade` (en ColorMap.ts) para construir `zmat` (mapa en dB). `useHeatmap` además construye la matriz `hover`.

---

## 2) Flujo paso a paso (cómo se invoca y qué hace cada paso)

1. `useHeatmap(config, building, params, finalLoop, lShapeMesh, refreshKey)`  
   - Construye `gridX` / `gridY` (centros de celda) en m.  
     - `res = config.resolution` (número de celdas por eje).  
     - `area = config.areaSize`.  
     - `dx = area / res`, y `gridX[i] = -area/2 + dx*(i+0.5)`.  
   - Extrae los segmentos de fachada:
     - `const segments = PerimeterExtractor.extractFacadesSegments(lShapeMesh)` -> lista de objetos `{ name, p1: [x,z], p2: [x,z] }`.
   - Construye `lwMap`: `{ "segment-0": Lw0, "segment-1": Lw1, ... }` desde `building.LwBySegment`.
   - Prepara `opts` (sampleSpacing, redMaxDist, yellowMaxDist, dbPerMeter, weights, applyYellowBlur).
   - Llama `generateRedHeatmapFromFacade(gridX, gridY, segments, perimeter, lwMap, opts)` y recibe `zmat` (dB).
   - Calcula `hover`:
     - Para cada celda calcula distancia mínima al segmento (proyección perpendicular).
     - Si `Lp` es finito, calcula `potenciaRel = 10^(Lp/10)` y construye texto HTML con `<br>`:
       - `"Distancia a fachada: XX m<br>Nivel (Lp): YY dB<br>Potencia estimada (rel): Z.ZZe+N"`

2. `generateRedHeatmapFromFacade(gridX, gridY, segments, perimeter, lwMap, opts)` (ColorMap.ts) – pipeline interno
   - Genera fuentes muestreadas a lo largo del perímetro y/o fachadas:
     - `WaveEmitter.generateSources(perimeter, segmentsWithNames, sampleSpacing, outwardOffset, lwMap)` devuelve lista de fuentes `{ x, z, Lw, nx, nz }` (nx/nz normal exterior).
   - Calcula mapas físicos por fuente usando `ISOModel`:
     - `redDb = ISOModel.computeGridLpFromSources(sources, gridX, gridY, { maxDist: redMaxDist, dbPerMeter, directivityCut, Lw_isRoom: true })`.
     - `yellowDb = ISOModel.computeGridLpFromSources(..., { maxDist: yellowMaxDist, ...})`.
     - Estas funciones devuelven matrices `Lp` (dB) por celda considerando atenuación geométrica, directividad y `dbPerMeter`.
   - Determina si una celda está "fuera" y frente a alguna fachada:
     - Para cada celda calcula `bestPerp = max_{seg}( getPerpAlong(px,pz, seg.p1, seg.p2).perp )`.
     - Si `bestPerp <= 0` la celda no está frente a una fachada -> no recibe halo.
     - Aplica límites perpendiculares: solo convierte dB->lineal cuando `bestPerp <= redMaxDist` (o `yellowMaxDist`).
   - Convierte dB->energía lineal:
     - `redLinear[j][i] = (cond) ? 10^(redDb/10) : 0`
     - `yellowLinear[j][i] = (cond) ? 10^(yellowDb/10) : 0`
   - Suaviza `yellowLinear` con un blur gaussiano (para halo):
     - `yellowLinear = gaussianBlurMatrix(yellowLinear, applyYellowBlur)`
     - Implementación separable (horizontal + vertical) para eficiencia.
   - Combina linealmente:
     - `combinedE = redWeight*redLinear + yellowWeight*yellowLinear`
     - `out[j][i] = combinedE > 0 ? 10*log10(combinedE) : NaN` (convertir a dB).
   - Resultado final: matriz `z` en dB lista para render.

3. Alternativa funcional en ColorMap: `generateRedGradient(gridX, gridY, segments, perimeter, options)`  
   - Similar, pero discretiza directamente cada segmento en `nSamples` emisores:
     - `P_total_linear = 10^(Lw_out/10)`, `P_per_sample = P_total_linear / nSamples`.
     - Para cada sample calcula:
       - distancia `dist` y `perp` (distancia perpendicular).
       - si `perp <= 0` o `perp > maxDist` -> omitir.
       - `geomLoss = 20*log10(dist) + 10*log10(4π)` y `atmosLoss = dbPerMeter * dist`.
       - `Lp_sample_db = 10*log10(P_per_sample) - geomLoss - atmosLoss`.
       - peso elíptico: `w_perp = exp(-perp^2 / (2*sigma_perp^2))`, `w_along = exp(-(along - center)^2/(2*sigma_along^2))`.
       - `E_sample = 10^(Lp_sample_db/10) * w_perp * w_along`
     - Suma energía lineal por celda y finalmente `10*log10(totalE)`.

4. `ColorGradientManager.computeGradientValue(px,pz,segments,LwMap,isInsidePerimeter,perimeter,cellSize,band)`  
   - Función utilitaria que calcula Lp en un punto (método usado por otras rutas):
     - Comprueba si el punto está dentro o muy cerca del perímetro y devuelve `-Infinity` si es interior.
     - Para cada segmento:
       - Discretiza el segmento en `nSamples` y calcula `P_per_sample`.
       - Orienta la normal hacia exterior (usa centroid como heurística).
       - Para cada sample calcula `dist, perp`.
       - Solo contribuye si `perp>0 && perp<=maxDist`.
       - Calcula `Lp_sample_db` con `geomLoss`, `atmosLoss`, `facadeLoss`.
       - Calcula `sigma_perp` y `sigma_along` (posible ajuste por `band`):
         - `sigma_perp = max(0.5, max(maxDist * bandLateralMultiplier, segLen * 0.25))`
         - `sigma_along = sigmaAlongFactor * segLen * bandAlongMultiplier`
       - Peso `weight = exp(-perp^2/(2*sigma_perp^2)) * exp(-dist^2/(2*sigma_along^2))`
       - `E_sample = 10^(Lp_sample_db_adj/10) * weight`, sumar a `totalE`.
     - Devuelve `10*log10(totalE)` o `-Infinity` si `totalE <= 0`.

---

## 3) Componentes / funciones clave (qué archivo y cómo se llaman)

- `useHeatmap` (app/hooks/useHeatmap.ts)
  - Firma: `(config, building, params, finalLoop, lShapeMesh, refreshKey)`
  - Construye `gridX/gridY`, `lwMap`, llama a `generateRedHeatmapFromFacade`, construye `hover` (HTML) y devuelve `{ x, y, z, hover, min, max }`.

- `generateRedHeatmapFromFacade` (app/acoustics/ColorMap.ts)
  - Firma: `(gridX, gridY, segments, perimeter, lwMap, options)`
  - Internamente: `WaveEmitter.generateSources`, `ISOModel.computeGridLpFromSources` → combinar en energía lineal → blur amarillo → combinar → dB.

- `generateRedGradient` (app/acoustics/ColorMap.ts)
  - Firma alternativa que muestrea directamente segmentos y produce mapa dB.

- `ColorGradientManager.computeGradientValue` (app/acoustics/ColorGradientManager.ts)
  - Calcula Lp puntual sumando contribuciones discretas de muestras sobre cada segmento; admite `band` para ajustar sigma lateral/longitudinal.

- `WaveEmitter.generateSources` (app/acoustics/WaveEmitter.ts)
  - Toma perímetro, segmentos y spacing; devuelve fuentes con posición, nivel, normal y orientación. (Usada por ColorMap).

- `ISOModel.computeGridLpFromSources` (app/lib/ISOModel.ts)
  - Dada la lista de fuentes y la grilla, calcula Lp por celda aplicando pérdidas geométricas, directividad y atenuación por distancia.

---

## 4) Unidades y convenciones importantes
- Distancias: metros (m).
- Niveles: decibelios (dB).  
  - Conversión a energía lineal: `E = 10^(Lp/10)`.
  - Pérdida geométrica de punto: `20*log10(r) + 10*log10(4π)`.
- `dbPerMeter`: dB por metro (atmosférico / pérdidas en trayecto).
- `sampleSpacing`: m entre emisores muestreados sobre fachada.
- `sigma_perp`, `sigma_along`: en metros; controlan extensión angular y longitudinal del halo.

---

## 5) Parámetros que puedes ajustar y efecto esperado
- `params.colorOverlay.redMaxDist` — distancia máxima para banda roja; incrementarlo extiende la banda roja.
- `params.colorOverlay.yellowMaxDist` — distancia máxima del halo amarillo; incrementarlo hace el halo más amplio.
- `applyYellowBlur` — número de celdas de blur en la matriz lineal amarilla (suaviza / hace halo más extenso).
- `sampleSpacing` — menor spacing = más emisores = mayor resolución/CPU.
- `ColorGradientManager.lateralSpreadFactor` — factor global para ampliar/reducir sigma lateral (mayor => halos más anchos).
- `ColorGradientManager.band` (cuando se llame a computeGradientValue) — permite escalado por banda: `yellow` normalmente mayor, `green` más estrecho.

Recomendaciones iniciales:
- Visualización: `cellSize` ≈ 0.5..1.0 m; `sampleSpacing` ≈ 0.1..0.5 m según coste.
- `yellowMaxDist` ≈ 6..12 m para halo visible; `redMaxDist` ≈ 1.5..3.0 m para banda roja localizada.
- `applyYellowBlur` ≈ 4..12 para halo suave; 0 para halo nítido.

---

## 6) Cómo integrar tooltip HTML con Plotly (ya implementado en hook)
- El hook `useHeatmap` devuelve `hover[row][col]` con `<br>` como saltos de línea.
- En el trace de Plotly use:
  ```js
  trace = {
    z: heat.z,
    x: heat.x,
    y: heat.y,
    type: "heatmap",
    text: heat.hover,      // matriz 2D con strings HTML
    hoverinfo: "text",
    hoverlabel: { align: "left" }
  }
  ```
- `Plotly` muestra `<br>` como saltos de línea en hover; puedes enriquecer con `<b>`, `<i>`, etc.

---

## 7) Dónde tocar si quieres cambiar comportamiento
- Cambiar muestreo / peso por muestra:
  - `app/acoustics/ColorMap.ts` → `generateRedHeatmapFromFacade` o `generateRedGradient`.
- Cambiar kernel y sigma:
  - `app/acoustics/ColorGradientManager.ts` → `sigma_perp`, `sigma_along`, `lateralSpreadFactor`.
- Cambiar suavizado/blur:
  - `app/acoustics/ColorMap.ts` → `gaussianBlurMatrix` y `applyYellowBlur` parámetros.
- Cambiar how perimeter masking works:
  - `app/acoustics/ColorGradientManager.ts` → función `isInsideOrNearPerimeter` (ajustar `halfCell` / buffer).

---

## 8) Ejemplo mínimo de traza Plotly para tooltip
```js
// suponer heat = useHeatmap(...)
const trace = {
  z: heat.z,
  x: heat.x,
  y: heat.y,
  type: "heatmap",
  text: heat.hover,      // matriz 2D con strings (HTML: <br>)
  hoverinfo: "text",
  colorscale: getColorscale()
};
```

---

## 9) Diagnóstico rápido si no aparece tooltip
- Asegura que `heat.hover` tenga la misma dimensión que `z` (filas x columnas).
- Asegura `trace.text = heat.hover` y `hoverinfo = 'text'`.
- Usa `<br>` en lugar de `\n` para saltos de línea.
- Comprueba en la consola `console.log(heat.hover[0][0])` para verificar contenido.

---

## 10) Resumen final
- El pipeline combina un modelo físico (ISO / pérdida geométrica) con muestreo sobre fachadas y kernels gaussianos para producir halos visuales.
- Se trabaja en energía lineal para sumar contribuciones, y se convierte a dB sólo al final.
- Parámetros clave: `sampleSpacing`, `dbPerMeter`, `maxDist`, `yellowMaxDist`, `applyYellowBlur`, `lateralSpreadFactor`.
- El hook `useHeatmap` produce además `hover` (HTML) listo para Plotly; solo hay que asignarlo a `trace.text` y `hoverinfo='text'`.

Fin del documento.
