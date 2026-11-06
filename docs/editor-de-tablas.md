# Editor de tablas (crear y editar)

Ficheros: `domain/table-draft.ts` (puro), `ui/modals/table-editor-modal.ts`, `state/store.ts` (`CREATE_TABLE`, `UPDATE_TABLE`), `diagram/layout.ts` (`placeNearRelated`).

Un único modal para crear y editar tablas: nombre, campos, claves foráneas y relaciones N:M en un solo paso. Sustituye al flujo antiguo (crear la tabla, luego cada campo, luego cada relación). Los formularios *Nuevo campo* y *Nueva relación* del panel siguen existiendo para cambios puntuales.

## Puntos de entrada

| Acción | Abre |
|---|---|
| Botón *+ Nueva tabla* (barra del diagrama), tecla `N` (fuera de campos de texto y sin modales abiertos) | Creador |
| Formulario *Nueva tabla* del panel | Creador con el nombre escrito |
| Doble clic en zona vacía del canvas | Creador; si la tabla no tiene relaciones, se coloca en ese punto |
| Botón *Editar* de la tarjeta, doble clic en la tarjeta | Editor de esa tabla |

`wireTableEditorModal(store, diagram)` devuelve `{ openTableCreator(options?), openTableEditor(tableId) }`. El modal se construye con `createElement` (sin `innerHTML` con texto del usuario) y actualiza cada fila en su sitio (`syncRow`) para no perder el foco mientras se escribe.

## Borrador (`TableDraft`)

```ts
TableDraft { tableId?, name, fields: FieldDraft[], manyToMany: ManyToManyDraft[] }
FieldDraft { key, sourceFieldId?, name, type, nullable, isPrimary, isUnique, isIndexed, autoIncrement,
             defaultValue, enumValues /* texto "a, b" */, reference: FieldReferenceDraft | null, referenceTouched }
FieldReferenceDraft { tableId, fieldId, kind: "1:N" | "1:1", onDelete, onUpdate,
                      source?: { relationId, tableId, fieldId } }
```

- `key`: identifica la fila en la UI. `sourceFieldId`: id del campo original al editar.
- `referenceTouched`: si es `true`, la referencia ya no se sugiere sola al cambiar el nombre (se marca al elegirla a mano y en todos los campos existentes al editar).
- `source`: relación de la que procede la referencia; su id se reutiliza mientras apunte al mismo campo.

Funciones:

| Función | Qué hace |
|---|---|
| `createTableDraft(nombre)` | Borrador nuevo: campo `id` autoincremental + una fila vacía |
| `draftFromTable(tabla, relaciones)` | Borrador de una tabla existente: campos con sus ids y FKs salientes (no N:M) como referencias |
| `suggestReference(nombreCampo, tablas)` | `cliente_id`, `clienteId`, `id_cliente`, `fk_cliente` → tabla `cliente`, `clientes`, `clientees`, `…ies`, `…ces` o con prefijo (`sport_clientes`); apunta a su PK (o a `id`) |
| `applyReferenceType(campo, tablas)` | Ajusta el tipo al del campo referenciado (`foreignKeyTypeFor`), indexa y, si es 1:1, marca UNIQUE. **No quita la PK** (PK compartida 1:1, claves compuestas) |
| `validateTableDraft(borrador, tablas)` | Errores: sin nombre, nombre en uso (excluye la propia tabla), sin campos, campos repetidos, referencia a tabla inexistente. Avisos: sin PK, `SET NULL` sobre NOT NULL |
| `buildTableFromDraft(borrador, tablas, tableId?)` | Tabla final (filas sin nombre se ignoran; conserva ids de campos y la posición original), sus relaciones FK y las N:M a crear |
| `lostIncomingRelations(borrador, relaciones)` | Relaciones de otras tablas que apuntan a campos que el borrador elimina |
| `relatedTableIds(borrador)` | Tablas con las que se relacionará (para colocarla cerca) |

## Comportamiento del formulario

- **Fila de campo**: ↑/↓ · nombre · tipo (select nativo con grupos) · NULL / PK / UQ / IDX · por defecto · referencia (select agrupado por tabla, PK primero) · quitar. Subfilas:
  - **Valores del enum**, si el tipo es `enum`.
  - **Relación**, si hay referencia: destino, tipo 1:N o 1:1 y `ON DELETE`. Si se eligió `SET NULL`, el campo pasa a admitir NULL.
- **Reglas de la UI**:
  - La PK es exclusiva al marcarla.
  - Los tipos autoincrementales marcan PK, NOT NULL y quitan el valor por defecto y la referencia.
  - Al asignar una referencia por primera vez el campo pasa a NOT NULL (se puede desmarcar).
  - Si desaparece una referencia sugerida, el tipo vuelve a `varchar`.
- **Teclado**: Enter en el nombre de la tabla va al primer campo vacío; Enter en un campo pasa al siguiente o crea uno nuevo; Ctrl/Cmd + Enter guarda; Esc cierra.
- **Muchos a muchos**: filas tabla + `ON DELETE` (por defecto `CASCADE`); el texto muestra el nombre de la tabla intermedia que se creará.
- **Solo al editar**:
  - Sección *Referenciada por*: relaciones entrantes con *Quitar*/*Deshacer*. Muestra "se perderá" si se borra el campo al que apuntan.
  - Botón *Eliminar tabla*, con confirmación.

## Guardado

**Crear**:
1. Validar.
2. `buildTableFromDraft`.
3. Colocar con `placeNearRelated`: hueco libre más cercano al centro de las tablas relacionadas, usando los anchos medidos (`diagram.getTableWidth`). Sin relaciones, el punto del doble clic o el centro de la vista.
4. `dispatch(CREATE_TABLE)`.
5. `diagram.focusTable` (anima, acerca a un zoom legible y resalta) y aviso.

**Editar**:
1. Validar.
2. Si hay relaciones entrantes que se perderán y no están marcadas para quitar, pedir confirmación listándolas.
3. `buildTableFromDraft` con el mismo id.
4. `dispatch(UPDATE_TABLE, removeRelationIds = quitadas)`.
5. `diagram.revealTable` y aviso.

Al editar se garantiza:
- Renombrar o reordenar campos conserva sus ids, así que las relaciones entrantes se mantienen.
- Guardar sin cambios deja tabla y relaciones idénticas (ids incluidos).
- La posición no cambia.
- Las relaciones N:M antiguas que salen de la tabla se conservan si su campo sigue existiendo.

Tests: `domain/table-draft.test.ts` (creación, sugerencias, colocación) y `domain/table-edit-draft.test.ts` (edición, relaciones entrantes, PK compuesta).
