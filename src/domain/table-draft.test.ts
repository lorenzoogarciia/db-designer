import { describe, expect, it } from "vitest";
import { getTableHeight, placeNearRelated } from "../diagram/layout.ts";
import { reducer } from "../state/store.ts";
import { createDefaultProject } from "./defaults.ts";
import { normalizeTables } from "./field.ts";
import {
  applyReferenceType,
  buildTableFromDraft,
  createEmptyFieldDraft,
  createTableDraft,
  relatedTableIds,
  suggestReference,
  validateTableDraft,
  type FieldDraft,
} from "./table-draft.ts";
import type { AppState, Table } from "./types.ts";

function table(id: string, name: string, pkType = "id"): Table {
  return {
    id,
    name,
    x: 0,
    y: 0,
    fields: [
      { id: `${id}_pk`, name: "id", type: pkType, nullable: false, isPrimary: true, isUnique: true, autoIncrement: pkType === "id", isIndexed: true },
      { id: `${id}_name`, name: "nombre", type: "varchar", nullable: false, isPrimary: false, isUnique: false, autoIncrement: false, isIndexed: false },
    ],
  };
}

const tables = [table("tc", "clientes"), table("tu", "users", "uuid"), table("tcat", "categories"), table("ts", "sport_escuelas")];

function field(name: string, overrides: Partial<FieldDraft> = {}): FieldDraft {
  return { ...createEmptyFieldDraft(), name, ...overrides };
}

describe("suggestReference", () => {
  it.each([
    ["cliente_id", "tc"],
    ["clienteId", "tc"],
    ["id_cliente", "tc"],
    ["fk_cliente", "tc"],
    ["user_id", "tu"],
    ["category_id", "tcat"],
    ["escuela_id", "ts"],
  ])("%s -> %s", (name, tableId) => {
    expect(suggestReference(name, tables)).toEqual({ tableId, fieldId: `${tableId}_pk` });
  });

  it("no sugiere nada si no hay tabla parecida", () => {
    expect(suggestReference("id", tables)).toBeNull();
    expect(suggestReference("pedido_id", tables)).toBeNull();
    expect(suggestReference("nombre", tables)).toBeNull();
  });
});

describe("applyReferenceType", () => {
  it("usa entero para referencias a autoincrementales y el mismo tipo en el resto", () => {
    const toClient = applyReferenceType(field("cliente_id", { reference: { tableId: "tc", fieldId: "tc_pk", kind: "1:N", onDelete: "NO ACTION", onUpdate: "NO ACTION" } }), tables);
    expect(toClient).toMatchObject({ type: "integer", isIndexed: true, isPrimary: false });
    const toUser = applyReferenceType(field("user_id", { reference: { tableId: "tu", fieldId: "tu_pk", kind: "1:1", onDelete: "NO ACTION", onUpdate: "NO ACTION" } }), tables);
    expect(toUser).toMatchObject({ type: "uuid", isUnique: true });
  });
});

describe("validateTableDraft", () => {
  it("exige nombre unico y campos sin repetir", () => {
    const draft = createTableDraft("clientes");
    draft.fields.push(field("email"), field("Email"));
    const { errors } = validateTableDraft(draft, tables);
    expect(errors.some((error) => error.includes("Ya existe"))).toBe(true);
    expect(errors.some((error) => error.includes("repetido"))).toBe(true);
  });

  it("acepta un borrador correcto e ignora filas vacias", () => {
    const draft = createTableDraft("pedidos");
    expect(validateTableDraft(draft, tables).errors).toEqual([]);
  });
});

describe("buildTableFromDraft", () => {
  it("crea la tabla, sus FKs y las relaciones N:M de una vez", () => {
    const draft = createTableDraft("pedidos");
    draft.fields = [
      draft.fields[0],
      field("cliente_id", { nullable: false, reference: { tableId: "tc", fieldId: "tc_pk", kind: "1:N", onDelete: "CASCADE", onUpdate: "NO ACTION" } }),
      field("total", { type: "decimal", defaultValue: "0" }),
      field(""),
    ];
    draft.manyToMany = [{ key: "k", tableId: "tcat", onDelete: "CASCADE" }];
    const built = buildTableFromDraft(draft, tables, "tp");

    expect(built.table.name).toBe("pedidos");
    expect(built.table.fields.map((item) => `${item.name}:${item.type}`)).toEqual(["id:id", "cliente_id:integer", "total:decimal"]);
    expect(built.relations).toHaveLength(1);
    expect(built.relations[0]).toMatchObject({ fromTableId: "tp", toTableId: "tc", toFieldId: "tc_pk", kind: "1:N", onDelete: "CASCADE" });
    expect(built.manyToMany).toEqual([
      expect.objectContaining({ fromTableId: "tp", fromFieldId: built.table.fields[0].id, toTableId: "tcat", toFieldId: "tcat_pk" }),
    ]);
    expect(relatedTableIds(draft).sort()).toEqual(["tc", "tcat"]);
  });

  it("respeta claves primarias compuestas (tablas intermedias importadas)", () => {
    const draft = createTableDraft("t");
    draft.fields = [field("a_id", { isPrimary: true }), field("b_id", { isPrimary: true })];
    const built = buildTableFromDraft(draft, tables);
    expect(built.table.fields.filter((item) => item.isPrimary)).toHaveLength(2);
  });
});

describe("reducer CREATE_TABLE", () => {
  it("anade tabla, relaciones y tablas intermedias en una sola accion", () => {
    const project = createDefaultProject(normalizeTables);
    const state: AppState = { projects: [project], activeProjectId: project.id, tables: project.tables, relations: project.relations, zoom: 1 };
    const draft = createTableDraft("comments");
    draft.fields.push(field("post_id", { reference: { tableId: "tbl_posts", fieldId: "fld_posts_id", kind: "1:N", onDelete: "CASCADE", onUpdate: "NO ACTION" } }));
    draft.manyToMany = [{ key: "k", tableId: "tbl_users", onDelete: "CASCADE" }];
    const built = buildTableFromDraft(draft, state.tables, "tbl_comments");
    const next = reducer(state, { type: "CREATE_TABLE", ...built });
    expect(next.tables.map((item) => item.name)).toEqual(["users", "posts", "comments", "comments_users"]);
    expect(next.relations).toHaveLength(1 + 1 + 2);
    expect(next.tables.find((item) => item.name === "comments")?.fields.find((item) => item.name === "post_id")?.type).toBe("uuid");
  });
});

describe("placeNearRelated", () => {
  const box = (x: number, y: number) => ({ x, y, width: 300, height: getTableHeight({ id: "", name: "", x: 0, y: 0, fields: [] }) + 200 });

  it("coloca la tabla junto a sus relacionadas sin solaparse", () => {
    const occupied = [box(0, 0), box(2000, 0), box(4000, 2000)];
    const position = placeNearRelated(occupied, 300, 200, [occupied[1]], { x: 0, y: 5000 });
    const placed = { ...position, width: 300, height: 200 };
    occupied.forEach((item) =>
      expect(placed.x < item.x + item.width && placed.x + 300 > item.x && placed.y < item.y + item.height && placed.y + 200 > item.y).toBe(false),
    );
    // Mas cerca de la tabla relacionada (x=2000) que de cualquier otra.
    expect(Math.hypot(position.x - 2000, position.y)).toBeLessThan(700);
  });

  it("entre varias relacionadas, queda cerca del centro de todas", () => {
    const related = [box(0, 0), box(1600, 0)];
    const position = placeNearRelated(related, 300, 200, related, { x: 0, y: 0 });
    expect(position.x + 150).toBeGreaterThan(400);
    expect(position.x + 150).toBeLessThan(1500);
  });

  it("sin relaciones usa el punto alternativo", () => {
    expect(placeNearRelated([], 300, 200, [], { x: 500, y: 500 })).toEqual({ x: 350, y: 400 });
  });
});
