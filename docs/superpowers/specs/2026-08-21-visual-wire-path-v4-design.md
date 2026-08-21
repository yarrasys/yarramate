# Visual wire paths as canonical `file:` URIs (protocol v4)

**Date:** 2026-08-21
**Status:** Approved design — not yet implemented. This document specifies
the change; no source, schema, or test file is touched by it.

Supersedes the intent of commit `7663f0a` ("keep VisualSessionPaths native,
wire-normalize only at the boundary") on this branch. That commit is a
correctness patch for `toWireAbsolutePath`'s worst symptom and is **not**
merge-ready: it leaves the representation this design replaces in place. Its
regression test (a POSIX directory name containing a literal backslash) is
valuable evidence and is kept in the verification matrix below, but the fix
it accompanies does not ship as-is.

## Problem and the security invariant at stake

`VisualSessionDescriptor`, `VisualSessionStarted`, and `VisualHandoff` carry
absolute filesystem paths — `sessionRoot`, `descriptorPath`, `journalPath`,
`transcriptPath` — as bare strings validated by `$defs.absolutePath`
(`schema/yarramate-visual-session-started.schema.json`, pattern
`^(?:/|[A-Za-z]:/)[^\u0000\\]*$`) and produced by
`toWireAbsolutePath` (`src/adapters/visual/protocol.ts`):

```ts
export const toWireAbsolutePath = (native: string): string =>
  native.replace(/\\/g, '/')
```

This is a lossy, non-invertible string transform standing in for a real
filesystem-path encoding, and it fails in both directions:

- **Aliasing.** A POSIX path whose own name contains a literal backslash
  (`/tmp/yarramate-visual-\store-abc/…`) and a Windows path joined with
  native separators both collapse to indistinguishable forward-slash text.
  Commit `7663f0a`'s regression test proves this concretely: before that
  fix, `visualSessionPaths` returned the mangled form, so `fs` calls against
  `paths.marker`/`paths.journal`/`paths.root` missed the directory
  `createVisualSession` actually created. `7663f0a` moved the mangling to
  the three serialization sites, which stops the ENOENT but does not
  restore an invertible mapping: two distinct native paths can still
  produce the same wire string, and nothing detects it.
- **Nonlocal paths pass as local.** `toWireAbsolutePath` has no concept of a
  host. A UNC path such as `\\server\share\x` becomes `//server/share/x`,
  which satisfies the current `^/[^\u0000]*$`-descended pattern as an
  ordinary POSIX-rooted path. ADR 0081 fixes the runtime's authorization
  model on the server being "loopback and ephemeral... nothing shareable,
  resumable, or reachable from another machine" — a session document that
  can silently name a network share violates that invariant at the one
  layer (the wire) that a consuming harness has no independent way to
  re-check.
- **No round-trip guarantee on untrusted input.** `readVisualSessionDescriptor`
  (`src/adapters/visual/client.ts`) treats an on-disk descriptor as
  untrusted until its `sessionRoot`/`journalPath` are proven to name the
  same file the CLI was told to open (`YMVS403`). That check is currently a
  byte-string compare of two `toWireAbsolutePath` outputs. A transform with
  no defined canonical form and no reversal function cannot back a proof
  of identity; it can only fail to *disprove* one, which is a materially
  weaker guarantee for a check that gates whether the descriptor's bearer
  capabilities (`browserUrl`'s bootstrap key, `webSocketUrl`) get used at
  all.

**The invariant this design restores:** every filesystem path a visual
protocol document carries is a canonical `file:` URI with a defined,
lossless native-path encoding and a decode path that refuses anything that
is not unambiguously one specific local file. "Descriptor authority" — the
embedded bearer capabilities — is never exercised on a document whose path
fields have not first passed that decode.

## Non-goals

- Changing how `sessionId`, `browserUrl`, `webSocketUrl`, or any bearer
  capability is minted, transported, or authenticated. The URI change is
  about path fields only; capability handling is untouched.
- Fixing case-insensitive-filesystem aliasing (e.g. `/Users/Foo` vs.
  `/users/foo` on default APFS or NTFS). `pathToFileURL`/`fileURLToPath`
  are pure string functions with no filesystem access; they cannot and do
  not resolve case-folding, and neither does anything else in this
  codebase today (`resolve()` doesn't either). This is a pre-existing
  platform property of every path this runtime already handles, not
  something introduced by or fixable through the wire representation.
- Preserving support for a hand-typed native or `cwd`-relative path as the
  operator-facing CLI argument to `wait`/`respond`/`status`/`recover`/
  `stop`. §CLI cutover below makes that argument the published URI, full
  stop; this is a deliberate compatibility break, not an oversight.
- Model-source relative-path confinement (`isConfinedRelativePath`,
  `.yarramate/…` document paths). That check already lives in a disjoint
  code path with its own already-correct POSIX-only rule and is unaffected.
- Writing the ADR, schema, parser, CLI, fixtures, or tests. This document
  is the specification those land against.

## Chosen representation: canonical local `file:` URIs

Every absolute path field on the wire (`sessionRoot`, `descriptorPath`,
`journalPath`, `transcriptPath`) becomes a `file:` URI string, encoded and
decoded exclusively through Node's own URL primitives:

- **Encode** (native → wire): `pathToFileURL(nativePath).href`, at the
  handful of sites that currently call `toWireAbsolutePath` — nowhere else.
  `VisualSessionPaths` (`src/adapters/visual/session-store.ts`) stays
  native, exactly as `7663f0a` left it; `visualSessionPaths(root)` is
  unconditionally native `resolve`/`join` output and is never serialized
  directly. This half of `7663f0a`'s change is correct and is kept.
- **Decode** (wire → native, untrusted input): `fileURLToPath(uri)`,
  wrapped so every failure mode Node itself raises
  (`ERR_INVALID_URL`, `ERR_INVALID_URL_SCHEME`, `ERR_INVALID_FILE_URL_HOST`,
  `ERR_INVALID_FILE_URL_PATH`) is caught and reported as a refusal rather
  than an uncaught exception.
- **Canonical round-trip identity is mandatory for every URI that did not
  originate in this process.** After decode, re-encode
  (`pathToFileURL(fileURLToPath(uri)).href`) and require byte-for-byte
  equality with the input string before the decoded native path is used
  for anything — including before the descriptor's own bearer capabilities
  are read. A URI that decodes but does not re-encode to itself is refused
  as noncanonical, never "fixed up" or silently accepted.

Why this over the alternatives considered:

- **Percent-encoding wins over stricter regex tightening** (e.g. banning
  literal backslashes outright) because a regex can describe what a string
  looks like but not what native path it denotes; the aliasing bug is
  exactly two different native inputs producing one indistinguishable wire
  string, which only an invertible encoding closes.
- **`file:` URI wins over a custom tagged format** (e.g. `{ platform:
  'win32' | 'posix', path: string }`) because `pathToFileURL`/
  `fileURLToPath` are the runtime's existing, already-vetted, dependency-
  free implementation of exactly this problem, used the same way
  elsewhere in the Node ecosystem (`import.meta.url`, ESM loaders). A
  custom format would have to reinvent percent-encoding and host handling
  and would still need its own decode-side round-trip check to get the
  same guarantee.
- **The host check falls out of the same primitive.** `pathToFileURL` on a
  UNC path (`\\server\share\x`) produces a URI with a non-empty
  `hostname` (`file://server/share/x`); on any local absolute path,
  `hostname` is always empty. "Nonlocal" is therefore not a new pattern to
  invent — it is `new URL(uri).hostname !== ''`, checked as part of decode,
  before the round trip.

Per ADR 0081's own precedent ("What the schemas alone do not say" —
byte-length and cross-field ownership are enforced in `protocol.ts` beside
the Ajv validators, not expressed as schema keywords), JSON Schema cannot
express "is a canonical local file URI." The schema keeps a coarse
structural gate; the decode-and-round-trip check is the real enforcement,
living in code beside the validators exactly where `isConfinedRelativePath`
and the byte-length checks already live.

## v4 versioning and schema implications

Following ADR 0088's rule directly: a field whose value shape changes
under a stable `$id` — bare-path string becoming a URI string — is not an
additive change, even though every field keeps its name. It mints new
document versions and bumps the protocol version that names the wire, the
same way ADR 0088 bumped `v1` → `v2` for a response-document member change.

- **`VISUAL_PROTOCOL_VERSION`** (`src/adapters/visual/protocol-contract.ts:21`)
  becomes `yarramate/visual-protocol/v4`. It is pinned as a `const` in the
  three documents that already agree on it —
  `visual-session-descriptor`, `visual-session-started`, `visual-status` —
  so a v3 consumer sees the mismatch in any of the three before it acts on
  one, unchanged from the ADR 0081/0088 mechanism.
- **Path-carrying documents get new `format`/`$id` versions**, because
  their field *shapes* changed (bare string → URI string), which is the
  ADR 0088 line between "grew a member" and "a member's contract changed":
  - `yarramate/visual-session-started/v1` → `v2`
    (`schema/yarramate-visual-session-started.schema.json` →
    `$id: https://yarramate.org/schema/visual-session-started/v2`)
  - `yarramate/visual-session-descriptor/v1` → `v2`
  - `yarramate/visual-handoff/v1` → `v2`
- **Documents that do not carry a path field are untouched**: `format`
  stays `v1` for `visual-session-request`, `visual-event`,
  `visual-response`, `visual-model`, `visual-diagnostic-result`,
  `visual-graph`, `visual-layout`. `visual-status` keeps `format:
  yarramate/visual-status/v1` — it has no path field — and only its
  `protocolVersion` const moves, exactly as ADR 0088 records for the
  detection-only case.
- **The shared `$defs` path definition** moves from `absolutePath`
  (pattern `^(?:/|[A-Za-z]:/)[^\u0000\\]*$`, `maxLength: 4096`, native
  form) to a new `sessionFileUri` definition on the v2 `visual-session-started`
  schema, referenced by the v2 descriptor and v2 handoff schemas the same
  way the three already cross-reference each other today:
  - `pattern: "^file:///[^\\u0000]*$"` — the coarse structural gate. Every
    URI `pathToFileURL` produces for a local path starts `file:///`
    (POSIX: empty host + `/`-rooted path; Windows: empty host + `/C:/…`),
    and a UNC-derived URI (`file://server/…`, two slashes before the host)
    fails this pattern outright, so the nonlocal case is caught
    structurally as well as in code.
  - `maxLength: 8192` — doubled from the native bound, sized for the
    worst case where every byte of a 4096-byte native path requires
    3-character percent-encoding; this widens the wire envelope to hold a
    legally encoded path, not the underlying path-length invariant, which
    is unchanged.
  - The real check — decode succeeds, host is empty, round-trip is
    byte-identical — is enforced in `protocol.ts`, per the "what the
    schemas alone do not say" precedent above, and reported through the
    document's existing parse code (`YMVS102`/`YMVS103`/`YMVS107`) when it
    runs as part of schema-adjacent semantics, or through a new client
    code (below) when it runs against a bare CLI argument before any
    document has been parsed yet.
- **`toWireAbsolutePath` is deleted**, not deprecated. Its three call
  sites (`session-server.ts:2219-2233`, `session-store.ts:517-518,
  recoverVisualSession`'s `transcriptPath`) call the new encode helper
  instead; the two comparison call sites (`session-store.ts`'s
  `writeVisualSessionDescriptor`, `client.ts`'s `readVisualSessionDescriptor`)
  compare canonical URI strings produced by the same encode helper against
  the URI fields already carried on the parsed document, which is a
  strictly stronger check than today's wire-string compare because both
  sides are now provably canonical.

## Producer/consumer flow and where authority is gated

```mermaid
sequenceDiagram
    participant Store as session-store.ts<br/>(native VisualSessionPaths)
    participant Server as session-server.ts<br/>(encode: pathToFileURL)
    participant Disk as descriptor.json / journal.jsonl
    participant CLI as visual-cli.ts / client.ts<br/>(decode: fileURLToPath)
    participant Skill as calling skill / harness

    Store->>Server: native sessionRoot, journalPath
    Server->>Disk: write VisualSessionStarted / VisualSessionDescriptor<br/>(URI fields, round-trip-clean by construction)
    Server-->>Skill: VisualSessionStarted.descriptorPath (URI, stdout)
    Skill->>CLI: yarramate-visual wait <descriptorPath URI>
    CLI->>CLI: decode URI -> native path (refuse: malformed / nonlocal / noncanonical)
    CLI->>Disk: open native path, O_NOFOLLOW/O_NONBLOCK (unchanged, YMVS401)
    Disk-->>CLI: VisualSessionDescriptor (URI fields)
    CLI->>CLI: re-encode own resolved path, own journal path;<br/>compare against descriptor's URI fields (ownership, YMVS403)
    CLI->>CLI: only past this point: use browserUrl / webSocketUrl (descriptor authority)
```

- **Producers** are `session-server.ts` (`VisualSessionStarted`,
  `VisualSessionDescriptor`) and `session-store.ts`'s `recoverVisualSession`
  (`VisualHandoff.transcriptPath`). All three call the encode helper on a
  native `VisualSessionPaths` field they already hold; encoding a path this
  process just resolved cannot fail (`pathToFileURL` has no error path for
  an already-absolute native string), so there is no producer-side refusal
  code — only an assertion that the input was absolute, which is a
  programming error, not a protocol fault, if it trips.
- **Consumers** are `client.ts`'s `readVisualSessionDescriptor` (decodes
  the CLI's positional argument and the descriptor's own `sessionRoot`/
  `journalPath`) and `visualSessionAlreadyStopped` (decodes the same
  argument on the already-stopped path). Both are untrusted-input
  boundaries and both must run decode-refuse-round-trip **before** the
  descriptor's bearer capabilities are read — `agentRequest`,
  `waitForVisualEvent`, `sendVisualResponse`, `fetchVisualStatus`, and
  `stopVisualSessionClient` all take an already-parsed, already-verified
  `VisualSessionDescriptor` as their argument, so gating happens once, at
  the top of `readVisualSessionDescriptor`, and nothing downstream can
  reach an ungated document.
- **The ownership check strengthens, not just relocates.** Today
  `paths.descriptor !== target` compares two `toWireAbsolutePath` outputs
  that may both be wrong the same way (aliasing is symmetric). Under this
  design both sides are independently round-trip-verified before the
  compare, so the check proves the descriptor names the exact file that
  was opened, not merely that their mangled forms happened to match.

## Error handling

New refusals are minted following the existing per-band, per-category
convention (`docs/superpowers/plans/2026-08-15-visual-editing-and-commit.md`:
"take the next contiguous code rather than backfilling a gap"; verified via
`grep -rEoh "YMVS[0-9]{3}" src/adapters/visual/*.ts | sort -u`, highest
1xx code in use is `YMVS132`, highest 4xx code in use is `YMVS413`):

- **`YMVS414`** — new client-side code (band 4xx: `client.ts` boundary
  refusals, alongside `YMVS401` unreadable/non-regular,
  `YMVS402` not JSON, `YMVS403` names artefacts outside its own directory).
  One code, three message shapes, matching the existing convention of one
  code covering a semantic category (`YMVS401` already covers two distinct
  underlying causes):
  - *Malformed*: the argument or a document's path field is not a
    parseable `file:` URI, or `fileURLToPath` rejects it
    (`ERR_INVALID_URL_SCHEME`, `ERR_INVALID_FILE_URL_PATH`, etc.) — `Session
    descriptor path "…" is not a canonical file: URI`.
  - *Nonlocal*: decode succeeds but `new URL(uri).hostname !== ''` — `Session
    descriptor path "…" names a nonlocal location`.
  - *Noncanonical / aliasing*: decode succeeds, host is empty, but
    re-encoding the decoded native path does not reproduce the input
    string byte-for-byte — `Session descriptor path "…" is not the
    canonical encoding of its own target`.
- **Existing codes are reused, not replaced, once decode has succeeded**:
  `YMVS401`/`YMVS402` (open/parse failures) and `YMVS403` (ownership
  mismatch) keep their current meaning and trigger after a successful
  `YMVS414` gate, on the now-canonical native path.
- **A v3 descriptor is refused generically, not specially.** A v3 document
  fails the v4 schema's `protocolVersion`/`format` `const` checks like any
  other schema violation, surfaced through the document's existing parse
  code (`YMVS102`/`YMVS103`) with a diagnostic pointing at
  `/protocolVersion` or `/format`. No bespoke "v3 detected" code or
  message is introduced — this is deliberate, matching ADR 0088's own
  choice not to special-case the old shape.
- **No server-side refusal code is needed for encoding**: as noted above,
  encoding a native path this process already resolved has no failure
  mode; a non-absolute input reaching the encode helper is a programming
  error and throws, uncaught, the same way an internal invariant violation
  elsewhere in this codebase does.

## v3 cutover policy

This is a v4-only change with no compatibility shim, matching ADR 0088's
"Not a compatibility shim" precedent:

- A v3 session descriptor, started result, or status document is refused
  by schema `const` mismatch (above), never parsed leniently, never
  translated to v4 shape. There is no dual-read path and none is added.
- A running v3 runtime and a v4 CLI (or the reverse) simply refuse each
  other at the first document exchanged — the same detectable-incompatibility
  property ADR 0088 established is preserved, not weakened, by adding a
  second breaking field-shape change on top of the removal ADR 0088 already
  recorded.
- **CLI argument cutover.** `yarramate-visual wait|respond|status|recover|stop`
  currently take a native (`cwd`-relative-or-absolute) path
  (`src/adapters/visual-cli.ts`, `descriptorPath: string`,
  `readVisualSessionDescriptor(descriptorPath, cwd)`). Under v4 the
  argument is the `file:` URI `yarramate-visual start` published as
  `VisualSessionStarted.descriptorPath` — copied back verbatim by the
  calling skill/harness, never hand-typed as a native path. `cwd`-relative
  resolution is removed from this argument entirely: a `file:` URI is
  inherently absolute, so the class of bug this whole design closes (an
  ambiguous, platform-dependent path string) cannot re-enter through the
  one remaining untrusted string input. The usage banner
  (`visualUsage` in `visual-cli.ts`) is updated to read `<descriptor-uri>`
  in place of `<descriptor.json>` at each of the five call sites.
- **`7663f0a` is superseded, not built on.** Its native-`VisualSessionPaths`
  half (keeping `visualSessionPaths` unconditionally native) is correct
  and is retained as-is. Its wire-normalization half
  (`toWireAbsolutePath` at three serialization sites, wire-form comparison
  at two consumption sites) is replaced wholesale by the encode/decode
  helpers above; none of `toWireAbsolutePath`'s call sites survive
  unchanged. `b501f1e`'s schema pattern widening
  (`^(?:/|[A-Za-z]:/)[^\u0000\\]*$`) is likewise replaced by the
  `sessionFileUri` `$def`. Neither commit is reverted — both are superseded
  by new commits built on this design, so the branch history keeps the
  record of the symptom that motivated the fix.

## Test and verification matrix

| Area | Case | Expected |
|---|---|---|
| Encode | POSIX absolute path, ASCII | `pathToFileURL` → `file:///a/b/c`; round-trips |
| Encode | POSIX path with space, `#`, `?`, non-ASCII byte | percent-encoded; round-trips |
| Encode | Windows drive-root path (native separators) | `file:///C:/Users/x`; round-trips |
| Encode | POSIX directory name containing a literal backslash | percent-encoded as `%5C`, distinguishable from a path separator (regression carried over from `7663f0a`, re-targeted at the new encoder) |
| Decode | Well-formed local `file:///…` URI | decodes to native path; matches what encode produced |
| Decode | Non-`file:` scheme (`http://`, `data:`) | refused `YMVS414`, malformed |
| Decode | Syntactically invalid URI (unbalanced `%`, control chars) | refused `YMVS414`, malformed |
| Decode | UNC-derived URI (`file://server/share/x`) | refused `YMVS414`, nonlocal |
| Decode | Same native target, two different percent-encodings of one byte | refused `YMVS414`, noncanonical (round-trip mismatch) |
| Decode | URI with a trailing-slash or `.`/`..` variance vs. the canonical form | refused `YMVS414`, noncanonical |
| Ownership | Descriptor's `sessionRoot`/`journalPath` URIs match the session that was opened | accepted, unchanged `YMVS403`-guarded path |
| Ownership | Descriptor copied beside a different session directory | refused `YMVS403`, now comparing two independently round-trip-verified URIs |
| Protocol | v3 `VisualSessionDescriptor`/`Started`/`Status` fed to the v4 parser | refused by `const` mismatch, existing parse code, no new code |
| Protocol | v4 documents round-trip through the full `start`→`wait`→`respond`→`recover`→`stop` CLI sequence against a real filesystem session | unchanged observable behavior other than URI-shaped path fields |
| CLI | `wait`/`respond`/`status`/`recover`/`stop` invoked with the exact `descriptorPath` URI `start` printed | succeeds |
| CLI | Same commands invoked with a native path (old-style argument) | refused `YMVS414`, malformed — this is the intended breaking behavior, asserted explicitly |
| Regression | `7663f0a`'s backslash-directory-name subprocess/unit test | re-target at `visualSessionPaths` (native, unchanged) and at the new encoder (wire-safe), both passing |
| Cross-platform | Windows-only assertions currently skipped on POSIX (`it.skipIf(!posixOnly)` and its Windows-side counterparts) | both platform branches exercised in CI, matching existing `test/visual-cli.test.ts`/`visual-session-store.test.ts` conventions |

## Planned ADR and issue requirements

Implementation is out of scope for this document and is tracked
separately:

1. **New ADR**, next available slot after `0095`
   (`docs/adr/0096-…` at the time of writing — confirm the actual next
   number when the ADR lands, since sibling work may claim `0096` first),
   titled to name the decision directly, e.g. "Visual session paths are
   published as canonical file URIs." It records, in ADR 0081/0088's own
   voice: the aliasing/nonlocal defects this design fixes, the choice of
   `pathToFileURL`/`fileURLToPath` over a custom encoding, the v3→v4
   protocol bump and the `v1`→`v2` bump on the three path-carrying
   documents, and the "not a compatibility shim" cutover decision — the
   same four elements ADR 0088 covered for its own removal.
2. **A tracked issue** for the implementation work itself, scoped to:
   schema edits (`yarramate-visual-session-started`,
   `-session-descriptor`, `-handoff` → `v2`; new `sessionFileUri` `$def`),
   `protocol.ts`/`protocol-contract.ts` (delete `toWireAbsolutePath`, add
   encode/decode helpers, bump `VISUAL_PROTOCOL_VERSION`), `session-server.ts`
   and `session-store.ts` (swap call sites), `client.ts` and
   `visual-cli.ts` (URI-only CLI argument, `YMVS414`), fixtures under
   `test/` for every row of the matrix above, and the ADR from item 1. The
   issue should link this design document and record that it supersedes
   the intent of `7663f0a` on `fix/visual-adapter-windows-absolute-paths`.
3. Both the ADR and the issue are written and filed as part of that later
   implementation work, not as part of this specification.

## Acceptance criteria

1. No protocol document accepts a bare native-path string in a field
   previously typed `$defs.absolutePath`; every such field is a `file:`
   URI validated by decode-refuse-round-trip, not by pattern alone.
2. A UNC or otherwise nonlocal path can never appear as a valid
   `sessionRoot`, `descriptorPath`, `journalPath`, or `transcriptPath` —
   provable by the "nonlocal" row of the verification matrix.
3. Two distinct native paths never produce the same accepted wire string,
   and one native path has exactly one accepted wire string — provable by
   the aliasing and noncanonical rows.
4. A v3 `VisualSessionStarted`, `VisualSessionDescriptor`, or `VisualStatus`
   document is refused by the v4 parser with no translation path, and the
   refusal is visible before any descriptor bearer capability is read.
5. `yarramate-visual wait|respond|status|recover|stop` accept exactly the
   URI `start` published and refuse a native-path argument.
6. `7663f0a` and `b501f1e` remain in branch history, superseded by new
   commits implementing this design; neither is treated as merge-ready on
   its own, and neither is reverted.
