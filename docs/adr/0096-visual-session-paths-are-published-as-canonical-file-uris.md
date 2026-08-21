# Visual session paths are published as canonical file URIs

Status: accepted

`VisualSessionDescriptor`, `VisualSessionStarted`, and `VisualHandoff` carry
absolute filesystem paths — `sessionRoot`, `descriptorPath`, `journalPath`,
`transcriptPath`. Until now those were bare strings, minted by a single string
transform in `src/adapters/visual/protocol.ts` that replaced every backslash
with a forward slash. This ADR records replacing that representation with
canonical local `file:` URIs, encoded and decoded through Node's own
`pathToFileURL`/`fileURLToPath`, and the version bumps that follow.

## Why a lossy transform was not enough

The transform stood in for a path encoding without being one. It fails in both
directions.

**It aliases.** A POSIX directory whose own name contains a literal backslash
and a Windows path joined with native separators collapse to indistinguishable
forward-slash text. That is not theoretical: it is the defect that opened this
work. Before the fix on this branch, `visualSessionPaths` returned the mangled
form, so `fs` calls against the marker, the journal, and the root missed the
directory `createVisualSession` had just made. Moving the mangling to the
serialization sites stopped the ENOENT without restoring an invertible mapping:
two distinct native paths could still produce one wire string, and nothing
detected it.

**It has no concept of a host.** A UNC path became a double-slash-rooted
string, which satisfied the schema's POSIX-rooted pattern as an ordinary local
path. [ADR 0081](0081-a-visual-conversation-is-an-adapter-with-a-published-protocol.md)
fixes the runtime's authorization model on a server that is loopback and
ephemeral, with nothing shareable, resumable, or reachable from another
machine. A session document that can silently name a network share breaks that
invariant at the one layer a consuming harness cannot independently re-check.

**It cannot back a proof of identity.** `readVisualSessionDescriptor` treats an
on-disk descriptor as hostile until its `sessionRoot`/`journalPath` are shown
to name the same file the CLI was told to open (`YMVS403`). That check was a
byte compare of two transform outputs. A transform with no defined canonical
form and no inverse cannot prove two paths are the same file; it can only fail
to disprove it, which is a materially weaker guarantee for the check that gates
whether the descriptor's bearer capabilities are spent at all.

## Decided

Every path field on the wire is a canonical local `file:` URI.

- **Encode** is `pathToFileURL(native).href`, at the sites that previously
  called the string transform and nowhere else. `VisualSessionPaths` stays
  native throughout: it is consumed as a filesystem path far more often than it
  is serialized, so encoding belongs at the boundary rather than at its source.
- **Decode** is `fileURLToPath`, wrapped so every failure Node itself raises is
  a refusal rather than an exception, and gated on two further checks: the
  URL's host must be empty, and re-encoding the decoded path must reproduce the
  input byte for byte. A URI that decodes but does not re-encode to itself is
  refused as noncanonical, never repaired.
- The old `toWireAbsolutePath` is deleted rather than deprecated.

`file:` URIs win over a stricter regex because a pattern can describe what a
string looks like but not which native path it denotes, and aliasing is exactly
two inputs sharing one appearance. They win over a custom tagged format
(a platform tag beside a path) because `pathToFileURL`/`fileURLToPath` are the
runtime's existing, dependency-free, already-vetted answer to this problem, and
a custom format would still need its own round-trip check to earn the same
guarantee. The host check falls out of the same primitive: `pathToFileURL`
leaves the host empty for every local path, so "nonlocal" is an empty-hostname
test rather than a rule to invent.

Refusals are reported as **`YMVS414`**, one code with three message shapes
(malformed, nonlocal, noncanonical), following the convention `YMVS401` already
sets by covering two distinct underlying causes. `YMVS401`, `YMVS402`, and
`YMVS403` keep their meanings and now run after a successful decode, on a path
already proven canonical.

Per ADR 0081's own "what the schemas alone do not say" precedent, JSON Schema
cannot express "is a canonical local file URI". The `sessionFileUri` definition
keeps a coarse structural gate, requiring the three-slash local form that a
UNC-derived URI fails outright; the real enforcement lives in `protocol.ts`
beside the Ajv validators, where the byte-length and path-confinement checks
already live.

## Why this bumps the wire, and what it does not bump

[ADR 0088](0088-removing-the-agents-mutation-path-bumps-the-wire.md) drew the
line between a document that grew a member and a member whose contract changed.
A field that was a bare path and is now a URI is the second kind: the name is
identical, so nothing about the shape of the document warns a v3 consumer, and
every such field it reads decodes to something it will use as a filesystem
path. That is precisely the detectable incompatibility the version exists to
turn into a refusal.

- `VISUAL_PROTOCOL_VERSION` becomes `yarramate/visual-protocol/v4`, pinned as a
  `const` in the three documents that agree on it (started, descriptor, and
  status), so a v3 consumer meets the mismatch in whichever it reads first.
- The three documents that carry a path move to `v2`:
  `visual-session-started`, `visual-session-descriptor`, `visual-handoff`.
- The eight that carry no path stay at `v1`. `visual-status` keeps
  `yarramate/visual-status/v1` and moves only its `protocolVersion` const,
  exactly the detection-only case ADR 0088 recorded for itself.

## Not a compatibility shim

A v3 document is refused by `const` mismatch through the existing parse codes,
with a diagnostic pointing at `/format` or `/protocolVersion`. There is no
dual-read path, no translation, and no bespoke "v3 detected" code, matching
ADR 0088's own choice not to special-case the shape it removed. A v3 runtime
and a v4 CLI refuse each other at the first document exchanged.

The CLI argument breaks with it. `wait`, `respond`, `status`, `recover`, and
`stop` took a native path resolved against `cwd`; they now take the exact
`descriptorPath` URI `start` published, copied back verbatim by the calling
skill or harness. Working-directory resolution is removed from that argument
rather than kept alongside: a `file:` URI is inherently absolute, so the class
of ambiguity this change closes cannot re-enter through the one string an
operator still passes by hand. A native path is refused with `YMVS414`, which
is the intended behavior and is asserted as such.

## Consequences

- Two distinct native paths can no longer produce one accepted wire string, and
  one native path has exactly one accepted spelling.
- A nonlocal path can never appear as a valid `sessionRoot`, `descriptorPath`,
  `journalPath`, or `transcriptPath`.
- The `YMVS403` ownership check strengthens rather than merely moving: both
  sides of the compare are independently round-trip-verified first, so a match
  proves the descriptor names the file that was opened.
- A `localhost` file host is refused as noncanonical rather than nonlocal.
  WHATWG `URL` normalizes that host away before the host check sees it, leaving
  a URI that is simply not the spelling this codec mints. It is refused either
  way; only the reported reason differs.
- The length bound on a path field doubles to 8192, sized for a path whose
  every byte needs three characters of percent-encoding. This widens the wire
  envelope, not the 4096-byte native path bound, which is unchanged.
- Case-insensitive-filesystem aliasing is untouched. `pathToFileURL` and
  `fileURLToPath` are pure string functions with no filesystem access, so they
  cannot resolve case folding, and nothing else in this codebase does either.
  That is a pre-existing platform property of every path this runtime already
  handles, not something this change introduces.

The design this ADR was written against is
`docs/superpowers/specs/2026-08-21-visual-wire-path-v4-design.md`.
