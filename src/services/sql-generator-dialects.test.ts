import { describe, expect, it } from "vitest";
import type { Field, Relation, Table } from "../domain/types.ts";
import { generateSql, orderTablesByDependencies, quoteIdentifier } from "./sql-generator.ts";

function field(id: string, name: string, overrides: Partial<Field> = {}): Field {
  return {
    id,
    name,
    type: "integer",
    nullable: false,
    isPrimary: false,
    isUnique: false,
    autoIncrement: false,
    isIndexed: false,
    ...overrides,
  };
}

function pk(id: string): Field {
  return field(id, "id", { type: "id", isPrimary: true, isUnique: true, autoIncrement: true, isIndexed: true });
}

function table(id: string, name: string, fields: Field[]): Table {
  return { id, name, fields, x: 0, y: 0 };
}

function rel(id: string, from: [string, string], to: [string, string], overrides: Partial<Relation> = {}): Relation {
  return {
    id,
    fromTableId: from[0],
    fromFieldId: from[1],
    toTableId: to[0],
    toFieldId: to[1],
    kind: "1:N",
    onDelete: "NO ACTION",
    onUpdate: "NO ACTION",
    ...overrides,
  };
}

const posts = table("tp", "posts", [pk("tp_id"), field("tp_user", "user_id", { isIndexed: true })]);
const users = table("tu", "users", [pk("tu_id")]);
const postsToUsers = rel("r1", ["tp", "tp_user"], ["tu", "tu_id"]);

describe("orden de creacion", () => {
  it("crea primero las tablas referenciadas", () => {
    const ordered = orderTablesByDependencies([posts, users], [postsToUsers]);
    expect(ordered.map((item) => item.name)).toEqual(["users", "posts"]);
  });

  it.each(["mysql", "postgresql", "sqlserver"] as const)("emite users antes que posts en %s", (dialect) => {
    const sql = generateSql({ tables: [posts, users], relations: [postsToUsers] }, dialect);
    const usersIndex = sql.indexOf(`CREATE TABLE ${dialect === "sqlserver" ? "" : "IF NOT EXISTS "}${quoteIdentifier("users", dialect)}`);
    const postsIndex = sql.indexOf(`CREATE TABLE ${dialect === "sqlserver" ? "" : "IF NOT EXISTS "}${quoteIdentifier("posts", dialect)}`);
    expect(usersIndex).toBeGreaterThanOrEqual(0);
    expect(postsIndex).toBeGreaterThan(usersIndex);
    expect(sql).not.toContain("ALTER TABLE");
  });

  it("rompe ciclos con ALTER TABLE al final", () => {
    const a = table("ta", "a", [pk("ta_id"), field("ta_b", "b_id", { nullable: true })]);
    const b = table("tb", "b", [pk("tb_id"), field("tb_a", "a_id", { nullable: true })]);
    const sql = generateSql(
      { tables: [a, b], relations: [rel("r1", ["ta", "ta_b"], ["tb", "tb_id"]), rel("r2", ["tb", "tb_a"], ["ta", "ta_id"])] },
      "postgresql",
    );
    expect(sql).toContain('ALTER TABLE "a" ADD CONSTRAINT "fk_a_b_id" FOREIGN KEY ("b_id") REFERENCES "b" ("id")');
    expect(sql.indexOf('ALTER TABLE "a"')).toBeGreaterThan(sql.indexOf('CREATE TABLE IF NOT EXISTS "b"'));
    expect(sql).toContain("referencias circulares");
  });

  it("mantiene inline las autorreferencias", () => {
    const employees = table("te", "employees", [pk("te_id"), field("te_boss", "boss_id", { nullable: true })]);
    const sql = generateSql({ tables: [employees], relations: [rel("r1", ["te", "te_boss"], ["te", "te_id"])] }, "mysql");
    expect(sql).toContain("CONSTRAINT `fk_employees_boss_id` FOREIGN KEY (`boss_id`) REFERENCES `employees` (`id`)");
    expect(sql).not.toContain("ALTER TABLE");
  });
});

describe("correcciones por dialecto", () => {
  it("escapa identificadores en MySQL y SQL Server", () => {
    expect(quoteIdentifier("a`b", "mysql")).toBe("`a``b`");
    expect(quoteIdentifier("a]b", "sqlserver")).toBe("[a]]b]");
  });

  it("usa OBJECT_ID con el nombre escapado en SQL Server", () => {
    const sql = generateSql({ tables: [table("t", "o'brien", [pk("t_id")])], relations: [] }, "sqlserver");
    expect(sql).toContain("IF OBJECT_ID(N'[o''brien]', N'U') IS NULL");
    expect(sql).not.toContain("sysobjects");
  });

  it("traduce RESTRICT a NO ACTION en SQL Server", () => {
    const sql = generateSql(
      { tables: [posts, users], relations: [{ ...postsToUsers, onDelete: "RESTRICT", onUpdate: "CASCADE" }] },
      "sqlserver",
    );
    expect(sql).toContain("ON DELETE NO ACTION ON UPDATE CASCADE");
    expect(sql).not.toContain("RESTRICT");
  });

  it("evita SET DEFAULT en MySQL y lo anota", () => {
    const sql = generateSql({ tables: [posts, users], relations: [{ ...postsToUsers, onDelete: "SET DEFAULT" }] }, "mysql");
    expect(sql).toContain("ON DELETE NO ACTION");
    expect(sql).toContain("no soporta SET DEFAULT");
    const pg = generateSql({ tables: [posts, users], relations: [{ ...postsToUsers, onDelete: "SET DEFAULT" }] }, "postgresql");
    expect(pg).toContain("ON DELETE SET DEFAULT");
  });

  it("nombra las claves foraneas", () => {
    const sql = generateSql({ tables: [posts, users], relations: [postsToUsers] }, "postgresql");
    expect(sql).toContain('CONSTRAINT "fk_posts_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id")');
  });

  it("usa tipos indexables para columnas text en claves", () => {
    const accounts = table("ta", "accounts", [pk("ta_id"), field("ta_email", "email", { type: "text", isUnique: true, isIndexed: true })]);
    expect(generateSql({ tables: [accounts], relations: [] }, "mysql")).toContain("`email` VARCHAR(255) NOT NULL");
    expect(generateSql({ tables: [accounts], relations: [] }, "sqlserver")).toContain("[email] NVARCHAR(450) NOT NULL");
    expect(generateSql({ tables: [accounts], relations: [] }, "postgresql")).toContain('"email" TEXT NOT NULL');
  });

  it("adapta valores por defecto por motor", () => {
    const flags = table("tf", "flags", [
      pk("tf_id"),
      field("tf_on", "enabled", { type: "boolean", defaultValue: "TRUE" }),
      field("tf_at", "created_at", { type: "timestamp", defaultValue: "NOW()" }),
    ]);
    const sqlserver = generateSql({ tables: [flags], relations: [] }, "sqlserver");
    expect(sqlserver).toContain("[enabled] BIT NOT NULL DEFAULT 1");
    expect(sqlserver).toContain("[created_at] DATETIME2 NOT NULL DEFAULT GETDATE()");
    expect(generateSql({ tables: [flags], relations: [] }, "postgresql")).toContain('"enabled" BOOLEAN NOT NULL DEFAULT TRUE');
  });

  it("anade UNIQUE a la FK de una relacion 1:1", () => {
    const profiles = table("tpr", "profiles", [pk("tpr_id"), field("tpr_user", "user_id")]);
    const sql = generateSql(
      { tables: [profiles, users], relations: [rel("r1", ["tpr", "tpr_user"], ["tu", "tu_id"], { kind: "1:1" })] },
      "postgresql",
    );
    expect(sql).toContain('UNIQUE ("user_id")');
  });

  it("avisa de tipos distintos, SET NULL en NOT NULL y destino no unico", () => {
    const orders = table("to", "orders", [pk("to_id"), field("to_code", "code", { type: "varchar" })]);
    const lines = table("tl", "lines", [pk("tl_id"), field("tl_order", "order_code", { type: "integer" })]);
    const sql = generateSql(
      { tables: [orders, lines], relations: [rel("r1", ["tl", "tl_order"], ["to", "to_code"], { onDelete: "SET NULL" })] },
      "postgresql",
    );
    expect(sql).toContain("-- AVISOS:");
    expect(sql).toContain("tipos distintos");
    expect(sql).toContain("SET NULL pero la columna es NOT NULL");
    expect(sql).toContain("no es PRIMARY KEY ni UNIQUE");
  });

  it("genera tabla intermedia para relaciones N:M antiguas", () => {
    const students = table("ts", "students", [pk("ts_id")]);
    const courses = table("tc", "courses", [pk("tc_id")]);
    const sql = generateSql(
      { tables: [students, courses], relations: [rel("r1", ["ts", "ts_id"], ["tc", "tc_id"], { kind: "N:M" })] },
      "postgresql",
    );
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "students_courses"');
    expect(sql).toContain('"students_id" INTEGER NOT NULL');
    expect(sql).toContain('REFERENCES "students" ("id")');
    expect(sql).toContain('REFERENCES "courses" ("id")');
    expect(sql).not.toContain('FOREIGN KEY ("id") REFERENCES "courses"');
  });
});
