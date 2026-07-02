import { clamp } from "../domain/ids.ts";
import type { Store } from "../state/store.ts";
import { getTableById } from "../state/store.ts";
import { CANVAS_GUTTER, getCanvasBounds, estimateTableWidth } from "./layout.ts";
import type { DiagramController } from "./diagram-controller.ts";

interface DragState {
  tableId: string;
  offsetX: number;
  offsetY: number;
}

interface PanState {
  startX: number;
  startY: number;
  startScrollLeft: number;
  startScrollTop: number;
}

export function wireCanvasInteractions(
  store: Store,
  diagram: DiagramController,
  handlers: { onEditField: (tableId: string, fieldId: string) => void },
): void {
  const diagramElement = diagram.getDiagramElement();
  let dragState: DragState | null = null;
  let panState: PanState | null = null;

  diagramElement.addEventListener("click", (event) => {
    const deleteRelationEl = (event.target as Element).closest("[data-action='delete-relation']");
    if (deleteRelationEl) {
      const relationId = deleteRelationEl.getAttribute("data-relation-id");
      if (relationId) {
        const relation = store.getState().relations.find((r) => r.id === relationId);
        if (!relation) return;
        const fromTable = getTableById(store.getState(), relation.fromTableId)?.name ?? "?";
        const toTable = getTableById(store.getState(), relation.toTableId)?.name ?? "?";
        const fromField = store.getState().tables.find((t) => t.id === relation.fromTableId)?.fields.find((f) => f.id === relation.fromFieldId)?.name ?? "?";
        const toField = store.getState().tables.find((t) => t.id === relation.toTableId)?.fields.find((f) => f.id === relation.toFieldId)?.name ?? "?";
        const ok = window.confirm(`Eliminar la relacion ${fromTable}.${fromField} -> ${toTable}.${toField}?`);
        if (!ok) return;
        store.dispatch({ type: "REMOVE_RELATION", relationId });
        return;
      }
    }

    const relationNode = (event.target as Element).closest("[data-relation-id]");
    if (relationNode && !deleteRelationEl) {
      const relationId = relationNode.getAttribute("data-relation-id");
      if (relationId) {
        const relation = store.getState().relations.find((r) => r.id === relationId);
        if (!relation) return;
        const input = window.prompt("Tipo de relacion (1:1, 1:N, N:M)", relation.kind);
        if (input === null) return;
        const normalized = input.trim() as "1:1" | "1:N" | "N:M";
        const allowed = ["1:1", "1:N", "N:M"] as const;
        if (!allowed.includes(normalized)) {
          alert("Tipo no valido. Usa 1:1, 1:N o N:M.");
          return;
        }
        store.dispatch({ type: "UPDATE_RELATION_KIND", relationId, kind: normalized });
        return;
      }
    }

    const target = event.target as HTMLElement;
    const action = target.dataset.action;
    if (action === "rename-table" && target.dataset.tableId) {
      const table = getTableById(store.getState(), target.dataset.tableId);
      if (!table) return;
      const value = window.prompt("Nuevo nombre de tabla", table.name);
      if (value === null) return;
      const newName = value.trim().replace(/\s+/g, "_").toLowerCase();
      if (!newName) return;
      store.dispatch({ type: "RENAME_TABLE", tableId: target.dataset.tableId, name: newName });
      return;
    }
    if (action === "delete-table" && target.dataset.tableId) {
      store.dispatch({ type: "REMOVE_TABLE", tableId: target.dataset.tableId });
      return;
    }
    if (action === "edit-field" && target.dataset.tableId && target.dataset.fieldId) {
      handlers.onEditField(target.dataset.tableId, target.dataset.fieldId);
      return;
    }
    if (action === "delete-field" && target.dataset.tableId && target.dataset.fieldId) {
      store.dispatch({ type: "REMOVE_FIELD", tableId: target.dataset.tableId, fieldId: target.dataset.fieldId });
      return;
    }
    if (action === "move-field-up" && target.dataset.tableId && target.dataset.fieldId) {
      store.dispatch({ type: "MOVE_FIELD", tableId: target.dataset.tableId, fieldId: target.dataset.fieldId, direction: "up" });
      return;
    }
    if (action === "move-field-down" && target.dataset.tableId && target.dataset.fieldId) {
      store.dispatch({ type: "MOVE_FIELD", tableId: target.dataset.tableId, fieldId: target.dataset.fieldId, direction: "down" });
    }
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
      const zoom = store.getState().zoom;
      dragState = {
        tableId,
        offsetX: (event.clientX - bounds.left) / zoom,
        offsetY: (event.clientY - bounds.top) / zoom,
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
      const state = store.getState();
      const table = getTableById(state, dragState.tableId);
      if (!table) return;
      const viewportBounds = diagramElement.getBoundingClientRect();
      const logicalX = (event.clientX - viewportBounds.left + diagramElement.scrollLeft) / state.zoom;
      const logicalY = (event.clientY - viewportBounds.top + diagramElement.scrollTop) / state.zoom;
      const getTableWidth = (t: typeof table) => estimateTableWidth(t);
      const bounds = getCanvasBounds(state.tables, state.zoom, diagramElement.clientWidth || 900, diagramElement.clientHeight || 650, getTableWidth);
      const tableWidth = getTableWidth(table);
      const x = clamp(logicalX - CANVAS_GUTTER - dragState.offsetX, 8 - CANVAS_GUTTER, bounds.logicalWidth - tableWidth - CANVAS_GUTTER - 8);
      const y = clamp(logicalY - CANVAS_GUTTER - dragState.offsetY, 8 - CANVAS_GUTTER, bounds.logicalHeight - 120 - CANVAS_GUTTER);
      store.dispatch({ type: "UPDATE_TABLE_POSITION", tableId: dragState.tableId, x, y }, { persist: false });
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
      const state = store.getState();
      const table = getTableById(state, dragState.tableId);
      if (table) {
        store.dispatch({ type: "UPDATE_TABLE_POSITION", tableId: dragState.tableId, x: table.x, y: table.y });
      }
    }
    dragState = null;
    panState = null;
    diagramElement.classList.remove("is-panning");
  });

  window.addEventListener("resize", () => diagram.render());
  window.visualViewport?.addEventListener("resize", () => diagram.render());
}
