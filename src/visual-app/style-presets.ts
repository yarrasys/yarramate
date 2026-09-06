/**
 * Style presets for the canvas: LAB ONLY, on branch `lab/style-presets`.
 *
 * Four directions for how subjects and edges could look, drawn over the same
 * notation (shapes by aspect, arrowheads by kind, glyphs, badges) so only the
 * dress changes. Each preset is a list of stylesheet blocks appended after the
 * base and notation rules, so it wins on the properties it names and inherits
 * everything else. `current` appends nothing.
 */
import type cytoscape from 'cytoscape'
import { LAYER_COLORS } from '../notation/archimate.js'

export const STYLE_PRESET_IDS = ['current', 'drafting', 'ink', 'tinted', 'dark'] as const
export type StylePresetId = (typeof STYLE_PRESET_IDS)[number]

export interface StylePreset {
  readonly id: StylePresetId
  readonly title: string
  readonly blurb: string
  /** The canvas ground behind the drawing; undefined keeps the shell's paper. */
  readonly canvas?: string
}

export const STYLE_PRESETS: readonly StylePreset[] = [
  { id: 'current', title: 'Current', blurb: 'What ships: ArchiMate pastels, 2px borders, Helvetica, grey edges with boxed labels.' },
  { id: 'drafting', title: 'Drafting', blurb: "The shell's own vocabulary on the canvas: paper-tinted fills, hairline ink rules, the body face, monospace edge readings with a paper halo." },
  { id: 'ink', title: 'Ink', blurb: 'Line-first and print-ready: white subjects, the layer carried by a coloured 1.5px border, ink edges, no boxes anywhere.' },
  { id: 'tinted', title: 'Tinted', blurb: 'A contemporary muted palette in place of the pastels, 8px corners, slate edges, edge readings on small pills.' },
  { id: 'dark', title: 'Dark', blurb: 'A dark ground with deep layer tints and light ink; glyphs stay ink-coloured and would need a light variant.', canvas: '#12161b' },
]

export const stylePresetOf = (id: StylePresetId): StylePreset =>
  STYLE_PRESETS.find((preset) => preset.id === id) ?? STYLE_PRESETS[0]!

export const isStylePresetId = (value: unknown): value is StylePresetId =>
  typeof value === 'string' && (STYLE_PRESET_IDS as readonly string[]).includes(value)

const BODY_FACE = "'Avenir Next', Avenir, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
const MONO_FACE = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace"

type Layer = keyof typeof LAYER_COLORS
type Palette = Readonly<Record<Layer, { readonly fill: string; readonly border: string }>>

const DRAFTING: Palette = {
  motivation: { fill: '#dcd9ef', border: '#6f6bb0' },
  strategy: { fill: '#ece2cd', border: '#a2843f' },
  business: { fill: '#ecebc4', border: '#9a9440' },
  application: { fill: '#cfe6e8', border: '#3f8f8f' },
  technology: { fill: '#d3e6d3', border: '#4f8f4f' },
  implementation: { fill: '#ebd9da', border: '#b07a7a' },
  physical: { fill: '#e1e5e7', border: '#7d868c' },
  composite: { fill: '#e1e5e7', border: '#7d868c' },
}

const INK: Palette = {
  motivation: { fill: '#ffffff', border: '#5b52c8' },
  strategy: { fill: '#ffffff', border: '#b8862b' },
  business: { fill: '#ffffff', border: '#a89a12' },
  application: { fill: '#ffffff', border: '#1f8f8f' },
  technology: { fill: '#ffffff', border: '#2f8f2f' },
  implementation: { fill: '#ffffff', border: '#c2606a' },
  physical: { fill: '#ffffff', border: '#6b7680' },
  composite: { fill: '#ffffff', border: '#6b7680' },
}

const TINTED: Palette = {
  motivation: { fill: '#ede9fe', border: '#7c3aed' },
  strategy: { fill: '#fef3c7', border: '#b45309' },
  business: { fill: '#fef9c3', border: '#a16207' },
  application: { fill: '#e0f2fe', border: '#0369a1' },
  technology: { fill: '#d1fae5', border: '#047857' },
  implementation: { fill: '#ffe4e6', border: '#be123c' },
  physical: { fill: '#f1f5f9', border: '#475569' },
  composite: { fill: '#f1f5f9', border: '#475569' },
}

const DARK: Palette = {
  motivation: { fill: '#2a2550', border: '#8b7fe0' },
  strategy: { fill: '#3a2e14', border: '#c9a355' },
  business: { fill: '#3a3a10', border: '#c9c355' },
  application: { fill: '#10344a', border: '#4fb8b8' },
  technology: { fill: '#10391f', border: '#5fae5f' },
  implementation: { fill: '#3d1b22', border: '#d89999' },
  physical: { fill: '#262c33', border: '#6b7680' },
  composite: { fill: '#262c33', border: '#6b7680' },
}

type Block = cytoscape.StylesheetJsonBlock

/** One rule per layer for fill and border, plus the passive-structure header band in the layer's own hue. */
const layerBlocks = (palette: Palette, bandStop = '16%'): Block[] => [
  ...(Object.keys(palette) as Layer[]).map(
    (layer): Block => ({
      selector: `node[layer = "${layer}"]`,
      style: { 'background-color': palette[layer].fill, 'border-color': palette[layer].border },
    }),
  ),
  ...(Object.keys(palette) as Layer[]).map(
    (layer): Block => ({
      selector: `node[layer = "${layer}"][aspect = "passive-structure"]:childless`,
      style: {
        'background-fill': 'linear-gradient',
        'background-gradient-direction': 'to-bottom',
        'background-gradient-stop-colors': [palette[layer].border, palette[layer].fill],
        'background-gradient-stop-positions': ['0%', bandStop],
      } as cytoscape.Css.Node,
    }),
  ),
]

interface Dress {
  readonly palette: Palette
  readonly ink: string
  readonly quiet: string
  readonly ground: string
  readonly nodeBorder: number
  readonly corner: number
  readonly edge: string
  readonly edgeWidth: number
  readonly edgeLabelFace: string
  readonly edgeLabelColor: string
  readonly edgeLabelBackground: { readonly color: string; readonly opacity: number; readonly shape: 'rectangle' | 'roundrectangle' }
  readonly halo: string | null
  readonly containerFill: { readonly color: string | null; readonly opacity: number }
  readonly containerBorder: { readonly color: string | null; readonly style: 'solid' | 'dashed'; readonly opacity: number }
  readonly containerTitle: { readonly face: string; readonly size: number; readonly weight: string; readonly color: string; readonly upper: boolean }
  readonly select: string
}

const dressBlocks = (d: Dress): Block[] => [
  ...layerBlocks(d.palette),
  {
    selector: 'node',
    style: {
      'border-width': d.nodeBorder,
      'corner-radius': `${d.corner}px`,
      'font-family': BODY_FACE,
      'font-size': 12,
      'font-weight': 500,
      color: d.ink,
    } as cytoscape.Css.Node,
  },
  {
    selector: 'node:parent',
    style: {
      ...(d.containerFill.color === null ? {} : { 'background-color': d.containerFill.color }),
      'background-opacity': d.containerFill.opacity,
      ...(d.containerBorder.color === null ? {} : { 'border-color': d.containerBorder.color }),
      'border-style': d.containerBorder.style,
      'border-width': 1,
      'border-opacity': d.containerBorder.opacity,
      'corner-radius': `${d.corner + 4}px`,
      'font-family': d.containerTitle.face,
      'font-size': d.containerTitle.size,
      'font-weight': d.containerTitle.weight,
      color: d.containerTitle.color,
      ...(d.containerTitle.upper ? { 'text-transform': 'uppercase' } : {}),
      'text-margin-y': -6,
    } as cytoscape.Css.Node,
  },
  {
    selector: 'edge',
    style: {
      'line-color': d.edge,
      'target-arrow-color': d.edge,
      'source-arrow-color': d.edge,
      width: d.edgeWidth,
      'line-cap': 'round',
      'arrow-scale': 0.85,
      'font-family': d.edgeLabelFace,
      'font-size': 9.5,
      color: d.edgeLabelColor,
      'text-background-color': d.edgeLabelBackground.color,
      'text-background-opacity': d.edgeLabelBackground.opacity,
      'text-background-shape': d.edgeLabelBackground.shape,
      'text-background-padding': '2px',
      ...(d.halo === null
        ? { 'text-outline-width': 0 }
        : { 'text-outline-color': d.halo, 'text-outline-width': 2, 'text-outline-opacity': 1 }),
    } as cytoscape.Css.Edge,
  },
  {
    selector: 'edge.lifted',
    style: { 'line-color': d.quiet, 'target-arrow-color': d.quiet, width: d.edgeWidth + 0.5 } as cytoscape.Css.Edge,
  },
  {
    // Selection as a glow rather than a thick coral border: the accent holds
    // the outline and a soft overlay lifts the subject off the ground.
    selector: 'node.selected',
    style: {
      'border-color': d.select,
      'border-width': 2,
      'overlay-color': d.select,
      'overlay-opacity': 0.12,
      'overlay-padding': 6,
    } as cytoscape.Css.Node,
  },
  {
    selector: 'edge.selected',
    style: { 'line-color': d.select, 'target-arrow-color': d.select, width: d.edgeWidth + 1 } as cytoscape.Css.Edge,
  },
]

const PRESET_BLOCKS: Readonly<Record<StylePresetId, () => Block[]>> = {
  current: () => [],
  drafting: () =>
    dressBlocks({
      palette: DRAFTING,
      ink: '#182228',
      quiet: '#7d868c',
      ground: '#e8eef0',
      nodeBorder: 1,
      corner: 4,
      edge: '#6b7680',
      edgeWidth: 1.25,
      edgeLabelFace: MONO_FACE,
      edgeLabelColor: '#4a555e',
      edgeLabelBackground: { color: '#e8eef0', opacity: 0, shape: 'rectangle' },
      halo: '#e8eef0',
      containerFill: { color: null, opacity: 0 },
      containerBorder: { color: '#182228', style: 'dashed', opacity: 0.3 },
      containerTitle: { face: MONO_FACE, size: 10, weight: '500', color: '#4a555e', upper: true },
      select: '#2457a6',
    }),
  ink: () =>
    dressBlocks({
      palette: INK,
      ink: '#182228',
      quiet: '#6b7680',
      ground: '#ffffff',
      nodeBorder: 1.5,
      corner: 4,
      edge: '#182228',
      edgeWidth: 1.2,
      edgeLabelFace: BODY_FACE,
      edgeLabelColor: '#182228',
      edgeLabelBackground: { color: '#ffffff', opacity: 0, shape: 'rectangle' },
      halo: '#e8eef0',
      containerFill: { color: '#182228', opacity: 0.04 },
      containerBorder: { color: '#182228', style: 'solid', opacity: 0.35 },
      containerTitle: { face: BODY_FACE, size: 11, weight: '600', color: '#182228', upper: true },
      select: '#2457a6',
    }),
  tinted: () =>
    dressBlocks({
      palette: TINTED,
      ink: '#0f172a',
      quiet: '#94a3b8',
      ground: '#e8eef0',
      nodeBorder: 1,
      corner: 8,
      edge: '#64748b',
      edgeWidth: 1.5,
      edgeLabelFace: BODY_FACE,
      edgeLabelColor: '#475569',
      edgeLabelBackground: { color: '#f8fafc', opacity: 1, shape: 'roundrectangle' },
      halo: null,
      containerFill: { color: null, opacity: 0.35 },
      containerBorder: { color: null, style: 'solid', opacity: 0.5 },
      containerTitle: { face: BODY_FACE, size: 11, weight: '600', color: '#334155', upper: false },
      select: '#2563eb',
    }),
  dark: () =>
    dressBlocks({
      palette: DARK,
      ink: '#e5e9ed',
      quiet: '#97a3ae',
      ground: '#12161b',
      nodeBorder: 1,
      corner: 6,
      edge: '#7f8b96',
      edgeWidth: 1.25,
      edgeLabelFace: BODY_FACE,
      edgeLabelColor: '#b8c2cc',
      edgeLabelBackground: { color: '#12161b', opacity: 0, shape: 'rectangle' },
      halo: '#12161b',
      containerFill: { color: '#1a2027', opacity: 0.7 },
      containerBorder: { color: '#3a444f', style: 'dashed', opacity: 1 },
      containerTitle: { face: BODY_FACE, size: 11, weight: '600', color: '#97a3ae', upper: false },
      select: '#7ea6ec',
    }),
}

export const presetBlocks = (id: StylePresetId): Block[] => PRESET_BLOCKS[id]()
