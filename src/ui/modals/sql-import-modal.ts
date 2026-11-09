import { generateId } from "../../domain/ids.ts";
import { parseSqlSchema, type SqlImportResult } from "../../services/sql-parser.ts";
import type { Store } from "../../state/store.ts";
import { getActiveProject } from "../../state/store.ts";
import { confirmDialog } from "../dialog.ts";
import { showToast } from "../toast.ts";

function query<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`No se encontro ${selector}`);
  return element;
}

export function wireSqlImportModal(store: Store, options: { onImported: () => void }): void {
  const openButton = query<HTMLButtonElement>("#project-import-sql-btn");
  const modal = query<HTMLDivElement>("#sql-import-modal");
  const closeButton = query<HTMLButtonElement>("#sql-import-close");
  const input = query<HTMLTextAreaElement>("#sql-import-input");
  const fileInput = query<HTMLInputElement>("#sql-import-file-input");
  const fileButton = query<HTMLButtonElement>("#sql-import-file-btn");
  const summary = query<HTMLDivElement>("#sql-import-summary");
  const projectNameInput = query<HTMLInputElement>("#sql-import-project-name");
  const confirmButton = query<HTMLButtonElement>("#sql-import-confirm");

  let result: SqlImportResult | null = null;
  let parseTimer: number | null = null;

  function targetMode(): "new" | "replace" {
    const checked = modal.querySelector<HTMLInputElement>('input[name="sqlImportTarget"]:checked');
    return checked?.value === "replace" ? "replace" : "new";
  }

  function renderSummary() {
    summary.replaceChildren();
    if (!result) return;
    const headline = document.createElement("p");
    headline.className = "sql-import-headline";
    headline.textContent =
      result.tables.length === 0
        ? "No se encontraron sentencias CREATE TABLE."
        : `${result.tables.length} tabla(s), ${result.tables.reduce((sum, table) => sum + table.fields.length, 0)} campo(s) y ${result.relations.length} relacion(es).`;
    summary.append(headline);

    if (result.warnings.length > 0) {
      const details = document.createElement("details");
      details.className = "sql-import-warnings";
      const title = document.createElement("summary");
      title.textContent = `${result.warnings.length} aviso(s)`;
      const list = document.createElement("ul");
      result.warnings.forEach((warning) => {
        const item = document.createElement("li");
        item.textContent = warning;
        list.append(item);
      });
      details.append(title, list);
      summary.append(details);
    }
  }

  function parseNow() {
    if (parseTimer !== null) {
      window.clearTimeout(parseTimer);
      parseTimer = null;
    }
    const text = input.value.trim();
    result = text ? parseSqlSchema(text) : null;
    confirmButton.disabled = !result || result.tables.length === 0;
    renderSummary();
  }

  function scheduleParse() {
    if (parseTimer !== null) window.clearTimeout(parseTimer);
    parseTimer = window.setTimeout(parseNow, 250);
  }

  function syncTargetFields() {
    projectNameInput.disabled = targetMode() !== "new";
  }

  function open() {
    const state = store.getState();
    projectNameInput.value = `proyecto_sql_${state.projects.length + 1}`;
    modal.classList.remove("hidden");
    syncTargetFields();
    parseNow();
    input.focus();
  }

  function close() {
    modal.classList.add("hidden");
  }

  async function confirmImport() {
    parseNow();
    if (!result || result.tables.length === 0) return;
    const project = { tables: result.tables, relations: result.relations, zoom: 1 };

    if (targetMode() === "replace") {
      const active = getActiveProject(store.getState());
      const ok = await confirmDialog({
        title: `¿Reemplazar "${active.name}"?`,
        message: "Se sustituirán todas sus tablas y relaciones por las del script. No se puede deshacer.",
        confirmLabel: "Reemplazar",
        danger: true,
      });
      if (!ok) return;
      store.dispatch({ type: "IMPORT_PROJECT", project: { ...project, name: active.name }, mergeIntoExistingId: active.id });
    } else {
      const name = projectNameInput.value.trim() || `proyecto_sql_${store.getState().projects.length + 1}`;
      store.dispatch({ type: "IMPORT_PROJECT", project: { ...project, name }, projectId: generateId("prj") });
    }

    showToast(
      `Importadas ${result.tables.length} tabla(s) y ${result.relations.length} relacion(es)` +
        (result.warnings.length > 0 ? ` con ${result.warnings.length} aviso(s).` : "."),
      "success",
    );
    input.value = "";
    result = null;
    close();
    requestAnimationFrame(() => options.onImported());
  }

  openButton.addEventListener("click", open);
  closeButton.addEventListener("click", close);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) close();
  });
  input.addEventListener("input", scheduleParse);
  modal.querySelectorAll<HTMLInputElement>('input[name="sqlImportTarget"]').forEach((radio) => {
    radio.addEventListener("change", syncTargetFields);
  });
  fileButton.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    try {
      input.value = await file.text();
      if (targetMode() === "new") projectNameInput.value = file.name.replace(/\.[^.]+$/, "") || projectNameInput.value;
      parseNow();
    } catch {
      showToast("No se pudo leer el archivo.", "error");
    }
  });
  confirmButton.addEventListener("click", () => void confirmImport());
}
