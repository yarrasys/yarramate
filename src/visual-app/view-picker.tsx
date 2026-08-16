import type { VisualViewSummary } from '../adapters/visual/protocol-contract.js'

interface ViewPickerProps {
  readonly views: readonly VisualViewSummary[]
  readonly activeViewId: string
  readonly onSelect: (view: VisualViewSummary) => void
  readonly onClear: () => void
}

export function ViewPicker({ views, activeViewId, onSelect, onClear }: ViewPickerProps) {
  const activeTitle =
    views.find((v) => v.id === activeViewId)?.title ?? 'All (unfiltered)'

  return (
    <select
      // The control is width-capped, so a long authored view title is elided
      // on screen. Hover recovers what the picker is actually showing.
      title={activeTitle}
      value={activeViewId === '' ? '__all__' : activeViewId}
      onChange={(e) => {
        const value = e.currentTarget.value
        if (value === '__all__') {
          onClear()
        } else {
          const view = views.find((v) => v.id === value)
          if (view) onSelect(view)
        }
      }}
    >
      <option value="__all__">All (unfiltered)</option>
      {[...views]
        .sort((a, b) => a.title.localeCompare(b.title))
        .map((view) => (
          <option key={view.id} value={view.id}>
            {view.title}
          </option>
        ))}
    </select>
  )
}
