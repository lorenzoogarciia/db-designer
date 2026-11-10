import { icon } from "./icons.ts";

/** Interruptor tipo "chip" para opciones booleanas de un campo (NULL, PK, UNIQUE…). */
function flag(id: string, name: string | null, label: string, title: string): string {
  return `<label class="flag-toggle" title="${title}"><input id="${id}" type="checkbox"${name ? ` name="${name}"` : ""} /><span>${label}</span></label>`;
}

function menuItem(id: string, iconName: Parameters<typeof icon>[0], label: string, hint = "", extraClass = ""): string {
  return `<button id="${id}" type="button" role="menuitem" class="menu-item${extraClass ? ` ${extraClass}` : ""}">${icon(iconName)}<span class="menu-item-text"><span>${label}</span>${hint ? `<small>${hint}</small>` : ""}</span></button>`;
}

export function mountAppShell(app: HTMLElement): void {
  app.innerHTML = `
  <div class="app-shell">
    <header class="topbar">
      <div class="brand" aria-label="DB Designer">
        <span class="brand-mark">${icon("database", 18)}</span>
        <span class="brand-name">DB<span>Designer</span></span>
      </div>

      <div class="project-switcher">
        <span class="project-switcher-icon">${icon("folder", 15)}</span>
        <div id="project-select" class="searchable-select-host project-select" aria-label="Proyecto activo"></div>
        <div class="menu" data-menu>
          <button type="button" class="icon-btn" data-menu-trigger aria-haspopup="menu" aria-label="Acciones del proyecto" title="Acciones del proyecto">${icon("more")}</button>
          <div class="menu-panel" role="menu" hidden>
            ${menuItem("project-new-btn", "plus", "Nuevo proyecto")}
            ${menuItem("project-rename-btn", "pencil", "Renombrar proyecto")}
            <div class="menu-separator" role="separator"></div>
            ${menuItem("project-delete-btn", "trash", "Eliminar proyecto", "", "is-danger")}
          </div>
        </div>
      </div>

      <div class="topbar-spacer"></div>

      <nav class="topbar-actions" aria-label="Acciones">
        <div class="menu" data-menu>
          <button type="button" class="btn btn-ghost" data-menu-trigger aria-haspopup="menu">${icon("upload")}<span>Importar</span>${icon("chevronDown", 14, "btn-caret")}</button>
          <div class="menu-panel menu-panel-end" role="menu" hidden>
            ${menuItem("project-import-json-btn", "braces", "Proyecto JSON", "Un proyecto exportado desde DBDesigner")}
            ${menuItem("project-import-sql-btn", "fileCode", "Script SQL", "CREATE TABLE de MySQL, PostgreSQL o SQL Server")}
          </div>
        </div>
        <input id="project-import-json-input" type="file" accept=".json,application/json" hidden />

        <div class="menu" data-menu>
          <button type="button" class="btn btn-ghost" data-menu-trigger aria-haspopup="menu">${icon("download")}<span>Exportar</span>${icon("chevronDown", 14, "btn-caret")}</button>
          <div class="menu-panel menu-panel-end" role="menu" hidden>
            ${menuItem("project-export-json-btn", "braces", "Proyecto JSON", "Copia de seguridad para volver a importar")}
            ${menuItem("export-btn", "image", "Imagen PNG", "Todo el diagrama, a tamaño real")}
          </div>
        </div>

        <div class="menu" data-menu>
          <button type="button" class="btn btn-primary" data-menu-trigger aria-haspopup="menu">${icon("code")}<span>Generar SQL</span>${icon("chevronDown", 14, "btn-caret")}</button>
          <div class="menu-panel menu-panel-end" role="menu" hidden>
            <div class="menu-heading">Dialecto</div>
            ${menuItem("sql-mysql-btn", "fileCode", "MySQL", "AUTO_INCREMENT · ENUM")}
            ${menuItem("sql-postgresql-btn", "fileCode", "PostgreSQL", "SERIAL · BIGSERIAL")}
            ${menuItem("sql-sqlserver-btn", "fileCode", "SQL Server", "IDENTITY · NVARCHAR")}
          </div>
        </div>

        <span class="topbar-divider" aria-hidden="true"></span>
        <button id="theme-toggle-btn" type="button" class="icon-btn theme-toggle-btn" aria-label="Cambiar tema"></button>
      </nav>
    </header>

    <main class="layout">
      <aside class="sidebar controls" aria-label="Herramientas">
        <section class="side-section side-section-hero">
          <div class="side-heading">
            <span class="side-heading-icon">${icon("table", 15)}</span>
            <h2>Nueva tabla</h2>
          </div>
          <form id="table-form" class="inline-form">
            <input id="table-name" name="tableName" class="input-mono" placeholder="nombre_de_la_tabla" autocomplete="off" spellcheck="false" aria-label="Nombre de la nueva tabla" />
            <button type="submit" class="btn btn-secondary" title="Abrir el editor con este nombre">${icon("arrowRight")}<span class="sr-only">Crear</span></button>
          </form>
          <p class="side-hint">Abre el editor de campos y relaciones. También con <kbd>N</kbd> o doble clic en el lienzo.</p>
        </section>

        <div class="side-tabs" role="tablist" aria-label="Añadir al esquema">
          <button type="button" role="tab" class="side-tab" data-side-tab="field" aria-selected="true" aria-controls="side-panel-field">${icon("field", 15)}<span>Campo</span></button>
          <button type="button" role="tab" class="side-tab" data-side-tab="relation" aria-selected="false" aria-controls="side-panel-relation">${icon("link", 15)}<span>Relación</span></button>
        </div>

        <section id="side-panel-field" class="side-section side-panel" role="tabpanel" data-side-panel="field">
          <p class="side-hint">Añade campos uno tras otro a una tabla existente; las opciones se conservan entre envíos.</p>
          <form id="field-form" class="form-stack">
            <div class="form-field">
              <label for="field-table">Tabla</label>
              <div id="field-table" class="searchable-select-host"></div>
            </div>
            <div class="form-row">
              <div class="form-field">
                <label for="field-name">Nombre</label>
                <input id="field-name" name="fieldName" class="input-mono" placeholder="customer_id" required autocomplete="off" spellcheck="false" />
              </div>
              <div class="form-field">
                <label for="field-type">Tipo</label>
                <div id="field-type" class="searchable-select-host"></div>
              </div>
            </div>
            <div class="form-field">
              <label for="field-enum-values" id="field-enum-values-label" hidden>Valores del enum</label>
              <textarea id="field-enum-values" name="enumValues" class="input-mono" rows="2" placeholder="pending, active, done" hidden></textarea>
            </div>
            <div class="form-field">
              <label for="field-default-value" id="field-default-value-label">Valor por defecto <span class="label-optional">opcional</span></label>
              <input id="field-default-value" name="defaultValue" class="input-mono" placeholder="0 · 'activo' · CURRENT_TIMESTAMP" autocomplete="off" spellcheck="false" />
            </div>
            <div class="form-field">
              <span class="form-label">Restricciones</span>
              <div class="flag-group">
                ${flag("field-nullable", "nullable", "NULL", "Permite valores nulos")}
                ${flag("field-primary", "isPrimary", "PK", "Clave primaria")}
                ${flag("field-unique", "isUnique", "UNIQUE", "Valores únicos")}
                ${flag("field-autoinc", "autoIncrement", "AUTO_INC", "Autoincremental")}
                ${flag("field-indexed", "isIndexed", "INDEX", "Crear índice")}
              </div>
            </div>
            <button type="submit" class="btn btn-primary btn-block">${icon("plus")}<span>Añadir campo</span></button>
          </form>
        </section>

        <section id="side-panel-relation" class="side-section side-panel" role="tabpanel" data-side-panel="relation" hidden>
          <p class="side-hint">La tabla de origen guarda la clave foránea; la de destino es la referenciada.</p>
          <form id="relation-form" class="form-stack">
            <fieldset class="endpoint">
              <legend><span class="endpoint-dot endpoint-from"></span>Origen <span class="label-optional">tiene la FK</span></legend>
              <div class="form-row">
                <div class="form-field">
                  <label for="from-table">Tabla</label>
                  <div id="from-table" class="searchable-select-host"></div>
                </div>
                <div class="form-field">
                  <label for="from-field">Campo</label>
                  <div id="from-field" class="searchable-select-host"></div>
                </div>
              </div>
            </fieldset>
            <fieldset class="endpoint">
              <legend><span class="endpoint-dot endpoint-to"></span>Destino <span class="label-optional">referenciada</span></legend>
              <div class="form-row">
                <div class="form-field">
                  <label for="to-table">Tabla</label>
                  <div id="to-table" class="searchable-select-host"></div>
                </div>
                <div class="form-field">
                  <label for="to-field">Campo</label>
                  <div id="to-field" class="searchable-select-host"></div>
                </div>
              </div>
            </fieldset>
            <div class="form-field">
              <label for="relation-kind">Cardinalidad</label>
              <div id="relation-kind" class="searchable-select-host"></div>
            </div>
            <div class="form-row">
              <div class="form-field">
                <label for="relation-on-delete">ON DELETE</label>
                <div id="relation-on-delete" class="searchable-select-host"></div>
              </div>
              <div class="form-field">
                <label for="relation-on-update">ON UPDATE</label>
                <div id="relation-on-update" class="searchable-select-host"></div>
              </div>
            </div>
            <button type="submit" class="btn btn-primary btn-block">${icon("link")}<span>Añadir relación</span></button>
          </form>
        </section>
      </aside>

      <section class="canvas-area diagram-area" aria-label="Diagrama">
        <div class="canvas-hud canvas-hud-top">
          <button id="sidebar-toggle-btn" type="button" class="icon-btn hud-btn" aria-label="Ocultar panel" title="Ocultar panel" aria-expanded="true">${icon("panel")}</button>
          <div class="hud-search">
            <span class="hud-search-icon">${icon("search", 15)}</span>
            <div id="diagram-table-search" class="searchable-select-host diagram-table-search"></div>
          </div>
          <div class="hud-spacer"></div>
          <button id="arrange-btn" type="button" class="btn btn-secondary hud-action" title="Organizar automáticamente todas las tablas según sus claves foráneas">${icon("arrange")}<span>Organizar</span></button>
          <button id="new-table-btn" type="button" class="btn btn-primary hud-primary" title="Nueva tabla (tecla N o doble clic en el lienzo)">${icon("plus")}<span>Nueva tabla</span><kbd>N</kbd></button>
        </div>

        <div id="diagram" class="diagram"></div>

        <div id="canvas-empty" class="canvas-empty" hidden>
          <span class="canvas-empty-icon">${icon("table", 26)}</span>
          <h2>Este proyecto aún no tiene tablas</h2>
          <p>Haz doble clic en cualquier punto del lienzo para crear una tabla ahí, o empieza desde un script existente.</p>
          <div class="canvas-empty-actions">
            <button id="canvas-empty-new-btn" type="button" class="btn btn-primary">${icon("plus")}<span>Nueva tabla</span></button>
            <button id="canvas-empty-import-btn" type="button" class="btn btn-secondary">${icon("fileCode")}<span>Importar SQL</span></button>
          </div>
        </div>

        <div class="canvas-hud canvas-hud-bottom">
          <div class="zoom-bar" role="group" aria-label="Zoom">
            <button id="zoom-out-btn" type="button" class="icon-btn" aria-label="Alejar" title="Alejar">${icon("minus")}</button>
            <input id="zoom-input" type="text" inputmode="decimal" value="100%" aria-label="Zoom (escribe un porcentaje y pulsa Enter)" title="Escribe un porcentaje y pulsa Enter (flechas: ±10 %)" />
            <button id="zoom-in-btn" type="button" class="icon-btn" aria-label="Acercar" title="Acercar">${icon("plus")}</button>
            <span class="zoom-bar-divider" aria-hidden="true"></span>
            <button id="fit-btn" type="button" class="btn btn-ghost btn-sm" title="Encuadrar todo el diagrama">${icon("fit", 15)}<span>Ajustar</span></button>
          </div>
        </div>
      </section>
    </main>
  </div>

  <div id="sql-export-tables-modal" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="sql-export-tables-title">
    <div class="modal-card modal-sm sql-export-tables-card">
      <header class="modal-header">
        <div class="modal-title">
          <span class="modal-title-icon">${icon("code", 16)}</span>
          <div>
            <h3 id="sql-export-tables-title">Seleccionar tablas</h3>
            <p class="modal-subtitle">Elige qué tablas incluir en el script.</p>
          </div>
        </div>
        <button id="sql-export-tables-close" type="button" class="icon-btn" aria-label="Cerrar">${icon("x")}</button>
      </header>
      <div class="modal-body">
        <div class="sql-export-tables-toolbar">
          <button id="sql-export-tables-select-all" type="button" class="btn btn-ghost btn-sm">${icon("check", 14)}<span>Todas</span></button>
          <button id="sql-export-tables-select-none" type="button" class="btn btn-ghost btn-sm">${icon("x", 14)}<span>Ninguna</span></button>
        </div>
        <div id="sql-export-tables-list" class="sql-export-tables-list"></div>
      </div>
      <footer class="modal-actions">
        <button id="sql-export-tables-cancel" type="button" class="btn btn-secondary">Cancelar</button>
        <button id="sql-export-tables-confirm" type="button" class="btn btn-primary">${icon("code")}<span>Generar</span></button>
      </footer>
    </div>
  </div>

  <div id="sql-modal" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="sql-modal-title">
    <div class="modal-card modal-xl">
      <header class="modal-header">
        <div class="modal-title">
          <span class="modal-title-icon">${icon("fileCode", 16)}</span>
          <div>
            <h3 id="sql-modal-title">SQL generado</h3>
            <p class="modal-subtitle">Revísalo, cópialo y ejecútalo en tu base de datos.</p>
          </div>
        </div>
        <button id="sql-modal-close" type="button" class="icon-btn" aria-label="Cerrar">${icon("x")}</button>
      </header>
      <div class="modal-body modal-body-fill">
        <textarea id="sql-modal-output" class="code-area" readonly spellcheck="false"></textarea>
      </div>
      <footer class="modal-actions">
        <button type="button" class="btn btn-secondary" data-modal-close>Cerrar</button>
        <button id="sql-modal-copy" type="button" class="btn btn-primary">${icon("copy")}<span>Copiar SQL</span></button>
      </footer>
    </div>
  </div>

  <div id="sql-import-modal" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="sql-import-title">
    <div class="modal-card modal-lg sql-import-card">
      <header class="modal-header">
        <div class="modal-title">
          <span class="modal-title-icon">${icon("upload", 16)}</span>
          <div>
            <h3 id="sql-import-title">Importar SQL</h3>
            <p class="modal-subtitle">Pega un script DDL (CREATE TABLE, ALTER TABLE, CREATE INDEX…) de MySQL, PostgreSQL o SQL Server.</p>
          </div>
        </div>
        <button id="sql-import-close" type="button" class="icon-btn" aria-label="Cerrar">${icon("x")}</button>
      </header>
      <div class="modal-body modal-body-fill">
        <textarea id="sql-import-input" class="code-area" spellcheck="false" placeholder="CREATE TABLE users (&#10;  id INT AUTO_INCREMENT PRIMARY KEY,&#10;  email VARCHAR(255) NOT NULL UNIQUE&#10;);"></textarea>
        <input id="sql-import-file-input" type="file" accept=".sql,text/plain,application/sql" hidden />
        <div id="sql-import-summary" class="sql-import-summary" aria-live="polite"></div>
        <div class="sql-import-target" role="radiogroup" aria-label="Destino">
          <label class="choice-card">
            <input type="radio" name="sqlImportTarget" value="new" checked />
            <span class="choice-card-body">
              <span class="choice-card-title">Nuevo proyecto</span>
              <input id="sql-import-project-name" class="input-sm" placeholder="Nombre del proyecto" autocomplete="off" />
            </span>
          </label>
          <label class="choice-card">
            <input type="radio" name="sqlImportTarget" value="replace" />
            <span class="choice-card-body">
              <span class="choice-card-title">Reemplazar el proyecto actual</span>
              <span class="choice-card-hint">Se sustituyen todas sus tablas y relaciones.</span>
            </span>
          </label>
        </div>
      </div>
      <footer class="modal-actions">
        <button id="sql-import-file-btn" type="button" class="btn btn-ghost">${icon("fileCode")}<span>Cargar archivo .sql</span></button>
        <span class="modal-actions-spacer"></span>
        <button type="button" class="btn btn-secondary" data-modal-close>Cancelar</button>
        <button id="sql-import-confirm" type="button" class="btn btn-primary" disabled>${icon("upload")}<span>Importar</span></button>
      </footer>
    </div>
  </div>

  <div id="field-edit-modal" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="field-edit-title">
    <div class="modal-card modal-md field-edit-card">
      <header class="modal-header">
        <div class="modal-title">
          <span class="modal-title-icon">${icon("field", 16)}</span>
          <div>
            <h3 id="field-edit-title">Editar campo</h3>
            <p class="modal-subtitle">Los cambios se aplican al guardar.</p>
          </div>
        </div>
        <button id="field-edit-close" type="button" class="icon-btn" aria-label="Cerrar">${icon("x")}</button>
      </header>
      <form id="field-edit-form" class="form-stack">
        <div class="modal-body">
          <input id="field-edit-table-id" type="hidden" />
          <input id="field-edit-field-id" type="hidden" />
          <div class="form-row">
            <div class="form-field">
              <label for="field-edit-name">Nombre</label>
              <input id="field-edit-name" class="input-mono" required autocomplete="off" spellcheck="false" />
            </div>
            <div class="form-field">
              <label for="field-edit-type">Tipo</label>
              <div id="field-edit-type" class="searchable-select-host"></div>
            </div>
          </div>
          <div class="form-field">
            <label for="field-edit-enum-values" id="field-edit-enum-values-label" hidden>Valores del enum</label>
            <textarea id="field-edit-enum-values" class="input-mono" rows="2" placeholder="pending, active, done" hidden></textarea>
          </div>
          <div class="form-field">
            <label for="field-edit-default-value" id="field-edit-default-value-label">Valor por defecto <span class="label-optional">opcional</span></label>
            <input id="field-edit-default-value" class="input-mono" placeholder="0 · 'activo' · CURRENT_TIMESTAMP" autocomplete="off" spellcheck="false" />
          </div>
          <div class="form-field">
            <span class="form-label">Restricciones</span>
            <div class="flag-group">
              ${flag("field-edit-nullable", null, "NULL", "Permite valores nulos")}
              ${flag("field-edit-primary", null, "PK", "Clave primaria")}
              ${flag("field-edit-unique", null, "UNIQUE", "Valores únicos")}
              ${flag("field-edit-autoinc", null, "AUTO_INC", "Autoincremental")}
              ${flag("field-edit-indexed", null, "INDEX", "Crear índice")}
            </div>
          </div>
        </div>
        <footer class="modal-actions">
          <button type="button" class="btn btn-secondary" data-modal-close>Cancelar</button>
          <button type="submit" class="btn btn-primary">${icon("check")}<span>Guardar cambios</span></button>
        </footer>
      </form>
    </div>
  </div>

  <div id="relation-edit-modal" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="relation-edit-title">
    <div class="modal-card modal-md relation-edit-card">
      <header class="modal-header">
        <div class="modal-title">
          <span class="modal-title-icon">${icon("link", 16)}</span>
          <div>
            <h3 id="relation-edit-title">Editar relación</h3>
            <p class="modal-subtitle">El origen guarda la clave foránea; el destino es la tabla referenciada.</p>
          </div>
        </div>
        <button id="relation-edit-close" type="button" class="icon-btn" aria-label="Cerrar">${icon("x")}</button>
      </header>
      <form id="relation-edit-form" class="form-stack">
        <div class="modal-body">
          <input id="relation-edit-relation-id" type="hidden" />
          <div class="endpoint-pair">
            <fieldset class="endpoint">
              <legend><span class="endpoint-dot endpoint-from"></span>Origen</legend>
              <div class="form-field">
                <label for="relation-edit-from-table">Tabla</label>
                <div id="relation-edit-from-table" class="searchable-select-host"></div>
              </div>
              <div class="form-field">
                <label for="relation-edit-from-field">Campo</label>
                <div id="relation-edit-from-field" class="searchable-select-host"></div>
              </div>
            </fieldset>
            <span class="endpoint-arrow" aria-hidden="true">${icon("arrowRight", 18)}</span>
            <fieldset class="endpoint">
              <legend><span class="endpoint-dot endpoint-to"></span>Destino</legend>
              <div class="form-field">
                <label for="relation-edit-to-table">Tabla</label>
                <div id="relation-edit-to-table" class="searchable-select-host"></div>
              </div>
              <div class="form-field">
                <label for="relation-edit-to-field">Campo</label>
                <div id="relation-edit-to-field" class="searchable-select-host"></div>
              </div>
            </fieldset>
          </div>
          <div class="form-row form-row-3">
            <div class="form-field">
              <label for="relation-edit-kind">Cardinalidad</label>
              <div id="relation-edit-kind" class="searchable-select-host"></div>
            </div>
            <div class="form-field">
              <label for="relation-edit-on-delete">ON DELETE</label>
              <div id="relation-edit-on-delete" class="searchable-select-host"></div>
            </div>
            <div class="form-field">
              <label for="relation-edit-on-update">ON UPDATE</label>
              <div id="relation-edit-on-update" class="searchable-select-host"></div>
            </div>
          </div>
        </div>
        <footer class="modal-actions">
          <button id="relation-edit-delete" type="button" class="btn btn-danger-ghost">${icon("trash")}<span>Eliminar relación</span></button>
          <span class="modal-actions-spacer"></span>
          <button type="button" class="btn btn-secondary" data-modal-close>Cancelar</button>
          <button type="submit" class="btn btn-primary">${icon("check")}<span>Guardar cambios</span></button>
        </footer>
      </form>
    </div>
  </div>
`;
}
