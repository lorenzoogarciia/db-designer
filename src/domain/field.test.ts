import { describe, expect, it } from "vitest";
import { applyFieldRules, normalizeField, parseEnumValuesInput } from "../domain/field.ts";

describe("normalizeField", () => {
  it("forces autoincrement types to be primary and not nullable", () => {
    const field = normalizeField({
      id: "f1",
      name: "id",
      type: "id",
      nullable: true,
      isPrimary: false,
      isUnique: false,
      autoIncrement: false,
      isIndexed: false,
    });
    expect(field.isPrimary).toBe(true);
    expect(field.autoIncrement).toBe(true);
    expect(field.nullable).toBe(false);
    expect(field.isUnique).toBe(true);
  });

  it("parses enum values without duplicates", () => {
    expect(parseEnumValuesInput("a, b\na, 'c'")).toEqual(["a", "b", "c"]);
    const field = normalizeField({
      id: "f1",
      name: "status",
      type: "enum",
      nullable: true,
      isPrimary: false,
      isUnique: false,
      autoIncrement: false,
      isIndexed: false,
      enumValues: ["x", "x", "y"],
    });
    expect(field.enumValues).toEqual(["x", "y"]);
  });
});

describe("applyFieldRules", () => {
  it("clears other primary keys when one field becomes primary", () => {
    const table = {
      id: "t1",
      name: "users",
      x: 0,
      y: 0,
      fields: [
        normalizeField({
          id: "f1",
          name: "id",
          type: "integer",
          nullable: false,
          isPrimary: true,
          isUnique: true,
          autoIncrement: false,
          isIndexed: true,
        }),
        normalizeField({
          id: "f2",
          name: "code",
          type: "text",
          nullable: false,
          isPrimary: false,
          isUnique: false,
          autoIncrement: false,
          isIndexed: false,
        }),
      ],
    };
    const candidate = table.fields[1];
    candidate.isPrimary = true;
    applyFieldRules(candidate, table);
    expect(table.fields[0].isPrimary).toBe(false);
    expect(table.fields[1].isPrimary).toBe(true);
  });
});
