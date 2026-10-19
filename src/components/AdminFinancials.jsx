import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import {
  loadBooks, inventoryAt, monthEnd, monthLabel, totals, sumLines, STATEMENT_ACCOUNTS,
} from '../lib/books'

// 2026 goal from the Targets tab ($200K net in 2026).
const TARGET_MONTHLY_NET = 23041
const TARGET_ANNUAL_NET = 200000

const fmt = (n, { dollar = false } = {}) => {
  if (n == null || Number.isNaN(n)) return '—'
  const v = Math.round(Number(n) * 100) / 100
  if (Math.abs(v) < 0.005) return '–'
  const s = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  return `${v < 0 ? '(' : ''}${dollar ? '$' : ''}${s}${v < 0 ? ')' : ''}`
}
const fmt2 = n => n == null ? '—' : `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const pct = (n, d) => (!d ? '—' : `${((n / d) * 100).toFixed(1)}%`)

export default function AdminFinancials() {
  const [year] = useState(2026)
  const [view, setView] = useState('management')
  const [books, setBooks] = useState(null)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(null)
  const [reloading, setReloading] = useState(false)

  async function reload() {
    setReloading(true)
    try {
      const b = await loadBooks(year)
      setBooks(b)
      setSelected(s => s || b.months[b.months.length - 1])
      setError(null)
    } catch (e) {
      console.error(e)
      setError(e.message || String(e))
    }
    setReloading(false)
  }
  useEffect(() => { reload() }, [year])

  if (error) return <div className="glass-card rounded-3xl p-6 text-red-300">Couldn’t load the books: {error}</div>
  if (!books) return <div className="text-slate-400 py-12 text-center">Building the books…</div>

  const ytd = { lines: sumLines(books.months.map(m => books.pnl[m])) }
  Object.assign(ytd, totals(ytd.lines, books.accounts))
  const closedCount = books.months.filter(m => books.pnl[m].status === 'closed').length

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black font-heading text-white mb-1">Financials {year}</h2>
          <p className="text-slate-400 text-sm">
            The official books. Whatnot revenue from monthly statements (ties to the 1099-K), expenses mapped to tax accounts,
            inventory valued at month-end. {closedCount} of {books.months.length} months closed — open months are live estimates.
          </p>
        </div>
        <div className="flex gap-2 print:hidden">
          {[['management', 'Business view'], ['tax', 'Tax view']].map(([v, l]) => (
            <button key={v} onClick={() => setView(v)}
              className={`px-4 py-2 rounded-2xl text-sm font-bold transition-all ${view === v ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-600/30' : 'glass-card text-white/70 hover:bg-white/10'}`}>
              {l}
            </button>
          ))}
          <button onClick={() => window.print()} className="px-4 py-2 rounded-2xl text-sm font-bold glass-card text-white/70 hover:bg-white/10">
            <iconify-icon icon="lucide:printer" width="16"></iconify-icon>
          </button>
        </div>
      </div>

      {view === 'management' && <Scorecard books={books} ytd={ytd} />}

      <div className="glass-card rounded-3xl p-4 md:p-6 overflow-x-auto">
        {view === 'management'
          ? <ManagementTable books={books} ytd={ytd} selected={selected} onSelect={setSelected} />
          : <TaxTable books={books} ytd={ytd} selected={selected} onSelect={setSelected} />}
      </div>

      {selected && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <BalanceSheet books={books} month={selected} />
          <ClosePanel books={books} month={selected} onChange={reload} busy={reloading} />
        </div>
      )}
    </div>
  )
}

// ── Business view ────────────────────────────────────────────────────────────
function mgmt(p) {
  const L = c => p.lines[c]?.amount || 0
  const whatnotGross = L('4000') + L('4001')
  const otherSales = L('4002') + L('4004')
  const refunds = L('4005')
  const netRevenue = whatnotGross + otherSales + refunds - p.whatnotFees
  const gp = netRevenue - p.cogs
  const labor = p.labor + L('8000')
  const opex = p.operating - p.whatnotFees
  const otherInc = p.other - L('8000')
  return { whatnotGross, otherSales, refunds, whatnotFees: p.whatnotFees, netRevenue, cogs: p.cogs, gp, labor, opex, otherInc, net: p.netIncome }
}

function Scorecard({ books, ytd }) {
  const y = mgmt(ytd)
  const nMonths = books.months.length
  const pace = TARGET_MONTHLY_NET * nMonths
  const last = books.pnl[books.months[books.months.length - 1]]
  const cards = [
    { label: 'Net revenue YTD', value: fmt(y.netRevenue, { dollar: true }), sub: `after ${fmt(y.whatnotFees, { dollar: true })} Whatnot fees` },
    { label: 'Gross margin YTD', value: pct(y.gp, y.netRevenue), sub: `${fmt(y.gp, { dollar: true })} gross profit · target 40%` },
    { label: 'Net profit YTD', value: fmt(y.net, { dollar: true }), sub: `target pace ${fmt(pace, { dollar: true })} (${pct(y.net, pace)})`, tone: y.net >= pace ? 'emerald' : 'amber' },
    { label: 'Inventory on hand', value: fmt(last.endInventory, { dollar: true }), sub: `${last.inventory?.source === 'live' ? 'live' : last.inventory?.source} · at cost` },
  ]
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map(c => (
        <div key={c.label} className="glass-card rounded-3xl p-5">
          <p className="text-xs uppercase tracking-wider text-slate-400 font-bold">{c.label}</p>
          <p className={`text-2xl font-black font-heading mt-1 ${c.tone === 'emerald' ? 'text-emerald-400' : c.tone === 'amber' ? 'text-amber-300' : 'text-white'}`}>{c.value}</p>
          <p className="text-xs text-slate-500 mt-1">{c.sub}</p>
          {c.label === 'Net profit YTD' && <p className="text-xs text-slate-500">2026 goal {fmt(TARGET_ANNUAL_NET, { dollar: true })}</p>}
        </div>
      ))}
    </div>
  )
}

function MonthHeader({ books, selected, onSelect }) {
  return (
    <thead>
      <tr className="text-xs text-slate-400">
        <th className="text-left font-semibold py-2 pr-4 sticky left-0 bg-[var(--bg-dark)] z-10 min-w-[220px]"></th>
        {books.months.map(m => {
          const p = books.pnl[m]
          return (
            <th key={m} className="text-right font-semibold px-2 py-2 min-w-[92px]">
              <button onClick={() => onSelect(m)} className={`rounded-lg px-2 py-1 ${selected === m ? 'bg-cyan-600/30 text-white' : 'hover:bg-white/10'}`}>
                {monthLabel(m).split(' ')[0]}
              </button>
              <div className={`text-[10px] font-bold ${p.status === 'closed' ? 'text-emerald-400' : p.estimated ? 'text-amber-300' : 'text-slate-500'}`}>
                {p.status === 'closed' ? 'CLOSED' : p.estimated ? 'ESTIMATE' : 'OPEN'}
              </div>
            </th>
          )
        })}
        <th className="text-right font-bold px-2 py-2 min-w-[100px] text-white">YTD</th>
      </tr>
    </thead>
  )
}

function Line({ label, values, bold, top, dim, indent, pctRow }) {
  return (
    <tr className={`${top ? 'border-t border-white/10' : ''}`}>
      <td className={`py-1.5 pr-4 sticky left-0 bg-[var(--bg-dark)] z-10 ${bold ? 'font-bold text-white' : dim ? 'text-slate-500' : 'text-white/80'} ${indent ? 'pl-4' : ''}`}>{label}</td>
      {values.map((v, i) => (
        <td key={i} className={`text-right px-2 py-1.5 font-mono tabular-nums ${bold ? 'font-bold text-white' : dim ? 'text-slate-500' : 'text-white/80'} ${i === values.length - 1 ? 'bg-white/5' : ''}`}>
          {pctRow ? v : fmt(v)}
        </td>
      ))}
    </tr>
  )
}

function ManagementTable({ books, ytd, selected, onSelect }) {
  const cols = [...books.months.map(m => mgmt(books.pnl[m])), mgmt(ytd)]
  const row = f => cols.map(f)
  return (
    <table className="w-full text-sm">
      <MonthHeader books={books} selected={selected} onSelect={onSelect} />
      <tbody>
        <Line label="Whatnot sales (gross)" values={row(c => c.whatnotGross)} />
        <Line label="Other sales (wholesale, direct)" values={row(c => c.otherSales)} />
        <Line label="Refunds & adjustments" values={row(c => c.refunds)} />
        <Line label="Whatnot fees" values={row(c => -c.whatnotFees)} />
        <Line label="Net revenue" values={row(c => c.netRevenue)} bold top />
        <Line label="Cost of goods sold" values={row(c => -c.cogs)} />
        <Line label="Gross profit" values={row(c => c.gp)} bold top />
        <Line label="Gross margin" values={row(c => pct(c.gp, c.netRevenue))} dim pctRow />
        <Line label="Labor (payroll, contractors, partners)" values={row(c => -c.labor)} />
        <Line label="Operating expenses" values={row(c => -c.opex)} />
        <Line label="Other income / (expense)" values={row(c => -c.otherInc)} />
        <Line label="Net profit" values={row(c => c.net)} bold top />
        <Line label="Net margin" values={row(c => pct(c.net, c.netRevenue))} dim pctRow />
        <Line label="vs. $23K/mo target" values={[...books.months.map(m => books.pnl[m].netIncome - TARGET_MONTHLY_NET), ytd.netIncome - TARGET_MONTHLY_NET * books.months.length]} dim />
        <Line label="Guaranteed payments to partners (in Labor)" values={[...books.months.map(m => books.pnl[m].guaranteedPayments), books.months.reduce((s, m) => s + books.pnl[m].guaranteedPayments, 0)]} dim top />
        {books.months.some(m => books.pnl[m].ownerDraws) && (
          <Line label="Owner draws (not an expense)" values={[...books.months.map(m => books.pnl[m].ownerDraws), books.months.reduce((s, m) => s + books.pnl[m].ownerDraws, 0)]} dim />
        )}
        <Line label="Capital invested" values={[...books.months.map(m => books.pnl[m].capitalIn), books.months.reduce((s, m) => s + books.pnl[m].capitalIn, 0)]} dim />
        <Line label="Inventory at month-end" values={[...books.months.map(m => books.pnl[m].endInventory), books.pnl[books.months[books.months.length - 1]].endInventory]} dim />
      </tbody>
    </table>
  )
}

// ── Tax view (bookkeeper layout) ─────────────────────────────────────────────
function TaxTable({ books, ytd, selected, onSelect }) {
  const sections = ['Sales', 'Cost of Sales', 'Labor', 'Operating', 'Other']
  const months = books.months.map(m => books.pnl[m])
  const all = [...months, ytd]
  const used = books.accounts.filter(a => a.section && all.some(p => Math.abs(p.lines[a.code]?.amount || 0) >= 0.005))
  const totalRow = { 'Sales': 'revenue', 'Cost of Sales': 'cogs', 'Labor': 'labor', 'Operating': 'operating', 'Other': 'other' }
  const totalLabel = { 'Sales': 'Total Revenues', 'Cost of Sales': 'Total Cost of Sales', 'Labor': 'Total Labor', 'Operating': 'Total Operating Expenses', 'Other': 'Total Other Expenses (Income)' }
  return (
    <table className="w-full text-sm">
      <MonthHeader books={books} selected={selected} onSelect={onSelect} />
      <tbody>
        {sections.map(sec => (
          <SectionRows key={sec} sec={sec} accounts={used.filter(a => a.section === sec)} all={all}
            total={all.map(p => p[totalRow[sec]])} totalLabel={totalLabel[sec]}
            after={sec === 'Cost of Sales' ? <Line label="Gross Profit" values={all.map(p => p.grossProfit)} bold top />
              : sec === 'Operating' ? <Line label="Operating Income" values={all.map(p => p.operatingIncome)} bold top /> : null} />
        ))}
        <Line label="Net Income (Loss)" values={all.map(p => p.netIncome)} bold top />
      </tbody>
    </table>
  )
}

function SectionRows({ sec, accounts, all, total, totalLabel, after }) {
  return (
    <>
      <tr><td className="pt-4 pb-1 font-bold text-cyan-300 text-xs uppercase tracking-wider sticky left-0 bg-[var(--bg-dark)]" colSpan={all.length + 1}>{sec}</td></tr>
      {accounts.map(a => (
        <Line key={a.code} label={`${a.name}${a.code === '7099' ? ' ⚠️' : ''}`} values={all.map(p => p.lines[a.code]?.amount || 0)} indent />
      ))}
      <Line label={totalLabel} values={total} bold top />
      {after}
    </>
  )
}

// ── Balance sheet ────────────────────────────────────────────────────────────
function BalanceSheet({ books, month }) {
  const bs = books.balanceSheets[month]
  const byType = t => books.accounts.filter(a => a.type === t && bs.rows[a.code])
  const Row = ({ a }) => {
    const r = bs.rows[a.code]
    const flag = r.source === 'statement' ? null : r.source
    return (
      <div className="flex justify-between gap-3 py-1 text-sm">
        <span className="text-white/80">{a.name}{flag && <span className={`ml-2 text-[10px] ${/opening|carried/.test(flag) ? 'text-amber-300' : 'text-slate-500'}`}>{flag}</span>}</span>
        <span className="font-mono tabular-nums text-white/90">{fmt2(r.amount)}</span>
      </div>
    )
  }
  return (
    <div className="glass-card rounded-3xl p-6">
      <h3 className="text-lg font-black font-heading text-white mb-1">Balance Sheet — {monthLabel(month)}</h3>
      <p className="text-xs text-slate-500 mb-4">As of {monthEnd(month)}. Cash & cards come from statement balances entered at close.</p>
      <p className="text-xs uppercase tracking-wider text-cyan-300 font-bold">Assets</p>
      {byType('asset').map(a => <Row key={a.code} a={a} />)}
      <Total label="Total Assets" v={bs.totalAssets} />
      <p className="text-xs uppercase tracking-wider text-cyan-300 font-bold mt-4">Liabilities</p>
      {byType('liability').map(a => <Row key={a.code} a={a} />)}
      <Total label="Total Liabilities" v={bs.totalLiabilities} />
      <p className="text-xs uppercase tracking-wider text-cyan-300 font-bold mt-4">Members’ Capital</p>
      {byType('equity').map(a => <Row key={a.code} a={a} />)}
      <div className="flex justify-between gap-3 py-1 text-sm"><span className="text-white/80">Net Income (year to date)</span><span className="font-mono tabular-nums text-white/90">{fmt2(bs.netIncomeYTD)}</span></div>
      <Total label="Total Members’ Capital" v={bs.totalEquity} />
      <div className={`mt-4 rounded-2xl px-4 py-3 text-sm font-bold ${Math.abs(bs.outOfBalance) < 1 ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-200'}`}>
        {Math.abs(bs.outOfBalance) < 1
          ? 'Balances ✓ — assets = liabilities + capital'
          : `Out of balance by ${fmt2(bs.outOfBalance)}${bs.missingStatements.length ? ` · ${bs.missingStatements.length} account(s) still need a statement balance` : ''}`}
      </div>
    </div>
  )
}
const Total = ({ label, v }) => (
  <div className="flex justify-between gap-3 py-1.5 mt-1 border-t border-white/10 text-sm font-bold text-white">
    <span>{label}</span><span className="font-mono tabular-nums">{fmt2(v)}</span>
  </div>
)

// ── Month close ──────────────────────────────────────────────────────────────
function ClosePanel({ books, month, onChange, busy }) {
  const p = books.pnl[month]
  const bs = books.balanceSheets[month]
  const me = monthEnd(month)
  const closed = p.status === 'closed'
  const [msg, setMsg] = useState('')
  const [bal, setBal] = useState({})
  const [override, setOverride] = useState({ value: '', note: '' })
  const [je, setJe] = useState({ debit: '', credit: '', amount: '', memo: '' })
  const glOptions = books.accounts

  useEffect(() => {
    const init = {}
    for (const c of STATEMENT_ACCOUNTS) {
      const b = books.balances.find(x => x.account === c && x.period_end === me)
      init[c] = b ? String(b.balance) : ''
    }
    setBal(init)
    setOverride({ value: p.close?.inventory_note ? String(p.close.inventory_value ?? '') : '', note: p.close?.inventory_note || '' })
    setMsg('')
  }, [month, books])

  async function run(label, fn) {
    setMsg(`${label}…`)
    try { await fn(); setMsg(`${label} ✓`); await onChange() } catch (e) { setMsg(`${label} failed: ${e.message}`) }
  }
  const upsertClose = fields => supabase.from('month_closes').upsert({ month, ...fields, updated_at: new Date().toISOString() }).then(r => { if (r.error) throw r.error })

  const snapshot = () => run('Inventory snapshot', async () => {
    const d = await inventoryAt(me)
    await upsertClose({ inventory_value: d.total, inventory_detail: d, inventory_note: null })
  })
  const saveOverride = () => run('Inventory override', async () => {
    if (!override.note.trim()) throw new Error('add a note explaining the value')
    await upsertClose({ inventory_value: Number(override.value), inventory_detail: { total: Number(override.value), override: true }, inventory_note: override.note.trim() })
  })
  const saveBalances = () => run('Statement balances', async () => {
    const rows = Object.entries(bal).filter(([, v]) => v !== '' && !Number.isNaN(Number(v)))
      .map(([account, v]) => ({ period_end: me, account, balance: Number(v), source: 'entered at close', updated_at: new Date().toISOString() }))
    if (rows.length) { const r = await supabase.from('account_balances').upsert(rows); if (r.error) throw r.error }
  })
  const setGl = (id, code) => run('Account assigned', async () => {
    const r = await supabase.from('expenses').update({ gl_account: code || null }).eq('id', id); if (r.error) throw r.error
  })
  const addJournal = () => run('Journal entry', async () => {
    const amt = Number(je.amount)
    if (!je.debit || !je.credit || !amt) throw new Error('pick both accounts and an amount')
    const batch = `manual-${month}-${Date.now()}`
    const r = await supabase.from('journal_entries').insert([
      { entry_date: me, account: je.debit, debit: amt, credit: 0, memo: je.memo, source: 'manual', batch },
      { entry_date: me, account: je.credit, debit: 0, credit: amt, memo: je.memo, source: 'manual', batch },
    ])
    if (r.error) throw r.error
    setJe({ debit: '', credit: '', amount: '', memo: '' })
  })
  const toggleClose = () => run(closed ? 'Reopened' : 'Month closed', async () => {
    if (!closed && p.close?.inventory_value == null) throw new Error('save an inventory snapshot (or override) first')
    await upsertClose({ status: closed ? 'open' : 'closed', closed_at: closed ? null : new Date().toISOString() })
  })

  const checks = [
    { ok: p.statementsLoaded.length === 2, label: `Whatnot statements loaded (${p.statementsLoaded.length}/2)` },
    { ok: p.unmapped.length === 0, label: `Expenses mapped to tax accounts${p.unmapped.length ? ` — ${p.unmapped.length} to review` : ''}` },
    { ok: p.close?.inventory_value != null, label: `Inventory snapshot saved${p.close?.inventory_value != null ? ` (${fmt2(p.close.inventory_value)}${p.close.inventory_note ? ', override' : ''})` : ''}` },
    { ok: bs.missingStatements.length === 0, label: `Statement balances entered${bs.missingStatements.length ? ` — ${bs.missingStatements.length} missing` : ''}` },
    { ok: Math.abs(bs.outOfBalance) < 1, label: `Balance sheet balances${Math.abs(bs.outOfBalance) >= 1 ? ` — off by ${fmt2(bs.outOfBalance)}` : ''}` },
  ]

  return (
    <div className="glass-card rounded-3xl p-6 space-y-5 print:hidden">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-black font-heading text-white">Close {monthLabel(month)}</h3>
          <p className="text-xs text-slate-500">{closed ? `Closed ${new Date(p.close.closed_at).toLocaleDateString()}` : 'Open — numbers can still change'}</p>
        </div>
        <button onClick={toggleClose} disabled={busy}
          className={`px-4 py-2 rounded-2xl text-sm font-bold transition-all disabled:opacity-50 ${closed ? 'glass-card text-white/70 hover:bg-white/10' : 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-lg shadow-emerald-600/30'}`}>
          {closed ? 'Reopen month' : 'Close month'}
        </button>
      </div>
      {msg && <p className="text-xs text-slate-300">{msg}</p>}

      <div className="space-y-1">
        {checks.map(c => (
          <div key={c.label} className="flex items-center gap-2 text-sm">
            <iconify-icon icon={c.ok ? 'lucide:check-circle-2' : 'lucide:circle-dashed'} class={c.ok ? 'text-emerald-400' : 'text-amber-300'} width="16"></iconify-icon>
            <span className={c.ok ? 'text-white/70' : 'text-white'}>{c.label}</span>
          </div>
        ))}
      </div>

      {/* Inventory */}
      <div className="border-t border-white/10 pt-4">
        <p className="text-sm font-bold text-white mb-1">Month-end inventory</p>
        <p className="text-xs text-slate-400 mb-2">
          Live value at {p.inventory?.date || me}: {fmt2(p.inventory?.total)}
          {p.inventory?.source === 'live' && <> — pools {fmt2(p.inventory.pools)}, in transit {fmt2(p.inventory.in_transit)}, manifested {fmt2(p.inventory.manifested)}, Kickstart intake {fmt2(p.inventory.kickstart_intake)}</>}
          . COGS includes the inventory change: begin {fmt2(p.beginInventory)} → end {fmt2(p.endInventory)}.
        </p>
        {!closed && (
          <div className="flex flex-wrap gap-2 items-center">
            <button onClick={snapshot} className="px-3 py-1.5 rounded-xl bg-cyan-600 text-white text-xs font-bold hover:bg-cyan-500">Save snapshot from app data</button>
            <input value={override.value} onChange={e => setOverride(o => ({ ...o, value: e.target.value }))} placeholder="override $"
              className="w-28 px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-xs" />
            <input value={override.note} onChange={e => setOverride(o => ({ ...o, note: e.target.value }))} placeholder="why (required)"
              className="flex-1 min-w-[140px] px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-xs" />
            <button onClick={saveOverride} className="px-3 py-1.5 rounded-xl glass-card text-white/80 text-xs font-bold hover:bg-white/10">Save override</button>
          </div>
        )}
      </div>

      {/* Statement balances */}
      <div className="border-t border-white/10 pt-4">
        <p className="text-sm font-bold text-white mb-2">Statement balances at {me}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
          {STATEMENT_ACCOUNTS.map(c => (
            <label key={c} className="flex items-center justify-between gap-2 text-xs">
              <span className="text-white/70 truncate">{books.acct[c]?.name}</span>
              <input value={bal[c] ?? ''} disabled={closed} onChange={e => setBal(b => ({ ...b, [c]: e.target.value }))}
                className="w-28 px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-white text-right font-mono disabled:opacity-60" />
            </label>
          ))}
        </div>
        {!closed && <button onClick={saveBalances} className="mt-2 px-3 py-1.5 rounded-xl bg-cyan-600 text-white text-xs font-bold hover:bg-cyan-500">Save balances</button>}
      </div>

      {/* Unmapped expenses */}
      {p.unmapped.length > 0 && (
        <div className="border-t border-white/10 pt-4">
          <p className="text-sm font-bold text-white mb-2">Expenses to map ({p.unmapped.length})</p>
          <div className="space-y-1 max-h-64 overflow-auto pr-1">
            {p.unmapped.map(e => (
              <div key={e.id} className="flex items-center gap-2 text-xs">
                <span className="text-slate-500 w-20 shrink-0">{e.date}</span>
                <span className="text-white/80 flex-1 truncate" title={e.description}>{e.description}</span>
                <span className="font-mono text-white/80 w-20 text-right">{fmt2(e.amount)}</span>
                <select disabled={closed} defaultValue="" onChange={ev => setGl(e.id, ev.target.value)}
                  className="w-44 px-1 py-1 rounded-lg bg-white/5 border border-white/10 text-white">
                  <option value="">— assign —</option>
                  {glOptions.filter(a => ['expense', 'cogs', 'other'].includes(a.type)).map(a => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Journal entry */}
      {!closed && (
        <div className="border-t border-white/10 pt-4">
          <p className="text-sm font-bold text-white mb-2">Adjusting entry (dated {me})</p>
          <div className="flex flex-wrap gap-2">
            {['debit', 'credit'].map(side => (
              <select key={side} value={je[side]} onChange={e => setJe(j => ({ ...j, [side]: e.target.value }))}
                className="w-48 px-1 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-xs">
                <option value="">{side === 'debit' ? 'Debit account' : 'Credit account'}</option>
                {glOptions.map(a => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}
              </select>
            ))}
            <input value={je.amount} onChange={e => setJe(j => ({ ...j, amount: e.target.value }))} placeholder="$"
              className="w-24 px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-xs" />
            <input value={je.memo} onChange={e => setJe(j => ({ ...j, memo: e.target.value }))} placeholder="memo"
              className="flex-1 min-w-[140px] px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-xs" />
            <button onClick={addJournal} className="px-3 py-1.5 rounded-xl bg-cyan-600 text-white text-xs font-bold hover:bg-cyan-500">Add</button>
          </div>
        </div>
      )}
    </div>
  )
}
