import { clamp } from "../domain/ids.ts";
import type { Store } from "../state/store.ts";
import { getTableById } from "../state/store.ts";
import { CANVAS_GUTTER, getCanvasBounds, estimateTableWidth } from "./layout.ts";
import type { DiagramController } from "./diagram-controller.ts";

const EDGE_THRESHOLD = 48;
const MAX_SCROLL_SPEED = 18;

interface DragState {
  tableId: string;
  card: HTMLElement;
  offsetX: number;
  offsetY: number;
  pendingX: number;
  pendingY: number;
  currentX: number;
  currentY: number;
}

interface PanState {
  startX: number;
  startY: number;
  startScrollLeft: number;
  startScrollTop: number;
}

function applyTableCardPosition(card: HTMLElement, x: number, y: number, zoom: number): void {
  card.style.left = `${(x + CANVAS_GUTTER) * zoom}px`;
  card.style.top = `${(y + CANVAS_GUTTER) * zoom}px`;
}

export function wireCanvasInteractions(
  store: Store,
  diagram: DiagramController,
  handlers: {
    onEditField: (tableId: string, fieldId: string) => void;
    onEditRelation: (relationId: string) => void;
  },
): void {
  const diagramElement = diagram.getDiagramElement();
  let dragState: DragState | null = null;
  let panState: PanState | null = null;
  let dragRafId: number | null = null;

  function computeDragPosition(clientX: number, clientY: number): { x: number; y: number } | null {
    if (!dragState) return null;
    const state = store.getState();
    const table = getTableById(state, dragState.tableId);
    if (!table) return null;

    const viewportBounds = diagramElement.getBoundingClientRect();
    const logicalX = (clientX - viewportBounds.left + diagramElement.scrollLeft) / state.zoom;
    const logicalY = (clientY - viewportBounds.top + diagramElement.scrollTop) / state.zoom;
    const tentativeX = logicalX - CANVAS_GUTTER - dragState.offsetX;
    const tentativeY = logicalY - CANVAS_GUTTER - dragState.offsetY;

    const getTableWidth = (t: typeof table) => estimateTableWidth(t);
    const tablesForBounds = state.tables.map((t) =>
      t.id === dragState!.tableId ? { ...t, x: tentativeX, y: tentativeY } : t,
    );
    const bounds = getCanvasBounds(
      tablesForBounds,
      state.zoom,
      diagramElement.clientWidth || 900,
      diagramElement.clientHeight || 650,
      getTableWidth,
    );
    const tableWidth = getTableWidth(table);
    const x = clamp(tentativeX, 8 - CANVAS_GUTTER, bounds.logicalWidth - tableWidth - CANVAS_GUTTER - 8);
    const y = clamp(tentativeY, 8 - CANVAS_GUTTER, bounds.logicalHeight - 120 - CANVAS_GUTTER);
    return { x, y };
  }

  function applyEdgeAutoScroll(clientX: number, clientY: number): void {
    const rect = diagramElement.getBoundingClientRect();

    if (clientX < rect.left + EDGE_THRESHOLD) {
      const intensity = 1 - Math.max(0, (clientX - rect.left) / EDGE_THRESHOLD);
      diagramElement.scrollLeft -= MAX_SCROLL_SPEED * intensity;
    } else if (clientX > rect.right - EDGE_THRESHOLD) {
      const intensity = 1 - Math.max(0, (rect.right - clientX) / EDGE_THRESHOLD);
      diagramElement.scrollLeft += MAX_SCROLL_SPEED * intensity;
    }

    if (clientY < rect.top + EDGE_THRESHOLD) {
      const intensity = 1 - Math.max(0, (clientY - rect.top) / EDGE_THRESHOLD);
      diagramElement.scrollTop -= MAX_SCROLL_SPEED * intensity;
    } else if (clientY > rect.bottom - EDGE_THRESHOLD) {
      const intensity = 1 - Math.max(0, (rect.bottom - clientY) / EDGE_THRESHOLD);
      diagramElement.scrollTop += MAX_SCROLL_SPEED * intensity;
    }
  }

  function dragTick(): void {
    if (!dragState) {
      dragRafId = null;
      return;
    }

    applyEdgeAutoScroll(dragState.pendingX, dragState.pendingY);

    const position = computeDragPosition(dragState.pendingX, dragState.pendingY);
    if (!position) {
      dragRafId = null;
      return;
    }

    dragState.currentX = position.x;
    dragState.currentY = position.y;
    applyTableCardPosition(dragState.card, position.x, position.y, store.getState().zoom);

    dragRafId = requestAnimationFrame(dragTick);
  }

  function scheduleDragTick(): void {
    if (dragRafId === null) {
      dragRafId = requestAnimationFrame(dragTick);
    }
  }

  function stopDragTick(): void {
    if (dragRafId !== null) {
      cancelAnimationFrame(dragRafId);
      dragRafId = null;
    }
  }

  function endTableDrag(): void {
    if (!dragState) return;

    stopDragTick();
    dragState.card.classList.remove("is-dragging");
    diagramElement.classList.remove("is-table-dragging");
    diagram.endTableDrag();

    store.dispatch({
      type: "UPDATE_TABLE_POSITION",
      tableId: dragState.tableId,
      x: dragState.currentX,
      y: dragState.currentY,
    });

    dragState = null;
  }

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
    if (relationNode && !deleteRelationEl && !(event.target as Element).closest("[data-action='delete-relation']")) {
      const relationId = relationNode.getAttribute("data-relation-id");
      if (relationId) {
        handlers.onEditRelation(relationId);
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
    const target = event.target as Element;
    if (target.closest("[data-relation-id]") || target.closest("[data-action='delete-relation']")) return;
    if (target.closest("button")) return;
    event.preventDefault();
    const tableCard = target.closest<HTMLElement>(".table-card");
    if (tableCard) {
      const tableId = tableCard.dataset.tableId;
      if (!tableId) return;
      const table = getTableById(store.getState(), tableId);
      if (!table) return;

      const bounds = tableCard.getBoundingClientRect();
      const zoom = store.getState().zoom;
      const offsetX = (event.clientX - bounds.left) / zoom;
      const offsetY = (event.clientY - bounds.top) / zoom;

      diagram.beginTableDrag(tableId);
      tableCard.classList.add("is-dragging");
      diagramElement.classList.add("is-table-dragging");

      dragState = {
        tableId,
        card: tableCard,
        offsetX,
        offsetY,
        pendingX: event.clientX,
        pendingY: event.clientY,
        currentX: table.x,
        currentY: table.y,
      };
      scheduleDragTick();
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
      dragState.pendingX = event.clientX;
      dragState.pendingY = event.clientY;
      scheduleDragTick();
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
      endTableDrag();
    }
    panState = null;
    diagramElement.classList.remove("is-panning");
  });

  window.addEventListener("resize", () => diagram.render());
  window.visualViewport?.addEventListener("resize", () => diagram.render());
}
