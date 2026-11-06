import { dataTypeLabel } from "../lib/data-types.ts";
import type { FieldAnchor } from "../lib/relation-routing.ts";
import { clamp } from "../domain/ids.ts";
import type { Field, RelationKind, Table } from "../domain/types.ts";
import {
  TABLE_HEADER_HEIGHT,
  TABLE_MIN_WIDTH,
  TABLE_ORIGIN_PADDING,
  TABLE_ROW_HEIGHT,
} from "./constants.ts";

export function fieldTypeLabel(field: Field): string {
  if (field.type !== "enum") return dataTypeLabel(field.type);
  const values = field.enumValues?.filter((item) => item.length > 0) ?? [];
  if (values.length === 0) return "enum";
  const preview = values.slice(0, 3).join(", ");
  const suffix = values.length > 3 ? ",…" : "";
  return `enum(${preview}${suffix})`;
}

export function getFieldMetaLabel(field: Field): string {
  const defaultSuffix = field.defaultValue
    ? ` | DEF ${field.defaultValue.length > 14 ? `${field.defaultValue.slice(0, 14)}…` : field.defaultValue}`
    : "";
  return `${fieldTypeLabel(field)}${field.nullable ? "?" : ""}${field.isPrimary ? " | PK" : ""}${field.isUnique && !field.isPrimary ? " | UQ" : ""}${field.autoIncrement ? " | AI" : ""}${field.isIndexed && !field.isPrimary && !field.isUnique ? " | IDX" : ""}${defaultSuffix}`;
}

export function estimateTableWidth(table: Table): number {
  const titleCharWidth = 9.5;
  const nameCharWidth = 8.5;
  const metaCharWidth = 7;
  const headerActionsWidth = 210;
  const rowActionsWidth = 168;
  const rowOrderWidth = 88;
  const rowGap = 24;
  const horizontalPadding = 32;

  let maxWidth = TABLE_MIN_WIDTH;
  const headerWidth = table.name.length * titleCharWidth + headerActionsWidth + horizontalPadding;
  maxWidth = Math.max(maxWidth, headerWidth);

  table.fields.forEach((field) => {
    const meta = getFieldMetaLabel(field);
    const rowWidth =
      field.name.length * nameCharWidth + meta.length * metaCharWidth + rowActionsWidth + rowOrderWidth + rowGap + horizontalPadding;
    maxWidth = Math.max(maxWidth, rowWidth);
  });

  return Math.ceil(maxWidth);
}

export function getTableHeight(table: Table): number {
  return TABLE_HEADER_HEIGHT + table.fields.length * TABLE_ROW_HEIGHT;
}

export type TableWidthResolver = (table: Table) => number;
export type TableHeightResolver = (table: Table) => number;

export function getTablesLogicalBounds(tables: Table[], getTableWidth: TableWidthResolver) {
  if (tables.length === 0) {
    return { minX: 0, minY: 0, maxX: 800, maxY: 600, width: 800, height: 600 };
  }
  const minX = Math.min(...tables.map((table) => table.x));
  const minY = Math.min(...tables.map((table) => table.y));
  const maxX = Math.max(...tables.map((table) => table.x + getTableWidth(table)));
  const maxY = Math.max(...tables.map((table) => table.y + getTableHeight(table)));
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/**
 * Shift all tables so none sit at negative (or near-zero) coords.
 * Needed after reducing CANVAS_GUTTER: old drags allowed x/y down to ~-792,
 * which now render outside the scrollable scene.
 */
export function normalizeTablesOrigin(tables: Table[]): { tables: Table[]; shifted: boolean } {
  if (tables.length === 0) return { tables, shifted: false };

  const withCoords = tables.map((table, index) => ({
    ...table,
    x: typeof table.x === "number" ? table.x : 24 + (index % 2) * 400,
    y: typeof table.y === "number" ? table.y : 24 + Math.floor(index / 2) * 280,
  }));

  const minX = Math.min(...withCoords.map((table) => table.x));
  const minY = Math.min(...withCoords.map((table) => table.y));
  const shiftX = minX < TABLE_ORIGIN_PADDING ? TABLE_ORIGIN_PADDING - minX : 0;
  const shiftY = minY < TABLE_ORIGIN_PADDING ? TABLE_ORIGIN_PADDING - minY : 0;

  if (shiftX === 0 && shiftY === 0) {
    return { tables: withCoords, shifted: false };
  }

  return {
    tables: withCoords.map((table) => ({
      ...table,
      x: table.x + shiftX,
      y: table.y + shiftY,
    })),
    shifted: true,
  };
}

export function chooseAnchors(
  fromTable: Table,
  fromFieldId: string,
  toTable: Table,
  toFieldId: string,
  getTableWidth: TableWidthResolver,
): { from: FieldAnchor; to: FieldAnchor } {
  const fromFieldIndex = fromTable.fields.findIndex((field) => field.id === fromFieldId);
  const toFieldIndex = toTable.fields.findIndex((field) => field.id === toFieldId);
  const fromY = fromTable.y + TABLE_HEADER_HEIGHT + Math.max(0, fromFieldIndex) * TABLE_ROW_HEIGHT + TABLE_ROW_HEIGHT / 2;
  const toY = toTable.y + TABLE_HEADER_HEIGHT + Math.max(0, toFieldIndex) * TABLE_ROW_HEIGHT + TABLE_ROW_HEIGHT / 2;
  const fromCenterX = fromTable.x + getTableWidth(fromTable) / 2;
  const toCenterX = toTable.x + getTableWidth(toTable) / 2;
  const fromCenterY = fromTable.y + getTableHeight(fromTable) / 2;
  const toCenterY = toTable.y + getTableHeight(toTable) / 2;
  const deltaX = toCenterX - fromCenterX;
  const deltaY = toCenterY - fromCenterY;

  if (Math.abs(deltaX) >= Math.abs(deltaY)) {
    if (deltaX >= 0) {
      return {
        from: { x: fromTable.x + getTableWidth(fromTable), y: fromY, side: "right" },
        to: { x: toTable.x, y: toY, side: "left" },
      };
    }
    return {
      from: { x: fromTable.x, y: fromY, side: "left" },
      to: { x: toTable.x + getTableWidth(toTable), y: toY, side: "right" },
    };
  }

  if (deltaY >= 0) {
    return {
      from: { x: fromTable.x + getTableWidth(fromTable) / 2, y: fromTable.y + getTableHeight(fromTable), side: "bottom" },
      to: { x: toTable.x + getTableWidth(toTable) / 2, y: toTable.y, side: "top" },
    };
  }
  return {
    from: { x: fromTable.x + getTableWidth(fromTable) / 2, y: fromTable.y, side: "top" },
    to: { x: toTable.x + getTableWidth(toTable) / 2, y: toTable.y + getTableHeight(toTable), side: "bottom" },
  };
}

export function relationStyle(kind: RelationKind): string {
  if (kind === "1:1") return "rel-one-one";
  if (kind === "N:M") return "rel-many-many";
  return "rel-one-many";
}

export function relationLaneKey(relation: { fromTableId: string; fromFieldId: string; toTableId: string; toFieldId: string }): string {
  return `${relation.fromTableId}:${relation.fromFieldId}->${relation.toTableId}:${relation.toFieldId}`;
}

export { clamp };

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Busca la posicion libre mas cercana a (preferredX, preferredY) para una tabla de
 * width x height, recorriendo anillos alrededor del punto preferido.
 */
export function findFreeTablePosition(
  occupied: Box[],
  width: number,
  height: number,
  preferredX: number,
  preferredY: number,
  margin = 40,
  step = 40,
): { x: number; y: number } {
  const collides = (x: number, y: number) =>
    occupied.some(
      (box) =>
        x < box.x + box.width + margin &&
        x + width + margin > box.x &&
        y < box.y + box.height + margin &&
        y + height + margin > box.y,
    );
  const startX = Math.round(preferredX);
  const startY = Math.round(preferredY);
  if (!collides(startX, startY)) return { x: startX, y: startY };
  for (let ring = 1; ring <= 120; ring += 1) {
    const candidates: Array<{ x: number; y: number }> = [];
    for (let offset = -ring; offset <= ring; offset += 1) {
      candidates.push(
        { x: startX + offset * step, y: startY + ring * step },
        { x: startX + offset * step, y: startY - ring * step },
        { x: startX + ring * step, y: startY + offset * step },
        { x: startX - ring * step, y: startY + offset * step },
      );
    }
    candidates.sort(
      (a, b) => Math.hypot(a.x - startX, a.y - startY) - Math.hypot(b.x - startX, b.y - startY),
    );
    const free = candidates.find((candidate) => !collides(candidate.x, candidate.y));
    if (free) return free;
  }
  return { x: startX, y: startY };
}

/**
 * Posicion para una tabla nueva: lo mas cerca posible del centro de sus tablas relacionadas
 * (donde haya hueco libre). Sin relaciones, cerca de `fallback` (p. ej. el centro de la vista).
 */
export function placeNearRelated(
  occupied: Box[],
  width: number,
  height: number,
  related: Box[],
  fallback: { x: number; y: number },
): { x: number; y: number } {
  const anchor =
    related.length > 0
      ? {
          x: related.reduce((sum, box) => sum + box.x + box.width / 2, 0) / related.length,
          y: related.reduce((sum, box) => sum + box.y + box.height / 2, 0) / related.length,
        }
      : fallback;
  return findFreeTablePosition(occupied, width, height, anchor.x - width / 2, anchor.y - height / 2, 60, 40);
}
