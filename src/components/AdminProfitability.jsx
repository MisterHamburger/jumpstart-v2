import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function AdminProfitability() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortField, setSortField] = useState('profit')
  const [sortDir, setSortDir] = useState('asc') // worst first by default
  const [channel, setChannel] = useState('all')
  const [summary, setSummary] = useState(null)

  useEffect(() => { loadData() }, [search, sortField, sortDir, channel])

  async function loadData() {
    setLoading(true)

    // Load from profitability view
    let query = supabase.from('profitability')
      .select('*')
      .order(sortField, { ascending: sortDir === 'asc' })
      .limit(200)

    if (channel !== 'all') query = query.eq('channel', channel)
    if (search) query = query.or(`description.ilike.%${search}%,barcode.ilike.%${search}%,category.ilike.%${search}%`)

    const { data, error } = await query
    if (data) {
      setItems(data)
      // Calculate summary
      const totalProfit = data.reduce((s, i) => s + Number(i.profit || 0), 0)
      const totalNet = data.reduce((s, i) => s + Number(i.net_payout || 0), 0)
      const totalHammer = data.reduce((s, i) => s + Number(i.original_hammer || 0), 0)
      setSummary({
        count: data.length,
        totalProfit,
        totalNet,
        avgProfit: data.length ? totalProfit / data.length : 0,
        avgMargin: totalNet ? (totalProfit / totalNet * 100) : 0,
        avgHammer: data.length ? totalHammer / data.length : 0,
      })
    }
    setLoading(false)
  }

  function toggleSort(field) {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('desc')
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">Profitability</h2>
        <div className="flex gap-2">
          {['all', 'Jumpstart', 'Kickstart'].map(c => (
            <button key={c} onClick={() => setChannel(c)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
                ${channel === c ? 'bg-slate-700 text-white' : 'text-slate-400 hover:bg-slate-700/50'}`}>
              {c === 'all' ? 'All' : c}
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-4">
          <SumCard label="Items" value={summary.count} />
          <SumCard label="Avg Hammer" value={`$${summary.avgHammer.toFixed(2)}`} />
          <SumCard label="Net Revenue" value={`$${summary.totalNet.toFixed(2)}`} />
          <SumCard label="Total Profit" value={`$${summary.totalProfit.toFixed(2)}`}
            color={summary.totalProfit >= 0 ? 'text-green-400' : 'text-red-400'} />
          <SumCard label="Profit/Item" value={`$${summary.avgProfit.toFixed(2)}`}
            color={summary.avgProfit >= 0 ? 'text-green-400' : 'text-red-400'} />
          <SumCard label="Margin" value={`${summary.avgMargin.toFixed(1)}%`}
            color={summary.avgMargin >= 0 ? 'text-green-400' : 'text-red-400'} />
        </div>
      )}

      {/* Search */}
      <input placeholder="Search barcode, description, category..."
        value={search} onChange={e => setSearch(e.target.value)}
        className="w-full bg-slate-800 rounded-lg px-4 py-2.5 mb-4 text-sm" />

      {loading ? (
        <div className="text-slate-400 py-8 text-center">Loading profitability data...</div>
      ) : items.length === 0 ? (
        <div className="text-slate-400 py-8 text-center">No profitability data yet. Scan items and upload show CSVs first.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400 border-b border-slate-700">
                <th className="text-left py-2 px-1">Listing</th>
                <th className="text-left py-2 px-1">Description</th>
                <th className="text-left py-2 px-1">Show</th>
                <th className="text-right py-2 px-1 cursor-pointer hover:text-white" onClick={() => toggleSort('original_hammer')}>
                  Hammer {sortField === 'original_hammer' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                </th>
                <th className="text-right py-2 px-1">Coupon</th>
                <th className="text-right py-2 px-1">Buyer Paid</th>
                <th className="text-right py-2 px-1">Fees</th>
                <th className="text-right py-2 px-1">Net</th>
                <th className="text-right py-2 px-1">Cost</th>
                <th className="text-right py-2 px-1 cursor-pointer hover:text-white" onClick={() => toggleSort('profit')}>
                  Profit {sortField === 'profit' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                </th>
                <th className="text-right py-2 px-1 cursor-pointer hover:text-white" onClick={() => toggleSort('margin')}>
                  Margin {sortField === 'margin' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={i} className="border-b border-slate-800/50 hover:bg-slate-800/50">
                  <td className="py-1.5 px-1">#{item.listing_number}</td>
                  <td className="py-1.5 px-1 max-w-[150px] truncate">{item.description}</td>
                  <td className="py-1.5 px-1 text-slate-400 max-w-[100px] truncate">{item.show_name}</td>
                  <td className="py-1.5 px-1 text-right">${Number(item.original_hammer).toFixed(2)}</td>
                  <td className="py-1.5 px-1 text-right text-slate-400">{Number(item.coupon_amount) > 0 ? `-$${Number(item.coupon_amount).toFixed(2)}` : '—'}</td>
                  <td className="py-1.5 px-1 text-right">${Number(item.buyer_paid).toFixed(2)}</td>
                  <td className="py-1.5 px-1 text-right text-slate-400">${Number(item.total_fees).toFixed(2)}</td>
                  <td className="py-1.5 px-1 text-right">${Number(item.net_payout).toFixed(2)}</td>
                  <td className="py-1.5 px-1 text-right">${Number(item.cost_freight || 0).toFixed(2)}</td>
                  <td className={`py-1.5 px-1 text-right font-medium ${Number(item.profit) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    ${Number(item.profit).toFixed(2)}
                  </td>
                  <td className={`py-1.5 px-1 text-right ${Number(item.margin) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {Number(item.margin).toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function SumCard({ label, value, color = 'text-white' }) {
  return (
    <div className="bg-slate-800 rounded-lg p-2.5">
      <div className="text-[10px] text-slate-400">{label}</div>
      <div className={`text-sm font-bold ${color}`}>{value}</div>
    </div>
  )
}
