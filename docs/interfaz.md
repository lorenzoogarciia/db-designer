# Interfaz

Ficheros: `ui/shell.ts`, `ui/project-panel.ts`, `ui/forms/forms.ts`, `ui/selects.ts`, `components/searchable-select.ts`, `ui/modals/*`, `ui/toast.ts`, `ui/zoom-input.ts`, `ui/theme-controls.ts`, `ui/diagram-table-search.ts`, `lib/theme.ts`, `services/png-export.ts`, `utils/dom.ts`, `styles/style.css`, `index.html`.

## Disposición (`ui/shell.ts`)

`mountAppShell` inserta el HTML estático:

- **Panel lateral** (`.controls`):
  - Proyectos: selector, *Nuevo*, *Renombrar*, *Exportar/Importar JSON*, *Importar SQL* y *Eliminar proyecto*.
  - *Nueva tabla*: abre el editor.
  - *Nuevo campo* y *Nueva relación*: formularios con comboboxes.
  - *Generar SQL*: MySQL, PostgreSQL o SQL Server.
- **Área del diagrama**: título, buscador de tablas, *+ Nueva tabla*, cambio de tema, −/zoom/+, *Ajustar*, *Exportar PNG* y `#diagram`.
- **Modales estáticos**: elegir tablas para SQL, SQL generado, importar SQL, editar campo y editar relación.
- El editor de tablas crea su propio modal (`#table-create-modal`) al iniciarse.

Con pantallas estrechas el panel y el diagrama se apilan.

## Componentes y piezas

- **`mountSearchableSelect(host, opciones)`**: combobox con búsqueda (`getValue`, `setValue`, `setOptions`, `onChange`). `createSelectControllers` crea todos los del panel (proyecto, tabla y tipo del campo, extremos/tipo/acciones de la relación). `refreshSelects()` los repuebla cuando `main.ts` detecta cambios de esquema por firma.
- **Formularios** (`forms.ts`):
  - *Nuevo campo*: añade un campo a la tabla elegida y conserva las opciones para encadenar varios.
  - *Nueva relación*: crea una FK o, si se elige N:M, la tabla intermedia.
  - *Nueva tabla*: abre el creador.
- **Modales**:
  - `field-edit-modal`: un campo existente (botón *Editar* de la fila).
  - `relation-edit-modal`: extremos, tipo y acciones de una relación (clic en su etiqueta); pasar a N:M crea la tabla intermedia.
  - `sql-modal` y `sql-import-modal`: ver [sql.md](sql.md).
  - `table-editor-modal`: ver [editor-de-tablas.md](editor-de-tablas.md).
- **Avisos** (`showToast(texto, "info"|"success"|"error")`): esquina inferior derecha, se cierran solos (3,2 s; errores 5,5 s) o con clic. Sustituyen a `alert()`. `confirm()`/`prompt()` se mantienen para decisiones destructivas y nombres de proyecto.
- **Buscador de tablas**: centra la tabla elegida y acerca a un zoom legible (`diagram.focusTable`).
- **Campo de zoom** (`zoom-input.ts`): ver [canvas.md](canvas.md#interacciones-canvas-interactionsts).

## Atajos

| Tecla / gesto | Acción |
|---|---|
| `N` | Nueva tabla (si no se está escribiendo y no hay modales) |
| Doble clic en vacío / en tarjeta | Crear tabla ahí / editar la tabla |
| `Ctrl`/`Cmd` + rueda | Zoom en el cursor |
| Rueda, arrastrar el fondo, botón central | Desplazar |
| Editor: `Enter`, `Ctrl`+`Enter`, `Esc` | Siguiente campo, guardar, cerrar |
| Campo de zoom: `Enter`, `Esc`, `↑`/`↓` | Aplicar, cancelar, ±10 % |

## Temas (`lib/theme.ts`, `index.html`, CSS)

- `html[data-theme="dark"|"light"]` con variables `--color-*` definidas en ambos bloques al principio de `style.css`.
- Hay colores específicos para relaciones (`--color-rel-11|1n|nm`), tarjeta en vista general (`--color-overview-card`), rejilla (`--color-grid-dot`) y leyenda (`--color-legend-bg`).
- `index.html` aplica el tema antes de cargar la app (sin parpadeo): primero lo guardado y, si no hay nada, `prefers-color-scheme`. Se guarda en `dbdesigner.theme.v1`.
- **Regla**: todo color nuevo, en los dos temas. Nada de `color-mix()` (rompe la exportación con html2canvas).

## Exportación PNG (`services/png-export.ts`)

Siempre exporta **el proyecto entero, a escala 1 y con detalle completo**, sin tocar la vista del usuario:

1. Calcula el área: los límites del contenido + 48 px de margen + 60 px para etiquetas.
2. Serializa las capas SVG con los estilos calculados en línea, forzando de forma temporal el LOD `full`, `--zoom: 1` y el grosor de línea normal. También reajusta el tamaño de los marcadores. Después las rasteriza como imágenes.
3. Ejecuta html2canvas solo para las tarjetas (fondo transparente). En el clon (`onclone`):
   - fija el viewport al tamaño del área;
   - aplana el `transform` del mundo y de cada tarjeta a `left/top`;
   - oculta las capas SVG y **elimina** la leyenda.
4. Compone el resultado: fondo del tema → líneas → tarjetas → etiquetas.
5. Usa una escala segura (`computeSafeExportScale`: máximo 8192 px de lado y 40 MP) y reintenta con escalas menores si falla.

`html2canvas` se importa de forma dinámica (unos 200 KB en un chunk aparte). Con 160 tablas tarda unos 16 s.
