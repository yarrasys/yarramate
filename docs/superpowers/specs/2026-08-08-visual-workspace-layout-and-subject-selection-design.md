# Visual workspace layout and subject selection

**Status:** Approved design  
**Date:** 2026-08-08  
**Extends:** `2026-08-08-visual-architecture-conversations-design.md`

## Summary

Rework the visual-conversation browser so the LikeC4 diagram is the primary workspace rather than content below a large document header. Replace the permanent header and vertical status rail with a compact command strip, make the conversation user-controlled, resizable, and collapsible, and use a bottom sheet on narrow screens.

Let the reviewer select either an element or a relationship in the LikeC4 renderer. Show stable identity and progressive description in the conversation panel, attach the selected subject to the composer, and include explicit readable context only when the user sends a question. Selection is local presentation state: a click alone is never journaled and the closed v1 protocol does not change.

This design supersedes the original design's browser-layout details. Runtime, authority, protocol, recovery, security, packaging, and skill boundaries remain unchanged.

## Problem

At 1568×924, the current browser gives roughly 215px of vertical space to a static title and description, 56px of horizontal space to a vertical status rail, and a fixed 21rem–26vw column to an empty conversation. The diagram receives the remainder even when the user has asked nothing. View tabs consume another permanent row. The resulting canvas is substantially smaller than the viewport and the vertical rail is difficult to scan.

The browser also enables LikeC4 element and relationship details but does not capture which rendered subject was clicked. The reviewer cannot carry that context into a question, and descriptions are not surfaced in the YarraMate-owned conversation workspace.

## Goals

- Make the LikeC4 canvas consume every pixel not actively used by controls or an open conversation.
- Keep title, authority, active view, connection state, attention, and End persistently reachable.
- Let the reviewer open, close, and resize the conversation without the application fighting that choice.
- Show selected element and relationship identity and descriptions next to the conversation.
- Make the exact selected-subject context sent to the visual agent visible in the transcript.
- Preserve the existing closed v1 protocol and append-only journal semantics.
- Preserve keyboard operation, responsive behavior, reduced motion, and safe text rendering.

## Non-goals

- Hover telemetry, click analytics, or journaling every diagram interaction.
- A general model inspector or source-code editor.
- Relationship editing, canonical model writes, or promotion of browser selection into declared intent.
- A new visual protocol version or optional fields added to a v1 document.
- Persisting panel preferences across visual sessions.
- Replacing LikeC4's renderer, details surfaces, pan/zoom controls, or navigation history.
- Adding a DOM-test framework solely for this change.

## Visual direction

Keep the existing drafting-desk palette, typography, square controls, and explicit authority colours. Change structure rather than re-theme the application. The command strip becomes the one signature element: dense enough to reclaim space, but each item encodes live session information or a user action.

Remove decorative or duplicate structure. In particular, the command-strip view selector replaces the application-owned bottom view-tab row. LikeC4's own in-canvas navigation and controls remain.

## Desktop workspace

At widths above 900px, the application fills `100dvh` with two rows:

```text
┌──────────────────────── 48px command strip ───────────────────────────┐
│ Title · authority · view ▾ · Details     Live · Conversation · End   │
├──────────────────────────────────────────┬─┬──────────────────────────┤
│                                          │↔│ Selected subject         │
│                                          │ │ Conversation             │
│              LikeC4 canvas               │ │ Choices / diagnostics    │
│                                          │ │ Composer                 │
│                                          │ │                          │
└──────────────────────────────────────────┴─┴──────────────────────────┘
```

### Command strip

The 48px strip contains:

- session title, truncated rather than wrapped;
- canonical/ad-hoc authority marker;
- active-view selector;
- **Details**, revealing the full session description without reserving canvas height;
- connection state;
- **Conversation**, including an attention count while closed;
- always-reachable **End**.

The vertical rail is removed. Authority, connection, and active view become horizontal, readable values. The application-owned view tabs are removed because the selector provides the same operation in less space.

The Details disclosure is non-modal. It is keyboard reachable, has a labelled close action, and does not resize the workspace merely to display static prose.

### Diagram and conversation split

The remaining row contains:

- diagram: `minmax(0, 1fr)`;
- separator: 7px;
- conversation: user-selected width.

The conversation default is `clamp(320px, 28vw, 480px)`. Resizing is clamped to 320px minimum and `min(45vw, 640px)` maximum. Pointer resizing uses pointer capture so leaving the separator does not lose the drag. The focusable separator supports ArrowLeft/ArrowRight and larger Shift+Arrow steps.

Collapsing the conversation removes both its column and separator; the diagram receives the entire remaining width. Empty sessions initially collapse the conversation. A direct element or relationship click opens it because that click explicitly asks to inspect a subject. Background chat, diagnostics, or choices do not override a manual close; they increment the Conversation attention count. Opening the panel marks current activity seen.

Panel mode and width live only for the current page/session. No `localStorage` or protocol state is introduced.

## Narrow workspace

At 900px and below:

- the compact command strip retains title, connection, Conversation, and End, with secondary values available through Details;
- the canvas remains the primary viewport;
- conversation becomes a non-modal bottom sheet;
- selected-subject context remains at the top of the sheet;
- the sheet opens and closes but does not expose a precision resize interaction;
- the document does not become a vertical stack of header, diagram, rail, and conversation;
- no horizontal overflow is permitted at 390×844.

The bottom sheet is a complementary region, not a modal dialog. It does not trap focus or prevent diagram navigation when open.

## Selected subjects

### Local representation

Selection is a separate browser-workspace concern:

```ts
type SelectedDiagramSubject =
  | {
      readonly type: 'element'
      readonly nodeId: string
      readonly identity: string
      readonly title: string
      readonly kind: string
      readonly description: string | null
      readonly technology: string | null
      readonly navigateTo: string | null
      readonly tags: readonly string[]
    }
  | {
      readonly type: 'relationship'
      readonly edgeId: string
      readonly source: { readonly id: string; readonly title: string }
      readonly target: { readonly id: string; readonly title: string }
      readonly label: string | null
      readonly description: string | null
      readonly kind: string | null
      readonly technology: string | null
      readonly notation: string | null
      readonly relationIds: readonly string[]
    }
```

For elements, identity prefers `modelRef`, then `deploymentRef`, then diagram node ID. Groups and generated nodes therefore remain inspectable without being misrepresented as canonical elements.

For relationships, source and target IDs are resolved against the active rendered view for display titles. Missing nodes fall back to stable IDs. One rendered edge may aggregate several model relationships; the inspector states the count and never fabricates one canonical relationship.

LikeC4 `MarkdownOrString` descriptions are flattened to text and rendered by React. The application never injects HTML. Missing descriptions render **No description declared in this model**.

### Renderer callbacks

The browser uses LikeC4's public callbacks:

- `onNodeClick(node, event)` selects an element;
- `onEdgeClick(edge, event)` selects a relationship;
- `onNavigateTo(viewId, event, node)` preserves the originating element before navigating when present.

A click changes only local workspace state. It emits no `VisualBrowserInput`, consumes no queue capacity, and adds no journal record.

### Inspector

The selected-subject inspector is docked above the transcript.

Element context shows:

- title;
- stable identity and kind;
- description;
- technology and tags when present.

Relationship context shows:

- source → target;
- label, or source → target when unlabelled;
- description;
- kind, technology, and notation;
- number of underlying model relationships.

Descriptions show three lines by default. **Show more** expands the full text and **Show less** returns height to the transcript. The inspector has an explicit clear action.

Selection survives view navigation within one rendered model. It clears when the user clears it or a model replacement becomes active. Ending or closing the session preserves the current selection and permits further local inspection of the retained diagram, while the composer stays disabled.

## Contextual questions

The composer displays a removable selected-subject chip. The chip changes placeholder copy to **Ask about this element** or **Ask about this relationship**.

Submitting with a chip formats ordinary visible text before calling the existing `ask(text)` seam:

```text
About element “Visual Session Server” (yarramate.visual.server): <question>
```

```text
About relationship “Visual Browser → Visual Session Server — sends authenticated input” (2 model relationships): <question>
```

The resulting transcript shows exactly this text. Only stable identity, title/label, endpoints, and aggregate count enter the question. Description, notes, tags, technology, notation, and arbitrary metadata are display-only and are not silently injected into the agent prompt.

Removing the chip sends the unmodified question. Clicking without submitting sends nothing.

## Module boundaries

### Existing session state

`src/visual-app/state.ts` remains the deep module for server/session truth: lifecycle, model, transcript, choices, diagnostics, acknowledgements, and composer availability. It does not gain panel geometry or click selection.

### Workspace state

Add `src/visual-app/workspace-state.ts` as the deep module for ephemeral presentation state. It owns:

- conversation mode, width, and unread count;
- selected-subject normalization;
- description flattening;
- resize clamping;
- model-change and session-close clearing;
- visible contextual-question formatting.

Its reducer and formatters are pure and testable without a DOM.

### Presentation

Reshape `App.tsx` around three presentation surfaces:

- `CommandStrip`;
- `DiagramWorkspace`;
- `ConversationPanel`.

The components consume session and workspace state. They do not own WebSocket behavior or mutate protocol documents. Small sub-surfaces such as the selected-subject inspector and separator remain private to their owning presentation module rather than becoming a collection of shallow exported files.

No new runtime dependency is required.

## State transitions

```text
session starts empty
  → conversation auto-collapsed

Conversation toggle
  → manual open / manual closed

node or edge click
  → normalize selected subject
  → open conversation
  → show inspector and composer chip

background activity while manually closed
  → keep closed
  → increment attention

open conversation
  → mark current activity seen

submit with selected subject
  → format visible contextual text
  → existing ask(text)
  → existing chat.message/v1

model replacement
  → clear selected subject

session close
  → preserve local inspection
  → disable contextual submission
```

## Failure and edge handling

- A missing description produces explicit empty-state copy rather than an empty block.
- An unlabelled relationship uses its endpoints as the visible name.
- An aggregate edge reports its underlying count without merging descriptions into an invented claim.
- A node missing `modelRef` and `deploymentRef` falls back to diagram ID.
- A missing source or target title falls back to node ID.
- Invalid or oversized description content cannot execute because it is flattened and rendered as text.
- A resize ending outside the separator still settles through pointer capture.
- A viewport change reclamps an out-of-range desktop width.
- The existing last-good drawing behavior remains authoritative; selection clears when a replacement becomes active.
- Session ending disables contextual submission but does not hide the subject the reviewer was inspecting.

## Accessibility

- Conversation exposes `aria-expanded` and `aria-controls`.
- The separator uses `role="separator"`, `aria-orientation="vertical"`, and current/minimum/maximum width values.
- The separator is keyboard focusable and has visible focus treatment.
- Details and description expansion are real buttons with accurate expanded state.
- Selecting a subject does not steal focus from the diagram.
- The inspector has a labelled heading and complementary-region semantics.
- Attention count has an accessible name and is not announced repeatedly while unchanged.
- Mobile bottom sheet is non-modal and does not trap focus.
- Reduced-motion behavior remains unchanged.

## Security and compatibility

This change is browser-local until an existing chat submission occurs. It adds no browser event type, response type, schema field, endpoint, capability, filesystem input, external request, or persisted secret.

The nine v1 schemas remain byte-for-byte unchanged. A future structured selected-subject payload would require a new version under ADR 0081's closed-schema rule; this design deliberately avoids it.

Selected descriptions and metadata are never hidden prompt context. The outgoing contextual prefix is visible to the user and transcript. Content is rendered as React text; no `dangerouslySetInnerHTML` is introduced.

## Verification

### Pure contracts

Focused tests for `workspace-state.ts` cover:

- initial empty-panel collapse;
- manual open and close;
- background activity preserving manual close and incrementing attention;
- opening marking activity seen;
- resize clamping and viewport reclamping;
- element normalization and identity fallback;
- relationship normalization, endpoint fallback, and aggregate count;
- missing and flattened descriptions;
- selection retained across view navigation;
- selection preserved for inspection but not submission after session close;
- contextual element and relationship question formatting;
- chip removal preserving the original question.

Existing visual protocol tests must remain unchanged and green.

### Browser verification

At 1568×924 and 390×844, exercise the real browser application and observe:

1. The 48px command strip replaces the large header and vertical rail.
2. The application-owned bottom view tabs are absent; the command-strip selector changes views.
3. The canvas receives all space outside an open conversation.
4. Collapse returns the conversation and separator width to the canvas.
5. Pointer and keyboard resize remain within limits.
6. Element click shows identity and progressive description.
7. Relationship click highlights context and shows endpoints, label, description, and aggregate count.
8. **Show more** and **Show less** change inspector height without losing selection.
9. The composer chip follows the selected subject and can be removed.
10. Submitted transcript text exactly matches the contextual text sent to the agent.
11. Clicks without submission add no journal event.
12. Model replacement clears stale selection.
13. Mobile uses a non-modal bottom sheet with no horizontal overflow.
14. Keyboard focus remains visible and no interaction steals diagram focus.
15. No console errors, external requests, or executable description content appear.

### Repository verification

Run the focused browser/state checks, typecheck both TypeScript programs, build the browser bundle, run the existing visual suite, then run `pnpm verify`. The existing real-browser End/recovery smoke remains green because session and protocol semantics do not change.

## Acceptance criteria

1. At desktop size, the static header, vertical rail, and bottom view tabs no longer reserve diagram space.
2. Empty sessions begin with the conversation collapsed.
3. The reviewer can open, close, pointer-resize, and keyboard-resize the conversation.
4. Manual close is respected while background activity remains visible as attention.
5. Clicking any inspectable LikeC4 element shows stable identity and description.
6. Clicking any inspectable relationship shows endpoints, label, description, and aggregate relation count.
7. Long descriptions expand on demand and missing descriptions are explicit.
8. Selected-subject questions show exactly what context the visual agent receives.
9. A click alone is browser-local and does not change the v1 journal.
10. Active-model replacement clears selection; session close preserves inspection while preventing submission.
11. The mobile layout preserves the canvas and uses an accessible non-modal bottom sheet.
12. The nine v1 schemas, runtime behavior, recovery, and security boundaries remain unchanged.
13. Focused state checks, browser verification, the visual suite, and repository verification pass.
