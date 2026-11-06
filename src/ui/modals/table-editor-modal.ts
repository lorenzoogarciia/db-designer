import type { DiagramController } from "../../diagram/diagram-controller.ts";
import { estimateTableWidth, getTableHeight, placeNearRelated } from "../../diagram/layout.ts";
import { safeName } from "../../domain/ids.ts";
import { FK_REFERENTIAL_ACTIONS } from "../../domain/relation.ts";
import {
  applyReferenceType,
  buildTableFromDraft,
  createEmptyFieldDraft,
  createTableDraft,
  draftFromTable,
  draftKey,
  lostIncomingRelations,
  relatedTableIds,
  suggestReference,
  validateTableDraft,
  type FieldDraft,
  type TableDraft,
} from "../../domain/table-draft.ts";
import type { FkReferentialAction, Relation, Table } from "../../domain/types.ts";
import { DATA_TYPE_OPTIONS, isAutoIncrementType } from "../../lib/data-types.ts";
import type { Store } from "../../state/store.ts";
import { showToast } from "../toast.ts";

export interface TableCreateOptions {
  /** Nombre inicial (p. ej. escrito en el panel lateral). */
  name?: string;
  /** Punto del mundo donde colocar la tabla si no tiene relaciones (p. ej. doble clic en el canvas). */
  at?: { x: number; y: number };
}

type Attrs = Record<string, string | boolean | undefined>;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, children: Array<Node | string> = []) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key === "class") element.className = String(value);
    else if (key === "text") element.textContent = String(value);
    else element.setAttribute(key, value === true ? "" : String(value));
  }
  element.append(...children);
  return element;
}

function buildTypeSelect(): HTMLSelectElement {
  const select = el("select", { class: "tc-type", "aria-label": "Tipo" });
  const groups = new Map<string, HTMLOptGroupElement>();
  for (const option of DATA_TYPE_OPTIONS) {
    let group = groups.get(option.group);
    if (!group) {
      group = el("optgroup", { label: option.group });
      groups.set(option.group, group);
      select.append(group);
    }
    group.append(el("option", { value: option.value, text: option.label }));
  }
  return select;
}

function buildActionSelect(label: string): HTMLSelectElement {
  const select = el("select", { class: "tc-action", "aria-label": label });
  FK_REFERENTIAL_ACTIONS.forEach((action) => select.append(el("option", { value: action, text: action })));
  return select;
}

/** Opciones "tabla.campo" agrupadas por tabla, con la clave primaria primero. */
function buildReferenceSelect(tables: Table[]): HTMLSelectElement {
  const select = el("select", { class: "tc-reference", "aria-label": "Referencia (clave foránea)" });
  select.append(el("option", { value: "", text: "— Sin referencia —" }));
  [...tables]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
    .forEach((table) => {
      const group = el("optgroup", { label: table.name });
      [...table.fields]
        .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
        .forEach((field) => {
          const flags = field.isPrimary ? " · PK" : field.isUnique ? " · UQ" : "";
          group.append(el("option", { value: `${table.id}|${field.id}`, text: `${table.name}.${field.name}${flags}` }));
        });
      select.append(group);
    });
  return select;
}

interface RowControls {
  row: HTMLElement;
  name: HTMLInputElement;
  type: HTMLSelectElement;
  nullable: HTMLInputElement;
  primary: HTMLInputElement;
  unique: HTMLInputElement;
  indexed: HTMLInputElement;
  defaultValue: HTMLInputElement;
  reference: HTMLSelectElement;
  enumRow: HTMLElement;
  enumValues: HTMLInputElement;
  referenceRow: HTMLElement;
  referenceKind: HTMLSelectElement;
  referenceOnDelete: HTMLSelectElement;
  referenceHint: HTMLElement;
}

export function wireTableEditorModal(
  store: Store,
  diagram: DiagramController,
): {
  openTableCreator: (options?: TableCreateOptions) => void;
  openTableEditor: (tableId: string) => void;
} {
  const modal = el("div", { id: "table-create-modal", class: "modal hidden", role: "dialog", "aria-modal": "true", "aria-labelledby": "table-create-title" });
  document.body.append(modal);

  let draft: TableDraft = createTableDraft();
  let tables: Table[] = [];
  let options: TableCreateOptions = {};
  const rows = new Map<string, RowControls>();
  let fieldsContainer: HTMLElement;
  let manyContainer: HTMLElement;
  let messages: HTMLElement;
  let nameInput: HTMLInputElement;
  let namePreview: HTMLElement;
  /** "create": tabla nueva; "edit": tabla existente (se conservan ids y posicion). */
  let mode: "create" | "edit" = "create";
  let relationsSnapshot: Relation[] = [];
  const removedIncoming = new Set<string>();
  let incomingContainer: HTMLElement | null = null;

  const tableById = (id: string) => tables.find((table) => table.id === id);

  function close() {
    modal.classList.add("hidden");
    modal.replaceChildren();
    rows.clear();
  }

  /* -------------------------- filas de campos -------------------------- */

  function syncRow(field: FieldDraft) {
    const controls = rows.get(field.key);
    if (!controls) return;
    const autoType = isAutoIncrementType(field.type);
    controls.type.value = field.type;
    controls.nullable.checked = field.nullable && !field.isPrimary && !autoType;
    controls.nullable.disabled = field.isPrimary || autoType;
    controls.primary.checked = field.isPrimary;
    controls.unique.checked = field.isUnique || field.isPrimary;
    controls.unique.disabled = field.isPrimary;
    controls.indexed.checked = field.isIndexed || field.isUnique || field.isPrimary || Boolean(field.reference);
    controls.indexed.disabled = field.isPrimary || field.isUnique || Boolean(field.reference);
    controls.defaultValue.disabled = autoType;
    controls.defaultValue.placeholder = autoType ? "auto" : "—";
    controls.reference.value = field.reference ? `${field.reference.tableId}|${field.reference.fieldId}` : "";
    controls.enumRow.hidden = field.type !== "enum";
    controls.referenceRow.hidden = !field.reference;
    controls.row.classList.toggle("has-reference", Boolean(field.reference));
    if (field.reference) {
      controls.referenceKind.value = field.reference.kind;
      controls.referenceOnDelete.value = field.reference.onDelete;
      const target = tableById(field.reference.tableId);
      const targetField = target?.fields.find((item) => item.id === field.reference?.fieldId);
      controls.referenceHint.textContent = `→ ${target?.name ?? "?"}.${targetField?.name ?? "?"}${field.referenceTouched ? "" : " (detectada por el nombre)"}`;
    }
  }

  function updateField(key: string, updater: (field: FieldDraft) => FieldDraft) {
    draft.fields = draft.fields.map((field) => (field.key === key ? updater(field) : field));
    const updated = draft.fields.find((field) => field.key === key);
    if (updated) syncRow(updated);
  }

  function setReference(key: string, value: string, touched: boolean) {
    updateField(key, (field) => {
      if (!value) return { ...field, reference: null, referenceTouched: touched || field.referenceTouched };
      const [tableId, fieldId] = value.split("|");
      // Al enlazar un campo por primera vez se vuelve obligatorio (lo habitual en una FK); se puede desmarcar.
      const nullable = field.reference ? field.nullable : false;
      const reference = {
        tableId,
        fieldId,
        kind: field.reference?.kind ?? "1:N",
        onDelete: field.reference?.onDelete ?? ("NO ACTION" as FkReferentialAction),
        onUpdate: field.reference?.onUpdate ?? ("NO ACTION" as FkReferentialAction),
        source: field.reference?.source,
      };
      return applyReferenceType({ ...field, nullable, reference, referenceTouched: touched || field.referenceTouched }, tables);
    });
  }

  function focusRow(key: string) {
    rows.get(key)?.name.focus();
  }

  function addField(afterKey?: string): FieldDraft {
    const field = createEmptyFieldDraft();
    const index = afterKey ? draft.fields.findIndex((item) => item.key === afterKey) : -1;
    if (index >= 0) draft.fields.splice(index + 1, 0, field);
    else draft.fields.push(field);
    const row = buildRow(field);
    const anchor = afterKey ? rows.get(afterKey)?.row : undefined;
    if (anchor) anchor.after(row);
    else fieldsContainer.append(row);
    syncRow(field);
    return field;
  }

  function removeField(key: string) {
    draft.fields = draft.fields.filter((field) => field.key !== key);
    rows.get(key)?.row.remove();
    rows.delete(key);
    renderIncoming();
  }

  function moveField(key: string, direction: -1 | 1) {
    const index = draft.fields.findIndex((field) => field.key === key);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= draft.fields.length) return;
    const fields = [...draft.fields];
    [fields[index], fields[target]] = [fields[target], fields[index]];
    draft.fields = fields;
    const row = rows.get(key)?.row;
    const other = rows.get(fields[index].key)?.row;
    if (row && other) {
      if (direction < 0) other.before(row);
      else other.after(row);
    }
    rows.get(key)?.name.focus();
  }

  /* ------------------- relaciones entrantes (edicion) ------------------- */

  function renderIncoming() {
    if (!incomingContainer || mode !== "edit" || !draft.tableId) return;
    const tableId = draft.tableId;
    const incoming = relationsSnapshot.filter((relation) => relation.toTableId === tableId && relation.fromTableId !== tableId);
    const lost = new Set(lostIncomingRelations(draft, relationsSnapshot).map((relation) => relation.id));
    if (incoming.length === 0) {
      incomingContainer.replaceChildren(el("p", { class: "tc-hint", text: "Ninguna otra tabla apunta a esta." }));
      return;
    }
    incomingContainer.replaceChildren(
      ...incoming.map((relation) => {
        const from = tableById(relation.fromTableId);
        const fromField = from?.fields.find((field) => field.id === relation.fromFieldId);
        const targetDraft = draft.fields.find((field) => field.sourceFieldId === relation.toFieldId);
        const removed = removedIncoming.has(relation.id);
        const status = removed ? "se quitará al guardar" : lost.has(relation.id) ? "se perderá: el campo al que apunta ya no existe" : "";
        const toggle = el("button", {
          type: "button",
          class: removed ? "neutral-btn tc-incoming-btn" : "danger-btn tc-incoming-btn",
          text: removed ? "Deshacer" : "Quitar",
        });
        toggle.addEventListener("click", () => {
          if (removedIncoming.has(relation.id)) removedIncoming.delete(relation.id);
          else removedIncoming.add(relation.id);
          renderIncoming();
        });
        const kindKey = relation.kind === "1:1" ? "11" : relation.kind === "N:M" ? "nm" : "1n";
        return el("div", { class: `tc-incoming rel-color-${kindKey}${removed || lost.has(relation.id) ? " is-lost" : ""}` }, [
          el("span", { class: "tc-incoming-kind", text: relation.kind }),
          el("span", {
            class: "tc-incoming-text",
            text: `${from?.name ?? "?"}.${fromField?.name ?? "?"} → ${safeName(targetDraft?.name ?? "") || "?"}`,
          }),
          el("span", { class: "tc-incoming-status", text: status }),
          toggle,
        ]);
      }),
    );
  }

  function buildRow(field: FieldDraft): HTMLElement {
    const name = el("input", { class: "tc-name", placeholder: "nombre_campo", "aria-label": "Nombre del campo", value: field.name, spellcheck: "false" });
    const type = buildTypeSelect();
    const check = (label: string, title: string) => {
      const input = el("input", { type: "checkbox", "aria-label": title });
      return { input, wrapper: el("label", { class: "tc-check", title }, [input, el("span", { text: label })]) };
    };
    const nullable = check("NULL", "Permite NULL");
    const primary = check("PK", "Clave primaria");
    const unique = check("UQ", "UNIQUE");
    const indexed = check("IDX", "Índice");
    const defaultValue = el("input", { class: "tc-default", "aria-label": "Valor por defecto", value: field.defaultValue, spellcheck: "false" });
    const reference = buildReferenceSelect(tables);
    const remove = el("button", { type: "button", class: "danger-btn tc-remove", title: "Quitar campo", "aria-label": "Quitar campo", text: "✕" });
    const moveUp = el("button", { type: "button", class: "neutral-btn tc-move", title: "Subir campo", "aria-label": "Subir campo", text: "↑" });
    const moveDown = el("button", { type: "button", class: "neutral-btn tc-move", title: "Bajar campo", "aria-label": "Bajar campo", text: "↓" });

    const enumValues = el("input", { class: "tc-enum", placeholder: "Valores del enum separados por comas: activo, inactivo", value: field.enumValues, spellcheck: "false" });
    const enumRow = el("div", { class: "tc-subrow" }, [el("span", { class: "tc-subrow-label", text: "Valores" }), enumValues]);

    const referenceKind = el("select", { class: "tc-kind", "aria-label": "Tipo de relación" });
    referenceKind.append(
      el("option", { value: "1:N", text: "Muchos a uno (1:N)" }),
      el("option", { value: "1:1", text: "Uno a uno (1:1)" }),
    );
    const referenceOnDelete = buildActionSelect("ON DELETE");
    const referenceHint = el("span", { class: "tc-reference-hint" });
    const referenceRow = el("div", { class: "tc-subrow tc-reference-row" }, [
      el("span", { class: "tc-subrow-label", text: "Relación" }),
      referenceHint,
      referenceKind,
      el("span", { class: "tc-subrow-label", text: "ON DELETE" }),
      referenceOnDelete,
    ]);

    const row = el("div", { class: "tc-field" }, [
      el("div", { class: "tc-field-main" }, [
        el("div", { class: "tc-moves" }, [moveUp, moveDown]),
        name,
        type,
        el("div", { class: "tc-checks" }, [nullable.wrapper, primary.wrapper, unique.wrapper, indexed.wrapper]),
        defaultValue,
        reference,
        remove,
      ]),
      enumRow,
      referenceRow,
    ]);

    const key = field.key;
    rows.set(key, {
      row,
      name,
      type,
      nullable: nullable.input,
      primary: primary.input,
      unique: unique.input,
      indexed: indexed.input,
      defaultValue,
      reference,
      enumRow,
      enumValues,
      referenceRow,
      referenceKind,
      referenceOnDelete,
      referenceHint,
    });

    name.addEventListener("input", () => {
      const value = name.value;
      draft.fields = draft.fields.map((item) => (item.key === key ? { ...item, name: value } : item));
      if (mode === "edit") renderIncoming();
      const current = draft.fields.find((item) => item.key === key);
      if (!current || current.referenceTouched) return;
      // Referencia automatica por el nombre (cliente_id -> clientes.id) mientras no se toque a mano.
      const suggestion = suggestReference(value, tables);
      const currentValue = current.reference ? `${current.reference.tableId}|${current.reference.fieldId}` : "";
      const nextValue = suggestion ? `${suggestion.tableId}|${suggestion.fieldId}` : "";
      if (nextValue !== currentValue) {
        if (nextValue) setReference(key, nextValue, false);
        else updateField(key, (item) => ({ ...item, reference: null, type: item.reference ? "varchar" : item.type }));
      }
    });
    name.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      const index = draft.fields.findIndex((item) => item.key === key);
      const next = draft.fields[index + 1];
      if (next) focusRow(next.key);
      else focusRow(addField(key).key);
    });
    type.addEventListener("change", () =>
      updateField(key, (item) => {
        const value = type.value;
        if (isAutoIncrementType(value)) {
          draft.fields = draft.fields.map((other) => (other.key === key ? other : { ...other, isPrimary: false }));
          draft.fields.forEach((other) => other.key !== key && syncRow(other));
          return { ...item, type: value, isPrimary: true, autoIncrement: true, nullable: false, defaultValue: "", reference: null };
        }
        return { ...item, type: value, autoIncrement: false };
      }),
    );
    nullable.input.addEventListener("change", () => updateField(key, (item) => ({ ...item, nullable: nullable.input.checked })));
    primary.input.addEventListener("change", () => {
      const checked = primary.input.checked;
      if (checked) {
        // Una sola clave primaria.
        draft.fields = draft.fields.map((other) => (other.key === key ? other : { ...other, isPrimary: false }));
        draft.fields.forEach((other) => other.key !== key && syncRow(other));
      }
      updateField(key, (item) => ({ ...item, isPrimary: checked, nullable: checked ? false : item.nullable }));
    });
    unique.input.addEventListener("change", () => updateField(key, (item) => ({ ...item, isUnique: unique.input.checked })));
    indexed.input.addEventListener("change", () => updateField(key, (item) => ({ ...item, isIndexed: indexed.input.checked })));
    defaultValue.addEventListener("input", () => {
      draft.fields = draft.fields.map((item) => (item.key === key ? { ...item, defaultValue: defaultValue.value } : item));
    });
    enumValues.addEventListener("input", () => {
      draft.fields = draft.fields.map((item) => (item.key === key ? { ...item, enumValues: enumValues.value } : item));
    });
    reference.addEventListener("change", () => setReference(key, reference.value, true));
    referenceKind.addEventListener("change", () =>
      updateField(key, (item) =>
        item.reference
          ? applyReferenceType({ ...item, reference: { ...item.reference, kind: referenceKind.value as "1:N" | "1:1" } }, tables)
          : item,
      ),
    );
    referenceOnDelete.addEventListener("change", () =>
      updateField(key, (item) =>
        item.reference
          ? {
              ...item,
              reference: { ...item.reference, onDelete: referenceOnDelete.value as FkReferentialAction },
              nullable: referenceOnDelete.value === "SET NULL" ? true : item.nullable,
            }
          : item,
      ),
    );
    remove.addEventListener("click", () => removeField(key));
    moveUp.addEventListener("click", () => moveField(key, -1));
    moveDown.addEventListener("click", () => moveField(key, 1));
    return row;
  }

  /* -------------------------- relaciones N:M --------------------------- */

  function addManyToMany() {
    const item = { key: draftKey(), tableId: "", onDelete: "CASCADE" as FkReferentialAction };
    draft.manyToMany.push(item);
    const tableSelect = el("select", { class: "tc-nm-table", "aria-label": "Tabla relacionada" });
    tableSelect.append(el("option", { value: "", text: "Elige una tabla…" }));
    [...tables]
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
      .forEach((table) => tableSelect.append(el("option", { value: table.id, text: table.name })));
    const onDelete = buildActionSelect("ON DELETE");
    onDelete.value = "CASCADE";
    const hint = el("span", { class: "tc-reference-hint" });
    const remove = el("button", { type: "button", class: "danger-btn tc-remove", title: "Quitar", "aria-label": "Quitar relación", text: "✕" });
    const row = el("div", { class: "tc-nm-row" }, [
      el("span", { class: "tc-subrow-label", text: "Con" }),
      tableSelect,
      hint,
      el("span", { class: "tc-subrow-label", text: "ON DELETE" }),
      onDelete,
      remove,
    ]);
    const update = () => {
      item.tableId = tableSelect.value;
      item.onDelete = onDelete.value as FkReferentialAction;
      const target = tableById(item.tableId);
      const ownName = safeName(nameInput.value) || "nueva_tabla";
      hint.textContent = target ? `crea la tabla intermedia ${ownName}_${target.name}` : "";
    };
    tableSelect.addEventListener("change", update);
    onDelete.addEventListener("change", update);
    remove.addEventListener("click", () => {
      draft.manyToMany = draft.manyToMany.filter((other) => other.key !== item.key);
      row.remove();
    });
    manyContainer.append(row);
    tableSelect.focus();
  }

  /* ------------------------------ guardar ------------------------------ */

  function showMessages(errors: string[], warnings: string[]) {
    messages.replaceChildren(
      ...errors.map((text) => el("p", { class: "tc-error", text })),
      ...warnings.map((text) => el("p", { class: "tc-warning", text })),
    );
  }

  function submitEdit() {
    const tableId = draft.tableId;
    if (!tableId) return;
    const lost = lostIncomingRelations(draft, relationsSnapshot).filter((relation) => !removedIncoming.has(relation.id));
    if (lost.length > 0) {
      const names = lost
        .map((relation) => {
          const from = tableById(relation.fromTableId);
          return `${from?.name ?? "?"}.${from?.fields.find((field) => field.id === relation.fromFieldId)?.name ?? "?"}`;
        })
        .join(", ");
      const ok = window.confirm(`Se eliminarán ${lost.length} relación(es) que apuntan a campos borrados: ${names}. ¿Continuar?`);
      if (!ok) return;
    }
    const built = buildTableFromDraft(draft, tables, tableId);
    store.dispatch({ type: "UPDATE_TABLE", ...built, removeRelationIds: [...removedIncoming] });
    close();
    diagram.revealTable(tableId);
    showToast(`Tabla "${built.table.name}" actualizada.`, "success");
  }

  function deleteTable() {
    const tableId = draft.tableId;
    const table = tableId ? tableById(tableId) : undefined;
    if (!tableId || !table) return;
    const relationCount = relationsSnapshot.filter((relation) => relation.fromTableId === tableId || relation.toTableId === tableId).length;
    const ok = window.confirm(
      `¿Eliminar la tabla "${table.name}"${relationCount > 0 ? ` y sus ${relationCount} relación(es)` : ""}? No se puede deshacer.`,
    );
    if (!ok) return;
    store.dispatch({ type: "REMOVE_TABLE", tableId });
    close();
    showToast(`Tabla "${table.name}" eliminada.`, "success");
  }

  function submit() {
    draft.name = nameInput.value;
    const { errors, warnings } = validateTableDraft(draft, tables);
    if (errors.length > 0) {
      showMessages(errors, warnings);
      return;
    }
    if (mode === "edit") {
      submitEdit();
      return;
    }
    const built = buildTableFromDraft(draft, tables);
    const width = estimateTableWidth(built.table);
    const height = getTableHeight(built.table);
    const box = (table: Table) => ({ x: table.x, y: table.y, width: diagram.getTableWidth(table), height: getTableHeight(table) });
    const related = relatedTableIds(draft)
      .map((id) => tableById(id))
      .filter((table): table is Table => Boolean(table))
      .map(box);
    const fallback = options.at ?? diagram.getViewportCenterWorld();
    const position = placeNearRelated(tables.map(box), width, height, related, fallback);
    built.table.x = position.x;
    built.table.y = position.y;

    store.dispatch({ type: "CREATE_TABLE", ...built });
    close();
    diagram.focusTable(built.table.id);

    const relationCount = built.relations.length + built.manyToMany.length;
    showToast(
      `Tabla "${built.table.name}" creada con ${built.table.fields.length} campo(s)` +
        (relationCount > 0 ? ` y ${relationCount} relación(es).` : "."),
      "success",
    );
  }

  /* ------------------------------- abrir ------------------------------- */

  function render() {
    const editing = mode === "edit";
    const title = el("h3", { id: "table-create-title", text: editing ? `Editar tabla: ${draft.name}` : "Nueva tabla" });
    const closeButton = el("button", { type: "button", class: "neutral-btn", text: "Cerrar" });
    closeButton.addEventListener("click", close);

    nameInput = el("input", { id: "table-create-name", class: "tc-table-name", placeholder: "nombre_de_la_tabla", value: draft.name, spellcheck: "false", autocomplete: "off" });
    namePreview = el("span", { class: "tc-name-preview" });
    const syncNamePreview = () => {
      const normalized = safeName(nameInput.value);
      const exists =
        normalized &&
        tables.some((table) => table.id !== draft.tableId && table.name.toLowerCase() === normalized.toLowerCase());
      namePreview.textContent = exists
        ? `Ya existe una tabla "${normalized}"`
        : normalized && normalized !== nameInput.value
          ? `Se guardará como "${normalized}"`
          : "";
      namePreview.classList.toggle("is-error", Boolean(exists));
    };
    nameInput.addEventListener("input", syncNamePreview);
    nameInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        const firstEmpty = draft.fields.find((field) => !field.name.trim());
        focusRow((firstEmpty ?? addField()).key);
      }
    });

    fieldsContainer = el("div", { class: "tc-fields" });
    const header = el("div", { class: "tc-field-head", "aria-hidden": "true" }, [
      el("span"),
      el("span", { text: "Campo" }),
      el("span", { text: "Tipo" }),
      el("span", { text: "Opciones" }),
      el("span", { text: "Por defecto" }),
      el("span", { text: "Referencia (FK)" }),
      el("span"),
    ]);
    const addFieldButton = el("button", { type: "button", class: "neutral-btn tc-add", text: "+ Añadir campo" });
    addFieldButton.addEventListener("click", () => focusRow(addField().key));

    manyContainer = el("div", { class: "tc-nm" });
    const addManyButton = el("button", { type: "button", class: "neutral-btn tc-add", text: "+ Relación muchos a muchos" });
    addManyButton.addEventListener("click", addManyToMany);
    if (tables.length === 0) addManyButton.disabled = true;

    messages = el("div", { class: "tc-messages", "aria-live": "polite" });
    const cancel = el("button", { type: "button", class: "neutral-btn", text: "Cancelar" });
    cancel.addEventListener("click", close);
    const create = el("button", { type: "button", class: "tc-submit", text: editing ? "Guardar cambios" : "Crear tabla" });
    create.append(el("kbd", { text: "Ctrl+Enter" }));
    create.addEventListener("click", submit);

    const card = el("div", { class: "modal-card table-create-card" }, [
      el("div", { class: "modal-header" }, [title, closeButton]),
      el("div", { class: "tc-body" }, [
        el("label", { class: "tc-section-label", for: "table-create-name", text: "Nombre de la tabla" }),
        el("div", { class: "tc-name-row" }, [nameInput, namePreview]),
        el("div", { class: "tc-section-head" }, [
          el("h4", { text: "Campos y relaciones" }),
          el("p", {
            class: "tc-hint",
            text: "Enter pasa al siguiente campo. Un campo como cliente_id o id_cliente se enlaza solo con la tabla clientes; también puedes elegir la referencia a mano.",
          }),
        ]),
        header,
        fieldsContainer,
        addFieldButton,
        el("div", { class: "tc-section-head" }, [
          el("h4", { text: "Muchos a muchos" }),
          el("p", { class: "tc-hint", text: "Crea automáticamente la tabla intermedia con las dos claves foráneas." }),
        ]),
        manyContainer,
        addManyButton,
        ...(editing
          ? [
              el("div", { class: "tc-section-head" }, [
                el("h4", { text: "Referenciada por" }),
                el("p", { class: "tc-hint", text: "Relaciones de otras tablas hacia esta. Se mantienen al renombrar o reordenar campos." }),
              ]),
              (incomingContainer = el("div", { class: "tc-incoming-list" })),
            ]
          : []),
        messages,
      ]),
      el(
        "div",
        { class: "modal-actions tc-actions" },
        editing ? [deleteButton(), el("span", { class: "tc-actions-spacer" }), cancel, create] : [cancel, create],
      ),
    ]);
    modal.replaceChildren(card);
    draft.fields.forEach((field) => {
      fieldsContainer.append(buildRow(field));
      syncRow(field);
    });
    syncNamePreview();
    renderIncoming();
  }

  function deleteButton(): HTMLButtonElement {
    const button = el("button", { type: "button", class: "danger-btn tc-delete-table", text: "Eliminar tabla" });
    button.addEventListener("click", deleteTable);
    return button;
  }

  modal.addEventListener("mousedown", (event) => {
    if (event.target === modal) close();
  });
  modal.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  });

  function openTableCreator(openOptions: TableCreateOptions = {}) {
    mode = "create";
    options = openOptions;
    tables = store.getState().tables;
    relationsSnapshot = store.getState().relations;
    removedIncoming.clear();
    incomingContainer = null;
    draft = createTableDraft(openOptions.name ?? "");
    render();
    modal.classList.remove("hidden");
    nameInput.focus();
    nameInput.select();
  }

  function openTableEditor(tableId: string) {
    const state = store.getState();
    const table = state.tables.find((item) => item.id === tableId);
    if (!table) return;
    mode = "edit";
    options = {};
    tables = state.tables;
    relationsSnapshot = state.relations;
    removedIncoming.clear();
    incomingContainer = null;
    draft = draftFromTable(table, state.relations);
    render();
    modal.classList.remove("hidden");
    nameInput.focus();
  }

  return { openTableCreator, openTableEditor };
}
