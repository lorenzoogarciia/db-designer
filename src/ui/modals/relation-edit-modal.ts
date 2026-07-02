import { mountSearchableSelect, type SelectOption } from "../../components/searchable-select.ts";
import {
  buildRelationId,
  DEFAULT_ON_DELETE,
  DEFAULT_ON_UPDATE,
  FK_REFERENTIAL_ACTIONS,
  isFkReferentialAction,
} from "../../domain/relation.ts";
import type { FkReferentialAction, RelationKind } from "../../domain/types.ts";
import { fieldTypeLabel } from "../../diagram/layout.ts";
import type { Store } from "../../state/store.ts";
import { getFieldName, getTableById } from "../../state/store.ts";

const RELATION_KIND_OPTIONS: SelectOption[] = [
  { value: "1:1", label: "1:1 (uno a uno)" },
  { value: "1:N", label: "1:N (uno a muchos)" },
  { value: "N:M", label: "N:M (muchos a muchos)" },
];

const FK_ACTION_OPTIONS: SelectOption[] = FK_REFERENTIAL_ACTIONS.map((action) => ({
  value: action,
  label: action,
}));

export function wireRelationEditModal(store: Store): {
  openRelationEditModal: (relationId: string) => void;
} {
  const modal = document.querySelector<HTMLDivElement>("#relation-edit-modal");
  const form = document.querySelector<HTMLFormElement>("#relation-edit-form");
  const closeButton = document.querySelector<HTMLButtonElement>("#relation-edit-close");
  const deleteButton = document.querySelector<HTMLButtonElement>("#relation-edit-delete");
  const title = document.querySelector<HTMLHeadingElement>("#relation-edit-title");
  const relationIdInput = document.querySelector<HTMLInputElement>("#relation-edit-relation-id");
  const fromTableHost = document.querySelector<HTMLDivElement>("#relation-edit-from-table");
  const fromFieldHost = document.querySelector<HTMLDivElement>("#relation-edit-from-field");
  const toTableHost = document.querySelector<HTMLDivElement>("#relation-edit-to-table");
  const toFieldHost = document.querySelector<HTMLDivElement>("#relation-edit-to-field");
  const kindHost = document.querySelector<HTMLDivElement>("#relation-edit-kind");
  const onDeleteHost = document.querySelector<HTMLDivElement>("#relation-edit-on-delete");
  const onUpdateHost = document.querySelector<HTMLDivElement>("#relation-edit-on-update");

  if (
    !modal ||
    !form ||
    !closeButton ||
    !deleteButton ||
    !title ||
    !relationIdInput ||
    !fromTableHost ||
    !fromFieldHost ||
    !toTableHost ||
    !toFieldHost ||
    !kindHost ||
    !onDeleteHost ||
    !onUpdateHost
  ) {
    throw new Error("No se encontraron elementos del modal de edicion de relacion");
  }

  const modalEl = modal;
  const formEl = form;
  const closeBtn = closeButton;
  const deleteBtn = deleteButton;
  const titleEl = title;
  const relationIdInputEl = relationIdInput;

  const fromTableSelect = mountSearchableSelect(fromTableHost, {
    required: true,
    placeholder: "Tabla origen...",
    searchPlaceholder: "Buscar tabla origen...",
  });
  const fromFieldSelect = mountSearchableSelect(fromFieldHost, {
    required: true,
    placeholder: "Campo origen...",
    searchPlaceholder: "Buscar campo origen...",
  });
  const toTableSelect = mountSearchableSelect(toTableHost, {
    required: true,
    placeholder: "Tabla destino...",
    searchPlaceholder: "Buscar tabla destino...",
  });
  const toFieldSelect = mountSearchableSelect(toFieldHost, {
    required: true,
    placeholder: "Campo destino...",
    searchPlaceholder: "Buscar campo destino...",
  });
  const kindSelect = mountSearchableSelect(kindHost, {
    required: true,
    placeholder: "Tipo de relacion...",
    searchPlaceholder: "Buscar tipo...",
    initialOptions: RELATION_KIND_OPTIONS,
    initialValue: "1:N",
  });
  const onDeleteSelect = mountSearchableSelect(onDeleteHost, {
    required: true,
    placeholder: "ON DELETE...",
    searchPlaceholder: "Buscar accion...",
    initialOptions: FK_ACTION_OPTIONS,
    initialValue: DEFAULT_ON_DELETE,
  });
  const onUpdateSelect = mountSearchableSelect(onUpdateHost, {
    required: true,
    placeholder: "ON UPDATE...",
    searchPlaceholder: "Buscar accion...",
    initialOptions: FK_ACTION_OPTIONS,
    initialValue: DEFAULT_ON_UPDATE,
  });

  function getFieldOptionsForTable(tableId: string): SelectOption[] {
    const state = store.getState();
    const table = getTableById(state, tableId);
    return table?.fields.map((field) => ({ value: field.id, label: `${field.name} (${fieldTypeLabel(field)})` })) ?? [];
  }

  function refreshTableOptions() {
    const tableOptions = store.getState().tables.map((table) => ({ value: table.id, label: table.name }));
    fromTableSelect.setOptions(tableOptions);
    toTableSelect.setOptions(tableOptions);
  }

  function syncFromFieldSelect(preserveValue = true) {
    const previous = preserveValue ? fromFieldSelect.getValue() : "";
    const options = getFieldOptionsForTable(fromTableSelect.getValue());
    fromFieldSelect.setOptions(options);
    if (previous && options.some((option) => option.value === previous)) {
      fromFieldSelect.setValue(previous);
    } else if (options.length > 0 && !preserveValue) {
      fromFieldSelect.setValue(options[0].value);
    }
  }

  function syncToFieldSelect(preserveValue = true) {
    const previous = preserveValue ? toFieldSelect.getValue() : "";
    const options = getFieldOptionsForTable(toTableSelect.getValue());
    toFieldSelect.setOptions(options);
    if (previous && options.some((option) => option.value === previous)) {
      toFieldSelect.setValue(previous);
    } else if (options.length > 0 && !preserveValue) {
      toFieldSelect.setValue(options[0].value);
    }
  }

  fromTableSelect.onChange(() => syncFromFieldSelect(false));
  toTableSelect.onChange(() => syncToFieldSelect(false));

  function openRelationEditModal(relationId: string) {
    const state = store.getState();
    const relation = state.relations.find((item) => item.id === relationId);
    if (!relation) return;

    const fromTableName = getTableById(state, relation.fromTableId)?.name ?? "?";
    const toTableName = getTableById(state, relation.toTableId)?.name ?? "?";
    const fromFieldName = getFieldName(state, relation.fromTableId, relation.fromFieldId);
    const toFieldName = getFieldName(state, relation.toTableId, relation.toFieldId);

    titleEl.textContent = `Editar relacion: ${fromTableName}.${fromFieldName} -> ${toTableName}.${toFieldName}`;
    relationIdInputEl.value = relationId;

    refreshTableOptions();
    fromTableSelect.setValue(relation.fromTableId);
    toTableSelect.setValue(relation.toTableId);
    syncFromFieldSelect(false);
    syncToFieldSelect(false);
    fromFieldSelect.setValue(relation.fromFieldId);
    toFieldSelect.setValue(relation.toFieldId);
    kindSelect.setValue(relation.kind);
    onDeleteSelect.setValue(relation.onDelete ?? DEFAULT_ON_DELETE);
    onUpdateSelect.setValue(relation.onUpdate ?? DEFAULT_ON_UPDATE);

    modalEl.classList.remove("hidden");
  }

  formEl.addEventListener("submit", (event) => {
    event.preventDefault();
    const editingRelationId = relationIdInputEl.value;
    if (!editingRelationId) return;

    const fromTableId = fromTableSelect.getValue();
    const toTableId = toTableSelect.getValue();
    const fromFieldId = fromFieldSelect.getValue();
    const toFieldId = toFieldSelect.getValue();
    const kind = (kindSelect.getValue() || "1:N") as RelationKind;
    const onDeleteRaw = onDeleteSelect.getValue() || DEFAULT_ON_DELETE;
    const onUpdateRaw = onUpdateSelect.getValue() || DEFAULT_ON_UPDATE;
    const onDelete: FkReferentialAction = isFkReferentialAction(onDeleteRaw) ? onDeleteRaw : DEFAULT_ON_DELETE;
    const onUpdate: FkReferentialAction = isFkReferentialAction(onUpdateRaw) ? onUpdateRaw : DEFAULT_ON_UPDATE;

    if (!fromTableId || !toTableId || !fromFieldId || !toFieldId || fromTableId === toTableId) {
      window.alert("Selecciona tablas y campos validos. Origen y destino deben ser tablas distintas.");
      return;
    }

    const newRelationId = buildRelationId(fromTableId, fromFieldId, toTableId, toFieldId);
    const state = store.getState();
    if (state.relations.some((relation) => relation.id === newRelationId && relation.id !== editingRelationId)) {
      window.alert("Ya existe una relacion con esos extremos.");
      return;
    }

    const before = state.relations;
    store.dispatch({
      type: "UPDATE_RELATION",
      relationId: editingRelationId,
      relation: {
        id: newRelationId,
        fromTableId,
        fromFieldId,
        toTableId,
        toFieldId,
        kind,
        onDelete,
        onUpdate,
      },
    });

    if (store.getState().relations === before) {
      window.alert("No se pudo actualizar la relacion.");
      return;
    }

    modalEl.classList.add("hidden");
  });

  deleteBtn.addEventListener("click", () => {
    const relationId = relationIdInputEl.value;
    if (!relationId) return;
    const state = store.getState();
    const relation = state.relations.find((item) => item.id === relationId);
    if (!relation) return;

    const fromTable = getTableById(state, relation.fromTableId)?.name ?? "?";
    const toTable = getTableById(state, relation.toTableId)?.name ?? "?";
    const fromField = getFieldName(state, relation.fromTableId, relation.fromFieldId);
    const toField = getFieldName(state, relation.toTableId, relation.toFieldId);
    const ok = window.confirm(`Eliminar la relacion ${fromTable}.${fromField} -> ${toTable}.${toField}?`);
    if (!ok) return;

    store.dispatch({ type: "REMOVE_RELATION", relationId });
    modalEl.classList.add("hidden");
  });

  closeBtn.addEventListener("click", () => modalEl.classList.add("hidden"));

  modalEl.addEventListener("click", (event) => {
    if (event.target === modalEl) {
      modalEl.classList.add("hidden");
    }
  });

  return { openRelationEditModal };
}
