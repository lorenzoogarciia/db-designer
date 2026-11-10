# DBDesigner

Diseñador visual de esquemas de base de datos en el navegador. Crea tablas, campos y relaciones con diagrama ERD en vivo, genera SQL (MySQL, PostgreSQL, SQL Server), importa esquemas desde SQL y exporta proyectos como JSON o PNG.

## Funcionalidades destacadas

- **Crear tablas en un solo paso**: el creador (botón *Nueva tabla* del lienzo, tecla `N`, doble clic en una zona vacía del canvas o el formulario del panel lateral) reúne nombre, campos y relaciones.
  - Cada campo se edita en una fila (tipo, NULL, PK, UQ, IDX, valor por defecto, valores enum) y puede llevar su **referencia** (clave foránea) en la misma fila, con tipo de relación (1:N / 1:1) y `ON DELETE`.
  - **Referencias automáticas**: un campo `cliente_id`, `clienteId`, `id_cliente` o `fk_cliente` se enlaza solo con la tabla `cliente`/`clientes` (también con prefijo, p. ej. `sport_clientes`), con el tipo de su clave primaria, NOT NULL e indexado. Elegir la referencia a mano desactiva la detección para ese campo.
  - **Muchos a muchos**: añade la tabla relacionada y se crea la tabla intermedia.
  - **Teclado**: `Enter` pasa al siguiente campo (o crea uno nuevo), `Ctrl`+`Enter` crea la tabla y `Esc` cancela.
  - La tabla se coloca en el hueco libre más cercano a sus tablas relacionadas (sin relaciones, donde se hizo doble clic o en el centro de la vista) y la cámara se centra en ella.
- **Editar tablas con el mismo editor** (botón ✎ de la tarjeta, visible al pasar el ratón, o doble clic sobre ella): renombrar la tabla y sus campos, cambiar tipos y opciones, reordenar campos (↑/↓), añadir o quitar campos, cambiar o quitar claves foráneas y añadir relaciones N:M, todo en un solo guardado.
  - Los campos conservan su identidad al renombrarlos o reordenarlos, así que las relaciones de otras tablas hacia esta se mantienen. La sección *Referenciada por* las lista, permite quitarlas y avisa de las que se perderían al borrar el campo al que apuntan (se pide confirmación al guardar).
  - La tabla mantiene su posición; también se puede eliminar desde el editor.
- **Canvas infinito**: el diagrama no tiene bordes; las tablas pueden ir a cualquier coordenada (también negativas) y el lienzo crece con el proyecto. Una cámara (desplazamiento + zoom) mueve todo el diagrama con un único `transform`, así que hacer zoom o desplazarse no vuelve a dibujar las tablas ni a recalcular las flechas.
  - **Organizar**: el botón *Organizar* (arriba, junto a *Nueva tabla*) recoloca todas las tablas según sus claves foráneas: las referenciadas a la izquierda y las que las referencian a la derecha, con la fila de cada FK a la altura de la clave a la que apunta (líneas rectas), pasillos para las líneas y una proporción que encaja en la pantalla. Las tablas sin relaciones se agrupan aparte. Se anima, encuadra el resultado y se puede *Deshacer* desde el aviso.
  - **Controles**: arrastrar el fondo (o el botón central) desplaza; la rueda desplaza; `Ctrl`/`Cmd` + rueda o pellizco en el trackpad hace zoom en el puntero; *Ajustar* encuadra todo el proyecto. Al arrastrar una tabla contra un borde, el canvas se desplaza solo.
  - **Zoom manual**: el porcentaje de la barra es editable; escribe un valor (`65`, `65%`, `12,5`) y pulsa `Enter`. `Esc` cancela y las flechas ↑/↓ cambian el zoom un 10 %.
  - **Zoom acorde al proyecto**: el zoom mínimo se calcula a partir del tamaño del proyecto (con el zoom mínimo se ve el proyecto entero, algo más pequeño que con *Ajustar*), entre el 2 % y el 250 %; los valores escritos se ajustan a ese rango.
  - **Niveles de detalle**: a partir del 60 % se ve todo; entre el 33 % y el 60 % (*compacto*) se ocultan los botones y el texto se compensa para seguir siendo legible; por debajo (*vista general*) cada tabla es una caja con su nombre completo en una línea; si no cabe, la caja crece (en proyectos muy densos puede montarse sobre la vecina: al pasar el ratón se pone delante). Las etiquetas de las relaciones se ocultan y las líneas adelgazan para que no se fundan. Los nombres nunca se cortan ni se ocultan.
  - **Seguir relaciones**: al pasar el ratón por una tabla se resaltan sus relaciones y las tablas del otro extremo, y el resto se atenúa.
  - **Relaciones**: las rutas son siempre ortogonales (tramos horizontales y verticales con giros en ángulo recto), rodean las tablas y minimizan los codos. Al alejar la vista, las líneas y las puntas de flecha se engrosan para que las relaciones sigan viéndose.
  - **Tablas nuevas** aparecen en un hueco libre en el centro de la vista; la búsqueda centra y acerca la tabla elegida; un clic en una tabla hace lo mismo (sin arrastrarla), y doble clic abre su edición.
  - **Exportar PNG** genera siempre el proyecto completo con todo el detalle, sea cual sea la vista actual.
- **Generar SQL**: las tablas se ordenan por dependencias (las referenciadas primero); si hay referencias circulares, esas FKs se añaden al final con `ALTER TABLE`. Las FKs llevan nombre (`fk_<tabla>_<campo>`) y cada motor recibe su variante correcta (SQL Server sin `RESTRICT`, MySQL sin `SET DEFAULT`, `DEFAULT` adaptados, columnas `text` en claves como `VARCHAR(255)` / `NVARCHAR(450)`…). Los problemas detectables (tipos de FK distintos, `SET NULL` en columna `NOT NULL`, FK a columna no única) aparecen como comentarios `-- AVISOS` al principio del script.
- **Relaciones N:M**: al elegir N:M se crea automáticamente la tabla intermedia `<tablaA>_<tablaB>` con `id` y dos FKs 1:N. Las relaciones N:M de proyectos antiguos se expanden igualmente al generar SQL.
- **Importar SQL**: pega o carga un `.sql` (MySQL, PostgreSQL / `pg_dump`, SQL Server / scripts de SSMS). Se interpretan `CREATE TABLE`, `ALTER TABLE ... ADD/ALTER`, `CREATE [UNIQUE] INDEX` y `CREATE TYPE ... AS ENUM`; el resto se ignora. Lo que no se puede representar (longitudes de tipo, índices o UNIQUE compuestos, columnas calculadas, tipos desconocidos) se lista como aviso antes de importar.

## Requisitos

- Node.js 20.19+ o 22.12+
- npm

## Scripts

| Comando | Descripción |
|---------|-------------|
| `npm run dev` | Servidor de desarrollo Vite |
| `npm run build` | Typecheck + build de producción |
| `npm run preview` | Vista previa del build |
| `npm test` | Tests unitarios (Vitest) |
| `npm run lint` | ESLint sobre `src/` |
| `npm run format` | Formatear con Prettier |

## Documentación técnica

La arquitectura, el modelo de datos, el store, el canvas, el enrutado de relaciones, el SQL, el editor de tablas y la guía de desarrollo están documentados en [`docs/`](docs/README.md). [`CLAUDE.md`](CLAUDE.md) resume el proyecto y sus reglas de trabajo.

```
src/
├── main.ts        # Arranque: store, diagrama, UI
├── domain/        # Tipos y reglas puras (campos, relaciones, N:M, borradores de tabla)
├── state/         # Store con acciones y reducer
├── persistence/   # localStorage e import/export JSON
├── services/      # Generador y parser SQL, exportación PNG
├── diagram/       # Canvas: cámara, render, interacciones, etiquetas
├── lib/           # Tipos de dato, enrutado de relaciones, tema
├── ui/            # Shell, formularios, modales, avisos, zoom
├── components/    # Combobox con búsqueda
└── styles/        # CSS
```

## Formato JSON de exportación

```json
{
  "version": 1,
  "name": "mi_proyecto",
  "tables": [ /* Table[] */ ],
  "relations": [ /* Relation[] */ ],
  "zoom": 1
}
```

La importación acepta este formato o un objeto legacy con solo `tables`, `relations` y `zoom`.

## Persistencia

| Clave | Contenido |
|-------|-----------|
| `dbdesigner.state.v1` | Lista de proyectos + proyecto activo |
| `dbdesigner.theme.v1` | `"dark"` o `"light"` |

## Stack

- TypeScript + Vite
- DOM vanilla (sin framework UI)
- html2canvas (export PNG, cargado bajo demanda)
