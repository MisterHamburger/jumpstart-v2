import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

// Landed cost for one load (docs/financial-rules.md): vendor cost + freight +
// forklift charges for unloading it. Freight/forklift can be typed in as an
// estimate when the load is recorded; once the actual bills are linked here,
// the load's freight/forklift become the sum of those bills (DB trigger), and
// the bills move out of operating expenses into cost of goods (GL 5010).

const money = n => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// Bank/card descriptions that are freight or forklift bills.
const BILL_FILTER = [
  'description.ilike.%widover%', 'description.ilike.%william syst%', 'description.ilike.%craneworks%',
  'description.ilike.%freight%', 'description.ilike.%forklift%', 'description.ilike.%ghst%',
].join(',')

export function landedSummary(l) {
  const vendor = Number(l.total_cost || 0)
  const freight = Number(l.freight_cost || 0)
  const forklift = Number(l.forklift_cost || 0)
  const landed = vendor + freight + forklift
  const qty = Number(l.quantity || l.item_count || 0)
  return { vendor, freight, forklift, landed, qty, perUnit: qty > 0 ? landed / qty : null, vendorPerUnit: qty > 0 ? vendor / qty : null }
}

export default function LoadLandedCosts({ load, onChange }) {
  const [linked, setLinked] = useState([])
  const [candidates, setCandidates] = useState([])
  const [pick, setPick] = useState('')
  const [pickType, setPickType] = useState('freight')
  const [draft, setDraft] = useState({ freight: '', forklift: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function refresh() {
    const [a, b] = await Promise.all([
      supabase.from('expenses').select('id, date, description, amount, landed_type').eq('load_id', load.id).order('date'),
      supabase.from('expenses').select('id, date, description, amount, category')
        .is('load_id', null).gte('date', '2026-01-01').lt('amount', 15000).or(BILL_FILTER)
        .order('date', { ascending: false }).limit(200),
    ])
    setLinked(a.data || [])
    setCandidates(b.data || [])
  }

  useEffect(() => {
    refresh()
    setDraft({ freight: String(load.freight_cost ?? 0), forklift: String(load.forklift_cost ?? 0) })
    setMsg('')
  }, [load.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const hasFreightBills = linked.some(e => e.landed_type === 'freight')
  const hasForkliftBills = linked.some(e => e.landed_type === 'forklift')
  const s = landedSummary(load)

  async function saveEstimates() {
    setBusy(true); setMsg('')
    const upd = {}
    if (!hasFreightBills) upd.freight_cost = Number(draft.freight) || 0
    if (!hasForkliftBills) upd.forklift_cost = Number(draft.forklift) || 0
    const { error } = await supabase.from('loads').update(upd).eq('id', load.id)
    setBusy(false)
    if (error) { setMsg(`❌ ${error.message}`); return }
    setMsg('✅ Saved')
    onChange?.()
  }

  async function link() {
    if (!pick) return
    setBusy(true); setMsg('')
    const { error } = await supabase.from('expenses').update({ load_id: load.id, landed_type: pickType }).eq('id', Number(pick))
    setBusy(false)
    if (error) { setMsg(`❌ ${error.message}`); return }
    setPick('')
    await refresh()
    onChange?.()
  }

  async function unlink(id) {
    setBusy(true); setMsg('')
    const { error } = await supabase.from('expenses').update({ load_id: null, landed_type: null }).eq('id', id)
    setBusy(false)
    if (error) { setMsg(`❌ ${error.message}`); return }
    await refresh()
    onChange?.()
  }

  const input = 'w-28 bg-slate-900/80 border border-white/10 rounded-lg px-2 py-1 text-xs text-right text-white focus:outline-none focus:border-cyan-500/50 disabled:opacity-50'

  return (
    <div onClick={e => e.stopPropagation()} className="mt-3 rounded-xl border border-white/10 bg-slate-900/50 p-3 space-y-3 cursor-default">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
        <Cell label="Vendor cost" value={money(s.vendor)} />
        <Cell label="Freight" value={money(s.freight)} note={hasFreightBills ? 'from bills' : 'estimate'} />
        <Cell label="Forklift" value={money(s.forklift)} note={hasForkliftBills ? 'from bills' : 'estimate'} />
        <Cell label="Balance sheet value" value={money(s.landed)} strong />
        <Cell label="Adjusted cost / unit" value={s.perUnit == null ? '—' : money(s.perUnit)} strong
          note={s.vendorPerUnit == null ? null : `vendor ${money(s.vendorPerUnit)}`} />
      </div>

      {(!hasFreightBills || !hasForkliftBills) && (
        <div className="flex flex-wrap items-end gap-3">
          {!hasFreightBills && (
            <label className="text-[11px] text-slate-400">Freight estimate
              <input type="number" step="0.01" min="0" value={draft.freight} disabled={busy}
                onChange={e => setDraft({ ...draft, freight: e.target.value })} className={`${input} block mt-1`} />
            </label>
          )}
          {!hasForkliftBills && (
            <label className="text-[11px] text-slate-400">Forklift estimate
              <input type="number" step="0.01" min="0" value={draft.forklift} disabled={busy}
                onChange={e => setDraft({ ...draft, forklift: e.target.value })} className={`${input} block mt-1`} />
            </label>
          )}
          <button onClick={saveEstimates} disabled={busy}
            className="bg-cyan-600 text-white hover:bg-cyan-500 active:scale-95 rounded-lg px-3 py-1.5 text-[11px] font-bold transition-all disabled:opacity-50">
            Save
          </button>
        </div>
      )}

      <div>
        <div className="text-[10px] uppercase tracking-wide text-slate-500 font-bold mb-1">Linked bills</div>
        {linked.length === 0 && <div className="text-[11px] text-slate-500">None yet — link the actual freight/forklift bills when they arrive.</div>}
        {linked.map(e => (
          <div key={e.id} className="flex items-center justify-between gap-2 text-[11px] text-slate-300 py-0.5">
            <span className="truncate">{e.date} · {e.description} · <span className="text-slate-500">{e.landed_type}</span></span>
            <span className="flex items-center gap-2 shrink-0">
              <span className="tabular-nums">{money(e.amount)}</span>
              <button onClick={() => unlink(e.id)} disabled={busy} className="text-slate-500 hover:text-red-400">Unlink</button>
            </span>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <select value={pick} onChange={e => setPick(e.target.value)} disabled={busy}
            className="flex-1 min-w-0 bg-slate-900/80 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-white">
            <option value="">Link a bill…</option>
            {candidates.map(c => (
              <option key={c.id} value={c.id}>{c.date} · {c.description.slice(0, 40)} · {money(c.amount)}</option>
            ))}
          </select>
          <select value={pickType} onChange={e => setPickType(e.target.value)} disabled={busy}
            className="bg-slate-900/80 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-white">
            <option value="freight">Freight</option>
            <option value="forklift">Forklift</option>
          </select>
          <button onClick={link} disabled={busy || !pick}
            className="bg-cyan-600 text-white hover:bg-cyan-500 active:scale-95 rounded-lg px-3 py-1 text-[11px] font-bold transition-all disabled:opacity-40">
            Link
          </button>
        </div>
      </div>
      {msg && <div className="text-[11px] text-slate-300">{msg}</div>}
    </div>
  )
}

function Cell({ label, value, note, strong }) {
  return (
    <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`tabular-nums ${strong ? 'text-white font-bold' : 'text-slate-300'}`}>{value}</div>
      {note && <div className="text-[10px] text-slate-500">{note}</div>}
    </div>
  )
}
