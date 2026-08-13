# Visual End Transition Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the command strip explain the observable handoff and return-to-main-agent stages after the reviewer presses End.

**Architecture:** Derive presentation copy from the existing `VisualAppState.lifecycle` and `VisualAppState.handoff` fields inside the visual React application. Keep transport, schemas, and reducer behavior unchanged; render one persistent live region so assistive technology receives each stage transition.

**Tech Stack:** TypeScript, React 19, server-rendered React regression tests, Vitest, CSS.

## Global Constraints

- Show compact, always-visible transition feedback in the command strip.
- Do not change the versioned visual-session protocol.
- Do not claim that the main harness has resumed; the browser cannot observe that event.
- Keep the diagram visible; do not add a modal, overlay, or completion screen.
- Preserve the existing transcript notice as the durable session record.
- Preserve the uncommitted spinner changes already present in this PR worktree.

---

### Task 1: Render observable End-transition stages

**Files:**
- Modify: `test/visual-app-render.test.ts:1-74`
- Modify: `src/visual-app/App.tsx:85-168`
- Modify: `src/visual-app/styles.css:80-167`
- Modify: `tsconfig.json`
- Modify: `tsconfig.visual.json`

**Interfaces:**
- Consumes: `VisualAppState.lifecycle`, whose relevant values are `'active'`, `'ending'`, and `'closed'`; `VisualAppState.handoff`, which becomes non-null after `handoff.complete`.
- Produces: a private `endTransitionStatus(state: VisualAppState): string` presentation helper and an always-mounted `.end-transition-status` live region in `CommandStrip`.

- [ ] **Step 1: Make the real-App render fixture support lifecycle overrides**

Import `VisualAppState` as a type, make the complete fixture the hoisted baseline, and add a helper that resets it before every render:

```tsx
import type { VisualAppState } from '../src/visual-app/state.js'

const session = vi.hoisted(() => {
  const baseState: VisualAppState = {
    lifecycle: 'active',
    authority: 'canonical',
    title: 'Visual architecture conversation',
    description: 'Checked architecture slice',
    chatEnabled: true,
    model: null,
    styleNonce: '',
    activeView: '',
    transcript: [
      { id: 'local-0', speaker: 'reviewer', text: 'What happens next?' },
    ],
    choices: null,
    agentStatus: null,
    diagnostics: [],
    handoff: null,
    composerEnabled: false,
    awaitingAgent: true,
    localRecords: 1,
    lastSequence: 1,
    frozen: false,
    closedReason: null,
  }
  return { baseState, state: baseState }
})

const renderSession = (overrides: Partial<VisualAppState> = {}): string => {
  session.state = { ...session.baseState, ...overrides }
  return renderToStaticMarkup(createElement(App))
}
```

The existing pending-agent test must call `renderSession()` so it continues defending the spinner change.

- [ ] **Step 2: Write failing render tests for the three observable stages**

Add these assertions to `test/visual-app-render.test.ts`:

```tsx
it('explains that End is preparing the main-agent handoff', () => {
  const markup = renderSession({ lifecycle: 'ending', handoff: null })

  expect(markup).toContain('role="status"')
  expect(markup).toContain('aria-live="polite"')
  expect(markup).toContain('Ending conversation — preparing a handoff for the main agent.')
  expect(markup).toContain('>Ending…</button>')
})

it('reports when the handoff is ready for the main agent', () => {
  const markup = renderSession({
    lifecycle: 'ending',
    handoff: {
      summary: 'Option B confirmed.',
      confirmedDecisions: ['option-b'],
      requestedChanges: [],
      unresolvedQuestions: [],
      finalViews: ['overview'],
    },
  })

  expect(markup).toContain('Handoff ready — returning control to the main agent.')
})

it('directs the reviewer to continue after the visual session closes', () => {
  const markup = renderSession({ lifecycle: 'closed' })

  expect(markup).toContain('Visual conversation ended. Continue in the main agent.')
})
```


- [ ] **Step 3: Run the render test and verify the new contract fails**

Run:

```bash
pnpm vitest run test/visual-app-render.test.ts
```

Expected: the existing pending-agent case passes; the new cases fail because the command strip has no End-transition live region and the button still reads `End`.

- [ ] **Step 4: Add the lifecycle-to-copy mapping**

In `src/visual-app/App.tsx`, add this private helper beside the command-strip presentation helpers:

```tsx
const endTransitionStatus = (state: VisualAppState): string => {
  if (state.lifecycle === 'closed') {
    return 'Visual conversation ended. Continue in the main agent.'
  }
  if (state.lifecycle !== 'ending') return ''
  if (state.handoff !== null) {
    return 'Handoff ready — returning control to the main agent.'
  }
  return 'Ending conversation — preparing a handoff for the main agent.'
}
```

This ordering makes terminal closure authoritative, then distinguishes a received handoff from the immediate ending state. It does not infer that the parent harness resumed.

- [ ] **Step 5: Render the persistent inline live region and action label**

Inside `.command-actions`, before the existing view selector, render the live region on every lifecycle so it exists before its text changes:

```tsx
<span
  className="end-transition-status"
  role="status"
  aria-live="polite"
  aria-atomic="true"
>
  {endTransitionStatus(state)}
</span>
```

Change the End button content without changing its existing disabled rule:

```tsx
{state.lifecycle === 'active' ? 'End' : 'Ending…'}
```

Do not disable navigation or disclosure controls; the existing reducer already freezes conversation input, and the design does not expand that behavior.

- [ ] **Step 6: Style the status as compact command-strip information**

Add a focused rule in `src/visual-app/styles.css` near `.connection-state`:

```css
.end-transition-status {
  max-width: 28rem;
  font-family: var(--utility);
  font-size: 11px;
  line-height: 1.25;
  color: var(--quiet);
}

.end-transition-status:empty {
  display: none;
}
```

Keep the existing narrow-screen `.command-actions` horizontal overflow behavior; do not introduce a new responsive layout.

- [ ] **Step 7: Run the focused regression suite**

Run:

```bash
pnpm vitest run test/visual-app-render.test.ts test/visual-app-state.test.ts test/visual-journey.test.ts
```

Expected: all three files pass, including the existing End journal/recovery assertions and pending-agent spinner assertion.

- [ ] **Step 8: Verify type ownership and the visual build**

Run:

```bash
pnpm typecheck
pnpm build:visual
```

Expected: both commands exit 0. The existing visual bundle chunk-size warning is acceptable; new TypeScript or build diagnostics are not.

- [ ] **Step 9: Smoke-test the real End transition in a fresh visual session**

Start the canonical visual journey from the PR worktree with `.yarramate/projections/visual-conversation-path.yaml`, open the browser, and press End. Observe, in order:

1. `Ending…` and `Ending conversation — preparing a handoff for the main agent.` appear immediately.
2. Conversation input is unavailable while the diagram remains visible.
3. If `handoff.complete` arrives before closure, `Handoff ready — returning control to the main agent.` appears.
4. On the closing frame, `Visual conversation ended. Continue in the main agent.` appears.
5. The main agent recovers the structured handoff, stops the runtime normally, and confirms temporary-session cleanup.

Record only stages actually observed. A transition can be too fast to visually sample the handoff-ready intermediate copy; the render test remains deterministic coverage for that state.

- [ ] **Step 10: Commit the implementation without absorbing unrelated worktree changes**

```bash
git add src/visual-app/App.tsx src/visual-app/styles.css test/visual-app-render.test.ts tsconfig.json tsconfig.visual.json
git commit -m "feat: explain visual session handoff on end"
```

Before committing, inspect the staged file list and confirm it contains exactly the five cohesive spinner and End-feedback files named above.
