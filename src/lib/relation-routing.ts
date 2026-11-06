export interface FieldAnchor {
  x: number;
  y: number;
  side: "left" | "right" | "top" | "bottom";
}

interface Point {
  x: number;
  y: number;
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface RouteTable {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/* ------------------------------------------------------------------ */
/* Parametros                                                          */
/* ------------------------------------------------------------------ */

/** Separacion minima entre una linea y una tabla ajena. */
const ROUTE_PADDING = 20;
/** Separacion extra por cada relacion paralela (carriles). */
const LANE_PADDING = 12;
/** Longitud del tramo recto que sale/entra perpendicular a la tabla. */
const STUB_LENGTH = 24;
/** Margen de la zona de busqueda alrededor de los extremos. */
const SEARCH_MARGIN = 220;
/** Coste de cada giro de 90 grados (equivale a recorrer esa distancia). */
const BEND_COST = 60;
/** Multiplicador de coste al atravesar una tabla ajena (obstaculo "blando": siempre hay ruta). */
const OBSTACLE_COST = 60;
/** Multiplicador de coste al pasar por debajo de las propias tablas origen/destino. */
const ENDPOINT_COST = 3;
const EPSILON = 0.001;

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

type Direction = 0 | 1 | 2 | 3; // derecha, izquierda, abajo, arriba
const DX = [1, -1, 0, 0];
const DY = [0, 0, 1, -1];
const OPPOSITE: Direction[] = [1, 0, 3, 2];

function sideDirection(side: FieldAnchor["side"]): Direction {
  if (side === "right") return 0;
  if (side === "left") return 1;
  if (side === "bottom") return 2;
  return 3;
}

function pushPoint(points: Point[], point: Point): void {
  const last = points[points.length - 1];
  if (last && Math.abs(last.x - point.x) < EPSILON && Math.abs(last.y - point.y) < EPSILON) return;
  points.push(point);
}

function simplifyOrthogonalPath(points: Point[]): Point[] {
  const deduped: Point[] = [];
  for (const point of points) pushPoint(deduped, point);
  if (deduped.length <= 2) return deduped;
  const simplified: Point[] = [deduped[0]];
  for (let i = 1; i < deduped.length - 1; i++) {
    const prev = simplified[simplified.length - 1];
    const current = deduped[i];
    const next = deduped[i + 1];
    const collinearHorizontal = Math.abs(prev.y - current.y) < EPSILON && Math.abs(current.y - next.y) < EPSILON;
    const collinearVertical = Math.abs(prev.x - current.x) < EPSILON && Math.abs(current.x - next.x) < EPSILON;
    if (collinearHorizontal || collinearVertical) continue;
    simplified.push(current);
  }
  pushPoint(simplified, deduped[deduped.length - 1]);
  return simplified;
}

/**
 * Red de seguridad: inserta un codo en cualquier tramo que no sea horizontal ni vertical,
 * de modo que la ruta final siempre gira en angulo recto.
 */
export function enforceOrthogonal(points: Point[]): Point[] {
  if (points.length < 2) return points.slice();
  const result: Point[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = result[result.length - 1];
    const current = points[i];
    if (Math.abs(prev.x - current.x) > EPSILON && Math.abs(prev.y - current.y) > EPSILON) {
      // Continuar en la direccion del tramo anterior antes de girar.
      const beforePrev = result[result.length - 2];
      const wasVertical = beforePrev ? Math.abs(beforePrev.x - prev.x) < EPSILON : false;
      pushPoint(result, wasVertical ? { x: prev.x, y: current.y } : { x: current.x, y: prev.y });
    }
    pushPoint(result, current);
  }
  return simplifyOrthogonalPath(result);
}

function rectContainsStrict(rect: Rect, x: number, y: number): boolean {
  return x > rect.left + EPSILON && x < rect.right - EPSILON && y > rect.top + EPSILON && y < rect.bottom - EPSILON;
}

function rectContainsClosed(rect: Rect, x: number, y: number): boolean {
  return x >= rect.left - EPSILON && x <= rect.right + EPSILON && y >= rect.top - EPSILON && y <= rect.bottom + EPSILON;
}

function tableRect(table: RouteTable, padding = 0): Rect {
  return {
    left: table.x - padding,
    top: table.y - padding,
    right: table.x + table.width + padding,
    bottom: table.y + table.height + padding,
  };
}

function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function sortedUnique(values: number[]): number[] {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  const result: number[] = [];
  for (const value of sorted) {
    if (result.length === 0 || value - result[result.length - 1] > 0.5) result.push(value);
  }
  return result;
}

/** Indice del valor mas cercano en un array ordenado. */
function nearestIndex(values: number[], target: number): number {
  let low = 0;
  let high = values.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (values[mid] < target) low = mid + 1;
    else high = mid;
  }
  if (low > 0 && Math.abs(values[low - 1] - target) < Math.abs(values[low] - target)) return low - 1;
  return low;
}

/* ------------------------------------------------------------------ */
/* Cola de prioridad (min-heap)                                        */
/* ------------------------------------------------------------------ */

class MinHeap {
  private readonly keys: number[] = [];
  private readonly items: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: number, key: number): void {
    this.items.push(item);
    this.keys.push(key);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.keys[parent] <= this.keys[index]) break;
      this.swap(index, parent);
      index = parent;
    }
  }

  pop(): number {
    const top = this.items[0];
    const lastItem = this.items.pop() as number;
    const lastKey = this.keys.pop() as number;
    if (this.items.length > 0) {
      this.items[0] = lastItem;
      this.keys[0] = lastKey;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < this.items.length && this.keys[left] < this.keys[smallest]) smallest = left;
        if (right < this.items.length && this.keys[right] < this.keys[smallest]) smallest = right;
        if (smallest === index) break;
        this.swap(index, smallest);
        index = smallest;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
  }
}

/* ------------------------------------------------------------------ */
/* Router ortogonal sobre rejilla                                      */
/* ------------------------------------------------------------------ */

interface GridRoute {
  points: Point[];
  /** true si la ruta tuvo que atravesar alguna tabla ajena. */
  crossesObstacle: boolean;
}

/**
 * A* sobre una rejilla ortogonal construida con las coordenadas relevantes (bordes de
 * obstaculos, salidas de los anclajes y canales intermedios). Cada giro cuesta BEND_COST,
 * asi que las rutas tienen pocos codos; los obstaculos son "blandos", por lo que siempre
 * existe ruta y nunca se recurre a tramos diagonales.
 */
function routeOnGrid(
  from: FieldAnchor,
  to: FieldAnchor,
  obstacles: Rect[],
  endpointRects: Rect[],
  window: Rect,
): GridRoute {
  const startDir = sideDirection(from.side);
  // Al llegar se entra en la tabla destino: direccion contraria a la normal de su lado.
  const arrivalDir = OPPOSITE[sideDirection(to.side)];
  const fromStub = { x: from.x + DX[startDir] * STUB_LENGTH, y: from.y + DY[startDir] * STUB_LENGTH };
  const toStub = { x: to.x - DX[arrivalDir] * STUB_LENGTH, y: to.y - DY[arrivalDir] * STUB_LENGTH };

  const xValues = [from.x, to.x, fromStub.x, toStub.x, (fromStub.x + toStub.x) / 2, window.left, window.right];
  const yValues = [from.y, to.y, fromStub.y, toStub.y, (fromStub.y + toStub.y) / 2, window.top, window.bottom];
  for (const rect of [...obstacles, ...endpointRects]) {
    xValues.push(rect.left, rect.right);
    yValues.push(rect.top, rect.bottom);
  }
  // Canales: centro de los huecos entre obstaculos, para que las lineas no vayan pegadas.
  const xs0 = sortedUnique(xValues);
  const ys0 = sortedUnique(yValues);
  const xs = sortedUnique([...xs0, ...channelMidpoints(xs0, obstacles, "x")]);
  const ys = sortedUnique([...ys0, ...channelMidpoints(ys0, obstacles, "y")]);

  const columns = xs.length;
  const rows = ys.length;
  const nodeCount = columns * rows;
  const nodeIndex = (column: number, row: number) => row * columns + column;

  // Coste multiplicador de cada arista: [horizontal desde (c,r) a (c+1,r)] y [vertical desde (c,r) a (c,r+1)].
  const horizontalCost = new Float32Array(nodeCount).fill(1);
  const verticalCost = new Float32Array(nodeCount).fill(1);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const index = nodeIndex(column, row);
      if (column < columns - 1) {
        horizontalCost[index] = edgeCost((xs[column] + xs[column + 1]) / 2, ys[row], obstacles, endpointRects);
      }
      if (row < rows - 1) {
        verticalCost[index] = edgeCost(xs[column], (ys[row] + ys[row + 1]) / 2, obstacles, endpointRects);
      }
    }
  }

  const start = nodeIndex(nearestIndex(xs, from.x), nearestIndex(ys, from.y));
  const goal = nodeIndex(nearestIndex(xs, to.x), nearestIndex(ys, to.y));
  const goalX = xs[goal % columns];
  const goalY = ys[Math.floor(goal / columns)];

  // Estado = nodo * 4 + direccion con la que se llego.
  const stateCount = nodeCount * 4;
  const best = new Float64Array(stateCount).fill(Number.POSITIVE_INFINITY);
  const cameFrom = new Int32Array(stateCount).fill(-1);
  const heap = new MinHeap();
  const startState = start * 4 + startDir;
  best[startState] = 0;
  heap.push(startState, 0);

  let goalState = -1;
  while (heap.size > 0) {
    const state = heap.pop();
    const node = state >> 2;
    const dir = (state & 3) as Direction;
    if (node === goal) {
      goalState = state;
      break;
    }
    const cost = best[state];
    const column = node % columns;
    const row = Math.floor(node / columns);

    for (let nextDir = 0 as Direction; nextDir < 4; nextDir = (nextDir + 1) as Direction) {
      // Media vuelta: solo se permite como dos giros (penalizado) salvo en el primer tramo.
      if (nextDir === OPPOSITE[dir] && state !== startState) continue;
      const nextColumn = column + DX[nextDir];
      const nextRow = row + DY[nextDir];
      if (nextColumn < 0 || nextColumn >= columns || nextRow < 0 || nextRow >= rows) continue;
      const nextNode = nodeIndex(nextColumn, nextRow);

      let multiplier: number;
      let length: number;
      if (nextDir === 0) {
        multiplier = horizontalCost[node];
        length = xs[nextColumn] - xs[column];
      } else if (nextDir === 1) {
        multiplier = horizontalCost[nextNode];
        length = xs[column] - xs[nextColumn];
      } else if (nextDir === 2) {
        multiplier = verticalCost[node];
        length = ys[nextRow] - ys[row];
      } else {
        multiplier = verticalCost[nextNode];
        length = ys[row] - ys[nextRow];
      }

      let stepCost = length * multiplier;
      if (nextDir !== dir) stepCost += nextDir === OPPOSITE[dir] ? BEND_COST * 2 : BEND_COST;
      if (nextNode === goal && nextDir !== arrivalDir) stepCost += BEND_COST;

      const nextState = nextNode * 4 + nextDir;
      const nextCost = cost + stepCost;
      if (nextCost >= best[nextState]) continue;
      best[nextState] = nextCost;
      cameFrom[nextState] = state;
      const heuristic = Math.abs(goalX - xs[nextColumn]) + Math.abs(goalY - ys[nextRow]);
      heap.push(nextState, nextCost + heuristic);
    }
  }

  if (goalState < 0) {
    // No deberia ocurrir (la rejilla es conexa), pero por si acaso: ruta en "Z" ortogonal.
    return { points: enforceOrthogonal([from, fromStub, toStub, to]), crossesObstacle: true };
  }

  const nodes: number[] = [];
  let crossesObstacle = false;
  for (let state = goalState; state >= 0; state = cameFrom[state]) {
    nodes.push(state >> 2);
    const previous = cameFrom[state];
    if (previous >= 0) {
      const a = previous >> 2;
      const b = state >> 2;
      const horizontal = Math.floor(a / columns) === Math.floor(b / columns);
      const multiplier = horizontal ? horizontalCost[Math.min(a, b)] : verticalCost[Math.min(a, b)];
      if (multiplier >= OBSTACLE_COST) crossesObstacle = true;
    }
  }
  nodes.reverse();

  const points: Point[] = [{ x: from.x, y: from.y }];
  for (const node of nodes) pushPoint(points, { x: xs[node % columns], y: ys[Math.floor(node / columns)] });
  pushPoint(points, { x: to.x, y: to.y });
  return { points: enforceOrthogonal(points), crossesObstacle };
}

function channelMidpoints(values: number[], obstacles: Rect[], axis: "x" | "y"): number[] {
  if (obstacles.length === 0) return [];
  const edges = new Set<number>();
  for (const rect of obstacles) {
    if (axis === "x") edges.add(rect.left).add(rect.right);
    else edges.add(rect.top).add(rect.bottom);
  }
  const result: number[] = [];
  for (let i = 0; i < values.length - 1; i++) {
    const gap = values[i + 1] - values[i];
    if (gap > 2 * ROUTE_PADDING && (edges.has(values[i]) || edges.has(values[i + 1]))) {
      result.push((values[i] + values[i + 1]) / 2);
    }
  }
  return result;
}

function edgeCost(x: number, y: number, obstacles: Rect[], endpointRects: Rect[]): number {
  // Por dentro de la tabla origen/destino (queda oculto bajo la tarjeta): permitido pero caro.
  if (endpointRects.some((rect) => rectContainsStrict(rect, x, y))) return ENDPOINT_COST;
  if (obstacles.some((rect) => rectContainsStrict(rect, x, y))) return OBSTACLE_COST;
  // Pegado al borde de la propia tabla: se ve feo, se desaconseja.
  if (endpointRects.some((rect) => rectContainsClosed(rect, x, y))) return 2;
  return 1;
}

/* ------------------------------------------------------------------ */
/* Ruta completa                                                       */
/* ------------------------------------------------------------------ */

function buildFastRoutePoints(from: FieldAnchor, to: FieldAnchor, laneOffset: number): Point[] {
  const clearance = STUB_LENGTH + laneOffset * 10;
  const startDir = sideDirection(from.side);
  const endDir = sideDirection(to.side);
  const exit = { x: from.x + DX[startDir] * clearance, y: from.y + DY[startDir] * clearance };
  const entry = { x: to.x + DX[endDir] * clearance, y: to.y + DY[endDir] * clearance };
  const midY = (exit.y + entry.y) / 2 + laneOffset * 14;
  const midX = (exit.x + entry.x) / 2 + laneOffset * 14;

  const middle =
    from.side === "left" || from.side === "right"
      ? [{ x: exit.x, y: midY }, { x: entry.x, y: midY }]
      : [{ x: midX, y: exit.y }, { x: midX, y: entry.y }];
  return enforceOrthogonal([{ x: from.x, y: from.y }, exit, ...middle, entry, { x: to.x, y: to.y }]);
}

function buildRoutePoints(
  from: FieldAnchor,
  to: FieldAnchor,
  tables: RouteTable[],
  fromTableId: string,
  toTableId: string,
  laneOffset: number,
  quality: "fast" | "full" = "full",
): Point[] {
  if (quality === "fast") return buildFastRoutePoints(from, to, laneOffset);

  const padding = ROUTE_PADDING + laneOffset * LANE_PADDING;
  const endpointRects = tables
    .filter((table) => table.id === fromTableId || table.id === toTableId)
    .map((table) => tableRect(table));
  const others = tables.filter((table) => table.id !== fromTableId && table.id !== toTableId);

  let margin = SEARCH_MARGIN;
  let route: GridRoute | null = null;
  // Zona de busqueda alrededor de los extremos; si la ruta tiene que atravesar una tabla, se amplia.
  for (let attempt = 0; attempt < 3; attempt++) {
    const area: Rect = {
      left: Math.min(from.x, to.x, ...endpointRects.map((rect) => rect.left)) - margin,
      top: Math.min(from.y, to.y, ...endpointRects.map((rect) => rect.top)) - margin,
      right: Math.max(from.x, to.x, ...endpointRects.map((rect) => rect.right)) + margin,
      bottom: Math.max(from.y, to.y, ...endpointRects.map((rect) => rect.bottom)) + margin,
    };
    const obstacles = others.map((table) => tableRect(table, padding)).filter((rect) => rectsIntersect(rect, area));
    // La ventana abarca tambien los obstaculos que sobresalen, para poder rodearlos.
    const window: Rect = {
      left: Math.min(area.left, ...obstacles.map((rect) => rect.left - padding)),
      top: Math.min(area.top, ...obstacles.map((rect) => rect.top - padding)),
      right: Math.max(area.right, ...obstacles.map((rect) => rect.right + padding)),
      bottom: Math.max(area.bottom, ...obstacles.map((rect) => rect.bottom + padding)),
    };
    route = routeOnGrid(from, to, obstacles, endpointRects, window);
    if (!route.crossesObstacle) break;
    margin *= 3;
  }

  return route ? route.points : buildFastRoutePoints(from, to, laneOffset);
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

/** @internal Exported for tests */
export function buildRoutePointsForTest(
  from: FieldAnchor,
  to: FieldAnchor,
  tables: RouteTable[],
  fromTableId: string,
  toTableId: string,
  laneOffset: number,
  quality: "fast" | "full" = "full",
): Point[] {
  return buildRoutePoints(from, to, tables, fromTableId, toTableId, laneOffset, quality);
}

/**
 * @internal Exported for tests: true si ningun tramo atraviesa una tabla ajena (con margen),
 * permitiendo pasar por debajo de las tablas de `excludeIds`.
 */
export function isRouteClearForTest(points: Point[], tables: RouteTable[], excludeIds: string[]): boolean {
  const obstacles = tables.filter((table) => !excludeIds.includes(table.id)).map((table) => tableRect(table, ROUTE_PADDING));
  const allowed = tables.filter((table) => excludeIds.includes(table.id)).map((table) => tableRect(table));
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const length = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    const steps = Math.max(1, Math.ceil(length / 4));
    for (let step = 1; step < steps; step++) {
      const x = a.x + ((b.x - a.x) * step) / steps;
      const y = a.y + ((b.y - a.y) * step) / steps;
      if (allowed.some((rect) => rectContainsClosed(rect, x, y))) continue;
      if (obstacles.some((rect) => rectContainsStrict(rect, x, y))) return false;
    }
  }
  return true;
}

export function buildRoutedRelationPath(
  from: FieldAnchor,
  to: FieldAnchor,
  tables: RouteTable[],
  fromTableId: string,
  toTableId: string,
  laneOffset: number,
  canvasGutter: number,
  zoom: number,
  quality: "fast" | "full" = "full",
): { path: string; pathPoints: Array<{ x: number; y: number }>; labelPoint: { x: number; y: number } } {
  const points = buildRoutePoints(from, to, tables, fromTableId, toTableId, laneOffset, quality);

  const scaled = points.map((point) => ({
    x: (point.x + canvasGutter) * zoom,
    y: (point.y + canvasGutter) * zoom,
  }));

  const path = scaled.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
  // Etiqueta en el centro del tramo mas largo: queda sobre una parte recta y visible.
  let longest = 0;
  let longestIndex = 0;
  for (let i = 0; i < scaled.length - 1; i++) {
    const length = Math.abs(scaled[i + 1].x - scaled[i].x) + Math.abs(scaled[i + 1].y - scaled[i].y);
    if (length > longest) {
      longest = length;
      longestIndex = i;
    }
  }
  const nextIndex = Math.min(longestIndex + 1, scaled.length - 1);
  const labelPoint = {
    x: (scaled[longestIndex].x + scaled[nextIndex].x) / 2,
    y: (scaled[longestIndex].y + scaled[nextIndex].y) / 2,
  };

  return { path, pathPoints: scaled, labelPoint };
}
