# Seeded slices cap their neighbourhood honestly

Status: accepted

On a dense graph, 1-hop connected expansion is not a focus mechanism:
hub concepts pull in most of the model. The third cross-harness report
measured it — a focused `ask` about boards and lifecycle transitions
reached 243 concepts of a 248-concept model (#132). `--budget` already
bounds the *rendering* (ADR 0042); the selection itself, and therefore
the JSON envelope, stayed unbounded.

Decided: every seeded 1-hop expansion — free-text and subject-seeded
slices, `--advise`, and `--changed` review slices — keeps at most 12
neighbours per seed. Seeds are never dropped, and the capped slice is
always a subset of the uncapped one: the cap removes neighbours and
their edges, it never adds edges the connected expansion would not have
selected. `--neighbours <n>` overrides the cap; `--neighbours 0` lifts
it. Projection-file addressing is untouched — a projection defines its
own query, so an explicit `--neighbours` there is rejected rather than
ignored. Orientation, roster, `--where`, `--next`, `--open`,
`--compare`, and the design/apply/export verbs do not expand and do not
change.

Kept neighbours are materiality-ordered. No materiality ordering for
neighbours existed in the engine — materiality is prose on catalogue
questions — so the closest house notion is reused: the brief's budget
ladder (ADR 0042, ADR 0055), which ranks motivation first, then
planned, current, retired. Ties break on seed affinity (a neighbour
touching more seeds is more material to the slice), then id — the
ordering is deterministic and derived, not scored by any model.

Twelve is an empirical threshold, not a round guess. On this
repository's own model (199 concepts, 268 relationships) the median
degree is 2 and only two subjects exceed 12 neighbours — the `cli` hub
at 27 and `agent-harness` at 19 — so the cap engages precisely where
the explosion lives and leaves every ordinary slice complete. Against
the reported failure, five seeds at twelve neighbours bound the slice
at 65 concepts, about a quarter of that model instead of 98% of it.

What was dropped is announced in the budgeted-ladder voice: a trailing
`[neighbours 12: 2 of 14 neighbours omitted — raise --neighbours or
pass --neighbours 0 for the full neighbourhood]` line in every human
rendering, and an additive optional `neighbourhood` object — cap, kept,
omitted, and per-seed omission counts — in the slice and advice
envelopes, present exactly when the cap bit. `yarramate/ask-result/v1`
is unchanged for every result the cap does not touch; the addition is
additive within v1 per the contract discipline (ADR 0024). Truncation
is never silent, and — unlike `--budget` — JSON mode is not the escape
hatch, because the selection itself is bounded; the announcement
therefore points at the flag, not at `--json`.
