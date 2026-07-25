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
//
// Unmanifested pools (RDM, Unmanifested J.Crew) have no per-unit barcodes and
// no manifest rows. We represent each as a single synthetic SKU here:
// qty = sum(loads.quantity WHERE kind=X) − Whatnot scans of barcode X (+ for
// RDM, rdm_bundle_sales units). Editing in-stock writes loads.quantity = sold
// + new_in_stock on the pool's primary load.
// Accent class lookup — Tailwind needs literal class names, so each pool
// accent's full set lives here rather than being interpolated.
const ACCENT_CLASSES = {
  violet: {
    container: 'bg-violet-500/10 border-violet-500/40',
    thumb: 'bg-violet-500/20 border-violet-500/40 text-violet-300',
    badge: 'bg-violet-500/30 border border-violet-500/50 text-violet-100',
    btn: 'bg-violet-600 hover:bg-violet-500',
    stock: { bg: 'bg-violet-500/20 border-violet-500/40', label: 'text-violet-300', value: 'text-violet-100' },
  },
  amber: {
    container: 'bg-amber-500/10 border-amber-500/40',
    thumb: 'bg-amber-500/20 border-amber-500/40 text-amber-300',
    badge: 'bg-amber-500/30 border border-amber-500/50 text-amber-100',
    btn: 'bg-amber-600 hover:bg-amber-500',
    stock: { bg: 'bg-amber-500/20 border-amber-500/40', label: 'text-amber-300', value: 'text-amber-100' },
  },
  emerald: {
    container: 'bg-emerald-500/10 border-emerald-500/40',
    thumb: 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300',
    badge: 'bg-emerald-500/30 border border-emerald-500/50 text-emerald-100',
    btn: 'bg-emerald-600 hover:bg-emerald-500',
    stock: { bg: 'bg-emerald-500/20 border-emerald-500/40', label: 'text-emerald-300', value: 'text-emerald-100' },
  },
}

// Display config for the two built-in pools, keyed by scan token (pool_tag).
// Custom brand pools synthesize their own config at load time (emerald accent).
const BASE_POOL_CONFIG = {
  RDM: {
    label: 'RDM (Random Mystery Lot)',
    vendorLabel: 'RDM',
    accent: 'violet',
    blurb: 'Random Mystery Lot — bulk units, no barcodes.',
    hasBundles: true,
  },
  UJC: {
    label: 'Unmanifested J.Crew (non-RDM)',
    vendorLabel: 'Unmanifested J.Crew',
    accent: 'amber',
    blurb: 'Direct-from-J.Crew batch — no per-unit barcodes.',
    hasBundles: false,
  },
}

// Build the full pool-config map keyed by pool_tag from the loads rows.
// RDM/UJC use BASE_POOL_CONFIG; any other tag (custom brand) is synthesized.
function buildPoolConfigs(poolLoads) {
  const cfgs = {}
  for (const l of poolLoads || []) {
    const tag = l.pool_tag
    if (!tag || cfgs[tag]) continue
    const base = BASE_POOL_CONFIG[tag]
    cfgs[tag] = base
      ? { ...base, key: `__pool_${tag}__`, scanBarcode: tag }
      : {
          key: `__pool_${tag}__`,
          label: l.vendor || tag,
          vendorLabel: l.vendor || tag,
          scanBarcode: tag,
          accent: 'emerald',
          blurb: `${l.vendor || tag} — bulk units, no barcodes.`,
          hasBundles: false,
        }
  }
  return cfgs
}

// Pool sort order: RDM, then UJC, then custom brands A–Z.
function poolRank(tag) {
  return tag === 'RDM' ? 0 : tag === 'UJC' ? 1 : 2
}

// Renders as a full-screen overlay when `onClose` is provided (scanner mode),
// or inline when `embed` is true (used on the Admin Inventory tab).
export default function JumpstartInventory({ onClose, embed = false }) {
  const [items, setItems] = useState([])              // jumpstart_manifest rows
  const [soldByBarcode, setSoldByBarcode] = useState({}) // barcode → sold count
  const [pools, setPools] = useState({})              // pool_tag → { purchased, sold, ... }
  const [poolConfigs, setPoolConfigs] = useState({})  // pool_tag → display config
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

      // Aggregate sold counts per barcode. Pool scans (barcode = a pool_tag like
      // 'RDM'/'UJC'/'QUINCE') are bucketed separately from real-barcode sales.
      // Pool sales draw from ONE shared inventory pool across both channels, so
      // count scans from jumpstart_sold_scans AND kickstart_sold_scans. Real-barcode
      // (manifest) sales only exist in jumpstart_sold_scans; any stray Kickstart UPC
      // won't match a manifest barcode, so bucketing it is harmless.
      const [jsSold, ksSold] = await Promise.all([
        fetchAll(() => supabase.from('jumpstart_sold_scans').select('barcode')),
        fetchAll(() => supabase.from('kickstart_sold_scans').select('barcode')),
      ])
      const sold = [...(jsSold || []), ...(ksSold || [])]
      // Per-pool load aggregates (purchased qty, total cost basis), keyed by
      // pool_tag (J.Crew/Madewell blend + custom brand pools). Closed pools
      // (legacy RDM/UJC folded into the JCM blend) are excluded.
      const { data: poolLoadsRaw } = await supabase
        .from('loads')
        .select('id, kind, pool_tag, vendor, quantity, total_cost, closed')
        .not('pool_tag', 'is', null)
      const poolLoads = (poolLoadsRaw || []).filter(l => !l.closed)

      const cfgs = buildPoolConfigs(poolLoads)
      const poolTagSet = new Set(Object.keys(cfgs))

      // Aggregate sold counts per barcode. Pool scans (barcode = a pool_tag)
      // are bucketed separately from real-barcode sales.
      const counts = {}
      const poolScanCounts = {}
      for (const s of (sold || [])) {
        const b = s.barcode
        if (!b) continue
        if (b === 'CUSTOM') continue
        if (poolTagSet.has(b)) { poolScanCounts[b] = (poolScanCounts[b] || 0) + 1; continue }
        counts[b] = (counts[b] || 0) + 1
      }

      // Bulk lot sales deplete their own pool (JCM, DAMAGE, or legacy RDM).
      const { data: rdmBundleRows } = await supabase
        .from('rdm_bundle_sales')
        .select('quantity, pool_tag')
      const bundleSoldByTag = {}
      for (const r of rdmBundleRows || []) {
        const t = r.pool_tag || 'RDM'
        bundleSoldByTag[t] = (bundleSoldByTag[t] || 0) + (Number(r.quantity) || 0)
      }

      const nextPools = {}
      for (const tag of poolTagSet) {
        const tagLoads = (poolLoads || []).filter(l => l.pool_tag === tag)
        const purchased = tagLoads.reduce((s, l) => s + (Number(l.quantity) || 0), 0)
        const totalCost = tagLoads.reduce((s, l) => s + (Number(l.total_cost) || 0), 0)
        const bundleSold = bundleSoldByTag[tag] || 0
        const scanSold = poolScanCounts[tag] || 0
        nextPools[tag] = {
          poolTag: tag,
          loadIds: tagLoads.map(l => l.id),
          purchased,
          sold: scanSold + bundleSold,
          scanSold,
          bundleSold,
          unitCost: purchased > 0 ? totalCost / purchased : 0,
        }
      }

      setItems(manifest || [])
      setSoldByBarcode(counts)
      setPools(nextPools)
      setPoolConfigs(cfgs)
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

    let visible = showSoldOut ? arr : arr.filter(g => g.inStock > 0)

    // Synthetic SKUs for each unmanifested pool (RDM, Unmanifested J.Crew).
    // Only show when filters don't exclude them and there's purchased qty on
    // file. Pinned to the top of the list regardless of sort.
    const poolGroups = []
    for (const tag of Object.keys(poolConfigs)) {
      const data = pools[tag]
      const cfg = poolConfigs[tag]
      if (!data || data.purchased <= 0) continue
      const searchHay = `${cfg.label} ${cfg.vendorLabel} ${cfg.scanBarcode}`.toLowerCase()
      const matchesFilters =
        (!filterCategory) &&
        (!filterSize) &&
        (!filterVendor || searchHay.includes(filterVendor.toLowerCase())) &&
        (!q || searchHay.includes(q))
      if (!matchesFilters) continue
      const inStock = Math.max(0, data.purchased - data.sold)
      if (!showSoldOut && inStock === 0) continue
      poolGroups.push({
        key: cfg.key,
        isPool: true,
        poolTag: tag,
        poolConfig: cfg,
        rep: {
          id: cfg.key,
          description: cfg.label,
          vendor: cfg.vendorLabel,
          color: null,
          size: null,
          msrp: null,
          cost_freight: data.unitCost,
          photo_url: null,
        },
        items: [],
        totalQty: data.purchased,
        inStock,
        sold: data.sold,
        inStockIds: [],
        poolDetails: data,
      })
    }
    visible = [...poolGroups, ...visible]

    visible.sort((a, b) => {
      // Pin pool synthetics to the top no matter the sort
      if (a.isPool && !b.isPool) return -1
      if (b.isPool && !a.isPool) return 1
      if (a.isPool && b.isPool) {
        // Stable order across pools: RDM, then UJC, then custom brands A–Z
        return poolRank(a.poolTag) - poolRank(b.poolTag) || a.poolTag.localeCompare(b.poolTag)
      }
      if (sortBy === 'oldest') return (a.earliestCreated || '').localeCompare(b.earliestCreated || '')
      if (sortBy === 'msrp_high') return Number(b.rep.msrp || 0) - Number(a.rep.msrp || 0)
      if (sortBy === 'msrp_low')  return Number(a.rep.msrp || 0) - Number(b.rep.msrp || 0)
      // default: newest
      return (b.latestCreated || '').localeCompare(a.latestCreated || '')
    })
    return visible
  }, [items, soldByBarcode, pools, poolConfigs, filterCategory, filterSize, filterVendor, searchQuery, sortBy, showSoldOut])

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
    <div className={embed
      ? 'glass-card rounded-3xl overflow-hidden'
      : 'absolute inset-0 z-20 bg-navy flex flex-col'}>
      {/* Header — hidden in embed mode (parent supplies its own heading). */}
      {!embed && (
        <div className="px-3 py-2 flex items-center gap-2 border-b border-white/[0.06] shrink-0">
          <button onClick={onClose} className="flex items-center gap-1 bg-white/[0.06] hover:bg-white/[0.1] px-3 py-1.5 rounded-xl border border-white/[0.08]">
            <iconify-icon icon="lucide:chevron-left" class="text-white"></iconify-icon>
            <span className="text-white text-sm font-medium">Scan</span>
          </button>
          <h1 className="text-lg font-semibold text-white font-heading">Inventory</h1>
        </div>
      )}

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
          const isPool = g.isPool
          const poolCfg = g.poolConfig
          // Accent classes per pool (Tailwind needs literal class names — see ACCENT_CLASSES)
          const accentClasses = isPool ? (ACCENT_CLASSES[poolCfg.accent] || ACCENT_CLASSES.violet) : null
          return (
            <div
              key={g.key}
              className={`border rounded-2xl p-3 flex items-center gap-3 transition-all ${
                isPool
                  ? accentClasses.container
                  : isSelected
                    ? 'bg-cyan-500/10 border-cyan-500/60'
                    : 'bg-white/5 border-white/10 hover:bg-cyan-500/5 hover:border-cyan-500/20'
              }`}
            >
              {/* Pool synthetics have no per-row deletion (not in
                  jumpstart_manifest), so no checkbox — adjust via the edit
                  dialog. */}
              {isPool ? (
                <div className="w-5 shrink-0" aria-hidden />
              ) : (
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleKey(g.key)}
                  className="w-5 h-5 accent-cyan-500 cursor-pointer shrink-0"
                />
              )}
              <button onClick={() => setEditing(g)} className="flex-1 min-w-0 text-left active:scale-[0.98] transition-transform">
                <div className="flex items-center gap-3">
                  {isPool ? (
                    <div className={`w-14 h-14 rounded-lg shrink-0 flex items-center justify-center font-black text-sm tracking-wider ${accentClasses.thumb}`}>
                      {poolCfg.scanBarcode}
                    </div>
                  ) : item.photo_url ? (
                    <img src={item.photo_url} alt="" loading="lazy" className="w-14 h-14 rounded-lg object-cover bg-white/5 shrink-0" />
                  ) : (
                    <div className="w-14 h-14 rounded-lg bg-white/5 border border-white/10 shrink-0 flex items-center justify-center text-slate-600">
                      <iconify-icon icon="lucide:image-off" width="20"></iconify-icon>
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-white font-semibold text-sm truncate">{item.description || 'Unknown'}</p>
                    {isPool ? (
                      <p className="text-slate-400 text-xs truncate">
                        Bulk lot · no barcode · {g.totalQty.toLocaleString()} purchased
                      </p>
                    ) : (
                      <p className="text-slate-400 text-xs truncate">
                        {[item.vendor, item.size, item.color].filter(Boolean).join(' · ')}
                      </p>
                    )}
                    <p className="text-slate-500 text-xs mt-0.5">
                      {isPool
                        ? `Cost $${Number(item.cost_freight || 0).toFixed(2)}/unit`
                        : `MSRP $${Number(item.msrp || 0).toFixed(0)} · Cost $${Number(item.cost_freight || 0).toFixed(2)}`}
                    </p>
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-1">
                    <span className={`px-2.5 py-1 rounded-full text-sm font-bold ${isPool ? accentClasses.badge : 'bg-cyan-500/20 border border-cyan-500/40 text-cyan-200'}`}>
                      ×{g.inStock.toLocaleString()}
                    </span>
                    {g.sold > 0 && (
                      <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">{g.sold.toLocaleString()} sold</span>
                    )}
                  </div>
                </div>
              </button>
            </div>
          )
        })}
      </div>

      {editing && !editing.isPool && (
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
      {editing && editing.isPool && pools[editing.poolTag] && (
        <PoolEditModal
          group={editing}
          onClose={() => setEditing(null)}
          onSaved={(newPurchased) => {
            const tag = editing.poolTag
            setPools(prev => ({ ...prev, [tag]: { ...prev[tag], purchased: newPurchased } }))
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

function PoolEditModal({ group, onClose, onSaved }) {
  const details = group.poolDetails
  const cfg = group.poolConfig
  const [targetInStock, setTargetInStock] = useState(group.inStock)
  const [saving, setSaving] = useState(false)

  // Adjusting in-stock writes back to loads.quantity on the pool's primary
  // load (first by id). The cost basis is loads.total_cost / loads.quantity,
  // which the WAC in the profitability view reads at sale time.
  const newPurchased = Math.max(details.sold, details.sold + Number(targetInStock || 0))
  const delta = newPurchased - details.purchased

  const accent = ACCENT_CLASSES[cfg.accent] || ACCENT_CLASSES.violet
  const accentBtn = accent.btn
  const accentStock = accent.stock

  async function save() {
    if (delta === 0) { onClose(); return }
    if (!details.loadIds?.length) { alert(`No ${cfg.scanBarcode} load on record to write to.`); return }
    if (!confirm(`Set ${cfg.scanBarcode} in-stock to ${Number(targetInStock).toLocaleString()}? This will change the load's purchased quantity by ${delta > 0 ? '+' : ''}${delta.toLocaleString()}.`)) return
    setSaving(true)
    try {
      const primaryId = details.loadIds[0]
      const { data: row } = await supabase.from('loads').select('quantity').eq('id', primaryId).maybeSingle()
      const currentQty = Number(row?.quantity || 0)
      const newQty = Math.max(0, currentQty + delta)
      const { error } = await supabase.from('loads').update({ quantity: newQty }).eq('id', primaryId)
      if (error) { alert('Save failed: ' + error.message); return }
      onSaved(newPurchased)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-slate-900 border border-white/10 rounded-3xl p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-bold text-white">{cfg.label} inventory</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-2xl leading-none">×</button>
        </div>
        <p className="text-xs text-slate-500 mb-4">
          {cfg.blurb} Cost basis ${Number(details.unitCost || 0).toFixed(2)}/unit (loads.total_cost ÷ qty).
        </p>

        <div className="grid grid-cols-3 gap-2 mb-5 text-center">
          <div className="bg-white/5 rounded-xl py-3">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Purchased</p>
            <p className="text-lg font-black text-white mt-1">{details.purchased.toLocaleString()}</p>
          </div>
          <div className="bg-white/5 rounded-xl py-3">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Sold</p>
            <p className="text-lg font-black text-white mt-1">{details.sold.toLocaleString()}</p>
            <p className="text-[9px] text-slate-600 mt-0.5">
              {details.scanSold} shows{cfg.hasBundles ? ` · ${details.bundleSold} bundles` : ''}
            </p>
          </div>
          <div className={`${accentStock.bg} border rounded-xl py-3`}>
            <p className={`text-[10px] ${accentStock.label} uppercase tracking-wider font-semibold`}>In stock</p>
            <p className={`text-lg font-black ${accentStock.value} mt-1`}>{group.inStock.toLocaleString()}</p>
          </div>
        </div>

        <Field label="Adjust in-stock (use after damaged / lost / given away)">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setTargetInStock(q => Math.max(0, Number(q) - 1))} className="px-3 py-2 rounded-lg bg-white/10 text-white">−</button>
            <input type="number" min="0" value={targetInStock} onChange={e => setTargetInStock(Math.max(0, Number(e.target.value) || 0))} className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white text-center outline-none" />
            <button type="button" onClick={() => setTargetInStock(q => Number(q) + 1)} className="px-3 py-2 rounded-lg bg-white/10 text-white">+</button>
          </div>
        </Field>
        <p className="text-[11px] text-slate-500 mt-2">
          {delta === 0
            ? 'No change.'
            : delta > 0
              ? `Will add ${delta.toLocaleString()} unit${delta === 1 ? '' : 's'} to purchased (treats as restock).`
              : `Will remove ${Math.abs(delta).toLocaleString()} unit${Math.abs(delta) === 1 ? '' : 's'} from purchased (treats as loss).`}
        </p>

        <div className="flex flex-col gap-2 mt-5">
          <button onClick={save} disabled={saving || delta === 0} className={`w-full py-2.5 rounded-xl ${accentBtn} text-white font-bold text-sm disabled:opacity-50`}>
            {saving ? 'Saving…' : 'Save'}
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
