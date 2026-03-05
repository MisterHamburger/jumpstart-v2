import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { calculateFees } from '../lib/fees'

const DATE_RANGES = [
  { label: 'All time', value: 'all' },
  { label: 'This month', value: 'month' },
  { label: 'Last month', value: 'lastmonth' },
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 30 days', value: '30d' },
  { label: 'Custom', value: 'custom' },
]

function getDateRange(range) {
  if (range === 'all') return { start: null, end: null }
  const now = new Date()
  let start, end = null
  if (range === 'month') {
    start = new Date(now.getFullYear(), now.getMonth(), 1)
  } else if (range === 'lastmonth') {
    start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    end = new Date(now.getFullYear(), now.getMonth(), 0) // last day of prev month
  } else if (range === '7d') {
    start = new Date(now); start.setDate(start.getDate() - 7)
  } else if (range === '30d') {
    start = new Date(now); start.setDate(start.getDate() - 30)
  }
  return {
    start: start ? start.toISOString().split('T')[0] : null,
    end: end ? end.toISOString().split('T')[0] : null,
  }
}

export default function AdminDashboard() {
  const [channel, setChannel] = useState('all')
  const [dateRange, setDateRange] = useState('all')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (dateRange === 'custom') {
      if (customStart) loadDashboard()
    } else {
      loadDashboard()
    }
  }, [dateRange, customStart, customEnd])

  async function loadDashboard() {
    setLoading(true)

    let start, end
    if (dateRange === 'custom') {
      start = customStart || null
      end = customEnd || null
    } else {
      const range = getDateRange(dateRange)
      start = range.start
      end = range.end
    }

    const { data: raw, error } = await supabase.rpc('get_dashboard_summary', {
      date_cutoff: start,
      date_end: end,
    })

    if (error || !raw) {
      console.error('Dashboard RPC error:', error?.message)
      setData(null)
      setLoading(false)
      return
    }

    // Compute Kickstart fees from revenue
    const kRevenue = Number(raw.kickstart.revenue) || 0
    const kItems = Number(raw.kickstart.items) || 0
    let kFees = 0, kNetRevenue = 0
    if (kItems > 0 && kRevenue > 0) {
      const avgBp = kRevenue / kItems
      const { totalFees: avgFee } = calculateFees(avgBp)
      kFees = avgFee * kItems
      kNetRevenue = kRevenue - kFees
    }
    const kCogs = Number(raw.kickstart.cogs) || 0
    const kGrossProfit = kNetRevenue - kCogs

    const jumpstart = {
      items: Number(raw.jumpstart.items) || 0,
      revenue: Number(raw.jumpstart.revenue) || 0,
      netRevenue: Number(raw.jumpstart.net_revenue) || 0,
      grossProfit: Number(raw.jumpstart.gross_profit) || 0,
      cogs: Number(raw.jumpstart.cogs) || 0,
    }
    jumpstart.fees = jumpstart.revenue - jumpstart.netRevenue
    jumpstart.margin = jumpstart.revenue > 0 ? (jumpstart.grossProfit / jumpstart.revenue) * 100 : 0

    const kickstart = {
      items: kItems, revenue: kRevenue, netRevenue: kNetRevenue,
      grossProfit: kGrossProfit, cogs: kCogs, fees: kFees,
    }
    kickstart.margin = kickstart.revenue > 0 ? (kickstart.grossProfit / kickstart.revenue) * 100 : 0

    const combined = {
      items: jumpstart.items + kickstart.items,
      revenue: jumpstart.revenue + kickstart.revenue,
      netRevenue: jumpstart.netRevenue + kickstart.netRevenue,
      grossProfit: jumpstart.grossProfit + kickstart.grossProfit,
      cogs: jumpstart.cogs + kickstart.cogs,
      fees: jumpstart.fees + kickstart.fees,
    }
    combined.margin = combined.revenue > 0 ? (combined.grossProfit / combined.revenue) * 100 : 0

    setData({
      jumpstart, kickstart, combined,
      jInventoryValue: Number(raw.inventory.js_value) || 0,
      kInventoryValue: Number(raw.inventory.ks_value) || 0,
      jInventoryCount: Number(raw.inventory.js_count) || 0,
      kInventoryCount: Number(raw.inventory.ks_count) || 0,
      totalExpenses: Number(raw.expenses) || 0,
      totalPayroll: Number(raw.payroll) || 0,
    })
    setLoading(false)
  }

  const stats = data
    ? channel === 'Jumpstart' ? data.jumpstart
    : channel === 'Kickstart' ? data.kickstart
    : data.combined
    : null

  const inventoryValue = data
    ? channel === 'Jumpstart' ? data.jInventoryValue
    : channel === 'Kickstart' ? data.kInventoryValue
    : data.jInventoryValue + data.kInventoryValue
    : 0

  const inventoryCount = data
    ? channel === 'Jumpstart' ? data.jInventoryCount
    : channel === 'Kickstart' ? data.kInventoryCount
    : data.jInventoryCount + data.kInventoryCount
    : 0

  const isSummary = channel === 'all'
  const netProfit = stats ? stats.grossProfit - (data?.totalExpenses || 0) - (data?.totalPayroll || 0) : 0
  const netMargin = stats && stats.revenue > 0 ? (netProfit / stats.revenue) * 100 : 0

  return (
    <div>
      {/* Channel tabs */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-2">
          {['all', 'Jumpstart', 'Kickstart'].map(c => (
            <button key={c} onClick={() => setChannel(c)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all
                ${channel === c
                  ? 'bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-lg shadow-purple-500/25'
                  : 'text-slate-400 hover:bg-white/[0.06]'}`}>
              {c === 'all' ? 'Summary' : c}
            </button>
          ))}
        </div>
      </div>

      {/* Date range */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <span className="text-sm text-slate-400">Date range:</span>
        <select value={dateRange} onChange={e => setDateRange(e.target.value)}
          className="bg-slate-800 border border-white/[0.1] text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-violet-500">
          {DATE_RANGES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        {dateRange === 'custom' && (
          <div className="flex items-center gap-2">
            <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
              className="bg-slate-800 border border-white/[0.1] text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-violet-500" />
            <span className="text-slate-500 text-sm">to</span>
            <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
              className="bg-slate-800 border border-white/[0.1] text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-violet-500" />
          </div>
        )}
      </div>

      {loading ? (
        <div className="text-slate-400 py-12 text-center">Loading dashboard...</div>
      ) : !stats ? (
        <div className="text-slate-400 py-12 text-center">No data yet. Upload manifests and show CSVs in Inputs.</div>
      ) : (
        <>
          {/* Row 1: Revenue, COGS, Gross Profit, Inventory */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <GradientKPI label="Revenue" value={fmt(stats.revenue)} sub={`${stats.items.toLocaleString()} items sold`} />
            <GradientKPI label="COGS" value={fmt(stats.cogs)} sub="Cost of goods sold" />
            <GradientKPI label="Gross Profit" value={fmt(stats.grossProfit)} sub={`${stats.margin.toFixed(1)}% margin`}
              negative={stats.grossProfit < 0} />
            <GradientKPI label="Inventory" value={fmt(inventoryValue)} sub={`${inventoryCount.toLocaleString()} items`} />
          </div>

          {/* Row 2 (Summary only): Expenses, Payroll, Net Profit */}
          {isSummary && (
            <div className="grid grid-cols-3 gap-3 mb-3">
              <GradientKPI label="Expenses" value={fmt(data.totalExpenses)} />
              <GradientKPI label="Payroll" value={fmt(data.totalPayroll)} />
              <GradientKPI label="Net Profit" value={fmt(netProfit)} sub={netProfit !== 0 ? `${netMargin.toFixed(1)}% net margin` : 'N/A net margin'}
                negative={netProfit < 0} />
            </div>
          )}

          {/* P&L Summary Table */}
          <div className="bg-slate-800/60 backdrop-blur-xl border border-white/[0.08] rounded-2xl p-5 mt-4">
            <h3 className="font-bold text-lg mb-4">P&L Summary</h3>
            <div className="space-y-0">
              <PLRow label="Total Revenue" value={stats.revenue} />
              <PLRow label="COGS" value={-stats.cogs} />
              <PLRow label="Gross Profit" value={stats.grossProfit} bold />
              {isSummary && (
                <>
                  <PLRow label="Expenses" value={-data.totalExpenses} />
                  <PLRow label="Payroll" value={-data.totalPayroll} />
                  <div className="border-t border-white/[0.1] mt-2 pt-2">
                    <PLRow label="Net Profit" value={netProfit} bold accent />
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function fmt(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function GradientKPI({ label, value, sub, negative }) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-violet-600/30 via-purple-600/20 to-fuchsia-600/10 border border-white/[0.08] p-4">
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      <div className={`text-xl font-bold ${negative ? 'text-red-400' : 'text-white'}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  )
}

function PLRow({ label, value, bold, accent }) {
  const v = Number(value) || 0
  const color = accent ? (v >= 0 ? 'text-green-400' : 'text-red-400') : v < 0 ? 'text-red-400' : 'text-slate-200'
  return (
    <div className={`flex justify-between items-center py-2.5 ${bold ? '' : 'border-b border-white/[0.04]'}`}>
      <span className={bold ? 'font-semibold text-white' : 'text-slate-300'}>{label}</span>
      <span className={`${color} ${bold ? 'font-bold text-lg' : ''}`}>{fmt(v)}</span>
    </div>
  )
}
