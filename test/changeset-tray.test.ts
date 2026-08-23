import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type {
  VisualChangesetCommitPayload,
  VisualDiagnostic,
} from '../src/adapters/visual/protocol-contract.js'
import type { CanvasGraph } from '../src/graph-projection.js'
import type { YarramateOperation } from '../src/operations.js'
import type { VisualAppState } from '../src/visual-app/state.js'
import {
  ChangesetTray,
  changesetRowLabel,
  describeChangesetRow,
  partitionDiagnostics,
  resolveSubjectName,
} from '../src/visual-app/changeset-tray.js'

// Ids are qualified `<document id>#<authored id>` exactly as the compiler
// emits them; `localId` is the id the document actually wrote, and the id an
// operation must address. Two documents deliberately author `checkout`.
const graph: CanvasGraph = {
  nodes: [
    {
      id: 'checkout',
      localId: 'checkout',
      document: 'architecture/main.yaml',
      kind: 'yarramate/core@0.1#applicationComponent',
      kindLabel: 'applicationComponent',
      coreKindLabel: 'applicationComponent',
      layer: 'application',
      aspect: 'active-structure',
      name: 'Checkout Service',
      description: null,
      aka: [],
      status: null,
      owner: null,
      distinctFrom: [],
      supersedes: [],
      constraints: [],
      references: [],
      presentIn: [],
      attestations: [],
    },
    {
      id: 'checkout',
      localId: 'checkout',
      document: 'architecture/operations.yaml',
      kind: 'yarramate/core@0.1#businessProcess',
      kindLabel: 'businessProcess',
      coreKindLabel: 'businessProcess',
      layer: 'business',
      aspect: 'behavior',
      name: 'Checkout Journey',
      description: null,
      aka: [],
      status: null,
      owner: null,
      distinctFrom: [],
      supersedes: [],
      constraints: [],
      references: [],
      presentIn: [],
      attestations: [],
    },
  ],
  edges: [
    {
      id: 'checkout-db',
      localId: 'checkout-db',
      document: 'architecture/main.yaml',
      kind: 'yarramate/core@0.1#serving',
      kindLabel: 'serving',
      coreKindLabel: 'serving',
      from: 'checkout',
      to: 'db',
      name: null,
      description: null,
      mode: null,
      content: null,
      status: null,
      references: [],
      presentIn: [],
    },
  ],
}

const updateOp: YarramateOperation = {
  op: 'update-concept',
  document: 'architecture/main.yaml',
  concept: { id: 'checkout', name: 'Checkout API' },
}

const retractOp: YarramateOperation = {
  op: 'update-concept',
  document: 'architecture/main.yaml',
  concept: { id: 'checkout' },
  remove: ['owner'],
}

const addOp: YarramateOperation = {
  op: 'add-concept',
  document: 'architecture/main.yaml',
  concept: {
    id: 'new-service',
    kind: 'yarramate/core@0.1#applicationComponent',
    name: 'New Service',
  },
}

const deleteOp: YarramateOperation = {
  op: 'delete-relationship',
  document: 'architecture/main.yaml',
  relationship: { id: 'checkout-db' },
}

const observeOp: YarramateOperation = {
  op: 'add-observation',
  document: '.yarramate/evidence/repository.yaml',
  observation: {
    subject: 'checkout',
    key: 'exists',
    value: 'true',
    result: 'confirmed',
    evidence: { uri: 'repo:src/checkout.ts' },
  },
}

const retractMessageOp: YarramateOperation = {
  op: 'update-observation',
  document: '.yarramate/evidence/repository.yaml',
  observation: { claim: 'checkout~expects-residency' },
  remove: ['message'],
}

describe('resolveSubjectName', () => {
  it('names a concept from the current graph', () => {
    expect(resolveSubjectName('architecture/main.yaml', 'checkout', graph)).toBe(
      'Checkout Service',
    )
  })

  it('tells apart the same authored id in two documents', () => {
    expect(resolveSubjectName('architecture/operations.yaml', 'checkout', graph)).toBe(
      'Checkout Journey',
    )
  })

  it('falls back to the raw id when the subject is not in the current graph', () => {
    expect(resolveSubjectName('architecture/main.yaml', 'missing', graph)).toBe('missing')
  })

  it('falls back to the raw id when the id is only authored in another document', () => {
    expect(resolveSubjectName('architecture/other.yaml', 'checkout', graph)).toBe('checkout')
  })

  it('falls back to the raw id when there is no model graph yet', () => {
    expect(resolveSubjectName('architecture/main.yaml', 'checkout', null)).toBe('checkout')
  })
})

describe('describeChangesetRow / changesetRowLabel', () => {
  it('names the verb, subject, and changed field for a scalar update', () => {
    const row = describeChangesetRow(updateOp, graph)
    expect(row).toEqual({
      verb: 'update-concept',
      subjectName: 'Checkout Service',
      fields: ['name'],
      removedFields: [],
    })
    expect(changesetRowLabel(row)).toBe('update-concept · Checkout Service · name')
  })

  it('renders a retraction as remove: <field>, never as a write', () => {
    const row = describeChangesetRow(retractOp, graph)
    expect(row.fields).toEqual([])
    expect(row.removedFields).toEqual(['owner'])
    expect(changesetRowLabel(row)).toBe(
      'update-concept · Checkout Service · remove: owner',
    )
  })

  it('falls back to the raw id for a subject an add-concept has not created yet', () => {
    const row = describeChangesetRow(addOp, graph)
    expect(row.subjectName).toBe('new-service')
    expect(changesetRowLabel(row)).toBe('add-concept · new-service · kind, name')
  })

  it('carries no field list for a delete operation', () => {
    const row = describeChangesetRow(deleteOp, graph)
    expect(row.fields).toEqual([])
    expect(row.removedFields).toEqual([])
    expect(changesetRowLabel(row)).toBe('delete-relationship · checkout-db')
  })

  it('addresses an observation by its target and key, never by an id', () => {
    const row = describeChangesetRow(observeOp, graph)
    expect(row).toEqual({
      verb: 'add-observation',
      subjectName: 'checkout (exists)',
      fields: ['value', 'result', 'evidence'],
      removedFields: [],
    })
    expect(changesetRowLabel(row)).toBe(
      'add-observation · checkout (exists) · value, result, evidence',
    )
  })

  it('names a keyless observation by its target alone', () => {
    const row = describeChangesetRow(retractMessageOp, graph)
    expect(row.subjectName).toBe('checkout~expects-residency')
    expect(row.fields).toEqual([])
    expect(changesetRowLabel(row)).toBe(
      'update-observation · checkout~expects-residency · remove: message',
    )
  })
})

describe('partitionDiagnostics', () => {
  const rowDiagnostic: VisualDiagnostic = {
    severity: 'error',
    code: 'YM912',
    message: 'cannot set and remove the same field',
    path: '',
    pointer: '/operations/2/document',
    line: 0,
    column: 0,
  }
  const exactRowDiagnostic: VisualDiagnostic = {
    severity: 'error',
    code: 'YM913',
    message: 'unknown operation kind',
    path: '',
    pointer: '/operations/0',
    line: 0,
    column: 0,
  }
  const compileDiagnostic: VisualDiagnostic = {
    severity: 'error',
    code: 'YM001',
    message: 'missing predicate',
    path: 'architecture/main.yaml',
    pointer: '/manifest/documents/0',
    line: 3,
    column: 5,
  }

  it('maps a /operations/<i>/... pointer to that row index', () => {
    const { byRow, batch } = partitionDiagnostics([rowDiagnostic])
    expect(byRow.get(2)).toEqual([rowDiagnostic])
    expect(batch).toEqual([])
  })

  it('maps a bare /operations/<i> pointer, with no trailing field, to that row', () => {
    const { byRow } = partitionDiagnostics([exactRowDiagnostic])
    expect(byRow.get(0)).toEqual([exactRowDiagnostic])
  })

  it('sends a pointer with no /operations/<i> segment to the batch level', () => {
    const { byRow, batch } = partitionDiagnostics([compileDiagnostic])
    expect(byRow.size).toBe(0)
    expect(batch).toEqual([compileDiagnostic])
  })

  it('groups multiple diagnostics staged against the same row', () => {
    const second: VisualDiagnostic = {
      ...rowDiagnostic,
      code: 'YM914',
      pointer: '/operations/2/concept/name',
    }
    const { byRow } = partitionDiagnostics([rowDiagnostic, second])
    expect(byRow.get(2)).toEqual([rowDiagnostic, second])
  })
})

/** A staged set as the tray takes it: pins ride along, and only the tests about
 * staleness care what is in them. */
const staged = (
  operations: readonly YarramateOperation[],
  sourceDigests: Readonly<Record<string, string>> = {},
): VisualChangesetCommitPayload => ({ operations, sourceDigests })

const baseState: VisualAppState = {
  lifecycle: 'active',
  authority: 'canonical',
  title: '',
  description: '',
  chatEnabled: false,
  model: {
    authority: 'canonical',
    initialView: '',
    graph,
    documents: [],
    vocabulary: { conceptKinds: [], relationshipKinds: [] },
    layouts: {},
    sourceDigests: {},
  },
  styleNonce: '',
  activeView: '',
  transcript: [],
  views: [],
  activeFilter: null,
  quickFilterText: '',
  choices: null,
  agentStatus: null,
  diagnostics: [],
  handoff: null,
  composerEnabled: false,
  awaitingAgent: false,
  localRecords: 0,
  lastSequence: 0,
  frozen: false,
  closedReason: null,
  pendingViewSave: null,
  viewSaveNotice: false,
  pendingChangeset: { operations: [], sourceDigests: {} },
  undoStack: [],
  redoStack: [],
  commitStatus: 'idle',
  commitDiagnostics: null,
  commitNotice: null,
  layoutNotice: null,
}

const render = (overrides: Partial<VisualAppState> = {}): string =>
  renderToStaticMarkup(
    createElement(ChangesetTray, {
      state: { ...baseState, ...overrides },
      onDiscardChange: () => {},
      onClearChangeset: () => {},
      onUndoChangeset: () => {},
      onRedoChangeset: () => {},
      onCommitChangeset: () => {},
    }),
  )

const commitButtonTag = (html: string): string => {
  const match = /<button[^>]*class="changeset-commit"[^>]*>/.exec(html)
  if (match === null) throw new Error('commit button not found in: ' + html)
  return match[0]
}

const historyButtonTag = (html: string, which: 'undo' | 'redo'): string => {
  const match = new RegExp(
    `<button[^>]*class="changeset-${which}"[^>]*>`,
  ).exec(html)
  if (match === null) throw new Error(`${which} button not found in: ` + html)
  return match[0]
}

describe('ChangesetTray', () => {
  it('renders nothing when the changeset is empty and there is no notice or diagnostics', () => {
    expect(render()).toBe('')
  })

  it('never gates on composerEnabled or the agent turn', () => {
    // chatEnabled: false and composerEnabled: false in baseState already; a
    // non-empty changeset must still render the tray and an enabled button.
    const html = render({ pendingChangeset: staged([updateOp]) })
    expect(html).not.toBe('')
    expect(commitButtonTag(html)).not.toContain('disabled')
  })

  it('disables Commit changes when the changeset is empty', () => {
    const html = render({ commitNotice: ['architecture/main.yaml'] })
    expect(commitButtonTag(html)).toContain('disabled=""')
  })

  it('disables Commit changes and marks it aria-busy while a commit is in flight', () => {
    const html = render({
      pendingChangeset: staged([updateOp]),
      commitStatus: 'committing',
    })
    const tag = commitButtonTag(html)
    expect(tag).toContain('disabled=""')
    expect(tag).toContain('aria-busy="true"')
  })

  it('enables Commit changes once operations are staged and idle', () => {
    const html = render({ pendingChangeset: staged([updateOp]) })
    expect(commitButtonTag(html)).not.toContain('disabled')
  })

  it('names exactly the paths the server reported on success', () => {
    const html = render({
      commitNotice: ['architecture/main.yaml', 'architecture/other.yaml'],
    })
    expect(html).toContain('Committed · 2 files')
    expect(html).toContain('architecture/main.yaml')
    expect(html).toContain('architecture/other.yaml')
  })

  it('keeps the staged rows on a failed commit instead of clearing the tray', () => {
    const html = render({
      pendingChangeset: staged([updateOp]),
      commitDiagnostics: [
        {
          severity: 'error',
          code: 'YM912',
          message: 'cannot set and remove the same field',
          path: '',
          pointer: '/operations/0/concept',
          line: 0,
          column: 0,
        },
      ],
    })
    expect(html).toContain('update-concept')
    expect(html).toContain('Checkout Service')
    expect(html).toContain('YM912')
  })

  it('offers Undo and Redo, each disabled while its stack is empty', () => {
    const html = render({ pendingChangeset: staged([updateOp]) })
    expect(historyButtonTag(html, 'undo')).toContain('disabled=""')
    expect(historyButtonTag(html, 'redo')).toContain('disabled=""')

    const withHistory = render({
      pendingChangeset: staged([updateOp]),
      undoStack: [staged([])],
      redoStack: [staged([updateOp])],
    })
    expect(historyButtonTag(withHistory, 'undo')).not.toContain('disabled')
    expect(historyButtonTag(withHistory, 'redo')).not.toContain('disabled')
  })

  it('stays mounted with nothing staged so history is still reachable', () => {
    // Undoing the last row empties the changeset; hiding the tray here would
    // strand the redo entry it just created.
    const undoneToEmpty = render({ redoStack: [staged([updateOp])] })
    expect(undoneToEmpty).not.toBe('')
    expect(historyButtonTag(undoneToEmpty, 'redo')).not.toContain('disabled')

    const discardedAll = render({ undoStack: [staged([updateOp])] })
    expect(historyButtonTag(discardedAll, 'undo')).not.toContain('disabled')
    // Nothing staged, so there is nothing to discard again.
    expect(discardedAll).not.toContain('changeset-discard-all')
  })

  it('marks a row whose document moved after it was staged', () => {
    const html = render({
      pendingChangeset: staged([updateOp], {
        'architecture/main.yaml': 'a'.repeat(64),
      }),
      model: {
        ...baseState.model!,
        sourceDigests: { 'architecture/main.yaml': 'b'.repeat(64) },
      },
    })
    expect(html).toContain('changeset-row conflicted')
    expect(html).toContain('changed after this edit was staged')
  })

  it('leaves a row unmarked while its pin still matches the model', () => {
    const html = render({
      pendingChangeset: staged([updateOp], {
        'architecture/main.yaml': 'a'.repeat(64),
      }),
      model: {
        ...baseState.model!,
        sourceDigests: { 'architecture/main.yaml': 'a'.repeat(64) },
      },
    })
    expect(html).not.toContain('conflicted')
  })

  it('leaves an unpinned row unmarked: there is nothing it can be stale against', () => {
    // A row that creates a document has no pin, and the model that lands it
    // will name a digest the row never saw. That is not a conflict.
    const html = render({
      pendingChangeset: staged([updateOp]),
      model: {
        ...baseState.model!,
        sourceDigests: { 'architecture/main.yaml': 'b'.repeat(64) },
      },
    })
    expect(html).not.toContain('conflicted')
  })
})

describe('what a refusal says it could not show', () => {
  const diagnostic = (
    code: string,
    pointer: string,
    subjects?: readonly string[],
  ): VisualDiagnostic => ({
    severity: 'error',
    code,
    message: `${code} happened`,
    path: 'architecture/main.yaml',
    pointer,
    line: 1,
    column: 1,
    ...(subjects === undefined ? {} : { subjects }),
  })

  it('says nothing while nothing has been refused', () => {
    expect(render()).not.toContain('changeset-fault-summary')
  })

  /**
   * The rule (ADR 0102): the count on screen is always the whole count. A
   * reviewer shown two marked elements and told nothing else will believe
   * those are the problems and commit.
   */
  it('counts what is marked and what cannot be, separately', () => {
    const markup = render({
      model: { graph } as never,
      commitDiagnostics: [
        diagnostic('YM404', '/relationships/0/kind', ['checkout']),
        diagnostic('YM201', '/'),
      ],
    })

    expect(markup).toContain(
      '2 problems: 1 marked on the diagram, 1 not on it.',
    )
  })

  it('does not call a subject this view cannot draw "marked"', () => {
    // It is real, this view cannot show it, and saying otherwise promises a
    // mark that never appears.
    const markup = render({
      model: { graph } as never,
      commitDiagnostics: [diagnostic('YM404', '/relationships/0', ['absent'])],
    })

    expect(markup).toContain('1 problem: 0 marked on the diagram, 1 not on it.')
  })
})
