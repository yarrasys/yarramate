# Open questions are recomputed, never stored

Status: accepted

The enrichment interview needs a gap engine: something that tells an agent
which design questions a model has not yet answered, so the conversation with
the human is driven methodically instead of by whatever the agent happens to
think of. Measured head-to-head on a deliberately thin prompt, a capable
agent asked twelve good functional questions and not one motivation
question; the catalogue's first wave is entirely the questions freehand
elicitation never reached. The research catalogue and reference evaluator
proved the mechanism; `yarramate interrogate` promotes it to the stable CLI.

A question is open iff its trigger — deterministic conditions over the
compiled graph — matches, and closed the moment it no longer does. Interview
state is therefore recomputed from model plus catalogue on every run and
never persisted: no session files and no second canonical store, which
project constraints forbid. The command requires an explicit workspace
manifest, emits `yarramate/interrogation-report/v1`, and exits `0` whatever
it finds: an open question is the agenda, not an error, so the epistemic
ladder stays intact — `check` gates form, `reconcile` gates truth,
`interrogate` gates nothing.

Catalogues are versioned data, not engine opinion. The seed ships as
`catalogues/core-enrichment.yaml` and is addressed by explicit path like
every other input; every question must state the decision its answer changes
and who may answer it. Productization settles the four decisions parked in
the research README: selector kind matching follows the schema's declared
`descendants` default, resolved through profile lineage exactly as
projections resolve it (the research evaluator's exact-matching was a
documented simplification — the first dogfood run under lineage matching
surfaced an ownerless subject the evaluator could not see); the
serving-direction reading inside `service-consumer-unknown` stays catalogue
data, revisable by editing the catalogue rather than the engine; catalogues
live as standalone explicit files, not a workspace manifest category;
and `extends` composition is deferred — the v1 normative schema omits it, so
a composing catalogue fails validation instead of half-working.
