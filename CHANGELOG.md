# Changelog

## 1.0.0

- **Breaking.** Relationship endpoints are validated against the ArchiMate
  3.2 relationship table (ADR 0097), vendored from Archi's `relationships.xml`
  (MIT) and regenerated into a zero-import module a test keeps honest. The
  four aspect rules from ADR 0004 accepted 64% of the kind-pair combinations
  the table rejects and refused 1,803 it permits, `triggering` between
  active-structure elements among them; a workspace carrying a forbidden
  edge now fails `check` with `YM404`, which names the pair and the kinds
  the table does permit. The repository's own model carried 13 such edges
  and the shipped fixtures 12, every one a folded field or a direction
  error. Migrate with `access` where behaviour produces passive structure,
  `artifact -realization-> dataObject` where a file gives a data object its
  form, `node -realization-> applicationComponent` for "deployed on", a
  swapped direction where a capability was realized by what it realizes,
  and `association` where nothing stronger carries the meaning. New `YM414`:
  every relationship on one junction must be the same kind. Product,
  plateau, and gap are composite, and only grouping draws dashed.
  `ask --kinds` reports the aspect shadow for all eleven kinds and the packed
  table as `relationshipMatrix`. `inspiredBy` values read `archimate:`.
  Catalogue `core-enrichment` goes to 1.0 (ADR 0098): seven questions that
  prescribed forbidden shapes are retargeted, the application service joins
  the interaction wave and is asked what data it accesses, and
  `kind-untested` asks whether a subject's relationships would survive
  reclassification to another aspect. The skill retires the degraded-edge
  pattern. Positioning: the core profile implements the ArchiMate vocabulary
  and relationship table; the custody layer is additive; not affiliated with
  or certified by The Open Group.
- **Breaking.** Visual session paths are published as canonical local `file:`
  URIs rather than bare path strings (ADR 0096). `sessionRoot`,
  `descriptorPath`, `journalPath`, and `transcriptPath` are encoded with
  `pathToFileURL` and decoded with `fileURLToPath`, refusing anything
  malformed, nonlocal, or noncanonical as `YMVS414` before a descriptor's
  bearer capabilities are read. This closes two defects the old
  backslash-to-slash transform could not: two distinct native paths could
  produce one indistinguishable wire string, and a UNC path passed as an
  ordinary local one. `yarramate/visual-protocol/v3` becomes `v4`;
  `visual-session-started`, `visual-session-descriptor`, and `visual-handoff`
  become `v2`; the eight documents that carry no path stay at `v1`. A v3
  document is refused, never translated. `yarramate-visual
  wait|respond|status|recover|stop` now take the exact `descriptorPath` URI
  `start` published, copied back verbatim: a native path is refused, and the
  argument is no longer resolved against the working directory (#208).

## 0.23.0

- Interrogation: `has-linkage`, `exists-linkage` (`direction` includes
  `either`), `missing-constraint`, and `missing-flow-content` conditions.
  Questions that name kinds from a profile no document has selected are
  omitted from the report rather than reported closed or stuck open.
  `no-subject-of-kind` honours `kindMatching` (default `descendants`), a
  loosening of `outcome-missing`, `stakeholders-missing`,
  `constraints-missing`, and `no-service-declared` for profile-derived
  kinds.
- Ship `yarramate/policy@0.1` as a built-in optional profile (ADR 0095):
  `authentication-constraint`, `rate-limit-constraint`,
  `reliability-constraint`, `mechanism-constraint`. Select it on a
  document; do not copy a file. Catalogue `core-enrichment` 0.9 adds an
  `interaction` wave before business so hop questions rank ahead of
  `owner-missing`.

## 0.22.0

- Export a Workers-safe visual-graph projector as
  `yarramate/adapter/visual-graph` (`projectGraphForCanvas`) and a
  renderer-neutral ArchiMate notation vocabulary as
  `yarramate/notation/archimate` (layer colours, aspect shapes, kind glyphs,
  relationship line styles). The local visual app consumes the same
  vocabulary. `canvasNode.layer` / `aspect` in
  `yarramate/visual-graph/v1` are closed on the profile enums (plus null).
  No session-protocol or apply changes (#201).

- Correct the conservative-extension property in `docs/PROFILES.md` and ADR
  0079. It was published as one statement — loading a profile extension adds
  subjects and never changes verdicts — quantified over the profile together
  with any documents that select it, and quantified that way it is false: an
  extension document declaring `orders` with a realization to a pre-existing
  goal resolves that goal's `goal-unrealized` question, and so does the same
  document written in plain core. It is now two properties: a vocabulary
  nobody selects changes nothing, and an extension document is never a worse
  neighbour than its core twin — the same subjects declared under the nearest
  core ancestor of each kind it uses. The first keeps its degenerate-case
  identity test; the second is measured by control, running one arrival
  through an extension kind and through its core twin and comparing the
  verdict changes about pre-existing subjects, with a witness that the
  inclusion is strict: exact-kind bucketing leaves a near-duplicate question
  closed where the core twin opens it. No engine change — the properties hold,
  the single sentence overclaimed (#172).

## 0.21.0

- Move a subject's local id through `apply`. Two operations,
  `rename-concept` and `rename-relationship`, re-point the declaration and
  every declarative reference to it — across documents, projections, evidence
  overlays and adapter mappings — in one atomic batch. A rename is an identity
  edit, not a succession: it writes no `supersedes` entry and retires nothing,
  because one subject kept its identity and changed its address (ADR 0094).
  Only matched scalars' own bytes change, so a bare reference stays bare, a
  qualified one stays qualified, an `~aspect` suffix is preserved, and the
  original quoting is kept; comparison is on the qualified address, so a
  same-local id in another document is untouched. Refused when the id is not
  declared, when `to` equals the current id, when the document declares an
  architecture state with the old or new local id, when a reference position
  holds a YAML alias, and — by the compile gate, before a byte is written —
  when the new local id is already taken. New diagnostic `YM913`: `apply`
  re-reads every file it touched and refuses if any of them still names an
  address a rename moved off. The apply result gains `renamedConcepts` and
  `renamedRelationships` counters.
- Walk the staged visual changeset back and forward. The tray gains Undo and
  Redo beside Discard all, over an ordered history of whole staged-operation
  snapshots: staging replaces on a repeated `(target, field)`, so an inverse
  operation would have nothing left to restore a value a re-edit had already
  overwritten, and re-editing one field twice then undoing once now returns
  the earlier edit rather than skipping to the model's own value (ADR 0092).
  Staging, discarding one row, and discarding all are undoable by the same
  mechanism; a refused commit keeps the rows and both stacks; a landed batch
  empties them, because what has landed is reverted with `git revert`, never
  from the browser. Index-attributed commit diagnostics are dropped whenever
  the staged rows move, so row 1's error is never redrawn against whatever now
  occupies row 1. Local state only: the stacks never reach the wire.
- Refuse a visual commit staged against bytes another writer has replaced. Each
  staged row pins the sha256 the browser rendered for the document it targets,
  taken from the model frame the row was staged against and never refreshed
  from a later one, and the commit carries those pins as
  `sourceDigests`. The server checks every document the batch targets — not
  just every pin sent, so a batch that vouches for nothing is refused rather
  than trusted — and answers a mismatch with preserve-and-refresh: the rows
  stay staged, the freshly compiled model is broadcast, and the affected rows
  are marked with the value that is there now. Two reviewers editing the same
  field previously produced one silent overwrite reported as landed (ADR 0093).
  New diagnostics `YMVS312` (a pinned document changed or is gone) and
  `YMVS313` (an existing targeted document was left unpinned).
- **Breaking:** the wire is `yarramate/visual-protocol/v3`.
  `VisualChangesetCommitPayload.sourceDigests` is required, so a v2 browser's
  commit is refused rather than written unconditionally, and
  `VisualRenderedModel` now forwards the per-document `sourceDigests` the
  session request already minted.

## 0.20.0

- Add `compileWorkspaceIncremental`, a delta entry point for consumers that
  compile a whole workspace on every commit. It takes the opaque
  `CompilationCache` the previous call returned and re-parses only the
  documents whose source text changed. Reuse is decided by exact source-text
  equality, never by a caller-declared change set, so a stale cache can only
  fail to save work — it can never alter compiled output (ADR 0091). A
  40-document commit against a 40,000-document workspace costs 698ms instead
  of 5.4s, and `compileWorkspace` and `compileWorkspaceWithProfileContext`
  keep producing byte-identical graphs, profile contexts, and diagnostics.
- Parse each workspace source once. `compileWorkspaceResolved` parsed every
  source twice — once to read its `format` key for profile-versus-document
  classification, then again in its own loop — and re-parsed a document to
  resolve each claim's line and column. Classification now reads the composed
  value the first parse produced, and positions are memoised per document:
  a full compile of 1,000 documents falls 233ms → 193ms and 40,000 falls
  7.9s → 5.3s, with output unchanged byte for byte.
- Refuse a LikeC4 export whose selected concepts never reach the emitted
  model. `likec4 validate` reads an empty model as valid, so the emitter was
  the only place that could notice a projected concept silently missing from
  the generated text; it now compares the assembled definition lines against
  the projection and reports `YMLC112`, located at the concept that went
  missing. `YMLC111` joins the published diagnostic envelope, which never
  admitted the code its own relationship-gap report emits, and `pnpm validate`
  runs `export-project --check` before handing the directory to
  `likec4 validate`, which passes vacuously on absent output. `likec4` is
  pinned to the exact `1.59.2` the docs already name, so the grammar oracle
  cannot drift away from the emitter under a caret range.
- Delete a visual session's entries in a decided order. Recursive removal
  rejects on the first entry that refuses deletion while the sibling
  deletions it already started are still in flight, so a failed cleanup could
  still take `journal.jsonl` with it and leave the retry the failure invites
  nothing to recover from — 40 of 40 runs lost the journal on Linux Node 22,
  8 of 40 on macOS, which is why the suite was green here and red there.
  Removal now walks one awaited entry at a time and keeps back the journal a
  retry reads and the marker that authorises deleting the directory at all.

## 0.19.0

- Render and edit the native model in the browser. `yarramate-visual` now
  draws the compiled graph v2 model directly with cytoscape.js — no LikeC4
  DSL, no compiler round-trip, no external renderer to resolve or consent to.
  Inspector fields are constrained to what the model allows, edits stage as a
  changeset, and **Commit changes** lands them as one `yarramate/operations/v1`
  batch through the same validated `yarramate apply` write the CLI performs;
  a refused batch writes nothing and shows the diagnostics on the row that
  caused them. The runtime never runs `git commit`, so Git review still
  decides what becomes declared architecture. Dragged positions persist per
  projection in `.yarramate/visual-layout/` sidecars. The wire is
  `yarramate/visual-protocol/v2`: the agent's `model.replace` mutation path is
  gone, so a v1 child is refused rather than misread (ADRs 0084 to 0088).
- Resolve a chat-issued filter server-side against the compiled graph. A
  delegated agent sets `appliedQuery: { query }` and the runtime evaluates the
  `ProjectionQuery`, so the panel and the chat agent can no longer produce two
  different match sets for one query; an agent-supplied `matchedIds` is
  refused with `YMVS311`. A chat-issued narrowing is badged with the query
  that produced it and dismissible in one click (ADR 0090).
- Land evidence observations through `yarramate apply`. An observation is a
  write addressed by its `(target, key)` pair, batched and validated with
  every other operation rather than written by a separate path (ADR 0089).
- Rename the question catalogue's `authority: evidence` to `agent`, matching
  the runtime, `yarramate-interrogation-report/v1`, and `docs/INTERROGATION.md`.
  A catalogue that declared `evidence` passed catalogue validation and then
  produced a report that failed its own schema; the shipped catalogue never
  used the value, so no interview changes.
- Add the `unconstrained-kind` trigger condition and a `kind-untested` hygiene
  question (core-enrichment 0.7 → 0.8): a subject whose kind is pinned by no
  relationship claim could be reclassified freely and still compile, so the
  interview asks rather than the engine inferring (ADR 0083). 153 of the
  repository's own 238 concepts carry such a kind; the shipped question is
  scoped to active-structure, where it opens 4.
- Publish `relationshipKindEndpointAspects` on `ResolvedProfileContext`, the
  lineage-resolved table of which endpoints each relationship kind constrains.

## 0.18.0

- Resolve `attestations[].by` as a subject reference, reusing `YM304` when it
  does not resolve, instead of accepting free text: an authority has to be
  someone the model already knows (ADR 0082). Documents whose `by` is a name
  rather than a reference no longer compile.
- Add optional `attestations[].recordedBy` naming whoever held the pen.
  `apply` requires it on every attestation an operations batch writes, since a
  batch is by construction a machine's transcription of someone's judgment.
- Report `unconfirmed-attestation` from `reconcile`, with a matching
  `summary.unconfirmedAttestations` counter, when a record names a recorder
  other than its attesting authority. Advisory like `stale-attestation`:
  `check --strict` is unaffected.
- Render the recorder beside the authority in `export rtm` attestation cells.

## 0.17.0

- Add the `yarramate-visual` adapter (beta): a sibling runtime that renders
  LikeC4 diagrams of a bounded slice in a local, authenticated browser
  session and delegates a chat conversation about what is on screen to a
  visual agent, over a published, closed `yarramate/visual-*/v1` contract.
  Git review remains responsible for accepting any resulting architecture
  proposal; the runtime never becomes canonical architecture by itself.

## 0.16.0

- Add optional profile concept-kind layers and layer-aware projections.
- Add bounded, directional connected expansion and deterministic presentation metadata.
