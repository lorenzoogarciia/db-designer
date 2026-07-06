export const RELATION_LABEL_WIDTH = 88;
export const RELATION_LABEL_ANCHOR_TOP = 14;
export const RELATION_LABEL_HEIGHT = 26;
export const RELATION_LABEL_COLLISION_MARGIN = 10;
export const TABLE_COLLISION_PADDING = 14;

interface Point {
  x: number;
  y: number;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function rectsOverlap(a: Rect, b: Rect, margin = 0): boolean {
  return a.left < b.right + margin && a.right > b.left - margin && a.top < b.bottom + margin && a.bottom > b.top - margin;
}

export function getRelationLabelBounds(centerX: number, centerY: number, margin = RELATION_LABEL_COLLISION_MARGIN): Rect {
  return {
    left: centerX - RELATION_LABEL_WIDTH / 2 - margin,
    right: centerX + RELATION_LABEL_WIDTH / 2 + margin,
    top: centerY - RELATION_LABEL_ANCHOR_TOP - margin,
    bottom: centerY - RELATION_LABEL_ANCHOR_TOP + RELATION_LABEL_HEIGHT + margin,
  };
}

export function labelOverlapsTables(point: Point, tableRects: Rect[]): boolean {
  const bounds = getRelationLabelBounds(point.x, point.y);
  return tableRects.some((rect) => rectsOverlap(bounds, rect));
}

function manhattanDistance(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function pointKey(point: Point): string {
  return `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
}

function uniquePoints(points: Point[]): Point[] {
  const seen = new Set<string>();
  const result: Point[] = [];
  for (const point of points) {
    const key = pointKey(point);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(point);
  }
  return result;
}

function segmentLength(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function interpolate(a: Point, b: Point, t: number): Point {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

function segmentNormal(start: Point, end: Point): Point {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return { x: 0, y: 1 };
  }
  return { x: 1, y: 0 };
}

export function findPreferredLabelPoint(pathPoints: Point[]): Point {
  if (pathPoints.length === 0) return { x: 0, y: 0 };
  if (pathPoints.length === 1) return { ...pathPoints[0] };

  let bestPoint = interpolate(pathPoints[0], pathPoints[1], 0.5);
  let bestLength = 0;

  for (let i = 0; i < pathPoints.length - 1; i++) {
    const length = segmentLength(pathPoints[i], pathPoints[i + 1]);
    if (length > bestLength) {
      bestLength = length;
      bestPoint = interpolate(pathPoints[i], pathPoints[i + 1], 0.5);
    }
  }

  return bestPoint;
}

export function buildLabelCandidates(pathPoints: Point[], preferred: Point): Point[] {
  const candidates: Point[] = [preferred];

  for (let i = 0; i < pathPoints.length - 1; i++) {
    const start = pathPoints[i];
    const end = pathPoints[i + 1];
    if (segmentLength(start, end) < 16) continue;

    for (const t of [0.15, 0.25, 0.35, 0.5, 0.65, 0.75, 0.85]) {
      candidates.push(interpolate(start, end, t));
    }
  }

  for (let i = 0; i < pathPoints.length - 1; i++) {
    candidates.push(interpolate(pathPoints[i], pathPoints[i + 1], 0.5));
  }

  return uniquePoints(candidates);
}

function buildOffsetCandidates(basePoints: Point[], pathPoints: Point[]): Point[] {
  const offsets = [16, 28, 42, 56, 72, 88];
  const candidates: Point[] = [];

  for (const base of basePoints) {
    candidates.push(base);
    for (const distance of offsets) {
      candidates.push(
        { x: base.x, y: base.y - distance },
        { x: base.x, y: base.y + distance },
        { x: base.x - distance, y: base.y },
        { x: base.x + distance, y: base.y },
      );
    }
  }

  for (let i = 0; i < pathPoints.length - 1; i++) {
    const start = pathPoints[i];
    const end = pathPoints[i + 1];
    if (segmentLength(start, end) < 12) continue;

    const normal = segmentNormal(start, end);
    for (const t of [0.25, 0.5, 0.75]) {
      const anchor = interpolate(start, end, t);
      for (const distance of offsets) {
        candidates.push(
          { x: anchor.x + normal.x * distance, y: anchor.y + normal.y * distance },
          { x: anchor.x - normal.x * distance, y: anchor.y - normal.y * distance },
        );
      }
    }
  }

  return uniquePoints(candidates);
}

function isWithinCanvas(bounds: Rect, canvasBounds: { width: number; height: number }): boolean {
  return bounds.left >= 8 && bounds.top >= 8 && bounds.right <= canvasBounds.width - 8 && bounds.bottom <= canvasBounds.height - 8;
}

function isValidLabelPosition(
  point: Point,
  tableRects: Rect[],
  placedLabels: Rect[],
  canvasBounds?: { width: number; height: number },
): boolean {
  const bounds = getRelationLabelBounds(point.x, point.y);

  if (canvasBounds && !isWithinCanvas(bounds, canvasBounds)) {
    return false;
  }

  if (labelOverlapsTables(point, tableRects)) return false;
  if (placedLabels.some((rect) => rectsOverlap(bounds, rect, 4))) return false;
  return true;
}

function isValidLabelPositionAvoidingTables(
  point: Point,
  tableRects: Rect[],
  canvasBounds?: { width: number; height: number },
): boolean {
  const bounds = getRelationLabelBounds(point.x, point.y);
  if (canvasBounds && !isWithinCanvas(bounds, canvasBounds)) return false;
  return !labelOverlapsTables(point, tableRects);
}

function sortByPreferred(candidates: Point[], preferred: Point): Point[] {
  return [...candidates].sort((a, b) => manhattanDistance(a, preferred) - manhattanDistance(b, preferred));
}

function findSpiralEscapePoint(
  preferred: Point,
  tableRects: Rect[],
  canvasBounds?: { width: number; height: number },
): Point | null {
  for (let radius = 0; radius <= 900; radius += 12) {
    for (let angle = 0; angle < 360; angle += 15) {
      const radians = (angle * Math.PI) / 180;
      const candidate = {
        x: preferred.x + Math.cos(radians) * radius,
        y: preferred.y + Math.sin(radians) * radius,
      };
      if (isValidLabelPositionAvoidingTables(candidate, tableRects, canvasBounds)) {
        return candidate;
      }
    }
  }
  return null;
}

function findAnyFreeCanvasPoint(
  tableRects: Rect[],
  canvasBounds: { width: number; height: number },
): Point {
  for (let y = 20; y < canvasBounds.height - 20; y += 22) {
    for (let x = 20; x < canvasBounds.width - 20; x += 22) {
      const candidate = { x, y };
      if (isValidLabelPositionAvoidingTables(candidate, tableRects, canvasBounds)) {
        return candidate;
      }
    }
  }

  return { x: 20, y: 20 };
}

export function placeRelationLabel(
  pathPoints: Point[],
  preferred: Point,
  tableRects: Rect[],
  placedLabels: Rect[],
  canvasBounds?: { width: number; height: number },
): Point {
  const baseCandidates = buildLabelCandidates(pathPoints, preferred);
  const expandedCandidates = buildOffsetCandidates(baseCandidates, pathPoints);
  const rankedCandidates = sortByPreferred(expandedCandidates, preferred);

  for (const candidate of rankedCandidates) {
    if (!isValidLabelPosition(candidate, tableRects, placedLabels, canvasBounds)) continue;
    placedLabels.push(getRelationLabelBounds(candidate.x, candidate.y));
    return candidate;
  }

  for (const candidate of rankedCandidates) {
    if (!isValidLabelPositionAvoidingTables(candidate, tableRects, canvasBounds)) continue;
    placedLabels.push(getRelationLabelBounds(candidate.x, candidate.y));
    return candidate;
  }

  const spiralEscape = findSpiralEscapePoint(preferred, tableRects, canvasBounds);
  if (spiralEscape) {
    placedLabels.push(getRelationLabelBounds(spiralEscape.x, spiralEscape.y));
    return spiralEscape;
  }

  const canvasFallback = canvasBounds
    ? findAnyFreeCanvasPoint(tableRects, canvasBounds)
    : { x: preferred.x, y: preferred.y - 120 };

  placedLabels.push(getRelationLabelBounds(canvasFallback.x, canvasFallback.y));
  return canvasFallback;
}

export function buildScaledTableRects(
  tables: Array<{ x: number; y: number; width: number; height: number }>,
  canvasGutter: number,
  zoom: number,
  padding = TABLE_COLLISION_PADDING,
): Rect[] {
  return tables.map((table) => ({
    left: (table.x + canvasGutter) * zoom - padding,
    top: (table.y + canvasGutter) * zoom - padding,
    right: (table.x + canvasGutter + table.width) * zoom + padding,
    bottom: (table.y + canvasGutter + table.height) * zoom + padding,
  }));
}
