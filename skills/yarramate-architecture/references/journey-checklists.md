# Journey checklists

## Discovery evidence

Inspect only what materially supports the proposed architecture:

- repository instructions and package/workspace manifests;
- executable entrypoints and public interfaces;
- stable modules and responsibility boundaries;
- persisted or exchanged information;
- external services and runtime/deployment configuration;
- tests that demonstrate significant behavior;
- ownership or constraints explicitly present in repository sources.

Distinguish:

- **observed** — directly supported by a locator;
- **proposed interpretation** — semantic meaning inferred for review;
- **unknown** — evidence is insufficient;
- **declared intent** — already accepted in native documents.

Do not infer organizational ownership from Git authorship, target intent from
unfinished code, or architectural importance from file size.

## Design questions

Ask only questions that can materially change the architecture:

- What outcome and driver justify the solution?
- Which constraints are non-negotiable?
- Who or what consumes the solution?
- What responsibility belongs inside versus outside the boundary?
- Which information must be owned, persisted, or exchanged?
- Which alternatives differ in boundaries, responsibility, dependency, or
  operational characteristics?
- What makes an alternative selected, rejected, or still unresolved?
- What must exist in the initial target for implementation to begin?

Avoid demanding a complete catalogue before a useful target can be reviewed.

## Completion signals

Discovery is minimally useful when:

- native documents pass `yarramate check`;
- significant proposed subjects have traceable observations or are explicitly
  identified as interpretation;
- a focused projection gives an agent useful repository context;
- intended projections are rendered through a current LikeC4 project;
- concepts outside all projections, ordered flows without dynamic views, and
  projections absent from the project are reported as coverage gaps;
- evidence has not been promoted automatically.

Design is minimally useful when:

- drivers and constraints are visible;
- material alternatives remain reviewable;
- the selected target has explicit boundaries and relationships;
- a bounded target projection can guide implementation;
- intended projections are rendered through a current LikeC4 project;
- rendering coverage gaps are stated, including intentional omissions;
- missing detail is visible without becoming a Core correctness error.
