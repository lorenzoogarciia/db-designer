import { estimateTableWidth, getTableHeight } from "../diagram/layout.ts";
import { TABLE_ORIGIN_PADDING } from "../diagram/constants.ts";
import { normalizeField } from "../domain/field.ts";
import { generateId } from "../domain/ids.ts";
import { buildRelationId, isFkReferentialAction } from "../domain/relation.ts";
import type { DataType } from "../lib/data-types.ts";
import type { Field, FkReferentialAction, Relation, Table } from "../domain/types.ts";

/* ------------------------------------------------------------------ */
/* Tokenizador                                                         */
/* ------------------------------------------------------------------ */

type TokenKind = "word" | "ident" | "string" | "number" | "punct";

interface Token {
  kind: TokenKind;
  value: string;
  /** Solo para `word`: valor en mayusculas para comparar palabras clave. */
  upper: string;
}

function makeToken(kind: TokenKind, value: string): Token {
  return { kind, value, upper: kind === "word" ? value.toUpperCase() : "" };
}

function readQuoted(sql: string, start: number, close: string, allowBackslash: boolean): { value: string; end: number } {
  let value = "";
  let i = start;
  while (i < sql.length) {
    const ch = sql[i];
    if (allowBackslash && ch === "\\" && i + 1 < sql.length) {
      const nextCh = sql[i + 1];
      value += nextCh === "n" ? "\n" : nextCh === "t" ? "\t" : nextCh;
      i += 2;
      continue;
    }
    if (ch === close) {
      if (sql[i + 1] === close) {
        value += close;
        i += 2;
        continue;
      }
      return { value, end: i + 1 };
    }
    value += ch;
    i += 1;
  }
  return { value, end: sql.length };
}

export function tokenizeSql(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if ((ch === "-" && sql[i + 1] === "-") || ch === "#") {
      while (i < sql.length && sql[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end < 0 ? sql.length : end + 2;
      continue;
    }
    if (ch === "'") {
      const { value, end } = readQuoted(sql, i + 1, "'", true);
      tokens.push(makeToken("string", value));
      i = end;
      continue;
    }
    if (ch === '"' || ch === "`") {
      const { value, end } = readQuoted(sql, i + 1, ch, false);
      tokens.push(makeToken("ident", value));
      i = end;
      continue;
    }
    if (ch === "[") {
      const { value, end } = readQuoted(sql, i + 1, "]", false);
      tokens.push(makeToken("ident", value));
      i = end;
      continue;
    }
    if (ch === "$") {
      // Cadenas dollar-quoted de PostgreSQL: $$...$$ o $tag$...$tag$
      const tagMatch = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (tagMatch) {
        const tag = tagMatch[0];
        const end = sql.indexOf(tag, i + tag.length);
        const stop = end < 0 ? sql.length : end;
        tokens.push(makeToken("string", sql.slice(i + tag.length, stop)));
        i = end < 0 ? sql.length : end + tag.length;
        continue;
      }
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(sql[i + 1] ?? ""))) {
      const match = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(sql.slice(i));
      const text = match ? match[0] : ch;
      tokens.push(makeToken("number", text));
      i += text.length;
      continue;
    }
    if (/[A-Za-z_À-￿@]/.test(ch)) {
      const match = /^[A-Za-z_À-￿@][\w$#@À-￿]*/.exec(sql.slice(i));
      const word = match ? match[0] : ch;
      // Prefijos de cadena: N'..' (SQL Server), E'..' (PostgreSQL), _utf8mb4'..' (MySQL)
      if (sql[i + word.length] === "'" && /^(N|E|B|X|_\w+)$/i.test(word)) {
        const { value, end } = readQuoted(sql, i + word.length + 1, "'", true);
        tokens.push(makeToken("string", value));
        i = end;
        continue;
      }
      tokens.push(makeToken("word", word));
      i += word.length;
      continue;
    }
    if (ch === ":" && sql[i + 1] === ":") {
      tokens.push(makeToken("punct", "::"));
      i += 2;
      continue;
    }
    tokens.push(makeToken("punct", ch));
    i += 1;
  }
  return tokens;
}

/* ------------------------------------------------------------------ */
/* Cursor                                                              */
/* ------------------------------------------------------------------ */

class Cursor {
  pos = 0;
  readonly tokens: Token[];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  get atEnd(): boolean {
    return this.pos >= this.tokens.length;
  }

  peek(offset = 0): Token | undefined {
    return this.tokens[this.pos + offset];
  }

  next(): Token | undefined {
    const token = this.tokens[this.pos];
    this.pos += 1;
    return token;
  }

  isKw(...words: string[]): boolean {
    return words.every((word, index) => {
      const token = this.peek(index);
      return token?.kind === "word" && token.upper === word;
    });
  }

  acceptKw(...words: string[]): boolean {
    if (!this.isKw(...words)) return false;
    this.pos += words.length;
    return true;
  }

  isPunct(value: string, offset = 0): boolean {
    const token = this.peek(offset);
    return token?.kind === "punct" && token.value === value;
  }

  acceptPunct(value: string): boolean {
    if (!this.isPunct(value)) return false;
    this.pos += 1;
    return true;
  }

  /** Con el cursor en "(", devuelve los tokens interiores y avanza tras el ")" correspondiente. */
  readGroup(): Token[] {
    if (!this.isPunct("(")) return [];
    const start = this.pos + 1;
    let depth = 0;
    while (!this.atEnd) {
      const token = this.next();
      if (token?.kind !== "punct") continue;
      if (token.value === "(") depth += 1;
      else if (token.value === ")") {
        depth -= 1;
        if (depth === 0) return this.tokens.slice(start, this.pos - 1);
      }
    }
    return this.tokens.slice(start);
  }

  skipGroupIfAny(): void {
    if (this.isPunct("(")) this.readGroup();
  }

  /** Lee un nombre posiblemente cualificado (schema.tabla) y devuelve la ultima parte. */
  readName(): string | null {
    const token = this.peek();
    if (!token || (token.kind !== "word" && token.kind !== "ident")) return null;
    this.pos += 1;
    let name = token.value;
    while (this.isPunct(".") && (this.peek(1)?.kind === "word" || this.peek(1)?.kind === "ident")) {
      this.pos += 1;
      name = this.next()?.value ?? name;
    }
    return name;
  }
}

function splitTopLevel(tokens: Token[], separator = ","): Token[][] {
  const parts: Token[][] = [];
  let current: Token[] = [];
  let depth = 0;
  for (const token of tokens) {
    if (token.kind === "punct") {
      if (token.value === "(") depth += 1;
      else if (token.value === ")") depth -= 1;
      else if (token.value === separator && depth === 0) {
        parts.push(current);
        current = [];
        continue;
      }
    }
    current.push(token);
  }
  if (current.length > 0) parts.push(current);
  return parts;
}

function tokensToText(tokens: Token[]): string {
  let text = "";
  let previous: Token | undefined;
  for (const token of tokens) {
    const value =
      token.kind === "string" ? `'${token.value.replace(/'/g, "''")}'` : token.kind === "ident" ? `"${token.value}"` : token.value;
    const noSpaceBefore = token.kind === "punct" && [")", ",", ".", "(", "::"].includes(token.value);
    const noSpaceAfterPrevious = previous?.kind === "punct" && ["(", ".", "::", "-", "+"].includes(previous.value);
    const callParen = token.kind === "punct" && token.value === "(" && previous?.kind === "word";
    if (text && !noSpaceBefore && !noSpaceAfterPrevious && !callParen) text += " ";
    else if (text && token.kind === "punct" && token.value === "(" && previous?.kind === "punct" && previous.value === ",") text += " ";
    text += value;
    previous = token;
  }
  return text;
}

/** Lista de columnas "(a, b DESC, c(10))". Devuelve null si alguna es una expresion. */
function parseColumnList(tokens: Token[]): string[] | null {
  const names: string[] = [];
  for (const part of splitTopLevel(tokens)) {
    const first = part[0];
    if (!first || (first.kind !== "word" && first.kind !== "ident")) return null;
    const second = part[1];
    // `lower(email)` es una expresion; `email(20)` es prefijo de MySQL.
    if (second?.kind === "punct" && second.value === "(" && part.length > 2 && part[2].kind !== "number") return null;
    names.push(first.value);
  }
  return names;
}

/* ------------------------------------------------------------------ */
/* Modelo intermedio                                                   */
/* ------------------------------------------------------------------ */

interface ParsedColumn {
  name: string;
  type: DataType;
  enumValues?: string[];
  nullable: boolean;
  explicitNull: boolean;
  isPrimary: boolean;
  isUnique: boolean;
  isIndexed: boolean;
  autoIncrement: boolean;
  defaultValue?: string;
}

interface ParsedTable {
  name: string;
  columns: ParsedColumn[];
  hasTablePrimaryKey: boolean;
}

interface PendingForeignKey {
  fromTable: string;
  fromColumns: string[];
  toTable: string;
  toColumns: string[];
  onDelete: FkReferentialAction;
  onUpdate: FkReferentialAction;
}

export interface SqlImportResult {
  tables: Table[];
  relations: Relation[];
  warnings: string[];
}

interface ParseContext {
  tables: Map<string, ParsedTable>;
  order: string[];
  enumTypes: Map<string, string[]>;
  foreignKeys: PendingForeignKey[];
  warnings: string[];
}

const key = (name: string) => name.toLowerCase();

function findColumn(table: ParsedTable, name: string): ParsedColumn | undefined {
  return table.columns.find((column) => key(column.name) === key(name));
}

/* ------------------------------------------------------------------ */
/* Tipos                                                               */
/* ------------------------------------------------------------------ */

interface TypeInfo {
  type: DataType;
  enumValues?: string[];
  autoIncrement?: boolean;
}

function readTypeName(cursor: Cursor): { name: string; args: Token[] } | null {
  const first = cursor.peek();
  if (!first || (first.kind !== "word" && first.kind !== "ident")) return null;
  let name = cursor.readName() ?? "";
  name = name.toUpperCase();
  const multiword: Array<[string, string[]]> = [
    ["DOUBLE", ["PRECISION"]],
    ["CHARACTER", ["VARYING"]],
    ["CHAR", ["VARYING"]],
    ["BIT", ["VARYING"]],
    ["NATIONAL", ["CHARACTER", "VARYING"]],
    ["NATIONAL", ["CHAR", "VARYING"]],
    ["NATIONAL", ["CHARACTER"]],
    ["NATIONAL", ["CHAR"]],
    ["LONG", ["VARCHAR"]],
    ["LONG", ["VARBINARY"]],
  ];
  for (const [head, tail] of multiword) {
    if (name === head && cursor.acceptKw(...tail)) {
      name = `${head} ${tail.join(" ")}`;
      break;
    }
  }
  const args = cursor.isPunct("(") ? cursor.readGroup() : [];
  if ((name === "TIMESTAMP" || name === "TIME") && cursor.isKw("WITH", "TIME", "ZONE")) {
    cursor.pos += 3;
    name = `${name} WITH TIME ZONE`;
  } else if ((name === "TIMESTAMP" || name === "TIME") && cursor.isKw("WITHOUT", "TIME", "ZONE")) {
    cursor.pos += 3;
  }
  while (cursor.acceptKw("UNSIGNED") || cursor.acceptKw("SIGNED") || cursor.acceptKw("ZEROFILL")) {
    // modificadores numericos de MySQL: no se modelan
  }
  // Arrays de PostgreSQL: int[] / int ARRAY
  while (cursor.isPunct("[") && cursor.isPunct("]", 1)) cursor.pos += 2;
  cursor.acceptKw("ARRAY");
  return { name, args };
}

const KNOWN_TYPE_NAMES = new Set(
  (
    "INT INTEGER INT4 MEDIUMINT SMALLINT INT2 TINYINT BIGINT INT8 SERIAL SERIAL4 SMALLSERIAL SERIAL2 BIGSERIAL SERIAL8 " +
    "DECIMAL DEC FIXED NUMERIC MONEY SMALLMONEY FLOAT REAL FLOAT4 DOUBLE FLOAT8 CHAR CHARACTER NCHAR BPCHAR NATIONAL " +
    "VARCHAR NVARCHAR VARCHAR2 NVARCHAR2 LONG TEXT NTEXT CLOB CITEXT STRING TINYTEXT MEDIUMTEXT LONGTEXT BOOLEAN BOOL BIT " +
    "VARBIT DATE TIME TIMETZ DATETIME DATETIME2 SMALLDATETIME TIMESTAMP TIMESTAMPTZ DATETIMEOFFSET YEAR INTERVAL JSON JSONB " +
    "BINARY VARBINARY BLOB IMAGE TINYBLOB MEDIUMBLOB LONGBLOB BYTEA INET CIDR MACADDR MACADDR8 XML GEOMETRY GEOGRAPHY " +
    "POINT UUID UNIQUEIDENTIFIER ENUM SET"
  ).split(" "),
);

function mapSqlType(name: string, args: Token[], ctx: ParseContext, location: string): TypeInfo {
  const firstArg = args[0];
  const argUpper = firstArg?.kind === "word" ? firstArg.upper : firstArg?.value;
  const isMax = argUpper === "MAX";
  const userEnum = ctx.enumTypes.get(key(name));
  if (userEnum) return { type: "enum", enumValues: [...userEnum] };

  switch (name) {
    case "INT":
    case "INTEGER":
    case "INT4":
      return { type: "integer" };
    case "MEDIUMINT":
      return { type: "mediumint" };
    case "SMALLINT":
    case "INT2":
      return { type: "smallint" };
    case "TINYINT":
      return { type: argUpper === "1" ? "boolean" : "tinyint" };
    case "BIGINT":
    case "INT8":
      return { type: "bigint" };
    case "SERIAL":
    case "SERIAL4":
    case "SMALLSERIAL":
    case "SERIAL2":
      return { type: "integer", autoIncrement: true };
    case "BIGSERIAL":
    case "SERIAL8":
      return { type: "bigint", autoIncrement: true };
    case "DECIMAL":
    case "DEC":
    case "FIXED":
      return { type: "decimal" };
    case "NUMERIC":
      return { type: "numeric" };
    case "MONEY":
    case "SMALLMONEY":
      return { type: "money" };
    case "FLOAT":
      return { type: firstArg?.kind === "number" && Number(firstArg.value) > 24 ? "double" : "float" };
    case "REAL":
    case "FLOAT4":
      return { type: "real" };
    case "DOUBLE":
    case "DOUBLE PRECISION":
    case "FLOAT8":
      return { type: "double" };
    case "CHAR":
    case "CHARACTER":
    case "NCHAR":
    case "BPCHAR":
    case "NATIONAL CHARACTER":
    case "NATIONAL CHAR":
      return { type: argUpper === "36" ? "uuid" : "char" };
    case "VARCHAR":
    case "NVARCHAR":
    case "VARCHAR2":
    case "NVARCHAR2":
    case "CHARACTER VARYING":
    case "CHAR VARYING":
    case "NATIONAL CHARACTER VARYING":
    case "NATIONAL CHAR VARYING":
    case "LONG VARCHAR":
      return { type: isMax ? "text" : "varchar" };
    case "TEXT":
    case "NTEXT":
    case "CLOB":
    case "CITEXT":
    case "STRING":
      return { type: "text" };
    case "TINYTEXT":
      return { type: "tinytext" };
    case "MEDIUMTEXT":
      return { type: "mediumtext" };
    case "LONGTEXT":
      return { type: "longtext" };
    case "BOOLEAN":
    case "BOOL":
      return { type: "boolean" };
    case "BIT":
      return { type: !firstArg || argUpper === "1" ? "boolean" : "bit" };
    case "BIT VARYING":
    case "VARBIT":
      return { type: "bit" };
    case "DATE":
      return { type: "date" };
    case "TIME":
    case "TIMETZ":
    case "TIME WITH TIME ZONE":
      return { type: "time" };
    case "DATETIME":
    case "DATETIME2":
    case "SMALLDATETIME":
      return { type: "datetime" };
    case "TIMESTAMP":
      return { type: "timestamp" };
    case "TIMESTAMPTZ":
    case "TIMESTAMP WITH TIME ZONE":
    case "DATETIMEOFFSET":
      return { type: "timestamptz" };
    case "YEAR":
      return { type: "year" };
    case "INTERVAL":
      return { type: "interval" };
    case "JSON":
      return { type: "json" };
    case "JSONB":
      return { type: "jsonb" };
    case "BINARY":
      return { type: "binary" };
    case "VARBINARY":
    case "LONG VARBINARY":
      return { type: isMax ? "blob" : "varbinary" };
    case "BLOB":
    case "IMAGE":
      return { type: "blob" };
    case "TINYBLOB":
      return { type: "tinyblob" };
    case "MEDIUMBLOB":
      return { type: "mediumblob" };
    case "LONGBLOB":
      return { type: "longblob" };
    case "BYTEA":
      return { type: "bytea" };
    case "INET":
      return { type: "inet" };
    case "CIDR":
      return { type: "cidr" };
    case "MACADDR":
    case "MACADDR8":
      return { type: "macaddr" };
    case "XML":
      return { type: "xml" };
    case "GEOMETRY":
    case "GEOGRAPHY":
      return { type: "geometry" };
    case "POINT":
      return { type: "point" };
    case "UUID":
    case "UNIQUEIDENTIFIER":
      return { type: "uuid" };
    case "ENUM":
      return {
        type: "enum",
        enumValues: args.filter((token) => token.kind === "string").map((token) => token.value),
      };
    default:
      ctx.warnings.push(`${location}: tipo "${name}" no reconocido, se importa como text.`);
      return { type: "text" };
  }
}

/* ------------------------------------------------------------------ */
/* Columnas y restricciones                                            */
/* ------------------------------------------------------------------ */

function readReferentialAction(cursor: Cursor): FkReferentialAction {
  const candidates: FkReferentialAction[] = ["NO ACTION", "RESTRICT", "CASCADE", "SET NULL", "SET DEFAULT"];
  for (const action of candidates) {
    if (cursor.acceptKw(...action.split(" "))) return action;
  }
  cursor.next();
  return "NO ACTION";
}

function readReferences(cursor: Cursor): { table: string; columns: string[]; onDelete: FkReferentialAction; onUpdate: FkReferentialAction } | null {
  const table = cursor.readName();
  if (!table) return null;
  const columns = cursor.isPunct("(") ? (parseColumnList(cursor.readGroup()) ?? []) : [];
  let onDelete: FkReferentialAction = "NO ACTION";
  let onUpdate: FkReferentialAction = "NO ACTION";
  for (;;) {
    if (cursor.acceptKw("ON", "DELETE")) onDelete = readReferentialAction(cursor);
    else if (cursor.acceptKw("ON", "UPDATE")) onUpdate = readReferentialAction(cursor);
    else if (cursor.acceptKw("MATCH")) cursor.next();
    else if (cursor.acceptKw("NOT", "DEFERRABLE") || cursor.acceptKw("DEFERRABLE")) continue;
    else if (cursor.acceptKw("INITIALLY")) cursor.next();
    else if (cursor.acceptKw("NOT", "FOR", "REPLICATION")) continue;
    else break;
  }
  return { table, columns, onDelete, onUpdate };
}

/** Valores de un CHECK tipo `col IN ('a','b')` o `col = ANY (ARRAY['a','b'])`, si solo menciona `column`. */
function enumValuesFromCheck(tokens: Token[], column?: string): { column: string; values: string[] } | null {
  const hasIn = tokens.some((token) => token.kind === "word" && (token.upper === "IN" || token.upper === "ANY"));
  if (!hasIn) return null;
  const names = new Set(
    tokens
      .filter((token, index) => {
        if (token.kind === "ident") return true;
        if (token.kind !== "word") return false;
        const previous = tokens[index - 1];
        if (previous?.kind === "punct" && previous.value === "::") return false; // casts
        return !["IN", "ANY", "ARRAY", "TEXT", "VARCHAR", "CHARACTER", "VARYING", "AND", "OR", "NOT", "NULL", "IS"].includes(token.upper);
      })
      .map((token) => key(token.value)),
  );
  const target = column ?? [...names][0];
  if (!target || names.size !== 1 || !names.has(key(target))) return null;
  const values = tokens.filter((token) => token.kind === "string").map((token) => token.value);
  return values.length > 0 ? { column: target, values } : null;
}

/** true si el primer "(" cierra justo en el ultimo token: "((0))" si, "(a) + (b)" no. */
function wrapsWhole(tokens: Token[]): boolean {
  if (tokens.length < 2) return false;
  const first = tokens[0];
  const last = tokens[tokens.length - 1];
  if (first.kind !== "punct" || first.value !== "(" || last.kind !== "punct" || last.value !== ")") return false;
  let depth = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.kind !== "punct") continue;
    if (token.value === "(") depth += 1;
    else if (token.value === ")") {
      depth -= 1;
      if (depth === 0 && index < tokens.length - 1) return false;
    }
  }
  return true;
}

function readDefault(cursor: Cursor): { value?: string; isSequence: boolean } {
  const parts: Token[] = [];
  const first = cursor.peek();
  if (!first) return { isSequence: false };
  if (first.kind === "punct" && first.value === "(") {
    parts.push(...cursor.readGroup());
  } else if (first.kind === "punct" && (first.value === "-" || first.value === "+")) {
    parts.push(cursor.next() as Token);
    if (cursor.peek()) parts.push(cursor.next() as Token);
  } else {
    parts.push(cursor.next() as Token);
    if (first.kind === "word" && cursor.isPunct("(")) {
      parts.push({ kind: "punct", value: "(", upper: "" }, ...cursor.readGroup(), { kind: "punct", value: ")", upper: "" });
    }
  }
  // Casts de PostgreSQL: 'x'::character varying
  while (cursor.acceptPunct("::")) {
    readTypeName(cursor);
  }

  // Quitar parentesis exteriores: ((0)) de SQL Server, (UUID()) de MySQL.
  let inner = parts;
  while (wrapsWhole(inner)) inner = inner.slice(1, -1);
  // Quitar casts internos que vinieran dentro del grupo.
  const castIndex = inner.findIndex((token) => token.kind === "punct" && token.value === "::");
  if (castIndex > 0) inner = inner.slice(0, castIndex);

  const head = inner[0];
  if (!head) return { isSequence: false };
  if (head.kind === "word" && head.upper === "NEXTVAL") return { isSequence: true };
  if (inner.length === 1 && head.kind === "word" && head.upper === "NULL") return { isSequence: false };
  if (inner.length === 1 && head.kind === "string") return { value: `'${head.value.replace(/'/g, "''")}'`, isSequence: false };
  return { value: tokensToText(inner), isSequence: false };
}

function parseColumn(tokens: Token[], tableName: string, ctx: ParseContext, pendingChecks: Token[][]): ParsedColumn | null {
  const cursor = new Cursor(tokens);
  const nameToken = cursor.next();
  if (!nameToken || (nameToken.kind !== "word" && nameToken.kind !== "ident")) return null;
  const location = `${tableName}.${nameToken.value}`;
  const column: ParsedColumn = {
    name: nameToken.value,
    type: "text",
    nullable: true,
    explicitNull: false,
    isPrimary: false,
    isUnique: false,
    isIndexed: false,
    autoIncrement: false,
  };

  // Columna calculada de SQL Server: `total AS (a * b)`
  if (cursor.isKw("AS")) {
    ctx.warnings.push(`${location}: columna calculada, se importa como text.`);
    return column;
  }

  const typeName = readTypeName(cursor);
  if (typeName) {
    const info = mapSqlType(typeName.name, typeName.args, ctx, location);
    column.type = info.type;
    if (info.enumValues) column.enumValues = info.enumValues;
    if (info.autoIncrement) column.autoIncrement = true;
  }

  while (!cursor.atEnd) {
    if (cursor.acceptKw("NOT", "NULL")) {
      column.nullable = false;
    } else if (cursor.acceptKw("NULL")) {
      column.nullable = true;
      column.explicitNull = true;
    } else if (cursor.acceptKw("PRIMARY", "KEY")) {
      column.isPrimary = true;
      cursor.acceptKw("ASC");
      cursor.acceptKw("DESC");
      cursor.acceptKw("CLUSTERED");
      cursor.acceptKw("NONCLUSTERED");
      if (cursor.acceptKw("AUTOINCREMENT")) column.autoIncrement = true;
    } else if (cursor.acceptKw("UNIQUE")) {
      column.isUnique = true;
      cursor.acceptKw("KEY");
      cursor.acceptKw("CLUSTERED");
      cursor.acceptKw("NONCLUSTERED");
    } else if (cursor.acceptKw("KEY")) {
      column.isPrimary = true;
    } else if (cursor.acceptKw("AUTO_INCREMENT") || cursor.acceptKw("AUTOINCREMENT")) {
      column.autoIncrement = true;
    } else if (cursor.acceptKw("IDENTITY")) {
      column.autoIncrement = true;
      cursor.skipGroupIfAny();
    } else if (cursor.acceptKw("GENERATED")) {
      cursor.acceptKw("ALWAYS");
      cursor.acceptKw("BY", "DEFAULT");
      if (cursor.acceptKw("AS", "IDENTITY")) {
        column.autoIncrement = true;
        cursor.skipGroupIfAny();
      } else if (cursor.acceptKw("AS")) {
        cursor.skipGroupIfAny();
        ctx.warnings.push(`${location}: columna generada; se importa sin su expresion.`);
      }
    } else if (cursor.acceptKw("DEFAULT")) {
      const { value, isSequence } = readDefault(cursor);
      if (isSequence) column.autoIncrement = true;
      else if (value !== undefined) column.defaultValue = value;
    } else if (cursor.acceptKw("REFERENCES")) {
      const reference = readReferences(cursor);
      if (reference) {
        ctx.foreignKeys.push({
          fromTable: tableName,
          fromColumns: [column.name],
          toTable: reference.table,
          toColumns: reference.columns,
          onDelete: reference.onDelete,
          onUpdate: reference.onUpdate,
        });
      }
    } else if (cursor.acceptKw("CHECK")) {
      const check = cursor.readGroup();
      const detected = enumValuesFromCheck(check, column.name);
      if (detected) {
        column.type = "enum";
        column.enumValues = detected.values;
      } else {
        pendingChecks.push(check);
      }
    } else if (cursor.acceptKw("CONSTRAINT")) {
      cursor.readName();
    } else if (cursor.acceptKw("ON", "UPDATE")) {
      // MySQL: ON UPDATE CURRENT_TIMESTAMP
      cursor.next();
      cursor.skipGroupIfAny();
    } else {
      cursor.next();
      cursor.skipGroupIfAny();
    }
  }

  return column;
}

function applyTableConstraint(tokens: Token[], table: ParsedTable, ctx: ParseContext): void {
  const cursor = new Cursor(tokens);
  if (cursor.acceptKw("CONSTRAINT")) cursor.readName();

  const markColumns = (columns: string[] | null, label: string, apply: (column: ParsedColumn) => void) => {
    if (!columns) {
      ctx.warnings.push(`${table.name}: ${label} sobre una expresion, se ignora.`);
      return;
    }
    columns.forEach((name) => {
      const column = findColumn(table, name);
      if (column) apply(column);
      else ctx.warnings.push(`${table.name}: ${label} sobre la columna desconocida "${name}".`);
    });
  };

  if (cursor.acceptKw("PRIMARY", "KEY")) {
    cursor.acceptKw("CLUSTERED");
    cursor.acceptKw("NONCLUSTERED");
    const columns = parseColumnList(cursor.readGroup());
    table.hasTablePrimaryKey = true;
    markColumns(columns, "PRIMARY KEY", (column) => {
      column.isPrimary = true;
    });
    return;
  }

  if (cursor.acceptKw("UNIQUE")) {
    if (!cursor.acceptKw("KEY")) cursor.acceptKw("INDEX");
    cursor.acceptKw("CLUSTERED");
    cursor.acceptKw("NONCLUSTERED");
    if (!cursor.isPunct("(")) cursor.readName();
    const columns = parseColumnList(cursor.readGroup());
    if (columns && columns.length > 1) {
      ctx.warnings.push(`${table.name}: UNIQUE compuesto (${columns.join(", ")}) no soportado; se marcan las columnas como indexadas.`);
      markColumns(columns, "UNIQUE", (column) => {
        column.isIndexed = true;
      });
      return;
    }
    markColumns(columns, "UNIQUE", (column) => {
      column.isUnique = true;
    });
    return;
  }

  if (cursor.isKw("KEY") || cursor.isKw("INDEX")) {
    cursor.next();
    if (!cursor.isPunct("(")) cursor.readName();
    const columns = parseColumnList(cursor.readGroup());
    markColumns(columns, "INDEX", (column) => {
      column.isIndexed = true;
    });
    if (columns && columns.length > 1) {
      ctx.warnings.push(`${table.name}: indice compuesto (${columns.join(", ")}) se importa como indices individuales.`);
    }
    return;
  }

  if (cursor.acceptKw("FOREIGN", "KEY")) {
    if (!cursor.isPunct("(")) cursor.readName();
    const fromColumns = parseColumnList(cursor.readGroup()) ?? [];
    if (!cursor.acceptKw("REFERENCES")) return;
    const reference = readReferences(cursor);
    if (!reference) return;
    ctx.foreignKeys.push({
      fromTable: table.name,
      fromColumns,
      toTable: reference.table,
      toColumns: reference.columns,
      onDelete: reference.onDelete,
      onUpdate: reference.onUpdate,
    });
    return;
  }

  if (cursor.acceptKw("CHECK")) {
    const detected = enumValuesFromCheck(cursor.readGroup());
    const column = detected ? findColumn(table, detected.column) : undefined;
    if (detected && column) {
      column.type = "enum";
      column.enumValues = detected.values;
    }
  }
  // FULLTEXT, SPATIAL, EXCLUDE...: no se modelan
}

function isTableConstraint(tokens: Token[]): boolean {
  const first = tokens[0];
  if (!first || first.kind !== "word") return false;
  if (["CONSTRAINT", "PRIMARY", "FOREIGN", "CHECK", "FULLTEXT", "SPATIAL", "EXCLUDE", "PERIOD", "LIKE"].includes(first.upper)) {
    return true;
  }
  const second = tokens[1];
  if (first.upper === "UNIQUE") return true;
  // MySQL: KEY idx (col) / INDEX idx (col); una columna llamada "key" iria seguida de un tipo.
  if (first.upper === "KEY" || first.upper === "INDEX") {
    if (second?.kind === "punct") return second.value === "(";
    const third = tokens[2];
    const secondIsType = second?.kind === "word" && KNOWN_TYPE_NAMES.has(second.upper);
    return !secondIsType && third?.kind === "punct" && third.value === "(";
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Sentencias                                                          */
/* ------------------------------------------------------------------ */

function parseCreateTable(cursor: Cursor, ctx: ParseContext): void {
  cursor.acceptKw("IF", "NOT", "EXISTS");
  const name = cursor.readName();
  if (!name) return;
  if (!cursor.isPunct("(")) {
    ctx.warnings.push(`${name}: CREATE TABLE sin lista de columnas (AS SELECT / LIKE), se ignora.`);
    return;
  }
  if (ctx.tables.has(key(name))) {
    ctx.warnings.push(`${name}: tabla duplicada en el script, se usa la primera definicion.`);
    cursor.readGroup();
    return;
  }
  const table: ParsedTable = { name, columns: [], hasTablePrimaryKey: false };
  const items = splitTopLevel(cursor.readGroup());
  const constraints: Token[][] = [];
  const pendingChecks: Token[][] = [];
  for (const item of items) {
    if (item.length === 0) continue;
    if (isTableConstraint(item)) {
      constraints.push(item);
      continue;
    }
    const column = parseColumn(item, name, ctx, pendingChecks);
    if (column) table.columns.push(column);
  }
  ctx.tables.set(key(name), table);
  ctx.order.push(key(name));
  constraints.forEach((constraint) => applyTableConstraint(constraint, table, ctx));
  pendingChecks.forEach((check) => applyTableConstraint([makeToken("word", "CHECK"), makeToken("punct", "("), ...check, makeToken("punct", ")")], table, ctx));
}

function parseCreateIndex(cursor: Cursor, unique: boolean, ctx: ParseContext): void {
  cursor.acceptKw("CONCURRENTLY");
  cursor.acceptKw("IF", "NOT", "EXISTS");
  if (!cursor.isKw("ON")) cursor.readName();
  if (!cursor.acceptKw("ON")) return;
  cursor.acceptKw("ONLY");
  const tableName = cursor.readName();
  if (!tableName) return;
  if (cursor.acceptKw("USING")) cursor.next();
  const columns = parseColumnList(cursor.readGroup());
  const table = ctx.tables.get(key(tableName));
  if (!table) {
    ctx.warnings.push(`Indice sobre la tabla desconocida "${tableName}", se ignora.`);
    return;
  }
  if (!columns) {
    ctx.warnings.push(`${tableName}: indice sobre una expresion, se ignora.`);
    return;
  }
  if (columns.length > 1) {
    ctx.warnings.push(
      `${tableName}: indice${unique ? " UNIQUE" : ""} compuesto (${columns.join(", ")}) se importa como indices individuales.`,
    );
  }
  columns.forEach((name) => {
    const column = findColumn(table, name);
    if (!column) return;
    if (unique && columns.length === 1) column.isUnique = true;
    else column.isIndexed = true;
  });
}

function parseCreateType(cursor: Cursor, ctx: ParseContext): void {
  const name = cursor.readName();
  if (!name || !cursor.acceptKw("AS", "ENUM")) return;
  const values = cursor.readGroup().filter((token) => token.kind === "string").map((token) => token.value);
  ctx.enumTypes.set(key(name), values);
}

function parseAlterTable(statement: Token[], ctx: ParseContext): void {
  const cursor = new Cursor(statement);
  cursor.acceptKw("IF", "EXISTS");
  cursor.acceptKw("ONLY");
  const tableName = cursor.readName();
  if (!tableName) return;
  const table = ctx.tables.get(key(tableName));
  if (!table) {
    ctx.warnings.push(`ALTER TABLE sobre la tabla desconocida "${tableName}", se ignora.`);
    return;
  }
  // SQL Server: ALTER TABLE x WITH CHECK ADD CONSTRAINT ...
  if (cursor.acceptKw("WITH", "CHECK") || cursor.acceptKw("WITH", "NOCHECK")) {
    // nada
  }
  const rest = statement.slice(cursor.pos);
  for (const action of splitTopLevel(rest)) {
    const actionCursor = new Cursor(action);
    if (actionCursor.acceptKw("ADD")) {
      const body = action.slice(actionCursor.pos);
      if (actionCursor.acceptKw("COLUMN") || !isTableConstraint(body)) {
        actionCursor.acceptKw("IF", "NOT", "EXISTS");
        const column = parseColumn(action.slice(actionCursor.pos), table.name, ctx, []);
        if (column && !findColumn(table, column.name)) table.columns.push(column);
      } else {
        applyTableConstraint(body, table, ctx);
      }
    } else if (actionCursor.acceptKw("ALTER")) {
      actionCursor.acceptKw("COLUMN");
      const columnName = actionCursor.readName();
      const column = columnName ? findColumn(table, columnName) : undefined;
      if (!column) continue;
      if (actionCursor.acceptKw("SET", "DEFAULT")) {
        const { value, isSequence } = readDefault(actionCursor);
        if (isSequence) column.autoIncrement = true;
        else if (value !== undefined) column.defaultValue = value;
      } else if (actionCursor.acceptKw("ADD", "GENERATED")) {
        column.autoIncrement = true;
      } else if (actionCursor.acceptKw("SET", "NOT", "NULL")) {
        column.nullable = false;
      }
    }
  }
}

/** Tokens de una sentencia hasta ";" o GO al nivel superior. */
function readStatement(cursor: Cursor): Token[] {
  const start = cursor.pos;
  let depth = 0;
  while (!cursor.atEnd) {
    const token = cursor.peek() as Token;
    if (token.kind === "punct") {
      if (token.value === "(") depth += 1;
      else if (token.value === ")") depth -= 1;
      else if (token.value === ";" && depth <= 0) break;
    } else if (token.kind === "word" && depth <= 0 && token.upper === "GO") {
      break;
    }
    cursor.pos += 1;
  }
  return cursor.tokens.slice(start, cursor.pos);
}

/* ------------------------------------------------------------------ */
/* Construccion del proyecto                                           */
/* ------------------------------------------------------------------ */

function toField(column: ParsedColumn, singlePrimaryKey: boolean): Field {
  let type = column.type;
  let autoIncrement = column.autoIncrement;
  const integerLike = ["integer", "smallint", "mediumint", "tinyint", "bigint"].includes(type);
  if (autoIncrement && !integerLike) autoIncrement = false;
  if (autoIncrement && column.isPrimary && singlePrimaryKey) {
    type = type === "bigint" ? "bigserial" : "id";
  }
  const nullable = column.isPrimary || autoIncrement ? false : column.nullable;
  return normalizeField({
    id: generateId("fld"),
    name: column.name,
    type,
    nullable,
    isPrimary: column.isPrimary,
    isUnique: column.isUnique,
    autoIncrement,
    isIndexed: column.isIndexed,
    ...(column.defaultValue !== undefined && !autoIncrement ? { defaultValue: column.defaultValue } : {}),
    ...(type === "enum" ? { enumValues: column.enumValues ?? [] } : {}),
  });
}

/** Coloca las tablas en rejilla, primero las referenciadas, para que el diagrama sea legible. */
export function layoutImportedTables(tables: Table[], relations: Relation[]): Table[] {
  if (tables.length === 0) return tables;
  const dependsOn = new Map<string, Set<string>>(tables.map((table) => [table.id, new Set()]));
  relations.forEach((relation) => {
    if (relation.fromTableId !== relation.toTableId) dependsOn.get(relation.fromTableId)?.add(relation.toTableId);
  });
  const ordered: Table[] = [];
  const placed = new Set<string>();
  const pending = [...tables];
  while (pending.length > 0) {
    let index = pending.findIndex((table) => [...(dependsOn.get(table.id) ?? [])].every((dep) => placed.has(dep)));
    if (index < 0) index = 0;
    const [table] = pending.splice(index, 1);
    ordered.push(table);
    placed.add(table.id);
  }

  const columns = Math.max(1, Math.ceil(Math.sqrt(ordered.length)));
  const gapX = 90;
  const gapY = 70;
  const columnWidths = new Array<number>(columns).fill(0);
  const rowHeights: number[] = [];
  ordered.forEach((table, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    columnWidths[column] = Math.max(columnWidths[column], estimateTableWidth(table));
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, getTableHeight(table));
  });
  const columnX = columnWidths.map((_, column) =>
    columnWidths.slice(0, column).reduce((sum, width) => sum + width + gapX, TABLE_ORIGIN_PADDING),
  );
  const rowY = rowHeights.map((_, row) => rowHeights.slice(0, row).reduce((sum, height) => sum + height + gapY, TABLE_ORIGIN_PADDING));
  const positions = new Map(
    ordered.map((table, index) => [table.id, { x: columnX[index % columns], y: rowY[Math.floor(index / columns)] }]),
  );
  return tables.map((table) => ({ ...table, ...(positions.get(table.id) ?? { x: TABLE_ORIGIN_PADDING, y: TABLE_ORIGIN_PADDING }) }));
}

/**
 * Convierte un script DDL (MySQL, PostgreSQL o SQL Server) en tablas y relaciones.
 * Soporta CREATE TABLE, CREATE INDEX, CREATE TYPE ... AS ENUM y ALTER TABLE ADD/ALTER;
 * el resto de sentencias se ignoran.
 */
export function parseSqlSchema(sql: string): SqlImportResult {
  const ctx: ParseContext = {
    tables: new Map(),
    order: [],
    enumTypes: new Map(),
    foreignKeys: [],
    warnings: [],
  };
  const cursor = new Cursor(tokenizeSql(sql));

  while (!cursor.atEnd) {
    if (cursor.acceptKw("CREATE")) {
      cursor.acceptKw("OR", "REPLACE");
      while (
        cursor.acceptKw("TEMPORARY") ||
        cursor.acceptKw("TEMP") ||
        cursor.acceptKw("GLOBAL") ||
        cursor.acceptKw("LOCAL") ||
        cursor.acceptKw("UNLOGGED")
      ) {
        // modificadores de tabla
      }
      if (cursor.acceptKw("TABLE")) {
        parseCreateTable(cursor, ctx);
      } else if (cursor.acceptKw("TYPE")) {
        parseCreateType(cursor, ctx);
      } else {
        const unique = cursor.acceptKw("UNIQUE");
        cursor.acceptKw("CLUSTERED");
        cursor.acceptKw("NONCLUSTERED");
        if (cursor.acceptKw("INDEX")) parseCreateIndex(cursor, unique, ctx);
      }
      continue;
    }
    if (cursor.acceptKw("ALTER", "TABLE")) {
      parseAlterTable(readStatement(cursor), ctx);
      continue;
    }
    cursor.pos += 1;
  }

  // Tablas y campos definitivos
  const tables: Table[] = [];
  const fieldByKey = new Map<string, { table: Table; field: Field }>();
  const tableByKey = new Map<string, Table>();
  ctx.order.forEach((tableKey) => {
    const parsed = ctx.tables.get(tableKey);
    if (!parsed) return;
    const primaryCount = parsed.columns.filter((column) => column.isPrimary).length;
    if (primaryCount > 1) {
      ctx.warnings.push(
        `${parsed.name}: clave primaria compuesta (${parsed.columns.filter((c) => c.isPrimary).map((c) => c.name).join(", ")}); se conserva, pero al editar un campo PK en la app quedara una sola.`,
      );
    }
    const table: Table = {
      id: generateId("tbl"),
      name: parsed.name,
      fields: parsed.columns.map((column) => toField(column, primaryCount === 1)),
      x: 0,
      y: 0,
    };
    tables.push(table);
    tableByKey.set(tableKey, table);
    table.fields.forEach((field) => fieldByKey.set(`${tableKey}.${key(field.name)}`, { table, field }));
  });

  // Relaciones
  const relations: Relation[] = [];
  const relationIds = new Set<string>();
  ctx.foreignKeys.forEach((fk) => {
    const fromTable = tableByKey.get(key(fk.fromTable));
    const toTable = tableByKey.get(key(fk.toTable));
    if (!fromTable || !toTable) {
      ctx.warnings.push(`FK ${fk.fromTable} -> ${fk.toTable}: tabla no encontrada en el script, se ignora.`);
      return;
    }
    let toColumns = fk.toColumns;
    if (toColumns.length === 0) toColumns = toTable.fields.filter((field) => field.isPrimary).map((field) => field.name);
    if (toColumns.length !== fk.fromColumns.length) {
      ctx.warnings.push(`FK ${fk.fromTable} -> ${fk.toTable}: numero de columnas distinto, se ignora.`);
      return;
    }
    if (fk.fromColumns.length > 1) {
      ctx.warnings.push(`FK compuesta ${fk.fromTable} (${fk.fromColumns.join(", ")}) -> ${fk.toTable}: se importa como una relacion por columna.`);
    }
    fk.fromColumns.forEach((fromColumn, index) => {
      const from = fieldByKey.get(`${key(fk.fromTable)}.${key(fromColumn)}`);
      const to = fieldByKey.get(`${key(fk.toTable)}.${key(toColumns[index])}`);
      if (!from || !to) {
        ctx.warnings.push(`FK ${fk.fromTable}.${fromColumn} -> ${fk.toTable}.${toColumns[index]}: columna no encontrada, se ignora.`);
        return;
      }
      const id = buildRelationId(from.table.id, from.field.id, to.table.id, to.field.id);
      if (relationIds.has(id)) return;
      relationIds.add(id);
      const singlePk = from.table.fields.filter((field) => field.isPrimary).length === 1;
      const isOneToOne = (from.field.isUnique && !from.field.isPrimary) || (from.field.isPrimary && singlePk);
      relations.push({
        id,
        fromTableId: from.table.id,
        fromFieldId: from.field.id,
        toTableId: to.table.id,
        toFieldId: to.field.id,
        kind: isOneToOne ? "1:1" : "1:N",
        onDelete: isFkReferentialAction(fk.onDelete) ? fk.onDelete : "NO ACTION",
        onUpdate: isFkReferentialAction(fk.onUpdate) ? fk.onUpdate : "NO ACTION",
      });
    });
  });

  return {
    tables: layoutImportedTables(tables, relations),
    relations,
    warnings: [...new Set(ctx.warnings)],
  };
}
