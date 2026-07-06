import { mountSearchableSelect } from "../components/searchable-select.ts";
import type { DiagramController } from "../diagram/diagram-controller.ts";
import type { Store } from "../state/store.ts";

export function wireDiagramTableSearch(store: Store, diagram: DiagramController): void {
  const host = document.querySelector<HTMLDivElement>("#diagram-table-search");
  if (!host) return;

  const select = mountSearchableSelect(host, {
    placeholder: "Buscar tabla...",
    searchPlaceholder: "Buscar tabla...",
  });

  const refresh = () => {
    const options = store
      .getState()
      .tables.slice()
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
      .map((table) => ({ value: table.id, label: table.name }));

    select.setOptions(options);
    if (!options.some((option) => option.value === select.getValue())) {
      select.setValue("");
    }
  };

  select.onChange(() => {
    const tableId = select.getValue();
    if (!tableId) return;
    diagram.focusTable(tableId);
  });

  refresh();
  store.subscribe(refresh);
}
