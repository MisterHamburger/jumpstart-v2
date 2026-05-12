import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, fetchAll } from '../lib/supabase'
import { compressPhoto, toBase64, uploadKickstartPhoto } from '../lib/photos'
import { generateWhatnotCsv, downloadCsv } from '../lib/whatnotCsv'
import { downloadStickerPdf } from '../lib/whatnotStickers'

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
        supabase.from('kickstart_intake').select('photo_url, item_photo_data, photo_data').eq('id', intakeId).single()
          .then(({ data }) => {
            if (data?.photo_url) setSrc(data.photo_url)
            else {
              const photo = data?.item_photo_data || data?.photo_data
              if (photo) setSrc(`data:image/jpeg;base64,${photo}`)
            }
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

const PRICE_BINS = [2, 5, 10, 15, 20, 25, 30, 40]
const CATEGORIES = [
  'Accessories', 'Bags', 'Bottoms', 'Dresses', 'Jewelry',
  'Jumpsuits', 'Outerwear', 'Sets', 'Sweaters', 'Tops'
]
const COLOR_GROUPS = [
  { label: 'Core Colors', colors: ['Blue', 'Dark Blue', 'Green', 'Light Blue', 'Orange', 'Pink', 'Purple', 'Red', 'Yellow'] },
  { label: 'Neutrals', colors: ['Black', 'Brown', 'Burgundy', 'Denim', 'Gray', 'Ivory / Cream', 'Navy', 'Olive', 'Tan', 'White'] },
  { label: 'Patterns', colors: ['Multi-Color', 'Other Pattern', 'Plaid', 'Stripe'] },
]
const SIZES = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'One Size', 'XS/S', 'M/L', 'L/XL']
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
  const [sizeQuantities, setSizeQuantities] = useState({})
  const [saving, setSaving] = useState(false)
  const [showSaved, setShowSaved] = useState(false)
  const [cloneSizePickerOpen, setCloneSizePickerOpen] = useState(false)
  const [lastSavedCount, setLastSavedCount] = useState(0)
  const [sessionCount, setSessionCount] = useState(0)
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [msrp, setMsrp] = useState('')
  const itemPhotoRef = useRef(null)
  const itemLibraryRef = useRef(null)

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
  const loadAllItems = async (liveOnly = false) => {
    setItemsLoading(true)
    try {
      let items = await fetchAll(() => supabase
        .from('kickstart_intake')
        .select('id, description, brand, color, size, condition, msrp, cost, true_cost, title, notes, status, photo_url, whatnot_listed_at, whatnot_sku, created_at')
        .neq('description', 'Manual entry')
        .not('color', 'is', null)
        .not('size', 'is', null)
        .order('created_at', { ascending: false }))

      if (liveOnly) {
        const [bundled, sold] = await Promise.all([
          fetchAll(() => supabase.from('kickstart_bundle_scans').select('intake_id').not('intake_id', 'is', null)),
          fetchAll(() => supabase.from('kickstart_sold_scans').select('intake_id').not('intake_id', 'is', null)),
        ])
        const skip = new Set([...bundled.map(b => b.intake_id), ...sold.map(s => s.intake_id)])
        items = items.filter(i =>
          (i.status === 'enriched' || i.status === 'pending_enrichment') && !skip.has(i.id)
        )
      }

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

  // Export current filtered inventory to a Whatnot bulk-listing CSV.
  // By default, items already exported (whatnot_listed_at set) are excluded —
  // this prevents accidental duplicate listings on Whatnot. Toggle the
  // includeListed checkbox to re-export everything (e.g. after deleting
  // listings on the Whatnot side).
  const [exporting, setExporting] = useState(false)
  const [includeListed, setIncludeListed] = useState(false)
  const handleExportWhatnotCsv = async () => {
    if (exporting) return
    setExporting(true)
    try {
      let items = getFilteredItems()
      if (!includeListed) items = items.filter(i => !i.whatnot_listed_at)
      const { csv, included, skipped, groups, skuByIntakeId } = generateWhatnotCsv(items)
      if (included === 0) {
        alert(includeListed
          ? 'No exportable items in the current view.'
          : 'No unlisted items in the current view. Check "Include already-listed" to re-export.')
        return
      }

      // Download first, then mark as listed. If user cancels the save dialog,
      // the items are already exported — we mark anyway since the CSV is in
      // their hands.
      const stamp = new Date().toISOString().slice(0, 10)
      downloadCsv(csv, `whatnot-listings-${stamp}.csv`)

      // Batch-update whatnot_listed_at + whatnot_sku. Each unit in a group
      // shares the group's SKU so sticker scans during the live show find
      // the right Whatnot listing.
      const ids = items
        .filter(i => CATEGORY_MAP_KEYS.has(i.description) && CONDITION_KEYS.has(i.condition))
        .map(i => i.id)
      const now = new Date().toISOString()
      // Group ids by their SKU so we can do one UPDATE ... IN (...) per SKU
      // rather than a per-row update. Items keep their existing whatnot_sku if
      // re-exporting (skuByIntakeId is deterministic per group, so this is
      // idempotent — same group → same first-id → same SKU).
      const idsBySku = new Map()
      for (const id of ids) {
        const sku = skuByIntakeId.get(id)
        if (!sku) continue
        if (!idsBySku.has(sku)) idsBySku.set(sku, [])
        idsBySku.get(sku).push(id)
      }
      let updateFailed = false
      for (const [sku, skuIds] of idsBySku) {
        for (let i = 0; i < skuIds.length; i += 500) {
          const batch = skuIds.slice(i, i + 500)
          const { error: updateErr } = await supabase
            .from('kickstart_intake')
            .update({ whatnot_listed_at: now, whatnot_sku: sku })
            .in('id', batch)
          if (updateErr) {
            console.error('Failed to mark items as listed:', updateErr)
            updateFailed = true
            break
          }
        }
        if (updateFailed) break
      }
      if (updateFailed) {
        alert('CSV exported, but failed to flag some items as listed. They may re-appear in future exports.')
      } else {
        // Update local state so the UI immediately reflects listed + sku
        setAllItems(prev => prev.map(i => {
          const sku = skuByIntakeId.get(i.id)
          if (!sku) return i
          return { ...i, whatnot_listed_at: now, whatnot_sku: sku }
        }))
      }

      const skippedNote = skipped > 0 ? `\nSkipped ${skipped} units (missing or unmapped category/condition).` : ''
      alert(`Exported ${groups} listings covering ${included} units.${skippedNote}`)
    } catch (err) {
      console.error('Whatnot CSV export error:', err)
      alert('Export failed: ' + (err?.message || err))
    } finally {
      setExporting(false)
    }
  }

  // Print barcode stickers (2"x1" thermal) for items in the current filtered
  // view that have a whatnot_sku — one sticker per individual intake unit, all
  // units in the same listing group share the same barcode.
  const [printing, setPrinting] = useState(false)
  const handlePrintStickers = async () => {
    if (printing) return
    setPrinting(true)
    try {
      const filtered = getFilteredItems()
      const withSku = filtered.filter(i => i.whatnot_sku)
      if (withSku.length === 0) {
        alert('No items in the current view have been exported to Whatnot yet. Run Export Whatnot CSV first.')
        return
      }
      const units = withSku.map(i => ({
        sku: i.whatnot_sku,
        title: i.title,
        brand: i.brand,
        size: i.size,
        color: i.color,
        condition: i.condition,
        msrp: i.msrp,
        photo_url: i.photo_url,
      }))
      const stamp = new Date().toISOString().slice(0, 10)
      await downloadStickerPdf(units, `whatnot-stickers-${stamp}.pdf`)
    } catch (err) {
      console.error('Sticker print error:', err)
      alert('Sticker print failed: ' + (err?.message || err))
    } finally {
      setPrinting(false)
    }
  }

  // Categories and conditions that map cleanly to Whatnot — used to filter
  // which intake rows get flagged as listed (skip unmappable rows).
  const CATEGORY_MAP_KEYS = new Set([
    'Tops','Bottoms','Sweaters','Outerwear','Dresses','Jumpsuits','Sets',
    'Accessories','Bags','Jewelry'
  ])
  const CONDITION_KEYS = new Set(['NWT','NWOT','Pre-loved/Nuuly'])

  // Reset whatnot_listed_at on a set of intake ids (used when Whatnot listings
  // are deleted out-of-band and admin needs to allow re-export).
  const handleResetListed = async (ids) => {
    if (!ids?.length) return
    const { error } = await supabase
      .from('kickstart_intake')
      .update({ whatnot_listed_at: null, whatnot_sku: null })
      .in('id', ids)
    if (error) {
      console.error('Failed to reset listed status:', error)
      alert('Failed to reset: ' + error.message)
      return
    }
    setAllItems(prev => prev.map(i =>
      ids.includes(i.id) ? { ...i, whatnot_listed_at: null, whatnot_sku: null } : i
    ))
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
        const searchable = [i.brand, i.description, i.color, i.condition, i.title, i.notes].filter(Boolean).join(' ').toLowerCase()
        return searchable.includes(q)
      })
    }
    return filtered
  }

  // Group filtered items by variant (description + size + color + brand + condition)
  // for the Inventory view. Picks the most-recent item as the variant rep.
  const getGroupedItems = () => {
    const filtered = getFilteredItems()
    const groups = new Map()
    for (const item of filtered) {
      const key = [
        item.description || '',
        item.size || '',
        item.color || '',
        item.brand || '',
        item.condition || '',
      ].join('||')
      if (!groups.has(key)) {
        groups.set(key, { rep: item, ids: [], listedIds: [], cost: item.cost, msrp: item.msrp })
      }
      const g = groups.get(key)
      g.ids.push(item.id)
      if (item.whatnot_listed_at) g.listedIds.push(item.id)
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
      const sourceId = restockItem.id

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
        title: restockItem.title || restockItem.notes || 'Free People',
        notes: restockItem.notes || restockItem.title || 'Free People',
        status: 'enriched',
      }

      const rows = Array.from({ length: restockQty }, () => ({ ...baseRow }))
      const { data: inserted, error } = await supabase.from('kickstart_intake').insert(rows).select('id')
      if (error) throw error

      if (itemPhotoData && inserted?.length) {
        await Promise.all(inserted.map(async (row) => {
          try {
            const url = await uploadKickstartPhoto(supabase, row.id, itemPhotoData)
            await supabase.from('kickstart_intake').update({ photo_url: url }).eq('id', row.id)
          } catch (uploadErr) {
            console.error(`Photo upload failed for intake ${row.id}:`, uploadErr)
          }
        }))
      }

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

  // Open the edit screen for a whole variant (group of items).
  // Carries _ids for bulk update + delete, _qty/_origQty for the qty selector,
  // and _cloneSizes for spawning new variants of other sizes (e.g. found a few S of an M variant).
  const handleEditVariant = (group) => {
    setEditingItem({
      ...group.rep,
      _ids: [...group.ids],
      _origQty: group.ids.length,
      _qty: group.ids.length,
      _cloneSizes: [],
    })
    setCloneSizePickerOpen(false)
    setStep('editItem')
  }

  const handleEditSave = async () => {
    if (!editingItem) return
    setSaving(true)
    try {
      const fields = {
        cost: editingItem.cost ? parseFloat(editingItem.cost) : null,
        brand: editingItem.brand || null,
        description: editingItem.description || null,
        color: editingItem.color || null,
        size: editingItem.size || null,
        condition: editingItem.condition || null,
        msrp: editingItem.msrp ? parseFloat(editingItem.msrp) : null,
        title: editingItem.title || editingItem.notes || 'Free People',
        notes: editingItem.notes || editingItem.title || 'Free People',
      }

      // Variant mode: bulk-update all ids + handle qty delta + clone-to-other-sizes
      if (Array.isArray(editingItem._ids)) {
        const ids = [...editingItem._ids]
        const newQty = Math.max(0, parseInt(editingItem._qty, 10) || 0)
        const origQty = editingItem._origQty
        const cloneSizes = (editingItem._cloneSizes || []).filter(c => c.size && (parseInt(c.qty, 10) || 0) > 0)
        const needsPhoto = newQty > origQty || cloneSizes.length > 0

        const { error: upErr } = await supabase.from('kickstart_intake').update(fields).in('id', ids)
        if (upErr) throw upErr

        // Fetch the rep photo once if any new rows will be inserted
        let photo = null
        if (needsPhoto) {
          const sourceId = ids[ids.length - 1]
          const { data: original } = await supabase
            .from('kickstart_intake')
            .select('item_photo_data')
            .eq('id', sourceId)
            .single()
          photo = original?.item_photo_data || null
        }

        if (newQty < origQty) {
          const toDelete = ids.slice(0, origQty - newQty)
          const { error: delErr } = await supabase.from('kickstart_intake').delete().in('id', toDelete)
          if (delErr) throw delErr
          setAllItems(prev => prev.filter(i => !toDelete.includes(i.id)))
        } else if (newQty > origQty) {
          const rows = Array.from({ length: newQty - origQty }, () => ({
            ...fields, item_photo_data: photo, status: 'enriched',
          }))
          const { data: insertedRows, error: insErr } = await supabase.from('kickstart_intake').insert(rows).select('id')
          if (insErr) throw insErr
          if (photo && insertedRows?.length) {
            await Promise.all(insertedRows.map(async (row) => {
              try {
                const url = await uploadKickstartPhoto(supabase, row.id, photo)
                await supabase.from('kickstart_intake').update({ photo_url: url }).eq('id', row.id)
              } catch (uploadErr) {
                console.error(`Photo upload failed for intake ${row.id}:`, uploadErr)
              }
            }))
          }
        }

        // Clone to other sizes — each becomes a fresh variant with this size
        for (const c of cloneSizes) {
          const cloneQty = parseInt(c.qty, 10) || 0
          const rows = Array.from({ length: cloneQty }, () => ({
            ...fields, size: c.size, item_photo_data: photo, status: 'enriched',
          }))
          const { data: clonedRows, error: cloneErr } = await supabase.from('kickstart_intake').insert(rows).select('id')
          if (cloneErr) throw cloneErr
          if (photo && clonedRows?.length) {
            await Promise.all(clonedRows.map(async (row) => {
              try {
                const url = await uploadKickstartPhoto(supabase, row.id, photo)
                await supabase.from('kickstart_intake').update({ photo_url: url }).eq('id', row.id)
              } catch (uploadErr) {
                console.error(`Photo upload failed for intake ${row.id}:`, uploadErr)
              }
            }))
          }
        }
      } else {
        const { error } = await supabase.from('kickstart_intake').update(fields).eq('id', editingItem.id)
        if (error) throw error
      }

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

  const handleEditDelete = async () => {
    if (!editingItem) return
    const isVariant = Array.isArray(editingItem._ids)
    const label = [editingItem.description, editingItem.color].filter(Boolean).join(' — ') ||
      (isVariant ? `${editingItem._origQty} items` : `#${editingItem.id}`)
    const prompt = isVariant
      ? `Delete all ${editingItem._origQty} of "${label}"? This cannot be undone.`
      : `Delete ${label}? This cannot be undone.`
    if (!confirm(prompt)) return
    setSaving(true)
    try {
      if (isVariant) {
        const { error } = await supabase.from('kickstart_intake').delete().in('id', editingItem._ids)
        if (error) throw error
        const idSet = new Set(editingItem._ids)
        setAllItems(prev => prev.filter(i => !idSet.has(i.id)))
      } else {
        const { error } = await supabase.from('kickstart_intake').delete().eq('id', editingItem.id)
        if (error) throw error
        setAllItems(prev => prev.filter(i => i.id !== editingItem.id))
      }
      setEditingItem(null)
      setStep('bin')
    } catch (err) {
      alert('Delete error: ' + (err?.message || JSON.stringify(err)))
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

  // --- Save ---
  const handleSave = async () => {
    setSaving(true)
    try {
      const cost = getCost()
      const itemPhotoData = itemPhoto ? toBase64(itemPhoto) : null

      // Schema mapping for Whatnot CSV export:
      //   description column → Whatnot Sub Category (e.g. "Tops")
      //   title column       → Whatnot Title (product name)
      //   notes column       → Whatnot Description (free-text)
      const baseRow = {
        cost,
        brand: selectedBrand,
        description: description || null,
        color: color || null,
        condition: condition || null,
        msrp: msrp ? parseFloat(msrp) : null,
        item_photo_data: itemPhotoData,
        title: title || notes || 'Free People',
        notes: notes || title || 'Free People',
        status: 'enriched',
      }

      const rows = []
      for (const s of SIZES) {
        const qty = sizeQuantities[s] || 0
        for (let i = 0; i < qty; i++) {
          rows.push({ ...baseRow, size: s })
        }
      }
      const totalQty = rows.length

      const { data: inserted, error } = await supabase.from('kickstart_intake').insert(rows).select('id')
      if (error) throw error

      // Upload photo to Storage for each new row and write photo_url
      if (itemPhotoData && inserted?.length) {
        await Promise.all(inserted.map(async (row) => {
          try {
            const url = await uploadKickstartPhoto(supabase, row.id, itemPhotoData)
            await supabase.from('kickstart_intake').update({ photo_url: url }).eq('id', row.id)
          } catch (uploadErr) {
            console.error(`Photo upload failed for intake ${row.id}:`, uploadErr)
          }
        }))
      }

      setSessionCount(prev => prev + totalQty)
      setLastSavedCount(totalQty)

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
    setSizeQuantities({})
    setTitle('')
    setNotes('')
    setMsrp('')
    setItemPhoto(null)
    if (itemPhotoRef.current) itemPhotoRef.current.value = ''
    if (itemLibraryRef.current) itemLibraryRef.current.value = ''
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
        setSizeQuantities({})
        setNotes('')
        setMsrp('')
        setItemPhoto(null)
        if (itemPhotoRef.current) itemPhotoRef.current.value = ''
        if (itemLibraryRef.current) itemLibraryRef.current.value = ''
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
          <p className="text-xl text-white/80">{lastSavedCount > 1 ? `${lastSavedCount} items` : '1 item'} added</p>
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

          <div className="w-full max-w-sm grid grid-cols-6 gap-2 mb-3">
            {PRICE_BINS.map(price => (
              <button
                key={price}
                onClick={() => handleBinSelect(price)}
                className={`py-3 rounded-xl bg-gradient-to-br from-pink-500/80 to-pink-600/80 border-2 border-pink-400/40 text-white font-black text-xl shadow-lg shadow-pink-500/20 hover:scale-105 active:scale-95 transition-all ${price === 30 || price === 40 ? 'col-span-3' : 'col-span-2'}`}
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

          {/* Restock + Inventory + Edit buttons */}
          <div className="w-full max-w-sm flex gap-2 mt-3">
            <button
              onClick={() => { resetFilters(); loadAllItems(); setStep('restock') }}
              className="flex-1 py-3 rounded-3xl bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 font-semibold text-base hover:bg-cyan-500/30 transition-all"
            >
              Restock
            </button>
            <button
              onClick={() => { resetFilters(); loadAllItems(true); setStep('inventory') }}
              className="flex-1 py-3 rounded-3xl bg-violet-500/20 border border-violet-500/30 text-violet-300 font-semibold text-base hover:bg-violet-500/30 transition-all"
            >
              Inventory
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

      {/* === RESTOCK / EDIT / INVENTORY ITEM PICKER (shared UI) === */}
      {(step === 'restock' || step === 'editRecent' || step === 'inventory') && (
        <div className="relative z-10 flex-1 min-h-0 flex flex-col overflow-hidden">
          {/* Whatnot CSV export — Inventory mode only */}
          {step === 'inventory' && (() => {
            const filtered = getFilteredItems()
            const listedCount = filtered.filter(i => i.whatnot_listed_at).length
            const unlistedCount = filtered.length - listedCount
            const stickerCount = filtered.filter(i => i.whatnot_sku).length
            return (
              <div className="px-4 py-2 bg-slate-800/50 border-b border-white/10 flex items-center justify-between gap-3 flex-shrink-0">
                <div className="flex flex-col text-xs text-slate-400 leading-tight">
                  <span>{filtered.length} items in view</span>
                  <span className="text-[10px] text-slate-500">
                    {unlistedCount} unlisted · {listedCount} on Whatnot
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-[11px] text-slate-400 select-none">
                    <input
                      type="checkbox"
                      checked={includeListed}
                      onChange={e => setIncludeListed(e.target.checked)}
                      className="w-3.5 h-3.5 accent-pink-500"
                    />
                    Include listed
                  </label>
                  <button
                    onClick={handlePrintStickers}
                    disabled={printing || itemsLoading || stickerCount === 0}
                    title={stickerCount === 0 ? 'No items in view have a Whatnot SKU yet. Export to Whatnot first.' : `Print ${stickerCount} sticker${stickerCount === 1 ? '' : 's'}`}
                    className="px-3 py-2 rounded-2xl bg-white/10 text-white font-bold text-sm hover:bg-white/15 active:scale-95 transition-all border border-white/15 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {printing ? 'Building PDF…' : `Print Stickers${stickerCount > 0 ? ` (${stickerCount})` : ''}`}
                  </button>
                  <button
                    onClick={handleExportWhatnotCsv}
                    disabled={exporting || itemsLoading}
                    className="px-4 py-2 rounded-2xl bg-pink-500 text-white font-bold text-sm hover:bg-pink-400 active:scale-95 transition-all shadow-lg shadow-pink-500/30 glow-magenta disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {exporting ? 'Exporting...' : 'Export Whatnot CSV'}
                  </button>
                </div>
              </div>
            )
          })()}
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
            ) : step === 'inventory' ? (() => {
              const groups = getGroupedItems()
              return groups.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-white/50 text-lg mb-2">No items found</p>
                  <button onClick={resetFilters} className="text-pink-400 text-sm underline">Clear filters</button>
                </div>
              ) : (
                <div className="space-y-2">
                  {(() => {
                    const totalItems = groups.reduce((sum, g) => sum + g.ids.length, 0)
                    return (
                      <p className="text-white/40 text-xs mb-1">
                        {totalItems} item{totalItems !== 1 ? 's' : ''} / {groups.length} variant{groups.length !== 1 ? 's' : ''}
                      </p>
                    )
                  })()}
                  {groups.map((group, i) => {
                    const item = group.rep
                    return (
                      <button
                        key={i}
                        onClick={() => handleEditVariant(group)}
                        className="w-full text-left bg-white/5 border border-white/10 rounded-3xl p-3 hover:bg-violet-500/10 hover:border-violet-500/30 active:scale-[0.98] transition-all"
                      >
                        <div className="flex items-center gap-3">
                          <LazyPhoto intakeId={item.id} />
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
                          <div className="shrink-0 flex flex-col items-end gap-1">
                            <span className="px-2.5 py-1 rounded-full bg-violet-500/20 border border-violet-500/40 text-violet-200 text-sm font-bold">
                              ×{group.ids.length}
                            </span>
                            {group.listedIds.length > 0 && (
                              <span className="px-2 py-0.5 rounded-full bg-pink-500/15 border border-pink-500/30 text-pink-300 text-[10px] font-semibold uppercase tracking-wider">
                                {group.listedIds.length === group.ids.length
                                  ? 'On Whatnot'
                                  : `${group.listedIds.length}/${group.ids.length} listed`}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )
            })() : (() => {
              const items = getFilteredItems()
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
                      key={item.id || i}
                      onClick={() => step === 'restock' ? handleRestockSelect(item) : handleEditSelect(item)}
                      className="w-full text-left bg-white/5 border border-white/10 rounded-3xl p-3 hover:bg-pink-500/10 hover:border-pink-500/30 active:scale-[0.98] transition-all"
                    >
                      <div className="flex items-center gap-3">
                        <LazyPhoto intakeId={item.id} />
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
                        <span className="text-slate-600 text-xs shrink-0">#{item.id}</span>
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
                <LazyPhoto intakeId={restockItem.id} />
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
                <div><span className="text-slate-500">Item ID</span><p className="text-white">#{restockItem.id}</p></div>
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
            <h2 className="text-lg font-bold text-white mb-3 font-heading">
              {Array.isArray(editingItem._ids)
                ? `Edit Variant (${editingItem._origQty} item${editingItem._origQty !== 1 ? 's' : ''})`
                : `Edit Item #${editingItem.id}`}
            </h2>
            <div className="flex flex-col items-center">

              {/* Quantity (variant mode only) */}
              {Array.isArray(editingItem._ids) && (
                <div className="w-full max-w-sm mb-3">
                  <label className="text-slate-400 text-xs uppercase tracking-wider mb-2 block">
                    Quantity {editingItem._qty !== editingItem._origQty && (
                      <span className="text-violet-300 normal-case tracking-normal ml-1">
                        ({editingItem._qty > editingItem._origQty ? '+' : ''}{editingItem._qty - editingItem._origQty})
                      </span>
                    )}
                  </label>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setEditingItem(prev => ({ ...prev, _qty: Math.max(0, (parseInt(prev._qty, 10) || 0) - 1) }))}
                      className="w-12 h-12 rounded-2xl bg-white/10 border border-white/20 text-white text-2xl font-bold flex items-center justify-center hover:bg-white/20 active:scale-95 transition-all"
                    >−</button>
                    <input
                      type="number"
                      min="0"
                      value={editingItem._qty}
                      onChange={e => {
                        const v = parseInt(e.target.value, 10)
                        setEditingItem(prev => ({ ...prev, _qty: isNaN(v) ? 0 : Math.max(0, v) }))
                      }}
                      className="flex-1 text-center bg-white/5 border border-white/10 rounded-2xl py-3 text-2xl font-black text-white focus:outline-none focus:border-violet-500/50 focus:ring-4 focus:ring-violet-500/10 transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setEditingItem(prev => ({ ...prev, _qty: (parseInt(prev._qty, 10) || 0) + 1 }))}
                      className="w-12 h-12 rounded-2xl bg-violet-500/20 border border-violet-500/40 text-violet-200 text-2xl font-bold flex items-center justify-center hover:bg-violet-500/30 active:scale-95 transition-all"
                    >+</button>
                  </div>
                  <p className="text-slate-500 text-xs mt-1">Was {editingItem._origQty}. Lowering deletes oldest; raising clones the variant.</p>
                </div>
              )}

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

              {/* Clone to Other Sizes (variant mode only) */}
              {Array.isArray(editingItem._ids) && (
                <div className="w-full max-w-sm mb-3">
                  <label className="text-slate-400 text-xs uppercase tracking-wider mb-2 block">
                    Clone to Other Sizes
                    <span className="text-slate-500 normal-case tracking-normal ml-1 text-[11px]">— same details, new variants</span>
                  </label>

                  {(editingItem._cloneSizes || []).length > 0 && (
                    <div className="space-y-2 mb-2">
                      {editingItem._cloneSizes.map((c, idx) => (
                        <div key={idx} className="flex items-center gap-2 bg-white/5 border border-violet-500/20 rounded-2xl p-2">
                          <span className="px-3 py-1 rounded-lg bg-violet-500/20 text-violet-200 text-sm font-bold min-w-[3.5rem] text-center">{c.size}</span>
                          <button
                            type="button"
                            onClick={() => setEditingItem(prev => ({
                              ...prev,
                              _cloneSizes: prev._cloneSizes.map((x, i) => i === idx ? { ...x, qty: Math.max(1, (parseInt(x.qty, 10) || 1) - 1) } : x)
                            }))}
                            className="w-9 h-9 rounded-xl bg-white/10 border border-white/20 text-white text-lg font-bold flex items-center justify-center active:scale-95"
                          >−</button>
                          <input
                            type="number"
                            min="1"
                            value={c.qty}
                            onChange={e => {
                              const v = parseInt(e.target.value, 10)
                              setEditingItem(prev => ({
                                ...prev,
                                _cloneSizes: prev._cloneSizes.map((x, i) => i === idx ? { ...x, qty: isNaN(v) ? 1 : Math.max(1, v) } : x)
                              }))
                            }}
                            className="flex-1 text-center bg-white/5 border border-white/10 rounded-xl py-1.5 text-base font-bold text-white focus:outline-none focus:border-violet-500/50"
                          />
                          <button
                            type="button"
                            onClick={() => setEditingItem(prev => ({
                              ...prev,
                              _cloneSizes: prev._cloneSizes.map((x, i) => i === idx ? { ...x, qty: (parseInt(x.qty, 10) || 1) + 1 } : x)
                            }))}
                            className="w-9 h-9 rounded-xl bg-violet-500/20 border border-violet-500/40 text-violet-200 text-lg font-bold flex items-center justify-center active:scale-95"
                          >+</button>
                          <button
                            type="button"
                            onClick={() => setEditingItem(prev => ({
                              ...prev,
                              _cloneSizes: prev._cloneSizes.filter((_, i) => i !== idx)
                            }))}
                            className="w-9 h-9 rounded-xl text-slate-400 hover:text-red-400 active:scale-95 text-xl"
                            aria-label="Remove"
                          >×</button>
                        </div>
                      ))}
                    </div>
                  )}

                  {!cloneSizePickerOpen ? (
                    <button
                      type="button"
                      onClick={() => setCloneSizePickerOpen(true)}
                      className="w-full py-2.5 rounded-xl bg-violet-500/15 border border-dashed border-violet-500/40 text-violet-300 text-sm font-semibold active:scale-[0.98] transition-all"
                    >
                      + Add Size
                    </button>
                  ) : (
                    <div className="bg-white/5 border border-white/10 rounded-2xl p-2">
                      <div className="grid grid-cols-4 gap-2">
                        {SIZES.filter(s => s !== editingItem.size && !(editingItem._cloneSizes || []).some(c => c.size === s)).map(s => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => {
                              setEditingItem(prev => ({
                                ...prev,
                                _cloneSizes: [...(prev._cloneSizes || []), { size: s, qty: 1 }],
                              }))
                              setCloneSizePickerOpen(false)
                            }}
                            className="py-2 rounded-lg text-sm font-bold bg-white/10 border border-white/10 text-white/80 active:scale-95"
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => setCloneSizePickerOpen(false)}
                        className="w-full mt-2 text-xs text-slate-400 underline"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )}

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

              {/* Title */}
              <div className="w-full max-w-sm mb-3">
                <label className="text-slate-400 text-xs uppercase tracking-wider mb-1 block">Title</label>
                <input
                  type="text"
                  value={editingItem.title || ''}
                  onChange={e => setEditingItem(prev => ({ ...prev, title: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 focus:ring-4 focus:ring-cyan-500/10 transition-all"
                />
              </div>

              {/* Description */}
              <div className="w-full max-w-sm mb-3">
                <label className="text-slate-400 text-xs uppercase tracking-wider mb-1 block">Description</label>
                <input
                  type="text"
                  value={editingItem.notes || ''}
                  onChange={e => setEditingItem(prev => ({ ...prev, notes: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 focus:ring-4 focus:ring-cyan-500/10 transition-all"
                />
              </div>

              {/* Reset Whatnot listing status — only when at least one of the
                  edited rows is currently flagged as listed. */}
              {(() => {
                const ids = Array.isArray(editingItem._ids) ? editingItem._ids : [editingItem.id]
                const listedCount = allItems.filter(i => ids.includes(i.id) && i.whatnot_listed_at).length
                if (listedCount === 0) return null
                return (
                  <div className="w-full max-w-sm mb-3">
                    <button
                      type="button"
                      onClick={async () => {
                        if (!confirm(`Reset ${listedCount} item${listedCount !== 1 ? 's' : ''} to unlisted? Use this only if you deleted the Whatnot listing — these items will re-appear in your next CSV export.`)) return
                        await handleResetListed(ids.filter(id => {
                          const item = allItems.find(i => i.id === id)
                          return item?.whatnot_listed_at
                        }))
                      }}
                      className="w-full py-2 rounded-2xl bg-pink-500/10 border border-pink-500/30 text-pink-300 text-sm font-semibold hover:bg-pink-500/20 active:scale-[0.98] transition-all"
                    >
                      Reset {listedCount} {listedCount === 1 ? 'item' : 'items'} to unlisted
                    </button>
                  </div>
                )
              })()}
            </div>
          </div>

          {/* Save + Delete buttons */}
          <div className="shrink-0 p-4 pt-2 flex gap-2">
            <button
              onClick={handleEditDelete}
              disabled={saving}
              className={`px-5 py-4 rounded-3xl font-bold text-base transition-all shrink-0 ${
                saving
                  ? 'bg-white/10 text-white/50 cursor-wait'
                  : 'bg-red-500/15 border border-red-500/40 text-red-300 hover:bg-red-500/25 active:scale-[0.98]'
              }`}
            >
              Delete
            </button>
            <button
              onClick={handleEditSave}
              disabled={saving}
              className={`flex-1 py-4 rounded-3xl font-bold text-xl transition-all ${
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

            {/* Item photo */}
            <div className="w-full max-w-sm mb-4">
              <input
                ref={itemPhotoRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleItemPhotoCapture}
                className="hidden"
              />
              <input
                ref={itemLibraryRef}
                type="file"
                accept="image/*"
                onChange={handleItemPhotoCapture}
                className="hidden"
              />

              {!itemPhoto && (
                <div className="flex gap-2 w-full">
                  <button
                    onClick={() => itemPhotoRef.current?.click()}
                    className="flex-1 flex items-center justify-center gap-2 bg-pink-500/20 border-2 border-dashed border-pink-400/40 rounded-xl px-3 py-5 text-pink-300 font-semibold hover:bg-pink-500/30 transition-all active:scale-95"
                  >
                    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    Take Photo
                  </button>
                  <button
                    onClick={() => itemLibraryRef.current?.click()}
                    className="flex items-center justify-center gap-2 bg-pink-500/10 border-2 border-dashed border-pink-400/20 rounded-xl px-4 py-5 text-pink-300/70 font-semibold hover:bg-pink-500/20 transition-all active:scale-95"
                  >
                    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    Library
                  </button>
                </div>
              )}

              {itemPhoto && (
                <div className="w-full rounded-xl px-3 py-3 border bg-emerald-500/10 border-emerald-400/30">
                  <div className="flex items-center gap-3">
                    <div className="w-14 h-14 rounded-lg overflow-hidden border border-white/20 shrink-0">
                      <img src={itemPhoto} alt="Item" className="w-full h-full object-cover" />
                    </div>
                    <p className="flex-1 text-emerald-300 text-sm font-semibold">Photo saved</p>
                    <button
                      onClick={() => setItemPhoto(null)}
                      className="text-white/40 hover:text-white/70 text-xs font-semibold shrink-0 px-2 py-1"
                    >
                      Retake
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Size buttons (multi-select with per-size quantity) */}
            <div className="w-full max-w-sm mb-4">
              <label className="text-slate-400 text-xs uppercase tracking-wider mb-2 block">Size *</label>
              <div className="grid grid-cols-4 gap-2">
                {SIZES.map(s => {
                  const qty = sizeQuantities[s] || 0
                  const selected = qty > 0
                  return (
                    <div
                      key={s}
                      className={`rounded-xl transition-all ${
                        selected
                          ? 'bg-pink-500 p-1.5'
                          : 'bg-white/10 border border-white/10'
                      }`}
                    >
                      <button
                        onClick={() =>
                          setSizeQuantities(prev => {
                            const next = { ...prev }
                            if (next[s]) delete next[s]
                            else next[s] = 1
                            return next
                          })
                        }
                        className={`w-full text-sm font-bold transition-all active:scale-95 ${
                          selected ? 'text-white py-0.5' : 'text-white/60 py-2.5'
                        }`}
                      >
                        {s}
                      </button>
                      {selected && (
                        <div className="flex items-center justify-between mt-1 bg-white/20 rounded-lg">
                          <button
                            onClick={() =>
                              setSizeQuantities(prev => {
                                const cur = prev[s] || 0
                                if (cur <= 1) return prev
                                return { ...prev, [s]: cur - 1 }
                              })
                            }
                            className="w-7 h-7 text-white text-lg font-bold flex items-center justify-center active:scale-90"
                          >
                            −
                          </button>
                          <span className="text-white text-base font-black">{qty}</span>
                          <button
                            onClick={() =>
                              setSizeQuantities(prev => ({ ...prev, [s]: (prev[s] || 0) + 1 }))
                            }
                            className="w-7 h-7 text-white text-lg font-bold flex items-center justify-center active:scale-90"
                          >
                            +
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
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

            {/* Title (Whatnot Title — product name) */}
            <div className="w-full max-w-sm mb-3">
              <label className="text-slate-400 text-xs uppercase tracking-wider mb-1 block">Title *</label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Teddy Peacoat, Cargo Joggers..."
                className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 focus:ring-4 focus:ring-cyan-500/10 transition-all"
              />
            </div>

            {/* Description (Whatnot Description — free-text) */}
            <div className="w-full max-w-sm mb-3">
              <label className="text-slate-400 text-xs uppercase tracking-wider mb-1 block">Description *</label>
              <input
                type="text"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Longer description for the listing..."
                className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 focus:ring-4 focus:ring-cyan-500/10 transition-all"
              />
            </div>

            {(() => {
              const totalQty = Object.values(sizeQuantities).reduce((s, v) => s + v, 0)
              return totalQty > 1 ? (
                <p className="text-slate-400 text-sm mb-2">
                  Total: <span className="text-white font-bold">${(getCost() * totalQty).toFixed(2)}</span> for {totalQty} items
                </p>
              ) : null
            })()}
          </div>
          </div>

          {/* Save button — always visible at bottom */}
          <div className="shrink-0 p-4 pt-2">
            {(() => {
              const totalQty = Object.values(sizeQuantities).reduce((s, v) => s + v, 0)
              const disabled = saving || !itemPhoto || !description || !condition || !color || totalQty === 0 || !msrp || !title.trim() || !notes.trim()
              return (
            <button
              onClick={handleSave}
              disabled={disabled}
              className={`w-full py-4 rounded-3xl font-bold text-xl transition-all ${
                disabled
                  ? 'bg-white/10 text-white/50 cursor-not-allowed'
                  : 'bg-gradient-to-r from-pink-500 to-pink-600 text-white shadow-2xl shadow-pink-500/30 hover:scale-[1.02] active:scale-[0.98]'
              }`}
            >
              {saving ? 'Saving...' : totalQty > 1 ? `Save ${totalQty} Items` : 'Save Item'}
            </button>
              )
            })()}
          </div>
        </div>
      )}
    </div>
  )
}
