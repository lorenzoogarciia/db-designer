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
          <div class="sql-actions">
            <button id="project-new-btn" type="button">Nuevo</button>
            <button id="project-rename-btn" type="button">Renombrar</button>
          </div>
          <div class="sql-actions">
            <button id="project-export-json-btn" type="button">Exportar JSON</button>
            <button id="project-import-json-btn" type="button">Importar JSON</button>
          </div>
          <input id="project-import-json-input" type="file" accept=".json,application/json" hidden />
          <button id="project-delete-btn" type="button" class="danger-btn">Eliminar proyecto</button>
        </div>
      </div>

      <div class="group">
        <h2>Nueva tabla</h2>
        <form id="table-form" class="form-grid">
          <label for="table-name">Nombre</label>
          <input id="table-name" name="tableName" placeholder="orders" required />
          <button type="submit">Agregar tabla</button>
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
        <h2>Diagrama</h2>
        <div class="toolbar-actions">
          <button id="theme-toggle-diagram-btn" type="button" class="theme-toggle-btn" aria-label="Cambiar tema"></button>
          <button id="zoom-out-btn" type="button">-</button>
          <span id="zoom-label">100%</span>
          <button id="zoom-in-btn" type="button">+</button>
          <button id="fit-btn" type="button">Ajustar</button>
          <button id="export-btn" type="button">Exportar PNG</button>
        </div>
      </div>
      <div id="diagram" class="diagram"></div>
    </section>
  </main>
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
        <label class="checkbox-row"><input id="field-edit-nullable" type="checkbox" /> Permite null</label>
        <label class="checkbox-row"><input id="field-edit-primary" type="checkbox" /> Clave primaria</label>
        <label class="checkbox-row"><input id="field-edit-unique" type="checkbox" /> UNIQUE</label>
        <label class="checkbox-row"><input id="field-edit-autoinc" type="checkbox" /> AUTO_INCREMENT</label>
        <label class="checkbox-row"><input id="field-edit-indexed" type="checkbox" /> INDEX</label>
        <button type="submit">Guardar cambios</button>
      </form>
    </div>
  </div>
`;
}
