import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { createLocalHost, type LocalHostOptions } from './local-host.js'
import type { EditorHost } from './editor-host.js'
import { RIGHT_SECTIONS, type RightSectionId } from './workspace-state.js'
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
 * // later
 * editor.unmount()
 * ```
 *
 * `sections` is what the host wants shown. Chat is the one a product usually
 * leaves out: with no agent behind it there is nobody to talk to and nothing to
 * hand control back to, so the section and the session button go together.
 */
export interface MountOptions extends LocalHostOptions {
  /**
   * Which sections the right column carries, in the stack's own order however
   * they are written here. Defaults to all three - which only makes sense with
   * a host that has an agent, so a product supplying a store will almost always
   * name the two it wants.
   */
  readonly sections?: readonly RightSectionId[]
}

export interface MountedEditor {
  /** Releases the host and takes the editor out of the element. */
  readonly unmount: () => void
}

export const mountEditor = (
  element: Element,
  options: MountOptions,
): MountedEditor => mountEditorWith(element, createLocalHost(options), options.sections)

/**
 * The same editor over a host the caller built.
 *
 * Exported for the case `mountEditor` does not cover: a product that already
 * speaks the visual protocol - to its own server, over its own transport - and
 * wants the editor in front of it. The protocol is the contract (ADR 0081), so
 * anything that answers it is a host.
 */
export const mountEditorWith = (
  element: Element,
  host: EditorHost,
  sections: readonly RightSectionId[] = RIGHT_SECTIONS,
): MountedEditor => {
  // No StrictMode: its double mount would open the host twice, and a host with
  // a socket behind it would open two.
  const root = createRoot(element)
  root.render(<App host={host} sections={sections} />)
  return {
    unmount: () => root.unmount(),
  }
}

export type { EditorHost, EditorHostEvents } from './editor-host.js'
export type { LocalHostOptions } from './local-host.js'
export { createLocalHost } from './local-host.js'
export { RIGHT_SECTIONS, type RightSectionId } from './workspace-state.js'
