import { generateId } from "../domain/ids.ts";
import { downloadProjectJson, parseImportedProject, readJsonFile } from "../persistence/project-io.ts";
import type { Store } from "../state/store.ts";
import { getActiveProject } from "../state/store.ts";
import type { SelectControllers } from "./selects.ts";
import { confirmDialog, promptDialog } from "./dialog.ts";
import { showToast } from "./toast.ts";

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

  projectNewButton.addEventListener("click", async () => {
    const state = store.getState();
    const nameInput = await promptDialog({
      title: "Nuevo proyecto",
      message: "Empieza un esquema vacío. Puedes cambiar de proyecto en cualquier momento desde la barra superior.",
      label: "Nombre del proyecto",
      initialValue: `proyecto_${state.projects.length + 1}`,
      confirmLabel: "Crear proyecto",
      icon: "folder",
    });
    if (nameInput === null) return;
    const projectName = nameInput.trim() || `proyecto_${state.projects.length + 1}`;
    store.dispatch({ type: "CREATE_PROJECT", name: projectName, projectId: generateId("prj") });
  });

  projectRenameButton.addEventListener("click", async () => {
    const active = getActiveProject(store.getState());
    const nameInput = await promptDialog({
      title: "Renombrar proyecto",
      label: "Nuevo nombre",
      initialValue: active.name,
      confirmLabel: "Renombrar",
      icon: "pencil",
    });
    if (nameInput === null) return;
    const projectName = nameInput.trim();
    if (!projectName) return;
    store.dispatch({ type: "RENAME_PROJECT", name: projectName });
  });

  projectDeleteButton.addEventListener("click", async () => {
    const state = store.getState();
    if (state.projects.length <= 1) {
      showToast("Debe existir al menos un proyecto.", "error");
      return;
    }
    const active = getActiveProject(state);
    const confirmDelete = await confirmDialog({
      title: `¿Eliminar "${active.name}"?`,
      message: `Se borrarán sus ${active.tables.length} tabla(s) y relaciones. Exporta antes a JSON si quieres conservar una copia.`,
      confirmLabel: "Eliminar proyecto",
      danger: true,
    });
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
        showToast("El archivo JSON no tiene un formato de proyecto valido.", "error");
        projectImportJsonInput.value = "";
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
      showToast(`Proyecto "${imported.name}" ${existing ? "actualizado" : "importado"} correctamente.`, "success");
    } catch {
      showToast("No se pudo leer el archivo JSON.", "error");
    }
    projectImportJsonInput.value = "";
  });
}
