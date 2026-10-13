import type { Store } from "../state/store.ts";
import { getTableById } from "../state/store.ts";
import { applyTableCardTransform } from "./card-style.ts";
import { BASE_PADDING, CANVAS_GUTTER } from "./constants.ts";
import { estimateTableWidth, getTableHeight } from "./layout.ts";
import type { DiagramController } from "./diagram-controller.ts";

const EDGE_THRESHOLD = 48;
const MAX_SCROLL_SPEED = 18;
const SCENE_GROW_HEADROOM = 400;

interface DragState {
  tableId: string;
  card: HTMLElement;
  offsetX: number;
  offsetY: number;
  pendingX: number;
  pendingY: number;
  currentX: number;
  currentY: number;
  tableWidth: number;
  tableHeight: number;
  viewportLeft: number;
  viewportTop: number;
  viewportRight: number;
  viewportBottom: number;
  scene: HTMLElement | null;
  linesLayer: SVGSVGElement | null;
  labelsLayer: SVGSVGElement | null;
  sceneWidth: number;
  sceneHeight: number;
}

interface PanState {
  startX: number;
  startY: number;
  startScrollLeft: number;
  startScrollTop: number;
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
    const zoom = store.getState().zoom;
    const logicalX = (clientX - dragState.viewportLeft + diagramElement.scrollLeft) / zoom;
    const logicalY = (clientY - dragState.viewportTop + diagramElement.scrollTop) / zoom;
    // Keep tables inside the scrollable scene (never negative logical coords).
    return {
      x: Math.max(8, logicalX - CANVAS_GUTTER - dragState.offsetX),
      y: Math.max(8, logicalY - CANVAS_GUTTER - dragState.offsetY),
    };
  }

  function expandSceneForDrag(x: number, y: number): void {
    if (!dragState?.scene) return;
    const zoom = store.getState().zoom;
    const neededWidth = Math.ceil((x + dragState.tableWidth + BASE_PADDING + CANVAS_GUTTER * 2) * zoom) + SCENE_GROW_HEADROOM;
    const neededHeight = Math.ceil((y + dragState.tableHeight + BASE_PADDING + CANVAS_GUTTER * 2) * zoom) + SCENE_GROW_HEADROOM;

    if (neededWidth > dragState.sceneWidth) {
      dragState.sceneWidth = neededWidth;
      dragState.scene.style.width = `${neededWidth}px`;
      dragState.linesLayer?.setAttribute("width", String(neededWidth));
      dragState.labelsLayer?.setAttribute("width", String(neededWidth));
    }
    if (neededHeight > dragState.sceneHeight) {
      dragState.sceneHeight = neededHeight;
      dragState.scene.style.height = `${neededHeight}px`;
      dragState.linesLayer?.setAttribute("height", String(neededHeight));
      dragState.labelsLayer?.setAttribute("height", String(neededHeight));
    }
  }

  function isNearEdge(clientX: number, clientY: number): boolean {
    if (!dragState) return false;
    return (
      clientX < dragState.viewportLeft + EDGE_THRESHOLD ||
      clientX > dragState.viewportRight - EDGE_THRESHOLD ||
      clientY < dragState.viewportTop + EDGE_THRESHOLD ||
      clientY > dragState.viewportBottom - EDGE_THRESHOLD
    );
  }

  function applyEdgeAutoScroll(clientX: number, clientY: number): boolean {
    if (!dragState) return false;
    let scrolled = false;

    if (clientX < dragState.viewportLeft + EDGE_THRESHOLD) {
      const intensity = 1 - Math.max(0, (clientX - dragState.viewportLeft) / EDGE_THRESHOLD);
      diagramElement.scrollLeft -= MAX_SCROLL_SPEED * intensity;
      scrolled = true;
    } else if (clientX > dragState.viewportRight - EDGE_THRESHOLD) {
      const intensity = 1 - Math.max(0, (dragState.viewportRight - clientX) / EDGE_THRESHOLD);
      diagramElement.scrollLeft += MAX_SCROLL_SPEED * intensity;
      scrolled = true;
    }

    if (clientY < dragState.viewportTop + EDGE_THRESHOLD) {
      const intensity = 1 - Math.max(0, (clientY - dragState.viewportTop) / EDGE_THRESHOLD);
      diagramElement.scrollTop -= MAX_SCROLL_SPEED * intensity;
      scrolled = true;
    } else if (clientY > dragState.viewportBottom - EDGE_THRESHOLD) {
      const intensity = 1 - Math.max(0, (dragState.viewportBottom - clientY) / EDGE_THRESHOLD);
      diagramElement.scrollTop += MAX_SCROLL_SPEED * intensity;
      scrolled = true;
    }

    return scrolled;
  }

  function dragTick(): void {
    if (!dragState) {
      dragRafId = null;
      return;
    }

    const nearEdge = isNearEdge(dragState.pendingX, dragState.pendingY);
    const scrolled = nearEdge ? applyEdgeAutoScroll(dragState.pendingX, dragState.pendingY) : false;

    const position = computeDragPosition(dragState.pendingX, dragState.pendingY);
    if (!position) {
      dragRafId = null;
      return;
    }

    if (position.x !== dragState.currentX || position.y !== dragState.currentY) {
      dragState.currentX = position.x;
      dragState.currentY = position.y;
      applyTableCardTransform(dragState.card, position.x, position.y, store.getState().zoom);
      expandSceneForDrag(position.x, position.y);
    }

    if (nearEdge || scrolled) {
      dragRafId = requestAnimationFrame(dragTick);
      return;
    }

    dragRafId = null;
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
    diagramElement.scrollLeft = panState.startScrollLeft - (panState.pendingX - panState.startX);
    diagramElement.scrollTop = panState.startScrollTop - (panState.pendingY - panState.startY);
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
    dragState.card.style.willChange = "";
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
      const measuredWidth = tableCard.offsetWidth;
      const measuredHeight = tableCard.offsetHeight;
      const scene = diagramElement.querySelector<HTMLElement>("#diagram-scene");
      const linesLayer = diagramElement.querySelector<SVGSVGElement>(".relation-lines-layer");
      const labelsLayer = diagramElement.querySelector<SVGSVGElement>(".relation-labels-layer");

      diagram.beginTableDrag(tableId);
      tableCard.classList.add("is-dragging");
      tableCard.style.willChange = "transform";
      diagramElement.classList.add("is-table-dragging");

      const next: DragState = {
        tableId,
        card: tableCard,
        offsetX,
        offsetY,
        pendingX: event.clientX,
        pendingY: event.clientY,
        currentX: table.x,
        currentY: table.y,
        tableWidth: measuredWidth || estimateTableWidth(table),
        tableHeight: measuredHeight || getTableHeight(table),
        viewportLeft: 0,
        viewportTop: 0,
        viewportRight: 0,
        viewportBottom: 0,
        scene,
        linesLayer,
        labelsLayer,
        sceneWidth: scene?.offsetWidth ?? 0,
        sceneHeight: scene?.offsetHeight ?? 0,
      };
      cacheViewport(next);
      dragState = next;
      expandSceneForDrag(table.x, table.y);
      scheduleDragTick();
      return;
    }

    panState = {
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: diagramElement.scrollLeft,
      startScrollTop: diagramElement.scrollTop,
      pendingX: event.clientX,
      pendingY: event.clientY,
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
      panState.pendingX = event.clientX;
      panState.pendingY = event.clientY;
      schedulePanTick();
    }
  });

  window.addEventListener("mouseup", () => {
    if (dragState) {
      endTableDrag();
    }
    stopPanTick();
    panState = null;
    diagramElement.classList.remove("is-panning");
  });

  window.addEventListener("resize", () => {
    if (dragState) cacheViewport(dragState);
    diagram.render();
  });
  window.visualViewport?.addEventListener("resize", () => {
    if (dragState) cacheViewport(dragState);
    diagram.render();
  });
}
