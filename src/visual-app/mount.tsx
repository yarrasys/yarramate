import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { createLocalHost, type LocalHostOptions } from './local-host.js'
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
  }
}

export type { EditorHost, EditorHostEvents } from './editor-host.js'
export type { LocalHostOptions } from './local-host.js'
export { createLocalHost } from './local-host.js'
export { RIGHT_SECTIONS, type RightSectionId } from './workspace-state.js'
