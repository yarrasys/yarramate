# Review slices derive from git

Status: accepted

The second cross-harness dogfood report (a Codex session completing the
YarraDev interview to zero open questions, 2026-08-01) named the next
gap precisely: after a burst of enrichment, the coherent decision slice
a reviewer should inspect has no surface — only per-subject views or
the catch-all diagram. The report proposed authored, non-authoritative
review tags (`tags: [review:operating-model-2026-08]`) with
tag-selecting projections, and itself supplied the right epistemics:
git diff stays authoritative for what changed, status records
lifecycle, attestations record acceptance, and a permanent generic
"new" tag would go stale.

Decision (with the maintainer): **the review slice is derived, not
authored.** The engine already knows every record's source lines;
paired with a git ref range, the slice assembles itself:

- `ask <ws> --changed <range>` — subjects whose declarations changed
  in the range (a subject is changed when a changed line intersects
  its declaration), seeded through the existing connected-neighbourhood
  machinery, rendered as the usual brief or digest — plus a **coverage
  note**: which changed subjects appear in no authored projection, the
  proposal's "material change visible only through the catch-all"
  report, answered inline.
- `export markdown|briefs --changed <range>` — the same slice as a
  persisted review document or per-concept handoff bundle.

Why derived beats authored here:

- **Zero new authored surface.** The native format's records stay
  closed (no generic metadata field — the door ADR-era decisions
  deliberately shut). Nothing to tag, nothing to forget to untag.
- **Stale-proof by construction.** A ref range is disposable the way
  the proposal wanted tags to be, without relying on anyone's
  discipline to dispose of it.
- **It implements the proposal's own first principle.** Git diff is
  authoritative for what changed; the engine only maps lines back to
  semantic identities.

The honest limit, recorded: a derived slice cannot express a
cross-cutting decision grouping that spans work git never grouped —
connected context from changed seeds covers most of that, not all.
Authored tags remain a deliberate deferral (issue filed), to be
designed properly against the closed-record doctrine if real reviews
hit that limit.
