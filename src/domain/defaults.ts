import type { Project, Relation, Table } from "./types.ts";

export const DEFAULT_TABLES: Table[] = [
  {
    id: "tbl_users",
    name: "users",
    fields: [
      { id: "fld_users_id", name: "id", type: "uuid", nullable: false, isPrimary: true, isUnique: true, autoIncrement: false, isIndexed: true },
      { id: "fld_users_email", name: "email", type: "text", nullable: false, isPrimary: false, isUnique: true, autoIncrement: false, isIndexed: true },
      { id: "fld_users_created_at", name: "created_at", type: "timestamp", nullable: false, isPrimary: false, isUnique: false, autoIncrement: false, isIndexed: false },
    ],
    x: 24,
    y: 24,
  },
  {
    id: "tbl_posts",
    name: "posts",
    fields: [
      { id: "fld_posts_id", name: "id", type: "uuid", nullable: false, isPrimary: true, isUnique: true, autoIncrement: false, isIndexed: true },
      { id: "fld_posts_user_id", name: "user_id", type: "uuid", nullable: false, isPrimary: false, isUnique: false, autoIncrement: false, isIndexed: true },
      { id: "fld_posts_title", name: "title", type: "text", nullable: false, isPrimary: false, isUnique: false, autoIncrement: false, isIndexed: false },
    ],
    x: 424,
    y: 24,
  },
];

export const DEFAULT_RELATIONS: Relation[] = [
  {
    id: "rel_posts_user_id_to_users_id",
    fromTableId: "tbl_posts",
    fromFieldId: "fld_posts_user_id",
    toTableId: "tbl_users",
    toFieldId: "fld_users_id",
    kind: "1:N",
  },
];

export function createDefaultProject(normalizeTables: (tables: Table[]) => Table[]): Project {
  return {
    id: "prj_default",
    name: "Proyecto principal",
    tables: normalizeTables(DEFAULT_TABLES),
    relations: DEFAULT_RELATIONS,
    zoom: 1,
  };
}
