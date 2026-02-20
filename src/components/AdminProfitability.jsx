import { useState, useEffect, Fragment, useMemo } from 'react'
import { supabase } from '../lib/supabase'

function formatShowName(name) {
  if (!name) return 'All Shows'
  const match = name.match(/(\d{4})-(\d{2})-(\d{2})-(\w+)-(\w+)/)
  if (!match) return name
  const [, year, month, day, channel, time] = match
  const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${monthNames[parseInt(month)]} ${parseInt(day)} ${time.charAt(0).toUpperCase() + time.slice(1)}`
}

function formatShowNameFull(name) {
  if (!name) return 'All Shows'
  const match = name.match(/(\d{4})-(\d{2})-(\d{2})-(\w+)-(\w+)/)
  if (!match) return name
  const [, year, month, day, channel, time] = match
  const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${monthNames[parseInt(month)]} ${parseInt(day)} - ${channel} ${time.charAt(0).toUpperCase() + time.slice(1)}`
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
  const [allShows, setAllShows] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState('profit_desc')
  const [channel, setChannel] = useState('all')
  const [selectedShow, setSelectedShow] = useState('all')
  const [page, setPage] = useState(0)
  const [expanded, setExpanded] = useState(null)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const PAGE_SIZE = 100

  useEffect(() => {
    async function loadShows() {
      const { data } = await supabase.from('profitability').select('show_name, channel')
      if (data) {
        const uniqueShows = [...new Set(data.map(d => JSON.stringify({ show_name: d.show_name, channel: d.channel })))]
          .map(s => JSON.parse(s))
          .filter(s => s.show_name)
          .sort((a, b) => b.show_name.localeCompare(a.show_name))
        setAllShows(uniqueShows)
      }
    }
    loadShows()
  }, [])

  const filteredShows = useMemo(() => {
    if (channel === 'all') return allShows
    return allShows.filter(s => s.channel === channel)
  }, [allShows, channel])

  useEffect(() => {
    if (selectedShow !== 'all') {
      const showExists = filteredShows.some(s => s.show_name === selectedShow)
      if (!showExists) setSelectedShow('all')
    }
  }, [channel, filteredShows, selectedShow])

  useEffect(() => { loadItems() }, [search, sortKey, channel, selectedShow, page, dateFrom, dateTo])

  async function loadItems() {
    setLoading(true)
    const opt = SORT_OPTIONS.find(o => o.value === sortKey)
    let query = supabase.from('profitability').select('*').order(opt.field, { ascending: opt.dir }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
    if (channel !== 'all') query = query.eq('channel', channel)
    if (selectedShow !== 'all') query = query.eq('show_name', selectedShow)
    if (search) query = query.or(`description.ilike.%${search}%,barcode.ilike.%${search}%,category.ilike.%${search}%,product_name.ilike.%${search}%`)
    if (dateFrom) query = query.gte('show_name', dateFrom)
    if (dateTo) query = query.lte('show_name', dateTo + '-z')
    const { data } = await query
    setItems(data || [])
    setLoading(false)
  }

  const [fullSummary, setFullSummary] = useState(null)
  useEffect(() => {
    async function loadFullSummary() {
      let query = supabase.from('profitability').select('profit, net_payout, original_hammer, show_name')
      if (channel !== 'all') query = query.eq('channel', channel)
      if (selectedShow !== 'all') query = query.eq('show_name', selectedShow)
      if (search) query = query.or(`description.ilike.%${search}%,barcode.ilike.%${search}%,category.ilike.%${search}%,product_name.ilike.%${search}%`)
      if (dateFrom) query = query.gte('show_name', dateFrom)
      if (dateTo) query = query.lte('show_name', dateTo + '-z')
      const { data } = await query
      if (data && data.length > 0) {
        const totalProfit = data.reduce((sum, item) => sum + Number(item.profit || 0), 0)
        const totalRevenue = data.reduce((sum, item) => sum + Number(item.net_payout || 0), 0)
        const totalHammer = data.reduce((sum, item) => sum + Number(item.original_hammer || 0), 0)
        const count = data.length
        setFullSummary({
          items_sold: count,
          total_profit: totalProfit,
          total_net_revenue: totalRevenue,
          avg_hammer: count ? totalHammer / count : 0,
          avg_net: count ? totalRevenue / count : 0,
          avg_profit_per_item: count ? totalProfit / count : 0,
          avg_margin: totalRevenue > 0 ? (totalProfit / totalRevenue * 100) : 0,
        })
      } else {
        setFullSummary(null)
      }
    }
    loadFullSummary()
  }, [channel, selectedShow, search, dateFrom, dateTo])

  const s = fullSummary

  // Styled dropdown classes
  const dropdownStyles = `
    relative bg-[#131a2b]
    border-l-2 border-l-purple-500/50 border-t border-r border-b border-white/[0.08]
    rounded-xl px-4 py-3 text-sm text-white 
    focus:outline-none focus:border-l-purple-400 focus:border-purple-500/30
    transition-all duration-200 cursor-pointer
    shadow-[0_4px_12px_rgba(0,0,0,0.3)]
    hover:shadow-[0_6px_16px_rgba(0,0,0,0.4)]
    hover:border-l-purple-400 hover:bg-[#1a2235]
    appearance-none
  `

  const dropdownArrow = {
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%238b5cf6'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 12px center',
    backgroundSize: '16px',
    paddingRight: '44px'
  }

  return (
    <div className="min-h-screen">
      {/* Header row */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-extrabold tracking-tight text-white">Profitability</h2>
        {/* Channel tabs */}
        <div className="relative p-[1px] rounded-2xl bg-gradient-to-r from-purple-500/60 via-fuchsia-500/60 to-cyan-500/60 shadow-lg shadow-purple-500/10">
          <div className="flex gap-1 bg-[#080c14] rounded-2xl p-1.5">
            {['all', 'Jumpstart', 'Kickstart'].map(c => (
              <button 
                key={c} 
                onClick={() => { setChannel(c); setPage(0) }}
                className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
                  channel === c 
                    ? 'bg-gradient-to-r from-purple-600 via-fuchsia-600 to-purple-600 text-white shadow-lg shadow-purple-500/30' 
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {c === 'all' ? 'All' : c}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Summary Section */}
      {s && (
        <div className="mb-6 space-y-4">
          {/* Hero Card */}
          <div className="relative overflow-hidden rounded-3xl shadow-2xl shadow-purple-900/20">
            {/* Gradient border */}
            <div className="absolute inset-0 bg-gradient-to-r from-purple-600 via-fuchsia-500 to-cyan-500 rounded-3xl" />
            
            {/* Inner card */}
            <div className="relative m-[1.5px] rounded-3xl bg-gradient-to-br from-[#1a1035] via-[#0f1629] to-[#0a1a2e] p-7">
              {/* Inner highlight - top edge */}
              <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
              
              {/* Glow orbs */}
              <div className="absolute top-0 right-1/4 w-80 h-80 bg-purple-600/25 rounded-full blur-[100px] pointer-events-none" />
              <div className="absolute bottom-0 left-1/4 w-80 h-80 bg-cyan-600/20 rounded-full blur-[100px] pointer-events-none" />
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-40 h-40 bg-fuchsia-500/15 rounded-full blur-[60px] pointer-events-none" />
              
              {/* Content */}
              <div className="relative flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-[0.25em] font-semibold text-purple-300/50 mb-3">Total Profit</div>
                  <div 
                    className={`text-5xl font-black tracking-tight ${Number(s.total_profit) >= 0 ? 'text-cyan-400' : 'text-pink-400'}`}
                    style={{ 
                      textShadow: Number(s.total_profit) >= 0 
                        ? '0 0 60px rgba(34, 211, 238, 0.5), 0 0 120px rgba(34, 211, 238, 0.25)' 
                        : '0 0 60px rgba(244, 114, 182, 0.5), 0 0 120px rgba(244, 114, 182, 0.25)'
                    }}
                  >
                    ${Number(s.total_profit).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs uppercase tracking-[0.25em] font-semibold text-cyan-300/50 mb-3">Items Sold</div>
                  <div 
                    className="text-5xl font-black text-white tracking-tight"
                    style={{ textShadow: '0 0 40px rgba(255, 255, 255, 0.15)' }}
                  >
                    {s.items_sold?.toLocaleString()}
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          {/* Stats Row */}
          <div className="grid grid-cols-5 gap-3">
            <GlassStatCard label="Avg Hammer" value={`$${Number(s.avg_hammer).toFixed(2)}`} accent="slate" />
            <GlassStatCard label="Net Revenue" value={`$${Number(s.total_net_revenue).toLocaleString(undefined, {maximumFractionDigits: 0})}`} accent="purple" />
            <GlassStatCard label="Net / Item" value={`$${Number(s.avg_net || 0).toFixed(2)}`} accent="fuchsia" />
            <GlassStatCard label="Profit / Item" value={`$${Number(s.avg_profit_per_item).toFixed(2)}`} accent="cyan" positive={Number(s.avg_profit_per_item) >= 0} />
            <GlassStatCard label="Margin" value={`${Number(s.avg_margin).toFixed(1)}%`} accent="cyan" positive={Number(s.avg_margin) >= 0} />
          </div>
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex gap-3 mb-5 items-center flex-wrap">
        {/* Search Input */}
        <div className="relative flex-1 min-w-[240px] group">
          <div className="absolute inset-0 bg-gradient-to-r from-purple-500/20 to-cyan-500/20 rounded-xl blur-sm opacity-0 group-focus-within:opacity-100 transition-opacity" />
          <div className="relative flex items-center bg-[#131a2b] border-l-2 border-l-cyan-500/50 border-t border-r border-b border-white/[0.08] rounded-xl shadow-[0_4px_12px_rgba(0,0,0,0.3)] group-focus-within:border-l-cyan-400 group-focus-within:border-cyan-500/30 group-focus-within:bg-[#1a2235] transition-all">
            <svg className="ml-4 w-4 h-4 text-slate-500 group-focus-within:text-cyan-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input 
              placeholder="Search barcode, description, category..." 
              value={search} 
              onChange={e => { setSearch(e.target.value); setPage(0) }} 
              className="flex-1 bg-transparent px-3 py-3 text-sm text-white placeholder-slate-500 focus:outline-none" 
            />
          </div>
        </div>

        {/* Show Dropdown */}
        <select 
          value={selectedShow} 
          onChange={e => { setSelectedShow(e.target.value); setPage(0) }}
          className={dropdownStyles}
          style={{ ...dropdownArrow, minWidth: '170px' }}
        >
          <option value="all">All Shows</option>
          {filteredShows.map(show => (
            <option key={show.show_name} value={show.show_name}>{formatShowNameFull(show.show_name)}</option>
          ))}
        </select>

        {/* Date Range */}
        <div className="flex items-center bg-[#131a2b] border-l-2 border-l-fuchsia-500/50 border-t border-r border-b border-white/[0.08] rounded-xl px-4 py-2 shadow-[0_4px_12px_rgba(0,0,0,0.3)] hover:border-l-fuchsia-400 hover:bg-[#1a2235] transition-all">
          <input
            type="date"
            value={dateFrom}
            onChange={e => { setDateFrom(e.target.value); setPage(0) }}
            className="bg-transparent text-sm text-white focus:outline-none [color-scheme:dark] w-[115px]"
          />
          <svg className="mx-2 w-4 h-4 text-fuchsia-400/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
          </svg>
          <input
            type="date"
            value={dateTo}
            onChange={e => { setDateTo(e.target.value); setPage(0) }}
            className="bg-transparent text-sm text-white focus:outline-none [color-scheme:dark] w-[115px]"
          />
        </div>

        {/* Sort Dropdown */}
        <select 
          value={sortKey} 
          onChange={e => { setSortKey(e.target.value); setPage(0) }} 
          className={dropdownStyles}
          style={{ ...dropdownArrow, minWidth: '160px' }}
        >
          {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {/* Active Filters */}
      {(selectedShow !== 'all' || search || dateFrom || dateTo) && (
        <div className="flex gap-2 mb-5 flex-wrap">
          {selectedShow !== 'all' && (
            <FilterPill color="purple" onClear={() => setSelectedShow('all')}>
              {formatShowName(selectedShow)}
            </FilterPill>
          )}
          {(dateFrom || dateTo) && (
            <FilterPill color="fuchsia" onClear={() => { setDateFrom(''); setDateTo('') }}>
              {dateFrom || '...'} → {dateTo || '...'}
            </FilterPill>
          )}
          {search && (
            <FilterPill color="cyan" onClear={() => setSearch('')}>
              "{search}"
            </FilterPill>
          )}
        </div>
      )}

      {/* Data Table */}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="relative">
            <div className="w-12 h-12 border-2 border-purple-500/20 rounded-full" />
            <div className="absolute inset-0 w-12 h-12 border-2 border-transparent border-t-purple-500 rounded-full animate-spin" />
          </div>
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-24 text-slate-500">No data found</div>
      ) : (
        <>
          {/* Table */}
          <div className="relative rounded-2xl overflow-hidden shadow-xl shadow-black/20">
            {/* Gradient border effect */}
            <div className="absolute inset-0 bg-gradient-to-b from-purple-500/30 via-transparent to-cyan-500/20 rounded-2xl pointer-events-none" />
            
            <div className="relative bg-gradient-to-b from-[#0d1320] to-[#080c14] border border-white/[0.06] rounded-2xl overflow-hidden">
              {/* Inner highlight */}
              <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
              
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.08]">
                    <th className="text-left py-4 px-6 text-[11px] uppercase tracking-wider font-semibold text-slate-400 bg-white/[0.02]">Description</th>
                    <th className="text-right py-4 px-6 text-[11px] uppercase tracking-wider font-semibold text-slate-400 bg-white/[0.02]">Hammer</th>
                    <th className="text-right py-4 px-6 text-[11px] uppercase tracking-wider font-semibold text-slate-400 bg-white/[0.02]">Net</th>
                    <th className="text-right py-4 px-6 text-[11px] uppercase tracking-wider font-semibold text-slate-400 bg-white/[0.02]">Cost</th>
                    <th className="text-right py-4 px-6 text-[11px] uppercase tracking-wider font-semibold text-slate-400 bg-white/[0.02]">Profit</th>
                    <th className="text-right py-4 px-6 text-[11px] uppercase tracking-wider font-semibold text-slate-400 bg-white/[0.02]">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, i) => {
                    const isExp = expanded === i
                    const profitNum = Number(item.profit)
                    const marginNum = Number(item.margin)
                    return (
                      <Fragment key={i}>
                        <tr 
                          onClick={() => setExpanded(isExp ? null : i)} 
                          className={`
                            cursor-pointer transition-all duration-200 border-b border-white/[0.04]
                            hover:bg-gradient-to-r hover:from-purple-600/10 hover:via-purple-600/5 hover:to-transparent
                            ${isExp ? 'bg-gradient-to-r from-purple-600/15 via-purple-600/10 to-transparent' : ''}
                          `}
                        >
                          <td className="py-4 px-6 max-w-[300px] truncate text-white font-medium">{item.description || item.product_name}</td>
                          <td className="py-4 px-6 text-right text-slate-300 font-medium">${Number(item.original_hammer).toFixed(2)}</td>
                          <td className="py-4 px-6 text-right text-slate-300">${Number(item.net_payout).toFixed(2)}</td>
                          <td className="py-4 px-6 text-right text-slate-500">${Number(item.cost_freight || 0).toFixed(2)}</td>
                          <td className={`py-4 px-6 text-right font-bold ${profitNum >= 0 ? 'text-cyan-400' : 'text-pink-400'}`}>
                            ${profitNum.toFixed(2)}
                          </td>
                          <td className={`py-4 px-6 text-right font-semibold ${marginNum >= 0 ? 'text-cyan-400' : 'text-pink-400'}`}>
                            {marginNum.toFixed(1)}%
                          </td>
                        </tr>
                        {isExp && (
                          <tr className="bg-gradient-to-r from-[#12061f] via-[#0a0e17] to-[#0a0e17]">
                            <td colSpan={6} className="px-6 py-5">
                              <div className="flex gap-8 text-xs flex-wrap items-center">
                                <DetailChip label="Barcode" value={item.barcode} mono />
                                <DetailChip label="Listing" value={`#${item.listing_number}`} highlight />
                                <DetailChip label="Show" value={formatShowNameFull(item.show_name)} />
                                {item.category && <DetailChip label="Category" value={item.category} />}
                                <DetailChip label="Coupon" value={Number(item.coupon_amount) > 0 ? `-$${Number(item.coupon_amount).toFixed(2)}` : '—'} dim={!Number(item.coupon_amount)} />
                                <DetailChip label="Fees" value={`-$${Number(item.total_fees).toFixed(2)}`} />
                                {item.msrp && <DetailChip label="MSRP" value={`$${Number(item.msrp).toFixed(0)}`} />}
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
          </div>
          
          {/* Pagination */}
          <div className="flex items-center justify-between mt-6 text-sm">
            <button 
              onClick={() => setPage(p => Math.max(0, p - 1))} 
              disabled={page === 0} 
              className={`px-5 py-2.5 rounded-xl font-medium transition-all duration-200 ${
                page === 0 
                  ? 'text-slate-600 cursor-not-allowed' 
                  : 'text-slate-300 hover:text-white bg-white/[0.02] hover:bg-white/[0.06] border border-white/[0.06] hover:border-white/[0.12]'
              }`}
            >
              ← Previous
            </button>
            <span className="text-slate-400">
              Page <span className="text-white font-bold">{page + 1}</span>
              {s && <span className="text-slate-600"> · Showing {items.length} of {s.items_sold}</span>}
            </span>
            <button 
              onClick={() => setPage(p => p + 1)} 
              disabled={items.length < PAGE_SIZE} 
              className={`px-5 py-2.5 rounded-xl font-medium transition-all duration-200 ${
                items.length < PAGE_SIZE 
                  ? 'text-slate-600 cursor-not-allowed' 
                  : 'text-slate-300 hover:text-white bg-white/[0.02] hover:bg-white/[0.06] border border-white/[0.06] hover:border-white/[0.12]'
              }`}
            >
              Next →
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function GlassStatCard({ label, value, accent, positive }) {
  const accentColors = {
    slate: 'from-slate-500/10',
    purple: 'from-purple-500/15',
    fuchsia: 'from-fuchsia-500/10',
    cyan: 'from-cyan-500/15',
  }
  const borderColors = {
    slate: 'border-l-slate-500/30',
    purple: 'border-l-purple-500/50',
    fuchsia: 'border-l-fuchsia-500/40',
    cyan: 'border-l-cyan-500/50',
  }
  
  const valueColor = positive === false ? 'text-pink-400' : positive === true ? 'text-cyan-400' : 'text-white'
  
  return (
    <div className={`
      relative overflow-hidden rounded-xl 
      bg-gradient-to-br ${accentColors[accent]} to-[#0a0e17]
      border-l-2 ${borderColors[accent]} border-t border-r border-b border-white/[0.06]
      p-4 shadow-lg shadow-black/20
    `}>
      {/* Inner highlight */}
      <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      
      <div className="relative">
        <div className="text-[10px] uppercase tracking-[0.2em] font-semibold text-slate-500 mb-1.5">{label}</div>
        <div className={`text-lg font-bold tracking-tight ${valueColor}`}>{value}</div>
      </div>
    </div>
  )
}

function FilterPill({ children, color, onClear }) {
  const colors = {
    purple: 'from-purple-500/25 to-purple-600/10 text-purple-300 border-purple-500/40',
    fuchsia: 'from-fuchsia-500/25 to-fuchsia-600/10 text-fuchsia-300 border-fuchsia-500/40',
    cyan: 'from-cyan-500/25 to-cyan-600/10 text-cyan-300 border-cyan-500/40',
  }
  
  return (
    <span className={`inline-flex items-center gap-2 bg-gradient-to-r ${colors[color]} px-3.5 py-1.5 rounded-full text-xs font-semibold border backdrop-blur-sm`}>
      {children}
      <button onClick={onClear} className="hover:text-white transition-colors text-base leading-none">×</button>
    </span>
  )
}

function DetailChip({ label, value, mono, highlight, dim }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-600">{label}</span>
      <span className={`
        font-medium px-2 py-0.5 rounded-md
        ${mono ? 'font-mono text-[11px] bg-slate-800/50' : ''} 
        ${highlight ? 'text-cyan-400 bg-cyan-500/10' : ''} 
        ${dim ? 'text-slate-600' : !highlight ? 'text-slate-300' : ''}
      `}>
        {value}
      </span>
    </div>
  )
}
