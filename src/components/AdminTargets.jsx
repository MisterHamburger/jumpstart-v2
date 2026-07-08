import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

// Gospel targets anchored on buy cost + 40% gross margin
const TARGETS = {
  annual: {
    label: '$500K/yr',
    netProfit: 500000,
    monthlyNet: 41667,
    monthlyGP: 83667,
    monthlyExpenses: 42000,
    monthlyItems: 16800,
    showsPerWeek: 16,
  },
  thisYear: {
    label: '$200K in 2026',
    netProfit: 200000,
    monthlyNet: 23041,
    monthlyGP: 51955,
    monthlyExpenses: 29000,
    monthlyItems: 10400,
    showsPerWeek: 10,
  },
  perItem: {
    buyCost: 7.50,
    grossProfit: 5.00,
    netRevenue: 12.50,
    hammerPrice: 14.70,
    cogs: 9.32,   // max COGS to hold 40% margin at current ASP
    margin: 40,
  },
  perShow: {
    items: 250,
    grossProfit: 1375,
    revenue: 4000,
  },
}

export default function AdminTargets() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]

    const [monthRes, allTimeRes] = await Promise.all([
      supabase.rpc('get_dashboard_summary', { date_cutoff: monthStart, date_end: null }),
      supabase.rpc('get_dashboard_summary', { date_cutoff: null, date_end: null }),
    ])

    const month = monthRes.data
    const allTime = allTimeRes.data

    // Calendar days this month
    const dayOfMonth = now.getDate()

    // Calendar days since launch (Feb 7, 2026)
    const launch = new Date('2026-02-07')
    const totalDays = Math.floor((now - launch) / (1000 * 60 * 60 * 24)) + 1

    if (month && allTime) {
      const mItems = Number(month.jumpstart?.items || 0) + Number(month.kickstart?.items || 0)
      const mNetRev = Number(month.jumpstart?.net_revenue || 0) + Number(month.kickstart?.net_revenue || 0)
      const mGP = Number(month.jumpstart?.gross_profit || 0) + Number(month.kickstart?.gross_profit || 0)
      const mCogs = Number(month.jumpstart?.cogs || 0) + Number(month.kickstart?.cogs || 0)
      const mExpenses = Number(month.expenses || 0) + Number(month.payroll || 0)

      const aItems = Number(allTime.jumpstart?.items || 0) + Number(allTime.kickstart?.items || 0)
      const aNetRev = Number(allTime.jumpstart?.net_revenue || 0) + Number(allTime.kickstart?.net_revenue || 0)
      const aGP = Number(allTime.jumpstart?.gross_profit || 0) + Number(allTime.kickstart?.gross_profit || 0)
      const aCogs = Number(allTime.jumpstart?.cogs || 0) + Number(allTime.kickstart?.cogs || 0)
      const aExpenses = Number(allTime.expenses || 0) + Number(allTime.payroll || 0)
      const aNetProfit = aGP - aExpenses

      setData({
        month: {
          items: mItems,
          netRevenue: mNetRev,
          grossProfit: mGP,
          cogs: mCogs,
          expenses: mExpenses,
          netProfit: mGP - mExpenses,
          days: dayOfMonth,
          itemsPerDay: mItems / dayOfMonth,
          gpPerDay: mGP / dayOfMonth,
          netRevPerItem: mItems > 0 ? mNetRev / mItems : 0,
          gpPerItem: mItems > 0 ? mGP / mItems : 0,
          cogsPerItem: mItems > 0 ? mCogs / mItems : 0,
          margin: mNetRev > 0 ? (mGP / mNetRev) * 100 : 0,
        },
        allTime: {
          items: aItems,
          netRevenue: aNetRev,
          grossProfit: aGP,
          cogs: aCogs,
          expenses: aExpenses,
          netProfit: aNetProfit,
          days: totalDays,
          itemsPerDay: aItems / totalDays,
          gpPerDay: aGP / totalDays,
          netRevPerItem: aItems > 0 ? aNetRev / aItems : 0,
          gpPerItem: aItems > 0 ? aGP / aItems : 0,
          cogsPerItem: aItems > 0 ? aCogs / aItems : 0,
          margin: aNetRev > 0 ? (aGP / aNetRev) * 100 : 0,
        },
      })
    }
    setLoading(false)
  }

  if (loading) return <div className="text-slate-400 py-12 text-center">Loading targets...</div>
  if (!data) return <div className="text-slate-400 py-12 text-center">No data available</div>

  const { month: m, allTime: a } = data
  const t = TARGETS

  // Monthly pace projections
  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate()
  const monthPace = {
    items: m.itemsPerDay * daysInMonth,
    gp: m.gpPerDay * daysInMonth,
    netProfit: (m.gpPerDay * daysInMonth) - m.expenses * (daysInMonth / m.days),
  }

  // Remaining 2026
  const endOfYear = new Date('2026-12-31')
  const remainingDays = Math.floor((endOfYear - new Date()) / (1000 * 60 * 60 * 24))
  const needed2026 = t.thisYear.netProfit - a.netProfit
  const requiredDailyNet = needed2026 / remainingDays

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-1 font-heading">Targets</h2>
      <p className="text-slate-500 text-sm mb-6">Gospel numbers and pace vs. goals</p>

      {/* Gospel Unit Economics */}
      <div className="glass-card rounded-3xl p-6 mb-6">
        <h3 className="font-bold font-heading text-lg mb-4 text-white">Gospel Unit Economics</h3>
        <p className="text-slate-500 text-xs mb-4">Anchored on buy cost + 40% gross profit margin on net revenue</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <TargetCard label="Buy Cost" target={t.perItem.buyCost} actual={m.cogsPerItem} format="$" lowerBetter />
          <TargetCard label="Net Rev / Item" target={t.perItem.netRevenue} actual={m.netRevPerItem} format="$" />
          <TargetCard label="Gross Profit / Item" target={t.perItem.grossProfit} actual={m.gpPerItem} format="$" />
          <TargetCard label="Gross Margin" target={t.perItem.margin} actual={m.margin} format="%" />
        </div>
      </div>

      {/* Monthly Pace vs $200K */}
      <div className="glass-card rounded-3xl p-6 mb-6">
        <h3 className="font-bold font-heading text-lg mb-1 text-white">Monthly Pace vs. $200K Target</h3>
        <p className="text-slate-500 text-xs mb-4">{m.days} days into the month | {remainingDays} days left in 2026 | ${fmt0(needed2026)} still needed</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <TargetCard label="Items / Month" target={t.thisYear.monthlyItems} actual={Math.round(monthPace.items)} format="#" />
          <TargetCard label="Gross Profit / Month" target={t.thisYear.monthlyGP} actual={monthPace.gp} format="$" />
          <TargetCard label="Net Profit / Month" target={t.thisYear.monthlyNet} actual={monthPace.netProfit} format="$" />
          <TargetCard label="Shows / Week" target={t.thisYear.showsPerWeek} actual={Math.round(m.itemsPerDay * 7 / t.perShow.items * 10) / 10} format="#" />
          <TargetCard label="Expenses / Month" target={t.thisYear.monthlyExpenses} actual={m.expenses * (daysInMonth / m.days)} format="$" lowerBetter />
          <TargetCard label="Required Daily Net" target={requiredDailyNet} actual={m.gpPerDay - (m.expenses / m.days)} format="$" />
        </div>
      </div>

      {/* Long-term $500K */}
      <div className="glass-card rounded-3xl p-6 mb-6">
        <h3 className="font-bold font-heading text-lg mb-1 text-white">$500K/yr Benchmark</h3>
        <p className="text-slate-500 text-xs mb-4">What the current month looks like against the long-term goal</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <TargetCard label="Items / Month" target={t.annual.monthlyItems} actual={Math.round(monthPace.items)} format="#" />
          <TargetCard label="Gross Profit / Month" target={t.annual.monthlyGP} actual={monthPace.gp} format="$" />
          <TargetCard label="Net Profit / Month" target={t.annual.monthlyNet} actual={monthPace.netProfit} format="$" />
          <TargetCard label="Shows / Week" target={t.annual.showsPerWeek} actual={Math.round(m.itemsPerDay * 7 / t.perShow.items * 10) / 10} format="#" />
          <TargetCard label="Expenses / Month" target={t.annual.monthlyExpenses} actual={m.expenses * (daysInMonth / m.days)} format="$" lowerBetter />
          <TargetCard label="Profit / Item" target={t.perItem.grossProfit} actual={m.gpPerItem} format="$" />
        </div>
      </div>

      {/* Per Show */}
      <div className="glass-card rounded-3xl p-6">
        <h3 className="font-bold font-heading text-lg mb-1 text-white">Per Show Benchmarks</h3>
        <p className="text-slate-500 text-xs mb-4">Every show should clear these minimums</p>
        <div className="grid grid-cols-3 gap-4">
          <GospelCard label="Items / Show" value="250" />
          <GospelCard label="GP / Show" value="$1,375" />
          <GospelCard label="Revenue / Show" value="$4,000" />
        </div>
      </div>
    </div>
  )
}

function TargetCard({ label, target, actual, format, lowerBetter }) {
  const hit = lowerBetter ? actual <= target : actual >= target
  const pct = target !== 0 ? (actual / target) * 100 : 0
  const borderColor = hit ? 'border-emerald-500/30' : pct >= 80 ? 'border-amber-500/30' : 'border-red-500/30'
  const bgColor = hit ? 'bg-emerald-500/5' : pct >= 80 ? 'bg-amber-500/5' : 'bg-red-500/5'
  const valueColor = hit ? 'text-emerald-400' : pct >= 80 ? 'text-amber-400' : 'text-red-400'

  const fmtVal = (v) => {
    if (format === '%') return `${v.toFixed(1)}%`
    if (format === '#') return v.toLocaleString()
    // Show 2 decimals for per-item values (< $100), whole numbers for monthly totals
    if (Math.abs(v) < 100) return `$${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    return `$${fmt0(v)}`
  }

  return (
    <div className={`rounded-2xl p-4 border ${borderColor} ${bgColor}`}>
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      <div className={`text-lg font-bold font-heading ${valueColor}`}>{fmtVal(actual)}</div>
      <div className="text-xs text-slate-500 mt-1">target: {fmtVal(target)}</div>
    </div>
  )
}

function GospelCard({ label, value }) {
  return (
    <div className="rounded-2xl p-4 border border-cyan-500/20 bg-cyan-500/5">
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      <div className="text-lg font-bold font-heading text-cyan-400">{value}</div>
      <div className="text-xs text-slate-500 mt-1">minimum</div>
    </div>
  )
}

function fmt0(n) {
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}
