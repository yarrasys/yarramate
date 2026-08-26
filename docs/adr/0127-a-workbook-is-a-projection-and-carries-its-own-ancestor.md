# A workbook is a projection, and carries its own ancestor

Status: accepted

An architect or FDE wants the model as a spreadsheet: open it, fill it in,
send it back (#355). Two constraints decide the design.

**It is a working document, not a report.** That rules out the technical
decomposition an engineer reaches for first — Subjects, Relationships, Claims
— where a person hunts across tabs to make one change.

**It must run on Cloudflare Workers**, because ApertureX both generates and
ingests these. No `fs`, no Node streams, and bundle size is a budget. This
repository ships three runtime dependencies, all small and text-only.

## Decision

**The workbook is written by hand, with no dependency.** An `.xlsx` is a zip
of XML parts, and the writer that produces one is smaller than any library
that would. Every xlsx package on npm is both larger and built for Node.

Entries use the **stored** method rather than deflate, which keeps writing
**synchronous**. The only compressor in a Worker is `CompressionStream`, which
is async, and an async writer would infect every caller including ApertureX's
deliberately synchronous `SourceStore` seam (ADR 0100). Reading is async, and
must be, because Excel re-saves deflated — but that cost lands on import
alone. Timestamps are fixed, so identical input produces identical bytes, the
same line `export rtm` already holds.

**A workbook is a projection.** `export xlsx` takes a projection and a
workspace, exactly as `export markdown` and `export briefs` do.

This settles "can the user choose which version to export" without a flag. A
projection query already has a `states` facet, and it already works: this
repository ships `core-contract-foundation.yaml`, which selects by state, and
`evaluateProjection` handles state selection internally. The workbook inherits
it, along with kinds, layers, owners, statuses and exclusions. A `--state`
flag would be a second, weaker selector competing with the one that exists.

**Identity is columnar, readability is derived.** Column A is always the id.
Foreign keys sit inline on the row, each followed by a `↳ … (auto)` column
carrying the referenced subject's name. The id round-trips; the `(auto)`
column exists to be read and is ignored on import. That is what lets a sheet
be understood without jumping tabs, which is the whole requirement.

**Unrecognised claims land in an overflow sheet rather than being dropped.**
Well-known predicates become columns because a person needs them to be
columns. Everything else goes to `07 Other Facts` verbatim, so a predicate
added to the compiler after this was written still survives a round trip.

This is the decision losslessness actually rests on. A mapping that enumerates
predicates is a mapping that silently loses the one it forgot, and the loss
has no symptom: the file opens, the sheets read correctly, and a subject
quietly lacks a field. Building it the other way was not hypothetical — the
first version omitted a state's `concept/kind`, and the only reason that was
noticed is that the overflow sheet had something in it.

**The workbook carries its own merge ancestor.** `~Baseline` is a `veryHidden`
copy of the working rows exactly as exported. It is never edited and never
updated; a fresh export mints a fresh one.

It is not a cache. It is the third leg of a three-way merge: without it,
"this cell differs from the model" cannot distinguish *the FDE changed it*
from *the repository moved underneath since the workbook was made*, and the
second would be silently clobbered. `~Meta` carries the source digests
alongside, the same pin discipline a visual commit uses.

## Excluded options

- **An xlsx library.** Fastest to build and the largest thing in the bundle,
  for a Worker whose whole job is emitting a spreadsheet. `exceljs` also
  assumes Node streams.
- **CSV per sheet.** Zero dependency and Excel opens it, but it is not a
  workbook: no hidden sheets, so nowhere for the ancestor or the provenance to
  live, and therefore no lossless round trip.
- **Deflated entries.** Smaller files, and it makes the writer async
  everywhere to save bytes on a document a person emails around. Available
  later for the CLI path, where async costs nothing.
- **A `--state` flag.** A second selector for something a projection already
  selects, which would then have to be reconciled with the projection when the
  two disagreed.
- **One sheet per kind, or per layer.** Reads well and cannot be coded
  against: the tab set changes with every model, so an adopter's sheet
  handling breaks per client, and a relationship spans two kinds so it needs
  its own sheet regardless.
- **Regenerating YAML on import.** Simpler than diffing, and it rewrites files
  wholesale: comments dropped, key order normalised, and a workbook imported
  with no edits still produces a large diff. `applyOperations` already edits
  surgically, so the operations route preserves what a rewrite would destroy.

## Consequences

`package.json` gains a `./workbook` export beside `./interrogation`, held to
the same bar by `test/export-purity.test.ts`: no Node builtins, no `ws`, no
session server, and no runtime import of the compiler.

No published format changes shape, so no consumer gains a required field.
`yarramate/workbook/v1` is new and is stamped in `~Meta`.

Import is a separate change. Export stands on its own: a workbook that cannot
yet be read back is still the artifact a consultant asked for.
