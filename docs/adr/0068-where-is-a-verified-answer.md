# Where is a verified answer

Status: accepted

Agents ask two location questions. "What is this code?" belongs to the
harness's own retrieval or a code index — commodity, and improving on
its own. "Where does this intent live?" has, until now, had no answer
surface at all, even though the engine already holds one: evidence
observations bind subjects to `repo:` locators with a confirmed or
contradicted result, and reconciliation polices them. That mapping
flowed only one way — locators in, verdicts out. A prototype that
imported the model into an external code graph resolved every one of
the self-model's evidence locators to a code entity (53/53), which
settled that the substrate is sound (#137).

Decided: `ask --where` inverts the mapping. The query surface is the
same free-text-or-subject-id seeding as every slice; the answer is each
matched subject's evidence locations, deduplicated across subject- and
claim-level observations, with contradicted locations included and
marked — a place known to disagree with intent is review signal, not
noise.

The load-bearing part is the routing rule the envelope states out
loud: **authority follows epistemic status, not tool seniority.**
Verified pointers outrank derived pointers wherever both exist, and
everything else is explicitly handed off. So every answer carries its
own coverage boundary — the verified locations, the subjects that are
modeled but unobserved, and a note telling the agent to use its own
search tools (or a code index) beyond the model's edge. A workspace
with no evidence overlay gets the same honesty: nothing is verified,
here is how to change that.

Consequences: evidence coverage becomes the visible limiting reagent —
every `unobserved` entry in a `--where` answer is a nudge toward
authoring the missing observation. And the engine stays out of the
indexing business: no repository scanning, no inferred links, no rank.
The model answers for what it knows verified and says where its
knowledge ends.
