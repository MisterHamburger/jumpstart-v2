import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

function fmt(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function pct(n, base) {
  if (!base) return '0.00%'
  return `${((n / base) * 100).toFixed(2)}%`
}

function signedFmt(n) {
  const v = Number(n || 0)
  const s = v >= 0 ? '+' : ''
  return `${s}${fmt(v)}`
}

// Read a file as base64 without the data:... prefix
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const s = reader.result
      const idx = typeof s === 'string' ? s.indexOf(',') : -1
      resolve(idx >= 0 ? s.slice(idx + 1) : s)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default function AdminStatements() {
  const [statements, setStatements] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState(null)
  const [preview, setPreview] = useState(null) // parsed data from netlify fn
  const [previewFilename, setPreviewFilename] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [saving, setSaving] = useState(false)
  const [rangeData, setRangeData] = useState({}) // { [statementId]: { items, hammer, cogs, netRev, fees } }
  const fileInputRef = useRef(null)

  useEffect(() => { loadStatements() }, [])

  async function loadStatements() {
    setLoading(true)
    const { data, error } = await supabase
      .from('whatnot_statements')
      .select('*')
      .order('period_start', { ascending: false })
    if (error) console.error('Error loading statements:', error)
    setStatements(data || [])
    setLoading(false)

    // Fetch matching profitability-view aggregates for each statement's date range
    const map = {}
    for (const s of data || []) {
      const { data: rows } = await supabase
        .from('profitability')
        .select('buyer_paid, total_fees, cost_freight, net_payout')
        .gte('show_date', s.period_start)
        .lte('show_date', s.period_end)
      if (rows) {
        let items = rows.length, hammer = 0, fees = 0, cogs = 0, net = 0
        for (const r of rows) {
          hammer += Number(r.buyer_paid || 0)
          fees += Number(r.total_fees || 0)
          cogs += Number(r.cost_freight || 0)
          net += Number(r.net_payout || 0)
        }
        map[s.id] = { items, hammer, fees, cogs, net }
      }
    }
    setRangeData(map)
  }

  async function handleFile(file) {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setUploadError('File must be a PDF')
      return
    }
    setUploadError(null)
    setUploading(true)
    setPreview(null)
    try {
      const base64 = await fileToBase64(file)
      const res = await fetch('/.netlify/functions/parse-whatnot-statement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdf_base64: base64 })
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Parser returned ${res.status}`)
      }
      const parsed = await res.json()
      setPreview(parsed)
      setPreviewFilename(file.name)
    } catch (err) {
      console.error('Upload error:', err)
      setUploadError(err.message || 'Failed to parse PDF')
    } finally {
      setUploading(false)
    }
  }

  function updatePreview(field, value) {
    setPreview(prev => ({ ...prev, [field]: value }))
  }

  async function savePreview() {
    if (!preview) return
    if (!preview.period_start || !preview.period_end) {
      setUploadError('Please fill in period start and end dates')
      return
    }
    setSaving(true)
    setUploadError(null)
    const row = {
      period_start: preview.period_start,
      period_end: preview.period_end,
      period_label: preview.period_label || null,
      statement_number: preview.statement_number || null,
      sales: Number(preview.sales) || 0,
      tips: Number(preview.tips) || 0,
      commission: Number(preview.commission) || 0,
      processing: Number(preview.processing) || 0,
      show_boost: Number(preview.show_boost) || 0,
      seller_shipping: Number(preview.seller_shipping) || 0,
      other_adjustments: Number(preview.other_adjustments) || 0,
      payouts: Number(preview.payouts) || 0,
      uploaded_filename: previewFilename || null,
    }
    const { error } = await supabase.from('whatnot_statements').upsert(row, {
      onConflict: 'period_start,period_end'
    })
    if (error) {
      setUploadError(`Save failed: ${error.message}`)
    } else {
      setPreview(null)
      setPreviewFilename('')
      await loadStatements()
    }
    setSaving(false)
  }

  async function deleteStatement(id) {
    if (!confirm('Delete this statement? The PDF stays on your computer, but it will be removed from the dashboard.')) return
    const { error } = await supabase.from('whatnot_statements').delete().eq('id', id)
    if (error) { alert(`Delete failed: ${error.message}`); return }
    await loadStatements()
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black font-heading text-white mb-1">Statements</h2>
        <p className="text-slate-400 text-sm">
          Upload monthly, weekly, or yearly Whatnot financial statement PDFs. These are the authoritative numbers from Whatnot — the rest of the dashboard remains an estimate.
        </p>
      </div>

      {/* Upload card */}
      <div
        className={`glass-card rounded-3xl p-6 border-2 border-dashed transition-all ${
          dragOver ? 'border-pink-400 bg-pink-500/5' : 'border-white/10'
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault(); setDragOver(false)
          const file = e.dataTransfer.files?.[0]
          if (file) handleFile(file)
        }}
      >
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center shrink-0">
            <iconify-icon icon="lucide:file-up" class="text-pink-400" width="24"></iconify-icon>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold mb-1">Upload Whatnot Statement PDF</p>
            <p className="text-slate-400 text-sm mb-4">
              Drag a PDF here, or click to pick one. Supports monthly, weekly, and yearly statements.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="px-4 py-2 rounded-2xl bg-pink-500 text-white font-bold text-sm hover:bg-pink-400 active:scale-[0.98] transition-all shadow-lg shadow-pink-500/30 glow-magenta disabled:opacity-50"
              >
                {uploading ? 'Parsing…' : 'Choose PDF'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
            </div>
            {uploadError && (
              <p className="text-red-400 text-sm mt-3">{uploadError}</p>
            )}
          </div>
        </div>
      </div>

      {/* Preview / edit before save */}
      {preview && (
        <div className="glass-card rounded-3xl p-6 border border-pink-500/30">
          <div className="flex items-start justify-between mb-4 gap-3">
            <div>
              <p className="text-xs uppercase tracking-wider text-pink-300 font-bold mb-1">Preview</p>
              <h3 className="text-xl font-black font-heading text-white">
                {preview.period_label || 'New Statement'}
              </h3>
              {preview.statement_number && (
                <p className="text-slate-500 text-xs mt-1">Statement #{preview.statement_number} · {previewFilename}</p>
              )}
            </div>
            <button
              onClick={() => { setPreview(null); setPreviewFilename('') }}
              className="text-white/60 hover:text-white text-2xl"
              aria-label="Cancel"
            >
              ×
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-white/70 text-xs font-semibold mb-1">Period start</label>
              <input
                type="date"
                value={preview.period_start || ''}
                onChange={(e) => updatePreview('period_start', e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-pink-500/50"
              />
            </div>
            <div>
              <label className="block text-white/70 text-xs font-semibold mb-1">Period end</label>
              <input
                type="date"
                value={preview.period_end || ''}
                onChange={(e) => updatePreview('period_end', e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-pink-500/50"
              />
            </div>
          </div>

          <div className="space-y-2 mb-5">
            {[
              ['sales', 'Sales'],
              ['tips', 'Tips'],
              ['commission', 'Commission fees'],
              ['processing', 'Payment processing'],
              ['show_boost', 'Show boost & promote'],
              ['seller_shipping', 'Seller paid shipping'],
              ['other_adjustments', 'Other adjustments'],
              ['payouts', 'Payouts'],
            ].map(([field, label]) => (
              <div key={field} className="flex items-center justify-between gap-3 py-1 border-b border-white/5 last:border-b-0">
                <span className="text-white/80 text-sm">{label}</span>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 text-sm pointer-events-none">$</span>
                  <input
                    type="number"
                    step="0.01"
                    value={preview[field] ?? 0}
                    onChange={(e) => updatePreview(field, e.target.value)}
                    className="w-40 pl-6 pr-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-right font-mono text-sm focus:outline-none focus:border-pink-500/50"
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-2 justify-end">
            <button
              onClick={() => { setPreview(null); setPreviewFilename('') }}
              disabled={saving}
              className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white/70 font-semibold text-sm hover:bg-white/10 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={savePreview}
              disabled={saving}
              className="px-5 py-2 rounded-xl bg-pink-500 text-white font-bold text-sm hover:bg-pink-400 shadow-lg shadow-pink-500/30 glow-magenta disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save statement'}
            </button>
          </div>
        </div>
      )}

      {/* Saved statements list */}
      {loading ? (
        <div className="glass-card rounded-3xl p-8 text-center text-slate-400">Loading statements…</div>
      ) : statements.length === 0 ? (
        <div className="glass-card rounded-3xl p-8 text-center">
          <p className="text-white/80 mb-1 font-semibold">No statements uploaded yet</p>
          <p className="text-slate-500 text-sm">Download your Whatnot financial statements from the seller dashboard and upload them here.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {statements.map(s => {
            const r = rangeData[s.id]
            const actualFees = Number(s.commission || 0) + Number(s.processing || 0)
            const totalCosts = Number(s.commission || 0) + Number(s.processing || 0) + Number(s.show_boost || 0) + Number(s.seller_shipping || 0) + Number(s.other_adjustments || 0)
            const actualNetProfit = r ? Number(s.payouts || 0) - r.cogs : null
            const estDrift = r ? Number(s.payouts || 0) - r.net : null
            return (
              <div key={s.id} className="glass-card rounded-3xl p-6">
                <div className="flex items-start justify-between gap-3 mb-4 pb-4 border-b border-white/5">
                  <div>
                    <h3 className="text-xl font-black font-heading text-white">{s.period_label || `${s.period_start} → ${s.period_end}`}</h3>
                    <p className="text-slate-500 text-xs mt-1">
                      {s.period_start} → {s.period_end}
                      {s.statement_number && <> · Statement #{s.statement_number}</>}
                    </p>
                  </div>
                  <button
                    onClick={() => deleteStatement(s.id)}
                    className="text-red-400/60 hover:text-red-300 hover:bg-red-500/10 rounded-lg p-2 transition-all"
                    aria-label="Delete"
                  >
                    <iconify-icon icon="lucide:trash-2" width="18"></iconify-icon>
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Actual from Whatnot */}
                  <div>
                    <p className="text-xs uppercase tracking-wider text-pink-300 font-bold mb-2">From Whatnot statement</p>
                    <div className="space-y-1 text-sm">
                      <Row label="Sales" value={fmt(s.sales)} />
                      <Row label="Tips" value={fmt(s.tips)} subtle />
                      <Row label={`Commission (${pct(s.commission, s.sales)})`} value={`−${fmt(s.commission)}`} dim />
                      <Row label={`Processing (${pct(s.processing, s.sales)})`} value={`−${fmt(s.processing)}`} dim />
                      <Row label="Show boost" value={`−${fmt(s.show_boost)}`} dim />
                      <Row label="Seller shipping" value={`−${fmt(s.seller_shipping)}`} dim />
                      <Row label="Other adjustments" value={`−${fmt(s.other_adjustments)}`} dim />
                      <div className="border-t border-white/10 my-2"></div>
                      <Row label="Payouts" value={fmt(s.payouts)} emphasis />
                      <p className="text-slate-500 text-xs mt-1">
                        {pct(totalCosts, s.sales)} total fees & costs
                      </p>
                    </div>
                  </div>

                  {/* Matched from our data */}
                  <div>
                    <p className="text-xs uppercase tracking-wider text-cyan-300 font-bold mb-2">From our data (same period)</p>
                    {!r ? (
                      <p className="text-slate-500 text-sm">Loading…</p>
                    ) : r.items === 0 ? (
                      <p className="text-slate-500 text-sm">No scanned shows in this date range.</p>
                    ) : (
                      <div className="space-y-1 text-sm">
                        <Row label="Items sold" value={r.items.toLocaleString()} />
                        <Row label="Hammer total" value={fmt(r.hammer)} />
                        <Row label="COGS" value={`−${fmt(r.cogs)}`} dim />
                        <Row label={`Estimated fees (${pct(r.fees, r.hammer)})`} value={`−${fmt(r.fees)}`} dim />
                        <div className="border-t border-white/10 my-2"></div>
                        <Row label="Dashboard net revenue" value={fmt(r.net)} />
                        {actualNetProfit !== null && (
                          <Row label="Actual net profit (Payouts − COGS)" value={fmt(actualNetProfit)} emphasis />
                        )}
                        {estDrift !== null && (
                          <p className={`text-xs mt-1 ${Math.abs(estDrift) / (Number(s.payouts) || 1) < 0.03 ? 'text-emerald-400' : 'text-amber-400'}`}>
                            Estimate drift: {signedFmt(estDrift)} ({((estDrift / (Number(s.payouts) || 1)) * 100).toFixed(1)}%)
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Row({ label, value, dim, emphasis, subtle }) {
  return (
    <div className={`flex justify-between items-baseline gap-3 ${subtle ? 'opacity-60' : ''}`}>
      <span className={`${emphasis ? 'text-white font-bold' : 'text-white/70'}`}>{label}</span>
      <span className={`font-mono tabular-nums ${emphasis ? 'text-white font-black text-base' : dim ? 'text-slate-400' : 'text-white/90'}`}>{value}</span>
    </div>
  )
}
