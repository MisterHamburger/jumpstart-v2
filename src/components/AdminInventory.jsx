import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function AdminInventory() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [zoneFilter, setZoneFilter] = useState('all')
  const [counts, setCounts] = useState({ total: 0, z1: 0, z2: 0, z3: 0, unassigned: 0 })

  useEffect(() => { loadCounts() }, [])
  useEffect(() => { loadItems() }, [search, zoneFilter])

  async function loadCounts() {
    const { count: total } = await supabase.from('items').select('id', { count: 'exact', head: true })
    const { count: z1 } = await supabase.from('items').select('id', { count: 'exact', head: true }).eq('zone', 1)
    const { count: z2 } = await supabase.from('items').select('id', { count: 'exact', head: true }).eq('zone', 2)
    const { count: z3 } = await supabase.from('items').select('id', { count: 'exact', head: true }).eq('zone', 3)
    setCounts({ total: total || 0, z1: z1 || 0, z2: z2 || 0, z3: z3 || 0, unassigned: (total || 0) - (z1 || 0) - (z2 || 0) - (z3 || 0) })
  }

  async function loadItems() {
    setLoading(true)
    let query = supabase.from('items')
      .select('barcode, description, category, size, color, msrp, cost, zone, bundle_number, load_id')
      .order('msrp', { ascending: false })
      .limit(100)

    if (zoneFilter !== 'all') query = query.eq('zone', parseInt(zoneFilter))
    if (search) query = query.or(`description.ilike.%${search}%,barcode.ilike.%${search}%,category.ilike.%${search}%`)

    const { data } = await query
    setItems(data || [])
    setLoading(false)
  }

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">Inventory</h2>

      {/* Zone counts */}
      <div className="grid grid-cols-5 gap-2 mb-4">
        {[
          { label: 'All', value: counts.total, filter: 'all' },
          { label: 'Zone 1', value: counts.z1, filter: '1' },
          { label: 'Zone 2', value: counts.z2, filter: '2' },
          { label: 'Zone 3', value: counts.z3, filter: '3' },
          { label: 'None', value: counts.unassigned, filter: 'none' },
        ].map(z => (
          <button key={z.filter} onClick={() => setZoneFilter(z.filter)}
            className={`p-2 rounded-lg text-center text-sm transition-colors
              ${zoneFilter === z.filter ? 'bg-slate-700 text-white' : 'bg-slate-800 text-slate-400'}`}>
            <div className="font-bold">{z.value.toLocaleString()}</div>
            <div className="text-xs">{z.label}</div>
          </button>
        ))}
      </div>

      {/* Search */}
      <input placeholder="Search barcode, description, category..."
        value={search} onChange={e => setSearch(e.target.value)}
        className="w-full bg-slate-800 rounded-lg px-4 py-2.5 mb-4 text-sm" />

      {/* Items table */}
      {loading ? (
        <div className="text-slate-400 py-8 text-center">Loading...</div>
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
                <th className="text-left py-2 px-2">Size</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={i} className="border-b border-slate-800 hover:bg-slate-800/50">
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
                  <td className="py-2 px-2 text-slate-400">{item.size}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {items.length >= 100 && (
            <p className="text-xs text-slate-500 text-center py-2">Showing first 100 results. Narrow your search for more.</p>
          )}
        </div>
      )}
    </div>
  )
}
