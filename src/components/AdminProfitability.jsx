import { useState, useEffect, Fragment, useMemo } from 'react'
import { supabase } from '../lib/supabase'

function formatShowName(name) {
  if (!name) return 'All Shows'
  // New format: 02-19-2026-Jumpstart-Bri
  const newMatch = name.match(/^(\d{2})-(\d{2})-(\d{4})-(\w+)-(\w+)$/)
  if (newMatch) {
    const [, month, day, year, channel, streamer] = newMatch
    const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    return `${monthNames[parseInt(month)]} ${parseInt(day)} - ${streamer}`
  }
  // Old format: 2026-02-19-Jumpstart-evening
  const oldMatch = name.match(/(\d{4})-(\d{2})-(\d{2})-(\w+)-(\w+)/)
  if (oldMatch) {
    const [, year, month, day, channel, time] = oldMatch
    const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    return `${monthNames[parseInt(month)]} ${parseInt(day)} - ${time.charAt(0).toUpperCase() + time.slice(1)}`
  }
  return name
}

function formatShowNameFull(name) {
  if (!name) return 'All Shows'
  // New format: 02-19-2026-Jumpstart-Bri
  const newMatch = name.match(/^(\d{2})-(\d{2})-(\d{4})-(\w+)-(\w+)$/)
  if (newMatch) {
    const [, month, day, year, channel, streamer] = newMatch
    const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    return `${monthNames[parseInt(month)]} ${parseInt(day)} - ${channel} - ${streamer}`
  }
  // Old format: 2026-02-19-Jumpstart-evening
  const oldMatch = name.match(/(\d{4})-(\d{2})-(\d{2})-(\w+)-(\w+)/)
  if (oldMatch) {
    const [, year, month, day, channel, time] = oldMatch
    const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    return `${monthNames[parseInt(month)]} ${parseInt(day)} - ${channel} - ${time.charAt(0).toUpperCase() + time.slice(1)}`
  }
  return name
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
  const [activeTab, setActiveTab] = useState('summary') // 'summary', 'Jumpstart', 'Kickstart', 'bundles'
  const [selectedShow, setSelectedShow] = useState('all')
  const [page, setPage] = useState(0)
  const [expanded, setExpanded] = useState(null)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [hideWacItems, setHideWacItems] = useState(false) // Include WAC items by default
  const [bundleData, setBundleData] = useState({ boxes: [], summary: null, loading: true })
  const PAGE_SIZE = 100

  useEffect(() => {
    async function loadShows() {
      // Get unique shows directly from shows table to avoid row limits
      const { data } = await supabase.from('shows').select('name, channel').order('date', { ascending: false })
      if (data) {
        const shows = data
          .filter(s => s.name)
          .map(s => ({ show_name: s.name, channel: s.channel }))
        setAllShows(shows)
      }
    }
    loadShows()
  }, [])

  // Load bundle data when switching to bundles tab
  useEffect(() => {
    if (activeTab !== 'bundles') return
    loadBundleData()
  }, [activeTab])

  async function loadBundleData() {
    setBundleData(prev => ({ ...prev, loading: true }))

    // === Jumpstart bundles ===
    const { data: jsBoxes } = await supabase
      .from('jumpstart_bundle_boxes')
      .select('*')
      .not('sold_at', 'is', null)
      .order('sold_at', { ascending: false })

    let jsBoxStats = []
    if (jsBoxes && jsBoxes.length > 0) {
      const jsBoxNumbers = jsBoxes.map(b => b.box_number)
      const { data: manifestItems } = await supabase
        .from('bundle_manifest')
        .select('*')
        .in('box_number', jsBoxNumbers)

      jsBoxStats = jsBoxes.map(box => {
        const items = (manifestItems || []).filter(i => i.box_number === box.box_number)
        const totalMsrp = items.reduce((sum, i) => sum + (i.msrp || 0), 0)
        const totalCost = items.reduce((sum, i) => sum + (i.cost_freight || i.cost || 0), 0)
        const pct = box.price_percentage || 10
        const salePrice = totalMsrp * (pct / 100)
        const shippingCharged = box.shipping_charged || 0
        const shippingCost = box.shipping_cost || 0
        const shippingProfit = shippingCharged - shippingCost
        const profit = salePrice - totalCost + shippingProfit
        const totalRevenue = salePrice + shippingCharged
        const margin = totalRevenue > 0 ? (profit / totalRevenue) * 100 : 0
        return {
          boxNumber: box.box_number,
          channel: 'Jumpstart',
          soldAt: box.sold_at,
          pricePercentage: pct,
          pricingLabel: `${pct}%`,
          itemCount: items.length,
          totalMsrp, totalCost, salePrice, profit, margin,
          shippingCharged, shippingCost, totalRevenue
        }
      })
    }

    // === Kickstart bundles ===
    const { data: ksBoxes } = await supabase
      .from('kickstart_bundle_boxes')
      .select('*')
      .not('sold_at', 'is', null)
      .order('sold_at', { ascending: false })

    let ksBoxStats = []
    if (ksBoxes && ksBoxes.length > 0) {
      const ksBoxNumbers = ksBoxes.map(b => b.box_number)
      const { data: ksScans } = await supabase
        .from('kickstart_bundle_scans')
        .select('box_number, intake_id')
        .in('box_number', ksBoxNumbers)

      // Fetch intake data for all scanned items
      const allIntakeIds = (ksScans || []).map(s => s.intake_id)
      let intakeMap = {}
      if (allIntakeIds.length > 0) {
        const { data: intakeData } = await supabase
          .from('kickstart_intake')
          .select('id, cost, true_cost, msrp')
          .in('id', allIntakeIds)
        ;(intakeData || []).forEach(i => { intakeMap[i.id] = i })
      }

      // Hardcoded known-correct data for historical boxes
      const hardcodedBoxes = {
        1: { totalCost: 689.50, salePrice: 890 },
        2: { totalCost: 4607, salePrice: 5758 },
      }

      ksBoxStats = ksBoxes.map(box => {
        const scans = (ksScans || []).filter(s => s.box_number === box.box_number)
        const items = scans.map(s => intakeMap[s.intake_id] || { cost: 0, true_cost: 0, msrp: 0 })
        const totalMsrp = items.reduce((sum, i) => sum + (i.msrp || 0), 0)
        const markup = box.markup_percentage || 25

        // Use hardcoded data for historical boxes, otherwise use true_cost + sale_price
        const hc = hardcodedBoxes[box.box_number]
        const totalCost = hc ? hc.totalCost : items.reduce((sum, i) => sum + (i.true_cost || i.cost || 0), 0)
        const salePrice = hc ? hc.salePrice : box.sale_price

        const shippingCharged = box.shipping_charged || 0
        const shippingCost = box.shipping_cost || 0
        const shippingProfit = shippingCharged - shippingCost
        const profit = salePrice - totalCost + shippingProfit
        const totalRevenue = salePrice + shippingCharged
        const margin = totalRevenue > 0 ? (profit / totalRevenue) * 100 : 0
        return {
          boxNumber: box.box_number,
          channel: 'Kickstart',
          soldAt: box.sold_at,
          pricePercentage: markup,
          pricingLabel: `+${markup}%`,
          itemCount: scans.length,
          totalMsrp, totalCost, salePrice, profit, margin,
          shippingCharged, shippingCost, totalRevenue
        }
      })
    }

    // Merge both channels sorted by sold date
    const allBoxStats = [...jsBoxStats, ...ksBoxStats].sort((a, b) =>
      new Date(b.soldAt) - new Date(a.soldAt)
    )

    if (allBoxStats.length === 0) {
      setBundleData({ boxes: [], summary: null, loading: false })
      return
    }

    const summary = {
      totalBoxes: allBoxStats.length,
      totalRevenue: allBoxStats.reduce((sum, b) => sum + (b.totalRevenue || b.salePrice), 0),
      totalCost: allBoxStats.reduce((sum, b) => sum + b.totalCost, 0),
      totalShippingCost: allBoxStats.reduce((sum, b) => sum + (b.shippingCost || 0), 0),
      totalProfit: allBoxStats.reduce((sum, b) => sum + b.profit, 0),
      totalItems: allBoxStats.reduce((sum, b) => sum + b.itemCount, 0),
      profitableBoxes: allBoxStats.filter(b => b.profit >= 0).length,
      losingBoxes: allBoxStats.filter(b => b.profit < 0).length
    }
    summary.overallMargin = summary.totalRevenue > 0 ? (summary.totalProfit / summary.totalRevenue) * 100 : 0

    setBundleData({ boxes: allBoxStats, summary, loading: false })
  }

  // Derive channel filter from activeTab
  const channel = activeTab === 'summary' ? 'all' : (activeTab === 'bundles' ? 'all' : activeTab)

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

  useEffect(() => {
    if (activeTab === 'bundles') return
    let cancelled = false
    async function loadItems() {
      setLoading(true)
      const opt = SORT_OPTIONS.find(o => o.value === sortKey)
      let query = supabase.from('profitability').select('*').order(opt.field, { ascending: opt.dir }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
      query = applyFilters(query)
      const { data } = await query
      if (cancelled) return
      // Filter out bad bundle barcodes client-side (orphaned scans with no manifest match)
      const filtered = (data || []).filter(item => !(item.is_bundle && item.is_bad_barcode))
      setItems(filtered)
      setLoading(false)
    }
    loadItems()
    return () => { cancelled = true }
  }, [search, sortKey, activeTab, selectedShow, page, dateFrom, dateTo, hideWacItems])

  function applyFilters(query) {
    if (channel !== 'all') query = query.eq('channel', channel)
    if (selectedShow !== 'all') query = query.eq('show_name', selectedShow)
    if (search) query = query.or(`description.ilike.%${search}%,barcode.ilike.%${search}%,category.ilike.%${search}%,product_name.ilike.%${search}%,show_name.ilike.%${search}%`)
    if (dateFrom) query = query.gte('show_date', dateFrom)
    if (dateTo) query = query.lte('show_date', dateTo)
    if (hideWacItems) query = query.eq('is_wac_cost', false) // Hide items using WAC by default
    return query
  }

  // Load stats from ALL matching items — paginate through Supabase's 1000 row cap
  const [fullSummary, setFullSummary] = useState(null)
  const [showWacMap, setShowWacMap] = useState({})
  useEffect(() => {
    if (activeTab === 'bundles') return
    let cancelled = false
    async function loadStats() {
      let allData = []
      let from = 0
      const batchSize = 1000
      while (true) {
        let query = supabase.from('profitability').select('profit, net_payout, buyer_paid, margin, cost_freight, is_bad_barcode, show_name').range(from, from + batchSize - 1)
        query = applyFilters(query)
        const { data } = await query
        if (cancelled) return
        if (!data || data.length === 0) break
        allData = allData.concat(data)
        if (data.length < batchSize) break
        from += batchSize
      }
      if (cancelled) return
      if (allData.length > 0) {
        const n = allData.length
        // Build per-show WAC map: avg cost_freight of matched items in each show
        const showCosts = {}
        for (const i of allData) {
          const show = i.show_name || '_unknown'
          if (!showCosts[show]) showCosts[show] = { total: 0, count: 0 }
          if (!i.is_bad_barcode && Number(i.cost_freight) > 0) {
            showCosts[show].total += Number(i.cost_freight)
            showCosts[show].count++
          }
        }
        const wacMap = {}
        for (const [show, data] of Object.entries(showCosts)) {
          wacMap[show] = data.count > 0 ? data.total / data.count : 0
        }
        setShowWacMap(wacMap)
        // Global avg cost (from matched items only) for the summary card
        const itemsWithCost = allData.filter(i => !i.is_bad_barcode && Number(i.cost_freight) > 0)
        const avgCost = itemsWithCost.length > 0
          ? itemsWithCost.reduce((sum, i) => sum + Number(i.cost_freight), 0) / itemsWithCost.length
          : 0
        // Recalculate totals using per-show WAC for bad barcode items
        let totalProfit = 0, totalNet = 0, totalHammer = 0, totalCost = 0
        for (const i of allData) {
          const net = Number(i.net_payout || 0)
          const useWac = i.is_bad_barcode && !Number(i.cost_freight)
          const showWac = wacMap[i.show_name || '_unknown'] || avgCost
          const cost = useWac ? showWac : Number(i.cost_freight || 0)
          const profit = useWac ? net - showWac : Number(i.profit || 0)
          totalNet += net
          totalHammer += Number(i.buyer_paid || 0)
          totalCost += cost
          totalProfit += profit
        }
        const totalMargin = totalHammer > 0 ? (totalProfit / totalHammer) * 100 : 0
        setFullSummary({
          items_sold: n,
          total_profit: totalProfit,
          total_net_revenue: totalNet,
          avg_hammer: totalHammer / n,
          avg_net: totalNet / n,
          avg_profit_per_item: totalProfit / n,
          avg_margin: totalMargin,
          avg_cost_per_item: avgCost,
        })
      } else {
        setFullSummary(null)
      }
    }
    loadStats()
    return () => { cancelled = true }
  }, [activeTab, selectedShow, search, dateFrom, dateTo, hideWacItems])

  const s = fullSummary

  // Styled dropdown classes - clean style without left border accent
  const dropdownStyles = `
    relative bg-white/5
    border border-white/10
    rounded-2xl px-4 py-3 text-sm text-white
    focus:outline-none focus:border-cyan-500/50 focus:ring-4 focus:ring-cyan-500/10
    transition-all duration-200 cursor-pointer
    shadow-lg shadow-black/20
    hover:bg-white/[0.08] hover:border-white/[0.12]
    appearance-none
  `

  const dropdownArrow = {
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2394a3b8'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 12px center',
    backgroundSize: '16px',
    paddingRight: '44px'
  }

  return (
    <div className="min-h-screen">
      {/* Header row */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-extrabold tracking-tight text-white font-heading">Profitability</h2>
        {/* Single row of tabs */}
        <div className="relative p-[1px] rounded-3xl bg-gradient-to-r from-cyan-500/60 via-cyan-400/60 to-cyan-500/60 shadow-lg shadow-cyan-600/30">
          <div className="flex gap-1 bg-[#080c14] rounded-3xl p-1.5">
            {[
              { key: 'summary', label: 'Summary' },
              { key: 'Jumpstart', label: 'Jumpstart' },
              { key: 'Kickstart', label: 'Kickstart' },
              { key: 'bundles', label: 'Bundles' }
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => { setActiveTab(tab.key); setPage(0); setSelectedShow('all') }}
                className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
                  activeTab === tab.key
                    ? 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg shadow-cyan-600/30'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* BUNDLES VIEW */}
      {activeTab === 'bundles' && (
        <BundlesView data={bundleData} onRefresh={loadBundleData} />
      )}

      {/* ITEMS VIEW (Summary, Jumpstart, Kickstart tabs) */}
      {activeTab !== 'bundles' && (
        <>
      {/* Summary Section */}
      {s && (
        <div className="mb-6 space-y-4">
          {/* Hero Card */}
          <div className="relative rounded-3xl">
            {/* Inner card */}
            <div className="relative rounded-3xl bg-gradient-to-br from-[#1a1035] via-[#0f1629] to-[#0a1a2e] p-7 overflow-hidden">
              {/* Inner highlight - top edge */}
              <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/20 to-transparent" />

              {/* Glow orbs */}
              <div className="absolute top-0 right-1/4 w-80 h-80 bg-cyan-600/25 rounded-full blur-[100px] pointer-events-none" />
              <div className="absolute bottom-0 left-1/4 w-80 h-80 bg-cyan-600/20 rounded-full blur-[100px] pointer-events-none" />
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-40 h-40 bg-cyan-500/15 rounded-full blur-[60px] pointer-events-none" />

              {/* Content */}
              <div className="relative flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-[0.25em] font-semibold text-cyan-300/50 mb-3">Total Profit</div>
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
          <div className="grid grid-cols-6 gap-3">
            <GlassStatCard label="Avg Hammer" value={`$${Number(s.avg_hammer).toFixed(2)}`} accent="slate" />
            <GlassStatCard label="Net Revenue" value={`$${Number(s.total_net_revenue).toLocaleString(undefined, {maximumFractionDigits: 0})}`} accent="purple" />
            <GlassStatCard label="Net / Item" value={`$${Number(s.avg_net || 0).toFixed(2)}`} accent="fuchsia" />
            <GlassStatCard label="Cost / Item" value={`$${Number(s.avg_cost_per_item || 0).toFixed(2)}`} accent="slate" />
            <GlassStatCard label="Profit / Item" value={`$${Number(s.avg_profit_per_item).toFixed(2)}`} accent="cyan" positive={Number(s.avg_profit_per_item) >= 0} />
            <GlassStatCard label="Margin" value={`${Number(s.avg_margin).toFixed(1)}%`} accent="cyan" positive={Number(s.avg_margin) >= 0} />
          </div>
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex gap-3 mb-5 items-center flex-wrap">
        {/* Search Input */}
        <div className="relative flex-1 min-w-[240px]">
          <div className="relative flex items-center bg-white/5 border border-white/10 rounded-2xl shadow-lg shadow-black/20 focus-within:border-cyan-500/50 focus-within:ring-4 focus-within:ring-cyan-500/10 transition-all">
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
        <div className="flex items-center bg-white/5 border border-white/10 rounded-2xl px-4 py-2 shadow-lg shadow-black/20 hover:border-white/[0.12] transition-all">
          <input
            type="date"
            value={dateFrom}
            onChange={e => { setDateFrom(e.target.value); setPage(0) }}
            className="bg-transparent text-sm text-white focus:outline-none [color-scheme:dark] w-[115px]"
          />
          <svg className="mx-2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

        {/* Include WAC Toggle */}
        <button
          onClick={() => { setHideWacItems(!hideWacItems); setPage(0) }}
          className={`px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 border ${
            !hideWacItems
              ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300'
              : 'bg-white/5 border-white/10 text-slate-400 hover:text-white hover:border-white/[0.12]'
          }`}
        >
          {hideWacItems ? 'Include WAC (per show avg)' : '✓ WAC (per show avg)'}
        </button>
      </div>

      {/* Active Filters */}
      {(selectedShow !== 'all' || search || dateFrom || dateTo) && (
        <div className="flex gap-2 mb-5 flex-wrap">
          {selectedShow !== 'all' && (
            <FilterPill color="cyan" onClear={() => setSelectedShow('all')}>
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
            <div className="w-12 h-12 border-2 border-cyan-500/20 rounded-full" />
            <div className="absolute inset-0 w-12 h-12 border-2 border-transparent border-t-cyan-500 rounded-full animate-spin" />
          </div>
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-24 text-slate-500">No data found</div>
      ) : (
        <>
          {/* Table */}
          <div className="relative rounded-3xl shadow-xl shadow-black/20">
            {/* Gradient border effect */}
            <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/30 via-transparent to-cyan-500/20 rounded-3xl pointer-events-none" />

            <div className="relative glass-card rounded-3xl overflow-auto" style={{maxHeight: "calc(100vh - 280px)"}}>
              {/* Inner highlight */}
              <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
              
              <table className="w-full text-sm">
                <thead className="bg-slate-800/95 backdrop-blur-xl border-b border-white/10 sticky top-0 z-10">
                  <tr className="border-b border-white/[0.08]">
                    <th className="text-left py-4 px-4 text-[11px] uppercase tracking-wider font-semibold text-slate-400 bg-white/[0.02]">Description</th>
                    <th className="text-right py-4 px-3 text-[11px] uppercase tracking-wider font-semibold text-slate-400 bg-white/[0.02]">Hammer</th>
                    <th className="text-right py-4 px-3 text-[11px] uppercase tracking-wider font-semibold text-slate-400 bg-white/[0.02]">Coupon</th>
                    <th className="text-right py-4 px-3 text-[11px] uppercase tracking-wider font-semibold text-slate-400 bg-white/[0.02]">Buyer Paid</th>
                    <th className="text-right py-4 px-3 text-[11px] uppercase tracking-wider font-semibold text-slate-400 bg-white/[0.02]">Fees</th>
                    <th className="text-right py-4 px-3 text-[11px] uppercase tracking-wider font-semibold text-slate-400 bg-white/[0.02]">Net</th>
                    <th className="text-right py-4 px-3 text-[11px] uppercase tracking-wider font-semibold text-slate-400 bg-white/[0.02]">Cost</th>
                    <th className="text-right py-4 px-3 text-[11px] uppercase tracking-wider font-semibold text-slate-400 bg-white/[0.02]">Profit</th>
                    <th className="text-right py-4 px-3 text-[11px] uppercase tracking-wider font-semibold text-slate-400 bg-white/[0.02]">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, i) => {
                    const isExp = expanded === i
                    const showWac = showWacMap[item.show_name] || Number(s?.avg_cost_per_item || 0)
                    const useWac = item.is_bad_barcode && !Number(item.cost_freight)
                    const costFreight = useWac ? showWac : Number(item.cost_freight || 0)
                    const netPayout = Number(item.net_payout)
                    const profitNum = useWac ? Math.round((netPayout - showWac) * 100) / 100 : Number(item.profit)
                    const marginNum = useWac && Number(item.buyer_paid) > 0
                      ? Math.round((profitNum / Number(item.buyer_paid)) * 1000) / 10
                      : Number(item.margin)
                    const couponAmt = Number(item.coupon_amount || 0)
                    return (
                      <Fragment key={i}>
                        <tr 
                          onClick={() => setExpanded(isExp ? null : i)} 
                          className={`
                            cursor-pointer transition-all duration-200 border-b border-white/[0.04]
                            hover:bg-gradient-to-r hover:from-cyan-600/10 hover:via-cyan-600/5 hover:to-transparent
                            ${isExp ? 'bg-gradient-to-r from-cyan-600/15 via-cyan-600/10 to-transparent' : ''}
                          `}
                        >
                          <td className="py-4 px-4 max-w-[280px] text-white font-medium">
                            <div className="flex items-center gap-2">
                              <span className="truncate">{item.description || item.product_name}</span>
                              {item.is_bundle && <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400 font-semibold">Bundle</span>}
                              {(item.is_wac_cost || useWac) && <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-pink-500/20 text-pink-400 font-semibold">WAC</span>}
                            </div>
                          </td>
                          <td className="py-4 px-3 text-right text-slate-300">${Number(item.original_hammer).toFixed(2)}</td>
                          <td className={`py-4 px-3 text-right ${couponAmt > 0 ? 'text-pink-400' : 'text-slate-600'}`}>
                            {couponAmt > 0 ? `-$${couponAmt.toFixed(2)}` : '—'}
                          </td>
                          <td className="py-4 px-3 text-right text-slate-300">${Number(item.buyer_paid).toFixed(2)}</td>
                          <td className="py-4 px-3 text-right text-slate-500">-${Number(item.total_fees).toFixed(2)}</td>
                          <td className="py-4 px-3 text-right text-slate-300">${Number(item.net_payout).toFixed(2)}</td>
                          <td className="py-4 px-3 text-right text-slate-500">${costFreight.toFixed(2)}</td>
                          <td className={`py-4 px-3 text-right font-bold ${profitNum >= 0 ? 'text-cyan-400' : 'text-pink-400'}`}>
                            ${profitNum.toFixed(2)}
                          </td>
                          <td className={`py-4 px-3 text-right font-semibold ${marginNum >= 0 ? 'text-cyan-400' : 'text-pink-400'}`}>
                            {marginNum.toFixed(1)}%
                          </td>
                        </tr>
                        {isExp && (
                          <tr className="bg-gradient-to-r from-[#12061f] via-[#0a0e17] to-[#0a0e17]">
                            <td colSpan={9} className="px-6 py-5">
                              <div className="flex gap-8 text-xs flex-wrap items-center">
                                <DetailChip label="Barcode" value={item.barcode} mono />
                                <DetailChip label="Listing" value={`#${item.listing_number}`} highlight />
                                <DetailChip label="Show" value={formatShowNameFull(item.show_name)} />
                                {item.category && <DetailChip label="Category" value={item.category} />}
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
        </>
      )}
    </div>
  )
}

// Bundles View Component
function BundlesView({ data, onRefresh }) {
  const { boxes: allBoxes, summary: rawSummary, loading } = data
  const [bundleChannel, setBundleChannel] = useState('all') // 'all', 'Jumpstart', 'Kickstart'

  // Filter boxes by channel — deduplicate by channel+boxNumber
  const boxes = useMemo(() => {
    const src = bundleChannel === 'all' ? (allBoxes || []) : (allBoxes || []).filter(b => b.channel === bundleChannel)
    const seen = new Set()
    return src.filter(b => {
      const key = `${b.channel}-${b.boxNumber}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [allBoxes, bundleChannel])

  // Recalculate summary for filtered boxes
  const summary = useMemo(() => {
    if (!boxes || boxes.length === 0) return null
    const s = {
      totalBoxes: boxes.length,
      totalRevenue: boxes.reduce((sum, b) => sum + (b.totalRevenue || b.salePrice), 0),
      totalCost: boxes.reduce((sum, b) => sum + b.totalCost, 0),
      totalShippingCost: boxes.reduce((sum, b) => sum + (b.shippingCost || 0), 0),
      totalProfit: boxes.reduce((sum, b) => sum + b.profit, 0),
      totalItems: boxes.reduce((sum, b) => sum + b.itemCount, 0),
      profitableBoxes: boxes.filter(b => b.profit >= 0).length,
      losingBoxes: boxes.filter(b => b.profit < 0).length
    }
    s.overallMargin = s.totalRevenue > 0 ? (s.totalProfit / s.totalRevenue) * 100 : 0
    return s
  }, [boxes])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="relative">
          <div className="w-12 h-12 border-2 border-emerald-500/20 rounded-full" />
          <div className="absolute inset-0 w-12 h-12 border-2 border-transparent border-t-emerald-500 rounded-full animate-spin" />
        </div>
      </div>
    )
  }

  if (!summary || boxes.length === 0) {
    return (
      <div className="text-center py-24">
        <div className="text-slate-500 text-lg mb-2">No sold bundles yet</div>
        <div className="text-slate-600 text-sm">Mark bundles as sold in the Bundle Sort page</div>
      </div>
    )
  }

  return (
    <div>
      {/* Channel Filter */}
      <div className="flex gap-2 mb-4">
        {['all', 'Jumpstart', 'Kickstart'].map(ch => (
          <button
            key={ch}
            onClick={() => setBundleChannel(ch)}
            className={`px-4 py-2 rounded-2xl text-sm font-semibold transition-all duration-200
              ${bundleChannel === ch
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-lg shadow-emerald-900/20'
                : 'bg-white/5 text-slate-400 border border-white/10 hover:bg-white/[0.08] hover:text-slate-300'
              }`}
          >
            {ch === 'all' ? 'All Boxes' : ch}
          </button>
        ))}
      </div>

      {/* Summary Hero Card */}
      <div className="mb-6 space-y-4">
        <div className="relative rounded-3xl">
          <div className="relative rounded-3xl bg-gradient-to-br from-[#0a1f1a] via-[#0f1629] to-[#0a1a2e] p-7">
            <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
            <div className="absolute top-0 right-1/4 w-80 h-80 bg-emerald-600/25 rounded-full blur-[100px] pointer-events-none" />
            <div className="absolute bottom-0 left-1/4 w-80 h-80 bg-teal-600/20 rounded-full blur-[100px] pointer-events-none" />

            <div className="relative flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-[0.25em] font-semibold text-emerald-300/50 mb-3">Total Bundle Profit</div>
                <div
                  className={`text-5xl font-black tracking-tight ${summary.totalProfit >= 0 ? 'text-emerald-400' : 'text-pink-400'}`}
                  style={{
                    textShadow: summary.totalProfit >= 0
                      ? '0 0 60px rgba(52, 211, 153, 0.5), 0 0 120px rgba(52, 211, 153, 0.25)'
                      : '0 0 60px rgba(244, 114, 182, 0.5), 0 0 120px rgba(244, 114, 182, 0.25)'
                  }}
                >
                  ${summary.totalProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs uppercase tracking-[0.25em] font-semibold text-teal-300/50 mb-3">Boxes Sold</div>
                <div
                  className="text-5xl font-black text-white tracking-tight"
                  style={{ textShadow: '0 0 40px rgba(255, 255, 255, 0.15)' }}
                >
                  {summary.totalBoxes}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-5 gap-3">
          <div className="relative overflow-hidden rounded-3xl glass-card p-4 shadow-xl shadow-black/30">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
            <div className="text-[10px] uppercase tracking-[0.2em] font-semibold text-slate-500 mb-1.5">Items Sold</div>
            <div className="text-lg font-bold text-white">{summary.totalItems}</div>
          </div>
          <div className="relative overflow-hidden rounded-3xl glass-card p-4 shadow-xl shadow-black/30">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
            <div className="text-[10px] uppercase tracking-[0.2em] font-semibold text-slate-500 mb-1.5">Total Revenue</div>
            <div className="text-lg font-bold text-emerald-400">${summary.totalRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
          </div>
          <div className="relative overflow-hidden rounded-3xl glass-card p-4 shadow-xl shadow-black/30">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
            <div className="text-[10px] uppercase tracking-[0.2em] font-semibold text-slate-500 mb-1.5">Total Cost</div>
            <div className="text-lg font-bold text-slate-300">${summary.totalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
          </div>
          <div className="relative overflow-hidden rounded-3xl glass-card p-4 shadow-xl shadow-black/30">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
            <div className="text-[10px] uppercase tracking-[0.2em] font-semibold text-slate-500 mb-1.5">Margin</div>
            <div className={`text-lg font-bold ${summary.overallMargin >= 0 ? 'text-emerald-400' : 'text-pink-400'}`}>{summary.overallMargin.toFixed(1)}%</div>
          </div>
          <div className="relative overflow-hidden rounded-3xl glass-card p-4 shadow-xl shadow-black/30">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
            <div className="text-[10px] uppercase tracking-[0.2em] font-semibold text-slate-500 mb-1.5">Win / Loss</div>
            <div className="text-lg font-bold">
              <span className="text-emerald-400">{summary.profitableBoxes}</span>
              <span className="text-slate-600"> / </span>
              <span className="text-pink-400">{summary.losingBoxes}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Box List Table */}
      <div className="relative rounded-3xl shadow-xl shadow-black/20">
        <div className="absolute inset-0 bg-gradient-to-b from-emerald-500/30 via-transparent to-teal-500/20 rounded-3xl pointer-events-none" />
        <div className="relative glass-card rounded-3xl overflow-auto" style={{ maxHeight: 'calc(100vh - 420px)' }}>
          <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
          <table className="w-full text-sm">
            <thead className="bg-slate-800/95 backdrop-blur-xl border-b border-white/10 sticky top-0 z-10">
              <tr className="border-b border-white/[0.08]">
                <th className="text-left py-4 px-4 text-[11px] uppercase tracking-wider font-semibold text-slate-400 bg-white/[0.02]">Box</th>
                <th className="text-center py-4 px-3 text-[11px] uppercase tracking-wider font-semibold text-slate-400 bg-white/[0.02]">Items</th>
                <th className="text-center py-4 px-3 text-[11px] uppercase tracking-wider font-semibold text-slate-400 bg-white/[0.02]">Price %</th>
                <th className="text-right py-4 px-3 text-[11px] uppercase tracking-wider font-semibold text-slate-400 bg-white/[0.02]">MSRP</th>
                <th className="text-right py-4 px-3 text-[11px] uppercase tracking-wider font-semibold text-slate-400 bg-white/[0.02]">Sale</th>
                <th className="text-right py-4 px-3 text-[11px] uppercase tracking-wider font-semibold text-slate-400 bg-white/[0.02]">Cost</th>
                <th className="text-right py-4 px-3 text-[11px] uppercase tracking-wider font-semibold text-slate-400 bg-white/[0.02]">Profit</th>
                <th className="text-right py-4 px-3 text-[11px] uppercase tracking-wider font-semibold text-slate-400 bg-white/[0.02]">Margin</th>
                <th className="text-right py-4 px-4 text-[11px] uppercase tracking-wider font-semibold text-slate-400 bg-white/[0.02]">Sold</th>
              </tr>
            </thead>
            <tbody>
              {boxes.map((box, i) => (
                <tr
                  key={`${box.channel}-${box.boxNumber}`}
                  className={`
                    transition-all duration-200 border-b border-white/[0.04]
                    hover:bg-gradient-to-r hover:from-emerald-600/10 hover:via-emerald-600/5 hover:to-transparent
                  `}
                >
                  <td className="py-4 px-4 text-white font-bold">
                    <div className="flex items-center gap-2">
                      Box #{box.boxNumber}
                      {box.channel === 'Kickstart' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-fuchsia-500/20 text-fuchsia-400 font-semibold">KS</span>}
                      {box.channel === 'Jumpstart' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400 font-semibold">JS</span>}
                      {box.profit < 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-pink-500/20 text-pink-400 font-semibold">LOSS</span>}
                    </div>
                  </td>
                  <td className="py-4 px-3 text-center text-slate-300">{box.itemCount}</td>
                  <td className="py-4 px-3 text-center text-slate-400">{box.pricingLabel || `${box.pricePercentage}%`}</td>
                  <td className="py-4 px-3 text-right text-slate-400">${box.totalMsrp.toFixed(0)}</td>
                  <td className="py-4 px-3 text-right text-slate-300">
                    ${box.salePrice.toFixed(2)}
                    {box.shippingCharged > 0 && <div className="text-[10px] text-slate-500">+${box.shippingCharged.toFixed(0)} ship</div>}
                  </td>
                  <td className="py-4 px-3 text-right text-slate-500">
                    ${box.totalCost.toFixed(2)}
                    {box.shippingCost > 0 && <div className="text-[10px] text-slate-600">+${box.shippingCost.toFixed(0)} ship</div>}
                  </td>
                  <td className={`py-4 px-3 text-right font-bold ${box.profit >= 0 ? 'text-emerald-400' : 'text-pink-400'}`}>
                    {box.profit >= 0 ? '+' : ''}${box.profit.toFixed(2)}
                  </td>
                  <td className={`py-4 px-3 text-right font-semibold ${box.margin >= 0 ? 'text-emerald-400' : 'text-pink-400'}`}>
                    {box.margin.toFixed(1)}%
                  </td>
                  <td className="py-4 px-4 text-right text-slate-500 text-xs">
                    {new Date(box.soldAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function GlassStatCard({ label, value, accent, positive }) {
  const valueColor = positive === false ? 'text-pink-400' : positive === true ? 'text-cyan-400' : 'text-white'
  
  return (
    <div className="relative overflow-hidden rounded-3xl glass-card p-4 shadow-xl shadow-black/30">
      {/* Inner highlight */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />

      <div className="relative">
        <div className="text-[10px] uppercase tracking-[0.2em] font-semibold text-slate-500 mb-1.5">{label}</div>
        <div className={`text-lg font-bold tracking-tight ${valueColor}`}>{value}</div>
      </div>
    </div>
  )
}

function FilterPill({ children, color, onClear }) {
  const colors = {
    purple: 'from-cyan-500/25 to-cyan-600/10 text-cyan-300 border-cyan-500/40',
    fuchsia: 'from-cyan-500/25 to-cyan-600/10 text-cyan-300 border-cyan-500/40',
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
