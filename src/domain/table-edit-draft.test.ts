import { describe, expect, it } from "vitest";
import { reducer } from "../state/store.ts";
import { createDefaultProject } from "./defaults.ts";
import { normalizeTables } from "./field.ts";
import {
  buildTableFromDraft,
  createEmptyFieldDraft,
  draftFromTable,
  lostIncomingRelations,
  validateTableDraft,
} from "./table-draft.ts";
import type { AppState, Relation } from "./types.ts";

function baseState(): AppState {
  const project = createDefaultProject(normalizeTables);
  return { projects: [project], activeProjectId: project.id, tables: project.tables, relations: project.relations, zoom: 1 };
}

function save(state: AppState, tableId: string, mutate: (draft: ReturnType<typeof draftFromTable>) => void, removeRelationIds: string[] = []) {
  const table = state.tables.find((item) => item.id === tableId);
  if (!table) throw new Error("tabla");
  const draft = draftFromTable(table, state.relations);
  mutate(draft);
  const built = buildTableFromDraft(draft, state.tables);
  return reducer(state, { type: "UPDATE_TABLE", ...built, removeRelationIds });
}

describe("editar tablas existentes", () => {
  it("cargar y guardar sin cambios deja la tabla y las relaciones igual", () => {
    const state = baseState();
    const next = save(state, "tbl_posts", () => {});
    expect(next.tables).toEqual(state.tables);
    expect(next.relations.map((relation) => relation.id)).toEqual(state.relations.map((relation) => relation.id));
  });

  it("carga las claves foraneas salientes como referencias de sus campos", () => {
    const state = baseState();
    const draft = draftFromTable(state.tables[1], state.relations);
    const userId = draft.fields.find((field) => field.name === "user_id");
    expect(userId?.reference).toMatchObject({ tableId: "tbl_users", fieldId: "fld_users_id", kind: "1:N" });
    expect(userId?.sourceFieldId).toBe("fld_posts_user_id");
  });

  it("renombrar campos y tabla conserva ids, posicion y relaciones entrantes", () => {
    const state = baseState();
    const next = save(state, "tbl_users", (draft) => {
      draft.name = "usuarios";
      draft.fields[0].name = "user_pk";
    });
    const users = next.tables.find((table) => table.id === "tbl_users");
    expect(users?.name).toBe("usuarios");
    expect(users?.fields[0]).toMatchObject({ id: "fld_users_id", name: "user_pk" });
    expect(users?.x).toBe(state.tables[0].x);
    expect(next.relations).toHaveLength(1);
  });

  it("borrar un campo referenciado elimina la relacion entrante (y se avisa antes)", () => {
    const state = baseState();
    const users = state.tables[0];
    const draft = draftFromTable(users, state.relations);
    draft.fields = draft.fields.filter((field) => field.name !== "id");
    expect(lostIncomingRelations(draft, state.relations).map((relation) => relation.id)).toEqual(["rel_posts_user_id_to_users_id"]);
    const next = save(state, "tbl_users", (d) => {
      d.fields = d.fields.filter((field) => field.name !== "id");
    });
    expect(next.relations).toHaveLength(0);
  });

  it("cambiar o quitar la referencia sustituye la clave foranea saliente", () => {
    const state = baseState();
    const changed = save(state, "tbl_posts", (draft) => {
      const field = draft.fields.find((item) => item.name === "user_id");
      if (field?.reference) field.reference = { ...field.reference, kind: "1:1", onDelete: "CASCADE" };
    });
    expect(changed.relations).toHaveLength(1);
    expect(changed.relations[0]).toMatchObject({ kind: "1:1", onDelete: "CASCADE", fromFieldId: "fld_posts_user_id" });

    const removed = save(state, "tbl_posts", (draft) => {
      const field = draft.fields.find((item) => item.name === "user_id");
      if (field) field.reference = null;
    });
    expect(removed.relations).toHaveLength(0);
  });

  it("anadir campos con referencia, reordenar y quitar relaciones entrantes", () => {
    const state = baseState();
    const next = save(state, "tbl_users", (draft) => {
      draft.fields.reverse();
      draft.fields.push({ ...createEmptyFieldDraft(), name: "last_post_id", reference: { tableId: "tbl_posts", fieldId: "fld_posts_id", kind: "1:N", onDelete: "SET NULL", onUpdate: "NO ACTION" } });
    }, ["rel_posts_user_id_to_users_id"]);
    const users = next.tables.find((table) => table.id === "tbl_users");
    expect(users?.fields.map((field) => field.name)).toEqual(["created_at", "email", "id", "last_post_id"]);
    expect(next.relations.map((relation) => `${relation.fromTableId}->${relation.toTableId}`)).toEqual(["tbl_users->tbl_posts"]);
  });

  it("conserva relaciones N:M antiguas y permite crear nuevas", () => {
    const state = baseState();
    const legacy: Relation = { id: "nm", fromTableId: "tbl_posts", fromFieldId: "fld_posts_id", toTableId: "tbl_users", toFieldId: "fld_users_id", kind: "N:M", onDelete: "NO ACTION", onUpdate: "NO ACTION" };
    const withLegacy = { ...state, relations: [...state.relations, legacy] };
    const next = save(withLegacy, "tbl_posts", (draft) => {
      draft.manyToMany = [{ key: "k", tableId: "tbl_users", onDelete: "CASCADE" }];
    });
    expect(next.relations.some((relation) => relation.id === "nm")).toBe(true);
    expect(next.tables.some((table) => table.name === "posts_users")).toBe(true);
  });

  it("al validar no choca el nombre con la propia tabla", () => {
    const state = baseState();
    const draft = draftFromTable(state.tables[0], state.relations);
    expect(validateTableDraft(draft, state.tables).errors).toEqual([]);
    draft.name = "posts";
    expect(validateTableDraft(draft, state.tables).errors[0]).toContain("Ya existe");
  });

  it("mantiene la clave primaria compuesta al editar una tabla intermedia", () => {
    const state = baseState();
    const junction = {
      id: "tj",
      name: "users_posts",
      x: 0,
      y: 0,
      fields: [
        { id: "j1", name: "user_id", type: "uuid", nullable: false, isPrimary: true, isUnique: true, autoIncrement: false, isIndexed: true },
        { id: "j2", name: "post_id", type: "uuid", nullable: false, isPrimary: true, isUnique: true, autoIncrement: false, isIndexed: true },
      ],
    };
    const relations: Relation[] = [
      { id: "r1", fromTableId: "tj", fromFieldId: "j1", toTableId: "tbl_users", toFieldId: "fld_users_id", kind: "1:N", onDelete: "CASCADE", onUpdate: "NO ACTION" },
      { id: "r2", fromTableId: "tj", fromFieldId: "j2", toTableId: "tbl_posts", toFieldId: "fld_posts_id", kind: "1:N", onDelete: "CASCADE", onUpdate: "NO ACTION" },
    ];
    const next = save({ ...state, tables: [...state.tables, junction], relations: [...state.relations, ...relations] }, "tj", () => {});
    const saved = next.tables.find((table) => table.id === "tj");
    expect(saved?.fields.filter((field) => field.isPrimary)).toHaveLength(2);
    expect(next.relations.filter((relation) => relation.fromTableId === "tj").map((relation) => relation.onDelete)).toEqual(["CASCADE", "CASCADE"]);
  });
});
