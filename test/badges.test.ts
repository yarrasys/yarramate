import cytoscape from 'cytoscape'
import { describe, expect, it } from 'vitest'
import {
  EVIDENCE_BADGE_URI,
  LIFECYCLE_BADGE_URI,
  isLifecycleStatus,
  ownerInitialsOf,
  type LifecycleStatus,
} from '../src/visual-app/badges.js'
import { buildStylesheet } from '../src/visual-app/graph-canvas.js'

describe('lifecycle badge URIs', () => {
  it('generates a distinct data:image/svg+xml URI per status', () => {
    const statuses: LifecycleStatus[] = ['planned', 'current', 'retired']
    for (const status of statuses) {
      const uri = LIFECYCLE_BADGE_URI[status]
      expect(uri.startsWith('data:image/svg+xml;utf8,')).toBe(true)
      const svg = decodeURIComponent(uri.slice('data:image/svg+xml;utf8,'.length))
      expect(svg).toContain('<svg')
      expect(svg).toContain('</svg>')
    }
    // Every status renders a different image - no shared placeholder shape.
    expect(new Set(statuses.map((status) => LIFECYCLE_BADGE_URI[status])).size).toBe(3)
  })

  it('colours planned/current/retired from the styles.css tokens the brief names', () => {
    // Literal hex values resolved from `src/visual-app/styles.css:11-21`
    // (--quiet, --eucalyptus, --failure) - see badges.ts for the sourcing.
    expect(decodeURIComponent(LIFECYCLE_BADGE_URI.planned)).toContain('#5f686d')
    expect(decodeURIComponent(LIFECYCLE_BADGE_URI.current)).toContain('#416f65')
    expect(decodeURIComponent(LIFECYCLE_BADGE_URI.retired)).toContain('#a3403a')
  })

  it('rejects any status the schema does not define', () => {
    expect(isLifecycleStatus('planned')).toBe(true)
    expect(isLifecycleStatus('current')).toBe(true)
    expect(isLifecycleStatus('retired')).toBe(true)
    expect(isLifecycleStatus('archived')).toBe(false)
    expect(isLifecycleStatus(null)).toBe(false)
  })
})

describe('evidence badge URI', () => {
  it('is a single fixed data:image/svg+xml URI colour from --ink', () => {
    expect(EVIDENCE_BADGE_URI.startsWith('data:image/svg+xml;utf8,')).toBe(true)
    expect(decodeURIComponent(EVIDENCE_BADGE_URI)).toContain('#182228')
  })
})

describe('ownerInitialsOf', () => {
  it('derives initials from the ref local id, not the document prefix', () => {
    expect(ownerInitialsOf('yarramate-product#yarramate-maintainers')).toBe('YM')
  })

  it('returns null for no owner', () => {
    expect(ownerInitialsOf(null)).toBeNull()
  })
})

describe('buildStylesheet badge layers', () => {
  const nodeRule = (showLifecycle: boolean, showEvidence: boolean): cytoscape.StylesheetStyle =>
    buildStylesheet(showLifecycle, showEvidence).find(
      (block): block is cytoscape.StylesheetStyle =>
        'style' in block && block.selector === 'node' && 'background-image' in block.style,
    )!

  const layersFor = (
    showLifecycle: boolean,
    showEvidence: boolean,
    data: Record<string, unknown>,
  ): string[] => {
    const rule = nodeRule(showLifecycle, showEvidence)
    const style = rule.style as cytoscape.Css.Node
    const mapper = style['background-image'] as (ele: { data: (key: string) => unknown }) => string[]
    return mapper({ data: (key) => data[key] })
  }

  it('draws no badges when both toggles are off', () => {
    expect(layersFor(false, false, { status: 'current', hasAttestations: true })).toEqual([])
  })

  it('draws the lifecycle badge only when showLifecycle is on and status is set', () => {
    expect(layersFor(true, false, { status: 'current', hasAttestations: false })).toEqual([
      LIFECYCLE_BADGE_URI.current,
    ])
    expect(layersFor(true, false, { status: null, hasAttestations: false })).toEqual([])
  })

  it('a node with no attestations gets no evidence badge, even with showEvidence on', () => {
    expect(layersFor(false, true, { status: null, hasAttestations: false })).toEqual([])
    expect(layersFor(false, true, { status: null, hasAttestations: true })).toEqual([EVIDENCE_BADGE_URI])
  })

  it('draws both badges, lifecycle first, when both apply', () => {
    expect(layersFor(true, true, { status: 'retired', hasAttestations: true })).toEqual([
      LIFECYCLE_BADGE_URI.retired,
      EVIDENCE_BADGE_URI,
    ])
  })
})
