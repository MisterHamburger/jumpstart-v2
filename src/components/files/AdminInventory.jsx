import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function AdminInventory() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [zoneFilter, setZoneFilter] = useState('all')
  const [loadFilter, setLoadFilter] = useState('all')
  const [stats, setStats] = useState({
    total: 0,
    sold: 0,
    remaining: 0,
    zones: { z1: 0, z2: 0, z3: 0, unassigned: 0 },
    loads: []
  })

  useEffect(() => { loadStats() }, [])
  useEffect(() => { loadItems() }, [search, zoneFilter, loadFilter])

  async function loadStats() {
    // Total inventory
    const { count: total } = await supabase
      .from('jumpstart_manifest')
      .select('id', { count: 'exact', head: true })

    // Sold items (valid show_items)
    const { count: sold } = await supabase
      .from('show_items')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'valid')

    // Zone counts
    const { count: z1 } = await supabase.from('jumpstart_manifest').select('id', { count: 'exact', head: true }).eq('zone', 1)
    const { count: z2 } = await supabase.from('jumpstart_manifest').select('id', { count: 'exact', head: true }).eq('zone', 2)
    const { count: z3 } = await supabase.from('jumpstart_manifest').select('id', { count: 'exact', head: true }).eq('zone', 3)
    const unassigned = (total || 0) - (z1 || 0) - (z2 || 0) - (z3 || 0)

    // Load breakdown with costs
    const { data: loadData } = await supabase
      .from('jumpstart_manifest')
      .select('load_id, cost')
    
    const loadMap = {}
    for (const item of (loadData || [])) {
      const lid = item.load_id || 'Unknown'
      if (!loadMap[lid]) loadMap[lid] = { count: 0, cost: 0 }
      loadMap[lid].count++
      loadMap[lid].cost += Number(item.cost) || 0
    }

    const loads = Object.entries(loadMap).map(([id, data]) => ({
      id,
      count: data.count,
      cost: data.cost
    })).sort((a, b) => a.id.localeCompare(b.id))

    setStats({
      total: total || 0,
      sold: sold || 0,
      remaining: (total || 0) - (sold || 0),
      zones: { z1: z1 || 0, z2: z2 || 0, z3: z3 || 0, unassigned },
      loads
    })
  }

  async function loadItems() {
    setLoading(true)
    let query = supabase.from('jumpstart_manifest')
      .select('barcode, description, category, size, color, msrp, cost, zone, bundle_number, load_id')
      .order('msrp', { ascending: false })
      .limit(100)

    if (zoneFilter === 'none') {
      query = query.is('zone', null)
    } else if (zoneFilter !== 'all') {
      query = query.eq('zone', parseInt(zoneFilter))
    }
    
    if (loadFilter !== 'all') {
      query = query.eq('load_id', loadFilter)
    }
    
    if (search) {
      query = query.or(`description.ilike.%${search}%,barcode.ilike.%${search}%,category.ilike.%${search}%`)
    }

    const { data } = await query
    setItems(data || [])
    setLoading(false)
  }

  const soldPercent = stats.total > 0 ? ((stats.sold / stats.total) * 100).toFixed(1) : 0

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Inventory</h2>

      {/* Top KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard 
          label="Total Items" 
          value={stats.total.toLocaleString()} 
          subtext="All inventory"
        />
        <KPICard 
          label="Sold" 
          value={stats.sold.toLocaleString()} 
          subtext={`${soldPercent}% of total`}
          color="text-green-400"
        />
        <KPICard 
          label="Remaining" 
          value={stats.remaining.toLocaleString()} 
          subtext="In stock"
          color="text-cyan-400"
        />
        <KPICard 
          label="Avg Cost" 
          value={`$${stats.total > 0 ? (stats.loads.reduce((sum, l) => sum + l.cost, 0) / stats.total).toFixed(2) : '0.00'}`} 
          subtext="Per item"
        />
      </div>

      {/* Progress Bar */}
      <div className="glass-card p-4">
        <div className="flex justify-between text-sm mb-2">
          <span className="text-slate-400">Inventory Status</span>
          <span className="text-white font-medium">{soldPercent}% sold</span>
        </div>
        <div className="h-4 bg-slate-700 rounded-full overflow-hidden">
          <div 
            className="h-full bg-gradient-to-r from-green-500 to-emerald-400 rounded-full transition-all duration-500"
            style={{ width: `${soldPercent}%` }}
          />
        </div>
        <div className="flex justify-between text-xs mt-2 text-slate-500">
          <span>{stats.sold.toLocaleString()} sold</span>
          <span>{stats.remaining.toLocaleString()} remaining</span>
        </div>
      </div>

      {/* By Load */}
      <div className="glass-card p-4">
        <h3 className="font-bold mb-3">By Load</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {stats.loads.map(load => (
            <div 
              key={load.id} 
              onClick={() => setLoadFilter(loadFilter === load.id ? 'all' : load.id)}
              className={`p-4 rounded-xl cursor-pointer transition-all ${
                loadFilter === load.id 
                  ? 'bg-cyan-600/30 border border-cyan-500/50' 
                  : 'bg-slate-800/50 hover:bg-slate-700/50 border border-transparent'
              }`}
            >
              <div className="flex justify-between items-start mb-2">
                <span className="font-medium">Load {load.id}</span>
                <span className="text-sm text-slate-400">{load.count.toLocaleString()} items</span>
              </div>
              <div className="text-xs text-slate-500">
                Cost: ${load.cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
          ))}
        </div>
        {loadFilter !== 'all' && (
          <button 
            onClick={() => setLoadFilter('all')}
            className="mt-3 text-xs text-cyan-400 hover:text-cyan-300"
          >
            ✕ Clear load filter
          </button>
        )}
      </div>

      {/* By Zone */}
      <div className="glass-card p-4">
        <h3 className="font-bold mb-3">By Zone</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {[
            { label: 'Zone 1', value: stats.zones.z1, filter: '1', color: 'bg-purple-600', desc: 'Premium' },
            { label: 'Zone 2', value: stats.zones.z2, filter: '2', color: 'bg-teal-600', desc: 'Standard' },
            { label: 'Zone 3', value: stats.zones.z3, filter: '3', color: 'bg-pink-600', desc: 'Value' },
            { label: 'Unassigned', value: stats.zones.unassigned, filter: 'none', color: 'bg-slate-600', desc: 'Pending' },
          ].map(z => (
            <button 
              key={z.filter} 
              onClick={() => setZoneFilter(zoneFilter === z.filter ? 'all' : z.filter)}
              className={`p-3 rounded-xl text-center transition-all ${
                zoneFilter === z.filter 
                  ? `${z.color} text-white shadow-lg` 
                  : 'bg-slate-800/50 hover:bg-slate-700/50'
              }`}
            >
              <div className="text-xl font-bold">{z.value.toLocaleString()}</div>
              <div className="text-xs opacity-70">{z.label}</div>
            </button>
          ))}
        </div>
        {zoneFilter !== 'all' && (
          <button 
            onClick={() => setZoneFilter('all')}
            className="mt-3 text-xs text-cyan-400 hover:text-cyan-300"
          >
            ✕ Clear zone filter
          </button>
        )}
      </div>

      {/* Search & Items Table */}
      <div className="glass-card p-4">
        <div className="flex items-center gap-3 mb-4">
          <input 
            placeholder="Search barcode, description, category..."
            value={search} 
            onChange={e => setSearch(e.target.value)}
            className="flex-1 bg-slate-800 rounded-lg px-4 py-2.5 text-sm border border-slate-700 focus:border-cyan-500 focus:outline-none transition-colors" 
          />
          {search && (
            <button 
              onClick={() => setSearch('')}
              className="text-xs text-slate-400 hover:text-white"
            >
              Clear
            </button>
          )}
        </div>

        {loading ? (
          <div className="text-slate-400 py-8 text-center">Loading...</div>
        ) : items.length === 0 ? (
          <div className="text-slate-400 py-8 text-center">No items found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-400 text-xs border-b border-slate-700">
                  <th className="text-left py-2 px-2">Description</th>
                  <th className="text-left py-2 px-2">Category</th>
                  <th className="text-right py-2 px-2">MSRP</th>
                  <th className="text-right py-2 px-2">Cost</th>
                  <th className="text-center py-2 px-2">Zone</th>
                  <th className="text-center py-2 px-2">Load</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={i} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                    <td className="py-2 px-2 max-w-[200px] truncate">{item.description}</td>
                    <td className="py-2 px-2 text-slate-400">{item.category}</td>
                    <td className="py-2 px-2 text-right">${Number(item.msrp || 0).toFixed(2)}</td>
                    <td className="py-2 px-2 text-right">${Number(item.cost || 0).toFixed(2)}</td>
                    <td className="py-2 px-2 text-center">
                      <span className={`inline-block w-6 h-6 rounded text-xs font-bold leading-6 text-center
                        ${item.zone === 1 ? 'bg-purple-600' : item.zone === 2 ? 'bg-teal-600' : item.zone === 3 ? 'bg-pink-600' : 'bg-slate-600'}`}>
                        {item.zone || '—'}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-center text-slate-400">{item.load_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {items.length >= 100 && (
              <p className="text-xs text-slate-500 text-center py-3">
                Showing first 100 results. Narrow your search for more.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function KPICard({ label, value, subtext, color = 'text-white' }) {
  return (
    <div className="glass-card p-4">
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      {subtext && <div className="text-xs text-slate-500 mt-1">{subtext}</div>}
    </div>
  )
}
