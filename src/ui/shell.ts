export function mountAppShell(app: HTMLElement): void {
  app.innerHTML = `
  <main class="layout">
    <section class="panel controls">
      <header class="app-header">
        <div>
          <h1>DB Designer</h1>
          <p>Crea tablas, campos y relaciones con vista previa en vivo.</p>
        </div>
        <button id="theme-toggle-btn" type="button" class="theme-toggle-btn" aria-label="Cambiar tema"></button>
      </header>

      <div class="group">
        <h2>Proyectos</h2>
        <div class="form-grid">
          <label for="project-select">Proyecto activo</label>
          <div id="project-select" class="searchable-select-host"></div>
          <div class="project-actions">
            <button id="project-new-btn" type="button">Nuevo</button>
            <button id="project-rename-btn" type="button">Renombrar</button>
            <button id="project-export-json-btn" type="button">Exportar JSON</button>
            <button id="project-import-json-btn" type="button">Importar JSON</button>
            <button id="project-import-sql-btn" type="button">Importar SQL</button>
          </div>
          <input id="project-import-json-input" type="file" accept=".json,application/json" hidden />
          <button id="project-delete-btn" type="button" class="danger-btn">Eliminar proyecto</button>
        </div>
      </div>

      <div class="group">
        <h2>Nueva tabla</h2>
        <form id="table-form" class="form-grid">
          <label for="table-name">Nombre</label>
          <input id="table-name" name="tableName" placeholder="orders" />
          <button type="submit">Crear tabla con campos y relaciones…</button>
        </form>
      </div>

      <div class="group">
        <h2>Nuevo campo</h2>
        <form id="field-form" class="form-grid">
          <label for="field-table">Tabla</label>
          <div id="field-table" class="searchable-select-host"></div>
          <label for="field-name">Campo</label>
          <input id="field-name" name="fieldName" placeholder="customer_id" required />
          <label for="field-type">Tipo</label>
          <div id="field-type" class="searchable-select-host"></div>
          <label for="field-enum-values" id="field-enum-values-label" hidden>Valores enum (opcional)</label>
          <textarea id="field-enum-values" name="enumValues" rows="2" placeholder="Separados por coma o una por linea (ej: pending, active, done)" hidden></textarea>
          <label for="field-default-value" id="field-default-value-label">Valor por defecto (opcional)</label>
          <input id="field-default-value" name="defaultValue" placeholder="ej: 0, 'activo', CURRENT_TIMESTAMP, NULL" />
          <label class="checkbox-row"><input id="field-nullable" type="checkbox" name="nullable" /> Permite null</label>
          <label class="checkbox-row"><input id="field-primary" type="checkbox" name="isPrimary" /> Clave primaria</label>
          <label class="checkbox-row"><input id="field-unique" type="checkbox" name="isUnique" /> UNIQUE</label>
          <label class="checkbox-row"><input id="field-autoinc" type="checkbox" name="autoIncrement" /> AUTO_INCREMENT</label>
          <label class="checkbox-row"><input id="field-indexed" type="checkbox" name="isIndexed" /> INDEX</label>
          <button type="submit">Agregar campo</button>
        </form>
      </div>

      <div class="group">
        <h2>Nueva relacion</h2>
        <form id="relation-form" class="form-grid">
          <label for="from-table">Desde tabla</label>
          <div id="from-table" class="searchable-select-host"></div>
          <label for="from-field">Desde campo</label>
          <div id="from-field" class="searchable-select-host"></div>
          <label for="to-table">Hacia tabla</label>
          <div id="to-table" class="searchable-select-host"></div>
          <label for="to-field">Hacia campo</label>
          <div id="to-field" class="searchable-select-host"></div>
          <label for="relation-kind">Tipo de relacion</label>
          <div id="relation-kind" class="searchable-select-host"></div>
          <label for="relation-on-delete">ON DELETE</label>
          <div id="relation-on-delete" class="searchable-select-host"></div>
          <label for="relation-on-update">ON UPDATE</label>
          <div id="relation-on-update" class="searchable-select-host"></div>
          <button type="submit">Agregar relacion</button>
        </form>
      </div>

      <div class="group">
        <h2>Generar SQL</h2>
        <div class="sql-actions">
          <button id="sql-mysql-btn" type="button">MySQL</button>
          <button id="sql-postgresql-btn" type="button">PostgreSQL</button>
          <button id="sql-sqlserver-btn" type="button">SQL Server</button>
        </div>
      </div>
    </section>

    <section class="panel diagram-area">
      <div class="diagram-toolbar">
        <div class="diagram-toolbar-start">
          <h2>Diagrama</h2>
          <div id="diagram-table-search" class="searchable-select-host diagram-table-search"></div>
        </div>
        <div class="toolbar-actions">
          <button id="new-table-btn" type="button" title="Nueva tabla (tecla N o doble clic en el canvas)">+ Nueva tabla</button>
          <button id="theme-toggle-diagram-btn" type="button" class="theme-toggle-btn" aria-label="Cambiar tema"></button>
          <button id="zoom-out-btn" type="button">-</button>
          <input id="zoom-input" type="text" inputmode="decimal" value="100%" aria-label="Zoom (escribe un porcentaje y pulsa Enter)" title="Escribe un porcentaje y pulsa Enter (flechas: +/-10%)" />
          <button id="zoom-in-btn" type="button">+</button>
          <button id="fit-btn" type="button">Ajustar</button>
          <button id="export-btn" type="button">Exportar PNG</button>
        </div>
      </div>
      <div id="diagram" class="diagram"></div>
    </section>
  </main>
  <div id="sql-export-tables-modal" class="modal hidden">
    <div class="modal-card sql-export-tables-card">
      <div class="modal-header">
        <h3 id="sql-export-tables-title">Seleccionar tablas</h3>
        <button id="sql-export-tables-close" type="button" class="neutral-btn">Cerrar</button>
      </div>
      <p class="sql-export-tables-hint">Elige las tablas que quieres incluir en el SQL generado.</p>
      <div class="sql-export-tables-toolbar">
        <button id="sql-export-tables-select-all" type="button" class="neutral-btn">Seleccionar todas</button>
        <button id="sql-export-tables-select-none" type="button" class="neutral-btn">Ninguna</button>
      </div>
      <div id="sql-export-tables-list" class="sql-export-tables-list"></div>
      <div class="modal-actions sql-export-tables-actions">
        <button id="sql-export-tables-cancel" type="button" class="neutral-btn">Cancelar</button>
        <button id="sql-export-tables-confirm" type="button">Exportar</button>
      </div>
    </div>
  </div>
  <div id="sql-modal" class="modal hidden">
    <div class="modal-card">
      <div class="modal-header">
        <h3 id="sql-modal-title">SQL generado</h3>
        <button id="sql-modal-close" type="button">Cerrar</button>
      </div>
      <textarea id="sql-modal-output" readonly></textarea>
      <div class="modal-actions">
        <button id="sql-modal-copy" type="button">Copiar SQL</button>
      </div>
    </div>
  </div>
  <div id="sql-import-modal" class="modal hidden">
    <div class="modal-card sql-import-card">
      <div class="modal-header">
        <h3>Importar SQL</h3>
        <button id="sql-import-close" type="button" class="neutral-btn">Cerrar</button>
      </div>
      <p class="sql-import-hint">
        Pega un script DDL de MySQL, PostgreSQL o SQL Server (CREATE TABLE, ALTER TABLE, CREATE INDEX…) o carga un archivo .sql.
      </p>
      <textarea id="sql-import-input" spellcheck="false" placeholder="CREATE TABLE users (&#10;  id INT AUTO_INCREMENT PRIMARY KEY,&#10;  email VARCHAR(255) NOT NULL UNIQUE&#10;);"></textarea>
      <input id="sql-import-file-input" type="file" accept=".sql,text/plain,application/sql" hidden />
      <div id="sql-import-summary" class="sql-import-summary" aria-live="polite"></div>
      <div class="sql-import-target">
        <label class="checkbox-row"><input type="radio" name="sqlImportTarget" value="new" checked /> Nuevo proyecto</label>
        <input id="sql-import-project-name" placeholder="Nombre del proyecto" />
        <label class="checkbox-row"><input type="radio" name="sqlImportTarget" value="replace" /> Reemplazar el proyecto actual</label>
      </div>
      <div class="modal-actions sql-import-actions">
        <button id="sql-import-file-btn" type="button" class="neutral-btn">Cargar archivo .sql</button>
        <button id="sql-import-confirm" type="button" disabled>Importar</button>
      </div>
    </div>
  </div>
  <div id="field-edit-modal" class="modal hidden">
    <div class="modal-card field-edit-card">
      <div class="modal-header">
        <h3>Editar campo</h3>
        <button id="field-edit-close" type="button">Cerrar</button>
      </div>
      <form id="field-edit-form" class="form-grid">
        <input id="field-edit-table-id" type="hidden" />
        <input id="field-edit-field-id" type="hidden" />
        <label for="field-edit-name">Nombre</label>
        <input id="field-edit-name" required />
        <label for="field-edit-type">Tipo</label>
        <div id="field-edit-type" class="searchable-select-host"></div>
        <label for="field-edit-enum-values" id="field-edit-enum-values-label" hidden>Valores enum (opcional)</label>
        <textarea id="field-edit-enum-values" rows="2" placeholder="Separados por coma o una por linea" hidden></textarea>
        <label for="field-edit-default-value" id="field-edit-default-value-label">Valor por defecto (opcional)</label>
        <input id="field-edit-default-value" placeholder="ej: 0, 'activo', CURRENT_TIMESTAMP, NULL" />
        <label class="checkbox-row"><input id="field-edit-nullable" type="checkbox" /> Permite null</label>
        <label class="checkbox-row"><input id="field-edit-primary" type="checkbox" /> Clave primaria</label>
        <label class="checkbox-row"><input id="field-edit-unique" type="checkbox" /> UNIQUE</label>
        <label class="checkbox-row"><input id="field-edit-autoinc" type="checkbox" /> AUTO_INCREMENT</label>
        <label class="checkbox-row"><input id="field-edit-indexed" type="checkbox" /> INDEX</label>
        <button type="submit">Guardar cambios</button>
      </form>
    </div>
  </div>
  <div id="relation-edit-modal" class="modal hidden">
    <div class="modal-card relation-edit-card">
      <div class="modal-header">
        <h3 id="relation-edit-title">Editar relacion</h3>
        <button id="relation-edit-close" type="button">Cerrar</button>
      </div>
      <form id="relation-edit-form" class="form-grid">
        <input id="relation-edit-relation-id" type="hidden" />
        <label for="relation-edit-from-table">Desde tabla</label>
        <div id="relation-edit-from-table" class="searchable-select-host"></div>
        <label for="relation-edit-from-field">Desde campo</label>
        <div id="relation-edit-from-field" class="searchable-select-host"></div>
        <label for="relation-edit-to-table">Hacia tabla</label>
        <div id="relation-edit-to-table" class="searchable-select-host"></div>
        <label for="relation-edit-to-field">Hacia campo</label>
        <div id="relation-edit-to-field" class="searchable-select-host"></div>
        <label for="relation-edit-kind">Tipo de relacion</label>
        <div id="relation-edit-kind" class="searchable-select-host"></div>
        <label for="relation-edit-on-delete">ON DELETE</label>
        <div id="relation-edit-on-delete" class="searchable-select-host"></div>
        <label for="relation-edit-on-update">ON UPDATE</label>
        <div id="relation-edit-on-update" class="searchable-select-host"></div>
        <div class="modal-actions relation-edit-actions">
          <button id="relation-edit-delete" type="button" class="danger-btn">Eliminar relacion</button>
          <button type="submit">Guardar cambios</button>
        </div>
      </form>
    </div>
  </div>
`;
}
