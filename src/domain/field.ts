import { isAutoIncrementType, isIntegerLikeType, normalizeDataType } from "../lib/data-types.ts";
import { generateId } from "./ids.ts";
import type { Field, Table } from "./types.ts";

export function dedupeEnumValues(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  values.forEach((value) => {
    if (seen.has(value)) return;
    seen.add(value);
    out.push(value);
  });
  return out;
}

export function parseEnumValuesInput(raw: string): string[] {
  const parts = raw
    .split(/[\n,]+/)
    .map((part) => part.trim().replace(/^['"]|['"]$/g, ""))
    .filter((part) => part.length > 0);
  return dedupeEnumValues(parts);
}

export function normalizeField(raw: Field): Field {
  const type = normalizeDataType(raw.type ?? "text");
  const autoIncrement = Boolean(raw.autoIncrement) || isAutoIncrementType(type);
  const isPrimary = Boolean(raw.isPrimary) || isAutoIncrementType(type);
  const enumValues =
    type === "enum"
      ? dedupeEnumValues(Array.isArray(raw.enumValues) ? raw.enumValues.map((item) => String(item).trim()).filter((item) => item.length > 0) : [])
      : undefined;
  const base = {
    id: raw.id,
    name: raw.name,
    type,
    nullable: isAutoIncrementType(type) || autoIncrement ? false : Boolean(raw.nullable),
    isPrimary,
    isUnique: Boolean(raw.isUnique) || isPrimary,
    autoIncrement,
    isIndexed: Boolean(raw.isIndexed) || Boolean(raw.isUnique) || isPrimary,
  };
  if (type === "enum") {
    return { ...base, enumValues: enumValues ?? [] };
  }
  return base;
}

export function normalizeTables(rawTables: Table[]): Table[] {
  return rawTables.map((table) => ({
    ...table,
    fields: table.fields.map((field) => normalizeField(field)),
  }));
}

export function createDefaultIdField(): Field {
  return normalizeField({
    id: generateId("fld"),
    name: "id",
    type: "id",
    nullable: false,
    isPrimary: true,
    isUnique: true,
    autoIncrement: true,
    isIndexed: true,
  });
}

export function applyFieldRules(field: Field, table: Table): void {
  if (isAutoIncrementType(field.type)) {
    field.autoIncrement = true;
    field.isPrimary = true;
    field.isUnique = true;
    field.nullable = false;
    field.isIndexed = true;
  }

  if (field.type === "enum") {
    field.autoIncrement = false;
    if (!field.enumValues) {
      field.enumValues = [];
    }
  } else {
    delete field.enumValues;
  }

  if (field.autoIncrement) {
    field.nullable = false;
    if (!isIntegerLikeType(field.type)) {
      field.autoIncrement = false;
    }
  }

  if (field.isPrimary) {
    field.isUnique = true;
    field.nullable = false;
    field.isIndexed = true;
    table.fields.forEach((item) => {
      if (item.id !== field.id) item.isPrimary = false;
    });
  }

  if (field.isUnique) {
    field.isIndexed = true;
  }
}
