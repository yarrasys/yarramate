// Condition definitions for the context benchmark (DESIGN.md, "Conditions").
// B and C share one verbatim instruction string: the agent must not be able to
// tell a stale model from a fresh one by prompt text ("Prompt leakage" threat).

const BASE = 'Work in the repository at the current directory.';

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
