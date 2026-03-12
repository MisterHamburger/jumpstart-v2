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
    zones: { z1: 0, z1p: 0, z2: 0, z2p: 0, unassigned: 0 }
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
    
    // Get load summary from view + load details for brand info
    const { data: loadData } = await supabase.from('load_summary').select('*')
    const { data: loadsInfo } = await supabase.from('loads').select('id,vendor,notes')
    
    // Get zone counts (handles both old integer zones and new string zones)
    const { count: z1 } = await supabase.from('jumpstart_manifest').select('id', { count: 'exact', head: true }).or('zone.eq.1,zone.eq.Zone 1')
    const { count: z1p } = await supabase.from('jumpstart_manifest').select('id', { count: 'exact', head: true }).eq('zone', 'Zone 1 Pants')
    const { count: z2 } = await supabase.from('jumpstart_manifest').select('id', { count: 'exact', head: true }).or('zone.eq.2,zone.eq.Zone 2')
    const { count: z2p } = await supabase.from('jumpstart_manifest').select('id', { count: 'exact', head: true }).eq('zone', 'Zone 2 Pants')
    const { count: total } = await supabase.from('jumpstart_manifest').select('id', { count: 'exact', head: true })

    // Get sold count from show_items (Jumpstart only)
    const { data: jsShows } = await supabase.from('shows').select('id').eq('channel', 'Jumpstart')
    const jsShowIds = jsShows?.map(s => s.id) || []
    const { count: sold } = jsShowIds.length > 0
      ? await supabase.from('show_items').select('id', { count: 'exact', head: true }).eq('status', 'valid').in('show_id', jsShowIds)
      : { count: 0 }

    const totalItems = loadData?.reduce((sum, l) => sum + Number(l.item_count), 0) || 0
    const totalCost = loadData?.reduce((sum, l) => sum + Number(l.total_cost), 0) || 0
    const avgCost = totalItems > 0 ? totalCost / totalItems : 0

    const assigned = (z1 || 0) + (z1p || 0) + (z2 || 0) + (z2p || 0)
    setStats({
      total: totalItems,
      sold: sold || 0,
      remaining: totalItems - (sold || 0),
      avgCost,
      loads: (loadData || []).map(l => {
        const info = loadsInfo?.find(i => i.id === l.load_id)
        return { ...l, brand: info?.vendor || info?.notes || '' }
      }),
      zones: {
        z1: z1 || 0,
        z1p: z1p || 0,
        z2: z2 || 0,
        z2p: z2p || 0,
        unassigned: (total || 0) - assigned
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
    // Get all manifest items with cost and load (paginated)
    const manifestData = await fetchAllRows('jumpstart_manifest', 'barcode,cost_freight,load_id')
    const { data: loadsInfo } = await supabase.from('loads').select('id,vendor,notes')

    // Get all sold scans (paginated) — these have barcodes of items that were sold
    const soldData = await fetchAllRows('jumpstart_sold_scans', 'barcode')

    if (!manifestData || manifestData.length === 0) {
      setUnsoldStats({ totalUnsoldCost: 0, totalUnsoldCount: 0, avgUnsoldCost: 0, byLoad: [] })
      return
    }

    // Count how many times each barcode was sold
    const soldCounts = {}
    if (soldData) {
      soldData.forEach(row => {
        soldCounts[row.barcode] = (soldCounts[row.barcode] || 0) + 1
      })
    }

    // Walk through every manifest item, subtract sold counts
    // Since manifest has duplicate barcodes (multiple physical items), we process each row
    // and decrement the sold count as we "use up" sold units
    const soldUsed = {} // track how many sold we've accounted for per barcode
    const byLoadMap = {}
    let totalCost = 0
    let totalCount = 0

    manifestData.forEach(item => {
      const bc = item.barcode
      const used = soldUsed[bc] || 0
      const totalSold = soldCounts[bc] || 0

      if (used < totalSold) {
        // This item was sold — mark it used
        soldUsed[bc] = used + 1
      } else {
        // This item is unsold
        const cost = Number(item.cost_freight) || 0
        const loadId = item.load_id || 'Unknown'

        if (!byLoadMap[loadId]) {
          byLoadMap[loadId] = { load_id: loadId, unsoldCost: 0, unsoldCount: 0 }
        }
        byLoadMap[loadId].unsoldCost += cost
        byLoadMap[loadId].unsoldCount += 1
        totalCost += cost
        totalCount += 1
      }
    })

    const byLoad = Object.values(byLoadMap).map(load => {
      const info = loadsInfo?.find(i => i.id === load.load_id)
      return {
        ...load,
        brand: info?.vendor || info?.notes || '',
        avgCost: load.unsoldCount > 0 ? load.unsoldCost / load.unsoldCount : 0
      }
    })

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
    } else if (zoneFilter === '1') {
      query = query.or('zone.eq.1,zone.eq.Zone 1')
    } else if (zoneFilter === '1p') {
      query = query.eq('zone', 'Zone 1 Pants')
    } else if (zoneFilter === '2') {
      query = query.or('zone.eq.2,zone.eq.Zone 2')
    } else if (zoneFilter === '2p') {
      query = query.eq('zone', 'Zone 2 Pants')
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
          <span>{stats.remaining.toLocaleString()} remaining</span>
        </div>
      </div>

      {/* Inventory by Load */}
      <div className="glass-card rounded-3xl p-6">
          <h3 className="font-bold text-lg mb-4">Inventory by Load</h3>
        <div className="grid grid-cols-2 gap-4">
          {stats.loads.map(load => {
            const totalItems = Number(load.item_count)
            const avgCostLoad = Number(load.avg_cost || 0)
            return (
              <div key={load.load_id} className="rounded-xl bg-slate-800/30 border border-white/[0.04] p-4 hover:bg-slate-800/50 transition-colors">
                <div className="flex justify-between items-start mb-2">
                  <div className="font-semibold text-white">
                    Load {load.load_id.replace('Load ', '')}
                    {load.brand && <span className="text-slate-400 font-normal"> — {load.brand}</span>}
                  </div>
                  <div className="text-lg font-bold text-white">{totalItems.toLocaleString()}</div>
                </div>
                <div className="flex justify-between text-xs text-slate-400 mt-1">
                  <span>Total: ${Number(load.total_cost).toLocaleString(undefined, {maximumFractionDigits: 0})}</span>
                  <span>Avg: ${avgCostLoad.toFixed(2)}/item</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* By Zone */}
      <div className="glass-card rounded-3xl p-6">
          <h3 className="font-bold text-lg mb-4">By Zone</h3>
        <div className="grid grid-cols-5 gap-4">
          <ZoneCard label="Zone 1" count={stats.zones.z1} color="purple" />
          <ZoneCard label="Zone 1 Pants" count={stats.zones.z1p} color="amber" />
          <ZoneCard label="Zone 2" count={stats.zones.z2} color="teal" />
          <ZoneCard label="Zone 2 Pants" count={stats.zones.z2p} color="pink" />
          <ZoneCard label="Unassigned" count={stats.zones.unassigned} color="slate" />
        </div>
      </div>

      {/* Item List */}
      <div className="glass-card rounded-3xl p-6">
          <h3 className="font-bold text-lg mb-4">Item List</h3>
        
        {/* Filters */}
        <div className="flex gap-3 mb-4">
          <input 
            placeholder="Search barcode, description, category..."
            value={search} 
            onChange={e => setSearch(e.target.value)}
            className="flex-1 bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500/50 focus:ring-4 focus:ring-cyan-500/10 transition-all" 
          />
          <select 
            value={zoneFilter} 
            onChange={e => setZoneFilter(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-sm text-white appearance-none focus:outline-none focus:border-cyan-500/50 focus:ring-4 focus:ring-cyan-500/10 transition-all"
          >
            <option value="all">All Zones</option>
            <option value="1">Zone 1</option>
            <option value="1p">Zone 1 Pants</option>
            <option value="2">Zone 2</option>
            <option value="2p">Zone 2 Pants</option>
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
                    {(() => {
                      const z = String(item.zone || '').toLowerCase().trim()
                      let label = item.zone || '—'
                      let bg = 'bg-slate-600'
                      if (z === '1' || z === 'zone 1') { label = 'Zone 1'; bg = 'bg-purple-600' }
                      else if (z === 'zone 1 pants') { label = 'Z1 Pants'; bg = 'bg-amber-600' }
                      else if (z === '2' || z === 'zone 2') { label = 'Zone 2'; bg = 'bg-teal-600' }
                      else if (z === 'zone 2 pants') { label = 'Z2 Pants'; bg = 'bg-pink-600' }
                      else if (z === '3') { label = 'Zone 3'; bg = 'bg-fuchsia-600' }
                      return <span className={`inline-flex items-center justify-center px-2 h-7 rounded-lg text-xs font-bold text-white ${bg}`}>{label}</span>
                    })()}
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
    <div className="glass-card rounded-3xl p-5">
      <div className="text-[10px] uppercase tracking-[0.15em] font-semibold text-slate-500 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${accent === 'cyan' ? 'text-cyan-400' : accent === 'purple' ? 'text-purple-400' : 'text-white'}`}>
        {value}
      </div>
      <div className="text-xs text-slate-500 mt-1">{sub}</div>
    </div>
  )
}

function ZoneCard({ count, label, color }) {
  const colors = {
    purple: 'border-purple-500/30 text-purple-400',
    amber: 'border-amber-500/30 text-amber-400',
    teal: 'border-teal-500/30 text-teal-400',
    pink: 'border-pink-500/30 text-pink-400',
    slate: 'border-white/[0.04] text-slate-400'
  }
  return (
    <div className={`rounded-xl bg-slate-800/30 border ${colors[color] || colors.slate} p-4 text-center hover:bg-slate-800/50 transition-colors`}>
      <div className="text-2xl font-bold text-white mb-1">{count.toLocaleString()}</div>
      <div className={`text-sm ${colors[color]?.split(' ')[1] || 'text-slate-400'}`}>{label}</div>
    </div>
  )
}
