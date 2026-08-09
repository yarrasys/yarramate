# Visual End Transition Feedback Design

## Problem

Pressing **End** freezes the visual conversation and records `Returning control to the main agent` in the transcript, but that record is visible only when the conversation panel is open. The always-visible command strip gives no explanation of the recovery and handoff now in progress.

## Decision

Show compact, always-visible transition feedback in the command strip. Derive it from lifecycle state already held by the browser; do not change the versioned visual-session protocol.

The browser must describe only stages it can observe. It may say that it is preparing or has received the handoff and direct the reviewer back to the main agent. It must not claim that the main harness has resumed, because no browser-visible acknowledgment proves that event.

## User Experience

Before End, the command strip remains unchanged.

After the reviewer presses **End**:

1. Conversation input becomes unavailable through the current `ending` lifecycle behavior.
2. The End button reads `Ending…` and remains disabled.
3. An inline live status reads `Ending conversation — preparing a handoff for the main agent.`

After the browser receives `handoff.complete`, the status reads `Handoff ready — returning control to the main agent.`

After the runtime sends its closing frame, the status reads `Visual conversation ended. Continue in the main agent.`

The existing transcript notice remains as the durable session record. The diagram stays visible throughout; no modal or blocking overlay is introduced.

## State and Data Flow

`src/visual-app/state.ts` remains the authority for browser lifecycle state:

- `end.requested` sets `lifecycle` to `ending` synchronously.
- `handoff.received` stores the structured handoff.
- `session.closed` sets `lifecycle` to `closed`.

`src/visual-app/App.tsx` maps those existing observable states to display copy. No new server response, schema field, or transport event is required.

The handoff-ready message takes precedence while the lifecycle is `ending` and `state.handoff` is non-null. The closed message takes precedence once the lifecycle is `closed`.

## Accessibility

The transition copy uses `role="status"` and `aria-live="polite"`. The End button's text change exposes the action state without moving focus. Existing disabled-control semantics remain intact.

## Failure Behavior

If the connection closes without a completed handoff, the UI shows only the terminal closed-state message and does not claim a handoff was prepared. Existing diagnostics and recovery behavior remain unchanged.

## Verification

- Reducer/render coverage proves the immediate ending, handoff-ready, and closed messages.
- Render coverage proves `role="status"`, `aria-live="polite"`, and the `Ending…` button label.
- The visual journey exercises End through the real transport and confirms conversation input remains unavailable during transition.
- A browser smoke test confirms the command strip communicates the transition while the diagram remains visible.

## Non-goals

- Adding harness-to-browser acknowledgment that the main agent resumed.
- Changing the visual protocol or handoff schema.
- Replacing the inline status with a modal, overlay, or completion screen.
