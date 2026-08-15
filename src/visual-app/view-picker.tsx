import type { VisualViewSummary } from '../adapters/visual/protocol-contract.js'

interface ViewPickerProps {
  readonly views: readonly VisualViewSummary[]
  readonly onSelect: (view: VisualViewSummary) => void
  readonly onClear: () => void
}

export function ViewPicker({ views, onSelect, onClear }: ViewPickerProps) {
  return (
    <select
      onChange={(e) => {
        const value = e.currentTarget.value
        if (value === '__all__') {
          onClear()
        } else {
          const view = views.find((v) => v.id === value)
          if (view) onSelect(view)
        }
        e.currentTarget.value = '__all__'
      }}
      defaultValue="__all__"
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
