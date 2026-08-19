// Condition definitions for the context benchmark (DESIGN.md, "Conditions").
// B and C share one verbatim instruction string: the agent must not be able to
// tell a stale model from a fresh one by prompt text ("Prompt leakage" threat).

const BASE = 'Work in the repository at the current directory.';

// Model-bearing workdirs additionally carry the AGENTS.md pointer that
// `yarramate init` writes (ADR 0040): an adopted repository advertises its
// workspace to agent harnesses, so B/C mirror an adopted repository rather
// than a bare model drop. The pilot (2026-07-29) ran without the pointer and
// the weak tier never discovered the workspace.
//
// Harness v3: the 2026-07-29 sweep's text named `status` and `context`, both
// removed by the 0.7.0 seven-verb break (ADR 0061); an instruction telling the
// agent to run verbs that exit with a usage dump is a harness defect, not a
// frozen artifact. The named query surface is now the current one. B and C
// still share the string byte for byte.
const MODEL_AVAILABLE =
  `${BASE} It contains a committed .yarramate architecture workspace; the ` +
  'yarramate CLI is installed and can query it (ask, check, reconcile).';

export const CONDITIONS = {
  A: {
    description: 'baseline: repository and prose docs only',
    instruction: `${BASE} Its README and documentation are available.`,
    model: 'none',
    families: ['comprehension', 'change'],
  },
  B: {
    description: 'yarramate: committed model + CLI available',
    instruction: MODEL_AVAILABLE,
    model: 'fresh',
    families: ['comprehension', 'change', 'model-maintenance'],
  },
  C: {
    description: 'stale: model with injected contradicted claims',
    instruction: MODEL_AVAILABLE,
    model: 'stale',
    families: ['comprehension', 'change', 'model-maintenance'],
  },
};
