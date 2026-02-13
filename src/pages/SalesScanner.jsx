import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Html5Qrcode } from 'html5-qrcode'
import { supabase } from '../lib/supabase'
import { normalizeBarcode } from '../lib/barcodes'

export default function SalesScanner() {
  const navigate = useNavigate()
  const { showId } = useParams()
  const [show, setShow] = useState(null)
  const [step, setStep] = useState('scanning') // 'scanning' | 'enter_listing' | 'success' | 'error' | 'completed'
  const [scannedBarcode, setScannedBarcode] = useState('')
  const [listingInput, setListingInput] = useState('')
  const [scannedCount, setScannedCount] = useState(0)
  const [totalItems, setTotalItems] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const scannerRef = useRef(null)
  const processingRef = useRef(false)

  // Load show data
  useEffect(() => {
    loadShow()
  }, [showId])

  // Subscribe to realtime scan count updates
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

  async function loadShow() {
    const { data } = await supabase
      .from('shows')
      .select('*')
      .eq('id', showId)
      .single()

    if (data) {
      setShow(data)
      setTotalItems(data.total_items || 0)
      setScannedCount(data.scanned_count || 0)
    }
  }

  async function refreshCount() {
    const { count } = await supabase
      .from('scans')
      .select('id', { count: 'exact', head: true })
      .eq('show_id', showId)

    setScannedCount(count || 0)

    // Check completion
    if (count >= totalItems && totalItems > 0) {
      setStep('completed')
      await supabase.from('shows').update({ status: 'completed', scanned_count: count }).eq('id', showId)
    }
  }

  const startScanner = useCallback(async () => {
    if (scannerRef.current) return
    try {
      const scanner = new Html5Qrcode('scanner-region')
      scannerRef.current = scanner
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 280, height: 150 } },
        onScanSuccess,
        () => {}
      )
    } catch (err) {
      console.error('Camera error:', err)
    }
  }, [])

  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try { await scannerRef.current.stop() } catch (e) {}
      scannerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (step === 'scanning') startScanner()
    return () => { stopScanner() }
  }, [step])

  async function onScanSuccess(decodedText) {
    if (processingRef.current) return
    processingRef.current = true

    const barcode = normalizeBarcode(decodedText)

    // Filter out non-liquidator barcodes (211... SKU codes)
    if (!barcode.startsWith('99')) {
      processingRef.current = false
      return
    }

    setScannedBarcode(barcode)
    setListingInput('')
    await stopScanner()
    setStep('enter_listing')
    processingRef.current = false
  }

  async function submitListing() {
    const listing = parseInt(listingInput, 10)
    if (!listing || listing < 1) {
      setErrorMsg('Enter a valid listing number')
      return
    }

    // Check if listing exists in this show's items
    const { data: showItem } = await supabase
      .from('show_items')
      .select('id, status, buyer_paid')
      .eq('show_id', showId)
      .eq('listing_number', listing)
      .maybeSingle()

    if (!showItem) {
      setErrorMsg(`Listing #${listing} not found in this show`)
      return
    }

    if (showItem.status === 'failed' || showItem.status === 'cancelled') {
      setErrorMsg(`Listing #${listing} is ${showItem.status}`)
      return
    }

    // Check if already scanned
    const { data: existingScan } = await supabase
      .from('scans')
      .select('id')
      .eq('show_id', showId)
      .eq('listing_number', listing)
      .maybeSingle()

    if (existingScan) {
      setErrorMsg(`Listing #${listing} already scanned`)
      return
    }

    // Log the scan
    const { error } = await supabase.from('scans').insert({
      show_id: parseInt(showId),
      barcode: scannedBarcode,
      listing_number: listing,
      scanned_by: 'phone'
    })

    if (error) {
      setErrorMsg(`Save failed: ${error.message}`)
      return
    }

    // Update show progress
    const newCount = scannedCount + 1
    setScannedCount(newCount)
    supabase.from('shows').update({
      scanned_count: newCount,
      status: newCount >= totalItems ? 'completed' : 'scanning'
    }).eq('id', showId)

    // Flash success
    setErrorMsg('')
    setStep('success')
    setTimeout(() => {
      if (newCount >= totalItems) {
        setStep('completed')
      } else {
        setStep('scanning')
      }
    }, 500)
  }

  function handleNumpad(val) {
    if (val === 'DEL') {
      setListingInput(prev => prev.slice(0, -1))
    } else if (val === 'GO') {
      submitListing()
    } else {
      setListingInput(prev => prev + val)
    }
    setErrorMsg('')
  }

  const remaining = totalItems - scannedCount

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-800">
        <button onClick={() => { stopScanner(); navigate('/sales') }} className="text-slate-400 hover:text-white">
          ←
        </button>
        <span className="font-bold text-sm truncate mx-2">{show?.name || 'Loading...'}</span>
        <div className="flex items-center gap-2">
          <span className="text-green-400 font-bold">{scannedCount}</span>
          <span className="text-slate-500">/</span>
          <span className="font-bold">{totalItems}</span>
          <span className="text-slate-500">→</span>
          <span className="font-bold">{remaining}</span>
        </div>
      </div>

      {step === 'scanning' && (
        <div className="flex-1 flex flex-col items-center justify-center px-4">
          <h3 className="text-lg font-bold mb-1">Scan Item Barcode</h3>
          <p className="text-slate-400 text-sm mb-4">Position barcode in the frame</p>
          <div id="scanner-region" className="w-full max-w-sm rounded-xl overflow-hidden" />
        </div>
      )}

      {step === 'enter_listing' && (
        <div className="flex-1 flex flex-col px-4 py-6">
          <div className="text-center mb-4">
            <div className="text-sm text-slate-400">Scanned barcode</div>
            <div className="text-xs text-slate-500 font-mono">{scannedBarcode}</div>
          </div>

          <div className="text-center mb-6">
            <div className="text-lg font-bold mb-2">Enter Yellow Sticker #</div>
            <div className="text-5xl font-black h-16 flex items-center justify-center">
              {listingInput || <span className="text-slate-600">—</span>}
            </div>
            {errorMsg && (
              <div className="text-red-400 text-sm mt-2">{errorMsg}</div>
            )}
          </div>

          {/* Numpad */}
          <div className="grid grid-cols-3 gap-2 max-w-xs mx-auto w-full">
            {[1,2,3,4,5,6,7,8,9].map(n => (
              <button key={n} onClick={() => handleNumpad(String(n))}
                className="bg-slate-700 rounded-xl py-4 text-2xl font-bold active:bg-slate-600 transition-colors">
                {n}
              </button>
            ))}
            <button onClick={() => handleNumpad('DEL')}
              className="bg-slate-800 rounded-xl py-4 text-lg font-bold text-red-400 active:bg-slate-700">
              DEL
            </button>
            <button onClick={() => handleNumpad('0')}
              className="bg-slate-700 rounded-xl py-4 text-2xl font-bold active:bg-slate-600">
              0
            </button>
            <button onClick={() => handleNumpad('GO')}
              className="bg-green-600 rounded-xl py-4 text-lg font-bold active:bg-green-500">
              GO ✓
            </button>
          </div>
        </div>
      )}

      {step === 'success' && (
        <div className="flex-1 flex items-center justify-center bg-green-600 zone-flash">
          <div className="text-4xl font-black">✓ SAVED</div>
        </div>
      )}

      {step === 'completed' && (
        <div className="flex-1 flex flex-col items-center justify-center bg-gradient-to-b from-green-600 to-emerald-800">
          <div className="text-5xl mb-4">🎉</div>
          <div className="text-4xl font-black mb-2">ALL DONE</div>
          <div className="text-xl text-white/80">{scannedCount} items scanned</div>
          <button
            onClick={() => navigate('/sales')}
            className="mt-8 px-8 py-3 bg-white text-slate-900 rounded-full font-bold"
          >
            Back to Shows
          </button>
        </div>
      )}
    </div>
  )
}
