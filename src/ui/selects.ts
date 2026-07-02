import { DATA_TYPE_OPTIONS } from "../lib/data-types.ts";
import { mountSearchableSelect, type SearchableSelect, type SelectOption } from "../components/searchable-select.ts";
import type { Store } from "../state/store.ts";
import { getTableById } from "../state/store.ts";
import { fieldTypeLabel } from "../diagram/layout.ts";

const DATA_TYPE_SELECT_OPTIONS: SelectOption[] = DATA_TYPE_OPTIONS.map((option) => ({
  value: option.value,
  label: option.label,
  group: option.group,
}));

const RELATION_KIND_OPTIONS: SelectOption[] = [
  { value: "1:1", label: "1:1 (uno a uno)" },
  { value: "1:N", label: "1:N (uno a muchos)" },
  { value: "N:M", label: "N:M (muchos a muchos)" },
];

export interface SelectControllers {
  projectSelect: SearchableSelect;
  fieldTableSelect: SearchableSelect;
  fieldTypeSelect: SearchableSelect;
  fromTableSelect: SearchableSelect;
  fromFieldSelect: SearchableSelect;
  toTableSelect: SearchableSelect;
  toFieldSelect: SearchableSelect;
  relationKindSelect: SearchableSelect;
  fieldEditTypeSelect: SearchableSelect;
  refreshProjectSelect: () => void;
  refreshSelects: (preserve?: {
    fieldTable?: boolean;
    fromTable?: boolean;
    fromField?: boolean;
    toTable?: boolean;
    toField?: boolean;
    relationKind?: boolean;
  }) => void;
}

export function createSelectControllers(store: Store): SelectControllers {
  const projectSelectHost = document.querySelector<HTMLDivElement>("#project-select");
  const fieldTableHost = document.querySelector<HTMLDivElement>("#field-table");
  const fieldTypeHost = document.querySelector<HTMLDivElement>("#field-type");
  const fromTableHost = document.querySelector<HTMLDivElement>("#from-table");
  const fromFieldHost = document.querySelector<HTMLDivElement>("#from-field");
  const toTableHost = document.querySelector<HTMLDivElement>("#to-table");
  const toFieldHost = document.querySelector<HTMLDivElement>("#to-field");
  const relationKindHost = document.querySelector<HTMLDivElement>("#relation-kind");
  const fieldEditTypeHost = document.querySelector<HTMLDivElement>("#field-edit-type");

  if (!projectSelectHost || !fieldTableHost || !fieldTypeHost || !fromTableHost || !fromFieldHost || !toTableHost || !toFieldHost || !relationKindHost || !fieldEditTypeHost) {
    throw new Error("No se pudieron inicializar los selectores");
  }

  const projectSelect = mountSearchableSelect(projectSelectHost, {
    name: "projectId",
    placeholder: "Seleccionar proyecto...",
    searchPlaceholder: "Buscar proyecto...",
  });
  const fieldTableSelect = mountSearchableSelect(fieldTableHost, {
    name: "tableId",
    required: true,
    placeholder: "Seleccionar tabla...",
    searchPlaceholder: "Buscar tabla...",
  });
  const fieldTypeSelect = mountSearchableSelect(fieldTypeHost, {
    name: "fieldType",
    required: true,
    placeholder: "Seleccionar tipo...",
    searchPlaceholder: "Buscar tipo de dato...",
    initialOptions: DATA_TYPE_SELECT_OPTIONS,
    initialValue: "text",
  });
  const fromTableSelect = mountSearchableSelect(fromTableHost, {
    name: "fromTableId",
    required: true,
    placeholder: "Tabla origen...",
    searchPlaceholder: "Buscar tabla origen...",
  });
  const fromFieldSelect = mountSearchableSelect(fromFieldHost, {
    name: "fromFieldId",
    required: true,
    placeholder: "Campo origen...",
    searchPlaceholder: "Buscar campo origen...",
  });
  const toTableSelect = mountSearchableSelect(toTableHost, {
    name: "toTableId",
    required: true,
    placeholder: "Tabla destino...",
    searchPlaceholder: "Buscar tabla destino...",
  });
  const toFieldSelect = mountSearchableSelect(toFieldHost, {
    name: "toFieldId",
    required: true,
    placeholder: "Campo destino...",
    searchPlaceholder: "Buscar campo destino...",
  });
  const relationKindSelect = mountSearchableSelect(relationKindHost, {
    name: "relationKind",
    required: true,
    placeholder: "Tipo de relacion...",
    searchPlaceholder: "Buscar tipo...",
    initialOptions: RELATION_KIND_OPTIONS,
    initialValue: "1:N",
  });
  const fieldEditTypeSelect = mountSearchableSelect(fieldEditTypeHost, {
    required: true,
    placeholder: "Seleccionar tipo...",
    searchPlaceholder: "Buscar tipo de dato...",
    initialOptions: DATA_TYPE_SELECT_OPTIONS,
    initialValue: "text",
  });

  function getFieldOptionsForTable(tableId: string): SelectOption[] {
    const state = store.getState();
    const selectedTable = getTableById(state, tableId);
    return selectedTable?.fields.map((field) => ({ value: field.id, label: `${field.name} (${fieldTypeLabel(field)})` })) ?? [];
  }

  function syncFromFieldSelect(preserveValue = true) {
    const previous = preserveValue ? fromFieldSelect.getValue() : "";
    const options = getFieldOptionsForTable(fromTableSelect.getValue());
    fromFieldSelect.setOptions(options);
    if (previous && options.some((option) => option.value === previous)) {
      fromFieldSelect.setValue(previous);
    }
  }

  function syncToFieldSelect(preserveValue = true) {
    const previous = preserveValue ? toFieldSelect.getValue() : "";
    const options = getFieldOptionsForTable(toTableSelect.getValue());
    toFieldSelect.setOptions(options);
    if (previous && options.some((option) => option.value === previous)) {
      toFieldSelect.setValue(previous);
    }
  }

  function refreshProjectSelect() {
    const state = store.getState();
    const options = state.projects.map((project) => ({ value: project.id, label: project.name }));
    projectSelect.setOptions(options);
    projectSelect.setValue(state.activeProjectId);
  }

  function refreshSelects(
    preserve: {
      fieldTable?: boolean;
      fromTable?: boolean;
      fromField?: boolean;
      toTable?: boolean;
      toField?: boolean;
      relationKind?: boolean;
    } = {},
  ) {
    const state = store.getState();
    const tableOptions = state.tables.map((table) => ({ value: table.id, label: table.name }));

    const fieldTableValue = fieldTableSelect.getValue();
    fieldTableSelect.setOptions(tableOptions);
    if (fieldTableValue && tableOptions.some((option) => option.value === fieldTableValue)) {
      fieldTableSelect.setValue(fieldTableValue);
    }

    const fromTableValue = fromTableSelect.getValue();
    const toTableValue = toTableSelect.getValue();
    fromTableSelect.setOptions(tableOptions);
    toTableSelect.setOptions(tableOptions);
    if (fromTableValue && tableOptions.some((option) => option.value === fromTableValue)) {
      fromTableSelect.setValue(fromTableValue);
    }
    if (toTableValue && tableOptions.some((option) => option.value === toTableValue)) {
      toTableSelect.setValue(toTableValue);
    }

    syncFromFieldSelect(preserve.fromField ?? true);
    syncToFieldSelect(preserve.toField ?? true);

    if (preserve.relationKind) {
      const kind = relationKindSelect.getValue() || "1:N";
      relationKindSelect.setValue(kind);
    } else if (!relationKindSelect.getValue()) {
      relationKindSelect.setValue("1:N");
    }
  }

  fromTableSelect.onChange(() => syncFromFieldSelect(false));
  toTableSelect.onChange(() => syncToFieldSelect(false));

  return {
    projectSelect,
    fieldTableSelect,
    fieldTypeSelect,
    fromTableSelect,
    fromFieldSelect,
    toTableSelect,
    toFieldSelect,
    relationKindSelect,
    fieldEditTypeSelect,
    refreshProjectSelect,
    refreshSelects,
  };
}
