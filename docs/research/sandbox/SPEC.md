# yarramate.dev sandbox: specification

Status: SHELVED, 2026-09-13. Nabeel's decision the same day: launch filesystem-only.
Supported platforms are the desktop apps and the command-line agents, which all have a
filesystem, so the record lives in the visitor's repository and nothing is hosted. This
document stays as the design for the chat-native door (claude.ai and ChatGPT in a browser or
on a phone), to be opened only if the site shows demand for it. Of section 13, only item 2
(stdio adapter parity: `yarramate_apply`, `yarramate_export`, optional `workspace`) is
needed now, because a desktop app cannot run the CLI to land an answer. Nothing else here is
built.

## 1. What it is, in one paragraph

A visitor's own agent connects to a yarramate record over the Model Context Protocol
(MCP) at a public URL, works the interview loop with the visitor, and the visitor watches
the map change in a browser tab. The agent, its model and its judgment stay on the
visitor's side. yarramate.dev holds only the record, answers deterministic tool calls
against it, and shows it. The record is plain files at every moment and leaves as a
download. No account, no model spend on our side, no data kept past the sandbox's
lifetime.

## 2. Why it exists

The interview loop runs in the agent's harness: the agent calls `design`, phrases the
question, takes the answer, calls `apply`, calls `design` again. The engine functions
behind those calls are stateless. The only state is the record.

A terminal agent (Claude Code, Codex CLI, Cursor) has a filesystem, so the record lives in
its repository and the MCP server runs locally. Nothing is hosted. A chat agent (claude.ai,
ChatGPT) has no filesystem and can only call a public URL. For those agents someone must
hold the record somewhere reachable. The sandbox is that, and nothing more: the record's
address, plus a browser view of the same record.

Validated on 2026-09-13 with a throwaway probe on the yarramate.dev Cloudflare account:
claude.ai (no-auth and guest OAuth), ChatGPT Pro (no-auth, write tool), Codex desktop (URL
and guest OAuth) and Claude Code (bearer and URL) all connected and identified their
sandbox. See the website-redesign memory for the evidence trail.

## 3. Principles

1. **Same tool surface at every layer.** The MCP tools a sandbox serves are the same
   names and schemas the stdio adapter serves over a local repository. An agent
   configured for one works on the other. The tool surface is the product's public API
   and is versioned with the package.
2. **The record is plain files.** Same folder layout as `yarramate init` produces.
   Download at any time; import later. Nothing exists only in the sandbox.
3. **A sandbox is a host around the local host.** The Durable Object runs
   `createLocalHost` from `yarramate/visual-app` over its own storage, the same host the
   mounted editor runs in a browser. It does not re-implement the session server.
4. **No model on our side.** Tool calls run deterministic engine code. Cost is compute
   and storage, both capped.
5. **No account, no persistence past lifetime, no support obligation.** Stated on the
   page. A later "claim into a workspace" reuses the same object; see section 12.
6. **Sandbox and workspace are one object type.** The sandbox is a workspace object with
   an empty owner field and a lifetime. Building it that way avoids a migration later.

## 4. Hosting

Cloudflare, in the account that serves yarramate.dev (the account ym-website deploys
from; the probe ran there).

| Piece | Role |
|---|---|
| Worker `yarramate-sandbox` at `mcp.yarramate.dev` | OAuth endpoints, guest authorize page, MCP route, sandbox creation, browser socket upgrade, download |
| Durable Object class `Sandbox`, SQLite-backed, one instance per sandbox | holds the record, runs the local host, answers tool calls, serves the browser socket, enforces its own caps, deletes itself on expiry |
| KV namespace `OAUTH_KV` | OAuth client registrations, grants and hashed tokens (the provider library's store) |
| KV namespace `SANDBOX_KV` | global daily creation counter, token to object-id map |
| Rate-limit bindings | first-line caps on creation per IP and calls per sandbox |
| Turnstile widget | bot check on sandbox creation |
| Cron trigger, daily | `purgeExpiredData()` on the OAuth store |

The page that shows the map lives on yarramate.dev (the website repo) and loads the
editor bundle from the yarramate package. It talks to the Worker over a WebSocket.

Why one Durable Object per sandbox: single-threaded per instance, own storage,
placed near the first request, hibernates when idle, and the engine already runs inside a
Durable Object in ApertureX's production, so Workers-safety of the engine is proven.

## 5. Identity and authentication

Three ways to name a sandbox, one object behind all of them.

| Path | Who uses it | Mechanism |
|---|---|---|
| `https://mcp.yarramate.dev/mcp` | claude.ai, ChatGPT (OAuth), Codex `mcp login`, Cursor, Claude Code `/mcp` | OAuth 2.1 with a guest authorize page. The bearer carries the sandbox id in its props. |
| `https://mcp.yarramate.dev/s/<token>/mcp` | CLIs and scripts, ChatGPT "No authentication" | The token in the path is the capability. Same tools. |
| `https://yarramate.dev/s/<token>` | the visitor's browser | The page; opens the socket to the same object |

**Guest OAuth.** The Worker is an OAuth 2.1 authorization server using
`@cloudflare/workers-oauth-provider`: PKCE S256 only, dynamic client registration and
client ID metadata documents both enabled (the 2026 MCP spec deprecates registration for
new clients; claude.ai used it today), protected-resource and authorization-server
metadata at the well-known paths, tokens stored by hash, props encrypted. The `/authorize`
page has no login. It shows:

1. a Turnstile check;
2. **Attach to the sandbox this browser holds**, when a `ym_sandbox` cookie names a live
   one, shown first;
3. **Create a new sandbox**, otherwise or as the second choice;
4. the connecting client's registered name, so the visitor knows what they are granting.

Completing authorization mints or reuses the sandbox, sets the cookie, and returns a code.
Access token lifetime equals the sandbox lifetime; refresh tokens are issued and die with
the sandbox. Grants are keyed by sandbox id, so deleting a sandbox revokes its tokens.

**Token in the path.** Minted at creation, 160 bits, base64url. It is the whole secret
for that sandbox. Acceptable because the sandbox expires, holds only what the visitor put
there, and the page says so. Never logged; the Worker strips it from any log line.

**Both paths resolve to the same object id.** `SANDBOX_KV` maps token to object id; the
OAuth props carry the object id directly.

## 6. Creation

Two entry points, both behind Turnstile, both minting the same object.

- **From the page.** "Start a sandbox" on the home page (or on the reference-engagement
  page) posts the Turnstile response to `POST /sandbox` with a seed choice. The response
  is the sandbox link; the page navigates to it, sets the cookie, and shows the connect
  panel.
- **From the agent.** The OAuth authorize page, when no cookie names a live sandbox. The
  first tool result the agent receives includes the page link, so the agent can hand it
  to the person: "open this to watch the record".

Seeds:

| Seed | Content | When |
|---|---|---|
| `blank` | `yarramate init` output only | default: the interview starts from "what are you building" |
| `reference` | the fictional reference engagement, current state | "copy this engagement into my sandbox" from the showcase page |

Creation writes the seed files into the object's storage, records `createdAt`,
`expiresAt`, seed, and nothing about the person.

## 7. The tool surface

Served over Streamable HTTP by `createMcpHandler` from the `agents` package
(`agents/mcp/server`), stateless per request; state lives in the object. Tool names and
schemas are shared with the stdio adapter in `src/adapters/mcp-cli.ts`, which gains the two
tools it lacks today so the surfaces match.

| Tool | Reads or writes | Engine beneath | Notes |
|---|---|---|---|
| `yarramate_ask` | read | compile, projection slice, interrogation, brief | modes: orientation, free text, subject, roster, kinds, next, open |
| `yarramate_design` | read | compile, catalogue evaluation, step rendering | the top open question with slice, materiality, trigger and answer skeleton; `subject` narrows |
| `yarramate_apply` | write | `planOperations` and `landOperations` over the store | atomic batch; refused whole on any invalid operation; returns the apply result and diagnostics |
| `yarramate_check` | read | compile plus validators | the verdict and diagnostics |
| `yarramate_export` | read | brief, RTM, LikeC4 project, workbook | returns text or a download link on the Worker |
| `yarramate_sandbox` | read | none | the sandbox's page link, expiry, caps used, download link. Sandbox-only tool; the stdio adapter does not serve it |

Not served: `reconcile`, because a sandbox holds no code to reconcile against. The tool
list says so in one line rather than silently omitting it.

The `workspace` argument the stdio adapter requires becomes optional everywhere and
defaults to the only workspace, so one agent instruction works on both.

Every tool description carries the loop in two sentences (call design, answer, apply,
call design again) because the visitor's agent has never seen yarramate. The skill file
shipped with the package is the long form; the Worker serves it at
`https://mcp.yarramate.dev/skill` and as an MCP resource.

After any successful `apply`, the object calls the local host's `refresh` so every
attached browser receives a fresh model frame.

## 8. The browser view

The page at `https://yarramate.dev/s/<token>` mounts the editor with `mountEditorWith`
over a socket host pointed at `wss://mcp.yarramate.dev/s/<token>/socket`. The socket
speaks the existing visual session protocol, version 5: the browser sends `filter.query`,
`changeset.commit`, `layout.save`, `view.navigate` and `session.end`; the object answers
with `ready`, `model`, `filter-result`, `apply-result` and `closing` frames. The
`chat.message` and `choice.selected` inputs are never sent because the page mounts without
the chat section; the agent talks over MCP, not over the socket.

Inside the object, inputs go to the local host's `send`, and the host's frames go to
every attached socket with a sequence number. Reconnects send `after=<lastSequence>` and
receive the frames they missed, as today's session server does. Layout sidecars are stored
beside the record so a drag survives a reload.

The page also shows, beside the canvas:

- the connect panel: one card per client with the exact thing to paste (claude.ai and
  ChatGPT get the OAuth URL and a two-line click path; Claude Code, Codex and Cursor get
  the one-line command with the token URL), and a copy button on each;
- the sandbox's expiry and caps used;
- **Download the record** (zip of the folder) and **Run it locally** (the three commands);
- the no-account, no-persistence statement.

WebSocket hibernation keeps an attached idle browser from costing compute.

## 9. Storage inside the object

A synchronous `SourceStore` (ADR 0100) over the object's SQLite-backed storage, using the
synchronous key-value API (`ctx.storage.kv.get`, `put`, `delete`, `list`). Keys:

| Key | Value |
|---|---|
| `file:<path>` | document bytes, one per record file, plus layout sidecars |
| `rev:<path>` | revision counter for compare-and-swap |
| `meta` | createdAt, expiresAt, seed, counters |
| `clients` | registered client names that have connected, for the whoami-style tool |

`writeAll` is atomic within one call because the object is single-threaded and the
storage API groups writes in the same task. Revisions are the store's own; nothing outside
compares them.

The manifest is resolved at creation from the seed's file list and stored as
`ResolvedWorkspace`, since glob expansion is the one engine step that needs a filesystem.
Adding a document through `apply` updates the stored manifest by name.

## 10. Caps and lifetime

Enforced inside the object, where they are exact. The rate-limit bindings in front are a
cheap first line and are permissive by design.

| Cap | Value | Enforced by |
|---|---|---|
| lifetime | 24 h from creation | alarm; on fire, `deleteAll` and revoke grants |
| idle | 60 min without a tool call or socket message | alarm reset on activity |
| storage | 2 MB of record files | refuse the apply that would exceed it |
| documents | 50 | same |
| subjects | 2,000 | same; keeps compile inside the object's CPU budget |
| tool calls | 60 per minute, 5,000 per lifetime | counter in `meta`; 429 with a plain message |
| sandboxes per IP | 20 per day | rate-limit binding on creation, keyed by a hash of the IP |
| sandboxes globally | 2,000 per day | `SANDBOX_KV` counter; creation answers "try tomorrow" |
| socket connections | 4 per sandbox | object |

The page and every refusal name the cap and the number, never a bare error.

## 11. Privacy and data

- Stored: the record files the visitor and their agent wrote, layout sidecars, the meta
  row, OAuth grants keyed by sandbox id, and the registered client names.
- Not stored: IP addresses (hashed only inside the rate-limit key, which is not readable),
  email, names, prompts, agent transcripts. The Worker never sees the agent's
  conversation, only tool calls.
- Deleted: everything, at expiry, by the object itself. The daily cron purges expired
  OAuth records.
- Logs: request counts and error classes. Tokens are stripped. No analytics script on the
  page.
- The one metric worth keeping, as a counter, not a log: sandboxes where an agent applied
  at least one change. That is the adoption signal the site exists for.
- Content is the visitor's own; nothing is shared between sandboxes. The reference seed is
  fictional and labelled so.

## 12. Exit and the path to a workspace

The exit is a download. `GET /s/<token>/export.zip` returns the folder exactly as
`yarramate init` would have laid it out, plus a `README` with the three commands to run it
locally and the stdio MCP config for each client.

The claim into an account-owned workspace (layer 2) is out of scope here, but the object
is shaped for it: same file layout, same tool surface, a `meta.owner` field that is empty.
Claiming fills the owner, lifts the lifetime and raises the caps. The token stays valid so
a connected agent keeps working through the moment the person signs in. Nothing moves.

## 13. Changes needed in the yarramate package

These are the only changes to the engine repository. Everything else is the sandbox's own.

1. **A Workers-safe tools entry**, `yarramate/tools`, exporting pure functions the
   sandbox and the stdio adapter both call: `designStep`, `askOrientation`, `askSlice`,
   `askRoster`, `askKinds`, `askNext`, `askOpen`, `checkWorkspace`, `applyBatch`,
   `exportBrief`, `exportRtm`, `exportLikeC4`, `exportWorkbook`. Each takes a
   `SourceStore` plus a `ResolvedWorkspace` and options, never a path. Today these live
   inside `runDesignCommand`, `runAskCommand`, `runCheckCommand` and `export-command.ts`
   behind file reads; the engines beneath (`compiler`, `interrogation-entry`,
   `apply-command`, `brief`, `rtm`, `likec4-export`, `workbook-entry`) already import no
   Node built-ins. Guarded by the existing purity test pattern in
   `test/export-purity.test.ts`.
2. **Two more stdio tools**, `yarramate_apply` and `yarramate_export`, so the local
   adapter and the sandbox serve the same surface. `workspace` becomes optional.
3. **Tool descriptions carry the loop** in two sentences, in one shared table both
   adapters read.
4. **`LocalEditorHost.refresh` stays public** (it is) and gets a one-line doc note that a
   host calls it after an out-of-band write.
5. Nothing in the editor bundle changes. `mountEditorWith` and `createSocketHost`'s
   shape already cover the page.

## 14. The sandbox's own code

A new repository, `yarrasys/yarramate-sandbox`, deployed by the same account and
credentials the website uses.

```
src/index.ts          Worker: OAuth provider wrapper, routes, creation, download, socket upgrade
src/authorize.ts      the guest page: Turnstile, attach-or-create, completeAuthorization
src/sandbox.ts        Durable Object: store, local host, MCP handler, socket fan-out, caps, alarm
src/store.ts          synchronous SourceStore over ctx.storage.kv
src/tools.ts          MCP tool registrations calling yarramate/tools
src/seeds/            blank and reference seeds, generated at build from the package and the showcase repo
test/                 spec client (the probe's client.mjs, kept), object tests under vitest-pool-workers
wrangler.jsonc        DO migration new_sqlite_classes, bindings, cron, compatibility flags nodejs_compat and global_fetch_strictly_public
```

Dependencies: `yarramate`, `agents`, `@modelcontextprotocol/server`,
`@cloudflare/workers-oauth-provider`, `zod`. Versions pinned; the probe's set is the
starting point.

The website repo gains the `/s/<token>` page: the editor bundle, the socket host, the
connect panel and the statement. It has no server code of its own for this.

## 15. Build order and effort

| Step | Where | Days |
|---|---|---|
| 1. `yarramate/tools` entry with purity guard; stdio adapter parity | yarramate | 2 |
| 2. Store, object, tool handler, creation, authless path, download; spec client green against `wrangler dev` | sandbox | 2 |
| 3. Guest OAuth with attach-or-create, Turnstile, cookie; real-client pass on claude.ai, ChatGPT, Codex, Claude Code, Cursor | sandbox | 1 |
| 4. Socket fan-out with sequence replay, layout sidecars; page with connect panel; map moves on apply in a browser | sandbox and website | 2 |
| 5. Caps, alarms, cron purge, logging without tokens, the metric counter | sandbox | 1 |
| 6. Copy on the page, the skill resource, README in the export | website and sandbox | 1 |

Nine working days, in the order above, each step verified in a browser and with a real
client before the next. The static live page (the reference engagement, read-only) ships
before step 1 and does not wait for any of this.

## 16. Verification

- The spec client from the probe, kept as an integration test: discovery, registration,
  guest authorize, PKCE exchange, initialize, tools, isolation between two sandboxes,
  forged bearer refused, authless path.
- Object tests: caps refuse at the boundary, alarm deletes, `writeAll` is atomic, a
  refresh after apply produces a model frame, reconnect replays from a sequence.
- A real-client checklist run before launch and after any dependency bump: claude.ai
  no-auth and OAuth, ChatGPT Pro plugin, Codex desktop, Claude Code, Cursor. Each must
  connect, call design, apply one operation, and the map must move in an open tab.
- Purity: the tools entry imports no Node built-ins, checked by the existing test.
- Load: 200 concurrent sandboxes each applying one batch per second for five minutes stay
  within the object CPU budget and the caps behave.

## 17. Risks and their answers

| Risk | Answer |
|---|---|
| The visitor's agent does not know how to work the loop | tool descriptions carry it; the skill is a resource; the design step returns an answer skeleton |
| Someone uses sandboxes as free storage or a relay | lifetime, storage cap, call cap, creation caps, no sharing between sandboxes |
| Token leaks from a config file or history | 24 h lifetime; only the visitor's own content is exposed; the page says the link is the key |
| Compile time on a large record exhausts the object's CPU budget | subjects cap; compile of 367 subjects took 650 ms in a browser |
| Rate-limit bindings are per-location and permissive | they are the first line only; the object's counters are exact |
| Dynamic client registration is being deprecated for new clients | client ID metadata documents are enabled alongside it |
| Two logins orphan a sandbox | attach-or-create on the authorize page, cookie-backed |
| The sandbox delays the real install rather than causing it | every surface points at the download and the three local commands; the metric counted is applied changes, not sessions |

## 18. Open decisions for Nabeel

1. Hostname: `mcp.yarramate.dev` for the Worker and `yarramate.dev/s/<token>` for the
   page, or everything under one host.
2. Default seed: blank (the interview story) or the reference engagement (something to
   look at first). The spec says blank by default with the copy-the-engagement button on
   the showcase page.
3. Lifetime: 24 hours as written, or shorter.
4. Whether the sandbox repository lives beside the website or inside it.

## ADR candidates for the yarramate repository

- The MCP tool surface is the product's public API and is identical at every layer.
- A hosted sandbox is a host around the local host, never a second implementation.
- The sandbox is a workspace object with an empty owner; claiming fills it.
