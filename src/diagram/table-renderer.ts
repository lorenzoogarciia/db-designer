import type { Field, Table } from "../domain/types.ts";
import { tableCardTransform } from "./card-style.ts";
import { getFieldMetaLabel, getTableHeight } from "./layout.ts";

/** Etiqueta corta para el nivel de detalle compacto: tipo + claves. */
function shortFieldMeta(field: Field): string {
  const flags = [field.isPrimary ? "PK" : "", field.isUnique && !field.isPrimary ? "UQ" : ""].filter(Boolean);
  return [field.type, ...flags].join(" · ");
}

export function buildTableMarkup(tables: Table[]): string {
  return tables
    .map((table) => {
      const fields = table.fields
        .map(
          (field: Field, fieldIndex: number) => `
            <li>
              <div class="field-left">
                <div class="field-order-actions">
                  <button type="button" class="field-order-btn" data-action="move-field-up" data-table-id="${table.id}" data-field-id="${field.id}" ${fieldIndex === 0 ? "disabled" : ""} title="Subir campo">↑</button>
                  <button type="button" class="field-order-btn" data-action="move-field-down" data-table-id="${table.id}" data-field-id="${field.id}" ${fieldIndex === table.fields.length - 1 ? "disabled" : ""} title="Bajar campo">↓</button>
                </div>
                <span class="field-name">${field.name}</span>
              </div>
              <div class="field-right">
                <small class="field-meta">${getFieldMetaLabel(field)}</small>
                <small class="field-meta-short">${shortFieldMeta(field)}</small>
                <button type="button" class="neutral-btn table-action-btn" data-action="edit-field" data-table-id="${table.id}" data-field-id="${field.id}">Editar</button>
                <button type="button" class="danger-btn table-action-btn" data-action="delete-field" data-table-id="${table.id}" data-field-id="${field.id}">X</button>
              </div>
            </li>
          `,
        )
        .join("");
      const fieldCount = `${table.fields.length} campo${table.fields.length === 1 ? "" : "s"}`;
      // En vista general los nombres largos pueden partirse en varias lineas por los "_".
      const breakableName = table.name.replace(/_/g, "_<wbr>");
      return `
        <article class="table-card" data-table-id="${table.id}" style="transform:${tableCardTransform(table.x, table.y)};height:${getTableHeight(table)}px">
          <div class="table-card-header">
            <div class="table-card-title">
              <h3 title="${table.name}">${breakableName}</h3>
              <span class="table-card-count">${fieldCount}</span>
            </div>
            <div class="table-actions">
              <button type="button" class="neutral-btn table-action-btn" data-action="rename-table" data-table-id="${table.id}">Editar</button>
              <button type="button" class="danger-btn table-action-btn" data-action="delete-table" data-table-id="${table.id}">Eliminar</button>
            </div>
          </div>
          <ul>${fields}</ul>
        </article>
      `;
    })
    .join("");
}
