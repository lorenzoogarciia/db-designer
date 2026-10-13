import { describe, expect, it } from "vitest";
import type { Table } from "../domain/types.ts";
import { TABLE_ORIGIN_PADDING } from "./constants.ts";
import { normalizeTablesOrigin } from "./layout.ts";

function table(id: string, x: number, y: number): Table {
  return { id, name: id, fields: [], x, y };
}

describe("normalizeTablesOrigin", () => {
  it("shifts negative coordinates into the visible origin", () => {
    const { tables, shifted } = normalizeTablesOrigin([
      table("a", -792, 40),
      table("b", 100, -50),
    ]);

    expect(shifted).toBe(true);
    expect(Math.min(...tables.map((item) => item.x))).toBe(TABLE_ORIGIN_PADDING);
    expect(Math.min(...tables.map((item) => item.y))).toBe(TABLE_ORIGIN_PADDING);
    expect(tables[1].x - tables[0].x).toBe(100 - -792);
  });

  it("does not move tables already inside the origin pad", () => {
    const input = [table("a", 40, 40), table("b", 300, 120)];
    const { tables, shifted } = normalizeTablesOrigin(input);

    expect(shifted).toBe(false);
    expect(tables[0].x).toBe(40);
    expect(tables[1].y).toBe(120);
  });
});
