# The editor is a mountable component, and a session is one host

Status: accepted

The visual editor is a browser component, not the screen of one Node process.
`yarramate-visual` remains the loopback conversation product, but its socket
session server is now one implementation of the editor's host seam rather than
the editor's only way to run.

## Why

**The socket made a reusable editor depend on a conversation.** The browser
owned a WebSocket, session fetch and reconnect loop, so a product that wanted
the canvas had to bring a Node session server, a journal and an agent journey
with it. A product that already owns its documents needs the engine and the
editor, not a second session lifecycle.

**The protocol is already the contract.** The editor reducer consumes
`VisualServerFrame` and sends `VisualBrowserInput`. Those are the published,
versioned frames from [ADR 0081](0081-a-visual-conversation-is-an-adapter-with-a-published-protocol.md).
A host seam made of a new set of editor verbs would create two contracts for
one browser and leave them to drift. A host instead delivers the frames and
accepts the inputs the editor already knows.

**ADR 0100 made the local engine possible without making Core asynchronous.**
A `SourceStore` owns reads and compare-and-swap writes, while Core works from
sources and an already-resolved workspace. The shipped interface is synchronous
on purpose: an asynchronous product fetches into an in-memory synchronous
store, runs the engine, then flushes the writes it receives. The same rule lets
the browser engine compile and persist over a store its caller owns.

**Chat is an agent capability, not a canvas dependency.** Filters, commits and
layout saves are engine work. Chat messages, choices, handoff and ending a
session need an agent and a session lifecycle. Making the latter mandatory
would make a reusable editor falsely claim it could converse.

## Decided

**The host seam is protocol frames and browser inputs.** `EditorHost` opens by
delivering `VisualServerFrame` values and accepts `VisualBrowserInput` values.
The socket host used by `yarramate-visual` implements that seam over the
existing session protocol. A product with its own compatible transport may use
that same seam; no second editor protocol is introduced.

**The package also ships a local host.** `mountEditor(element, { store,
workspace, sections? })` synchronously creates it over the caller's
`SourceStore` and `ResolvedWorkspace`, mounts the editor, and returns
`{ unmount }`. The workspace is resolved before the call because expanding a
manifest's globs is a filesystem concern, not browser-engine work.
`mountEditorWith(element, host, sections?)` is the alternative for a caller that
supplies an `EditorHost` itself. `createLocalHost` is exported for callers that
need the local host separately.

**The mounted bundle is self-contained.** Consumers import
`yarramate/visual-app` and `yarramate/visual-app/styles.css`; a host does not
supply React. Sections are declared by the caller. A local product normally
uses `['properties', 'changes']`: omitting `chat` is an honest declaration that
there is no agent behind the editor, not a reduced engine.

## Consequences

- The local host compiles and projects the supplied workspace, evaluates
  filters, commits changes and saves layouts through the caller's synchronous
  store. Model and view writes from one changeset reach `writeAll` in one
  compare-and-swap batch.
- The caller owns persistence. An asynchronous backing service must fetch
  before mounting into a synchronous in-memory store and flush the writes it
  receives; the editor does not turn `SourceStore` into an asynchronous API.
- The local host has no chat, choices, journal, handoff or session end. It is
  not a replacement for a conversation server.
- `yarramate-visual` remains the socket/session host, including its agent
  journey and session lifecycle. Existing session clients keep their path.

## Rejected

**Keeping the editor inseparable from the socket session.** That preserves one
runtime at the price of forcing every embedded product to run a server and an
agent for mechanical editor work.

**Inventing a local-only callback or command API.** It would duplicate the
published protocol and give the reducer two ways to express the same input.

**Making `SourceStore` asynchronous.** This repeats the rejected alternative in
ADR 0100: it would make the shipped CLI, adapters and tests asynchronous for
stores that are not shipped. Fetching and flushing at an asynchronous product's
boundary is the narrower seam.

**Rendering a chat section without an agent.** A composer with nobody to answer
and no handoff to make is a broken promise, not a capability.
