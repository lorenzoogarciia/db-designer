import { describe, expect, it } from "vitest";
import { normalizeRelation, formatFkReferentialActions } from "../domain/relation.ts";

describe("normalizeRelation", () => {
  it("applies defaults for missing fk actions", () => {
    const relation = normalizeRelation({
      id: "r1",
      fromTableId: "t1",
      fromFieldId: "f1",
      toTableId: "t2",
      toFieldId: "f2",
      kind: "1:N",
    });
    expect(relation.onDelete).toBe("NO ACTION");
    expect(relation.onUpdate).toBe("NO ACTION");
  });
});

describe("formatFkReferentialActions", () => {
  it("formats on delete and on update clauses", () => {
    expect(
      formatFkReferentialActions({
        onDelete: "CASCADE",
        onUpdate: "RESTRICT",
      }),
    ).toBe(" ON DELETE CASCADE ON UPDATE RESTRICT");
  });
});
