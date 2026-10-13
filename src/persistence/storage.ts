import { createDefaultProject, DEFAULT_RELATIONS } from "../domain/defaults.ts";
import { normalizeTables } from "../domain/field.ts";
import { normalizeRelations } from "../domain/relation.ts";
import { normalizeTablesOrigin } from "../diagram/layout.ts";
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

function normalizeProjects(projects: Project[]): { projects: Project[]; originShifted: boolean } {
  let originShifted = false;
  const normalized = projects.map((project) => {
    const tables = normalizeTables(project.tables);
    const { tables: originTables, shifted } = normalizeTablesOrigin(tables);
    if (shifted) originShifted = true;
    return {
      ...project,
      tables: originTables,
      relations: normalizeRelations(project.relations ?? []),
      zoom: typeof project.zoom === "number" ? project.zoom : 1,
    };
  });
  return { projects: normalized, originShifted };
}

export function loadInitialState(): AppState {
  const storedState = parseStoredState(window.localStorage.getItem(STORAGE_KEY));
  const defaultProject = createDefaultProject(normalizeTables);
  const loaded = storedState?.projects?.length
    ? normalizeProjects(storedState.projects)
    : { projects: [{ ...defaultProject, tables: normalizeTablesOrigin(defaultProject.tables).tables }], originShifted: false };
  const initialProjects = loaded.projects;
  const initialActiveProjectId =
    storedState?.activeProjectId && initialProjects.some((project) => project.id === storedState.activeProjectId)
      ? storedState.activeProjectId
      : initialProjects[0].id;
  const activeProject = initialProjects.find((project) => project.id === initialActiveProjectId) ?? initialProjects[0];

  const state: AppState = {
    projects: initialProjects,
    activeProjectId: initialActiveProjectId,
    tables: activeProject.tables,
    relations: activeProject.relations,
    zoom: activeProject.zoom,
  };

  // Persist corrected origins so off-canvas tables don't come back after reload.
  if (loaded.originShifted) {
    saveState(state);
  }

  return state;
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

/** @internal for tests */
export function createEmptyAppState(): AppState {
  const project = createDefaultProject(normalizeTables);
  return {
    projects: [project],
    activeProjectId: project.id,
    tables: project.tables,
    relations: DEFAULT_RELATIONS,
    zoom: 1,
  };
}
