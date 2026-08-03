# Deletion completes the audited write surface

Status: accepted

ADR 0064 deferred whole-subject deletion: with field retraction
(ADR 0062) and `status: retired` covering the honest cases, deleting
a subject stayed a reviewed Git edit until real usage demanded
otherwise. Issue #123 calls it due — the write surface that can
assert, enrich, and retract could not remove, so retired noise that
genuinely should leave the file had no audited exit.

`apply` now accepts `delete-concept` and `delete-relationship`. A
delete splices out the exact authored item range, marker line
included, so bytes the batch never touched stay byte-identical
(ADR 0062); deleting the last item leaves an explicit empty
collection. Flow-style items are deleted whole through the same
line-based path — unlike the 0.8.1 regression, where a line-based
*field* removal silently destroyed the item, the whole item is
precisely the intent here.

A delete is rejected, located at its operation, while anything still
references the target: relationship endpoints, `owner`, constraint
refs, and identified references. Integrity is evaluated against the
post-batch state — stage everything in memory, then look — so a batch
that deletes a concept together with its referring relationships
lands as one atomic motion, in any order. Projection selectors are
deliberately not consulted: a selector that matches nothing is not a
validation error by design. The compile gate stays the backstop: the
staged workspace must compile whole or nothing is written.

The write surface is now complete — assert, enrich, retract, delete —
and every motion walks through the same audited door. The division of
labour stands unchanged: retirement remains the descoping path,
preserving the decision on record, and the catalogue's guidance still
draws the line — "Delete only when the history itself is noise."
