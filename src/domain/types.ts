import type { DataType } from "../lib/data-types.ts";

export type RelationKind = "1:1" | "1:N" | "N:M";

export interface Field {
  id: string;
  name: string;
  type: DataType;
  nullable: boolean;
  isPrimary: boolean;
  isUnique: boolean;
  autoIncrement: boolean;
  isIndexed: boolean;
  /** Solo aplica cuando `type` es `enum`; orden conservado, sin duplicados. */
  enumValues?: string[];
}

export interface Table {
  id: string;
  name: string;
  fields: Field[];
  x: number;
  y: number;
}

export interface Relation {
  id: string;
  fromTableId: string;
  fromFieldId: string;
  toTableId: string;
  toFieldId: string;
  kind: RelationKind;
}

export interface Project {
  id: string;
  name: string;
  tables: Table[];
  relations: Relation[];
  zoom: number;
}

export interface ExportedProject {
  version: 1;
  name: string;
  tables: Table[];
  relations: Relation[];
  zoom: number;
}

export interface AppState {
  projects: Project[];
  activeProjectId: string;
  tables: Table[];
  relations: Relation[];
  zoom: number;
}

export interface PersistedState {
  projects: Project[];
  activeProjectId: string;
  tables?: Table[];
  relations?: Relation[];
  zoom?: number;
}
