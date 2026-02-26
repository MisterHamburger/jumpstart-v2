import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { generateKickstartManifest } from '../lib/kickstartPdf'

export default function AdminKickstartHauls() {
  const [trips, setTrips] = useState([])
  const [selectedTrip, setSelectedTrip] = useState(null)
  const [tagPhotos, setTagPhotos] = useState([])
  const [receiptItems, setReceiptItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingCell, setEditingCell] = useState(null) // { id, field }
  const [editValue, setEditValue] = useState('')
  const [bulkCost, setBulkCost] = useState('')
  const [actionLoading, setActionLoading] = useState(false)

  // Load trips
  useEffect(() => { loadTrips() }, [])

  const loadTrips = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('kickstart_trips')
      .select('*')
      .order('created_at', { ascending: false })
    setTrips(data || [])
    setLoading(false)
  }

  // Load trip detail
  const openTrip = async (trip) => {
    setSelectedTrip(trip)
    const [tagsRes, receiptRes] = await Promise.all([
      supabase.from('kickstart_tag_photos').select('*').eq('trip_id', trip.id).order('id'),
      supabase.from('kickstart_receipt_items').select('*').eq('trip_id', trip.id).order('id')
    ])
    setTagPhotos(tagsRes.data || [])
    setReceiptItems(receiptRes.data || [])
  }

  const refreshTrip = async () => {
    if (!selectedTrip) return
    const { data } = await supabase.from('kickstart_trips').select('*').eq('id', selectedTrip.id).single()
    if (data) setSelectedTrip(data)
    const [tagsRes, receiptRes] = await Promise.all([
      supabase.from('kickstart_tag_photos').select('*').eq('trip_id', selectedTrip.id).order('id'),
      supabase.from('kickstart_receipt_items').select('*').eq('trip_id', selectedTrip.id).order('id')
    ])
    setTagPhotos(tagsRes.data || [])
    setReceiptItems(receiptRes.data || [])
  }

  // Inline edit
  const startEdit = (id, field, currentValue) => {
    setEditingCell({ id, field })
    setEditValue(currentValue || '')
  }

  const saveEdit = async () => {
    if (!editingCell) return
    const { id, field } = editingCell
    const value = ['msrp', 'cost'].includes(field) ? (parseFloat(editValue) || null) : (editValue || null)
    await supabase.from('kickstart_tag_photos').update({ [field]: value }).eq('id', id)
    setTagPhotos(prev => prev.map(t => t.id === id ? { ...t, [field]: value } : t))
    setEditingCell(null)
  }

  const handleEditKeyDown = (e) => {
    if (e.key === 'Enter') saveEdit()
    if (e.key === 'Escape') setEditingCell(null)
  }

  // Bulk set cost for unmatched tags
  const handleBulkCost = async () => {
    const cost = parseFloat(bulkCost)
    if (!cost || cost <= 0) return
    const unmatched = tagPhotos.filter(t => !t.cost)
    if (unmatched.length === 0) return
    for (const tag of unmatched) {
      await supabase.from('kickstart_tag_photos').update({ cost }).eq('id', tag.id)
    }
    setTagPhotos(prev => prev.map(t => !t.cost ? { ...t, cost } : t))
    setBulkCost('')
  }

  // Trigger enrichment
  const handleEnrich = async () => {
    setActionLoading(true)
    try {
      // Keep calling until no more pending
      let hasMore = true
      while (hasMore) {
        const res = await fetch('/.netlify/functions/enrich-kickstart-v2', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trip_id: selectedTrip.id })
        })
        const data = await res.json()
        hasMore = data.has_more
      }
      await refreshTrip()
    } catch (err) {
      alert('Enrichment error: ' + err.message)
    } finally {
      setActionLoading(false)
    }
  }

  // Trigger receipt parse
  const handleParseReceipt = async () => {
    setActionLoading(true)
    try {
      const res = await fetch('/.netlify/functions/parse-receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trip_id: selectedTrip.id })
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      await refreshTrip()
    } catch (err) {
      alert('Receipt parse error: ' + err.message)
    } finally {
      setActionLoading(false)
    }
  }

  // Trigger matching
  const handleMatch = async () => {
    setActionLoading(true)
    try {
      const res = await fetch('/.netlify/functions/match-kickstart-trip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trip_id: selectedTrip.id })
      })
      const data = await res.json()
      if (data.error && !data.matched && data.matched !== 0) throw new Error(data.error)
      await refreshTrip()
    } catch (err) {
      alert('Match error: ' + err.message)
    } finally {
      setActionLoading(false)
    }
  }

  // Finalize — write items to kickstart_intake
  const handleFinalize = async () => {
    if (!confirm(`Finalize ${tagPhotos.length} items into kickstart_intake? This cannot be undone.`)) return
    setActionLoading(true)
    try {
      const rows = tagPhotos.map(tag => ({
        upc: tag.upc || null,
        style_number: tag.style_number || null,
        brand: tag.brand || 'Free People',
        description: tag.description || null,
        color: tag.color || null,
        size: tag.size || null,
        msrp: tag.msrp ? parseFloat(tag.msrp) : null,
        cost: tag.cost ? parseFloat(tag.cost) : null,
        photo_data: tag.photo_data || null,
        status: 'enriched'
      }))

      const { error } = await supabase.from('kickstart_intake').insert(rows)
      if (error) throw error

      // Update trip status
      await supabase.from('kickstart_trips').update({ status: 'finalized' }).eq('id', selectedTrip.id)
      setSelectedTrip(prev => ({ ...prev, status: 'finalized' }))
      loadTrips()
    } catch (err) {
      alert('Finalize error: ' + err.message)
    } finally {
      setActionLoading(false)
    }
  }

  // Generate PDF
  const handlePdf = () => {
    generateKickstartManifest(selectedTrip, tagPhotos)
  }

  // === Trip detail view ===
  if (selectedTrip) {
    const enrichedCount = tagPhotos.filter(t => t.status === 'enriched').length
    const pendingCount = tagPhotos.filter(t => t.status === 'pending_enrichment').length
    const matchedCount = tagPhotos.filter(t => t.cost).length
    const totalCost = tagPhotos.reduce((sum, t) => sum + (parseFloat(t.cost) || 0), 0)
    const totalMsrp = tagPhotos.reduce((sum, t) => sum + (parseFloat(t.msrp) || 0), 0)

    return (
      <div>
        {/* Back + header */}
        <div className="flex items-center justify-between mb-6">
          <button onClick={() => { setSelectedTrip(null); loadTrips() }}
            className="text-slate-400 hover:text-white transition-colors flex items-center gap-1 text-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6" /></svg>
            Back to trips
          </button>
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
              selectedTrip.status === 'finalized' ? 'bg-emerald-500/20 text-emerald-400' :
              selectedTrip.status === 'matched' ? 'bg-cyan-500/20 text-cyan-400' :
              'bg-amber-500/20 text-amber-400'
            }`}>{selectedTrip.status}</span>
          </div>
        </div>

        <h2 className="text-xl font-bold text-white mb-1">
          {selectedTrip.buyer_name} — {new Date(selectedTrip.created_at).toLocaleDateString()}
        </h2>
        <p className="text-slate-400 text-sm mb-4">
          {tagPhotos.length} tags • {enrichedCount} enriched • {matchedCount} w/ cost • ${totalCost.toFixed(2)} total cost • ${totalMsrp.toFixed(2)} MSRP
        </p>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2 mb-6">
          {pendingCount > 0 && (
            <button onClick={handleEnrich} disabled={actionLoading}
              className="px-3 py-1.5 rounded-lg bg-purple-500/20 border border-purple-500/30 text-purple-300 text-sm font-medium hover:bg-purple-500/30 disabled:opacity-50">
              {actionLoading ? 'Working...' : `Enrich ${pendingCount} Tags`}
            </button>
          )}
          {selectedTrip.receipt_photo && receiptItems.length === 0 && (
            <button onClick={handleParseReceipt} disabled={actionLoading}
              className="px-3 py-1.5 rounded-lg bg-blue-500/20 border border-blue-500/30 text-blue-300 text-sm font-medium hover:bg-blue-500/30 disabled:opacity-50">
              {actionLoading ? 'Working...' : 'Parse Receipt'}
            </button>
          )}
          {enrichedCount > 0 && receiptItems.length > 0 && (
            <button onClick={handleMatch} disabled={actionLoading}
              className="px-3 py-1.5 rounded-lg bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 text-sm font-medium hover:bg-cyan-500/30 disabled:opacity-50">
              {actionLoading ? 'Working...' : 'Match Receipt → Tags'}
            </button>
          )}
          {selectedTrip.status !== 'finalized' && enrichedCount > 0 && (
            <button onClick={handleFinalize} disabled={actionLoading}
              className="px-3 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-sm font-medium hover:bg-emerald-500/30 disabled:opacity-50">
              Finalize → Intake
            </button>
          )}
          <button onClick={handlePdf}
            className="px-3 py-1.5 rounded-lg bg-fuchsia-500/20 border border-fuchsia-500/30 text-fuchsia-300 text-sm font-medium hover:bg-fuchsia-500/30">
            Generate PDF
          </button>
          <button onClick={refreshTrip}
            className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-400 text-sm font-medium hover:bg-white/10">
            Refresh
          </button>
        </div>

        {/* Bulk cost setter */}
        {tagPhotos.some(t => !t.cost) && (
          <div className="flex items-center gap-2 mb-4 bg-white/5 rounded-lg p-3 border border-white/10">
            <span className="text-sm text-slate-400">Set cost for {tagPhotos.filter(t => !t.cost).length} unmatched:</span>
            <span className="text-white/50">$</span>
            <input
              type="number"
              value={bulkCost}
              onChange={e => setBulkCost(e.target.value)}
              placeholder="0.00"
              className="w-20 bg-white/10 border border-white/20 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-fuchsia-400/50"
            />
            <button onClick={handleBulkCost}
              className="px-3 py-1 rounded bg-fuchsia-500/30 text-fuchsia-300 text-sm font-medium hover:bg-fuchsia-500/40">
              Apply
            </button>
          </div>
        )}

        {/* Receipt items (collapsed) */}
        {receiptItems.length > 0 && (
          <details className="mb-4">
            <summary className="text-sm text-slate-400 cursor-pointer hover:text-white">
              Receipt Items ({receiptItems.length})
            </summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-500 text-xs border-b border-white/10">
                    <th className="text-left py-1 px-2">Style</th>
                    <th className="text-left py-1 px-2">Description</th>
                    <th className="text-right py-1 px-2">Qty</th>
                    <th className="text-right py-1 px-2">Price</th>
                    <th className="text-center py-1 px-2">Matched</th>
                  </tr>
                </thead>
                <tbody>
                  {receiptItems.map(ri => (
                    <tr key={ri.id} className="border-b border-white/5">
                      <td className="py-1 px-2 text-slate-300">{ri.style_number || '—'}</td>
                      <td className="py-1 px-2 text-white">{ri.description || '—'}</td>
                      <td className="py-1 px-2 text-right text-slate-300">{ri.qty}</td>
                      <td className="py-1 px-2 text-right text-slate-300">${parseFloat(ri.price_each || 0).toFixed(2)}</td>
                      <td className="py-1 px-2 text-center">{ri.matched ? '✓' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}

        {/* Tag photos table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-900/90 backdrop-blur z-10">
              <tr className="text-slate-500 text-xs border-b border-white/10">
                <th className="text-left py-2 px-2">#</th>
                <th className="text-left py-2 px-2">Description</th>
                <th className="text-left py-2 px-2">Brand</th>
                <th className="text-left py-2 px-2">Color</th>
                <th className="text-left py-2 px-2">Size</th>
                <th className="text-left py-2 px-2">Style</th>
                <th className="text-right py-2 px-2">MSRP</th>
                <th className="text-right py-2 px-2">Cost</th>
                <th className="text-center py-2 px-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {tagPhotos.map((tag, i) => (
                <tr key={tag.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="py-1.5 px-2 text-slate-500">{i + 1}</td>
                  {['description', 'brand', 'color', 'size', 'style_number', 'msrp', 'cost'].map(field => {
                    const isEditing = editingCell?.id === tag.id && editingCell?.field === field
                    const isNumeric = field === 'msrp' || field === 'cost'
                    const val = tag[field]
                    const display = isNumeric && val ? `$${parseFloat(val).toFixed(2)}` : (val || '—')

                    return (
                      <td key={field}
                        className={`py-1.5 px-2 ${isNumeric ? 'text-right' : 'text-left'} ${
                          field === 'cost' && !val ? 'text-amber-400/60' : 'text-white'
                        } cursor-pointer hover:bg-white/5`}
                        onClick={() => !isEditing && startEdit(tag.id, field, isNumeric ? val : (val || ''))}
                      >
                        {isEditing ? (
                          <input
                            type={isNumeric ? 'number' : 'text'}
                            value={editValue}
                            onChange={e => setEditValue(e.target.value)}
                            onBlur={saveEdit}
                            onKeyDown={handleEditKeyDown}
                            autoFocus
                            className="w-full bg-white/10 border border-fuchsia-400/50 rounded px-1 py-0.5 text-white text-sm focus:outline-none"
                          />
                        ) : display}
                      </td>
                    )
                  })}
                  <td className="py-1.5 px-2 text-center">
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                      tag.status === 'enriched' ? 'bg-emerald-500/20 text-emerald-400' :
                      tag.status === 'pending_enrichment' ? 'bg-amber-500/20 text-amber-400' :
                      'bg-red-500/20 text-red-400'
                    }`}>{tag.status === 'pending_enrichment' ? 'pending' : tag.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {tagPhotos.length === 0 && (
          <div className="text-center py-12 text-slate-500">No tags scanned for this trip</div>
        )}
      </div>
    )
  }

  // === Trip list view ===
  return (
    <div>
      <h2 className="text-xl font-bold text-white mb-4">Kickstart Hauls</h2>

      {loading ? (
        <div className="text-center py-12 text-slate-500">Loading...</div>
      ) : trips.length === 0 ? (
        <div className="text-center py-12 text-slate-500">No trips yet. Share /kickstart/buyer with a buyer to start.</div>
      ) : (
        <div className="space-y-2">
          {trips.map(trip => (
            <button
              key={trip.id}
              onClick={() => openTrip(trip)}
              className="w-full text-left bg-white/[0.03] hover:bg-white/[0.06] border border-white/10 rounded-xl p-4 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-white font-semibold">{trip.buyer_name}</div>
                  <div className="text-slate-400 text-sm">
                    {new Date(trip.created_at).toLocaleDateString()} • {trip.tag_count || 0} tags
                    {trip.total_cost ? ` • $${parseFloat(trip.total_cost).toFixed(2)}` : ''}
                  </div>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  trip.status === 'finalized' ? 'bg-emerald-500/20 text-emerald-400' :
                  trip.status === 'matched' ? 'bg-cyan-500/20 text-cyan-400' :
                  trip.status === 'submitted' ? 'bg-purple-500/20 text-purple-400' :
                  'bg-amber-500/20 text-amber-400'
                }`}>{trip.status}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
