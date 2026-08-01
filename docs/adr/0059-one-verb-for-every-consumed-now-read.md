# One verb for every consumed-now read

Status: accepted

Four sibling commands existed just to read the model — `status`,
`context`, `next`, `compare` — plus `interrogate` for the open-questions
report, and none of them answered the two questions agents actually
arrive with: "where do I start when I only have words, not a subject
id?" and "what would the architect say about this?". Every read surface
demanded structural addressing — an exact qualified id or a pre-authored
projection — so the model was unreachable without already knowing its
contents.

`yarramate ask <workspace>` is the one entry point for every read whose
output is consumed now by the asking agent; anything persisted for later
consumers belongs to `export` (the graphify query/wiki split). Its modes
share one envelope, `yarramate/ask-result/v1`, discriminated by `mode`:

- **Orientation** (bare): the check verdict, the reconciliation summary,
  the open-question count from the internal design catalogue, and the
  backlog — planned subjects in dependency order first, because "what
  should happen next" is the question orientation exists to answer.
  This is also the one-call model verdict: state, drift, and remaining
  interview in a single read.
- **Free-text slices** (default addressing): query terms match concept
  ids, names, and descriptions; matching concepts seed the existing
  one-hop connected-neighbourhood machinery, rendered as a brief
  (ADR 0055), a budgeted digest, or JSON. Deterministic term matching,
  no LLM in the engine — exact subject ids and projection files
  short-circuit to precise addressing, so the precise modes are special
  cases of the general one, not separate grammars.
- **`--subjects`**: the filterable roster the seeding matches against —
  the discovery surface every other flag depends on.
- **`--advise <topic>`**: the expert composition. The engine
  deterministically assembles the slice, the open questions touching it,
  and the evidence drift into one context block; the LLM on top answers
  *as* the architect. The engine composes ground truth and stops — it
  never advises (ADR 0054).
- **`--next`**, **`--open`**, **`--compare`**: the build order, the full
  interrogation report, and the state delta, unchanged in substance,
  reachable without learning three more command grammars.

Consolidation, not addition: `status`, `context`, `next`, `compare`,
and `interrogate` remain until the 0.7.0 clean break removes them, and
`ask` reuses their machinery rather than reimplementing it — one
ordering algorithm, one catalogue evaluation, one slice renderer.
