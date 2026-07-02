import type { FkReferentialAction, Relation } from "./types.ts";

export const FK_REFERENTIAL_ACTIONS: FkReferentialAction[] = [
  "NO ACTION",
  "RESTRICT",
  "CASCADE",
  "SET NULL",
  "SET DEFAULT",
];

export const DEFAULT_ON_DELETE: FkReferentialAction = "NO ACTION";
export const DEFAULT_ON_UPDATE: FkReferentialAction = "NO ACTION";

export type RelationInput = Omit<Relation, "onDelete" | "onUpdate"> & Partial<Pick<Relation, "onDelete" | "onUpdate">>;

export function isFkReferentialAction(value: string): value is FkReferentialAction {
  return FK_REFERENTIAL_ACTIONS.includes(value as FkReferentialAction);
}

export function buildRelationId(
  fromTableId: string,
  fromFieldId: string,
  toTableId: string,
  toFieldId: string,
): string {
  return `${fromTableId}_${fromFieldId}__${toTableId}_${toFieldId}`;
}

export function normalizeRelation(raw: RelationInput): Relation {
  const onDelete = raw.onDelete && isFkReferentialAction(raw.onDelete) ? raw.onDelete : DEFAULT_ON_DELETE;
  const onUpdate = raw.onUpdate && isFkReferentialAction(raw.onUpdate) ? raw.onUpdate : DEFAULT_ON_UPDATE;
  return {
    ...raw,
    onDelete,
    onUpdate,
  };
}

export function normalizeRelations(relations: RelationInput[]): Relation[] {
  return relations.map((relation) => normalizeRelation(relation));
}

export function formatFkReferentialActions(relation: Pick<Relation, "onDelete" | "onUpdate">): string {
  const clauses: string[] = [];
  if (relation.onDelete) clauses.push(`ON DELETE ${relation.onDelete}`);
  if (relation.onUpdate) clauses.push(`ON UPDATE ${relation.onUpdate}`);
  return clauses.length > 0 ? ` ${clauses.join(" ")}` : "";
}
