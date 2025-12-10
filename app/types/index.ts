export type LwSide = { value: number };

export interface Building {
	LwBySegment?: LwSide[];
	// otros campos del building si los hay
	[id: string]: any;
}

export interface ColorOverlayParams {
	overlaySmoothSize?: number;
	redMaxDist?: number;
	yellowMaxDist?: number;
	redThreshold?: number;
	yellowThreshold?: number;
	greenThreshold?: number;
	blueThreshold?: number;
	// permitir extras
	[key: string]: any;
}

export interface Params {
	sourceSpacing?: number;
	cellSize?: number;
	redWeight?: number;
	yellowWeight?: number;
	dbPerMeter?: number;
	inputMode?: "Lw" | "Lp";
	colorOverlay?: ColorOverlayParams;
	// permitir campos adicionales
	[key: string]: any;
}

export interface Config {
	areaSize?: number;
	resolution?: number;
	// permitir extras
	[key: string]: any;
}

// nuevo: tipo Segment básico usado por extractor de perímetro / gradientes
export interface Segment {
	name: string;
	p1: [number, number];
	p2: [number, number];
}

// HeatmapResult ahora incluye hover (matriz de texto para tooltip por celda)
export interface HeatmapResult {
	x: number[];
	y: number[];
	z: number[][];
	min: number;
	max: number;
	hover?: string[][];
}
