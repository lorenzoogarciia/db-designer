# Canvas: cámara, render y niveles de detalle

Ficheros: `diagram/camera.ts` (puro), `diagram/diagram-controller.ts`, `diagram/canvas-interactions.ts`, `diagram/table-renderer.ts`, `diagram/layout.ts`, `diagram/card-style.ts`, `diagram/constants.ts`, `ui/zoom-input.ts`.

## Estructura del DOM

```
#diagram  (viewport: overflow hidden, rejilla de puntos de fondo)
├── #diagram-world.diagram-world  data-lod="full|compact|overview"
│     transform: translate(x, y) scale(zoom)   ← la cámara; variables CSS --zoom, --line-world…
│   ├── svg.relation-lines-layer     (z 5)  líneas + <defs> de símbolos de cardinalidad
│   ├── div.table-layer              (z 10) article.table-card × N  (transform: translate(x, y))
│   └── svg.relation-labels-layer    (z 20) etiquetas de relación
└── div.diagram-legend   (fija, fuera del mundo; no se exporta)
```

- Las tarjetas se colocan con `translate` **2D** en coordenadas del mundo (`card-style.ts`); el zoom lo aplica solo el contenedor. Translate 2D (no 3D) para que el navegador vuelva a rasterizar el texto nítido al cambiar el zoom.
- Las capas SVG cubren el contenido más `RELATION_LAYER_PADDING` (240). Usan un desplazamiento `offset = 240 - min(minX, minY)`: un punto del mundo `(x, y)` se dibuja en `(x + offset, y + offset)` y la capa se coloca en `left/top = -offset`. `overflow: visible`.

## Cámara (`camera.ts`)

`Camera = { x, y, zoom }`, `pantalla = mundo * zoom + (x, y)` (relativo a la esquina del viewport).

| Función | Para qué |
|---|---|
| `screenToWorld`, `zoomAround(cam, z, sx, sy)` | Conversión; zoom manteniendo fijo el punto bajo el cursor |
| `fitZoom`, `fitCamera`, `centerOn` | Encuadrar (margen `FIT_PADDING` = 48 px, nunca por encima de 100 %) |
| `zoomLimits(bounds, vw, vh)` | Zoom permitido: máximo 2,5; mínimo = `min(0.25, fit × 0.8)` acotado a ≥ 0,02. Con el mínimo se ve todo el proyecto, algo más pequeño que con *Ajustar* |
| `interpolateCamera` | Animaciones: zoom en escala logarítmica y centro del mundo lineal |
| `isWorldRectVisible`, `gridSpacing` | Visibilidad de una tabla; separación de la rejilla (24 px × zoom, se duplica si queda < 14 px) |
| `detailLevelForZoom` | LOD (ver abajo) |
| `relationLineWidth`, `cardinalityMarkerSize`, `cardinalityMarkerStroke`, `overviewNameSize` | Tamaños en pantalla según el zoom |
| `parseZoomInput` | Interpreta lo escrito en el campo de zoom (siempre porcentaje: `65`, `65%`, `12,5`) |

En el controlador, `setCamera` acota el zoom y programa la escritura con `requestAnimationFrame` (`writeCamera`), que:
- escribe el `transform` del mundo y el valor del campo de zoom (si no tiene el foco);
- cambia `data-lod` al cruzar un umbral;
- actualiza las variables CSS con el zoom cuantizado a 0,01 (`--zoom`, `--label-scale`, `--line-world`, `--overview-name-size`, `--marker-stroke`) y el tamaño de los símbolos de cardinalidad;
- mueve la rejilla de fondo (`background-size/position`).

El zoom se persiste en el proyecto con `SET_ZOOM` 500 ms después del último cambio. Al cambiar de proyecto o al arrancar, se encuadra el contenido.

## Niveles de detalle (LOD)

| Nivel | Zoom | Qué se ve |
|---|---|---|
| `full` | ≥ 0,60 | Tarjeta completa con botones (subir/bajar, editar, borrar) y metadatos largos |
| `compact` | 0,33–0,60 | Sin botones; nombre de campo y tipo corto (`.field-meta-short`). El texto se compensa (`Npx / zoom`) pero sin pasar del ancho de la tarjeta: `container-type: inline-size` en la tarjeta y `min(…, (100cqw − margen) / (--len × ancho medio))`, con `--len` = nº de caracteres que pone `table-renderer.ts`, y nunca por debajo del tamaño de `full` (con el que se midió la tarjeta). Así el nombre va siempre entero en una línea; si es muy largo, más pequeño. Si no cabe todo, se recorta antes el tipo. Etiquetas de relación ampliadas con `--label-scale` |
| `overview` | < 0,33 | Cada tabla es una caja con su nombre **completo en una línea** a tamaño fijo en pantalla (13 px → 11 px con la vista muy alejada). La caja (`.table-card-title`) mide como mínimo lo que la tabla real y crece, centrada, si el nombre no cabe; en proyectos densos puede montarse sobre la vecina salvo tras *Organizar*, que reserva su hueco (la de debajo del ratón y sus relacionadas pasan delante). Los anclajes de las líneas no cambian. Sin etiquetas de relación; líneas continuas |

Todo se hace con CSS (`.diagram-world[data-lod="…"] …`) sobre el mismo DOM. **Las dimensiones de la tarjeta no cambian entre niveles**: el ancho se mide en `full` y se fija; el alto es `getTableHeight` = 64 + 42 × campos. Así las rutas y los anclajes valen para cualquier zoom.

## Grosores y símbolos según el zoom

- **Líneas**: `relationLineWidth(zoom)` = 2,25 px desde el 60 %; al alejar **adelgazan** en escala logarítmica hasta 1,25 px (8 % o menos). Antes engordaban hasta 7 px y, en proyectos grandes, las líneas paralelas se fundían en bloques: no volver a eso. Se aplica como `stroke-width: var(--line-world)` con `--line-world = ancho / zoom` (unidades del mundo). **No usar `vector-effect: non-scaling-stroke`**: no compensa el transform CSS del contenedor.
- **Guiones**: `stroke-dasharray: calc(8px / var(--zoom)) …` para mantener su tamaño en pantalla.
- **Símbolos de cardinalidad**: marcadores `markerUnits="userSpaceOnUse"` de `cardinalityMarkerSize / zoom` unidades: 16 px en pantalla con el detalle completo y encogiendo con la raíz del zoom hasta un mínimo de 8 px. Su trazo (`--marker-stroke`) se calcula para igualar el grosor de la línea.

## Resaltado de relaciones al pasar el ratón

`setHoveredTable` (en el controlador, con `pointerover`/`pointerout` sobre la capa de tablas) marca `.is-related` en las relaciones de la tabla (las capas SVG llevan `data-from-table`/`data-to-table`) y en las tablas del otro extremo, y `.has-hover-focus` en el mundo. El CSS atenúa el resto (líneas al 8 %, tarjetas al 40 %) y engrosa las relacionadas. Funciona en todos los niveles de detalle y se desactiva mientras se arrastra o se desplaza. Tras redibujar relaciones se vuelve a aplicar. En vista general, las cajas resaltadas pasan delante de las que se les monten.

## Render (`diagram-controller.ts`)

`render()` se suscribe al store y compara dos firmas:

- **Firma de esquema**: proyecto activo + tablas (nombre y todas las propiedades de cada campo) + relaciones (id, tipo y extremos).
- **Firma de posiciones**: `id:x,y` de cada tabla.

| Cambio | Qué se hace |
|---|---|
| Nada | Nada |
| Solo posiciones | `patchTablePositions` + recalcular límites + `paintRelationsDeferred` (rutas rápidas al instante y completas en `requestIdleCallback`) |
| Esquema | `renderFull`: `innerHTML` de las tarjetas → `measureAndPinWidths` (fuerza `data-lod="full"`, lee `offsetWidth`, fija `style.width`, restaura el LOD) → límites → `paintRelations("full")`. Si cambió el proyecto activo, encuadra |

Mientras se arrastra una tabla (`beginTableDrag`) no se renderiza; al soltar se despacha `UPDATE_TABLE_POSITION`.

API pública del controlador: `render`, `getDiagramElement`, `getWorldElement`, `getCamera`, `getContentBounds`, `getTableWidth`, `fitContentToViewport(animar?)`, `focusTable` (anima y acerca hasta un zoom legible, 0,9, y resalta), `revealTable` (solo mueve si no se ve o el zoom es bajo), `setZoom`, `zoomBy`, `panBy`, `clientToWorld`, `getViewportCenterWorld`, `stopCameraAnimation`, `beginTableDrag`, `endTableDrag`.

## Interacciones (`canvas-interactions.ts`)

| Gesto | Acción |
|---|---|
| Arrastrar una tarjeta | Mueve la tabla (coordenadas libres, incluso negativas). Cerca de un borde (48 px) la cámara se desplaza sola, hasta 18 px por fotograma |
| Arrastrar el fondo o con el botón central | Desplaza la cámara |
| Rueda | Desplaza (Mayús: horizontal). Normaliza `deltaMode` (líneas × 16) |
| Ctrl/Cmd + rueda, pellizco | Zoom en el cursor: factor `exp(-deltaY × 0,0018)` |
| Clic en botones de tarjeta / etiqueta | Editar campo, borrar, mover campo, editar o borrar relación (delegación por `data-action`) |
| Clic en tarjeta (sin arrastrar) | Lleva la vista a la tabla como el buscador (`handlers.onFocusTable` → `focusTable`). Se distingue del arrastre porque el puntero no se aleja más de 4 px (`CLICK_MOVE_TOLERANCE`) y espera 260 ms (`SINGLE_CLICK_DELAY_MS`) para cancelarse si llega un doble clic; cualquier `mousedown` nuevo también lo cancela |
| Doble clic en tarjeta | Abre el editor de la tabla (sin mover la vista) |
| Doble clic en zona vacía | Abre el creador de tablas colocado en ese punto (si la tabla no tiene relaciones) |

Cualquier interacción detiene una animación de cámara en curso. Barra de herramientas: −/+ (×1,25), campo de zoom editable (Enter aplica, Esc cancela, ↑/↓ ±10 %), *Ajustar* (animado).

## Colocación de tablas (`layout.ts`)

- `findFreeTablePosition(ocupadas, w, h, x, y, margen=40, paso=40)`: busca en anillos crecientes alrededor de `(x, y)` la posición libre más cercana.
- `placeNearRelated(ocupadas, w, h, relacionadas, alternativa)`: centra la búsqueda en el centro medio de las tablas relacionadas, o en `alternativa` si no hay.
- `estimateTableWidth` (estimación por caracteres, usada antes de medir) y `getTableHeight`.
- `chooseAnchors`: elige lados enfrentados según la posición relativa; el anclaje horizontal va a la altura de la fila del campo (`64 + 42 × índice + 21`).

## Organizar (`auto-layout.ts`)

Botón *Organizar* de la barra superior del lienzo. `computeAutoLayout(tablas, relaciones, {getTableWidth, measureOverviewName, viewport, origin})` es pura y devuelve la posición de cada tabla; `main.ts` la aplica con `SET_TABLE_POSITIONS` (una sola acción, guardado inmediato) y ofrece *Deshacer* en el aviso con las posiciones anteriores.

Algoritmo (disposición por capas, de izquierda a derecha):

1. **Componentes**: grafo de FKs (sin autorrelaciones). Las tablas sin relaciones forman una rejilla alfabética aparte.
2. **Capas**: camino más largo (una tabla va a la derecha de las que referencia; los ciclos se rompen por DFS) y después cada tabla se acerca a sus hijas para acortar líneas.
3. **Orden** dentro de la capa: baricentro de las vecinas, 16 pasadas alternas.
4. **Forma**: las capas demasiado altas se reparten en subcolumnas equilibradas y, si las columnas no caben a lo ancho (cadenas de FK largas), se parten en **bandas** consecutivas apiladas hacia abajo, como un texto que salta de línea (dentro de cada banda se lee de izquierda a derecha). Se prueban 12 alturas de columna y el número de bandas cercano al ideal, y se elige la forma que mejor encaja en la proporción (`max(ancho / proporción, alto)` mínimo). Con filas alineadas cada banda extra cuesta un 35 % más, para preferir una sola.
5. **X** (por banda): columnas con el ancho de su tabla más ancha (tablas centradas) y pasillos de 120 px + 9 px por cada línea que los cruza (máx. 300), para que el enrutado tenga sitio.
6. **Y**: cada tabla quiere alinear la fila de su FK con la fila referenciada (líneas horizontales rectas). Por columna se resuelve con regresión isotónica ponderada (PAV), que respeta el orden y la separación de 64 px; 14 pasadas alternas.
7. **Empaquetado**: los componentes, de mayor a menor, en estantes; se prueban varios anchos de estante y varias rejillas para las tablas sueltas y se queda la forma que mejor encaja. La proporción es la del hueco que deja *Ajustar* (lienzo menos `FIT_PADDING`, acotada a 0,8–3).

**Vista general**: si el encuadre previsto cae por debajo del 33 %, el nombre se pinta a tamaño fijo en pantalla y la caja crece más que la tabla, a lo ancho **y a lo alto** (a un 8 % de zoom, una caja de ~34 px de alto ocupa ~400 unidades del mundo, más que muchas tablas). Para un zoom de reserva `z` cada tabla reserva el ancho (`overviewBoxWorldWidth`, con el nombre medido con la fuente real mediante `measureOverviewName`; sin medidor se estima a 0,64 em por carácter) y el alto (`overviewBoxWorldHeight`, repartido por encima y por debajo, `padY`) de su caja. Reservar agranda el diagrama y aleja el encuadre, lo que a su vez agranda las cajas: se busca por bisección (entre 2 % y 33 %) el **mayor `z` cuyo encuadre previsto sea ≥ `z`**; con ese encuadre ninguna caja pisa a otra. En este modo no se alinean filas FK↔PK (no se ven y estirarían las columnas): las columnas se apilan compactas. Con el proyecto real de 67 tablas del usuario el encuadre queda en ~9,7 % sin solapes.

El resultado es determinista y su esquina coincide con la del contenido anterior, así que organizar dos veces seguidas no mueve nada («Las tablas ya están organizadas»). Animación: `animateNextLayoutChange` pone `.is-arranging` en `#diagram` durante `LAYOUT_ANIMATION_MS` (520 ms): las tarjetas se deslizan con `transition` y las capas de relaciones se ocultan hasta que llegan; la cámara encuadra a la vez.

## Rendimiento

- Zoom y desplazamiento: un solo `transform` más variables CSS cuantizadas; sin render.
- Con 160 tablas y 222 relaciones, las rutas completas se calculan en unos 130 ms (ver [relaciones.md](relaciones.md)).
- La medición de anchos provoca un único reflow por cambio de esquema.
