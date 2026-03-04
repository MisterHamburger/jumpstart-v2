import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Html5Qrcode } from 'html5-qrcode'
import { supabase } from '../lib/supabase'
import { normalizeBarcode } from '../lib/barcodes'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

// Lazy-loading photo thumbnail for No Barcode picker
function LazyPhoto({ intakeId }) {
  const [src, setSrc] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!intakeId) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !loaded) {
        setLoaded(true)
        supabase.from('kickstart_intake').select('item_photo_data, photo_data').eq('id', intakeId).single()
          .then(({ data }) => {
            const photo = data?.item_photo_data || data?.photo_data
            if (photo) setSrc(`data:image/jpeg;base64,${photo}`)
          })
      }
    }, { rootMargin: '200px' })
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [intakeId, loaded])

  return (
    <>
      <div
        ref={ref}
        className="w-16 h-16 rounded-xl border border-white/20 shrink-0 overflow-hidden bg-white/10"
        onClick={(e) => { if (src) { e.stopPropagation(); setExpanded(true) } }}
      >
        {src ? (
          <img src={src} alt="Tag" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-white/20 text-xs">{loaded ? '...' : ''}</span>
          </div>
        )}
      </div>
      {expanded && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={(e) => { e.stopPropagation(); setExpanded(false) }}
        >
          <img src={src} alt="Tag" className="max-w-full max-h-full rounded-2xl" />
        </div>
      )}
    </>
  )
}

export default function BundleSort() {
  const navigate = useNavigate()
  const location = useLocation()
  const [channel, setChannel] = useState(location.state?.channel || 'Jumpstart')
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
  // Kickstart No Barcode picker state
  const [noBarcodeStep, setNoBarcodeStep] = useState(null) // null | 'size' | 'category' | 'pickItem'
  const [noBarcodeSize, setNoBarcodeSize] = useState(null)
  const [noBarcodeCategory, setNoBarcodeCategory] = useState(null)
  const [noBarcodeCategories, setNoBarcodeCategories] = useState([])
  const [noBarcodeItems, setNoBarcodeItems] = useState([])
  const [noBarcodeAllItems, setNoBarcodeAllItems] = useState([])
  const [noBarcodeLoading, setNoBarcodeLoading] = useState(false)
  const html5QrcodeRef = useRef(null)
  const processingRef = useRef(false)
  const scanCountRef = useRef(0)

  const isKickstart = channel === 'Kickstart'

  // Reset state + re-fetch when channel changes
  useEffect(() => {
    setActiveBox(null)
    setViewingBox(null)
    setLastScan(null)
    setShowItemList(false)
    setActiveBoxItems([])
    setNoBarcodeStep(null)
    setLoading(true)
    fetchBoxes()
  }, [channel])

  const fetchBoxes = async () => {
    try {
      if (isKickstart) {
        const { data: boxRows } = await supabase
          .from('kickstart_bundle_boxes')
          .select('*')
          .order('box_number', { ascending: false })

        const { data: scanRows } = await supabase
          .from('kickstart_bundle_scans')
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
          markupPercentage: b.markup_percentage || 50,
          itemCount: (scansByBox[b.box_number] || []).length,
          items: (scansByBox[b.box_number] || []).map(s => ({
            intakeId: s.intake_id,
            timestamp: s.scanned_at,
            id: s.id
          }))
        }))

        setBoxes(merged)
        return merged
      } else {
        // Jumpstart
        const { data: boxRows } = await supabase
          .from('jumpstart_bundle_boxes')
          .select('*')
          .order('box_number', { ascending: false })

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
      }
    } catch (e) {
      console.error('Failed to fetch boxes:', e)
      return []
    } finally {
      setLoading(false)
    }
  }

  const openBox = async (box) => {
    setViewingBox(box)

    if (isKickstart) {
      const { data: scans } = await supabase
        .from('kickstart_bundle_scans')
        .select('id, intake_id, scanned_at')
        .eq('box_number', box.boxNumber)
        .order('scanned_at')

      if (scans && scans.length > 0) {
        const intakeIds = scans.map(s => s.intake_id)
        const { data: intakeData } = await supabase
          .from('kickstart_intake')
          .select('id, brand, description, color, size, cost, msrp')
          .in('id', intakeIds)

        const intakeMap = {}
        ;(intakeData || []).forEach(i => { intakeMap[i.id] = i })

        const manifestItems = scans.map(s => {
          const intake = intakeMap[s.intake_id] || {}
          return {
            scan_id: s.id,
            intake_id: s.intake_id,
            scanned_at: s.scanned_at,
            brand: intake.brand,
            description: intake.description,
            color: intake.color,
            size: intake.size,
            cost: intake.cost || 0,
            msrp: intake.msrp || 0
          }
        })
        setViewingBox(prev => ({ ...prev, manifestItems }))
      } else {
        setViewingBox(prev => ({ ...prev, manifestItems: [] }))
      }
    } else {
      const { data } = await supabase
        .from('bundle_manifest')
        .select('*')
        .eq('box_number', box.boxNumber)
        .order('scanned_at')
      if (data) {
        setViewingBox(prev => ({ ...prev, manifestItems: data }))
      }
    }
  }

  const startScanningBox = (box) => {
    setViewingBox(null)
    setActiveBox(box.boxNumber)
    const count = box.itemCount || 0
    setScanCount(count)
    scanCountRef.current = count
    setLastScan(null)
    setShowItemList(false)
    setNoBarcodeStep(null)
  }

  const closeScanner = async () => {
    await stopScanner()
    setActiveBox(null)
    setLastScan(null)
    setShowItemList(false)
    setNoBarcodeStep(null)
    processingRef.current = false
    fetchBoxes()
  }

  const fetchActiveBoxItems = async () => {
    if (isKickstart) {
      const { data: scans } = await supabase
        .from('kickstart_bundle_scans')
        .select('id, intake_id, scanned_at')
        .eq('box_number', activeBox)
        .order('scanned_at', { ascending: false })

      if (!scans || scans.length === 0) {
        setActiveBoxItems([])
        setScanCount(0)
        return
      }

      const intakeIds = scans.map(s => s.intake_id)
      const { data: intakeData } = await supabase
        .from('kickstart_intake')
        .select('id, brand, description, color, size')
        .in('id', intakeIds)

      const intakeMap = {}
      ;(intakeData || []).forEach(i => { intakeMap[i.id] = i })

      const items = scans.map(s => ({
        id: s.id,
        intakeId: s.intake_id,
        timestamp: s.scanned_at,
        brand: intakeMap[s.intake_id]?.brand,
        description: intakeMap[s.intake_id]?.description,
        color: intakeMap[s.intake_id]?.color,
        size: intakeMap[s.intake_id]?.size
      }))

      setActiveBoxItems(items)
      setScanCount(items.length)
      scanCountRef.current = items.length
    } else {
      const allBoxes = await fetchBoxes()
      const box = allBoxes.find(b => b.boxNumber === activeBox)
      setActiveBoxItems(box?.items || [])
      setScanCount(box?.itemCount || scanCount)
    }
  }

  const toggleItemList = () => {
    if (!showItemList) fetchActiveBoxItems()
    setShowItemList(!showItemList)
  }

  useEffect(() => {
    if (activeBox && !noBarcodeStep) {
      const timer = setTimeout(() => startScanner(), 300)
      return () => { clearTimeout(timer); stopScanner() }
    }
  }, [activeBox, noBarcodeStep])

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

    if (isKickstart) {
      // Accept any 8+ digit numeric barcode
      if (decodedText.length < 8 || !/^\d+$/.test(decodedText)) return
      processingRef.current = true
      const normalizedUpc = normalizeBarcode(decodedText)

      try {
        // Look up in kickstart_intake by UPC, excluding already-bundled
        const { data: bundledData } = await supabase
          .from('kickstart_bundle_scans')
          .select('intake_id')

        const bundledIds = new Set((bundledData || []).map(s => s.intake_id))

        const { data: intakeMatches } = await supabase
          .from('kickstart_intake')
          .select('id, brand, description, color')
          .eq('upc', normalizedUpc)
          .in('status', ['enriched', 'pending_enrichment'])

        const available = (intakeMatches || []).filter(i => !bundledIds.has(i.id))

        if (available.length === 0) {
          setLastScan({ barcode: normalizedUpc, notFound: true })
          return
        }

        const intake = available[0]

        await supabase.from('kickstart_bundle_scans').insert({
          box_number: activeBox,
          intake_id: intake.id
        })

        const newCount = scanCountRef.current + 1
        scanCountRef.current = newCount
        setScanCount(newCount)
        setLastScan({
          barcode: decodedText,
          description: [intake.brand, intake.description, intake.color].filter(Boolean).join(' — ')
        })

        if (newCount >= 40) {
          await supabase.from('kickstart_bundle_boxes')
            .update({ status: 'complete' })
            .eq('box_number', activeBox)
          await stopScanner()
          setTimeout(() => { alert('Box complete! 40 items reached.'); closeScanner() }, 500)
        }
      } catch (e) {
        console.error('Scan error:', e)
        setLastScan({ barcode: decodedText, error: true })
      }
    } else {
      // Jumpstart: must start with 099
      if (!decodedText.startsWith('099')) return
      processingRef.current = true
      try {
        await supabase.from('jumpstart_bundle_scans').insert({
          box_number: activeBox,
          barcode: decodedText
        })

        const newCount = scanCountRef.current + 1
        scanCountRef.current = newCount
        setScanCount(newCount)
        setLastScan({ barcode: decodedText })

        if (newCount >= 40) {
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
  }

  const handleNext = () => { processingRef.current = false; setLastScan(null) }

  // === No Barcode picker (Kickstart only) ===
  const handleNoBarcode = async () => {
    await stopScanner()
    setNoBarcodeStep('size')
  }

  const fetchNoBarcodeItems = async (size) => {
    setNoBarcodeLoading(true)
    setNoBarcodeSize(size)
    try {
      let query = supabase
        .from('kickstart_intake')
        .select('id, brand, description, color, condition, size')
        .in('status', ['enriched', 'pending_enrichment'])
      if (size) query = query.eq('size', size)
      const { data: intakeItems } = await query

      // Get already-bundled intake_ids
      const { data: bundledData } = await supabase
        .from('kickstart_bundle_scans')
        .select('intake_id')
      const bundledIds = new Set((bundledData || []).map(s => s.intake_id))

      // Get already-sold intake_ids
      const { data: soldData } = await supabase
        .from('kickstart_sold_scans')
        .select('intake_id')
        .not('intake_id', 'is', null)
      const soldIds = new Set((soldData || []).map(s => s.intake_id))

      const available = (intakeItems || [])
        .filter(item => !bundledIds.has(item.id) && !soldIds.has(item.id))
        .sort((a, b) => b.id - a.id)

      // Extract unique categories with counts
      const catCounts = {}
      for (const item of available) {
        const cat = item.description || 'Uncategorized'
        catCounts[cat] = (catCounts[cat] || 0) + 1
      }
      const cats = Object.entries(catCounts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)

      setNoBarcodeAllItems(available)
      setNoBarcodeCategories(cats)

      if (cats.length <= 1) {
        setNoBarcodeItems(available.map(item => ({
          brand: item.brand, description: item.description, color: item.color,
          condition: item.condition, size: item.size, ids: [item.id]
        })))
        // Group even single-category items
        groupAndSetItems(available)
        setNoBarcodeStep('pickItem')
      } else {
        setNoBarcodeStep('category')
      }
    } catch (err) {
      console.error('Error fetching no-barcode items:', err)
    }
    setNoBarcodeLoading(false)
  }

  const groupAndSetItems = (items) => {
    const groups = new Map()
    for (const item of items) {
      const key = `${item.brand}||${item.description || ''}||${item.color || ''}||${item.condition || ''}`
      if (!groups.has(key)) {
        groups.set(key, { brand: item.brand, description: item.description, color: item.color, condition: item.condition, size: item.size, ids: [] })
      }
      groups.get(key).ids.push(item.id)
    }
    setNoBarcodeItems(Array.from(groups.values()).sort((a, b) => b.ids.length - a.ids.length))
  }

  const handleNoBarcodeCategory = (category) => {
    setNoBarcodeCategory(category)
    const filtered = category
      ? noBarcodeAllItems.filter(i => (i.description || 'Uncategorized') === category)
      : noBarcodeAllItems
    groupAndSetItems(filtered)
    setNoBarcodeStep('pickItem')
  }

  const handlePickNoBarcodeItem = async (group) => {
    const intakeId = group.ids[0]
    try {
      await supabase.from('kickstart_bundle_scans').insert({
        box_number: activeBox,
        intake_id: intakeId
      })

      const newCount = scanCountRef.current + 1
      scanCountRef.current = newCount
      setScanCount(newCount)
      setLastScan({
        description: [group.brand, group.description, group.color].filter(Boolean).join(' — '),
        added: true
      })

      // Reset picker state
      setNoBarcodeStep(null)
      setNoBarcodeSize(null)
      setNoBarcodeCategory(null)
      setNoBarcodeCategories([])
      setNoBarcodeItems([])
      setNoBarcodeAllItems([])

      if (newCount >= 40) {
        await supabase.from('kickstart_bundle_boxes')
          .update({ status: 'complete' })
          .eq('box_number', activeBox)
        await stopScanner()
        setTimeout(() => { alert('Box complete! 40 items reached.'); closeScanner() }, 500)
      }
    } catch (e) {
      console.error('Error adding item:', e)
    }
  }

  const cancelNoBarcode = async () => {
    setNoBarcodeStep(null)
    setNoBarcodeSize(null)
    setNoBarcodeCategory(null)
    setNoBarcodeCategories([])
    setNoBarcodeItems([])
    setNoBarcodeAllItems([])
    await startScanner()
  }

  const createNewBox = async () => {
    const maxBox = boxes.reduce((max, b) => Math.max(max, b.boxNumber), 0)
    const newBoxNum = maxBox + 1
    const table = isKickstart ? 'kickstart_bundle_boxes' : 'jumpstart_bundle_boxes'
    const newBox = {
      boxNumber: newBoxNum,
      status: 'empty',
      note: '',
      itemCount: 0,
      items: [],
      ...(isKickstart ? { markupPercentage: 50 } : { pricePercentage: 10 })
    }
    setBoxes(prev => [newBox, ...prev])
    await supabase.from(table).insert({
      box_number: newBoxNum,
      status: 'empty',
      note: '',
      ...(isKickstart ? { markup_percentage: 50 } : {})
    })
    fetchBoxes()
  }

  const saveNote = async (boxNumber) => {
    const table = isKickstart ? 'kickstart_bundle_boxes' : 'jumpstart_bundle_boxes'
    await supabase.from(table)
      .update({ note: noteText })
      .eq('box_number', boxNumber)
    setEditingNote(null)
    fetchBoxes()
  }

  const reopenBox = async (boxNumber) => {
    const table = isKickstart ? 'kickstart_bundle_boxes' : 'jumpstart_bundle_boxes'
    await supabase.from(table)
      .update({ status: 'in-progress' })
      .eq('box_number', boxNumber)
    setViewingBox(null)
    fetchBoxes()
  }

  const markAsSold = async () => {
    setSavingSale(true)
    const items = viewingBox.manifestItems || []
    const table = isKickstart ? 'kickstart_bundle_boxes' : 'jumpstart_bundle_boxes'

    let calculatedPrice
    if (isKickstart) {
      const totalCost = items.reduce((sum, item) => sum + (item.cost || 0), 0)
      const markup = viewingBox.markupPercentage || 50
      calculatedPrice = totalCost * (1 + markup / 100)
    } else {
      const totalMsrp = items.reduce((sum, item) => sum + (item.msrp || 0), 0)
      const pct = viewingBox.pricePercentage || 10
      calculatedPrice = totalMsrp * (pct / 100)
    }

    await supabase.from(table)
      .update({
        sale_price: calculatedPrice,
        sold_at: new Date().toISOString()
      })
      .eq('box_number', viewingBox.boxNumber)
    setSavingSale(false)
    setShowSoldModal(false)
    const allBoxes = await fetchBoxes()
    const updated = allBoxes.find(b => b.boxNumber === viewingBox.boxNumber)
    if (updated) openBox(updated)
  }

  const clearSale = async () => {
    if (!confirm('Clear sale data for this box?')) return
    const table = isKickstart ? 'kickstart_bundle_boxes' : 'jumpstart_bundle_boxes'
    await supabase.from(table)
      .update({ sale_price: null, sold_at: null })
      .eq('box_number', viewingBox.boxNumber)
    const allBoxes = await fetchBoxes()
    const updated = allBoxes.find(b => b.boxNumber === viewingBox.boxNumber)
    if (updated) openBox(updated)
  }

  const savePercentage = async (newPercentage) => {
    const pct = parseFloat(newPercentage)
    if (isNaN(pct) || pct <= 0 || pct > (isKickstart ? 300 : 100)) return
    const table = isKickstart ? 'kickstart_bundle_boxes' : 'jumpstart_bundle_boxes'
    const field = isKickstart ? 'markup_percentage' : 'price_percentage'
    await supabase.from(table)
      .update({ [field]: pct })
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

      const doc = new jsPDF({ orientation: 'landscape' })
      const pageWidth = doc.internal.pageSize.getWidth()

      if (isKickstart) {
        // Kickstart PDF: cost + markup pricing
        const totalCost = items.reduce((sum, item) => sum + (item.cost || 0), 0)
        const totalMsrp = items.reduce((sum, item) => sum + (item.msrp || 0), 0)
        const markup = viewingBox.markupPercentage || 50
        const salePrice = totalCost * (1 + markup / 100)

        const tableWidth = 234
        const leftMargin = (pageWidth - tableWidth) / 2

        doc.setTextColor(0, 0, 0)
        doc.setFontSize(14)
        doc.setFont('helvetica', 'bold')
        doc.text(`BOX #${viewingBox.boxNumber} - Free People/UO/Anthro Liquidation Bundle`, leftMargin, 12)

        doc.setFontSize(9)
        doc.setFont('helvetica', 'normal')
        doc.text(`${items.length} Pieces | Mixed Brands & Categories`, leftMargin, 18)

        const tableData = items.map(item => [
          item.brand || '',
          item.description || 'Unknown',
          item.color || '',
          item.size || '',
          `$${(item.msrp || 0).toFixed(2)}`
        ])

        autoTable(doc, {
          startY: 22,
          head: [['Brand', 'Description', 'Color', 'Size', 'MSRP']],
          body: tableData,
          theme: 'grid',
          styles: { fontSize: 7, cellPadding: 1, lineWidth: 0.1 },
          headStyles: { fillColor: [120, 40, 100], textColor: 255, fontStyle: 'bold', fontSize: 7, cellPadding: 1.5, halign: 'left' },
          columnStyles: {
            0: { cellWidth: 40 },  // Brand
            1: { cellWidth: 90 },  // Description
            2: { cellWidth: 35 },  // Color
            3: { cellWidth: 25 },  // Size
            4: { cellWidth: 44, halign: 'right' }  // MSRP
          },
          margin: { left: leftMargin, right: leftMargin, top: 10, bottom: 10 },
          didParseCell: function(data) {
            if (data.section === 'head' && data.column.index === 4) {
              data.cell.styles.halign = 'right'
            }
          }
        })

        const tableRightEdge = leftMargin + tableWidth
        const finalY = doc.lastAutoTable.finalY + 5

        doc.setFontSize(9)
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(80, 80, 80)
        const avgPerItem = salePrice / items.length
        const detailText = `${items.length} items  •  $${avgPerItem.toFixed(2)} avg per item  •  Retail Value: $${totalMsrp.toFixed(2)} MSRP`
        doc.text(detailText, tableRightEdge, finalY, { align: 'right' })

        doc.setFontSize(12)
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(120, 40, 100)
        doc.text(`YOUR PRICE: $${salePrice.toFixed(2)}`, tableRightEdge, finalY + 6, { align: 'right' })

        doc.save(`Kickstart_Box_${viewingBox.boxNumber}_Manifest.pdf`)
      } else {
        // Jumpstart PDF (existing logic)
        const totalMsrp = items.reduce((sum, item) => sum + (item.msrp || 0), 0)
        const pricePercent = viewingBox.pricePercentage || 10
        const totalCustomerPrice = totalMsrp * (pricePercent / 100)

        const tableWidth = 234
        const leftMargin = (pageWidth - tableWidth) / 2

        doc.setTextColor(0, 0, 0)
        doc.setFontSize(14)
        doc.setFont('helvetica', 'bold')
        doc.text(`BOX #${viewingBox.boxNumber} - Madewell/J.Crew Liquidation Bundle`, leftMargin, 12)

        doc.setFontSize(9)
        doc.setFont('helvetica', 'normal')
        doc.text(`${items.length} Pieces | Mixed Categories`, leftMargin, 18)

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

        autoTable(doc, {
          startY: 22,
          head: [['Description', 'Color', 'Style', 'Size', 'Category', 'Vendor', 'MSRP', 'Your Price']],
          body: tableData,
          theme: 'grid',
          styles: { fontSize: 7, cellPadding: 1, lineWidth: 0.1 },
          headStyles: { fillColor: [30, 58, 138], textColor: 255, fontStyle: 'bold', fontSize: 7, cellPadding: 1.5, halign: 'left' },
          columnStyles: {
            0: { cellWidth: 75 },
            1: { cellWidth: 22 },
            2: { cellWidth: 20 },
            3: { cellWidth: 15 },
            4: { cellWidth: 32 },
            5: { cellWidth: 28 },
            6: { cellWidth: 20, halign: 'right' },
            7: { cellWidth: 22, halign: 'right' }
          },
          margin: { left: leftMargin, right: leftMargin, top: 10, bottom: 10 },
          didParseCell: function(data) {
            if (data.section === 'head' && (data.column.index === 6 || data.column.index === 7)) {
              data.cell.styles.halign = 'right'
            }
          }
        })

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
        doc.text(`YOUR PRICE: $${totalCustomerPrice.toFixed(2)}`, tableRightEdge, finalY + 6, { align: 'right' })

        doc.save(`Box_${viewingBox.boxNumber}_Manifest.pdf`)
      }
    } catch (err) {
      console.error('PDF generation error:', err)
      alert('Error generating PDF: ' + err.message)
    }
  }

  const completeBox = async (boxNumber) => {
    const table = isKickstart ? 'kickstart_bundle_boxes' : 'jumpstart_bundle_boxes'
    await supabase.from(table)
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
    const scanTable = isKickstart ? 'kickstart_bundle_scans' : 'jumpstart_bundle_scans'
    const boxTable = isKickstart ? 'kickstart_bundle_boxes' : 'jumpstart_bundle_boxes'
    await supabase.from(scanTable).delete().eq('box_number', box.boxNumber)
    await supabase.from(boxTable).delete().eq('box_number', box.boxNumber)
    fetchBoxes()
  }

  const deleteItem = async (boxNumber, id) => {
    if (!confirm('Delete this item?')) return
    const scanTable = isKickstart ? 'kickstart_bundle_scans' : 'jumpstart_bundle_scans'
    await supabase.from(scanTable).delete().eq('id', id)
    const allBoxes = await fetchBoxes()
    const updated = allBoxes.find(b => b.boxNumber === boxNumber)
    if (updated) openBox(updated)
    else setViewingBox(null)
  }

  const deleteActiveItem = async (id) => {
    if (!confirm('Delete this item?')) return
    const scanTable = isKickstart ? 'kickstart_bundle_scans' : 'jumpstart_bundle_scans'
    await supabase.from(scanTable).delete().eq('id', id)
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
          <h1 className="text-lg font-bold text-white">
            {isKickstart && <span className="text-fuchsia-400 text-sm mr-1">KS</span>}
            Box {activeBox}
          </h1>
          <div className="flex items-center gap-2">
            <button onClick={toggleItemList} className="bg-gradient-to-r from-cyan-500/20 to-blue-500/20 backdrop-blur-lg px-3 py-1.5 rounded-full border border-cyan-400/30 active:bg-cyan-500/30">
              <span className="text-cyan-300 font-bold text-sm">{scanCount}/40</span>
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-white/5">
          <div className={`h-full transition-all duration-500 ${isKickstart ? 'bg-gradient-to-r from-fuchsia-400 via-pink-500 to-rose-500' : 'bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-500'}`} style={{ width: `${progressPercent(scanCount)}%` }}></div>
        </div>

        {/* Item list overlay */}
        {showItemList ? (
          <div className="flex-1 overflow-y-auto p-4">
            <div className="flex items-center justify-between mb-4">
              <p className="text-white font-bold text-lg">{activeBoxItems.length} items scanned</p>
              <button onClick={() => setShowItemList(false)} className={`px-4 py-2 rounded-full text-white font-semibold text-sm shadow-lg ${isKickstart ? 'bg-gradient-to-r from-fuchsia-500 to-pink-600 shadow-fuchsia-500/30' : 'bg-gradient-to-r from-cyan-500 to-blue-600 shadow-cyan-500/30'}`}>
                Back to Scanner
              </button>
            </div>
            {activeBoxItems.length === 0 ? (
              <p className="text-slate-500 text-center py-8">No items yet</p>
            ) : (
              <div className="space-y-2">
                {activeBoxItems.map((item, i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-white/5 backdrop-blur-sm border border-white/10">
                    {isKickstart ? (
                      <div className="flex-1 min-w-0 mr-3">
                        <p className="text-white font-medium text-sm truncate">{item.description || 'Unknown'}</p>
                        <p className="text-slate-400 text-xs">{[item.brand, item.color, item.size].filter(Boolean).join(' · ')}</p>
                      </div>
                    ) : (
                      <p className="text-white font-mono font-medium text-base flex-1 min-w-0 mr-3">{item.barcode}</p>
                    )}
                    <button onClick={() => deleteActiveItem(item.id)} className="text-red-400 hover:text-red-300 w-8 h-8 rounded-full bg-red-500/10 hover:bg-red-500/20 flex items-center justify-center shrink-0 text-sm">
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : noBarcodeStep ? (
          /* No Barcode Picker (Kickstart only) */
          <div className="flex-1 flex flex-col items-center p-4 overflow-y-auto">
            {noBarcodeStep === 'size' && (
              <>
                <h2 className="text-xl font-bold text-white mb-1 mt-2">Select Size</h2>
                <p className="text-slate-400 mb-4 text-sm">What size is the item?</p>
                <div className="w-full max-w-sm grid grid-cols-2 gap-3 mb-4">
                  {['XS', 'S', 'M', 'L', 'XL', 'XXL', 'One Size'].map(s => (
                    <button
                      key={s}
                      onClick={() => fetchNoBarcodeItems(s)}
                      className="py-5 rounded-2xl bg-gradient-to-br from-fuchsia-500/80 to-pink-500/80 border-2 border-fuchsia-400/40 text-white font-black text-2xl shadow-xl shadow-fuchsia-500/20 hover:scale-105 active:scale-95 transition-all"
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => fetchNoBarcodeItems(null)}
                  className="w-full max-w-sm py-3 mt-1 rounded-2xl bg-white/10 border border-white/20 text-white/70 font-semibold text-lg hover:bg-white/20 transition-all"
                >
                  All Items
                </button>
                <button onClick={cancelNoBarcode} className="text-white/40 text-sm underline mt-3">Cancel</button>
              </>
            )}
            {noBarcodeStep === 'category' && (
              <>
                <h2 className="text-xl font-bold text-white mb-1 mt-2">Select Category</h2>
                <p className="text-slate-400 mb-4 text-sm">{noBarcodeAllItems.length} available {noBarcodeSize || 'All'} items</p>
                {noBarcodeLoading ? (
                  <p className="text-white/50 text-lg py-12">Loading...</p>
                ) : (
                  <div className="w-full max-w-sm space-y-2 mb-4">
                    {noBarcodeCategories.map(cat => (
                      <button
                        key={cat.name}
                        onClick={() => handleNoBarcodeCategory(cat.name)}
                        className="w-full text-left bg-white/5 border border-white/10 rounded-2xl px-4 py-4 hover:bg-white/10 active:scale-[0.98] transition-all flex items-center justify-between"
                      >
                        <span className="text-white font-semibold">{cat.name}</span>
                        <span className="text-fuchsia-300 font-bold text-sm bg-fuchsia-500/20 px-3 py-1 rounded-full">{cat.count}</span>
                      </button>
                    ))}
                    <button
                      onClick={() => handleNoBarcodeCategory(null)}
                      className="w-full py-3 mt-1 rounded-2xl bg-white/10 border border-white/20 text-white/70 font-semibold hover:bg-white/20 transition-all"
                    >
                      All Categories
                    </button>
                  </div>
                )}
                <div className="flex gap-3 w-full max-w-sm">
                  <button onClick={() => setNoBarcodeStep('size')} className="flex-1 py-3 rounded-2xl bg-white/10 border border-white/20 text-white font-semibold text-sm">
                    ← Back
                  </button>
                  <button onClick={cancelNoBarcode} className="flex-1 py-3 rounded-2xl bg-white/10 border border-white/20 text-white/50 font-semibold text-sm">
                    Cancel
                  </button>
                </div>
              </>
            )}
            {noBarcodeStep === 'pickItem' && (
              <>
                <h2 className="text-xl font-bold text-white mb-1 mt-2">{noBarcodeSize ? `Pick Item — ${noBarcodeSize}` : 'Pick Item'}{noBarcodeCategory ? ` — ${noBarcodeCategory}` : ''}</h2>
                <p className="text-slate-400 mb-4 text-sm">{noBarcodeItems.length} item group{noBarcodeItems.length !== 1 ? 's' : ''}</p>
                {noBarcodeLoading ? (
                  <p className="text-white/50 text-lg py-12">Loading...</p>
                ) : noBarcodeItems.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-white/50 text-lg mb-4">No available items{noBarcodeSize ? ` in size ${noBarcodeSize}` : ''}</p>
                    <button
                      onClick={() => setNoBarcodeStep('size')}
                      className="px-6 py-3 bg-white/10 rounded-2xl text-white font-semibold border border-white/20"
                    >
                      Try Another Size
                    </button>
                  </div>
                ) : (
                  <div className="w-full max-w-sm space-y-2 mb-4">
                    {noBarcodeItems.map((group, idx) => (
                      <button
                        key={idx}
                        onClick={() => handlePickNoBarcodeItem(group)}
                        className="w-full text-left bg-white/5 border border-white/10 rounded-2xl p-3 hover:bg-white/10 active:scale-[0.98] transition-all"
                      >
                        <div className="flex items-center gap-3">
                          <LazyPhoto intakeId={group.ids[0]} />
                          <div className="min-w-0 flex-1">
                            <p className="text-white font-semibold text-sm truncate">
                              {[group.description, group.color].filter(Boolean).join(' — ') || 'Unknown'}
                            </p>
                            <p className="text-slate-400 text-xs">
                              {[group.brand, group.size, group.condition].filter(Boolean).join(' · ')}
                            </p>
                          </div>
                          {group.ids.length > 1 && (
                            <span className="text-fuchsia-300 font-bold text-sm bg-fuchsia-500/20 px-3 py-1 rounded-full shrink-0">
                              {group.ids.length}
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex gap-3 w-full max-w-sm">
                  <button onClick={() => { noBarcodeCategories.length > 1 ? setNoBarcodeStep('category') : setNoBarcodeStep('size') }} className="flex-1 py-3 rounded-2xl bg-white/10 border border-white/20 text-white font-semibold text-sm">
                    ← Back
                  </button>
                  <button onClick={cancelNoBarcode} className="flex-1 py-3 rounded-2xl bg-white/10 border border-white/20 text-white/50 font-semibold text-sm">
                    Cancel
                  </button>
                </div>
              </>
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
                <div className={`absolute inset-0 flex flex-col items-center justify-center z-10 ${
                  lastScan.notFound ? 'bg-gradient-to-br from-amber-500 via-orange-500 to-red-500' :
                  lastScan.error ? 'bg-gradient-to-br from-red-500 via-red-600 to-red-700' :
                  lastScan.added ? 'bg-gradient-to-br from-fuchsia-500 via-pink-500 to-rose-500' :
                  'bg-gradient-to-br from-cyan-500 via-teal-500 to-emerald-500'
                }`}>
                  <div className="text-center mb-10">
                    {lastScan.notFound ? (
                      <>
                        <h2 className="text-4xl font-black text-white mb-4">NOT FOUND</h2>
                        <p className="text-xl text-white/90 font-semibold">No matching item in intake</p>
                        <p className="text-lg text-white/70 mt-2 font-mono">{lastScan.barcode}</p>
                      </>
                    ) : lastScan.error ? (
                      <>
                        <h2 className="text-4xl font-black text-white mb-4">ERROR</h2>
                        <p className="text-xl text-white/90 font-semibold">Try again</p>
                      </>
                    ) : (
                      <>
                        <h2 className="text-6xl font-black text-white mb-4 tracking-tight">
                          {lastScan.added ? 'ADDED ✓' : 'SCANNED ✓'}
                        </h2>
                        <p className="text-2xl text-white/90 font-semibold">Place in Box {activeBox}</p>
                        {lastScan.description && (
                          <p className="text-lg text-white/70 mt-2">{lastScan.description}</p>
                        )}
                      </>
                    )}
                  </div>
                  <button onClick={handleNext} className="bg-white/95 hover:bg-white text-slate-900 font-bold text-xl px-16 py-4 rounded-2xl shadow-2xl shadow-black/30 hover:scale-105 transition-all active:scale-95">
                    Next Scan
                  </button>
                </div>
              )}
            </div>

            {/* No Barcode button (Kickstart only) */}
            {isKickstart && !lastScan && (
              <div className="px-4 pb-4">
                <button
                  onClick={handleNoBarcode}
                  className="w-full py-4 rounded-2xl font-bold text-lg bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg shadow-amber-500/30 border border-amber-400/50 active:scale-[0.97] transition-all"
                >
                  No Barcode
                </button>
              </div>
            )}
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
    const totalCost = isKickstart
      ? manifestItems.reduce((sum, item) => sum + (item.cost || 0), 0)
      : manifestItems.reduce((sum, item) => sum + (item.cost_freight || item.cost || 0), 0)
    const totalMsrp = manifestItems.reduce((sum, item) => sum + (item.msrp || 0), 0)
    const isSold = viewingBox.salePrice != null

    // Pricing differs by channel
    let customerPrice, pricingLabel, pricingParam
    if (isKickstart) {
      pricingParam = viewingBox.markupPercentage || 50
      customerPrice = totalCost * (1 + pricingParam / 100)
      pricingLabel = `+${pricingParam}%`
    } else {
      pricingParam = viewingBox.pricePercentage || 10
      customerPrice = totalMsrp * (pricingParam / 100)
      pricingLabel = `${pricingParam}%`
    }
    const profit = customerPrice - totalCost
    const margin = customerPrice > 0 ? (profit / customerPrice) * 100 : null

    return (
      <div className="min-h-screen flex flex-col bg-[#0a0f1a]">
        <div className={`fixed inset-0 bg-gradient-to-br ${isKickstart ? 'from-fuchsia-900/20 via-transparent to-pink-900/10' : 'from-pink-900/20 via-transparent to-fuchsia-900/10'} pointer-events-none`} />
        {/* Header */}
        <div className="p-3 flex items-center justify-between backdrop-blur-xl bg-white/5 border-b border-white/10">
          <button onClick={() => { setViewingBox(null); fetchBoxes() }} className="bg-white/10 hover:bg-white/20 backdrop-blur-lg w-10 h-10 rounded-full border border-white/20 text-white font-bold text-lg flex items-center justify-center">
            ←
          </button>
          <h1 className="text-lg font-bold text-white">
            {isKickstart && <span className="text-fuchsia-400 text-sm mr-1">KS</span>}
            Box {viewingBox.boxNumber}
          </h1>
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
          <div className={`h-full transition-all duration-500 ${isSold ? 'bg-gradient-to-r from-emerald-400 to-green-500' : isComplete ? (isKickstart ? 'bg-gradient-to-r from-fuchsia-400 to-pink-500' : 'bg-gradient-to-r from-fuchsia-400 to-purple-500') : (isKickstart ? 'bg-gradient-to-r from-fuchsia-400 via-pink-500 to-rose-500' : 'bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-500')}`} style={{ width: `${pct}%` }}></div>
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
              onClick={() => { setEditingPercentage(true); setTempPercentage(String(pricingParam)); }}
            >
              <p className="text-2xl font-bold text-emerald-400">${customerPrice.toFixed(2)}</p>
              <p className="text-xs text-emerald-300/60">Price ({pricingLabel})</p>
            </div>
          </div>

          {/* Percentage / Markup editor */}
          {editingPercentage && (
            <div className="bg-slate-800/80 rounded-xl p-3 mb-3 border border-white/10">
              <p className="text-xs text-slate-400 mb-2">
                {isKickstart ? 'Adjust markup on cost' : 'Adjust pricing percentage'}
              </p>
              <div className="flex gap-2">
                {(isKickstart ? [25, 50, 75, 100] : [8, 10, 12, 15]).map(pctVal => (
                  <button
                    key={pctVal}
                    onClick={() => savePercentage(pctVal)}
                    className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
                      pricingParam === pctVal
                        ? 'bg-emerald-500 text-white'
                        : 'bg-white/10 text-white hover:bg-white/20'
                    }`}
                  >
                    {isKickstart ? `+${pctVal}%` : `${pctVal}%`}
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

          {/* Profit preview */}
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
              <button onClick={() => startScanningBox(viewingBox)} className={`flex-1 py-3 rounded-xl text-white font-bold text-sm shadow-lg active:scale-[0.98] transition-all ${isKickstart ? 'bg-gradient-to-r from-fuchsia-500 to-pink-600 shadow-fuchsia-500/25' : 'bg-gradient-to-r from-cyan-500 to-blue-600 shadow-cyan-500/25'}`}>
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

        {/* Items list */}
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
                          {isKickstart
                            ? [item.brand, item.description].filter(Boolean).join(' — ') || 'Unknown item'
                            : item.description || 'Unknown item'
                          }
                        </p>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-xs text-slate-400">
                          {item.color && <span>{item.color}</span>}
                          {item.size && <span>Size: {item.size}</span>}
                          {!isKickstart && item.category && <span>{item.category}</span>}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-fuchsia-400 font-semibold text-sm">${(isKickstart ? (item.cost || 0) : (item.cost_freight || item.cost || 0)).toFixed(2)}</p>
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
                  <span className="text-slate-500">
                    {isKickstart
                      ? `Cost $${totalCost.toFixed(2)} + ${pricingParam}% markup`
                      : `${pricingParam}% of $${totalMsrp.toFixed(2)} MSRP`
                    }
                  </span>
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
      <div className={`fixed inset-0 bg-gradient-to-br ${isKickstart ? 'from-fuchsia-900/20 via-transparent to-pink-900/10' : 'from-pink-900/20 via-transparent to-fuchsia-900/10'} pointer-events-none`} />
      {/* Header */}
      <div className="p-3 backdrop-blur-xl bg-white/5 border-b border-white/10">
        <div className="flex items-center justify-between">
          <button onClick={() => navigate('/')} className="bg-white/10 hover:bg-white/20 backdrop-blur-lg px-4 py-2 rounded-full border border-white/20 text-white font-semibold text-sm shrink-0">
            ← Home
          </button>
          <h1 className="text-lg font-bold text-white shrink-0">Bundle Sort</h1>
          <button onClick={createNewBox} className={`px-4 py-2 rounded-full text-white font-semibold text-sm shadow-lg shrink-0 ${isKickstart ? 'bg-gradient-to-r from-fuchsia-500 to-pink-600 hover:from-fuchsia-400 hover:to-pink-500 shadow-fuchsia-500/30' : 'bg-gradient-to-r from-fuchsia-500 to-purple-600 hover:from-fuchsia-400 hover:to-purple-500 shadow-fuchsia-500/30'}`}>
            ＋ New
          </button>
        </div>
        {/* Channel toggle */}
        <div className="flex gap-1 mt-2 bg-white/5 rounded-xl p-1">
          {['Jumpstart', 'Kickstart'].map(ch => (
            <button
              key={ch}
              onClick={() => setChannel(ch)}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
                channel === ch
                  ? (ch === 'Kickstart'
                    ? 'bg-gradient-to-r from-fuchsia-500 to-pink-600 text-white shadow-lg shadow-fuchsia-500/30'
                    : 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-lg shadow-cyan-500/30')
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              {ch}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-3">
        {loading && (
          <div className="text-center py-12">
            <div className={`w-12 h-12 border-4 ${isKickstart ? 'border-fuchsia-400/30 border-t-fuchsia-400' : 'border-purple-400/30 border-t-purple-400'} rounded-full animate-spin mb-4 mx-auto`}></div>
            <p className="text-slate-400">Loading boxes...</p>
          </div>
        )}
        {!loading && boxes.length === 0 && (
          <div className="text-center py-16">
            <p className="text-slate-300 text-lg mb-6">No {channel} boxes yet</p>
            <button onClick={createNewBox} className={`px-8 py-3 rounded-full text-white font-bold text-lg shadow-xl ${isKickstart ? 'bg-gradient-to-r from-fuchsia-500 to-pink-600 shadow-fuchsia-500/30' : 'bg-gradient-to-r from-fuchsia-500 to-purple-600 shadow-fuchsia-500/30'}`}>
              ＋ Create Box 1
            </button>
          </div>
        )}
        {boxes.map(box => {
          const pct = progressPercent(box.itemCount)
          const isSold = box.salePrice != null
          const statusColor = isSold ? 'from-emerald-500/20 to-green-500/20' :
                              box.status === 'complete' ? (isKickstart ? 'from-fuchsia-500/20 to-pink-500/20' : 'from-fuchsia-500/20 to-purple-500/20') :
                              box.status === 'in-progress' ? (isKickstart ? 'from-fuchsia-500/20 to-rose-500/20' : 'from-cyan-500/20 to-blue-500/20') : 'from-slate-500/20 to-slate-600/20'
          const borderColor = isSold ? 'border-emerald-400/30' :
                              box.status === 'complete' ? 'border-fuchsia-400/30' :
                              box.status === 'in-progress' ? (isKickstart ? 'border-fuchsia-400/30' : 'border-cyan-400/30') : 'border-white/10'
          const statusText = isSold ? `Sold · $${box.salePrice.toFixed(2)}` :
                             box.status === 'complete' ? 'Complete' : box.status === 'in-progress' ? 'In Progress' : 'Empty'

          return (
            <div key={box.boxNumber} className={`rounded-2xl bg-gradient-to-r ${statusColor} backdrop-blur-lg border ${borderColor} overflow-hidden max-w-full`}>
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
                <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-500 ${
                    isSold ? 'bg-gradient-to-r from-emerald-400 to-green-500' :
                    box.status === 'complete' ? (isKickstart ? 'bg-gradient-to-r from-fuchsia-400 to-pink-500' : 'bg-gradient-to-r from-fuchsia-400 to-purple-500') :
                    (isKickstart ? 'bg-gradient-to-r from-fuchsia-400 via-pink-500 to-rose-500' : 'bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-500')
                  }`} style={{ width: `${pct}%` }}></div>
                </div>
              </div>
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
                    <button onClick={() => saveNote(box.boxNumber)} className={`px-3 py-2 rounded-xl text-white text-xs font-semibold shrink-0 ${isKickstart ? 'bg-gradient-to-r from-fuchsia-500 to-pink-600' : 'bg-gradient-to-r from-cyan-500 to-blue-600'}`}>
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
