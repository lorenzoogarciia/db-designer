import { normalizeTables } from "../domain/field.ts";
import type { ExportedProject, Project, Table } from "../domain/types.ts";
import { safeDownloadLink } from "../utils/dom.ts";

export function isValidTable(raw: unknown): raw is Table {
  if (!raw || typeof raw !== "object") return false;
  const table = raw as Table;
  return (
    typeof table.id === "string" &&
    typeof table.name === "string" &&
    Array.isArray(table.fields) &&
    typeof table.x === "number" &&
    typeof table.y === "number" &&
    table.fields.every((field) => field && typeof field.id === "string" && typeof field.name === "string")
  );
}

export function parseImportedProject(raw: unknown): Omit<Project, "id"> | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Partial<ExportedProject> & { tables?: Table[]; relations?: Project["relations"]; zoom?: number; name?: string };

  let name: string;
  let tables: Table[];
  let relations: Project["relations"];
  let zoom: number;

  if (typeof data.name === "string" && Array.isArray(data.tables)) {
    name = data.name.trim();
    tables = data.tables;
    relations = Array.isArray(data.relations) ? data.relations : [];
    zoom = typeof data.zoom === "number" ? data.zoom : 1;
  } else if (Array.isArray(data.tables) && Array.isArray(data.relations)) {
    name = "Proyecto importado";
    tables = data.tables;
    relations = data.relations;
    zoom = typeof data.zoom === "number" ? data.zoom : 1;
  } else {
    return null;
  }

  if (!name || !tables.every(isValidTable)) return null;

  return {
    name,
    tables: normalizeTables(tables),
    relations,
    zoom,
  };
}

export function buildExportedProject(project: Project): ExportedProject {
  return {
    version: 1,
    name: project.name,
    tables: project.tables,
    relations: project.relations,
    zoom: project.zoom,
  };
}

export function downloadProjectJson(project: Project): void {
  const payload = buildExportedProject(project);
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const safeFilename = project.name.trim().replace(/[^\w\-.]+/g, "_") || "proyecto";
  const link = document.createElement("a");
  link.download = `${safeFilename}.json`;
  const url = URL.createObjectURL(blob);
  link.href = url;
  safeDownloadLink(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export async function readJsonFile(file: File): Promise<unknown> {
  const text = await file.text();
  return JSON.parse(text) as unknown;
}
