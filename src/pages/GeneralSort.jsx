import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Html5Qrcode } from 'html5-qrcode'
import { supabase } from '../lib/supabase'
import { normalizeBarcode } from '../lib/barcodes'

const ZONE_CONFIG = {
  1: { label: 'ZONE 1', sub: 'Premium Items', bg: 'bg-purple-600', color: 'from-purple-600 to-purple-800' },
  2: { label: 'ZONE 2', sub: 'Standard Items', bg: 'bg-teal-500', color: 'from-teal-500 to-cyan-600' },
  3: { label: 'ZONE 3', sub: 'Bundle', bg: 'bg-pink-600', color: 'from-pink-600 to-rose-700' },
  notfound: { label: 'NOT FOUND', sub: 'Item not in manifest', bg: 'bg-red-600', color: 'from-red-600 to-red-800' },
}

export default function GeneralSort() {
  const navigate = useNavigate()
  const [scanning, setScanning] = useState(false)
  const [result, setResult] = useState(null) // { zone, bundle_number, description }
  const [scanCount, setScanCount] = useState(0)
  const [totalItems, setTotalItems] = useState(0)
  const scannerRef = useRef(null)
  const processingRef = useRef(false)

  // Get total item count on mount
  useEffect(() => {
    supabase.from('items').select('id', { count: 'exact', head: true })
      .then(({ count }) => setTotalItems(count || 0))
  }, [])

  const startScanner = useCallback(async () => {
    if (scannerRef.current) return
    try {
      const scanner = new Html5Qrcode('scanner-region')
      scannerRef.current = scanner
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 280, height: 150 } },
        onScanSuccess,
        () => {} // ignore scan failures
      )
      setScanning(true)
    } catch (err) {
      console.error('Camera error:', err)
    }
  }, [])

  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop()
      } catch (e) { /* already stopped */ }
      scannerRef.current = null
    }
    setScanning(false)
  }, [])

  useEffect(() => {
    startScanner()
    return () => { stopScanner() }
  }, [])

  async function onScanSuccess(decodedText) {
    if (processingRef.current) return
    processingRef.current = true

    const barcode = normalizeBarcode(decodedText)
    if (!barcode) {
      processingRef.current = false
      return
    }

    // Look up in items table
    const { data, error } = await supabase
      .from('items')
      .select('zone, bundle_number, description, category, msrp')
      .eq('barcode', barcode)
      .limit(1)
      .maybeSingle()

    if (data) {
      setResult({
        zone: data.zone,
        bundle_number: data.bundle_number,
        description: data.description,
        category: data.category,
        msrp: data.msrp
      })
      // Log to sort_log (fire-and-forget)
      supabase.from('sort_log').insert({
        barcode,
        zone: data.zone,
        bundle_number: data.bundle_number,
        sort_type: 'general'
      })
    } else {
      setResult({ zone: 'notfound', description: `Barcode: ${decodedText}` })
    }

    setScanCount(c => c + 1)

    // Pause scanner while showing result
    await stopScanner()
    processingRef.current = false
  }

  function handleNextScan() {
    setResult(null)
    startScanner()
  }

  const zoneKey = result ? (result.zone || 'notfound') : null
  const config = zoneKey ? ZONE_CONFIG[zoneKey] || ZONE_CONFIG.notfound : null

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-800">
        <button onClick={() => { stopScanner(); navigate('/sorting') }} className="text-slate-400 hover:text-white">
          ← Home
        </button>
        <span className="font-bold">General Sort</span>
        <span className="text-sm text-slate-400">{scanCount} / {totalItems}</span>
      </div>

      {result ? (
        /* Result screen */
        <div className={`flex-1 flex flex-col items-center justify-center bg-gradient-to-b ${config.color} zone-flash`}>
          <div className="text-6xl font-black mb-2">{config.label}</div>
          <div className="text-xl text-white/80 mb-2">{config.sub}</div>
          {result.bundle_number && (
            <div className="text-4xl font-bold mt-2">BOX {result.bundle_number}</div>
          )}
          {result.description && (
            <div className="text-sm text-white/60 mt-4 px-8 text-center">{result.description}</div>
          )}
          {result.msrp && (
            <div className="text-sm text-white/60 mt-1">MSRP: ${Number(result.msrp).toFixed(2)}</div>
          )}
          <button
            onClick={handleNextScan}
            className="mt-10 px-12 py-4 bg-white text-slate-900 rounded-full text-lg font-bold
              active:scale-95 transition-transform"
          >
            Next Scan
          </button>
        </div>
      ) : (
        /* Scanner view */
        <div className="flex-1 flex flex-col items-center justify-center px-4">
          <h3 className="text-lg font-bold mb-1">Scan Item Barcode</h3>
          <p className="text-slate-400 text-sm mb-4">Position barcode in the frame</p>
          <div id="scanner-region" className="w-full max-w-sm rounded-xl overflow-hidden" />
        </div>
      )}
    </div>
  )
}
