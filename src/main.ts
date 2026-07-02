import { wireCanvasInteractions } from "./diagram/canvas-interactions.ts";
import { createDiagramController } from "./diagram/diagram-controller.ts";
import { loadInitialState, saveState } from "./persistence/storage.ts";
import { exportDiagramAsPng } from "./services/png-export.ts";
import { createStore } from "./state/store.ts";
import { wireTableForm, wireFieldForm, wireRelationForm } from "./ui/forms/forms.ts";
import { wireFieldEditModal } from "./ui/modals/field-edit-modal.ts";
import { wireRelationEditModal } from "./ui/modals/relation-edit-modal.ts";
import { wireSqlModal } from "./ui/modals/sql-modal.ts";
import { wireProjectPanel } from "./ui/project-panel.ts";
import { createSelectControllers } from "./ui/selects.ts";
import { mountAppShell } from "./ui/shell.ts";
import { wireThemeToggles } from "./ui/theme-controls.ts";
import "./styles/style.css";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("No se encontro #app");

mountAppShell(app);

const controlsPanel = document.querySelector<HTMLElement>(".controls");
controlsPanel?.addEventListener(
  "wheel",
  (event) => {
    event.stopPropagation();
  },
  { passive: true },
);

const store = createStore(loadInitialState(), saveState);
const selects = createSelectControllers(store);

const diagramElement = document.querySelector<HTMLDivElement>("#diagram");
const zoomLabel = document.querySelector<HTMLSpanElement>("#zoom-label");
const zoomOutButton = document.querySelector<HTMLButtonElement>("#zoom-out-btn");
const zoomInButton = document.querySelector<HTMLButtonElement>("#zoom-in-btn");
const fitButton = document.querySelector<HTMLButtonElement>("#fit-btn");
const exportButton = document.querySelector<HTMLButtonElement>("#export-btn");

if (!diagramElement || !zoomLabel || !zoomOutButton || !zoomInButton || !fitButton || !exportButton) {
  throw new Error("No se encontraron elementos del diagrama");
}

const diagram = createDiagramController(store, diagramElement, zoomLabel);
const { openFieldEditModal } = wireFieldEditModal(store, selects);
const { openRelationEditModal } = wireRelationEditModal(store);

wireThemeToggles();
wireProjectPanel(store, selects);
wireTableForm(store);
wireFieldForm(store, selects);
wireRelationForm(store, selects);
wireSqlModal(store);
wireCanvasInteractions(store, diagram, {
  onEditField: openFieldEditModal,
  onEditRelation: openRelationEditModal,
});

zoomOutButton.addEventListener("click", () => diagram.setZoom(store.getState().zoom - 0.1));
zoomInButton.addEventListener("click", () => diagram.setZoom(store.getState().zoom + 0.1));
fitButton.addEventListener("click", () => diagram.fitContentToViewport());
exportButton.addEventListener("click", () => void exportDiagramAsPng(diagramElement));

diagramElement.addEventListener(
  "wheel",
  (event) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    const direction = event.deltaY > 0 ? -0.08 : 0.08;
    diagram.setZoom(store.getState().zoom + direction, event.clientX, event.clientY);
  },
  { passive: false },
);

selects.refreshProjectSelect();
selects.refreshSelects();
diagram.render();

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
