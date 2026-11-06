import { createDefaultProject } from "../domain/defaults.ts";
import { normalizeTables } from "../domain/field.ts";
import { normalizeRelations } from "../domain/relation.ts";
import type { AppState, PersistedState, Project } from "../domain/types.ts";

export const STORAGE_KEY = "dbdesigner.state.v1";

export function parseStoredState(raw: string | null): PersistedState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PersistedState;
    if (Array.isArray(parsed.projects) && typeof parsed.activeProjectId === "string") {
      return parsed;
    }
    if (Array.isArray(parsed.tables) && Array.isArray(parsed.relations) && typeof parsed.zoom === "number") {
      return {
        projects: [
          {
            id: "prj_default",
            name: "Proyecto principal",
            tables: parsed.tables,
            relations: parsed.relations,
            zoom: parsed.zoom,
          },
        ],
        activeProjectId: "prj_default",
      };
    }
    return null;
  } catch {
    return null;
  }
}

function normalizeProjects(projects: Project[]): Project[] {
  // El canvas es infinito: las coordenadas (incluidas las negativas) se conservan tal cual.
  return projects.map((project) => ({
    ...project,
    tables: normalizeTables(project.tables),
    relations: normalizeRelations(project.relations ?? []),
    zoom: typeof project.zoom === "number" ? project.zoom : 1,
  }));
}

export function loadInitialState(): AppState {
  const storedState = parseStoredState(window.localStorage.getItem(STORAGE_KEY));
  const initialProjects = storedState?.projects?.length
    ? normalizeProjects(storedState.projects)
    : [createDefaultProject(normalizeTables)];
  const initialActiveProjectId =
    storedState?.activeProjectId && initialProjects.some((project) => project.id === storedState.activeProjectId)
      ? storedState.activeProjectId
      : initialProjects[0].id;
  const activeProject = initialProjects.find((project) => project.id === initialActiveProjectId) ?? initialProjects[0];

  return {
    projects: initialProjects,
    activeProjectId: initialActiveProjectId,
    tables: activeProject.tables,
    relations: activeProject.relations,
    zoom: activeProject.zoom,
  };
}

export function saveState(state: AppState): void {
  const project = state.projects.find((p) => p.id === state.activeProjectId) ?? state.projects[0];
  if (project) {
    project.tables = state.tables;
    project.relations = state.relations;
    project.zoom = state.zoom;
  }
  const payload: PersistedState = {
    projects: state.projects,
    activeProjectId: state.activeProjectId,
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}
