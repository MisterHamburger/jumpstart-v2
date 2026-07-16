import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { Html5Qrcode } from 'html5-qrcode'
import { supabase } from '../lib/supabase'
import { normalizeBarcode } from '../lib/barcodes'

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
  const [savingRdm, setSavingRdm] = useState(false)
  // Manual Scan modal: pool-tag based no-barcode sales (whole-show / single-item)
  const [showCogsModal, setShowCogsModal] = useState(false)
  const [cogsTab, setCogsTab] = useState('show') // 'show' | 'item'
  const [itemCogsListing, setItemCogsListing] = useState('')
  const [savingCogs, setSavingCogs] = useState(false)
  const [itemCogsError, setItemCogsError] = useState(null)
  // "Manual Scan" modal: pool tag for no-barcode items.
  // The tag drives both inventory deduction (which pool) and COGS (that pool's WAC).
  // Pools are data-driven from loads.pool_tag (RDM, UJC, + custom brands like QUINCE).
  const [tagType, setTagType] = useState('')
  const [poolTagOptions, setPoolTagOptions] = useState([]) // [{ tag, label }]
  const [manualMsg, setManualMsg] = useState('')
  const html5QrcodeRef = useRef(null)
  const scannerStartingRef = useRef(false)
  // Synchronous re-entrancy guard for whole-show "finish" handlers. The
  // savingCogs state guard is async (React batches the update), so a rapid
  // double-tap can pass `if (savingCogs) return` twice — both reads see 0
  // existing scans and both bulk-insert, doubling every listing (show 171).
  const finishingShowRef = useRef(false)
  const initialScannedRef = useRef(null)
  const onScanSuccessRef = useRef(null)
  const [hardwareInput, setHardwareInput] = useState('')
  const hardwareInputRef = useRef(null)
  const hardwareTimerRef = useRef(null)
  const isHardwareScanner = /Zebra|TC[0-9]/i.test(navigator.userAgent) || new URLSearchParams(window.location.search).has('hw')

  const totalItems = showData?.totalItems || 0
  const scannedCount = realScannedCount
  const remainingCount = Math.max(0, totalItems - scannedCount)

  // Determine which table to use based on channel. Both channels sell from the
  // same shared inventory pool; the table split only preserves per-channel
  // revenue attribution (the profitability view keys COGS off pool WAC either way).
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

  // Load the available pool tags (J.Crew/Madewell blend + custom brand pools) so
  // the Manual Scan dropdown is data-driven. Closed pools (legacy RDM/UJC, now
  // folded into the JCM blend) are excluded. JCM first, then brands A–Z.
  useEffect(() => {
    supabase.from('loads')
      .select('pool_tag, vendor, kind, closed')
      .not('pool_tag', 'is', null)
      .then(({ data }) => {
        const byTag = new Map()
        for (const l of data || []) {
          if (!l.pool_tag || l.closed || byTag.has(l.pool_tag)) continue
          const label = l.pool_tag === 'JCM' ? 'J.Crew/Madewell (RDM + UJC)'
            : l.kind === 'rdm' ? 'RDM — Items with Defect Tags'
            : l.kind === 'unmanifested' ? 'UJC — J.Crew/Madewell, no barcodes/defect tags'
            : `${l.vendor || l.pool_tag} (${l.pool_tag})`
          byTag.set(l.pool_tag, { tag: l.pool_tag, label })
        }
        const rank = t => (t === 'JCM' ? 0 : 1)
        const opts = [...byTag.values()].sort(
          (a, b) => rank(a.tag) - rank(b.tag) || a.tag.localeCompare(b.tag))
        setPoolTagOptions(opts)
      })
  }, [])

  // Start scanner on mount (unless excluded modal is showing)
  useEffect(() => {
    if (!showExcludedModal && showData?.channel) startScanner()
    return () => { stopScanner() }
  }, [showExcludedModal, showData?.channel])

  // Re-focus hardware input when scanner is active (or always for hardware scanner devices)
  useEffect(() => {
    if (!scannedBarcode && (isScanning || isHardwareScanner)) setTimeout(() => hardwareInputRef.current?.focus(), 400)
  }, [scannedBarcode, isScanning])

  // Poll for real scanned count (multi-device support)
  useEffect(() => {
    if (showExcludedModal || !showName || !showData?.channel) return

    const fetchRealCount = async () => {
      try {
        const { count } = await supabase
          .from(scansTable)
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
    const { data } = await supabase
      .from(scansTable)
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
      // Get all scanned listing numbers for this show
      const { data: scannedData } = await supabase
        .from(scansTable)
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
    if (isHardwareScanner) { hardwareInputRef.current?.focus(); return } // Zebra: no camera needed
    if (scannerStartingRef.current) return // Prevent concurrent starts
    scannerStartingRef.current = true
    try {
      if (html5QrcodeRef.current) {
        const old = html5QrcodeRef.current
        html5QrcodeRef.current = null
        setIsScanning(false)
        try { await old.stop() } catch (e) {}
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
    } finally {
      scannerStartingRef.current = false
    }
  }

  const stopScanner = async () => {
    const scanner = html5QrcodeRef.current
    if (scanner) {
      html5QrcodeRef.current = null
      setIsScanning(false)
      try {
        await scanner.stop()
      } catch (err) {
        console.error("Stop error:", err)
      }
    }
  }

  const onScanSuccess = async (decodedText) => {
    // Jumpstart/liquidator barcodes start with 099; both channels sell shared
    // pool inventory, so the same gate applies. No-barcode (pool) items are
    // sold via Manual Scan.
    if (!decodedText.startsWith('099')) return

    setScannedBarcode(normalizeBarcode(decodedText))
    await stopScanner()
  }
  onScanSuccessRef.current = onScanSuccess

  // Bulk-save all remaining unscanned valid show_items as RDM, then mark show complete
  const handleSaveAllRemainingAsRdm = async () => {
    if (savingRdm || finishingShowRef.current) return
    finishingShowRef.current = true
    try {
      const { data: allItems } = await supabase
        .from('show_items')
        .select('listing_number')
        .eq('show_id', showId)
        .eq('status', 'valid')
      const { data: scannedData } = await supabase
        .from(scansTable)
        .select('listing_number')
        .eq('show_id', showId)
      const scannedSet = new Set((scannedData || []).map(s => String(s.listing_number)))
      const toInsert = (allItems || [])
        .filter(item => !scannedSet.has(String(item.listing_number)))
        .map(item => ({
          show_id: showId,
          barcode: 'RDM',
          listing_number: item.listing_number,
          scanned_by: 'phone'
        }))
      const count = toInsert.length
      if (!confirm(`Save ${count} remaining item${count !== 1 ? 's' : ''} as RDM and mark show complete?`)) return
      setSavingRdm(true)
      if (toInsert.length > 0) {
        await supabase.from(scansTable).insert(toInsert)
      }
      await supabase.from('shows')
        .update({ status: 'completed', scanned_count: scannedCount + toInsert.length })
        .eq('id', showId)
      setShowRemainingModal(false)
      setShowCompletion(true)
    } catch (err) {
      console.error('Error saving remaining as RDM:', err)
      alert('Error saving — try again')
    } finally {
      setSavingRdm(false)
      finishingShowRef.current = false
    }
  }

  // Manual Scan — whole show: tag every remaining unscanned valid item with a
  // pool barcode (RDM | UJC | custom brand), then mark the show complete. The
  // tag is what deducts the pool and resolves COGS to that pool's WAC.
  const handleApplyTagAndFinish = async (tag) => {
    if (savingCogs || finishingShowRef.current) return
    if (!poolTagOptions.some(o => o.tag === tag)) return
    finishingShowRef.current = true
    try {
      const { data: allItems } = await supabase
        .from('show_items')
        .select('listing_number')
        .eq('show_id', showId)
        .eq('status', 'valid')
      const { data: scannedData } = await supabase
        .from(scansTable)
        .select('listing_number')
        .eq('show_id', showId)
      const scannedSet = new Set((scannedData || []).map(s => String(s.listing_number)))
      const toInsert = (allItems || [])
        .filter(item => !scannedSet.has(String(item.listing_number)))
        .map(item => ({
          show_id: showId,
          barcode: tag,
          listing_number: item.listing_number,
          scanned_by: 'phone'
        }))
      const count = toInsert.length
      const msg = count === 0
        ? 'No remaining items — mark this show complete?'
        : `Tag ${count} remaining item${count !== 1 ? 's' : ''} as ${tag} and mark show complete?`
      if (!confirm(msg)) return
      setSavingCogs(true)
      if (count > 0) {
        await supabase.from(scansTable).insert(toInsert)
      }
      await supabase.from('shows')
        .update({ status: 'completed', scanned_count: scannedCount + count })
        .eq('id', showId)
      setShowCogsModal(false)
      setShowCompletion(true)
    } catch (err) {
      console.error('Error tagging remaining & finishing show:', err)
      alert('Error saving — try again')
    } finally {
      setSavingCogs(false)
      finishingShowRef.current = false
    }
  }

  // Manual Scan — single item: record one no-barcode sale tagged to a pool
  // (RDM | UJC | custom brand) for a given sticker #. Inserts a real pool scan
  // so it both logs the sale and deducts that pool. Stays open so several can be added.
  const handleManualPoolScan = async (tag) => {
    if (savingCogs) return
    if (!poolTagOptions.some(o => o.tag === tag)) { setItemCogsError('Pick a pool type'); return }
    const listingNum = parseInt(itemCogsListing, 10)
    if (!(listingNum > 0)) { setItemCogsError('Enter a valid sticker number'); return }
    setSavingCogs(true)
    setItemCogsError(null)
    setManualMsg('')
    try {
      const { data: dup } = await supabase
        .from(scansTable)
        .select('id')
        .eq('show_id', showId)
        .eq('listing_number', listingNum)
        .limit(1)
      if (dup && dup.length > 0) {
        setItemCogsError(`#${listingNum} was already scanned`)
        setSavingCogs(false)
        return
      }
      const { data: exists } = await supabase
        .from('show_items')
        .select('listing_number, product_name, status')
        .eq('show_id', showId)
        .eq('listing_number', listingNum)
        .limit(1)
      if (!exists || exists.length === 0) {
        setItemCogsError(`#${listingNum} not found in this show`)
        setSavingCogs(false)
        return
      }
      if (exists[0].status === 'failed' || exists[0].status === 'cancelled') {
        setItemCogsError(`#${listingNum} is ${exists[0].status}`)
        setSavingCogs(false)
        return
      }
      await supabase.from(scansTable).insert({
        show_id: showId,
        barcode: tag,
        listing_number: listingNum,
        scanned_by: 'phone'
      })
      await supabase.from('shows')
        .update({ scanned_count: scannedCount + 1 })
        .eq('id', showId)
      await loadScans()
      setManualMsg(`✓ #${listingNum} added as ${tag}`)
      setItemCogsListing('')
    } catch (err) {
      console.error('Error saving manual pool scan:', err)
      setItemCogsError('Save failed — check console')
    }
    setSavingCogs(false)
  }

  const handleSubmit = async (e) => {
    if (e) e.preventDefault()
    if (submitting) return

    const table = scansTable

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
        setScannerKey(prev => prev + 1)
        setSubmitting(false)
        await startScanner()
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
    await supabase.from(scansTable).delete().eq('show_id', showId).eq('listing_number', scan.listingNum)
    // Remove from local state
    setScans(prev => prev.filter((_, idx) => idx !== indexToDelete))
    // Count will auto-update via the polling interval
  }

  const handleFinish = async () => {
    await stopScanner()
    navigate('/sales')
  }

  const handleBack = async () => {
    // If in listing number entry screen, go back to the scanner
    if (scannedBarcode) {
      setScannedBarcode(null)
      setListingNumber('')
      setShowWarning(null)
      await startScanner()
    } else {
      // From scanner screen, go back to show list
      handleFinish()
    }
  }

  // Excluded items interstitial
  if (showExcludedModal) {
    return (
      <div className="h-screen flex items-center justify-center bg-navy p-6">
        <div className="fixed inset-0 pointer-events-none" />
        <div className="relative z-10 w-full max-w-md">
          <div className="bg-pink-500/10 border border-pink-500/30 rounded-3xl p-6 mb-6">
            <div className="text-center mb-4">
              <div className="text-5xl mb-3">⚠️</div>
              <h2 className="text-2xl font-bold font-heading text-pink-200">Items Removed</h2>
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
            onClick={() => { setShowExcludedModal(false) }}
            className="w-full py-4 px-8 rounded-3xl font-bold text-lg bg-cyan-600 text-white shadow-lg shadow-cyan-500/30 hover:scale-[1.02] active:scale-[0.98] transition-all"
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
          <h2 className="text-4xl font-black font-heading text-white mb-2">All Done!</h2>
          <button
            onClick={() => navigate('/sales')}
            className="px-8 py-4 bg-white/20 backdrop-blur rounded-3xl text-white font-bold text-lg hover:bg-white/30 transition-all"
          >
            Back to Shows
          </button>
        </div>
      </div>
    )
  }

  // Accent colors based on channel (Kickstart keeps its pink identity; behavior
  // is identical to Jumpstart)
  const isKickstart = showData?.channel === 'Kickstart'
  const gradientFrom = isKickstart ? 'from-fuchsia-600' : 'from-cyan-600'
  const gradientTo = isKickstart ? 'to-pink-600' : 'to-teal-600'
  const shadowColor = isKickstart ? 'shadow-fuchsia-500/30' : 'shadow-cyan-500/30'

  return (
    <div className="fixed inset-0 flex flex-col bg-navy">
      <div className="fixed inset-0 pointer-events-none" />

      {/* Header - Row 1: Back + Show Name */}
      <div className="relative z-10 bg-slate-800/80 backdrop-blur-xl px-4 pt-3 pb-1 flex items-center border-b border-white/5">
        <button onClick={handleBack} className="text-white text-2xl mr-3"><iconify-icon icon="lucide:chevron-left" class="text-white"></iconify-icon></button>
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
          <p className="text-3xl font-black text-cyan-400">{remainingCount}</p>
          <p className="text-white/50 text-xs">Remaining</p>
        </div>
      </div>

      {/* Main Content */}
      {!scannedBarcode ? (
        <div className="relative z-10 flex-1 min-h-0">
          {isHardwareScanner ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900 px-4"
              onClick={() => hardwareInputRef.current?.focus()}
            >
              <iconify-icon icon="lucide:scan-barcode" class="text-cyan-400" width="64" height="64"></iconify-icon>
              <p className="text-white font-bold text-xl mt-4 font-heading">Ready to Scan</p>
              <p className="text-slate-400 text-sm mt-1">Pull trigger to scan barcode</p>
              <input
                ref={hardwareInputRef}
                value={hardwareInput}
                onChange={e => {
                  const val = e.target.value
                  setHardwareInput(val)
                  clearTimeout(hardwareTimerRef.current)
                  hardwareTimerRef.current = setTimeout(() => {
                    const trimmed = val.trim()
                    setHardwareInput('')
                    if (trimmed.length > 5) onScanSuccessRef.current?.(trimmed)
                  }, 50)
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    clearTimeout(hardwareTimerRef.current)
                    const val = hardwareInput.trim()
                    setHardwareInput('')
                    if (val.length > 5) onScanSuccessRef.current?.(val)
                  }
                }}
                className="absolute opacity-0 w-px h-px top-0 left-0"
                autoComplete="off"
                inputMode="none"
                autoFocus
              />
            </div>
          ) : cameraError ? (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-900">
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
            <div className="absolute inset-0 overflow-hidden flex items-center justify-center bg-slate-900 px-4 py-2">
              <div
                key={scannerKey}
                id="sales-reader"
                className="w-full max-w-lg rounded-3xl overflow-hidden" style={{ maxHeight: "100%", height: "100%" }}
              ></div>
              {/* Hardware scanner input (fallback for non-Zebra devices with keyboards) */}
              <input
                ref={hardwareInputRef}
                value={hardwareInput}
                onChange={e => {
                  const val = e.target.value
                  setHardwareInput(val)
                  clearTimeout(hardwareTimerRef.current)
                  hardwareTimerRef.current = setTimeout(() => {
                    const trimmed = val.trim()
                    setHardwareInput('')
                    if (trimmed.length > 5) onScanSuccessRef.current?.(trimmed)
                  }, 50)
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    clearTimeout(hardwareTimerRef.current)
                    const val = hardwareInput.trim()
                    setHardwareInput('')
                    if (val.length > 5) onScanSuccessRef.current?.(val)
                  }
                }}
                className="absolute opacity-0 w-px h-px top-0 left-0"
                autoComplete="off"
                inputMode="none"
              />
            </div>
          )}
        </div>
      ) : showSuccess ? (
        <div className={`flex-1 flex items-center justify-center bg-gradient-to-br ${isKickstart ? 'from-fuchsia-500/95 via-pink-500/95 to-rose-500/95' : 'from-green-500/95 via-emerald-500/95 to-teal-500/95'}`}>
          <div className="text-center">
            <div className="text-9xl mb-6">✓</div>
            <h2 className="text-6xl font-black font-heading text-white">Saved!</h2>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center p-4 overflow-hidden">
          <div className="w-full max-w-md flex flex-col" style={{ maxHeight: 'calc(100vh - 180px)' }}>
            <div className={`bg-gradient-to-br ${isKickstart ? 'from-fuchsia-500/20 via-pink-500/20 to-rose-500/20 border-fuchsia-400/30' : 'from-teal-500/20 via-cyan-500/20 to-blue-500/20 border-cyan-400/30'} backdrop-blur-lg rounded-3xl p-4 mb-4 border`}>
              <p className="text-xs text-white/70 mb-1">Scanned Barcode</p>
              <p className="text-xl font-bold text-white break-all">{scannedBarcode}</p>
            </div>

            {/* Warning Message */}
            {showWarning && (
              <div className="bg-red-500/30 border-2 border-red-400 rounded-3xl p-4 mb-4 animate-pulse">
                <p className="text-white font-bold text-center text-lg">⚠️ {showWarning}</p>
              </div>
            )}

            <div className="flex-1 flex flex-col justify-between">
              <div>
                <label className="block text-base [@media(max-height:700px)]:text-sm font-semibold text-white/90 mb-2 [@media(max-height:700px)]:mb-1 text-center">
                  Yellow Sticker Number
                </label>
                <div className="text-6xl [@media(max-height:700px)]:text-4xl font-bold text-white text-center mb-4 [@media(max-height:700px)]:mb-1 flex items-center justify-center">
                  {listingNumber || '_'}
                </div>
              </div>

              <div className="grid grid-cols-5 gap-2 [@media(max-height:700px)]:gap-1.5 mb-3 [@media(max-height:700px)]:mb-2">
                {[1,2,3,4,5,6,7,8,9,0].map(num => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => {
                      setListingNumber(prev => { const next = prev + num.toString(); return String(parseInt(next, 10)); })
                      setShowWarning(null)
                    }}
                    className={`py-3 [@media(max-height:700px)]:py-1.5 text-2xl [@media(max-height:700px)]:text-xl font-semibold bg-gradient-to-br ${isKickstart ? 'from-fuchsia-500 to-pink-500 border-fuchsia-400/50 shadow-fuchsia-500/30' : 'from-teal-500 to-cyan-500 border-cyan-400/50 shadow-teal-500/30'} text-white border-2 rounded-xl hover:scale-105 transition-all shadow-xl`}
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
                  className="py-3 [@media(max-height:700px)]:py-1.5 text-xl [@media(max-height:700px)]:text-lg font-semibold bg-gradient-to-br from-amber-400 to-orange-500 text-white border-2 border-amber-400/50 rounded-xl hover:scale-105 transition-all shadow-xl shadow-amber-500/40"
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
                    setScannerKey(prev => prev + 1)
                    await startScanner()
                  }}
                  className="flex-1 py-4 [@media(max-height:700px)]:py-2.5 px-6 rounded-2xl bg-gradient-to-r from-pink-500 to-rose-500 border-2 border-pink-400/60 text-white font-bold text-lg [@media(max-height:700px)]:text-base
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
                    setScannerKey(prev => prev + 1)
                    await startScanner()
                  } : handleSubmit}
                  disabled={showWarning ? false : (!listingNumber || submitting)}
                  className={`flex-1 py-4 [@media(max-height:700px)]:py-2.5 px-6 rounded-2xl font-bold text-lg [@media(max-height:700px)]:text-base transition-all ${
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

      {/* Bottom buttons — pinned outside scanner flex so camera can't push them
          off. Manual Scan (no-barcode pool items) + Scans. */}
      {!scannedBarcode && !showSuccess && (
        <div className="relative z-10 px-4 pt-3 flex gap-2 bg-slate-900 shrink-0" style={{ paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 12px))' }}>
          <button
            onClick={async () => {
              await stopScanner()
              setCogsTab('show')
              setTagType('')
              setManualMsg('')
              setItemCogsError(null)
              setItemCogsListing('')
              setShowCogsModal(true)
            }}
            className="flex-1 py-3 rounded-2xl font-bold text-xs bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg shadow-amber-500/30 border border-amber-400/50 active:scale-[0.97] transition-all"
          >
            Manual Scan
          </button>
          <button
            onClick={() => setShowScansModal(true)}
            className="flex-1 py-3 rounded-2xl font-bold text-xs bg-cyan-600 text-white shadow-lg shadow-cyan-500/30 border border-cyan-400/50 active:scale-[0.97] transition-all"
          >
            Scans
          </button>
        </div>
      )}

      {/* Scans Modal */}
      {showScansModal && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-lg z-50 flex flex-col">
          <div className="glass-card px-6 py-4 flex items-center justify-between border-b border-white/10">
            <button
              onClick={() => setShowScansModal(false)}
              className="text-white/80 hover:text-white text-3xl transition-colors"
            >
              <iconify-icon icon="lucide:chevron-left" class="text-white"></iconify-icon>
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
                  <div key={idx} className="glass-card rounded-3xl p-4">
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
          <div className="glass-card px-6 py-4 flex items-center justify-between border-b border-white/10">
            <button
              onClick={() => setShowRemainingModal(false)}
              className="text-white/80 hover:text-white text-3xl transition-colors"
            >
              <iconify-icon icon="lucide:chevron-left" class="text-white"></iconify-icon>
            </button>
            <div
              className="text-center select-none"
              onTouchStart={(e) => {
                e.currentTarget._longPress = setTimeout(() => {
                  if (confirm(`Mark this show as complete with ${remainingItems.length} item${remainingItems.length !== 1 ? 's' : ''} remaining?`)) {
                    supabase.from('shows')
                      .update({ status: 'completed', scanned_count: scannedCount })
                      .eq('id', showId)
                      .then(() => {
                        setShowRemainingModal(false)
                        setShowCompletion(true)
                      })
                  }
                }, 1500)
              }}
              onTouchEnd={(e) => { clearTimeout(e.currentTarget._longPress) }}
              onTouchMove={(e) => { clearTimeout(e.currentTarget._longPress) }}
            >
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
                    className="bg-indigo-500/10 backdrop-blur-lg rounded-3xl p-4 border border-indigo-500/30 hover:border-indigo-400/50 transition-all cursor-pointer active:scale-[0.98]"
                    onClick={async () => {
                      setShowRemainingModal(false)
                      setListingNumber(String(item.listing_number))
                      if (!isScanning && !scannedBarcode) {
                        await startScanner()
                      }
                    }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-white font-semibold text-base leading-snug break-words">
                          {item.product_name || `Listing ${item.listing_number}`}
                        </p>
                        <p className="text-indigo-400/60 text-xs mt-1">tap to scan</p>
                      </div>
                      <span className="text-indigo-300 font-bold text-xs whitespace-nowrap bg-indigo-500/15 px-2 py-1 rounded-lg border border-indigo-500/30">
                        #{item.listing_number}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
          {remainingItems.length > 0 && (
            <div className="px-6 pb-6 pt-3 border-t border-white/[0.06]">
              <button
                onClick={handleSaveAllRemainingAsRdm}
                disabled={savingRdm}
                className="w-full py-4 rounded-2xl font-bold text-base bg-cyan-600 text-white shadow-lg shadow-cyan-600/30 glow-cyan active:scale-[0.98] hover:bg-cyan-500 transition-all disabled:opacity-50"
              >
                {savingRdm ? 'Saving...' : `Save ${remainingItems.length} Remaining as RDM`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Manual Scan modal — pool-tag no-barcode sales */}
      {showCogsModal && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-lg z-50 flex flex-col">
          <div className="glass-card px-6 py-4 flex items-center justify-between border-b border-white/10">
            <button
              onClick={() => setShowCogsModal(false)}
              className="text-white/80 hover:text-white text-3xl transition-colors"
            >
              <iconify-icon icon="lucide:chevron-left" class="text-white"></iconify-icon>
            </button>
            <div className="text-center">
              <h3 className="text-xl font-bold text-white font-heading">Manual Scan</h3>
            </div>
            <button
              onClick={() => setShowCogsModal(false)}
              className="text-white/80 hover:text-white text-3xl transition-colors"
            >
              ×
            </button>
          </div>

          {/* Tabs */}
          <div className="px-6 pt-4 bg-slate-900/50 border-b border-white/5">
            <div className="flex gap-2 max-w-md mx-auto">
              <button
                onClick={() => setCogsTab('show')}
                className={`flex-1 py-3 rounded-t-2xl font-bold text-sm transition-all ${
                  cogsTab === 'show'
                    ? 'bg-pink-500/20 text-pink-200 border-t border-x border-pink-500/30'
                    : 'bg-transparent text-white/50 hover:text-white/80'
                }`}
              >
                Whole show
              </button>
              <button
                onClick={() => setCogsTab('item')}
                className={`flex-1 py-3 rounded-t-2xl font-bold text-sm transition-all ${
                  cogsTab === 'item'
                    ? 'bg-pink-500/20 text-pink-200 border-t border-x border-pink-500/30'
                    : 'bg-transparent text-white/50 hover:text-white/80'
                }`}
              >
                Single item
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 flex items-start justify-center">
            <div className="w-full max-w-md space-y-5">

              {/* Whole show: tag all remaining items to a pool */}
              {cogsTab === 'show' && (
                <>
                  <div className="glass-card rounded-3xl p-5">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center shrink-0">
                        <iconify-icon icon="lucide:package" class="text-cyan-400" width="20"></iconify-icon>
                      </div>
                      <div className="flex-1">
                        <p className="text-white font-bold mb-1">Tag remaining items</p>
                        <p className="text-slate-400 text-sm">
                          For no-barcode items that weren't pre-scanned. Pick the pool — every remaining unscanned item is tagged, deducted from that pool, and costed at the pool's running WAC. Items already scanned by barcode keep their own cost.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-white/70 text-sm font-semibold mb-2">Item type</label>
                    <select
                      value={tagType}
                      onChange={(e) => setTagType(e.target.value)}
                      className="w-full px-4 py-4 rounded-2xl bg-white/5 border border-white/10 text-white text-lg font-bold focus:outline-none focus:border-cyan-500/50 focus:ring-4 focus:ring-cyan-500/10 transition-all"
                    >
                      <option value="">Select type…</option>
                      {poolTagOptions.map(o => (
                        <option key={o.tag} value={o.tag}>{o.label}</option>
                      ))}
                    </select>
                  </div>

                  <button
                    onClick={() => handleApplyTagAndFinish(tagType)}
                    disabled={savingCogs || !poolTagOptions.some(o => o.tag === tagType)}
                    className="w-full py-5 px-6 rounded-2xl bg-gradient-to-r from-cyan-500 to-teal-500 text-white font-black text-base hover:scale-[1.02] active:scale-[0.98] transition-all shadow-xl shadow-cyan-500/40 border-2 border-cyan-400/50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {savingCogs ? 'Applying…' : `Apply ${tagType || 'tag'} to remaining ${remainingCount} & finish show`}
                  </button>
                  <p className="text-slate-500 text-xs text-center -mt-2">
                    Tags every unscanned item to the selected pool and marks the show complete.
                  </p>
                </>
              )}

              {/* Single item: record one no-barcode pool sale */}
              {cogsTab === 'item' && (
                <>
                  <div className="glass-card rounded-3xl p-5">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center shrink-0">
                        <iconify-icon icon="lucide:tag" class="text-cyan-400" width="20"></iconify-icon>
                      </div>
                      <div className="flex-1">
                        <p className="text-white font-bold mb-1">Record one no-barcode item</p>
                        <p className="text-slate-400 text-sm">
                          Enter the yellow sticker # and pick its pool. Logs the sale, deducts that pool, and costs it at the pool's running WAC.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="block text-white/70 text-sm font-semibold mb-2">Yellow sticker #</label>
                      <input
                        type="number"
                        inputMode="numeric"
                        placeholder="e.g. 42"
                        value={itemCogsListing}
                        onChange={(e) => { setItemCogsListing(e.target.value); setItemCogsError(null); setManualMsg('') }}
                        className="w-full px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-white text-lg font-bold focus:outline-none focus:border-cyan-500/50 focus:ring-4 focus:ring-cyan-500/10 transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-white/70 text-sm font-semibold mb-2">Item type</label>
                      <select
                        value={tagType}
                        onChange={(e) => { setTagType(e.target.value); setItemCogsError(null) }}
                        className="w-full px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-white text-lg font-bold focus:outline-none focus:border-cyan-500/50 focus:ring-4 focus:ring-cyan-500/10 transition-all"
                      >
                        <option value="">Select type…</option>
                        {poolTagOptions.map(o => (
                          <option key={o.tag} value={o.tag}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {itemCogsError && (
                    <p className="text-red-400 text-sm text-center">{itemCogsError}</p>
                  )}
                  {manualMsg && (
                    <p className="text-emerald-400 text-sm text-center">{manualMsg}</p>
                  )}

                  <button
                    onClick={() => handleManualPoolScan(tagType)}
                    disabled={savingCogs || !itemCogsListing || !poolTagOptions.some(o => o.tag === tagType)}
                    className="w-full py-4 px-6 rounded-2xl bg-cyan-600 text-white font-bold hover:bg-cyan-500 active:scale-[0.98] transition-all shadow-lg shadow-cyan-600/30 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {savingCogs ? 'Saving…' : 'Add item'}
                  </button>
                </>
              )}

            </div>
          </div>
        </div>
      )}
    </div>
  )
}
