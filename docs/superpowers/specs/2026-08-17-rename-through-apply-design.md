# Design: Rename through `apply`

Issue: [#200](https://github.com/yarrasys/yarramate/issues/200) — "renaming a
concept subject MUST become a real `apply` operation".

## Problem

A local id is part of a subject's address (`document#localId`). Today the only
way to change one is to edit YAML by hand and then hunt every other file that
named the old address. `yarramate/operations/v1` has eleven branches and none of
them can move an id: `update-concept` replaces scalar fields, and `id` is not
among them (`src/apply-command.ts:673-748`, the update branch operates on
`SCALAR_CONCEPT_FIELDS` / `LIST_CONCEPT_FIELDS`, neither of which contains
`id`). The retire-and-duplicate workaround — `delete-concept` plus
`add-concept` with `supersedes` — is a lie about what happened when the id was
simply mistyped, and it cannot be done in one batch anyway: the delete refuses
while anything still references the subject (`YM912`,
`src/apply-command.ts:760-849`).

## The ruling this implements

From the #200 discussion, recorded there and in `docs/BACKLOG-DISPOSITION.md`:

- A rename is an **identity edit**, not a succession. Genuine succession —
  split, merge, responsibility moved — stays `supersedes` (ADR 0080). A
  mistyped id before publication is a Git edit reviewed as a diff.
- Therefore a rename writes **no** `supersedes` entry, retires nothing, and
  duplicates nothing. Both ids do not persist; the old address stops existing.
- The rename is **total within the workspace**: every declarative reference to
  the old address moves with it, in the same atomic batch. Prose is left
  exactly as written — a description that mentions the old name is a human's
  sentence, not an address.

## Grounding — verified in this repo, not assumed

Reference surfaces (scout enumeration cross-checked against the schemas):

| Group | Path | Address space |
|---|---|---|
| document | `concepts/*/id` | subject, bare local (declaration) |
| document | `concepts/*/owner` | subject, bare or qualified |
| document | `concepts/*/distinctFrom/*` | subject, bare or qualified |
| document | `concepts/*/supersedes/*` | subject, bare or qualified |
| document | `concepts/*/constraints/*/ref` | subject, bare or qualified |
| document | `concepts/*/references/*/ref` | subject, bare or qualified |
| document | `concepts/*/attestations/*/by` | subject, bare or qualified |
| document | `relationships/*/id` | subject, bare local (declaration) |
| document | `relationships/*/from` | subject, bare or qualified |
| document | `relationships/*/to` | subject, bare or qualified |
| document | `relationships/*/references/*/ref` | subject, bare or qualified |
| projection | `query/subjects/*` | subject, qualified |
| projection | `query/owners/*` | subject, qualified |
| projection | `query/constraints/*` | subject, qualified |
| evidence | `observations/*/subject` | subject, qualified |
| evidence | `observations/*/claim` | claim = subject + `~aspect` |
| mapping | `mappings/*/native` | subject, qualified |

Deliberately **excluded**, with the reason:

- `states/*/id`, `states/*/after`, `concepts/*/presentIn/*`,
  `relationships/*/presentIn/*`, projection `query/states/*` — these carry the
  same `reference` / `subjectIdentity` *syntax* but address architecture
  **states**, which the compiler keeps in a separate id set
  (`src/compiler.ts:965`, `architectureStateIds`, built from
  `documents.flatMap(states)`, distinct from `subjectIds` at `:970`).
- Every prose field (`name`, `description`, `aka`, `content`), every kind
  (`kind`, `relationshipKinds`, `qualifiedKind`), `mappings/*/external`,
  `attestations/*/recordedBy` (free text, not a reference), and
  `constraints/*/expects/*` (a provider/key/value triple, not an address).
- Profiles (`schema/yarramate-profile.schema.json`) and the core contract hold
  **zero** subject-id fields — verified by counting `qualifiedIdentity` and
  `reference` refs in both schemas: 0 each. They are not scanned.

Other facts the design leans on:

- Claim addresses are `${subject}~aspect` — minted in `src/compiler.ts:1140`,
  `:1785`, `:1802`, `:1846`, `:1886`, etc. So an evidence `claim` value carries
  a suffix that must survive the move.
- `reference` (document group) is `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:#...)?$` —
  bare local **or** qualified. Bare means "this document"; the qualified form
  of a bare value is `${documentId}#${value}`.
- All apply-time refusals carry `YM912` and point at
  `/operations/<i>/document` (`src/apply-command.ts:512-523`).
- The operations schema keeps id fields as `nonEmptyText` on purpose: id
  *patterns* are enforced when the candidate document is validated by the
  compile gate (`src/apply-command.ts:852-865`), so a malformed `to` is
  reported against the document it would have produced.
- `applyOperations` already stages every edit into `candidates` and writes only
  after the whole candidate workspace compiles (`:852-884`). A rename needs no
  new write path — only more candidates.

## The operation

Two branches, already in `schema/yarramate-operations.schema.json` and
`src/operations.ts`:

```yaml
- op: rename-concept
  document: architecture/engine.yaml
  concept: { id: adapter-mapping }
  to: adapter-mappings
- op: rename-relationship
  document: architecture/engine.yaml
  relationship: { id: engine-uses-mapping }
  to: engine-reads-mapping
```

`to` sits at the operation level rather than inside the subject object because
a relationship's own `to` field is an endpoint — nesting would collide.
`concept`/`relationship` is a `subjectTarget` (`{ id }` only): a rename names
what is there rather than restating it, exactly like a delete.

## The engine — one enumeration, one walk

New module `src/subject-references.ts`:

- `SUBJECT_REFERENCE_POSITIONS`: the table above **as data** — `{ group, path,
  form }`, where `path` is a segment pattern (`'*'` = every sequence index) and
  `form` is `declaration` (bare local id in its own document), `reference`
  (bare-or-qualified) or `qualified` (always qualified, may carry `~aspect`).
- One generic walker descends a parsed YAML document by a segment pattern and
  yields the scalar nodes it reaches, with their source ranges.
- `rewriteSubjectReferences(source, group, documentId, from, to)` collects every
  hit whose **qualified address** equals `from`, then splices back-to-front so
  earlier offsets stay valid. Byte-identity elsewhere is preserved: nothing is
  re-rendered, only the matched scalar's own bytes are replaced. A bare value
  stays bare, a qualified value stays qualified, a `~aspect` suffix is kept,
  and an original quote character (`'` / `"`) is preserved.

Comparison is always on the **qualified** address, never on the local id, so a
document that legally declares its own `adapter-mapping` is untouched when
another document's `adapter-mapping` is renamed.

In `applyOperations`, a rename branch:

1. Refuses if the target local id is not declared in the named document
   (`YM912`, same phrasing shape as the delete branch).
2. Refuses if the named document declares a **state** with the old or the new
   local id — the state/subject collision would make the re-point ambiguous.
   The compile gate alone is not enough: it compiles the batch's result, and
   renaming a concept out of an already-ambiguous document leaves a result that
   compiles clean.
3. Rewrites the declaration and every reference in **every** document,
   projection, evidence document and adapter mapping of the workspace, staging
   each changed file into `candidates`. Unchanged files are not staged, so the
   result's `documents` list stays truthful.
4. Bumps `renamedConcepts` / `renamedRelationships`.

The rename runs against candidate text, so renames compose with other
operations in the same batch and with each other (rename A→B then B→C lands as
A→C).

## Refusals

- `YM912` — target not declared; state-id collision on the old or new id.
- `YM913` (new) — **residue**: after rewriting, the enumeration is walked again
  over every candidate and any surviving reference to the old address refuses
  the batch, naming the file and the pointer. This catches a position the
  walker reached but could not splice — an alias node, a merge key, a scalar
  that re-parses to the old value. It cannot see a position the enumeration
  omits; the schema-derived completeness test is what covers that.
- Compile gate — a malformed `to`, or a `to` that collides with an existing
  local id in the same document, is `YM301` "Duplicate local ID" against the
  candidate document.
- Overlay gate — a touched evidence document is re-evaluated against the graph
  the batch just proved compiles, so a re-pointed observation that no longer
  resolves refuses the batch (`src/apply-command.ts:867-880`, unchanged).
- Touched projections and adapter mappings are re-loaded and schema-validated
  before the write (they are not part of `compileWorkspace`'s input), so a
  rewrite that produced an invalid `subjectIdentity` refuses the batch.

## Result

`YarramateApplyResult.applied` gains `renamedConcepts` and
`renamedRelationships` (`src/operations.ts:167-168`,
`schema/yarramate-apply-result.schema.json:21-22,34-35`). Counting renames
under `updated*` would hide the one operation that moves an address.

## Cost, stated

A batch containing a rename parses every document, projection, evidence
document and adapter mapping in the workspace once — this repo's
`.yarramate` is 40-odd files, and the compile gate already re-compiles the
whole workspace on every apply, so the added cost is a fraction of what the
batch already pays. A 40,000-document workspace pays 40,000 parses for a
rename; that is the price of totality, and the alternative — a partial
re-point — is a lost reference, not a saving.

## Proof

- A **schema-derived completeness test**: walk every `$defs` in
  `yarramate-document`, `yarramate-projection`, `yarramate-evidence` and
  `yarramate-adapter-mapping`, collect every position whose type is a subject
  reference (`reference`, `subjectIdentity`, `qualifiedIdentity`,
  `qualifiedSubject`), and assert the set equals
  `SUBJECT_REFERENCE_POSITIONS` plus the recorded exclusion list. A new
  reference field added to a schema without touching the enumeration fails
  this test — that is the guarantee that "total" stays true.
- Apply-level tests for all four groups: a rename that moves an owner, a
  `from`/`to` endpoint, a projection selector, an evidence `claim` with an
  aspect suffix and an adapter mapping's `native`.
- A rename on a scratch copy of this repository's own `.yarramate`, checked
  with `yarramate check --strict` afterwards.

## Not in scope

- Renaming a **document** id, a state id, a profile or a kind.
- Cross-document moves (changing which document declares a subject).
- Prose. A description that names the old id is left as written.
- The visual adapter's dropdown surface for renames: the wire already carries
  `yarramate/operations/v1`, so the browser gains renames when a control is
  added, which is a separate, smaller change.
