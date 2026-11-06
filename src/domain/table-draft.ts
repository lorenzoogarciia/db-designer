import { isAutoIncrementType, isIntegerLikeType, type DataType } from "../lib/data-types.ts";
import { normalizeField, parseEnumValuesInput } from "./field.ts";
import { generateId, safeName } from "./ids.ts";
import { foreignKeyTypeFor, type ManyToManyInput } from "./many-to-many.ts";
import { buildRelationId } from "./relation.ts";
import type { Field, FkReferentialAction, Relation, Table } from "./types.ts";

/** Referencia (clave foranea) de un campo del borrador hacia un campo de otra tabla. */
export interface FieldReferenceDraft {
  tableId: string;
  fieldId: string;
  kind: "1:N" | "1:1";
  onDelete: FkReferentialAction;
  onUpdate: FkReferentialAction;
  /** Relacion existente de la que procede (se reutiliza su id mientras apunte al mismo campo). */
  source?: { relationId: string; tableId: string; fieldId: string };
}

/** Campo tal y como se edita en el creador de tablas (aun sin normalizar). */
export interface FieldDraft {
  key: string;
  /** Id del campo original al editar una tabla existente (se conserva para no romper relaciones). */
  sourceFieldId?: string;
  name: string;
  type: DataType;
  nullable: boolean;
  isPrimary: boolean;
  isUnique: boolean;
  isIndexed: boolean;
  autoIncrement: boolean;
  defaultValue: string;
  enumValues: string;
  reference: FieldReferenceDraft | null;
  /** true si el usuario toco la referencia a mano: entonces no se vuelve a sugerir. */
  referenceTouched: boolean;
}

export interface ManyToManyDraft {
  key: string;
  tableId: string;
  onDelete: FkReferentialAction;
}

export interface TableDraft {
  /** Id de la tabla al editar una existente; ausente al crear. */
  tableId?: string;
  name: string;
  fields: FieldDraft[];
  manyToMany: ManyToManyDraft[];
}

let draftCounter = 0;
export function draftKey(): string {
  draftCounter += 1;
  return `draft_${draftCounter}`;
}

export function createIdFieldDraft(): FieldDraft {
  return {
    key: draftKey(),
    name: "id",
    type: "id",
    nullable: false,
    isPrimary: true,
    isUnique: true,
    isIndexed: true,
    autoIncrement: true,
    defaultValue: "",
    enumValues: "",
    reference: null,
    referenceTouched: false,
  };
}

export function createEmptyFieldDraft(): FieldDraft {
  return {
    key: draftKey(),
    name: "",
    type: "varchar",
    nullable: true,
    isPrimary: false,
    isUnique: false,
    isIndexed: false,
    autoIncrement: false,
    defaultValue: "",
    enumValues: "",
    reference: null,
    referenceTouched: false,
  };
}

export function createTableDraft(name = ""): TableDraft {
  return { name, fields: [createIdFieldDraft(), createEmptyFieldDraft()], manyToMany: [] };
}

/** Campo al que apunta por defecto una referencia: la clave primaria (o un campo "id"). */
export function defaultReferencedField(table: Table): Field | undefined {
  const primaries = table.fields.filter((field) => field.isPrimary);
  if (primaries.length === 1) return primaries[0];
  return table.fields.find((field) => field.name.toLowerCase() === "id") ?? primaries[0] ?? table.fields[0];
}

function singularCandidates(base: string): string[] {
  const candidates = new Set([base, `${base}s`, `${base}es`]);
  if (base.endsWith("y")) candidates.add(`${base.slice(0, -1)}ies`);
  if (base.endsWith("z")) candidates.add(`${base.slice(0, -1)}ces`); // luz -> luces
  return [...candidates];
}

/**
 * Sugiere a que tabla apunta un campo por su nombre: `cliente_id`, `clienteId`, `id_cliente`
 * o `fk_cliente` -> tabla `cliente`/`clientes` (tambien con prefijo, p. ej. `sport_clientes`).
 */
export function suggestReference(fieldName: string, tables: Table[]): { tableId: string; fieldId: string } | null {
  const name = fieldName
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
  let base: string | null = null;
  const suffix = /^(.+?)_?id$/.exec(name);
  const prefix = /^(?:id|fk)_(.+)$/.exec(name);
  if (prefix) base = prefix[1];
  else if (suffix && suffix[1] !== "") base = suffix[1];
  if (!base || base === "id") return null;
  base = base.replace(/_+$/, "");

  const candidates = singularCandidates(base);
  const lowerName = (table: Table) => table.name.toLowerCase();
  const exact = tables.find((table) => candidates.includes(lowerName(table)));
  const prefixed = tables.find((table) => candidates.some((candidate) => lowerName(table).endsWith(`_${candidate}`)));
  const target = exact ?? prefixed;
  if (!target) return null;
  const field = defaultReferencedField(target);
  return field ? { tableId: target.id, fieldId: field.id } : null;
}

/** Ajusta el tipo del campo al del campo referenciado (los autoincrementales pasan a entero). */
export function applyReferenceType(draft: FieldDraft, tables: Table[]): FieldDraft {
  if (!draft.reference) return draft;
  const target = tables.find((table) => table.id === draft.reference?.tableId);
  const targetField = target?.fields.find((field) => field.id === draft.reference?.fieldId);
  if (!targetField) return draft;
  const { type, enumValues } = foreignKeyTypeFor(targetField);
  return {
    ...draft,
    type,
    enumValues: enumValues ? enumValues.join(", ") : draft.enumValues,
    autoIncrement: false,
    isIndexed: true,
    isUnique: draft.reference.kind === "1:1" ? true : draft.isUnique,
  };
}

export interface DraftValidation {
  errors: string[];
  warnings: string[];
}

export function validateTableDraft(draft: TableDraft, tables: Table[]): DraftValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const name = safeName(draft.name);
  if (!name) errors.push("La tabla necesita un nombre.");
  else if (tables.some((table) => table.id !== draft.tableId && table.name.toLowerCase() === name.toLowerCase())) {
    errors.push(`Ya existe una tabla llamada "${name}".`);
  }

  const filled = draft.fields.filter((field) => safeName(field.name));
  if (filled.length === 0) errors.push("Añade al menos un campo.");
  const seen = new Set<string>();
  for (const field of filled) {
    const fieldName = safeName(field.name);
    if (seen.has(fieldName)) errors.push(`El campo "${fieldName}" está repetido.`);
    seen.add(fieldName);
    if (field.reference && !tables.some((table) => table.id === field.reference?.tableId)) {
      errors.push(`La referencia de "${fieldName}" apunta a una tabla que ya no existe.`);
    }
    if (field.reference?.onDelete === "SET NULL" && !field.nullable) {
      warnings.push(`"${fieldName}" usa ON DELETE SET NULL pero no admite NULL.`);
    }
  }
  if (!filled.some((field) => field.isPrimary)) warnings.push("La tabla no tiene clave primaria.");
  return { errors: [...new Set(errors)], warnings };
}

export interface BuiltTable {
  table: Table;
  relations: Relation[];
  manyToMany: ManyToManyInput[];
}

/** Convierte el borrador en la tabla, sus relaciones (FKs) y las relaciones N:M a crear. */
export function buildTableFromDraft(
  draft: TableDraft,
  tables: Table[],
  tableId = draft.tableId ?? generateId("tbl"),
): BuiltTable {
  const fields: Field[] = [];
  const relations: Relation[] = [];

  for (const fieldDraft of draft.fields) {
    const name = safeName(fieldDraft.name);
    if (!name) continue;
    const resolved = applyReferenceType(fieldDraft, tables);
    // El editor marca la PK de forma exclusiva; aqui se respetan claves compuestas existentes.
    const isPrimary = resolved.isPrimary;
    const autoIncrement = (resolved.autoIncrement || isAutoIncrementType(resolved.type)) && isIntegerLikeType(resolved.type);
    const field = normalizeField({
      id: fieldDraft.sourceFieldId ?? generateId("fld"),
      name,
      type: resolved.type,
      nullable: isPrimary ? false : resolved.nullable,
      isPrimary,
      isUnique: resolved.isUnique,
      autoIncrement,
      isIndexed: resolved.isIndexed,
      ...(resolved.defaultValue.trim() ? { defaultValue: resolved.defaultValue } : {}),
      ...(resolved.type === "enum" ? { enumValues: parseEnumValuesInput(resolved.enumValues) } : {}),
    });
    fields.push(field);

    if (fieldDraft.reference) {
      const target = tables.find((table) => table.id === fieldDraft.reference?.tableId);
      const targetField = target?.fields.find((item) => item.id === fieldDraft.reference?.fieldId);
      if (target && targetField) {
        const source = fieldDraft.reference.source;
        const sameTarget = source && source.tableId === target.id && source.fieldId === targetField.id;
        relations.push({
          id: sameTarget ? source.relationId : buildRelationId(tableId, field.id, target.id, targetField.id),
          fromTableId: tableId,
          fromFieldId: field.id,
          toTableId: target.id,
          toFieldId: targetField.id,
          kind: fieldDraft.reference.kind,
          onDelete: fieldDraft.reference.onDelete,
          onUpdate: fieldDraft.reference.onUpdate,
        });
      }
    }
  }

  const original = tables.find((candidate) => candidate.id === tableId);
  const table: Table = { id: tableId, name: safeName(draft.name), fields, x: original?.x ?? 0, y: original?.y ?? 0 };
  const ownKey = fields.find((field) => field.isPrimary) ?? fields[0];
  const manyToMany: ManyToManyInput[] = [];
  for (const item of draft.manyToMany) {
    const target = tables.find((candidate) => candidate.id === item.tableId);
    const targetField = target ? defaultReferencedField(target) : undefined;
    if (!target || !targetField || !ownKey) continue;
    manyToMany.push({
      fromTableId: tableId,
      fromFieldId: ownKey.id,
      toTableId: target.id,
      toFieldId: targetField.id,
      onDelete: item.onDelete,
      onUpdate: "NO ACTION",
    });
  }

  return { table, relations, manyToMany };
}

/** Borrador para editar una tabla existente: campos con sus ids y sus claves foraneas salientes. */
export function draftFromTable(table: Table, relations: Relation[]): TableDraft {
  const outgoing = relations.filter((relation) => relation.fromTableId === table.id && relation.kind !== "N:M");
  return {
    tableId: table.id,
    name: table.name,
    manyToMany: [],
    fields: table.fields.map((field) => {
      const relation = outgoing.find((item) => item.fromFieldId === field.id);
      return {
        key: draftKey(),
        sourceFieldId: field.id,
        name: field.name,
        type: field.type,
        nullable: field.nullable,
        isPrimary: field.isPrimary,
        isUnique: field.isUnique,
        isIndexed: field.isIndexed,
        autoIncrement: field.autoIncrement,
        defaultValue: field.defaultValue ?? "",
        enumValues: (field.enumValues ?? []).join(", "),
        reference: relation
          ? {
              tableId: relation.toTableId,
              fieldId: relation.toFieldId,
              kind: relation.kind === "1:1" ? "1:1" : "1:N",
              onDelete: relation.onDelete,
              onUpdate: relation.onUpdate,
              source: { relationId: relation.id, tableId: relation.toTableId, fieldId: relation.toFieldId },
            }
          : null,
        // Los campos existentes no cambian de referencia solos al renombrarlos.
        referenceTouched: true,
      };
    }),
  };
}

/** Relaciones de otras tablas hacia esta que apuntan a campos que el borrador elimina. */
export function lostIncomingRelations(draft: TableDraft, relations: Relation[]): Relation[] {
  if (!draft.tableId) return [];
  const kept = new Set(
    draft.fields.filter((field) => field.sourceFieldId && safeName(field.name)).map((field) => field.sourceFieldId as string),
  );
  return relations.filter(
    (relation) => relation.toTableId === draft.tableId && relation.fromTableId !== draft.tableId && !kept.has(relation.toFieldId),
  );
}

/** Ids de las tablas con las que se relacionara la nueva tabla (para colocarla cerca). */
export function relatedTableIds(draft: TableDraft): string[] {
  const ids = new Set<string>();
  draft.fields.forEach((field) => {
    if (field.reference && safeName(field.name)) ids.add(field.reference.tableId);
  });
  draft.manyToMany.forEach((item) => ids.add(item.tableId));
  return [...ids];
}
