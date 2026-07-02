import { applyFieldRules, createDefaultIdField, normalizeField } from "../domain/field.ts";
import { normalizeRelation, type RelationInput } from "../domain/relation.ts";
import { clamp, generateId, safeName } from "../domain/ids.ts";
import type { AppState, Field, Project, RelationKind, Table } from "../domain/types.ts";

export function getActiveProject(state: AppState): Project {
  return state.projects.find((project) => project.id === state.activeProjectId) ?? state.projects[0];
}

export function getTableById(state: AppState, tableId: string): Table | undefined {
  return state.tables.find((table) => table.id === tableId);
}

export function getFieldName(state: AppState, tableId: string, fieldId: string): string {
  return getTableById(state, tableId)?.fields.find((field) => field.id === fieldId)?.name ?? "unknown";
}

export function syncActiveProjectFromState(state: AppState): void {
  const project = getActiveProject(state);
  project.tables = state.tables;
  project.relations = state.relations;
  project.zoom = state.zoom;
}

export function syncStateFromActiveProject(state: AppState): AppState {
  const project = getActiveProject(state);
  return {
    ...state,
    tables: project.tables,
    relations: project.relations,
    zoom: project.zoom,
  };
}

export type Action =
  | { type: "ADD_TABLE"; name: string }
  | { type: "REMOVE_TABLE"; tableId: string }
  | { type: "RENAME_TABLE"; tableId: string; name: string }
  | { type: "ADD_FIELD"; tableId: string; field: Field }
  | { type: "UPDATE_FIELD"; tableId: string; fieldId: string; updates: Partial<Field> }
  | { type: "REMOVE_FIELD"; tableId: string; fieldId: string }
  | { type: "MOVE_FIELD"; tableId: string; fieldId: string; direction: "up" | "down" }
  | { type: "ADD_RELATION"; relation: RelationInput }
  | { type: "REMOVE_RELATION"; relationId: string }
  | { type: "UPDATE_RELATION_KIND"; relationId: string; kind: RelationKind }
  | { type: "SET_ZOOM"; zoom: number }
  | { type: "UPDATE_TABLE_POSITION"; tableId: string; x: number; y: number }
  | { type: "CREATE_PROJECT"; name: string; projectId: string }
  | { type: "RENAME_PROJECT"; name: string }
  | { type: "DELETE_PROJECT" }
  | { type: "SWITCH_PROJECT"; projectId: string }
  | { type: "IMPORT_PROJECT"; project: Omit<Project, "id">; projectId?: string; mergeIntoExistingId?: string };

function mutateFieldUpdate(table: Table, fieldId: string, updates: Partial<Field>): void {
  const field = table.fields.find((item) => item.id === fieldId);
  if (!field) return;
  Object.assign(field, updates);
  applyFieldRules(field, table);
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "ADD_TABLE": {
      const tables = [
        ...state.tables,
        {
          id: generateId("tbl"),
          name: action.name,
          fields: [createDefaultIdField()],
          x: 24 + state.tables.length * 28,
          y: 24 + state.tables.length * 28,
        },
      ];
      return { ...state, tables };
    }
    case "REMOVE_TABLE": {
      const tables = state.tables.filter((table) => table.id !== action.tableId);
      const relations = state.relations.filter(
        (relation) => relation.fromTableId !== action.tableId && relation.toTableId !== action.tableId,
      );
      return { ...state, tables, relations };
    }
    case "RENAME_TABLE": {
      const tables = state.tables.map((table) =>
        table.id === action.tableId ? { ...table, name: action.name } : table,
      );
      return { ...state, tables };
    }
    case "ADD_FIELD": {
      const table = getTableById(state, action.tableId);
      if (!table) return state;
      const field = { ...action.field };
      applyFieldRules(field, table);
      const tables = state.tables.map((t) =>
        t.id === action.tableId ? { ...t, fields: [...t.fields, field] } : t,
      );
      return { ...state, tables };
    }
    case "UPDATE_FIELD": {
      const tables = state.tables.map((table) => {
        if (table.id !== action.tableId) return table;
        const fields = table.fields.map((field) => {
          if (field.id !== action.fieldId) return field;
          const updated = { ...field, ...action.updates };
          applyFieldRules(updated, { ...table, fields: table.fields });
          return updated;
        });
        return { ...table, fields };
      });
      return { ...state, tables };
    }
    case "REMOVE_FIELD": {
      const tables = state.tables.map((table) =>
        table.id === action.tableId
          ? { ...table, fields: table.fields.filter((field) => field.id !== action.fieldId) }
          : table,
      );
      const relations = state.relations.filter(
        (relation) =>
          !(relation.fromTableId === action.tableId && relation.fromFieldId === action.fieldId) &&
          !(relation.toTableId === action.tableId && relation.toFieldId === action.fieldId),
      );
      return { ...state, tables, relations };
    }
    case "MOVE_FIELD": {
      const table = getTableById(state, action.tableId);
      if (!table) return state;
      const index = table.fields.findIndex((field) => field.id === action.fieldId);
      if (index < 0) return state;
      const targetIndex = action.direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= table.fields.length) return state;
      const fields = [...table.fields];
      const [field] = fields.splice(index, 1);
      fields.splice(targetIndex, 0, field);
      const tables = state.tables.map((t) => (t.id === action.tableId ? { ...t, fields } : t));
      return { ...state, tables };
    }
    case "ADD_RELATION": {
      const relation = normalizeRelation(action.relation);
      if (state.relations.some((item) => item.id === relation.id)) return state;
      return { ...state, relations: [...state.relations, relation] };
    }
    case "REMOVE_RELATION": {
      return { ...state, relations: state.relations.filter((item) => item.id !== action.relationId) };
    }
    case "UPDATE_RELATION_KIND": {
      const relations = state.relations.map((relation) =>
        relation.id === action.relationId ? { ...relation, kind: action.kind } : relation,
      );
      return { ...state, relations };
    }
    case "SET_ZOOM": {
      const zoom = clamp(Number(action.zoom.toFixed(2)), 0.3, 2.5);
      return { ...state, zoom };
    }
    case "UPDATE_TABLE_POSITION": {
      const tables = state.tables.map((table) =>
        table.id === action.tableId ? { ...table, x: action.x, y: action.y } : table,
      );
      return { ...state, tables };
    }
    case "CREATE_PROJECT": {
      const newProject: Project = {
        id: action.projectId,
        name: action.name,
        tables: [],
        relations: [],
        zoom: 1,
      };
      const projects = [...state.projects, newProject];
      return syncStateFromActiveProject({
        ...state,
        projects,
        activeProjectId: action.projectId,
        tables: [],
        relations: [],
        zoom: 1,
      });
    }
    case "RENAME_PROJECT": {
      const projects = state.projects.map((project) =>
        project.id === state.activeProjectId ? { ...project, name: action.name } : project,
      );
      return { ...state, projects };
    }
    case "DELETE_PROJECT": {
      if (state.projects.length <= 1) return state;
      const active = getActiveProject(state);
      const projects = state.projects.filter((project) => project.id !== active.id);
      const next = syncStateFromActiveProject({
        ...state,
        projects,
        activeProjectId: projects[0].id,
      });
      return next;
    }
    case "SWITCH_PROJECT": {
      if (!state.projects.some((project) => project.id === action.projectId)) return state;
      return syncStateFromActiveProject({ ...state, activeProjectId: action.projectId });
    }
    case "IMPORT_PROJECT": {
      if (action.mergeIntoExistingId) {
        const projects = state.projects.map((project) =>
          project.id === action.mergeIntoExistingId
            ? { ...project, tables: action.project.tables, relations: action.project.relations, zoom: action.project.zoom }
            : project,
        );
        return syncStateFromActiveProject({
          ...state,
          projects,
          activeProjectId: action.mergeIntoExistingId,
        });
      }
      const newProject: Project = { id: action.projectId ?? generateId("prj"), ...action.project };
      const projects = [...state.projects, newProject];
      return syncStateFromActiveProject({
        ...state,
        projects,
        activeProjectId: newProject.id,
      });
    }
    default:
      return state;
  }
}

export type Listener = () => void;

export interface Store {
  getState: () => AppState;
  subscribe: (listener: Listener) => () => void;
  dispatch: (action: Action, options?: { persist?: boolean }) => void;
}

export function createStore(initial: AppState, onPersist: (state: AppState) => void): Store {
  let state = initial;
  const listeners = new Set<Listener>();

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch: (action, options) => {
      state = reducer(state, action);
      syncActiveProjectFromState(state);
      if (options?.persist !== false) {
        onPersist(state);
      }
      listeners.forEach((listener) => listener());
    },
  };
}

/** @internal helper for field edit form */
export function applyFieldEditToTable(table: Table, fieldId: string, raw: Partial<Field>): void {
  mutateFieldUpdate(table, fieldId, raw);
}

export { normalizeField, safeName };
