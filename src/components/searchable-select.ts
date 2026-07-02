export interface SelectOption {
  value: string;
  label: string;
  group?: string;
}

export interface SearchableSelect {
  root: HTMLElement;
  hiddenInput: HTMLInputElement;
  setOptions: (options: SelectOption[]) => void;
  getValue: () => string;
  setValue: (value: string) => void;
  getLabel: () => string;
  onChange: (handler: () => void) => void;
  destroy: () => void;
}

let openSelect: SearchableSelect | null = null;

function closeOpenSelect() {
  if (!openSelect) return;
  const panel = openSelect.root.querySelector<HTMLElement>(".combobox-panel");
  panel?.classList.add("hidden");
  openSelect = null;
}

function normalizeSearch(value: string) {
  return value.trim().toLowerCase();
}

export function mountSearchableSelect(
  host: HTMLElement,
  options: {
    name?: string;
    required?: boolean;
    placeholder?: string;
    searchPlaceholder?: string;
    initialValue?: string;
    initialOptions?: SelectOption[];
  } = {},
): SearchableSelect {
  const hiddenInput = document.createElement("input");
  hiddenInput.type = "hidden";
  if (options.name) hiddenInput.name = options.name;
  if (options.required) hiddenInput.required = true;

  host.classList.add("combobox");
  host.innerHTML = `
    <button type="button" class="combobox-trigger" aria-haspopup="listbox">
      <span class="combobox-value">${options.placeholder ?? "Seleccionar..."}</span>
      <span class="combobox-chevron">▾</span>
    </button>
    <div class="combobox-panel hidden" role="listbox">
      <input type="text" class="combobox-search" placeholder="${options.searchPlaceholder ?? "Buscar..."}" autocomplete="off" />
      <ul class="combobox-list"></ul>
      <div class="combobox-empty hidden">Sin resultados</div>
    </div>
  `;
  host.appendChild(hiddenInput);

  const trigger = host.querySelector<HTMLButtonElement>(".combobox-trigger")!;
  const valueEl = host.querySelector<HTMLElement>(".combobox-value")!;
  const panel = host.querySelector<HTMLElement>(".combobox-panel")!;
  const searchInput = host.querySelector<HTMLInputElement>(".combobox-search")!;
  const list = host.querySelector<HTMLUListElement>(".combobox-list")!;
  const emptyState = host.querySelector<HTMLElement>(".combobox-empty")!;

  let currentOptions: SelectOption[] = options.initialOptions ?? [];
  let filteredOptions: SelectOption[] = currentOptions;
  let highlightedIndex = -1;
  const changeHandlers: Array<() => void> = [];

  const getOptionLabel = (value: string) => currentOptions.find((option) => option.value === value)?.label ?? "";

  const renderValue = () => {
    const value = hiddenInput.value;
    valueEl.textContent = value ? getOptionLabel(value) || value : (options.placeholder ?? "Seleccionar...");
    valueEl.classList.toggle("is-placeholder", !value);
  };

  const selectValue = (value: string, notify = true) => {
    hiddenInput.value = value;
    renderValue();
    closeOpenSelect();
    if (notify) changeHandlers.forEach((handler) => handler());
  };

  const renderList = () => {
    list.innerHTML = "";
    highlightedIndex = filteredOptions.length > 0 ? 0 : -1;
    emptyState.classList.toggle("hidden", filteredOptions.length > 0);

    let lastGroup = "";
    filteredOptions.forEach((option, index) => {
      if (option.group && option.group !== lastGroup) {
        lastGroup = option.group;
        const group = document.createElement("li");
        group.className = "combobox-group";
        group.textContent = option.group;
        list.appendChild(group);
      }
      const item = document.createElement("li");
      item.className = "combobox-option";
      item.dataset.value = option.value;
      item.dataset.index = String(index);
      item.setAttribute("role", "option");
      if (option.value === hiddenInput.value) item.classList.add("is-selected");
      if (index === highlightedIndex) item.classList.add("is-highlighted");
      item.textContent = option.label;
      item.addEventListener("mousedown", (event) => {
        event.preventDefault();
        selectValue(option.value);
      });
      list.appendChild(item);
    });
  };

  const applyFilter = (query: string) => {
    const normalized = normalizeSearch(query);
    filteredOptions = normalized
      ? currentOptions.filter((option) => {
          const haystack = `${option.label} ${option.value} ${option.group ?? ""}`.toLowerCase();
          return haystack.includes(normalized);
        })
      : currentOptions.slice();
    renderList();
  };

  const openPanel = () => {
    closeOpenSelect();
    openSelect = api;
    panel.classList.remove("hidden");
    searchInput.value = "";
    applyFilter("");
    window.requestAnimationFrame(() => {
      searchInput.focus();
      searchInput.select();
    });
  };

  const moveHighlight = (delta: number) => {
    if (filteredOptions.length === 0) return;
    highlightedIndex = (highlightedIndex + delta + filteredOptions.length) % filteredOptions.length;
    list.querySelectorAll(".combobox-option").forEach((node) => node.classList.remove("is-highlighted"));
    const next = list.querySelector<HTMLElement>(`.combobox-option[data-index="${highlightedIndex}"]`);
    next?.classList.add("is-highlighted");
    next?.scrollIntoView({ block: "nearest" });
  };

  trigger.addEventListener("click", () => {
    if (panel.classList.contains("hidden")) openPanel();
    else closeOpenSelect();
  });

  searchInput.addEventListener("input", () => applyFilter(searchInput.value));
  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveHighlight(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveHighlight(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = filteredOptions[highlightedIndex];
      if (option) selectValue(option.value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeOpenSelect();
    }
  });

  const onDocumentClick = (event: MouseEvent) => {
    if (!host.contains(event.target as Node)) closeOpenSelect();
  };
  document.addEventListener("mousedown", onDocumentClick);

  const api: SearchableSelect = {
    root: host,
    hiddenInput,
    setOptions(nextOptions) {
      currentOptions = nextOptions.slice();
      applyFilter(searchInput.value);
      if (hiddenInput.value && !currentOptions.some((option) => option.value === hiddenInput.value)) {
        hiddenInput.value = "";
      }
      renderValue();
    },
    getValue: () => hiddenInput.value,
    setValue(value) {
      hiddenInput.value = value;
      renderValue();
    },
    getLabel: () => getOptionLabel(hiddenInput.value),
    onChange(handler) {
      changeHandlers.push(handler);
    },
    destroy() {
      document.removeEventListener("mousedown", onDocumentClick);
      if (openSelect === api) closeOpenSelect();
      host.innerHTML = "";
      host.classList.remove("combobox");
    },
  };

  if (options.initialValue) api.setValue(options.initialValue);
  else renderValue();

  return api;
}
