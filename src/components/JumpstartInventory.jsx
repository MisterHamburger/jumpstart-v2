import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase, fetchAll } from '../lib/supabase'

// In-stock inventory browser for jumpstart_manifest.
//   - Variant cards grouped by description+color+size+vendor+msrp+cost.
//   - Each card shows in-stock × sold counts.
//   - Filter pills (category, size, vendor), sort, search.
//   - Multi-select + bulk delete of unsold units.
//   - Tap card → edit variant (msrp / cost / zone / description, qty adjust,
//     delete entire variant).
//
// Deletion is always restricted to UNSOLD manifest rows so we never break
// profitability joins. Per barcode the deletable count is
// (manifest rows of that barcode) − (jumpstart_sold_scans rows with that barcode).
export default function JumpstartInventory({ onClose }) {
  const [items, setItems] = useState([])              // jumpstart_manifest rows
  const [soldByBarcode, setSoldByBarcode] = useState({}) // barcode → sold count
  const [loading, setLoading] = useState(true)

  const [filterCategory, setFilterCategory] = useState(null)
  const [filterSize, setFilterSize] = useState(null)
  const [filterVendor, setFilterVendor] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState('newest')      // newest | oldest | msrp_high | msrp_low
  const [openFilter, setOpenFilter] = useState(null)  // 'category' | 'size' | 'vendor' | null
  const [showSoldOut, setShowSoldOut] = useState(false) // include variants with 0 in stock?
  const [selectedKeys, setSelectedKeys] = useState(() => new Set())
  const [editing, setEditing] = useState(null)        // { key, rep, ids, soldIds, ... }
  const [busy, setBusy] = useState(false)

  useEffect(() => { loadData() }, [])
  // Clear selection whenever any filter / search changes
  useEffect(() => { setSelectedKeys(new Set()) }, [filterCategory, filterSize, filterVendor, searchQuery])

  async function loadData() {
    setLoading(true)
    try {
      // Manifest rows: only the fields we display + need for grouping/editing
      const manifest = await fetchAll(() => supabase
        .from('jumpstart_manifest')
        .select('id, barcode, description, category, subclass, size, color, vendor, gender, part_number, msrp, cost_freight, zone, load_id, photo_url, created_at')
        .order('created_at', { ascending: false }))

      // Aggregate sold counts per barcode (we paginate raw and count locally)
      const sold = await fetchAll(() => supabase
        .from('jumpstart_sold_scans')
        .select('barcode'))
      const counts = {}
      for (const s of (sold || [])) {
        const b = s.barcode
        if (!b || b === 'RDM' || b === 'CUSTOM') continue
        counts[b] = (counts[b] || 0) + 1
      }
      setItems(manifest || [])
      setSoldByBarcode(counts)
    } finally {
      setLoading(false)
    }
  }

  // Distinct lists for filter pills, derived from the unfiltered set so the
  // pill options don't disappear when you narrow the view.
  const categoryOptions = useMemo(() => {
    const set = new Map()
    for (const i of items) {
      const c = (i.category || '').trim()
      if (!c) continue
      set.set(c, (set.get(c) || 0) + 1)
    }
    return Array.from(set.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
  }, [items])
  const sizeOptions = useMemo(() => {
    const set = new Map()
    for (const i of items) {
      const s = (i.size || '').trim()
      if (!s) continue
      set.set(s, (set.get(s) || 0) + 1)
    }
    return Array.from(set.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
  }, [items])
  const vendorOptions = useMemo(() => {
    const set = new Map()
    for (const i of items) {
      const v = (i.vendor || '').trim()
      if (!v) continue
      set.set(v, (set.get(v) || 0) + 1)
    }
    return Array.from(set.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
  }, [items])

  // Filter → group → sort
  const groups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const filtered = items.filter(i => {
      if (filterCategory && (i.category || '') !== filterCategory) return false
      if (filterSize && (i.size || '') !== filterSize) return false
      if (filterVendor && (i.vendor || '') !== filterVendor) return false
      if (q) {
        const hay = [i.description, i.color, i.vendor, i.size, i.category, i.subclass, i.barcode].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })

    const map = new Map()
    for (const i of filtered) {
      const key = [
        i.description || '',
        i.color || '',
        i.size || '',
        i.vendor || '',
        Number(i.msrp || 0).toFixed(2),
        Number(i.cost_freight || 0).toFixed(2),
      ].join('||')
      let g = map.get(key)
      if (!g) {
        g = { key, rep: i, items: [], totalQty: 0, latestCreated: i.created_at }
        map.set(key, g)
      }
      g.items.push(i)
      g.totalQty++
      if (i.created_at > g.latestCreated) g.latestCreated = i.created_at
      if (i.created_at < (g.earliestCreated || i.created_at)) g.earliestCreated = i.created_at
    }

    const arr = Array.from(map.values()).map(g => {
      // Per-barcode in-stock = manifest rows of that barcode (within group)
      // minus sold count for that barcode. Sum across barcodes for the group.
      const byBarcode = new Map()
      for (const it of g.items) {
        const arr2 = byBarcode.get(it.barcode) || []
        arr2.push(it)
        byBarcode.set(it.barcode, arr2)
      }
      let inStock = 0, sold = 0
      const inStockIdsByBarcode = new Map()
      for (const [bc, rows] of byBarcode) {
        const soldN = Math.min(rows.length, soldByBarcode[bc] || 0)
        sold += soldN
        const stockN = rows.length - soldN
        inStock += stockN
        // The stockN rows we'd allow deletion of: take the newest stockN rows
        // by created_at (so we keep older rows linked to past sales / profit
        // history). Sort desc by created_at then take first stockN.
        const sorted = [...rows].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
        inStockIdsByBarcode.set(bc, sorted.slice(0, stockN).map(r => r.id))
      }
      const inStockIds = []
      for (const ids of inStockIdsByBarcode.values()) inStockIds.push(...ids)
      return { ...g, sold, inStock, inStockIds }
    })

    const visible = showSoldOut ? arr : arr.filter(g => g.inStock > 0)
    visible.sort((a, b) => {
      if (sortBy === 'oldest') return (a.earliestCreated || '').localeCompare(b.earliestCreated || '')
      if (sortBy === 'msrp_high') return Number(b.rep.msrp || 0) - Number(a.rep.msrp || 0)
      if (sortBy === 'msrp_low')  return Number(a.rep.msrp || 0) - Number(b.rep.msrp || 0)
      // default: newest
      return (b.latestCreated || '').localeCompare(a.latestCreated || '')
    })
    return visible
  }, [items, soldByBarcode, filterCategory, filterSize, filterVendor, searchQuery, sortBy, showSoldOut])

  const totalInStock = useMemo(() => groups.reduce((s, g) => s + g.inStock, 0), [groups])
  const totalSelected = useMemo(() => groups.filter(g => selectedKeys.has(g.key)).reduce((s, g) => s + g.inStock, 0), [groups, selectedKeys])
  const allSelected = groups.length > 0 && groups.every(g => selectedKeys.has(g.key))

  function toggleKey(k) {
    setSelectedKeys(prev => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k); else next.add(k)
      return next
    })
  }
  function clearFilters() {
    setFilterCategory(null); setFilterSize(null); setFilterVendor(null); setSearchQuery('')
  }

  async function bulkDeleteUnsold() {
    if (totalSelected === 0) return
    const variantCount = groups.filter(g => selectedKeys.has(g.key)).length
    if (!confirm(`Delete ${totalSelected} unsold unit${totalSelected === 1 ? '' : 's'} across ${variantCount} variant${variantCount === 1 ? '' : 's'}?\n\nSold items are never touched.`)) return
    setBusy(true)
    try {
      const idsToDelete = []
      for (const g of groups) {
        if (!selectedKeys.has(g.key)) continue
        idsToDelete.push(...g.inStockIds)
      }
      let deleted = 0
      for (let i = 0; i < idsToDelete.length; i += 500) {
        const batch = idsToDelete.slice(i, i + 500)
        const { error } = await supabase.from('jumpstart_manifest').delete().in('id', batch)
        if (error) { alert('Delete failed: ' + error.message); break }
        deleted += batch.length
      }
      // Update local state instead of full reload
      const idSet = new Set(idsToDelete)
      setItems(prev => prev.filter(i => !idSet.has(i.id)))
      setSelectedKeys(new Set())
      alert(`Deleted ${deleted} unit${deleted === 1 ? '' : 's'}.`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="absolute inset-0 z-20 bg-navy flex flex-col">
      {/* Header */}
      <div className="px-3 py-2 flex items-center gap-2 border-b border-white/[0.06] shrink-0">
        <button onClick={onClose} className="flex items-center gap-1 bg-white/[0.06] hover:bg-white/[0.1] px-3 py-1.5 rounded-xl border border-white/[0.08]">
          <iconify-icon icon="lucide:chevron-left" class="text-white"></iconify-icon>
          <span className="text-white text-sm font-medium">Scan</span>
        </button>
        <h1 className="text-lg font-semibold text-white font-heading">Inventory</h1>
      </div>

      {/* Selection / bulk-action bar */}
      <div className="px-3 py-2 bg-slate-800/50 border-b border-white/10 flex items-center justify-between gap-3 shrink-0">
        <label className="flex items-center gap-2 select-none cursor-pointer">
          <input
            type="checkbox"
            checked={allSelected}
            ref={el => { if (el) el.indeterminate = selectedKeys.size > 0 && !allSelected }}
            onChange={e => {
              if (e.target.checked) setSelectedKeys(new Set(groups.map(g => g.key)))
              else setSelectedKeys(new Set())
            }}
            className="w-4 h-4 accent-cyan-500"
          />
          <div className="flex flex-col leading-tight text-xs text-slate-400">
            <span>
              {selectedKeys.size > 0
                ? `${selectedKeys.size} variant${selectedKeys.size === 1 ? '' : 's'} selected · ${totalSelected} unit${totalSelected === 1 ? '' : 's'}`
                : `${groups.length} variants · ${totalInStock} in stock`}
            </span>
          </div>
        </label>
        <button
          onClick={bulkDeleteUnsold}
          disabled={busy || totalSelected === 0}
          className="px-3 py-1.5 rounded-xl bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-300 text-xs font-bold disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {busy ? 'Deleting…' : `Delete unsold${totalSelected > 0 ? ` (${totalSelected})` : ''}`}
        </button>
      </div>

      {/* Filter row */}
      <div className="px-3 py-2 bg-slate-800/30 border-b border-white/[0.06] shrink-0 space-y-2">
        <div className="flex gap-2 overflow-x-auto">
          <FilterPill label="Category" value={filterCategory} open={openFilter === 'category'} onOpen={() => setOpenFilter(openFilter === 'category' ? null : 'category')} onClear={() => setFilterCategory(null)} options={categoryOptions} onSelect={v => { setFilterCategory(v); setOpenFilter(null) }} />
          <FilterPill label="Size" value={filterSize} open={openFilter === 'size'} onOpen={() => setOpenFilter(openFilter === 'size' ? null : 'size')} onClear={() => setFilterSize(null)} options={sizeOptions} onSelect={v => { setFilterSize(v); setOpenFilter(null) }} />
          <FilterPill label="Vendor" value={filterVendor} open={openFilter === 'vendor'} onOpen={() => setOpenFilter(openFilter === 'vendor' ? null : 'vendor')} onClear={() => setFilterVendor(null)} options={vendorOptions} onSelect={v => { setFilterVendor(v); setOpenFilter(null) }} />
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none shrink-0"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="msrp_high">MSRP high → low</option>
            <option value="msrp_low">MSRP low → high</option>
          </select>
          <label className="flex items-center gap-1.5 text-xs text-slate-400 select-none shrink-0 pl-1">
            <input type="checkbox" checked={showSoldOut} onChange={e => setShowSoldOut(e.target.checked)} className="w-3.5 h-3.5 accent-cyan-500" />
            Show sold-out
          </label>
          {(filterCategory || filterSize || filterVendor || searchQuery) && (
            <button onClick={clearFilters} className="px-2.5 py-1.5 rounded-lg text-xs text-cyan-400 hover:text-cyan-300 shrink-0">Clear</button>
          )}
        </div>
        <input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search description, vendor, color, barcode…"
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 outline-none focus:border-cyan-500/40"
        />
      </div>

      {/* Variant list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading ? (
          <p className="text-center text-slate-500 text-sm py-12">Loading inventory…</p>
        ) : groups.length === 0 ? (
          <p className="text-center text-slate-500 text-sm py-12">No items match.</p>
        ) : groups.map(g => {
          const isSelected = selectedKeys.has(g.key)
          const item = g.rep
          return (
            <div
              key={g.key}
              className={`bg-white/5 border rounded-2xl p-3 flex items-center gap-3 transition-all ${
                isSelected ? 'border-cyan-500/60 bg-cyan-500/10' : 'border-white/10 hover:bg-cyan-500/5 hover:border-cyan-500/20'
              }`}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => toggleKey(g.key)}
                className="w-5 h-5 accent-cyan-500 cursor-pointer shrink-0"
              />
              <button onClick={() => setEditing(g)} className="flex-1 min-w-0 text-left active:scale-[0.98] transition-transform">
                <div className="flex items-center gap-3">
                  {item.photo_url ? (
                    <img src={item.photo_url} alt="" loading="lazy" className="w-14 h-14 rounded-lg object-cover bg-white/5 shrink-0" />
                  ) : (
                    <div className="w-14 h-14 rounded-lg bg-white/5 border border-white/10 shrink-0 flex items-center justify-center text-slate-600">
                      <iconify-icon icon="lucide:image-off" width="20"></iconify-icon>
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-white font-semibold text-sm truncate">{item.description || 'Unknown'}</p>
                    <p className="text-slate-400 text-xs truncate">
                      {[item.vendor, item.size, item.color].filter(Boolean).join(' · ')}
                    </p>
                    <p className="text-slate-500 text-xs mt-0.5">
                      MSRP ${Number(item.msrp || 0).toFixed(0)} · Cost ${Number(item.cost_freight || 0).toFixed(2)}
                    </p>
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-1">
                    <span className="px-2.5 py-1 rounded-full bg-cyan-500/20 border border-cyan-500/40 text-cyan-200 text-sm font-bold">
                      ×{g.inStock}
                    </span>
                    {g.sold > 0 && (
                      <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">{g.sold} sold</span>
                    )}
                  </div>
                </div>
              </button>
            </div>
          )
        })}
      </div>

      {editing && (
        <EditVariantModal
          group={editing}
          onClose={() => setEditing(null)}
          onSaved={(patch) => {
            // Apply field patch locally to matching manifest rows
            const matchIds = new Set(editing.items.map(i => i.id))
            setItems(prev => prev.map(i => matchIds.has(i.id) ? { ...i, ...patch } : i))
            setEditing(null)
          }}
          onDeleted={(deletedIds) => {
            const set = new Set(deletedIds)
            setItems(prev => prev.filter(i => !set.has(i.id)))
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

function FilterPill({ label, value, open, onOpen, onClear, options, onSelect }) {
  return (
    <div className="relative shrink-0">
      <button
        onClick={onOpen}
        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap flex items-center gap-1 ${
          value ? 'bg-cyan-500 text-white' : 'bg-white/10 text-white/60 border border-white/20'
        }`}
      >
        {value || label}
        {value
          ? <span onClick={e => { e.stopPropagation(); onClear() }} className="ml-0.5 opacity-70 hover:opacity-100">×</span>
          : <span className="text-[10px] opacity-50">▾</span>}
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 z-30 bg-slate-900 border border-white/15 rounded-xl shadow-xl py-1 max-h-72 overflow-y-auto min-w-[180px]">
          {options.length === 0 && <p className="px-3 py-2 text-xs text-slate-500">No options</p>}
          {options.map(o => (
            <button
              key={o.name}
              onClick={() => onSelect(o.name)}
              className="w-full text-left px-3 py-1.5 text-xs text-white hover:bg-cyan-500/20 flex justify-between items-center gap-3"
            >
              <span className="truncate">{o.name}</span>
              <span className="text-slate-500 text-[10px] shrink-0">{o.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function EditVariantModal({ group, onClose, onSaved, onDeleted }) {
  const rep = group.rep
  const [description, setDescription] = useState(rep.description || '')
  const [msrp, setMsrp] = useState(rep.msrp != null ? String(rep.msrp) : '')
  const [cost, setCost] = useState(rep.cost_freight != null ? String(rep.cost_freight) : '')
  const [zone, setZone] = useState(rep.zone || '')
  const [targetQty, setTargetQty] = useState(group.inStock)
  const [saving, setSaving] = useState(false)

  // How many unsold units to delete to reach target
  const deleteCount = Math.max(0, group.inStock - Number(targetQty || 0))
  const idsToDelete = group.inStockIds.slice(0, deleteCount)

  async function save() {
    setSaving(true)
    try {
      const patch = {}
      if ((rep.description || '') !== description.trim()) patch.description = description.trim()
      const newMsrp = msrp === '' ? null : Number(msrp)
      const newCost = cost === '' ? null : Number(cost)
      if (Number(rep.msrp || 0) !== Number(newMsrp || 0)) patch.msrp = newMsrp
      if (Number(rep.cost_freight || 0) !== Number(newCost || 0)) patch.cost_freight = newCost
      if ((rep.zone || '') !== zone.trim()) patch.zone = zone.trim() || null

      const matchIds = group.items.map(i => i.id)

      // Apply patch first (across every manifest row in the variant)
      if (Object.keys(patch).length > 0) {
        for (let i = 0; i < matchIds.length; i += 500) {
          const batch = matchIds.slice(i, i + 500)
          const { error } = await supabase.from('jumpstart_manifest').update(patch).in('id', batch)
          if (error) { alert('Save failed: ' + error.message); setSaving(false); return }
        }
      }

      // Delete N unsold rows if quantity reduced
      if (idsToDelete.length > 0) {
        for (let i = 0; i < idsToDelete.length; i += 500) {
          const batch = idsToDelete.slice(i, i + 500)
          const { error } = await supabase.from('jumpstart_manifest').delete().in('id', batch)
          if (error) { alert('Delete failed: ' + error.message); setSaving(false); return }
        }
        onDeleted(idsToDelete)
      } else if (Object.keys(patch).length > 0) {
        onSaved(patch)
      } else {
        onClose()
      }
    } finally {
      setSaving(false)
    }
  }

  async function deleteAllUnsold() {
    if (group.inStockIds.length === 0) return
    if (!confirm(`Delete all ${group.inStockIds.length} unsold unit${group.inStockIds.length === 1 ? '' : 's'} of this variant?\n\nSold units stay.`)) return
    setSaving(true)
    try {
      for (let i = 0; i < group.inStockIds.length; i += 500) {
        const batch = group.inStockIds.slice(i, i + 500)
        const { error } = await supabase.from('jumpstart_manifest').delete().in('id', batch)
        if (error) { alert('Delete failed: ' + error.message); return }
      }
      onDeleted(group.inStockIds)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-slate-900 border border-white/10 rounded-3xl p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-bold text-white">Edit variant</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-2xl leading-none">×</button>
        </div>
        <p className="text-xs text-slate-500 mb-4">{group.totalQty} total · {group.inStock} in stock · {group.sold} sold</p>

        <div className="space-y-3">
          <Field label="Description">
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-cyan-500/40" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="MSRP">
              <input type="number" step="0.01" value={msrp} onChange={e => setMsrp(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-cyan-500/40" />
            </Field>
            <Field label="Cost">
              <input type="number" step="0.01" value={cost} onChange={e => setCost(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-cyan-500/40" />
            </Field>
          </div>
          <Field label="Zone">
            <input value={zone} onChange={e => setZone(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-cyan-500/40" />
          </Field>
          <Field label={`Quantity in stock (will delete ${deleteCount} unsold unit${deleteCount === 1 ? '' : 's'})`}>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setTargetQty(q => Math.max(0, Number(q) - 1))} className="px-3 py-2 rounded-lg bg-white/10 text-white">−</button>
              <input type="number" min="0" max={group.inStock} value={targetQty} onChange={e => setTargetQty(Math.max(0, Math.min(group.inStock, Number(e.target.value) || 0)))} className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white text-center outline-none" />
              <button type="button" onClick={() => setTargetQty(q => Math.min(group.inStock, Number(q) + 1))} className="px-3 py-2 rounded-lg bg-white/10 text-white">+</button>
            </div>
          </Field>
        </div>

        <div className="flex flex-col gap-2 mt-5">
          <button onClick={save} disabled={saving} className="w-full py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-sm disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={deleteAllUnsold} disabled={saving || group.inStockIds.length === 0} className="w-full py-2 rounded-xl bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-300 text-xs font-bold disabled:opacity-30">
            Delete all {group.inStockIds.length} unsold
          </button>
          <button onClick={onClose} className="w-full py-2 rounded-xl text-slate-400 hover:text-white text-xs">Cancel</button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-1">{label}</span>
      {children}
    </label>
  )
}
