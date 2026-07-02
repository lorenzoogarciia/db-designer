# DBDesigner

Diseñador visual de esquemas de base de datos en el navegador. Crea tablas, campos y relaciones con diagrama ERD en vivo, genera SQL (MySQL, PostgreSQL, SQL Server) y exporta proyectos como JSON o PNG.

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

## Arquitectura

```
src/
├── main.ts              # Bootstrap: store, diagrama, UI
├── domain/              # Tipos y reglas de negocio puras
├── state/               # Store con acciones y reducer
├── persistence/         # localStorage e import/export JSON
├── services/            # SQL generator, export PNG
├── diagram/             # Renderizado ERD, zoom, pan, drag
├── ui/                  # Shell, formularios, modales, selects
├── components/          # searchable-select
├── lib/                 # data-types, relation-routing, theme
└── styles/              # CSS
```

## Modelo de datos

### Field

| Propiedad | Tipo | Descripción |
|-----------|------|-------------|
| `id` | string | Identificador único |
| `name` | string | Nombre de columna |
| `type` | string | Tipo lógico (ver `lib/data-types.ts`) |
| `nullable` | boolean | Permite NULL |
| `isPrimary` | boolean | Clave primaria |
| `isUnique` | boolean | Restricción UNIQUE |
| `autoIncrement` | boolean | Autoincremental |
| `isIndexed` | boolean | Índice |
| `enumValues` | string[]? | Valores si `type === "enum"` |

### Table

| Propiedad | Tipo |
|-----------|------|
| `id`, `name` | string |
| `fields` | Field[] |
| `x`, `y` | number (posición en diagrama) |

### Relation

| Propiedad | Tipo |
|-----------|------|
| `id` | string |
| `fromTableId`, `fromFieldId` | string |
| `toTableId`, `toFieldId` | string |
| `kind` | `"1:1"` \| `"1:N"` \| `"N:M"` |

### Project

Contiene `tables`, `relations` y `zoom`. Varios proyectos se guardan en `localStorage` bajo la clave `dbdesigner.state.v1`.

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
- html2canvas (export PNG)
