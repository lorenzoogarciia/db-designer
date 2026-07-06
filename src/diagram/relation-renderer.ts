import { buildRoutedRelationPath } from "../lib/relation-routing.ts";
import type { Relation, Table } from "../domain/types.ts";
import { CANVAS_GUTTER } from "./constants.ts";
import {
  buildScaledTableRects,
  findPreferredLabelPoint,
  placeRelationLabel,
  RELATION_LABEL_WIDTH,
  type Rect,
} from "./relation-label-placement.ts";
import {
  chooseAnchors,
  getCanvasBounds,
  relationLaneKey,
  relationStyle,
  type TableHeightResolver,
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
  getTableHeight: TableHeightResolver;
  getTableCollisionRects?: () => Rect[];
}

interface PreparedRelation {
  relation: Relation;
  index: number;
  path: string;
  pathPoints: Array<{ x: number; y: number }>;
  preferredLabelPoint: { x: number; y: number };
  fromAnchor: ReturnType<typeof chooseAnchors>["from"];
  toAnchor: ReturnType<typeof chooseAnchors>["to"];
  fromField: string;
  toField: string;
  relationTooltip: string;
}

function renderRelationParts(ctx: RelationRenderContext): { lines: string; labels: string } {
  const laneUsage = new Map<string, number>();
  const routeTables = ctx.tables.map((table) => ({
    id: table.id,
    x: table.x,
    y: table.y,
    width: ctx.getTableWidth(table),
    height: ctx.getTableHeight(table),
  }));

  const prepared: PreparedRelation[] = [];

  ctx.relations.forEach((relation, index) => {
    const fromTable = ctx.getTableById(relation.fromTableId);
    const toTable = ctx.getTableById(relation.toTableId);
    if (!fromTable || !toTable) return;

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
    const { path, pathPoints, labelPoint } = buildRoutedRelationPath(
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

    prepared.push({
      relation,
      index,
      path,
      pathPoints,
      preferredLabelPoint: findPreferredLabelPoint(pathPoints.length > 1 ? pathPoints : [labelPoint]),
      fromAnchor,
      toAnchor,
      fromField,
      toField,
      relationTooltip: `${fromTable.name}.${fromField} -> ${toTable.name}.${toField}`,
    });
  });

  const tableRects = ctx.getTableCollisionRects?.() ?? buildScaledTableRects(routeTables, CANVAS_GUTTER, ctx.zoom);
  const placedLabels: Array<{ left: number; top: number; right: number; bottom: number }> = [];
  const labelPositions = new Map<string, { x: number; y: number }>();
  const canvasBounds = { width: ctx.bounds.scaledWidth, height: ctx.bounds.scaledHeight };

  for (const item of prepared) {
    const position = placeRelationLabel(
      item.pathPoints,
      item.preferredLabelPoint,
      tableRects,
      placedLabels,
      canvasBounds,
    );
    labelPositions.set(item.relation.id, position);
  }

  const lines: string[] = [];
  const labels: string[] = [];

  for (const item of prepared) {
    const labelPoint = labelPositions.get(item.relation.id) ?? item.preferredLabelPoint;
    const labelWidth = RELATION_LABEL_WIDTH;
    const labelOffsetX = -labelWidth / 2;
    const scaledLabelX = labelPoint.x;
    const scaledLabelY = labelPoint.y;

    lines.push(`
      <g class="relation-line-bundle" data-relation-id="${item.relation.id}">
        <path class="relation-path ${relationStyle(item.relation.kind)}" data-relation-id="${item.relation.id}" d="${item.path}" marker-end="url(#arrow-head)">
          <title>${item.relationTooltip}</title>
        </path>
        <circle class="relation-anchor relation-anchor-from" cx="${(item.fromAnchor.x + CANVAS_GUTTER) * ctx.zoom}" cy="${(item.fromAnchor.y + CANVAS_GUTTER) * ctx.zoom}" r="4"></circle>
        <circle class="relation-anchor relation-anchor-to" cx="${(item.toAnchor.x + CANVAS_GUTTER) * ctx.zoom}" cy="${(item.toAnchor.y + CANVAS_GUTTER) * ctx.zoom}" r="4"></circle>
      </g>
    `);

    labels.push(`
      <g class="relation-label-bundle" data-relation-id="${item.relation.id}" style="--relation-z:${20 + item.index}">
        <g class="relation-label" transform="translate(${scaledLabelX}, ${scaledLabelY})">
          <rect x="${labelOffsetX}" y="-14" width="${labelWidth}" height="18" rx="6" class="relation-label-box"></rect>
          <text x="0" y="-4" text-anchor="middle" class="relation-label-text">${item.relation.kind}</text>
          <text x="0" y="6" text-anchor="middle" class="relation-label-subtext">${item.fromField} → ${item.toField}</text>
          <g data-relation-id="${item.relation.id}" class="relation-label-edit">
            <title>${item.relationTooltip} (clic para cambiar tipo)</title>
            <rect x="${labelOffsetX}" y="-14" width="${labelWidth - 22}" height="18" fill="transparent"></rect>
          </g>
          <g class="relation-delete-btn" data-action="delete-relation" data-relation-id="${item.relation.id}">
            <title>Eliminar relacion</title>
            <rect x="${labelWidth / 2 - 18}" y="-14" width="18" height="18" rx="4" class="relation-delete-hit"></rect>
            <text x="${labelWidth / 2 - 9}" y="-4" text-anchor="middle" class="relation-delete-x">×</text>
          </g>
        </g>
      </g>
    `);
  }

  return { lines: lines.join(""), labels: labels.join("") };
}

export function buildRelationLayersMarkup(ctx: RelationRenderContext): { lines: string; labels: string } {
  return renderRelationParts(ctx);
}

export function buildRelationLinesMarkup(ctx: RelationRenderContext): string {
  return renderRelationParts(ctx).lines;
}

export function buildRelationLabelsMarkup(ctx: RelationRenderContext): string {
  return renderRelationParts(ctx).labels;
}

export function buildRelationMarkup(ctx: RelationRenderContext): string {
  const { lines, labels } = renderRelationParts(ctx);
  return `${lines}${labels}`;
}
