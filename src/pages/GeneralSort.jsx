import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Html5Qrcode } from 'html5-qrcode'
import { supabase } from '../lib/supabase'
import { normalizeBarcode } from '../lib/barcodes'

export default function GeneralSort() {
  const navigate = useNavigate()
  const [scannedItem, setScannedItem] = useState(null)
  const [isScanning, setIsScanning] = useState(false)
  const [cameraError, setCameraError] = useState(null)
  const html5QrcodeRef = useRef(null)
  const processingRef = useRef(false)

  useEffect(() => {
    startScanner()
    return () => { stopScanner() }
  }, [])

  const startScanner = async () => {
    try {
      if (html5QrcodeRef.current && isScanning) {
        await html5QrcodeRef.current.stop()
        html5QrcodeRef.current = null
        setIsScanning(false)
      }
      
      await new Promise(resolve => setTimeout(resolve, 200))
      
      const html5QrCode = new Html5Qrcode("qr-reader")
      html5QrcodeRef.current = html5QrCode
      
      await html5QrCode.start(
        { facingMode: "environment" },
        { 
          fps: 60,
          disableFlip: true,
          experimentalFeatures: { useBarCodeDetectorIfSupported: true }
        },
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
    if (processingRef.current) return
    if (!decodedText.startsWith('099')) return
    processingRef.current = true

    const barcode = normalizeBarcode(decodedText)
    if (!barcode) {
      processingRef.current = false
      return
    }

    try {
      const { data } = await supabase
        .from('jumpstart_manifest')
        .select('zone, bundle_number, description, category, msrp, vendor')
        .eq('barcode', barcode)
        .limit(1)
        .maybeSingle()

      if (data) {
        const item = {
          barcode: decodedText,
          zone: data.zone,
          bundleNumber: data.bundle_number || null,
          description: data.description || '',
          msrp: data.msrp || '',
          category: data.category || '',
          vendor: data.vendor || ''
        }
        setScannedItem(item)

        const { error: insertError } = await supabase.from('jumpstart_sort_log').insert({
          barcode,
          zone: data.zone,
          bundle_number: data.bundle_number,
          sort_type: 'general'
        })
        if (insertError) {
          console.error('INSERT ERROR:', insertError)
        }
      } else {
        setScannedItem({
          barcode: decodedText,
          zone: 0,
          bundleNumber: null
        })
      }
    } catch (error) {
      console.error('Lookup error:', error)
      setScannedItem({
        barcode: decodedText,
        zone: 0,
        bundleNumber: null
      })
    }
  }

  const handleNext = async () => {
    processingRef.current = false
    setScannedItem(null)
    setTimeout(() => startScanner(), 300)
  }

  const getZoneDisplay = () => {
    if (!scannedItem) return null
    switch (scannedItem.zone) {
      case 1:
        return {
          gradient: 'from-violet-600 via-purple-600 to-fuchsia-600',
          glow: 'shadow-purple-500/50',
          text: 'ZONE 1'
        }
      case 2:
        return {
          gradient: 'from-cyan-500 via-teal-500 to-emerald-500',
          glow: 'shadow-cyan-500/50',
          text: 'ZONE 2'
        }
      case 3:
        return {
          gradient: 'from-pink-500 via-rose-500 to-fuchsia-500',
          glow: 'shadow-pink-500/50',
          text: 'ZONE 3'
        }
      case 4:
        return {
          gradient: 'from-fuchsia-500 via-pink-500 to-rose-500',
          glow: 'shadow-fuchsia-500/50',
          text: 'ZONE 4'
        }
      default:
        return {
          gradient: 'from-slate-600 via-slate-700 to-slate-800',
          glow: 'shadow-slate-500/30',
          text: 'NOT FOUND'
        }
    }
  }

  const zoneDisplay = getZoneDisplay()

  return (
    <div className="h-screen flex flex-col bg-[#0a0f1a] overflow-hidden">
      {/* Gradient overlay */}
      <div className="fixed inset-0 bg-gradient-to-br from-purple-900/20 via-transparent to-cyan-900/10 pointer-events-none" />
      
      {/* Header - compact */}
      <div className="relative z-10 px-3 py-2 flex items-center border-b border-white/[0.06] shrink-0">
        <button 
          onClick={() => { stopScanner(); navigate('/') }}
          className="flex items-center gap-2 bg-white/[0.06] hover:bg-white/[0.1] backdrop-blur-xl px-3 py-1.5 rounded-xl border border-white/[0.08] transition-all"
        >
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          <span className="text-white text-sm font-medium">Home</span>
        </button>
        <h1 className="ml-3 text-lg font-semibold text-white">Sort</h1>
      </div>

      {/* Scanner - minimal top padding */}
      <div className={`relative z-10 flex-1 flex flex-col items-center pt-2 px-4 ${scannedItem ? 'hidden' : ''}`}>
        <div className="mb-2 text-center">
          <h2 className="text-xl font-bold text-white mb-1 tracking-tight">Scan Barcode</h2>
          <p className="text-slate-500 text-sm">Position barcode in frame</p>
        </div>
        <div 
          id="qr-reader" 
          className="w-full max-w-md flex-1 rounded-2xl overflow-hidden border border-white/[0.08] shadow-2xl shadow-black/50"
          style={{ maxHeight: '65vh' }}
        />
      </div>

      {/* Zone Display - full screen takeover */}
      {scannedItem && (
        <div className={`relative z-10 flex-1 flex flex-col items-center justify-center p-4 bg-gradient-to-br ${zoneDisplay.gradient}`}>
          <div className={`absolute inset-0 ${zoneDisplay.glow} shadow-[0_0_120px_40px] opacity-30`} />
          
          <div className="relative text-center mb-8">
            <h2 className="text-8xl font-black text-white tracking-tight drop-shadow-lg">
              {zoneDisplay.text}
            </h2>
          </div>

          <button
            onClick={handleNext}
            className="relative bg-white hover:bg-white/95 text-slate-900 font-bold text-xl px-16 py-4 rounded-2xl
                       shadow-2xl shadow-black/30 hover:scale-[1.03] active:scale-[0.98] transition-all"
          >
            Next Scan
          </button>
        </div>
      )}
    </div>
  )
}
