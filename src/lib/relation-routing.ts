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

interface RouteContext {
  obstacles: Rect[];
  allowedRects: Rect[];
}

const ROUTE_PADDING = 20;
const MAX_REPAIR_ITERATIONS = 48;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function subtractIntervals(interval: [number, number], blockers: Array<[number, number]>): Array<[number, number]> {
  let parts: Array<[number, number]> = [interval];
  for (const [blockStart, blockEnd] of blockers) {
    const next: Array<[number, number]> = [];
    for (const [start, end] of parts) {
      if (blockEnd <= start || blockStart >= end) {
        next.push([start, end]);
        continue;
      }
      if (start < blockStart) next.push([start, blockStart]);
      if (blockEnd < end) next.push([blockEnd, end]);
    }
    parts = next;
  }
  return parts.filter(([start, end]) => end - start > 0.001);
}

function horizontalSegmentBlocked(x1: number, y: number, x2: number, obstacle: Rect, allowedRects: Rect[]): boolean {
  if (y <= obstacle.top || y >= obstacle.bottom) return false;

  const segMin = Math.min(x1, x2);
  const segMax = Math.max(x1, x2);
  const overlapMin = Math.max(segMin, obstacle.left);
  const overlapMax = Math.min(segMax, obstacle.right);
  if (overlapMin >= overlapMax) return false;

  const allowedIntervals = allowedRects
    .filter((rect) => y > rect.top && y < rect.bottom)
    .map((rect) => [Math.max(overlapMin, rect.left), Math.min(overlapMax, rect.right)] as [number, number])
    .filter(([start, end]) => end - start > 0.001);

  return subtractIntervals([overlapMin, overlapMax], allowedIntervals).length > 0;
}

function verticalSegmentBlocked(x: number, y1: number, y2: number, obstacle: Rect, allowedRects: Rect[]): boolean {
  if (x <= obstacle.left || x >= obstacle.right) return false;

  const segMin = Math.min(y1, y2);
  const segMax = Math.max(y1, y2);
  const overlapMin = Math.max(segMin, obstacle.top);
  const overlapMax = Math.min(segMax, obstacle.bottom);
  if (overlapMin >= overlapMax) return false;

  const allowedIntervals = allowedRects
    .filter((rect) => x > rect.left && x < rect.right)
    .map((rect) => [Math.max(overlapMin, rect.top), Math.min(overlapMax, rect.bottom)] as [number, number])
    .filter(([start, end]) => end - start > 0.001);

  return subtractIntervals([overlapMin, overlapMax], allowedIntervals).length > 0;
}

function segmentBlockedByObstacle(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  obstacle: Rect,
  allowedRects: Rect[],
): boolean {
  if (Math.abs(y1 - y2) < 0.001) {
    return horizontalSegmentBlocked(x1, y1, x2, obstacle, allowedRects);
  }
  if (Math.abs(x1 - x2) < 0.001) {
    return verticalSegmentBlocked(x1, y1, y2, obstacle, allowedRects);
  }
  return false;
}

function segmentHitsObstacle(x1: number, y1: number, x2: number, y2: number, ctx: RouteContext): boolean {
  return ctx.obstacles.some((obstacle) => segmentBlockedByObstacle(x1, y1, x2, y2, obstacle, ctx.allowedRects));
}

function getObstacleRects(tables: RouteTable[], excludeIds: string[]): Rect[] {
  return tables
    .filter((table) => !excludeIds.includes(table.id))
    .map((table) => ({
      left: table.x - ROUTE_PADDING,
      top: table.y - ROUTE_PADDING,
      right: table.x + table.width + ROUTE_PADDING,
      bottom: table.y + table.height + ROUTE_PADDING,
    }));
}

function getEndpointRects(tables: RouteTable[], endpointIds: string[]): Rect[] {
  return tables
    .filter((table) => endpointIds.includes(table.id))
    .map((table) => ({
      left: table.x,
      top: table.y,
      right: table.x + table.width,
      bottom: table.y + table.height,
    }));
}

function buildRouteContext(tables: RouteTable[], fromTableId: string, toTableId: string): RouteContext {
  return {
    obstacles: getObstacleRects(tables, [fromTableId, toTableId]),
    allowedRects: getEndpointRects(tables, [fromTableId, toTableId]),
  };
}

function extendAnchor(anchor: FieldAnchor, clearance: number): Point {
  switch (anchor.side) {
    case "right":
      return { x: anchor.x + clearance, y: anchor.y };
    case "left":
      return { x: anchor.x - clearance, y: anchor.y };
    case "bottom":
      return { x: anchor.x, y: anchor.y + clearance };
    case "top":
      return { x: anchor.x, y: anchor.y - clearance };
  }
}

function slideAnchorAlongEdge(anchor: FieldAnchor, table: RouteTable, delta: number): FieldAnchor {
  switch (anchor.side) {
    case "left":
    case "right":
      return { ...anchor, y: clamp(anchor.y + delta, table.y + 8, table.y + table.height - 8) };
    case "top":
    case "bottom":
      return { ...anchor, x: clamp(anchor.x + delta, table.x + 8, table.x + table.width - 8) };
  }
}

function computeSafeExitPoint(
  anchor: FieldAnchor,
  table: RouteTable,
  ctx: RouteContext,
  clearance: number,
  laneOffset: number,
): Point {
  const candidates: FieldAnchor[] = [anchor];
  for (let step = 1; step <= 12; step++) {
    const delta = step * (14 + laneOffset * 2);
    candidates.push(slideAnchorAlongEdge(anchor, table, delta));
    candidates.push(slideAnchorAlongEdge(anchor, table, -delta));
  }

  for (const candidate of candidates) {
    for (let currentClearance = clearance; currentClearance >= 8; currentClearance -= 4) {
      const exit = extendAnchor(candidate, currentClearance);
      const connector = [{ x: anchor.x, y: anchor.y }, exit];
      if (Math.abs(candidate.x - anchor.x) > 0.001 || Math.abs(candidate.y - anchor.y) > 0.001) {
        connector.splice(1, 0, { x: candidate.x, y: candidate.y });
      }
      if (isPathClear(connector, ctx)) return exit;
    }
  }

  return extendAnchor(anchor, 8);
}

function pushPoint(points: Point[], point: Point): void {
  const last = points[points.length - 1];
  if (last && Math.abs(last.x - point.x) < 0.001 && Math.abs(last.y - point.y) < 0.001) return;
  points.push(point);
}

function isPathClear(points: Point[], ctx: RouteContext): boolean {
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i];
    const to = points[i + 1];
    if (segmentHitsObstacle(from.x, from.y, to.x, to.y, ctx)) return false;
  }
  return true;
}

function pathLength(points: Point[]): number {
  let length = 0;
  for (let i = 0; i < points.length - 1; i++) {
    length += Math.abs(points[i + 1].x - points[i].x) + Math.abs(points[i + 1].y - points[i].y);
  }
  return length;
}

function simplifyOrthogonalPath(points: Point[]): Point[] {
  if (points.length <= 2) return points.slice();
  const simplified: Point[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = simplified[simplified.length - 1];
    const current = points[i];
    const next = points[i + 1];
    const collinearHorizontal = Math.abs(prev.y - current.y) < 0.001 && Math.abs(current.y - next.y) < 0.001;
    const collinearVertical = Math.abs(prev.x - current.x) < 0.001 && Math.abs(current.x - next.x) < 0.001;
    if (collinearHorizontal || collinearVertical) continue;
    pushPoint(simplified, current);
  }
  pushPoint(simplified, points[points.length - 1]);
  return simplified;
}

function laneCandidates(preferred: number, laneOffset: number, step = 18): number[] {
  const values = [preferred];
  for (let i = 1; i <= 32; i++) {
    const delta = i * (step + laneOffset * 2);
    values.push(preferred - delta, preferred + delta);
  }
  return values;
}

function obstacleSpanCandidates(
  obstacles: Rect[],
  axis: "x" | "y",
  min: number,
  max: number,
  laneOffset: number,
): number[] {
  const values: number[] = [];
  for (const rect of obstacles) {
    if (axis === "y") {
      if (rect.right <= min || rect.left >= max) continue;
      values.push(rect.top - 24 - laneOffset * 8, rect.bottom + 24 + laneOffset * 8);
    } else {
      if (rect.bottom <= min || rect.top >= max) continue;
      values.push(rect.left - 24 - laneOffset * 8, rect.right + 24 + laneOffset * 8);
    }
  }
  return values;
}

function uniqueCandidates(values: number[]): number[] {
  const seen = new Set<string>();
  const result: number[] = [];
  for (const value of values) {
    const key = value.toFixed(2);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function uniquePoints(points: Point[]): Point[] {
  const seen = new Set<string>();
  const result: Point[] = [];
  for (const point of points) {
    const key = `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(point);
  }
  return result;
}

function manhattanDistance(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function canConnectOrthogonal(a: Point, b: Point, ctx: RouteContext): boolean {
  if (Math.abs(a.x - b.x) > 0.001 && Math.abs(a.y - b.y) > 0.001) return false;
  return !segmentHitsObstacle(a.x, a.y, b.x, b.y, ctx);
}

function collectTablePerimeterNodes(table: RouteTable, step = 28): Point[] {
  const points: Point[] = [];
  for (let y = table.y; y <= table.y + table.height; y += step) {
    points.push({ x: table.x, y }, { x: table.x + table.width, y });
  }
  for (let x = table.x; x <= table.x + table.width; x += step) {
    points.push({ x, y: table.y }, { x, y: table.y + table.height });
  }
  return points;
}

function collectRouteNodes(
  exit: Point,
  entry: Point,
  tables: RouteTable[],
  endpointIds: string[],
  ctx: RouteContext,
  laneOffset: number,
): Point[] {
  const margin = 8 + laneOffset * 4;
  const points: Point[] = [exit, entry];

  for (const rect of ctx.obstacles) {
    points.push(
      { x: rect.left - margin, y: rect.top - margin },
      { x: rect.right + margin, y: rect.top - margin },
      { x: rect.left - margin, y: rect.bottom + margin },
      { x: rect.right + margin, y: rect.bottom + margin },
    );
  }

  for (const rect of ctx.obstacles) {
    points.push(
      { x: exit.x, y: rect.top - margin },
      { x: exit.x, y: rect.bottom + margin },
      { x: rect.left - margin, y: exit.y },
      { x: rect.right + margin, y: exit.y },
      { x: entry.x, y: rect.top - margin },
      { x: entry.x, y: rect.bottom + margin },
      { x: rect.left - margin, y: entry.y },
      { x: rect.right + margin, y: entry.y },
    );
  }

  for (const table of tables.filter((item) => endpointIds.includes(item.id))) {
    points.push(...collectTablePerimeterNodes(table));
  }

  return uniquePoints(points);
}

function astarOrthogonalRoute(
  exit: Point,
  entry: Point,
  tables: RouteTable[],
  endpointIds: string[],
  ctx: RouteContext,
  laneOffset: number,
): Point[] | null {
  const nodes = collectRouteNodes(exit, entry, tables, endpointIds, ctx, laneOffset);
  const startIndex = nodes.findIndex((node) => manhattanDistance(node, exit) < 0.001);
  const endIndex = nodes.findIndex((node) => manhattanDistance(node, entry) < 0.001);
  if (startIndex < 0 || endIndex < 0) return null;

  const neighbors = new Map<number, Array<{ to: number; cost: number }>>();
  for (let i = 0; i < nodes.length; i++) {
    neighbors.set(i, []);
  }

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (!canConnectOrthogonal(nodes[i], nodes[j], ctx)) continue;
      const cost = manhattanDistance(nodes[i], nodes[j]);
      neighbors.get(i)!.push({ to: j, cost });
      neighbors.get(j)!.push({ to: i, cost });
    }
  }

  const open = new Set<number>([startIndex]);
  const cameFrom = new Map<number, number>();
  const gScore = new Map<number, number>([[startIndex, 0]]);
  const fScore = new Map<number, number>([[startIndex, manhattanDistance(nodes[startIndex], nodes[endIndex])]]);

  while (open.size > 0) {
    let current = -1;
    let bestF = Number.POSITIVE_INFINITY;
    for (const index of open) {
      const score = fScore.get(index) ?? Number.POSITIVE_INFINITY;
      if (score < bestF) {
        bestF = score;
        current = index;
      }
    }

    if (current === endIndex) {
      const path: Point[] = [nodes[current]];
      while (cameFrom.has(current)) {
        current = cameFrom.get(current)!;
        path.unshift(nodes[current]);
      }
      return simplifyOrthogonalPath(path);
    }

    open.delete(current);
    const currentG = gScore.get(current) ?? Number.POSITIVE_INFINITY;

    for (const edge of neighbors.get(current) ?? []) {
      const tentativeG = currentG + edge.cost;
      if (tentativeG >= (gScore.get(edge.to) ?? Number.POSITIVE_INFINITY)) continue;
      cameFrom.set(edge.to, current);
      gScore.set(edge.to, tentativeG);
      fScore.set(edge.to, tentativeG + manhattanDistance(nodes[edge.to], nodes[endIndex]));
      open.add(edge.to);
    }
  }

  return null;
}

function buildHVHRoute(exit: Point, entry: Point, midY: number): Point[] {
  return [exit, { x: exit.x, y: midY }, { x: entry.x, y: midY }, entry];
}

function buildVHVRoute(exit: Point, entry: Point, midX: number): Point[] {
  return [exit, { x: midX, y: exit.y }, { x: midX, y: entry.y }, entry];
}

function findBestOrthogonalRoute(
  exit: Point,
  entry: Point,
  tables: RouteTable[],
  endpointIds: string[],
  ctx: RouteContext,
  laneOffset: number,
): Point[] {
  const direct = [exit, entry];
  if (isPathClear(direct, ctx)) return direct;

  const cornerA = { x: entry.x, y: exit.y };
  const cornerB = { x: exit.x, y: entry.y };
  const minX = Math.min(exit.x, entry.x);
  const maxX = Math.max(exit.x, entry.x);
  const minY = Math.min(exit.y, entry.y);
  const maxY = Math.max(exit.y, entry.y);

  const midYCandidates = uniqueCandidates([
    ...laneCandidates((exit.y + entry.y) / 2 + laneOffset * 14, laneOffset),
    ...obstacleSpanCandidates(ctx.obstacles, "y", minX, maxX, laneOffset),
  ]);
  const midXCandidates = uniqueCandidates([
    ...laneCandidates((exit.x + entry.x) / 2 + laneOffset * 14, laneOffset),
    ...obstacleSpanCandidates(ctx.obstacles, "x", minY, maxY, laneOffset),
  ]);

  let bestPath: Point[] | null = null;
  const consider = (candidate: Point[]) => {
    const simplified = simplifyOrthogonalPath(candidate);
    if (!isPathClear(simplified, ctx)) return;
    if (!bestPath || pathLength(simplified) < pathLength(bestPath)) {
      bestPath = simplified;
    }
  };

  consider([exit, cornerA, entry]);
  consider([exit, cornerB, entry]);
  for (const midY of midYCandidates) consider(buildHVHRoute(exit, entry, midY));
  for (const midX of midXCandidates) consider(buildVHVRoute(exit, entry, midX));

  if (bestPath) return bestPath;

  const astarPath = astarOrthogonalRoute(exit, entry, tables, endpointIds, ctx, laneOffset);
  if (astarPath) return astarPath;

  return repairOrthogonalPath([exit, entry], tables, endpointIds, ctx, laneOffset);
}

function repairOrthogonalPath(
  points: Point[],
  tables: RouteTable[],
  endpointIds: string[],
  ctx: RouteContext,
  laneOffset: number,
): Point[] {
  let current = simplifyOrthogonalPath(points);

  for (let iteration = 0; iteration < MAX_REPAIR_ITERATIONS; iteration++) {
    let changed = false;
    const next: Point[] = [current[0]];

    for (let i = 0; i < current.length - 1; i++) {
      const from = next[next.length - 1];
      const to = current[i + 1];

      if (!segmentHitsObstacle(from.x, from.y, to.x, to.y, ctx)) {
        pushPoint(next, to);
        continue;
      }

      changed = true;
      const detour = buildDetourBetween(from, to, tables, endpointIds, ctx, laneOffset);
      for (const point of detour) pushPoint(next, point);
      pushPoint(next, to);
    }

    current = simplifyOrthogonalPath(next);
    if (!changed) break;
  }

  return current;
}

function buildDetourBetween(
  from: Point,
  to: Point,
  tables: RouteTable[],
  endpointIds: string[],
  ctx: RouteContext,
  laneOffset: number,
): Point[] {
  const horizontal = Math.abs(from.y - to.y) < 0.001;
  const vertical = Math.abs(from.x - to.x) < 0.001;

  if (horizontal) {
    const detourY = findFreeHorizontalY(from.x, to.x, from.y, ctx, laneOffset);
    return [{ x: from.x, y: detourY }, { x: to.x, y: detourY }];
  }

  if (vertical) {
    const detourX = findFreeVerticalX(from.y, to.y, from.x, ctx, laneOffset);
    return [{ x: detourX, y: from.y }, { x: detourX, y: to.y }];
  }

  const astarPath = astarOrthogonalRoute(from, to, tables, endpointIds, ctx, laneOffset);
  if (astarPath && astarPath.length > 2) return astarPath.slice(1, -1);

  const midY = findFreeHorizontalY(from.x, to.x, (from.y + to.y) / 2, ctx, laneOffset);
  return [{ x: from.x, y: midY }, { x: to.x, y: midY }];
}

function findFreeHorizontalY(xStart: number, xEnd: number, preferredY: number, ctx: RouteContext, laneOffset: number): number {
  const minX = Math.min(xStart, xEnd);
  const maxX = Math.max(xStart, xEnd);
  const candidates = uniqueCandidates([
    ...laneCandidates(preferredY, laneOffset),
    ...obstacleSpanCandidates(ctx.obstacles, "y", minX, maxX, laneOffset),
  ]);

  for (const y of candidates) {
    if (!segmentHitsObstacle(minX, y, maxX, y, ctx)) return y;
  }

  const blocking = ctx.obstacles.filter((rect) => rect.right > minX && rect.left < maxX);
  if (blocking.length === 0) return preferredY;

  const above = Math.min(...blocking.map((rect) => rect.top)) - 24 - laneOffset * 10;
  if (!segmentHitsObstacle(minX, above, maxX, above, ctx)) return above;

  return Math.max(...blocking.map((rect) => rect.bottom)) + 24 + laneOffset * 10;
}

function findFreeVerticalX(yStart: number, yEnd: number, preferredX: number, ctx: RouteContext, laneOffset: number): number {
  const minY = Math.min(yStart, yEnd);
  const maxY = Math.max(yStart, yEnd);
  const candidates = uniqueCandidates([
    ...laneCandidates(preferredX, laneOffset),
    ...obstacleSpanCandidates(ctx.obstacles, "x", minY, maxY, laneOffset),
  ]);

  for (const x of candidates) {
    if (!segmentHitsObstacle(x, minY, x, maxY, ctx)) return x;
  }

  const blocking = ctx.obstacles.filter((rect) => rect.bottom > minY && rect.top < maxY);
  if (blocking.length === 0) return preferredX;

  const left = Math.min(...blocking.map((rect) => rect.left)) - 24 - laneOffset * 10;
  if (!segmentHitsObstacle(left, minY, left, maxY, ctx)) return left;

  return Math.max(...blocking.map((rect) => rect.right)) + 24 + laneOffset * 10;
}

function getTableById(tables: RouteTable[], tableId: string): RouteTable | undefined {
  return tables.find((table) => table.id === tableId);
}

function appendConnectorPoints(points: Point[], anchor: FieldAnchor, exit: Point, ctx: RouteContext): void {
  if (Math.abs(anchor.x - exit.x) < 0.001 || Math.abs(anchor.y - exit.y) < 0.001) {
    if (!segmentHitsObstacle(anchor.x, anchor.y, exit.x, exit.y, ctx)) {
      pushPoint(points, exit);
      return;
    }
  }

  const cornerA = { x: exit.x, y: anchor.y };
  const cornerB = { x: anchor.x, y: exit.y };
  const routeA =
    !segmentHitsObstacle(anchor.x, anchor.y, cornerA.x, cornerA.y, ctx) &&
    !segmentHitsObstacle(cornerA.x, cornerA.y, exit.x, exit.y, ctx);
  const routeB =
    !segmentHitsObstacle(anchor.x, anchor.y, cornerB.x, cornerB.y, ctx) &&
    !segmentHitsObstacle(cornerB.x, cornerB.y, exit.x, exit.y, ctx);

  if (routeA) {
    pushPoint(points, cornerA);
    pushPoint(points, exit);
    return;
  }
  if (routeB) {
    pushPoint(points, cornerB);
    pushPoint(points, exit);
    return;
  }

  pushPoint(points, exit);
}

function appendEntryConnector(points: Point[], anchor: FieldAnchor, entry: Point, ctx: RouteContext): void {
  pushPoint(points, entry);

  if (Math.abs(anchor.x - entry.x) < 0.001 || Math.abs(anchor.y - entry.y) < 0.001) {
    if (!segmentHitsObstacle(entry.x, entry.y, anchor.x, anchor.y, ctx)) {
      pushPoint(points, { x: anchor.x, y: anchor.y });
      return;
    }
  }

  const cornerA = { x: entry.x, y: anchor.y };
  const cornerB = { x: anchor.x, y: entry.y };
  const routeA =
    !segmentHitsObstacle(entry.x, entry.y, cornerA.x, cornerA.y, ctx) &&
    !segmentHitsObstacle(cornerA.x, cornerA.y, anchor.x, anchor.y, ctx);
  const routeB =
    !segmentHitsObstacle(entry.x, entry.y, cornerB.x, cornerB.y, ctx) &&
    !segmentHitsObstacle(cornerB.x, cornerB.y, anchor.x, anchor.y, ctx);

  if (routeA) {
    pushPoint(points, cornerA);
    pushPoint(points, { x: anchor.x, y: anchor.y });
    return;
  }
  if (routeB) {
    pushPoint(points, cornerB);
    pushPoint(points, { x: anchor.x, y: anchor.y });
    return;
  }

  pushPoint(points, { x: anchor.x, y: anchor.y });
}

function buildRoutePoints(
  from: FieldAnchor,
  to: FieldAnchor,
  tables: RouteTable[],
  fromTableId: string,
  toTableId: string,
  laneOffset: number,
): Point[] {
  const ctx = buildRouteContext(tables, fromTableId, toTableId);
  const fromTable = getTableById(tables, fromTableId);
  const toTable = getTableById(tables, toTableId);
  if (!fromTable || !toTable) return [{ x: from.x, y: from.y }, { x: to.x, y: to.y }];

  const clearance = 34 + laneOffset * 16;
  const points: Point[] = [{ x: from.x, y: from.y }];
  const exit = computeSafeExitPoint(from, fromTable, ctx, clearance, laneOffset);
  const entry = computeSafeExitPoint(to, toTable, ctx, clearance, laneOffset);

  appendConnectorPoints(points, from, exit, ctx);

  const middle = findBestOrthogonalRoute(exit, entry, tables, [fromTableId, toTableId], ctx, laneOffset);
  for (const point of middle.slice(1, -1)) pushPoint(points, point);

  appendEntryConnector(points, to, entry, ctx);

  return repairOrthogonalPath(simplifyOrthogonalPath(points), tables, [fromTableId, toTableId], ctx, laneOffset);
}

/** @internal Exported for tests */
export function buildRoutePointsForTest(
  from: FieldAnchor,
  to: FieldAnchor,
  tables: RouteTable[],
  fromTableId: string,
  toTableId: string,
  laneOffset: number,
): Point[] {
  return buildRoutePoints(from, to, tables, fromTableId, toTableId, laneOffset);
}

/** @internal Exported for tests */
export function isRouteClearForTest(points: Point[], tables: RouteTable[], excludeIds: string[]): boolean {
  const ctx = {
    obstacles: getObstacleRects(tables, excludeIds),
    allowedRects: getEndpointRects(tables, excludeIds),
  };
  return isPathClear(points, ctx);
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
): { path: string; pathPoints: Array<{ x: number; y: number }>; labelPoint: { x: number; y: number } } {
  const points = buildRoutePoints(from, to, tables, fromTableId, toTableId, laneOffset);

  const scaled = points.map((point) => ({
    x: (point.x + canvasGutter) * zoom,
    y: (point.y + canvasGutter) * zoom,
  }));

  const path = scaled.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
  const midIndex = Math.floor((scaled.length - 1) / 2);
  const nextIndex = Math.min(midIndex + 1, scaled.length - 1);
  const labelPoint = {
    x: (scaled[midIndex].x + scaled[nextIndex].x) / 2,
    y: (scaled[midIndex].y + scaled[nextIndex].y) / 2,
  };

  return { path, pathPoints: scaled, labelPoint };
}
