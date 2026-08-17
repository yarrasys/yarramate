# Reuse is decided by source text, not by a declared delta

Status: accepted

A per-commit consumer compiles a project's whole architecture model on every
write, inside a Cloudflare Durable Object. `compileWorkspaceWithProfileContext`
was the only entry point, so a commit that appends 40 documents to a 40,000
document workspace paid for all 40,000. Compile itself is linear and fast —
measured at ~200µs per document, flat from 1,000 to 40,000 — but a thousand
successive commits over a growing workspace accumulate quadratically. The
consumer measured ~28 minutes of compile per project and a Durable Object that
exceeded its CPU time limit and was reset.

The ask was a delta entry point whose result is byte-identical to a full
compile of the same final source set.

## What a cache may be keyed on

A caller-declared change set (`{ path, source? }[]`, absent meaning delete) was
the shape proposed. It was refused: a declared delta is a claim by the caller
that the compiler cannot check, so a wrong or stale declaration silently
changes compiled output. Nothing in the type system stops a consumer from
appending a document and forgetting to declare it.

A digest per document was refused for a smaller reason: it costs a hash over
every byte to learn what a comparison of the bytes already tells us, and it
adds a collision class that the honest comparison does not have. Measured, the
compare is cheaper than the hash.

Decided: reuse is decided by **exact source-text equality** against the entry
the previous call returned. A stale cache therefore cannot change compiled
output — it can only fail to save work. The cache is opaque: consumers hold
it and hand it back, and never construct or mutate one.

```ts
export const compileWorkspaceIncremental = (
  sources: readonly WorkspaceSource[],
  previous?: CompilationCache,
): IncrementalCompilationResult
```

`IncrementalCompilationResult` adds `incremental` (false when every source had
to be parsed) and `cache` (to hand to the next call) to the existing result.
`compileWorkspace` and `compileWorkspaceWithProfileContext` are untouched, so
the 28 places that freeze compiled-output bytes keep passing.

## What one entry holds

Every field of an entry is derived from `input.source` alone: the composed
YAML value, whether the text is a profile or a document, the schema and parse
faults the text carries on its own, and line/column positions already resolved
for it. That is what makes an entry a pure function of its text.

Cross-document faults are deliberately **not** cached. Duplicate document ids,
unresolved concept references, contradicting endpoints, and whole-part
coherence all depend on documents the entry knows nothing about, and are
re-derived on every compile.

The position memo matters more than it looks. Positions were being resolved by
re-parsing the source on demand, which a comment claimed was rare because only
diagnostics read a position. The profile disagreed: every emitted claim carries
a `source` line and column, so every document was re-parsed to build its
claims. Caching the resolved positions per YAML path is what turned the delta
from 56% of a full compile into 7%.

## The double parse it exposed

Classification (is this text a profile or a document?) re-read the composed
`format` key by parsing the source a second time. Reading it from the document
the first parse already produced is byte-identical and 42% faster on the full
compile path — 40,000 documents fell from 7,939ms to 4,627ms. That win is not
part of the delta feature; it belongs to every caller.

## The boundary this does not cross

A delta is 7% of a full compile, not proportional to the change:

| documents | full ms | delta ms | delta share | proportional ms |
|---:|---:|---:|---:|---:|
| 1,000 | 271.9 | 24.6 | 0.09 | 10.5 |
| 5,000 | 1,246.2 | 87.3 | 0.07 | 9.9 |
| 10,000 | 2,308.8 | 153.1 | 0.066 | 9.2 |
| 40,000 | 9,482.5 | 683.9 | 0.072 | 9.5 |

The residual is whole-workspace claim emission, the total-order sort over all
claims and subjects, and the cross-document validation passes. Profiled at
40,000 documents, the 684ms splits roughly 40% sort (`compareById`), 40% claim
emission, and the rest global validation and collection.

None of that is per-document pure. Claim emission interleaves cross-document
lookups that feed diagnostics, so caching a document's claims does not let
the document be skipped — the traversal that produced the diagnostics still
has to run. Making the cost proportional needs a two-tier engine: per-document
emission cached separately from global validation, incrementally maintained
global indices, and a splice-merge into a retained sorted output. That is a
larger design with real byte-identity risk, and it is a separate decision.

Two measurements bound the value of taking it: the worst single commit at
40,000 documents is 684ms against a 30s CPU budget, a 44× margin, and a
40,000 document workspace does not fit a 512MiB Durable Object at all — cold
or warm, it exceeds a 448MB heap. The memory ceiling is ~20,000 documents,
and holding the cache lowers heap rather than raising it (264MB warm vs
393MB cold at 20,000). The CPU blocker is cleared; the next ceiling is
memory, not compile.

## Byte-identity is tested, not asserted

`test/compile-incremental.test.ts` runs 24 seeded random change sequences of 12
steps each — edit, add, delete, toggle the profile — and asserts the
incremental graph and profile context are byte-identical to a full compile of
the same final sources at every step. Outcome counters assert both the ok and
the failed paths were exercised, so identity cannot pass vacuously by every
corpus failing to compile.

`Intl.Collator` was measured as a byte-identical replacement for
`localeCompare` in the sort and rejected: same order, 2× slower.
