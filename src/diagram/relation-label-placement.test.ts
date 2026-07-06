import { describe, expect, it } from "vitest";
import {
  buildLabelCandidates,
  buildScaledTableRects,
  getRelationLabelBounds,
  labelOverlapsTables,
  placeRelationLabel,
  RELATION_LABEL_WIDTH,
} from "./relation-label-placement.ts";

describe("relation label placement", () => {
  it("places label on path segment away from table", () => {
    const pathPoints = [
      { x: 100, y: 300 },
      { x: 400, y: 300 },
    ];
    const tableRects = buildScaledTableRects([{ x: 0, y: 0, width: 200, height: 200 }], 0, 1);
    const placed: Array<{ left: number; top: number; right: number; bottom: number }> = [];

    const point = placeRelationLabel(pathPoints, { x: 250, y: 300 }, tableRects, placed, { width: 900, height: 700 });

    expect(point.y).toBe(300);
    expect(point.x).toBeGreaterThan(200);
    expect(labelOverlapsTables(point, tableRects)).toBe(false);
  });

  it("avoids overlapping another placed label", () => {
    const pathPoints = [
      { x: 300, y: 100 },
      { x: 300, y: 500 },
    ];
    const tableRects: Array<{ left: number; top: number; right: number; bottom: number }> = [];
    const placed: Array<{ left: number; top: number; right: number; bottom: number }> = [];

    const first = placeRelationLabel(pathPoints, { x: 300, y: 250 }, tableRects, placed, { width: 900, height: 700 });
    const second = placeRelationLabel(pathPoints, { x: 300, y: 260 }, tableRects, placed, { width: 900, height: 700 });

    expect(intersects(getRelationLabelBounds(first.x, first.y), getRelationLabelBounds(second.x, second.y), 4)).toBe(false);
  });

  it("never keeps a label over a table even when preferred point is blocked", () => {
    const pathPoints = [
      { x: 120, y: 120 },
      { x: 120, y: 120 },
    ];
    const tableRects = buildScaledTableRects([{ x: 0, y: 0, width: 220, height: 220 }], 0, 1);
    const placed: Array<{ left: number; top: number; right: number; bottom: number }> = [];

    const point = placeRelationLabel(pathPoints, { x: 120, y: 120 }, tableRects, placed, { width: 900, height: 700 });

    expect(labelOverlapsTables(point, tableRects)).toBe(false);
  });

  it("generates candidates along each path segment", () => {
    const candidates = buildLabelCandidates(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      { x: 50, y: 0 },
    );

    expect(candidates.length).toBeGreaterThan(3);
    expect(candidates.some((point) => point.x === 100 && point.y === 50)).toBe(true);
  });

  it("uses label width constant matching renderer", () => {
    const bounds = getRelationLabelBounds(120, 80, 0);
    expect(bounds.right - bounds.left).toBe(RELATION_LABEL_WIDTH);
  });
});

function intersects(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
  margin = 0,
): boolean {
  return a.left < b.right + margin && a.right > b.left - margin && a.top < b.bottom + margin && a.bottom > b.top - margin;
}
