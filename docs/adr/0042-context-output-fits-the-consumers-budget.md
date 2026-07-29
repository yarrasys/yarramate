# Context output fits the consumer's budget

Status: accepted

A context slice that overflows the consumer's window is a flood, not a
slice: measured on this repository's own model, one projection rendered
251 KB of result JSON — far beyond what any agent can spend on
orientation.

`yarramate context ... --budget <tokens>` renders a compact deterministic
text presentation inside an approximate token budget. Lines compete for
the budget in a fixed priority ladder — two header lines always render,
then subject skeleton, relationships, descriptions, and detail claims —
and everything dropped is announced in a trailing note. Truncation is
never silent.

The budget applies to presentation only. Without `--budget`, `context`
emits the unchanged normative `yarramate/projection-result/v1` JSON; the
compact rendering is a presentation like `view`'s Markdown, carries no
versioned contract, omits source locations, and estimates tokens
heuristically (four characters per token), so the cap is approximate. A
consumer that needs the complete slice or citations uses JSON mode.
