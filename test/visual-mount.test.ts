import { beforeEach, describe, expect, it, vi } from 'vitest'

const root = vi.hoisted(() => ({
  render: vi.fn(),
  unmount: vi.fn(),
}))
const createRoot = vi.hoisted(() => vi.fn(() => root))

vi.mock('react-dom/client', () => ({ createRoot }))
import {
  mountEditorWith,
  type EditorHost,
  type RightSectionId,
} from '../src/visual-app/mount.js'

const host: EditorHost = {
  open: () => () => undefined,
  send: () => undefined,
}

const sections: readonly RightSectionId[] = ['properties', 'changes']

describe('mountEditorWith', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders into the host element and unmounts its rendered root', () => {
    const element = {} as Element

    const editor = mountEditorWith(element, host, sections)

    expect(createRoot).toHaveBeenCalledWith(element)
    expect(root.render).toHaveBeenCalledOnce()

    editor.unmount()

    expect(root.unmount).toHaveBeenCalledOnce()
  })
})
