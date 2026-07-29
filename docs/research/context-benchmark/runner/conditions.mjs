// Condition definitions for the context benchmark (DESIGN.md, "Conditions").
// B and C share one verbatim instruction string: the agent must not be able to
// tell a stale model from a fresh one by prompt text ("Prompt leakage" threat).

const BASE = 'Work in the repository at the current directory.';

// Model-bearing workdirs additionally carry the AGENTS.md pointer that
// `yarramate init` writes (ADR 0040): an adopted repository advertises its
// workspace to agent harnesses, so B/C mirror an adopted repository rather
// than a bare model drop. The pilot (2026-07-29) ran without the pointer and
// the weak tier never discovered the workspace; the instruction text below is
// unchanged so prompt neutrality is preserved.
const MODEL_AVAILABLE =
  `${BASE} It contains a committed .yarramate architecture workspace; the ` +
  'yarramate CLI is installed and can query it (status, context, check).';

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
