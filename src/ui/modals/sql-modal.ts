import type { SqlDialect } from "../../lib/data-types.ts";
import { filterProjectByTableIds, generateSql, sqlDialectLabel } from "../../services/sql-generator.ts";
import type { Store } from "../../state/store.ts";

export function wireSqlModal(store: Store): void {
  const sqlModal = document.querySelector<HTMLDivElement>("#sql-modal");
  const sqlModalTitle = document.querySelector<HTMLHeadingElement>("#sql-modal-title");
  const sqlModalOutput = document.querySelector<HTMLTextAreaElement>("#sql-modal-output");
  const sqlModalClose = document.querySelector<HTMLButtonElement>("#sql-modal-close");
  const sqlModalCopy = document.querySelector<HTMLButtonElement>("#sql-modal-copy");
  const mysqlButton = document.querySelector<HTMLButtonElement>("#sql-mysql-btn");
  const postgresqlButton = document.querySelector<HTMLButtonElement>("#sql-postgresql-btn");
  const sqlServerButton = document.querySelector<HTMLButtonElement>("#sql-sqlserver-btn");
  const exportTablesModal = document.querySelector<HTMLDivElement>("#sql-export-tables-modal");
  const exportTablesTitle = document.querySelector<HTMLHeadingElement>("#sql-export-tables-title");
  const exportTablesClose = document.querySelector<HTMLButtonElement>("#sql-export-tables-close");
  const exportTablesSelectAll = document.querySelector<HTMLButtonElement>("#sql-export-tables-select-all");
  const exportTablesSelectNone = document.querySelector<HTMLButtonElement>("#sql-export-tables-select-none");
  const exportTablesList = document.querySelector<HTMLDivElement>("#sql-export-tables-list");
  const exportTablesCancel = document.querySelector<HTMLButtonElement>("#sql-export-tables-cancel");
  const exportTablesConfirm = document.querySelector<HTMLButtonElement>("#sql-export-tables-confirm");

  if (
    !sqlModal ||
    !sqlModalTitle ||
    !sqlModalOutput ||
    !sqlModalClose ||
    !sqlModalCopy ||
    !mysqlButton ||
    !postgresqlButton ||
    !sqlServerButton ||
    !exportTablesModal ||
    !exportTablesTitle ||
    !exportTablesClose ||
    !exportTablesSelectAll ||
    !exportTablesSelectNone ||
    !exportTablesList ||
    !exportTablesCancel ||
    !exportTablesConfirm
  ) {
    throw new Error("No se encontraron elementos del modal SQL");
  }

  const modal = sqlModal;
  const modalTitle = sqlModalTitle;
  const modalOutput = sqlModalOutput;
  const tablesModal = exportTablesModal;
  const tablesList = exportTablesList;
  let pendingDialect: SqlDialect | null = null;

  function openSqlModal(dialect: SqlDialect, sql: string) {
    modalTitle.textContent = `SQL generado (${sqlDialectLabel(dialect)})`;
    modalOutput.value = sql;
    modal.classList.remove("hidden");
  }

  function closeTablesModal() {
    tablesModal.classList.add("hidden");
    pendingDialect = null;
    tablesList.replaceChildren();
  }

  function renderTableCheckboxes() {
    const { tables } = store.getState();
    tablesList.replaceChildren();

    tables.forEach((table) => {
      const label = document.createElement("label");
      label.className = "checkbox-row sql-export-table-row";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = table.id;
      checkbox.checked = true;

      const name = document.createElement("span");
      name.textContent = table.name;

      label.append(checkbox, name);
      tablesList.append(label);
    });
  }

  function getSelectedTableIds(): Set<string> {
    const selected = new Set<string>();
    tablesList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked').forEach((checkbox) => {
      selected.add(checkbox.value);
    });
    return selected;
  }

  function setAllTableCheckboxes(checked: boolean) {
    tablesList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((checkbox) => {
      checkbox.checked = checked;
    });
  }

  function openTablesModal(dialect: SqlDialect) {
    const { tables } = store.getState();
    if (tables.length === 0) {
      alert("No hay tablas para exportar.");
      return;
    }

    pendingDialect = dialect;
    exportTablesTitle.textContent = `Seleccionar tablas (${sqlDialectLabel(dialect)})`;
    renderTableCheckboxes();
    tablesModal.classList.remove("hidden");
  }

  function confirmTableSelection() {
    if (!pendingDialect) return;

    const selectedTableIds = getSelectedTableIds();
    if (selectedTableIds.size === 0) {
      alert("Selecciona al menos una tabla.");
      return;
    }

    const state = store.getState();
    const filteredProject = filterProjectByTableIds(
      { tables: state.tables, relations: state.relations },
      selectedTableIds,
    );
    const dialect = pendingDialect;
    const sql = generateSql(filteredProject, dialect);

    closeTablesModal();
    openSqlModal(dialect, sql);
  }

  mysqlButton.addEventListener("click", () => openTablesModal("mysql"));
  postgresqlButton.addEventListener("click", () => openTablesModal("postgresql"));
  sqlServerButton.addEventListener("click", () => openTablesModal("sqlserver"));

  exportTablesClose.addEventListener("click", closeTablesModal);
  exportTablesCancel.addEventListener("click", closeTablesModal);
  exportTablesSelectAll.addEventListener("click", () => setAllTableCheckboxes(true));
  exportTablesSelectNone.addEventListener("click", () => setAllTableCheckboxes(false));
  exportTablesConfirm.addEventListener("click", confirmTableSelection);

  tablesModal.addEventListener("click", (event) => {
    if (event.target === tablesModal) {
      closeTablesModal();
    }
  });

  sqlModalClose.addEventListener("click", () => modal.classList.add("hidden"));

  sqlModalCopy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(modalOutput.value);
      alert("SQL copiado al portapapeles.");
    } catch {
      alert("No se pudo copiar automaticamente.");
    }
  });

  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      modal.classList.add("hidden");
    }
  });
}
