import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Html5Qrcode } from 'html5-qrcode'
import { supabase } from '../lib/supabase'
import { normalizeBarcode } from '../lib/barcodes'

export default function ItemLookup() {
  const navigate = useNavigate()
  const [result, setResult] = useState(null)
  const [notFound, setNotFound] = useState(false)
  const [scanning, setScanning] = useState(true)
  const [lastBarcode, setLastBarcode] = useState('')
  const scannerRef = useRef(null)

  useEffect(() => {
    startScanner()
    return () => stopScanner()
  }, [])

  const startScanner = async () => {
    setScanning(true)
    try {
      await new Promise(r => setTimeout(r, 200))
      const scanner = new Html5Qrcode('lookup-reader')
      scannerRef.current = scanner
      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 60,
          disableFlip: true,
          experimentalFeatures: { useBarCodeDetectorIfSupported: true }
        },
        (decodedText) => {
          if (decodedText.length >= 8 && /^\d+$/.test(decodedText)) {
            handleScan(decodedText)
          }
        },
        () => {}
      )
    } catch (err) {
      console.error('Scanner error:', err)
    }
  }

  const stopScanner = async () => {
    if (scannerRef.current) {
      try { await scannerRef.current.stop() } catch (e) {}
      scannerRef.current = null
    }
    setScanning(false)
  }

  const handleScan = async (rawBarcode) => {
    const barcode = normalizeBarcode(rawBarcode)
    if (barcode === lastBarcode) return
    setLastBarcode(barcode)

    const { data } = await supabase
      .from('jumpstart_manifest')
      .select('barcode, description, category, color, size, msrp, cost_freight, zone, vendor')
      .eq('barcode', barcode)
      .limit(1)

    if (data && data.length > 0) {
      setResult(data[0])
      setNotFound(false)
    } else {
      setResult(null)
      setNotFound(true)
    }
  }

  const handleScanAgain = () => {
    setResult(null)
    setNotFound(false)
    setLastBarcode('')
  }

  const zoneLabel = (z) => {
    if (!z) return null
    const zl = String(z).toLowerCase().trim()
    if (zl === '1' || zl === 'zone 1') return { label: 'Zone 1', bg: 'bg-purple-600' }
    if (zl === 'zone 1 pants') return { label: 'Z1 Pants', bg: 'bg-amber-600' }
    if (zl === '2' || zl === 'zone 2') return { label: 'Zone 2', bg: 'bg-teal-600' }
    if (zl === 'zone 2 pants') return { label: 'Z2 Pants', bg: 'bg-pink-600' }
    return { label: z, bg: 'bg-slate-600' }
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-[#0a0f1a]">
      <div className="fixed inset-0 bg-gradient-to-br from-cyan-900/20 via-transparent to-purple-900/10 pointer-events-none" />

      {/* Header */}
      <div className="relative z-10 px-3 py-2 flex items-center justify-between border-b border-white/10 shrink-0">
        <button
          onClick={() => navigate('/')}
          className="bg-white/10 hover:bg-white/20 backdrop-blur-lg px-3 py-1.5 rounded-full border border-white/20 text-white font-semibold text-sm"
        >
          ← Home
        </button>
        <h1 className="text-lg font-bold text-white">Item Lookup</h1>
        <div className="w-16" />
      </div>

      {/* Scanner */}
      <div className="flex-1 min-h-0 flex flex-col relative z-10">
        <div className="flex-1 min-h-0 flex items-center justify-center bg-slate-900 px-4 py-2">
          <div id="lookup-reader" className="w-full max-w-lg rounded-3xl overflow-hidden" style={{ maxHeight: '100%' }} />
        </div>

        {/* Result Card */}
        <div className="shrink-0 px-4 pb-4 pt-2">
          {result && (
            <div className="rounded-2xl bg-gradient-to-b from-slate-800/80 to-slate-900/60 border border-white/10 p-5 backdrop-blur-xl">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 mr-3">
                  <h3 className="text-white font-bold text-lg leading-tight">{result.description || 'No description'}</h3>
                  <p className="text-slate-400 text-sm mt-0.5">{result.category || ''} {result.color ? `· ${result.color}` : ''} {result.size ? `· ${result.size}` : ''}</p>
                </div>
                {result.zone && (() => {
                  const z = zoneLabel(result.zone)
                  return z ? <span className={`${z.bg} text-white text-sm font-bold px-3 py-1.5 rounded-xl`}>{z.label}</span> : null
                })()}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-white/5 p-3 text-center">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">MSRP</div>
                  <div className="text-2xl font-black text-emerald-400">${Number(result.msrp || 0).toFixed(2)}</div>
                </div>
                <div className="rounded-xl bg-white/5 p-3 text-center">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Our Cost</div>
                  <div className="text-2xl font-black text-cyan-400">${Number(result.cost_freight || 0).toFixed(2)}</div>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                <span>{result.vendor || ''}</span>
                <span className="font-mono">{result.barcode}</span>
              </div>
            </div>
          )}

          {notFound && (
            <div className="rounded-2xl bg-red-500/10 border border-red-500/20 p-5 text-center">
              <p className="text-red-400 font-bold text-lg mb-1">Not Found</p>
              <p className="text-slate-400 text-sm">Barcode not in manifest. Try another item.</p>
            </div>
          )}

          {!result && !notFound && (
            <div className="text-center py-3">
              <p className="text-slate-500 text-sm">Scan a barcode to look up item details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
