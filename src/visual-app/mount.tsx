import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import {
  createLocalHost,
  type LocalEditorHost,
  type LocalHostOptions,
  type RefreshOutcome,
} from './local-host.js'
import type { DecorationMap } from './graph-canvas.js'
import type { EditorHost } from './editor-host.js'
import {
  RIGHT_SECTIONS,
  type EditorPointer,
  type RightSectionId,
} from './workspace-state.js'
import './styles.css'

/**
 * Mount the editor in someone else's product (#252).
 *
 * The tree, the canvas, the query panel and the section stack, in an element
 * the host owns, over a store the host owns. No Node process, no session
 * server, no websocket, no journal: `yarramate-visual` is one way to run this
 * and no longer the only one.
 *
 * ```ts
 * import { mountEditor } from 'yarramate/visual-app'
 * import 'yarramate/visual-app/styles.css'
 *
 * const editor = mountEditor(document.querySelector('#editor')!, {
 *   store,                              // read / writeAll (ADR 0100)
 *   workspace,                          // a resolved manifest
 *   sections: ['properties', 'changes'],
 * })
 * editor.select('app.checkout')       // as a canvas tap would (#297)
 * editor.openDraft({ kind: 'goal' })  // as a palette pick would
 * // later
 * editor.unmount()
 * ```
 *
 * `sections` is what the host wants shown. Chat is the one a product usually
 * leaves out: with no agent behind it there is nobody to talk to and nothing to
 * hand control back to, so the section and the session button go together.
 *
 * `readOnly: true` mounts a viewer (#298): the same canvas, tree, questions
 * and properties, with every staging and committing affordance absent.
 */
export interface MountOptions extends LocalHostOptions {
  /**
   * Which sections the right column carries, in the stack's own order however
   * they are written here. Defaults to all three - which only makes sense with
   * a host that has an agent, so a product supplying a store will almost always
   * name the two it wants.
   */
  readonly sections?: readonly RightSectionId[]
  /**
   * A viewer, not an author (#298, ADR 0117). Every affordance that stages or
   * commits a change is absent - not disabled - so a frozen snapshot renders
   * with the authoring surface's visual language and none of its pen. A UI
   * posture only: a host whose store also refuses writes has two independent
   * defenses, and this option is not the one that guards the data.
   */
  readonly readOnly?: boolean
  /**
   * The host's per-subject marks at mount time (#314, ADR 0119): subject id -
   * concept or relationship - to `'added' | 'removed' | 'changed'`, rendered
   * as class-based visual treatments the way faults are. This is the seam
   * that lets a host with its own comparison model use the one viewer for
   * decorated comparison: the SEMANTICS stay host-side - the viewer never
   * diffs, it renders the marks it is handed. An id the model does not name
   * is silently inert. This option is the initial map; a live comparison
   * replaces it wholesale through the handle's `setDecorations`.
   */
  readonly decorations?: DecorationMap
}

/**
 * The handle a mount returns (#297, ADR 0118): the disposal it always had,
 * and three ways for the host to point at the canvas. Each method is the
 * programmatic twin of a gesture the surface already has - never a second
 * write path: nothing here commits, and anything the opened affordances stage
 * still goes through the changeset like every reviewer gesture.
 *
 * Every method answers with whether it acted. False means nothing moved: the
 * id named nothing in the current model, the model has not arrived yet - the
 * editor renders before its host's first frame lands - or the mount is a
 * viewer (`readOnly`, #298) and the gesture would have reached for the pen.
 */
export interface MountedEditor {
  /** Releases the host and takes the editor out of the element. */
  readonly unmount: () => void
  /**
   * Selects the subject - concept or relationship - on the canvas and in the
   * inspector, exactly as a tap on it would, which also scopes the Open
   * questions section to it.
   */
  readonly select: (subjectId: string) => boolean
  /**
   * Opens the Add-subject dialog, with the kind preselected when one is
   * given - the same seed a palette pick rides (#295). Without a kind, the
   * plain no-default form.
   */
  readonly openDraft: (options?: { readonly kind?: string }) => boolean
  /**
   * Arms the connection tool from the named subject, exactly as the
   * inspector's Connect does: the next selection becomes the target and the
   * kinds on offer are derived from the two endpoints.
   */
  readonly startConnection: (fromSubjectId: string) => boolean
  /**
   * Replaces the per-subject marks wholesale (#314, ADR 0119) - never a
   * merge: the map handed here is the map drawn, and `{}` clears every mark.
   * The one handle method that is not a gesture's twin, because no gesture
   * decorates: it is the live half of the `decorations` mount option, for a
   * comparison that moves under an open viewer. Decorating is reading, so it
   * works under `readOnly`, and unknown ids are silently inert - false is
   * only the shared not-there window: before the shell's first render, or
   * after unmount.
   */
  readonly setDecorations: (decorations: DecorationMap) => boolean
  /**
   * Re-reads the host's store and follows it, keeping staged work (#444).
   *
   * The answer to a model that moves under an open canvas - an agent writing
   * while a reviewer watches - where the only previous option was `unmount`
   * plus mounting again, which discards everything staged. A clean refresh
   * keeps the reviewer's staged rows, their zoom, their selection and their
   * filter: only the compilation is replaced.
   *
   * It hands the store no bytes. The host already owns the store and the
   * editor reads through it (ADR 0100), so this asks for a re-read rather
   * than introducing a second way in.
   *
   * Refuses rather than refreshing where staged operations pin content that
   * moved, naming those documents. That refusal is the point: refreshing
   * anyway would leave a reviewer editing against bytes nobody can see, to be
   * refused at commit by `YMVS312` after more work had gone in.
   *
   * A mount over a host the caller built (`mountEditorWith`) answers
   * `not-supported`: such a host already owns delivery and can push a model
   * frame whenever it likes, which is the same refresh by another route.
   */
  readonly refresh: () => MountRefreshOutcome
}

/** {@link RefreshOutcome}, plus the two ways a handle itself can decline. */
export type MountRefreshOutcome =
  | RefreshOutcome
  | {
      /** Before the shell's first render, or after `unmount`. */
      readonly applied: false
      readonly reason: 'not-mounted'
    }
  | {
      /**
       * The mount runs over a host the caller built, which owns its own
       * delivery. Push a `model` frame instead.
       */
      readonly applied: false
      readonly reason: 'not-supported'
    }

/**
 * The sections a read-only mount defaults to: the reading surfaces. No palette
 * and no changes tray - those exist only to stage - and no chat, because the
 * local host has no agent behind it. A host that wants a different reading set
 * still names its own `sections`.
 */
const READ_SECTIONS: readonly RightSectionId[] = ['properties', 'questions']

export const mountEditor = (
  element: Element,
  options: MountOptions,
): MountedEditor =>
  mountEditorWith(
    element,
    createLocalHost(options),
    options.sections ??
      (options.readOnly === true ? READ_SECTIONS : RIGHT_SECTIONS),
    options.readOnly,
    options.decorations,
  )

/**
 * The same editor over a host the caller built.
 *
 * Exported for the case `mountEditor` does not cover: a product that already
 * speaks the visual protocol - to its own server, over its own transport - and
 * wants the editor in front of it. The protocol is the contract (ADR 0081), so
 * anything that answers it is a host. `readOnly` composes: a custom host gets
 * the same viewer posture `mountEditor` offers, and stays free to refuse
 * writes on its own side of the seam as well.
 */
export const mountEditorWith = (
  element: Element,
  host: EditorHost,
  sections: readonly RightSectionId[] = RIGHT_SECTIONS,
  readOnly = false,
  decorations?: DecorationMap,
): MountedEditor => {
  // No StrictMode: its double mount would open the host twice, and a host with
  // a socket behind it would open two.
  const root = createRoot(element)
  // The bridge the imperative methods delegate through (#297, ADR 0118). The
  // shell hands its pointer up after its first render; until then - and after
  // disposal - every method answers false rather than throwing, because "not
  // ready" and "that id names nothing" are the same fact to a caller: nothing
  // moved.
  const bridge: { current: EditorPointer | null } = { current: null }
  root.render(
    <App
      host={host}
      sections={sections}
      readOnly={readOnly}
      decorations={decorations}
      onReady={(pointer) => {
        bridge.current = pointer
      }}
    />,
  )
  return {
    unmount: () => {
      root.unmount()
      bridge.current = null
    },
    select: (subjectId) => bridge.current?.select(subjectId) ?? false,
    openDraft: (options) => bridge.current?.openDraft(options) ?? false,
    startConnection: (fromSubjectId) =>
      bridge.current?.startConnection(fromSubjectId) ?? false,
    setDecorations: (decorations) =>
      bridge.current?.setDecorations(decorations) ?? false,
    refresh: () => {
      const pointer = bridge.current
      if (pointer === null) return { applied: false, reason: 'not-mounted' }
      // Only a host that owns a store can re-read one. A caller-built host is
      // already on the delivering side of the protocol.
      if (!isLocalHost(host)) return { applied: false, reason: 'not-supported' }
      // The pins go host-side unread: the handle reports what is staged and
      // the store that minted those revisions decides what they mean
      // (ADR 0100).
      return host.refresh(pointer.stagedPins())
    },
  }
}

const isLocalHost = (host: EditorHost): host is LocalEditorHost =>
  typeof (host as Partial<LocalEditorHost>).refresh === 'function'

export type { EditorHost, EditorHostEvents } from './editor-host.js'
export type { DecorationMap, DecorationMark } from './graph-canvas.js'
export type {
  LocalEditorHost,
  LocalHostOptions,
  RefreshOutcome,
} from './local-host.js'
export { createLocalHost } from './local-host.js'
export { RIGHT_SECTIONS, type RightSectionId } from './workspace-state.js'
