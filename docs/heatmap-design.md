# Diseño e implementación del mapa de calor acústico por fachadas

## 1. Resumen objetivo
Producir un mapa de calor (matriz z) sobre una grilla 2D que represente niveles acústicos exteriores (Lp) generados por fuentes interiores distribuidas a lo largo de las fachadas.  
Principio: muestrear fachadas → calcular Lp físico por muestra → ponderar espacialmente (kernel elíptico) → sumar energía lineal → convertir a dB → renderizar como textura (Plotly → Three.js).

---

## 2. Módulos clave (ubicación en el código)
- PerimeterExtractor — app/Perimeter.ts  
  Extrae perímetro 2D y divide en segmentos; utilidades: buildEdgeLoops, extractBasePerimeter, extractFacadesSegments, createDefaultLwMap.

- WaveEmitter — app/acoustics/WaveEmitter.ts  
  Genera fuentes muestreadas (x,z,nx,nz,Lw) a lo largo de cada fachada; normaliza LwMap.

- ISOModel — app/lib/ISOModel.ts  
  Funciones físicas: computeFacadeRePrime, cálculo geométrico/atenuación, computeLpOutAtPoint, computeGridLpFromSources.

- GradientFactory / ColorGradientManager / ColorMap — app/acoustics/  
  - GradientFactory: genera mapas por banda (red/yellow/green/blue).  
  - ColorGradientManager: evaluación por celda (computeGradientValue).  
  - ColorMap: utilidades de color, blur, generateRedHeatmapFromFacade.

- UI / render — app/page.tsx, app/ControlsPanel.tsx, app/map/MapBuilder.ts  
  page.tsx: orquesta flujo y aplica textura a Three.js.  
  ControlsPanel: sliders/umbrales.  
  MapBuilder: construcción de grilla y llamada a funciones de cálculo.

---

## 3. Flujo de datos (pipeline)
1. Entradas:
   - Perímetro (lista [x,z]).
   - Lw por segmento (LwMap) desde UI.
   - Parámetros (defaultParams).
   - Grilla: gridX, gridY (MapBuilder).

2. Perímetro → segmentos:
   - extractFacadesSegments obtiene p1/p2 por segmento.

3. Muestreo:
   - WaveEmitter.generateSources muestrea cada segmento con spacing configurable; cada muestra tiene posición y normal.

4. Cálculo físico por muestra:
   - Lw_out = Lw_room - Re' (si aplica).
   - P_per_sample (lineal) según normalización ('per_meter' o 'per_sample').
   - Pérdidas: geométricas + atmosféricas (simplificadas).
   - Lp_sample_db = 10·log10(P_per_sample) - geomLoss - atmosLoss - facadeLoss.

5. Forma espacial (kernel elíptico):
   - Separar perp (perpendicular) y along (longitudinal).
   - Peso espacial: w = exp(-perp^2/(2σ_perp^2)) * exp(-(along - centro)^2/(2σ_along^2)).
   - σ_perp pequeño → tira estrecha; σ_along mayor → extensión a lo largo.

6. Suma de energías:
   - E_sample = 10^(Lp_sample_db/10) * w.
   - totalE = sum(E_sample).
   - Lp_total_db = 10·log10(totalE).

7. Composición de bandas:
   - Mapas separados (rojo estrecho, amarillo más ancho).
   - Amarillo suavizado opcionalmente con blur.
   - Mezcla lineal: E_comb = w_red·E_red + w_yellow·E_yellow → convertir a dB.

8. Color mapping:
   - buildThresholdColorscale mapea thresholds (red/yellow/green/blue) al rango zmin..zmax para obtener stops de color.
   - Plotly renderiza PNG transparente → Three.js lo usa como textura.

---

## 4. Fórmulas y decisiones físicas (resumen)
- Conversión energía ↔ dB:
  - P_linear = 10^(Lw_dB / 10)
  - Lp_dB = 10·log10(P_linear)

- Divergencia (geom. loss):
  - geomLoss ≈ 20·log10(r) + C  (C ≈ 10·log10(4π) ≈ 10.99 dB)

- Atenuación atmosférica (simplificada):
  - atmosLoss ≈ dbPerMeter · r

- Kernel elíptico (forma):
  - w = exp(-perp²/(2σ_perp²)) · exp(-(along - center)²/(2σ_along²))

- Re' fachada (si aplica):
  - R'_e = -10·log10( Σ(S_j · 10^{-R_j/10}) / S_fachada )

---

## 5. Parámetros principales (dónde cambiarlos)
- app/config.ts — defaultParams: cellSize, sourceSpacing, redSampleSpacing, redMaxDist, yellowMaxDist, overlaySmoothSize, overlaySmoothSigma, colorSpread, propagation.
- WaveEmitter.generateSources: sampleSpacing, outwardOffset.
- ISOModel.computeGridLpFromSources: maxDist, dbPerMeter.
- ColorMap.generateRedHeatmapFromFacade: redWeight, yellowWeight, applyYellowBlur.
- GradientFactory: σ_perp, σ_along, red/yellow sample spacing.

---

## 6. Ajustes prácticos para la "forma" del rojo y halo
- Roja más nítida:
  - Reducir σ_perp_red (ej. 0.12 m).
  - Mantener redMaxDist ≈ 1.2–2.5 m.
  - redSampleSpacing 0.08–0.25 m.

- Halo amarillo más gradual:
  - Incrementar overlaySmoothSize/overlaySmoothSigma.
  - Aumentar yellowMaxDist (4–8 m).
  - Aplicar gaussian blur (2–6 celdas) al mapa amarillo.
  - Reducir bandDecay.yellow para caída más lenta.

---

## 7. Recomendaciones de pruebas (casos)
- Test A: fachada plana única con Lw=100 dB → observar tira roja ~1.5–2 m + halo amarillo suave.
- Test B: fachadas largas vs cortas → validar normalize='per_meter' para uniformidad.
- Test C: variar sampleSpacing y resolución para detectar banding y coste computacional.

---

## 8. Limitaciones conocidas / mejoras futuras
- No hay modelado de difracción ni bloqueo por obstáculos.
- Implementar cálculo por bandas (tercios/octava) para cumplir ISO.
- Mejorar modelo atmosférico y directividad por frecuencia.
- Integrar validación con mediciones o software certificado.

---

## 9. Dónde buscar el código (rápida)
- PerimeterExtractor: app/Perimeter.ts  
- WaveEmitter: app/acoustics/WaveEmitter.ts  
- ISOModel: app/lib/ISOModel.ts  
- GradientFactory / ColorMap / ColorGradientManager: app/acoustics/  
- MapBuilder: app/map/MapBuilder.ts  
- UI: app/page.tsx, app/ControlsPanel.tsx

---

## 10. Resumen rápido de pipeline recomendado
1. WaveEmitter (sampleSpacing ≈ 0.12–0.25 m).  
2. ISOModel.computeGridLpFromSources:
   - redDb: maxDist 1.5–2.0 m, dbPerMeter ≈ 0.5
   - yellowDb: maxDist 5–8 m, dbPerMeter ≈ 0.5  
3. Blur amarillo (2–4 celdas), mezclar energías lineales: E = w_red·E_red + w_yellow·E_yellow.  
4. Convertir a dB y mapear colores con buildThresholdColorscale.  
5. Render Plotly → PNG → Three.js.

