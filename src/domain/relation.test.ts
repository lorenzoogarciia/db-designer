import { describe, expect, it } from "vitest";
import { buildRelationId, normalizeRelation, formatFkReferentialActions } from "../domain/relation.ts";

describe("buildRelationId", () => {
  it("builds stable id from table and field endpoints", () => {
    expect(buildRelationId("tbl_a", "fld_1", "tbl_b", "fld_2")).toBe("tbl_a_fld_1__tbl_b_fld_2");
  });
});

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
