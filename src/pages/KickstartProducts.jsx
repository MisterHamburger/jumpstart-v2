import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

// ─── Lazy photo thumbnail ─────────────────────────────────
function LazyPhoto({ intakeId, size = 'sm' }) {
  const [src, setSrc] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const ref = useRef(null)

  useEffect(() => { setSrc(null); setLoaded(false) }, [intakeId])

  useEffect(() => {
    if (!intakeId) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !loaded) {
        setLoaded(true)
        supabase.from('kickstart_intake').select('item_photo_data, photo_data').eq('id', intakeId).single()
          .then(({ data }) => {
            const photo = data?.item_photo_data || data?.photo_data
            if (photo) setSrc(`data:image/jpeg;base64,${photo}`)
          })
      }
    }, { rootMargin: '200px' })
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [intakeId, loaded])

  const dim = size === 'lg' ? 'w-16 h-16' : 'w-10 h-10'
  return (
    <div ref={ref} className={`${dim} rounded-xl bg-white/5 border border-white/10 overflow-hidden flex-shrink-0`}>
      {src && <img src={src} className="w-full h-full object-cover" />}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────
export default function KickstartProducts() {
  const navigate = useNavigate()

  // Data
  const [products, setProducts] = useState([])
  const [unassigned, setUnassigned] = useState([])
  const [loading, setLoading] = useState(true)

  // UI state
  const [tab, setTab] = useState('unassigned') // 'unassigned' | 'products'
  const [selected, setSelected] = useState(new Set())
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showAssignModal, setShowAssignModal] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [saving, setSaving] = useState(false)

  // ─── Data loading ───────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true)
    const [{ data: prods }, { data: items }] = await Promise.all([
      supabase.from('kickstart_product_inventory').select('*').eq('status', 'active').order('created_at', { ascending: false }),
      supabase.from('kickstart_intake').select('id, brand, description, color, size, condition, cost, msrp, product_id, created_at')
        .is('product_id', null).is('sale_price', null).order('created_at', { ascending: false }),
    ])
    setProducts(prods || [])
    setUnassigned(items || [])
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // ─── Selection ──────────────────────────────────────────
  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const selectAll = () => {
    const visible = getFilteredUnassigned()
    if (selected.size === visible.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(visible.map(i => i.id)))
    }
  }

  // ─── Filtering ──────────────────────────────────────────
  const getFilteredUnassigned = () => {
    if (!searchQuery.trim()) return unassigned
    const q = searchQuery.toLowerCase()
    return unassigned.filter(i => {
      const searchable = [i.brand, i.description, i.color, i.size, i.condition].filter(Boolean).join(' ').toLowerCase()
      return searchable.includes(q)
    })
  }

  const getFilteredProducts = () => {
    if (!searchQuery.trim()) return products
    const q = searchQuery.toLowerCase()
    return products.filter(p => {
      const searchable = [p.title, p.brand, p.description, p.color, p.size].filter(Boolean).join(' ').toLowerCase()
      return searchable.includes(q)
    })
  }

  // ─── Create new product from selected items ─────────────
  const handleCreate = async () => {
    if (!newTitle.trim() || selected.size === 0) return
    setSaving(true)
    try {
      // Use first selected item for defaults
      const firstItem = unassigned.find(i => selected.has(i.id))
      const { data: product, error: createErr } = await supabase.from('kickstart_products').insert({
        title: newTitle.trim(),
        brand: firstItem?.brand || null,
        description: firstItem?.description || null,
        color: firstItem?.color || null,
        size: firstItem?.size || null,
        condition: firstItem?.condition || null,
        cost: firstItem?.cost || null,
        msrp: firstItem?.msrp || null,
      }).select().single()

      if (createErr) throw createErr

      // Assign all selected items to this product
      const { error: updateErr } = await supabase.from('kickstart_intake')
        .update({ product_id: product.id })
        .in('id', [...selected])

      if (updateErr) throw updateErr

      setSelected(new Set())
      setShowCreateModal(false)
      setNewTitle('')
      await loadData()
    } catch (err) {
      alert('Error: ' + err.message)
    }
    setSaving(false)
  }

  // ─── Assign selected items to existing product ──────────
  const handleAssign = async (productId) => {
    if (selected.size === 0) return
    setSaving(true)
    try {
      const { error } = await supabase.from('kickstart_intake')
        .update({ product_id: productId })
        .in('id', [...selected])

      if (error) throw error

      setSelected(new Set())
      setShowAssignModal(false)
      await loadData()
    } catch (err) {
      alert('Error: ' + err.message)
    }
    setSaving(false)
  }

  // ─── Unassign items from a product ──────────────────────
  const handleUnassign = async (productId) => {
    if (!confirm('Remove all items from this product? Items return to unassigned.')) return
    setSaving(true)
    try {
      const { error } = await supabase.from('kickstart_intake')
        .update({ product_id: null })
        .eq('product_id', productId)
      if (error) throw error
      await loadData()
    } catch (err) {
      alert('Error: ' + err.message)
    }
    setSaving(false)
  }

  // ─── Render ─────────────────────────────────────────────
  const filteredUnassigned = getFilteredUnassigned()
  const filteredProducts = getFilteredProducts()

  return (
    <div className="min-h-screen bg-navy relative overflow-hidden">
      <div className="bg-blob-cyan" /><div className="bg-blob-magenta" />

      <div className="relative z-10 max-w-lg mx-auto flex flex-col min-h-screen">
        {/* Header */}
        <div className="px-4 pt-6 pb-3">
          <div className="flex items-center gap-3 mb-4">
            <button onClick={() => navigate('/')} className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white">
              <iconify-icon icon="lucide:arrow-left" width="18" />
            </button>
            <div>
              <h1 className="text-xl font-bold text-white font-heading">Product Manager</h1>
              <p className="text-slate-500 text-xs">Group intake items into Shopify products</p>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 mb-3">
            <button
              onClick={() => { setTab('unassigned'); setSearchQuery(''); setSelected(new Set()) }}
              className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-all ${tab === 'unassigned' ? 'bg-pink-500 text-white shadow-lg shadow-pink-500/30' : 'bg-white/5 text-slate-400 border border-white/10'}`}
            >
              Unassigned ({unassigned.length})
            </button>
            <button
              onClick={() => { setTab('products'); setSearchQuery(''); setSelected(new Set()) }}
              className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-all ${tab === 'products' ? 'bg-pink-500 text-white shadow-lg shadow-pink-500/30' : 'bg-white/5 text-slate-400 border border-white/10'}`}
            >
              Products ({products.length})
            </button>
          </div>

          {/* Search */}
          <input
            type="text"
            placeholder={tab === 'unassigned' ? 'Search unassigned items...' : 'Search products...'}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder-slate-500 focus:border-pink-500/50 focus:outline-none"
          />
        </div>

        {/* Action bar (when items selected) */}
        {tab === 'unassigned' && selected.size > 0 && (
          <div className="px-4 pb-3 flex gap-2">
            <button
              onClick={() => {
                const first = unassigned.find(i => selected.has(i.id))
                setNewTitle(first ? [first.brand, first.description, first.color, first.size].filter(Boolean).join(' — ') : '')
                setShowCreateModal(true)
              }}
              className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-pink-500 text-white shadow-lg shadow-pink-500/30 hover:bg-pink-400 active:scale-95 transition-all"
            >
              New Product ({selected.size})
            </button>
            {products.length > 0 && (
              <button
                onClick={() => setShowAssignModal(true)}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-white/5 border border-white/10 text-white hover:bg-white/10 active:scale-95 transition-all"
              >
                Add to Existing
              </button>
            )}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 pb-24">
          {loading ? (
            <div className="text-center py-12 text-white/50">Loading...</div>
          ) : tab === 'unassigned' ? (
            <>
              {/* Select all */}
              {filteredUnassigned.length > 0 && (
                <button onClick={selectAll} className="text-pink-400 text-xs mb-2 hover:underline">
                  {selected.size === filteredUnassigned.length ? 'Deselect all' : `Select all ${filteredUnassigned.length}`}
                </button>
              )}

              {filteredUnassigned.length === 0 ? (
                <div className="text-center py-12">
                  <iconify-icon icon="lucide:check-circle" width="48" class="text-emerald-400 mb-3" />
                  <p className="text-white/50">All items assigned to products</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {filteredUnassigned.map(item => (
                    <button
                      key={item.id}
                      onClick={() => toggleSelect(item.id)}
                      className={`w-full text-left rounded-2xl p-3 transition-all active:scale-[0.98] flex items-center gap-3 ${
                        selected.has(item.id)
                          ? 'bg-pink-500/20 border border-pink-500/40'
                          : 'bg-white/5 border border-white/10 hover:bg-white/8'
                      }`}
                    >
                      {/* Checkbox */}
                      <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                        selected.has(item.id) ? 'bg-pink-500 border-pink-500' : 'border-white/20'
                      }`}>
                        {selected.has(item.id) && <iconify-icon icon="lucide:check" width="12" class="text-white" />}
                      </div>

                      <LazyPhoto intakeId={item.id} />

                      <div className="min-w-0 flex-1">
                        <p className="text-white text-sm font-medium truncate">
                          {[item.description, item.color].filter(Boolean).join(' — ') || 'Unknown'}
                        </p>
                        <p className="text-slate-400 text-xs">
                          {[item.brand, item.size, item.condition].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <span className="text-slate-600 text-xs">#{item.id}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            /* Products tab */
            filteredProducts.length === 0 ? (
              <div className="text-center py-12">
                <iconify-icon icon="lucide:package" width="48" class="text-slate-600 mb-3" />
                <p className="text-white/50">No products yet</p>
                <p className="text-slate-600 text-xs mt-1">Select unassigned items to create products</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredProducts.map(product => (
                  <div key={product.id} className="glass-card rounded-2xl p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="min-w-0 flex-1">
                        <h3 className="text-white font-semibold text-sm truncate">{product.title}</h3>
                        <p className="text-slate-400 text-xs">
                          {[product.brand, product.size, product.condition].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 ml-3">
                        {product.shopify_product_id ? (
                          <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full">Synced</span>
                        ) : (
                          <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full">Not listed</span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-xs">
                      <div>
                        <span className="text-slate-500">Available</span>
                        <span className="text-white font-bold ml-1">{product.qty_available}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Sold</span>
                        <span className="text-white font-bold ml-1">{product.qty_sold}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Total</span>
                        <span className="text-white font-bold ml-1">{product.qty_total}</span>
                      </div>
                      {product.cost && (
                        <div>
                          <span className="text-slate-500">Cost</span>
                          <span className="text-white font-bold ml-1">${parseFloat(product.cost).toFixed(2)}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={() => handleUnassign(product.id)}
                        className="text-xs text-slate-500 hover:text-red-400 transition-colors"
                      >
                        Unassign items
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>

      {/* ─── Create Product Modal ────────────────────────── */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowCreateModal(false)}>
          <div className="w-full max-w-lg bg-slate-900 border-t border-white/10 rounded-t-3xl p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-white font-heading mb-1">New Product</h2>
            <p className="text-slate-500 text-xs mb-4">{selected.size} item{selected.size !== 1 ? 's' : ''} will be assigned</p>

            <label className="text-slate-400 text-xs uppercase tracking-wider mb-1 block">Product Title</label>
            <input
              type="text"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              placeholder="e.g. Free People Red Socks — One Size"
              autoFocus
              className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder-slate-500 focus:border-pink-500/50 focus:outline-none mb-4"
            />

            <div className="flex gap-3">
              <button onClick={() => setShowCreateModal(false)} className="flex-1 py-3 rounded-xl text-sm font-semibold bg-white/5 border border-white/10 text-white active:scale-95 transition-all">
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!newTitle.trim() || saving}
                className="flex-1 py-3 rounded-xl text-sm font-bold bg-pink-500 text-white shadow-lg shadow-pink-500/30 hover:bg-pink-400 active:scale-95 transition-all disabled:opacity-50"
              >
                {saving ? 'Creating...' : 'Create Product'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Assign to Existing Product Modal ────────────── */}
      {showAssignModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowAssignModal(false)}>
          <div className="w-full max-w-lg bg-slate-900 border-t border-white/10 rounded-t-3xl p-6 max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-white font-heading mb-1">Add to Existing Product</h2>
            <p className="text-slate-500 text-xs mb-4">{selected.size} item{selected.size !== 1 ? 's' : ''} will be assigned</p>

            <div className="flex-1 overflow-y-auto space-y-2">
              {products.map(p => (
                <button
                  key={p.id}
                  onClick={() => handleAssign(p.id)}
                  disabled={saving}
                  className="w-full text-left rounded-2xl p-3 bg-white/5 border border-white/10 hover:bg-pink-500/10 hover:border-pink-500/30 active:scale-[0.98] transition-all"
                >
                  <p className="text-white text-sm font-semibold truncate">{p.title}</p>
                  <p className="text-slate-400 text-xs">
                    {[p.brand, p.size].filter(Boolean).join(' · ')} · {p.qty_available} available
                  </p>
                </button>
              ))}
            </div>

            <button onClick={() => setShowAssignModal(false)} className="mt-4 w-full py-3 rounded-xl text-sm font-semibold bg-white/5 border border-white/10 text-white active:scale-95 transition-all">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
