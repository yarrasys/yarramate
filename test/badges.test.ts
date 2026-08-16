import cytoscape from 'cytoscape'
import { describe, expect, it } from 'vitest'
import {
  EVIDENCE_BADGE_URI,
  LIFECYCLE_BADGE_URI,
  isLifecycleStatus,
  ownerBadgeUri,
  ownerColorOf,
  ownerInitialsOf,
  type LifecycleStatus,
} from '../src/visual-app/badges.js'
import { LAYER_COLORS, buildStylesheet } from '../src/visual-app/graph-canvas.js'

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
  const nodeRule = (
    showLifecycle: boolean,
    showEvidence: boolean,
    showOwnership: boolean,
  ): cytoscape.StylesheetStyle =>
    buildStylesheet(showLifecycle, showEvidence, showOwnership, 'native').find(
      (block): block is cytoscape.StylesheetStyle =>
        'style' in block && block.selector === 'node' && 'background-image' in block.style,
    )!

  const layersFor = (
    showLifecycle: boolean,
    showEvidence: boolean,
    showOwnership: boolean,
    data: Record<string, unknown>,
  ): string[] => {
    const rule = nodeRule(showLifecycle, showEvidence, showOwnership)
    const style = rule.style as cytoscape.Css.Node
    const mapper = style['background-image'] as (ele: { data: (key: string) => unknown }) => string[]
    return mapper({ data: (key) => data[key] })
  }

  it('draws a background-color rule for every LAYER_COLORS key', () => {
    const sheet = buildStylesheet(false, false, false, 'native')
    for (const layer of Object.keys(LAYER_COLORS)) {
      const rule = sheet.find(
        (block): block is cytoscape.StylesheetStyle =>
          'style' in block && block.selector === `node[layer = "${layer}"]`,
      )
      if (rule === undefined) throw new Error(`missing selector for layer "${layer}"`)
      expect((rule.style as cytoscape.Css.Node)['background-color']).toBe(
        LAYER_COLORS[layer as keyof typeof LAYER_COLORS].fill,
      )
    }
  })

  it('draws no badges when both toggles are off', () => {
    expect(layersFor(false, false, false, { status: 'current', hasAttestations: true })).toEqual([])
  })

  it('draws the lifecycle badge only when showLifecycle is on and status is set', () => {
    expect(layersFor(true, false, false, { status: 'current', hasAttestations: false })).toEqual([
      LIFECYCLE_BADGE_URI.current,
    ])
    expect(layersFor(true, false, false, { status: null, hasAttestations: false })).toEqual([])
  })

  it('a node with no attestations gets no evidence badge, even with showEvidence on', () => {
    expect(layersFor(false, true, false, { status: null, hasAttestations: false })).toEqual([])
    expect(layersFor(false, true, false, { status: null, hasAttestations: true })).toEqual([EVIDENCE_BADGE_URI])
  })

  it('draws both badges, lifecycle first, when both apply', () => {
    expect(layersFor(true, true, false, { status: 'retired', hasAttestations: true })).toEqual([
      LIFECYCLE_BADGE_URI.retired,
      EVIDENCE_BADGE_URI,
    ])
  })

  it('gives each node its own badge set from one shared stylesheet', () => {
    // One stylesheet serves the whole graph and the mapper memoises per node
    // data, so the cache key must discriminate on all four fields it reads.
    // A key that dropped one would hand the second node the first's badges.
    const style = nodeRule(true, true, true).style as cytoscape.Css.Node
    const images = style['background-image'] as (ele: {
      data: (key: string) => unknown
    }) => string[]
    const eleOf = (data: Record<string, unknown>) => ({
      data: (key: string) => data[key] ?? null,
    })

    const bare = eleOf({ status: 'planned' })
    const owned = eleOf({ status: 'planned', owner: 'doc#dana', ownerInitials: 'D' })
    const evidenced = eleOf({ status: 'planned', hasAttestations: true })

    expect(images(bare)).toEqual([LIFECYCLE_BADGE_URI.planned])
    expect(images(owned)).toEqual([LIFECYCLE_BADGE_URI.planned, ownerBadgeUri('doc#dana', 'D')])
    expect(images(evidenced)).toEqual([LIFECYCLE_BADGE_URI.planned, EVIDENCE_BADGE_URI])
    // A repeat lookup is served from the cache and must not have drifted.
    expect(images(bare)).toEqual([LIFECYCLE_BADGE_URI.planned])
  })

  it('keeps all seven badge properties the same length for one node', () => {
    // cytoscape reads the seven arrays positionally - entry `i` of each one
    // describes the same badge - so a node carrying all three badges must
    // report three entries on every property, not just on the image list.
    const style = nodeRule(true, true, true).style as unknown as Record<
      string,
      (ele: { data: (key: string) => unknown }) => unknown[]
    >
    const data: Record<string, unknown> = {
      status: 'current',
      hasAttestations: true,
      owner: 'doc#dana',
      ownerInitials: 'D',
    }
    const ele = { data: (key: string) => data[key] ?? null }
    const properties = [
      'background-image',
      'background-position-x',
      'background-position-y',
      'background-width',
      'background-height',
      'background-image-containment',
      'background-clip',
    ]
    for (const property of properties) {
      const mapper = style[property]
      if (mapper === undefined) throw new Error(`node rule is missing ${property}`)
      expect(mapper(ele)).toHaveLength(3)
    }
  })

})

describe('ownerColorOf hash function', () => {
  it('same ref always maps to the same colour', () => {
    const ref = 'test-doc#test-owner'
    const color1 = ownerColorOf(ref)
    const color2 = ownerColorOf(ref)
    expect(color1).toBe(color2)
  })

  it('null in, null out', () => {
    expect(ownerColorOf(null)).toBeNull()
  })

  it('fixed set of synthetic refs spreads across all four palette slots', () => {
    // FNV-1a hash should distribute these four refs across the four-slot palette.
    const refs = ['owner-a', 'owner-b', 'owner-c', 'owner-d']
    const colors = refs.map((ref) => ownerColorOf(ref))
    // Check that we got all four distinct colors (implies all palette slots used)
    const byColor: Record<string, number> = {}
    for (const color of colors) {
      byColor[color!] = (byColor[color!] ?? 0) + 1
    }
    expect(Object.keys(byColor).length).toBe(4)
  })
  it('no ref ever maps outside the palette', () => {
    const palette = ['#416f65', '#8c4d18', '#2457a6', '#182228']
    const testRefs = [
      'simple-owner',
      'yarramate-product#yarramate-maintainers',
      'repo#team-member-1',
      'repo#team-member-2',
      'repo#another-team',
    ]
    for (const ref of testRefs) {
      const color = ownerColorOf(ref)
      expect(color).not.toBeNull()
      expect(palette).toContain(color)
    }
  })
})
