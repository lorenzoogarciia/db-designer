import { formatDefaultForSql } from "../domain/field.ts";
import { isAutoIncrementType, isIntegerLikeType, mapDataTypeToSql, type SqlDialect } from "../lib/data-types.ts";
import type { Field, Project, Relation, Table } from "../domain/types.ts";
import { formatFkReferentialActions } from "../domain/relation.ts";

function escapeSqlStringLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function sqlEnumMysql(field: Field): string {
  const values = field.enumValues?.filter((item) => item.length > 0) ?? [];
  if (values.length === 0) {
    return "ENUM('')";
  }
  return `ENUM(${values.map((value) => `'${escapeSqlStringLiteral(value)}'`).join(", ")})`;
}

function sqlEnumPostgresql(field: Field): string {
  const values = field.enumValues?.filter((item) => item.length > 0) ?? [];
  if (values.length === 0) {
    return "TEXT /* enum */";
  }
  const col = quoteIdentifier(field.name, "postgresql");
  const list = values.map((value) => `'${escapeSqlStringLiteral(value)}'`).join(", ");
  return `TEXT CHECK (${col} IN (${list}))`;
}

function sqlEnumSqlServer(field: Field): string {
  const values = field.enumValues?.filter((item) => item.length > 0) ?? [];
  if (values.length === 0) {
    return "NVARCHAR(50) /* enum */";
  }
  const col = quoteIdentifier(field.name, "sqlserver");
  const list = values.map((value) => `'${escapeSqlStringLiteral(value)}'`).join(", ");
  return `NVARCHAR(128) CHECK (${col} IN (${list}))`;
}

function mapFieldType(field: Field, dialect: SqlDialect): string {
  if (field.autoIncrement && isIntegerLikeType(field.type)) {
    if (dialect === "mysql") return field.type === "bigint" || field.type === "bigserial" ? "BIGINT AUTO_INCREMENT" : "INT AUTO_INCREMENT";
    if (dialect === "postgresql") return field.type === "bigint" || field.type === "bigserial" ? "BIGSERIAL" : "SERIAL";
    return field.type === "bigint" || field.type === "bigserial" ? "BIGINT IDENTITY(1,1)" : "INT IDENTITY(1,1)";
  }
  if (field.type === "enum") {
    if (dialect === "mysql") return sqlEnumMysql(field);
    if (dialect === "postgresql") return sqlEnumPostgresql(field);
    return sqlEnumSqlServer(field);
  }
  return mapDataTypeToSql(field.type, dialect);
}

export function quoteIdentifier(identifier: string, dialect: SqlDialect): string {
  if (dialect === "mysql") return `\`${identifier}\``;
  if (dialect === "postgresql") return `"${identifier.replace(/"/g, '""')}"`;
  return `[${identifier}]`;
}

export function sqlDialectLabel(dialect: SqlDialect): string {
  if (dialect === "mysql") return "MySQL";
  if (dialect === "postgresql") return "PostgreSQL";
  return "SQL Server";
}

function getFieldName(tables: Table[], tableId: string, fieldId: string): string {
  return tables.find((t) => t.id === tableId)?.fields.find((f) => f.id === fieldId)?.name ?? "unknown";
}

function getTableById(tables: Table[], tableId: string): Table | undefined {
  return tables.find((table) => table.id === tableId);
}

export function generateSql(project: Pick<Project, "tables" | "relations">, dialect: SqlDialect): string {
  const { tables, relations } = project;
  const statements: string[] = [];

  tables.forEach((table) => {
    const tableName = quoteIdentifier(table.name, dialect);
    const primaryKeys = table.fields.filter((field) => field.isPrimary).map((field) => quoteIdentifier(field.name, dialect));
    const uniqueFields = table.fields.filter((field) => field.isUnique && !field.isPrimary);
    const columnLines = table.fields.map((field) => {
      const forceNotNull = isAutoIncrementType(field.type) || field.autoIncrement;
      const nullable = forceNotNull ? "NOT NULL" : field.nullable ? "NULL" : "NOT NULL";
      const defaultClause = field.defaultValue ? ` DEFAULT ${formatDefaultForSql(field.defaultValue)}` : "";
      return `  ${quoteIdentifier(field.name, dialect)} ${mapFieldType(field, dialect)} ${nullable}${defaultClause}`;
    });
    const relationConstraints = relations
      .filter((relation: Relation) => relation.fromTableId === table.id)
      .map((relation) => {
        const fromField = getFieldName(tables, relation.fromTableId, relation.fromFieldId);
        const toTable = getTableById(tables, relation.toTableId);
        const toField = getFieldName(tables, relation.toTableId, relation.toFieldId);
        if (!toTable) return "";
        return `  FOREIGN KEY (${quoteIdentifier(fromField, dialect)}) REFERENCES ${quoteIdentifier(toTable.name, dialect)} (${quoteIdentifier(toField, dialect)})${formatFkReferentialActions(relation)}`;
      })
      .filter(Boolean);
    const indexedFields = table.fields.filter((field) => field.isIndexed && !field.isPrimary && !field.isUnique);
    if (primaryKeys.length > 0) columnLines.push(`  PRIMARY KEY (${primaryKeys.join(", ")})`);
    uniqueFields.forEach((field) => {
      columnLines.push(`  UNIQUE (${quoteIdentifier(field.name, dialect)})`);
    });
    if (dialect === "mysql") {
      indexedFields.forEach((field) => {
        const idxName = quoteIdentifier(`idx_${table.name}_${field.name}`, dialect);
        columnLines.push(`  INDEX ${idxName} (${quoteIdentifier(field.name, dialect)})`);
      });
    }
    columnLines.push(...relationConstraints);
    if (columnLines.length > 0) {
      if (dialect === "mysql") {
        statements.push(`CREATE TABLE IF NOT EXISTS ${tableName} (\n${columnLines.join(",\n")}\n);`);
      } else if (dialect === "postgresql") {
        statements.push(`CREATE TABLE IF NOT EXISTS ${tableName} (\n${columnLines.join(",\n")}\n);`);
        indexedFields.forEach((field) => {
          const idxName = quoteIdentifier(`idx_${table.name}_${field.name}`, dialect);
          statements.push(`CREATE INDEX IF NOT EXISTS ${idxName} ON ${tableName} (${quoteIdentifier(field.name, dialect)});`);
        });
      } else {
        statements.push(
          `IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='${table.name}' AND xtype='U')\nBEGIN\nCREATE TABLE ${tableName} (\n${columnLines.join(",\n")}\n);\nEND;`,
        );
        indexedFields.forEach((field) => {
          const idxName = `[idx_${table.name}_${field.name}]`;
          statements.push(
            `IF NOT EXISTS (SELECT name FROM sys.indexes WHERE name = 'idx_${table.name}_${field.name}')\nCREATE INDEX ${idxName} ON ${tableName} (${quoteIdentifier(field.name, dialect)});`,
          );
        });
      }
    }
  });

  return statements.join("\n\n");
}
