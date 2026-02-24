import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function AdminInventory() {
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState([])
  const [search, setSearch] = useState('')
  const [zoneFilter, setZoneFilter] = useState('all')
  const [stats, setStats] = useState({
    total: 0,
    sold: 0,
    remaining: 0,
    avgCost: 0,
    loads: [],
    zones: { z1: 0, z2: 0, z3: 0, unassigned: 0 }
  })
  const [unsoldStats, setUnsoldStats] = useState({
    totalUnsoldCost: 0,
    totalUnsoldCount: 0,
    avgUnsoldCost: 0,
    byLoad: [] // { load_id, unsoldCost, unsoldCount, avgCost }
  })

  useEffect(() => { loadStats(); loadUnsoldStats() }, [])
  useEffect(() => { loadItems() }, [search, zoneFilter])

  async function loadStats() {
    setLoading(true)
    
    // Get load summary from view
    const { data: loadData } = await supabase.from('load_summary').select('*')
    
    // Get zone counts
    const { count: z1 } = await supabase.from('jumpstart_manifest').select('id', { count: 'exact', head: true }).eq('zone', 1)
    const { count: z2 } = await supabase.from('jumpstart_manifest').select('id', { count: 'exact', head: true }).eq('zone', 2)
    const { count: z3 } = await supabase.from('jumpstart_manifest').select('id', { count: 'exact', head: true }).eq('zone', 3)
    const { count: total } = await supabase.from('jumpstart_manifest').select('id', { count: 'exact', head: true })
    
    // Get sold count from show_items
    const { count: sold } = await supabase.from('show_items').select('id', { count: 'exact', head: true }).eq('status', 'valid')
    
    const totalItems = loadData?.reduce((sum, l) => sum + Number(l.item_count), 0) || 0
    const totalCost = loadData?.reduce((sum, l) => sum + Number(l.total_cost), 0) || 0
    const avgCost = totalItems > 0 ? totalCost / totalItems : 0
    
    setStats({
      total: totalItems,
      sold: sold || 0,
      remaining: totalItems - (sold || 0),
      avgCost,
      loads: loadData || [],
      zones: {
        z1: z1 || 0,
        z2: z2 || 0,
        z3: z3 || 0,
        unassigned: (total || 0) - (z1 || 0) - (z2 || 0) - (z3 || 0)
      }
    })
    setLoading(false)
  }

  // Helper to fetch all rows with pagination (Supabase default limit is 1000)
  async function fetchAllRows(table, columns) {
    let allData = []
    let offset = 0
    const pageSize = 1000
    while (true) {
      const { data } = await supabase.from(table).select(columns).range(offset, offset + pageSize - 1)
      if (!data || data.length === 0) break
      allData = allData.concat(data)
      offset += pageSize
      if (data.length < pageSize) break
    }
    return allData
  }

  async function loadUnsoldStats() {
    // Get all scanned items from sort_log (with pagination)
    const sortData = await fetchAllRows('jumpstart_sort_log', 'barcode')

    // Get all sold items (with pagination)
    const soldData = await fetchAllRows('jumpstart_sold_scans', 'barcode')

    if (!sortData || sortData.length === 0) {
      setUnsoldStats({ totalUnsoldCost: 0, totalUnsoldCount: 0, avgUnsoldCost: 0, byLoad: [] })
      return
    }

    // Count scanned items per barcode
    const scannedCounts = {}
    sortData.forEach(row => {
      scannedCounts[row.barcode] = (scannedCounts[row.barcode] || 0) + 1
    })

    // Count sold items per barcode
    const soldCounts = {}
    if (soldData) {
      soldData.forEach(row => {
        soldCounts[row.barcode] = (soldCounts[row.barcode] || 0) + 1
      })
    }

    // Calculate remaining per barcode
    const remainingCounts = {}
    Object.keys(scannedCounts).forEach(barcode => {
      const scanned = scannedCounts[barcode]
      const sold = soldCounts[barcode] || 0
      const remaining = scanned - sold
      if (remaining > 0) {
        remainingCounts[barcode] = remaining
      }
    })

    // Get cost and load_id for each barcode from manifest
    const barcodes = Object.keys(remainingCounts)
    if (barcodes.length === 0) {
      setUnsoldStats({ totalUnsoldCost: 0, totalUnsoldCount: 0, avgUnsoldCost: 0, byLoad: [] })
      return
    }

    const { data: manifestData } = await supabase
      .from('jumpstart_manifest')
      .select('barcode, cost_freight, load_id')
      .in('barcode', barcodes)

    // Deduplicate manifest by barcode (take first match)
    const manifestByBarcode = {}
    if (manifestData) {
      manifestData.forEach(row => {
        if (!manifestByBarcode[row.barcode]) {
          manifestByBarcode[row.barcode] = row
        }
      })
    }

    // Aggregate by load
    const byLoadMap = {}
    let totalCost = 0
    let totalCount = 0

    Object.entries(remainingCounts).forEach(([barcode, count]) => {
      const manifest = manifestByBarcode[barcode]
      if (manifest) {
        const cost = Number(manifest.cost_freight) || 0
        const loadId = manifest.load_id || 'Unknown'

        if (!byLoadMap[loadId]) {
          byLoadMap[loadId] = { load_id: loadId, unsoldCost: 0, unsoldCount: 0 }
        }
        byLoadMap[loadId].unsoldCost += cost * count
        byLoadMap[loadId].unsoldCount += count
        totalCost += cost * count
        totalCount += count
      }
    })

    // Calculate averages
    const byLoad = Object.values(byLoadMap).map(load => ({
      ...load,
      avgCost: load.unsoldCount > 0 ? load.unsoldCost / load.unsoldCount : 0
    }))

    setUnsoldStats({
      totalUnsoldCost: totalCost,
      totalUnsoldCount: totalCount,
      avgUnsoldCost: totalCount > 0 ? totalCost / totalCount : 0,
      byLoad
    })
  }

  async function loadItems() {
    let query = supabase.from('jumpstart_manifest')
      .select('barcode, description, category, size, color, msrp, cost_freight, zone, load_id')
      .order('msrp', { ascending: false })
      .limit(100)

    if (zoneFilter === 'none') {
      query = query.is('zone', null)
    } else if (zoneFilter !== 'all') {
      query = query.eq('zone', parseInt(zoneFilter))
    }
    if (search) query = query.or(`description.ilike.%${search}%,barcode.ilike.%${search}%,category.ilike.%${search}%`)

    const { data } = await query
    setItems(data || [])
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
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Total Items" value={stats.total.toLocaleString()} sub="All inventory" />
        <StatCard label="Sold" value={stats.sold.toLocaleString()} sub={`${soldPct}% of total`} accent="cyan" />
        <StatCard label="Remaining" value={stats.remaining.toLocaleString()} sub="In stock" accent="purple" />
        <StatCard label="Avg Cost" value={`$${stats.avgCost.toFixed(2)}`} sub="Per item (incl. freight)" />
      </div>

      {/* Progress Bar */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-b from-slate-800/60 to-slate-900/40 border border-white/[0.08] p-5 shadow-xl shadow-black/30">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
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
          <span>{stats.remaining.toLocaleString()} remaining</span>
        </div>
      </div>

      {/* Unsold Inventory Summary */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-b from-amber-900/20 to-slate-900/40 border border-amber-500/20 p-5 shadow-xl shadow-black/30">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-500/40 to-transparent" />
        <h3 className="font-bold text-lg mb-4 text-amber-400">Unsold Inventory (Scanned)</h3>
        <p className="text-sm text-slate-400 mb-4">Items scanned into sort log but not yet sold</p>
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="rounded-xl bg-slate-800/30 border border-white/[0.04] p-4 text-center">
            <div className="text-2xl font-bold text-amber-400">${unsoldStats.totalUnsoldCost.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
            <div className="text-sm text-slate-400">Total Cost Tied Up</div>
          </div>
          <div className="rounded-xl bg-slate-800/30 border border-white/[0.04] p-4 text-center">
            <div className="text-2xl font-bold text-white">{unsoldStats.totalUnsoldCount.toLocaleString()}</div>
            <div className="text-sm text-slate-400">Unsold Items</div>
          </div>
          <div className="rounded-xl bg-slate-800/30 border border-white/[0.04] p-4 text-center">
            <div className="text-2xl font-bold text-slate-300">${unsoldStats.avgUnsoldCost.toFixed(2)}</div>
            <div className="text-sm text-slate-400">Avg Cost/Item</div>
          </div>
        </div>

        {/* Unsold By Load */}
        {unsoldStats.byLoad.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-slate-400 mb-3 uppercase tracking-wider">By Load</h4>
            <div className="grid grid-cols-2 gap-4">
              {unsoldStats.byLoad.map(load => (
                <div key={load.load_id} className="rounded-xl bg-slate-800/30 border border-amber-500/10 p-4 hover:bg-slate-800/50 transition-colors">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-semibold text-white">Load {load.load_id}</div>
                      <div className="text-sm text-amber-400/80 mt-1">Unsold: ${load.unsoldCost.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
                      <div className="text-xs text-slate-500 mt-0.5">Avg: ${load.avgCost.toFixed(2)}/item</div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-amber-400">{load.unsoldCount.toLocaleString()}</div>
                      <div className="text-xs text-slate-500">items</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {unsoldStats.byLoad.length === 0 && unsoldStats.totalUnsoldCount === 0 && (
          <p className="text-sm text-slate-500 text-center py-4">No items have been scanned into sort log yet</p>
        )}
      </div>

      {/* By Load (All Inventory) */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-b from-slate-800/60 to-slate-900/40 border border-white/[0.08] p-5 shadow-xl shadow-black/30">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
        <h3 className="font-bold text-lg mb-4">All Inventory by Load</h3>
        <div className="grid grid-cols-2 gap-4">
          {stats.loads.map(load => (
            <div key={load.load_id} className="rounded-xl bg-slate-800/30 border border-white/[0.04] p-4 hover:bg-slate-800/50 transition-colors">
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-semibold text-white">Load {load.load_id}</div>
                  <div className="text-sm text-slate-500 mt-1">Total Cost: ${Number(load.total_cost).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-slate-300">{Number(load.item_count).toLocaleString()} items</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* By Zone */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-b from-slate-800/60 to-slate-900/40 border border-white/[0.08] p-5 shadow-xl shadow-black/30">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
        <h3 className="font-bold text-lg mb-4">By Zone</h3>
        <div className="grid grid-cols-4 gap-4">
          <ZoneCard zone={1} count={stats.zones.z1} />
          <ZoneCard zone={2} count={stats.zones.z2} />
          <ZoneCard zone={3} count={stats.zones.z3} />
          <ZoneCard zone={null} count={stats.zones.unassigned} label="Unassigned" />
        </div>
      </div>

      {/* Item List */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-b from-slate-800/60 to-slate-900/40 border border-white/[0.08] p-5 shadow-xl shadow-black/30">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
        <h3 className="font-bold text-lg mb-4">Item List</h3>
        
        {/* Filters */}
        <div className="flex gap-3 mb-4">
          <input 
            placeholder="Search barcode, description, category..."
            value={search} 
            onChange={e => setSearch(e.target.value)}
            className="flex-1 bg-slate-800/50 border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:border-cyan-500/50 focus:outline-none transition-colors" 
          />
          <select 
            value={zoneFilter} 
            onChange={e => setZoneFilter(e.target.value)}
            className="bg-slate-800/50 border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white focus:border-cyan-500/50 focus:outline-none transition-colors"
          >
            <option value="all">All Zones</option>
            <option value="1">Zone 1</option>
            <option value="2">Zone 2</option>
            <option value="3">Zone 3</option>
            <option value="none">Unassigned</option>
          </select>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.08]">
                <th className="text-left py-3 px-3 text-[11px] uppercase tracking-wider font-semibold text-slate-400">Description</th>
                <th className="text-left py-3 px-3 text-[11px] uppercase tracking-wider font-semibold text-slate-400">Category</th>
                <th className="text-right py-3 px-3 text-[11px] uppercase tracking-wider font-semibold text-slate-400">MSRP</th>
                <th className="text-right py-3 px-3 text-[11px] uppercase tracking-wider font-semibold text-slate-400">Cost</th>
                <th className="text-center py-3 px-3 text-[11px] uppercase tracking-wider font-semibold text-slate-400">Zone</th>
                <th className="text-left py-3 px-3 text-[11px] uppercase tracking-wider font-semibold text-slate-400">Size</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={i} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                  <td className="py-3 px-3 max-w-[250px] truncate text-white">{item.description}</td>
                  <td className="py-3 px-3 text-slate-400">{item.category}</td>
                  <td className="py-3 px-3 text-right text-slate-300">${Number(item.msrp || 0).toFixed(2)}</td>
                  <td className="py-3 px-3 text-right text-slate-500">${Number(item.cost_freight || 0).toFixed(2)}</td>
                  <td className="py-3 px-3 text-center">
                    <span className={`inline-flex items-center justify-center w-7 h-7 rounded-lg text-xs font-bold text-white
                      ${item.zone === 1 ? 'bg-purple-600' : item.zone === 2 ? 'bg-teal-600' : item.zone === 3 ? 'bg-pink-600' : 'bg-slate-600'}`}>
                      {item.zone || '—'}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-slate-400">{item.size}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {items.length >= 100 && (
            <p className="text-xs text-slate-500 text-center py-3">Showing first 100 results. Narrow your search for more.</p>
          )}
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-b from-slate-800/60 to-slate-900/40 border border-white/[0.08] p-4 shadow-xl shadow-black/30">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      <div className="text-[10px] uppercase tracking-[0.15em] font-semibold text-slate-500 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${accent === 'cyan' ? 'text-cyan-400' : accent === 'purple' ? 'text-purple-400' : 'text-white'}`}>
        {value}
      </div>
      <div className="text-xs text-slate-500 mt-1">{sub}</div>
    </div>
  )
}

function ZoneCard({ zone, count, label }) {
  return (
    <div className="rounded-xl bg-slate-800/30 border border-white/[0.04] p-4 text-center hover:bg-slate-800/50 transition-colors">
      <div className="text-2xl font-bold text-white mb-1">{count.toLocaleString()}</div>
      <div className="text-sm text-slate-400">{label || `Zone ${zone}`}</div>
    </div>
  )
}
