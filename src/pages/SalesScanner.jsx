import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'
import { supabase } from '../lib/supabase'
import { normalizeBarcode } from '../lib/barcodes'

function formatShowLabel(show) {
  if (!show?.date) return show?.name || ''
  const d = new Date(show.date + 'T12:00:00')
  const m = d.getMonth() + 1
  const day = d.getDate()
  const time = show.time_of_day === 'morning' ? 'Morning' : 'Evening'
  return `${m}/${day} ${show.channel} ${time}`
}

export default function SalesScanner() {
  const navigate = useNavigate()
  const { showId } = useParams()

  // State
  const [show, setShow] = useState(null)
  const [step, setStep] = useState('loading') // loading | excluded | scanning | enter_listing | saving | success | error | completed
  const [excludedItems, setExcludedItems] = useState([])
  const [scannedBarcode, setScannedBarcode] = useState('')
  const [listingInput, setListingInput] = useState('')
  const [scannedCount, setScannedCount] = useState(0)
  const [totalItems, setTotalItems] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const [localScans, setLocalScans] = useState([])

  // Refs
  const scannerRef = useRef(null)
  const processingRef = useRef(false)
  const scannerContainerId = 'sales-qr-reader'

  // ── Load show + check for excluded items ──────────────────
  useEffect(() => {
    loadShow()
  }, [showId])

  async function loadShow() {
    // Get show
    const { data: showData } = await supabase
      .from('shows').select('*').eq('id', showId).single()
    if (!showData) { navigate('/sales'); return }
    setShow(showData)

    // Check for failed/cancelled items
    const { data: excluded } = await supabase
      .from('show_items').select('listing_number, product_name, status, buyer_paid')
      .eq('show_id', showId)
      .in('status', ['failed', 'cancelled'])
      .order('listing_number')

    // Scannable total = total items minus failed/cancelled
    const excludedCount = excluded?.length || 0
    setTotalItems((showData.total_items || 0) - excludedCount)

    // Get current scan count
    const { count } = await supabase
      .from('scans').select('id', { count: 'exact', head: true }).eq('show_id', showId)
    setScannedCount(count || 0)

    if (excluded && excluded.length > 0) {
      setExcludedItems(excluded)
      setStep('excluded')
    } else {
      setStep('scanning')
    }
  }

  // ── Realtime subscription for multi-device count ──────────
  useEffect(() => {
    if (!showId) return
    const channel = supabase
      .channel(`scans-${showId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'scans', filter: `show_id=eq.${showId}` },
        () => { refreshCount() }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [showId])

  async function refreshCount() {
    const { count } = await supabase
      .from('scans').select('id', { count: 'exact', head: true }).eq('show_id', showId)
    setScannedCount(count || 0)
  }

  // ── Camera start/stop ─────────────────────────────────────
  const startScanner = useCallback(async () => {
    if (scannerRef.current) return
    // Small delay for DOM to be ready
    await new Promise(r => setTimeout(r, 300))
    const el = document.getElementById(scannerContainerId)
    if (!el) return
    try {
      const scanner = new Html5Qrcode(scannerContainerId, {
        formatsToSupport: [
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.EAN_13
        ],
        useBarCodeDetectorIfSupported: true
      })
      scannerRef.current = scanner
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 60, disableFlip: true },
        onScanSuccess,
        () => {}
      )
    } catch (err) {
      console.error('Camera error:', err)
    }
  }, [showId])

  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try { await scannerRef.current.stop() } catch (e) {}
      scannerRef.current = null
    }
  }, [])

  // Start camera when entering scanning step
  useEffect(() => {
    if (step === 'scanning') {
      startScanner()
    }
    return () => {
      if (step === 'scanning') stopScanner()
    }
  }, [step])

  // Cleanup on unmount
  useEffect(() => {
    return () => { stopScanner() }
  }, [])

  // ── Scan handler ──────────────────────────────────────────
  function onScanSuccess(decodedText) {
    if (processingRef.current) return
    const barcode = normalizeBarcode(decodedText)

    // Filter: only accept 099... liquidator barcodes
    if (!barcode.startsWith('099') && !barcode.startsWith('99')) return

    processingRef.current = true
    setScannedBarcode(barcode)
    setListingInput('')
    setErrorMsg('')

    // Stop camera, show number pad
    stopScanner().then(() => {
      setStep('enter_listing')
      processingRef.current = false
    })
  }

  // ── Submit listing number ─────────────────────────────────
  async function submitListing() {
    const listing = parseInt(listingInput, 10)
    if (!listing || listing < 1) {
      setErrorMsg('Enter a valid listing number')
      return
    }

    // Check if listing already scanned for this show (duplicate listing NOT allowed)
    const { data: existingScan } = await supabase
      .from('scans').select('id').eq('show_id', parseInt(showId)).eq('listing_number', listing).maybeSingle()

    if (existingScan) {
      setErrorMsg(`Listing #${listing} already scanned for this show`)
      return
    }

    // Check if listing exists and is valid in show_items
    const { data: showItem } = await supabase
      .from('show_items').select('id, status').eq('show_id', parseInt(showId)).eq('listing_number', listing).maybeSingle()

    if (showItem && (showItem.status === 'failed' || showItem.status === 'cancelled')) {
      setErrorMsg(`Listing #${listing} is ${showItem.status} — pull this item`)
      return
    }

    // Save scan
    setStep('saving')
    const { error } = await supabase.from('scans').insert({
      show_id: parseInt(showId),
      barcode: scannedBarcode,
      listing_number: listing,
      scanned_by: 'phone'
    })

    if (error) {
      setErrorMsg(`Save failed: ${error.message}`)
      setStep('enter_listing')
      return
    }

    // Update local state
    const newCount = scannedCount + 1
    setScannedCount(newCount)
    setLocalScans(prev => [...prev, { barcode: scannedBarcode, listing: listing }])

    // Update show progress (fire and forget)
    supabase.from('shows').update({
      scanned_count: newCount,
      status: newCount >= totalItems ? 'completed' : 'scanning'
    }).eq('id', parseInt(showId))

    // Flash success then back to scanning
    setStep('success')
    setTimeout(() => {
      if (newCount >= totalItems && totalItems > 0) {
        setStep('completed')
      } else {
        setStep('scanning')
      }
    }, 500)
  }

  // ── Number pad handler ────────────────────────────────────
  function handleNumpad(val) {
    setErrorMsg('')
    if (val === 'back') {
      setListingInput(prev => prev.slice(0, -1))
    } else {
      setListingInput(prev => prev + val)
    }
  }

  function handleCancel() {
    setScannedBarcode('')
    setListingInput('')
    setErrorMsg('')
    setStep('scanning')
  }

  function handleNextScan() {
    submitListing()
  }

  // ── Derived ───────────────────────────────────────────────
  const remaining = totalItems - scannedCount

  // ── RENDER ────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex flex-col">

      {/* ── Header ─────────────────────────────────── */}
      {step !== 'success' && step !== 'completed' && (
        <div className="backdrop-blur-xl bg-white/5 border-b border-white/10 px-4 py-3 flex items-center justify-between">
          <button onClick={() => { stopScanner(); navigate('/sales') }}
            className="w-10 h-10 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-white hover:bg-white/20 active:scale-[0.98] transition-all">
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 10H5M5 10l5-5M5 10l5 5"/></svg>
          </button>
          <span className="font-bold text-sm text-white truncate mx-3">{formatShowLabel(show)}</span>
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-cyan-300">{scannedCount}</span>
            <span className="text-slate-500">/</span>
            <span className="font-bold text-white">{totalItems}</span>
            {remaining > 0 && (
              <>
                <span className="text-slate-600 mx-1">·</span>
                <span className="font-bold text-amber-400">{remaining}</span>
                <span className="text-xs text-slate-500">left</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Loading ────────────────────────────────── */}
      {step === 'loading' && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-slate-400">Loading show...</div>
        </div>
      )}

      {/* ── Excluded Items Interstitial ────────────── */}
      {step === 'excluded' && (
        <div className="flex-1 flex flex-col px-4 py-6">
          <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-amber-500/30 p-5 mb-6">
            <div className="flex items-center gap-2 mb-3">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-amber-400">
                <path d="M10 2L1 18h18L10 2z" stroke="currentColor" strokeWidth="1.5" fill="none"/>
                <path d="M10 8v4M10 14v1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              <h2 className="text-lg font-bold text-amber-400">Pull These Items</h2>
            </div>
            <p className="text-sm text-slate-400 mb-4">
              {excludedItems.length} listing{excludedItems.length !== 1 ? 's' : ''} had failed payments or were cancelled.
              Remove them from the packing area before scanning.
              Your scan target is <span className="font-bold text-cyan-300">{totalItems}</span> items.
            </p>
            <div className="space-y-2 max-h-[50vh] overflow-y-auto">
              {excludedItems.map(item => (
                <div key={item.listing_number}
                  className="flex items-center justify-between py-2 px-3 rounded-xl bg-red-500/10 border border-red-500/20">
                  <div>
                    <span className="font-bold text-white">#{item.listing_number}</span>
                    <span className="text-slate-400 text-sm ml-2 truncate">{item.product_name}</span>
                  </div>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    item.status === 'failed' ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'
                  }`}>
                    {item.status}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <button onClick={() => setStep('scanning')}
            className="w-full py-4 rounded-full font-bold text-lg text-white
              bg-gradient-to-r from-cyan-500 to-blue-600 shadow-xl shadow-cyan-500/25
              active:scale-[0.98] transition-all">
            Done — Start Scanning
          </button>
        </div>
      )}

      {/* ── Camera Scanning ────────────────────────── */}
      {step === 'scanning' && (
        <div className="flex-1 flex flex-col items-center justify-center px-4">
          <h3 className="text-lg font-bold tracking-tight text-white mb-1">Scan Item Barcode</h3>
          <p className="text-slate-400 text-sm mb-4">Position barcode in the camera frame</p>
          <div className="w-full max-w-sm">
            <div id={scannerContainerId}
              className="rounded-3xl overflow-hidden border-2 border-purple-400/30" />
          </div>
        </div>
      )}

      {/* ── Enter Listing Number ───────────────────── */}
      {step === 'enter_listing' && (
        <div className="flex-1 flex flex-col px-4 py-4 overflow-hidden">
          {/* Scanned barcode display */}
          <div className="backdrop-blur-xl bg-white/5 rounded-2xl border border-white/10 p-4 mb-4">
            <div className="text-xs uppercase tracking-wider font-semibold text-slate-500 mb-1">Scanned Barcode</div>
            <div className="font-mono font-medium text-lg text-white">{scannedBarcode}</div>
          </div>

          {/* Listing number display */}
          <div className="text-center mb-4">
            <div className="text-lg font-bold tracking-tight text-white mb-2">Yellow Sticker Number</div>
            <div className="text-6xl font-black text-white h-20 flex items-center justify-center">
              {listingInput || <span className="text-slate-600">—</span>}
            </div>
            {errorMsg && (
              <div className="mt-2 px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/20">
                <span className="text-red-400 text-sm font-medium">{errorMsg}</span>
              </div>
            )}
          </div>

          {/* 5-column Number Pad */}
          <div className="grid grid-cols-5 gap-2 max-w-sm mx-auto w-full mb-4">
            {[1,2,3,4,5].map(n => (
              <button key={n} onClick={() => handleNumpad(String(n))}
                className="bg-white/10 border border-white/20 backdrop-blur-lg rounded-xl py-4 text-2xl font-bold text-white active:bg-white/20 active:scale-[0.98] transition-all">
                {n}
              </button>
            ))}
            {[6,7,8,9,0].map(n => (
              <button key={n} onClick={() => handleNumpad(String(n))}
                className="bg-white/10 border border-white/20 backdrop-blur-lg rounded-xl py-4 text-2xl font-bold text-white active:bg-white/20 active:scale-[0.98] transition-all">
                {n}
              </button>
            ))}
          </div>

          {/* Backspace */}
          <div className="max-w-sm mx-auto w-full mb-4">
            <button onClick={() => handleNumpad('back')}
              className="bg-gradient-to-r from-amber-500 to-orange-600 shadow-lg shadow-amber-500/25 rounded-xl w-14 h-14 flex items-center justify-center active:scale-[0.98] transition-all">
              <svg width="24" height="24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M19 12H5M5 12l5-5M5 12l5 5"/></svg>
            </button>
          </div>

          {/* Cancel / Next Scan buttons */}
          <div className="grid grid-cols-2 gap-3 max-w-sm mx-auto w-full mt-auto">
            <button onClick={handleCancel}
              className="py-4 rounded-full font-bold text-lg text-red-400 bg-red-500/10 border border-red-500/20 active:scale-[0.98] transition-all">
              Cancel
            </button>
            <button onClick={handleNextScan} disabled={!listingInput}
              className={`py-4 rounded-full font-bold text-lg transition-all active:scale-[0.98]
                ${listingInput
                  ? 'text-white bg-gradient-to-r from-teal-500/90 via-cyan-500/90 to-blue-500/90 shadow-xl shadow-teal-500/30'
                  : 'text-slate-600 bg-white/5 border border-white/10'}`}>
              Next Scan
            </button>
          </div>
        </div>
      )}

      {/* ── Saving ─────────────────────────────────── */}
      {step === 'saving' && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-slate-400 text-lg">Saving...</div>
        </div>
      )}

      {/* ── Success Flash ──────────────────────────── */}
      {step === 'success' && (
        <div className="flex-1 flex items-center justify-center bg-gradient-to-br from-emerald-500 via-green-500 to-teal-500">
          <div className="text-center">
            <div className="text-6xl font-black text-white mb-2">SAVED</div>
            <div className="text-xl text-white/80">{scannedCount} / {totalItems}</div>
          </div>
        </div>
      )}

      {/* ── Completed ──────────────────────────────── */}
      {step === 'completed' && (
        <div className="flex-1 flex flex-col items-center justify-center bg-gradient-to-br from-emerald-500 via-green-500 to-teal-500 px-6">
          <div className="text-6xl font-black text-white mb-2">ALL DONE</div>
          <div className="text-2xl text-white/80 mb-8">{scannedCount} items scanned</div>
          <button onClick={() => navigate('/sales')}
            className="px-10 py-4 bg-white/95 text-gray-900 font-bold text-xl rounded-full shadow-2xl active:scale-[0.98] transition-all">
            Back to Shows
          </button>
        </div>
      )}
    </div>
  )
}
