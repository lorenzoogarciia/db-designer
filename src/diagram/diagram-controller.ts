import type { Store } from "../state/store.ts";
import { getFieldName, getTableById } from "../state/store.ts";
import { CANVAS_GUTTER, estimateTableWidth, getCanvasBounds, getTableHeight, getTablesLogicalBounds } from "./layout.ts";
import { buildRelationLayersMarkup } from "./relation-renderer.ts";
import { buildTableMarkup } from "./table-renderer.ts";

export interface DiagramController {
  render: () => void;
  getDiagramElement: () => HTMLDivElement;
  fitContentToViewport: () => void;
  focusTable: (tableId: string) => void;
  setZoom: (nextZoom: number, focusClientX?: number, focusClientY?: number) => void;
  beginTableDrag: (tableId: string) => void;
  endTableDrag: () => void;
}

export function createDiagramController(
  store: Store,
  diagramElement: HTMLDivElement,
  zoomLabelElement: HTMLSpanElement,
): DiagramController {
  const measuredTableWidths = new Map<string, number>();
  let draggingTableId: string | null = null;

  function getTableWidth(table: { id: string; name: string; fields: { name: string }[] }) {
    return measuredTableWidths.get(table.id) ?? estimateTableWidth(table as Parameters<typeof estimateTableWidth>[0]);
  }

  function measureTableWidths() {
    measuredTableWidths.clear();
    const state = store.getState();
    state.tables.forEach((table) => {
      const element = diagramElement.querySelector<HTMLElement>(`.table-card[data-table-id="${table.id}"]`);
      if (element) {
        measuredTableWidths.set(table.id, element.offsetWidth);
      }
    });
  }

  function render() {
    if (draggingTableId) return;

    const state = store.getState();
    state.tables.forEach((table, index) => {
      if (typeof table.x === "number" && typeof table.y === "number") return;
      table.x = 24 + (index % 2) * 400;
      table.y = 24 + Math.floor(index / 2) * 280;
    });

    zoomLabelElement.textContent = `${Math.round(state.zoom * 100)}%`;
    measuredTableWidths.clear();

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

    measureTableWidths();
    bounds = getCanvasBounds(state.tables, state.zoom, viewportWidth, viewportHeight, getTableWidth);

    const scene = diagramElement.querySelector<HTMLElement>("#diagram-scene");
    const relationLinesLayer = diagramElement.querySelector<SVGSVGElement>(".relation-lines-layer");
    const relationLabelsLayer = diagramElement.querySelector<SVGSVGElement>(".relation-labels-layer");
    if (scene) {
      scene.style.width = `${bounds.scaledWidth}px`;
      scene.style.height = `${bounds.scaledHeight}px`;
    }
    if (relationLinesLayer && relationLabelsLayer) {
      relationLinesLayer.setAttribute("width", String(bounds.scaledWidth));
      relationLinesLayer.setAttribute("height", String(bounds.scaledHeight));
      relationLabelsLayer.setAttribute("width", String(bounds.scaledWidth));
      relationLabelsLayer.setAttribute("height", String(bounds.scaledHeight));
      const appState = store.getState();
      const relationCtx = {
        tables: appState.tables,
        relations: appState.relations,
        zoom: appState.zoom,
        bounds,
        getTableById: (id: string) => getTableById(appState, id),
        getFieldName: (tableId: string, fieldId: string) => getFieldName(appState, tableId, fieldId),
        getTableWidth,
      };
      const { lines, labels } = buildRelationLayersMarkup(relationCtx);
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
