import { buildRoutedRelationPath } from "../lib/relation-routing.ts";
import type { Relation, Table } from "../domain/types.ts";
import { CANVAS_GUTTER } from "./constants.ts";
import {
  chooseAnchors,
  clamp,
  getCanvasBounds,
  getTableHeight,
  relationLaneKey,
  relationStyle,
  type TableWidthResolver,
} from "./layout.ts";

export interface RelationRenderContext {
  tables: Table[];
  relations: Relation[];
  zoom: number;
  bounds: ReturnType<typeof getCanvasBounds>;
  getTableById: (tableId: string) => Table | undefined;
  getFieldName: (tableId: string, fieldId: string) => string;
  getTableWidth: TableWidthResolver;
}

export function buildRelationMarkup(ctx: RelationRenderContext): string {
  const laneUsage = new Map<string, number>();
  const routeTables = ctx.tables.map((table) => ({
    id: table.id,
    x: table.x,
    y: table.y,
    width: ctx.getTableWidth(table),
    height: getTableHeight(table),
  }));

  return ctx.relations
    .map((relation, index) => {
      const fromTable = ctx.getTableById(relation.fromTableId);
      const toTable = ctx.getTableById(relation.toTableId);
      if (!fromTable || !toTable) return "";
      const laneKey = relationLaneKey(relation);
      const laneOffset = laneUsage.get(laneKey) ?? 0;
      laneUsage.set(laneKey, laneOffset + 1);
      const { from: fromAnchor, to: toAnchor } = chooseAnchors(
        fromTable,
        relation.fromFieldId,
        toTable,
        relation.toFieldId,
        ctx.getTableWidth,
      );
      const { path, labelPoint } = buildRoutedRelationPath(
        fromAnchor,
        toAnchor,
        routeTables,
        relation.fromTableId,
        relation.toTableId,
        laneOffset,
        CANVAS_GUTTER,
        ctx.zoom,
      );
      const fromField = ctx.getFieldName(relation.fromTableId, relation.fromFieldId);
      const toField = ctx.getFieldName(relation.toTableId, relation.toFieldId);
      const relationTooltip = `${fromTable.name}.${fromField} -> ${toTable.name}.${toField}`;
      const labelWidth = 88;
      const labelOffsetX = -labelWidth / 2;
      const scaledLabelX = clamp(labelPoint.x, labelWidth / 2 + 8, ctx.bounds.scaledWidth - labelWidth / 2 - 8);
      const scaledLabelY = clamp(labelPoint.y, 16, ctx.bounds.scaledHeight - 8);
      return `
        <g class="relation-bundle" data-relation-id="${relation.id}" style="--relation-z:${20 + index}">
          <path class="relation-path ${relationStyle(relation.kind)}" data-relation-id="${relation.id}" d="${path}" marker-end="url(#arrow-head)">
            <title>${relationTooltip}</title>
          </path>
          <circle class="relation-anchor relation-anchor-from" cx="${(fromAnchor.x + CANVAS_GUTTER) * ctx.zoom}" cy="${(fromAnchor.y + CANVAS_GUTTER) * ctx.zoom}" r="4"></circle>
          <circle class="relation-anchor relation-anchor-to" cx="${(toAnchor.x + CANVAS_GUTTER) * ctx.zoom}" cy="${(toAnchor.y + CANVAS_GUTTER) * ctx.zoom}" r="4"></circle>
          <g class="relation-label" transform="translate(${scaledLabelX}, ${scaledLabelY})">
            <rect x="${labelOffsetX}" y="-14" width="${labelWidth}" height="18" rx="6" class="relation-label-box"></rect>
            <text x="0" y="-4" text-anchor="middle" class="relation-label-text">${relation.kind}</text>
            <text x="0" y="6" text-anchor="middle" class="relation-label-subtext">${fromField} → ${toField}</text>
            <g data-relation-id="${relation.id}" class="relation-label-edit">
              <title>${relationTooltip} (clic para cambiar tipo)</title>
              <rect x="${labelOffsetX}" y="-14" width="${labelWidth - 22}" height="18" fill="transparent"></rect>
            </g>
            <g class="relation-delete-btn" data-action="delete-relation" data-relation-id="${relation.id}">
              <title>Eliminar relacion</title>
              <rect x="${labelWidth / 2 - 18}" y="-14" width="18" height="18" rx="4" class="relation-delete-hit"></rect>
              <text x="${labelWidth / 2 - 9}" y="-4" text-anchor="middle" class="relation-delete-x">×</text>
            </g>
          </g>
        </g>
      `;
    })
    .join("");
}
