import { describe, expect, it } from "vitest";
import {
  cardinalityMarkerSize,
  cardinalityMarkerStroke,
  centerOn,
  MARKER_VIEWBOX,
  detailLevelForZoom,
  overviewNameSize,
  fitCamera,
  gridSpacing,
  interpolateCamera,
  isWorldRectVisible,
  parseZoomInput,
  RELATION_LINE_WIDTH,
  RELATION_LINE_WIDTH_MIN,
  relationLineWidth,
  screenToWorld,
  zoomAround,
  zoomLimits,
  ZOOM_FLOOR,
  ZOOM_MAX,
  ZOOM_MIN_DEFAULT,
} from "./camera.ts";
import { findFreeTablePosition } from "./layout.ts";

describe("camara", () => {
  it("convierte pantalla a mundo y mantiene fijo el punto al hacer zoom", () => {
    const camera = { x: 100, y: 50, zoom: 0.5 };
    const before = screenToWorld(camera, 300, 200);
    const zoomed = zoomAround(camera, 2, 300, 200);
    expect(screenToWorld(zoomed, 300, 200)).toEqual(before);
    expect(zoomed.zoom).toBe(2);
  });

  it("encuadra el contenido centrado y sin pasar de 100%", () => {
    const bounds = { minX: -500, minY: 1000, maxX: 4500, maxY: 3000 };
    const camera = fitCamera(bounds, 1000, 600);
    const center = screenToWorld(camera, 500, 300);
    expect(center.x).toBeCloseTo(2000);
    expect(center.y).toBeCloseTo(2000);
    expect(isWorldRectVisible(camera, bounds, 1000, 600)).toBe(true);
    expect(fitCamera({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, 1000, 600).zoom).toBe(1);
  });

  it("ajusta el zoom minimo al tamano del proyecto", () => {
    expect(zoomLimits(null, 1000, 600)).toEqual({ min: ZOOM_MIN_DEFAULT, max: ZOOM_MAX });
    // Proyecto pequeno: se puede alejar hasta el minimo por defecto.
    expect(zoomLimits({ minX: 0, minY: 0, maxX: 800, maxY: 500 }, 1000, 600).min).toBe(ZOOM_MIN_DEFAULT);
    // Con el zoom minimo se ve el proyecto entero, solo un poco mas pequeno que "ajustar".
    const big = { minX: 0, minY: 0, maxX: 20000, maxY: 12000 };
    const fit = fitCamera(big, 1000, 600).zoom;
    expect(zoomLimits(big, 1000, 600).min).toBeCloseTo(fit * 0.8);
    const medium = { minX: 0, minY: 0, maxX: 4000, maxY: 2400 };
    expect(zoomLimits(medium, 1000, 600).min).toBeCloseTo(fitCamera(medium, 1000, 600).zoom * 0.8);
    // Nunca por debajo del suelo absoluto.
    expect(zoomLimits({ minX: 0, minY: 0, maxX: 1e7, maxY: 1e7 }, 1000, 600).min).toBe(ZOOM_FLOOR);
  });

  it("elige el nivel de detalle segun el zoom", () => {
    expect(detailLevelForZoom(1)).toBe("full");
    expect(detailLevelForZoom(0.5)).toBe("compact");
    expect(detailLevelForZoom(0.1)).toBe("overview");
  });

  it("muestra el detalle completo desde el 60%", () => {
    expect(detailLevelForZoom(0.6)).toBe("full");
    expect(detailLevelForZoom(0.59)).toBe("compact");
  });

  it("adelgaza las lineas al alejar la vista, con limites", () => {
    expect(relationLineWidth(1)).toBe(RELATION_LINE_WIDTH);
    expect(relationLineWidth(2.5)).toBe(RELATION_LINE_WIDTH);
    expect(relationLineWidth(0.1)).toBeLessThan(relationLineWidth(0.3));
    expect(relationLineWidth(0.02)).toBe(RELATION_LINE_WIDTH_MIN);
  });

  it("nunca engorda las lineas por debajo del detalle completo", () => {
    for (const zoom of [0.59, 0.4, 0.25, 0.1, 0.05]) {
      expect(relationLineWidth(zoom)).toBeLessThanOrEqual(RELATION_LINE_WIDTH);
      expect(relationLineWidth(zoom)).toBeGreaterThanOrEqual(RELATION_LINE_WIDTH_MIN);
    }
    expect(relationLineWidth(0.08)).toBe(RELATION_LINE_WIDTH_MIN);
  });

  it("el nombre en vista general depende solo del zoom", () => {
    expect(overviewNameSize(0.3)).toBe(13);
    expect(overviewNameSize(0.25)).toBe(13);
    expect(overviewNameSize(0.15)).toBeGreaterThan(11);
    expect(overviewNameSize(0.15)).toBeLessThan(13);
    expect(overviewNameSize(0.02)).toBe(11);
  });

  it("los simbolos de cardinalidad encogen al alejar, con un minimo", () => {
    expect(cardinalityMarkerSize(1)).toBe(16);
    expect(cardinalityMarkerSize(0.3)).toBeLessThan(16);
    expect(cardinalityMarkerSize(0.3)).toBeGreaterThan(8);
    expect(cardinalityMarkerSize(0.05)).toBe(8);
  });

  it("el trazo de los simbolos iguala el grosor de la linea en pantalla", () => {
    for (const zoom of [1, 0.4, 0.25, 0.1, 0.03]) {
      const pxPerUnit = cardinalityMarkerSize(zoom) / MARKER_VIEWBOX;
      expect(cardinalityMarkerStroke(zoom) * pxPerUnit).toBeCloseTo(relationLineWidth(zoom));
    }
  });

  it("interpreta el zoom escrito a mano", () => {
    expect(parseZoomInput("65")).toBeCloseTo(0.65);
    expect(parseZoomInput("65 %")).toBeCloseTo(0.65);
    expect(parseZoomInput("12,5%")).toBeCloseTo(0.125);
    expect(parseZoomInput("2")).toBeCloseTo(0.02);
    expect(parseZoomInput("150")).toBeCloseTo(1.5);
    expect(parseZoomInput("abc")).toBeNull();
    expect(parseZoomInput("0")).toBeNull();
    expect(parseZoomInput("")).toBeNull();
  });

  it("la rejilla nunca queda demasiado densa", () => {
    expect(gridSpacing(1)).toBe(24);
    expect(gridSpacing(0.05)).toBeGreaterThanOrEqual(14);
  });

  it("interpola camaras empezando y terminando en los extremos", () => {
    const from = centerOn({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, 1, 800, 600);
    const to = centerOn({ minX: 5000, minY: 5000, maxX: 5100, maxY: 5100 }, 0.2, 800, 600);
    const start = interpolateCamera(from, to, 0, 800, 600);
    const end = interpolateCamera(from, to, 1, 800, 600);
    expect(start.zoom).toBeCloseTo(1);
    expect(end.zoom).toBeCloseTo(0.2);
    expect(end.x).toBeCloseTo(to.x);
    expect(end.y).toBeCloseTo(to.y);
  });
});

describe("findFreeTablePosition", () => {
  const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

  it("usa el punto preferido si esta libre", () => {
    expect(findFreeTablePosition([], 300, 200, 50, 60)).toEqual({ x: 50, y: 60 });
  });

  it("busca el hueco libre mas cercano sin solapar", () => {
    const occupied = [
      { x: 0, y: 0, width: 400, height: 300 },
      { x: 440, y: 0, width: 400, height: 300 },
      { x: 0, y: 340, width: 400, height: 300 },
    ];
    const position = findFreeTablePosition(occupied, 300, 200, 100, 100);
    const box = { ...position, width: 300, height: 200 };
    occupied.forEach((item) => expect(overlaps(box, item)).toBe(false));
    expect(Math.hypot(position.x - 100, position.y - 100)).toBeLessThan(800);
  });
});
