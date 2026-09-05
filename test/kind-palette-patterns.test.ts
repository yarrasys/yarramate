import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  KindPalette,
  paletteGroups,
  palettePatternGroups,
} from '../src/visual-app/kind-palette.js'
import type {
  VisualKindOption,
  VisualPatternOption,
} from '../src/adapters/visual/protocol-contract.js'

// #473 phase 4 item 4.3 (ADR 0146): the pattern is the unit on the palette.
//
// Measured on the ApertureX reference before this: 146 kinds, and the motivation
// band opened with availability-constraint, coverage-target,
// idempotency-constraint, java-baseline, maven-coordinates — 48 rulings a reader
// scrolls past to reach what they came for, every one of which is authored by
// filling a slot rather than by dragging it onto a canvas.

const kind = (
  label: string,
  coreLabel: string,
  extra: Partial<VisualKindOption> = {},
): VisualKindOption => ({
  id: `acme/p@1.0#${label}`,
  label,
  coreLabel,
  ...extra,
})

const pattern = (
  label: string,
  document: string,
  slots: VisualPatternOption['slots'],
  extra: Partial<VisualPatternOption> = {},
): VisualPatternOption => ({
  kind: `acme/p@1.0#${label}`,
  label,
  coreLabel: 'grouping',
  document,
  slots,
  wiring: [],
  ports: [],
  ...extra,
})

const RULINGS = ['rate-limit', 'retention-policy'] as const

const KINDS: readonly VisualKindOption[] = [
  kind('api', 'grouping', { pattern: 'acme/p@1.0#api', name: 'System API' }),
  kind('applicationComponent', 'applicationComponent'),
  // A slot kind that is NOT a ruling, and must stay a first-class row: it is a
  // real thing to draw, and keying the collapse on "appears as a slot kind"
  // would bury it (review F14).
  kind('dataObject', 'dataObject'),
  ...RULINGS.map((label) => kind(label, 'constraint')),
  // A ruling NO slot admits stays where it is: it is not reachable by filling
  // anything, so hiding it would leave no way to author it at all.
  kind('unbound-rule', 'constraint'),
]

const PATTERNS: readonly VisualPatternOption[] = [
  pattern('api', 'patterns/acme.yaml', [
    { name: 'component', required: true, wiring: 'owned', admits: ['applicationComponent'] },
    { name: 'payload', required: false, wiring: 'owned', admits: ['dataObject'] },
    { name: 'limit', required: false, wiring: 'unwired', admits: [...RULINGS] },
  ], { name: 'System API' }),
]

describe('the pattern bands', () => {
  it('groups patterns by the document that declared them', () => {
    const groups = palettePatternGroups([
      ...PATTERNS,
      pattern('job', 'patterns/other.yaml', []),
    ])
    expect(groups.map(({ document }) => document)).toEqual([
      'patterns/acme.yaml',
      'patterns/other.yaml',
    ])
  })

  it('says nothing where the frame carried no patterns', () => {
    expect(palettePatternGroups()).toEqual([])
    expect(palettePatternGroups([])).toEqual([])
  })
})

describe('what a layer band holds', () => {
  const groupFor = (layer: string) =>
    paletteGroups(KINDS, PATTERNS).find((group) => group.layer === layer)

  it('moves a ruling a slot admits out of the band it would crowd', () => {
    const motivation = groupFor('motivation')
    expect(motivation?.boundThroughSlot.map(({ label }) => label).sort()).toEqual([
      'rate-limit',
      'retention-policy',
    ])
  })

  it('keeps a ruling no slot admits as a first-class row', () => {
    // Nothing binds it, so filling a slot is not a way to author it.
    expect(groupFor('motivation')?.kinds.map(({ label }) => label)).toContain(
      'unbound-rule',
    )
  })

  it('keeps dataObject a first-class row, though a slot admits it', () => {
    // The rule is constraint LINEAGE and slot admission together. Keying on
    // slot admission alone would bury a thing readers draw all the time.
    const application = paletteGroups(KINDS, PATTERNS).find((group) =>
      group.kinds.some(({ label }) => label === 'dataObject'),
    )
    expect(application).toBeDefined()
    expect(
      application?.boundThroughSlot.map(({ label }) => label),
    ).not.toContain('dataObject')
  })

  it('collapses nothing when the workspace declares no patterns', () => {
    // No slots, so nothing is reachable by filling one, so every kind stays
    // exactly where it was before this feature existed.
    for (const group of paletteGroups(KINDS)) {
      expect(group.boundThroughSlot).toEqual([])
    }
  })
})

describe('what the palette renders', () => {
  const html = (
    kinds: readonly VisualKindOption[] = KINDS,
    patterns?: readonly VisualPatternOption[],
  ) =>
    renderToStaticMarkup(
      createElement(KindPalette, { kinds, patterns, onPick: () => {} }),
    )

  it('draws a band per pattern document, above the layers', () => {
    const markup = html(KINDS, PATTERNS)
    // The BASENAME, not the path: rendered whole, a path wrapped the header
    // onto two lines and pushed the rows down. Seen in a browser.
    expect(markup).toContain('patterns · acme')
    expect(markup.indexOf('patterns · acme')).toBeLessThan(
      markup.indexOf('motivation'),
    )
  })

  it('keeps the full path on the header for whoever has to open it', () => {
    expect(html(KINDS, PATTERNS)).toContain('title="patterns/acme.yaml"')
  })

  it('says "1 slot", never "1 slots"', () => {
    const markup = renderToStaticMarkup(
      createElement(KindPalette, {
        kinds: KINDS,
        patterns: [
          pattern('solo', 'patterns/acme.yaml', [
            { name: 'only', required: false, wiring: 'owned', admits: ['dataObject'] },
          ]),
        ],
        onPick: () => {},
      }),
    )
    expect(markup).toContain('1 slot<')
    expect(markup).not.toContain('1 slots')
  })

  it('names the pattern by its display name and counts its slots', () => {
    const markup = html(KINDS, PATTERNS)
    expect(markup).toContain('System API')
    expect(markup).toContain('3 slots, 1 required')
  })

  it('wears the stacked mark a folded node wears', () => {
    // The class alone is what this can check from a string. It passed while the
    // mark rendered at 0x0 because no rule styled it, which is why the
    // stylesheet is asserted below rather than trusted.
    expect(html(KINDS, PATTERNS)).toContain('kind-palette-stack')
  })

  it('drags the KIND label, the same payload every other row carries', () => {
    // An operation names the kind; if the pattern row dragged something else
    // the drop handler would need a second grammar.
    //
    // Scoped to the PATTERN row. `api` is also an ordinary kind in the layer
    // bands, so a bare substring check passes on that row instead and says
    // nothing about this one - which is exactly what it did at first.
    const markup = html(KINDS, PATTERNS)
    const row = markup.slice(markup.indexOf('kind-palette-pattern'))
    const attributes = row.slice(0, row.indexOf('>'))
    expect(attributes).toContain('data-kind="api"')
    expect(attributes).toContain('data-pattern="acme/p@1.0#api"')
  })

  it('offers the bound rulings behind one collapsed row', () => {
    const markup = html(KINDS, PATTERNS)
    expect(markup).toContain('motivation · 2 kinds bound through a slot')
    // Collapsed by default, so the band is short until a reader opens it.
    expect(markup).not.toContain('data-kind="rate-limit"')
  })

  it('draws no pattern band and no collapse without patterns', () => {
    const markup = html()
    expect(markup).not.toContain('kind-palette-stack')
    expect(markup).not.toContain('bound through a slot')
    // And every ruling is still reachable as an ordinary row.
    expect(markup).toContain('data-kind="rate-limit"')
  })
})

describe('the marks a reader actually sees', () => {
  // A class name in the markup is not a mark on the screen. The stacked mark
  // shipped in the DOM at 0x0 because nothing styled it, and the render test
  // above passed the whole time. This reads the STYLESHEET, which is the
  // nearest a headless test gets to looking.
  const styles = readFileSync(
    new URL('../src/visual-app/styles.css', import.meta.url),
    'utf8',
  )

  const rule = (selector: string): string => {
    const at = styles.indexOf(`${selector} {`)
    expect(at, `${selector} has no rule at all`).toBeGreaterThan(-1)
    return styles.slice(at, styles.indexOf('}', at))
  }

  it('gives the stacked mark a size, so it is visible', () => {
    const block = rule('.kind-palette-stack')
    expect(block).toMatch(/width:\s*\d/)
    expect(block).toMatch(/height:\s*\d/)
  })

  it('draws the second box of the stack', () => {
    expect(rule('.kind-palette-stack::before')).toContain('content')
  })

  it('styles the slot count and the collapsed band', () => {
    expect(rule('.kind-palette-slots')).toContain('font-size')
    expect(rule('.kind-palette-bound-name')).toContain('padding-left')
  })
})
