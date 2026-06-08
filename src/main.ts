import html2canvas from "html2canvas";
import {
  DATA_TYPE_OPTIONS,
  dataTypeLabel,
  isAutoIncrementType,
  isIntegerLikeType,
  mapDataTypeToSql,
  normalizeDataType,
  type DataType,
  type SqlDialect,
} from "./data-types";
import { mountSearchableSelect, type SelectOption } from "./searchable-select";
import {
  applyTheme,
  getActiveTheme,
  getExportBackgroundColor,
  getStoredTheme,
  themeToggleIcon,
  themeToggleLabel,
  toggleTheme,
  type AppTheme,
} from "./theme";
import { buildRoutedRelationPath, type FieldAnchor } from "./relation-routing";
import "./style.css";
type RelationKind = "1:1" | "1:N" | "N:M";

interface Field {
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

interface Table {
  id: string;
  name: string;
  fields: Field[];
  x: number;
  y: number;
}

interface Relation {
  id: string;
  fromTableId: string;
  fromFieldId: string;
  toTableId: string;
  toFieldId: string;
  kind: RelationKind;
}

interface Project {
  id: string;
  name: string;
  tables: Table[];
  relations: Relation[];
  zoom: number;
}

interface ExportedProject {
  version: 1;
  name: string;
  tables: Table[];
  relations: Relation[];
  zoom: number;
}

const TABLE_MIN_WIDTH = 260;
const TABLE_HEADER_HEIGHT = 64;
const TABLE_ROW_HEIGHT = 42;
const BASE_PADDING = 40;
const CANVAS_GUTTER = 800;
const MAX_EXPORT_SIDE = 8192;
const MAX_EXPORT_PIXELS = 40_000_000;

const DEFAULT_TABLES: Table[] = [
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

const DEFAULT_RELATIONS: Relation[] = [
  {
    id: "rel_posts_user_id_to_users_id",
    fromTableId: "tbl_posts",
    fromFieldId: "fld_posts_user_id",
    toTableId: "tbl_users",
    toFieldId: "fld_users_id",
    kind: "1:N",
  },
];

const STORAGE_KEY = "dbdesigner.state.v1";

interface PersistedState {
  projects: Project[];
  activeProjectId: string;
  tables?: Table[];
  relations?: Relation[];
  zoom?: number;
}

function dedupeEnumValues(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  values.forEach((value) => {
    if (seen.has(value)) return;
    seen.add(value);
    out.push(value);
  });
  return out;
}

function parseEnumValuesInput(raw: string): string[] {
  const parts = raw
    .split(/[\n,]+/)
    .map((part) => part.trim().replace(/^['"]|['"]$/g, ""))
    .filter((part) => part.length > 0);
  return dedupeEnumValues(parts);
}

function escapeSqlStringLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function normalizeField(raw: Field): Field {
  const type = normalizeDataType(raw.type ?? "text");
  const autoIncrement = Boolean(raw.autoIncrement) || isAutoIncrementType(type);
  const isPrimary = Boolean(raw.isPrimary) || isAutoIncrementType(type);
  const enumValues =
    type === "enum"
      ? dedupeEnumValues(Array.isArray(raw.enumValues) ? raw.enumValues.map((item) => String(item).trim()).filter((item) => item.length > 0) : [])
      : undefined;
  const base = {
    id: raw.id,
    name: raw.name,
    type,
    nullable: isAutoIncrementType(type) || autoIncrement ? false : Boolean(raw.nullable),
    isPrimary,
    isUnique: Boolean(raw.isUnique) || isPrimary,
    autoIncrement,
    isIndexed: Boolean(raw.isIndexed) || Boolean(raw.isUnique) || isPrimary,
  };
  if (type === "enum") {
    return { ...base, enumValues: enumValues ?? [] };
  }
  return base;
}

function normalizeTables(rawTables: Table[]): Table[] {
  return rawTables.map((table) => ({
    ...table,
    fields: table.fields.map((field) => normalizeField(field)),
  }));
}

function parseStoredState(raw: string | null): PersistedState | null {
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

const storedState = parseStoredState(window.localStorage.getItem(STORAGE_KEY));
const defaultProject: Project = {
  id: "prj_default",
  name: "Proyecto principal",
  tables: normalizeTables(DEFAULT_TABLES),
  relations: DEFAULT_RELATIONS,
  zoom: 1,
};
const initialProjects = storedState?.projects?.length
  ? storedState.projects.map((project) => ({
      ...project,
      tables: normalizeTables(project.tables),
      relations: project.relations ?? [],
      zoom: typeof project.zoom === "number" ? project.zoom : 1,
    }))
  : [defaultProject];
const initialActiveProjectId =
  storedState?.activeProjectId && initialProjects.some((project) => project.id === storedState.activeProjectId)
    ? storedState.activeProjectId
    : initialProjects[0].id;
const activeProject = initialProjects.find((project) => project.id === initialActiveProjectId) ?? initialProjects[0];

const state: {
  projects: Project[];
  activeProjectId: string;
  tables: Table[];
  relations: Relation[];
  zoom: number;
} = {
  projects: initialProjects,
  activeProjectId: initialActiveProjectId,
  tables: activeProject.tables,
  relations: activeProject.relations,
  zoom: activeProject.zoom,
};

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("No se encontro #app");

app.innerHTML = `
  <main class="layout">
    <section class="panel controls">
      <header class="app-header">
        <div>
          <h1>DB Designer</h1>
          <p>Crea tablas, campos y relaciones con vista previa en vivo.</p>
        </div>
        <button id="theme-toggle-btn" type="button" class="theme-toggle-btn" aria-label="Cambiar tema"></button>
      </header>

      <div class="group">
        <h2>Proyectos</h2>
        <div class="form-grid">
          <label for="project-select">Proyecto activo</label>
          <div id="project-select" class="searchable-select-host"></div>
          <div class="sql-actions">
            <button id="project-new-btn" type="button">Nuevo</button>
            <button id="project-rename-btn" type="button">Renombrar</button>
          </div>
          <div class="sql-actions">
            <button id="project-export-json-btn" type="button">Exportar JSON</button>
            <button id="project-import-json-btn" type="button">Importar JSON</button>
          </div>
          <input id="project-import-json-input" type="file" accept=".json,application/json" hidden />
          <button id="project-delete-btn" type="button" class="danger-btn">Eliminar proyecto</button>
        </div>
      </div>

      <div class="group">
        <h2>Nueva tabla</h2>
        <form id="table-form" class="form-grid">
          <label for="table-name">Nombre</label>
          <input id="table-name" name="tableName" placeholder="orders" required />
          <button type="submit">Agregar tabla</button>
        </form>
      </div>

      <div class="group">
        <h2>Nuevo campo</h2>
        <form id="field-form" class="form-grid">
          <label for="field-table">Tabla</label>
          <div id="field-table" class="searchable-select-host"></div>
          <label for="field-name">Campo</label>
          <input id="field-name" name="fieldName" placeholder="customer_id" required />
          <label for="field-type">Tipo</label>
          <div id="field-type" class="searchable-select-host"></div>
          <label for="field-enum-values" id="field-enum-values-label" hidden>Valores enum (opcional)</label>
          <textarea id="field-enum-values" name="enumValues" rows="2" placeholder="Separados por coma o una por linea (ej: pending, active, done)" hidden></textarea>
          <label class="checkbox-row"><input id="field-nullable" type="checkbox" name="nullable" /> Permite null</label>
          <label class="checkbox-row"><input id="field-primary" type="checkbox" name="isPrimary" /> Clave primaria</label>
          <label class="checkbox-row"><input id="field-unique" type="checkbox" name="isUnique" /> UNIQUE</label>
          <label class="checkbox-row"><input id="field-autoinc" type="checkbox" name="autoIncrement" /> AUTO_INCREMENT</label>
          <label class="checkbox-row"><input id="field-indexed" type="checkbox" name="isIndexed" /> INDEX</label>
          <button type="submit">Agregar campo</button>
        </form>
      </div>

      <div class="group">
        <h2>Nueva relacion</h2>
        <form id="relation-form" class="form-grid">
          <label for="from-table">Desde tabla</label>
          <div id="from-table" class="searchable-select-host"></div>
          <label for="from-field">Desde campo</label>
          <div id="from-field" class="searchable-select-host"></div>
          <label for="to-table">Hacia tabla</label>
          <div id="to-table" class="searchable-select-host"></div>
          <label for="to-field">Hacia campo</label>
          <div id="to-field" class="searchable-select-host"></div>
          <label for="relation-kind">Tipo de relacion</label>
          <div id="relation-kind" class="searchable-select-host"></div>
          <button type="submit">Agregar relacion</button>
        </form>
      </div>

      <div class="group">
        <h2>Generar SQL</h2>
        <div class="sql-actions">
          <button id="sql-mysql-btn" type="button">MySQL</button>
          <button id="sql-postgresql-btn" type="button">PostgreSQL</button>
          <button id="sql-sqlserver-btn" type="button">SQL Server</button>
        </div>
      </div>
    </section>

    <section class="panel diagram-area">
      <div class="diagram-toolbar">
        <h2>Diagrama</h2>
        <div class="toolbar-actions">
          <button id="theme-toggle-diagram-btn" type="button" class="theme-toggle-btn" aria-label="Cambiar tema"></button>
          <button id="zoom-out-btn" type="button">-</button>
          <span id="zoom-label">100%</span>
          <button id="zoom-in-btn" type="button">+</button>
          <button id="fit-btn" type="button">Ajustar</button>
          <button id="export-btn" type="button">Exportar PNG</button>
        </div>
      </div>
      <div id="diagram" class="diagram"></div>
    </section>
  </main>
  <div id="sql-modal" class="modal hidden">
    <div class="modal-card">
      <div class="modal-header">
        <h3 id="sql-modal-title">SQL generado</h3>
        <button id="sql-modal-close" type="button">Cerrar</button>
      </div>
      <textarea id="sql-modal-output" readonly></textarea>
      <div class="modal-actions">
        <button id="sql-modal-copy" type="button">Copiar SQL</button>
      </div>
    </div>
  </div>
  <div id="field-edit-modal" class="modal hidden">
    <div class="modal-card field-edit-card">
      <div class="modal-header">
        <h3>Editar campo</h3>
        <button id="field-edit-close" type="button">Cerrar</button>
      </div>
      <form id="field-edit-form" class="form-grid">
        <input id="field-edit-table-id" type="hidden" />
        <input id="field-edit-field-id" type="hidden" />
        <label for="field-edit-name">Nombre</label>
        <input id="field-edit-name" required />
        <label for="field-edit-type">Tipo</label>
        <div id="field-edit-type" class="searchable-select-host"></div>
        <label for="field-edit-enum-values" id="field-edit-enum-values-label" hidden>Valores enum (opcional)</label>
        <textarea id="field-edit-enum-values" rows="2" placeholder="Separados por coma o una por linea" hidden></textarea>
        <label class="checkbox-row"><input id="field-edit-nullable" type="checkbox" /> Permite null</label>
        <label class="checkbox-row"><input id="field-edit-primary" type="checkbox" /> Clave primaria</label>
        <label class="checkbox-row"><input id="field-edit-unique" type="checkbox" /> UNIQUE</label>
        <label class="checkbox-row"><input id="field-edit-autoinc" type="checkbox" /> AUTO_INCREMENT</label>
        <label class="checkbox-row"><input id="field-edit-indexed" type="checkbox" /> INDEX</label>
        <button type="submit">Guardar cambios</button>
      </form>
    </div>
  </div>
`;

const tableForm = document.querySelector<HTMLFormElement>("#table-form");
const fieldForm = document.querySelector<HTMLFormElement>("#field-form");
const fieldNameInput = document.querySelector<HTMLInputElement>("#field-name");
const fieldTypeHost = document.querySelector<HTMLDivElement>("#field-type");
const fieldNullableInput = document.querySelector<HTMLInputElement>("#field-nullable");
const fieldPrimaryInput = document.querySelector<HTMLInputElement>("#field-primary");
const fieldUniqueInput = document.querySelector<HTMLInputElement>("#field-unique");
const fieldAutoincInput = document.querySelector<HTMLInputElement>("#field-autoinc");
const fieldIndexedInput = document.querySelector<HTMLInputElement>("#field-indexed");
const fieldEnumValuesLabel = document.querySelector<HTMLLabelElement>("#field-enum-values-label");
const fieldEnumValuesTextarea = document.querySelector<HTMLTextAreaElement>("#field-enum-values");
const relationForm = document.querySelector<HTMLFormElement>("#relation-form");
const themeToggleButton = document.querySelector<HTMLButtonElement>("#theme-toggle-btn");
const themeToggleDiagramButton = document.querySelector<HTMLButtonElement>("#theme-toggle-diagram-btn");
const exportButton = document.querySelector<HTMLButtonElement>("#export-btn");
const zoomOutButton = document.querySelector<HTMLButtonElement>("#zoom-out-btn");
const zoomInButton = document.querySelector<HTMLButtonElement>("#zoom-in-btn");
const fitButton = document.querySelector<HTMLButtonElement>("#fit-btn");
const zoomLabel = document.querySelector<HTMLSpanElement>("#zoom-label");
const projectSelectHost = document.querySelector<HTMLDivElement>("#project-select");
const projectNewButton = document.querySelector<HTMLButtonElement>("#project-new-btn");
const projectRenameButton = document.querySelector<HTMLButtonElement>("#project-rename-btn");
const projectDeleteButton = document.querySelector<HTMLButtonElement>("#project-delete-btn");
const projectExportJsonButton = document.querySelector<HTMLButtonElement>("#project-export-json-btn");
const projectImportJsonButton = document.querySelector<HTMLButtonElement>("#project-import-json-btn");
const projectImportJsonInput = document.querySelector<HTMLInputElement>("#project-import-json-input");
const mysqlButton = document.querySelector<HTMLButtonElement>("#sql-mysql-btn");
const postgresqlButton = document.querySelector<HTMLButtonElement>("#sql-postgresql-btn");
const sqlServerButton = document.querySelector<HTMLButtonElement>("#sql-sqlserver-btn");
const sqlModal = document.querySelector<HTMLDivElement>("#sql-modal");
const sqlModalTitle = document.querySelector<HTMLHeadingElement>("#sql-modal-title");
const sqlModalOutput = document.querySelector<HTMLTextAreaElement>("#sql-modal-output");
const sqlModalClose = document.querySelector<HTMLButtonElement>("#sql-modal-close");
const sqlModalCopy = document.querySelector<HTMLButtonElement>("#sql-modal-copy");
const fieldEditModal = document.querySelector<HTMLDivElement>("#field-edit-modal");
const fieldEditForm = document.querySelector<HTMLFormElement>("#field-edit-form");
const fieldEditClose = document.querySelector<HTMLButtonElement>("#field-edit-close");
const fieldEditTableId = document.querySelector<HTMLInputElement>("#field-edit-table-id");
const fieldEditFieldId = document.querySelector<HTMLInputElement>("#field-edit-field-id");
const fieldEditName = document.querySelector<HTMLInputElement>("#field-edit-name");
const fieldEditTypeHost = document.querySelector<HTMLDivElement>("#field-edit-type");
const fieldEditNullable = document.querySelector<HTMLInputElement>("#field-edit-nullable");
const fieldEditPrimary = document.querySelector<HTMLInputElement>("#field-edit-primary");
const fieldEditUnique = document.querySelector<HTMLInputElement>("#field-edit-unique");
const fieldEditAutoinc = document.querySelector<HTMLInputElement>("#field-edit-autoinc");
const fieldEditIndexed = document.querySelector<HTMLInputElement>("#field-edit-indexed");
const fieldEditEnumValuesLabel = document.querySelector<HTMLLabelElement>("#field-edit-enum-values-label");
const fieldEditEnumValuesTextarea = document.querySelector<HTMLTextAreaElement>("#field-edit-enum-values");
const diagram = document.querySelector<HTMLDivElement>("#diagram");

if (!tableForm || !fieldForm || !fieldNameInput || !fieldTypeHost || !fieldNullableInput || !fieldPrimaryInput || !fieldUniqueInput || !fieldAutoincInput || !fieldIndexedInput || !fieldEnumValuesLabel || !fieldEnumValuesTextarea || !relationForm || !themeToggleButton || !themeToggleDiagramButton || !exportButton || !zoomOutButton || !zoomInButton || !fitButton || !zoomLabel || !projectSelectHost || !projectNewButton || !projectRenameButton || !projectDeleteButton || !projectExportJsonButton || !projectImportJsonButton || !projectImportJsonInput || !diagram || !mysqlButton || !postgresqlButton || !sqlServerButton || !sqlModal || !sqlModalTitle || !sqlModalOutput || !sqlModalClose || !sqlModalCopy || !fieldEditModal || !fieldEditForm || !fieldEditClose || !fieldEditTableId || !fieldEditFieldId || !fieldEditName || !fieldEditTypeHost || !fieldEditNullable || !fieldEditPrimary || !fieldEditUnique || !fieldEditAutoinc || !fieldEditIndexed || !fieldEditEnumValuesLabel || !fieldEditEnumValuesTextarea) {
  throw new Error("No se pudo inicializar la interfaz");
}

const diagramElement = diagram;
const sqlModalElement = sqlModal;
const sqlModalTitleElement = sqlModalTitle;
const sqlModalOutputElement = sqlModalOutput;
const fieldEditModalElement = fieldEditModal;
const fieldEditTableIdElement = fieldEditTableId;
const fieldEditFieldIdElement = fieldEditFieldId;
const fieldEditNameElement = fieldEditName;
const fieldEditNullableElement = fieldEditNullable;
const fieldEditPrimaryElement = fieldEditPrimary;
const fieldEditUniqueElement = fieldEditUnique;
const fieldEditAutoincElement = fieldEditAutoinc;
const fieldEditIndexedElement = fieldEditIndexed;
const fieldEditEnumValuesTextareaElement = fieldEditEnumValuesTextarea;
const projectNewButtonElement = projectNewButton;
const projectRenameButtonElement = projectRenameButton;
const projectDeleteButtonElement = projectDeleteButton;
const projectExportJsonButtonElement = projectExportJsonButton;
const projectImportJsonButtonElement = projectImportJsonButton;
const projectImportJsonInputElement = projectImportJsonInput;
const zoomLabelElement = zoomLabel;
const themeToggleButtonElement = themeToggleButton;
const themeToggleDiagramButtonElement = themeToggleDiagramButton;

function updateThemeToggleButtons(theme: AppTheme = getActiveTheme()) {
  const label = themeToggleLabel(theme);
  const icon = themeToggleIcon(theme);
  themeToggleButtonElement.textContent = icon;
  themeToggleButtonElement.title = label;
  themeToggleButtonElement.setAttribute("aria-label", label);
  themeToggleDiagramButtonElement.textContent = icon;
  themeToggleDiagramButtonElement.title = label;
  themeToggleDiagramButtonElement.setAttribute("aria-label", label);
}

function handleThemeToggle() {
  const nextTheme = toggleTheme();
  updateThemeToggleButtons(nextTheme);
}

applyTheme(getStoredTheme());
updateThemeToggleButtons();

const generateId = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
const safeName = (value: string) => value.trim().replace(/\s+/g, "_").toLowerCase();
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const getTableById = (tableId: string) => state.tables.find((table) => table.id === tableId);

function createDefaultIdField(): Field {
  return normalizeField({
    id: generateId("fld"),
    name: "id",
    type: "id",
    nullable: false,
    isPrimary: true,
    isUnique: true,
    autoIncrement: true,
    isIndexed: true,
  });
}

const DATA_TYPE_SELECT_OPTIONS: SelectOption[] = DATA_TYPE_OPTIONS.map((option) => ({
  value: option.value,
  label: option.label,
  group: option.group,
}));

const RELATION_KIND_OPTIONS: SelectOption[] = [
  { value: "1:1", label: "1:1 (uno a uno)" },
  { value: "1:N", label: "1:N (uno a muchos)" },
  { value: "N:M", label: "N:M (muchos a muchos)" },
];

const fieldTableHost = document.querySelector<HTMLDivElement>("#field-table");
const fromTableHost = document.querySelector<HTMLDivElement>("#from-table");
const fromFieldHost = document.querySelector<HTMLDivElement>("#from-field");
const toTableHost = document.querySelector<HTMLDivElement>("#to-table");
const toFieldHost = document.querySelector<HTMLDivElement>("#to-field");
const relationKindHost = document.querySelector<HTMLDivElement>("#relation-kind");

if (!fieldTableHost || !fromTableHost || !fromFieldHost || !toTableHost || !toFieldHost || !relationKindHost) {
  throw new Error("No se pudieron inicializar los selectores");
}

const projectSelect = mountSearchableSelect(projectSelectHost, {
  name: "projectId",
  placeholder: "Seleccionar proyecto...",
  searchPlaceholder: "Buscar proyecto...",
});
const fieldTableSelect = mountSearchableSelect(fieldTableHost, {
  name: "tableId",
  required: true,
  placeholder: "Seleccionar tabla...",
  searchPlaceholder: "Buscar tabla...",
});
const fieldTypeSelect = mountSearchableSelect(fieldTypeHost, {
  name: "fieldType",
  required: true,
  placeholder: "Seleccionar tipo...",
  searchPlaceholder: "Buscar tipo de dato...",
  initialOptions: DATA_TYPE_SELECT_OPTIONS,
  initialValue: "text",
});
const fromTableSelect = mountSearchableSelect(fromTableHost, {
  name: "fromTableId",
  required: true,
  placeholder: "Tabla origen...",
  searchPlaceholder: "Buscar tabla origen...",
});
const fromFieldSelect = mountSearchableSelect(fromFieldHost, {
  name: "fromFieldId",
  required: true,
  placeholder: "Campo origen...",
  searchPlaceholder: "Buscar campo origen...",
});
const toTableSelect = mountSearchableSelect(toTableHost, {
  name: "toTableId",
  required: true,
  placeholder: "Tabla destino...",
  searchPlaceholder: "Buscar tabla destino...",
});
const toFieldSelect = mountSearchableSelect(toFieldHost, {
  name: "toFieldId",
  required: true,
  placeholder: "Campo destino...",
  searchPlaceholder: "Buscar campo destino...",
});
const relationKindSelect = mountSearchableSelect(relationKindHost, {
  name: "relationKind",
  required: true,
  placeholder: "Tipo de relacion...",
  searchPlaceholder: "Buscar tipo...",
  initialOptions: RELATION_KIND_OPTIONS,
  initialValue: "1:N",
});
const fieldEditTypeSelect = mountSearchableSelect(fieldEditTypeHost, {
  required: true,
  placeholder: "Seleccionar tipo...",
  searchPlaceholder: "Buscar tipo de dato...",
  initialOptions: DATA_TYPE_SELECT_OPTIONS,
  initialValue: "text",
});

let dragState: { tableId: string; offsetX: number; offsetY: number } | null = null;
let panState: { startX: number; startY: number; startScrollLeft: number; startScrollTop: number } | null = null;

function getActiveProject() {
  return state.projects.find((project) => project.id === state.activeProjectId) ?? state.projects[0];
}

function syncStateFromActiveProject() {
  const project = getActiveProject();
  state.tables = project.tables;
  state.relations = project.relations;
  state.zoom = project.zoom;
}

function syncActiveProjectFromState() {
  const project = getActiveProject();
  project.tables = state.tables;
  project.relations = state.relations;
  project.zoom = state.zoom;
}

function persistState() {
  syncActiveProjectFromState();
  const payload: PersistedState = {
    projects: state.projects,
    activeProjectId: state.activeProjectId,
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function refreshProjectSelect() {
  const options = state.projects.map((project) => ({ value: project.id, label: project.name }));
  projectSelect.setOptions(options);
  projectSelect.setValue(state.activeProjectId);
}

function getFieldOptionsForTable(tableId: string): SelectOption[] {
  const selectedTable = getTableById(tableId);
  return selectedTable?.fields.map((field) => ({ value: field.id, label: `${field.name} (${fieldTypeLabel(field)})` })) ?? [];
}

function syncFromFieldSelect(preserveValue = true) {
  const previous = preserveValue ? fromFieldSelect.getValue() : "";
  const options = getFieldOptionsForTable(fromTableSelect.getValue());
  fromFieldSelect.setOptions(options);
  if (previous && options.some((option) => option.value === previous)) {
    fromFieldSelect.setValue(previous);
  }
}

function syncToFieldSelect(preserveValue = true) {
  const previous = preserveValue ? toFieldSelect.getValue() : "";
  const options = getFieldOptionsForTable(toTableSelect.getValue());
  toFieldSelect.setOptions(options);
  if (previous && options.some((option) => option.value === previous)) {
    toFieldSelect.setValue(previous);
  }
}

function refreshSelects(preserve: { fieldTable?: boolean; fromTable?: boolean; fromField?: boolean; toTable?: boolean; toField?: boolean; relationKind?: boolean } = {}) {
  const tableOptions = state.tables.map((table) => ({ value: table.id, label: table.name }));

  const fieldTableValue = preserve.fieldTable ? fieldTableSelect.getValue() : fieldTableSelect.getValue();
  fieldTableSelect.setOptions(tableOptions);
  if (fieldTableValue && tableOptions.some((option) => option.value === fieldTableValue)) {
    fieldTableSelect.setValue(fieldTableValue);
  }

  const fromTableValue = preserve.fromTable ? fromTableSelect.getValue() : fromTableSelect.getValue();
  const toTableValue = preserve.toTable ? toTableSelect.getValue() : toTableSelect.getValue();
  fromTableSelect.setOptions(tableOptions);
  toTableSelect.setOptions(tableOptions);
  if (fromTableValue && tableOptions.some((option) => option.value === fromTableValue)) {
    fromTableSelect.setValue(fromTableValue);
  }
  if (toTableValue && tableOptions.some((option) => option.value === toTableValue)) {
    toTableSelect.setValue(toTableValue);
  }

  syncFromFieldSelect(preserve.fromField ?? true);
  syncToFieldSelect(preserve.toField ?? true);

  if (preserve.relationKind) {
    const kind = relationKindSelect.getValue() || "1:N";
    relationKindSelect.setValue(kind);
  } else if (!relationKindSelect.getValue()) {
    relationKindSelect.setValue("1:N");
  }
}

function ensureTablePositions() {
  state.tables.forEach((table, index) => {
    if (typeof table.x === "number" && typeof table.y === "number") return;
    table.x = 24 + (index % 2) * 400;
    table.y = 24 + Math.floor(index / 2) * 280;
  });
}

function getFieldName(tableId: string, fieldId: string) {
  return getTableById(tableId)?.fields.find((field) => field.id === fieldId)?.name ?? "unknown";
}

function fieldTypeLabel(field: Field): string {
  if (field.type !== "enum") return dataTypeLabel(field.type);
  const values = field.enumValues?.filter((item) => item.length > 0) ?? [];
  if (values.length === 0) return "enum";
  const preview = values.slice(0, 3).join(", ");
  const suffix = values.length > 3 ? ",…" : "";
  return `enum(${preview}${suffix})`;
}

const measuredTableWidths = new Map<string, number>();

function getFieldMetaLabel(field: Field) {
  return `${fieldTypeLabel(field)}${field.nullable ? "?" : ""}${field.isPrimary ? " | PK" : ""}${field.isUnique && !field.isPrimary ? " | UQ" : ""}${field.autoIncrement ? " | AI" : ""}${field.isIndexed && !field.isPrimary && !field.isUnique ? " | IDX" : ""}`;
}

function estimateTableWidth(table: Table) {
  const titleCharWidth = 9.5;
  const nameCharWidth = 8.5;
  const metaCharWidth = 7;
  const headerActionsWidth = 210;
  const rowActionsWidth = 168;
  const rowOrderWidth = 88;
  const rowGap = 24;
  const horizontalPadding = 32;

  let maxWidth = TABLE_MIN_WIDTH;
  const headerWidth = table.name.length * titleCharWidth + headerActionsWidth + horizontalPadding;
  maxWidth = Math.max(maxWidth, headerWidth);

  table.fields.forEach((field) => {
    const meta = getFieldMetaLabel(field);
    const rowWidth =
      field.name.length * nameCharWidth + meta.length * metaCharWidth + rowActionsWidth + rowOrderWidth + rowGap + horizontalPadding;
    maxWidth = Math.max(maxWidth, rowWidth);
  });

  return Math.ceil(maxWidth);
}

function getTableHeight(table: Table) {
  return TABLE_HEADER_HEIGHT + table.fields.length * TABLE_ROW_HEIGHT;
}

function getTableWidth(table: Table) {
  return measuredTableWidths.get(table.id) ?? estimateTableWidth(table);
}

function measureTableWidths() {
  measuredTableWidths.clear();
  state.tables.forEach((table) => {
    const element = diagramElement.querySelector<HTMLElement>(`.table-card[data-table-id="${table.id}"]`);
    if (element) {
      measuredTableWidths.set(table.id, element.offsetWidth);
    }
  });
}

function getCanvasBounds() {
  const viewportWidth = diagramElement.clientWidth || 900;
  const viewportHeight = diagramElement.clientHeight || 650;
  const maxRight = Math.max(700, ...state.tables.map((table) => table.x + getTableWidth(table) + BASE_PADDING)) + CANVAS_GUTTER * 2;
  const maxBottom = Math.max(500, ...state.tables.map((table) => table.y + getTableHeight(table) + BASE_PADDING)) + CANVAS_GUTTER * 2;
  const minLogicalWidth = viewportWidth / state.zoom + CANVAS_GUTTER * 2;
  const minLogicalHeight = viewportHeight / state.zoom + CANVAS_GUTTER * 2;
  const logicalWidth = Math.max(maxRight, minLogicalWidth);
  const logicalHeight = Math.max(maxBottom, minLogicalHeight);
  return {
    logicalWidth,
    logicalHeight,
    scaledWidth: Math.ceil(logicalWidth * state.zoom),
    scaledHeight: Math.ceil(logicalHeight * state.zoom),
  };
}

function getTablesLogicalBounds() {
  if (state.tables.length === 0) {
    return { minX: 0, minY: 0, maxX: 800, maxY: 600, width: 800, height: 600 };
  }
  const minX = Math.min(...state.tables.map((table) => table.x));
  const minY = Math.min(...state.tables.map((table) => table.y));
  const maxX = Math.max(...state.tables.map((table) => table.x + getTableWidth(table)));
  const maxY = Math.max(...state.tables.map((table) => table.y + getTableHeight(table)));
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function setZoom(nextZoom: number, focusClientX?: number, focusClientY?: number) {
  const boundedZoom = clamp(Number(nextZoom.toFixed(2)), 0.3, 2.5);
  const previousZoom = state.zoom;
  if (boundedZoom === previousZoom) return;

  const viewportRect = diagramElement.getBoundingClientRect();
  const relativeX = focusClientX ?? viewportRect.left + viewportRect.width / 2;
  const relativeY = focusClientY ?? viewportRect.top + viewportRect.height / 2;
  const logicalX = (diagramElement.scrollLeft + (relativeX - viewportRect.left)) / previousZoom;
  const logicalY = (diagramElement.scrollTop + (relativeY - viewportRect.top)) / previousZoom;

  state.zoom = boundedZoom;
  renderDiagram();

  diagramElement.scrollLeft = logicalX * state.zoom - (relativeX - viewportRect.left);
  diagramElement.scrollTop = logicalY * state.zoom - (relativeY - viewportRect.top);
  persistState();
}

function fitContentToViewport() {
  const viewportWidth = diagramElement.clientWidth;
  const viewportHeight = diagramElement.clientHeight;
  const bounds = getTablesLogicalBounds();
  const padding = 60;
  const zoomByWidth = (viewportWidth - padding) / Math.max(bounds.width, 1);
  const zoomByHeight = (viewportHeight - padding) / Math.max(bounds.height, 1);
  const nextZoom = clamp(Math.min(zoomByWidth, zoomByHeight), 0.3, 2.5);

  state.zoom = Number(nextZoom.toFixed(2));
  renderDiagram();

  const centerLogicalX = bounds.minX + bounds.width / 2;
  const centerLogicalY = bounds.minY + bounds.height / 2;
  diagramElement.scrollLeft = (centerLogicalX + CANVAS_GUTTER) * state.zoom - viewportWidth / 2;
  diagramElement.scrollTop = (centerLogicalY + CANVAS_GUTTER) * state.zoom - viewportHeight / 2;
  persistState();
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

function mapFieldType(field: Field, dialect: SqlDialect) {
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

function quoteIdentifier(identifier: string, dialect: SqlDialect) {
  if (dialect === "mysql") return `\`${identifier}\``;
  if (dialect === "postgresql") return `"${identifier.replace(/"/g, '""')}"`;
  return `[${identifier}]`;
}

function sqlDialectLabel(dialect: SqlDialect) {
  if (dialect === "mysql") return "MySQL";
  if (dialect === "postgresql") return "PostgreSQL";
  return "SQL Server";
}

function openSqlModal(dialect: SqlDialect, sql: string) {
  sqlModalTitleElement.textContent = `SQL generado (${sqlDialectLabel(dialect)})`;
  sqlModalOutputElement.value = sql;
  sqlModalElement.classList.remove("hidden");
}

function generateSql(dialect: SqlDialect) {
  const statements: string[] = [];
  state.tables.forEach((table) => {
    const tableName = quoteIdentifier(table.name, dialect);
    const primaryKeys = table.fields.filter((field) => field.isPrimary).map((field) => quoteIdentifier(field.name, dialect));
    const uniqueFields = table.fields.filter((field) => field.isUnique && !field.isPrimary);
    const columnLines = table.fields.map((field) => {
      const forceNotNull = isAutoIncrementType(field.type) || field.autoIncrement;
      const nullable = forceNotNull ? "NOT NULL" : field.nullable ? "NULL" : "NOT NULL";
      return `  ${quoteIdentifier(field.name, dialect)} ${mapFieldType(field, dialect)} ${nullable}`;
    });
    const relationConstraints = state.relations
      .filter((relation) => relation.fromTableId === table.id)
      .map((relation) => {
        const fromField = getFieldName(relation.fromTableId, relation.fromFieldId);
        const toTable = getTableById(relation.toTableId);
        const toField = getFieldName(relation.toTableId, relation.toFieldId);
        if (!toTable) return "";
        return `  FOREIGN KEY (${quoteIdentifier(fromField, dialect)}) REFERENCES ${quoteIdentifier(toTable.name, dialect)} (${quoteIdentifier(toField, dialect)})`;
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
  openSqlModal(dialect, statements.join("\n\n"));
}

function removeTable(tableId: string) {
  state.tables = state.tables.filter((table) => table.id !== tableId);
  state.relations = state.relations.filter((relation) => relation.fromTableId !== tableId && relation.toTableId !== tableId);
  persistState();
  refreshSelects();
  renderDiagram();
}

function renameTable(tableId: string) {
  const table = getTableById(tableId);
  if (!table) return;
  const value = window.prompt("Nuevo nombre de tabla", table.name);
  if (value === null) return;
  const newName = safeName(value);
  if (!newName) return;
  table.name = newName;
  persistState();
  refreshSelects();
  renderDiagram();
}

function createProject() {
  const nameInput = window.prompt("Nombre del nuevo proyecto", `proyecto_${state.projects.length + 1}`);
  if (nameInput === null) return;
  const projectName = nameInput.trim() || `proyecto_${state.projects.length + 1}`;
  const projectId = generateId("prj");
  const newProject: Project = {
    id: projectId,
    name: projectName,
    tables: [],
    relations: [],
    zoom: 1,
  };
  state.projects.push(newProject);
  state.activeProjectId = projectId;
  syncStateFromActiveProject();
  persistState();
  refreshProjectSelect();
  refreshSelects();
  renderDiagram();
}

function renameProject() {
  const active = getActiveProject();
  const nameInput = window.prompt("Nuevo nombre del proyecto", active.name);
  if (nameInput === null) return;
  const projectName = nameInput.trim();
  if (!projectName) return;
  active.name = projectName;
  persistState();
  refreshProjectSelect();
}

function deleteProject() {
  if (state.projects.length <= 1) {
    alert("Debe existir al menos un proyecto.");
    return;
  }
  const active = getActiveProject();
  const confirmDelete = window.confirm(`Eliminar proyecto "${active.name}"?`);
  if (!confirmDelete) return;
  state.projects = state.projects.filter((project) => project.id !== active.id);
  state.activeProjectId = state.projects[0].id;
  syncStateFromActiveProject();
  persistState();
  refreshProjectSelect();
  refreshSelects();
  renderDiagram();
}

function switchProject(projectId: string) {
  if (!state.projects.some((project) => project.id === projectId)) return;
  state.activeProjectId = projectId;
  syncStateFromActiveProject();
  persistState();
  refreshProjectSelect();
  refreshSelects();
  renderDiagram();
}

function isValidTable(raw: unknown): raw is Table {
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

function parseImportedProject(raw: unknown): Omit<Project, "id"> | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Partial<ExportedProject> & { tables?: Table[]; relations?: Relation[]; zoom?: number; name?: string };

  let name: string;
  let tables: Table[];
  let relations: Relation[];
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

function exportProjectAsJson() {
  syncActiveProjectFromState();
  const project = getActiveProject();
  const payload: ExportedProject = {
    version: 1,
    name: project.name,
    tables: project.tables,
    relations: project.relations,
    zoom: project.zoom,
  };
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

function importProjectFromJson(file: File) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result)) as unknown;
      const imported = parseImportedProject(parsed);
      if (!imported) {
        alert("El archivo JSON no tiene un formato de proyecto valido.");
        return;
      }

      const existing = state.projects.find((project) => project.name === imported.name);
      if (existing) {
        existing.tables = imported.tables;
        existing.relations = imported.relations;
        existing.zoom = imported.zoom;
        state.activeProjectId = existing.id;
      } else {
        const newProject: Project = {
          id: generateId("prj"),
          ...imported,
        };
        state.projects.push(newProject);
        state.activeProjectId = newProject.id;
      }

      syncStateFromActiveProject();
      persistState();
      refreshProjectSelect();
      refreshSelects();
      renderDiagram();
      alert(`Proyecto "${imported.name}" ${existing ? "actualizado" : "importado"} correctamente.`);
    } catch {
      alert("No se pudo leer el archivo JSON.");
    }
  };
  reader.readAsText(file);
}

function removeField(tableId: string, fieldId: string) {
  const table = getTableById(tableId);
  if (!table) return;
  table.fields = table.fields.filter((field) => field.id !== fieldId);
  state.relations = state.relations.filter((relation) => !(relation.fromTableId === tableId && relation.fromFieldId === fieldId) && !(relation.toTableId === tableId && relation.toFieldId === fieldId));
  persistState();
  refreshSelects();
  renderDiagram();
}

function openFieldEditModal(tableId: string, fieldId: string) {
  const table = getTableById(tableId);
  const field = table?.fields.find((item) => item.id === fieldId);
  if (!table || !field) return;
  fieldEditTableIdElement.value = tableId;
  fieldEditFieldIdElement.value = fieldId;
  fieldEditNameElement.value = field.name;
  fieldEditTypeSelect.setValue(field.type);
  fieldEditNullableElement.checked = field.nullable;
  fieldEditPrimaryElement.checked = field.isPrimary;
  fieldEditUniqueElement.checked = field.isUnique;
  fieldEditAutoincElement.checked = field.autoIncrement;
  fieldEditIndexedElement.checked = field.isIndexed;
  fieldEditEnumValuesTextareaElement.value = field.enumValues?.length ? field.enumValues.join(", ") : "";
  syncFieldEditEnumRowVisibility();
  fieldEditModalElement.classList.remove("hidden");
}

function applyFieldRules(field: Field, table: Table) {
  if (isAutoIncrementType(field.type)) {
    field.autoIncrement = true;
    field.isPrimary = true;
    field.isUnique = true;
    field.nullable = false;
    field.isIndexed = true;
  }

  if (field.type === "enum") {
    field.autoIncrement = false;
    if (!field.enumValues) {
      field.enumValues = [];
    }
  } else {
    delete field.enumValues;
  }

  if (field.autoIncrement) {
    field.nullable = false;
    if (!isIntegerLikeType(field.type)) {
      field.autoIncrement = false;
    }
  }

  if (field.isPrimary) {
    field.isUnique = true;
    field.nullable = false;
    field.isIndexed = true;
    table.fields.forEach((item) => {
      if (item.id !== field.id) item.isPrimary = false;
    });
  }

  if (field.isUnique) {
    field.isIndexed = true;
  }
}

function relationStyle(kind: RelationKind) {
  if (kind === "1:1") return "rel-one-one";
  if (kind === "N:M") return "rel-many-many";
  return "rel-one-many";
}

function chooseAnchors(fromTable: Table, fromFieldId: string, toTable: Table, toFieldId: string): { from: FieldAnchor; to: FieldAnchor } {
  const fromFieldIndex = fromTable.fields.findIndex((field) => field.id === fromFieldId);
  const toFieldIndex = toTable.fields.findIndex((field) => field.id === toFieldId);
  const fromY = fromTable.y + TABLE_HEADER_HEIGHT + Math.max(0, fromFieldIndex) * TABLE_ROW_HEIGHT + TABLE_ROW_HEIGHT / 2;
  const toY = toTable.y + TABLE_HEADER_HEIGHT + Math.max(0, toFieldIndex) * TABLE_ROW_HEIGHT + TABLE_ROW_HEIGHT / 2;
  const fromCenterX = fromTable.x + getTableWidth(fromTable) / 2;
  const toCenterX = toTable.x + getTableWidth(toTable) / 2;
  const fromCenterY = fromTable.y + getTableHeight(fromTable) / 2;
  const toCenterY = toTable.y + getTableHeight(toTable) / 2;
  const deltaX = toCenterX - fromCenterX;
  const deltaY = toCenterY - fromCenterY;

  if (Math.abs(deltaX) >= Math.abs(deltaY)) {
    if (deltaX >= 0) {
      return {
        from: { x: fromTable.x + getTableWidth(fromTable), y: fromY, side: "right" },
        to: { x: toTable.x, y: toY, side: "left" },
      };
    }
    return {
      from: { x: fromTable.x, y: fromY, side: "left" },
      to: { x: toTable.x + getTableWidth(toTable), y: toY, side: "right" },
    };
  }

  if (deltaY >= 0) {
    return {
      from: { x: fromTable.x + getTableWidth(fromTable) / 2, y: fromTable.y + getTableHeight(fromTable), side: "bottom" },
      to: { x: toTable.x + getTableWidth(toTable) / 2, y: toTable.y, side: "top" },
    };
  }
  return {
    from: { x: fromTable.x + getTableWidth(fromTable) / 2, y: fromTable.y, side: "top" },
    to: { x: toTable.x + getTableWidth(toTable) / 2, y: toTable.y + getTableHeight(toTable), side: "bottom" },
  };
}

function getRouteTables() {
  return state.tables.map((table) => ({
    id: table.id,
    x: table.x,
    y: table.y,
    width: getTableWidth(table),
    height: getTableHeight(table),
  }));
}

function relationLaneKey(relation: Relation) {
  return `${relation.fromTableId}:${relation.fromFieldId}->${relation.toTableId}:${relation.toFieldId}`;
}

function moveField(tableId: string, fieldId: string, direction: "up" | "down") {
  const table = getTableById(tableId);
  if (!table) return;
  const index = table.fields.findIndex((field) => field.id === fieldId);
  if (index < 0) return;
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= table.fields.length) return;
  const [field] = table.fields.splice(index, 1);
  table.fields.splice(targetIndex, 0, field);
  persistState();
  refreshSelects();
  renderDiagram();
}

function editRelationKind(relationId: string) {
  const relation = state.relations.find((item) => item.id === relationId);
  if (!relation) return;
  const input = window.prompt("Tipo de relacion (1:1, 1:N, N:M)", relation.kind);
  if (input === null) return;
  const normalized = input.trim() as RelationKind;
  const allowed: RelationKind[] = ["1:1", "1:N", "N:M"];
  if (!allowed.includes(normalized)) {
    alert("Tipo no valido. Usa 1:1, 1:N o N:M.");
    return;
  }
  relation.kind = normalized;
  persistState();
  renderDiagram();
}

function removeRelation(relationId: string) {
  const relation = state.relations.find((item) => item.id === relationId);
  if (!relation) return;
  const fromTable = getTableById(relation.fromTableId)?.name ?? "?";
  const toTable = getTableById(relation.toTableId)?.name ?? "?";
  const fromField = getFieldName(relation.fromTableId, relation.fromFieldId);
  const toField = getFieldName(relation.toTableId, relation.toFieldId);
  const ok = window.confirm(`Eliminar la relacion ${fromTable}.${fromField} -> ${toTable}.${toField}?`);
  if (!ok) return;
  state.relations = state.relations.filter((item) => item.id !== relationId);
  persistState();
  refreshSelects();
  renderDiagram();
}

function buildRelationMarkup(bounds: ReturnType<typeof getCanvasBounds>) {
  const laneUsage = new Map<string, number>();
  const routeTables = getRouteTables();
  return state.relations
    .map((relation, index) => {
      const fromTable = getTableById(relation.fromTableId);
      const toTable = getTableById(relation.toTableId);
      if (!fromTable || !toTable) return "";
      const laneKey = relationLaneKey(relation);
      const laneOffset = laneUsage.get(laneKey) ?? 0;
      laneUsage.set(laneKey, laneOffset + 1);
      const { from: fromAnchor, to: toAnchor } = chooseAnchors(fromTable, relation.fromFieldId, toTable, relation.toFieldId);
      const { path, labelPoint } = buildRoutedRelationPath(
        fromAnchor,
        toAnchor,
        routeTables,
        relation.fromTableId,
        relation.toTableId,
        laneOffset,
        CANVAS_GUTTER,
        state.zoom,
      );
      const fromField = getFieldName(relation.fromTableId, relation.fromFieldId);
      const toField = getFieldName(relation.toTableId, relation.toFieldId);
      const fromTableName = fromTable.name;
      const toTableName = toTable.name;
      const relationLabel = relation.kind;
      const relationTooltip = `${fromTableName}.${fromField} -> ${toTableName}.${toField}`;
      const labelWidth = 88;
      const labelOffsetX = -labelWidth / 2;
      const scaledLabelX = clamp(labelPoint.x, labelWidth / 2 + 8, bounds.scaledWidth - labelWidth / 2 - 8);
      const scaledLabelY = clamp(labelPoint.y, 16, bounds.scaledHeight - 8);
      return `
        <g class="relation-bundle" data-relation-id="${relation.id}" style="--relation-z:${20 + index}">
          <path class="relation-path ${relationStyle(relation.kind)}" data-relation-id="${relation.id}" d="${path}" marker-end="url(#arrow-head)">
            <title>${relationTooltip}</title>
          </path>
          <circle class="relation-anchor relation-anchor-from" cx="${(fromAnchor.x + CANVAS_GUTTER) * state.zoom}" cy="${(fromAnchor.y + CANVAS_GUTTER) * state.zoom}" r="4"></circle>
          <circle class="relation-anchor relation-anchor-to" cx="${(toAnchor.x + CANVAS_GUTTER) * state.zoom}" cy="${(toAnchor.y + CANVAS_GUTTER) * state.zoom}" r="4"></circle>
          <g class="relation-label" transform="translate(${scaledLabelX}, ${scaledLabelY})">
            <rect x="${labelOffsetX}" y="-14" width="${labelWidth}" height="18" rx="6" class="relation-label-box"></rect>
            <text x="0" y="-4" text-anchor="middle" class="relation-label-text">${relationLabel}</text>
            <text x="0" y="6" text-anchor="middle" class="relation-label-subtext">${fromField} → ${toField}</text>
            <g data-relation-id="${relation.id}" class="relation-label-edit">
              <title>${relationTooltip} (clic para cambiar tipo)</title>
              <rect x="${labelOffsetX}" y="-14" width="${labelWidth - 22}" height="18" fill="transparent"></rect>
            </g>
            <g class="relation-delete-btn" data-action="delete-relation" data-relation-id="${relation.id}">
              <title>Eliminar relacion</title>
              <rect x="${labelWidth / 2 - 18}" y="-14" width="18" height="18" rx="4" class="relation-delete-hit"></rect>
              <text x="${labelWidth / 2 - 9}" y="-4" text-anchor="middle" class="relation-delete-x">×</text>
            </g>
          </g>
        </g>
      `;
    })
    .join("");
}

function buildTableMarkup() {
  return state.tables
    .map((table) => {
      const fields = table.fields
        .map(
          (field, fieldIndex) => `
            <li>
              <div class="field-left">
                <div class="field-order-actions">
                  <button type="button" class="field-order-btn" data-action="move-field-up" data-table-id="${table.id}" data-field-id="${field.id}" ${fieldIndex === 0 ? "disabled" : ""} title="Subir campo">↑</button>
                  <button type="button" class="field-order-btn" data-action="move-field-down" data-table-id="${table.id}" data-field-id="${field.id}" ${fieldIndex === table.fields.length - 1 ? "disabled" : ""} title="Bajar campo">↓</button>
                </div>
                <span class="field-name">${field.name}</span>
              </div>
              <div class="field-right">
                <small>${getFieldMetaLabel(field)}</small>
                <button type="button" class="neutral-btn table-action-btn" data-action="edit-field" data-table-id="${table.id}" data-field-id="${field.id}">Editar</button>
                <button type="button" class="danger-btn table-action-btn" data-action="delete-field" data-table-id="${table.id}" data-field-id="${field.id}">X</button>
              </div>
            </li>
          `,
        )
        .join("");
      return `
        <article class="table-card" data-table-id="${table.id}" style="left:${(table.x + CANVAS_GUTTER) * state.zoom}px;top:${(table.y + CANVAS_GUTTER) * state.zoom}px;transform:scale(${state.zoom})">
          <div class="table-card-header">
            <h3>${table.name}</h3>
            <div class="table-actions">
              <button type="button" class="neutral-btn table-action-btn" data-action="rename-table" data-table-id="${table.id}">Editar</button>
              <button type="button" class="danger-btn table-action-btn" data-action="delete-table" data-table-id="${table.id}">Eliminar</button>
            </div>
          </div>
          <ul>${fields}</ul>
        </article>
      `;
    })
    .join("");
}

function renderDiagram() {
  ensureTablePositions();
  zoomLabelElement.textContent = `${Math.round(state.zoom * 100)}%`;
  measuredTableWidths.clear();

  let bounds = getCanvasBounds();
  const tableMarkup = buildTableMarkup();

  diagramElement.innerHTML = `
    <div id="diagram-scene" class="diagram-scene" style="width:${bounds.scaledWidth}px;height:${bounds.scaledHeight}px">
      <div class="table-layer">${tableMarkup}</div>
      <svg class="relation-layer" width="${bounds.scaledWidth}" height="${bounds.scaledHeight}">
        <defs>
          <marker id="arrow-head" markerWidth="10" markerHeight="8" refX="10" refY="4" orient="auto">
            <polygon points="0 0, 10 4, 0 8" class="arrow-head"></polygon>
          </marker>
        </defs>
      </svg>
    </div>
  `;

  measureTableWidths();
  bounds = getCanvasBounds();

  const scene = diagramElement.querySelector<HTMLElement>("#diagram-scene");
  const relationLayer = diagramElement.querySelector<SVGSVGElement>(".relation-layer");
  if (scene) {
    scene.style.width = `${bounds.scaledWidth}px`;
    scene.style.height = `${bounds.scaledHeight}px`;
  }
  if (relationLayer) {
    relationLayer.setAttribute("width", String(bounds.scaledWidth));
    relationLayer.setAttribute("height", String(bounds.scaledHeight));
    relationLayer.innerHTML = `
      <defs>
        <marker id="arrow-head" markerWidth="10" markerHeight="8" refX="10" refY="4" orient="auto">
          <polygon points="0 0, 10 4, 0 8" class="arrow-head"></polygon>
        </marker>
      </defs>
      ${buildRelationMarkup(bounds)}
    `;
  }
}

function safeDownloadLink(link: HTMLAnchorElement) {
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function computeSafeExportScale(width: number, height: number, preferredScale = 2) {
  const bySide = Math.min(MAX_EXPORT_SIDE / Math.max(width, 1), MAX_EXPORT_SIDE / Math.max(height, 1));
  const byPixels = Math.sqrt(MAX_EXPORT_PIXELS / Math.max(width * height, 1));
  const safeScale = Math.min(preferredScale, bySide, byPixels);
  return Math.max(0.35, Number(safeScale.toFixed(2)));
}

function downloadPngFromCanvas(canvas: HTMLCanvasElement) {
  const filename = `db-schema-${Date.now()}.png`;
  const link = document.createElement("a");
  link.download = filename;
  if (canvas.toBlob) {
    canvas.toBlob((blob) => {
      if (!blob) {
        link.href = canvas.toDataURL("image/png");
        safeDownloadLink(link);
        return;
      }
      const url = URL.createObjectURL(blob);
      link.href = url;
      safeDownloadLink(link);
      // Esperamos un ciclo para evitar revocar el blob antes de que el navegador termine la descarga.
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    }, "image/png");
    return;
  }
  link.href = canvas.toDataURL("image/png");
  safeDownloadLink(link);
}

async function exportDiagramAsPng() {
  const scene = diagramElement.querySelector<HTMLElement>("#diagram-scene");
  if (!scene) {
    alert("No hay diagrama para exportar.");
    return;
  }
  try {
    const width = Math.max(1, scene.scrollWidth || scene.offsetWidth);
    const height = Math.max(1, scene.scrollHeight || scene.offsetHeight);
    const initialScale = computeSafeExportScale(width, height, 2);
    const attemptScales = Array.from(new Set([initialScale, 1, 0.75, 0.5, 0.35].filter((item) => item <= initialScale)));
    let lastError: unknown = undefined;

    for (const scale of attemptScales) {
      try {
        const canvas = await html2canvas(scene, {
          backgroundColor: getExportBackgroundColor(),
          scale,
          useCORS: true,
          allowTaint: true,
          width,
          height,
          windowWidth: width,
          windowHeight: height,
          scrollX: 0,
          scrollY: 0,
        });
        downloadPngFromCanvas(canvas);
        return;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError ?? new Error("Export failed");
  } catch (_error) {
    alert("No se pudo exportar la imagen.");
  }
}

function syncFieldEnumRowVisibility() {
  if (!fieldEnumValuesLabel || !fieldEnumValuesTextarea) return;
  const isEnum = fieldTypeSelect.getValue() === "enum";
  fieldEnumValuesLabel.hidden = !isEnum;
  fieldEnumValuesTextarea.hidden = !isEnum;
}

function syncFieldEditEnumRowVisibility() {
  if (!fieldEditEnumValuesLabel || !fieldEditEnumValuesTextarea) return;
  const isEnum = fieldEditTypeSelect.getValue() === "enum";
  fieldEditEnumValuesLabel.hidden = !isEnum;
  fieldEditEnumValuesTextarea.hidden = !isEnum;
}

tableForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(tableForm);
  const tableName = safeName((form.get("tableName") as string) || "");
  if (!tableName) return;
  state.tables.push({
    id: generateId("tbl"),
    name: tableName,
    fields: [createDefaultIdField()],
    x: 24 + state.tables.length * 28,
    y: 24 + state.tables.length * 28,
  });
  persistState();
  tableForm.reset();
  refreshSelects();
  renderDiagram();
});

fieldTypeSelect.onChange(syncFieldEnumRowVisibility);

fieldForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(fieldForm);
  const selectedTableId = fieldTableSelect.getValue();
  const table = getTableById(selectedTableId);
  if (!table) return;
  const fieldName = safeName((form.get("fieldName") as string) || "");
  if (!fieldName) return;
  const hasPrimary = table.fields.some((field) => field.isPrimary);
  const wantsPrimary = form.get("isPrimary") === "on";
  const wantsUnique = form.get("isUnique") === "on";
  const wantsAutoIncrement = form.get("autoIncrement") === "on";
  const wantsIndexed = form.get("isIndexed") === "on";
  const selectedType = normalizeDataType(fieldTypeSelect.getValue() || "text");
  const enumRaw = (form.get("enumValues") as string) || "";
  const parsedEnum = selectedType === "enum" ? parseEnumValuesInput(enumRaw) : undefined;
  const newField = normalizeField({
    id: generateId("fld"),
    name: fieldName,
    type: selectedType,
    nullable: isAutoIncrementType(selectedType) ? false : form.get("nullable") === "on",
    isPrimary: isAutoIncrementType(selectedType) ? true : hasPrimary ? false : wantsPrimary,
    isUnique: wantsUnique || isAutoIncrementType(selectedType),
    autoIncrement: wantsAutoIncrement || isAutoIncrementType(selectedType),
    isIndexed: wantsIndexed || wantsUnique || isAutoIncrementType(selectedType),
    ...(parsedEnum !== undefined ? { enumValues: parsedEnum } : {}),
  });
  applyFieldRules(newField, table);
  table.fields.push(newField);
  persistState();
  const keptType = fieldTypeSelect.getValue();
  const keptNullable = fieldNullableInput.checked;
  const keptPrimary = fieldPrimaryInput.checked;
  const keptUnique = fieldUniqueInput.checked;
  const keptAutoinc = fieldAutoincInput.checked;
  const keptIndexed = fieldIndexedInput.checked;
  fieldNameInput.value = "";
  fieldEnumValuesTextarea.value = "";
  refreshSelects({ fieldTable: true });
  if (selectedTableId) fieldTableSelect.setValue(selectedTableId);
  fieldTypeSelect.setValue(keptType);
  fieldNullableInput.checked = keptNullable;
  fieldPrimaryInput.checked = keptPrimary;
  fieldUniqueInput.checked = keptUnique;
  fieldAutoincInput.checked = keptAutoinc;
  fieldIndexedInput.checked = keptIndexed;
  syncFieldEnumRowVisibility();
  fieldNameInput.focus();
  renderDiagram();
});

fromTableSelect.onChange(() => syncFromFieldSelect(false));
toTableSelect.onChange(() => syncToFieldSelect(false));

relationForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const fromTableId = fromTableSelect.getValue();
  const toTableId = toTableSelect.getValue();
  const fromFieldId = fromFieldSelect.getValue();
  const toFieldId = toFieldSelect.getValue();
  const relationKind = (relationKindSelect.getValue() || "1:N") as RelationKind;
  if (!fromTableId || !toTableId || !fromFieldId || !toFieldId || fromTableId === toTableId) return;
  const relationId = `${fromTableId}_${fromFieldId}__${toTableId}_${toFieldId}`;
  if (state.relations.some((relation) => relation.id === relationId)) return;
  state.relations.push({ id: relationId, fromTableId, fromFieldId, toTableId, toFieldId, kind: relationKind });
  persistState();
  refreshSelects({
    fromTable: true,
    fromField: true,
    toTable: true,
    toField: true,
    relationKind: true,
  });
  renderDiagram();
});

diagramElement.addEventListener("click", (event) => {
  const deleteRelationEl = (event.target as Element).closest("[data-action='delete-relation']");
  if (deleteRelationEl) {
    const relationId = deleteRelationEl.getAttribute("data-relation-id");
    if (relationId) {
      removeRelation(relationId);
      return;
    }
  }

  const relationNode = (event.target as Element).closest("[data-relation-id]");
  if (relationNode) {
    const relationId = relationNode.getAttribute("data-relation-id");
    if (relationId) return editRelationKind(relationId);
  }

  const target = event.target as HTMLElement;
  const action = target.dataset.action;
  if (action === "rename-table" && target.dataset.tableId) return renameTable(target.dataset.tableId);
  if (action === "delete-table" && target.dataset.tableId) return removeTable(target.dataset.tableId);
  if (action === "edit-field" && target.dataset.tableId && target.dataset.fieldId) return openFieldEditModal(target.dataset.tableId, target.dataset.fieldId);
  if (action === "delete-field" && target.dataset.tableId && target.dataset.fieldId) removeField(target.dataset.tableId, target.dataset.fieldId);
  if (action === "move-field-up" && target.dataset.tableId && target.dataset.fieldId) moveField(target.dataset.tableId, target.dataset.fieldId, "up");
  if (action === "move-field-down" && target.dataset.tableId && target.dataset.fieldId) moveField(target.dataset.tableId, target.dataset.fieldId, "down");
});

diagramElement.addEventListener("mousedown", (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  const target = event.target as HTMLElement;
  if ((event.target as Element).closest("[data-relation-id]")) return;
  if (target.closest("button")) return;
  const tableCard = target.closest<HTMLElement>(".table-card");
  if (tableCard) {
    const tableId = tableCard.dataset.tableId;
    if (!tableId) return;
    const bounds = tableCard.getBoundingClientRect();
    dragState = {
      tableId,
      offsetX: (event.clientX - bounds.left) / state.zoom,
      offsetY: (event.clientY - bounds.top) / state.zoom,
    };
    return;
  }

  panState = {
    startX: event.clientX,
    startY: event.clientY,
    startScrollLeft: diagramElement.scrollLeft,
    startScrollTop: diagramElement.scrollTop,
  };
  diagramElement.classList.add("is-panning");
});

window.addEventListener("mousemove", (event) => {
  if (dragState) {
    const table = getTableById(dragState.tableId);
    if (!table) return;
    const viewportBounds = diagramElement.getBoundingClientRect();
    const logicalX = (event.clientX - viewportBounds.left + diagramElement.scrollLeft) / state.zoom;
    const logicalY = (event.clientY - viewportBounds.top + diagramElement.scrollTop) / state.zoom;
    const bounds = getCanvasBounds();
    const tableWidth = getTableWidth(table);
    table.x = clamp(logicalX - CANVAS_GUTTER - dragState.offsetX, 8 - CANVAS_GUTTER, bounds.logicalWidth - tableWidth - CANVAS_GUTTER - 8);
    table.y = clamp(logicalY - CANVAS_GUTTER - dragState.offsetY, 8 - CANVAS_GUTTER, bounds.logicalHeight - 120 - CANVAS_GUTTER);
    renderDiagram();
    return;
  }

  if (panState) {
    const deltaX = event.clientX - panState.startX;
    const deltaY = event.clientY - panState.startY;
    diagramElement.scrollLeft = panState.startScrollLeft - deltaX;
    diagramElement.scrollTop = panState.startScrollTop - deltaY;
  }
});

window.addEventListener("mouseup", () => {
  if (dragState) {
    persistState();
  }
  dragState = null;
  panState = null;
  diagramElement.classList.remove("is-panning");
});

zoomOutButton.addEventListener("click", () => {
  setZoom(state.zoom - 0.1);
});
zoomInButton.addEventListener("click", () => {
  setZoom(state.zoom + 0.1);
});
fitButton.addEventListener("click", fitContentToViewport);

diagramElement.addEventListener(
  "wheel",
  (event) => {
    if (!event.ctrlKey) {
      return;
    }
    event.preventDefault();
    const direction = event.deltaY > 0 ? -0.08 : 0.08;
    setZoom(state.zoom + direction, event.clientX, event.clientY);
  },
  { passive: false },
);

window.addEventListener("resize", () => {
  renderDiagram();
});

window.visualViewport?.addEventListener("resize", () => {
  renderDiagram();
});

themeToggleButtonElement.addEventListener("click", handleThemeToggle);
themeToggleDiagramButtonElement.addEventListener("click", handleThemeToggle);
exportButton.addEventListener("click", () => void exportDiagramAsPng());
mysqlButton.addEventListener("click", () => generateSql("mysql"));
postgresqlButton.addEventListener("click", () => generateSql("postgresql"));
sqlServerButton.addEventListener("click", () => generateSql("sqlserver"));
projectSelect.onChange(() => {
  switchProject(projectSelect.getValue());
});
projectNewButtonElement.addEventListener("click", createProject);
projectRenameButtonElement.addEventListener("click", renameProject);
projectDeleteButtonElement.addEventListener("click", deleteProject);
projectExportJsonButtonElement.addEventListener("click", exportProjectAsJson);
projectImportJsonButtonElement.addEventListener("click", () => {
  projectImportJsonInputElement.click();
});
projectImportJsonInputElement.addEventListener("change", () => {
  const file = projectImportJsonInputElement.files?.[0];
  if (!file) return;
  importProjectFromJson(file);
  projectImportJsonInputElement.value = "";
});

sqlModalClose.addEventListener("click", () => {
  sqlModalElement.classList.add("hidden");
});

sqlModalCopy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(sqlModalOutputElement.value);
    alert("SQL copiado al portapapeles.");
  } catch {
    alert("No se pudo copiar automaticamente.");
  }
});

sqlModalElement.addEventListener("click", (event) => {
  if (event.target === sqlModalElement) {
    sqlModalElement.classList.add("hidden");
  }
});

fieldEditTypeSelect.onChange(() => {
  const selectedType = normalizeDataType(fieldEditTypeSelect.getValue());
  if (isAutoIncrementType(selectedType)) {
    fieldEditAutoincElement.checked = true;
    fieldEditPrimaryElement.checked = true;
    fieldEditUniqueElement.checked = true;
    fieldEditNullableElement.checked = false;
  }
  if (selectedType === "enum") {
    fieldEditAutoincElement.checked = false;
  }
  syncFieldEditEnumRowVisibility();
});

fieldEditAutoincElement.addEventListener("change", () => {
  const currentType = normalizeDataType(fieldEditTypeSelect.getValue());
  if (fieldEditAutoincElement.checked && !isIntegerLikeType(currentType)) {
    fieldEditTypeSelect.setValue("integer");
  }
  if (fieldEditAutoincElement.checked) {
    fieldEditNullableElement.checked = false;
  }
  syncFieldEditEnumRowVisibility();
});

fieldEditPrimaryElement.addEventListener("change", () => {
  if (fieldEditPrimaryElement.checked) {
    fieldEditUniqueElement.checked = true;
    fieldEditNullableElement.checked = false;
  }
});

fieldEditForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const table = getTableById(fieldEditTableIdElement.value);
  const field = table?.fields.find((item) => item.id === fieldEditFieldIdElement.value);
  if (!table || !field) return;

  const newName = safeName(fieldEditNameElement.value);
  if (!newName) return;

  field.name = newName;
  field.type = normalizeDataType(fieldEditTypeSelect.getValue());
  field.nullable = fieldEditNullableElement.checked;
  field.isPrimary = fieldEditPrimaryElement.checked;
  field.isUnique = fieldEditUniqueElement.checked;
  field.autoIncrement = fieldEditAutoincElement.checked;
  field.isIndexed = fieldEditIndexedElement.checked;
  if (field.type === "enum") {
    field.enumValues = parseEnumValuesInput(fieldEditEnumValuesTextareaElement.value);
  } else {
    delete field.enumValues;
  }
  applyFieldRules(field, table);

  persistState();
  refreshSelects();
  renderDiagram();
  fieldEditModalElement.classList.add("hidden");
});

fieldEditClose.addEventListener("click", () => {
  fieldEditModalElement.classList.add("hidden");
});

fieldEditModalElement.addEventListener("click", (event) => {
  if (event.target === fieldEditModalElement) {
    fieldEditModalElement.classList.add("hidden");
  }
});

syncFieldEnumRowVisibility();
refreshProjectSelect();
refreshSelects();
renderDiagram();
