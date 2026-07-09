// Segmented In Transit / Landed toggle.
//   value: true = Landed, false = In Transit (and 'all' when includeAll is set)
//   In Transit sits on the left (red when active); Landed on the right (green).
//   With includeAll, a neutral "All" segment is prepended (used as a filter).
//   onChange(nextValue) fires when a side is clicked.
// Used both as a per-load status switch (Inputs → Loads, two-state) and as a
// filter for the Inventory-by-Load grid (three-state with All).
export default function LandedToggle({ value, onChange, size = 'md', includeAll = false, className = '' }) {
  const pad = size === 'sm' ? 'px-2.5 py-1 text-[10px]' : 'px-3 py-1 text-[11px]'
  const seg = (active, activeCls) =>
    `${pad} rounded-full font-bold uppercase tracking-wide transition-all ${
      active ? activeCls : 'text-white/40 hover:text-white/70'
    }`
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className={`inline-flex items-center gap-0.5 rounded-full bg-slate-900/70 border border-white/10 p-0.5 select-none ${className}`}
    >
      {includeAll && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onChange('all') }}
          className={seg(value === 'all', 'bg-white/15 text-white shadow-inner shadow-black/40')}
        >
          All
        </button>
      )}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onChange(false) }}
        className={seg(value === false, 'bg-red-500/25 text-red-300 shadow-inner shadow-red-900/40')}
      >
        In Transit
      </button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onChange(true) }}
        className={seg(value === true, 'bg-emerald-500/25 text-emerald-300 shadow-inner shadow-emerald-900/40')}
      >
        Landed
      </button>
    </div>
  )
}
