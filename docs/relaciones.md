# Relaciones: semántica, N:M, enrutado y notación

Ficheros: `domain/relation.ts`, `domain/many-to-many.ts`, `lib/relation-routing.ts`, `diagram/relation-renderer.ts`, `diagram/relation-label-placement.ts`, `diagram/layout.ts` (`chooseAnchors`), `ui/modals/relation-edit-modal.ts`.

## Semántica

- Una relación es una **clave foránea**: `from` (tabla y campo con la FK) → `to` (tabla y campo referenciados, normalmente la PK).
- `kind`:
  - `1:N`: muchas filas de `from` por cada fila de `to` (el caso normal de una FK).
  - `1:1`: el campo FK es único (el generador SQL le añade `UNIQUE`).
  - `N:M`: no se guarda como tal en relaciones nuevas (ver abajo).
- `onDelete` y `onUpdate`: `NO ACTION` (por defecto), `RESTRICT`, `CASCADE`, `SET NULL` o `SET DEFAULT`. El generador SQL adapta los que no soporta cada motor.
- `normalizeRelation` rellena las acciones ausentes; `buildRelationId` construye el id a partir de los extremos.

## Muchos a muchos (`domain/many-to-many.ts`)

`buildJunction(tablas, {fromTableId, fromFieldId, toTableId, toFieldId, onDelete?, onUpdate?})` devuelve la tabla intermedia y dos relaciones 1:N:

- **Nombre**: `<tablaA>_<tablaB>`, con sufijo `_2`, `_3`… si ya existe.
- **Campos**:
  - `id` autoincremental (PK sustituta: el editor no permite PK compuestas nuevas).
  - `<tablaA>_<campoA>` y `<tablaB>_<campoB>`, NOT NULL e indexados.
  - El tipo de cada FK lo da `foreignKeyTypeFor`: `id`/`serial` → `integer`, `bigserial` → `bigint`, `enum` copia sus valores y el resto conserva el mismo tipo.
- **Posición**: el hueco libre más cercano al punto medio de las dos tablas (`placeNearRelated`).

Dónde se usa: al elegir N:M en el formulario de relación, al cambiar una relación a N:M en su modal (sustituye la original), en el editor de tablas (sección *Muchos a muchos*) y en `CREATE_TABLE`/`UPDATE_TABLE`. `expandManyToMany` convierte las N:M **antiguas** que queden en un proyecto en tablas intermedias virtuales solo al generar SQL.

## Enrutado ortogonal (`lib/relation-routing.ts`)

**Garantía**: todas las rutas son horizontales/verticales con giros de 90°. Se consigue por construcción y con la red de seguridad `enforceOrthogonal`, que convierte cualquier tramo diagonal en un codo. (Antes salían diagonales porque el detector de colisiones solo entendía tramos rectos y daba por libre cualquier diagonal.)

Algoritmo de `buildRoutePoints(from, to, tablas, fromId, toId, carril, calidad)`:

1. **Calidad `fast`** (mientras se arrastra): forma en "Z" con tramos de salida perpendiculares (`buildFastRoutePoints`).
2. **Calidad `full`**:
   - **Obstáculos**: las demás tablas, con margen `ROUTE_PADDING` (20) + `LANE_PADDING` (12) × carril. Las tablas origen y destino no son obstáculo: se puede pasar "por debajo" de ellas (queda oculto bajo la tarjeta) con coste ×3, y ir pegado a su borde cuesta ×2.
   - **Zona de búsqueda**: los extremos ± `SEARCH_MARGIN` (220), ampliada para abarcar los obstáculos que sobresalen.
   - **Rejilla**: solo las coordenadas relevantes. Bordes de obstáculos y extremos, salidas perpendiculares de `STUB_LENGTH` (24), punto medio entre salidas, límites de la zona y centros de los pasillos entre obstáculos (para que las líneas no vayan pegadas).
   - **A\*** sobre estados `(nodo, dirección de llegada)`, con montículo binario. Cuestan:
     - la longitud del tramo;
     - cada giro, `BEND_COST` (60), y una media vuelta, el doble (solo se permite en el primer tramo);
     - llegar al destino sin entrar perpendicular, un giro extra;
     - cruzar una tabla ajena multiplica la longitud por `OBSTACLE_COST` (60): un obstáculo "blando", así que siempre existe ruta.
   - Si la ruta encontrada cruza una tabla ajena, se repite con la zona ×3 (hasta 3 intentos).
3. La ruta empieza y termina exactamente en los anclajes (`chooseAnchors`: lados enfrentados, a la altura de la fila del campo).

Rendimiento medido: 318 rutas sobre 160 tablas en ~130 ms; 720 rutas aleatorias con tablas solapadas, todas ortogonales (`relation-routing-orthogonal.test.ts`).

`buildRoutedRelationPath` devuelve el `d` del `<path>`, los puntos (ya desplazados por `offset`) y el punto preferido para la etiqueta: el centro del **tramo más largo**.

## Etiquetas (`relation-label-placement.ts`)

Cada etiqueta (88 × 26) muestra el tipo, `campoOrigen → campoDestino` y un botón ×. `placeRelationLabel` prueba candidatos a lo largo de la ruta y desplazados a ambos lados, ordenados por cercanía al punto preferido. Rechaza los que pisan tablas (con margen) u otras etiquetas ya colocadas y, si nada cabe, busca en espiral. Clic en la etiqueta: modal de relación; clic en ×: borrar (con confirmación). En vista general las etiquetas se ocultan.

## Notación y colores (`relation-renderer.ts` + CSS)

Notación "pata de gallo" en los extremos, legible a cualquier zoom:

| Tipo | Extremo `from` (FK) | Extremo `to` | Color (oscuro / claro) | Línea |
|---|---|---|---|---|
| 1:1 | barra ("uno") | barra | verde `#34d399` / `#059669` | continua |
| 1:N | pata de gallo ("muchos") | barra | azul `#60a5fa` / `#2563eb` | discontinua 8-4 |
| N:M | pata de gallo | pata de gallo | ámbar `#fbbf24` / `#d97706` | discontinua 3-5 |

- `buildCardinalityMarkerDefs(tamañoMundo)` define 6 marcadores (`card-one-{11,1n,nm}`, `card-many-{…}`), dibujados en un marco de 16 × 16 donde +x apunta hacia la tabla y el borde de la tabla está en x = 16. `orient="auto-start-reverse"` orienta igual el extremo inicial.
- `cardinalityMarkers(kind)` devuelve qué marcador va en cada extremo.
- El color se hereda mediante `--rel-color` desde las clases `.rel-one-one / .rel-one-many / .rel-many-many` (líneas y etiquetas) y `.rel-color-{11,1n,nm}` (marcadores y leyenda).
- En vista general las líneas pasan a continuas. La leyenda fija de la esquina explica la notación.
