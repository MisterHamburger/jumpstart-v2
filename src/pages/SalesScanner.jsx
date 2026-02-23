import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { Html5Qrcode } from 'html5-qrcode'
import { supabase } from '../lib/supabase'

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
  const [showCompletion, setShowCompletion] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [realScannedCount, setRealScannedCount] = useState(0)
  const [showExcludedModal, setShowExcludedModal] = useState(
    (sessionState.excludedItems || []).length > 0
  )
  const [showNoBarcodeInput, setShowNoBarcodeInput] = useState(false)
  const [manualBarcode, setManualBarcode] = useState('')
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
  useEffect(() => {
    if (!showExcludedModal) {
      startScanner()
    }
    return () => { stopScanner() }
  }, [])

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
        setRealScannedCount(count || 0)
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

  // Browser back button for modal
  useEffect(() => {
    const handlePopState = () => {
      if (showScansModal) {
        setShowScansModal(false)
        window.history.pushState(null, '', window.location.pathname)
      }
    }
    if (showScansModal) {
      window.history.pushState(null, '', window.location.pathname)
      window.addEventListener('popstate', handlePopState)
    }
    return () => { window.removeEventListener('popstate', handlePopState) }
  }, [showScansModal])

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
    const prefix = showData?.channel === 'Kickstart' ? '198' : '099'
    if (!decodedText.startsWith(prefix)) return
    setScannedBarcode(decodedText)
    await stopScanner()
  }

  // No Barcode handlers
  const handleNoBarcode = async () => {
    await stopScanner()
    setShowNoBarcodeInput(true)
  }

  const handleManualSubmit = () => {
    if (!manualBarcode.trim()) return
    setScannedBarcode(manualBarcode.trim())
    setShowNoBarcodeInput(false)
    setManualBarcode('')
  }

  const handleCancelManual = async () => {
    setShowNoBarcodeInput(false)
    setManualBarcode('')
    setScannerKey(prev => prev + 1)
    await startScanner()
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

      // For Kickstart, look up the intake_id by matching UPC
      if (isKickstart) {
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

  const handleDeleteScan = (indexToDelete) => {
    if (confirm('Delete this scan?')) {
      setScans(prev => prev.filter((_, idx) => idx !== indexToDelete))
    }
  }

  const handleFinish = async () => {
    await stopScanner()
    navigate('/sales')
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
    <div className="h-screen flex flex-col bg-[#0a0f1a]">
      <div className={`fixed inset-0 bg-gradient-to-br ${isKickstart ? 'from-fuchsia-900/20 via-transparent to-pink-900/10' : 'from-cyan-900/20 via-transparent to-teal-900/10'} pointer-events-none`} />

      {/* Header - Row 1: Back + Show Name */}
      <div className="relative z-10 bg-slate-800/80 backdrop-blur-xl px-4 pt-3 pb-1 flex items-center border-b border-white/5">
        <button onClick={handleFinish} className="text-white text-2xl mr-3">←</button>
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
      {showNoBarcodeInput ? (
        /* No Barcode Manual Entry */
        <div className="relative z-10 flex-1 flex flex-col items-center justify-center p-6">
          <p className="text-white text-xl font-bold mb-2">Enter Yellow Sticker Number</p>
          <p className="text-slate-500 text-sm mb-6">Type the barcode or sticker number</p>
          <input
            type="text"
            inputMode="numeric"
            autoFocus
            value={manualBarcode}
            onChange={(e) => setManualBarcode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleManualSubmit()}
            placeholder="Sticker number..."
            className="w-full max-w-sm text-center text-3xl font-mono text-white bg-white/[0.06] border border-white/[0.1] rounded-2xl px-4 py-4 outline-none focus:border-teal-500/50 focus:ring-2 focus:ring-teal-500/20 placeholder:text-slate-600"
          />
          <div className="flex gap-3 mt-6 w-full max-w-sm">
            <button
              onClick={handleCancelManual}
              className="flex-1 py-4 rounded-2xl font-bold text-lg bg-white/[0.06] border border-white/[0.1] text-white/70 active:scale-[0.97] transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleManualSubmit}
              disabled={!manualBarcode.trim()}
              className={`flex-1 py-4 rounded-2xl font-bold text-lg transition-all active:scale-[0.97] ${
                manualBarcode.trim()
                  ? `bg-gradient-to-r ${gradientFrom} ${gradientTo} text-white shadow-lg ${shadowColor}`
                  : 'bg-white/5 border border-white/10 text-white/30 cursor-not-allowed'
              }`}
            >
              Continue
            </button>
          </div>
        </div>
      ) : !scannedBarcode ? (
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
            <div className="flex-1 flex items-center justify-center bg-slate-900 px-4">
              <div 
                key={scannerKey}
                id="sales-reader" 
                className="w-full max-w-lg rounded-3xl overflow-hidden" style={{ height: "calc(100vh - 300px)" }}
              ></div>
            </div>
          )}

          {/* Bottom buttons: No Barcode + Scans */}
          <div className="relative z-10 px-4 py-3 flex gap-3 backdrop-blur-xl">
            <button
              onClick={handleNoBarcode}
              className="flex-1 py-3 rounded-2xl font-bold text-base bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg shadow-amber-500/30 border border-amber-400/50 active:scale-[0.97] transition-all"
            >
              No Barcode
            </button>
            <button
              onClick={() => setShowScansModal(true)}
              className="flex-1 py-3 rounded-2xl font-bold text-base bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-lg shadow-violet-500/30 border border-violet-400/50 active:scale-[0.97] transition-all"
            >
              Scans
            </button>
          </div>
        </div>
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
              <p className="text-xs text-white/70 mb-1">Scanned Barcode</p>
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
                    setScannerKey(prev => prev + 1)
                    await startScanner()
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
                    setScannerKey(prev => prev + 1)
                    await startScanner()
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
    </div>
  )
}
