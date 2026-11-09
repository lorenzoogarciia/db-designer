import type { Field, Table } from "../domain/types.ts";
import { tableCardTransform } from "./card-style.ts";
import { fieldTypeLabel, getTableHeight } from "./layout.ts";

/** Etiqueta corta para el nivel de detalle compacto: tipo + claves. */
function shortFieldMeta(field: Field): string {
  const flags = [field.isPrimary ? "PK" : "", field.isUnique && !field.isPrimary ? "UQ" : ""].filter(Boolean);
  return [field.type, ...flags].join(" · ");
}

/**
 * Tipo + restricciones como insignias. Mismo contenido que getFieldMetaLabel (que se usa para
 * estimar el ancho), pero con marcado para poder distinguir de un vistazo PK, UQ, AI, IDX y DEF.
 */
function fieldMetaMarkup(field: Field): string {
  const badges = [
    field.isPrimary ? '<span class="field-flag flag-pk">PK</span>' : "",
    field.isUnique && !field.isPrimary ? '<span class="field-flag flag-uq">UQ</span>' : "",
    field.autoIncrement ? '<span class="field-flag flag-ai">AI</span>' : "",
    field.isIndexed && !field.isPrimary && !field.isUnique ? '<span class="field-flag flag-idx">IDX</span>' : "",
  ].join("");
  const defaultValue = field.defaultValue
    ? `<span class="field-default" title="DEFAULT ${field.defaultValue}">= ${field.defaultValue.length > 14 ? `${field.defaultValue.slice(0, 14)}…` : field.defaultValue}</span>`
    : "";
  const nullable = field.nullable ? '<span class="field-nullable" title="Permite NULL">?</span>' : "";
  return `${defaultValue}<span class="field-type">${fieldTypeLabel(field)}${nullable}</span>${badges}`;
}

/**
 * Botón de las tarjetas con icono por máscara CSS (no SVG): hay muchas tarjetas y html2canvas
 * tendría que cargar cada SVG como imagen. Al exportar PNG se quitan del clon.
 */
function cardButton(action: string, iconName: string, label: string, data: string, extra = ""): string {
  return `<button type="button" class="card-btn${extra ? ` ${extra}` : ""}" data-action="${action}" ${data} title="${label}" aria-label="${label}"><span class="card-icon card-icon-${iconName}" aria-hidden="true"></span></button>`;
}

export function buildTableMarkup(tables: Table[]): string {
  return tables
    .map((table) => {
      const fields = table.fields
        .map((field: Field, fieldIndex: number) => {
          const data = `data-table-id="${table.id}" data-field-id="${field.id}"`;
          return `
            <li class="${field.isPrimary ? "is-pk" : ""}">
              <div class="field-left">
                <span class="field-key" aria-hidden="true"></span>
                <span class="field-name" title="${field.name}" style="--len:${field.name.length}">${field.name}</span>
              </div>
              <div class="field-right">
                <small class="field-meta">${fieldMetaMarkup(field)}</small>
                <small class="field-meta-short">${shortFieldMeta(field)}</small>
                <div class="field-actions">
                  ${cardButton("move-field-up", "up", "Subir campo", `${data} ${fieldIndex === 0 ? "disabled" : ""}`, "field-order-btn")}
                  ${cardButton("move-field-down", "down", "Bajar campo", `${data} ${fieldIndex === table.fields.length - 1 ? "disabled" : ""}`, "field-order-btn")}
                  ${cardButton("edit-field", "pencil", "Editar campo", data, "table-action-btn")}
                  ${cardButton("delete-field", "trash", "Eliminar campo", data, "table-action-btn is-danger")}
                </div>
              </div>
            </li>
          `;
        })
        .join("");
      const fieldCount = `${table.fields.length} campo${table.fields.length === 1 ? "" : "s"}`;
      const tableData = `data-table-id="${table.id}"`;
      return `
        <article class="table-card" data-table-id="${table.id}" style="transform:${tableCardTransform(table.x, table.y)};height:${getTableHeight(table)}px">
          <div class="table-card-header">
            <div class="table-card-title">
              <h3 title="${table.name}" style="--len:${table.name.length}">${table.name}</h3>
              <span class="table-card-count">${fieldCount}</span>
            </div>
            <div class="table-actions">
              ${cardButton("rename-table", "pencil", "Editar tabla", tableData, "table-action-btn")}
              ${cardButton("delete-table", "trash", "Eliminar tabla", tableData, "table-action-btn is-danger")}
            </div>
          </div>
          <ul>${fields}</ul>
        </article>
      `;
    })
    .join("");
}
