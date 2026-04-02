import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import ChatTab from './ChatTab'

// Normalize zone values: "1", "Zone 1", "Zone 1 Pants" → "Zone 1", etc.
function normalizeZone(z) {
  if (!z) return 'Unknown'
  const s = String(z).trim()
  if (s === '1' || s === 'Zone 1' || s === 'Zone 1 Pants') return 'Zone 1'
  if (s === '2' || s === 'Zone 2' || s === 'Zone 2 Pants') return 'Zone 2'
  if (s === '3' || s === 'Zone 3') return 'Zone 3'
  return s
}

function msrpTier(msrp) {
  const v = Number(msrp) || 0
  if (v < 50) return '$0–49'
  if (v < 100) return '$50–99'
  if (v < 200) return '$100–199'
  return '$200+'
}

const MSRP_ORDER = ['$0–49', '$50–99', '$100–199', '$200+']

function fmt(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function pct(n) {
  return `${Number(n || 0).toFixed(1)}%`
}

// Helper to fetch all rows with pagination
async function fetchAllRows(table, columns, filters = []) {
  let allData = []
  let offset = 0
  const pageSize = 1000
  while (true) {
    let query = supabase.from(table).select(columns).range(offset, offset + pageSize - 1)
    for (const f of filters) {
      if (f.type === 'eq') query = query.eq(f.col, f.val)
    }
    const { data } = await query
    if (!data || data.length === 0) break
    allData = allData.concat(data)
    offset += pageSize
    if (data.length < pageSize) break
  }
  return allData
}

function ageBucket(days) {
  if (days <= 7) return '0–1 weeks'
  if (days <= 14) return '1–2 weeks'
  if (days <= 21) return '2–3 weeks'
  if (days <= 28) return '3–4 weeks'
  return '4+ weeks'
}

const AGE_ORDER = ['0–1 weeks', '1–2 weeks', '2–3 weeks', '3–4 weeks', '4+ weeks']

export default function AdminAnalytics() {
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState([])
  const [view, setView] = useState('category')

  // Inventory aging data (loaded lazily)
  const [agingData, setAgingData] = useState(null)
  const [agingLoading, setAgingLoading] = useState(false)

  // Load ROI data (loaded lazily)
  const [loadROIData, setLoadROIData] = useState(null)
  const [loadROILoading, setLoadROILoading] = useState(false)

  useEffect(() => { loadProfitabilityData() }, [])

  // Load aging data when tab is selected
  useEffect(() => {
    if (view === 'aging' && !agingData && !agingLoading) loadAgingData()
  }, [view])

  // Load ROI data when tab is selected
  useEffect(() => {
    if (view === 'loadroi' && !loadROIData && !loadROILoading) loadLoadROIData()
  }, [view])

  async function loadProfitabilityData() {
    setLoading(true)
    const PAGE = 1000
    let all = [], offset = 0
    while (true) {
      const { data, error } = await supabase
        .from('profitability')
        .select('category,description,msrp,cost_freight,buyer_paid,profit,margin,zone,show_name,show_date,is_bundle,barcode')
        .eq('channel', 'Jumpstart')
        .eq('is_bundle', false)
        .range(offset, offset + PAGE - 1)
      if (error) break
      all = all.concat(data || [])
      if (!data || data.length < PAGE) break
      offset += PAGE
    }
    setItems(all)
    setLoading(false)
  }

  // Helper: get all sold barcodes from sold scans + sold bundle items
  async function getSoldBarcodes() {
    const soldScansData = await fetchAllRows('jumpstart_sold_scans', 'barcode')
    const soldBoxes = (await supabase.from('jumpstart_bundle_boxes').select('box_number').not('sold_at', 'is', null)).data || []
    const soldBoxNumbers = soldBoxes.map(b => b.box_number)
    let soldBundleData = []
    if (soldBoxNumbers.length > 0) {
      const allBundleScans = await fetchAllRows('jumpstart_bundle_scans', 'barcode,box_number')
      soldBundleData = allBundleScans.filter(s => soldBoxNumbers.includes(s.box_number))
    }
    return [...soldScansData, ...soldBundleData]
  }

  async function loadAgingData() {
    setAgingLoading(true)
    const [manifestData, soldData, loadsData] = await Promise.all([
      fetchAllRows('jumpstart_manifest', 'barcode,cost_freight,load_id,category,zone,msrp,description'),
      getSoldBarcodes(),
      supabase.from('loads').select('id,date,vendor,notes').then(r => r.data || []),
    ])

    // Count sold per barcode (from sold scans + sold bundles — items that physically left)
    const soldCounts = {}
    soldData.forEach(row => {
      soldCounts[row.barcode] = (soldCounts[row.barcode] || 0) + 1
    })

    // Walk manifest, find unsold items
    const soldUsed = {}
    const unsoldItems = []
    const today = new Date()

    // Build load date lookup
    const loadDates = {}
    const loadNames = {}
    loadsData.forEach(l => {
      loadDates[l.id] = l.date ? new Date(l.date) : null
      loadNames[l.id] = l.vendor || l.notes || l.id
    })

    manifestData.forEach(item => {
      const bc = item.barcode
      const used = soldUsed[bc] || 0
      const totalSold = soldCounts[bc] || 0

      if (used < totalSold) {
        soldUsed[bc] = used + 1
      } else {
        const loadDate = loadDates[item.load_id]
        const daysOld = loadDate ? Math.floor((today - loadDate) / (1000 * 60 * 60 * 24)) : null
        unsoldItems.push({
          ...item,
          loadName: loadNames[item.load_id] || item.load_id || 'Unknown',
          loadDate,
          daysOld,
          ageBucket: daysOld !== null ? ageBucket(daysOld) : 'Unknown',
        })
      }
    })

    setAgingData({
      unsoldItems,
      totalManifest: manifestData.length,
      totalSold: manifestData.length - unsoldItems.length,
      loads: loadsData,
    })
    setAgingLoading(false)
  }

  async function loadLoadROIData() {
    setLoadROILoading(true)
    // Fetch everything self-contained — no dependency on `items` state
    const [manifestData, loadsData, soldData, profitData] = await Promise.all([
      fetchAllRows('jumpstart_manifest', 'barcode,cost_freight,load_id'),
      supabase.from('loads').select('id,date,vendor,notes,total_cost,quantity').then(r => r.data || []),
      getSoldBarcodes(),
      fetchAllRows('profitability', 'barcode,buyer_paid,profit', [{ type: 'eq', col: 'channel', val: 'Jumpstart' }]),
    ])

    // Count items per load and total cost per load from manifest
    const loadManifest = {}
    manifestData.forEach(item => {
      const lid = item.load_id || 'Unknown'
      if (!loadManifest[lid]) loadManifest[lid] = { items: 0, totalCost: 0 }
      loadManifest[lid].items++
      loadManifest[lid].totalCost += Number(item.cost_freight) || 0
    })

    // Build barcode → load_id mapping (from manifest, first load wins per barcode)
    const barcodeToLoad = {}
    manifestData.forEach(item => {
      if (!barcodeToLoad[item.barcode]) barcodeToLoad[item.barcode] = item.load_id
    })

    // Count sold per barcode (from sold scans + sold bundles — items that physically left)
    const soldCounts = {}
    soldData.forEach(row => {
      soldCounts[row.barcode] = (soldCounts[row.barcode] || 0) + 1
    })

    // Count sold items per load
    const loadSold = {}
    for (const [barcode, count] of Object.entries(soldCounts)) {
      const lid = barcodeToLoad[barcode] || 'Unknown'
      if (!loadSold[lid]) loadSold[lid] = 0
      loadSold[lid] += count
    }

    // Map profitability items to loads via barcode (includes bundles)
    const loadProfit = {}
    profitData.forEach(item => {
      const lid = barcodeToLoad[item.barcode]
      if (!lid) return
      if (!loadProfit[lid]) loadProfit[lid] = { revenue: 0, profit: 0, soldWithProfit: 0 }
      loadProfit[lid].revenue += Number(item.buyer_paid) || 0
      loadProfit[lid].profit += Number(item.profit) || 0
      loadProfit[lid].soldWithProfit++
    })

    // Build load ROI rows
    const loadRows = loadsData.map(load => {
      const manifest = loadManifest[load.id] || { items: 0, totalCost: 0 }
      const sold = loadSold[load.id] || 0
      const prof = loadProfit[load.id] || { revenue: 0, profit: 0, soldWithProfit: 0 }
      const sellThrough = manifest.items > 0 ? (sold / manifest.items) * 100 : 0
      const roi = manifest.totalCost > 0 ? (prof.profit / manifest.totalCost) * 100 : 0

      return {
        id: load.id,
        name: load.vendor || load.notes || load.id,
        date: load.date,
        totalItems: manifest.items,
        totalCost: manifest.totalCost,
        sold,
        remaining: manifest.items - sold,
        sellThrough,
        revenue: prof.revenue,
        profit: prof.profit,
        roi,
        avgMargin: prof.revenue > 0 ? (prof.profit / prof.revenue) * 100 : 0,
      }
    }).sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))

    setLoadROIData(loadRows)
    setLoadROILoading(false)
  }

  if (loading) {
    return <div className="text-slate-400 py-12 text-center">Loading analytics...</div>
  }

  // Aggregate by different dimensions
  function aggregate(keyFn) {
    const groups = {}
    for (const item of items) {
      const key = keyFn(item) || 'Unknown'
      if (!groups[key]) groups[key] = { items: 0, revenue: 0, cost: 0, profit: 0, profitable: 0 }
      const g = groups[key]
      g.items++
      g.revenue += Number(item.buyer_paid) || 0
      g.cost += Number(item.cost_freight) || 0
      g.profit += Number(item.profit) || 0
      if (Number(item.profit) > 0) g.profitable++
    }
    return Object.entries(groups).map(([key, g]) => ({
      key,
      items: g.items,
      revenue: g.revenue,
      cost: g.cost,
      profit: g.profit,
      avgProfit: g.profit / g.items,
      avgSale: g.revenue / g.items,
      avgCost: g.cost / g.items,
      margin: g.revenue > 0 ? (g.profit / g.revenue) * 100 : 0,
      pctProfitable: (g.profitable / g.items) * 100,
    }))
  }

  const totalProfit = items.reduce((s, i) => s + (Number(i.profit) || 0), 0)
  const totalRevenue = items.reduce((s, i) => s + (Number(i.buyer_paid) || 0), 0)
  const totalProfitable = items.filter(i => Number(i.profit) > 0).length

  const TABS = [
    { id: 'category', label: 'By Category' },
    { id: 'zone', label: 'By Zone' },
    { id: 'msrp', label: 'By MSRP Tier' },
    { id: 'bundles', label: 'Bundle Candidates' },
    { id: 'aging', label: 'Inventory Aging' },
    { id: 'loadroi', label: 'Load ROI' },
    { id: 'shows', label: 'Show Performance' },
    { id: 'chat', label: 'Chat' },
  ]

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white">Jumpstart Analytics</h2>
        <p className="text-slate-500 text-sm mt-1">
          {items.length.toLocaleString()} items sold | {fmt(totalRevenue)} revenue | {fmt(totalProfit)} profit | {pct(totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0)} margin | {pct((totalProfitable / items.length) * 100)} profitable
        </p>
      </div>

      {/* View Tabs */}
      <div className="flex flex-wrap gap-2 mb-6">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setView(t.id)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all
              ${view === t.id
                ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-600/30 glow-cyan'
                : 'text-slate-400 hover:bg-white/[0.06] border border-transparent'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {view === 'category' && <CategoryView items={items} aggregate={aggregate} />}
      {view === 'zone' && <ZoneView items={items} aggregate={aggregate} />}
      {view === 'msrp' && <MSRPView items={items} aggregate={aggregate} />}
      {view === 'bundles' && <BundleView items={items} aggregate={aggregate} />}
      {view === 'aging' && <AgingView data={agingData} loading={agingLoading} />}
      {view === 'loadroi' && <LoadROIView data={loadROIData} loading={loadROILoading} />}
      {view === 'shows' && <ShowView items={items} />}
      {view === 'chat' && <ChatTab />}
    </div>
  )
}

function CategoryView({ aggregate }) {
  const data = aggregate(i => i.category)
    .filter(d => d.items >= 10)
    .sort((a, b) => b.profit - a.profit)

  return (
    <div>
      <h3 className="text-lg font-bold text-white mb-3">Category Scorecard</h3>
      <p className="text-slate-500 text-xs mb-4">Categories with 10+ items, sorted by total profit</p>
      <div className="glass-card rounded-3xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-400 text-xs border-b border-white/[0.08]">
                <th className="text-left px-4 py-3">Category</th>
                <th className="text-right px-4 py-3">Items</th>
                <th className="text-right px-4 py-3">Avg Sale</th>
                <th className="text-right px-4 py-3">Avg Cost</th>
                <th className="text-right px-4 py-3">Avg Profit</th>
                <th className="text-right px-4 py-3">Margin</th>
                <th className="text-right px-4 py-3">% Profitable</th>
                <th className="text-right px-4 py-3">Total Profit</th>
              </tr>
            </thead>
            <tbody>
              {data.map(d => (
                <tr key={d.key} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                  <td className="px-4 py-3 text-white font-medium">{d.key}</td>
                  <td className="px-4 py-3 text-right text-slate-300">{d.items}</td>
                  <td className="px-4 py-3 text-right text-slate-300">{fmt(d.avgSale)}</td>
                  <td className="px-4 py-3 text-right text-slate-300">{fmt(d.avgCost)}</td>
                  <td className={`px-4 py-3 text-right font-semibold ${d.avgProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt(d.avgProfit)}</td>
                  <td className={`px-4 py-3 text-right ${d.margin >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{pct(d.margin)}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`${d.pctProfitable >= 70 ? 'text-emerald-400' : d.pctProfitable >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                      {pct(d.pctProfitable)}
                    </span>
                  </td>
                  <td className={`px-4 py-3 text-right font-bold ${d.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt(d.profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function ZoneView({ aggregate }) {
  const data = aggregate(i => normalizeZone(i.zone))
    .sort((a, b) => {
      const order = ['Zone 1', 'Zone 2', 'Zone 3', 'Unknown']
      return order.indexOf(a.key) - order.indexOf(b.key)
    })

  return (
    <div>
      <h3 className="text-lg font-bold text-white mb-3">Zone Performance</h3>
      <p className="text-slate-500 text-xs mb-4">How each zone contributes to profit</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {data.filter(d => d.key !== 'Unknown').map(d => (
          <div key={d.key} className="glass-card rounded-3xl p-6">
            <div className="text-sm text-slate-400 mb-1">{d.key}</div>
            <div className="text-2xl font-bold text-white mb-3">{fmt(d.profit)}</div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Items</span>
                <span className="text-slate-300">{d.items.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Avg Sale</span>
                <span className="text-slate-300">{fmt(d.avgSale)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Avg Cost</span>
                <span className="text-slate-300">{fmt(d.avgCost)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Avg Profit</span>
                <span className={d.avgProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}>{fmt(d.avgProfit)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Margin</span>
                <span className={d.margin >= 0 ? 'text-emerald-400' : 'text-red-400'}>{pct(d.margin)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">% Profitable</span>
                <span className={`${d.pctProfitable >= 70 ? 'text-emerald-400' : d.pctProfitable >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                  {pct(d.pctProfitable)}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function MSRPView({ items, aggregate }) {
  const data = aggregate(i => msrpTier(i.msrp))
    .sort((a, b) => MSRP_ORDER.indexOf(a.key) - MSRP_ORDER.indexOf(b.key))

  const tiers = {}
  for (const item of items) {
    const tier = msrpTier(item.msrp)
    if (!tiers[tier]) tiers[tier] = { totalMsrp: 0, totalSale: 0, count: 0 }
    tiers[tier].totalMsrp += Number(item.msrp) || 0
    tiers[tier].totalSale += Number(item.buyer_paid) || 0
    tiers[tier].count++
  }

  return (
    <div>
      <h3 className="text-lg font-bold text-white mb-3">MSRP Tier Analysis</h3>
      <p className="text-slate-500 text-xs mb-4">How profitability changes with retail price tier</p>

      <div className="glass-card rounded-3xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-400 text-xs border-b border-white/[0.08]">
                <th className="text-left px-4 py-3">MSRP Tier</th>
                <th className="text-right px-4 py-3">Items</th>
                <th className="text-right px-4 py-3">Avg MSRP</th>
                <th className="text-right px-4 py-3">Avg Sale</th>
                <th className="text-right px-4 py-3">Recovery %</th>
                <th className="text-right px-4 py-3">Avg Cost</th>
                <th className="text-right px-4 py-3">Avg Profit</th>
                <th className="text-right px-4 py-3">Margin</th>
                <th className="text-right px-4 py-3">% Profitable</th>
                <th className="text-right px-4 py-3">Total Profit</th>
              </tr>
            </thead>
            <tbody>
              {data.map(d => {
                const t = tiers[d.key]
                const recovery = t && t.totalMsrp > 0 ? (t.totalSale / t.totalMsrp) * 100 : 0
                const avgMsrp = t && t.count > 0 ? t.totalMsrp / t.count : 0
                return (
                  <tr key={d.key} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                    <td className="px-4 py-3 text-white font-medium">{d.key}</td>
                    <td className="px-4 py-3 text-right text-slate-300">{d.items}</td>
                    <td className="px-4 py-3 text-right text-slate-300">{fmt(avgMsrp)}</td>
                    <td className="px-4 py-3 text-right text-slate-300">{fmt(d.avgSale)}</td>
                    <td className="px-4 py-3 text-right text-cyan-400">{pct(recovery)}</td>
                    <td className="px-4 py-3 text-right text-slate-300">{fmt(d.avgCost)}</td>
                    <td className={`px-4 py-3 text-right font-semibold ${d.avgProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt(d.avgProfit)}</td>
                    <td className={`px-4 py-3 text-right ${d.margin >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{pct(d.margin)}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`${d.pctProfitable >= 70 ? 'text-emerald-400' : d.pctProfitable >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                        {pct(d.pctProfitable)}
                      </span>
                    </td>
                    <td className={`px-4 py-3 text-right font-bold ${d.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt(d.profit)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function BundleView({ items, aggregate }) {
  const catData = aggregate(i => i.category)
    .filter(d => d.items >= 5)
    .sort((a, b) => a.pctProfitable - b.pctProfitable)

  const combos = {}
  for (const item of items) {
    const cat = item.category || 'Unknown'
    const tier = msrpTier(item.msrp)
    const key = `${cat} | ${tier}`
    if (!combos[key]) combos[key] = { items: 0, profit: 0, losers: 0, cat, tier }
    combos[key].items++
    combos[key].profit += Number(item.profit) || 0
    if (Number(item.profit) <= 0) combos[key].losers++
  }

  const dangerCombos = Object.values(combos)
    .filter(c => c.items >= 10 && (c.losers / c.items) > 0.4)
    .sort((a, b) => (b.losers / b.items) - (a.losers / a.items))

  const losers = items.filter(i => Number(i.profit) < 0)
  const loserRevenue = losers.reduce((s, i) => s + (Number(i.buyer_paid) || 0), 0)
  const loserLoss = losers.reduce((s, i) => s + (Number(i.profit) || 0), 0)

  return (
    <div>
      <h3 className="text-lg font-bold text-white mb-3">Bundle Candidates</h3>
      <p className="text-slate-500 text-xs mb-4">Items and categories that lose money on live shows — better off in bundles</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-5">
          <div className="text-sm text-red-400 mb-1">Money-Losing Items</div>
          <div className="text-2xl font-bold text-red-400">{losers.length.toLocaleString()}</div>
          <div className="text-xs text-slate-500 mt-1">{pct((losers.length / items.length) * 100)} of all items</div>
        </div>
        <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-5">
          <div className="text-sm text-red-400 mb-1">Total Losses</div>
          <div className="text-2xl font-bold text-red-400">{fmt(loserLoss)}</div>
          <div className="text-xs text-slate-500 mt-1">Revenue: {fmt(loserRevenue)}</div>
        </div>
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-5">
          <div className="text-sm text-amber-400 mb-1">Avg Loss Per Item</div>
          <div className="text-2xl font-bold text-amber-400">{fmt(losers.length > 0 ? loserLoss / losers.length : 0)}</div>
          <div className="text-xs text-slate-500 mt-1">Bundling could recover some of this</div>
        </div>
      </div>

      <h4 className="text-md font-bold text-white mb-3">High-Loss Segments</h4>
      <p className="text-slate-500 text-xs mb-3">Category + MSRP combos where 40%+ of items lose money (10+ items min)</p>
      <div className="glass-card rounded-3xl overflow-hidden mb-6">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-400 text-xs border-b border-white/[0.08]">
                <th className="text-left px-4 py-3">Category</th>
                <th className="text-left px-4 py-3">MSRP Tier</th>
                <th className="text-right px-4 py-3">Items</th>
                <th className="text-right px-4 py-3">% Losing</th>
                <th className="text-right px-4 py-3">Total Loss</th>
                <th className="text-left px-4 py-3">Recommendation</th>
              </tr>
            </thead>
            <tbody>
              {dangerCombos.map((c, i) => {
                const lossRate = (c.losers / c.items) * 100
                const rec = lossRate > 60 ? 'Bundle immediately' : lossRate > 50 ? 'Consider bundling' : 'Monitor closely'
                const recColor = lossRate > 60 ? 'text-red-400' : lossRate > 50 ? 'text-amber-400' : 'text-yellow-400'
                return (
                  <tr key={i} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                    <td className="px-4 py-3 text-white">{c.cat}</td>
                    <td className="px-4 py-3 text-slate-300">{c.tier}</td>
                    <td className="px-4 py-3 text-right text-slate-300">{c.items}</td>
                    <td className="px-4 py-3 text-right text-red-400 font-semibold">{pct(lossRate)}</td>
                    <td className="px-4 py-3 text-right text-red-400">{fmt(c.profit)}</td>
                    <td className={`px-4 py-3 ${recColor} font-medium text-xs`}>{rec}</td>
                  </tr>
                )
              })}
              {dangerCombos.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">No high-loss segments found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <h4 className="text-md font-bold text-white mb-3">Categories by % Profitable</h4>
      <p className="text-slate-500 text-xs mb-3">Categories sorted by how often items sell at a profit (5+ items min)</p>
      <div className="glass-card rounded-3xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-400 text-xs border-b border-white/[0.08]">
                <th className="text-left px-4 py-3">Category</th>
                <th className="text-right px-4 py-3">Items</th>
                <th className="text-right px-4 py-3">% Profitable</th>
                <th className="text-right px-4 py-3">Avg Profit</th>
                <th className="text-right px-4 py-3">Total Profit</th>
              </tr>
            </thead>
            <tbody>
              {catData.map(d => (
                <tr key={d.key} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                  <td className="px-4 py-3 text-white">{d.key}</td>
                  <td className="px-4 py-3 text-right text-slate-300">{d.items}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`font-semibold ${d.pctProfitable >= 70 ? 'text-emerald-400' : d.pctProfitable >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                      {pct(d.pctProfitable)}
                    </span>
                  </td>
                  <td className={`px-4 py-3 text-right ${d.avgProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt(d.avgProfit)}</td>
                  <td className={`px-4 py-3 text-right font-bold ${d.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt(d.profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─── INVENTORY AGING VIEW ───────────────────────────────────────────────────────

function AgingView({ data, loading }) {
  const [groupBy, setGroupBy] = useState('age')

  if (loading || !data) {
    return <div className="text-slate-400 py-12 text-center">Loading inventory aging data...</div>
  }

  const { unsoldItems, totalManifest, totalSold } = data
  const totalUnsoldCost = unsoldItems.reduce((s, i) => s + (Number(i.cost_freight) || 0), 0)
  const avgCost = unsoldItems.length > 0 ? totalUnsoldCost / unsoldItems.length : 0

  // Group unsold items
  function groupItems(keyFn, orderFn) {
    const groups = {}
    unsoldItems.forEach(item => {
      const key = keyFn(item)
      if (!groups[key]) groups[key] = { items: 0, cost: 0, avgMsrp: 0, totalMsrp: 0 }
      groups[key].items++
      groups[key].cost += Number(item.cost_freight) || 0
      groups[key].totalMsrp += Number(item.msrp) || 0
    })
    let rows = Object.entries(groups).map(([key, g]) => ({
      key,
      items: g.items,
      cost: g.cost,
      avgCost: g.items > 0 ? g.cost / g.items : 0,
      avgMsrp: g.items > 0 ? g.totalMsrp / g.items : 0,
      pctOfUnsold: unsoldItems.length > 0 ? (g.items / unsoldItems.length) * 100 : 0,
    }))
    if (orderFn) rows = rows.sort(orderFn)
    return rows
  }

  let rows, label
  if (groupBy === 'age') {
    rows = groupItems(i => i.ageBucket, (a, b) => AGE_ORDER.indexOf(a.key) - AGE_ORDER.indexOf(b.key))
    label = 'Age Bucket'
  } else if (groupBy === 'category') {
    rows = groupItems(i => i.category || 'Unknown', (a, b) => b.cost - a.cost)
    label = 'Category'
  } else if (groupBy === 'zone') {
    rows = groupItems(i => normalizeZone(i.zone), (a, b) => b.cost - a.cost)
    label = 'Zone'
  } else if (groupBy === 'load') {
    rows = groupItems(i => i.loadName, (a, b) => b.cost - a.cost)
    label = 'Load'
  }

  return (
    <div>
      <h3 className="text-lg font-bold text-white mb-3">Inventory Aging</h3>
      <p className="text-slate-500 text-xs mb-4">Unsold inventory — what's sitting and tying up capital</p>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="glass-card rounded-3xl p-5">
          <div className="text-xs text-slate-400 mb-1">Unsold Items</div>
          <div className="text-2xl font-bold text-amber-400">{unsoldItems.length.toLocaleString()}</div>
          <div className="text-xs text-slate-500 mt-1">of {totalManifest.toLocaleString()} total</div>
        </div>
        <div className="glass-card rounded-3xl p-5">
          <div className="text-xs text-slate-400 mb-1">Capital Tied Up</div>
          <div className="text-2xl font-bold text-red-400">{fmt(totalUnsoldCost)}</div>
          <div className="text-xs text-slate-500 mt-1">at cost</div>
        </div>
        <div className="glass-card rounded-3xl p-5">
          <div className="text-xs text-slate-400 mb-1">Sell-Through Rate</div>
          <div className="text-2xl font-bold text-cyan-400">{pct(totalManifest > 0 ? (totalSold / totalManifest) * 100 : 0)}</div>
          <div className="text-xs text-slate-500 mt-1">{totalSold.toLocaleString()} sold</div>
        </div>
        <div className="glass-card rounded-3xl p-5">
          <div className="text-xs text-slate-400 mb-1">Avg Unsold Cost</div>
          <div className="text-2xl font-bold text-white">{fmt(avgCost)}</div>
          <div className="text-xs text-slate-500 mt-1">per item</div>
        </div>
      </div>

      {/* Group By Selector */}
      <div className="flex items-center gap-3 mb-4">
        <span className="text-sm text-slate-400">Group by:</span>
        {['age', 'category', 'zone', 'load'].map(g => (
          <button key={g} onClick={() => setGroupBy(g)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all
              ${groupBy === g
                ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                : 'text-slate-400 hover:bg-white/[0.06] border border-transparent'}`}>
            {g === 'age' ? 'Age' : g === 'category' ? 'Category' : g === 'zone' ? 'Zone' : 'Load'}
          </button>
        ))}
      </div>

      {/* Aging Table */}
      <div className="glass-card rounded-3xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-400 text-xs border-b border-white/[0.08]">
                <th className="text-left px-4 py-3">{label}</th>
                <th className="text-right px-4 py-3">Items</th>
                <th className="text-right px-4 py-3">% of Unsold</th>
                <th className="text-right px-4 py-3">Total Cost</th>
                <th className="text-right px-4 py-3">Avg Cost</th>
                <th className="text-right px-4 py-3">Avg MSRP</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(d => (
                <tr key={d.key} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                  <td className="px-4 py-3 text-white font-medium">{d.key}</td>
                  <td className="px-4 py-3 text-right text-slate-300">{d.items.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-slate-400">{pct(d.pctOfUnsold)}</td>
                  <td className="px-4 py-3 text-right text-amber-400 font-semibold">{fmt(d.cost)}</td>
                  <td className="px-4 py-3 text-right text-slate-300">{fmt(d.avgCost)}</td>
                  <td className="px-4 py-3 text-right text-slate-300">{fmt(d.avgMsrp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─── LOAD ROI VIEW ──────────────────────────────────────────────────────────────

function LoadROIView({ data, loading }) {
  if (loading || !data) {
    return <div className="text-slate-400 py-12 text-center">Loading load ROI data...</div>
  }

  const totalInvested = data.reduce((s, l) => s + l.totalCost, 0)
  const totalProfit = data.reduce((s, l) => s + l.profit, 0)
  const totalRevenue = data.reduce((s, l) => s + l.revenue, 0)
  const totalItems = data.reduce((s, l) => s + l.totalItems, 0)
  const totalSold = data.reduce((s, l) => s + l.sold, 0)
  const overallROI = totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0

  return (
    <div>
      <h3 className="text-lg font-bold text-white mb-3">Load ROI</h3>
      <p className="text-slate-500 text-xs mb-4">Which loads are making money and which aren't worth repeating</p>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="glass-card rounded-3xl p-5">
          <div className="text-xs text-slate-400 mb-1">Total Invested</div>
          <div className="text-2xl font-bold text-white">{fmt(totalInvested)}</div>
          <div className="text-xs text-slate-500 mt-1">{data.length} loads</div>
        </div>
        <div className="glass-card rounded-3xl p-5">
          <div className="text-xs text-slate-400 mb-1">Total Profit</div>
          <div className={`text-2xl font-bold ${totalProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt(totalProfit)}</div>
          <div className="text-xs text-slate-500 mt-1">{fmt(totalRevenue)} revenue</div>
        </div>
        <div className="glass-card rounded-3xl p-5">
          <div className="text-xs text-slate-400 mb-1">Overall ROI</div>
          <div className={`text-2xl font-bold ${overallROI >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{pct(overallROI)}</div>
          <div className="text-xs text-slate-500 mt-1">profit / cost</div>
        </div>
        <div className="glass-card rounded-3xl p-5">
          <div className="text-xs text-slate-400 mb-1">Sell-Through</div>
          <div className="text-2xl font-bold text-cyan-400">{pct(totalItems > 0 ? (totalSold / totalItems) * 100 : 0)}</div>
          <div className="text-xs text-slate-500 mt-1">{totalSold.toLocaleString()} of {totalItems.toLocaleString()}</div>
        </div>
      </div>

      {/* Load Table */}
      <div className="glass-card rounded-3xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-400 text-xs border-b border-white/[0.08]">
                <th className="text-left px-4 py-3">Load</th>
                <th className="text-left px-4 py-3">Date</th>
                <th className="text-right px-4 py-3">Items</th>
                <th className="text-right px-4 py-3">Cost</th>
                <th className="text-right px-4 py-3">Sold</th>
                <th className="text-right px-4 py-3">Sell-Through</th>
                <th className="text-right px-4 py-3">Revenue</th>
                <th className="text-right px-4 py-3">Profit</th>
                <th className="text-right px-4 py-3">ROI</th>
                <th className="text-right px-4 py-3">Margin</th>
              </tr>
            </thead>
            <tbody>
              {data.map(l => (
                <tr key={l.id} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                  <td className="px-4 py-3 text-white font-medium">{l.name}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{l.date || '—'}</td>
                  <td className="px-4 py-3 text-right text-slate-300">{l.totalItems.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-slate-300">{fmt(l.totalCost)}</td>
                  <td className="px-4 py-3 text-right text-slate-300">{l.sold.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={l.sellThrough >= 50 ? 'text-emerald-400' : l.sellThrough >= 25 ? 'text-amber-400' : 'text-red-400'}>
                      {pct(l.sellThrough)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-slate-300">{fmt(l.revenue)}</td>
                  <td className={`px-4 py-3 text-right font-bold ${l.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt(l.profit)}</td>
                  <td className={`px-4 py-3 text-right font-semibold ${l.roi >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{pct(l.roi)}</td>
                  <td className={`px-4 py-3 text-right ${l.avgMargin >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{pct(l.avgMargin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─── SHOW PERFORMANCE VIEW ──────────────────────────────────────────────────────

function ShowView({ items }) {
  // Group profitability items by show
  const shows = {}
  items.forEach(item => {
    const key = item.show_name || 'Unknown'
    if (!shows[key]) shows[key] = {
      name: key,
      date: item.show_date,
      items: 0,
      revenue: 0,
      cost: 0,
      profit: 0,
      profitable: 0,
    }
    const s = shows[key]
    s.items++
    s.revenue += Number(item.buyer_paid) || 0
    s.cost += Number(item.cost_freight) || 0
    s.profit += Number(item.profit) || 0
    if (Number(item.profit) > 0) s.profitable++
  })

  const showRows = Object.values(shows).map(s => ({
    ...s,
    avgSale: s.items > 0 ? s.revenue / s.items : 0,
    avgProfit: s.items > 0 ? s.profit / s.items : 0,
    margin: s.revenue > 0 ? (s.profit / s.revenue) * 100 : 0,
    pctProfitable: s.items > 0 ? (s.profitable / s.items) * 100 : 0,
  })).sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))

  // Averages across shows
  const avgItems = showRows.length > 0 ? showRows.reduce((s, r) => s + r.items, 0) / showRows.length : 0
  const avgShowProfit = showRows.length > 0 ? showRows.reduce((s, r) => s + r.profit, 0) / showRows.length : 0
  const bestShow = showRows.length > 0 ? showRows.reduce((best, r) => r.profit > best.profit ? r : best, showRows[0]) : null
  const worstShow = showRows.length > 0 ? showRows.reduce((worst, r) => r.profit < worst.profit ? r : worst, showRows[0]) : null

  return (
    <div>
      <h3 className="text-lg font-bold text-white mb-3">Show Performance</h3>
      <p className="text-slate-500 text-xs mb-4">How each show performed — find the winning formula</p>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="glass-card rounded-3xl p-5">
          <div className="text-xs text-slate-400 mb-1">Total Shows</div>
          <div className="text-2xl font-bold text-white">{showRows.length}</div>
          <div className="text-xs text-slate-500 mt-1">Jumpstart only</div>
        </div>
        <div className="glass-card rounded-3xl p-5">
          <div className="text-xs text-slate-400 mb-1">Avg Items/Show</div>
          <div className="text-2xl font-bold text-white">{Math.round(avgItems)}</div>
        </div>
        <div className="glass-card rounded-3xl p-5">
          <div className="text-xs text-slate-400 mb-1">Avg Profit/Show</div>
          <div className={`text-2xl font-bold ${avgShowProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt(avgShowProfit)}</div>
        </div>
        <div className="glass-card rounded-3xl p-5">
          <div className="text-xs text-slate-400 mb-1">Best Show</div>
          <div className="text-lg font-bold text-emerald-400">{fmt(bestShow?.profit || 0)}</div>
          <div className="text-xs text-slate-500 mt-1 truncate">{bestShow?.name || '—'}</div>
        </div>
      </div>

      {/* Show Table */}
      <div className="glass-card rounded-3xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-400 text-xs border-b border-white/[0.08]">
                <th className="text-left px-4 py-3">Show</th>
                <th className="text-left px-4 py-3">Date</th>
                <th className="text-right px-4 py-3">Items</th>
                <th className="text-right px-4 py-3">Revenue</th>
                <th className="text-right px-4 py-3">Avg Sale</th>
                <th className="text-right px-4 py-3">COGS</th>
                <th className="text-right px-4 py-3">Profit</th>
                <th className="text-right px-4 py-3">Profit/Item</th>
                <th className="text-right px-4 py-3">Margin</th>
                <th className="text-right px-4 py-3">% Profitable</th>
              </tr>
            </thead>
            <tbody>
              {showRows.map(s => (
                <tr key={s.name} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                  <td className="px-4 py-3 text-white font-medium max-w-[200px] truncate">{s.name}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{s.date || '—'}</td>
                  <td className="px-4 py-3 text-right text-slate-300">{s.items}</td>
                  <td className="px-4 py-3 text-right text-slate-300">{fmt(s.revenue)}</td>
                  <td className="px-4 py-3 text-right text-slate-300">{fmt(s.avgSale)}</td>
                  <td className="px-4 py-3 text-right text-slate-400">{fmt(s.cost)}</td>
                  <td className={`px-4 py-3 text-right font-bold ${s.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt(s.profit)}</td>
                  <td className={`px-4 py-3 text-right font-semibold ${s.avgProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt(s.avgProfit)}</td>
                  <td className={`px-4 py-3 text-right ${s.margin >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{pct(s.margin)}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`${s.pctProfitable >= 70 ? 'text-emerald-400' : s.pctProfitable >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                      {pct(s.pctProfitable)}
                    </span>
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
