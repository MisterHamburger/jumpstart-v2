import { useState, useEffect, Fragment } from 'react'
import { supabase } from '../lib/supabase'

function formatShowName(name) {
  if (!name) return ''
  const match = name.match(/(\d{4})-(\d{2})-(\d{2})-(\w+)-(\w+)/)
  if (!match) return name
  const [, , month, day, channel, time] = match
  return `${parseInt(month)}-${parseInt(day)}-26 ${channel} ${time.charAt(0).toUpperCase() + time.slice(1)}`
}

const SORT_OPTIONS = [
  { value: 'profit_desc', label: 'Highest Profit', field: 'profit', dir: false },
  { value: 'profit_asc', label: 'Lowest Profit', field: 'profit', dir: true },
  { value: 'margin_desc', label: 'Highest Margin %', field: 'margin', dir: false },
  { value: 'margin_asc', label: 'Lowest Margin %', field: 'margin', dir: true },
  { value: 'hammer_desc', label: 'Highest Hammer', field: 'original_hammer', dir: false },
  { value: 'hammer_asc', label: 'Lowest Hammer', field: 'original_hammer', dir: true },
]

export default function AdminProfitability() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState('profit_desc')
  const [channel, setChannel] = useState('all')
  const [summary, setSummary] = useState(null)
  const [page, setPage] = useState(0)
  const [expanded, setExpanded] = useState(null)
  const PAGE_SIZE = 100
  useEffect(() => { loadSummary() }, [channel])
  useEffect(() => { loadItems() }, [search, sortKey, channel, page])
  async function loadSummary() {
    if (channel === 'all') {
      const { data } = await supabase.from('dashboard_summary').select('*')
      if (data && data.length > 0) {
        const combined = data.reduce((acc, row) => ({
          items_sold: (acc.items_sold || 0) + (row.items_sold || 0),
          total_net_revenue: (acc.total_net_revenue || 0) + Number(row.total_net_revenue || 0),
          total_profit: (acc.total_profit || 0) + Number(row.total_profit || 0),
          avg_hammer: 0,
        }), {})
        combined.avg_hammer = combined.items_sold ? Number(data.reduce((s, r) => s + Number(r.avg_hammer || 0) * (r.items_sold || 0), 0)) / combined.items_sold : 0
        combined.avg_net = combined.items_sold ? combined.total_net_revenue / combined.items_sold : 0
        combined.avg_profit_per_item = combined.items_sold ? combined.total_profit / combined.items_sold : 0
        combined.avg_margin = combined.total_net_revenue > 0 ? (combined.total_profit / combined.total_net_revenue * 100) : 0
        setSummary(combined)
      }
    } else {
      const { data } = await supabase.from('dashboard_summary').select('*').eq('channel', channel)
      if (data && data.length > 0) {
        const row = data[0]
        setSummary({ items_sold: row.items_sold, avg_hammer: Number(row.avg_hammer), avg_net: Number(row.avg_net), total_net_revenue: Number(row.total_net_revenue), total_profit: Number(row.total_profit), avg_profit_per_item: Number(row.avg_profit_per_item), avg_margin: Number(row.avg_margin) })
      }
    }
  }
  async function loadItems() {
    setLoading(true)
    const opt = SORT_OPTIONS.find(o => o.value === sortKey)
    let query = supabase.from('profitability').select('*').order(opt.field, { ascending: opt.dir }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
    if (channel !== 'all') query = query.eq('channel', channel)
    if (search) query = query.or(`description.ilike.%${search}%,barcode.ilike.%${search}%,category.ilike.%${search}%,product_name.ilike.%${search}%`)
    const { data } = await query
    setItems(data || [])
    setLoading(false)
  }
  const s = summary
  return (
    <div className="min-h-screen">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold tracking-tight text-white">Item-Level Profitability</h2>
        <div className="flex gap-1 backdrop-blur-xl bg-white/5 rounded-full p-1 border border-white/10">
          {['all', 'Jumpstart', 'Kickstart'].map(c => (
            <button key={c} onClick={() => { setChannel(c); setPage(0) }}
              className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-all ${channel === c ? 'bg-gradient-to-r from-purple-500/90 via-purple-600/90 to-blue-600/90 text-white shadow-lg shadow-purple-500/30' : 'text-slate-400 hover:text-white hover:bg-white/10'}`}>
              {c === 'all' ? 'All' : c}
            </button>
          ))}
        </div>
      </div>
      {s && (
        <div className="grid grid-cols-4 md:grid-cols-7 gap-3 mb-6">
          <SumCard label="Items Sold" value={s.items_sold?.toLocaleString()} />
          <SumCard label="Hammer / Item" value={`$${Number(s.avg_hammer).toFixed(2)}`} />
          <SumCard label="Net / Item" value={`$${Number(s.avg_net || 0).toFixed(2)}`} />
          <SumCard label="Net Revenue" value={`$${Number(s.total_net_revenue).toLocaleString(undefined, {minimumFractionDigits: 2})}`} />
          <SumCard label="Profit" value={`$${Number(s.total_profit).toLocaleString(undefined, {minimumFractionDigits: 2})}`} color={Number(s.total_profit) >= 0 ? 'text-emerald-400' : 'text-red-400'} />
          <SumCard label="Profit / Item" value={`$${Number(s.avg_profit_per_item).toFixed(2)}`} color={Number(s.avg_profit_per_item) >= 0 ? 'text-emerald-400' : 'text-red-400'} />
          <SumCard label="Margin" value={`${Number(s.avg_margin).toFixed(1)}%`} color={Number(s.avg_margin) >= 0 ? 'text-emerald-400' : 'text-red-400'} />
        </div>
      )}
      <div className="flex gap-3 mb-5">
        <input placeholder="Search by barcode, description, or sticker #..." value={search} onChange={e => { setSearch(e.target.value); setPage(0) }} className="flex-1 bg-white/10 border border-white/20 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-purple-400/50 backdrop-blur-lg" />
        <select value={sortKey} onChange={e => { setSortKey(e.target.value); setPage(0) }} className="bg-white/10 border border-white/20 rounded-xl px-3 py-2.5 text-sm text-white min-w-[170px] backdrop-blur-lg focus:outline-none focus:border-purple-400/50">
          {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      {loading ? (<div className="text-slate-400 py-12 text-center">Loading...</div>) : items.length === 0 ? (<div className="text-slate-400 py-12 text-center">No profitability data found.</div>) : (
        <>
          <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-white/10 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left py-3 px-4 text-xs uppercase tracking-wider font-semibold text-slate-500">Description</th>
                  <th className="text-right py-3 px-4 text-xs uppercase tracking-wider font-semibold text-slate-500">Hammer</th>
                  <th className="text-right py-3 px-4 text-xs uppercase tracking-wider font-semibold text-slate-500">Coupon</th>
                  <th className="text-right py-3 px-4 text-xs uppercase tracking-wider font-semibold text-slate-500">Paid</th>
                  <th className="text-right py-3 px-4 text-xs uppercase tracking-wider font-semibold text-slate-500">Fees</th>
                  <th className="text-right py-3 px-4 text-xs uppercase tracking-wider font-semibold text-slate-500">Net</th>
                  <th className="text-right py-3 px-4 text-xs uppercase tracking-wider font-semibold text-slate-500">Cost</th>
                  <th className="text-right py-3 px-4 text-xs uppercase tracking-wider font-semibold text-slate-500">Profit</th>
                  <th className="text-right py-3 px-4 text-xs uppercase tracking-wider font-semibold text-slate-500">Margin</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => {
                  const isExp = expanded === i
                  const profitNum = Number(item.profit)
                  const marginNum = Number(item.margin)
                  return (
                    <Fragment key={i}>
                      <tr onClick={() => setExpanded(isExp ? null : i)} className={`cursor-pointer transition-all hover:bg-white/5 ${i % 2 === 0 ? 'bg-transparent' : 'bg-white/[0.02]'} ${isExp ? 'bg-white/10' : ''}`}>
                        <td className="py-3 px-4 max-w-[240px] truncate text-white">{item.description}</td>
                        <td className="py-3 px-4 text-right text-white">${Number(item.original_hammer).toFixed(2)}</td>
                        <td className="py-3 px-4 text-right">{Number(item.coupon_amount) > 0 ? <span className="text-amber-400">-${Number(item.coupon_amount).toFixed(2)}</span> : <span className="text-slate-600">{'\u2014'}</span>}</td>
                        <td className="py-3 px-4 text-right text-white">${Number(item.buyer_paid).toFixed(2)}</td>
                        <td className="py-3 px-4 text-right text-slate-400">-${Number(item.total_fees).toFixed(2)}</td>
                        <td className="py-3 px-4 text-right text-white">${Number(item.net_payout).toFixed(2)}</td>
                        <td className="py-3 px-4 text-right text-slate-300">${Number(item.cost_freight || 0).toFixed(2)}</td>
                        <td className={`py-3 px-4 text-right font-bold ${profitNum >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>${profitNum.toFixed(2)}</td>
                        <td className={`py-3 px-4 text-right font-medium ${marginNum >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{marginNum.toFixed(1)}%</td>
                      </tr>
                      {isExp && (
                        <tr>
                          <td colSpan={9} className="px-4 py-0">
                            <div className="bg-gradient-to-r from-purple-500/10 via-blue-500/10 to-cyan-500/10 border border-white/10 rounded-xl px-5 py-3 my-2">
                              <div className="flex gap-8 text-xs">
                                <div><span className="text-xs uppercase tracking-wider font-semibold text-slate-500 mr-1">ID</span><span className="font-mono font-medium text-white">{item.barcode}</span></div>
                                <div><span className="text-xs uppercase tracking-wider font-semibold text-slate-500 mr-1">Listing</span><span className="font-bold text-cyan-300">#{item.listing_number}</span></div>
                                <div><span className="text-xs uppercase tracking-wider font-semibold text-slate-500 mr-1">Show</span><span className="text-white">{formatShowName(item.show_name)}</span></div>
                                {item.category && <div><span className="text-xs uppercase tracking-wider font-semibold text-slate-500 mr-1">Category</span><span className="text-white">{item.category}</span></div>}
                                {item.msrp && <div><span className="text-xs uppercase tracking-wider font-semibold text-slate-500 mr-1">MSRP</span><span className="text-white">${Number(item.msrp).toFixed(0)}</span></div>}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between mt-5">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className={`px-5 py-2 rounded-full text-sm font-semibold transition-all ${page === 0 ? 'text-slate-600' : 'bg-white/10 border border-white/20 text-white hover:bg-white/20 active:scale-[0.98]'}`}>Prev</button>
            <span className="text-sm text-slate-400">Page <span className="font-bold text-cyan-300">{page + 1}</span> of {Math.ceil((s?.items_sold || 0) / PAGE_SIZE)}</span>
            <button onClick={() => setPage(p => p + 1)} disabled={items.length < PAGE_SIZE} className={`px-5 py-2 rounded-full text-sm font-semibold transition-all ${items.length < PAGE_SIZE ? 'text-slate-600' : 'bg-white/10 border border-white/20 text-white hover:bg-white/20 active:scale-[0.98]'}`}>Next</button>
          </div>
        </>
      )}
    </div>
  )
}
function SumCard({ label, value, color = 'text-white' }) {
  return (
    <div className="backdrop-blur-xl bg-white/5 rounded-2xl p-3 border border-white/10">
      <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">{label}</div>
      <div className={`text-sm font-bold ${color}`}>{value}</div>
    </div>
  )
}
