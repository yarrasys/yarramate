import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  DIRECTIONS,
  DIRECTION_LABELS,
  LAYOUT_MODE_LABELS,
  LayoutControls,
} from '../src/visual-app/layout-controls.js'
import { LAYOUT_MODES } from '../src/layout-mode.js'
import { STYLE_PRESETS } from '../src/visual-app/style-presets.js'

const render = (overrides: Partial<Parameters<typeof LayoutControls>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(LayoutControls, {
      layout: 'served-by',
      direction: 'top-down',
      stylePreset: 'current',
      onLayoutChange: () => {},
      onDirectionChange: () => {},
      onStyleChange: () => {},
      ...overrides,
    }),
  )

describe('LayoutControls (ADR 0147)', () => {
  // The labels are iterated against the vocabulary, so a mode the format
  // admits cannot be missing a name on the canvas.
  it('names every layout mode and every direction', () => {
    for (const mode of LAYOUT_MODES) expect(LAYOUT_MODE_LABELS[mode]).toBeTruthy()
    for (const direction of DIRECTIONS) expect(DIRECTION_LABELS[direction]).toBeTruthy()
    const markup = render()
    for (const mode of LAYOUT_MODES) expect(markup).toContain(`>${LAYOUT_MODE_LABELS[mode]}<`)
    for (const direction of DIRECTIONS) expect(markup).toContain(`>${DIRECTION_LABELS[direction]}<`)
    // And every dress (ADR 0148), in the third select.
    expect(markup).toContain('aria-label="Style"')
    for (const preset of STYLE_PRESETS) expect(markup).toContain(`>${preset.title}<`)
  })

  it('opens on the style the browser remembered', () => {
    expect(render({ stylePreset: 'ink' })).toContain('<option value="ink" selected="">Ink</option>')
  })

  it('opens on the layout and direction in force', () => {
    const markup = render({ layout: 'bands', direction: 'left-right' })
    expect(markup).toContain('<option value="bands" selected="">Layer bands</option>')
    expect(markup).toContain('<option value="left-right" selected="">Left-right</option>')
    expect(markup).toContain('aria-label="Layout"')
    expect(markup).toContain('aria-label="Direction"')
  })

  // Each select reports to its own handler, with the value the reviewer picked.
  it('reports a pick to the right handler', () => {
    const onLayoutChange = vi.fn()
    const onDirectionChange = vi.fn()
    const onStyleChange = vi.fn()
    const element = LayoutControls({
      layout: 'served-by',
      direction: 'top-down',
      stylePreset: 'current',
      onLayoutChange,
      onDirectionChange,
      onStyleChange,
    }) as ReactElement<{ children: ReactElement<{ onChange: (event: unknown) => void }>[] }>
    const [layoutSelect, directionSelect, styleSelect] = element.props.children
    layoutSelect!.props.onChange({ currentTarget: { value: 'routed' } })
    directionSelect!.props.onChange({ currentTarget: { value: 'left-right' } })
    styleSelect!.props.onChange({ currentTarget: { value: 'dark' } })
    expect(onLayoutChange).toHaveBeenCalledWith('routed')
    expect(onDirectionChange).toHaveBeenCalledWith('left-right')
    expect(onStyleChange).toHaveBeenCalledWith('dark')
    expect(onLayoutChange).toHaveBeenCalledTimes(1)
    expect(onDirectionChange).toHaveBeenCalledTimes(1)
    expect(onStyleChange).toHaveBeenCalledTimes(1)
  })
})
