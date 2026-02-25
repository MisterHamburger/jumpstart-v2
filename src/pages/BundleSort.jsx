import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Html5Qrcode } from 'html5-qrcode'
import { supabase } from '../lib/supabase'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

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
  const [showSoldModal, setShowSoldModal] = useState(false)
  const [salePrice, setSalePrice] = useState('')
  const [savingSale, setSavingSale] = useState(false)
  const [editingPercentage, setEditingPercentage] = useState(false)
  const [tempPercentage, setTempPercentage] = useState('')
  const html5QrcodeRef = useRef(null)
  const processingRef = useRef(false)

  useEffect(() => { fetchBoxes() }, [])

  const fetchBoxes = async () => {
    try {
      // Get all boxes
      const { data: boxRows } = await supabase
        .from('jumpstart_bundle_boxes')
        .select('*')
        .order('box_number', { ascending: false })

      // Get all scans grouped by box
      const { data: scanRows } = await supabase
        .from('jumpstart_bundle_scans')
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
        salePrice: b.sale_price,
        soldAt: b.sold_at,
        pricePercentage: b.price_percentage || 10,
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

  const openBox = async (box) => {
    setViewingBox(box)
    // Fetch manifest details for this box
    const { data } = await supabase
      .from('bundle_manifest')
      .select('*')
      .eq('box_number', box.boxNumber)
      .order('scanned_at')
    if (data) {
      setViewingBox(prev => ({ ...prev, manifestItems: data }))
    }
  }

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
      await supabase.from('jumpstart_bundle_scans').insert({
        box_number: activeBox,
        barcode: decodedText
      })

      const newCount = scanCount + 1
      setScanCount(newCount)
      setLastScan({ barcode: decodedText })

      if (newCount >= 40) {
        // Mark box complete
        await supabase.from('jumpstart_bundle_boxes')
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
    setBoxes(prev => [{ boxNumber: newBoxNum, status: 'empty', note: '', itemCount: 0, items: [] }, ...prev])
    // Sync to Supabase
    await supabase.from('jumpstart_bundle_boxes').insert({ box_number: newBoxNum, status: 'empty', note: '' })
    fetchBoxes()
  }

  const saveNote = async (boxNumber) => {
    await supabase.from('jumpstart_bundle_boxes')
      .update({ note: noteText })
      .eq('box_number', boxNumber)
    setEditingNote(null)
    fetchBoxes()
  }

  const reopenBox = async (boxNumber) => {
    await supabase.from('jumpstart_bundle_boxes')
      .update({ status: 'in-progress' })
      .eq('box_number', boxNumber)
    setViewingBox(null)
    fetchBoxes()
  }

  const markAsSold = async () => {
    setSavingSale(true)
    // Calculate the sale price from MSRP and percentage
    const items = viewingBox.manifestItems || []
    const totalMsrp = items.reduce((sum, item) => sum + (item.msrp || 0), 0)
    const pct = viewingBox.pricePercentage || 10
    const calculatedPrice = totalMsrp * (pct / 100)

    await supabase.from('jumpstart_bundle_boxes')
      .update({
        sale_price: calculatedPrice,
        sold_at: new Date().toISOString()
      })
      .eq('box_number', viewingBox.boxNumber)
    setSavingSale(false)
    setShowSoldModal(false)
    // Refresh
    const allBoxes = await fetchBoxes()
    const updated = allBoxes.find(b => b.boxNumber === viewingBox.boxNumber)
    if (updated) openBox(updated)
  }

  const clearSale = async () => {
    if (!confirm('Clear sale data for this box?')) return
    await supabase.from('jumpstart_bundle_boxes')
      .update({ sale_price: null, sold_at: null })
      .eq('box_number', viewingBox.boxNumber)
    const allBoxes = await fetchBoxes()
    const updated = allBoxes.find(b => b.boxNumber === viewingBox.boxNumber)
    if (updated) openBox(updated)
  }

  const savePercentage = async (newPercentage) => {
    const pct = parseFloat(newPercentage)
    if (isNaN(pct) || pct <= 0 || pct > 100) return
    await supabase.from('jumpstart_bundle_boxes')
      .update({ price_percentage: pct })
      .eq('box_number', viewingBox.boxNumber)
    setEditingPercentage(false)
    const allBoxes = await fetchBoxes()
    const updated = allBoxes.find(b => b.boxNumber === viewingBox.boxNumber)
    if (updated) openBox(updated)
  }

  const generatePDF = () => {
    try {
      const items = viewingBox.manifestItems || []
      if (items.length === 0) {
        alert('No items to generate PDF')
        return
      }

      const totalMsrp = items.reduce((sum, item) => sum + (item.msrp || 0), 0)
      const pricePercent = viewingBox.pricePercentage || 10
      const totalCustomerPrice = totalMsrp * (pricePercent / 100)

      // Landscape orientation for more width
      const doc = new jsPDF({ orientation: 'landscape' })
      const pageWidth = doc.internal.pageSize.getWidth()

      // Calculate table width and centering
      const tableWidth = 234 // Sum of all column widths
      const leftMargin = (pageWidth - tableWidth) / 2

      // Header text - plain black bold
      doc.setTextColor(0, 0, 0)
      doc.setFontSize(14)
      doc.setFont('helvetica', 'bold')
      doc.text(`BOX #${viewingBox.boxNumber} - Madewell/J.Crew Liquidation Bundle`, leftMargin, 12)

      doc.setFontSize(9)
      doc.setFont('helvetica', 'normal')
      doc.text(`${items.length} Pieces | Mixed Categories`, leftMargin, 18)

      // Table data - Your Price = MSRP * percentage
      const tableData = items.map(item => {
        const msrp = item.msrp || 0
        const yourPrice = msrp * (pricePercent / 100)
        return [
          item.description || 'Unknown',
          item.color || '',
          item.style || '',
          item.size || '',
          item.category || '',
          item.vendor || '',
          `$${msrp.toFixed(2)}`,
          `$${yourPrice.toFixed(2)}`
        ]
      })

      // Add table using autoTable function - centered on page
      autoTable(doc, {
        startY: 22,
        head: [['Description', 'Color', 'Style', 'Size', 'Category', 'Vendor', 'MSRP', 'Your Price']],
        body: tableData,
        theme: 'grid',
        styles: { fontSize: 7, cellPadding: 1, lineWidth: 0.1 },
        headStyles: { fillColor: [30, 58, 138], textColor: 255, fontStyle: 'bold', fontSize: 7, cellPadding: 1.5, halign: 'left' },
        columnStyles: {
          0: { cellWidth: 75 },  // Description
          1: { cellWidth: 22 },  // Color
          2: { cellWidth: 20 },  // Style
          3: { cellWidth: 15 },  // Size
          4: { cellWidth: 32 },  // Category
          5: { cellWidth: 28 },  // Vendor
          6: { cellWidth: 20, halign: 'right' },  // MSRP - right aligned
          7: { cellWidth: 22, halign: 'right' }   // Your Price - right aligned
        },
        margin: { left: leftMargin, right: leftMargin, top: 10, bottom: 10 },
        didParseCell: function(data) {
          // Right-align MSRP and Your Price headers
          if (data.section === 'head' && (data.column.index === 6 || data.column.index === 7)) {
            data.cell.styles.halign = 'right'
          }
        }
      })

      // Add totals below table - right aligned to table edge
      const tableRightEdge = leftMargin + tableWidth
      const finalY = doc.lastAutoTable.finalY + 5

      doc.setFontSize(9)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(80, 80, 80)
      const avgPerItem = totalCustomerPrice / items.length
      const detailText = `${items.length} items  •  $${avgPerItem.toFixed(2)} avg per item  •  Retail Value: $${totalMsrp.toFixed(2)} MSRP  •  ${pricePercent}% of MSRP`
      doc.text(detailText, tableRightEdge, finalY, { align: 'right' })

      doc.setFontSize(12)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(30, 58, 138)
      const priceText = `YOUR PRICE: $${totalCustomerPrice.toFixed(2)}`
      doc.text(priceText, tableRightEdge, finalY + 6, { align: 'right' })

      // Save
      doc.save(`Box_${viewingBox.boxNumber}_Manifest.pdf`)
    } catch (err) {
      console.error('PDF generation error:', err)
      alert('Error generating PDF: ' + err.message)
    }
  }

  const completeBox = async (boxNumber) => {
    await supabase.from('jumpstart_bundle_boxes')
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
    await supabase.from('jumpstart_bundle_scans').delete().eq('box_number', box.boxNumber)
    await supabase.from('jumpstart_bundle_boxes').delete().eq('box_number', box.boxNumber)
    fetchBoxes()
  }

  const deleteItem = async (boxNumber, barcode, id) => {
    if (!confirm('Delete this item?')) return
    await supabase.from('jumpstart_bundle_scans').delete().eq('id', id)
    // Refresh the viewing box
    const allBoxes = await fetchBoxes()
    const updated = allBoxes.find(b => b.boxNumber === boxNumber)
    if (updated) setViewingBox(updated)
    else setViewingBox(null)
  }

  const deleteActiveItem = async (barcode, id) => {
    if (!confirm('Delete this item?')) return
    await supabase.from('jumpstart_bundle_scans').delete().eq('id', id)
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
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-cyan-500 via-teal-500 to-emerald-500 z-10">
                  <div className="text-center mb-10">
                    <h2 className="text-6xl font-black text-white mb-4 tracking-tight">SCANNED ✓</h2>
                    <p className="text-2xl text-white/90 font-semibold">Place in Box {activeBox}</p>
                  </div>
                  <button onClick={handleNext} className="bg-white/95 hover:bg-white text-slate-900 font-bold text-xl px-16 py-4 rounded-2xl shadow-2xl shadow-black/30 hover:scale-105 transition-all active:scale-95">
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
    const manifestItems = viewingBox.manifestItems || []
    const totalCost = manifestItems.reduce((sum, item) => sum + (item.cost_freight || item.cost || 0), 0)
    const totalMsrp = manifestItems.reduce((sum, item) => sum + (item.msrp || 0), 0)
    const pricePercentage = viewingBox.pricePercentage || 10
    const customerPrice = totalMsrp * (pricePercentage / 100)
    const isSold = viewingBox.salePrice != null
    const profit = customerPrice - totalCost
    const margin = customerPrice > 0 ? (profit / customerPrice) * 100 : null

    return (
      <div className="min-h-screen flex flex-col bg-[#0a0f1a]">
        {/* Gradient overlay */}
        <div className="fixed inset-0 bg-gradient-to-br from-pink-900/20 via-transparent to-fuchsia-900/10 pointer-events-none" />
        {/* Header */}
        <div className="p-3 flex items-center justify-between backdrop-blur-xl bg-white/5 border-b border-white/10">
          <button onClick={() => { setViewingBox(null); fetchBoxes() }} className="bg-white/10 hover:bg-white/20 backdrop-blur-lg w-10 h-10 rounded-full border border-white/20 text-white font-bold text-lg flex items-center justify-center">
            ←
          </button>
          <h1 className="text-lg font-bold text-white">Box {viewingBox.boxNumber}</h1>
          <div className="flex items-center gap-2">
            {isComplete && !isSold && (
              <button onClick={() => reopenBox(viewingBox.boxNumber)} className="bg-white/10 px-3 py-1.5 rounded-full text-white/70 text-sm border border-white/10">
                Reopen
              </button>
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-white/5">
          <div className={`h-full transition-all duration-500 ${isSold ? 'bg-gradient-to-r from-emerald-400 to-green-500' : isComplete ? 'bg-gradient-to-r from-fuchsia-400 to-purple-500' : 'bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-500'}`} style={{ width: `${pct}%` }}></div>
        </div>

        {/* Stats cards */}
        <div className="px-4 pt-4 pb-2">
          <div className="grid grid-cols-4 gap-2 mb-3">
            <div className="bg-white/5 rounded-xl p-3 text-center border border-white/10">
              <p className="text-2xl font-bold text-white">{viewingBox.itemCount}</p>
              <p className="text-xs text-slate-400">Items</p>
            </div>
            <div className="bg-white/5 rounded-xl p-3 text-center border border-white/10">
              <p className="text-2xl font-bold text-cyan-400">${totalMsrp.toFixed(0)}</p>
              <p className="text-xs text-slate-400">MSRP</p>
            </div>
            <div className="bg-white/5 rounded-xl p-3 text-center border border-white/10">
              <p className="text-2xl font-bold text-fuchsia-400">${totalCost.toFixed(2)}</p>
              <p className="text-xs text-slate-400">Cost</p>
            </div>
            <div
              className="bg-emerald-500/10 rounded-xl p-3 text-center border border-emerald-500/30 cursor-pointer hover:border-emerald-400/50 transition-all"
              onClick={() => { setEditingPercentage(true); setTempPercentage(String(pricePercentage)); }}
            >
              <p className="text-2xl font-bold text-emerald-400">${customerPrice.toFixed(2)}</p>
              <p className="text-xs text-emerald-300/60">Price ({pricePercentage}%)</p>
            </div>
          </div>

          {/* Percentage editor */}
          {editingPercentage && (
            <div className="bg-slate-800/80 rounded-xl p-3 mb-3 border border-white/10">
              <p className="text-xs text-slate-400 mb-2">Adjust pricing percentage</p>
              <div className="flex gap-2">
                {[8, 10, 12, 15].map(pct => (
                  <button
                    key={pct}
                    onClick={() => savePercentage(pct)}
                    className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
                      pricePercentage === pct
                        ? 'bg-emerald-500 text-white'
                        : 'bg-white/10 text-white hover:bg-white/20'
                    }`}
                  >
                    {pct}%
                  </button>
                ))}
                <input
                  type="number"
                  value={tempPercentage}
                  onChange={e => setTempPercentage(e.target.value)}
                  onBlur={() => savePercentage(tempPercentage)}
                  onKeyDown={e => e.key === 'Enter' && savePercentage(tempPercentage)}
                  className="w-16 bg-white/10 border border-white/20 rounded-lg px-2 py-2 text-white text-sm text-center"
                  placeholder="%"
                />
              </div>
            </div>
          )}

          {/* Profit preview (always show) */}
          <div className={`rounded-xl p-3 mb-3 border ${profit >= 0 ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-400 mb-1">{isSold ? 'SOLD' : 'PROJECTED'}</p>
                <p className="text-xl font-bold text-white">${customerPrice.toFixed(2)}</p>
              </div>
              <div className="text-right">
                <p className={`text-xl font-bold ${profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {profit >= 0 ? '+' : ''}${profit.toFixed(2)}
                </p>
                <p className="text-xs text-slate-400">{margin?.toFixed(1)}% margin</p>
              </div>
            </div>
            {isSold && (
              <button onClick={clearSale} className="text-xs text-slate-500 hover:text-slate-300 mt-2">
                Clear sale
              </button>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            {!isComplete && (
              <button onClick={() => startScanningBox(viewingBox)} className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-600 py-3 rounded-xl text-white font-bold text-sm shadow-lg shadow-cyan-500/25 active:scale-[0.98] transition-all">
                Scan Items
              </button>
            )}
            {isComplete && !isSold && (
              <button onClick={() => setShowSoldModal(true)} className="flex-1 bg-gradient-to-r from-emerald-500 to-green-600 py-3 rounded-xl text-white font-bold text-sm shadow-lg shadow-emerald-500/25 active:scale-[0.98] transition-all">
                Mark as Sold
              </button>
            )}
            {isComplete && (
              <button onClick={generatePDF} className="flex-1 bg-gradient-to-r from-fuchsia-500 to-purple-600 py-3 rounded-xl text-white font-bold text-sm shadow-lg shadow-fuchsia-500/25 active:scale-[0.98] transition-all">
                Generate PDF
              </button>
            )}
          </div>
        </div>

        {/* Items list with manifest details */}
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {manifestItems.length === 0 ? (
            <p className="text-slate-600 text-center py-8 text-sm">No items scanned yet</p>
          ) : (
            <>
              <p className="text-slate-500 text-xs uppercase tracking-wider mb-2 font-semibold">{manifestItems.length} Items</p>
              <div className="space-y-2">
                {manifestItems.map((item, i) => (
                  <div key={i} className="bg-white/5 rounded-xl p-3 border border-white/10">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-medium leading-tight line-clamp-2">
                          {item.description || 'Unknown item'}
                        </p>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-xs text-slate-400">
                          {item.color && <span>{item.color}</span>}
                          {item.size && <span>Size: {item.size}</span>}
                          {item.category && <span>{item.category}</span>}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-fuchsia-400 font-semibold text-sm">${(item.cost_freight || item.cost || 0).toFixed(2)}</p>
                        <p className="text-slate-500 text-xs">${(item.msrp || 0).toFixed(0)} MSRP</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Mark as Sold Modal */}
        {showSoldModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-slate-800 rounded-2xl p-6 w-full max-w-sm border border-white/10">
              <h3 className="text-xl font-bold text-white mb-2">Mark as Sold</h3>
              <p className="text-slate-400 text-sm mb-4">Confirm sale of Box {viewingBox.boxNumber}</p>

              <div className="bg-emerald-500/10 rounded-xl p-4 mb-4 border border-emerald-500/30">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-slate-400">Sale Price</span>
                  <span className="text-2xl font-bold text-emerald-400">${customerPrice.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-500">{pricePercentage}% of ${totalMsrp.toFixed(2)} MSRP</span>
                  <span className={`font-semibold ${profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {profit >= 0 ? '+' : ''}${profit.toFixed(2)} profit
                  </span>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowSoldModal(false)}
                  className="flex-1 bg-white/10 py-3 rounded-xl text-white font-semibold border border-white/10"
                >
                  Cancel
                </button>
                <button
                  onClick={markAsSold}
                  disabled={savingSale}
                  className="flex-1 bg-gradient-to-r from-emerald-500 to-green-600 py-3 rounded-xl text-white font-bold disabled:opacity-50"
                >
                  {savingSale ? 'Saving...' : 'Confirm Sale'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // === BOX LIST ===
  return (
    <div className="min-h-screen flex flex-col bg-[#0a0f1a] overflow-x-hidden max-w-full">
      {/* Gradient overlay */}
      <div className="fixed inset-0 bg-gradient-to-br from-pink-900/20 via-transparent to-fuchsia-900/10 pointer-events-none" />
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
          const isSold = box.salePrice != null
          const statusColor = isSold ? 'from-emerald-500/20 to-green-500/20' :
                              box.status === 'complete' ? 'from-fuchsia-500/20 to-purple-500/20' :
                              box.status === 'in-progress' ? 'from-cyan-500/20 to-blue-500/20' : 'from-slate-500/20 to-slate-600/20'
          const borderColor = isSold ? 'border-emerald-400/30' :
                              box.status === 'complete' ? 'border-fuchsia-400/30' :
                              box.status === 'in-progress' ? 'border-cyan-400/30' : 'border-white/10'
          const statusText = isSold ? `Sold · $${box.salePrice.toFixed(2)}` :
                             box.status === 'complete' ? 'Complete' : box.status === 'in-progress' ? 'In Progress' : 'Empty'

          return (
            <div key={box.boxNumber} className={`rounded-2xl bg-gradient-to-r ${statusColor} backdrop-blur-lg border ${borderColor} overflow-hidden max-w-full`}>
              {/* Box card */}
              <div className="p-4 cursor-pointer active:bg-white/5" onClick={() => openBox(box)}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-white font-bold text-lg">Box {box.boxNumber}</h3>
                    <p className="text-slate-400 text-sm">{box.itemCount}/40 items • <span className={isSold ? 'text-emerald-400' : ''}>{statusText}</span></p>
                  </div>
                  <button onClick={(e) => deleteBox(e, box)} className="text-slate-500 hover:text-red-400 active:text-red-400 w-10 h-10 rounded-full bg-white/5 hover:bg-red-500/10 flex items-center justify-center text-lg font-bold transition-colors shrink-0">
                    ✕
                  </button>
                </div>
                {/* Progress bar */}
                <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-500 ${
                    isSold ? 'bg-gradient-to-r from-emerald-400 to-green-500' :
                    box.status === 'complete' ? 'bg-gradient-to-r from-fuchsia-400 to-purple-500' :
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
