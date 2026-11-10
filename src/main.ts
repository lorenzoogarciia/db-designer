import { wireCanvasInteractions } from "./diagram/canvas-interactions.ts";
import { computeAutoLayout } from "./diagram/auto-layout.ts";
import { createDiagramController, LAYOUT_ANIMATION_MS } from "./diagram/diagram-controller.ts";
import { wireZoomInput } from "./ui/zoom-input.ts";
import { loadInitialState, saveState } from "./persistence/storage.ts";
import { exportDiagramAsPng } from "./services/png-export.ts";
import { createStore } from "./state/store.ts";
import { wireTableForm, wireFieldForm, wireRelationForm } from "./ui/forms/forms.ts";
import { wireFieldEditModal } from "./ui/modals/field-edit-modal.ts";
import { wireRelationEditModal } from "./ui/modals/relation-edit-modal.ts";
import { wireSqlModal } from "./ui/modals/sql-modal.ts";
import { wireSqlImportModal } from "./ui/modals/sql-import-modal.ts";
import { wireTableEditorModal } from "./ui/modals/table-editor-modal.ts";
import { confirmDialog } from "./ui/dialog.ts";
import { whenUiFontsReady } from "./ui/fonts.ts";
import { wireShellControls } from "./ui/shell-controls.ts";
import { showToast } from "./ui/toast.ts";
import { createTextMeasurer } from "./utils/dom.ts";
import { wireProjectPanel } from "./ui/project-panel.ts";
import { createSelectControllers } from "./ui/selects.ts";
import { mountAppShell } from "./ui/shell.ts";
import { wireDiagramTableSearch } from "./ui/diagram-table-search.ts";
import { wireThemeToggles } from "./ui/theme-controls.ts";
import "./styles/style.css";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("No se encontro #app");

mountAppShell(app);
wireShellControls();

const controlsPanel = document.querySelector<HTMLElement>(".controls");
controlsPanel?.addEventListener(
  "wheel",
  (event) => {
    event.stopPropagation();
  },
  { passive: true },
);

let lastSaveErrorAt = 0;
function persistState(state: Parameters<typeof saveState>[0]) {
  try {
    saveState(state);
  } catch {
    // Normalmente QuotaExceededError: avisar sin saturar (como mucho cada 10 s).
    const now = Date.now();
    if (now - lastSaveErrorAt > 10_000) {
      lastSaveErrorAt = now;
      showToast("No se pudieron guardar los cambios en el navegador (almacenamiento lleno?). Exporta el proyecto a JSON.", "error");
    }
  }
}

const store = createStore(loadInitialState(), persistState);
const selects = createSelectControllers(store);

const diagramElement = document.querySelector<HTMLDivElement>("#diagram");
const zoomInput = document.querySelector<HTMLInputElement>("#zoom-input");
const zoomOutButton = document.querySelector<HTMLButtonElement>("#zoom-out-btn");
const zoomInButton = document.querySelector<HTMLButtonElement>("#zoom-in-btn");
const fitButton = document.querySelector<HTMLButtonElement>("#fit-btn");
const exportButton = document.querySelector<HTMLButtonElement>("#export-btn");

if (!diagramElement || !zoomInput || !zoomOutButton || !zoomInButton || !fitButton || !exportButton) {
  throw new Error("No se encontraron elementos del diagrama");
}

const diagram = createDiagramController(store, diagramElement, zoomInput);
const { openFieldEditModal } = wireFieldEditModal(store, selects);
const { openRelationEditModal } = wireRelationEditModal(store);

wireThemeToggles();
wireProjectPanel(store, selects);
const { openTableCreator, openTableEditor } = wireTableEditorModal(store, diagram);
wireTableForm(openTableCreator);
document.querySelector<HTMLButtonElement>("#new-table-btn")?.addEventListener("click", () => openTableCreator());
// Tecla N (fuera de campos de texto y sin modales abiertos): nueva tabla.
window.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() !== "n" || event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target as HTMLElement | null;
  if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
  if (document.querySelector(".modal:not(.hidden)")) return;
  event.preventDefault();
  openTableCreator();
});
wireFieldForm(store, selects);
wireRelationForm(store, selects);
wireSqlModal(store);
wireSqlImportModal(store, { onImported: () => diagram.fitContentToViewport(true) });
wireCanvasInteractions(store, diagram, {
  onEditTable: openTableEditor,
  onEditField: openFieldEditModal,
  onEditRelation: openRelationEditModal,
  onFocusTable: (tableId) => diagram.focusTable(tableId),
  onCreateTableAt: (point) => openTableCreator({ at: point }),
  confirmDestructive: (title, message, confirmLabel) => confirmDialog({ title, message, confirmLabel, danger: true }),
});
wireDiagramTableSearch(store, diagram);

zoomOutButton.addEventListener("click", () => diagram.zoomBy(1 / 1.25));
zoomInButton.addEventListener("click", () => diagram.zoomBy(1.25));
fitButton.addEventListener("click", () => diagram.fitContentToViewport(true));
wireZoomInput(zoomInput, diagram);

// Organizar: recoloca todas las tablas según sus claves foráneas (con «Deshacer»).
const arrangeButton = document.querySelector<HTMLButtonElement>("#arrange-btn");
function applyPositions(positions: Record<string, { x: number; y: number }>) {
  diagram.stopCameraAnimation();
  diagram.animateNextLayoutChange();
  store.dispatch({ type: "SET_TABLE_POSITIONS", positions });
  diagram.fitContentToViewport(true, LAYOUT_ANIMATION_MS);
}
arrangeButton?.addEventListener("click", () => {
  const { tables, relations } = store.getState();
  if (tables.length === 0) return;
  const bounds = diagram.getContentBounds();
  const next = computeAutoLayout(tables, relations, {
    getTableWidth: diagram.getTableWidth,
    measureOverviewName: createTextMeasurer(".table-card h3"),
    viewport: diagram.getViewportSize(),
    origin: bounds ? { x: Math.round(bounds.minX), y: Math.round(bounds.minY) } : undefined,
  });
  const previous = Object.fromEntries(tables.map((table) => [table.id, { x: table.x, y: table.y }]));
  if (tables.every((table) => next.get(table.id)?.x === table.x && next.get(table.id)?.y === table.y)) {
    diagram.fitContentToViewport(true);
    showToast("Las tablas ya están organizadas.", "info");
    return;
  }
  const projectId = store.getState().activeProjectId;
  applyPositions(Object.fromEntries(next));
  showToast("Tablas organizadas según sus relaciones.", "success", {
    label: "Deshacer",
    onAction: () => {
      if (store.getState().activeProjectId === projectId) applyPositions(previous);
    },
  });
});
function syncArrangeButton() {
  if (arrangeButton) arrangeButton.disabled = store.getState().tables.length < 2;
}
syncArrangeButton();
store.subscribe(syncArrangeButton);
exportButton.addEventListener("click", () => void exportDiagramAsPng(diagram));

selects.refreshProjectSelect();
selects.refreshSelects();
void whenUiFontsReady().then(() => {
  diagram.render();
  // Al abrir, encuadrar todo el proyecto (las tablas ya estan medidas tras el primer render).
  diagram.fitContentToViewport();
});

// Estado vacío del lienzo: se muestra mientras el proyecto activo no tiene tablas.
const canvasEmpty = document.querySelector<HTMLElement>("#canvas-empty");
document.querySelector("#canvas-empty-new-btn")?.addEventListener("click", () => openTableCreator());
document.querySelector("#canvas-empty-import-btn")?.addEventListener("click", () =>
  document.querySelector<HTMLButtonElement>("#project-import-sql-btn")?.click(),
);
function syncCanvasEmpty() {
  if (canvasEmpty) canvasEmpty.hidden = store.getState().tables.length > 0;
}
syncCanvasEmpty();
store.subscribe(syncCanvasEmpty);

let schemaSignature = "";
store.subscribe(() => {
  const state = store.getState();
  const signature = [
    state.activeProjectId,
    state.projects.map((p) => `${p.id}:${p.name}`).join(","),
    state.tables.map((t) => `${t.id}:${t.name}:${t.fields.map((f) => f.id).join(".")}`).join("|"),
    state.relations.map((r) => r.id).join(","),
  ].join(";");
  if (signature !== schemaSignature) {
    schemaSignature = signature;
    selects.refreshProjectSelect();
    selects.refreshSelects();
  }
});
