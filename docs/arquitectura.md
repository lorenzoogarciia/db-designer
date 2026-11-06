# Arquitectura

## Visión general

Aplicación de una sola página, sin framework ni backend. Todo el estado vive en un store propio en memoria y se persiste en `localStorage`. La interfaz es DOM vanilla: el HTML base lo monta `ui/shell.ts` y cada parte de la UI se "conecta" (`wire…`) a ese DOM y al store.

```
            ┌───────────────────────────── main.ts ─────────────────────────────┐
            │ mountAppShell → createStore → createDiagramController → wire…()   │
            └────────────────────────────────────────────────────────────────────┘
   UI (ui/, components/)        Canvas (diagram/)             Servicios (services/)
   formularios, modales,  ──▶   controlador + cámara    ◀──   SQL, importación, PNG
   buscador, zoom, avisos       interacciones, render
            │                          │
            └──── store.dispatch ──────┤
                                       ▼
                         Estado (state/store.ts) ──▶ persistence/storage.ts (localStorage)
                                       │
                         Dominio puro (domain/, lib/): tipos, reglas, rutas, tipos SQL
```

## Capas y dependencias

| Capa | Carpeta | Puede depender de | Notas |
|---|---|---|---|
| Dominio | `domain/`, `lib/` | Solo entre sí | Funciones puras, testeables en Node. Sin DOM. |
| Estado | `state/` | Dominio | Reducer puro + store con suscriptores. |
| Persistencia | `persistence/` | Dominio | `localStorage` y JSON. |
| Servicios | `services/` | Dominio, estado | SQL (puro), PNG (DOM). |
| Canvas | `diagram/` | Dominio, estado, `lib/` | Render y cámara. `camera.ts` y `layout.ts` son puros. |
| Interfaz | `ui/`, `components/` | Todo lo anterior | Solo conecta: la lógica va abajo. |
| Arranque | `main.ts` | Todo | Orden de inicialización. |

Excepciones aceptadas: `domain/many-to-many.ts`, `domain/table-draft.ts` y `services/sql-parser.ts` importan medidas de `diagram/layout.ts` (para colocar tablas nuevas); `services/png-export.ts` usa `ui/toast.ts`.

## Flujo de datos

1. Un evento de UI llama a `store.dispatch(action)`.
2. `reducer(state, action)` devuelve el nuevo `AppState` (ver [modelo-y-estado.md](modelo-y-estado.md)).
3. `syncActiveProjectFromState` copia `tables/relations/zoom` al proyecto activo.
4. Persistencia: inmediata, o con 250 ms de debounce si la acción es `UPDATE_TABLE_POSITION` o `SET_ZOOM`. Se puede omitir con `dispatch(action, { persist: false })`.
5. Se notifica a todos los suscriptores. Los principales:
   - `diagram-controller.render()`: redibuja según firmas de esquema/posición (ver [canvas.md](canvas.md)).
   - `main.ts`: refresca los selects de los formularios si cambian proyectos, tablas, campos o relaciones (por firma).
   - `ui/diagram-table-search.ts`: refresca el buscador de tablas.

La **cámara** (desplazamiento y zoom) es estado local del controlador del diagrama, no del store: así hacer zoom no dispara suscriptores. El zoom se guarda en el proyecto con un debounce de 500 ms solo para persistirlo.

## Arranque (`main.ts`)

Orden actual (importa: varios `wire…` necesitan elementos o funciones creados antes):

1. `mountAppShell(#app)`: inserta todo el HTML estático (paneles, barra del diagrama, modales de SQL, campo y relación).
2. `createStore(loadInitialState(), persistState)`: `persistState` envuelve `saveState` y muestra un aviso (como mucho cada 10 s) si `localStorage` falla.
3. `createSelectControllers(store)`: comboboxes de los formularios del panel.
4. `createDiagramController(store, #diagram, #zoom-input)`: crea el mundo, las capas y la leyenda, y se suscribe al store.
5. Modales: `wireFieldEditModal`, `wireRelationEditModal`, `wireTableEditorModal` (devuelve `openTableCreator` y `openTableEditor`).
6. Panel y formularios: `wireThemeToggles`, `wireProjectPanel`, `wireTableForm(openTableCreator)`, `wireFieldForm`, `wireRelationForm`, `wireSqlModal`, `wireSqlImportModal`.
7. Botón *+ Nueva tabla* y atajo de teclado `N`.
8. `wireCanvasInteractions(store, diagram, { onEditTable, onEditField, onEditRelation, onCreateTableAt })`.
9. `wireDiagramTableSearch`, botones de zoom, `wireZoomInput`, exportar PNG.
10. Primer render (`diagram.render()`) y encuadre (`diagram.fitContentToViewport()`, síncrono).

## Convenciones de módulos

- Funciones `wireX(store, …)`: conectan una parte de la UI ya presente en el DOM y, si hace falta, devuelven funciones para abrirla (`{ openX }`).
- Funciones `createX(…)`: construyen un objeto con estado propio (store, controlador del diagrama, selects).
- Funciones `buildX(…)` / `parseX(…)` / `generateX(…)`: puras, devuelven datos o cadenas.
- Los tests viven junto al código (`*.test.ts`) y se ejecutan en Node: solo pueden importar módulos sin DOM (o funciones puras de módulos que lo usan de forma perezosa).
