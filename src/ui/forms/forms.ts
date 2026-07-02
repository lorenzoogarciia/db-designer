import { isAutoIncrementType, normalizeDataType } from "../../lib/data-types.ts";
import { normalizeField, parseEnumValuesInput } from "../../domain/field.ts";
import { generateId } from "../../domain/ids.ts";
import type { FkReferentialAction, RelationKind } from "../../domain/types.ts";
import { isFkReferentialAction } from "../../domain/relation.ts";
import type { Store } from "../../state/store.ts";
import { getTableById, safeName } from "../../state/store.ts";
import type { SelectControllers } from "../selects.ts";

export function wireTableForm(store: Store): void {
  const tableForm = document.querySelector<HTMLFormElement>("#table-form");
  if (!tableForm) throw new Error("No se encontro #table-form");

  tableForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(tableForm);
    const tableName = safeName((form.get("tableName") as string) || "");
    if (!tableName) return;
    store.dispatch({ type: "ADD_TABLE", name: tableName });
    tableForm.reset();
  });
}

export function wireFieldForm(store: Store, selects: SelectControllers): void {
  const fieldForm = document.querySelector<HTMLFormElement>("#field-form");
  const fieldNameInput = document.querySelector<HTMLInputElement>("#field-name");
  const fieldNullableInput = document.querySelector<HTMLInputElement>("#field-nullable");
  const fieldPrimaryInput = document.querySelector<HTMLInputElement>("#field-primary");
  const fieldUniqueInput = document.querySelector<HTMLInputElement>("#field-unique");
  const fieldAutoincInput = document.querySelector<HTMLInputElement>("#field-autoinc");
  const fieldIndexedInput = document.querySelector<HTMLInputElement>("#field-indexed");
  const fieldEnumValuesLabel = document.querySelector<HTMLLabelElement>("#field-enum-values-label");
  const fieldEnumValuesTextarea = document.querySelector<HTMLTextAreaElement>("#field-enum-values");
  const fieldDefaultValueLabel = document.querySelector<HTMLLabelElement>("#field-default-value-label");
  const fieldDefaultValueInput = document.querySelector<HTMLInputElement>("#field-default-value");

  if (
    !fieldForm ||
    !fieldNameInput ||
    !fieldNullableInput ||
    !fieldPrimaryInput ||
    !fieldUniqueInput ||
    !fieldAutoincInput ||
    !fieldIndexedInput ||
    !fieldEnumValuesLabel ||
    !fieldEnumValuesTextarea ||
    !fieldDefaultValueLabel ||
    !fieldDefaultValueInput
  ) {
    throw new Error("No se encontraron elementos del formulario de campo");
  }

  const enumLabel = fieldEnumValuesLabel;
  const enumTextarea = fieldEnumValuesTextarea;
  const defaultLabel = fieldDefaultValueLabel;
  const defaultInput = fieldDefaultValueInput;

  const autoincInput = fieldAutoincInput;

  function syncFieldDefaultRowVisibility() {
    const isAutoIncType = isAutoIncrementType(normalizeDataType(selects.fieldTypeSelect.getValue() || "text"));
    const hideDefault = isAutoIncType || autoincInput.checked;
    defaultLabel.hidden = hideDefault;
    defaultInput.hidden = hideDefault;
    if (hideDefault) defaultInput.value = "";
  }

  function syncFieldEnumRowVisibility() {
    const isEnum = selects.fieldTypeSelect.getValue() === "enum";
    enumLabel.hidden = !isEnum;
    enumTextarea.hidden = !isEnum;
  }

  function syncFieldFormRows() {
    syncFieldEnumRowVisibility();
    syncFieldDefaultRowVisibility();
  }

  selects.fieldTypeSelect.onChange(syncFieldFormRows);
  autoincInput.addEventListener("change", syncFieldDefaultRowVisibility);

  fieldForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(fieldForm);
    const selectedTableId = selects.fieldTableSelect.getValue();
    const state = store.getState();
    const table = getTableById(state, selectedTableId);
    if (!table) return;
    const fieldName = safeName((form.get("fieldName") as string) || "");
    if (!fieldName) return;
    const hasPrimary = table.fields.some((field) => field.isPrimary);
    const wantsPrimary = form.get("isPrimary") === "on";
    const wantsUnique = form.get("isUnique") === "on";
    const wantsAutoIncrement = form.get("autoIncrement") === "on";
    const wantsIndexed = form.get("isIndexed") === "on";
    const selectedType = normalizeDataType(selects.fieldTypeSelect.getValue() || "text");
    const enumRaw = (form.get("enumValues") as string) || "";
    const defaultRaw = (form.get("defaultValue") as string) || "";
    const parsedEnum = selectedType === "enum" ? parseEnumValuesInput(enumRaw) : undefined;
    const newField = normalizeField({
      id: generateId("fld"),
      name: fieldName,
      type: selectedType,
      nullable: isAutoIncrementType(selectedType) ? false : form.get("nullable") === "on",
      isPrimary: isAutoIncrementType(selectedType) ? true : hasPrimary ? false : wantsPrimary,
      isUnique: wantsUnique || isAutoIncrementType(selectedType),
      autoIncrement: wantsAutoIncrement || isAutoIncrementType(selectedType),
      isIndexed: wantsIndexed || wantsUnique || isAutoIncrementType(selectedType),
      ...(parsedEnum !== undefined ? { enumValues: parsedEnum } : {}),
      ...(defaultRaw.trim() ? { defaultValue: defaultRaw } : {}),
    });
    store.dispatch({ type: "ADD_FIELD", tableId: selectedTableId, field: newField });

    const keptType = selects.fieldTypeSelect.getValue();
    const keptNullable = fieldNullableInput.checked;
    const keptPrimary = fieldPrimaryInput.checked;
    const keptUnique = fieldUniqueInput.checked;
    const keptAutoinc = autoincInput.checked;
    const keptIndexed = fieldIndexedInput.checked;
    const keptDefault = defaultInput.value;
    fieldNameInput.value = "";
    enumTextarea.value = "";
    defaultInput.value = "";
    selects.refreshSelects({ fieldTable: true });
    if (selectedTableId) selects.fieldTableSelect.setValue(selectedTableId);
    selects.fieldTypeSelect.setValue(keptType);
    fieldNullableInput.checked = keptNullable;
    fieldPrimaryInput.checked = keptPrimary;
    fieldUniqueInput.checked = keptUnique;
    fieldAutoincInput.checked = keptAutoinc;
    fieldIndexedInput.checked = keptIndexed;
    defaultInput.value = keptDefault;
    syncFieldFormRows();
    fieldNameInput.focus();
  });

  syncFieldFormRows();
}

export function wireRelationForm(store: Store, selects: SelectControllers): void {
  const relationForm = document.querySelector<HTMLFormElement>("#relation-form");
  if (!relationForm) throw new Error("No se encontro #relation-form");

  relationForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const fromTableId = selects.fromTableSelect.getValue();
    const toTableId = selects.toTableSelect.getValue();
    const fromFieldId = selects.fromFieldSelect.getValue();
    const toFieldId = selects.toFieldSelect.getValue();
    const relationKind = (selects.relationKindSelect.getValue() || "1:N") as RelationKind;
    const onDeleteRaw = selects.relationOnDeleteSelect.getValue() || "NO ACTION";
    const onUpdateRaw = selects.relationOnUpdateSelect.getValue() || "NO ACTION";
    const onDelete: FkReferentialAction = isFkReferentialAction(onDeleteRaw) ? onDeleteRaw : "NO ACTION";
    const onUpdate: FkReferentialAction = isFkReferentialAction(onUpdateRaw) ? onUpdateRaw : "NO ACTION";
    if (!fromTableId || !toTableId || !fromFieldId || !toFieldId || fromTableId === toTableId) return;
    const relationId = `${fromTableId}_${fromFieldId}__${toTableId}_${toFieldId}`;
    store.dispatch({
      type: "ADD_RELATION",
      relation: { id: relationId, fromTableId, fromFieldId, toTableId, toFieldId, kind: relationKind, onDelete, onUpdate },
    });
    selects.refreshSelects({
      fromTable: true,
      fromField: true,
      toTable: true,
      toField: true,
      relationKind: true,
      onDelete: true,
      onUpdate: true,
    });
  });
}
