# Changelog

- Add `compileWorkspaceIncremental`, a delta entry point for consumers that
  compile a whole workspace on every commit. It takes the opaque
  `CompilationCache` the previous call returned and re-parses only the
  documents whose source text changed. Reuse is decided by exact source-text
  equality, never by a caller-declared change set, so a stale cache can only
  fail to save work — it can never alter compiled output (ADR 0091). A
  40-document commit against a 40,000-document workspace costs 684ms instead
  of 9.5s, and `compileWorkspace` and `compileWorkspaceWithProfileContext`
  keep producing byte-identical graphs, profile contexts, and diagnostics.
- Parse each workspace source once. `compileWorkspaceResolved` parsed every
  source twice — once to read its `format` key for profile-versus-document
  classification, then again in its own loop — and re-parsed a document to
  resolve each claim's line and column. Classification now reads the composed
  value the first parse produced, and positions are memoised per document:
  a full compile of 1,000 documents falls 233ms → 154ms and 40,000 falls
  7.9s → 4.6s, with output unchanged byte for byte.

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
