import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { InstanceDraftPanel } from '../src/visual-app/instance-draft-panel.js'
import type { CanvasGraph } from '../src/graph-projection.js'
import type { VisualPatternOption } from '../src/adapters/visual/protocol-contract.js'

// #473 phase 4 item 4.4 (ADR 0146): dropping a pattern opens a form that asks
// for its slots in the order the pattern declared them.

const node = (id: string, name: string, kindLabel: string) =>
  ({
    id,
    localId: id,
    name,
    kind: `acme/p@1.0#${kindLabel}`,
    kindLabel,
    coreKindLabel: kindLabel,
    document: 'architecture/main.yaml',
  }) as never

const graph = {
  nodes: [
    node('checkout', 'Checkout', 'applicationComponent'),
    node('ledger', 'Ledger', 'applicationComponent'),
    node('receipt', 'Receipt', 'dataObject'),
  ],
  edges: [],
} as unknown as CanvasGraph

const PATTERN: VisualPatternOption = {
  kind: 'acme/p@1.0#api',
  label: 'api',
  coreLabel: 'grouping',
  document: 'patterns/acme.yaml',
  name: 'System API',
  slots: [
    { name: 'component', required: true, wiring: 'owned', admits: ['applicationComponent'] },
    { name: 'payload', required: false, wiring: 'owned', admits: ['dataObject'] },
    { name: 'upstream', required: false, wiring: 'context', admits: ['applicationComponent'] },
  ],
  wiring: [
    { from: 'self', kind: 'aggregation', to: 'component' },
    { from: 'upstream', kind: 'serving', to: 'self' },
  ],
  ports: [],
}

const html = (pattern: VisualPatternOption = PATTERN) =>
  renderToStaticMarkup(
    createElement(InstanceDraftPanel, {
      graph,
      pattern,
      documents: ['architecture/main.yaml', 'architecture/apis.yaml'],
      defaultDocument: 'architecture/main.yaml',
      reservedIds: [],
      onStage: () => {},
      onCancel: () => {},
    }),
  )

describe('the instance form', () => {
  it('is headed by the pattern the reviewer dropped', () => {
    expect(html()).toContain('System API')
  })

  it('asks for the slots in the order the pattern declared them', () => {
    const markup = html()
    const order = ['component', 'payload', 'upstream'].map((slot) =>
      markup.indexOf(`instance-slot-${slot}`),
    )
    // Not alphabetical: the order a pattern declares is the order it is asked.
    expect(order).toEqual([...order].sort((left, right) => left - right))
    expect(order.every((at) => at > -1)).toBe(true)
  })

  it('marks a required slot and labels a context slot', () => {
    const markup = html()
    expect(markup).toContain('required')
    // A context slot names what the instance USES, and is the one row that
    // will not fold inside the box. Cheaper to say here than to discover.
    expect(markup).toContain('context')
  })

  it('narrows each picker to what the slot admits', () => {
    const markup = html()
    const componentSelect = markup.slice(
      markup.indexOf('instance-slot-component'),
      markup.indexOf('instance-slot-payload'),
    )
    expect(componentSelect).toContain('Checkout')
    expect(componentSelect).toContain('Ledger')
    // A dataObject is not an applicationComponent, so it is not offered here.
    expect(componentSelect).not.toContain('Receipt')
  })

  it('offers New… on every slot', () => {
    expect(html().match(/New…/g)?.length).toBe(3)
  })

  it('reads "Choose one" on a required slot and "Leave for later" otherwise', () => {
    const markup = html()
    expect(markup).toContain('Choose one')
    // An optional slot left empty is a decision nobody has taken yet, which is
    // what the interview asks about rather than an error.
    expect(markup).toContain('Leave for later')
  })

  it('previews the wires the compiler will mint', () => {
    const markup = html()
    expect(markup).toContain('The compiler will mint')
    expect(markup).toContain('self aggregation component')
    expect(markup).toContain('upstream serving self')
  })

  it('says nothing about wiring for a pattern that declares none', () => {
    expect(html({ ...PATTERN, wiring: [] })).not.toContain('The compiler will mint')
  })

  it('refuses to stage until the required slot is filled', () => {
    // Nothing is chosen on a fresh form, so the button starts disabled.
    expect(html()).toContain('disabled=""')
  })
})

describe('the form a reader actually sees', () => {
  // A field that renders is not a field that reads. The slot rows shipped as a
  // bulleted list with the label jammed against its control, and every
  // assertion above passed. This reads the STYLESHEET, the nearest a headless
  // test gets to looking.
  const styles = readFileSync(
    new URL('../src/visual-app/styles.css', import.meta.url),
    'utf8',
  )

  const rule = (selector: string): string => {
    const at = styles.indexOf(`${selector} {`)
    expect(at, `${selector} has no rule at all`).toBeGreaterThan(-1)
    return styles.slice(at, styles.indexOf('}', at))
  }

  it('draws the slots as a form rather than a bulleted list', () => {
    expect(rule('.instance-draft-slots')).toContain('list-style: none')
  })

  it('separates each slot label from its control', () => {
    const row = rule('.instance-draft-slot')
    expect(row).toMatch(/gap:/)
    // A grid, so every control lines up rather than starting wherever its
    // label happened to end.
    expect(row).toContain('grid-template-columns')
  })

  it('gives the required and context marks something to look like', () => {
    expect(rule('.instance-draft-required')).toContain('border')
    expect(rule('.instance-draft-context')).toContain('border')
  })
})
