import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, fetchAll } from '../lib/supabase'
import { compressPhoto, toBase64 } from '../lib/photos'

// Lazy-loading photo thumbnail — tap to expand
function LazyPhoto({ intakeId }) {
  const [src, setSrc] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    setSrc(null)
    setLoaded(false)
  }, [intakeId])

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

  return (
    <>
      <div
        ref={ref}
        className="w-14 h-14 rounded-xl border border-white/20 shrink-0 overflow-hidden bg-white/10"
        onClick={(e) => { if (src) { e.stopPropagation(); setExpanded(true) } }}
      >
        {src ? (
          <img src={src} alt="Tag" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-white/20 text-xs">{loaded ? '...' : ''}</span>
          </div>
        )}
      </div>
      {expanded && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={(e) => { e.stopPropagation(); setExpanded(false) }}
        >
          <img src={src} alt="Tag" className="max-w-full max-h-full rounded-2xl" />
        </div>
      )}
    </>
  )
}

const PRICE_BINS = [3.41, 10, 15, 20, 25, 29, 30, 35, 40]
const CATEGORIES = [
  'Accessories - Bags', 'Accessories - Belts', 'Accessories - Jewelry',
  'Accessories - Other', 'Accessories - Socks', 'Dresses', 'Hoodies',
  'Jumpsuits', 'Leggings', 'Long Sleeve Tops', 'Outerwear/Jackets',
  'Pants', 'Rompers', 'Sets', 'Shorts', 'Short Sleeve Tops', 'Skirts',
  'Sleeveless Tops'
]
const COLOR_GROUPS = [
  { label: 'Core Colors', colors: ['Blue', 'Dark Blue', 'Green', 'Light Blue', 'Orange', 'Pink', 'Purple', 'Red', 'Yellow'] },
  { label: 'Neutrals', colors: ['Black', 'Brown', 'Burgundy', 'Denim', 'Gray', 'Ivory / Cream', 'Navy', 'Olive', 'Tan', 'White'] },
  { label: 'Patterns', colors: ['Multi-Color', 'Other Pattern', 'Plaid', 'Stripe'] },
]
const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'One Size']
const CONDITIONS = ['NWT', 'NWOT', 'Pre-loved/Nuuly']

export default function KickstartSort() {
  const navigate = useNavigate()
  const [step, setStep] = useState('bin') // bin, brand, details, restock, editRecent, editItem
  const [selectedBin, setSelectedBin] = useState(null)
  const [selectedBrand, setSelectedBrand] = useState(null)
  const [customPrice, setCustomPrice] = useState('')
  const [showCustom, setShowCustom] = useState(false)
  const [itemPhoto, setItemPhoto] = useState(null)
  const [description, setDescription] = useState('')
  const [condition, setCondition] = useState('')
  const [color, setColor] = useState('')
  const [size, setSize] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [saving, setSaving] = useState(false)
  const [showSaved, setShowSaved] = useState(false)
  const [sessionCount, setSessionCount] = useState(0)
  const [notes, setNotes] = useState('')
  const [msrp, setMsrp] = useState('')
  const itemPhotoRef = useRef(null)

  // AI garment identification state
  const [identifying, setIdentifying] = useState(false)
  const [identifyResult, setIdentifyResult] = useState(null)
  const [identifyError, setIdentifyError] = useState(null)
  const identifyPhotoRef = useRef(null)
  const identifyLibraryRef = useRef(null)

  // Restock + Edit shared state
  const [allItems, setAllItems] = useState([])
  const [categories, setCategories] = useState([])
  const [itemsLoading, setItemsLoading] = useState(false)
  const [filterSize, setFilterSize] = useState(null)
  const [filterCondition, setFilterCondition] = useState(null)
  const [filterCategory, setFilterCategory] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [openFilter, setOpenFilter] = useState(null) // 'size' | 'category' | 'condition' | null
  const [editingItem, setEditingItem] = useState(null)
  const [restockItem, setRestockItem] = useState(null) // item being restocked (read-only confirm)
  const [restockQty, setRestockQty] = useState(1)

  // --- Load all items (shared by restock + edit) — same pattern as SalesScanner ---
  const loadAllItems = async () => {
    setItemsLoading(true)
    try {
      const items = await fetchAll(() => supabase
        .from('kickstart_intake')
        .select('id, description, brand, color, size, condition, msrp, cost, notes, status, created_at')
        .neq('description', 'Manual entry')
        .not('color', 'is', null)
        .not('size', 'is', null)
        .order('created_at', { ascending: false }))

      // Extract unique categories with counts
      const catCounts = {}
      for (const item of items) {
        const cat = item.description || 'Uncategorized'
        catCounts[cat] = (catCounts[cat] || 0) + 1
      }
      const cats = Object.entries(catCounts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)

      setAllItems(items)
      setCategories(cats)
      setFilterSize(null)
      setFilterCondition(null)
      setFilterCategory(null)
      setSearchQuery('')
      setOpenFilter(null)
    } catch (err) {
      console.error('Load items error:', err)
    }
    setItemsLoading(false)
  }

  // Client-side filtering
  const getFilteredItems = () => {
    let filtered = allItems
    if (filterSize) filtered = filtered.filter(i => i.size === filterSize)
    if (filterCondition) filtered = filtered.filter(i => (i.condition || '') === filterCondition)
    if (filterCategory) filtered = filtered.filter(i => (i.description || 'Uncategorized') === filterCategory)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      filtered = filtered.filter(i => {
        const searchable = [i.brand, i.description, i.color, i.condition, i.notes].filter(Boolean).join(' ').toLowerCase()
        return searchable.includes(q)
      })
    }
    return filtered
  }

  // For restock: group identical items
  const getGroupedItems = () => {
    const filtered = getFilteredItems()
    const groups = new Map()
    for (const item of filtered) {
      const key = `${item.brand}||${item.description || ''}||${item.color || ''}||${item.size || ''}||${item.condition || ''}`
      if (!groups.has(key)) {
        groups.set(key, { ...item, ids: [] })
      }
      groups.get(key).ids.push(item.id)
    }
    return Array.from(groups.values()).sort((a, b) => b.ids.length - a.ids.length)
  }

  const resetFilters = () => {
    setFilterSize(null)
    setFilterCondition(null)
    setFilterCategory(null)
    setSearchQuery('')
    setOpenFilter(null)
  }

  const handleRestockSelect = (item) => {
    setRestockItem(item)
    setRestockQty(1)
    setStep('restockConfirm')
  }

  const handleRestockSave = async () => {
    if (!restockItem) return
    setSaving(true)
    try {
      const sourceId = restockItem.id || restockItem.ids?.[0]

      // Fetch photo from original item
      let itemPhotoData = null
      if (sourceId) {
        const { data: original } = await supabase
          .from('kickstart_intake')
          .select('item_photo_data')
          .eq('id', sourceId)
          .single()
        itemPhotoData = original?.item_photo_data || null
      }

      const baseRow = {
        cost: restockItem.cost ? parseFloat(restockItem.cost) : null,
        brand: restockItem.brand || null,
        description: restockItem.description || null,
        color: restockItem.color || null,
        size: restockItem.size || null,
        condition: restockItem.condition || null,
        msrp: restockItem.msrp ? parseFloat(restockItem.msrp) : null,
        item_photo_data: itemPhotoData,
        notes: restockItem.notes || null,
        status: 'enriched',
      }

      const rows = Array.from({ length: restockQty }, () => ({ ...baseRow }))
      const { error } = await supabase.from('kickstart_intake').insert(rows)
      if (error) throw error

      setSessionCount(prev => prev + restockQty)
      setShowSaved(true)
      setTimeout(() => {
        setShowSaved(false)
        setRestockItem(null)
        setStep('bin')
      }, 400)
    } catch (err) {
      alert('Save error: ' + (err?.message || JSON.stringify(err)))
    } finally {
      setSaving(false)
    }
  }

  const handleEditSelect = (item) => {
    setEditingItem({ ...item })
    setStep('editItem')
  }

  const handleEditSave = async () => {
    if (!editingItem) return
    setSaving(true)
    try {
      const { error } = await supabase.from('kickstart_intake').update({
        cost: editingItem.cost ? parseFloat(editingItem.cost) : null,
        brand: editingItem.brand || null,
        description: editingItem.description || null,
        color: editingItem.color || null,
        size: editingItem.size || null,
        condition: editingItem.condition || null,
        msrp: editingItem.msrp ? parseFloat(editingItem.msrp) : null,
        notes: editingItem.notes || null,
      }).eq('id', editingItem.id)
      if (error) throw error
      setShowSaved(true)
      setTimeout(() => {
        setShowSaved(false)
        setEditingItem(null)
        setStep('bin')
      }, 400)
    } catch (err) {
      alert('Save error: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const getCost = () => {
    if (showCustom) return parseFloat(customPrice) || 0
    return selectedBin || 0
  }

  // --- Bin step ---
  const handleBinSelect = (price) => {
    setSelectedBin(price)
    setShowCustom(false)
    setStep('brand')
  }

  const handleCustomSelect = () => {
    setShowCustom(true)
    setSelectedBin(null)
  }

  const handleCustomConfirm = () => {
    if (parseFloat(customPrice) > 0) {
      setStep('brand')
    }
  }

  // --- Brand step ---
  const handleBrandSelect = (brand) => {
    setSelectedBrand(brand)
    setStep('details')
  }

  // --- Photo capture ---
  const handleItemPhotoCapture = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    try {
      const dataUrl = await compressPhoto(file, { maxWidth: 800, quality: 0.5 })
      setItemPhoto(dataUrl)
    } catch (err) {
      console.error('Photo compression error:', err)
      alert('Failed to process photo')
    }
  }

  // --- AI Garment Identification ---
  const handleIdentifyCapture = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    setIdentifying(true)
    setIdentifyResult(null)
    setIdentifyError(null)

    try {
      const dataUrl = await compressPhoto(file, { maxWidth: 800, quality: 0.5 })
      setItemPhoto(dataUrl) // Use identify photo as the item photo
      const base64 = toBase64(dataUrl)

      // Step 1: Upload image to Supabase storage directly from client (faster than routing through function)
      const tempFileName = `identify-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
      const imageBytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))

      const { error: uploadErr } = await supabase.storage
        .from('temp-identify')
        .upload(tempFileName, imageBytes, { contentType: 'image/jpeg', upsert: true })

      if (uploadErr) throw new Error('Failed to upload image')

      const { data: { publicUrl } } = supabase.storage
        .from('temp-identify')
        .getPublicUrl(tempFileName)

      // Step 2: Call identify function with URL (no image payload — fast)
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 25000)

      const response = await fetch('/.netlify/functions/identify-item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: publicUrl, brand: selectedBrand }),
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      // Fire-and-forget cleanup of temp image
      supabase.storage.from('temp-identify').remove([tempFileName]).catch(() => {})

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || 'Identification failed')
      }

      const result = await response.json()
      setIdentifyResult(result)

      // Auto-fill fields
      if (result.product_name) setNotes(result.product_name)
      if (result.msrp && result.msrp > 0) setMsrp(String(result.msrp))
      if (result.category && CATEGORIES.includes(result.category)) setDescription(result.category)
      if (result.color) {
        const allColors = COLOR_GROUPS.flatMap(g => g.colors)
        if (allColors.includes(result.color)) setColor(result.color)
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        setIdentifyError('Timed out — try again or enter manually')
      } else {
        setIdentifyError(err.message || 'Identification failed')
      }
    } finally {
      setIdentifying(false)
      if (identifyPhotoRef.current) identifyPhotoRef.current.value = ''
      if (identifyLibraryRef.current) identifyLibraryRef.current.value = ''
    }
  }

  // --- Save ---
  const handleSave = async () => {
    setSaving(true)
    try {
      const cost = getCost()
      const itemPhotoData = itemPhoto ? toBase64(itemPhoto) : null

      const baseRow = {
        cost,
        brand: selectedBrand,
        description: description || null,
        color: color || null,
        size: size || null,
        condition: condition || null,
        msrp: msrp ? parseFloat(msrp) : null,
        item_photo_data: itemPhotoData,
        notes: notes || null,
        status: 'enriched',
      }

      const rows = Array.from({ length: quantity }, () => ({ ...baseRow }))

      let { error } = await supabase.from('kickstart_intake').insert(rows)
      if (error) throw error

      setSessionCount(prev => prev + quantity)

      setShowSaved(true)
      setTimeout(() => {
        setShowSaved(false)
        resetForNext()
      }, 400)
    } catch (err) {
      console.error('Save error:', err)
      alert('Failed to save: ' + (err?.message || err?.code || JSON.stringify(err)))
    } finally {
      setSaving(false)
    }
  }

  // Keep bin, brand, condition, category — reset item-specific fields
  const resetForNext = () => {
    setColor('')
    setSize('')
    setQuantity(1)
    setNotes('')
    setMsrp('')
    setItemPhoto(null)
    setIdentifyResult(null)
    setIdentifyError(null)
    if (itemPhotoRef.current) itemPhotoRef.current.value = ''
    if (identifyPhotoRef.current) identifyPhotoRef.current.value = ''
  }

  // --- Back navigation ---
  const handleBack = () => {
    switch (step) {
      case 'bin': navigate('/'); break
      case 'brand': setStep('bin'); break
      case 'details':
        setDescription('')
        setCondition('')
        setColor('')
        setSize('')
        setQuantity(1)
        setNotes('')
        setMsrp('')
        setItemPhoto(null)
        setIdentifyResult(null)
        setIdentifyError(null)
        if (itemPhotoRef.current) itemPhotoRef.current.value = ''
        if (identifyPhotoRef.current) identifyPhotoRef.current.value = ''
      if (identifyLibraryRef.current) identifyLibraryRef.current.value = ''
        setStep('brand')
        break
      case 'restock': setStep('bin'); break
      case 'restockConfirm': setRestockItem(null); setStep('restock'); break
      case 'editRecent': setStep('bin'); break
      case 'editItem': setEditingItem(null); setStep('editRecent'); break
    }
  }

  const backLabel = () => {
    switch (step) {
      case 'bin': return '← Home'
      case 'brand': return '← Bin'
      case 'details': return '← Brand'
      case 'restock': return '← Back'
      case 'restockConfirm': return '← Back'
      case 'editRecent': return '← Back'
      case 'editItem': return '← Back'
      default: return '← Back'
    }
  }

  // === SAVED FLASH ===
  if (showSaved) {
    return (
      <div className="h-screen flex items-center justify-center bg-gradient-to-br from-cyan-600 via-teal-500 to-emerald-500">
        <div className="text-center">
          <div className="text-9xl mb-4">✓</div>
          <h2 className="text-5xl font-black text-white mb-2 font-heading">Saved!</h2>
          <p className="text-xl text-white/80">{quantity > 1 ? `${quantity} items` : '1 item'} added</p>
        </div>
      </div>
    )
  }

  const pastBinBrand = step === 'details'
  const brandAbbrev = { 'Free People': 'FP', 'Urban Outfitters': 'UO', 'Anthropologie': 'Anthro' }

  return (
    <div className="flex flex-col bg-navy" style={{ height: '100dvh', overflow: 'hidden' }}>
      {/* Subtle gradient overlay */}
      <div className="fixed inset-0 bg-gradient-to-br from-pink-900/20 via-transparent to-pink-900/10 pointer-events-none" />

      {/* Header */}
      <div className="relative z-10 px-3 py-2 flex items-center justify-between border-b border-white/10 shrink-0">
        <button
          onClick={handleBack}
          className="bg-white/10 hover:bg-white/20 backdrop-blur-lg px-3 py-1.5 rounded-full border border-white/20 text-white font-semibold text-sm"
        >
          {backLabel()}
        </button>
        <h1 className="text-lg font-bold text-white font-heading">Kickstart</h1>
        <div className="bg-gradient-to-r from-pink-500/20 to-pink-600/20 backdrop-blur-lg px-3 py-1.5 rounded-full border border-pink-400/30">
          <span className="text-pink-300 font-bold text-sm">{sessionCount} today</span>
        </div>
      </div>

      {/* Compact bin+brand bar when past those steps */}
      {pastBinBrand && (
        <div className="relative z-10 mx-3 mt-2 bg-pink-500/20 border border-pink-500/30 rounded-xl px-3 py-2 shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-pink-200 text-sm font-semibold">${getCost()}</span>
            <span className="text-white/30">·</span>
            <span className="text-pink-200 text-sm font-semibold">{brandAbbrev[selectedBrand] || selectedBrand}</span>
          </div>
          <button
            onClick={() => setStep('bin')}
            className="text-pink-400 text-xs font-semibold"
          >
            Change
          </button>
        </div>
      )}

      {/* === STEP 1: BIN SELECTION === */}
      {step === 'bin' && (
        <div className="relative z-10 flex-1 flex flex-col items-center pt-3 px-4 overflow-y-auto">
          <h2 className="text-lg font-bold text-white mb-0.5 tracking-tight font-heading">Select Price Bin</h2>
          <p className="text-slate-400 mb-2 text-sm">What did we pay per item?</p>

          <div className="w-full max-w-sm grid grid-cols-3 gap-2 mb-3">
            {PRICE_BINS.map(price => (
              <button
                key={price}
                onClick={() => handleBinSelect(price)}
                className="py-3 rounded-xl bg-gradient-to-br from-pink-500/80 to-pink-600/80 border-2 border-pink-400/40 text-white font-black text-xl shadow-lg shadow-pink-500/20 hover:scale-105 active:scale-95 transition-all"
              >
                ${price}
              </button>
            ))}
          </div>

          {/* Custom price */}
          {!showCustom ? (
            <button
              onClick={handleCustomSelect}
              className="w-full max-w-sm py-3 rounded-3xl bg-white/10 border border-white/20 text-white/70 font-semibold text-lg hover:bg-white/20 transition-all"
            >
              Other Amount
            </button>
          ) : (
            <div className="w-full max-w-sm">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/50 text-lg">$</span>
                  <input
                    type="number"
                    value={customPrice}
                    onChange={e => setCustomPrice(e.target.value)}
                    placeholder="0.00"
                    autoFocus
                    className="w-full bg-white/5 border border-white/10 rounded-2xl pl-8 pr-4 py-3 text-white text-xl font-bold placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 focus:ring-4 focus:ring-cyan-500/10 transition-all"
                  />
                </div>
                <button
                  onClick={handleCustomConfirm}
                  disabled={!customPrice || parseFloat(customPrice) <= 0}
                  className={`px-6 rounded-xl font-bold text-lg transition-all ${
                    customPrice && parseFloat(customPrice) > 0
                      ? 'bg-gradient-to-r from-pink-500 to-pink-600 text-white'
                      : 'bg-white/5 text-white/30 cursor-not-allowed'
                  }`}
                >
                  Go
                </button>
              </div>
            </div>
          )}

          {/* Restock + Edit buttons */}
          <div className="w-full max-w-sm flex gap-2 mt-3">
            <button
              onClick={() => { resetFilters(); loadAllItems(); setStep('restock') }}
              className="flex-1 py-3 rounded-3xl bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 font-semibold text-base hover:bg-cyan-500/30 transition-all"
            >
              Restock
            </button>
            <button
              onClick={() => { resetFilters(); loadAllItems(); setStep('editRecent') }}
              className="flex-1 py-3 rounded-3xl bg-orange-500/20 border border-orange-500/30 text-orange-300 font-semibold text-base hover:bg-orange-500/30 transition-all"
            >
              Edit Recent
            </button>
          </div>
        </div>
      )}

      {/* === STEP 2: BRAND SELECTION === */}
      {step === 'brand' && (
        <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-4">
          <h2 className="text-xl font-bold text-white mb-1 tracking-tight font-heading">Select Brand</h2>
          <p className="text-slate-400 mb-6 text-sm">Which brand is this item?</p>

          <div className="w-full max-w-sm flex flex-col gap-3">
            {['Free People', 'Urban Outfitters', 'Anthropologie'].map(brand => (
              <button
                key={brand}
                onClick={() => handleBrandSelect(brand)}
                className="py-5 rounded-3xl bg-gradient-to-br from-pink-500/80 to-pink-600/80 border-2 border-pink-400/40 text-white font-black text-2xl shadow-xl shadow-pink-500/20 hover:scale-105 active:scale-95 transition-all"
              >
                {brand}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* === RESTOCK / EDIT ITEM PICKER (shared UI) === */}
      {(step === 'restock' || step === 'editRecent') && (
        <div className="relative z-10 flex-1 min-h-0 flex flex-col overflow-hidden">
          {/* Filter pills + search */}
          <div className="px-4 py-2 bg-slate-800/50 border-b border-white/10 space-y-2 flex-shrink-0">
            {/* Filter pills row — Size → Category → Condition */}
            <div className="flex gap-2">
              {/* Size pill */}
              <div className="relative">
                <button
                  onClick={() => setOpenFilter(openFilter === 'size' ? null : 'size')}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all whitespace-nowrap flex items-center gap-1 ${
                    filterSize
                      ? 'bg-pink-500 text-white'
                      : 'bg-white/10 text-white/60 border border-white/20'
                  }`}
                >
                  {filterSize || 'Size'}
                  {filterSize ? (
                    <span onClick={(e) => { e.stopPropagation(); setFilterSize(null); setOpenFilter(null) }} className="ml-0.5 opacity-70 hover:opacity-100">&times;</span>
                  ) : (
                    <span className="text-[10px] opacity-50">&#9662;</span>
                  )}
                </button>
                {openFilter === 'size' && (
                  <div className="absolute top-full left-0 mt-1 bg-slate-800 border border-white/20 rounded-xl p-2 z-50 shadow-xl shadow-black/50 flex flex-wrap gap-1.5 min-w-[200px]">
                    {SIZES.map(s => (
                      <button
                        key={s}
                        onClick={() => { setFilterSize(s); setOpenFilter(null) }}
                        className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                          filterSize === s ? 'bg-pink-500 text-white' : 'bg-white/10 text-white/60 hover:bg-white/20'
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Category pill */}
              <div className="relative">
                <button
                  onClick={() => setOpenFilter(openFilter === 'category' ? null : 'category')}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all whitespace-nowrap flex items-center gap-1 ${
                    filterCategory
                      ? 'bg-pink-500 text-white'
                      : 'bg-white/10 text-white/60 border border-white/20'
                  }`}
                >
                  {filterCategory || 'Category'}
                  {filterCategory ? (
                    <span onClick={(e) => { e.stopPropagation(); setFilterCategory(null); setOpenFilter(null) }} className="ml-0.5 opacity-70 hover:opacity-100">&times;</span>
                  ) : (
                    <span className="text-[10px] opacity-50">&#9662;</span>
                  )}
                </button>
                {openFilter === 'category' && (
                  <div className="absolute top-full left-0 mt-1 bg-slate-800 border border-white/20 rounded-xl p-2 z-50 shadow-xl shadow-black/50 flex flex-wrap gap-1.5 min-w-[200px] max-w-[280px]">
                    {categories.slice(0, 8).map(cat => (
                      <button
                        key={cat.name}
                        onClick={() => { setFilterCategory(cat.name); setOpenFilter(null) }}
                        className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all whitespace-nowrap ${
                          filterCategory === cat.name ? 'bg-pink-500 text-white' : 'bg-white/10 text-white/60 hover:bg-white/20'
                        }`}
                      >
                        {cat.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Condition pill */}
              <div className="relative">
                <button
                  onClick={() => setOpenFilter(openFilter === 'condition' ? null : 'condition')}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all whitespace-nowrap flex items-center gap-1 ${
                    filterCondition
                      ? 'bg-pink-500 text-white'
                      : 'bg-white/10 text-white/60 border border-white/20'
                  }`}
                >
                  {filterCondition || 'Condition'}
                  {filterCondition ? (
                    <span onClick={(e) => { e.stopPropagation(); setFilterCondition(null); setOpenFilter(null) }} className="ml-0.5 opacity-70 hover:opacity-100">&times;</span>
                  ) : (
                    <span className="text-[10px] opacity-50">&#9662;</span>
                  )}
                </button>
                {openFilter === 'condition' && (
                  <div className="absolute top-full left-0 mt-1 bg-slate-800 border border-white/20 rounded-xl p-2 z-50 shadow-xl shadow-black/50 flex flex-wrap gap-1.5">
                    {CONDITIONS.map(c => (
                      <button
                        key={c}
                        onClick={() => { setFilterCondition(c); setOpenFilter(null) }}
                        className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all whitespace-nowrap ${
                          filterCondition === c ? 'bg-pink-500 text-white' : 'bg-white/10 text-white/60 hover:bg-white/20'
                        }`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Search box */}
            <input
              type="text"
              placeholder="Search by brand, description, color..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-2xl text-white placeholder-white/40 focus:outline-none focus:border-cyan-500/50 focus:ring-4 focus:ring-cyan-500/10 transition-all text-sm"
            />
          </div>

          {/* Dismiss popover when tapping items list */}
          {openFilter && (
            <div className="fixed inset-0 z-40" onClick={() => setOpenFilter(null)} />
          )}

          {/* Items list */}
          <div className="flex-1 overflow-y-auto p-4 min-h-0">
            {itemsLoading ? (
              <div className="text-center py-12"><p className="text-white/50 text-lg">Loading...</p></div>
            ) : (() => {
              const items = step === 'restock' ? getGroupedItems() : getFilteredItems()
              return items.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-white/50 text-lg mb-2">No items found</p>
                  <button onClick={resetFilters} className="text-pink-400 text-sm underline">Clear filters</button>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-white/40 text-xs mb-1">{items.length} result{items.length !== 1 ? 's' : ''}</p>
                  {items.map((item, i) => (
                    <button
                      key={item.id || item.ids?.[0] || i}
                      onClick={() => step === 'restock' ? handleRestockSelect(item) : handleEditSelect(item)}
                      className="w-full text-left bg-white/5 border border-white/10 rounded-3xl p-3 hover:bg-pink-500/10 hover:border-pink-500/30 active:scale-[0.98] transition-all"
                    >
                      <div className="flex items-center gap-3">
                        <LazyPhoto intakeId={item.id || item.ids?.[0]} />
                        <div className="min-w-0 flex-1">
                          <p className="text-white font-semibold text-sm truncate">
                            {[item.description, item.color].filter(Boolean).join(' — ') || 'Unknown'}
                          </p>
                          {item.notes && (
                            <p className="text-pink-300/70 text-xs truncate">{item.notes}</p>
                          )}
                          <p className="text-slate-400 text-xs">
                            {[item.brand, item.size, item.condition].filter(Boolean).join(' · ')}
                          </p>
                          <p className="text-slate-500 text-xs mt-0.5">
                            ${parseFloat(item.cost || 0).toFixed(2)}{item.msrp ? ` · MSRP $${parseFloat(item.msrp).toFixed(2)}` : ''}
                          </p>
                        </div>
                        {item.ids && item.ids.length > 1 && (
                          <span className="text-pink-300 font-bold text-sm bg-pink-500/20 px-3 py-1 rounded-full shrink-0">
                            {item.ids.length}
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )
            })()}
          </div>
        </div>
      )}

      {/* === RESTOCK CONFIRM (read-only) === */}
      {step === 'restockConfirm' && restockItem && (
        <div className="relative z-10 flex-1 min-h-0 flex flex-col">
          <div className="flex-1 overflow-y-auto p-4">
            <h2 className="text-lg font-bold text-white mb-3 font-heading">Restock Item</h2>

            {/* Photo + summary card */}
            <div className="bg-white/5 border border-white/10 rounded-3xl p-4 mb-4">
              <div className="flex gap-4 mb-3">
                <LazyPhoto intakeId={restockItem.id || restockItem.ids?.[0]} />
                <div className="min-w-0 flex-1">
                  <p className="text-white font-semibold text-base">
                    {[restockItem.description, restockItem.color].filter(Boolean).join(' — ') || 'Unknown'}
                  </p>
                  {restockItem.notes && (
                    <p className="text-pink-300/70 text-sm">{restockItem.notes}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-slate-500">Brand</span><p className="text-white">{restockItem.brand || '—'}</p></div>
                <div><span className="text-slate-500">Size</span><p className="text-white">{restockItem.size || '—'}</p></div>
                <div><span className="text-slate-500">Category</span><p className="text-white">{restockItem.description || '—'}</p></div>
                <div><span className="text-slate-500">Condition</span><p className="text-white">{restockItem.condition || '—'}</p></div>
                <div><span className="text-slate-500">Color</span><p className="text-white">{restockItem.color || '—'}</p></div>
                <div><span className="text-slate-500">Cost</span><p className="text-white">${parseFloat(restockItem.cost || 0).toFixed(2)}</p></div>
                <div><span className="text-slate-500">MSRP</span><p className="text-white">{restockItem.msrp ? `$${parseFloat(restockItem.msrp).toFixed(2)}` : '—'}</p></div>
                {restockItem.ids && restockItem.ids.length > 0 && (
                  <div><span className="text-slate-500">In stock</span><p className="text-white">{restockItem.ids.length}</p></div>
                )}
              </div>
            </div>

            {/* Quantity picker */}
            <div className="flex flex-col items-center">
              <p className="text-slate-400 text-sm mb-3">How many are you adding?</p>
              <div className="flex items-center gap-5 mb-2">
                <button
                  onClick={() => setRestockQty(q => Math.max(1, q - 1))}
                  className="w-11 h-11 rounded-full bg-white/10 border border-white/20 text-white text-2xl font-bold flex items-center justify-center hover:bg-white/20 active:scale-95 transition-all"
                >
                  −
                </button>
                <input
                  type="number"
                  value={restockQty}
                  onChange={e => { const v = parseInt(e.target.value, 10); setRestockQty(v > 0 ? v : 1) }}
                  className="w-20 text-center bg-white/5 border border-white/10 rounded-2xl py-2 text-3xl font-black text-white focus:outline-none focus:border-cyan-500/50 focus:ring-4 focus:ring-cyan-500/10 transition-all"
                />
                <button
                  onClick={() => setRestockQty(q => q + 1)}
                  className="w-11 h-11 rounded-full bg-gradient-to-br from-pink-500 to-pink-600 text-white text-2xl font-bold flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-lg shadow-pink-500/30"
                >
                  +
                </button>
              </div>
              {restockQty > 1 && (
                <p className="text-slate-400 text-sm">
                  Total: <span className="text-white font-bold">${(parseFloat(restockItem.cost || 0) * restockQty).toFixed(2)}</span> for {restockQty} items
                </p>
              )}
            </div>
          </div>

          {/* Save button */}
          <div className="shrink-0 p-4 pt-2">
            <button
              onClick={handleRestockSave}
              disabled={saving}
              className={`w-full py-4 rounded-3xl font-bold text-xl transition-all ${
                saving
                  ? 'bg-white/10 text-white/50 cursor-wait'
                  : 'bg-gradient-to-r from-pink-500 to-pink-600 text-white shadow-2xl shadow-pink-500/30 hover:scale-[1.02] active:scale-[0.98]'
              }`}
            >
              {saving ? 'Saving...' : restockQty > 1 ? `Add ${restockQty} Items` : 'Add 1 Item'}
            </button>
          </div>
        </div>
      )}

      {/* === EDIT ITEM === */}
      {step === 'editItem' && editingItem && (
        <div className="relative z-10 flex-1 min-h-0 flex flex-col">
          <div className="flex-1 overflow-y-auto p-4">
            <h2 className="text-lg font-bold text-white mb-3 font-heading">Edit Item #{editingItem.id}</h2>
            <div className="flex flex-col items-center">

              {/* Cost */}
              <div className="w-full max-w-sm mb-3">
                <label className="text-slate-400 text-xs uppercase tracking-wider mb-1 block">Cost</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/50">$</span>
                  <input
                    type="number"
                    value={editingItem.cost || ''}
                    onChange={e => setEditingItem(prev => ({ ...prev, cost: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl pl-8 pr-4 py-3 text-white text-base font-semibold placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 focus:ring-4 focus:ring-cyan-500/10 transition-all"
                  />
                </div>
              </div>

              {/* Brand */}
              <div className="w-full max-w-sm mb-3">
                <label className="text-slate-400 text-xs uppercase tracking-wider mb-1 block">Brand</label>
                <select
                  value={editingItem.brand || ''}
                  onChange={e => setEditingItem(prev => ({ ...prev, brand: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white text-base font-semibold appearance-none focus:outline-none focus:border-cyan-500/50 focus:ring-4 focus:ring-cyan-500/10 transition-all"
                >
                  <option value="" className="bg-[#1a1f2e]">Select...</option>
                  <option value="Free People" className="bg-[#1a1f2e]">Free People</option>
                  <option value="Urban Outfitters" className="bg-[#1a1f2e]">Urban Outfitters</option>
                  <option value="Anthropologie" className="bg-[#1a1f2e]">Anthropologie</option>
                </select>
              </div>

              {/* Size */}
              <div className="w-full max-w-sm mb-3">
                <label className="text-slate-400 text-xs uppercase tracking-wider mb-2 block">Size</label>
                <div className="grid grid-cols-4 gap-2">
                  {SIZES.map(s => (
                    <button
                      key={s}
                      onClick={() => setEditingItem(prev => ({ ...prev, size: prev.size === s ? '' : s }))}
                      className={`py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95 ${
                        editingItem.size === s
                          ? 'bg-orange-500 text-white'
                          : 'bg-white/10 text-white/60 border border-white/10'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Category */}
              <div className="w-full max-w-sm mb-3">
                <label className="text-slate-400 text-xs uppercase tracking-wider mb-1 block">Category</label>
                <select
                  value={editingItem.description || ''}
                  onChange={e => setEditingItem(prev => ({ ...prev, description: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white text-base font-semibold appearance-none focus:outline-none focus:border-cyan-500/50 focus:ring-4 focus:ring-cyan-500/10 transition-all"
                >
                  <option value="" className="bg-[#1a1f2e]">Select...</option>
                  {CATEGORIES.map(cat => <option key={cat} value={cat} className="bg-[#1a1f2e]">{cat}</option>)}
                </select>
              </div>

              {/* Condition */}
              <div className="w-full max-w-sm mb-3">
                <label className="text-slate-400 text-xs uppercase tracking-wider mb-1 block">Condition</label>
                <select
                  value={editingItem.condition || ''}
                  onChange={e => setEditingItem(prev => ({ ...prev, condition: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white text-base font-semibold appearance-none focus:outline-none focus:border-cyan-500/50 focus:ring-4 focus:ring-cyan-500/10 transition-all"
                >
                  <option value="" className="bg-[#1a1f2e]">Select...</option>
                  {CONDITIONS.map(c => <option key={c} value={c} className="bg-[#1a1f2e]">{c}</option>)}
                </select>
              </div>

              {/* Color */}
              <div className="w-full max-w-sm mb-3">
                <label className="text-slate-400 text-xs uppercase tracking-wider mb-1 block">Color</label>
                <select
                  value={editingItem.color || ''}
                  onChange={e => setEditingItem(prev => ({ ...prev, color: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white text-base font-semibold appearance-none focus:outline-none focus:border-cyan-500/50 focus:ring-4 focus:ring-cyan-500/10 transition-all"
                >
                  <option value="" className="bg-[#1a1f2e]">Select...</option>
                  {COLOR_GROUPS.map(group => (
                    <optgroup key={group.label} label={group.label} className="bg-[#1a1f2e] text-slate-400">
                      {group.colors.map(c => <option key={c} value={c} className="bg-[#1a1f2e] text-white">{c}</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>

              {/* MSRP */}
              <div className="w-full max-w-sm mb-3">
                <label className="text-slate-400 text-xs uppercase tracking-wider mb-1 block">MSRP</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/50">$</span>
                  <input
                    type="number"
                    value={editingItem.msrp || ''}
                    onChange={e => setEditingItem(prev => ({ ...prev, msrp: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl pl-8 pr-4 py-3 text-white text-base font-semibold placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 focus:ring-4 focus:ring-cyan-500/10 transition-all"
                  />
                </div>
              </div>

              {/* Notes */}
              <div className="w-full max-w-sm mb-3">
                <label className="text-slate-400 text-xs uppercase tracking-wider mb-1 block">Notes</label>
                <input
                  type="text"
                  value={editingItem.notes || ''}
                  onChange={e => setEditingItem(prev => ({ ...prev, notes: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 focus:ring-4 focus:ring-cyan-500/10 transition-all"
                />
              </div>
            </div>
          </div>

          {/* Save button */}
          <div className="shrink-0 p-4 pt-2">
            <button
              onClick={handleEditSave}
              disabled={saving}
              className={`w-full py-4 rounded-3xl font-bold text-xl transition-all ${
                saving
                  ? 'bg-white/10 text-white/50 cursor-wait'
                  : 'bg-gradient-to-r from-orange-500 to-orange-600 text-white shadow-2xl shadow-orange-500/30 hover:scale-[1.02] active:scale-[0.98]'
              }`}
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}

      {/* === STEP 3: DETAILS FORM === */}
      {step === 'details' && (
        <div className="relative z-10 flex-1 min-h-0 flex flex-col" style={{ WebkitOverflowScrolling: 'touch' }}>
          <div className="flex-1 overflow-y-auto p-4">
            <div className="flex flex-col items-center">

            {/* AI Garment Identification — optional */}
            <div className="w-full max-w-sm mb-4">
              <input
                ref={identifyPhotoRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleIdentifyCapture}
                className="hidden"
              />
              <input
                ref={identifyLibraryRef}
                type="file"
                accept="image/*"
                onChange={handleIdentifyCapture}
                className="hidden"
              />

              {!identifying && !identifyResult && !identifyError && !itemPhoto && (
                <div className="flex gap-2 w-full">
                  <button
                    onClick={() => identifyPhotoRef.current?.click()}
                    className="flex-1 flex items-center justify-center gap-2 bg-pink-500/20 border-2 border-dashed border-pink-400/40 rounded-xl px-3 py-5 text-pink-300 font-semibold hover:bg-pink-500/30 transition-all active:scale-95"
                  >
                    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    Take Photo
                  </button>
                  <button
                    onClick={() => identifyLibraryRef.current?.click()}
                    className="flex items-center justify-center gap-2 bg-pink-500/10 border-2 border-dashed border-pink-400/20 rounded-xl px-4 py-5 text-pink-300/70 font-semibold hover:bg-pink-500/20 transition-all active:scale-95"
                  >
                    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    Library
                  </button>
                </div>
              )}

              {identifying && (
                <div className="w-full flex items-center gap-3 bg-cyan-500/10 border border-cyan-400/20 rounded-xl px-4 py-3">
                  {itemPhoto && (
                    <div className="w-14 h-14 rounded-lg overflow-hidden border border-white/20 shrink-0">
                      <img src={itemPhoto} alt="Item" className="w-full h-full object-cover" />
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                    <span className="text-cyan-300 font-semibold text-sm">Identifying...</span>
                  </div>
                </div>
              )}

              {identifyResult && (
                <div className={`w-full rounded-xl px-3 py-3 border ${
                  identifyResult.confidence === 'high'
                    ? 'bg-emerald-500/10 border-emerald-400/30'
                    : identifyResult.confidence === 'none' || !identifyResult.product_name
                      ? 'bg-red-500/10 border-red-400/30'
                      : 'bg-amber-500/10 border-amber-400/30'
                }`}>
                  {/* Row 1: Photo thumbnail + confidence/MSRP + retake */}
                  <div className="flex items-center gap-3 mb-2">
                    {itemPhoto && (
                      <div className="w-11 h-11 rounded-lg overflow-hidden border border-white/20 shrink-0">
                        <img src={itemPhoto} alt="Item" className="w-full h-full object-cover" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      {identifyResult.product_name ? (
                        <p className="text-slate-400 text-xs">
                          {identifyResult.confidence === 'high' ? '✓ High confidence' :
                           identifyResult.confidence === 'medium' ? '~ Medium — verify' : '? Low — verify'}
                          {identifyResult.msrp > 0 && ` · MSRP $${identifyResult.msrp}`}
                        </p>
                      ) : (
                        <p className="text-red-300 text-sm font-semibold">Couldn't identify</p>
                      )}
                    </div>
                    <button
                      onClick={() => { setIdentifyResult(null); setIdentifyError(null); setItemPhoto(null) }}
                      className="text-white/40 hover:text-white/70 text-xs font-semibold shrink-0 px-2 py-1"
                    >
                      Retake
                    </button>
                  </div>
                  {/* Row 2: Full-width editable product name */}
                  {identifyResult.product_name ? (
                    <input
                      type="text"
                      value={notes}
                      onChange={e => setNotes(e.target.value)}
                      className="w-full bg-white/5 text-white font-semibold text-sm rounded-lg px-3 py-2 border border-white/10 focus:border-cyan-400/50 focus:outline-none transition-colors"
                      placeholder="Product name..."
                    />
                  ) : (
                    <p className="text-slate-500 text-xs">Enter details manually below</p>
                  )}
                </div>
              )}

              {identifyError && (
                <div className={`w-full rounded-xl px-4 py-3 border bg-red-500/10 border-red-400/30`}>
                  <div className="flex items-start gap-3">
                    {itemPhoto && (
                      <div className="w-14 h-14 rounded-lg overflow-hidden border border-white/20 shrink-0">
                        <img src={itemPhoto} alt="Item" className="w-full h-full object-cover" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-red-300 text-sm">{identifyError}</p>
                      <p className="text-slate-500 text-[11px] mt-1">Photo saved — enter details manually</p>
                    </div>
                    <button
                      onClick={() => { setIdentifyError(null); setItemPhoto(null) }}
                      className="text-white/40 hover:text-white/70 text-xs font-semibold shrink-0 px-2 py-1"
                    >
                      Retake
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Size buttons */}
            <div className="w-full max-w-sm mb-4">
              <label className="text-slate-400 text-xs uppercase tracking-wider mb-2 block">Size *</label>
              <div className="grid grid-cols-4 gap-2">
                {SIZES.map(s => (
                  <button
                    key={s}
                    onClick={() => setSize(size === s ? '' : s)}
                    className={`py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95 ${
                      size === s
                        ? 'bg-pink-500 text-white'
                        : 'bg-white/10 text-white/60 border border-white/10'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Category dropdown */}
            <div className="w-full max-w-sm mb-3">
              <label className="text-slate-400 text-xs uppercase tracking-wider mb-1 block">Category *</label>
              <select
                value={description}
                onChange={e => setDescription(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white text-base font-semibold appearance-none focus:outline-none focus:border-cyan-500/50 focus:ring-4 focus:ring-cyan-500/10 transition-all"
              >
                <option value="" className="bg-[#1a1f2e]">Select category...</option>
                {CATEGORIES.map(cat => (
                  <option key={cat} value={cat} className="bg-[#1a1f2e]">{cat}</option>
                ))}
              </select>
            </div>

            {/* Condition dropdown */}
            <div className="w-full max-w-sm mb-3">
              <label className="text-slate-400 text-xs uppercase tracking-wider mb-1 block">Condition *</label>
              <select
                value={condition}
                onChange={e => setCondition(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white text-base font-semibold appearance-none focus:outline-none focus:border-cyan-500/50 focus:ring-4 focus:ring-cyan-500/10 transition-all"
              >
                <option value="" className="bg-[#1a1f2e]">Select condition...</option>
                {CONDITIONS.map(c => (
                  <option key={c} value={c} className="bg-[#1a1f2e]">{c}</option>
                ))}
              </select>
            </div>

            {/* Color dropdown */}
            <div className="w-full max-w-sm mb-3">
              <label className="text-slate-400 text-xs uppercase tracking-wider mb-1 block">Color *</label>
              <select
                value={color}
                onChange={e => setColor(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white text-base font-semibold appearance-none focus:outline-none focus:border-cyan-500/50 focus:ring-4 focus:ring-cyan-500/10 transition-all"
              >
                <option value="" className="bg-[#1a1f2e]">Select color...</option>
                {COLOR_GROUPS.map(group => (
                  <optgroup key={group.label} label={group.label} className="bg-[#1a1f2e] text-slate-400">
                    {group.colors.map(c => (
                      <option key={c} value={c} className="bg-[#1a1f2e] text-white">{c}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            {/* MSRP */}
            <div className="w-full max-w-sm mb-4">
              <label className="text-slate-400 text-xs uppercase tracking-wider mb-1 block">MSRP *</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/50">$</span>
                <input
                  type="number"
                  value={msrp}
                  onChange={e => setMsrp(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-white/5 border border-white/10 rounded-2xl pl-8 pr-4 py-3 text-white text-base font-semibold placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 focus:ring-4 focus:ring-cyan-500/10 transition-all"
                />
              </div>
            </div>

            {/* Item Description */}
            <div className="w-full max-w-sm mb-3">
              <label className="text-slate-400 text-xs uppercase tracking-wider mb-1 block">Item Description (optional)</label>
              <input
                type="text"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="e.g. Teddy Peacoat, Cargo Joggers..."
                className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 focus:ring-4 focus:ring-cyan-500/10 transition-all"
              />
            </div>

            {/* Quantity */}
            <div className="flex items-center gap-5 mb-4">
              <button
                onClick={() => setQuantity(q => Math.max(1, q - 1))}
                className="w-11 h-11 rounded-full bg-white/10 border border-white/20 text-white text-2xl font-bold flex items-center justify-center hover:bg-white/20 active:scale-95 transition-all"
              >
                −
              </button>
              <input
                type="number"
                value={quantity}
                onChange={e => { const v = parseInt(e.target.value, 10); setQuantity(v > 0 ? v : 1) }}
                className="w-20 text-center bg-white/5 border border-white/10 rounded-2xl py-2 text-3xl font-black text-white focus:outline-none focus:border-cyan-500/50 focus:ring-4 focus:ring-cyan-500/10 transition-all"
              />
              <button
                onClick={() => setQuantity(q => q + 1)}
                className="w-11 h-11 rounded-full bg-gradient-to-br from-pink-500 to-pink-600 text-white text-2xl font-bold flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-lg shadow-pink-500/30"
              >
                +
              </button>
            </div>

            {quantity > 1 && (
              <p className="text-slate-400 text-sm mb-2">
                Total: <span className="text-white font-bold">${(getCost() * quantity).toFixed(2)}</span> for {quantity} items
              </p>
            )}
          </div>
          </div>

          {/* Save button — always visible at bottom */}
          <div className="shrink-0 p-4 pt-2">
            <button
              onClick={handleSave}
              disabled={saving || !itemPhoto || !description || !condition || !color || !size || !msrp}
              className={`w-full py-4 rounded-3xl font-bold text-xl transition-all ${
                saving || !itemPhoto || !description || !condition || !color || !size || !msrp
                  ? 'bg-white/10 text-white/50 cursor-not-allowed'
                  : 'bg-gradient-to-r from-pink-500 to-pink-600 text-white shadow-2xl shadow-pink-500/30 hover:scale-[1.02] active:scale-[0.98]'
              }`}
            >
              {saving ? 'Saving...' : quantity > 1 ? `Save ${quantity} Items` : 'Save Item'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
