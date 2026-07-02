import type { SqlDialect } from "../../lib/data-types.ts";
import { generateSql, sqlDialectLabel } from "../../services/sql-generator.ts";
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

  if (!sqlModal || !sqlModalTitle || !sqlModalOutput || !sqlModalClose || !sqlModalCopy || !mysqlButton || !postgresqlButton || !sqlServerButton) {
    throw new Error("No se encontraron elementos del modal SQL");
  }

  const modal = sqlModal;
  const modalTitle = sqlModalTitle;
  const modalOutput = sqlModalOutput;

  function openSqlModal(dialect: SqlDialect, sql: string) {
    modalTitle.textContent = `SQL generado (${sqlDialectLabel(dialect)})`;
    modalOutput.value = sql;
    modal.classList.remove("hidden");
  }

  function showSql(dialect: SqlDialect) {
    const state = store.getState();
    const sql = generateSql({ tables: state.tables, relations: state.relations }, dialect);
    openSqlModal(dialect, sql);
  }

  mysqlButton.addEventListener("click", () => showSql("mysql"));
  postgresqlButton.addEventListener("click", () => showSql("postgresql"));
  sqlServerButton.addEventListener("click", () => showSql("sqlserver"));

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
