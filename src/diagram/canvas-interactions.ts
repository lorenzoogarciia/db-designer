import type { Store } from "../state/store.ts";
import { getTableById } from "../state/store.ts";
import { applyTableCardTransform } from "./card-style.ts";
import type { DiagramController } from "./diagram-controller.ts";

const EDGE_THRESHOLD = 48;
const MAX_EDGE_PAN_SPEED = 18;
/** Pixeles por "linea" cuando la rueda informa en lineas (Firefox). */
const WHEEL_LINE_HEIGHT = 16;
/** Sensibilidad del zoom con rueda/pellizco: factor = exp(-deltaY * WHEEL_ZOOM_SPEED). */
const WHEEL_ZOOM_SPEED = 0.0018;

interface DragState {
  tableId: string;
  card: HTMLElement;
  /** Punto agarrado dentro de la tabla, en coordenadas del mundo. */
  offsetX: number;
  offsetY: number;
  pendingX: number;
  pendingY: number;
  currentX: number;
  currentY: number;
  viewportLeft: number;
  viewportTop: number;
  viewportRight: number;
  viewportBottom: number;
}

interface PanState {
  lastX: number;
  lastY: number;
  pendingX: number;
  pendingY: number;
}

export function wireCanvasInteractions(
  store: Store,
  diagram: DiagramController,
  handlers: {
    onEditTable: (tableId: string) => void;
    onEditField: (tableId: string, fieldId: string) => void;
    onEditRelation: (relationId: string) => void;
    /** Doble clic en una zona vacia del canvas: crear una tabla en ese punto del mundo. */
    onCreateTableAt: (point: { x: number; y: number }) => void;
  },
): void {
  const diagramElement = diagram.getDiagramElement();
  let dragState: DragState | null = null;
  let panState: PanState | null = null;
  let dragRafId: number | null = null;
  let panRafId: number | null = null;

  function cacheViewport(state: DragState): void {
    const rect = diagramElement.getBoundingClientRect();
    state.viewportLeft = rect.left;
    state.viewportTop = rect.top;
    state.viewportRight = rect.right;
    state.viewportBottom = rect.bottom;
  }

  function computeDragPosition(clientX: number, clientY: number): { x: number; y: number } | null {
    if (!dragState) return null;
    // Canvas infinito: sin limites, las tablas pueden ir a coordenadas negativas.
    const world = diagram.clientToWorld(clientX, clientY);
    return {
      x: Math.round(world.x - dragState.offsetX),
      y: Math.round(world.y - dragState.offsetY),
    };
  }

  /** Velocidad de desplazamiento automatico al acercar el puntero a un borde (px de pantalla). */
  function edgePanVelocity(clientX: number, clientY: number): { dx: number; dy: number } {
    if (!dragState) return { dx: 0, dy: 0 };
    const intensity = (distance: number) => Math.max(0, 1 - distance / EDGE_THRESHOLD);
    let dx = 0;
    let dy = 0;
    if (clientX < dragState.viewportLeft + EDGE_THRESHOLD) {
      dx = MAX_EDGE_PAN_SPEED * intensity(clientX - dragState.viewportLeft);
    } else if (clientX > dragState.viewportRight - EDGE_THRESHOLD) {
      dx = -MAX_EDGE_PAN_SPEED * intensity(dragState.viewportRight - clientX);
    }
    if (clientY < dragState.viewportTop + EDGE_THRESHOLD) {
      dy = MAX_EDGE_PAN_SPEED * intensity(clientY - dragState.viewportTop);
    } else if (clientY > dragState.viewportBottom - EDGE_THRESHOLD) {
      dy = -MAX_EDGE_PAN_SPEED * intensity(dragState.viewportBottom - clientY);
    }
    return { dx, dy };
  }

  function dragTick(): void {
    dragRafId = null;
    if (!dragState) return;

    const { dx, dy } = edgePanVelocity(dragState.pendingX, dragState.pendingY);
    const panning = dx !== 0 || dy !== 0;
    if (panning) diagram.panBy(dx, dy);

    const position = computeDragPosition(dragState.pendingX, dragState.pendingY);
    if (position && (position.x !== dragState.currentX || position.y !== dragState.currentY)) {
      dragState.currentX = position.x;
      dragState.currentY = position.y;
      applyTableCardTransform(dragState.card, position.x, position.y);
    }

    // Mientras el puntero siga en el borde, seguir desplazando aunque no se mueva el raton.
    if (panning) dragRafId = requestAnimationFrame(dragTick);
  }

  function scheduleDragTick(): void {
    if (!dragState || dragRafId !== null) return;
    dragRafId = requestAnimationFrame(dragTick);
  }

  function stopDragTick(): void {
    if (dragRafId !== null) {
      cancelAnimationFrame(dragRafId);
      dragRafId = null;
    }
  }

  function panTick(): void {
    panRafId = null;
    if (!panState) return;
    const dx = panState.pendingX - panState.lastX;
    const dy = panState.pendingY - panState.lastY;
    panState.lastX = panState.pendingX;
    panState.lastY = panState.pendingY;
    if (dx !== 0 || dy !== 0) diagram.panBy(dx, dy);
  }

  function schedulePanTick(): void {
    if (panRafId === null) {
      panRafId = requestAnimationFrame(panTick);
    }
  }

  function stopPanTick(): void {
    if (panRafId !== null) {
      cancelAnimationFrame(panRafId);
      panRafId = null;
    }
  }

  function endTableDrag(): void {
    if (!dragState) return;

    stopDragTick();
    dragState.card.classList.remove("is-dragging");
    diagramElement.classList.remove("is-table-dragging");
    diagram.endTableDrag();

    const table = getTableById(store.getState(), dragState.tableId);
    if (table && (table.x !== dragState.currentX || table.y !== dragState.currentY)) {
      store.dispatch({
        type: "UPDATE_TABLE_POSITION",
        tableId: dragState.tableId,
        x: dragState.currentX,
        y: dragState.currentY,
      });
    }

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
        const fromField =
          store
            .getState()
            .tables.find((t) => t.id === relation.fromTableId)
            ?.fields.find((f) => f.id === relation.fromFieldId)?.name ?? "?";
        const toField =
          store
            .getState()
            .tables.find((t) => t.id === relation.toTableId)
            ?.fields.find((f) => f.id === relation.toFieldId)?.name ?? "?";
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
      handlers.onEditTable(target.dataset.tableId);
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
      store.dispatch({
        type: "MOVE_FIELD",
        tableId: target.dataset.tableId,
        fieldId: target.dataset.fieldId,
        direction: "down",
      });
    }
  });

  // Doble clic en una tabla (util en vista general, donde no hay botones): abrir su edicion.
  diagramElement.addEventListener("dblclick", (event) => {
    const target = event.target as Element;
    if (target.closest("button")) return;
    const card = target.closest<HTMLElement>(".table-card");
    if (card?.dataset.tableId) {
      handlers.onEditTable(card.dataset.tableId);
      return;
    }
    if (target.closest("[data-relation-id]")) return;
    handlers.onCreateTableAt(diagram.clientToWorld(event.clientX, event.clientY));
  });

  diagramElement.addEventListener("mousedown", (event) => {
    if (event.button !== 0 && event.button !== 1) return;
    const target = event.target as Element;
    diagram.stopCameraAnimation();
    // Boton central: desplazar siempre, incluso sobre una tabla.
    const tableCard = event.button === 0 ? target.closest<HTMLElement>(".table-card") : null;
    if (event.button === 0) {
      if (target.closest("[data-relation-id]") || target.closest("[data-action='delete-relation']")) return;
      if (target.closest("button")) return;
    }
    event.preventDefault();
    if (tableCard) {
      const tableId = tableCard.dataset.tableId;
      if (!tableId) return;
      const table = getTableById(store.getState(), tableId);
      if (!table) return;

      const grab = diagram.clientToWorld(event.clientX, event.clientY);
      diagram.beginTableDrag(tableId);
      tableCard.classList.add("is-dragging");
      diagramElement.classList.add("is-table-dragging");

      const next: DragState = {
        tableId,
        card: tableCard,
        offsetX: grab.x - table.x,
        offsetY: grab.y - table.y,
        pendingX: event.clientX,
        pendingY: event.clientY,
        currentX: table.x,
        currentY: table.y,
        viewportLeft: 0,
        viewportTop: 0,
        viewportRight: 0,
        viewportBottom: 0,
      };
      cacheViewport(next);
      dragState = next;
      return;
    }

    panState = {
      lastX: event.clientX,
      lastY: event.clientY,
      pendingX: event.clientX,
      pendingY: event.clientY,
    };
    diagramElement.classList.add("is-panning");
  });

  // Evita el autoscroll nativo del boton central.
  diagramElement.addEventListener("auxclick", (event) => {
    if (event.button === 1) event.preventDefault();
  });

  window.addEventListener("mousemove", (event) => {
    if (dragState) {
      dragState.pendingX = event.clientX;
      dragState.pendingY = event.clientY;
      scheduleDragTick();
      return;
    }

    if (panState) {
      panState.pendingX = event.clientX;
      panState.pendingY = event.clientY;
      schedulePanTick();
    }
  });

  window.addEventListener("mouseup", () => {
    if (dragState) {
      endTableDrag();
    }
    if (panState) panTick();
    stopPanTick();
    panState = null;
    diagramElement.classList.remove("is-panning");
  });

  // Rueda: desplaza el canvas. Ctrl/Cmd + rueda (o pellizco en trackpad) hace zoom en el puntero.
  diagramElement.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      diagram.stopCameraAnimation();
      const unit = event.deltaMode === 1 ? WHEEL_LINE_HEIGHT : event.deltaMode === 2 ? diagramElement.clientHeight : 1;
      const deltaX = event.deltaX * unit;
      const deltaY = event.deltaY * unit;
      if (event.ctrlKey || event.metaKey) {
        diagram.zoomBy(Math.exp(-deltaY * WHEEL_ZOOM_SPEED), event.clientX, event.clientY);
        return;
      }
      if (event.shiftKey && deltaX === 0) {
        diagram.panBy(-deltaY, 0);
        return;
      }
      diagram.panBy(-deltaX, -deltaY);
    },
    { passive: false },
  );

  window.addEventListener("resize", () => {
    if (dragState) cacheViewport(dragState);
  });
}
