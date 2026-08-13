# Changelog

## 0.19.0

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
