import { describe, expect, it } from "vitest";
import { parseImportedProject } from "../persistence/project-io.ts";

describe("parseImportedProject", () => {
  it("accepts versioned export payload", () => {
    const result = parseImportedProject({
      version: 1,
      name: "demo",
      tables: [
        {
          id: "t1",
          name: "users",
          x: 0,
          y: 0,
          fields: [{ id: "f1", name: "id", type: "integer", nullable: false, isPrimary: true, isUnique: true, autoIncrement: true, isIndexed: true }],
        },
      ],
      relations: [],
      zoom: 1,
    });
    expect(result?.name).toBe("demo");
    expect(result?.tables).toHaveLength(1);
  });

  it("rejects invalid payloads", () => {
    expect(parseImportedProject(null)).toBeNull();
    expect(parseImportedProject({ name: "x" })).toBeNull();
  });
});
