# Reconcile reports the artifacts no observation claims

Status: accepted

Three times in three weeks, a day of shipped features moved the model not at
all while every gate stayed green (#175). The blind spot is structural, not
disciplinary: the catalogue asks about declared subjects, reconcile compares
declared claims against observed evidence, and a change that declares nothing
touches neither. ADR 0049 closed the subject side of this gap — a `current`
concept no observation reaches is counted and listed. The artifact side had
no reciprocal: nothing could say which files in the repository no observation
so much as mentions.

Decided: the workspace manifest may declare an optional `coverage` list of
glob patterns, and `reconcile` — only `reconcile` — assesses it. The patterns
resolve against the root of the git repository the manifest lives in, and an
artifact is any file git can see there: tracked, or untracked and not
ignored. An observation claims an artifact when its evidence locator is
`repo:<path>`, with any `#fragment` stripped; a locator naming a directory
claims everything beneath it; a locator in any other scheme claims nothing.
The report mirrors ADR 0049: `summary.artifactsInScope` and
`summary.unclaimedArtifacts` appear exactly when coverage was assessed, and a
positive count lists the paths in a top-level `unclaimedArtifacts` array,
sorted, beside a `coverageScope` echo of the declared patterns so the report
is honest about what it was asked to look at.

Unclaimed is absence, never accusation: no finding is fabricated, and the
list does not participate in `check --strict` — a coverage signal is not a
contradiction, the same line staleness (ADR 0074) and unobserved
expectations (ADR 0075) already hold.

When coverage was not assessed, the report says so in `notes` rather than
staying silent: a manifest with no `coverage` scope, and a workspace outside
any git repository, each name their reason — the ADR 0074 parallel the issue
asked for. The counters appear exactly when the scope was assessed, so a
report without them is one that never looked, not one that found nothing. A
declared pattern that selects no artifact gets its own note naming the
pattern: a dead glob is indistinguishable from a typo, and silently
contributing nothing is how a mistyped pattern would report full coverage
(the ADR 0128 lesson, resolved with a note rather than a refusal because a
coverage scope is a lens, not load-bearing input — YM702 refuses an
unmatched *document* pattern because without documents there is no
workspace).

Three recorded decisions sit in this feature's path, and each keeps its
line rather than being reversed:

1. **"The `evidence.uri` value is opaque to YarraMate Core"**
   (docs/EVIDENCE.md). Resolution and external validity stay entirely with
   the provider: Core still never opens, fetches, or validates what a
   locator points at. Coverage performs a syntactic string comparison
   against the one scheme the product's own documentation has always used
   for repository paths — `repo:` appears in every EVIDENCE.md example and
   ADR 0068 names it outright. A workspace whose providers use other
   schemes simply reports everything unclaimed, which is true: no
   observation names those files as repository paths.
2. **"The engine stays out of the indexing business: no repository
   scanning"** (ADR 0068). What that refused was inference — a code index,
   inferred links, rank. Coverage infers nothing: it enumerates files only
   inside a scope the maintainer declared, reads no file contents, and
   reports only absence. Scanning-to-understand stays out;
   counting-to-report-absence is the same honesty ADR 0068 itself promised
   when it called evidence coverage "the visible limiting reagent".
3. **"A manifest never searches parent directories"** (docs/WORKSPACES.md).
   Manifest *resolution* still doesn't: `coverage` is not a document
   category, resolves to no files at load, and is never compiled. It is a
   declaration that `reconcile`, the verb already coupled to the
   repository's reality frame through git (ADR 0074), interprets against
   the repository root. Load-time validation covers only pattern safety —
   absolute paths, backslashes, and `..` traversal are refused with the
   same YM701 every other category uses.

The enumeration is bounded by git twice over: the root comes from
`rev-parse --show-toplevel` on the manifest's directory, and glob matches
are intersected with `git ls-files --cached --others --exclude-standard`,
so a symlink escaping the repository or a build tree git ignores cannot
enter the artifact set however broad the glob.

Rejected:

- **Tracked files only.** The recurrence this feature exists to catch is
  precisely a fresh file nobody has declared, and during development that
  file is often not yet committed. Filtering to the index would blind the
  report to exactly the newest artifacts.
- **Anchoring on the process cwd.** That is the #216 bug shape: the same
  command reporting different coverage depending on where it was invoked.
  The git toplevel of the manifest's directory is stable and matches what
  `repo:` locators have always meant in practice.
- **A declarable root for a tree the workspace does not live in.** An audit
  workspace modelling an external repository cannot declare a scope over
  it. Deferred with a gate: build a `root` when a real workspace models a
  tree it does not live in and asks for coverage over it — it needs a
  deliberate relaxation of the `..` guard and nothing shipped needs it
  today.
- **The RELEASING.md checklist line.** Three releases shipped on
  2026-08-26 and a checklist question would have been answered "fine"
  three times; this recurred twice with maintainers who knew. Discipline
  is the thing that failed; the fix is a number that moves.
