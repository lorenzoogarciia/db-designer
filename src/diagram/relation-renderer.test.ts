import { describe, expect, it } from "vitest";
import { buildCardinalityMarkerDefs, cardinalityMarkers } from "./relation-renderer.ts";

describe("notacion de cardinalidad", () => {
  it("1:N pone 'muchos' en la tabla con la clave foranea y 'uno' en la referenciada", () => {
    expect(cardinalityMarkers("1:N")).toEqual({ start: "card-many-1n", end: "card-one-1n" });
  });

  it("1:1 y N:M usan el mismo simbolo en ambos extremos", () => {
    expect(cardinalityMarkers("1:1")).toEqual({ start: "card-one-11", end: "card-one-11" });
    expect(cardinalityMarkers("N:M")).toEqual({ start: "card-many-nm", end: "card-many-nm" });
  });

  it("define todos los marcadores referenciados", () => {
    const defs = buildCardinalityMarkerDefs(20);
    for (const kind of ["1:1", "1:N", "N:M"] as const) {
      const { start, end } = cardinalityMarkers(kind);
      expect(defs).toContain(`id="${start}"`);
      expect(defs).toContain(`id="${end}"`);
    }
    expect(defs).toContain('orient="auto-start-reverse"');
  });
});
