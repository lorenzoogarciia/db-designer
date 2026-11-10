# Interfaz

Ficheros: `ui/shell.ts`, `ui/shell-controls.ts`, `ui/icons.ts`, `ui/dialog.ts`, `ui/fonts.ts`, `ui/project-panel.ts`, `ui/forms/forms.ts`, `ui/selects.ts`, `components/searchable-select.ts`, `ui/modals/*`, `ui/toast.ts`, `ui/zoom-input.ts`, `ui/theme-controls.ts`, `ui/diagram-table-search.ts`, `lib/theme.ts`, `services/png-export.ts`, `utils/dom.ts`, `styles/style.css`, `index.html`.

## Sistema de diseño

- **Identidad**: mesa de trabajo técnica. Grafito cálido (oscuro) o papel (claro) y **un único acento lima** (`--accent`) reservado para la acción principal de cada contexto y lo seleccionado. Todo lo que es SQL (nombres de tablas y campos, tipos, valores, el código) va en monoespaciada.
- **Tipografías** (Google Fonts en `index.html`): *IBM Plex Sans* (`--font-ui`) y *JetBrains Mono* (`--font-mono`). Sin conexión se usan las del sistema. `ui/fonts.ts` (`whenUiFontsReady`) retrasa el primer render del diagrama hasta que cargan (máx. 2,5 s), porque las tarjetas miden y fijan su ancho al renderizar.
- **Tokens** al principio de `style.css`, en los dos temas: superficies `--bg-app`, `--surface-sunken|1|2|3|hover|overlay`; bordes `--border-subtle|border|border-strong|border-hover`; texto `--text|text-2|text-3|text-placeholder`; acento `--accent`, `--accent-ink` (texto sobre el acento), `--accent-soft`, `--accent-border`, `--accent-text` (acento legible como texto), `--focus-ring`; estados `--danger*`, `--warning-text`, `--success-text`, `--info-text`; insignias `--flag-pk|uq|ai|idx-bg/text`; sombras `--shadow-1|2|3`. Las variables `--color-*` son las del canvas (tarjetas, relaciones, rejilla, leyenda).
- **Botones**: `.btn` + `.btn-primary` (una por contexto), `.btn-secondary`, `.btn-ghost`, `.btn-danger` (confirmar algo destructivo), `.btn-danger-ghost` (botón de borrar dentro de un formulario), `.btn-dashed` (añadir); tamaños `.btn-sm` / `.btn-block`. `.icon-btn` para botones solo con icono (siempre con `aria-label`). Los `<button>` sin clase no tienen estilo propio.
- **Campos**: `input`, `textarea` y `select` comparten alto (`--control-h`, 34 px), borde y anillo de foco; `.input-mono` para identificadores y valores SQL. Las opciones booleanas son chips (`.flag-toggle` en los formularios, `.tc-check` en el editor de tablas) con el checkbox real superpuesto e invisible. Agrupación: `.form-stack` › `.form-field` (label + control) y `.form-row` / `.form-row-3` para columnas.
- **Iconos** (`ui/icons.ts`): SVG de trazo en línea (`icon(nombre)` como texto, `iconNode(nombre)` como nodo). En las tarjetas del canvas **no** se usan SVG (serían miles de nodos y html2canvas los cargaría como imágenes): allí son máscaras CSS (`.card-icon-*`, `--card-icon-table`, `--card-icon-key`).

## Disposición (`ui/shell.ts`)

`mountAppShell` inserta el HTML estático y `wireShellControls` (`ui/shell-controls.ts`) le da el comportamiento que no depende del proyecto:

- **Barra superior** (`.topbar`): marca; selector de proyecto con menú *⋯* (nuevo, renombrar, eliminar); menús *Importar* (JSON, SQL), *Exportar* (JSON, PNG) y *Generar SQL* (MySQL, PostgreSQL, SQL Server); cambio de tema.
- **Panel lateral** (`.sidebar.controls`, plegable):
  - *Nueva tabla*: nombre + botón que abre el editor.
  - Pestañas *Campo* / *Relación* con los formularios rápidos (la relación separa *Origen* —tiene la FK— y *Destino*).
- **Lienzo** (`.canvas-area`): `#diagram` ocupa todo; encima flotan (`.canvas-hud`) el botón de plegar el panel, el buscador de tablas, *Organizar* (`#arrange-btn`, `.hud-action`; desactivado con menos de 2 tablas) y *Nueva tabla* (arriba) y la barra de zoom −/%/+/*Ajustar* (abajo a la derecha). La leyenda queda abajo a la izquierda, dentro de `#diagram`. Con el proyecto vacío se muestra `#canvas-empty` (acciones *Nueva tabla* e *Importar SQL*; no bloquea el doble clic).
- **Menús** (`[data-menu]` con `[data-menu-trigger]` y `.menu-panel`): clic o ↓ para abrir, ↑/↓ para moverse, Escape o clic fuera para cerrar; elegir una opción lo cierra.
- **Panel plegable**: el estado se guarda en `dbdesigner.sidebar.v1`. Por debajo de 900 px el panel flota sobre el lienzo, empieza plegado y se pliega al tocar el lienzo.
- **Modales estáticos**: elegir tablas para SQL, SQL generado, importar SQL, editar campo y editar relación. Estructura común: `.modal` › `.modal-card` (`.modal-xs|sm|md|lg|xl`) › `.modal-header` (icono, título, subtítulo, ✕) · `.modal-body` · `.modal-actions` (pie). Los botones `[data-modal-close]` reutilizan el ✕ de la cabecera (así cada modal ejecuta su propio cierre) y Escape cierra el modal visible (salvo el editor de tablas, que lo gestiona él).
- El editor de tablas crea su propio modal (`#table-create-modal`) al iniciarse, con la misma estructura.

## Componentes y piezas

- **`mountSearchableSelect(host, opciones)`**: combobox con búsqueda (`getValue`, `setValue`, `setOptions`, `onChange`). `createSelectControllers` crea todos los del panel (proyecto, tabla y tipo del campo, extremos/tipo/acciones de la relación). `refreshSelects()` los repuebla cuando `main.ts` detecta cambios de esquema por firma. En filas de dos columnas el desplegable ocupa la fila entera.
- **Formularios** (`forms.ts`):
  - *Nuevo campo*: añade un campo a la tabla elegida y conserva las opciones para encadenar varios.
  - *Nueva relación*: crea una FK o, si se elige N:M, la tabla intermedia.
  - *Nueva tabla*: abre el creador.
- **Modales**:
  - `field-edit-modal`: un campo existente (botón ✎ de la fila).
  - `relation-edit-modal`: extremos, tipo y acciones de una relación (clic en su etiqueta); pasar a N:M crea la tabla intermedia.
  - `sql-modal` y `sql-import-modal`: ver [sql.md](sql.md).
  - `table-editor-modal`: ver [editor-de-tablas.md](editor-de-tablas.md).
- **Diálogos** (`ui/dialog.ts`): `confirmDialog({title, message, confirmLabel, danger})` → `Promise<boolean>` y `promptDialog({title, label, initialValue…})` → `Promise<string | null>`. Sustituyen a `window.confirm` / `window.prompt`. Enter acepta y Escape o clic fuera cancela; en los destructivos (`danger`) el foco empieza en *Cancelar*, así que Enter no borra nada. El canvas no importa la UI: recibe la confirmación como `handlers.confirmDestructive` desde `main.ts`.
- **Tarjetas de tabla** (`diagram/table-renderer.ts`): icono y nombre; filas con llave para la PK, nombre en monoespaciada, `?` si admite NULL, tipo e insignias PK/UQ/AI/IDX. Las acciones (↑ ↓ ✎ 🗑 de cada fila; ✎ 🗑 de la cabecera) aparecen al pasar el ratón y flotan a la derecha sin reservar ancho. Eliminar una tabla desde la tarjeta pide confirmación.
- **Avisos** (`showToast(texto, "info"|"success"|"error", acción?)`): esquina inferior derecha, con icono; se cierran solos (3,2 s; errores 5,5 s) o con clic. Sustituyen a `alert()`. Con `acción` (`{label, onAction}`, p. ej. *Deshacer* tras organizar) muestran un botón `.toast-action` y duran 4 s más.
- **Buscador de tablas**: centra la tabla elegida y acerca a un zoom legible (`diagram.focusTable`).
- **Campo de zoom** (`zoom-input.ts`): ver [canvas.md](canvas.md#interacciones-canvas-interactionsts).

## Atajos

| Tecla / gesto | Acción |
|---|---|
| `N` | Nueva tabla (si no se está escribiendo y no hay modales) |
| Clic en una tarjeta | Llevar la vista a esa tabla (como el buscador) |
| Doble clic en vacío / en tarjeta | Crear tabla ahí / editar la tabla |
| `Ctrl`/`Cmd` + rueda | Zoom en el cursor |
| Rueda, arrastrar el fondo, botón central | Desplazar |
| Editor: `Enter`, `Ctrl`+`Enter`, `Esc` | Siguiente campo, guardar, cerrar |
| Modales y menús: `Esc` | Cerrar |
| Menús: `↓` / `↑` | Abrir y moverse por las opciones |
| Campo de zoom: `Enter`, `Esc`, `↑`/`↓` | Aplicar, cancelar, ±10 % |

## Temas (`lib/theme.ts`, `index.html`, CSS)

- `html[data-theme="dark"|"light"]` con todos los tokens definidos en ambos bloques al principio de `style.css`.
- Colores del canvas: relaciones (`--color-rel-11|1n|nm`), tarjetas (`--color-bg-table`, `--color-bg-table-header`, `--color-table-border`, `--color-row-hover`), vista general (`--color-overview-card`), rejilla (`--color-grid-dot`) y leyenda (`--color-legend-bg`). El fondo del PNG (`THEME_EXPORT_BACKGROUNDS` en `lib/theme.ts`) debe coincidir con `--color-bg-diagram-gradient-end`.
- `index.html` aplica el tema antes de cargar la app (sin parpadeo): primero lo guardado y, si no hay nada, `prefers-color-scheme`. Se guarda en `dbdesigner.theme.v1`.
- **Regla**: todo color nuevo, en los dos temas. Nada de `color-mix()` (rompe la exportación con html2canvas); para transparencias, `rgba()`.

## Exportación PNG (`services/png-export.ts`)

Siempre exporta **el proyecto entero, a escala 1 y con detalle completo**, sin tocar la vista del usuario:

1. Calcula el área: los límites del contenido + 48 px de margen + 60 px para etiquetas.
2. Serializa las capas SVG con los estilos calculados en línea, forzando de forma temporal el LOD `full`, `--zoom: 1` y el grosor de línea normal. También reajusta el tamaño de los marcadores. Después las rasteriza como imágenes.
3. Ejecuta html2canvas solo para las tarjetas (fondo transparente). En el clon (`onclone`):
   - fija el viewport al tamaño del área;
   - aplana el `transform` del mundo y de cada tarjeta a `left/top`;
   - oculta las capas SVG y **elimina** la leyenda, los botones de las tarjetas (`.table-actions`, `.field-actions`) y el icono de la cabecera (html2canvas convierte los `::before` en nodos al clonar y no entiende las máscaras CSS: pintaría cuadrados); la llave de la PK se deja en blanco.
4. Compone el resultado: fondo del tema → líneas → tarjetas → etiquetas.
5. Usa una escala segura (`computeSafeExportScale`: máximo 8192 px de lado y 40 MP) y reintenta con escalas menores si falla.

`html2canvas` se importa de forma dinámica (unos 200 KB en un chunk aparte). Con 160 tablas tarda unos 16 s.
