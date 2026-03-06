import { useState, useEffect } from 'react'
import { supabase, fetchAll } from '../lib/supabase'

export default function AdminUnknownItems() {
  const [unknownItems, setUnknownItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState(null)
  const [reEnriching, setReEnriching] = useState(new Set())

  useEffect(() => {
    loadUnknownItems()
  }, [])

  const loadUnknownItems = async () => {
    setLoading(true)
    try {
      // Get items with enriched or pending_enrichment status (matches sales scanner)
      // Don't load photos initially - too much data
      const allItems = await fetchAll(() => supabase
        .from('kickstart_intake')
        .select('id, brand, description, color, condition, size, status, upc, style_number, msrp, created_at')
        .in('status', ['enriched', 'pending_enrichment'])
        .order('created_at', { ascending: false }))

      // Filter for items where BOTH description AND color are empty (that's what shows as "Unknown")
      const itemsWithMissingData = allItems.filter(item =>
        (!item.description || item.description.trim() === '') &&
        (!item.color || item.color.trim() === '')
      )

      // Get sold intake_ids to filter out
      const soldData = await fetchAll(() => supabase
        .from('kickstart_sold_scans')
        .select('intake_id')
        .not('intake_id', 'is', null))

      const soldIds = new Set(soldData.map(s => s.intake_id))
      const unsold = itemsWithMissingData.filter(item => !soldIds.has(item.id))

      console.log('Unsold unknown items:', unsold.length)
      console.log('Sample of unsold unknown:', unsold.slice(0, 3))

      setUnknownItems(unsold)
    } catch (err) {
      console.error('Error loading unknown items:', err)
    }
    setLoading(false)
  }

  const reEnrichItem = async (itemId) => {
    setReEnriching(prev => new Set(prev).add(itemId))
    try {
      // Trigger enrichment by calling the Netlify function
      await fetch('/.netlify/functions/enrich-kickstart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: itemId })
      })

      // Wait a bit for enrichment to complete
      await new Promise(resolve => setTimeout(resolve, 3000))

      // Reload items
      await loadUnknownItems()
    } catch (err) {
      console.error('Error re-enriching:', err)
      alert('Failed to re-enrich item')
    }
    setReEnriching(prev => {
      const next = new Set(prev)
      next.delete(itemId)
      return next
    })
  }

  const reEnrichAll = async () => {
    if (!confirm(`Re-enrich all ${unknownItems.length} unknown items? This may take a while.`)) return

    for (const item of unknownItems) {
      await reEnrichItem(item.id)
    }
  }

  if (loading) {
    return (
      <div className="p-8">
        <p className="text-white/50">Loading unknown items...</p>
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Unknown Items</h1>
          <p className="text-white/60">Items with missing description or color ({unknownItems.length} total)</p>
        </div>
        <button
          onClick={reEnrichAll}
          className="px-6 py-3 bg-gradient-to-r from-fuchsia-500 to-pink-500 text-white font-semibold rounded-xl hover:scale-105 transition-all shadow-lg shadow-fuchsia-500/30"
        >
          Re-enrich All
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {unknownItems.map(item => {
          const isExpanded = expandedId === item.id

          return (
            <div key={item.id} className="bg-slate-800/50 border border-white/10 rounded-2xl p-4 hover:border-fuchsia-500/30 transition-all">
              {/* Photo placeholder - click to load */}
              <div className="aspect-square bg-slate-900 rounded-xl overflow-hidden mb-3 flex items-center justify-center text-white/30 text-sm">
                ID: {item.id}
              </div>

              {/* Info */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    item.status === 'enriched'
                      ? 'bg-green-500/20 text-green-300'
                      : item.status === 'pending_enrichment'
                      ? 'bg-yellow-500/20 text-yellow-300'
                      : 'bg-red-500/20 text-red-300'
                  }`}>
                    {item.status}
                  </span>
                  <span className="text-white/40 text-xs">ID: {item.id}</span>
                </div>

                <div className="text-sm text-white/80">
                  <p><strong>Brand:</strong> {item.brand || '—'}</p>
                  <p><strong>Description:</strong> {item.description || <span className="text-red-400">Missing</span>}</p>
                  <p><strong>Color:</strong> {item.color || <span className="text-red-400">Missing</span>}</p>
                  <p><strong>Size:</strong> {item.size || '—'}</p>
                  <p><strong>Condition:</strong> {item.condition || '—'}</p>
                </div>

                {isExpanded && (
                  <div className="text-xs text-white/60 border-t border-white/10 pt-2 mt-2">
                    <p><strong>UPC:</strong> {item.upc || '—'}</p>
                    <p><strong>Style:</strong> {item.style_number || '—'}</p>
                    <p><strong>MSRP:</strong> {item.msrp ? `$${item.msrp}` : '—'}</p>
                    <p><strong>Created:</strong> {new Date(item.created_at).toLocaleDateString()}</p>
                  </div>
                )}

                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : item.id)}
                    className="flex-1 py-2 text-xs bg-white/5 hover:bg-white/10 text-white rounded-lg transition-all"
                  >
                    {isExpanded ? 'Less' : 'More'}
                  </button>
                  <button
                    onClick={() => reEnrichItem(item.id)}
                    disabled={reEnriching.has(item.id)}
                    className="flex-1 py-2 text-xs bg-fuchsia-500/20 hover:bg-fuchsia-500/30 text-fuchsia-300 rounded-lg transition-all disabled:opacity-50"
                  >
                    {reEnriching.has(item.id) ? 'Re-enriching...' : 'Re-enrich'}
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {unknownItems.length === 0 && (
        <div className="text-center py-12">
          <p className="text-white/50 text-lg">✓ No unknown items found!</p>
        </div>
      )}
    </div>
  )
}
