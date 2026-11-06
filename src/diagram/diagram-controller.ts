import type { AppState, Table } from "../domain/types.ts";
import type { Store } from "../state/store.ts";
import { getFieldName } from "../state/store.ts";
import {
  cardinalityMarkerSize,
  cardinalityMarkerStroke,
  centerOn,
  clampValue,
  detailLevelForZoom,
  fitCamera,
  gridSpacing,
  interpolateCamera,
  isWorldRectVisible,
  overviewNameSize,
  relationLineWidth,
  screenToWorld,
  zoomAround,
  zoomLimits,
  type Camera,
  type DetailLevel,
  type WorldBounds,
} from "./camera.ts";
import { applyTableCardTransform } from "./card-style.ts";
import { RELATION_LAYER_PADDING } from "./constants.ts";
import { estimateTableWidth, getTableHeight } from "./layout.ts";
import { buildScaledTableRects } from "./relation-label-placement.ts";
import { buildCardinalityMarkerDefs, buildRelationLayersMarkup } from "./relation-renderer.ts";
import { buildTableMarkup } from "./table-renderer.ts";

type IdleHandle = number;

function scheduleIdle(callback: () => void, timeoutMs: number): IdleHandle {
  const ric = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
    .requestIdleCallback;
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

/**
 * Punta de flecha en unidades del mundo (userSpaceOnUse): su tamano se ajusta con el zoom
 * para que en pantalla sea proporcional al grosor de la linea.
 */
function markerDefs(rawZoom: number): string {
  const zoom = rawZoom > 0 ? rawZoom : 1;
  return buildCardinalityMarkerDefs(cardinalityMarkerSize(zoom) / zoom);
}

/** Leyenda fija en la esquina del canvas con la notacion y los colores de cada tipo de relacion. */
const LEGEND_MARKUP = `
  <div class="diagram-legend" aria-label="Leyenda de relaciones">
    ${[
      ["11", "1:1", "M 4 7 L 52 7 M 10 1 L 10 13 M 46 1 L 46 13", "uno a uno"],
      ["1n", "1:N", "M 4 7 L 52 7 M 4 1 L 12 7 L 4 13 M 46 1 L 46 13", "muchos a uno"],
      ["nm", "N:M", "M 4 7 L 52 7 M 4 1 L 12 7 L 4 13 M 52 1 L 44 7 L 52 13", "muchos a muchos"],
    ]
      .map(
        ([key, label, path, title]) =>
          `<div class="diagram-legend-row rel-color-${key}" title="${title}"><svg width="56" height="14" viewBox="0 0 56 14" aria-hidden="true"><path d="${path}"></path></svg><span>${label}</span></div>`,
      )
      .join("")}
  </div>`;

/** Zoom minimo al que se lleva la camara al buscar una tabla, para que se lea. */
const FOCUS_READABLE_ZOOM = 0.9;

export function formatZoom(zoom: number): string {
  const percent = zoom * 100;
  return `${percent < 10 ? percent.toFixed(1).replace(/\.0$/, "") : Math.round(percent)}%`;
}

export interface DiagramController {
  render: () => void;
  getDiagramElement: () => HTMLDivElement;
  getWorldElement: () => HTMLDivElement;
  getCamera: () => Camera;
  /** Limites del contenido en coordenadas del mundo (null si no hay tablas). */
  getContentBounds: () => WorldBounds | null;
  getTableWidth: (table: Table) => number;
  fitContentToViewport: (animate?: boolean) => void;
  focusTable: (tableId: string) => void;
  /** Desplaza la camara lo justo para que la tabla se vea, sin cambiar el zoom si ya es legible. */
  revealTable: (tableId: string) => void;
  setZoom: (nextZoom: number, focusClientX?: number, focusClientY?: number) => void;
  zoomBy: (factor: number, focusClientX?: number, focusClientY?: number) => void;
  panBy: (deltaX: number, deltaY: number) => void;
  clientToWorld: (clientX: number, clientY: number) => { x: number; y: number };
  /** Punto del mundo que se ve en el centro del viewport. */
  getViewportCenterWorld: () => { x: number; y: number };
  stopCameraAnimation: () => void;
  beginTableDrag: (tableId: string) => void;
  endTableDrag: () => void;
}

function schemaSignature(state: AppState): string {
  // Todo lo que afecta al marcado de tablas/relaciones excepto posiciones y zoom.
  return [
    state.activeProjectId,
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
    state.relations
      .map(
        (relation) =>
          `${relation.id}:${relation.kind}:${relation.fromTableId}:${relation.fromFieldId}:${relation.toTableId}:${relation.toFieldId}`,
      )
      .join(","),
  ].join(";");
}

function layoutSignature(state: AppState): string {
  return state.tables.map((table) => `${table.id}:${table.x.toFixed(1)},${table.y.toFixed(1)}`).join("|");
}

export function createDiagramController(
  store: Store,
  diagramElement: HTMLDivElement,
  zoomInputElement: HTMLInputElement,
): DiagramController {
  diagramElement.innerHTML = `
    <div id="diagram-world" class="diagram-world" data-lod="full">
      <svg class="relation-lines-layer" xmlns="http://www.w3.org/2000/svg"></svg>
      <div class="table-layer"></div>
      <svg class="relation-labels-layer" xmlns="http://www.w3.org/2000/svg"></svg>
    </div>
    ${LEGEND_MARKUP}
  `;
  const world = diagramElement.querySelector<HTMLDivElement>("#diagram-world") as HTMLDivElement;
  const tableLayer = world.querySelector<HTMLDivElement>(".table-layer") as HTMLDivElement;
  const linesLayer = world.querySelector<SVGSVGElement>(".relation-lines-layer") as SVGSVGElement;
  const labelsLayer = world.querySelector<SVGSVGElement>(".relation-labels-layer") as SVGSVGElement;

  const measuredTableWidths = new Map<string, number>();
  let camera: Camera = { x: 40, y: 40, zoom: clampValue(store.getState().zoom || 1, 0.02, 2.5) };
  let viewportWidth = diagramElement.clientWidth || 900;
  let viewportHeight = diagramElement.clientHeight || 650;
  let contentBounds: WorldBounds | null = null;
  let currentLod: DetailLevel | null = null;
  let cameraFrame: number | null = null;
  let animationFrame: number | null = null;
  let persistZoomTimer: number | null = null;
  let draggingTableId: string | null = null;
  let lastSchemaSignature = "";
  let lastLayoutSignature = "";
  let lastProjectId: string | null = null;
  let pendingRelationPaint: IdleHandle | null = null;
  let lastLineZoom = -1;

  function updateMarkers(zoom: number) {
    const size = (cardinalityMarkerSize(zoom) / zoom).toFixed(2);
    linesLayer.querySelectorAll(".card-marker").forEach((marker) => {
      marker.setAttribute("markerWidth", size);
      marker.setAttribute("markerHeight", size);
    });
  }

  function getTableWidth(table: Table): number {
    return measuredTableWidths.get(table.id) ?? estimateTableWidth(table);
  }

  function computeContentBounds(tables: Table[]): WorldBounds | null {
    if (tables.length === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const table of tables) {
      minX = Math.min(minX, table.x);
      minY = Math.min(minY, table.y);
      maxX = Math.max(maxX, table.x + getTableWidth(table));
      maxY = Math.max(maxY, table.y + getTableHeight(table));
    }
    return { minX, minY, maxX, maxY };
  }

  function currentZoomLimits() {
    return zoomLimits(contentBounds, viewportWidth, viewportHeight);
  }

  /* ---------------------------------------------------------------- */
  /* Camara                                                            */
  /* ---------------------------------------------------------------- */

  function writeCamera() {
    cameraFrame = null;
    const { x, y, zoom } = camera;
    world.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${zoom})`;
    // No pisar lo que el usuario esta escribiendo en el campo de zoom.
    if (document.activeElement !== zoomInputElement) zoomInputElement.value = formatZoom(zoom);

    const lod = detailLevelForZoom(zoom);
    if (lod !== currentLod) {
      currentLod = lod;
      world.dataset.lod = lod;
    }
    // Variables para compensar el tamano del texto en los niveles reducidos (cuantizadas
    // para no recalcular estilos en cada fotograma de una rueda continua).
    const quantized = Math.round(zoom * 100) / 100;
    world.style.setProperty("--zoom", String(quantized));
    world.style.setProperty("--label-scale", String(lod === "compact" ? Math.min(2.2, 0.8 / quantized) : 1));
    if (quantized !== lastLineZoom) {
      lastLineZoom = quantized;
      world.style.setProperty("--line-world", `${(relationLineWidth(quantized) / quantized).toFixed(3)}px`);
      world.style.setProperty("--overview-name-size", `${overviewNameSize(quantized)}px`);
      world.style.setProperty("--marker-stroke", cardinalityMarkerStroke(quantized).toFixed(2));
      updateMarkers(quantized);
    }

    const spacing = gridSpacing(zoom);
    diagramElement.style.backgroundSize = `${spacing}px ${spacing}px`;
    diagramElement.style.backgroundPosition = `${x.toFixed(1)}px ${y.toFixed(1)}px`;
  }

  function scheduleCameraWrite() {
    if (cameraFrame === null) cameraFrame = requestAnimationFrame(writeCamera);
  }

  function schedulePersistZoom() {
    if (persistZoomTimer !== null) window.clearTimeout(persistZoomTimer);
    persistZoomTimer = window.setTimeout(() => {
      persistZoomTimer = null;
      const zoom = Number(camera.zoom.toFixed(3));
      if (Math.abs(store.getState().zoom - zoom) > 0.001) {
        store.dispatch({ type: "SET_ZOOM", zoom });
      }
    }, 500);
  }

  function setCamera(next: Camera, options: { immediate?: boolean } = {}) {
    const { min, max } = currentZoomLimits();
    camera = { ...next, zoom: clampValue(next.zoom, min, max) };
    if (options.immediate) {
      if (cameraFrame !== null) cancelAnimationFrame(cameraFrame);
      writeCamera();
    } else {
      scheduleCameraWrite();
    }
    schedulePersistZoom();
  }

  function stopCameraAnimation() {
    if (animationFrame !== null) {
      cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }
  }

  function animateCamera(target: Camera, durationMs = 320) {
    stopCameraAnimation();
    const { min, max } = currentZoomLimits();
    const to = { ...target, zoom: clampValue(target.zoom, min, max) };
    const from = { ...camera };
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      camera = interpolateCamera(from, to, eased, viewportWidth, viewportHeight);
      writeCamera();
      if (t < 1) {
        animationFrame = requestAnimationFrame(step);
      } else {
        animationFrame = null;
        camera = to;
        writeCamera();
        schedulePersistZoom();
      }
    };
    animationFrame = requestAnimationFrame(step);
  }

  function clientToViewport(clientX: number, clientY: number) {
    const rect = diagramElement.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function setZoom(nextZoom: number, focusClientX?: number, focusClientY?: number) {
    stopCameraAnimation();
    const { min, max } = currentZoomLimits();
    const zoom = clampValue(nextZoom, min, max);
    if (Math.abs(zoom - camera.zoom) < 1e-4) return;
    const focus =
      focusClientX !== undefined && focusClientY !== undefined
        ? clientToViewport(focusClientX, focusClientY)
        : { x: viewportWidth / 2, y: viewportHeight / 2 };
    setCamera(zoomAround(camera, zoom, focus.x, focus.y));
  }

  function fitContentToViewport(animate = false) {
    const target = contentBounds
      ? fitCamera(contentBounds, viewportWidth, viewportHeight)
      : { x: viewportWidth / 2, y: viewportHeight / 2, zoom: 1 };
    if (animate) animateCamera(target);
    else {
      stopCameraAnimation();
      setCamera(target, { immediate: true });
    }
  }

  function tableBounds(table: Table): WorldBounds {
    return { minX: table.x, minY: table.y, maxX: table.x + getTableWidth(table), maxY: table.y + getTableHeight(table) };
  }

  function highlightTable(tableId: string, delayMs: number) {
    window.setTimeout(() => {
      const card = tableLayer.querySelector<HTMLElement>(`.table-card[data-table-id="${CSS.escape(tableId)}"]`);
      if (!card) return;
      card.classList.add("is-focused");
      window.setTimeout(() => card.classList.remove("is-focused"), 1600);
    }, delayMs);
  }

  function focusTable(tableId: string) {
    const table = store.getState().tables.find((item) => item.id === tableId);
    if (!table) return;
    const bounds = tableBounds(table);
    // Acercar lo suficiente para leerla, sin pasarse si la tabla es enorme.
    const fitsZoom = Math.min((viewportWidth * 0.8) / (bounds.maxX - bounds.minX), (viewportHeight * 0.8) / (bounds.maxY - bounds.minY));
    const zoom = camera.zoom >= FOCUS_READABLE_ZOOM ? camera.zoom : Math.min(1, Math.max(camera.zoom, fitsZoom));
    animateCamera(centerOn(bounds, zoom, viewportWidth, viewportHeight));
    highlightTable(tableId, 340);
  }

  function revealTable(tableId: string) {
    const table = store.getState().tables.find((item) => item.id === tableId);
    if (!table) return;
    const bounds = tableBounds(table);
    if (camera.zoom >= FOCUS_READABLE_ZOOM && isWorldRectVisible(camera, bounds, viewportWidth, viewportHeight, 24)) {
      highlightTable(tableId, 0);
      return;
    }
    focusTable(tableId);
  }

  /* ---------------------------------------------------------------- */
  /* Render                                                            */
  /* ---------------------------------------------------------------- */

  function cancelPendingRelationPaint() {
    if (pendingRelationPaint !== null) {
      cancelIdle(pendingRelationPaint);
      pendingRelationPaint = null;
    }
  }

  function paintRelations(quality: "fast" | "full") {
    const state = store.getState();
    if (!contentBounds) {
      linesLayer.innerHTML = markerDefs(lastLineZoom);
      labelsLayer.innerHTML = "";
      return;
    }
    const offset = RELATION_LAYER_PADDING - Math.min(contentBounds.minX, contentBounds.minY);
    const width = Math.ceil(contentBounds.maxX + offset + RELATION_LAYER_PADDING);
    const height = Math.ceil(contentBounds.maxY + offset + RELATION_LAYER_PADDING);
    for (const layer of [linesLayer, labelsLayer]) {
      layer.setAttribute("width", String(width));
      layer.setAttribute("height", String(height));
      layer.style.left = `${-offset}px`;
      layer.style.top = `${-offset}px`;
    }

    const tablesById = new Map(state.tables.map((table) => [table.id, table]));
    const routeTables = state.tables.map((table) => ({
      id: table.id,
      x: table.x,
      y: table.y,
      width: getTableWidth(table),
      height: getTableHeight(table),
    }));
    const { lines, labels } = buildRelationLayersMarkup(
      {
        tables: state.tables,
        relations: state.relations,
        offset,
        getTableById: (id: string) => tablesById.get(id),
        getFieldName: (tableId: string, fieldId: string) => getFieldName(state, tableId, fieldId),
        getTableWidth,
        getTableHeight,
        getTableCollisionRects: () => buildScaledTableRects(routeTables, offset, 1),
      },
      quality,
    );
    linesLayer.innerHTML = `${markerDefs(lastLineZoom)}${lines}`;
    labelsLayer.innerHTML = labels;
  }

  function paintRelationsDeferred() {
    cancelPendingRelationPaint();
    paintRelations("fast");
    pendingRelationPaint = scheduleIdle(() => {
      pendingRelationPaint = null;
      if (draggingTableId) return;
      paintRelations("full");
    }, 120);
  }

  function patchTablePositions(state: AppState) {
    for (const table of state.tables) {
      const card = tableLayer.querySelector<HTMLElement>(`.table-card[data-table-id="${CSS.escape(table.id)}"]`);
      if (card) applyTableCardTransform(card, table.x, table.y);
    }
  }

  /** Mide el ancho natural de cada tabla en el nivel de detalle completo y lo fija. */
  function measureAndPinWidths(state: AppState) {
    measuredTableWidths.clear();
    world.dataset.lod = "full";
    const cards = tableLayer.querySelectorAll<HTMLElement>(".table-card");
    const widths: Array<[HTMLElement, number]> = [];
    cards.forEach((card) => widths.push([card, card.offsetWidth]));
    widths.forEach(([card, width]) => {
      const tableId = card.dataset.tableId;
      if (!tableId) return;
      measuredTableWidths.set(tableId, width);
      card.style.width = `${width}px`;
    });
    // Tablas sin tarjeta (no deberia ocurrir) usan la estimacion.
    state.tables.forEach((table) => {
      if (!measuredTableWidths.has(table.id)) measuredTableWidths.set(table.id, estimateTableWidth(table));
    });
    if (currentLod) world.dataset.lod = currentLod;
  }

  function renderFull(state: AppState) {
    tableLayer.innerHTML = buildTableMarkup(state.tables);
    measureAndPinWidths(state);
    contentBounds = computeContentBounds(state.tables);
    paintRelations("full");
  }

  function render() {
    if (draggingTableId) return;

    const state = store.getState();
    const nextSchema = schemaSignature(state);
    const nextLayout = layoutSignature(state);
    const projectChanged = lastProjectId !== null && lastProjectId !== state.activeProjectId;

    if (nextSchema === lastSchemaSignature && nextLayout === lastLayoutSignature) return;

    if (nextSchema === lastSchemaSignature) {
      // Solo cambian posiciones: se conservan las tarjetas y se redibujan las relaciones.
      patchTablePositions(state);
      contentBounds = computeContentBounds(state.tables);
      paintRelationsDeferred();
      lastLayoutSignature = nextLayout;
      return;
    }

    cancelPendingRelationPaint();
    renderFull(state);
    lastSchemaSignature = nextSchema;
    lastLayoutSignature = nextLayout;
    lastProjectId = state.activeProjectId;
    if (projectChanged) fitContentToViewport();
  }

  function handleResize() {
    const nextWidth = diagramElement.clientWidth;
    const nextHeight = diagramElement.clientHeight;
    if (!nextWidth || !nextHeight || (nextWidth === viewportWidth && nextHeight === viewportHeight)) return;
    // Mantener centrado lo que se estaba viendo.
    const center = screenToWorld(camera, viewportWidth / 2, viewportHeight / 2);
    viewportWidth = nextWidth;
    viewportHeight = nextHeight;
    setCamera({ zoom: camera.zoom, x: nextWidth / 2 - center.x * camera.zoom, y: nextHeight / 2 - center.y * camera.zoom });
  }

  if (typeof ResizeObserver === "function") {
    new ResizeObserver(handleResize).observe(diagramElement);
  } else {
    window.addEventListener("resize", handleResize);
  }

  store.subscribe(render);
  writeCamera();

  return {
    render,
    getDiagramElement: () => diagramElement,
    getWorldElement: () => world,
    getCamera: () => ({ ...camera }),
    getContentBounds: () => (contentBounds ? { ...contentBounds } : null),
    getTableWidth,
    fitContentToViewport,
    focusTable,
    revealTable,
    setZoom,
    zoomBy: (factor, focusClientX, focusClientY) => setZoom(camera.zoom * factor, focusClientX, focusClientY),
    panBy: (deltaX, deltaY) => {
      stopCameraAnimation();
      setCamera({ ...camera, x: camera.x + deltaX, y: camera.y + deltaY });
    },
    clientToWorld: (clientX, clientY) => {
      const point = clientToViewport(clientX, clientY);
      return screenToWorld(camera, point.x, point.y);
    },
    getViewportCenterWorld: () => screenToWorld(camera, viewportWidth / 2, viewportHeight / 2),
    stopCameraAnimation,
    beginTableDrag: (tableId: string) => {
      draggingTableId = tableId;
      cancelPendingRelationPaint();
    },
    endTableDrag: () => {
      draggingTableId = null;
    },
  };
}
