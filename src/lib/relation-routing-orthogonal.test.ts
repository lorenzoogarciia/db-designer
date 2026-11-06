import { describe, expect, it } from "vitest";
import {
  buildRoutePointsForTest,
  enforceOrthogonal,
  isRouteClearForTest,
  type FieldAnchor,
  type RouteTable,
} from "./relation-routing.ts";

function isOrthogonal(points: Array<{ x: number; y: number }>): boolean {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (Math.abs(a.x - b.x) > 0.001 && Math.abs(a.y - b.y) > 0.001) return false;
  }
  return true;
}

/** Anclajes como los elige el diagrama: lados enfrentados segun la posicion relativa. */
function anchorsFor(from: RouteTable, to: RouteTable, fromRow: number, toRow: number): [FieldAnchor, FieldAnchor] {
  const fromY = from.y + 64 + fromRow * 42 + 21;
  const toY = to.y + 64 + toRow * 42 + 21;
  const dx = to.x + to.width / 2 - (from.x + from.width / 2);
  const dy = to.y + to.height / 2 - (from.y + from.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? [{ x: from.x + from.width, y: fromY, side: "right" }, { x: to.x, y: toY, side: "left" }]
      : [{ x: from.x, y: fromY, side: "left" }, { x: to.x + to.width, y: toY, side: "right" }];
  }
  return dy >= 0
    ? [{ x: from.x + from.width / 2, y: from.y + from.height, side: "bottom" }, { x: to.x + to.width / 2, y: to.y, side: "top" }]
    : [{ x: from.x + from.width / 2, y: from.y, side: "top" }, { x: to.x + to.width / 2, y: to.y + to.height, side: "bottom" }];
}

function seededRandom(seed: number) {
  let value = seed;
  return () => (value = (value * 16807) % 2147483647) / 2147483647;
}

describe("rutas ortogonales", () => {
  it("enforceOrthogonal convierte cualquier diagonal en un codo", () => {
    const result = enforceOrthogonal([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 50, y: 40 },
    ]);
    expect(isOrthogonal(result)).toBe(true);
    expect(result[result.length - 1]).toEqual({ x: 50, y: 40 });
  });

  it("nunca genera tramos diagonales, ni con tablas muy juntas o solapadas", () => {
    const random = seededRandom(42);
    for (let scenario = 0; scenario < 60; scenario++) {
      const tables: RouteTable[] = [];
      for (let i = 0; i < 14; i++) {
        tables.push({
          id: `t${i}`,
          x: Math.round(random() * 1400),
          y: Math.round(random() * 900),
          width: 260 + Math.round(random() * 200),
          height: 64 + 42 * (1 + Math.floor(random() * 8)),
        });
      }
      for (let r = 0; r < 6; r++) {
        const a = tables[Math.floor(random() * tables.length)];
        const b = tables[Math.floor(random() * tables.length)];
        if (a === b) continue;
        const [from, to] = anchorsFor(a, b, 0, 0);
        for (const quality of ["full", "fast"] as const) {
          const points = buildRoutePointsForTest(from, to, tables, a.id, b.id, r % 2, quality);
          expect(isOrthogonal(points)).toBe(true);
          expect(points[0]).toEqual({ x: from.x, y: from.y });
          expect(points[points.length - 1]).toEqual({ x: to.x, y: to.y });
        }
      }
    }
  });

  it("encuentra el pasillo entre tablas en vez de atravesarlas", () => {
    // Fila de tablas con un hueco de 120px entre ellas; origen arriba, destino abajo.
    const tables: RouteTable[] = [
      { id: "from", x: 400, y: 0, width: 300, height: 190 },
      { id: "to", x: 400, y: 900, width: 300, height: 190 },
      { id: "w1", x: 0, y: 450, width: 500, height: 200 },
      { id: "w2", x: 620, y: 450, width: 500, height: 200 },
    ];
    const [from, to] = anchorsFor(tables[0], tables[1], 0, 0);
    const points = buildRoutePointsForTest(from, to, tables, "from", "to", 0);
    expect(isOrthogonal(points)).toBe(true);
    expect(isRouteClearForTest(points, tables, ["from", "to"])).toBe(true);
    // Debe pasar por el hueco (x entre 520 y 600) y no dar la vuelta por fuera.
    const crossing = points.find((point, index) => index > 0 && point.y > 450 && point.y < 650);
    const verticalAtGap = points.some((point) => point.x > 520 && point.x < 600);
    expect(crossing === undefined || verticalAtGap).toBe(true);
    expect(verticalAtGap).toBe(true);
  });

  it("rodea obstaculos cuando existe un camino libre", () => {
    const random = seededRandom(7);
    let clear = 0;
    let total = 0;
    for (let scenario = 0; scenario < 40; scenario++) {
      // Rejilla con huecos amplios: siempre hay camino libre.
      const tables: RouteTable[] = [];
      for (let i = 0; i < 16; i++) {
        tables.push({ id: `t${i}`, x: (i % 4) * 600, y: Math.floor(i / 4) * 520, width: 300 + Math.round(random() * 120), height: 64 + 42 * 6 });
      }
      const a = tables[Math.floor(random() * 16)];
      const b = tables[Math.floor(random() * 16)];
      if (a === b) continue;
      const [from, to] = anchorsFor(a, b, 1, 2);
      const points = buildRoutePointsForTest(from, to, tables, a.id, b.id, 0);
      total += 1;
      if (isRouteClearForTest(points, tables, [a.id, b.id])) clear += 1;
    }
    expect(clear).toBe(total);
  });

  it("es rapido con proyectos grandes", () => {
    const random = seededRandom(3);
    const tables: RouteTable[] = [];
    for (let i = 0; i < 160; i++) {
      tables.push({ id: `t${i}`, x: (i % 16) * 620 + Math.round(random() * 60), y: Math.floor(i / 16) * 560, width: 380, height: 64 + 42 * (2 + Math.floor(random() * 8)) });
    }
    const start = performance.now();
    for (let i = 1; i < 160; i++) {
      for (const target of [i - 1, Math.max(0, i - 17)]) {
        const [from, to] = anchorsFor(tables[i], tables[target], 1, 0);
        const points = buildRoutePointsForTest(from, to, tables, tables[i].id, tables[target].id, 0);
        expect(isOrthogonal(points)).toBe(true);
      }
    }
    expect(performance.now() - start).toBeLessThan(3000);
  });
});
