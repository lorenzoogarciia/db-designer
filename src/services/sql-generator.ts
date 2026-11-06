import { formatDefaultForSql } from "../domain/field.ts";
import { expandManyToMany } from "../domain/many-to-many.ts";
import { isAutoIncrementType, isIntegerLikeType, mapDataTypeToSql, type SqlDialect } from "../lib/data-types.ts";
import type { Field, FkReferentialAction, Project, Relation, Table } from "../domain/types.ts";

type SchemaInput = Pick<Project, "tables" | "relations">;

/** Longitud maxima de nombres de constraint/indice compatible con los tres motores (MySQL: 64, PostgreSQL: 63). */
const MAX_OBJECT_NAME = 60;

function escapeSqlStringLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function sqlString(value: string, dialect: SqlDialect): string {
  return `${dialect === "sqlserver" ? "N" : ""}'${escapeSqlStringLiteral(value)}'`;
}

export function quoteIdentifier(identifier: string, dialect: SqlDialect): string {
  if (dialect === "mysql") return `\`${identifier.replace(/`/g, "``")}\``;
  if (dialect === "postgresql") return `"${identifier.replace(/"/g, '""')}"`;
  return `[${identifier.replace(/]/g, "]]")}]`;
}

export function sqlDialectLabel(dialect: SqlDialect): string {
  if (dialect === "mysql") return "MySQL";
  if (dialect === "postgresql") return "PostgreSQL";
  return "SQL Server";
}

function enumValuesOf(field: Field): string[] {
  return field.enumValues?.filter((item) => item.length > 0) ?? [];
}

function enumColumnType(field: Field, dialect: SqlDialect): string {
  const values = enumValuesOf(field);
  if (dialect === "mysql") {
    return values.length === 0 ? "ENUM('')" : `ENUM(${values.map((value) => sqlString(value, dialect)).join(", ")})`;
  }
  const baseType = dialect === "postgresql" ? "TEXT" : "NVARCHAR(128)";
  if (values.length === 0) return `${baseType} /* enum */`;
  const col = quoteIdentifier(field.name, dialect);
  return `${baseType} CHECK (${col} IN (${values.map((value) => sqlString(value, dialect)).join(", ")}))`;
}

function baseColumnType(field: Field, dialect: SqlDialect): string {
  if (field.autoIncrement && isIntegerLikeType(field.type)) {
    const big = field.type === "bigint" || field.type === "bigserial";
    if (dialect === "mysql") return big ? "BIGINT AUTO_INCREMENT" : "INT AUTO_INCREMENT";
    if (dialect === "postgresql") return big ? "BIGSERIAL" : "SERIAL";
    return big ? "BIGINT IDENTITY(1,1)" : "INT IDENTITY(1,1)";
  }
  if (field.type === "enum") return enumColumnType(field, dialect);
  return mapDataTypeToSql(field.type, dialect);
}

const MYSQL_KEY_SUBSTITUTES: Record<string, string> = {
  TINYTEXT: "VARCHAR(255)",
  TEXT: "VARCHAR(255)",
  MEDIUMTEXT: "VARCHAR(255)",
  LONGTEXT: "VARCHAR(255)",
  TINYBLOB: "VARBINARY(255)",
  BLOB: "VARBINARY(255)",
  MEDIUMBLOB: "VARBINARY(255)",
  LONGBLOB: "VARBINARY(255)",
};

const SQLSERVER_KEY_SUBSTITUTES: Record<string, string> = {
  "NVARCHAR(MAX)": "NVARCHAR(450)",
  "VARBINARY(MAX)": "VARBINARY(900)",
};

/** Tipos que no pueden formar parte de una clave/indice aunque se sustituyan. */
const NON_INDEXABLE = /^(JSON|GEOMETRY|POINT|XML)$/;

interface ColumnTypeInfo {
  sql: string;
  substitutedFrom?: string;
  nonIndexable: boolean;
}

function columnType(field: Field, dialect: SqlDialect, inKey: boolean): ColumnTypeInfo {
  const sql = baseColumnType(field, dialect);
  if (!inKey) return { sql, nonIndexable: false };
  const substitutes = dialect === "mysql" ? MYSQL_KEY_SUBSTITUTES : dialect === "sqlserver" ? SQLSERVER_KEY_SUBSTITUTES : {};
  const substitute = substitutes[sql];
  if (substitute) return { sql: substitute, substitutedFrom: sql, nonIndexable: false };
  return { sql, nonIndexable: NON_INDEXABLE.test(sql) };
}

/** Tipo "comparable" para detectar FKs con tipos incompatibles. */
function comparableType(sql: string): string {
  return sql
    .replace(/\s+AUTO_INCREMENT$/, "")
    .replace(/\s+IDENTITY\(\d+,\s*\d+\)$/, "")
    .replace(/^BIGSERIAL$/, "BIGINT")
    .replace(/^SERIAL$/, "INTEGER")
    .replace(/\s+CHECK \(.*\)$/, "")
    .replace(/\s*\/\*.*\*\/$/, "");
}

const MYSQL_EXPRESSION_DEFAULT_ONLY = /^(TINYTEXT|TEXT|MEDIUMTEXT|LONGTEXT|TINYBLOB|BLOB|MEDIUMBLOB|LONGBLOB|JSON|GEOMETRY|POINT)$/;

function adaptDefault(formatted: string, columnSql: string, dialect: SqlDialect): string {
  const upper = formatted.toUpperCase();
  let value = formatted;
  if (dialect === "sqlserver") {
    if (upper === "TRUE") value = "1";
    else if (upper === "FALSE") value = "0";
    else if (upper === "NOW()" || upper === "LOCALTIMESTAMP" || upper === "LOCALTIME") value = "GETDATE()";
    else if (upper === "GEN_RANDOM_UUID()" || upper === "UUID_GENERATE_V4()" || upper === "UUID()") value = "NEWID()";
    else if (value.startsWith("'")) value = `N${value}`;
  } else {
    if (upper === "GETDATE()" || upper === "SYSDATETIME()" || upper === "SYSUTCDATETIME()") value = "CURRENT_TIMESTAMP";
    if (dialect === "postgresql" && (upper === "UUID()" || upper === "NEWID()")) value = "gen_random_uuid()";
    if (dialect === "mysql") {
      if (upper === "GEN_RANDOM_UUID()" || upper === "UUID_GENERATE_V4()" || upper === "NEWID()") value = "(UUID())";
      else if (MYSQL_EXPRESSION_DEFAULT_ONLY.test(columnSql) && !value.startsWith("(")) value = `(${value})`;
    }
  }
  return value;
}

function adaptReferentialAction(action: FkReferentialAction, dialect: SqlDialect): { action: FkReferentialAction; note?: string } {
  if (dialect === "mysql" && action === "SET DEFAULT") {
    return { action: "NO ACTION", note: "MySQL (InnoDB) no soporta SET DEFAULT; se usa NO ACTION" };
  }
  if (dialect === "sqlserver" && action === "RESTRICT") {
    return { action: "NO ACTION" };
  }
  return { action };
}

function truncateName(name: string): string {
  return name.length > MAX_OBJECT_NAME ? name.slice(0, MAX_OBJECT_NAME) : name;
}

function reserveName(base: string, taken: Set<string>): string {
  let candidate = truncateName(base);
  let index = 2;
  while (taken.has(candidate.toLowerCase())) {
    const suffix = `_${index}`;
    candidate = `${truncateName(base).slice(0, MAX_OBJECT_NAME - suffix.length)}${suffix}`;
    index += 1;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

/**
 * Orden de creacion: cada tabla despues de las que referencia. Si hay ciclos,
 * se rompen por el orden original y esas FKs se emiten despues con ALTER TABLE.
 */
export function orderTablesByDependencies(tables: Table[], relations: Relation[]): Table[] {
  const ids = new Set(tables.map((table) => table.id));
  const dependsOn = new Map<string, Set<string>>(tables.map((table) => [table.id, new Set<string>()]));
  relations.forEach((relation) => {
    if (relation.fromTableId === relation.toTableId) return;
    if (!ids.has(relation.fromTableId) || !ids.has(relation.toTableId)) return;
    dependsOn.get(relation.fromTableId)?.add(relation.toTableId);
  });

  const ordered: Table[] = [];
  const placed = new Set<string>();
  const pending = [...tables];
  while (pending.length > 0) {
    let index = pending.findIndex((table) => [...(dependsOn.get(table.id) ?? [])].every((dep) => placed.has(dep)));
    if (index < 0) index = 0; // ciclo: se coloca la primera tabla pendiente
    const [table] = pending.splice(index, 1);
    ordered.push(table);
    placed.add(table.id);
  }
  return ordered;
}

interface ForeignKeyPlan {
  relation: Relation;
  table: Table;
  field: Field;
  targetTable: Table;
  targetField: Field;
  name: string;
  clause: string;
}

export function filterProjectByTableIds(project: SchemaInput, tableIds: ReadonlySet<string>): SchemaInput {
  const tables = project.tables.filter((table) => tableIds.has(table.id));
  const relations = project.relations.filter(
    (relation) => tableIds.has(relation.fromTableId) && tableIds.has(relation.toTableId),
  );
  return { tables, relations };
}

export function generateSql(project: SchemaInput, dialect: SqlDialect): string {
  const { tables, relations } = expandManyToMany(project);
  const q = (identifier: string) => quoteIdentifier(identifier, dialect);
  const tableById = new Map(tables.map((table) => [table.id, table]));
  const warnings: string[] = [];
  const notes: string[] = [];
  const constraintNames = new Set<string>();
  const indexNames = new Set<string>();

  // Campos que participan en claves/indices/FKs: necesitan un tipo indexable.
  const keyFieldIds = new Set<string>();
  // Relaciones 1:1 → la columna FK debe ser UNIQUE.
  const forcedUniqueFieldIds = new Set<string>();
  tables.forEach((table) =>
    table.fields.forEach((field) => {
      if (field.isPrimary || field.isUnique || field.isIndexed) keyFieldIds.add(field.id);
    }),
  );

  const foreignKeys: ForeignKeyPlan[] = [];
  relations.forEach((relation) => {
    const table = tableById.get(relation.fromTableId);
    const targetTable = tableById.get(relation.toTableId);
    const field = table?.fields.find((item) => item.id === relation.fromFieldId);
    const targetField = targetTable?.fields.find((item) => item.id === relation.toFieldId);
    if (!table || !targetTable || !field || !targetField) return;
    keyFieldIds.add(field.id);
    keyFieldIds.add(targetField.id);
    if (relation.kind === "1:1" && !field.isPrimary && !field.isUnique) forcedUniqueFieldIds.add(field.id);

    const onDelete = adaptReferentialAction(relation.onDelete, dialect);
    const onUpdate = adaptReferentialAction(relation.onUpdate, dialect);
    [onDelete.note, onUpdate.note].forEach((note) => {
      if (note) notes.push(`${table.name}.${field.name}: ${note}.`);
    });
    if ((relation.onDelete === "SET NULL" || relation.onUpdate === "SET NULL") && !field.nullable) {
      warnings.push(`${table.name}.${field.name} usa SET NULL pero la columna es NOT NULL.`);
    }
    if (!targetField.isPrimary && !targetField.isUnique) {
      warnings.push(
        `${table.name}.${field.name} referencia ${targetTable.name}.${targetField.name}, que no es PRIMARY KEY ni UNIQUE.`,
      );
    }

    const name = reserveName(`fk_${table.name}_${field.name}`, constraintNames);
    const clause =
      `CONSTRAINT ${q(name)} FOREIGN KEY (${q(field.name)}) REFERENCES ${q(targetTable.name)} (${q(targetField.name)})` +
      ` ON DELETE ${onDelete.action} ON UPDATE ${onUpdate.action}`;
    foreignKeys.push({ relation, table, field, targetTable, targetField, name, clause });
  });

  const columnTypes = new Map<string, ColumnTypeInfo>();
  tables.forEach((table) =>
    table.fields.forEach((field) => {
      const info = columnType(field, dialect, keyFieldIds.has(field.id));
      columnTypes.set(field.id, info);
      if (info.substitutedFrom) {
        notes.push(`${table.name}.${field.name} (${info.substitutedFrom}) se genera como ${info.sql} porque forma parte de una clave o indice.`);
      }
      if (info.nonIndexable) {
        warnings.push(`${table.name}.${field.name} es ${info.sql}, que no se puede usar en claves/indices en ${sqlDialectLabel(dialect)}.`);
      }
    }),
  );

  foreignKeys.forEach(({ table, field, targetTable, targetField }) => {
    const fromType = comparableType(columnTypes.get(field.id)?.sql ?? "");
    const toType = comparableType(columnTypes.get(targetField.id)?.sql ?? "");
    if (fromType !== toType) {
      warnings.push(
        `${table.name}.${field.name} (${fromType}) y ${targetTable.name}.${targetField.name} (${toType}) tienen tipos distintos.`,
      );
    }
  });

  const ordered = orderTablesByDependencies(tables, relations);
  const created = new Set<string>();
  const statements: string[] = [];
  const deferredForeignKeys: ForeignKeyPlan[] = [];

  ordered.forEach((table) => {
    const tableName = q(table.name);
    const lines = table.fields.map((field) => {
      const type = columnTypes.get(field.id)?.sql ?? baseColumnType(field, dialect);
      const forceNotNull = isAutoIncrementType(field.type) || field.autoIncrement || field.isPrimary;
      const nullable = forceNotNull || !field.nullable ? "NOT NULL" : "NULL";
      const formatted = field.defaultValue ? formatDefaultForSql(field.defaultValue) : "";
      const defaultClause = formatted ? ` DEFAULT ${adaptDefault(formatted, type, dialect)}` : "";
      return `  ${q(field.name)} ${type} ${nullable}${defaultClause}`;
    });

    const primaryKeys = table.fields.filter((field) => field.isPrimary).map((field) => q(field.name));
    if (primaryKeys.length > 0) lines.push(`  PRIMARY KEY (${primaryKeys.join(", ")})`);
    table.fields
      .filter((field) => !field.isPrimary && (field.isUnique || forcedUniqueFieldIds.has(field.id)))
      .forEach((field) => lines.push(`  UNIQUE (${q(field.name)})`));

    const indexedFields = table.fields.filter(
      (field) => field.isIndexed && !field.isPrimary && !field.isUnique && !forcedUniqueFieldIds.has(field.id),
    );
    const indexNameOf = new Map(indexedFields.map((field) => [field.id, reserveName(`idx_${table.name}_${field.name}`, indexNames)]));
    if (dialect === "mysql") {
      indexedFields.forEach((field) => lines.push(`  INDEX ${q(indexNameOf.get(field.id) ?? "")} (${q(field.name)})`));
    }

    foreignKeys
      .filter((fk) => fk.table.id === table.id)
      .forEach((fk) => {
        if (fk.targetTable.id === table.id || created.has(fk.targetTable.id)) lines.push(`  ${fk.clause}`);
        else deferredForeignKeys.push(fk);
      });

    const body = `(\n${lines.join(",\n")}\n);`;
    if (dialect === "sqlserver") {
      statements.push(
        `IF OBJECT_ID(${sqlString(tableName, dialect)}, N'U') IS NULL\nBEGIN\nCREATE TABLE ${tableName} ${body}\nEND;`,
      );
    } else {
      statements.push(`CREATE TABLE IF NOT EXISTS ${tableName} ${body}`);
    }

    if (dialect !== "mysql") {
      indexedFields.forEach((field) => {
        const indexName = indexNameOf.get(field.id) ?? "";
        const create = `CREATE INDEX ${dialect === "postgresql" ? "IF NOT EXISTS " : ""}${q(indexName)} ON ${tableName} (${q(field.name)});`;
        statements.push(
          dialect === "sqlserver"
            ? `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = ${sqlString(indexName, dialect)} AND object_id = OBJECT_ID(${sqlString(tableName, dialect)}))\n${create}`
            : create,
        );
      });
    }
    created.add(table.id);
  });

  deferredForeignKeys.forEach((fk) => {
    const alter = `ALTER TABLE ${q(fk.table.name)} ADD ${fk.clause};`;
    statements.push(
      dialect === "sqlserver" ? `IF OBJECT_ID(${sqlString(q(fk.name), dialect)}, N'F') IS NULL\n${alter}` : alter,
    );
  });

  const header: string[] = [];
  if (deferredForeignKeys.length > 0) {
    notes.push("Hay referencias circulares entre tablas; esas claves foraneas se anaden al final con ALTER TABLE.");
  }
  if (warnings.length > 0) header.push("-- AVISOS:", ...warnings.map((item) => `-- - ${item}`));
  if (notes.length > 0) header.push("-- NOTAS:", ...notes.map((item) => `-- - ${item}`));

  return [header.join("\n"), ...statements].filter(Boolean).join("\n\n");
}
