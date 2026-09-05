import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// #473 phase 3, and the reason this file exists at all.
//
// `showConstraints` reached `graphToElements` at both call sites, typechecked,
// and was covered by unit tests and four mutations. It was still INERT in the
// app: the effect that rebuilds the elements lists `[graph, openQuestionCounts]`,
// so flipping the toggle re-rendered the component and re-ran nothing. Found by
// the ApertureX session reading cytoscape's own registration in a browser, on a
// PUBLISHED release, after I had written "wired, not just built" in the pull
// request.
//
// This is the third time in the programme that a feature passed its own tests
// and did nothing in the product: patterns in 1.4.0, folding in 1.20.0, rows in
// 1.22.0. Each time the seam was one layer out from whatever the tests drove.
// So the check is derived from the MECHANISM rather than from this instance: an
// effect that reads a prop and does not depend on it cannot react to it, and
// that is true of every effect in this file, including the ones not written yet.
//
// The convention is already the code's own. The elements effect says of
// `openQuestionCounts`: "listed for honesty, never an extra rerun."

const SOURCE = readFileSync(
  new URL('../src/visual-app/graph-canvas.tsx', import.meta.url),
  'utf8',
)

/** The props `GraphCanvas` destructures, which are what an effect can read. */
const propNames = (): readonly string[] => {
  const start = SOURCE.indexOf('}: GraphCanvasProps): React.ReactElement {')
  expect(start).toBeGreaterThan(-1)
  const open = SOURCE.lastIndexOf('export function GraphCanvas({', start)
  expect(open).toBeGreaterThan(-1)
  return SOURCE.slice(open, start)
    .split('\n')
    .slice(1)
    .map((line) => line.trim().replace(/,$/, ''))
    .filter((name) => /^[a-zA-Z][a-zA-Z0-9]*$/.test(name))
}

/**
 * The effect that REBUILDS the element set, and its dependency array.
 *
 * Narrowed to this one deliberately. A blanket sweep over every effect
 * over-fires: the cytoscape mount runs once by design, and the fold effect
 * reads the graph while depending on `folded` alone so that a fold does not
 * also trigger a full relayout. Both are decisions. What is NOT a decision is
 * an input to `graphToElements` that nothing re-triggers, and that is the
 * failure this file exists for, twice over.
 */
const elementsEffect = (): { readonly deps: readonly string[]; readonly call: string; readonly line: number } => {
  const at = SOURCE.indexOf('const elements = graphToElements(')
  expect(at).toBeGreaterThan(-1)
  const callEnd = SOURCE.indexOf('cyRef.current.elements().remove()', at)
  const depsOpen = SOURCE.indexOf('}, [', callEnd)
  const depsClose = SOURCE.indexOf(']', depsOpen)
  return {
    call: SOURCE.slice(at, callEnd),
    deps: SOURCE.slice(depsOpen + 4, depsClose)
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
    line: SOURCE.slice(0, depsOpen).split('\n').length,
  }
}

const mentions = (body: string, name: string): boolean =>
  new RegExp(`(?<![\\w.'"\`])${name}(?![\\w:])`).test(body)

describe('every input to the element build can rebuild the elements', () => {
  const props = propNames()
  const effect = elementsEffect()

  it('found the props and the effect, or it is asserting nothing', () => {
    // Guard against the parse degrading to an empty sweep, which would make
    // the assertion below vacuously true - the inert-fixture shape.
    expect(props).toContain('showConstraints')
    expect(effect.call).toContain('graphToElements(')
    expect(effect.deps.length).toBeGreaterThan(0)
  })

  it('lists every prop passed into graphToElements', () => {
    // `folded` is the one exemption, and it is a decision rather than an
    // omission: the fold effect below rebuilds with the reader's eye anchored
    // on the box they clicked, and depending on it here would relayout the
    // whole canvas on every fold. The assertion after this one pins it, so
    // satisfying this one by adding everything cannot quietly undo it.
    const OWNED_ELSEWHERE = ['folded']
    const passed = props
      .filter((name) => mentions(effect.call, name))
      .filter((name) => !OWNED_ELSEWHERE.includes(name))
    const missing = passed.filter((name) => !effect.deps.includes(name))
    expect(
      missing,
      `graph-canvas.tsx:${effect.line} passes ${missing.join(', ')} into ` +
        `graphToElements and does not depend on it. A change to it re-renders ` +
        `the component and rebuilds nothing, so the feature is inert in the ` +
        `app while its own tests stay green.`,
    ).toEqual([])
  })

  it('does not depend on `folded`, which has its own effect', () => {
    // Not an oversight: a fold rebuilds through the anchored path so the
    // reader's eye stays where they clicked. Pinned so that satisfying the
    // assertion above by adding everything does not quietly undo it.
    expect(effect.deps).not.toContain('folded')
  })
})
