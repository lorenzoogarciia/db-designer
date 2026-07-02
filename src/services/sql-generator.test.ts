import { describe, expect, it } from "vitest";
import { generateSql, quoteIdentifier } from "../services/sql-generator.ts";

describe("quoteIdentifier", () => {
  it("quotes per dialect", () => {
    expect(quoteIdentifier("users", "mysql")).toBe("`users`");
    expect(quoteIdentifier('say"hi', "postgresql")).toBe('"say""hi"');
    expect(quoteIdentifier("users", "sqlserver")).toBe("[users]");
  });
});

describe("generateSql", () => {
  const project = {
    tables: [
      {
        id: "t1",
        name: "users",
        x: 0,
        y: 0,
        fields: [
          {
            id: "f1",
            name: "id",
            type: "integer",
            nullable: false,
            isPrimary: true,
            isUnique: true,
            autoIncrement: true,
            isIndexed: true,
          },
          {
            id: "f2",
            name: "email",
            type: "text",
            nullable: false,
            isPrimary: false,
            isUnique: true,
            autoIncrement: false,
            isIndexed: true,
          },
        ],
      },
    ],
    relations: [],
  };

  it("generates mysql ddl with primary key and unique", () => {
    const sql = generateSql(project, "mysql");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS `users`");
    expect(sql).toContain("PRIMARY KEY (`id`)");
    expect(sql).toContain("UNIQUE (`email`)");
    expect(sql).toContain("AUTO_INCREMENT");
  });

  it("generates postgresql ddl with separate index", () => {
    const withIndex = {
      ...project,
      tables: [
        {
          ...project.tables[0],
          fields: [
            project.tables[0].fields[0],
            {
              ...project.tables[0].fields[1],
              isUnique: false,
              isIndexed: true,
            },
          ],
        },
      ],
    };
    const sql = generateSql(withIndex, "postgresql");
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "users"');
    expect(sql).toContain("SERIAL");
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "idx_users_email"');
  });

  it("generates sql server ddl with identity", () => {
    const sql = generateSql(project, "sqlserver");
    expect(sql).toContain("CREATE TABLE [users]");
    expect(sql).toContain("IDENTITY(1,1)");
  });
});
