import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Html5Qrcode } from 'html5-qrcode'
import { supabase } from '../lib/supabase'
import { normalizeBarcode } from '../lib/barcodes'

export default function BundleSort() {
  const navigate = useNavigate()
  const [scanning, setScanning] = useState(false)
  const [result, setResult] = useState(null)
  const [scanCount, setScanCount] = useState(0)
  const scannerRef = useRef(null)
  const processingRef = useRef(false)

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
      setScanning(true)
    } catch (err) {
      console.error('Camera error:', err)
    }
  }, [])

  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try { await scannerRef.current.stop() } catch (e) {}
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
    if (!barcode) { processingRef.current = false; return }

    const { data } = await supabase
      .from('items')
      .select('zone, bundle_number, description')
      .eq('barcode', barcode)
      .limit(1)
      .maybeSingle()

    if (data && data.zone === 3 && data.bundle_number) {
      setResult({ type: 'bundle', bundle_number: data.bundle_number, description: data.description })
    } else if (data) {
      setResult({ type: 'wrong_zone', zone: data.zone, description: data.description })
    } else {
      setResult({ type: 'notfound', barcode: decodedText })
    }

    setScanCount(c => c + 1)

    // Log to sort_log
    if (data) {
      supabase.from('sort_log').insert({
        barcode,
        zone: data.zone,
        bundle_number: data.bundle_number,
        sort_type: 'bundle'
      })
    }

    await stopScanner()
    processingRef.current = false
  }

  function handleNextScan() {
    setResult(null)
    startScanner()
  }

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 bg-slate-800">
        <button onClick={() => { stopScanner(); navigate('/sorting') }} className="text-slate-400 hover:text-white">
          ← Home
        </button>
        <span className="font-bold">Bundle Sort</span>
        <span className="text-sm text-slate-400">{scanCount} scanned</span>
      </div>

      {result ? (
        <div className={`flex-1 flex flex-col items-center justify-center zone-flash ${
          result.type === 'bundle' ? 'bg-gradient-to-b from-pink-600 to-rose-800' :
          result.type === 'wrong_zone' ? 'bg-gradient-to-b from-amber-600 to-orange-800' :
          'bg-gradient-to-b from-red-600 to-red-900'
        }`}>
          {result.type === 'bundle' ? (
            <>
              <div className="text-3xl font-bold text-white/70 mb-2">BUNDLE</div>
              <div className="text-8xl font-black">BOX {result.bundle_number}</div>
            </>
          ) : result.type === 'wrong_zone' ? (
            <>
              <div className="text-4xl font-black">NOT A BUNDLE</div>
              <div className="text-2xl mt-2 text-white/80">Zone {result.zone}</div>
            </>
          ) : (
            <>
              <div className="text-4xl font-black">NOT FOUND</div>
              <div className="text-sm mt-2 text-white/60">{result.barcode}</div>
            </>
          )}
          {result.description && (
            <div className="text-sm text-white/60 mt-4 px-8 text-center">{result.description}</div>
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
        <div className="flex-1 flex flex-col items-center justify-center px-4">
          <h3 className="text-lg font-bold mb-1">Scan Bundle Item</h3>
          <p className="text-slate-400 text-sm mb-4">Position barcode in the frame</p>
          <div id="scanner-region" className="w-full max-w-sm rounded-xl overflow-hidden" />
        </div>
      )}
    </div>
  )
}
