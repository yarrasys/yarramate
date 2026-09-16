# The tools entry is the engine's path-free surface

Status: accepted. Amends ADR 0044 and ADR 0149.

Every verb the CLI runs lived inside `run*Command(argv, cwd)`: argument
parsing, `readFileSync`, the engine call, the rendering, one function each.
The engines beneath were already pure (the compiler, the interrogation
engine, the apply core, the projection renderer, the RTM, the LikeC4
export, the workbook writer import no Node built-in), but the only way to
reach them as a verb was through a path. The stdio adapter therefore ran
the CLI in-process with paths (ADR 0044, ADR 0149), lending it scratch files
where a call carried text.

yarramate.dev's hosted workspaces (#543) run the engine inside a Durable
Object over a `SourceStore` (ADR 0100), with no filesystem and no CLI. The
object could compile and could mount the editor's local host, and could
not serve a single tool: `design`, `ask`, `check`, `apply` and `export` had
no store-backed form. A second implementation of the verbs on the hosted
side would have been the drift ADR 0044 forbade.

## Decision

`yarramate/tools` is the engine's path-free entry. Each verb is a function
over a `ToolWorkspace` (`{ store, workspace, manifestDirectory?, catalogue?,
yarramateVersion? }`): `designStep`, `askOrientation`, `askSlice`,
`askRoster`, `askKinds`, `askNext`, `askOpen`, `checkWorkspace`,
`applyBatch`, `exportMarkdown`, `exportGraph`, `exportBriefs`, `exportRtm`,
`exportLikeC4`, `exportWorkbook`. They return the published documents
(`yarramate/design-step/v1`, `yarramate/ask-result/v1`,
`yarramate/check-result/v1`, `yarramate/apply-result/v1`) and the
deliverables as text, files or bytes; nothing writes. One `ToolResult<T>`
carries a refusal as `diagnostics` (the engine's, with locations) or
`refused` (an argument, in one sentence). `resolveWorkspaceFrom(manifest,
paths)` is `loadWorkspaceManifest` over a listed file set, with the same
YM701/YM702/YM703. The shipped catalogue and the LikeC4 specification
travel as generated text modules, so no entry reads the package's files.

**The CLI commands are thin over the same functions.** `design`, `ask`,
`check`, `export` and `apply` parse arguments, resolve the manifest against
the filesystem, build a `ToolWorkspace` over `createFileSystemStore`, call
the core, and render the human form. Their JSON forms are the cores'
results, printed. The git-derived modes (`ask --changed`, `export --changed`,
`export likec4 --changed`, `reconcile`) stay the CLI's own and compose the
same helpers.

**One tool table.** `TOOL_CATALOGUE` holds the six rows (name, description
ending in the loop, input schema, access, served) and `runTool(name,
input, workspace)` answers a call over a store with exactly the text the
stdio adapter returned before. The stdio adapter publishes the rows with
its two filesystem-only properties spread in (`STDIO_PROPERTIES`:
`workspace`, `out`) and dispatches every call but `reconcile` to `runTool`
over a store rooted at the repository. A hosted server publishes the rows
as they are and dispatches to the same function over its own store.
`reconcile` is `stdio-only`: it evaluates evidence against a repository,
and the row says so in one line where it is not served.

**`yarramate/host`** ships `createLocalHost` and the `EditorHost` seam
without the editor bundle, built by `tsc` like every engine entry, so a
server can run the host the browser runs. `yarramate/visual-app` re-exports
the same names. **`createSocketHost(options?)`** takes its routes, retry
and reconnect window; with no argument it is what `yarramate-visual` mounts.

ADR 0044's rule stands in its intent and changes in its letter: the
adapter still adds no semantics, but the surface it executes is the tool
functions, which the CLI also executes, rather than the CLI itself.
ADR 0149's scratch files are gone; an operations document arrives as text
or an object and lands through the store.

## Consequences

- One semantics by construction: the CLI, the stdio adapter and a hosted
  server cannot drift, because there is one implementation of each verb.
  `test/tools-entry.test.ts` compares every function with the CLI on the
  repository's own record, byte for byte, the generated LikeC4 project
  included.
- Two entries join the purity guard (`test/export-purity.test.ts`) with
  the compiler allowed at runtime, since compiling is the point; the
  manifest loader, the filesystem store, git and the CLI stay out.
- `AskSlice.rendered` is an additive field on the published document: the
  brief, or the budgeted context, so a hosted tool answers an agent with
  text without re-rendering. The CLI's `--json` omits it, so its output is
  unchanged.
- `sha256Hex` is a pure SHA-256, pinned to `createHash` by test, so a
  workbook's provenance and a generated project's marker carry the same
  digests from any entry.
- `checkWorkspace` reads a Core contract's files through the store; a
  runtime with no schema compiler treats a schema that parses as valid.
- The stdio adapter's `--json` output for a slice gains `rendered`; nothing
  else it returns moves. Its tool list is byte-identical but for the
  workspace sentence and the `out` property it always had.
