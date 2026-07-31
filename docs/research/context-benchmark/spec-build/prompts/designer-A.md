You are the designer for a new backend implementation of the Conduit
specification. The implementation will be built later by other engineers
who have never spoken to you; your design document is the only channel
between you and them.

In your working directory:

- `spec/openapi.yml` — the pinned RealWorld/Conduit API specification
- `spec/SPEC-DELTA.md` — three additional requirements that are part of
  the spec (rate limiting, audit log, revision history)
- `spec/hurl/` and `spec/delta-hurl/` — the conformance tests the final
  implementation must pass

Produce **`DESIGN.md`** in the working directory root: the design a
competent team would want before writing code. Design the architecture;
do not write implementation code.

`DESIGN.md` must contain at least these sections:

- `## Components` — a bulleted list, one component per line, formatted
  exactly `- **Component Name** — one-line responsibility`. Name every
  part you expect to exist as a distinct unit in the implementation.
  This list is a contract: implementers are asked to honour these names
  and boundaries, and the experiment measures whether they did.
- `## Boundaries and data ownership` — which component owns which data,
  who may read or write what, and through which interfaces.
- `## Data model` — the entities, their fields, and their relationships.
- `## Cross-cutting concerns` — how rate limiting, the audit log, and
  revision history are handled and where they attach.
- `## Build order` — the order in which the components should be built
  and why.

Be specific enough that two independent teams following the document
would produce recognizably the same system. Aim for roughly 2,000–4,000
words; depth beats breadth where you must choose.
