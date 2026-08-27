# Catalogues compose as a resolved set, and a question id carries its origin

Status: accepted

A workspace should be able to carry its own questions (#345). A consultancy has
a domain catalogue it asks on every engagement; an individual engagement raises
questions true of that client and nowhere else, discovered mid-engagement
rather than at product-design time. Today those have nowhere to live:
`evaluateCatalogue` takes ONE catalogue and `--catalogue` replaces the shipped
one wholesale.

#151 reserved `extends` for this in August and set its gate as *"build `extends`
when the first real second catalogue exists"*. That gate has fired. This ADR
settles both issues together, because they are one decision and deciding them
separately would produce two mechanisms for one problem.

## Decision

### Catalogues compose as a RESOLVED SET, not an `extends` chain

`questions:` becomes a workspace manifest category, resolving like `patterns`
and `evidence` already do, and it is **additive to the shipped catalogue**:

```yaml
format: yarramate/workspace/v1
id: icwa-web
documents: ['documents/**/*.yaml']
questions: ['questions/*.yaml']
```

`--catalogue` and `MountOptions.catalogue` keep exactly the meaning #328 gave
them: replace the BASE. So there are three positions and each has a mechanism —
replace the base wholesale, add to it, and (not built) selectively override it.

**A wave is declared exactly once across the resolved set.** Two declarations
of the same wave id is a refusal at load. Any catalogue may contribute
questions to a wave it did not declare, by bare id, which is the case that
prompted the issue: *one more Assurance question for this client*. Referencing
a wave nothing declares stays YM911, now evaluated across the union rather than
within one file.

That single rule answers three of #345's four sub-questions at once. Wave
identity: a project catalogue joins a declared wave rather than colliding with
it. Ordering: only a declaration places a wave, and wave order is resolved-set
order then array order, so the shipped catalogue's order is unchanged and new
waves append. `opensWhen` precedence, which ADR 0125 made load-bearing: there
is exactly one declarer, so there is no precedence question to answer.

**Id collisions dissolve rather than being resolved.** Two catalogues may both
carry `outcome-missing`; qualification makes them `core-enrichment#outcome-missing`
and `consulting#outcome-missing`, which are different questions. No merge rule,
no last-wins, no refusal.

**A broken catalogue behaves differently at the two surfaces.** `check` refuses
it, because a catalogue in the manifest is workspace content and `check` refuses
broken workspace content. Evaluation drops the broken catalogue and names it,
so one bad project catalogue does not silence the domain one — the #328
precedent for a host-supplied catalogue, applied to a set.

**Additive only. No override.** A later catalogue cannot weaken, retire or
re-materialise an earlier one's question. Nothing asked for it, and a pack
quietly lowering the materiality of a shipped question is a failure mode worth
refusing by construction. `extends` remains deferred, with a sharper gate than
#151 could state in August: build it when someone needs to OVERRIDE a shipped
question rather than merely add to one.

### A question id carries its origin, and carries no version

**Authors keep writing local ids.** The authored catalogue schema is unchanged:
`^[a-z][a-z0-9-]*$`, no `@`, no `#`. The engine qualifies on the way out.

**The report's question id becomes `catalogue#question`**, unversioned. This
needs no schema change: every id in `yarramate/interrogation-report/v1` is
already `{"type": "string", "minLength": 1}` — the question id, the wave id and
the top-level `catalogue` alike. The published format has always been able to
carry a qualified id; only the values change.

**No version in the identity, and that is the whole point.** ApertureX keys
stored dismissals on `(catalogueId, questionId, subjectRef)`. `core-enrichment`
has had seven versions and went 1.0 to 1.3 on 2026-08-26, three bumps in one
day, renaming nothing. Under a versioned identity every one of those would have
stranded every stored dismissal in every adopter's database, for changes that
removed no question. That is the `aka` failure arriving through the front door,
at a scale `aka` was never meant to cover.

The principle underneath, which was not written down before this:

> **Versioned identity is safe for things that are AUTHORED and unsafe for
> things that are STORED.** A kind identity is pinned by a document, so a
> profile version bump strands nothing: the document keeps naming the version
> it was written against and an author updates it deliberately. A dismissal is
> a row in an adopter's database. Nobody re-authors it. It has no author to
> update it and no document to live in.

So the parallel with kinds (`profile@version#kindId`) holds for the origin half
and breaks for the version half, and it breaks exactly where it was leaned on
hardest.

**Version stays in the report, beside the identity rather than inside it.**
`catalogue` keeps its current value shape — a string, the base catalogue's
`id@version` — because changing it to an array would break every reader. A new
**optional** `catalogues` array lists every contributing catalogue with its
version. Optional and additive is safe for readers, which ignore it, and does
not force constructors, which is the break that hit a consumer's production
code this month.

## Consequences

**One migration, and it is a value change rather than a required-field
addition.** A consumer matching on question ids sees `consulting#regulator-signoff`
where it saw `regulator-signoff`. ApertureX collapses two of its three key
fields into one and ends with fewer keys than it started with; the migration is
a string concatenation over existing rows.

**#151 is superseded, not deferred again.** Its composition question is
answered by the set, its collision question dissolves under qualification, and
its `since`-annotation question is the same question as the stored-judgment one
and gets the same answer: no version in an identity. Packs become entries in
`questions:` and need no new keyword. What remains of #151 is distribution,
which was never the hard part.

**A new refusal**: two catalogues declaring the same wave id. YM915.

**What this does not settle.** Dismissal is the adopter's, per #328, and this
ADR does not reach into it. It settles only whether a question's identity is
stable across catalogue edits, which is the part that had to be decided in the
format rather than worked around by every adopter.
