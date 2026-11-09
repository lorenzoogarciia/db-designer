# DBDesigner — contexto para Claude

Diseñador visual de esquemas de base de datos que corre 100 % en el navegador (sin backend). Permite crear tablas, campos y relaciones sobre un canvas infinito, generar SQL para MySQL / PostgreSQL / SQL Server, importar DDL y exportar a JSON o PNG. Es una herramienta **local y personal** del usuario.

> Este fichero es el resumen que debe leerse siempre. El detalle de cada sistema está en [`docs/`](docs/README.md); léelo antes de tocar ese sistema.

## Cómo trabajar en este proyecto

- **Idioma**: conversación, textos de la interfaz, comentarios y documentación en **español**. Los identificadores de código, en inglés.
- **Verificar de verdad**: tras cambiar algo visible, comprobarlo en el navegador integrado (`preview_start` con la configuración `dbdesigner` de `.claude/launch.json`) y **medir lo que se pinta**, no solo lo que se calcula (ver *Trampas conocidas*). El usuario es exigente con la calidad visual.
- **No hacer commit** salvo que el usuario lo pida.
- **Decisiones ya tomadas por el usuario** (no volver a proponerlas como problema):
  - XSS al importar JSON: irrelevante (herramienta local; uno se importa a sí mismo).
  - La dependencia `@rolldown/binding-win32-x64-msvc` en `dependencies` se queda (la cambia si usa otro sistema).
  - Que `syncActiveProjectFromState` / `saveState` muten el proyecto en su sitio no es prioritario.
- Antes de dar algo por terminado: `npm test`, `npx tsc`, `npm run lint` y `npm run build`.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Vite en desarrollo (el puerto 5173 suele estar ocupado → 5174) |
| `npm test` | Vitest (todos los `src/**/*.test.ts`, entorno `node`) |
| `npx tsc` | Typecheck (lo ejecuta también `npm run build`) |
| `npm run lint` | ESLint sobre `src/` |
| `npm run build` | `tsc && vite build` |
| `npm run format` | Prettier — **no ejecutarlo en todo el repo**: casi todos los ficheros tienen CRLF y lo reescribiría todo |

Requiere Node 20.19+ / 22.12+ (en la máquina del usuario hay 22.9: Vite avisa pero funciona).

## Stack

TypeScript 6 estricto + Vite 8 (Rolldown) + Vitest 4 + ESLint 9 + Prettier 3. **DOM vanilla, sin framework.** Única dependencia de ejecución: `html2canvas` (cargada bajo demanda solo al exportar PNG). Persistencia en `localStorage`.

## Mapa del código

```
src/
├── main.ts                    Arranque: monta la UI, crea store y diagrama, conecta todo
├── domain/                    Modelo y reglas puras (sin DOM)
│   ├── types.ts               Field, Table, Relation, Project, AppState…
│   ├── field.ts               normalizeField, applyFieldRules, formatDefaultForSql
│   ├── relation.ts            ids de relación, acciones ON DELETE/UPDATE
│   ├── many-to-many.ts        Tablas intermedias N:M (buildJunction, expandManyToMany)
│   ├── table-draft.ts         Borradores del editor de tablas, FK sugeridas, build/validate
│   ├── defaults.ts, ids.ts    Proyecto de ejemplo; generateId, safeName, clamp
├── state/store.ts             Store propio: reducer con 20 acciones + persistencia con debounce
├── persistence/               localStorage (storage.ts) e import/export JSON (project-io.ts)
├── services/
│   ├── sql-generator.ts       DDL por dialecto (orden por dependencias, FKs con nombre, avisos)
│   ├── sql-parser.ts          Importar DDL (tokenizador + CREATE/ALTER/INDEX/TYPE)
│   └── png-export.ts          Exportación PNG (html2canvas para tarjetas + SVG propio)
├── diagram/                   Canvas
│   ├── camera.ts              Cámara, zoom, niveles de detalle, grosores (funciones puras)
│   ├── diagram-controller.ts  Render del mundo, cámara, capas SVG, leyenda
│   ├── canvas-interactions.ts Arrastre de tablas, pan, rueda, clics y doble clic
│   ├── table-renderer.ts      Marcado HTML de las tarjetas
│   ├── relation-renderer.ts   Marcado SVG de relaciones + símbolos de cardinalidad
│   ├── relation-label-placement.ts  Colocación de etiquetas sin colisiones
│   ├── layout.ts              Medidas de tabla, anclajes, huecos libres (findFreeTablePosition)
│   └── constants.ts, card-style.ts
├── lib/
│   ├── relation-routing.ts    Rutas ortogonales (A* sobre rejilla con coste por giro)
│   ├── data-types.ts          Catálogo de tipos y su traducción por dialecto
│   └── theme.ts               Tema claro/oscuro
├── ui/                        Shell (barra superior, panel, lienzo), menús, diálogos, iconos, formularios, modales, avisos
│   └── modals/table-editor-modal.ts   Editor de tablas (crear y editar)
├── components/searchable-select.ts    Combobox con búsqueda
├── utils/dom.ts               Descargas y escala segura de exportación
└── styles/style.css           Todo el CSS (temas con variables en html[data-theme])
```

**Dirección de dependencias**: `domain` y `lib` son puros → `state` → `persistence`/`services` → `diagram` → `ui` → `main`. Excepciones existentes y aceptadas: `domain/many-to-many` y `domain/table-draft` usan medidas de `diagram/layout`; `services/sql-parser` usa `diagram/layout` para colocar tablas; `services/png-export` usa `ui/toast`.

## Conceptos clave (resumen)

- **Relación**: `from` es la tabla con la **clave foránea**, `to` la referenciada. En 1:N, `from` es el lado "muchos". Las N:M nuevas se convierten siempre en tabla intermedia `<a>_<b>` con `id` + dos FKs 1:N; las N:M antiguas que queden se expanden al generar SQL.
- **Coordenadas**: las tablas viven en coordenadas del *mundo* (lógicas, sin límites, pueden ser negativas). La **cámara** `{x, y, zoom}` transforma un único contenedor (`#diagram-world`): `pantalla = mundo * zoom + (x, y)`. Hacer zoom o desplazarse **no** vuelve a renderizar.
- **Geometría fija de tarjeta**: cabecera 64 px y filas 42 px (`diagram/constants.ts`), impuestas también por CSS. Las flechas se anclan con esas constantes: si cambias el CSS de la tarjeta, mantén ambas en sintonía.
- **Niveles de detalle (LOD)**: `full` ≥ 60 % · `compact` 33–60 % (sin botones, texto compensado) · `overview` < 33 % (caja con el nombre completo en una línea a tamaño fijo en pantalla; la caja crece si el nombre no cabe; sin etiquetas de relación). Al pasar el ratón por una tabla se resaltan sus relaciones y se atenúa el resto (todas las vistas).
- **Render**: el controlador compara una *firma de esquema* y una *firma de posiciones*. Solo cambian posiciones → mueve tarjetas y redibuja relaciones (rápido y luego completo en idle). Cambia el esquema → reconstruye tarjetas, mide anchos en LOD `full` y los fija.
- **Store**: `dispatch` → reducer → sincroniza el proyecto activo → persiste (inmediato, o con 250 ms de debounce para posiciones/zoom) → notifica a los suscriptores.
- **Editor de tablas**: un único modal para crear y editar (`CREATE_TABLE` / `UPDATE_TABLE`, atómicos). Al editar se conservan los ids de campos y relaciones para no romper relaciones entrantes.

## Reglas al cambiar código

- La lógica nueva va en módulos **puros y testeados** (`domain/`, `lib/`, `diagram/camera.ts`, `services/`); la UI solo los conecta.
- Cambios de datos **siempre** vía `store.dispatch`. Si una operación toca varias cosas (tabla + relaciones), crea una acción atómica en lugar de varios dispatch.
- UI nueva: construir DOM con `createElement`/`textContent` (como `table-editor-modal.ts`), no `innerHTML` con texto del usuario.
- Avisos con `showToast` (`ui/toast.ts`), nunca `alert()`. Confirmaciones y nombres con `confirmDialog` / `promptDialog` (`ui/dialog.ts`), nunca `confirm()`/`prompt()` nativos.
- Estilo de la UI: usar el sistema de diseño de `style.css` (tokens, `.btn-*`, `.icon-btn`, `.form-field`, `.flag-toggle`, estructura `.modal-header/.modal-body/.modal-actions`) e iconos de `ui/icons.ts`; un solo `.btn-primary` por contexto. Detalle en [docs/interfaz.md](docs/interfaz.md#sistema-de-diseño).
- Colores y tamaños con variables CSS de tema; cualquier color nuevo, en los dos temas (`html[data-theme="dark"]` y `"light"`).
- Tamaños que deben verse igual en pantalla a cualquier zoom: calcular en unidades del mundo (`px / zoom`) mediante variables CSS que escribe la cámara (`--zoom`, `--line-world`, `--marker-stroke`, `--overview-name-size`, `--label-scale`).
- Si tocas el SQL generado, comprueba el *round-trip* (generar → importar) en `sql-parser.test.ts`.
- Mantener `README.md` (usuario) y `docs/` (técnico) al día con cada funcionalidad.

## Trampas conocidas (aprendidas a base de errores)

- **`vector-effect: non-scaling-stroke` no sirve aquí**: no compensa el `transform` CSS del contenedor del mundo. Los grosores se expresan en unidades del mundo (`--line-world = px / zoom`).
- **html2canvas** no entiende máscaras CSS (pinta cuadrados) y convierte los `::before` en nodos reales al clonar, antes de `onclone`: los iconos de las tarjetas se quitan del clon en `png-export.ts`. Tampoco entiende `color-mix()` (falla aunque el elemento esté oculto: hay que *quitarlo* del clon), no coloca bien transforms anidados ni SVG con `left/top` negativos. Por eso `png-export.ts` aplana transforms en el clon y rasteriza las capas SVG por su cuenta.
- **Panel del navegador oculto**: no corre `requestAnimationFrame` (la cámara escribe el transform en rAF) ni dispara `blur`. Si una prueba "no cambia", comprueba `tabs_context`; las capturas pueden llegar con retraso: repetirlas.
- **Recarga en caliente de CSS**: a veces la hoja cargada queda desfasada; recargar la página antes de concluir que una regla no funciona.
- **No engordar las líneas al alejar**: se probó (hasta 7 px) y con proyectos grandes las paralelas se funden en bloques ilegibles. Las líneas adelgazan (2,25 → 1,25 px) y los símbolos de los extremos encogen (16 → 8 px).
- **Nombres de tabla y campo: siempre completos y en una línea** (decisión del usuario). No ocultarlos ni cortarlos con «…»: en vista general la caja crece (puede montarse sobre la vecina en proyectos densos) y en compacto el texto se ajusta al ancho de la tarjeta con `cqw` y `--len`.
- Los tramos diagonales en rutas vienen de comprobar colisiones solo en horizontal/vertical: `relation-routing.ts` garantiza ortogonalidad por construcción + `enforceOrthogonal`; no reintroducir atajos directos.
- En Bash, los *heredoc* largos con comillas y backticks fallan con este entorno: escribir scripts auxiliares con la herramienta de escritura en el scratchpad y ejecutarlos.

## Documentación detallada

| Documento | Contenido |
|---|---|
| [docs/arquitectura.md](docs/arquitectura.md) | Capas, flujo de datos, arranque, convenciones de módulos |
| [docs/modelo-y-estado.md](docs/modelo-y-estado.md) | Tipos, reglas de campos, acciones del store, persistencia, JSON |
| [docs/canvas.md](docs/canvas.md) | Cámara, mundo, LOD, render, interacciones, grosores, leyenda |
| [docs/relaciones.md](docs/relaciones.md) | Semántica, N:M, enrutado ortogonal, etiquetas, cardinalidad |
| [docs/sql.md](docs/sql.md) | Generador por dialecto e importador DDL |
| [docs/editor-de-tablas.md](docs/editor-de-tablas.md) | Creador/editor, borradores, FKs sugeridas, colocación |
| [docs/interfaz.md](docs/interfaz.md) | Sistema de diseño, shell (barra superior, panel, lienzo), menús, modales, diálogos, atajos, temas, exportación PNG |
| [docs/desarrollo.md](docs/desarrollo.md) | Tests, verificación en navegador, limitaciones y pendientes |
