# Desarrollo, pruebas y limitaciones

## Lista de comprobación antes de terminar

```bash
npm test          # Vitest
npx tsc           # tipos
npm run lint      # ESLint
npm run build     # tsc + vite build
```

Si el cambio se ve en pantalla, verificarlo además en el navegador (ver abajo). No ejecutar `npm run format` sobre todo el repo: casi todos los ficheros tienen finales de línea CRLF y Prettier los reescribiría todos.

## Tests

Vitest en entorno `node`: solo se testea lógica pura (sin DOM). Cada test vive junto a su módulo.

| Fichero | Cubre |
|---|---|
| `domain/field.test.ts` | Normalización de campos, valores por defecto, enums |
| `domain/relation.test.ts` | Acciones referenciales e ids |
| `domain/many-to-many.test.ts` | Tabla intermedia (tipos, nombres únicos, sin solapes), acción `ADD_MANY_TO_MANY` |
| `domain/table-draft.test.ts` | FKs sugeridas, validación, `buildTableFromDraft`, `CREATE_TABLE`, `placeNearRelated` |
| `domain/table-edit-draft.test.ts` | Edición: ids conservados, relaciones entrantes, cambio o quitado de FK, N:M antiguas, PK compuesta |
| `diagram/camera.test.ts` | Conversiones, encuadre, límites de zoom, LOD, grosores, marcadores, zoom escrito a mano, `findFreeTablePosition` |
| `diagram/relation-renderer.test.ts` | Marcadores de cardinalidad por tipo |
| `diagram/relation-label-placement.test.ts` | Colocación de etiquetas |
| `diagram/layout-origin.test.ts` | `normalizeTablesOrigin` (importar JSON) |
| `lib/relation-routing.test.ts` | Rodear obstáculos, carriles |
| `lib/relation-routing-orthogonal.test.ts` | Ortogonalidad garantizada (720 rutas aleatorias), pasillos, rendimiento con 160 tablas |
| `services/sql-generator.test.ts`, `sql-generator-dialects.test.ts` | DDL por dialecto, orden por dependencias, ciclos, escapes, sustituciones, avisos, N:M |
| `services/sql-parser.test.ts` | Tokenizador, MySQL / pg_dump / SSMS, casos especiales, **round-trip** en los tres dialectos |
| `persistence/project-io.test.ts` | Validación del JSON importado |

Pautas:
- Lógica nueva = función pura + test. La UI solo conecta.
- Para el canvas, probar los cálculos en `camera.ts`/`layout.ts` y verificar visualmente el resto.
- Cuando se arregla un fallo, añadir el test que lo habría detectado.

## Verificación en el navegador integrado

- Arrancar con `preview_start` y `name: "dbdesigner"` (`.claude/launch.json`; `.claude/` está en `.gitignore`). El puerto 5173 suele estar ocupado y Vite usa el 5174.
- **Medir lo que se pinta, no lo que se calcula.** Ejemplo: el grosor real en pantalla de una línea = `parseFloat(getComputedStyle(path).strokeWidth) × --zoom`. Un valor calculado correcto no garantiza el resultado visual (así se escapó el fallo de `non-scaling-stroke`).
- **Panel oculto** (`tabs_context` lo indica): no corre `requestAnimationFrame`, así que la cámara no escribe el transform, el LOD no cambia y las animaciones no avanzan; tampoco se dispara `blur`. Usar interacción real (clics y teclas) con el panel visible, o comprobar el estado (localStorage, DOM) en lugar de la pantalla.
- **Capturas con retraso**: a veces muestran el fotograma anterior; repetir la captura antes de sacar conclusiones.
- **CSS desfasado** tras la recarga en caliente: si una regla nueva "no funciona", comprobar que la hoja cargada la contiene y recargar.
- Cambiar un módulo importado por `main.ts` recarga la página entera y corta los scripts en curso.
- **Probar con proyectos grandes**: crear uno sintético escribiendo `localStorage['dbdesigner.state.v1']` con unas 160 tablas en rejilla y ~220 relaciones, y recargar. Otra vía, más realista: generar un DDL con un script, dejarlo **temporalmente** en `public/` (Vite lo sirve), leerlo con `fetch` en la página y pasarlo por *Importar SQL* como proyecto nuevo. Al terminar, borrar el fichero de `public/` y el proyecto de prueba, y volver a dejar activo el proyecto que el usuario tenía abierto.
- **Animaciones lentas en el panel**: los `requestAnimationFrame` van limitados y una animación de cámara de 320 ms puede tardar más de 1 s. Leer el estado tras esperar 2 s, no justo después del clic.
- **Al probar arrastres**, apuntar el inicio sobre la tarjeta calculando su posición en pantalla (`getBoundingClientRect` × escala de la captura): si cae en el fondo, desplaza la vista en vez de mover la tabla. Dejar las tablas del usuario donde estaban.
- **Interacción por JS**: el campo de zoom se aplica con un `KeyboardEvent('keydown', {key: 'Enter'})`; un `\n` escrito con la herramienta de teclado no lo dispara.
- **Exportación PNG sin descargar**: importar `renderDiagramCanvas` desde `/src/services/png-export.ts` y pasarle un objeto con `getContentBounds`, `getDiagramElement` y `getWorldElement`; mostrar el canvas resultante en una superposición.

## Limitaciones conocidas y posibles mejoras

| Tema | Estado |
|---|---|
| Longitud y precisión de tipos | No se modelan (`VARCHAR(255)`, `DECIMAL(10,2)` fijos por tipo). Al importar se pierden |
| Índices y UNIQUE compuestos | No se modelan (se importan como individuales, con aviso) |
| PK compuesta | Se conserva (importación, editor), pero los formularios y `applyFieldRules` imponen una sola PK al editar un campo suelto |
| Relaciones distintas por el mismo pasillo | Pueden superponerse en un tramo; los carriles solo separan relaciones idénticas. Con líneas finas y el resaltado al pasar el ratón se siguen, pero separarlas de verdad exige cambiar el enrutado (`lib/relation-routing.ts`) |
| Vista general en proyectos densos | Las cajas crecen para que el nombre entre entero en una línea (decisión del usuario: nunca ocultar ni cortar nombres). Tras *Organizar*, encuadrado, no se montan; si después se aleja más o se mueven tablas a mano sí pueden montarse. Al pasar el ratón se ponen delante |
| Nombres muy largos en vista compacta | Se ven enteros pero pequeños: el texto no baja del tamaño de `full` ni pasa del ancho de la tarjeta |
| Deshacer/rehacer | No existe. El reducer es casi puro, pero `syncActiveProjectFromState`/`saveState` mutan el proyecto (aceptado por ahora) |
| Exportar PNG en proyectos enormes | Lento (html2canvas): unos 16 s con 160 tablas |
| Rutas con muchas relaciones en zonas muy densas | Correctas y ortogonales, pero pueden cruzar tablas si no hay otro camino (obstáculos "blandos") |
| `innerHTML` con nombres de tablas/campos (tarjetas, etiquetas, combobox) | Aceptado: herramienta local (decisión del usuario) |
| Dependencia `@rolldown/binding-win32-x64-msvc` | Se mantiene (decisión del usuario) |
| Exportar JSON del proyecto | Incluye `zoom`, pero no la posición de la cámara |

Ideas planteadas: minimapa, más formatos de exportación (SVG, Mermaid, DBML), validaciones de esquema más ricas, tests de UI con jsdom y CI.
