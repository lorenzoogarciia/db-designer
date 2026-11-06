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
| `compact` | 0,33–0,60 | Sin botones; nombre de campo y tipo corto (`.field-meta-short`) con fuente compensada `min(Npx / zoom, tope)`; etiquetas de relación ampliadas con `--label-scale` |
| `overview` | < 0,33 | Tarjeta como bloque: nombre (mismo tamaño en pantalla para todas las tablas, 14 px → 10 px con la vista muy alejada) y nº de campos; el nombre puede sobresalir de tarjetas pequeñas y partirse por los `_`; sin etiquetas de relación; líneas continuas |

Todo se hace con CSS (`.diagram-world[data-lod="…"] …`) sobre el mismo DOM. **Las dimensiones de la tarjeta no cambian entre niveles**: el ancho se mide en `full` y se fija; el alto es `getTableHeight` = 64 + 42 × campos. Así las rutas y los anclajes valen para cualquier zoom.

## Grosores y símbolos según el zoom

- **Líneas**: `relationLineWidth(zoom)` = 2,5 px hasta el 60 %; al alejar crece como `2,5 × (0,6 / zoom)^0,85` hasta 7 px. Se aplica como `stroke-width: var(--line-world)` con `--line-world = ancho / zoom` (unidades del mundo). **No usar `vector-effect: non-scaling-stroke`**: no compensa el transform CSS del contenedor.
- **Guiones**: `stroke-dasharray: calc(8px / var(--zoom)) …` para mantener su tamaño en pantalla.
- **Símbolos de cardinalidad**: marcadores `markerUnits="userSpaceOnUse"` de `cardinalityMarkerSize / zoom` unidades (18–28 px en pantalla); su trazo (`--marker-stroke`) se calcula para igualar el grosor de la línea.

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
| Doble clic en tarjeta | Abre el editor de la tabla |
| Doble clic en zona vacía | Abre el creador de tablas colocado en ese punto (si la tabla no tiene relaciones) |

Cualquier interacción detiene una animación de cámara en curso. Barra de herramientas: −/+ (×1,25), campo de zoom editable (Enter aplica, Esc cancela, ↑/↓ ±10 %), *Ajustar* (animado).

## Colocación de tablas (`layout.ts`)

- `findFreeTablePosition(ocupadas, w, h, x, y, margen=40, paso=40)`: busca en anillos crecientes alrededor de `(x, y)` la posición libre más cercana.
- `placeNearRelated(ocupadas, w, h, relacionadas, alternativa)`: centra la búsqueda en el centro medio de las tablas relacionadas, o en `alternativa` si no hay.
- `estimateTableWidth` (estimación por caracteres, usada antes de medir) y `getTableHeight`.
- `chooseAnchors`: elige lados enfrentados según la posición relativa; el anclaje horizontal va a la altura de la fila del campo (`64 + 42 × índice + 21`).

## Rendimiento

- Zoom y desplazamiento: un solo `transform` más variables CSS cuantizadas; sin render.
- Con 160 tablas y 222 relaciones, las rutas completas se calculan en unos 130 ms (ver [relaciones.md](relaciones.md)).
- La medición de anchos provoca un único reflow por cambio de esquema.
