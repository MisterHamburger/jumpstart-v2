import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Html5Qrcode } from 'html5-qrcode'
import { supabase } from '../lib/supabase'
import { normalizeBarcode } from '../lib/barcodes'

export default function GeneralSort() {
  const navigate = useNavigate()
  const [scannedItem, setScannedItem] = useState(null)
  const [sortedCount, setSortedCount] = useState(null)
  const [isScanning, setIsScanning] = useState(false)
  const [cameraError, setCameraError] = useState(null)
  const html5QrcodeRef = useRef(null)
  const processingRef = useRef(false)

  // Fetch sort count on mount
  useEffect(() => {
    supabase.from('sort_log').select('id', { count: 'exact', head: true })
      .then(({ count }) => setSortedCount(count || 0))
      .catch(() => setSortedCount(0))
  }, [])

  // Total items count
  const [totalItems, setTotalItems] = useState(4639)
  useEffect(() => {
    supabase.from('items').select('id', { count: 'exact', head: true })
      .then(({ count }) => setTotalItems(count || 4639))
  }, [])

  // Start scanner on mount
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
        .from('items')
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
        setSortedCount(prev => (prev || 0) + 1)

        // Log to sort_log (fire and forget)
        supabase.from('sort_log').insert({
          barcode,
          zone: data.zone,
          bundle_number: data.bundle_number,
          sort_type: 'general'
        })
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
          gradient: 'from-purple-500/95 via-purple-600/95 to-blue-600/95',
          text: 'ZONE 1',
          subtext: 'Premium Items ($98+)'
        }
      case 2:
        return {
          gradient: 'from-teal-500/95 via-cyan-500/95 to-blue-500/95',
          text: 'ZONE 2',
          subtext: 'Standard Items'
        }
      case 3:
        const bundleText = scannedItem.bundleNumber === 'Leftover'
          ? 'Bundle Leftover'
          : `Bundle #${scannedItem.bundleNumber}`
        return {
          gradient: 'from-pink-500/95 via-rose-500/95 to-orange-500/95',
          text: 'ZONE 3',
          subtext: bundleText
        }
      case 4:
        return {
          gradient: 'from-amber-500/95 via-orange-500/95 to-yellow-500/95',
          text: 'ZONE 4',
          subtext: 'Needs Review / Manual Sort'
        }
      default:
        return {
          gradient: 'from-red-600/95 via-red-700/95 to-red-800/95',
          text: 'NOT FOUND',
          subtext: 'Barcode not in any zone'
        }
    }
  }

  const zoneDisplay = getZoneDisplay()

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Header */}
      <div className="p-6 flex items-center justify-between backdrop-blur-xl bg-slate-900/50 border-b border-white/5">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => { stopScanner(); navigate('/') }}
            className="bg-white/10 hover:bg-white/20 backdrop-blur-lg px-4 py-2 rounded-full border border-white/20 transition-colors flex items-center gap-2"
          >
            <span className="text-white text-lg">←</span>
            <span className="text-white text-base font-semibold">Home</span>
          </button>
          <h1 className="text-xl font-bold text-white">General Sort</h1>
        </div>
        <div className="bg-white/10 backdrop-blur-lg px-4 py-2 rounded-full border border-white/20">
          <span className="text-white text-lg font-semibold">
            {sortedCount !== null ? sortedCount : '…'} / {totalItems}
          </span>
        </div>
      </div>

      {/* Scanner - always in DOM */}
      <div className={`flex-1 flex flex-col items-center justify-center p-4 ${scannedItem ? 'hidden' : ''}`}>
        <div className="mb-4 text-center">
          <h2 className="text-2xl font-bold text-white mb-2 tracking-tight">Scan Item Barcode</h2>
          <p className="text-slate-400 text-base">Position barcode in the frame</p>
        </div>
        <div 
          id="qr-reader" 
          className="w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl border border-white/10"
          style={{ maxHeight: '50vh' }}
        ></div>
      </div>

      {/* Zone Display */}
      {scannedItem && (
        <div className={`flex-1 flex flex-col items-center justify-center p-6 bg-gradient-to-br ${zoneDisplay.gradient}`}>
          <div className="text-center mb-12">
            <h2 className="text-6xl font-black text-white mb-6 tracking-tight">
              {zoneDisplay.text}
            </h2>
            <p className="text-2xl text-white/90 font-medium">{zoneDisplay.subtext}</p>
          </div>

          <button
            onClick={handleNext}
            className="bg-white hover:bg-white/90 text-gray-900 font-bold text-2xl px-20 py-5 rounded-full
                       shadow-xl hover:scale-105 transition-all"
          >
            Next Scan
          </button>
        </div>
      )}
    </div>
  )
}
