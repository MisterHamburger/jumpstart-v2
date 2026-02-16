import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Html5Qrcode } from 'html5-qrcode'
import { supabase } from '../lib/supabase'

export default function BundleSort() {
  const navigate = useNavigate()
  const [boxes, setBoxes] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeBox, setActiveBox] = useState(null)
  const [viewingBox, setViewingBox] = useState(null)
  const [scanCount, setScanCount] = useState(0)
  const [lastScan, setLastScan] = useState(null)
  const [isScanning, setIsScanning] = useState(false)
  const [cameraError, setCameraError] = useState(null)
  const [editingNote, setEditingNote] = useState(null)
  const [noteText, setNoteText] = useState('')
  const [showItemList, setShowItemList] = useState(false)
  const [activeBoxItems, setActiveBoxItems] = useState([])
  const html5QrcodeRef = useRef(null)
  const processingRef = useRef(false)

  useEffect(() => { fetchBoxes() }, [])

  const fetchBoxes = async () => {
    try {
      // Get all boxes
      const { data: boxRows } = await supabase
        .from('bundle_boxes')
        .select('*')
        .order('box_number')

      // Get all scans grouped by box
      const { data: scanRows } = await supabase
        .from('bundle_scans')
        .select('*')
        .order('scanned_at')

      const scansByBox = {}
      ;(scanRows || []).forEach(s => {
        if (!scansByBox[s.box_number]) scansByBox[s.box_number] = []
        scansByBox[s.box_number].push(s)
      })

      const merged = (boxRows || []).map(b => ({
        boxNumber: b.box_number,
        status: b.status,
        note: b.note || '',
        itemCount: (scansByBox[b.box_number] || []).length,
        items: (scansByBox[b.box_number] || []).map(s => ({
          barcode: s.barcode,
          timestamp: s.scanned_at,
          id: s.id
        }))
      }))

      setBoxes(merged)
      return merged
    } catch (e) {
      console.error('Failed to fetch boxes:', e)
      return []
    } finally {
      setLoading(false)
    }
  }

  const openBox = (box) => { setViewingBox(box) }

  const startScanningBox = (box) => {
    setViewingBox(null)
    setActiveBox(box.boxNumber)
    setScanCount(box.itemCount || 0)
    setLastScan(null)
    setShowItemList(false)
  }

  const closeScanner = async () => {
    await stopScanner()
    setActiveBox(null)
    setLastScan(null)
    setShowItemList(false)
    processingRef.current = false
    fetchBoxes()
  }

  const fetchActiveBoxItems = async () => {
    const allBoxes = await fetchBoxes()
    const box = allBoxes.find(b => b.boxNumber === activeBox)
    setActiveBoxItems(box?.items || [])
    setScanCount(box?.itemCount || scanCount)
  }

  const toggleItemList = () => {
    if (!showItemList) fetchActiveBoxItems()
    setShowItemList(!showItemList)
  }

  useEffect(() => {
    if (activeBox) {
      const timer = setTimeout(() => startScanner(), 300)
      return () => { clearTimeout(timer); stopScanner() }
    }
  }, [activeBox])

  const startScanner = async () => {
    try {
      if (html5QrcodeRef.current) { try { await html5QrcodeRef.current.stop() } catch(e) {}; html5QrcodeRef.current = null }
      await new Promise(r => setTimeout(r, 200))
      const html5QrCode = new Html5Qrcode("nb-qr-reader")
      html5QrcodeRef.current = html5QrCode
      await html5QrCode.start({ facingMode: "environment" }, { fps: 60 }, onScanSuccess, () => {})
      setIsScanning(true)
      setCameraError(null)
    } catch (err) {
      console.error("[Scanner] Start error:", err)
      setCameraError(err.message)
      setIsScanning(false)
    }
  }

  const stopScanner = async () => {
    if (html5QrcodeRef.current) { try { await html5QrcodeRef.current.stop() } catch(e) {}; html5QrcodeRef.current = null; setIsScanning(false) }
  }

  const onScanSuccess = async (decodedText) => {
    if (processingRef.current) return
    if (!decodedText.startsWith('099')) return
    processingRef.current = true
    try {
      // Log scan to Supabase
      await supabase.from('bundle_scans').insert({
        box_number: activeBox,
        barcode: decodedText
      })

      const newCount = scanCount + 1
      setScanCount(newCount)
      setLastScan({ barcode: decodedText })

      if (newCount >= 40) {
        // Mark box complete
        await supabase.from('bundle_boxes')
          .update({ status: 'complete' })
          .eq('box_number', activeBox)
        await stopScanner()
        setTimeout(() => { alert('Box complete! 40 items reached.'); closeScanner() }, 500)
        return
      }
    } catch (e) {
      console.error('Scan error:', e)
      setLastScan({ barcode: decodedText, error: true })
    }
  }

  const handleNext = () => { processingRef.current = false; setLastScan(null) }

  const createNewBox = async () => {
    const maxBox = boxes.reduce((max, b) => Math.max(max, b.boxNumber), 0)
    const newBoxNum = maxBox + 1
    // Optimistic UI
    setBoxes(prev => [...prev, { boxNumber: newBoxNum, status: 'empty', note: '', itemCount: 0, items: [] }])
    // Sync to Supabase
    await supabase.from('bundle_boxes').insert({ box_number: newBoxNum, status: 'empty', note: '' })
    fetchBoxes()
  }

  const saveNote = async (boxNumber) => {
    await supabase.from('bundle_boxes')
      .update({ note: noteText })
      .eq('box_number', boxNumber)
    setEditingNote(null)
    fetchBoxes()
  }

  const reopenBox = async (boxNumber) => {
    await supabase.from('bundle_boxes')
      .update({ status: 'in-progress' })
      .eq('box_number', boxNumber)
    setViewingBox(null)
    fetchBoxes()
  }

  const completeBox = async (boxNumber) => {
    await supabase.from('bundle_boxes')
      .update({ status: 'complete' })
      .eq('box_number', boxNumber)
    closeScanner()
  }

  const deleteBox = async (e, box) => {
    e.stopPropagation()
    const msg = box.itemCount > 0
      ? `Delete Box ${box.boxNumber}? This will remove ${box.itemCount} item${box.itemCount !== 1 ? 's' : ''}.`
      : `Delete Box ${box.boxNumber}? (0 items)`
    if (!confirm(msg)) return
    // Delete scans first, then box
    await supabase.from('bundle_scans').delete().eq('box_number', box.boxNumber)
    await supabase.from('bundle_boxes').delete().eq('box_number', box.boxNumber)
    fetchBoxes()
  }

  const deleteItem = async (boxNumber, barcode, id) => {
    if (!confirm('Delete this item?')) return
    await supabase.from('bundle_scans').delete().eq('id', id)
    // Refresh the viewing box
    const allBoxes = await fetchBoxes()
    const updated = allBoxes.find(b => b.boxNumber === boxNumber)
    if (updated) setViewingBox(updated)
    else setViewingBox(null)
  }

  const deleteActiveItem = async (barcode, id) => {
    if (!confirm('Delete this item?')) return
    await supabase.from('bundle_scans').delete().eq('id', id)
    await fetchActiveBoxItems()
  }

  const progressPercent = (count) => Math.min(100, Math.round((count / 40) * 100))

  // === SCANNER VIEW ===
  if (activeBox) {
    return (
      <div className="min-h-screen flex flex-col bg-gradient-to-br from-violet-950 via-slate-900 to-fuchsia-950">
        {/* Header */}
        <div className="p-3 flex items-center justify-between backdrop-blur-xl bg-white/5 border-b border-white/10">
          <button onClick={closeScanner} className="bg-white/10 hover:bg-white/20 backdrop-blur-lg w-10 h-10 rounded-full border border-white/20 text-white font-bold text-lg flex items-center justify-center">
            ←
          </button>
          <h1 className="text-lg font-bold text-white">Box {activeBox}</h1>
          <div className="flex items-center gap-2">
            <button onClick={toggleItemList} className="bg-gradient-to-r from-cyan-500/20 to-blue-500/20 backdrop-blur-lg px-3 py-1.5 rounded-full border border-cyan-400/30 active:bg-cyan-500/30">
              <span className="text-cyan-300 font-bold text-sm">{scanCount}/40</span>
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-white/5">
          <div className="h-full bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-500 transition-all duration-500" style={{ width: `${progressPercent(scanCount)}%` }}></div>
        </div>

        {/* Item list overlay */}
        {showItemList ? (
          <div className="flex-1 overflow-y-auto p-4">
            <div className="flex items-center justify-between mb-4">
              <p className="text-white font-bold text-lg">{activeBoxItems.length} items scanned</p>
              <button onClick={() => setShowItemList(false)} className="bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2 rounded-full text-white font-semibold text-sm shadow-lg shadow-cyan-500/30">
                Back to Scanner
              </button>
            </div>
            {activeBoxItems.length === 0 ? (
              <p className="text-slate-500 text-center py-8">No items yet</p>
            ) : (
              <div className="space-y-2">
                {activeBoxItems.map((item, i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-white/5 backdrop-blur-sm border border-white/10">
                    <p className="text-white font-mono font-medium text-base flex-1 min-w-0 mr-3">{item.barcode}</p>
                    <button onClick={() => deleteActiveItem(item.barcode, item.id)} className="text-red-400 hover:text-red-300 w-8 h-8 rounded-full bg-red-500/10 hover:bg-red-500/20 flex items-center justify-center shrink-0 text-sm">
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Camera always running */}
            <div className="flex-1 flex flex-col items-center justify-center p-4 relative">
              <div className={`text-center mb-3 ${lastScan ? 'invisible' : ''}`}>
                <h2 className="text-2xl font-bold text-white mb-1">Scan Barcode</h2>
              </div>
              <div id="nb-qr-reader" className="w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl shadow-purple-500/20 border-2 border-purple-400/30" style={{ maxHeight: '50vh' }}></div>
              {cameraError && <p className="text-red-400 mt-3 text-sm">{cameraError}</p>}

              {/* Scan result overlay */}
              {lastScan && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-emerald-500 via-green-500 to-teal-500 z-10">
                  <div className="text-center mb-10">
                    <h2 className="text-6xl font-black text-white mb-4 tracking-tight">SCANNED ✓</h2>
                    <p className="text-2xl text-white/90 font-semibold">Place in Box {activeBox}</p>
                  </div>
                  <button onClick={handleNext} className="bg-white/95 hover:bg-white text-gray-900 font-bold text-xl px-16 py-4 rounded-full shadow-2xl shadow-black/30 hover:scale-105 transition-all active:scale-95">
                    Next Scan
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    )
  }

  // === VIEWING BOX ===
  if (viewingBox) {
    const isComplete = viewingBox.status === 'complete'
    const pct = progressPercent(viewingBox.itemCount)
    const items = viewingBox.items || []
    return (
      <div className="min-h-screen flex flex-col bg-gradient-to-br from-violet-950 via-slate-900 to-fuchsia-950">
        {/* Header */}
        <div className="p-3 flex items-center justify-between backdrop-blur-xl bg-white/5 border-b border-white/10">
          <button onClick={() => { setViewingBox(null); fetchBoxes() }} className="bg-white/10 hover:bg-white/20 backdrop-blur-lg w-10 h-10 rounded-full border border-white/20 text-white font-bold text-lg flex items-center justify-center">
            ←
          </button>
          <h1 className="text-lg font-bold text-white">Box {viewingBox.boxNumber}</h1>
          <div className="flex items-center gap-2">
            {isComplete && (
              <button onClick={() => reopenBox(viewingBox.boxNumber)} className="bg-gradient-to-r from-amber-500 to-orange-600 px-4 py-2 rounded-full text-white font-semibold text-sm shadow-lg shadow-amber-500/30">
                Reopen
              </button>
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-white/5">
          <div className={`h-full transition-all duration-500 ${isComplete ? 'bg-gradient-to-r from-emerald-400 to-green-500' : 'bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-500'}`} style={{ width: `${pct}%` }}></div>
        </div>

        {/* Status line */}
        <div className="px-4 pt-4 pb-2 flex items-baseline justify-between">
          <div>
            <span className="text-white font-bold text-2xl">{viewingBox.itemCount}</span>
            <span className="text-slate-400 text-lg">/40 items</span>
          </div>
          <span className={`text-sm font-medium ${isComplete ? 'text-emerald-400' : viewingBox.itemCount > 0 ? 'text-cyan-400' : 'text-slate-500'}`}>
            {isComplete ? 'Complete' : viewingBox.itemCount > 0 ? 'In Progress' : 'Empty'}
          </span>
        </div>

        {/* Scan button */}
        {!isComplete && (
          <div className="px-4 pb-4">
            <button onClick={() => startScanningBox(viewingBox)} className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 py-4 rounded-2xl text-white font-bold text-lg shadow-xl shadow-cyan-500/25 active:scale-[0.98] transition-all">
              Scan Items
            </button>
          </div>
        )}

        {/* Items list */}
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {items.length === 0 ? (
            <p className="text-slate-600 text-center py-8 text-sm">No items scanned yet</p>
          ) : (
            <>
              <p className="text-slate-500 text-xs uppercase tracking-wider mb-2 font-semibold">Scanned Items</p>
              <div className="space-y-1">
                {items.map((item, i) => (
                  <div key={i} className="flex items-center justify-between py-2.5 border-b border-white/5">
                    <p className="text-white font-mono text-base flex-1 min-w-0 mr-3">{item.barcode}</p>
                    <button onClick={() => deleteItem(viewingBox.boxNumber, item.barcode, item.id)} className="text-red-500/50 hover:text-red-400 text-xs px-2 py-1 shrink-0">
                      remove
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  // === BOX LIST ===
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-violet-950 via-slate-900 to-fuchsia-950 overflow-x-hidden max-w-full">
      {/* Header */}
      <div className="p-3 backdrop-blur-xl bg-white/5 border-b border-white/10">
        <div className="flex items-center justify-between">
          <button onClick={() => navigate('/')} className="bg-white/10 hover:bg-white/20 backdrop-blur-lg px-4 py-2 rounded-full border border-white/20 text-white font-semibold text-sm shrink-0">
            ← Home
          </button>
          <h1 className="text-lg font-bold text-white shrink-0">Bundle Sort</h1>
          <button onClick={createNewBox} className="bg-gradient-to-r from-fuchsia-500 to-purple-600 hover:from-fuchsia-400 hover:to-purple-500 px-4 py-2 rounded-full text-white font-semibold text-sm shadow-lg shadow-fuchsia-500/30 shrink-0">
            ＋ New
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-3">
        {loading && (
          <div className="text-center py-12">
            <div className="w-12 h-12 border-4 border-purple-400/30 border-t-purple-400 rounded-full animate-spin mb-4 mx-auto"></div>
            <p className="text-slate-400">Loading boxes...</p>
          </div>
        )}
        {!loading && boxes.length === 0 && (
          <div className="text-center py-16">
            <p className="text-slate-300 text-lg mb-6">No boxes yet</p>
            <button onClick={createNewBox} className="bg-gradient-to-r from-fuchsia-500 to-purple-600 hover:from-fuchsia-400 hover:to-purple-500 px-8 py-3 rounded-full text-white font-bold text-lg shadow-xl shadow-fuchsia-500/30">
              ＋ Create Box 1
            </button>
          </div>
        )}
        {boxes.map(box => {
          const pct = progressPercent(box.itemCount)
          const statusColor = box.status === 'complete' ? 'from-emerald-500/20 to-green-500/20' :
                              box.status === 'in-progress' ? 'from-cyan-500/20 to-blue-500/20' : 'from-slate-500/20 to-slate-600/20'
          const borderColor = box.status === 'complete' ? 'border-emerald-400/30' :
                              box.status === 'in-progress' ? 'border-cyan-400/30' : 'border-white/10'
          const statusText = box.status === 'complete' ? 'Complete' : box.status === 'in-progress' ? 'In Progress' : 'Empty'

          return (
            <div key={box.boxNumber} className={`rounded-2xl bg-gradient-to-r ${statusColor} backdrop-blur-lg border ${borderColor} overflow-hidden max-w-full`}>
              {/* Box card */}
              <div className="p-4 cursor-pointer active:bg-white/5" onClick={() => openBox(box)}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-white font-bold text-lg">Box {box.boxNumber}</h3>
                    <p className="text-slate-400 text-sm">{box.itemCount}/40 items • {statusText}</p>
                  </div>
                  <button onClick={(e) => deleteBox(e, box)} className="text-slate-500 hover:text-red-400 active:text-red-400 w-10 h-10 rounded-full bg-white/5 hover:bg-red-500/10 flex items-center justify-center text-lg font-bold transition-colors shrink-0">
                    ✕
                  </button>
                </div>
                {/* Progress bar */}
                <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-500 ${
                    box.status === 'complete' ? 'bg-gradient-to-r from-emerald-400 to-green-500' :
                    'bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-500'
                  }`} style={{ width: `${pct}%` }}></div>
                </div>
              </div>
              {/* Note */}
              <div className="px-4 pb-3 max-w-full" onClick={e => e.stopPropagation()}>
                {editingNote === box.boxNumber ? (
                  <div className="flex gap-2 items-center w-full max-w-full">
                    <input
                      type="text"
                      value={noteText}
                      onChange={e => setNoteText(e.target.value)}
                      className="flex-1 min-w-0 bg-white/10 border border-white/20 rounded-xl px-3 py-2 text-white text-base placeholder-slate-500 focus:outline-none focus:border-purple-400/50"
                      style={{ fontSize: '16px' }}
                      placeholder="Type a note..."
                      autoFocus
                    />
                    <button onClick={() => saveNote(box.boxNumber)} className="bg-gradient-to-r from-cyan-500 to-blue-600 px-3 py-2 rounded-xl text-white text-xs font-semibold shrink-0">
                      Save
                    </button>
                    <button onClick={() => setEditingNote(null)} className="bg-white/10 w-7 h-7 rounded-full text-white text-xs shrink-0 flex items-center justify-center">
                      ✕
                    </button>
                  </div>
                ) : (
                  <p
                    className="text-slate-500 text-sm cursor-pointer hover:text-slate-300 py-1"
                    onClick={() => { setEditingNote(box.boxNumber); setNoteText(box.note || '') }}
                  >
                    {box.note || 'Add note...'}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
