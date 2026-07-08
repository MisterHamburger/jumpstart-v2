import { useState, useEffect } from 'react'
import { supabase, fetchAll } from '../lib/supabase'
import JumpstartInventory from './JumpstartInventory'

// Admin → Inventory tab.
//
// Top section: stat cards + Inventory Status bar + Inventory by Load grid.
//   - Includes RDM and Unmanifested-J.Crew pools alongside manifested loads,
//     so totals match the variant browser below.
//   - Inventory by Load surfaces every load row (incl. RDM/UJC) with the
//     correct in-stock / sold split per kind, sorted by date desc.
//
// Below the top section we embed the same variant browser used in the
// scanner overlay (JumpstartInventory), so admins can search, filter, edit,
// and bulk-delete variants without leaving the page.
export default function AdminInventory() {
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({
    total: 0,
    sold: 0,
    onShelfCount: 0,
    onShelfCost: 0,
    transitCount: 0,
    transitCost: 0,
    ownedRemaining: 0,
    ownedCost: 0,
    avgRemainingCost: 0,
    loads: [],
  })

  useEffect(() => { loadStats() }, [])

  async function loadStats() {
    setLoading(true)

    // Manifested-load summary from the existing view (load_id → counts/cost).
    const { data: loadSummary } = await supabase.from('load_summary').select('*')

    // Every load row, including non-manifested kinds. Needed for brand/notes
    // lookup, sort-by-date, and RDM/UJC totals (which load_summary's
    // manifest-join doesn't cover).
    const { data: loadsInfo } = await supabase
      .from('loads')
      .select('id, kind, pool_tag, vendor, notes, quantity, total_cost, date, landed')

    // Pool tokens (RDM, UJC, custom brands) from the loads table.
    const poolTagSet = new Set((loadsInfo || []).map(l => l.pool_tag).filter(Boolean))

    // Pool scan counts (RDM/UJC/custom tokens) — the only inventory that carries
    // a live in-stock balance. Manifested barcodes are intentionally NOT walked
    // for in-stock: every manifested unit is treated as depleted (sold live,
    // tagged into a pool, bundled, or lost to scanner misses), so it contributes
    // nothing to Remaining / Inventory Value (see the Remaining calc below).
    // Pool sales come from BOTH channels now — one shared inventory pool. Jumpstart
    // shows write to jumpstart_sold_scans, Kickstart shows to kickstart_sold_scans;
    // both deduct from the same pool, so count pool-tag scans across both tables.
    // (Non-pool barcodes are ignored below by the poolTagSet filter.)
    const [jsScans, ksScans] = await Promise.all([
      fetchAll(() => supabase.from('jumpstart_sold_scans').select('barcode')),
      fetchAll(() => supabase.from('kickstart_sold_scans').select('barcode')),
    ])
    const allSoldScans = [...(jsScans || []), ...(ksScans || [])]
    const poolScansByTag = {}   // pool_tag → Whatnot scan count
    for (const s of allSoldScans || []) {
      const b = s.barcode
      if (b && poolTagSet.has(b)) poolScansByTag[b] = (poolScansByTag[b] || 0) + 1
    }

    // RDM bundle sales (whole-crate sales outside Whatnot) deplete the RDM pool.
    const { data: rdmBundleRows } = await supabase
      .from('rdm_bundle_sales')
      .select('quantity')
    const rdmBundleSold = (rdmBundleRows || []).reduce((s, r) => s + (Number(r.quantity) || 0), 0)

    // ── Build per-load rows for the "Inventory by Load" grid ──
    const rows = []
    for (const l of loadsInfo || []) {
      if (l.kind === 'manifested' || !l.kind) {
        const summary = (loadSummary || []).find(s => s.load_id === l.id)
        if (!summary) continue
        rows.push({
          load_id: l.id,
          kind: 'manifested',
          landed: l.landed,
          date: l.date || null,
          brand: l.vendor || l.notes || '',
          item_count: Number(summary.item_count) || 0,
          total_cost: Number(summary.total_cost) || 0,
          avg_cost: Number(summary.avg_cost) || 0,
        })
      } else {
        const qty = Number(l.quantity) || 0
        const cost = Number(l.total_cost) || 0
        rows.push({
          load_id: l.id,
          kind: l.kind,
          pool_tag: l.pool_tag || null,
          landed: l.landed,
          date: l.date || null,
          brand: l.kind === 'rdm' ? 'RDM'
            : l.kind === 'unmanifested' ? 'Unmanifested J.Crew'
            : (l.vendor || l.pool_tag || 'Custom'),
          item_count: qty,
          total_cost: cost,
          avg_cost: qty > 0 ? cost / qty : 0,
        })
      }
    }
    // Sort by date desc; loads without a date go last in id order.
    rows.sort((a, b) => {
      if (a.date && b.date) return b.date.localeCompare(a.date)
      if (a.date && !b.date) return -1
      if (!a.date && b.date) return 1
      return String(a.load_id).localeCompare(String(b.load_id))
    })

    // ── Top-level totals ──
    const manifestedItems = (loadSummary || []).reduce((s, l) => s + (Number(l.item_count) || 0), 0)
    const poolRows = (loadsInfo || []).filter(l => l.pool_tag)
    const poolItems = poolRows.reduce((s, l) => s + (Number(l.quantity) || 0), 0)

    const total = manifestedItems + poolItems

    // Pool remaining, split into LANDED (physically on the shelf) and IN-TRANSIT
    // (purchased but not yet arrived). Sales can only draw from landed loads, so
    // sold is apportioned pro-rata across a pool's landed loads only; in-transit
    // loads keep their full quantity. This keeps "cost of units in stock"
    // precise (physical) while still exposing total owned inventory value.
    const poolByTag = {}
    for (const l of poolRows) (poolByTag[l.pool_tag] ||= []).push(l)
    const poolSoldByTag = {}
    for (const tag of Object.keys(poolByTag)) {
      poolSoldByTag[tag] = (poolScansByTag[tag] || 0) + (tag === 'RDM' ? rdmBundleSold : 0)
    }
    let onShelfCount = 0, onShelfCost = 0     // landed & unsold
    let transitCount = 0, transitCost = 0     // purchased, not yet landed
    for (const tag of Object.keys(poolByTag)) {
      const landedLoads  = poolByTag[tag].filter(l => l.landed)
      const transitLoads = poolByTag[tag].filter(l => !l.landed)
      const landedQty = landedLoads.reduce((s, l) => s + (Number(l.quantity) || 0), 0)
      const soldFromLanded = Math.min(landedQty, poolSoldByTag[tag] || 0)
      for (const l of landedLoads) {
        const qty = Number(l.quantity) || 0
        const unitCost = qty > 0 ? (Number(l.total_cost) || 0) / qty : 0
        const allocatedSold = landedQty > 0 ? Math.round(soldFromLanded * (qty / landedQty)) : 0
        const remainingQty = Math.max(0, qty - allocatedSold)
        onShelfCount += remainingQty
        onShelfCost  += remainingQty * unitCost
      }
      for (const l of transitLoads) {
        const qty = Number(l.quantity) || 0
        const unitCost = qty > 0 ? (Number(l.total_cost) || 0) / qty : 0
        transitCount += qty
        transitCost  += qty * unitCost
      }
    }

    // Manifested inventory is treated as fully depleted (sold, pool-tagged,
    // bundled, or scanner-missed), so it adds nothing to in-stock. "In stock" =
    // landed pool units; "owned" also includes in-transit. Sold ties out:
    // Total = Sold + Owned-remaining.
    const ownedRemaining      = onShelfCount + transitCount
    const avgRemainingCost    = onShelfCount > 0 ? onShelfCost / onShelfCount : 0
    const sold                = Math.max(0, total - ownedRemaining)

    setStats({
      total,
      sold,
      onShelfCount,
      onShelfCost,
      transitCount,
      transitCost,
      ownedRemaining,
      ownedCost: onShelfCost + transitCost,
      avgRemainingCost,
      loads: rows,
    })
    setLoading(false)
  }

  const soldPct = stats.total > 0 ? (stats.sold / stats.total * 100).toFixed(1) : 0

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="relative">
          <div className="w-12 h-12 border-2 border-cyan-500/20 rounded-full" />
          <div className="absolute inset-0 w-12 h-12 border-2 border-transparent border-t-cyan-500 rounded-full animate-spin" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-extrabold tracking-tight text-white">Inventory</h2>

      {/* Top Stats Row */}
      <div className="grid grid-cols-5 gap-4">
        <StatCard label="In Stock (landed)"     value={stats.onShelfCount.toLocaleString()} sub={stats.transitCount > 0 ? `on the shelf · +${stats.transitCount.toLocaleString()} in transit` : 'on the shelf'} accent="purple" />
        <StatCard label="Sold"                  value={stats.sold.toLocaleString()}      sub={`${soldPct}% of total`} accent="cyan" />
        <StatCard label="Total Items Purchased" value={stats.total.toLocaleString()}     sub="All inventory ever" />
        <StatCard label="Avg Cost of Remaining" value={`$${stats.avgRemainingCost.toFixed(2)}`} sub="Per landed unit" />
        <StatCard label="Landed Stock Value"    value={`$${Math.round(stats.onShelfCost).toLocaleString()}`} sub={stats.transitCost > 0 ? `owned $${Math.round(stats.ownedCost).toLocaleString()} incl. transit` : 'cost of in-stock units'} accent="emerald" />
      </div>

      {/* Progress Bar */}
      <div className="glass-card rounded-3xl p-6">
        <div className="flex justify-between items-center mb-3">
          <span className="text-sm font-medium text-slate-300">Inventory Status</span>
          <span className="text-sm text-cyan-400 font-semibold">{soldPct}% sold</span>
        </div>
        <div className="h-3 rounded-full bg-slate-800 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-400 transition-all duration-500"
            style={{ width: `${soldPct}%` }}
          />
        </div>
        <div className="flex justify-between mt-2 text-xs text-slate-500">
          <span>{stats.sold.toLocaleString()} sold</span>
          <span>{stats.ownedRemaining.toLocaleString()} remaining{stats.transitCount > 0 ? ` (${stats.onShelfCount.toLocaleString()} landed + ${stats.transitCount.toLocaleString()} in transit)` : ''}</span>
        </div>
      </div>

      {/* Inventory by Load — 3-col grid, newest first */}
      <div className="glass-card rounded-3xl p-6">
        <h3 className="font-bold text-lg mb-4">Inventory by Load</h3>
        <div className="grid grid-cols-3 gap-4">
          {stats.loads.map(load => {
            const badge = load.kind === 'rdm'
              ? { label: 'RDM',          cls: 'bg-violet-500/20 text-violet-300 border-violet-500/30' }
              : load.kind === 'unmanifested'
                ? { label: 'Unmanifested', cls: 'bg-amber-500/20 text-amber-300 border-amber-500/30' }
                : load.kind === 'custom'
                  ? { label: load.pool_tag || 'Custom', cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' }
                  : null
            const formattedDate = load.date
              ? (() => { const [y, m, d] = load.date.split('-'); return `${m}-${d}-${y}` })()
              : null
            return (
              <div key={load.load_id} className="rounded-xl bg-slate-800/30 border border-white/[0.04] p-4 hover:bg-slate-800/50 transition-colors">
                <div className="flex justify-between items-start mb-2 gap-2">
                  <div className="font-semibold text-white flex items-center gap-2 flex-wrap min-w-0">
                    <span>Load {load.load_id.replace('Load ', '')}</span>
                    {badge && (
                      <span className={`px-1.5 py-0.5 rounded-md text-[10px] uppercase tracking-wider font-bold border ${badge.cls}`}>
                        {badge.label}
                      </span>
                    )}
                    {load.landed === false && (
                      <span className="px-1.5 py-0.5 rounded-md text-[10px] uppercase tracking-wider font-bold border bg-orange-500/20 text-orange-300 border-orange-500/30">
                        In transit
                      </span>
                    )}
                  </div>
                  <div className="text-lg font-bold text-white shrink-0">{load.item_count.toLocaleString()}</div>
                </div>
                {(load.brand || formattedDate) && (
                  <div className="text-xs text-slate-400 mb-1 truncate">
                    {load.brand}
                    {load.brand && formattedDate && <span className="text-slate-600"> · </span>}
                    {formattedDate}
                  </div>
                )}
                <div className="flex justify-between text-xs text-slate-400 mt-1">
                  <span>Total: ${Number(load.total_cost).toLocaleString(undefined, {maximumFractionDigits: 0})}</span>
                  <span>Avg: ${Number(load.avg_cost).toFixed(2)}/item</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Variant browser — same component as the scanner's Inventory overlay */}
      <JumpstartInventory embed />
    </div>
  )
}

function StatCard({ label, value, sub, accent }) {
  const valueClass =
    accent === 'cyan'    ? 'text-cyan-400'    :
    accent === 'purple'  ? 'text-purple-400'  :
    accent === 'emerald' ? 'text-emerald-400' :
    'text-white'
  return (
    <div className="glass-card rounded-3xl p-5">
      <div className="text-[10px] uppercase tracking-[0.15em] font-semibold text-slate-500 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${valueClass}`}>
        {value}
      </div>
      <div className="text-xs text-slate-500 mt-1">{sub}</div>
    </div>
  )
}
