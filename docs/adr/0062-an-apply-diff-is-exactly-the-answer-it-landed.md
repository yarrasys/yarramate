# An apply diff is exactly the answer it landed

Status: accepted

Dogfooding 0.7.0 against a foreign model (yarradev-ai, #114) showed
`apply` rewriting prose it never touched: the YAML AST round-trip
re-emitted the whole document, reflowing every authored `>-` folded
description — a 10-operation status batch produced a 350-line diff. On
a git-reviewed model that buries the real change and claims authorship
of untouched content.

`apply` now writes by **splicing**: every operation becomes a minimal
text edit against the document's current source, computed from the
parsed nodes' source ranges — append an item after the last one,
replace a scalar's value token, insert a new field line, delete a
field's lines. Bytes the batch never touched stay byte-identical. The
atomic compile gate is the safety net that makes this cheap to trust:
the spliced text itself must compile as a whole workspace before a
single byte is written, so a splice defect rejects the batch loudly
instead of corrupting a document.

The same dogfood run supplied the second half (#115): reconcile caught
two unsupported `status: current` claims the moment they became
checkable, and there was no verb to take them back — enrich-only
`update` can overwrite a scalar but never unset it. Update operations
now accept `remove: [<field>...]`: the field's lines are deleted,
identity fields (`id`, `kind`, `from`, `to`) are not removable at the
schema gate, removing a field that is not set is a located error, and
setting and removing the same field in one operation is rejected. The
loop is whole: apply asserts, reconcile catches, apply retracts — and
retraction restores the exact prior bytes.

This amends ADR 0057's "removals stay Git edits": *silent* shrinkage
still does not exist, but explicit, reviewed retraction is part of the
write surface, because a loop that can assert must be able to take an
assertion back through the same audited door.
