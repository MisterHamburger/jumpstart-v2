import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { loadBooks, monthLabel, sumLines, totals } from '../lib/books'

// One rulebook (docs/financial-rules.md). Closed months come straight from the
// books (Financials tab); open months are the same engine's estimate — item
// cost at vendor cost for COGS, Whatnot fees from statements or each account's
// actual fee rates. The Sales Pulse below is item-level and labeled as such.

const BUSINESS_START_YEAR = 2026
const GOAL = { year: 2026, netIncome: 200000 }
// Unit-economics targets (from the former Targets tab): 40% gross margin.
const PER_ITEM = { netRevenue: 12.5, maxCost: 9.32, grossProfit: 5.0 }

const LINE_GROUPS = [
  { label: 'Gross sales', codes: ['4000', '4001', '4004', '4002'], sign: 1, kind: 'sales' },
  { label: 'Refunds', codes: ['4005'], sign: 1, kind: 'refunds' },
  { label: 'Whatnot fees', codes: ['7080', '7085', '7090', '7095'], sign: -1, kind: 'fees' },
]
const LABOR = ['6000', '6005', '6060', '6050', '6070']
const WHATNOT_FEES = ['7080', '7085', '7090', '7095']

export default function AdminDashboard() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [period, setPeriod] = useState('month') // 'month' | 'ytd' | 'YYYY-MM-01'
  const [books, setBooks] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let live = true
    setBooks(null); setError(null)
    loadBooks(year, { fast: true }).then(b => { if (live) setBooks(b) }).catch(e => { if (live) setError(e.message) })
    return () => { live = false }
  }, [year])

  const view = useMemo(() => {
    if (!books) return null
    const months = books.months
    const current = months[months.length - 1]
    let sel
    if (period === 'ytd') sel = months
    else if (period === 'month') sel = [current]
    else sel = months.includes(period) ? [period] : [current]
    const lines = sumLines(sel.map(m => books.pnl[m]))
    const t = totals(lines, books.accounts)
    const closedCount = sel.filter(m => books.pnl[m].status === 'closed').length
    return { sel, lines, t, closedCount, estimated: sel.some(m => books.pnl[m].status !== 'closed') }
  }, [books, period])

  const years = []
  for (let y = now.getFullYear(); y >= BUSINESS_START_YEAR; y--) years.push(y)

  return (
    <div className="space-y-4">
      {/* Period controls */}
      <div className="flex flex-wrap items-center gap-2">
        {[['month', 'This month'], ['ytd', 'Year to date']].map(([v, l]) => (
          <button key={v} onClick={() => setPeriod(v)}
            className={`px-4 py-2 rounded-2xl text-sm font-bold transition-all ${period === v
              ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-600/30' : 'text-slate-400 hover:bg-white/[0.06]'}`}>{l}</button>
        ))}
        <select value={period.length > 7 ? period : ''} onChange={e => setPeriod(e.target.value || 'month')}
          className="bg-white/5 border border-white/10 text-white text-sm rounded-2xl px-4 py-2 focus:outline-none focus:border-cyan-500/50">
          <option value="">Pick a month…</option>
          {(books?.months || []).map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        <select value={year} onChange={e => { setYear(Number(e.target.value)); setPeriod('ytd') }}
          className="bg-white/5 border border-white/10 text-white text-sm rounded-2xl px-4 py-2 focus:outline-none focus:border-cyan-500/50">
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {error && <div className="glass-card rounded-3xl p-6 text-red-400 text-sm">Couldn’t load the books: {error}</div>}
      {!books && !error && <div className="text-slate-400 py-12 text-center">Loading…</div>}

      {view && (
        <>
          <StatusBadge view={view} books={books} />

          {/* Headline numbers */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KPI label="Gross sales" value={fmt(view.t.grossSales)} sub={`${fmt(view.t.revenueNetOfFees)} after Whatnot fees`} />
            <KPI label="Gross profit" value={fmt(view.t.grossProfitAfterFees)}
              sub={`${pct(view.t.grossProfitAfterFees, view.t.revenueNetOfFees)} of revenue after fees`} negative={view.t.grossProfitAfterFees < 0} />
            <KPI label="Labor + operating" value={fmt(view.t.labor + view.t.operatingExFees)} sub="excl. Whatnot fees" />
            <KPI label="Net income" value={fmt(view.t.netIncome)} sub={`${pct(view.t.netIncome, view.t.revenueNetOfFees)} of revenue after fees`} negative={view.t.netIncome < 0} accent />
          </div>

          {year === GOAL.year && <GoalCard books={books} />}

          <PnL view={view} books={books} />

          <MonthTable books={books} onPick={setPeriod} selected={view.sel.length === 1 ? view.sel[0] : null} />

          <SalesPulse />
        </>
      )}
    </div>
  )
}

function StatusBadge({ view, books }) {
  const { sel, closedCount, estimated } = view
  const open = sel.filter(m => books.pnl[m].status !== 'closed')
  let text
  if (!estimated) text = sel.length === 1 ? 'Closed books — ties to bank, card and Whatnot statements' : `All ${sel.length} months closed`
  else if (closedCount === 0) text = `Estimate — ${open.map(monthLabel).join(', ')} is open. COGS is item cost at vendor cost; shrinkage and write-offs are caught at close.`
  else text = `${closedCount} closed month${closedCount > 1 ? 's' : ''} + estimate for ${open.map(monthLabel).join(', ')}`
  return (
    <div className={`rounded-2xl px-4 py-2.5 text-xs border ${estimated
      ? 'border-amber-500/30 bg-amber-500/10 text-amber-200' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'}`}>
      {text}
    </div>
  )
}

function GoalCard({ books }) {
  const closed = books.months.filter(m => books.pnl[m].status === 'closed')
  const closedNI = closed.reduce((s, m) => s + books.pnl[m].netIncome, 0)
  const openMonths = books.months.filter(m => books.pnl[m].status !== 'closed')
  const openNI = openMonths.reduce((s, m) => s + books.pnl[m].netIncome, 0)
  const remainingMonths = 12 - closed.length
  const needed = (GOAL.netIncome - closedNI) / Math.max(remainingMonths, 1)
  const progress = Math.max(0, Math.min(1, closedNI / GOAL.netIncome))
  return (
    <div className="glass-card rounded-3xl p-6">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="font-bold font-heading text-lg">2026 goal: {fmt0(GOAL.netIncome)} net income</h3>
        <span className="text-xs text-slate-500">closed months only</span>
      </div>
      <div className="h-2 rounded-full bg-white/10 overflow-hidden mb-3">
        <div className="h-full bg-cyan-500" style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <Stat label={`Through ${closed.length ? monthLabel(closed[closed.length - 1]) : '—'}`} value={fmt0(closedNI)} negative={closedNI < 0} />
        <Stat label="Still needed" value={fmt0(GOAL.netIncome - closedNI)} />
        <Stat label={`Per month (${remainingMonths} left)`} value={fmt0(needed)} />
        <Stat label="Open month(s), estimate" value={fmt0(openNI)} negative={openNI < 0} />
      </div>
    </div>
  )
}

function PnL({ view, books }) {
  const { lines, t } = view
  const amt = c => lines[c]?.amount || 0
  const name = c => books.acct[c]?.name?.replace(/^Sales-/, '').replace(/^Whatnot-/, '') || c
  const opex = books.accounts.filter(a => a.section === 'Operating' && !WHATNOT_FEES.includes(a.code) && amt(a.code))
    .sort((a, b) => amt(b.code) - amt(a.code))
  const otherCodes = books.accounts.filter(a => a.section === 'Other' && amt(a.code))
  return (
    <div className="glass-card rounded-3xl p-6">
      <h3 className="font-bold font-heading text-lg mb-4">Income statement</h3>
      {LINE_GROUPS.map(g => {
        const total = g.kind === 'sales' ? t.grossSales : g.kind === 'refunds' ? -t.refunds : -t.whatnotFees
        if (!total && g.kind !== 'sales') return null
        return (
          <div key={g.label}>
            <Row label={g.label} value={total} bold />
            {g.kind !== 'refunds' && g.codes.filter(c => amt(c)).map(c =>
              <Row key={c} label={name(c)} value={g.sign * amt(c)} indent />)}
          </div>
        )
      })}
      <Row label="Revenue after Whatnot fees" value={t.revenueNetOfFees} bold rule />
      <Row label="Cost of goods sold" value={-t.cogs} bold />
      <Row label="Gross profit" value={t.grossProfitAfterFees} bold rule />
      <Row label="Labor" value={-t.labor} bold />
      {LABOR.filter(c => amt(c)).map(c => <Row key={c} label={name(c)} value={-amt(c)} indent />)}
      <Row label="Operating expenses" value={-t.operatingExFees} bold />
      {opex.map(a => <Row key={a.code} label={a.name} value={-amt(a.code)} indent />)}
      {otherCodes.length > 0 && (
        <>
          <Row label="Other income & expense" value={-t.other} bold />
          {otherCodes.map(a => <Row key={a.code} label={a.name} value={-amt(a.code)} indent />)}
        </>
      )}
      <Row label="Net income" value={t.netIncome} bold accent rule />
    </div>
  )
}

function MonthTable({ books, onPick, selected }) {
  return (
    <div className="glass-card rounded-3xl p-6 overflow-x-auto">
      <h3 className="font-bold font-heading text-lg mb-4">By month</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-slate-500 text-xs text-right">
            <th className="text-left font-medium pb-2">Month</th>
            <th className="font-medium pb-2">Gross sales</th>
            <th className="font-medium pb-2 hidden md:table-cell">After fees</th>
            <th className="font-medium pb-2">Gross margin</th>
            <th className="font-medium pb-2">Net income</th>
          </tr>
        </thead>
        <tbody>
          {books.months.map(m => {
            const p = books.pnl[m]
            return (
              <tr key={m} onClick={() => onPick(m)}
                className={`border-t border-white/[0.06] text-right cursor-pointer hover:bg-white/[0.03] ${selected === m ? 'bg-white/[0.05]' : ''}`}>
                <td className="text-left py-2 text-slate-300">
                  {monthLabel(m)}
                  {p.status !== 'closed' && <span className="ml-2 text-[10px] text-amber-300 uppercase">est.</span>}
                </td>
                <td className="text-slate-300">{fmt0(p.grossSales)}</td>
                <td className="text-slate-400 hidden md:table-cell">{fmt0(p.revenueNetOfFees)}</td>
                <td className="text-slate-400">{pct(p.grossProfitAfterFees, p.revenueNetOfFees)}</td>
                <td className={p.netIncome < 0 ? 'text-red-400' : 'text-emerald-400'}>{fmt0(p.netIncome)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// Item-level sales pulse for short windows (days, not months). Same fee lines as
// the books (statement rates), refunds separate, item cost at vendor cost. Not a
// P&L: labor and operating expenses aren't spread across days.
const PULSE_RANGES = [
  { v: 'today', l: 'Today', days: 0 },
  { v: '7d', l: 'Last 7 days', days: 6 },
  { v: 'month', l: 'This month', days: null },
  { v: '30d', l: 'Last 30 days', days: 29 },
]

function SalesPulse() {
  const [range, setRange] = useState('7d')
  const [channel, setChannel] = useState('all')
  const [data, setData] = useState(null)
  const [days, setDays] = useState(1)

  useEffect(() => {
    let live = true
    const d = new Date()
    const iso = x => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
    const end = iso(d)
    const r = PULSE_RANGES.find(x => x.v === range)
    const s = new Date(d)
    if (r.days == null) s.setDate(1); else s.setDate(s.getDate() - r.days)
    setDays(Math.round((d - s) / 86400000) + 1)
    setData(null)
    supabase.rpc('get_dashboard_summary', { date_cutoff: iso(s), date_end: end }).then(({ data: raw }) => {
      if (!live || !raw) return
      const pick = k => ['jumpstart', 'kickstart'].filter(c => channel === 'all' || c === channel)
        .reduce((t, c) => t + Number(raw[c]?.[k] || 0), 0)
      const sales = pick('whatnot_sales') + pick('offplatform_sales')
      const refunds = pick('adjustments')
      const fees = pick('commission') + pick('processing') + pick('show_boost') + pick('shipping')
      const cost = pick('cogs')
      setData({ items: pick('items'), sales, refunds, fees, cost, gp: sales - refunds - fees - cost, writeoffs: pick('writeoffs') })
    })
    return () => { live = false }
  }, [range, channel])

  const per = (v) => (data?.items ? v / data.items : 0)
  return (
    <div className="glass-card rounded-3xl p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h3 className="font-bold font-heading text-lg">Sales pulse</h3>
        <div className="flex flex-wrap gap-1">
          {[['all', 'All'], ['jumpstart', 'Jumpstart'], ['kickstart', 'Kickstart']].map(([v, l]) => (
            <button key={v} onClick={() => setChannel(v)}
              className={`px-3 py-1 rounded-xl text-xs font-bold ${channel === v ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:bg-white/[0.06]'}`}>{l}</button>
          ))}
        </div>
      </div>
      <p className="text-xs text-slate-500 mb-4">Item-level, from scanned sales: Whatnot fees from statements (estimated from statement rates for open months), item cost at vendor cost. Labor and operating costs are in the income statement above.</p>
      <div className="flex flex-wrap gap-1 mb-4">
        {PULSE_RANGES.map(r => (
          <button key={r.v} onClick={() => setRange(r.v)}
            className={`px-3 py-1 rounded-xl text-xs font-bold ${range === r.v ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/[0.06]'}`}>{r.l}</button>
        ))}
      </div>
      {!data ? <div className="text-slate-500 text-sm">Loading…</div> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Stat label="Items sold" value={data.items.toLocaleString()} sub={`${Math.round(data.items / days).toLocaleString()} / day`} />
            <Stat label="Gross sales" value={fmt0(data.sales)} sub={`${fmt0(data.sales / days)} / day`} />
            <Stat label="Gross profit (item level)" value={fmt0(data.gp)} sub={`${fmt0(data.gp / days)} / day`} negative={data.gp < 0} />
            <Stat label="Item cost / sales" value={pct(data.cost, data.sales)} sub={data.writeoffs ? `incl. ${fmt0(data.writeoffs)} write-offs` : ''} />
          </div>
          <div className="text-xs text-slate-500 mb-2">Per item vs. target (40% margin)</div>
          <div className="grid grid-cols-3 gap-3">
            <Target label="After fees" actual={per(data.sales - data.refunds - data.fees)} target={PER_ITEM.netRevenue} higherIsBetter />
            <Target label="Item cost" actual={per(data.cost)} target={PER_ITEM.maxCost} />
            <Target label="Gross profit" actual={per(data.gp)} target={PER_ITEM.grossProfit} higherIsBetter />
          </div>
        </>
      )}
    </div>
  )
}

function Target({ label, actual, target, higherIsBetter }) {
  const good = higherIsBetter ? actual >= target : actual <= target
  return (
    <div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] p-3">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`text-lg font-bold font-heading ${good ? 'text-emerald-400' : 'text-amber-300'}`}>{fmt(actual)}</div>
      <div className="text-[11px] text-slate-500">target {higherIsBetter ? '≥' : '≤'} {fmt(target)}</div>
    </div>
  )
}

function KPI({ label, value, sub, negative, accent }) {
  return (
    <div className="glass-card rounded-3xl p-5">
      <div className="text-xs text-slate-400 mb-1 font-medium">{label}</div>
      <div className={`text-xl font-bold font-heading ${negative ? 'text-red-400' : accent ? 'text-emerald-400' : 'text-white'}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  )
}

function Stat({ label, value, sub, negative }) {
  return (
    <div>
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`font-bold font-heading ${negative ? 'text-red-400' : 'text-white'}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </div>
  )
}

function Row({ label, value, bold, accent, indent, rule }) {
  const v = Number(value) || 0
  const color = accent ? (v >= 0 ? 'text-emerald-400' : 'text-red-400') : v < 0 ? 'text-red-300' : 'text-slate-200'
  return (
    <div className={`flex justify-between items-center ${indent ? 'py-1' : 'py-2'} ${rule ? 'border-t border-white/[0.1] mt-1' : ''}`}>
      <span className={indent ? 'pl-4 text-sm text-slate-400' : bold ? 'font-semibold text-white' : 'text-slate-300'}>{label}</span>
      <span className={`${indent ? 'text-sm text-slate-400' : color} ${bold ? 'font-bold' : ''}`}>{fmt(v)}</span>
    </div>
  )
}

const fmt = n => `${n < 0 ? '−' : ''}$${Math.abs(Number(n || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmt0 = n => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(Number(n || 0))).toLocaleString()}`
const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : '—')
