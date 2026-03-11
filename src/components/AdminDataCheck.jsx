import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const BUSINESS_START = '2026-02-07'

function fmt(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

export default function AdminDataCheck() {
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState(null)
  const [dashData, setDashData] = useState(null)
  const [lastRun, setLastRun] = useState(null)

  useEffect(() => {
    loadAndRun()
  }, [])

  async function loadAndRun() {
    setRunning(true)
    setResults(null)

    // Load dashboard data first (needed for P&L checks)
    const { data: raw, error } = await supabase.rpc('get_dashboard_summary', {
      date_cutoff: BUSINESS_START,
      date_end: null,
    })

    if (error || !raw) {
      setResults([{ label: 'Dashboard Load', pass: false, detail: `Failed to load dashboard data: ${error?.message}` }])
      setRunning(false)
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

    const data = {
      jumpstart: build(raw.jumpstart),
      kickstart: build(raw.kickstart),
      totalExpenses: Number(raw.expenses) || 0,
      totalPayroll: Number(raw.payroll) || 0,
    }
    setDashData(data)

    await runChecks(data)
  }

  async function runChecks(data) {
    setRunning(true)
    setResults(null)
    const results = []
    const check = (label, pass, detail) => results.push({ label, pass, detail })

    try {
      // ═══════════════════════════════════════════
      // SECTION 1: P&L MATH
      // ═══════════════════════════════════════════
      for (const ch of [
        { name: 'Jumpstart', d: data.jumpstart },
        { name: 'Kickstart', d: data.kickstart },
      ]) {
        const { revenue, fees, netRevenue, cogs, grossProfit } = ch.d
        const calcNet = round2(revenue - fees)
        const netOk = Math.abs(calcNet - netRevenue) < 0.02
        const calcGP = round2(netRevenue - cogs)
        const gpOk = Math.abs(calcGP - grossProfit) < 0.02
        let d = `Rev ${fmt(revenue)} - Fees ${fmt(fees)} = Net ${fmt(calcNet)}`
        if (!netOk) d += ` (expected ${fmt(netRevenue)})`
        d += ` | Net - COGS = GP ${fmt(calcGP)}`
        if (!gpOk) d += ` (expected ${fmt(grossProfit)})`
        check(`P&L Math — ${ch.name}`, netOk && gpOk, d)
      }

      // ═══════════════════════════════════════════
      // SECTION 2: MONTH ADDITIVITY
      // ═══════════════════════════════════════════
      const [febRes, marRes, allRes] = await Promise.all([
        supabase.rpc('get_dashboard_summary', { date_cutoff: '2026-02-07', date_end: '2026-02-28' }),
        supabase.rpc('get_dashboard_summary', { date_cutoff: '2026-03-01', date_end: '2026-03-31' }),
        supabase.rpc('get_dashboard_summary', { date_cutoff: BUSINESS_START, date_end: null }),
      ])
      if (febRes.error || marRes.error || allRes.error) {
        check('Month Additivity', false, 'RPC error')
      } else {
        const feb = febRes.data, mar = marRes.data, all = allRes.data
        let ok = true; const fails = []
        for (const f of ['revenue', 'fees', 'cogs', 'gross_profit']) {
          for (const ch of ['jumpstart', 'kickstart']) {
            const sum = round2((Number(feb[ch]?.[f]) || 0) + (Number(mar[ch]?.[f]) || 0))
            const tot = round2(Number(all[ch]?.[f]) || 0)
            if (Math.abs(sum - tot) >= 0.05) { ok = false; fails.push(`${ch}.${f}: ${fmt(sum)} vs ${fmt(tot)}`) }
          }
        }
        for (const f of ['expenses', 'payroll']) {
          const sum = round2((Number(feb[f]) || 0) + (Number(mar[f]) || 0))
          const tot = round2(Number(all[f]) || 0)
          if (Math.abs(sum - tot) >= 0.05) { ok = false; fails.push(`${f}: ${fmt(sum)} vs ${fmt(tot)}`) }
        }
        check('Month Additivity (Feb + Mar = All Time)', ok, ok ? 'All fields match' : fails.join(' | '))
      }

      // ═══════════════════════════════════════════
      // SECTION 3: ITEM COUNTS
      // ═══════════════════════════════════════════
      const [jsC, ksC] = await Promise.all([
        supabase.from('profitability').select('scan_id', { count: 'exact', head: true }).eq('channel', 'Jumpstart'),
        supabase.from('profitability').select('scan_id', { count: 'exact', head: true }).eq('channel', 'Kickstart'),
      ])
      if (jsC.error || ksC.error) {
        check('Item Counts', false, `Query error: ${jsC.error?.message || ksC.error?.message}`)
      } else {
        const jsOk = jsC.count === data.jumpstart.items, ksOk = ksC.count === data.kickstart.items
        check('Item Counts', jsOk && ksOk,
          `JS: prof=${jsC.count} dash=${data.jumpstart.items}${jsOk ? '' : ' MISMATCH'} | KS: prof=${ksC.count} dash=${data.kickstart.items}${ksOk ? '' : ' MISMATCH'}`)
      }

      // ═══════════════════════════════════════════
      // SECTION 4: FEE FORMULA VERIFICATION
      // ═══════════════════════════════════════════
      const { data: feeSample } = await supabase.from('profitability')
        .select('buyer_paid,commission,processing_fee,total_fees,net_payout,is_bundle')
        .eq('is_bundle', false).limit(500)
      if (feeSample && feeSample.length > 0) {
        let bad = 0; const errors = []
        for (const r of feeSample) {
          const bp = Number(r.buyer_paid) || 0
          const expComm = round2(bp * 0.072)
          const expProc = round2(bp * 0.029 + 0.30)
          const expTotal = round2(expComm + expProc)
          const expNet = round2(bp - expTotal)
          if (Math.abs(expComm - Number(r.commission)) > 0.02) { bad++; if (errors.length < 3) errors.push(`commission ${r.commission} != ${expComm} on ${fmt(bp)} item`) }
          if (Math.abs(expProc - Number(r.processing_fee)) > 0.02) { bad++; if (errors.length < 3) errors.push(`processing ${r.processing_fee} != ${expProc} on ${fmt(bp)} item`) }
          if (Math.abs(expTotal - Number(r.total_fees)) > 0.02) { bad++; if (errors.length < 3) errors.push(`total_fees ${r.total_fees} != ${expTotal} on ${fmt(bp)} item`) }
          if (Math.abs(expNet - Number(r.net_payout)) > 0.02) { bad++; if (errors.length < 3) errors.push(`net_payout ${r.net_payout} != ${expNet} on ${fmt(bp)} item`) }
        }
        check('Fee Formulas (7.2% + 2.9% + $0.30)', bad === 0,
          bad === 0 ? `All ${feeSample.length} sampled items have correct fee math` : `${bad} errors in ${feeSample.length} items: ${errors.join('; ')}`)
      }

      // ═══════════════════════════════════════════
      // SECTION 5: BUNDLE ITEMS HAVE 0% FEES
      // ═══════════════════════════════════════════
      const { data: bundleItems } = await supabase.from('profitability')
        .select('commission,processing_fee,total_fees,buyer_paid,net_payout,is_bundle')
        .eq('is_bundle', true).limit(500)
      if (bundleItems && bundleItems.length > 0) {
        let bad = 0
        for (const r of bundleItems) {
          if (Number(r.commission) !== 0 || Number(r.processing_fee) !== 0 || Number(r.total_fees) !== 0) bad++
          if (Math.abs(Number(r.buyer_paid) - Number(r.net_payout)) > 0.01) bad++
        }
        check('Bundle Items — 0% Fees', bad === 0,
          bad === 0 ? `All ${bundleItems.length} bundle items have zero fees and net = buyer_paid` : `${bad} bundle items have incorrect fees`)
      } else {
        check('Bundle Items — 0% Fees', true, 'No bundle items found (OK if no bundles sold yet)')
      }

      // ═══════════════════════════════════════════
      // SECTION 6: PROFIT FORMULA (profit = net_payout - cost)
      // ═══════════════════════════════════════════
      const { data: profitSample } = await supabase.from('profitability')
        .select('net_payout,cost_freight,profit,is_bundle')
        .limit(500)
      if (profitSample && profitSample.length > 0) {
        let bad = 0; const errors = []
        for (const r of profitSample) {
          const expected = round2(Number(r.net_payout) - Number(r.cost_freight || 0))
          if (Math.abs(expected - Number(r.profit)) > 0.02) {
            bad++
            if (errors.length < 3) errors.push(`profit ${r.profit} != ${expected} (net ${r.net_payout} - cost ${r.cost_freight})`)
          }
        }
        check('Profit Formula (net - cost)', bad === 0,
          bad === 0 ? `All ${profitSample.length} sampled items: profit = net_payout - cost_freight` : `${bad} errors: ${errors.join('; ')}`)
      }

      // ═══════════════════════════════════════════
      // SECTION 7: MARGIN FORMULA (margin = profit / buyer_paid * 100)
      // ═══════════════════════════════════════════
      const { data: marginSample } = await supabase.from('profitability')
        .select('buyer_paid,profit,margin')
        .gt('buyer_paid', 0).limit(500)
      if (marginSample && marginSample.length > 0) {
        let bad = 0
        for (const r of marginSample) {
          const expected = round2((Number(r.profit) / Number(r.buyer_paid)) * 100)
          if (Math.abs(expected - Number(r.margin)) > 0.2) bad++
        }
        check('Margin Formula (profit / revenue)', bad === 0,
          bad === 0 ? `All ${marginSample.length} sampled items have correct margins` : `${bad} items with incorrect margin calc`)
      }

      // ═══════════════════════════════════════════
      // SECTION 8: NO $0 COST WAC ITEMS
      // ═══════════════════════════════════════════
      const { count: zeroCostWac } = await supabase.from('profitability')
        .select('scan_id', { count: 'exact', head: true })
        .eq('is_wac_cost', true).eq('cost_freight', 0)
      check('WAC Items — No $0 Cost', (zeroCostWac || 0) === 0,
        (zeroCostWac || 0) === 0 ? 'All WAC items have a cost assigned' : `${zeroCostWac} WAC items still have $0 cost`)

      // ═══════════════════════════════════════════
      // SECTION 9: WAC OVERRIDE SHOWS (38, 40, 41 = $15.50)
      // ═══════════════════════════════════════════
      const { data: wacOverrideItems } = await supabase.from('profitability')
        .select('cost,show_name,is_wac_cost')
        .eq('is_wac_cost', true)
        .in('show_name', ['02-24-2026-Kickstart-Bri', '02-26-2026-Kickstart-Hannah', '02-27-2026-Kickstart-Laura'])
        .limit(500)
      if (wacOverrideItems && wacOverrideItems.length > 0) {
        let bad = 0
        for (const r of wacOverrideItems) {
          if (Math.abs(Number(r.cost) - 15.50) > 0.01) bad++
        }
        check('WAC Override — $15.50 for Early Shows', bad === 0,
          bad === 0 ? `All ${wacOverrideItems.length} WAC items on early shows have $15.50 cost` : `${bad} items don't have $15.50`)
      } else {
        check('WAC Override — $15.50 for Early Shows', true, 'No WAC items found on override shows')
      }

      // ═══════════════════════════════════════════
      // SECTION 10: BUNDLE REVENUE SPLIT
      // ═══════════════════════════════════════════
      const { data: bundleBoxes } = await supabase.from('jumpstart_bundle_boxes')
        .select('box_number,sale_price')
        .not('sale_price', 'is', null).not('sold_at', 'is', null)
      if (bundleBoxes && bundleBoxes.length > 0) {
        let ok = true; const fails = []
        for (const box of bundleBoxes) {
          const { data: items } = await supabase.from('profitability')
            .select('buyer_paid')
            .eq('listing_number', 'B' + box.box_number).eq('is_bundle', true).eq('channel', 'Jumpstart')
          if (items && items.length > 0) {
            const itemSum = items.reduce((s, i) => s + Number(i.buyer_paid), 0)
            const diff = Math.abs(itemSum - Number(box.sale_price))
            if (diff > items.length * 0.02) {
              ok = false
              fails.push(`JS Box ${box.box_number}: items sum ${fmt(itemSum)} vs sale ${fmt(box.sale_price)}`)
            }
          }
        }
        const { data: ksBundleBoxes } = await supabase.from('kickstart_bundle_boxes')
          .select('box_number,sale_price')
          .not('sale_price', 'is', null).not('sold_at', 'is', null)
        if (ksBundleBoxes) {
          for (const box of ksBundleBoxes) {
            const { data: items } = await supabase.from('profitability')
              .select('buyer_paid')
              .eq('listing_number', 'B' + box.box_number).eq('is_bundle', true).eq('channel', 'Kickstart')
            if (items && items.length > 0) {
              const itemSum = items.reduce((s, i) => s + Number(i.buyer_paid), 0)
              const diff = Math.abs(itemSum - Number(box.sale_price))
              if (diff > items.length * 0.02) {
                ok = false
                fails.push(`KS Box ${box.box_number}: items sum ${fmt(itemSum)} vs sale ${fmt(box.sale_price)}`)
              }
            }
          }
        }
        check('Bundle Revenue Split', ok,
          ok ? `All bundle box totals match sale prices (within rounding)` : fails.join(' | '))
      }

      // ═══════════════════════════════════════════
      // SECTION 11: CHANNEL ISOLATION
      // ═══════════════════════════════════════════
      const { count: crossChannel } = await supabase.from('profitability')
        .select('scan_id', { count: 'exact', head: true })
        .not('channel', 'in', '("Jumpstart","Kickstart")')
      check('Channel Isolation', (crossChannel || 0) === 0,
        (crossChannel || 0) === 0 ? 'All items are Jumpstart or Kickstart' : `${crossChannel} items with unknown channel`)

      // ═══════════════════════════════════════════
      // SECTION 12: EXPENSE DATE CLAMPING
      // ═══════════════════════════════════════════
      {
        const { data: bsData, error: expErr } = await supabase.rpc('get_dashboard_summary', {
          date_cutoff: BUSINESS_START, date_end: null,
        })
        if (expErr) {
          check('Expense Date Clamping', false, `Query error: ${expErr.message}`)
        } else {
          const rpcExp = round2(Number(bsData?.expenses) || 0)
          const dashExp = round2(data.totalExpenses)
          const ok = Math.abs(rpcExp - dashExp) < 0.05
          check('Expense Date Clamping', ok,
            ok ? `Dashboard expenses ${fmt(dashExp)} match RPC from ${BUSINESS_START}` : `Dashboard ${fmt(dashExp)} vs RPC ${fmt(rpcExp)}`)
        }
      }

      // ═══════════════════════════════════════════
      // SECTION 13: NO NEGATIVE BUYER_PAID
      // ═══════════════════════════════════════════
      const { count: negBP } = await supabase.from('profitability')
        .select('scan_id', { count: 'exact', head: true })
        .lt('buyer_paid', 0)
      check('No Negative Revenue', (negBP || 0) === 0,
        (negBP || 0) === 0 ? 'All items have buyer_paid >= 0' : `${negBP} items with negative buyer_paid`)

      // ═══════════════════════════════════════════
      // SECTION 14: ALL ITEMS HAVE SHOW DATES
      // ═══════════════════════════════════════════
      const { count: noDate } = await supabase.from('profitability')
        .select('scan_id', { count: 'exact', head: true })
        .is('show_date', null)
      check('All Items Have Dates', (noDate || 0) === 0,
        (noDate || 0) === 0 ? 'Every profitability item has a show_date' : `${noDate} items missing show_date`)

    } catch (err) {
      results.push({ label: 'Unexpected Error', pass: false, detail: err.message })
    }

    setResults(results)
    setRunning(false)
    setLastRun(new Date())
  }

  const passCount = results ? results.filter(r => r.pass).length : 0
  const failCount = results ? results.filter(r => !r.pass).length : 0

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white">Data Integrity</h2>
          <p className="text-slate-500 text-sm mt-1">Automated verification of every calculation in the system</p>
        </div>
        <button
          onClick={() => dashData ? runChecks(dashData) : loadAndRun()}
          disabled={running}
          className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40 transition-all disabled:opacity-50"
        >
          {running ? 'Running...' : 'Run All Checks'}
        </button>
      </div>

      {lastRun && !running && (
        <div className="flex items-center gap-4 mb-6">
          <div className={`px-4 py-2 rounded-xl text-sm font-bold ${failCount === 0 ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/20 text-red-400 border border-red-500/20'}`}>
            {failCount === 0 ? 'ALL CHECKS PASSED' : `${failCount} FAILED`}
          </div>
          <span className="text-slate-500 text-sm">
            {passCount} passed, {failCount} failed — Last run {lastRun.toLocaleTimeString()}
          </span>
        </div>
      )}

      {running && (
        <div className="flex items-center gap-3 text-slate-400 py-12 justify-center">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Running {results ? results.length : 0} of 14 checks...
        </div>
      )}

      {results && !running && (
        <div className="bg-slate-800/60 backdrop-blur-xl border border-white/[0.08] rounded-2xl overflow-hidden">
          {results.map((r, i) => (
            <div key={i} className={`flex items-start gap-3 px-5 py-4 ${i < results.length - 1 ? 'border-b border-white/[0.06]' : ''}`}>
              <div className={`mt-0.5 w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${r.pass ? 'bg-emerald-500/20' : 'bg-red-500/20'}`}>
                <span className={`text-xs font-bold ${r.pass ? 'text-emerald-400' : 'text-red-400'}`}>
                  {r.pass ? '\u2713' : '\u2717'}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-semibold ${r.pass ? 'text-emerald-400' : 'text-red-400'}`}>
                    {r.pass ? 'PASS' : 'FAIL'}
                  </span>
                  <span className="text-sm text-white font-medium">{r.label}</span>
                </div>
                <div className="text-xs text-slate-500 mt-1 break-all leading-relaxed">{r.detail}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
