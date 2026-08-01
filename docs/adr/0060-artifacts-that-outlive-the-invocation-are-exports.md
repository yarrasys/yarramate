# Artifacts that outlive the invocation are exports

Status: accepted

The rule separating `ask` from `export` (ADR 0059, borrowed from
graphify's query/wiki split) needed its second half: `yarramate export`
owns every derived artifact that is persisted for later consumers —
CI outputs, handoff bundles, visualization projects, published
documents. Same renderers as `ask`, opposite intent: nothing `export`
writes is meant to be read back by the invoking agent in the same
breath.

Four artifact kinds, one grammar
(`export <kind> … <workspace.yaml>`):

- **`graph`** — the canonical graph v2 JSON (today's `compile`), to
  stdout for pipelines or `--out` for files.
- **`markdown`** — the human-readable projection document (today's
  `view`), same stdout/`--out` choice.
- **`briefs`** — the handoff bundle the spec-build experiment family
  assembled by hand: one brief (ADR 0055) per projected concept, each
  the concept's one-hop neighbourhood, plus an `INDEX.md`, so N
  implementers each pick up one slice of a checked model. `--budget`
  bounds each brief.
- **`likec4`** — the visualization project. The core delegates to the
  sibling `yarramate-likec4` binary in a separate process: the
  adapter-runtime-dependency exclusion holds because the core never
  imports adapter code, it hands over the invocation. The direct
  binary remains for the adapter's richer forms (`--check`, kind
  mappings, state comparison).

Exports never gate: a failing model fails compilation before any
artifact is written, and a valid model always exports. `check` is the
gate; `export` is the printer.
