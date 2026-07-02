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

export function normalizeDefaultValue(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  const trimmed = String(raw).trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Formatea el valor DEFAULT para DDL SQL. */
export function formatDefaultForSql(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const upper = trimmed.toUpperCase();
  if (upper === "NULL") return "NULL";
  if (
    /^(CURRENT_TIMESTAMP|CURRENT_DATE|CURRENT_TIME|LOCALTIME|LOCALTIMESTAMP|NOW\(\)|GETDATE\(\)|SYSDATETIME\(\)|SYSUTCDATETIME\(\)|UUID_GENERATE_V4\(\)|GEN_RANDOM_UUID\(\)|TRUE|FALSE)$/i.test(
      trimmed,
    )
  ) {
    return trimmed;
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed;
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    const inner = trimmed.slice(1, -1).replace(/"/g, '""');
    return `'${inner.replace(/'/g, "''")}'`;
  }
  return `'${trimmed.replace(/'/g, "''")}'`;
}

export function normalizeField(raw: Field): Field {
  const type = normalizeDataType(raw.type ?? "text");
  const autoIncrement = Boolean(raw.autoIncrement) || isAutoIncrementType(type);
  const isPrimary = Boolean(raw.isPrimary) || isAutoIncrementType(type);
  const enumValues =
    type === "enum"
      ? dedupeEnumValues(Array.isArray(raw.enumValues) ? raw.enumValues.map((item) => String(item).trim()).filter((item) => item.length > 0) : [])
      : undefined;
  const defaultValue = autoIncrement || isAutoIncrementType(type) ? undefined : normalizeDefaultValue(raw.defaultValue);
  const base = {
    id: raw.id,
    name: raw.name,
    type,
    nullable: isAutoIncrementType(type) || autoIncrement ? false : Boolean(raw.nullable),
    isPrimary,
    isUnique: Boolean(raw.isUnique) || isPrimary,
    autoIncrement,
    isIndexed: Boolean(raw.isIndexed) || Boolean(raw.isUnique) || isPrimary,
    ...(defaultValue !== undefined ? { defaultValue } : {}),
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
    delete field.defaultValue;
    if (!isIntegerLikeType(field.type)) {
      field.autoIncrement = false;
    }
  }

  if (isAutoIncrementType(field.type)) {
    delete field.defaultValue;
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
