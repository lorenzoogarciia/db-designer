# Modelo de datos y estado

## Tipos (`domain/types.ts`)

```ts
Field    { id, name, type: DataType, nullable, isPrimary, isUnique, autoIncrement, isIndexed,
           defaultValue?: string, enumValues?: string[] }
Table    { id, name, fields: Field[], x, y }            // x, y: coordenadas del mundo (sin límites)
Relation { id, fromTableId, fromFieldId, toTableId, toFieldId,
           kind: "1:1" | "1:N" | "N:M", onDelete, onUpdate }   // acciones: NO ACTION | RESTRICT | CASCADE | SET NULL | SET DEFAULT
Project  { id, name, tables, relations, zoom }
AppState { projects, activeProjectId, tables, relations, zoom }  // tables/relations/zoom = copia del proyecto activo
```

- **Ids**: `generateId(prefix)` → `"<prefix>_<8 caracteres aleatorios>"` (`tbl_`, `fld_`, `prj_`). Los ids de relación se construyen con `buildRelationId(fromTable, fromField, toTable, toField)`; el editor de tablas reutiliza el id original mientras la relación apunte al mismo campo.
- **Nombres**: `safeName(valor)` = recortar, espacios → `_`, minúsculas. Lo aplican formularios y editor; los nombres importados de SQL/JSON se conservan tal cual.
- **Semántica de relación**: `from` es la tabla con la clave foránea. En `1:N`, `from` es el lado "muchos". Ver [relaciones.md](relaciones.md).

## Tipos de dato (`lib/data-types.ts`)

`DATA_TYPE_OPTIONS` es el catálogo (valor, etiqueta y grupo), por ejemplo `id`, `uuid`, `enum`, `serial`, `bigserial`, enteros, decimales, texto, fecha/hora, JSON, binarios, red y otros. Cada tipo tiene una traducción fija por dialecto (`mapDataTypeToSql`), por ejemplo `varchar → VARCHAR(255)` en MySQL o `NVARCHAR(255)` en SQL Server. **No se guardan longitudes ni precisiones.**

- `isAutoIncrementType`: `id`, `serial` y `bigserial` (siempre PK, autoincremental y NOT NULL).
- `isIntegerLikeType`: tipos que admiten `autoIncrement`.
- `normalizeDataType`: valores desconocidos → `text`; alias antiguos `int`/`string`/`bool`.

## Reglas de campos (`domain/field.ts`)

`normalizeField(raw)` deja un campo coherente (se usa al cargar, importar y crear):

- Tipos autoincrementales ⇒ `isPrimary`, `autoIncrement`, NOT NULL y sin `defaultValue`.
- `isPrimary` ⇒ `isUnique` e `isIndexed`; `isUnique` ⇒ `isIndexed`.
- `enum` ⇒ `enumValues` sin duplicados ni vacíos; los demás tipos no tienen `enumValues`.
- `defaultValue` vacío se elimina.

`applyFieldRules(field, table)` hace lo mismo **mutando** y además fuerza **una sola PK por tabla** (desmarca las demás). Lo usan `ADD_FIELD`/`UPDATE_FIELD`. El editor de tablas, en cambio, respeta claves compuestas existentes (por ejemplo, tablas intermedias importadas).

`formatDefaultForSql(valor)`: deja tal cual `NULL`, números, funciones conocidas (`CURRENT_TIMESTAMP`, `NOW()`, `UUID()`, `NEWID()`, `GEN_RANDOM_UUID()`…), llamadas `f(...)`, expresiones `( … )` y literales ya entre comillas simples; el resto lo entrecomilla escapando `'`.

## Store (`state/store.ts`)

`createStore(inicial, onPersist)` devuelve `{ getState, subscribe, dispatch }`. `dispatch` aplica el reducer, sincroniza el proyecto activo, persiste y notifica (ver [arquitectura.md](arquitectura.md#flujo-de-datos)).

### Acciones

| Acción | Efecto |
|---|---|
| `ADD_TABLE {name, tableId?, x?, y?}` | Tabla con un campo `id` por defecto. **La UI ya no la usa** (crea con `CREATE_TABLE`); se conserva para usos programáticos |
| `CREATE_TABLE {table, relations, manyToMany}` | Añade una tabla completa, sus FKs y una tabla intermedia por cada N:M, de forma atómica |
| `UPDATE_TABLE {table, relations, manyToMany, removeRelationIds}` | Sustituye la tabla (mismo id). Las FKs salientes se reemplazan por `relations` (salvo N:M antiguas cuyo campo siga existiendo). Se eliminan las relaciones entrantes hacia campos que ya no existen y las de `removeRelationIds`. Crea las N:M indicadas |
| `REMOVE_TABLE {tableId}` | Borra la tabla y todas sus relaciones |
| `RENAME_TABLE {tableId, name}` | Renombra |
| `ADD_FIELD / UPDATE_FIELD / REMOVE_FIELD / MOVE_FIELD` | Operaciones sobre un campo (aplican `applyFieldRules`; `REMOVE_FIELD` borra sus relaciones) |
| `ADD_RELATION {relation}` | Añade si no existe ya ese id |
| `UPDATE_RELATION {relationId, relation}` | Reemplaza; rechaza si choca con otra relación existente |
| `ADD_MANY_TO_MANY {relation, replaceRelationId?}` | Crea la tabla intermedia (y opcionalmente sustituye una relación) |
| `REMOVE_RELATION {relationId}` | Borra |
| `SET_ZOOM {zoom}` | Guarda el zoom (acotado a 0,02–2,5) |
| `UPDATE_TABLE_POSITION {tableId, x, y}` | Mueve una tabla |
| `CREATE_PROJECT / RENAME_PROJECT / DELETE_PROJECT / SWITCH_PROJECT` | Gestión de proyectos (no se puede borrar el último) |
| `IMPORT_PROJECT {project, projectId?, mergeIntoExistingId?}` | Añade un proyecto o reemplaza tablas/relaciones de uno existente |

**Regla**: si una operación de la UI afecta a varias entidades, crea una acción atómica (como `CREATE_TABLE`/`UPDATE_TABLE`) en vez de encadenar dispatch: un solo render, una sola persistencia y estado nunca intermedio.

Selectores útiles: `getActiveProject`, `getTableById`, `getFieldName`.

## Persistencia (`persistence/storage.ts`)

| Clave de `localStorage` | Contenido |
|---|---|
| `dbdesigner.state.v1` | `{ projects, activeProjectId }` |
| `dbdesigner.theme.v1` | `"dark"` o `"light"` |
| `dbdesigner.sidebar.v1` | `"open"` o `"collapsed"` (panel lateral; por debajo de 900 px se ignora y empieza plegado) |

- `loadInitialState`: lee, acepta el formato antiguo (`{tables, relations, zoom}` → un proyecto "Proyecto principal"), normaliza campos y relaciones. **No** mueve coordenadas (el canvas es infinito). Sin datos, crea el proyecto de ejemplo (`domain/defaults.ts`: `users` y `posts`).
- `saveState`: copia el estado activo al proyecto y escribe. Puede lanzar (cuota): `main.ts` lo captura y avisa.

## JSON de proyecto (`persistence/project-io.ts`)

```json
{ "version": 1, "name": "mi_proyecto", "tables": [], "relations": [], "zoom": 1 }
```

- Exportar: `downloadProjectJson(project)` (nombre de archivo saneado).
- Importar: `parseImportedProject` acepta este formato o el antiguo sin `name`; valida tablas (`isValidTable`), normaliza y desplaza las coordenadas para que empiecen en ≥ 24 (`normalizeTablesOrigin`).
- En el panel, si ya existe un proyecto con el mismo nombre, **se reemplazan sus tablas y relaciones**; si no, se crea uno nuevo.
