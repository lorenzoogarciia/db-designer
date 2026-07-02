export interface FieldAnchor {
  x: number;
  y: number;
  side: "left" | "right" | "top" | "bottom";
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface RouteTable {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const ROUTE_PADDING = 16;

function segmentIntersectsRect(x1: number, y1: number, x2: number, y2: number, rect: Rect): boolean {
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);

  if (Math.abs(y1 - y2) < 0.001) {
    const y = y1;
    if (y <= rect.top || y >= rect.bottom) return false;
    return maxX > rect.left && minX < rect.right;
  }

  if (Math.abs(x1 - x2) < 0.001) {
    const x = x1;
    if (x <= rect.left || x >= rect.right) return false;
    return maxY > rect.top && minY < rect.bottom;
  }

  return false;
}

function segmentHitsObstacle(x1: number, y1: number, x2: number, y2: number, obstacles: Rect[]): boolean {
  return obstacles.some((rect) => segmentIntersectsRect(x1, y1, x2, y2, rect));
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

function extendAnchor(anchor: FieldAnchor, clearance: number): { x: number; y: number } {
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

function findFreeHorizontalY(
  xStart: number,
  xEnd: number,
  preferredY: number,
  obstacles: Rect[],
  laneOffset: number,
): number {
  const minX = Math.min(xStart, xEnd);
  const maxX = Math.max(xStart, xEnd);
  const candidates = [preferredY];

  for (let step = 1; step <= 24; step++) {
    candidates.push(preferredY - step * (18 + laneOffset * 2));
    candidates.push(preferredY + step * (18 + laneOffset * 2));
  }

  for (const y of candidates) {
    if (!segmentHitsObstacle(minX, y, maxX, y, obstacles)) return y;
  }

  const blocking = obstacles.filter((rect) => rect.right > minX && rect.left < maxX);
  if (blocking.length === 0) return preferredY;

  const above = Math.min(...blocking.map((rect) => rect.top)) - 24 - laneOffset * 10;
  if (!segmentHitsObstacle(minX, above, maxX, above, obstacles)) return above;

  return Math.max(...blocking.map((rect) => rect.bottom)) + 24 + laneOffset * 10;
}

function findFreeVerticalX(
  yStart: number,
  yEnd: number,
  preferredX: number,
  obstacles: Rect[],
  laneOffset: number,
): number {
  const minY = Math.min(yStart, yEnd);
  const maxY = Math.max(yStart, yEnd);
  const candidates = [preferredX];

  for (let step = 1; step <= 24; step++) {
    candidates.push(preferredX - step * (18 + laneOffset * 2));
    candidates.push(preferredX + step * (18 + laneOffset * 2));
  }

  for (const x of candidates) {
    if (!segmentHitsObstacle(x, minY, x, maxY, obstacles)) return x;
  }

  const blocking = obstacles.filter((rect) => rect.bottom > minY && rect.top < maxY);
  if (blocking.length === 0) return preferredX;

  const left = Math.min(...blocking.map((rect) => rect.left)) - 24 - laneOffset * 10;
  if (!segmentHitsObstacle(left, minY, left, maxY, obstacles)) return left;

  return Math.max(...blocking.map((rect) => rect.right)) + 24 + laneOffset * 10;
}

function pushPoint(points: Array<{ x: number; y: number }>, point: { x: number; y: number }) {
  const last = points[points.length - 1];
  if (last && Math.abs(last.x - point.x) < 0.001 && Math.abs(last.y - point.y) < 0.001) return;
  points.push(point);
}

function routeHorizontalPair(
  from: FieldAnchor,
  to: FieldAnchor,
  obstacles: Rect[],
  laneOffset: number,
): Array<{ x: number; y: number }> {
  const clearance = 34 + laneOffset * 16;
  const points: Array<{ x: number; y: number }> = [{ x: from.x, y: from.y }];
  const exit = extendAnchor(from, clearance);
  const entry = extendAnchor(to, clearance);
  pushPoint(points, exit);

  if (Math.abs(exit.y - entry.y) < 0.001) {
    const routeY = findFreeHorizontalY(exit.x, entry.x, exit.y, obstacles, laneOffset);
    if (Math.abs(routeY - exit.y) > 0.001) {
      pushPoint(points, { x: exit.x, y: routeY });
      pushPoint(points, { x: entry.x, y: routeY });
    } else if (!segmentHitsObstacle(exit.x, exit.y, entry.x, entry.y, obstacles)) {
      pushPoint(points, { x: entry.x, y: entry.y });
    } else {
      const detourY = findFreeHorizontalY(exit.x, entry.x, exit.y - 40, obstacles, laneOffset);
      pushPoint(points, { x: exit.x, y: detourY });
      pushPoint(points, { x: entry.x, y: detourY });
    }
  } else {
    const midX = findFreeVerticalX(exit.y, entry.y, (exit.x + entry.x) / 2 + laneOffset * 14, obstacles, laneOffset);
    pushPoint(points, { x: midX, y: exit.y });
    pushPoint(points, { x: midX, y: entry.y });
  }

  pushPoint(points, entry);
  pushPoint(points, { x: to.x, y: to.y });
  return points;
}

function routeVerticalPair(
  from: FieldAnchor,
  to: FieldAnchor,
  obstacles: Rect[],
  laneOffset: number,
): Array<{ x: number; y: number }> {
  const clearance = 34 + laneOffset * 16;
  const points: Array<{ x: number; y: number }> = [{ x: from.x, y: from.y }];
  const exit = extendAnchor(from, clearance);
  const entry = extendAnchor(to, clearance);
  pushPoint(points, exit);

  if (Math.abs(exit.x - entry.x) < 0.001) {
    const routeX = findFreeVerticalX(exit.y, entry.y, exit.x, obstacles, laneOffset);
    if (Math.abs(routeX - exit.x) > 0.001) {
      pushPoint(points, { x: routeX, y: exit.y });
      pushPoint(points, { x: routeX, y: entry.y });
    } else if (!segmentHitsObstacle(exit.x, exit.y, entry.x, entry.y, obstacles)) {
      pushPoint(points, { x: entry.x, y: entry.y });
    } else {
      const detourX = findFreeVerticalX(exit.y, entry.y, exit.x + 40, obstacles, laneOffset);
      pushPoint(points, { x: detourX, y: exit.y });
      pushPoint(points, { x: detourX, y: entry.y });
    }
  } else {
    const midY = findFreeHorizontalY(exit.x, entry.x, (exit.y + entry.y) / 2 + laneOffset * 14, obstacles, laneOffset);
    pushPoint(points, { x: exit.x, y: midY });
    pushPoint(points, { x: entry.x, y: midY });
  }

  pushPoint(points, entry);
  pushPoint(points, { x: to.x, y: to.y });
  return points;
}

function routeMixedPair(
  from: FieldAnchor,
  to: FieldAnchor,
  obstacles: Rect[],
  laneOffset: number,
): Array<{ x: number; y: number }> {
  const clearance = 34 + laneOffset * 16;
  const points: Array<{ x: number; y: number }> = [{ x: from.x, y: from.y }];
  const exit = extendAnchor(from, clearance);
  const entry = extendAnchor(to, clearance);
  pushPoint(points, exit);

  const cornerA = { x: entry.x, y: exit.y };
  const cornerB = { x: exit.x, y: entry.y };
  const routeA =
    !segmentHitsObstacle(exit.x, exit.y, cornerA.x, cornerA.y, obstacles) &&
    !segmentHitsObstacle(cornerA.x, cornerA.y, entry.x, entry.y, obstacles);
  const routeB =
    !segmentHitsObstacle(exit.x, exit.y, cornerB.x, cornerB.y, obstacles) &&
    !segmentHitsObstacle(cornerB.x, cornerB.y, entry.x, entry.y, obstacles);

  if (routeA) {
    pushPoint(points, cornerA);
  } else if (routeB) {
    pushPoint(points, cornerB);
  } else {
    const midY = findFreeHorizontalY(exit.x, entry.x, (exit.y + entry.y) / 2, obstacles, laneOffset);
    pushPoint(points, { x: exit.x, y: midY });
    pushPoint(points, { x: entry.x, y: midY });
  }

  pushPoint(points, entry);
  pushPoint(points, { x: to.x, y: to.y });
  return points;
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
): { path: string; labelPoint: { x: number; y: number } } {
  const obstacles = getObstacleRects(tables, [fromTableId, toTableId]);
  const isHorizontalSide = (side: FieldAnchor["side"]) => side === "left" || side === "right";

  let points: Array<{ x: number; y: number }>;
  if (isHorizontalSide(from.side) && isHorizontalSide(to.side)) {
    points = routeHorizontalPair(from, to, obstacles, laneOffset);
  } else if (!isHorizontalSide(from.side) && !isHorizontalSide(to.side)) {
    points = routeVerticalPair(from, to, obstacles, laneOffset);
  } else {
    points = routeMixedPair(from, to, obstacles, laneOffset);
  }

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

  return { path, labelPoint };
}
