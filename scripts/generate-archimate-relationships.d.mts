// Hand-written declarations for the generator, so the freshness test can
// import it under `tsc` without the script itself being compiled.
export interface RelationshipTable {
  readonly version: string
  readonly order: readonly string[]
  readonly rows: Readonly<Record<string, Readonly<Record<string, string>>>>
}

export const RELATIONSHIP_LETTERS: Readonly<Record<string, string>>
export function parseRelationshipsXml(xml: string): RelationshipTable
export function renderModule(table: RelationshipTable, sourceSha256: string): string
export function generate(): string
