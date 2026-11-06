import { buildRoutedRelationPath } from "../lib/relation-routing.ts";
import type { Relation, RelationKind, Table } from "../domain/types.ts";
import {
  buildScaledTableRects,
  findPreferredLabelPoint,
  placeRelationLabel,
  RELATION_LABEL_WIDTH,
  type Rect,
} from "./relation-label-placement.ts";
import {
  chooseAnchors,
  relationLaneKey,
  relationStyle,
  type TableHeightResolver,
  type TableWidthResolver,
} from "./layout.ts";

/**
 * Simbolos de cardinalidad (notacion "pata de gallo") de cada extremo. El origen de la relacion
 * es la tabla con la clave foranea: en 1:N es el lado "muchos".
 */
export function cardinalityMarkers(kind: RelationKind): { start: string; end: string } {
  const key = relationKindKey(kind);
  if (kind === "1:1") return { start: `card-one-${key}`, end: `card-one-${key}` };
  if (kind === "N:M") return { start: `card-many-${key}`, end: `card-many-${key}` };
  return { start: `card-many-${key}`, end: `card-one-${key}` };
}

export function relationKindKey(kind: RelationKind): string {
  if (kind === "1:1") return "11";
  if (kind === "N:M") return "nm";
  return "1n";
}

/**
 * Definiciones SVG de los simbolos. Se dibujan en un marco donde +x apunta hacia la tabla y el
 * borde de la tabla esta en x=16; `auto-start-reverse` orienta igual el extremo inicial.
 * El tamano va en unidades del mundo para poder ajustarlo al zoom (ver diagram-controller).
 */
export function buildCardinalityMarkerDefs(worldSize: number): string {
  const size = worldSize.toFixed(2);
  const markers: string[] = [];
  for (const key of ["11", "1n", "nm"]) {
    markers.push(
      `<marker id="card-one-${key}" class="card-marker rel-color-${key}" viewBox="0 0 16 16" refX="16" refY="8" markerUnits="userSpaceOnUse" markerWidth="${size}" markerHeight="${size}" orient="auto-start-reverse"><path d="M 0 8 L 16 8 M 10 2 L 10 14"></path></marker>`,
      `<marker id="card-many-${key}" class="card-marker rel-color-${key}" viewBox="0 0 16 16" refX="16" refY="8" markerUnits="userSpaceOnUse" markerWidth="${size}" markerHeight="${size}" orient="auto-start-reverse"><path d="M 0 8 L 16 8 M 5 8 L 16 1.5 M 5 8 L 16 14.5"></path></marker>`,
    );
  }
  return `<defs>${markers.join("")}</defs>`;
}

export interface RelationRenderContext {
  tables: Table[];
  relations: Relation[];
  /**
   * Desplazamiento de las coordenadas del SVG respecto al mundo: un punto logico (x, y)
   * se dibuja en (x + offset, y + offset). La capa SVG se coloca en (-offset, -offset).
   */
  offset: number;
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

function renderRelationParts(
  ctx: RelationRenderContext,
  quality: "fast" | "full" = "full",
): { lines: string; labels: string } {
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
      ctx.offset,
      1,
      quality,
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

  const tableRects = ctx.getTableCollisionRects?.() ?? buildScaledTableRects(routeTables, ctx.offset, 1);
  const placedLabels: Array<{ left: number; top: number; right: number; bottom: number }> = [];
  const labelPositions = new Map<string, { x: number; y: number }>();

  for (const item of prepared) {
    if (quality === "fast") {
      labelPositions.set(item.relation.id, item.preferredLabelPoint);
      continue;
    }
    const position = placeRelationLabel(
      item.pathPoints,
      item.preferredLabelPoint,
      tableRects,
      placedLabels,
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

    const { start, end } = cardinalityMarkers(item.relation.kind);
    lines.push(`
      <g class="relation-line-bundle" data-relation-id="${item.relation.id}">
        <path class="relation-path ${relationStyle(item.relation.kind)}" data-relation-id="${item.relation.id}" d="${item.path}" marker-start="url(#${start})" marker-end="url(#${end})">
          <title>${item.relation.kind} · ${item.relationTooltip}</title>
        </path>
      </g>
    `);

    labels.push(`
      <g class="relation-label-bundle ${relationStyle(item.relation.kind)}" data-relation-id="${item.relation.id}" style="--relation-z:${20 + item.index}">
        <g class="relation-label" transform="translate(${scaledLabelX.toFixed(1)}, ${scaledLabelY.toFixed(1)})">
          <g class="relation-label-scale">
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
      </g>
    `);
  }

  return { lines: lines.join(""), labels: labels.join("") };
}

export function buildRelationLayersMarkup(
  ctx: RelationRenderContext,
  quality: "fast" | "full" = "full",
): { lines: string; labels: string } {
  return renderRelationParts(ctx, quality);
}
