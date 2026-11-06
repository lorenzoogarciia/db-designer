/**
 * Camara del canvas infinito: un punto del mundo (coordenadas logicas de las tablas)
 * se ve en pantalla en `world * zoom + (x, y)`, relativo a la esquina del viewport.
 */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface WorldBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type DetailLevel = "full" | "compact" | "overview";

/** Zoom maximo absoluto. */
export const ZOOM_MAX = 2.5;
/** Zoom minimo absoluto (proyectos enormes). */
export const ZOOM_FLOOR = 0.02;
/** Con proyectos pequenos se puede alejar al menos hasta aqui. */
export const ZOOM_MIN_DEFAULT = 0.25;
/** Por debajo de "ajustar a pantalla" se permite alejar hasta este factor. */
export const ZOOM_BEYOND_FIT = 0.8;
/** Margen (px de pantalla) al encuadrar el contenido. */
export const FIT_PADDING = 48;

/** Umbrales de nivel de detalle: por debajo de cada uno se simplifica la tabla. */
export const LOD_FULL_MIN_ZOOM = 0.6;
export const LOD_COMPACT_MIN_ZOOM = 0.33;

export function detailLevelForZoom(zoom: number): DetailLevel {
  if (zoom >= LOD_FULL_MIN_ZOOM) return "full";
  if (zoom >= LOD_COMPACT_MIN_ZOOM) return "compact";
  return "overview";
}

/** Grosor base de las relaciones en pantalla (px) a zoom normal. */
export const RELATION_LINE_WIDTH = 2.5;
/** Grosor maximo en pantalla con la vista muy alejada. */
export const RELATION_LINE_WIDTH_MAX = 7;

/**
 * Grosor en pantalla de las lineas de relacion: constante con el detalle completo y creciendo
 * al alejar la vista (40 % ≈ 3,5 px, 25 % ≈ 5,3 px, desde ~15 % = 7 px), para que se sigan viendo.
 */
export function relationLineWidth(zoom: number): number {
  const z = Math.max(zoom, ZOOM_FLOOR);
  if (z >= LOD_FULL_MIN_ZOOM) return RELATION_LINE_WIDTH;
  const grown = RELATION_LINE_WIDTH * Math.pow(LOD_FULL_MIN_ZOOM / z, 0.85);
  return clampValue(grown, RELATION_LINE_WIDTH, RELATION_LINE_WIDTH_MAX);
}

/** Lado del marco (en unidades del viewBox) en que se dibujan los simbolos de cardinalidad. */
export const MARKER_VIEWBOX = 16;

/**
 * Tamano en pantalla (px) de los simbolos de cardinalidad de los extremos (barra = "uno",
 * pata de gallo = "muchos"). Crece con la linea pero con tope, para no tapar tablas pequenas.
 */
export function cardinalityMarkerSize(zoom: number): number {
  return clampValue(relationLineWidth(zoom) * 4.5, 18, 28);
}

/** Grosor del trazo de los simbolos, en unidades del viewBox, para que iguale al de la linea. */
export function cardinalityMarkerStroke(zoom: number): number {
  return (relationLineWidth(zoom) * MARKER_VIEWBOX) / cardinalityMarkerSize(zoom);
}

/**
 * Tamano en pantalla (px) del nombre de las tablas en vista general: el MISMO para todas las
 * tablas (solo depende del zoom). Baja de forma moderada al alejar mucho (14 px hasta el 25 %,
 * 10 px desde el 8 %) para que los nombres no se monten unos sobre otros.
 */
export function overviewNameSize(zoom: number): number {
  if (zoom >= 0.25) return 14;
  if (zoom <= 0.08) return 10;
  return Math.round((10 + ((zoom - 0.08) / (0.25 - 0.08)) * 4) * 10) / 10;
}

/**
 * Interpreta lo que se escribe en el campo de zoom como porcentaje: "80", "80%", "12,5", "12.5 %".
 * Devuelve el factor de zoom (0.8 para "80") o null si no es valido.
 */
export function parseZoomInput(raw: string): number | null {
  const text = raw.trim().replace(",", ".");
  const match = /^(\d+(?:\.\d+)?|\.\d+)\s*%?$/.exec(text);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value / 100;
}

export function clampValue(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function boundsSize(bounds: WorldBounds): { width: number; height: number } {
  return { width: Math.max(1, bounds.maxX - bounds.minX), height: Math.max(1, bounds.maxY - bounds.minY) };
}

/** Zoom que hace caber todo el contenido en el viewport. */
export function fitZoom(bounds: WorldBounds, viewportWidth: number, viewportHeight: number): number {
  const { width, height } = boundsSize(bounds);
  const availableWidth = Math.max(1, viewportWidth - FIT_PADDING * 2);
  const availableHeight = Math.max(1, viewportHeight - FIT_PADDING * 2);
  return Math.min(availableWidth / width, availableHeight / height);
}

/**
 * Limites de zoom segun el tamano del proyecto: siempre se puede alejar lo suficiente
 * para ver todo (y un poco mas), pero no hasta un vacio sin sentido.
 */
export function zoomLimits(
  bounds: WorldBounds | null,
  viewportWidth: number,
  viewportHeight: number,
): { min: number; max: number } {
  if (!bounds) return { min: ZOOM_MIN_DEFAULT, max: ZOOM_MAX };
  const fit = fitZoom(bounds, viewportWidth, viewportHeight);
  const min = clampValue(Math.min(ZOOM_MIN_DEFAULT, fit * ZOOM_BEYOND_FIT), ZOOM_FLOOR, ZOOM_MIN_DEFAULT);
  return { min, max: ZOOM_MAX };
}

export function screenToWorld(camera: Camera, screenX: number, screenY: number): { x: number; y: number } {
  return { x: (screenX - camera.x) / camera.zoom, y: (screenY - camera.y) / camera.zoom };
}

/** Cambia el zoom manteniendo fijo el punto de pantalla (screenX, screenY). */
export function zoomAround(camera: Camera, nextZoom: number, screenX: number, screenY: number): Camera {
  const world = screenToWorld(camera, screenX, screenY);
  return { zoom: nextZoom, x: screenX - world.x * nextZoom, y: screenY - world.y * nextZoom };
}

/** Camara que centra `bounds` en el viewport con el zoom indicado. */
export function centerOn(
  bounds: WorldBounds,
  zoom: number,
  viewportWidth: number,
  viewportHeight: number,
): Camera {
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  return { zoom, x: viewportWidth / 2 - centerX * zoom, y: viewportHeight / 2 - centerY * zoom };
}

/** Camara que encuadra todo el contenido. */
export function fitCamera(bounds: WorldBounds, viewportWidth: number, viewportHeight: number): Camera {
  const zoom = clampValue(fitZoom(bounds, viewportWidth, viewportHeight), ZOOM_FLOOR, 1);
  return centerOn(bounds, zoom, viewportWidth, viewportHeight);
}

/** true si el rectangulo del mundo se ve entero en el viewport. */
export function isWorldRectVisible(
  camera: Camera,
  rect: WorldBounds,
  viewportWidth: number,
  viewportHeight: number,
  margin = 0,
): boolean {
  const left = rect.minX * camera.zoom + camera.x;
  const top = rect.minY * camera.zoom + camera.y;
  const right = rect.maxX * camera.zoom + camera.x;
  const bottom = rect.maxY * camera.zoom + camera.y;
  return left >= margin && top >= margin && right <= viewportWidth - margin && bottom <= viewportHeight - margin;
}

/**
 * Separacion de la rejilla de fondo en pantalla: se duplica al alejar para que
 * los puntos nunca queden a menos de `minSpacing` px.
 */
export function gridSpacing(zoom: number, baseSpacing = 24, minSpacing = 14): number {
  let spacing = baseSpacing * zoom;
  while (spacing < minSpacing) spacing *= 2;
  return spacing;
}

export function interpolateCamera(
  from: Camera,
  to: Camera,
  t: number,
  viewportWidth: number,
  viewportHeight: number,
): Camera {
  // Zoom en escala logaritmica (acercar/alejar uniforme) y centro del mundo en lineal,
  // asi la animacion no "derrapa" al combinar desplazamiento y zoom.
  const zoom = Math.exp(Math.log(from.zoom) + (Math.log(to.zoom) - Math.log(from.zoom)) * t);
  const fromCenter = screenToWorld(from, viewportWidth / 2, viewportHeight / 2);
  const toCenter = screenToWorld(to, viewportWidth / 2, viewportHeight / 2);
  const centerX = fromCenter.x + (toCenter.x - fromCenter.x) * t;
  const centerY = fromCenter.y + (toCenter.y - fromCenter.y) * t;
  return { zoom, x: viewportWidth / 2 - centerX * zoom, y: viewportHeight / 2 - centerY * zoom };
}
