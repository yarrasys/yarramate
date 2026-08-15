interface QuickFilterBoxProps {
  readonly value: string
  readonly onChange: (text: string) => void
}

/**
 * Client-side, ephemeral narrowing by name/id/kind-label substring on top of
 * whatever `activeFilter` is loaded - never a view definition, never sent to
 * the server. `App.tsx` feeds `value` straight into `applyFilter`.
 */
export function QuickFilterBox({ value, onChange }: QuickFilterBoxProps) {
  return (
    <input
      type="search"
      className="quick-filter"
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
      placeholder="Filter by name or id…"
      aria-label="Quick filter"
    />
  )
}
