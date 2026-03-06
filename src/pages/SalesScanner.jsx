import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { Html5Qrcode } from 'html5-qrcode'
import { supabase } from '../lib/supabase'
import { normalizeBarcode } from '../lib/barcodes'

// Lazy-loading photo thumbnail for No Barcode picker — tap to expand
function LazyPhoto({ intakeId }) {
  const [src, setSrc] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const ref = useRef(null)

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
        className="w-16 h-16 rounded-xl border border-white/20 shrink-0 overflow-hidden bg-white/10"
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

export default function SalesScanner() {
  const navigate = useNavigate()
  const { showId } = useParams()
  const location = useLocation()
  const sessionState = location.state || {}

  const [showName, setShowName] = useState(sessionState.showName || '')
  const [showData, setShowData] = useState(sessionState.showData || {})
  const [excludedItems, setExcludedItems] = useState(sessionState.excludedItems || [])
  const [scans, setScans] = useState([])
  const [scannedBarcode, setScannedBarcode] = useState(null)
  const [listingNumber, setListingNumber] = useState('')
  const [showSuccess, setShowSuccess] = useState(false)
  const [showWarning, setShowWarning] = useState(null)
  const [isScanning, setIsScanning] = useState(false)
  const [cameraError, setCameraError] = useState(null)
  const [scannerKey, setScannerKey] = useState(0)
  const [showScansModal, setShowScansModal] = useState(false)
  const [showRemainingModal, setShowRemainingModal] = useState(false)
  const [remainingItems, setRemainingItems] = useState([])
  const [loadingRemaining, setLoadingRemaining] = useState(false)
  const [showCompletion, setShowCompletion] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [realScannedCount, setRealScannedCount] = useState(0)
  const [showExcludedModal, setShowExcludedModal] = useState(
    (sessionState.excludedItems || []).length > 0
  )
  // No-barcode item picker (Kickstart only)
  const [noBarcodeStep, setNoBarcodeStep] = useState(null) // null | 'size' | 'category' | 'pickItem'
  const [noBarcodeSize, setNoBarcodeSize] = useState(null)
  const [noBarcodeCategory, setNoBarcodeCategory] = useState(null)
  const [noBarcodeCategories, setNoBarcodeCategories] = useState([])
  const [noBarcodeItems, setNoBarcodeItems] = useState([])
  const [noBarcodeAllItems, setNoBarcodeAllItems] = useState([])
  const [noBarcodeLoading, setNoBarcodeLoading] = useState(false)
  const [selectedIntakeId, setSelectedIntakeId] = useState(null)
  // New unified picker state
  const [showItemPicker, setShowItemPicker] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const html5QrcodeRef = useRef(null)
  const initialScannedRef = useRef(null)

  const totalItems = showData?.totalItems || 0
  const scannedCount = realScannedCount
  const remainingCount = Math.max(0, totalItems - scannedCount)
  
  // Determine which table to use based on channel
  const scansTable = showData?.channel === 'Kickstart' ? 'kickstart_sold_scans' : 'jumpstart_sold_scans'

  // Load show data if we don't have it from navigation state
  useEffect(() => {
    if (!showName && showId) {
      supabase.from('shows').select('*').eq('id', showId).single()
        .then(({ data }) => {
          if (data) {
            setShowName(data.name)
            setShowData({
              id: data.id,
              showName: data.name,
              totalItems: data.total_items,
              scanned: data.scanned_count || 0,
              channel: data.channel,
              date: data.date
            })
          }
        })
    }
  }, [showId])

  // Start scanner on mount (unless excluded modal is showing)
  // For Kickstart, load item picker instead of scanner
  useEffect(() => {
    if (!showExcludedModal) {
      if (showData?.channel === 'Kickstart') {
        // For Kickstart, show item picker as main interface
        setShowItemPicker(true)
        loadAllUnsoldItems()
      } else {
        // For Jumpstart, use barcode scanner
        startScanner()
      }
    }
    return () => { stopScanner() }
  }, [showExcludedModal, showData?.channel])

  // Poll for real scanned count (multi-device support)
  useEffect(() => {
    if (showExcludedModal || !showName || !showData?.channel) return

    const fetchRealCount = async () => {
      try {
        const table = showData.channel === 'Kickstart' ? 'kickstart_sold_scans' : 'jumpstart_sold_scans'
        const { count } = await supabase
          .from(table)
          .select('id', { count: 'exact', head: true })
          .eq('show_id', showId)
        const realCount = count || 0
        setRealScannedCount(realCount)
        // Keep shows.scanned_count in sync
        supabase.from('shows').update({ scanned_count: realCount }).eq('id', showId).then(() => {})
      } catch (err) {
        console.error('Error fetching real count:', err)
      }
    }

    fetchRealCount()
    const interval = setInterval(fetchRealCount, 5000)
    return () => clearInterval(interval)
  }, [showName, showExcludedModal, showId, showData?.channel])


  // Load scans from Supabase (persists across refreshes)
  const loadScans = async () => {
    if (!showId || !showData?.channel) return
    const table = showData.channel === 'Kickstart' ? 'kickstart_sold_scans' : 'jumpstart_sold_scans'
    const { data } = await supabase
      .from(table)
      .select('barcode, listing_number, scanned_at')
      .eq('show_id', showId)
      .order('scanned_at', { ascending: false })
    if (data) {
      setScans(data.map(s => ({
        barcode: s.barcode,
        listingNum: s.listing_number,
        productName: '',
        timestamp: s.scanned_at
      })))
    }
  }

  useEffect(() => {
    if (showId && showData?.channel) loadScans()
  }, [showId, showData?.channel])

  // Load remaining (unscanned) items
  const loadRemainingItems = async () => {
    if (!showId || !showData?.channel) return
    setLoadingRemaining(true)
    try {
      const table = showData.channel === 'Kickstart' ? 'kickstart_sold_scans' : 'jumpstart_sold_scans'

      // Get all scanned listing numbers for this show
      const { data: scannedData } = await supabase
        .from(table)
        .select('listing_number')
        .eq('show_id', showId)

      const scannedListings = new Set((scannedData || []).map(s => String(s.listing_number)))

      // Get all valid show_items that haven't been scanned
      const { data: allItems } = await supabase
        .from('show_items')
        .select('listing_number, product_name, status')
        .eq('show_id', showId)
        .eq('status', 'valid')
        .order('listing_number', { ascending: true })

      const remaining = (allItems || []).filter(item =>
        !scannedListings.has(String(item.listing_number))
      )

      setRemainingItems(remaining)
    } catch (err) {
      console.error('Error loading remaining items:', err)
    }
    setLoadingRemaining(false)
  }

  // Check for completion
  useEffect(() => {
    if (showExcludedModal) return
    if (initialScannedRef.current === null && scannedCount > 0) {
      initialScannedRef.current = scannedCount
      if (scannedCount >= totalItems) return
    }
    if (initialScannedRef.current !== null && initialScannedRef.current < totalItems &&
        scannedCount >= totalItems && !showCompletion) {
      handleAutoComplete()
    }
  }, [scannedCount, totalItems, showExcludedModal])

  // Browser back button for modals
  useEffect(() => {
    const handlePopState = () => {
      if (showScansModal) {
        setShowScansModal(false)
        window.history.pushState(null, '', window.location.pathname)
      }
      if (showRemainingModal) {
        setShowRemainingModal(false)
        window.history.pushState(null, '', window.location.pathname)
      }
    }
    if (showScansModal || showRemainingModal) {
      window.history.pushState(null, '', window.location.pathname)
      window.addEventListener('popstate', handlePopState)
    }
    return () => { window.removeEventListener('popstate', handlePopState) }
  }, [showScansModal, showRemainingModal])

  const handleAutoComplete = async () => {
    await stopScanner()
    setShowCompletion(true)
    try {
      await supabase.from('shows')
        .update({ status: 'completed', scanned_count: scannedCount })
        .eq('id', showId)
    } catch (err) {
      console.error('Error updating show status:', err)
    }
  }

  const startScanner = async () => {
    try {
      if (html5QrcodeRef.current && isScanning) {
        await html5QrcodeRef.current.stop()
        html5QrcodeRef.current = null
        setIsScanning(false)
      }
      await new Promise(resolve => setTimeout(resolve, 200))
      const html5QrCode = new Html5Qrcode("sales-reader")
      html5QrcodeRef.current = html5QrCode
      await html5QrCode.start(
        { facingMode: "environment" },
        { fps: 60 },
        onScanSuccess,
        () => {}
      )
      setIsScanning(true)
      setCameraError(null)
    } catch (err) {
      console.error("Camera error:", err)
      setCameraError(err.message)
      setIsScanning(false)
    }
  }

  const stopScanner = async () => {
    if (html5QrcodeRef.current && isScanning) {
      try {
        await html5QrcodeRef.current.stop()
        setIsScanning(false)
      } catch (err) {
        console.error("Stop error:", err)
      }
    }
  }

  const onScanSuccess = async (decodedText) => {
    // Kickstart: Free People/UO/Anthro use 196-199 prefixes (with or without leading 0)
    // Jumpstart: J.Crew/Madewell use 099 prefix
    // Kickstart: accept any barcode 8+ digits (FP/UO/Anthro tags have various formats)
    // Jumpstart: must start with 099 prefix
    const isValidBarcode = showData?.channel === 'Kickstart'
      ? decodedText.length >= 8 && /^\d+$/.test(decodedText)
      : decodedText.startsWith('099')
    if (!isValidBarcode) return
    setScannedBarcode(normalizeBarcode(decodedText))
    await stopScanner()
  }

  // No Barcode handler
  const handleNoBarcode = async () => {
    await stopScanner()
    if (showData?.channel === 'Kickstart') {
      // For Kickstart, item picker is already main interface - this shouldn't be called
      // But if it is, just ensure picker is loaded
      if (!showItemPicker) {
        setShowItemPicker(true)
        loadAllUnsoldItems()
      }
    } else {
      setScannedBarcode('NO_BARCODE')
    }
  }

  // Load all unsold Kickstart items for the unified picker
  const loadAllUnsoldItems = async () => {
    setNoBarcodeLoading(true)
    try {
      const { data: intakeItems } = await supabase
        .from('kickstart_intake')
        .select('id, brand, description, color, condition, size')
        .in('status', ['enriched', 'pending_enrichment'])

      // Get already-sold intake_ids
      const { data: soldData } = await supabase
        .from('kickstart_sold_scans')
        .select('intake_id')
        .not('intake_id', 'is', null)

      const soldIds = new Set((soldData || []).map(s => s.intake_id))
      const available = (intakeItems || [])
        .filter(item => !soldIds.has(item.id))
        .sort((a, b) => b.id - a.id) // newest first

      // Extract unique categories with counts
      const catCounts = {}
      for (const item of available) {
        const cat = item.description || 'Uncategorized'
        catCounts[cat] = (catCounts[cat] || 0) + 1
      }
      const cats = Object.entries(catCounts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)

      setNoBarcodeAllItems(available)
      setNoBarcodeCategories(cats)
      setNoBarcodeSize(null) // Reset filters
      setNoBarcodeCategory(null)
      setSearchQuery('')
    } catch (err) {
      console.error('Error loading unsold items:', err)
    }
    setNoBarcodeLoading(false)
  }

  // Fetch unsold Kickstart items for a given size, then show category picker
  const fetchNoBarcodeItems = async (size) => {
    setNoBarcodeLoading(true)
    setNoBarcodeSize(size)
    try {
      let query = supabase
        .from('kickstart_intake')
        .select('id, brand, description, color, condition, size')
        .in('status', ['enriched', 'pending_enrichment'])
      if (size) query = query.eq('size', size)
      const { data: intakeItems } = await query

      // Get already-sold intake_ids
      const { data: soldData } = await supabase
        .from('kickstart_sold_scans')
        .select('intake_id')
        .not('intake_id', 'is', null)

      const soldIds = new Set((soldData || []).map(s => s.intake_id))
      const available = (intakeItems || [])
        .filter(item => !soldIds.has(item.id))
        .sort((a, b) => b.id - a.id) // newest first

      // Extract unique categories with counts
      const catCounts = {}
      for (const item of available) {
        const cat = item.description || 'Uncategorized'
        catCounts[cat] = (catCounts[cat] || 0) + 1
      }
      const cats = Object.entries(catCounts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)

      setNoBarcodeAllItems(available)
      setNoBarcodeCategories(cats)

      if (cats.length <= 1) {
        // Skip category step if only one (or zero) categories
        setNoBarcodeItems(available)
        setNoBarcodeStep('pickItem')
      } else {
        setNoBarcodeStep('category')
      }
    } catch (err) {
      console.error('Error fetching no-barcode items:', err)
    }
    setNoBarcodeLoading(false)
  }

  // Filter items based on size, category, and search query
  const getFilteredItems = () => {
    let filtered = noBarcodeAllItems

    // Filter by size
    if (noBarcodeSize) {
      filtered = filtered.filter(i => i.size === noBarcodeSize)
    }

    // Filter by category
    if (noBarcodeCategory) {
      filtered = filtered.filter(i => (i.description || 'Uncategorized') === noBarcodeCategory)
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(i => {
        const searchable = [i.brand, i.description, i.color, i.condition].filter(Boolean).join(' ').toLowerCase()
        return searchable.includes(query)
      })
    }

    // Group by (brand, description, color, condition) — identical items become one row
    const groups = new Map()
    for (const item of filtered) {
      const key = `${item.brand}||${item.description || ''}||${item.color || ''}||${item.condition || ''}`
      if (!groups.has(key)) {
        groups.set(key, { brand: item.brand, description: item.description, color: item.color, condition: item.condition, size: item.size, ids: [] })
      }
      groups.get(key).ids.push(item.id)
    }

    return Array.from(groups.values()).sort((a, b) => b.ids.length - a.ids.length)
  }

  // Filter by category, group identical items, show grouped list
  const handleNoBarcodeCategory = (category) => {
    setNoBarcodeCategory(category)
    const filtered = category
      ? noBarcodeAllItems.filter(i => (i.description || 'Uncategorized') === category)
      : noBarcodeAllItems

    // Group by (brand, description, color, condition) — identical items become one row
    const groups = new Map()
    for (const item of filtered) {
      const key = `${item.brand}||${item.description || ''}||${item.color || ''}||${item.condition || ''}`
      if (!groups.has(key)) {
        groups.set(key, { brand: item.brand, description: item.description, color: item.color, condition: item.condition, size: item.size, ids: [] })
      }
      groups.get(key).ids.push(item.id)
    }

    setNoBarcodeItems(Array.from(groups.values()).sort((a, b) => b.ids.length - a.ids.length))
    setNoBarcodeStep('pickItem')
  }

  // Select a no-barcode group — grab the first unsold ID
  const handlePickNoBarcodeItem = (group) => {
    const intakeId = group.ids[0]
    setSelectedIntakeId(intakeId)
    const label = [group.brand, group.description, group.color, group.condition].filter(Boolean).join(' - ')
    setScannedBarcode(label) // Clean label without NO_BARCODE prefix
    setNoBarcodeStep(null)
    // Don't close showItemPicker or reset filters - they'll return to it after submitting
  }

  const cancelNoBarcode = async () => {
    setNoBarcodeStep(null)
    setNoBarcodeSize(null)
    setNoBarcodeCategory(null)
    setNoBarcodeCategories([])
    setNoBarcodeItems([])
    setNoBarcodeAllItems([])
    setShowItemPicker(false)
    setSearchQuery('')
    setScannerKey(prev => prev + 1)
    // For Jumpstart only - restart scanner
    if (showData?.channel !== 'Kickstart') {
      await startScanner()
    }
  }

  const handleSubmit = async (e) => {
    if (e) e.preventDefault()
    if (submitting) return

    const isKickstart = showData?.channel === 'Kickstart'
    const table = isKickstart ? 'kickstart_sold_scans' : 'jumpstart_sold_scans'

    try {
      // Check for duplicate scan
      const { data: dupCheck } = await supabase
        .from(table)
        .select('id')
        .eq('show_id', showId)
        .eq('listing_number', listingNumber)
        .limit(1)

      if (dupCheck && dupCheck.length > 0) {
        setShowWarning('Duplicate — this listing was already scanned')
        return
      }

      // Check show_items for this listing
      const { data: itemCheck } = await supabase
        .from('show_items')
        .select('*')
        .eq('show_id', showId)
        .eq('listing_number', listingNumber)
        .limit(1)

      if (!itemCheck || itemCheck.length === 0) {
        setShowWarning('Listing not found in show data')
        return
      }

      const showItem = itemCheck[0]

      // Check for failed/cancelled
      if (showItem.status === 'failed' || showItem.status === 'cancelled') {
        setShowWarning(`${showItem.status === 'failed' ? '❌ Failed payment' : '❌ Cancelled'} — ${showItem.product_name}`)
        return
      }

      // Valid — proceed
      setSubmitting(true)

      const scan = {
        barcode: scannedBarcode,
        listingNum: listingNumber,
        productName: showItem.product_name || '',
        timestamp: new Date().toISOString()
      }

      setScans(prev => [...prev, scan])

      // Build insert object
      const insertData = {
        show_id: showId,
        barcode: scannedBarcode,
        listing_number: listingNumber,
        scanned_by: 'phone'
      }

      // For Kickstart, use selected intake_id (no-barcode picker) or look up by UPC
      // Both scannedBarcode and kickstart_intake.upc are normalized (leading 0s stripped,
      // 13-digit EAN-13 → 12-digit UPC-A) so exact match works
      if (isKickstart) {
        if (selectedIntakeId) {
          insertData.intake_id = selectedIntakeId
        } else {
          const { data: intakeMatch } = await supabase
            .from('kickstart_intake')
            .select('id')
            .eq('upc', scannedBarcode)
            .eq('status', 'enriched')
            .is('sale_price', null)
            .limit(1)

          if (intakeMatch && intakeMatch.length > 0) {
            insertData.intake_id = intakeMatch[0].id
          }
        }
      }

      // Fire-and-forget: log scan to Supabase
      supabase.from(table).insert(insertData).then(() => {
        supabase.from('shows')
          .update({ scanned_count: scannedCount + 1 })
          .eq('id', showId)
      })

      // Show success and restart
      setShowSuccess(true)
      setShowWarning(null)
      setTimeout(async () => {
        setShowSuccess(false)
        setScannedBarcode(null)
        setListingNumber('')
        setSelectedIntakeId(null)
        setScannerKey(prev => prev + 1)
        setSubmitting(false)
        // For Kickstart, return to item picker; for Jumpstart, restart scanner
        if (showData?.channel === 'Kickstart') {
          // Already in item picker - just clearing scannedBarcode returns us there
        } else {
          await startScanner()
        }
        loadScans()
      }, 500)

    } catch (err) {
      console.error('Submit error:', err)
      setShowWarning('Error validating listing')
    }
  }

  const handleDeleteScan = async (indexToDelete) => {
    if (!confirm('Delete this scan?')) return
    const scan = scans[indexToDelete]
    if (!scan) return
    // Delete from Supabase by matching show_id + listing_number
    const table = showData?.channel === 'Kickstart' ? 'kickstart_sold_scans' : 'jumpstart_sold_scans'
    await supabase.from(table).delete().eq('show_id', showId).eq('listing_number', scan.listingNum)
    // Remove from local state
    setScans(prev => prev.filter((_, idx) => idx !== indexToDelete))
    // Count will auto-update via the polling interval
  }

  const handleFinish = async () => {
    await stopScanner()
    navigate('/sales')
  }

  const handleBack = async () => {
    // If in listing number entry screen, go back to item picker
    if (scannedBarcode) {
      setScannedBarcode(null)
      setListingNumber('')
      setSelectedIntakeId(null)
      setShowWarning(null)
      // Don't restart scanner for Kickstart (item picker is main screen)
      if (showData?.channel !== 'Kickstart') {
        await startScanner()
      }
    } else {
      // From main screen (item picker or scanner), go back to show list
      handleFinish()
    }
  }

  // Excluded items interstitial
  if (showExcludedModal) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#0a0f1a] p-6">
        <div className="fixed inset-0 bg-gradient-to-br from-pink-900/20 via-transparent to-fuchsia-900/10 pointer-events-none" />
        <div className="relative z-10 w-full max-w-md">
          <div className="bg-pink-500/10 border border-pink-500/30 rounded-2xl p-6 mb-6">
            <div className="text-center mb-4">
              <div className="text-5xl mb-3">⚠️</div>
              <h2 className="text-2xl font-bold text-pink-200">Items Removed</h2>
              <p className="text-pink-200/60 text-sm mt-1">Skip these when scanning — they failed or were cancelled</p>
            </div>
            <div className="space-y-2 mb-4">
              {excludedItems.map((item, i) => (
                <div key={i} className="bg-pink-500/10 rounded-xl p-3 flex items-center justify-between">
                  <div className="flex-1">
                    <p className="text-pink-100 text-sm font-semibold">#{item.listingNum}</p>
                    <p className="text-pink-200/60 text-xs truncate">{item.productName}</p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full ${item.status === 'failed' ? 'bg-red-500/30 text-red-300' : 'bg-amber-500/30 text-amber-300'}`}>
                    {item.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <button
            onClick={() => { setShowExcludedModal(false); startScanner(); }}
            className="w-full py-4 px-8 rounded-2xl font-bold text-lg bg-gradient-to-r from-cyan-600 to-teal-600 text-white shadow-lg shadow-cyan-500/30 hover:scale-[1.02] active:scale-[0.98] transition-all"
          >
            Got it — Start Scanning
          </button>
        </div>
      </div>
    )
  }

  // Completion screen
  if (showCompletion) {
    return (
      <div className="h-screen flex items-center justify-center bg-gradient-to-br from-green-600 via-emerald-500 to-teal-500 p-6">
        <div className="text-center">
          <div className="text-9xl mb-6">🎉</div>
          <h2 className="text-4xl font-black text-white mb-2">All Done!</h2>
          <button
            onClick={() => navigate('/sales')}
            className="px-8 py-4 bg-white/20 backdrop-blur rounded-2xl text-white font-bold text-lg hover:bg-white/30 transition-all"
          >
            Back to Shows
          </button>
        </div>
      </div>
    )
  }

  // Accent colors based on channel
  const isKickstart = showData?.channel === 'Kickstart'
  const gradientFrom = isKickstart ? 'from-fuchsia-600' : 'from-cyan-600'
  const gradientTo = isKickstart ? 'to-pink-600' : 'to-teal-600'
  const shadowColor = isKickstart ? 'shadow-fuchsia-500/30' : 'shadow-cyan-500/30'

  return (
    <div className="fixed inset-0 flex flex-col bg-[#0a0f1a]">
      <div className={`fixed inset-0 bg-gradient-to-br ${isKickstart ? 'from-fuchsia-900/20 via-transparent to-pink-900/10' : 'from-cyan-900/20 via-transparent to-teal-900/10'} pointer-events-none`} />

      {/* Header - Row 1: Back + Show Name */}
      <div className="relative z-10 bg-slate-800/80 backdrop-blur-xl px-4 pt-3 pb-1 flex items-center border-b border-white/5">
        <button onClick={handleBack} className="text-white text-2xl mr-3">←</button>
        <p className="text-white font-bold text-base truncate flex-1 text-center">{showName}</p>
      </div>

      {/* Header - Row 2: Scanned / Total → Remaining */}
      <div className="relative z-10 bg-slate-800/80 backdrop-blur-xl px-4 pt-1 pb-3 flex items-center justify-center gap-3 border-b border-white/5">
        <div className="text-center">
          <p className={`text-3xl font-black ${isKickstart ? 'text-fuchsia-400' : 'text-teal-400'}`}>{scannedCount}</p>
          <p className="text-white/50 text-xs">Scanned</p>
        </div>
        <span className="text-white/30 text-2xl font-light">/</span>
        <div className="text-center">
          <p className="text-3xl font-black text-white">{totalItems}</p>
          <p className="text-white/50 text-xs">Total</p>
        </div>
        <span className="text-white/30 text-2xl">→</span>
        <div className="text-center">
          <p className="text-3xl font-black text-violet-400">{remainingCount}</p>
          <p className="text-white/50 text-xs">Remaining</p>
        </div>
      </div>

      {/* Main Content */}
      {noBarcodeStep ? (
        <div className="relative z-10 flex-1 flex flex-col items-center p-4 overflow-y-auto">
          {noBarcodeStep === 'size' && (
            <>
              <h2 className="text-xl font-bold text-white mb-1 mt-2">Select Size</h2>
              <p className="text-slate-400 mb-4 text-sm">What size is the item?</p>
              <div className="w-full max-w-sm grid grid-cols-2 gap-3 mb-4">
                {['XS', 'S', 'M', 'L', 'XL', 'XXL', 'One Size'].map(s => (
                  <button
                    key={s}
                    onClick={() => fetchNoBarcodeItems(s)}
                    className="py-5 rounded-2xl bg-gradient-to-br from-fuchsia-500/80 to-pink-500/80 border-2 border-fuchsia-400/40 text-white font-black text-2xl shadow-xl shadow-fuchsia-500/20 hover:scale-105 active:scale-95 transition-all"
                  >
                    {s}
                  </button>
                ))}
              </div>
              <button
                onClick={() => fetchNoBarcodeItems(null)}
                className="w-full max-w-sm py-3 mt-1 rounded-2xl bg-white/10 border border-white/20 text-white/70 font-semibold text-lg hover:bg-white/20 transition-all"
              >
                All Items
              </button>
              <button onClick={cancelNoBarcode} className="text-white/40 text-sm underline mt-3">Cancel</button>
            </>
          )}
          {noBarcodeStep === 'category' && (
            <>
              <h2 className="text-xl font-bold text-white mb-1 mt-2">Select Category</h2>
              <p className="text-slate-400 mb-4 text-sm">{noBarcodeAllItems.length} unsold {noBarcodeSize || 'All'} items</p>
              {noBarcodeLoading ? (
                <p className="text-white/50 text-lg py-12">Loading...</p>
              ) : (
                <div className="w-full max-w-sm space-y-2 mb-4">
                  {noBarcodeCategories.map(cat => (
                    <button
                      key={cat.name}
                      onClick={() => handleNoBarcodeCategory(cat.name)}
                      className="w-full text-left bg-white/5 border border-white/10 rounded-2xl px-4 py-4 hover:bg-white/10 active:scale-[0.98] transition-all flex items-center justify-between"
                    >
                      <span className="text-white font-semibold">{cat.name}</span>
                      <span className="text-fuchsia-300 font-bold text-sm bg-fuchsia-500/20 px-3 py-1 rounded-full">{cat.count}</span>
                    </button>
                  ))}
                  <button
                    onClick={() => handleNoBarcodeCategory(null)}
                    className="w-full py-3 mt-1 rounded-2xl bg-white/10 border border-white/20 text-white/70 font-semibold hover:bg-white/20 transition-all"
                  >
                    All Categories
                  </button>
                </div>
              )}
              <div className="flex gap-3 w-full max-w-sm">
                <button onClick={() => setNoBarcodeStep('size')} className="flex-1 py-3 rounded-2xl bg-white/10 border border-white/20 text-white font-semibold text-sm">
                  ← Back
                </button>
                <button onClick={cancelNoBarcode} className="flex-1 py-3 rounded-2xl bg-white/10 border border-white/20 text-white/50 font-semibold text-sm">
                  Cancel
                </button>
              </div>
            </>
          )}
          {noBarcodeStep === 'pickItem' && (
            <>
              <h2 className="text-xl font-bold text-white mb-1 mt-2">{noBarcodeSize ? `Pick Item — ${noBarcodeSize}` : 'Pick Item'}{noBarcodeCategory ? ` — ${noBarcodeCategory}` : ''}</h2>
              <p className="text-slate-400 mb-4 text-sm">{noBarcodeItems.length} unsold item{noBarcodeItems.length !== 1 ? 's' : ''}</p>
              {noBarcodeLoading ? (
                <p className="text-white/50 text-lg py-12">Loading...</p>
              ) : noBarcodeItems.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-white/50 text-lg mb-4">No unsold items{noBarcodeSize ? ` in size ${noBarcodeSize}` : ''}</p>
                  <button
                    onClick={() => setNoBarcodeStep('size')}
                    className="px-6 py-3 bg-white/10 rounded-2xl text-white font-semibold border border-white/20"
                  >
                    Try Another Size
                  </button>
                </div>
              ) : (
                <div className="w-full max-w-sm space-y-2 mb-4">
                  {noBarcodeItems.map((group, idx) => (
                    <button
                      key={idx}
                      onClick={() => handlePickNoBarcodeItem(group)}
                      className="w-full text-left bg-white/5 border border-white/10 rounded-2xl p-3 hover:bg-white/10 active:scale-[0.98] transition-all"
                    >
                      <div className="flex items-center gap-3">
                        <LazyPhoto intakeId={group.ids[0]} />
                        <div className="min-w-0 flex-1">
                          <p className="text-white font-semibold text-sm truncate">
                            {[group.description, group.color].filter(Boolean).join(' — ') || 'Unknown'}
                          </p>
                          <p className="text-slate-400 text-xs">
                            {[group.brand, group.size, group.condition].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                        {group.ids.length > 1 && (
                          <span className="text-fuchsia-300 font-bold text-sm bg-fuchsia-500/20 px-3 py-1 rounded-full shrink-0">
                            {group.ids.length}
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              <div className="flex gap-3 w-full max-w-sm">
                <button onClick={() => { noBarcodeCategories.length > 1 ? setNoBarcodeStep('category') : setNoBarcodeStep('size') }} className="flex-1 py-3 rounded-2xl bg-white/10 border border-white/20 text-white font-semibold text-sm">
                  ← Back
                </button>
                <button onClick={cancelNoBarcode} className="flex-1 py-3 rounded-2xl bg-white/10 border border-white/20 text-white/50 font-semibold text-sm">
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      ) : !scannedBarcode ? (
        showItemPicker ? (
          <div className="relative z-10 flex-1 flex flex-col overflow-hidden">
            {/* Filters - fixed height, scrollable if needed */}
            <div className="px-4 py-3 bg-slate-800/50 border-b border-white/10 space-y-3 flex-shrink-0 max-h-[40vh] overflow-y-auto">
            {/* Search box */}
            <input
              type="text"
              placeholder="Search by brand, description, color..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-fuchsia-500"
            />

            {/* Size filter */}
            <div>
              <p className="text-white/60 text-xs font-semibold mb-2">SIZE</p>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => setNoBarcodeSize(null)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                    !noBarcodeSize
                      ? 'bg-fuchsia-500 text-white'
                      : 'bg-white/10 text-white/60 hover:bg-white/20'
                  }`}
                >
                  All
                </button>
                {['XS', 'S', 'M', 'L', 'XL', 'XXL', 'One Size'].map(s => (
                  <button
                    key={s}
                    onClick={() => setNoBarcodeSize(s)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                      noBarcodeSize === s
                        ? 'bg-fuchsia-500 text-white'
                        : 'bg-white/10 text-white/60 hover:bg-white/20'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Category filter */}
            <div>
              <p className="text-white/60 text-xs font-semibold mb-2">CATEGORY</p>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => setNoBarcodeCategory(null)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                    !noBarcodeCategory
                      ? 'bg-fuchsia-500 text-white'
                      : 'bg-white/10 text-white/60 hover:bg-white/20'
                  }`}
                >
                  All
                </button>
                {noBarcodeCategories.slice(0, 8).map(cat => (
                  <button
                    key={cat.name}
                    onClick={() => setNoBarcodeCategory(cat.name)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                      noBarcodeCategory === cat.name
                        ? 'bg-fuchsia-500 text-white'
                        : 'bg-white/10 text-white/60 hover:bg-white/20'
                    }`}
                  >
                    {cat.name} ({cat.count})
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Items list */}
          <div className="flex-1 overflow-y-auto p-4 min-h-0">
            {noBarcodeLoading ? (
              <div className="text-center py-12">
                <p className="text-white/50 text-lg">Loading...</p>
              </div>
            ) : (() => {
              const filteredGroups = getFilteredItems()
              return filteredGroups.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-white/50 text-lg mb-2">No items found</p>
                  <button
                    onClick={() => { setNoBarcodeSize(null); setNoBarcodeCategory(null); setSearchQuery('') }}
                    className="text-fuchsia-400 text-sm underline"
                  >
                    Clear filters
                  </button>
                </div>
              ) : (
                <div className="max-w-2xl mx-auto space-y-2">
                  <p className="text-white/40 text-xs mb-3">{filteredGroups.length} result{filteredGroups.length !== 1 ? 's' : ''}</p>
                  {filteredGroups.map((group, idx) => (
                    <button
                      key={idx}
                      onClick={() => handlePickNoBarcodeItem(group)}
                      className="w-full text-left bg-white/5 border border-white/10 rounded-2xl p-3 hover:bg-fuchsia-500/10 hover:border-fuchsia-500/30 active:scale-[0.98] transition-all"
                    >
                      <div className="flex items-center gap-3">
                        <LazyPhoto intakeId={group.ids[0]} />
                        <div className="min-w-0 flex-1">
                          <p className="text-white font-semibold text-sm truncate">
                            {[group.description, group.color].filter(Boolean).join(' — ') || 'Unknown'}
                          </p>
                          <p className="text-slate-400 text-xs">
                            {[group.brand, group.size, group.condition].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                        {group.ids.length > 1 && (
                          <span className="text-fuchsia-300 font-bold text-sm bg-fuchsia-500/20 px-3 py-1 rounded-full shrink-0">
                            {group.ids.length}
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )
            })()}
          </div>

          {/* Bottom buttons: Remaining + Scans (no Find Item - the whole page is for finding items) */}
          <div className="relative z-10 px-4 pt-3 flex gap-2 backdrop-blur-xl shrink-0" style={{ paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 12px))' }}>
            <button
              onClick={() => { loadRemainingItems(); setShowRemainingModal(true); }}
              className="flex-1 py-3 rounded-2xl font-bold text-sm bg-gradient-to-r from-indigo-500 to-blue-500 text-white shadow-lg shadow-indigo-500/30 border border-indigo-400/50 active:scale-[0.97] transition-all"
            >
              Remaining
            </button>
            <button
              onClick={() => setShowScansModal(true)}
              className="flex-1 py-3 rounded-2xl font-bold text-sm bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-lg shadow-violet-500/30 border border-violet-400/50 active:scale-[0.97] transition-all"
            >
              Scans
            </button>
          </div>
        </div>
        ) : (
          <div className="relative z-10 flex-1 flex flex-col">
          {cameraError ? (
            <div className="flex-1 flex items-center justify-center bg-slate-900">
              <div className="text-center">
                <p className="text-red-400 mb-4">Camera Error: {cameraError}</p>
                <button
                  onClick={startScanner}
                  className="px-6 py-3 bg-white/20 rounded-full text-white font-semibold"
                >
                  Retry
                </button>
              </div>
            </div>
          ) : (
            <div className="flex-1 min-h-0 flex items-center justify-center bg-slate-900 px-4 py-2">
              <div
                key={scannerKey}
                id="sales-reader"
                className="w-full max-w-lg rounded-3xl overflow-hidden" style={{ maxHeight: "100%", height: "100%" }}
              ></div>
            </div>
          )}

          {/* Bottom buttons: No Barcode + Remaining + Scans */}
          <div className="relative z-10 px-4 pt-3 flex gap-2 backdrop-blur-xl shrink-0" style={{ paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 12px))' }}>
            <button
              onClick={handleNoBarcode}
              className="flex-1 py-3 rounded-2xl font-bold text-sm bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg shadow-amber-500/30 border border-amber-400/50 active:scale-[0.97] transition-all"
            >
              {isKickstart ? 'Find Item' : 'No Barcode'}
            </button>
            <button
              onClick={() => { loadRemainingItems(); setShowRemainingModal(true); }}
              className="flex-1 py-3 rounded-2xl font-bold text-sm bg-gradient-to-r from-indigo-500 to-blue-500 text-white shadow-lg shadow-indigo-500/30 border border-indigo-400/50 active:scale-[0.97] transition-all"
            >
              Remaining
            </button>
            <button
              onClick={() => setShowScansModal(true)}
              className="flex-1 py-3 rounded-2xl font-bold text-sm bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-lg shadow-violet-500/30 border border-violet-400/50 active:scale-[0.97] transition-all"
            >
              Scans
            </button>
          </div>
        </div>
        )
      ) : showSuccess ? (
        <div className={`flex-1 flex items-center justify-center bg-gradient-to-br ${isKickstart ? 'from-fuchsia-500/95 via-pink-500/95 to-rose-500/95' : 'from-green-500/95 via-emerald-500/95 to-teal-500/95'}`}>
          <div className="text-center">
            <div className="text-9xl mb-6">✓</div>
            <h2 className="text-6xl font-black text-white">Saved!</h2>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center p-4 overflow-hidden">
          <div className="w-full max-w-md flex flex-col" style={{ maxHeight: 'calc(100vh - 180px)' }}>
            <div className={`bg-gradient-to-br ${isKickstart ? 'from-fuchsia-500/20 via-pink-500/20 to-rose-500/20 border-fuchsia-400/30' : 'from-teal-500/20 via-cyan-500/20 to-blue-500/20 border-cyan-400/30'} backdrop-blur-lg rounded-3xl p-4 mb-4 border`}>
              <p className="text-xs text-white/70 mb-1">{isKickstart ? 'Selected Item' : 'Scanned Barcode'}</p>
              <p className="text-xl font-bold text-white break-all">{scannedBarcode}</p>
            </div>

            {/* Warning Message */}
            {showWarning && (
              <div className="bg-red-500/30 border-2 border-red-400 rounded-2xl p-4 mb-4 animate-pulse">
                <p className="text-white font-bold text-center text-lg">⚠️ {showWarning}</p>
              </div>
            )}

            <div className="flex-1 flex flex-col justify-between">
              <div>
                <label className="block text-base font-semibold text-white/90 mb-2 text-center">
                  Yellow Sticker Number
                </label>
                <div className="text-6xl font-bold text-white text-center mb-4 flex items-center justify-center">
                  {listingNumber || '_'}
                </div>
              </div>
              
              <div className="grid grid-cols-5 gap-2 mb-3">
                {[1,2,3,4,5,6,7,8,9,0].map(num => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => {
                      setListingNumber(prev => { const next = prev + num.toString(); return String(parseInt(next, 10)); })
                      setShowWarning(null)
                    }}
                    className={`py-3 text-2xl font-semibold bg-gradient-to-br ${isKickstart ? 'from-fuchsia-500 to-pink-500 border-fuchsia-400/50 shadow-fuchsia-500/30' : 'from-teal-500 to-cyan-500 border-cyan-400/50 shadow-teal-500/30'} text-white border-2 rounded-xl hover:scale-105 transition-all shadow-xl`}
                  >
                    {num}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setListingNumber(prev => prev.slice(0, -1))
                    setShowWarning(null)
                  }}
                  className="py-3 text-xl font-semibold bg-gradient-to-br from-amber-400 to-orange-500 text-white border-2 border-amber-400/50 rounded-xl hover:scale-105 transition-all shadow-xl shadow-amber-500/40"
                >
                  ←
                </button>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={async () => {
                    setScannedBarcode(null)
                    setListingNumber('')
                    setShowWarning(null)
                    setSelectedIntakeId(null)
                    setScannerKey(prev => prev + 1)
                    // For Kickstart, return to item picker; for Jumpstart, restart scanner
                    if (showData?.channel !== 'Kickstart') {
                      await startScanner()
                    }
                  }}
                  className="flex-1 py-4 px-6 rounded-2xl bg-gradient-to-r from-pink-500 to-rose-500 border-2 border-pink-400/60 text-white font-bold text-lg
                             hover:scale-105 transition-all shadow-xl shadow-pink-500/40"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={showWarning ? async () => {
                    setScannedBarcode(null)
                    setListingNumber('')
                    setShowWarning(null)
                    setSelectedIntakeId(null)
                    setScannerKey(prev => prev + 1)
                    // For Kickstart, return to item picker; for Jumpstart, restart scanner
                    if (showData?.channel !== 'Kickstart') {
                      await startScanner()
                    }
                  } : handleSubmit}
                  disabled={showWarning ? false : (!listingNumber || submitting)}
                  className={`flex-1 py-4 px-6 rounded-2xl font-bold text-lg transition-all ${
                    showWarning || (listingNumber && !submitting)
                      ? `bg-gradient-to-r ${gradientFrom} ${gradientTo} border-2 ${isKickstart ? 'border-fuchsia-400/60' : 'border-cyan-400/60'} text-white shadow-2xl ${shadowColor} hover:scale-105`
                      : 'bg-white/5 border-2 border-white/10 text-white/30 cursor-not-allowed'
                  }`}
                >
                  {submitting ? 'Saving...' : showWarning ? 'Skip → Next Scan' : 'Next Scan'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Scans Modal */}
      {showScansModal && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-lg z-50 flex flex-col">
          <div className="bg-slate-800/90 px-6 py-4 flex items-center justify-between border-b border-white/10">
            <button
              onClick={() => setShowScansModal(false)}
              className="text-white/80 hover:text-white text-3xl transition-colors"
            >
              ←
            </button>
            <div className="text-center">
              <h3 className="text-xl font-bold text-white">Scans</h3>
            </div>
            <button
              onClick={() => setShowScansModal(false)}
              className="text-white/80 hover:text-white text-3xl transition-colors"
            >
              ×
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-2xl mx-auto space-y-3">
              {scans.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-white/50 text-lg">No scans yet</p>
                </div>
              ) : (
                scans.map((scan, idx) => (
                  <div key={idx} className="bg-white/10 backdrop-blur-lg rounded-2xl p-4 border border-white/10">
                    <div className="flex items-center gap-4">
                      <div className="flex-1">
                        <p className="text-white/50 text-xs mb-1">Barcode</p>
                        <p className="text-white font-mono text-sm">{scan.barcode}</p>
                        {scan.productName && (
                          <>
                            <p className="text-white/50 text-xs mt-2 mb-1">Product</p>
                            <p className="text-white/80 text-xs">{scan.productName}</p>
                          </>
                        )}
                      </div>
                      <div className="text-center">
                        <p className="text-white/50 text-xs mb-1">Listing #</p>
                        <p className="text-white font-bold text-2xl">{scan.listingNum}</p>
                      </div>
                      <button
                        onClick={() => handleDeleteScan(idx)}
                        className="text-red-400 hover:text-red-300 hover:bg-red-500/20 rounded-lg p-3 transition-all"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 6h18"/>
                          <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                          <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Remaining Modal */}
      {showRemainingModal && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-lg z-50 flex flex-col">
          <div className="bg-slate-800/90 px-6 py-4 flex items-center justify-between border-b border-white/10">
            <button
              onClick={() => setShowRemainingModal(false)}
              className="text-white/80 hover:text-white text-3xl transition-colors"
            >
              ←
            </button>
            <div className="text-center">
              <h3 className="text-xl font-bold text-white">Remaining</h3>
              <p className="text-white/50 text-sm">{remainingItems.length} items left</p>
            </div>
            <button
              onClick={() => setShowRemainingModal(false)}
              className="text-white/80 hover:text-white text-3xl transition-colors"
            >
              ×
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-2xl mx-auto space-y-3">
              {loadingRemaining ? (
                <div className="text-center py-12">
                  <p className="text-white/50 text-lg">Loading...</p>
                </div>
              ) : remainingItems.length === 0 ? (
                <div className="text-center py-12">
                  <div className="text-6xl mb-4">🎉</div>
                  <p className="text-white text-lg font-semibold">All items scanned!</p>
                </div>
              ) : (
                remainingItems.map((item, idx) => (
                  <div
                    key={idx}
                    className="bg-indigo-500/10 backdrop-blur-lg rounded-2xl p-4 border border-indigo-500/30 hover:border-indigo-400/50 transition-all cursor-pointer active:scale-[0.98]"
                    onClick={async () => {
                      setShowRemainingModal(false)
                      setListingNumber(String(item.listing_number))
                      if (!isScanning && !scannedBarcode) {
                        await startScanner()
                      }
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-indigo-300 font-bold text-2xl">#{item.listing_number}</p>
                      <p className="text-indigo-400/60 text-sm">tap to scan</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
