import { describe, expect, it } from "vitest";
import {
  buildRoutePointsForTest,
  isRouteClearForTest,
  type RouteTable,
} from "./relation-routing.ts";
import type { FieldAnchor } from "./relation-routing.ts";

function table(id: string, x: number, y: number, width = 260, height = 180): RouteTable {
  return { id, x, y, width, height };
}

function pathCrossesAnyTable(
  points: Array<{ x: number; y: number }>,
  tables: RouteTable[],
  excludeIds: string[],
): boolean {
  const obstacles = tables
    .filter((t) => !excludeIds.includes(t.id))
    .map((table) => ({
      x: table.x - 20,
      y: table.y - 20,
      width: table.width + 40,
      height: table.height + 40,
    }));
  const allowed = tables
    .filter((t) => excludeIds.includes(t.id))
    .map((table) => ({
      left: table.x,
      top: table.y,
      right: table.x + table.width,
      bottom: table.y + table.height,
    }));

  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i];
    const to = points[i + 1];
    for (const obstacle of obstacles) {
      const rect = {
        left: obstacle.x,
        top: obstacle.y,
        right: obstacle.x + obstacle.width,
        bottom: obstacle.y + obstacle.height,
      };
      if (segmentBlockedWithAllowed(from.x, from.y, to.x, to.y, rect, allowed)) return true;
    }
  }
  return false;
}

function segmentBlockedWithAllowed(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  obstacle: { left: number; top: number; right: number; bottom: number },
  allowedRects: Array<{ left: number; top: number; right: number; bottom: number }>,
): boolean {
  if (Math.abs(y1 - y2) < 0.001) {
    const y = y1;
    if (y <= obstacle.top || y >= obstacle.bottom) return false;
    const segMin = Math.min(x1, x2);
    const segMax = Math.max(x1, x2);
    const overlapMin = Math.max(segMin, obstacle.left);
    const overlapMax = Math.min(segMax, obstacle.right);
    if (overlapMin >= overlapMax) return false;
    const allowedIntervals = allowedRects
      .filter((rect) => y > rect.top && y < rect.bottom)
      .map((rect) => [Math.max(overlapMin, rect.left), Math.min(overlapMax, rect.right)] as [number, number])
      .filter(([start, end]) => end - start > 0.001);
    return subtractTestIntervals([overlapMin, overlapMax], allowedIntervals).length > 0;
  }

  if (Math.abs(x1 - x2) < 0.001) {
    const x = x1;
    if (x <= obstacle.left || x >= obstacle.right) return false;
    const segMin = Math.min(y1, y2);
    const segMax = Math.max(y1, y2);
    const overlapMin = Math.max(segMin, obstacle.top);
    const overlapMax = Math.min(segMax, obstacle.bottom);
    if (overlapMin >= overlapMax) return false;
    const allowedIntervals = allowedRects
      .filter((rect) => x > rect.left && x < rect.right)
      .map((rect) => [Math.max(overlapMin, rect.top), Math.min(overlapMax, rect.bottom)] as [number, number])
      .filter(([start, end]) => end - start > 0.001);
    return subtractTestIntervals([overlapMin, overlapMax], allowedIntervals).length > 0;
  }

  return false;
}

function subtractTestIntervals(interval: [number, number], blockers: Array<[number, number]>): Array<[number, number]> {
  let parts: Array<[number, number]> = [interval];
  for (const [blockStart, blockEnd] of blockers) {
    const next: Array<[number, number]> = [];
    for (const [start, end] of parts) {
      if (blockEnd <= start || blockStart >= end) {
        next.push([start, end]);
        continue;
      }
      if (start < blockStart) next.push([start, blockStart]);
      if (blockEnd < end) next.push([blockEnd, end]);
    }
    parts = next;
  }
  return parts.filter(([start, end]) => end - start > 0.001);
}

describe("relation routing", () => {
  it("routes around a table blocking a horizontal relation", () => {
    const tables = [
      table("a", 40, 80),
      table("b", 520, 80),
      table("blocker", 280, 60),
    ];
    const from: FieldAnchor = { x: 300, y: 150, side: "right" };
    const to: FieldAnchor = { x: 520, y: 150, side: "left" };

    const points = buildRoutePointsForTest(from, to, tables, "a", "b", 0);

    expect(points.length).toBeGreaterThan(2);
    expect(isRouteClearForTest(points, tables, ["a", "b"])).toBe(true);
    expect(pathCrossesAnyTable(points, tables, ["a", "b"])).toBe(false);
  });

  it("routes around a table blocking a vertical relation", () => {
    const tables = [
      table("a", 120, 40),
      table("b", 120, 420),
      table("blocker", 100, 220),
    ];
    const from: FieldAnchor = { x: 250, y: 220, side: "bottom" };
    const to: FieldAnchor = { x: 250, y: 420, side: "top" };

    const points = buildRoutePointsForTest(from, to, tables, "a", "b", 0);

    expect(isRouteClearForTest(points, tables, ["a", "b"])).toBe(true);
    expect(pathCrossesAnyTable(points, tables, ["a", "b"])).toBe(false);
  });

  it("keeps a direct route when no obstacle is in the way", () => {
    const tables = [table("a", 40, 80), table("b", 520, 80)];
    const from: FieldAnchor = { x: 300, y: 150, side: "right" };
    const to: FieldAnchor = { x: 520, y: 150, side: "left" };

    const points = buildRoutePointsForTest(from, to, tables, "a", "b", 0);

    expect(isRouteClearForTest(points, tables, ["a", "b"])).toBe(true);
    expect(pathCrossesAnyTable(points, tables, ["a", "b"])).toBe(false);
  });

  it("offsets parallel relations with different lane indexes", () => {
    const tables = [table("a", 40, 80), table("b", 520, 80), table("blocker", 280, 60)];
    const from: FieldAnchor = { x: 300, y: 150, side: "right" };
    const to: FieldAnchor = { x: 520, y: 150, side: "left" };

    const first = buildRoutePointsForTest(from, to, tables, "a", "b", 0);
    const second = buildRoutePointsForTest(from, to, tables, "a", "b", 1);

    expect(isRouteClearForTest(first, tables, ["a", "b"])).toBe(true);
    expect(isRouteClearForTest(second, tables, ["a", "b"])).toBe(true);
    expect(JSON.stringify(first)).not.toBe(JSON.stringify(second));
  });
});
