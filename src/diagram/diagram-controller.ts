import type { AppState } from "../domain/types.ts";
import type { Store } from "../state/store.ts";
import { getFieldName, getTableById } from "../state/store.ts";
import { applyTableCardTransform } from "./card-style.ts";
import { CANVAS_GUTTER, estimateTableWidth, getCanvasBounds, getTableHeight as estimateTableHeight, getTablesLogicalBounds } from "./layout.ts";
import { buildScaledTableRects } from "./relation-label-placement.ts";
import { buildRelationLayersMarkup } from "./relation-renderer.ts";
import { buildTableMarkup } from "./table-renderer.ts";

type IdleHandle = number;

function scheduleIdle(callback: () => void, timeoutMs: number): IdleHandle {
  const ric = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
  if (typeof ric === "function") {
    return ric(callback, { timeout: timeoutMs });
  }
  return window.setTimeout(callback, 0);
}

function cancelIdle(handle: IdleHandle): void {
  const cic = (window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
  if (typeof cic === "function") {
    cic(handle);
    return;
  }
  window.clearTimeout(handle);
}

export interface DiagramController {
  render: () => void;
  getDiagramElement: () => HTMLDivElement;
  fitContentToViewport: () => void;
  focusTable: (tableId: string) => void;
  setZoom: (nextZoom: number, focusClientX?: number, focusClientY?: number) => void;
  beginTableDrag: (tableId: string) => void;
  endTableDrag: () => void;
}

function schemaSignature(state: AppState): string {
  // Everything that affects table/relation DOM markup except x/y positions.
  return [
    state.activeProjectId,
    state.zoom.toFixed(2),
    state.tables
      .map((table) =>
        [
          table.id,
          table.name,
          table.fields
            .map(
              (field) =>
                `${field.id}:${field.name}:${field.type}:${field.nullable ? 1 : 0}:${field.isPrimary ? 1 : 0}:${field.isUnique ? 1 : 0}:${field.autoIncrement ? 1 : 0}:${field.isIndexed ? 1 : 0}:${field.defaultValue ?? ""}:${(field.enumValues ?? []).join("/")}`,
            )
            .join(","),
        ].join(":"),
      )
      .join("|"),
    state.relations.map((relation) => `${relation.id}:${relation.kind}:${relation.fromTableId}:${relation.fromFieldId}:${relation.toTableId}:${relation.toFieldId}`).join(","),
  ].join(";");
}

function layoutSignature(state: AppState): string {
  return state.tables.map((table) => `${table.id}:${table.x.toFixed(1)},${table.y.toFixed(1)}`).join("|");
}

export function createDiagramController(
  store: Store,
  diagramElement: HTMLDivElement,
  zoomLabelElement: HTMLSpanElement,
): DiagramController {
  const measuredTableWidths = new Map<string, number>();
  const measuredTableHeights = new Map<string, number>();
  let draggingTableId: string | null = null;
  let lastSchemaSignature = "";
  let lastLayoutSignature = "";
  let suppressNextRender = false;
  let pendingRelationPaint: IdleHandle | null = null;

  function getTableWidth(table: { id: string; name: string; fields: { name: string }[] }) {
    return measuredTableWidths.get(table.id) ?? estimateTableWidth(table as Parameters<typeof estimateTableWidth>[0]);
  }

  function getTableHeight(table: { id: string; fields: { name: string }[] }) {
    return measuredTableHeights.get(table.id) ?? estimateTableHeight(table as Parameters<typeof estimateTableHeight>[0]);
  }

  function measureTableDimensions() {
    const state = store.getState();
    state.tables.forEach((table) => {
      const element = diagramElement.querySelector<HTMLElement>(`.table-card[data-table-id="${table.id}"]`);
      if (element) {
        measuredTableWidths.set(table.id, element.offsetWidth);
        measuredTableHeights.set(table.id, element.offsetHeight);
      }
    });
  }

  function buildRelationContext(bounds: ReturnType<typeof getCanvasBounds>) {
    const appState = store.getState();
    const routeTables = appState.tables.map((table) => ({
      id: table.id,
      x: table.x,
      y: table.y,
      width: getTableWidth(table),
      height: getTableHeight(table),
    }));

    return {
      tables: appState.tables,
      relations: appState.relations,
      zoom: appState.zoom,
      bounds,
      getTableById: (id: string) => getTableById(appState, id),
      getFieldName: (tableId: string, fieldId: string) => getFieldName(appState, tableId, fieldId),
      getTableWidth,
      getTableHeight,
      // Logical rects avoid forced reflow from getBoundingClientRect after DOM writes.
      getTableCollisionRects: () => buildScaledTableRects(routeTables, CANVAS_GUTTER, appState.zoom),
    };
  }

  function paintRelations(bounds: ReturnType<typeof getCanvasBounds>, quality: "fast" | "full" = "full") {
    const relationLinesLayer = diagramElement.querySelector<SVGSVGElement>(".relation-lines-layer");
    const relationLabelsLayer = diagramElement.querySelector<SVGSVGElement>(".relation-labels-layer");
    if (!relationLinesLayer || !relationLabelsLayer) return;

    relationLinesLayer.setAttribute("width", String(bounds.scaledWidth));
    relationLinesLayer.setAttribute("height", String(bounds.scaledHeight));
    relationLabelsLayer.setAttribute("width", String(bounds.scaledWidth));
    relationLabelsLayer.setAttribute("height", String(bounds.scaledHeight));

    const { lines, labels } = buildRelationLayersMarkup(buildRelationContext(bounds), quality);
    relationLinesLayer.innerHTML = `
      <defs>
        <marker id="arrow-head" markerWidth="10" markerHeight="8" refX="10" refY="4" orient="auto">
          <polygon points="0 0, 10 4, 0 8" class="arrow-head"></polygon>
        </marker>
      </defs>
      ${lines}
    `;
    relationLabelsLayer.innerHTML = labels;
  }

  function applySceneSize(bounds: ReturnType<typeof getCanvasBounds>) {
    const scene = diagramElement.querySelector<HTMLElement>("#diagram-scene");
    if (!scene) return;
    scene.style.width = `${bounds.scaledWidth}px`;
    scene.style.height = `${bounds.scaledHeight}px`;
  }

  function patchTablePositions(state: AppState) {
    const zoom = state.zoom;
    for (const table of state.tables) {
      const card = diagramElement.querySelector<HTMLElement>(`.table-card[data-table-id="${table.id}"]`);
      if (!card) continue;
      applyTableCardTransform(card, table.x, table.y, zoom);
    }
  }

  function cancelPendingRelationPaint() {
    if (pendingRelationPaint !== null) {
      cancelIdle(pendingRelationPaint);
      pendingRelationPaint = null;
    }
  }

  function renderRelationsOnly(state: AppState, deferPaint = false) {
    zoomLabelElement.textContent = `${Math.round(state.zoom * 100)}%`;
    const viewportWidth = diagramElement.clientWidth || 900;
    const viewportHeight = diagramElement.clientHeight || 650;
    const bounds = getCanvasBounds(state.tables, state.zoom, viewportWidth, viewportHeight, getTableWidth);
    applySceneSize(bounds);

    if (!deferPaint) {
      cancelPendingRelationPaint();
      paintRelations(bounds, "full");
      return;
    }

    // Fast preview immediately, then refine when the browser is idle so drag-end stays smooth.
    cancelPendingRelationPaint();
    paintRelations(bounds, "fast");
    pendingRelationPaint = scheduleIdle(() => {
      pendingRelationPaint = null;
      if (draggingTableId) return;
      const latest = store.getState();
      // Re-read viewport size here — a resize may have happened since this idle was scheduled.
      const latestViewportWidth = diagramElement.clientWidth || 900;
      const latestViewportHeight = diagramElement.clientHeight || 650;
      const latestBounds = getCanvasBounds(
        latest.tables,
        latest.zoom,
        latestViewportWidth,
        latestViewportHeight,
        getTableWidth,
      );
      applySceneSize(latestBounds);
      paintRelations(latestBounds, "full");
    }, 120);
  }

  function renderFull(state: AppState) {
    state.tables.forEach((table, index) => {
      if (typeof table.x === "number" && typeof table.y === "number") return;
      table.x = 24 + (index % 2) * 400;
      table.y = 24 + Math.floor(index / 2) * 280;
    });

    zoomLabelElement.textContent = `${Math.round(state.zoom * 100)}%`;

    const viewportWidth = diagramElement.clientWidth || 900;
    const viewportHeight = diagramElement.clientHeight || 650;
    let bounds = getCanvasBounds(state.tables, state.zoom, viewportWidth, viewportHeight, getTableWidth);
    const tableMarkup = buildTableMarkup(state.tables, state.zoom);

    diagramElement.innerHTML = `
    <div id="diagram-scene" class="diagram-scene" style="width:${bounds.scaledWidth}px;height:${bounds.scaledHeight}px">
      <svg class="relation-lines-layer" width="${bounds.scaledWidth}" height="${bounds.scaledHeight}">
        <defs>
          <marker id="arrow-head" markerWidth="10" markerHeight="8" refX="10" refY="4" orient="auto">
            <polygon points="0 0, 10 4, 0 8" class="arrow-head"></polygon>
          </marker>
        </defs>
      </svg>
      <div class="table-layer">${tableMarkup}</div>
      <svg class="relation-labels-layer" width="${bounds.scaledWidth}" height="${bounds.scaledHeight}"></svg>
    </div>
  `;

    measureTableDimensions();
    bounds = getCanvasBounds(state.tables, state.zoom, viewportWidth, viewportHeight, getTableWidth);
    applySceneSize(bounds);
    paintRelations(bounds);
  }

  function render() {
    if (draggingTableId) return;
    if (suppressNextRender) {
      suppressNextRender = false;
      return;
    }

    const state = store.getState();
    const nextSchema = schemaSignature(state);
    const nextLayout = layoutSignature(state);
    const sceneExists = Boolean(diagramElement.querySelector("#diagram-scene"));

    // Position-only updates: keep table DOM, only resize scene + redraw relations.
    if (sceneExists && nextSchema === lastSchemaSignature && nextLayout !== lastLayoutSignature) {
      patchTablePositions(state);
      renderRelationsOnly(state, true);
      lastLayoutSignature = nextLayout;
      return;
    }

    if (sceneExists && nextSchema === lastSchemaSignature && nextLayout === lastLayoutSignature) {
      return;
    }

    cancelPendingRelationPaint();
    renderFull(state);
    lastSchemaSignature = nextSchema;
    lastLayoutSignature = nextLayout;
  }

  function setZoom(nextZoom: number, focusClientX?: number, focusClientY?: number) {
    const state = store.getState();
    const previousZoom = state.zoom;
    const boundedZoom = Math.min(Math.max(Number(nextZoom.toFixed(2)), 0.3), 2.5);
    if (boundedZoom === previousZoom) return;

    const viewportRect = diagramElement.getBoundingClientRect();
    const relativeX = focusClientX ?? viewportRect.left + viewportRect.width / 2;
    const relativeY = focusClientY ?? viewportRect.top + viewportRect.height / 2;
    const logicalX = (diagramElement.scrollLeft + (relativeX - viewportRect.left)) / previousZoom;
    const logicalY = (diagramElement.scrollTop + (relativeY - viewportRect.top)) / previousZoom;

    // Subscribe would also call render(); suppress the duplicate and render once here.
    suppressNextRender = true;
    store.dispatch({ type: "SET_ZOOM", zoom: boundedZoom });
    render();

    diagramElement.scrollLeft = logicalX * boundedZoom - (relativeX - viewportRect.left);
    diagramElement.scrollTop = logicalY * boundedZoom - (relativeY - viewportRect.top);
  }

  function fitContentToViewport() {
    const state = store.getState();
    const viewportWidth = diagramElement.clientWidth;
    const viewportHeight = diagramElement.clientHeight;
    const bounds = getTablesLogicalBounds(state.tables, getTableWidth);
    const padding = 60;
    const zoomByWidth = (viewportWidth - padding) / Math.max(bounds.width, 1);
    const zoomByHeight = (viewportHeight - padding) / Math.max(bounds.height, 1);
    const nextZoom = Math.min(Math.max(Math.min(zoomByWidth, zoomByHeight), 0.3), 2.5);

    suppressNextRender = true;
    store.dispatch({ type: "SET_ZOOM", zoom: Number(nextZoom.toFixed(2)) });
    render();

    const centerLogicalX = bounds.minX + bounds.width / 2;
    const centerLogicalY = bounds.minY + bounds.height / 2;
    diagramElement.scrollLeft = (centerLogicalX + CANVAS_GUTTER) * nextZoom - viewportWidth / 2;
    diagramElement.scrollTop = (centerLogicalY + CANVAS_GUTTER) * nextZoom - viewportHeight / 2;
  }

  function focusTable(tableId: string) {
    const state = store.getState();
    const table = state.tables.find((item) => item.id === tableId);
    if (!table) return;

    const width = getTableWidth(table);
    const height = getTableHeight(table);
    const centerLogicalX = table.x + width / 2;
    const centerLogicalY = table.y + height / 2;
    const zoom = state.zoom;
    const viewportWidth = diagramElement.clientWidth;
    const viewportHeight = diagramElement.clientHeight;

    diagramElement.scrollTo({
      left: Math.max(0, (centerLogicalX + CANVAS_GUTTER) * zoom - viewportWidth / 2),
      top: Math.max(0, (centerLogicalY + CANVAS_GUTTER) * zoom - viewportHeight / 2),
      behavior: "smooth",
    });

    window.setTimeout(() => {
      const card = diagramElement.querySelector<HTMLElement>(`.table-card[data-table-id="${tableId}"]`);
      if (!card) return;
      card.classList.add("is-focused");
      window.setTimeout(() => card.classList.remove("is-focused"), 1600);
    }, 280);
  }

  store.subscribe(render);

  return {
    render,
    getDiagramElement: () => diagramElement,
    fitContentToViewport,
    focusTable,
    setZoom,
    beginTableDrag: (tableId: string) => {
      draggingTableId = tableId;
    },
    endTableDrag: () => {
      draggingTableId = null;
    },
  };
}
