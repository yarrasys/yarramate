# Add operational lifecycle status claims

Status: accepted

## Context

The canonical self-model needs to distinguish architecture that currently
exists from planned or retired architecture. Git already supplies review and
approval, so status must not create a parallel governance lifecycle.

## Decision

Concepts and relationships may declare one optional lifecycle status:

- `planned` — intended architecture that is not current;
- `current` — architecture represented as presently operative;
- `retired` — architecture retained for semantic history but no longer
  operative.

Status compiles into a declared `yarramate/lifecycle/status` claim about the
stable concept or relationship subject. It is a controlled value checked by
the document schema.

Lifecycle status does not express draft, review, acceptance, approval,
ownership, confidence, or evidence quality. Git and repository policy retain
authority over those concerns.

## Consequences

Queries can separate current, planned, and historical architecture without
introducing workflow orchestration. Status remains optional because absence is
not a correctness failure.

The vocabulary and wording are original YarraMate semantics. Profiles may
later define additional claim predicates, but cannot reinterpret these Core
values.
