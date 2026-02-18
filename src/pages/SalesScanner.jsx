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
  const html5QrcodeRef = useRef(null)
  const initialScannedRef = useRef(null)

  const totalItems = showData?.totalItems || 0
  const scannedCount = realScannedCount
  const remainingCount = Math.max(0, totalItems - scannedCount)

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
    if (showExcludedModal || !showName) return

    const fetchRealCount = async () => {
      try {
        const { count } = await supabase
          .from('scans')
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
  }, [showName, showExcludedModal, showId])

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
    // Update show status
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
    if (!decodedText.startsWith('099') && !decodedText.startsWith('198')) return
    setScannedBarcode(decodedText)
    await stopScanner()
  }

  const handleSubmit = async (e) => {
    if (e) e.preventDefault()
    if (submitting) return

    // Check listing number status
    try {
      // Check for duplicate scan
      const { data: dupCheck } = await supabase
        .from('scans')
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

      // Fire-and-forget: log scan to Supabase
      supabase.from('scans').insert({
        show_id: showId,
        barcode: scannedBarcode,
        listing_number: listingNumber,
        scanned_by: 'phone'
      }).then(() => {
        // Update show progress
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
    if (confirm(`Finish session with ${scans.length} scans?`)) {
      await stopScanner()
      navigate('/sales')
    }
  }

  // Excluded items interstitial
  if (showExcludedModal) {
    return (
      <div className="h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6">
        <div className="w-full max-w-md">
          <div className="bg-amber-500/20 border-2 border-amber-500/50 rounded-3xl p-6 mb-6">
            <div className="text-center mb-4">
              <div className="text-5xl mb-3">⚠️</div>
              <h2 className="text-2xl font-bold text-amber-200">Items Removed</h2>
              <p className="text-amber-200/70 text-sm mt-1">Skip these when scanning — they failed or were cancelled</p>
            </div>
            <div className="space-y-2 mb-4">
              {excludedItems.map((item, i) => (
                <div key={i} className="bg-amber-500/20 rounded-xl p-3 flex items-center justify-between">
                  <div>
                    <span className="text-amber-100 font-bold text-lg">#{item.listingNum}</span>
                    <span className="text-amber-200/70 text-sm ml-2">{item.productName}</span>
                  </div>
                  <span className="text-amber-300/60 text-xs uppercase font-semibold">{item.status}</span>
                </div>
              ))}
            </div>
            <p className="text-center text-amber-200/60 text-sm">
              Scanning {totalItems} of {totalItems + excludedItems.length} listings
            </p>
          </div>
          <button
            onClick={() => {
              setShowExcludedModal(false)
              startScanner()
            }}
            className="w-full py-5 rounded-2xl font-bold text-xl bg-gradient-to-r from-teal-500 to-cyan-500 text-white shadow-2xl shadow-teal-500/50 hover:scale-[1.02] transition-all"
          >
            Done
          </button>
        </div>
      </div>
    )
  }

  // Completion screen
  if (showCompletion) {
    return (
      <div className="h-screen flex items-center justify-center bg-gradient-to-br from-teal-500/95 via-emerald-500/95 to-green-500/95">
        <div className="text-center p-8">
          <div className="text-9xl mb-6">🎉</div>
          <h2 className="text-6xl font-black text-white mb-4">All Done!</h2>
          <p className="text-2xl text-white/90 mb-8">
            {totalItems} of {totalItems} items scanned
          </p>
          <button
            onClick={() => navigate('/sales')}
            className="bg-white text-teal-600 px-12 py-5 rounded-full font-bold text-2xl hover:scale-105 transition-all shadow-2xl"
          >
            Back to Shows
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen overflow-hidden flex flex-col bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">

      {!scannedBarcode ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header with Progress Counter */}
          <div className="bg-slate-800 px-4 py-3 border-b border-white/5">
            <div className="flex items-center justify-between mb-2">
              <button onClick={() => navigate('/sales')} className="text-white/80 hover:text-white text-2xl transition-colors">←</button>
              <div className="text-center">
                <h2 className="text-base font-bold text-white">{showName}</h2>
              </div>
              <div className="w-8"></div>
            </div>
            
            {/* Progress Counter */}
            <div className="flex items-center justify-center gap-4 mt-2">
              <div className="text-center">
                <div className="text-3xl font-black text-teal-400">{scannedCount}</div>
                <div className="text-xs text-white/50">Scanned</div>
              </div>
              <div className="text-white/30 text-2xl">/</div>
              <div className="text-center">
                <div className="text-3xl font-black text-white">{totalItems}</div>
                <div className="text-xs text-white/50">Total</div>
              </div>
              <div className="text-white/30 text-2xl">→</div>
              <div className="text-center">
                <div className="text-3xl font-black text-amber-400">{remainingCount}</div>
                <div className="text-xs text-white/50">Remaining</div>
              </div>
            </div>
          </div>

          {/* Camera */}
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
                className="w-full max-w-lg h-full rounded-3xl overflow-hidden"
              ></div>
            </div>
          )}
          
          {/* Footer with Count + Finish */}
          <div className="bg-slate-800 px-6 py-4 flex items-center justify-between border-t border-white/5">
            <button
              onClick={() => setShowScansModal(true)}
              className="bg-white/10 backdrop-blur-lg px-6 py-3 rounded-full border border-white/20 hover:bg-white/20 transition-all"
            >
              <span className="text-white text-2xl font-bold">{scans.length}</span>
              <span className="text-white/60 text-sm ml-2">scans</span>
            </button>
            <button
              onClick={handleFinish}
              className="bg-teal-500 hover:bg-teal-600 px-8 py-3 rounded-full text-white font-bold text-lg
                         shadow-xl transition-colors"
            >
              Finish
            </button>
          </div>
        </div>
      ) : showSuccess ? (
        <div className="flex-1 flex items-center justify-center bg-gradient-to-br from-green-500/95 via-emerald-500/95 to-teal-500/95">
          <div className="text-center">
            <div className="text-9xl mb-6">✓</div>
            <h2 className="text-6xl font-black text-white">Saved!</h2>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center p-4 overflow-hidden">
          <div className="w-full max-w-md flex flex-col" style={{ maxHeight: 'calc(100vh - 120px)' }}>
            <div className="bg-gradient-to-br from-teal-500/20 via-cyan-500/20 to-blue-500/20 backdrop-blur-lg rounded-3xl p-4 mb-4 border border-cyan-400/30">
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
                      setListingNumber(prev => prev + num.toString())
                      setShowWarning(null)
                    }}
                    className="py-3 text-2xl font-semibold bg-gradient-to-br from-teal-500 to-cyan-500 text-white border-2 border-cyan-400/50 rounded-xl hover:scale-105 transition-all shadow-xl shadow-teal-500/30"
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
                      ? 'bg-gradient-to-r from-teal-500 to-cyan-500 border-2 border-cyan-400/60 text-white shadow-2xl shadow-teal-500/50 hover:scale-105'
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
              <h3 className="text-xl font-bold text-white">Scanned on This Device ({scans.length})</h3>
              <p className="text-xs text-white/50">Total scanned: {realScannedCount} items</p>
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
