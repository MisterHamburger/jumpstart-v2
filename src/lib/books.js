// Books engine: builds the monthly income statement and month-end balance
// sheet (income-tax basis, the 2025 bookkeeper's chart of accounts) from
//   - whatnot_statements   gross Whatnot revenue + fees (ties to the 1099-K)
//   - expenses_gl          bank/card expenses resolved to tax accounts
//   - journal_entries      opening balances + adjusting entries
//   - month_closes         month-end inventory (closed months)
//   - account_balances     month-end statement balances (cash, cards, …)
// Months with no Whatnot statement yet fall back to the dashboard's item-level
// estimate, and open months value inventory live, so the current month is
// always visible — flagged as an estimate until it's closed.
import { supabase, fetchAll } from './supabase'

export const STORE_REVENUE = { jumpstartdeals: '4000', kickstartdeals: '4001' }
const STORE_CHANNEL = { jumpstartdeals: 'jumpstart', kickstartdeals: 'kickstart' }
// Whatnot's commission share of the dashboard's 12.3% fee estimate.
const EST_COMMISSION = 0.072
const EST_TOTAL_FEES = 0.123

// Balance-sheet accounts whose month-end value comes from a statement.
export const STATEMENT_ACCOUNTS = ['1000', '1001', '1002', '1003', '1004', '1011', '1012', '1013', '2001', '2002', '2003']

const pad = n => String(n).padStart(2, '0')
export const monthEnd = m => {
  const [y, mo] = m.split('-').map(Number)
  return `${y}-${pad(mo)}-${pad(new Date(y, mo, 0).getDate())}`
}
const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
export const monthLabel = m =>
  new Date(`${m}T12:00:00`).toLocaleString('en-US', { month: 'short', year: 'numeric' })

// Jan..current month for the current year; Jan..Dec for past years.
export function monthsOf(year) {
  const now = new Date()
  const last = year < now.getFullYear() ? 12 : now.getMonth() + 1
  return Array.from({ length: last }, (_, i) => `${year}-${pad(i + 1)}-01`)
}

const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100

// Live month-end inventory at cost from the app's item/pool data.
export async function inventoryAt(date) {
  const [pools, transit, manifested, ks] = await Promise.all([
    supabase.rpc('pool_inventory_at', { p_date: date }),
    supabase.rpc('in_transit_inventory_at', { p_date: date }),
    supabase.rpc('manifested_inventory_at', { p_date: date }),
    supabase.rpc('kickstart_intake_inventory_at', { p_date: date }),
  ])
  for (const r of [pools, transit, manifested, ks]) if (r.error) throw r.error
  const poolRows = (pools.data || []).filter(p => Number(p.units) !== 0)
  const sum = (rows, f) => (rows || []).reduce((s, r) => s + Number(r[f] || 0), 0)
  const detail = {
    date,
    pools: round2(sum(poolRows, 'value')),
    pool_rows: poolRows.map(p => ({ pool: p.pool_tag, units: Number(p.units), avg_cost: Number(p.avg_cost), value: Number(p.value) })),
    in_transit: round2(sum(transit.data, 'value')),
    manifested: round2(Number(manifested.data?.[0]?.value || 0)),
    kickstart_intake: round2(Number(ks.data?.[0]?.value || 0)),
  }
  detail.total = round2(detail.pools + detail.in_transit + detail.manifested + detail.kickstart_intake)
  return detail
}

export async function loadBooks(year) {
  const start = `${year}-01-01`, end = `${year}-12-31`
  const months = monthsOf(year)
  const [acctRes, stmtRes, expenses, journal, closeRes, balRes] = await Promise.all([
    supabase.from('gl_accounts').select('*').order('sort'),
    supabase.from('whatnot_statements').select('*').gte('period_start', start).lte('period_end', end),
    fetchAll(() => supabase.from('expenses_gl')
      .select('id, date, description, amount, category, gl_account, gl_code, gl_source')
      .gte('date', start).lte('date', end)),
    fetchAll(() => supabase.from('journal_entries').select('*').lte('entry_date', end)),
    supabase.from('month_closes').select('*').gte('month', start).lte('month', end),
    supabase.from('account_balances').select('*').lte('period_end', end),
  ])
  for (const r of [acctRes, stmtRes, closeRes, balRes]) if (r.error) throw r.error

  const accounts = acctRes.data || []
  const acct = Object.fromEntries(accounts.map(a => [a.code, a]))
  const closes = Object.fromEntries((closeRes.data || []).map(c => [c.month, c]))
  const statements = (stmtRes.data || []).filter(s => s.period_start.endsWith('-01') && s.period_end === monthEnd(s.period_start))

  // Whatnot estimates for months that don't have a statement yet.
  const needEstimate = months.filter(m => Object.keys(STORE_REVENUE).some(a =>
    !statements.find(s => s.account === a && s.period_start === m)))
  const estimates = {}
  await Promise.all(needEstimate.map(async m => {
    const { data } = await supabase.rpc('get_dashboard_summary', { date_cutoff: m, date_end: monthEnd(m) })
    estimates[m] = typeof data === 'string' ? JSON.parse(data) : data
  }))

  // Month-end inventory: closed months use the saved snapshot; open months are live.
  const today = todayStr()
  // Live valuations run one month at a time: manifested_inventory_at scans the
  // profitability view, and ten of them at once hit the statement timeout.
  // Closed months skip this entirely, so it only gets lighter as months close.
  const inventory = {}
  for (const m of months) {
    const c = closes[m]
    if (c?.status === 'closed' && c.inventory_value != null) {
      inventory[m] = { total: Number(c.inventory_value), ...(c.inventory_detail || {}), source: 'closed' }
    } else if (c?.inventory_value != null && c.inventory_note) {
      inventory[m] = { total: Number(c.inventory_value), ...(c.inventory_detail || {}), source: 'override' }
    } else {
      const d = monthEnd(m) < today ? monthEnd(m) : today
      let lastErr = null
      for (let attempt = 0; attempt < 2 && !inventory[m]; attempt++) {
        try { inventory[m] = { ...(await inventoryAt(d)), source: 'live' } }
        catch (e) { lastErr = e }
      }
      if (!inventory[m]) inventory[m] = { total: null, source: 'error', error: lastErr?.message }
    }
  }

  const opening = journal.filter(j => j.source === 'opening' && j.entry_date < start)
  const openingInventory = opening.filter(j => ['1015', '1016'].includes(j.account))
    .reduce((s, j) => s + Number(j.debit) - Number(j.credit), 0)

  // ── Income statement per month ──
  const pnl = {}
  let prevInventory = openingInventory
  for (const m of months) {
    const me = monthEnd(m)
    const lines = {}   // code -> { amount, sources:Set }
    const add = (code, amount, source) => {
      if (!amount) return
      lines[code] ||= { amount: 0, sources: new Set() }
      lines[code].amount += amount
      lines[code].sources.add(source)
    }
    let estimated = false
    for (const [store, revCode] of Object.entries(STORE_REVENUE)) {
      const s = statements.find(x => x.account === store && x.period_start === m)
      if (s) {
        add(revCode, Number(s.total_income || 0) || (Number(s.sales) + Number(s.tips) + Number(s.referral_credits || 0)), 'whatnot')
        add('7080', Number(s.commission || 0), 'whatnot')
        add('7085', Number(s.processing || 0), 'whatnot')
        add('7095', Number(s.show_boost || 0), 'whatnot')
        add('7090', Number(s.seller_shipping || 0) + Number(s.shipping_surcharges || 0), 'whatnot')
        add('4005', -(Number(s.order_refunds || 0) + Number(s.other_adjustments || 0)), 'whatnot')
      } else {
        const ch = estimates[m]?.[STORE_CHANNEL[store]]
        const rev = Number(ch?.revenue || 0)
        if (rev) {
          estimated = true
          add(revCode, rev, 'estimate')
          add('7080', rev * EST_COMMISSION, 'estimate')
          add('7085', Number(ch.fees || rev * EST_TOTAL_FEES) - rev * EST_COMMISSION, 'estimate')
        }
      }
    }
    for (const e of expenses) {
      if (e.date < m || e.date > me) continue
      const a = acct[e.gl_code]
      if (a && ['revenue', 'cogs', 'expense', 'other'].includes(a.type)) {
        add(e.gl_code, a.type === 'revenue' ? -Number(e.amount) : Number(e.amount), e.gl_source)
      }
    }
    for (const j of journal) {
      if (j.source === 'opening' || j.entry_date < m || j.entry_date > me) continue
      const a = acct[j.account]
      if (!a || !['revenue', 'cogs', 'expense', 'other'].includes(a.type)) continue
      const net = Number(j.debit) - Number(j.credit)
      add(j.account, a.type === 'revenue' ? -net : net, 'journal')
    }
    const inv = inventory[m]
    const endInv = inv?.total
    if (endInv != null) add('5000', round2(prevInventory - endInv), 'inventory change')
    const inventoryChange = endInv != null ? round2(prevInventory - endInv) : null
    const beginInventory = prevInventory
    if (endInv != null) prevInventory = endInv

    const out = {}
    for (const [k, v] of Object.entries(lines)) out[k] = { amount: round2(v.amount), sources: [...v.sources] }
    pnl[m] = {
      lines: out, estimated, beginInventory, endInventory: endInv, inventoryChange,
      inventory: inv, status: closes[m]?.status || 'open', close: closes[m] || null,
      unmapped: expenses.filter(e => e.date >= m && e.date <= me && e.gl_code === '7099'),
      ownerDraws: round2(expenses.filter(e => e.date >= m && e.date <= me && e.gl_code === '3010').reduce((s, e) => s + Number(e.amount), 0)),
      guaranteedPayments: round2(expenses.filter(e => e.date >= m && e.date <= me && e.gl_code === '6070').reduce((s, e) => s + Number(e.amount), 0)),
      capitalIn: round2(-expenses.filter(e => e.date >= m && e.date <= me && e.gl_code === '3000').reduce((s, e) => s + Number(e.amount), 0)),
      statementsLoaded: Object.keys(STORE_REVENUE).filter(a => statements.find(s => s.account === a && s.period_start === m)),
    }
    Object.assign(pnl[m], totals(pnl[m].lines, accounts))
  }

  // ── Balance sheet at each month end ──
  const balances = balRes.data || []
  const balanceSheets = {}
  let ytdNI = 0
  for (const m of months) {
    const me = monthEnd(m)
    ytdNI += pnl[m].netIncome
    const rows = {}
    const set = (code, amount, source) => { rows[code] = { amount: round2(amount), source } }
    // Statement accounts: this month's statement balance, else the latest earlier one, else opening.
    for (const code of STATEMENT_ACCOUNTS) {
      const exact = balances.find(b => b.account === code && b.period_end === me)
      if (exact) { set(code, Number(exact.balance), 'statement'); continue }
      const prior = balances.filter(b => b.account === code && b.period_end < me).sort((a, b) => (a.period_end < b.period_end ? 1 : -1))[0]
      if (prior) { set(code, Number(prior.balance), `carried from ${prior.period_end}`); continue }
      const op = opening.filter(j => j.account === code).reduce((s, j) => s + Number(j.debit) - Number(j.credit), 0)
      const isLiab = acct[code]?.type === 'liability'
      if (op) set(code, isLiab ? -op : op, 'opening (not yet reconciled)')
    }
    // Inventory
    const inv = inventory[m]
    if (inv?.total != null) {
      const ks = Number(inv.kickstart_intake || 0)
      set('1015', inv.total - ks, inv.source)
      if (ks) set('1016', ks, inv.source)
    }
    // Loans & equity: opening + journal + capital/draw rows from the expense feed.
    for (const a of accounts.filter(a => ['liability', 'equity'].includes(a.type) && !STATEMENT_ACCOUNTS.includes(a.code))) {
      let v = journal.filter(j => j.account === a.code && j.entry_date <= me)
        .reduce((s, j) => s + Number(j.credit) - Number(j.debit), 0)
      v += expenses.filter(e => e.gl_code === a.code && e.date <= me).reduce((s, e) => s - Number(e.amount), 0)
      if (round2(v)) set(a.code, v, 'books')
    }
    const assetTotal = Object.entries(rows).filter(([c]) => acct[c]?.type === 'asset').reduce((s, [, r]) => s + r.amount, 0)
    const liabTotal = Object.entries(rows).filter(([c]) => acct[c]?.type === 'liability').reduce((s, [, r]) => s + r.amount, 0)
    const equityTotal = Object.entries(rows).filter(([c]) => acct[c]?.type === 'equity').reduce((s, [, r]) => s + r.amount, 0) + ytdNI
    balanceSheets[m] = {
      rows, netIncomeYTD: round2(ytdNI),
      totalAssets: round2(assetTotal), totalLiabilities: round2(liabTotal), totalEquity: round2(equityTotal),
      outOfBalance: round2(assetTotal - liabTotal - equityTotal),
      missingStatements: STATEMENT_ACCOUNTS.filter(c => rows[c] && rows[c].source !== 'statement'),
    }
  }

  return { year, months, accounts, acct, pnl, balanceSheets, statements, closes, balances, openingInventory }
}

// Section totals in the bookkeeper's statement layout.
export function totals(lines, accounts) {
  const bySection = s => accounts.filter(a => a.section === s).reduce((t, a) => t + (lines[a.code]?.amount || 0), 0)
  const revenue = bySection('Sales')
  const cogs = bySection('Cost of Sales')
  const labor = bySection('Labor')
  const operating = bySection('Operating')
  const other = bySection('Other')
  const whatnotFees = ['7080', '7085', '7090', '7095'].reduce((t, c) => t + (lines[c]?.amount || 0), 0)
  return {
    revenue: round2(revenue), cogs: round2(cogs), grossProfit: round2(revenue - cogs),
    labor: round2(labor), operating: round2(operating), totalExpenses: round2(labor + operating),
    operatingIncome: round2(revenue - cogs - labor - operating), other: round2(other),
    netIncome: round2(revenue - cogs - labor - operating - other),
    whatnotFees: round2(whatnotFees),
  }
}

// Sum a set of months' lines (for YTD / quarter columns).
export function sumLines(pnlMonths) {
  const out = {}
  for (const p of pnlMonths) for (const [k, v] of Object.entries(p.lines)) {
    out[k] ||= { amount: 0, sources: [] }
    out[k].amount = round2(out[k].amount + v.amount)
  }
  return out
}
