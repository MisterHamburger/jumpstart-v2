import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const DATE_RANGES = [
  { label: 'All time (Beginning 2/7/26)', value: 'all' },
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
    end = new Date(now.getFullYear(), now.getMonth(), 0)
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

    const build = (r) => ({
      items: Number(r.items) || 0,
      revenue: Number(r.revenue) || 0,
      fees: Number(r.fees) || 0,
      netRevenue: Number(r.net_revenue) || 0,
      cogs: Number(r.cogs) || 0,
      grossProfit: Number(r.gross_profit) || 0,
    })

    const jumpstart = build(raw.jumpstart)
    const kickstart = build(raw.kickstart)

    const combined = {
      items: jumpstart.items + kickstart.items,
      revenue: jumpstart.revenue + kickstart.revenue,
      fees: jumpstart.fees + kickstart.fees,
      netRevenue: jumpstart.netRevenue + kickstart.netRevenue,
      cogs: jumpstart.cogs + kickstart.cogs,
      grossProfit: jumpstart.grossProfit + kickstart.grossProfit,
    }

    setData({
      jumpstart, kickstart, combined,
      totalOpex: Number(raw.expenses) || 0,
      totalPayroll: Number(raw.payroll) || 0,
      loadCost: Number(raw.load_cost) || 0,
      loadFreight: Number(raw.load_freight) || 0,
      sourcing: Number(raw.sourcing) || 0,
      sourcingDirect: Number(raw.sourcing_direct) || 0,
      sourcingVenmo: Number(raw.sourcing_venmo) || 0,
      sourcingUps: Number(raw.sourcing_ups) || 0,
    })
    setLoading(false)
  }


  const stats = data
    ? channel === 'Jumpstart' ? data.jumpstart
    : channel === 'Kickstart' ? data.kickstart
    : data.combined
    : null

  const isSummary = channel === 'all'
  const avgSalePrice = stats && stats.items > 0 ? stats.revenue / stats.items : 0
  const profitPerUnit = stats && stats.items > 0 ? stats.grossProfit / stats.items : 0
  const margin = stats && stats.revenue > 0 ? (stats.grossProfit / stats.revenue) * 100 : 0
  const netProfit = stats ? stats.grossProfit - (data?.totalOpex || 0) - (data?.totalPayroll || 0) : 0

  return (
    <div>
      {/* Channel tabs */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-2">
          {['all', 'Jumpstart', 'Kickstart'].map(c => (
            <button key={c} onClick={() => setChannel(c)}
              className={`px-4 py-2 rounded-2xl text-sm font-bold transition-all
                ${channel === c
                  ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-600/30 glow-cyan'
                  : 'text-slate-400 hover:bg-white/[0.06] border border-transparent'}`}>
              {c === 'all' ? 'Summary' : c}
            </button>
          ))}
        </div>
      </div>

      {/* Date range */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <span className="text-sm text-slate-400">Date range:</span>
        <select value={dateRange} onChange={e => setDateRange(e.target.value)}
          className="bg-white/5 border border-white/10 text-white text-sm rounded-2xl px-4 py-2 focus:outline-none focus:border-cyan-500/50 focus:ring-4 focus:ring-cyan-500/10 transition-all">
          {DATE_RANGES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        {dateRange === 'custom' && (
          <div className="flex items-center gap-2">
            <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
              className="bg-white/5 border border-white/10 text-white text-sm rounded-2xl px-4 py-2 focus:outline-none focus:border-cyan-500/50 focus:ring-4 focus:ring-cyan-500/10 transition-all" />
            <span className="text-slate-500 text-sm">to</span>
            <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
              className="bg-white/5 border border-white/10 text-white text-sm rounded-2xl px-4 py-2 focus:outline-none focus:border-cyan-500/50 focus:ring-4 focus:ring-cyan-500/10 transition-all" />
          </div>
        )}
      </div>

      {loading ? (
        <div className="text-slate-400 py-12 text-center">Loading dashboard...</div>
      ) : !stats ? (
        <div className="text-slate-400 py-12 text-center">No data yet. Upload manifests and show CSVs in Inputs.</div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <GradientKPI label="Avg Sale Price" value={fmt(avgSalePrice)} sub={`${stats.items.toLocaleString()} items sold`} />
            <GradientKPI label="Profit / Unit" value={fmt(profitPerUnit)} negative={profitPerUnit < 0} />
            <GradientKPI label="Gross Profit" value={fmt(stats.grossProfit)} sub={`${margin.toFixed(1)}% margin`}
              negative={stats.grossProfit < 0} />
            {isSummary ? (
              <GradientKPI label="Net Profit" value={fmt(netProfit)}
                negative={netProfit < 0} />
            ) : (
              <GradientKPI label="Revenue" value={fmt(stats.netRevenue)}
                sub="net of fees" />
            )}
          </div>

          {/* P&L Summary Table */}
          <div className="glass-card rounded-3xl p-6 mt-4">
            <h3 className="font-bold font-heading text-lg mb-4">P&L Summary</h3>
            <div className="space-y-0">
              <PLRow label="Revenue (net of Whatnot fees)" value={stats.netRevenue} bold />
              {isSummary && (
                <>
                  <PLRow label="Jumpstart" value={data.jumpstart.netRevenue} indent />
                  <PLRow label="Kickstart" value={data.kickstart.netRevenue} indent />
                </>
              )}

              <PLRow label="Cost of Goods Sold (COGS)" value={-stats.cogs} bold />
              {isSummary && (
                <>
                  <PLRow label="Jumpstart" value={-data.jumpstart.cogs} indent />
                  <PLRow label="Kickstart" value={-data.kickstart.cogs} indent />
                </>
              )}

              <div className="border-t border-white/[0.1] mt-2 pt-2">
                <PLRow label="Gross Profit" value={stats.grossProfit} bold />
              </div>

              {isSummary && (
                <>
                  <div className="mt-4">
                    <PLRow label="OpEx" value={-(data?.totalOpex || 0)} />
                    <PLRow label="Payroll" value={-(data?.totalPayroll || 0)} />
                    <PLRow label="Total Expenses" value={-((data?.totalOpex || 0) + (data?.totalPayroll || 0))} bold />
                  </div>

                  <div className="border-t border-white/[0.1] mt-2 pt-2">
                    <PLRow label="Net Profit" value={netProfit} bold accent />
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Cashflow Summary */}
          <div className="glass-card rounded-3xl p-6 mt-4">
            <h3 className="font-bold font-heading text-lg mb-4">Cashflow Summary</h3>
            <div className="space-y-0">
              <PLRow label="Revenue (net of Whatnot fees)" value={stats.netRevenue} bold />
              {isSummary && (
                <>
                  <PLRow label="Jumpstart" value={data.jumpstart.netRevenue} indent />
                  <PLRow label="Kickstart" value={data.kickstart.netRevenue} indent />
                </>
              )}

              {(() => {
                const jsInvPurchases = (data?.loadCost || 0) + (data?.loadFreight || 0)
                const ksInvPurchases = data?.sourcing || 0
                const totalInvPurchases = jsInvPurchases + ksInvPurchases

                const invPurchases = channel === 'Jumpstart' ? jsInvPurchases
                  : channel === 'Kickstart' ? ksInvPurchases
                  : totalInvPurchases

                // Venmo is now categorized as INVENTORY (not PAYROLL), no deduction needed
                const cashflowPayroll = (data?.totalPayroll || 0)

                const cashflow = isSummary
                  ? stats.netRevenue - totalInvPurchases - (data?.totalOpex || 0) - cashflowPayroll
                  : stats.netRevenue - invPurchases

                return (
                  <>
                    <PLRow label="Inventory Purchases" value={-invPurchases} bold />
                    {isSummary && (
                      <>
                        <PLRow label="Jumpstart" value={-jsInvPurchases} indent />
                        <PLRow label="Kickstart" value={-ksInvPurchases} indent />
                      </>
                    )}
                    {channel === 'Jumpstart' && (
                      <>
                        <PLRow label="Load Costs" value={-(data?.loadCost || 0)} indent />
                        <PLRow label="Freight" value={-(data?.loadFreight || 0)} indent />
                      </>
                    )}
                    {channel === 'Kickstart' && (
                      <>
                        <PLRow label="Sourcing" value={-(data?.sourcing || 0)} indent />
                      </>
                    )}

                    {isSummary && (
                      <>
                        <PLRow label="OpEx" value={-(data?.totalOpex || 0)} />
                        <PLRow label="Payroll" value={-cashflowPayroll} />
                      </>
                    )}

                    <div className="border-t border-white/[0.1] mt-2 pt-2">
                      <PLRow label="Cashflow" value={cashflow} bold accent />
                    </div>
                  </>
                )
              })()}
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
    <div className="glass-card rounded-3xl p-5">
      <div className="text-xs text-slate-400 mb-1 font-medium">{label}</div>
      <div className={`text-xl font-bold font-heading ${negative ? 'text-red-400' : 'text-white'}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  )
}

function PLRow({ label, value, bold, accent, indent }) {
  const v = Number(value) || 0
  const color = accent ? (v >= 0 ? 'text-emerald-400' : 'text-red-400') : v < 0 ? 'text-red-400' : 'text-slate-200'
  return (
    <div className={`flex justify-between items-center py-2.5 ${bold ? '' : 'border-b border-white/[0.04]'}`}>
      <span className={`${bold ? 'font-semibold text-white' : 'text-slate-300'} ${indent ? 'pl-4 text-sm text-slate-400' : ''}`}>{label}</span>
      <span className={`${color} ${bold ? 'font-bold text-lg' : ''} ${indent ? 'text-sm text-slate-400' : ''}`}>{fmt(v)}</span>
    </div>
  )
}
