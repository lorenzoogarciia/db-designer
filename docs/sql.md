# SQL: generación e importación

Ficheros: `services/sql-generator.ts`, `services/sql-parser.ts`, `lib/data-types.ts`, `domain/field.ts` (`formatDefaultForSql`), `ui/modals/sql-modal.ts`, `ui/modals/sql-import-modal.ts`.

## Generación (`generateSql(proyecto, dialecto)`)

Dialectos: `mysql`, `postgresql`, `sqlserver`. En la UI primero se eligen las tablas (`filterProjectByTableIds` descarta las relaciones con extremos fuera de la selección).

### Pasos

1. `expandManyToMany`: las relaciones N:M antiguas pasan a ser tablas intermedias virtuales.
2. **Campos "en clave"**: PK, UNIQUE, indexados y los dos extremos de cada FK. En ellos se sustituyen los tipos que esos motores no pueden indexar:
   - MySQL: `TEXT`/`*TEXT` → `VARCHAR(255)`, `*BLOB` → `VARBINARY(255)`.
   - SQL Server: `NVARCHAR(MAX)` → `NVARCHAR(450)`, `VARBINARY(MAX)` → `VARBINARY(900)`.
   - JSON, GEOMETRY, POINT y XML en claves generan un aviso.
3. **Relaciones 1:1**: la columna FK recibe `UNIQUE`.
4. **Orden de creación** (`orderTablesByDependencies`): cada tabla después de las que referencia. Ante un ciclo se coloca la primera pendiente y esas FKs se añaden al final con `ALTER TABLE … ADD CONSTRAINT` (SQL Server con guarda `IF OBJECT_ID(…, N'F') IS NULL`). Las autorreferencias van dentro del `CREATE TABLE`.
5. **FKs con nombre**: `fk_<tabla>_<campo>`, únicos y truncados a 60 caracteres (límite común a los tres motores). Índices: `idx_<tabla>_<campo>`.
6. Columnas: `nombre TIPO NULL|NOT NULL [DEFAULT …]` (PK y autoincrementales siempre NOT NULL), seguidas de `PRIMARY KEY (…)`, `UNIQUE (…)`, índices (MySQL en línea; PostgreSQL y SQL Server como `CREATE INDEX` aparte) y FKs.
7. **Cabecera de comentarios**:
   - `-- AVISOS` para problemas detectables: tipos distintos entre FK y destino, `SET NULL` sobre columna NOT NULL, FK hacia columna no PK/UNIQUE, tipo no indexable.
   - `-- NOTAS` para sustituciones y adaptaciones.

### Diferencias por dialecto

| | MySQL | PostgreSQL | SQL Server |
|---|---|---|---|
| Identificadores | `` `a``b` `` | `"a""b"` | `[a]]b]` |
| Crear | `CREATE TABLE IF NOT EXISTS` | `CREATE TABLE IF NOT EXISTS` | `IF OBJECT_ID(N'[t]', N'U') IS NULL BEGIN … END;` |
| Autoincremental | `INT/BIGINT AUTO_INCREMENT` | `SERIAL/BIGSERIAL` | `INT/BIGINT IDENTITY(1,1)` |
| Enum | `ENUM('a','b')` | `TEXT CHECK (col IN (…))` | `NVARCHAR(128) CHECK (…)` |
| `RESTRICT` | sí | sí | → `NO ACTION` |
| `SET DEFAULT` | → `NO ACTION` + nota (InnoDB no lo soporta) | sí | sí |
| Literales | `'x'` | `'x'` | `N'x'` |

`DEFAULT` adaptado (`adaptDefault`):
- SQL Server: `TRUE/FALSE` → `1/0`, `NOW()` → `GETDATE()`, UUID → `NEWID()`.
- PostgreSQL y MySQL: `GETDATE()` y similares → `CURRENT_TIMESTAMP`.
- MySQL: UUID → `(UUID())`; en TEXT/BLOB/JSON/GEOMETRY el valor va entre paréntesis, porque MySQL 8 solo admite ahí expresiones.

## Importación (`parseSqlSchema(texto)`)

Devuelve `{ tables, relations, warnings }`, con tablas ya colocadas en rejilla (`layoutImportedTables`, primero las referenciadas).

### Tokenizador

- Ignora los comentarios `--`, `#` y `/* */`.
- Cadenas: `'…'` con `''` y `\` como escapes, los prefijos `N'`, `E'`, `B'`, `X'` y `_charset'`, y las *dollar quotes* de PostgreSQL.
- Identificadores: `"…"`, `` `…` `` y `[…]`.
- Reconoce números, palabras y el operador `::`.

### Sentencias reconocidas (el resto se ignora)

- `CREATE [TEMP…] TABLE [IF NOT EXISTS] nombre (…)`, con columnas y restricciones de tabla (`CONSTRAINT`, `PRIMARY KEY`, `UNIQUE [KEY|INDEX]`, `KEY`/`INDEX`, `FOREIGN KEY … REFERENCES`, `CHECK`).
- `ALTER TABLE [ONLY] t ADD [COLUMN]|ADD CONSTRAINT …` y `ALTER COLUMN … SET DEFAULT | ADD GENERATED | SET NOT NULL`, incluido el estilo de `pg_dump` y `WITH CHECK ADD` de SQL Server.
- `CREATE [UNIQUE] [CLUSTERED|NONCLUSTERED] INDEX … ON t [USING …] (cols)`.
- `CREATE TYPE x AS ENUM (…)`: los tipos enum de PostgreSQL se aplican a las columnas que los usan.
- Separadores: `;` y `GO`. Funciona con envoltorios como `IF … BEGIN … END`.

### Columnas

- **Tipos**: `mapSqlType` traduce decenas de nombres al catálogo; los desconocidos pasan a `text` con aviso.
- **Casos especiales**:
  - `TINYINT(1)`/`BIT` → `boolean`.
  - `CHAR(36)` → `uuid`.
  - `VARCHAR(MAX)` → `text`.
  - `FLOAT(>24)` → `double`.
- **Autoincremento**: `AUTO_INCREMENT`, `IDENTITY`, `SERIAL`, `GENERATED … AS IDENTITY` y `DEFAULT nextval(…)`. Un entero autoincremental que es la única PK pasa a ser `id` (`bigserial` si es `bigint`).
- **DEFAULT**: quita casts `::tipo` y paréntesis exteriores (`((1))` → `1`).
- **Enums por CHECK**: `col IN ('a', 'b')` o `col = ANY (ARRAY[…])` sobre una sola columna convierten esta en `enum`.

### Relaciones

Cada FK (en columna, de tabla o por `ALTER`) se resuelve al final:
- Sin columnas de destino, apunta a la PK.
- Las compuestas se importan como una relación por columna, con aviso.
- Tipo `1:1` si la columna FK es UNIQUE o es la PK única; si no, `1:N`.

### Avisos (no bloquean la importación)

Tipos desconocidos, columnas calculadas, índices o UNIQUE compuestos (se importan como índices individuales), PK compuestas (se conservan), FKs hacia tablas que no están en el script, tablas duplicadas y CREATE sin columnas.

**No se modela**: longitudes y precisiones, índices y UNIQUE compuestos, columnas calculadas, vistas, triggers, secuencias, esquemas (se queda la última parte del nombre).

### Garantía de *round-trip*

`sql-parser.test.ts` genera SQL de un proyecto con FK, enum, defaults y tabla intermedia en los tres dialectos, lo vuelve a importar y comprueba tablas, tipos, defaults, índices y relaciones. **Cualquier cambio en el generador debe mantener este test en verde.**

## UI

- *Generar SQL* (panel): MySQL / PostgreSQL / SQL Server → elegir tablas → modal con el SQL y botón *Copiar*.
- *Importar SQL* (menú *Importar* de la barra superior, o el estado vacío del lienzo): pegar o cargar `.sql`; vista previa en vivo (con 250 ms de espera) con el recuento y los avisos; importar como proyecto nuevo o reemplazar el actual (con confirmación). Después se encuadra el diagrama.
