import { estimateTableWidth, getTableHeight, placeNearRelated } from "../diagram/layout.ts";
import { isAutoIncrementType } from "../lib/data-types.ts";
import { createDefaultIdField, normalizeField } from "./field.ts";
import { generateId } from "./ids.ts";
import { buildRelationId, DEFAULT_ON_DELETE, DEFAULT_ON_UPDATE } from "./relation.ts";
import type { DataType } from "../lib/data-types.ts";
import type { Field, FkReferentialAction, Relation, Table } from "./types.ts";

export interface ManyToManyInput {
  fromTableId: string;
  fromFieldId: string;
  toTableId: string;
  toFieldId: string;
  onDelete?: FkReferentialAction;
  onUpdate?: FkReferentialAction;
}

export interface JunctionResult {
  table: Table;
  relations: Relation[];
}

/** Tipo que debe tener una columna FK que apunta a `field` (los autoincrementales pasan a entero normal). */
export function foreignKeyTypeFor(field: Field): { type: DataType; enumValues?: string[] } {
  if (field.type === "bigserial") return { type: "bigint" };
  if (isAutoIncrementType(field.type)) return { type: "integer" };
  if (field.type === "enum") return { type: "enum", enumValues: [...(field.enumValues ?? [])] };
  return { type: field.type };
}

function uniqueName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(`${base}_${index}`)) index += 1;
  return `${base}_${index}`;
}

/** Hueco libre lo mas cerca posible del punto medio entre las dos tablas que une. */
function findFreePosition(tables: Table[], junction: Table, fromTable: Table, toTable: Table): { x: number; y: number } {
  const box = (table: Table) => ({
    x: table.x,
    y: table.y,
    width: estimateTableWidth(table),
    height: getTableHeight(table),
  });
  return placeNearRelated(
    tables.map(box),
    estimateTableWidth(junction),
    getTableHeight(junction),
    [box(fromTable), box(toTable)],
    { x: fromTable.x, y: fromTable.y },
  );
}

/**
 * Construye la tabla intermedia de una relacion N:M y sus dos relaciones 1:N.
 * Devuelve null si alguno de los extremos no existe o ambos son la misma tabla.
 */
export function buildJunction(
  tables: Table[],
  input: ManyToManyInput,
  makeId: (prefix: string) => string = generateId,
): JunctionResult | null {
  const fromTable = tables.find((table) => table.id === input.fromTableId);
  const toTable = tables.find((table) => table.id === input.toTableId);
  if (!fromTable || !toTable || fromTable.id === toTable.id) return null;
  const fromField = fromTable.fields.find((field) => field.id === input.fromFieldId);
  const toField = toTable.fields.find((field) => field.id === input.toFieldId);
  if (!fromField || !toField) return null;

  const tableName = uniqueName(`${fromTable.name}_${toTable.name}`, new Set(tables.map((table) => table.name)));
  const idField = { ...createDefaultIdField(), id: makeId("fld") };
  const fromColumnName = uniqueName(`${fromTable.name}_${fromField.name}`, new Set([idField.name]));
  const toColumnName = uniqueName(`${toTable.name}_${toField.name}`, new Set([idField.name, fromColumnName]));

  const buildFkField = (name: string, target: Field): Field =>
    normalizeField({
      id: makeId("fld"),
      name,
      ...foreignKeyTypeFor(target),
      nullable: false,
      isPrimary: false,
      isUnique: false,
      autoIncrement: false,
      isIndexed: true,
    });

  const fromFkField = buildFkField(fromColumnName, fromField);
  const toFkField = buildFkField(toColumnName, toField);

  const table: Table = {
    id: makeId("tbl"),
    name: tableName,
    fields: [idField, fromFkField, toFkField],
    x: 0,
    y: 0,
  };
  Object.assign(table, findFreePosition(tables, table, fromTable, toTable));

  const onDelete = input.onDelete ?? DEFAULT_ON_DELETE;
  const onUpdate = input.onUpdate ?? DEFAULT_ON_UPDATE;
  const relations: Relation[] = [
    {
      id: buildRelationId(table.id, fromFkField.id, fromTable.id, fromField.id),
      fromTableId: table.id,
      fromFieldId: fromFkField.id,
      toTableId: fromTable.id,
      toFieldId: fromField.id,
      kind: "1:N",
      onDelete,
      onUpdate,
    },
    {
      id: buildRelationId(table.id, toFkField.id, toTable.id, toField.id),
      fromTableId: table.id,
      fromFieldId: toFkField.id,
      toTableId: toTable.id,
      toFieldId: toField.id,
      kind: "1:N",
      onDelete,
      onUpdate,
    },
  ];

  return { table, relations };
}

/**
 * Sustituye las relaciones N:M que queden (proyectos antiguos) por tablas intermedias virtuales.
 * Se usa al generar SQL para que el resultado sea siempre valido.
 */
export function expandManyToMany(project: { tables: Table[]; relations: Relation[] }): {
  tables: Table[];
  relations: Relation[];
} {
  if (!project.relations.some((relation) => relation.kind === "N:M")) return project;
  let counter = 0;
  const makeId = (prefix: string) => `${prefix}_nm_${(counter += 1)}`;
  const tables = [...project.tables];
  const relations: Relation[] = [];
  for (const relation of project.relations) {
    if (relation.kind !== "N:M") {
      relations.push(relation);
      continue;
    }
    const junction = buildJunction(tables, relation, makeId);
    if (!junction) continue;
    tables.push(junction.table);
    relations.push(...junction.relations);
  }
  return { tables, relations };
}
