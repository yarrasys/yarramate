# The catalogue deepens honestly

Status: accepted

The internal design catalogue is versioned with the product, and it
grows: 0.4 completes the deep ArchiMate path with technology and
implementation waves. That raises the question the pinned-baseline
lesson from the benchmark predicted: what happens to a model whose
interview was "complete" when the catalogue deepens under it?

Decision (with Nabeel, 2026-08-01): **it honestly reopens, with a
delta annotation and no pinning.**

- Reopening is correct behavior, not breakage. The model did not
  regress; our shared standard of adequacy deepened. A pinned
  catalogue version would let models silently age against the path
  and would add stored state the stateless loop (ADR 0053/0058)
  deliberately refuses.
- Every question records `since: <version>` — the catalogue version
  it first appeared in. The report, the design step, and the
  `ask --open` rendering carry it (`[since 0.4]`), so a harness or a
  human can distinguish "twenty new questions arrived with 0.4" from
  "the model lost ground" without diffing catalogues.
- Semver discipline: a **minor** bump only adds questions or loosens
  triggers; a **major** bump may change or remove triggers, because
  that silently flips the meaning of an existing "complete". The 0.x
  series follows the minor rule from 0.4 onward.
- A question that fires on subjects its author never meant is a
  catalogue defect, not model debt: 0.4's `artifact-unassigned` and
  `deliverable-realizes-nothing` select with `kindMatching: exact`
  after descendant matching pulled in profile-derived documentation
  kinds. Selector precision is part of the additive contract.

0.4 itself: six waves; `component-unhosted` (exact-matched — derived
module kinds inherit their deployable parent's hosting),
`node-serves-nothing`, `technology-service-unrealized`,
`artifact-unassigned`, and four implementation-wave questions over
work packages, deliverables, plateaus, and gaps. A considered
rejection: "every data object needs a materializing artifact" fails
the catalogue's own bar — for result and message data objects the
question changes no decision, so it was not added.
