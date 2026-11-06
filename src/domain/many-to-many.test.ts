import { describe, expect, it } from "vitest";
import { estimateTableWidth, getTableHeight } from "../diagram/layout.ts";
import { reducer } from "../state/store.ts";
import { createDefaultProject } from "./defaults.ts";
import { normalizeTables } from "./field.ts";
import { buildJunction } from "./many-to-many.ts";
import type { AppState, Table } from "./types.ts";

function overlaps(a: Table, b: Table): boolean {
  return (
    a.x < b.x + estimateTableWidth(b) &&
    a.x + estimateTableWidth(a) > b.x &&
    a.y < b.y + getTableHeight(b) &&
    a.y + getTableHeight(a) > b.y
  );
}

describe("buildJunction", () => {
  const project = createDefaultProject(normalizeTables);
  const [users, posts] = project.tables;

  it("crea la tabla intermedia con id y dos FKs del tipo correcto", () => {
    const junction = buildJunction(project.tables, {
      fromTableId: users.id,
      fromFieldId: users.fields[0].id,
      toTableId: posts.id,
      toFieldId: posts.fields[0].id,
      onDelete: "CASCADE",
    });
    expect(junction?.table.name).toBe("users_posts");
    expect(junction?.table.fields.map((field) => `${field.name}:${field.type}`)).toEqual([
      "id:id",
      "users_id:uuid",
      "posts_id:uuid",
    ]);
    expect(junction?.relations.map((relation) => [relation.kind, relation.toTableId, relation.onDelete])).toEqual([
      ["1:N", users.id, "CASCADE"],
      ["1:N", posts.id, "CASCADE"],
    ]);
  });

  it("usa enteros para FKs a columnas autoincrementales y evita nombres repetidos", () => {
    const a: Table = { ...users, id: "ta", name: "a", fields: [{ ...users.fields[0], id: "fa", type: "id", autoIncrement: true }] };
    const b: Table = { ...posts, id: "tb", name: "b", fields: [{ ...posts.fields[0], id: "fb", type: "bigserial", autoIncrement: true }] };
    const existing: Table = { ...users, id: "tx", name: "a_b", x: 2000, y: 2000 };
    const junction = buildJunction([a, b, existing], { fromTableId: "ta", fromFieldId: "fa", toTableId: "tb", toFieldId: "fb" });
    expect(junction?.table.name).toBe("a_b_2");
    expect(junction?.table.fields.slice(1).map((field) => field.type)).toEqual(["integer", "bigint"]);
  });

  it("no se solapa con las tablas existentes", () => {
    const blocker: Table = { ...posts, id: "blocker", name: "blocker", x: 200, y: 260 };
    const tables = [users, posts, blocker];
    const junction = buildJunction(tables, {
      fromTableId: users.id,
      fromFieldId: users.fields[0].id,
      toTableId: posts.id,
      toFieldId: posts.fields[0].id,
    });
    expect(junction).not.toBeNull();
    tables.forEach((table) => expect(overlaps(junction!.table, table)).toBe(false));
  });

  it("rechaza la misma tabla en ambos extremos", () => {
    expect(
      buildJunction(project.tables, { fromTableId: users.id, fromFieldId: users.fields[0].id, toTableId: users.id, toFieldId: users.fields[0].id }),
    ).toBeNull();
  });
});

describe("reducer ADD_MANY_TO_MANY", () => {
  const project = createDefaultProject(normalizeTables);
  const state: AppState = {
    projects: [project],
    activeProjectId: project.id,
    tables: project.tables,
    relations: project.relations,
    zoom: 1,
  };
  const [users, posts] = project.tables;

  it("sustituye la relacion editada por la tabla intermedia", () => {
    const next = reducer(state, {
      type: "ADD_MANY_TO_MANY",
      relation: { fromTableId: posts.id, fromFieldId: posts.fields[1].id, toTableId: users.id, toFieldId: users.fields[0].id },
      replaceRelationId: project.relations[0].id,
    });
    expect(next.tables).toHaveLength(3);
    expect(next.relations).toHaveLength(2);
    expect(next.relations.some((relation) => relation.id === project.relations[0].id)).toBe(false);
    expect(next.relations.every((relation) => relation.fromTableId === next.tables[2].id)).toBe(true);
  });
});
