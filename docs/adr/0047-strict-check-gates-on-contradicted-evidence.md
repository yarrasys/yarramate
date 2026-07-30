# Strict check gates on contradicted evidence

Status: accepted

`yarramate check` deliberately verifies structure and references, not truth:
reconciliation findings are advisory, and "checks pass" was satisfiable over
a model whose confirmed claims the evidence contradicts. A benchmark sweep
showed what that hole costs — agents gated on "checks must pass" saw three
injected contradictions, reported success anyway, and repair only ever
happened where an explicit zero-contradiction criterion existed.

`check --strict` is the one-knob gate for consumers who want contradictions
blocking: CI, benchmark harnesses, and skill acceptance criteria. When the
base check passes, strict mode reconciles the workspace's evidence overlays
and fails the check if any observation is `contradicted`. Each contradiction
is rendered as an ordinary source-located diagnostic (`YM901`) anchored at
the claim the model declares, restating the asserted relationship (ADR 0046)
and the contradicting observation, so the failure is repairable where it is
reported (ADR 0039). `unknown` and `not-observed` stay advisory: absence of
evidence is not contradiction.

The flag is opt-in and the default is unchanged, preserving the epistemic
cut: a plain `check` still answers "is this a well-formed model", never "is
this model true", and reconciliation itself still reports findings without
remediation (ADR 0032). A strict pass also
reports what it evaluated — including that zero evidence observations were
available — because a vacuous gate that looks engaged is exactly the failure
mode this flag exists to close. The machine result gains an additive
optional `strict` summary within `yarramate/check-result/v1`.
