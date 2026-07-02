import { isAutoIncrementType, isIntegerLikeType, normalizeDataType } from "../../lib/data-types.ts";
import { parseEnumValuesInput, normalizeField } from "../../domain/field.ts";
import type { Store } from "../../state/store.ts";
import { getTableById, safeName } from "../../state/store.ts";
import type { SelectControllers } from "../selects.ts";

export function wireFieldEditModal(store: Store, selects: SelectControllers): {
  openFieldEditModal: (tableId: string, fieldId: string) => void;
} {
  const fieldEditModal = document.querySelector<HTMLDivElement>("#field-edit-modal");
  const fieldEditForm = document.querySelector<HTMLFormElement>("#field-edit-form");
  const fieldEditClose = document.querySelector<HTMLButtonElement>("#field-edit-close");
  const fieldEditTableId = document.querySelector<HTMLInputElement>("#field-edit-table-id");
  const fieldEditFieldId = document.querySelector<HTMLInputElement>("#field-edit-field-id");
  const fieldEditName = document.querySelector<HTMLInputElement>("#field-edit-name");
  const fieldEditNullable = document.querySelector<HTMLInputElement>("#field-edit-nullable");
  const fieldEditPrimary = document.querySelector<HTMLInputElement>("#field-edit-primary");
  const fieldEditUnique = document.querySelector<HTMLInputElement>("#field-edit-unique");
  const fieldEditAutoinc = document.querySelector<HTMLInputElement>("#field-edit-autoinc");
  const fieldEditIndexed = document.querySelector<HTMLInputElement>("#field-edit-indexed");
  const fieldEditEnumValuesLabel = document.querySelector<HTMLLabelElement>("#field-edit-enum-values-label");
  const fieldEditEnumValuesTextarea = document.querySelector<HTMLTextAreaElement>("#field-edit-enum-values");

  if (
    !fieldEditModal ||
    !fieldEditForm ||
    !fieldEditClose ||
    !fieldEditTableId ||
    !fieldEditFieldId ||
    !fieldEditName ||
    !fieldEditNullable ||
    !fieldEditPrimary ||
    !fieldEditUnique ||
    !fieldEditAutoinc ||
    !fieldEditIndexed ||
    !fieldEditEnumValuesLabel ||
    !fieldEditEnumValuesTextarea
  ) {
    throw new Error("No se encontraron elementos del modal de edicion de campo");
  }

  const modal = fieldEditModal;
  const form = fieldEditForm;
  const tableIdInput = fieldEditTableId;
  const fieldIdInput = fieldEditFieldId;
  const nameInput = fieldEditName;
  const nullableInput = fieldEditNullable;
  const primaryInput = fieldEditPrimary;
  const uniqueInput = fieldEditUnique;
  const autoincInput = fieldEditAutoinc;
  const indexedInput = fieldEditIndexed;
  const enumLabel = fieldEditEnumValuesLabel;
  const enumTextarea = fieldEditEnumValuesTextarea;

  function syncFieldEditEnumRowVisibility() {
    const isEnum = selects.fieldEditTypeSelect.getValue() === "enum";
    enumLabel.hidden = !isEnum;
    enumTextarea.hidden = !isEnum;
  }

  function openFieldEditModal(tableId: string, fieldId: string) {
    const state = store.getState();
    const table = getTableById(state, tableId);
    const field = table?.fields.find((item) => item.id === fieldId);
    if (!table || !field) return;
    tableIdInput.value = tableId;
    fieldIdInput.value = fieldId;
    nameInput.value = field.name;
    selects.fieldEditTypeSelect.setValue(field.type);
    nullableInput.checked = field.nullable;
    primaryInput.checked = field.isPrimary;
    uniqueInput.checked = field.isUnique;
    autoincInput.checked = field.autoIncrement;
    indexedInput.checked = field.isIndexed;
    enumTextarea.value = field.enumValues?.length ? field.enumValues.join(", ") : "";
    syncFieldEditEnumRowVisibility();
    modal.classList.remove("hidden");
  }

  selects.fieldEditTypeSelect.onChange(() => {
    const selectedType = normalizeDataType(selects.fieldEditTypeSelect.getValue());
    if (isAutoIncrementType(selectedType)) {
      autoincInput.checked = true;
      primaryInput.checked = true;
      uniqueInput.checked = true;
      nullableInput.checked = false;
    }
    if (selectedType === "enum") {
      autoincInput.checked = false;
    }
    syncFieldEditEnumRowVisibility();
  });

  autoincInput.addEventListener("change", () => {
    const currentType = normalizeDataType(selects.fieldEditTypeSelect.getValue());
    if (autoincInput.checked && !isIntegerLikeType(currentType)) {
      selects.fieldEditTypeSelect.setValue("integer");
    }
    if (autoincInput.checked) {
      nullableInput.checked = false;
    }
    syncFieldEditEnumRowVisibility();
  });

  primaryInput.addEventListener("change", () => {
    if (primaryInput.checked) {
      uniqueInput.checked = true;
      nullableInput.checked = false;
    }
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const tableId = tableIdInput.value;
    const fieldId = fieldIdInput.value;
    const state = store.getState();
    const table = getTableById(state, tableId);
    const field = table?.fields.find((item) => item.id === fieldId);
    if (!table || !field) return;

    const newName = safeName(nameInput.value);
    if (!newName) return;

    const updates = normalizeField({
      ...field,
      name: newName,
      type: normalizeDataType(selects.fieldEditTypeSelect.getValue()),
      nullable: nullableInput.checked,
      isPrimary: primaryInput.checked,
      isUnique: uniqueInput.checked,
      autoIncrement: autoincInput.checked,
      isIndexed: indexedInput.checked,
      enumValues:
        normalizeDataType(selects.fieldEditTypeSelect.getValue()) === "enum"
          ? parseEnumValuesInput(enumTextarea.value)
          : undefined,
    });

    store.dispatch({ type: "UPDATE_FIELD", tableId, fieldId, updates });
    modal.classList.add("hidden");
  });

  fieldEditClose.addEventListener("click", () => modal.classList.add("hidden"));

  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      modal.classList.add("hidden");
    }
  });

  return { openFieldEditModal };
}
