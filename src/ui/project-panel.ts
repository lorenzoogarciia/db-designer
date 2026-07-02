import { generateId } from "../domain/ids.ts";
import { downloadProjectJson, parseImportedProject, readJsonFile } from "../persistence/project-io.ts";
import type { Store } from "../state/store.ts";
import { getActiveProject } from "../state/store.ts";
import type { SelectControllers } from "./selects.ts";

export function wireProjectPanel(store: Store, selects: SelectControllers): void {
  const projectNewButton = document.querySelector<HTMLButtonElement>("#project-new-btn");
  const projectRenameButton = document.querySelector<HTMLButtonElement>("#project-rename-btn");
  const projectDeleteButton = document.querySelector<HTMLButtonElement>("#project-delete-btn");
  const projectExportJsonButton = document.querySelector<HTMLButtonElement>("#project-export-json-btn");
  const projectImportJsonButton = document.querySelector<HTMLButtonElement>("#project-import-json-btn");
  const projectImportJsonInput = document.querySelector<HTMLInputElement>("#project-import-json-input");

  if (
    !projectNewButton ||
    !projectRenameButton ||
    !projectDeleteButton ||
    !projectExportJsonButton ||
    !projectImportJsonButton ||
    !projectImportJsonInput
  ) {
    throw new Error("No se encontraron controles de proyecto");
  }

  selects.projectSelect.onChange(() => {
    store.dispatch({ type: "SWITCH_PROJECT", projectId: selects.projectSelect.getValue() });
  });

  projectNewButton.addEventListener("click", () => {
    const state = store.getState();
    const nameInput = window.prompt("Nombre del nuevo proyecto", `proyecto_${state.projects.length + 1}`);
    if (nameInput === null) return;
    const projectName = nameInput.trim() || `proyecto_${state.projects.length + 1}`;
    store.dispatch({ type: "CREATE_PROJECT", name: projectName, projectId: generateId("prj") });
  });

  projectRenameButton.addEventListener("click", () => {
    const active = getActiveProject(store.getState());
    const nameInput = window.prompt("Nuevo nombre del proyecto", active.name);
    if (nameInput === null) return;
    const projectName = nameInput.trim();
    if (!projectName) return;
    store.dispatch({ type: "RENAME_PROJECT", name: projectName });
  });

  projectDeleteButton.addEventListener("click", () => {
    const state = store.getState();
    if (state.projects.length <= 1) {
      alert("Debe existir al menos un proyecto.");
      return;
    }
    const active = getActiveProject(state);
    const confirmDelete = window.confirm(`Eliminar proyecto "${active.name}"?`);
    if (!confirmDelete) return;
    store.dispatch({ type: "DELETE_PROJECT" });
  });

  projectExportJsonButton.addEventListener("click", () => {
    downloadProjectJson(getActiveProject(store.getState()));
  });

  projectImportJsonButton.addEventListener("click", () => {
    projectImportJsonInput.click();
  });

  projectImportJsonInput.addEventListener("change", async () => {
    const file = projectImportJsonInput.files?.[0];
    if (!file) return;
    try {
      const parsed = await readJsonFile(file);
      const imported = parseImportedProject(parsed);
      if (!imported) {
        alert("El archivo JSON no tiene un formato de proyecto valido.");
        return;
      }

      const state = store.getState();
      const existing = state.projects.find((project) => project.name === imported.name);
      if (existing) {
        store.dispatch({
          type: "IMPORT_PROJECT",
          project: imported,
          mergeIntoExistingId: existing.id,
        });
      } else {
        store.dispatch({
          type: "IMPORT_PROJECT",
          project: imported,
          projectId: generateId("prj"),
        });
      }
      alert(`Proyecto "${imported.name}" ${existing ? "actualizado" : "importado"} correctamente.`);
    } catch {
      alert("No se pudo leer el archivo JSON.");
    }
    projectImportJsonInput.value = "";
  });
}
