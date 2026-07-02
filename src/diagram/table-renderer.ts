import type { Field, Table } from "../domain/types.ts";
import { CANVAS_GUTTER } from "./constants.ts";
import { getFieldMetaLabel } from "./layout.ts";
import type { TableWidthResolver } from "./layout.ts";

export function buildTableMarkup(tables: Table[], zoom: number): string {
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
                <small>${getFieldMetaLabel(field)}</small>
                <button type="button" class="neutral-btn table-action-btn" data-action="edit-field" data-table-id="${table.id}" data-field-id="${field.id}">Editar</button>
                <button type="button" class="danger-btn table-action-btn" data-action="delete-field" data-table-id="${table.id}" data-field-id="${field.id}">X</button>
              </div>
            </li>
          `,
        )
        .join("");
      return `
        <article class="table-card" data-table-id="${table.id}" style="left:${(table.x + CANVAS_GUTTER) * zoom}px;top:${(table.y + CANVAS_GUTTER) * zoom}px;transform:scale(${zoom})">
          <div class="table-card-header">
            <h3>${table.name}</h3>
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

export type { TableWidthResolver };
