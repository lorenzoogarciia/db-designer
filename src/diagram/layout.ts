import { dataTypeLabel } from "../lib/data-types.ts";
import type { FieldAnchor } from "../lib/relation-routing.ts";
import { clamp } from "../domain/ids.ts";
import type { Field, RelationKind, Table } from "../domain/types.ts";
import {
  BASE_PADDING,
  CANVAS_GUTTER,
  TABLE_HEADER_HEIGHT,
  TABLE_MIN_WIDTH,
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
  return `${fieldTypeLabel(field)}${field.nullable ? "?" : ""}${field.isPrimary ? " | PK" : ""}${field.isUnique && !field.isPrimary ? " | UQ" : ""}${field.autoIncrement ? " | AI" : ""}${field.isIndexed && !field.isPrimary && !field.isUnique ? " | IDX" : ""}`;
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

export function getCanvasBounds(
  tables: Table[],
  zoom: number,
  viewportWidth: number,
  viewportHeight: number,
  getTableWidth: TableWidthResolver,
) {
  const maxRight = Math.max(700, ...tables.map((table) => table.x + getTableWidth(table) + BASE_PADDING)) + CANVAS_GUTTER * 2;
  const maxBottom = Math.max(500, ...tables.map((table) => table.y + getTableHeight(table) + BASE_PADDING)) + CANVAS_GUTTER * 2;
  const minLogicalWidth = viewportWidth / zoom + CANVAS_GUTTER * 2;
  const minLogicalHeight = viewportHeight / zoom + CANVAS_GUTTER * 2;
  const logicalWidth = Math.max(maxRight, minLogicalWidth);
  const logicalHeight = Math.max(maxBottom, minLogicalHeight);
  return {
    logicalWidth,
    logicalHeight,
    scaledWidth: Math.ceil(logicalWidth * zoom),
    scaledHeight: Math.ceil(logicalHeight * zoom),
  };
}

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

export function ensureTablePositions(tables: Table[]): Table[] {
  return tables.map((table, index) => {
    if (typeof table.x === "number" && typeof table.y === "number") return table;
    return {
      ...table,
      x: 24 + (index % 2) * 400,
      y: 24 + Math.floor(index / 2) * 280,
    };
  });
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

export { clamp, CANVAS_GUTTER };
