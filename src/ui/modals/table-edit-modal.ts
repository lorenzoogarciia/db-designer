import type { Relation } from "../../domain/types.ts";
import type { Store } from "../../state/store.ts";
import { getFieldName, getTableById, safeName } from "../../state/store.ts";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function wireTableEditModal(
  store: Store,
  handlers: {
    onEditRelation: (relationId: string) => void;
  },
): {
  openTableEditModal: (tableId: string) => void;
} {
  const modal = document.querySelector<HTMLDivElement>("#table-edit-modal");
  const form = document.querySelector<HTMLFormElement>("#table-edit-form");
  const closeButton = document.querySelector<HTMLButtonElement>("#table-edit-close");
  const title = document.querySelector<HTMLHeadingElement>("#table-edit-title");
  const tableIdInput = document.querySelector<HTMLInputElement>("#table-edit-table-id");
  const nameInput = document.querySelector<HTMLInputElement>("#table-edit-name");
  const relationsCount = document.querySelector<HTMLSpanElement>("#table-edit-relations-count");
  const relationsList = document.querySelector<HTMLDivElement>("#table-edit-relations-list");

  if (!modal || !form || !closeButton || !title || !tableIdInput || !nameInput || !relationsCount || !relationsList) {
    throw new Error("No se encontraron elementos del modal de edicion de tabla");
  }

  const modalEl = modal;
  const formEl = form;
  const closeBtn = closeButton;
  const titleEl = title;
  const tableIdInputEl = tableIdInput;
  const nameInputEl = nameInput;
  const relationsCountEl = relationsCount;
  const relationsListEl = relationsList;

  let activeTableId: string | null = null;

  function getTableRelations(tableId: string): Relation[] {
    return store.getState().relations.filter(
      (relation) => relation.fromTableId === tableId || relation.toTableId === tableId,
    );
  }

  function renderRelationsList(tableId: string) {
    const state = store.getState();
    const table = getTableById(state, tableId);
    const relations = getTableRelations(tableId);

    relationsCountEl.textContent = relations.length === 1 ? "1 relacion" : `${relations.length} relaciones`;

    if (!table) {
      relationsListEl.innerHTML = `<p class="table-edit-relations-empty">Tabla no encontrada.</p>`;
      return;
    }

    if (relations.length === 0) {
      relationsListEl.innerHTML = `<p class="table-edit-relations-empty">Esta tabla no tiene relaciones.</p>`;
      return;
    }

    relationsListEl.innerHTML = relations
      .map((relation) => {
        const fromTable = getTableById(state, relation.fromTableId);
        const toTable = getTableById(state, relation.toTableId);
        const fromField = getFieldName(state, relation.fromTableId, relation.fromFieldId);
        const toField = getFieldName(state, relation.toTableId, relation.toFieldId);
        const outgoing = relation.fromTableId === tableId;
        const direction = outgoing ? "Saliente" : "Entrante";
        const otherTableName = outgoing ? (toTable?.name ?? "?") : (fromTable?.name ?? "?");
        const summary = `${fromTable?.name ?? "?"}.${fromField} → ${toTable?.name ?? "?"}.${toField}`;

        return `
          <article class="table-edit-relation-item" data-relation-id="${escapeHtml(relation.id)}">
            <div class="table-edit-relation-main">
              <div class="table-edit-relation-meta">
                <span class="table-edit-relation-kind">${escapeHtml(relation.kind)}</span>
                <span class="table-edit-relation-direction ${outgoing ? "is-out" : "is-in"}">${direction}</span>
              </div>
              <p class="table-edit-relation-summary">${escapeHtml(summary)}</p>
              <p class="table-edit-relation-side">
                ${outgoing ? "Hacia" : "Desde"} <strong>${escapeHtml(otherTableName)}</strong>
                · ON DELETE ${escapeHtml(relation.onDelete)} · ON UPDATE ${escapeHtml(relation.onUpdate)}
              </p>
            </div>
            <div class="table-edit-relation-actions">
              <button type="button" class="neutral-btn table-action-btn" data-action="edit-relation" data-relation-id="${escapeHtml(relation.id)}">Editar</button>
              <button type="button" class="danger-btn table-action-btn" data-action="delete-relation" data-relation-id="${escapeHtml(relation.id)}">Eliminar</button>
            </div>
          </article>
        `;
      })
      .join("");
  }

  function openTableEditModal(tableId: string) {
    const table = getTableById(store.getState(), tableId);
    if (!table) return;

    activeTableId = tableId;
    tableIdInputEl.value = tableId;
    nameInputEl.value = table.name;
    titleEl.textContent = `Editar tabla · ${table.name}`;
    renderRelationsList(tableId);
    modalEl.classList.remove("hidden");
    nameInputEl.focus();
    nameInputEl.select();
  }

  function closeModal() {
    modalEl.classList.add("hidden");
    activeTableId = null;
  }

  formEl.addEventListener("submit", (event) => {
    event.preventDefault();
    const tableId = tableIdInputEl.value;
    const table = getTableById(store.getState(), tableId);
    if (!table) return;

    const newName = safeName(nameInputEl.value);
    if (!newName) return;

    if (newName !== table.name) {
      store.dispatch({ type: "RENAME_TABLE", tableId, name: newName });
    }

    titleEl.textContent = `Editar tabla · ${newName}`;
    nameInputEl.value = newName;
  });

  relationsListEl.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const action = target.closest<HTMLElement>("[data-action]")?.dataset.action;
    const relationId = target.closest<HTMLElement>("[data-relation-id]")?.dataset.relationId;
    if (!action || !relationId) return;

    if (action === "edit-relation") {
      handlers.onEditRelation(relationId);
      return;
    }

    if (action === "delete-relation") {
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
      if (activeTableId) renderRelationsList(activeTableId);
    }
  });

  store.subscribe(() => {
    if (!activeTableId || modalEl.classList.contains("hidden")) return;
    const table = getTableById(store.getState(), activeTableId);
    if (!table) {
      closeModal();
      return;
    }
    titleEl.textContent = `Editar tabla · ${table.name}`;
    if (document.activeElement !== nameInputEl) {
      nameInputEl.value = table.name;
    }
    renderRelationsList(activeTableId);
  });

  closeBtn.addEventListener("click", closeModal);
  modalEl.addEventListener("click", (event) => {
    if (event.target === modalEl) closeModal();
  });

  return { openTableEditModal };
}
