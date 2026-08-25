# A constraint nothing tests is a comment

Status: accepted

[ADR 0083](0083-a-kind-nothing-constrains-is-a-label.md) found that a kind
nothing constrains is a label. The same argument applies one level up, and the
GitLab showcase demonstrated it.

That model declared:

> `git-io-through-gitaly` — "No component reads repository storage directly;
> every git operation crosses Gitaly's RPC surface."

and then recorded three `access` edges to `git-repositories` from subjects that
were not Gitaly. `yarramate check --strict` returned green. The constraint's
only wiring in the graph was two `association` edges. It constrained nothing.

This is worse than a missing feature, because the constraint's presence is
actively misleading. A reader reasonably concludes the rule holds, since the
tool checked the model and said nothing. The tool never looked.

[ADR 0097](0097-relationship-endpoints-are-validated-against-the-archimate-relationship-table.md)
made every relationship answerable against the ArchiMate table, so a
relationship can no longer be silently wrong. A constraint still could.

## Decided

**A subject may declare `forbids`: relationship shapes ruled out, checked
against the graph. A violation is a `check` error, YM415.**

```yaml
- id: git-io-through-gitaly
  kind: constraint
  name: Git I/O crosses Gitaly
  forbids:
    - relationship: access
      to: git-repositories
      exceptFrom: [gitaly]
```

Deliberately narrow: forbid a relationship kind between named endpoints, with
exceptions. That covers "everything goes through X", which is the most common
architectural rule anyone writes, and it needs no traversal, so it stays inside
the no-derivation boundary [ADR 0003](0003-native-document-and-compiler-foundation.md)
drew and [ADR 0083](0083-a-kind-nothing-constrains-is-a-label.md) reaffirmed.

## Why this one is a check error when the absence rule is not

[ADR 0107](0107-a-recorded-search-makes-an-absence-auditable.md) declined to
make an unsupported `not-observed` fail the gate, on ADR 0083's reasoning that
a new rule must not fail existing repositories on upgrade. That reasoning does
not apply here, and the difference is worth being explicit about.

`forbids` is a **new field**. No existing model has one, so no existing model
can violate one. The error can only fire on a rule someone deliberately wrote,
which makes it opt-in by authoring rather than imposed by upgrade. An author who
writes a rule is asking for it to be enforced; that is the whole point of
writing it.

And unlike an unverifiable absence, a violated constraint **is** a
contradiction: the model states a rule and then states a fact that breaks it.
That is exactly what the gate is for.

## A rule is about the graph, not about who wrote it down

`forbids` is honoured wherever it is declared, and the diagnostic names the
declaring subject. Putting it on a `constraint` is the idiom and what the field
description recommends, but the check does not require it: the rule constrains
the graph, and refusing to evaluate one because it sits on the wrong kind would
be the same failure this ADR is fixing, arriving from the other direction.

## Deliberately not done

- **No `requires`.** "Every component must be hosted" is a real rule and a
  different shape: it quantifies over subjects rather than filtering
  relationships, and it overlaps what the interview already asks. Worth its own
  decision once `forbids` has been used in anger.
- **No traversal.** A rule cannot say "reaches X through any path". That would
  be derivation, which ADR 0003 excludes and ADR 0083's lineage reaffirms.
- **`principle` is unchanged.** A principle is usually not mechanically
  testable, and that may be exactly the distinction worth keeping between it
  and a constraint.

## Consequences

- Additive. A constraint with no `forbids` behaves exactly as before, so every
  existing model still checks the same way.
- The GitLab showcase's rule is expressible: it now describes the route through
  `git-storage-service` in prose, and can be tightened to a predicate once this
  ships.
- A rule that can be written down and never fires is now visibly inert, which
  is a better problem than one that cannot be written down at all.
