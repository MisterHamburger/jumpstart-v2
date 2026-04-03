import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Html5Qrcode } from 'html5-qrcode'
import { supabase } from '../lib/supabase'
import { normalizeBarcode } from '../lib/barcodes'
import jsPDF from 'jspdf'

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
  const [shippingCharged, setShippingCharged] = useState('')
  const [shippingCost, setShippingCost] = useState('')
  const [editingPercentage, setEditingPercentage] = useState(false)
  const [tempPercentage, setTempPercentage] = useState('')
  const [tempPrice, setTempPrice] = useState('')
  const [editingPrice, setEditingPrice] = useState(false)
  const [editingCost, setEditingCost] = useState(false)
  const [tempEditPrice, setTempEditPrice] = useState('')
  const [tempEditCost, setTempEditCost] = useState('')
  const [editingItemIdx, setEditingItemIdx] = useState(null) // index of item being edited
  const [editingItemField, setEditingItemField] = useState(null) // 'cost' or 'price'
  const [tempItemValue, setTempItemValue] = useState('')
  // Kickstart No Barcode picker state
  const [noBarcodeStep, setNoBarcodeStep] = useState(null) // null | 'size' | 'category' | 'pickItem'
  const [noBarcodeSize, setNoBarcodeSize] = useState(null)
  const [noBarcodeCategory, setNoBarcodeCategory] = useState(null)
  const [noBarcodeCategories, setNoBarcodeCategories] = useState([])
  const [noBarcodeItems, setNoBarcodeItems] = useState([])
  const [noBarcodeAllItems, setNoBarcodeAllItems] = useState([])
  const [noBarcodeLoading, setNoBarcodeLoading] = useState(false)
  const [noBarcodeQty, setNoBarcodeQty] = useState(1)
  const [noBarcodeSelectedGroup, setNoBarcodeSelectedGroup] = useState(null)
  const [noBarcodeFlaws, setNoBarcodeFlaws] = useState(false)
  // New Box modal state
  const [showNewBoxModal, setShowNewBoxModal] = useState(false)
  const [newBoxTargetQty, setNewBoxTargetQty] = useState(40)
  const [newBoxMode, setNewBoxMode] = useState('fixed') // 'fixed' | 'unlimited' | 'rdm'
  const [rdmSalePrice, setRdmSalePrice] = useState('')
  const [rdmBuyerName, setRdmBuyerName] = useState('')
  const [rdmBundles, setRdmBundles] = useState([])
  // Active box target quantity (null = unlimited, N = fixed)
  const [activeBoxTarget, setActiveBoxTarget] = useState(40)
  const html5QrcodeRef = useRef(null)
  const processingRef = useRef(false)
  const scanCountRef = useRef(0)
  const onScanSuccessRef = useRef(null)
  const [hardwareInput, setHardwareInput] = useState('')
  const hardwareInputRef = useRef(null)
  const hardwareTimerRef = useRef(null)

  const isKickstart = channel === 'Kickstart'

  // Reset state + re-fetch when channel changes
  useEffect(() => {
    setActiveBox(null)
    setViewingBox(null)
    setLastScan(null)
    setShowItemList(false)
    setActiveBoxItems([])
    setNoBarcodeStep(null)
    setRdmBundles([])
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
          shippingCharged: b.shipping_charged || 0,
          shippingCost: b.shipping_cost || 0,
          markupPercentage: b.markup_percentage || 25,
          priceOverride: b.price_override || null,
          costOverride: b.cost_override || null,
          targetQuantity: b.target_quantity,
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

        const { data: countRows } = await supabase.rpc('get_bundle_scan_counts')
        const scanCountByBox = {}
        ;(countRows || []).forEach(r => { scanCountByBox[r.box_number] = Number(r.scan_count) })

        const merged = (boxRows || []).map(b => ({
          boxNumber: b.box_number,
          status: b.status,
          note: b.note || '',
          salePrice: b.sale_price,
          soldAt: b.sold_at,
          shippingCharged: b.shipping_charged || 0,
          shippingCost: b.shipping_cost || 0,
          pricePercentage: b.price_percentage || 10,
          priceOverride: b.price_override || null,
          costOverride: b.cost_override || null,
          targetQuantity: b.target_quantity,
          itemCount: scanCountByBox[b.box_number] || 0,
          items: []
        }))

        setBoxes(merged)

        const { data: rdmRows } = await supabase
          .from('rdm_bundle_sales')
          .select('*')
          .order('sold_at', { ascending: false })
        setRdmBundles(rdmRows || [])

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
        .select('id, intake_id, scanned_at, cost_override, price_override')
        .eq('box_number', box.boxNumber)
        .order('scanned_at')

      if (scans && scans.length > 0) {
        const intakeIds = scans.map(s => s.intake_id)
        const { data: intakeData } = await supabase
          .from('kickstart_intake')
          .select('id, brand, description, color, size, condition, cost, true_cost, msrp, notes')
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
            condition: intake.condition,
            cost: intake.true_cost || intake.cost || 0,
            msrp: intake.msrp || 0,
            notes: intake.notes,
            cost_override: s.cost_override,
            price_override: s.price_override
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
    setActiveBoxTarget(box.targetQuantity != null ? box.targetQuantity : null)
    const count = box.itemCount || 0
    setScanCount(count)
    scanCountRef.current = count
    setLastScan(null)
    setShowItemList(false)
    setNoBarcodeStep(isKickstart ? 'size' : null)
  }

  const closeScanner = async () => {
    await stopScanner()
    setActiveBox(null)
    setActiveBoxTarget(40)
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
      const { data: scans } = await supabase
        .from('jumpstart_bundle_scans')
        .select('id, barcode, scanned_at')
        .eq('box_number', activeBox)
        .order('scanned_at', { ascending: false })
      const items = (scans || []).map(s => ({ id: s.id, barcode: s.barcode, timestamp: s.scanned_at }))
      setActiveBoxItems(items)
      setScanCount(items.length)
      scanCountRef.current = items.length
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

  // Re-focus hardware input when active box is set
  useEffect(() => {
    if (activeBox) setTimeout(() => hardwareInputRef.current?.focus(), 400)
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

        if (activeBoxTarget != null && newCount >= activeBoxTarget) {
          await supabase.from('kickstart_bundle_boxes')
            .update({ status: 'complete' })
            .eq('box_number', activeBox)
          await stopScanner()
          setTimeout(() => { alert(`Box complete! ${activeBoxTarget} items reached.`); closeScanner() }, 500)
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

        if (activeBoxTarget != null && newCount >= activeBoxTarget) {
          await supabase.from('jumpstart_bundle_boxes')
            .update({ status: 'complete' })
            .eq('box_number', activeBox)
          await stopScanner()
          setTimeout(() => { alert(`Box complete! ${activeBoxTarget} items reached.`); closeScanner() }, 500)
          return
        }
      } catch (e) {
        console.error('Scan error:', e)
        setLastScan({ barcode: decodedText, error: true })
      }
    }
  }
  onScanSuccessRef.current = onScanSuccess

  const handleNext = () => {
    processingRef.current = false
    setLastScan(null)
    setTimeout(() => hardwareInputRef.current?.focus(), 100)
  }

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

  const handlePickNoBarcodeItem = async (group, qty = 1) => {
    const ids = group.ids.slice(0, qty)
    const rows = ids.map(id => ({ box_number: activeBox, intake_id: id, has_flaws: noBarcodeFlaws }))
    try {
      await supabase.from('kickstart_bundle_scans').insert(rows)

      const newCount = scanCountRef.current + qty
      scanCountRef.current = newCount
      setScanCount(newCount)

      const desc = [group.brand, group.description, group.color].filter(Boolean).join(' — ')
      setLastScan({
        description: qty > 1 ? `Added ${qty} × ${desc}` : desc,
        added: true
      })

      // Reset picker state — Kickstart goes back to size, Jumpstart to camera
      setNoBarcodeStep(isKickstart ? 'size' : null)
      setNoBarcodeSize(null)
      setNoBarcodeCategory(null)
      setNoBarcodeCategories([])
      setNoBarcodeItems([])
      setNoBarcodeAllItems([])
      setNoBarcodeQty(1)
      setNoBarcodeSelectedGroup(null)
      setNoBarcodeFlaws(false)

      if (activeBoxTarget != null && newCount >= activeBoxTarget) {
        await supabase.from('kickstart_bundle_boxes')
          .update({ status: 'complete' })
          .eq('box_number', activeBox)
        await stopScanner()
        setTimeout(() => { alert(`Box complete! ${activeBoxTarget} items reached.`); closeScanner() }, 500)
      }
    } catch (e) {
      console.error('Error adding item:', e)
    }
  }

  const cancelNoBarcode = async () => {
    setNoBarcodeSize(null)
    setNoBarcodeCategory(null)
    setNoBarcodeCategories([])
    setNoBarcodeItems([])
    setNoBarcodeAllItems([])
    setNoBarcodeQty(1)
    setNoBarcodeSelectedGroup(null)
    setNoBarcodeFlaws(false)
    if (isKickstart) {
      setNoBarcodeStep('size')
    } else {
      setNoBarcodeStep(null)
      await startScanner()
    }
  }

  const createNewBox = () => {
    setNewBoxTargetQty(40)
    setNewBoxMode('fixed')
    setRdmSalePrice('')
    setRdmBuyerName('')
    setShowNewBoxModal(true)
  }

  const confirmCreateBox = async () => {
    if (newBoxMode === 'rdm') {
      const price = parseFloat(rdmSalePrice)
      if (!price || price <= 0) return
      await supabase.from('rdm_bundle_sales').insert({
        quantity: newBoxTargetQty,
        sale_price: price,
        buyer_name: rdmBuyerName.trim() || null,
        sold_at: new Date().toISOString()
      })
      setShowNewBoxModal(false)
      fetchBoxes()
      return
    }

    const maxBox = boxes.reduce((max, b) => Math.max(max, b.boxNumber), 0)
    const newBoxNum = maxBox + 1
    const table = isKickstart ? 'kickstart_bundle_boxes' : 'jumpstart_bundle_boxes'
    const targetQty = newBoxMode === 'unlimited' ? null : newBoxTargetQty
    const newBox = {
      boxNumber: newBoxNum,
      status: 'empty',
      note: '',
      itemCount: 0,
      items: [],
      targetQuantity: targetQty,
      ...(isKickstart ? { markupPercentage: 25 } : { pricePercentage: 10 })
    }
    setBoxes(prev => [newBox, ...prev])
    setShowNewBoxModal(false)
    await supabase.from(table).insert({
      box_number: newBoxNum,
      status: 'empty',
      note: '',
      target_quantity: targetQty,
      ...(isKickstart ? { markup_percentage: 25 } : {})
    })
    fetchBoxes()
  }

  const generateRdmInvoice = (bundle) => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const pageW = doc.internal.pageSize.getWidth()
    const mx = 20
    let y = 20

    const TEAL = [32, 178, 170]
    const DARK = [23, 23, 23]
    const GRAY4 = [163, 163, 163]

    // Header
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(22)
    doc.setTextColor(TEAL[0], TEAL[1], TEAL[2])
    doc.text('Jumpstart', mx, y)
    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(GRAY4[0], GRAY4[1], GRAY4[2])
    doc.text('INVOICE', pageW - mx, y, { align: 'right' })
    y += 8

    doc.setDrawColor(TEAL[0], TEAL[1], TEAL[2])
    doc.setLineWidth(0.5)
    doc.line(mx, y, pageW - mx, y)
    y += 10

    // Buyer + date
    const date = new Date(bundle.sold_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(GRAY4[0], GRAY4[1], GRAY4[2])
    doc.text('SOLD TO', mx, y)
    doc.text('DATE', pageW - mx - 40, y)
    y += 5
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(DARK[0], DARK[1], DARK[2])
    doc.text(bundle.buyer_name || 'Local Buyer', mx, y)
    doc.text(date, pageW - mx - 40, y)
    y += 14

    // Table header
    doc.setFillColor(245, 245, 245)
    doc.rect(mx, y - 4, pageW - mx * 2, 10, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(GRAY4[0], GRAY4[1], GRAY4[2])
    doc.text('DESCRIPTION', mx + 2, y + 2)
    doc.text('QTY', pageW - mx - 60, y + 2, { align: 'right' })
    doc.text('UNIT PRICE', pageW - mx - 30, y + 2, { align: 'right' })
    doc.text('TOTAL', pageW - mx, y + 2, { align: 'right' })
    y += 12

    // Line item
    const unitPrice = bundle.sale_price / bundle.quantity
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(11)
    doc.setTextColor(DARK[0], DARK[1], DARK[2])
    doc.text('RDM Items (Damaged / Salvage)', mx + 2, y)
    doc.text(`${bundle.quantity}`, pageW - mx - 60, y, { align: 'right' })
    doc.text(`$${unitPrice.toFixed(2)}`, pageW - mx - 30, y, { align: 'right' })
    doc.text(`$${bundle.sale_price.toFixed(2)}`, pageW - mx, y, { align: 'right' })
    y += 10

    doc.setDrawColor(220, 220, 220)
    doc.setLineWidth(0.3)
    doc.line(mx, y, pageW - mx, y)
    y += 10

    // Total
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.setTextColor(DARK[0], DARK[1], DARK[2])
    doc.text('TOTAL', pageW - mx - 30, y, { align: 'right' })
    doc.setTextColor(TEAL[0], TEAL[1], TEAL[2])
    doc.text(`$${bundle.sale_price.toFixed(2)}`, pageW - mx, y, { align: 'right' })

    doc.save(`rdm-invoice-${date}.pdf`)
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

  const markAsSold = async (finalPrice) => {
    setSavingSale(true)
    const table = isKickstart ? 'kickstart_bundle_boxes' : 'jumpstart_bundle_boxes'

    await supabase.from(table)
      .update({
        sale_price: finalPrice,
        sold_at: new Date().toISOString(),
        shipping_charged: parseFloat(shippingCharged) || 0,
        shipping_cost: parseFloat(shippingCost) || 0
      })
      .eq('box_number', viewingBox.boxNumber)
    setSavingSale(false)
    setShowSoldModal(false)
    setShippingCharged('')
    setShippingCost('')
    const allBoxes = await fetchBoxes()
    const updated = allBoxes.find(b => b.boxNumber === viewingBox.boxNumber)
    if (updated) openBox(updated)
  }

  const clearSale = async () => {
    if (!confirm('Clear sale data for this box?')) return
    const table = isKickstart ? 'kickstart_bundle_boxes' : 'jumpstart_bundle_boxes'
    await supabase.from(table)
      .update({ sale_price: null, sold_at: null, shipping_charged: 0, shipping_cost: 0 })
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

  const saveDirectPrice = async (priceStr) => {
    const price = parseFloat(priceStr)
    if (isNaN(price) || price <= 0) return
    const table = isKickstart ? 'kickstart_bundle_boxes' : 'jumpstart_bundle_boxes'
    await supabase.from(table)
      .update({ price_override: price })
      .eq('box_number', viewingBox.boxNumber)
    setEditingPrice(false)
    const allBoxes = await fetchBoxes()
    const updated = allBoxes.find(b => b.boxNumber === viewingBox.boxNumber)
    if (updated) openBox(updated)
  }

  const saveCostOverride = async (costStr) => {
    const cost = parseFloat(costStr)
    if (isNaN(cost) || cost <= 0) return
    const table = isKickstart ? 'kickstart_bundle_boxes' : 'jumpstart_bundle_boxes'
    await supabase.from(table)
      .update({ cost_override: cost })
      .eq('box_number', viewingBox.boxNumber)
    setEditingCost(false)
    const allBoxes = await fetchBoxes()
    const updated = allBoxes.find(b => b.boxNumber === viewingBox.boxNumber)
    if (updated) openBox(updated)
  }

  const clearPriceOverride = async () => {
    const table = isKickstart ? 'kickstart_bundle_boxes' : 'jumpstart_bundle_boxes'
    await supabase.from(table)
      .update({ price_override: null })
      .eq('box_number', viewingBox.boxNumber)
    setEditingPrice(false)
    const allBoxes = await fetchBoxes()
    const updated = allBoxes.find(b => b.boxNumber === viewingBox.boxNumber)
    if (updated) openBox(updated)
  }

  const clearCostOverride = async () => {
    const table = isKickstart ? 'kickstart_bundle_boxes' : 'jumpstart_bundle_boxes'
    await supabase.from(table)
      .update({ cost_override: null })
      .eq('box_number', viewingBox.boxNumber)
    setEditingCost(false)
    const allBoxes = await fetchBoxes()
    const updated = allBoxes.find(b => b.boxNumber === viewingBox.boxNumber)
    if (updated) openBox(updated)
  }

  const saveItemOverride = async (scanId, field, value) => {
    const val = parseFloat(value)
    if (isNaN(val) || val < 0) return
    await supabase.from('kickstart_bundle_scans')
      .update({ [field]: val || null })
      .eq('id', scanId)
    setEditingItemIdx(null)
    setEditingItemField(null)
    // Refresh box data
    const allBoxes = await fetchBoxes()
    const updated = allBoxes.find(b => b.boxNumber === viewingBox.boxNumber)
    if (updated) openBox(updated)
  }

  const deleteItemFromBox = async (scanId) => {
    const table = isKickstart ? 'kickstart_bundle_scans' : 'jumpstart_bundle_scans'
    await supabase.from(table).delete().eq('id', scanId)
    // If box was complete and now has fewer items, reopen it
    const boxTable = isKickstart ? 'kickstart_bundle_boxes' : 'jumpstart_bundle_boxes'
    await supabase.from(boxTable).update({ status: 'open' }).eq('box_number', viewingBox.boxNumber)
    const allBoxes = await fetchBoxes()
    const updated = allBoxes.find(b => b.boxNumber === viewingBox.boxNumber)
    if (updated) openBox(updated)
  }

  const [swipedItemIdx, setSwipedItemIdx] = useState(null)
  const [generatingPdf, setGeneratingPdf] = useState(false)

  const generatePDF = async () => {
    try {
      const items = viewingBox.manifestItems || []
      if (items.length === 0) { alert('No items to generate PDF'); return }
      setGeneratingPdf(true)

      // --- Compute pricing ---
      const totalMsrp = items.reduce((sum, item) => sum + (item.msrp || 0), 0)
      const avgMsrp = items.length > 0 ? totalMsrp / items.length : 0
      let salePrice, avgPerItem
      if (isKickstart) {
        const calcCost = items.reduce((sum, item) => sum + (item.cost || 0), 0)
        const totalCost = viewingBox.costOverride || calcCost
        const markup = viewingBox.markupPercentage || 25
        salePrice = viewingBox.priceOverride || (totalCost * (1 + markup / 100))
        avgPerItem = salePrice / items.length
      } else {
        const pricePercent = viewingBox.pricePercentage || 10
        salePrice = totalMsrp * (pricePercent / 100)
        avgPerItem = salePrice / items.length
      }

      // --- Fetch photos for Kickstart ---
      const photoMap = {}
      if (isKickstart) {
        const intakeIds = items.map(i => i.intake_id).filter(Boolean)
        for (let i = 0; i < intakeIds.length; i += 5) {
          const batch = intakeIds.slice(i, i + 5)
          const { data: photoData, error } = await supabase
            .from('kickstart_intake')
            .select('id, item_photo_data, photo_data')
            .in('id', batch)
          if (error) console.error('PDF photo fetch error:', error)
          ;(photoData || []).forEach(p => {
            const photo = p.item_photo_data || p.photo_data
            if (photo) photoMap[p.id] = photo
          })
        }
      }

      // --- Condition counts ---
      const conditions = {}
      items.forEach(item => { const c = item.condition || 'Unknown'; conditions[c] = (conditions[c] || 0) + 1 })
      const hasNWT = conditions['NWT'] > 0
      const hasNWOT = conditions['NWOT'] > 0

      // --- Labels ---
      const brandNames = isKickstart
        ? [...new Set(items.map(i => i.brand).filter(Boolean))]
        : [...new Set(items.map(i => i.vendor).filter(Boolean))]
      const brandTitle = brandNames.length > 0 ? brandNames.join(' · ') : (isKickstart ? 'Free People · UO · Anthro' : 'J.Crew · Madewell')
      const fmt = (n) => '$' + Math.round(n).toLocaleString()
      const fmt2 = (n) => '$' + n.toFixed(2)

      // --- jsPDF direct drawing ---
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
      const pageW = doc.internal.pageSize.getWidth()  // 297
      const pageH = doc.internal.pageSize.getHeight() // 210
      const mx = 18  // margin x
      const mt = 16  // margin top
      const cw = pageW - mx * 2  // content width ~261
      let y = mt

      // Colors
      const TEAL = [32, 178, 170]
      const DARK = [23, 23, 23]
      const GRAY4 = [163, 163, 163]   // neutral-400
      const GRAY3 = [212, 212, 212]   // neutral-300
      const GRAY2 = [229, 229, 229]   // neutral-200
      const GRAY1 = [245, 245, 245]   // neutral-100
      const GRAY0 = [250, 250, 250]   // neutral-50

      const setC = (c) => doc.setTextColor(c[0], c[1], c[2])
      const setD = (c) => doc.setDrawColor(c[0], c[1], c[2])
      const setF = (c) => doc.setFillColor(c[0], c[1], c[2])

      // Check page break
      const needsPage = (h) => {
        if (y + h > pageH - 12) { doc.addPage(); y = mt; return true }
        return false
      }

      // ========== BRAND TITLE ==========
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(16)
      setC(DARK)
      doc.text(brandTitle, mx, y + 5)
      y += 14

      // ========== STATS ROW + YOUR PRICE ==========
      // Layout: compact stats on left, YOUR PRICE on right with breathing room
      const statsY = y
      const statsLabelY = statsY
      const statsValueY = statsY + 8
      const statsColW = 42  // wide enough to not overlap

      // Metric 1: Pieces
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(6.5)
      setC(GRAY4)
      doc.text('PIECES', mx, statsLabelY)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(16)
      setC(DARK)
      doc.text(`${items.length}`, mx, statsValueY)

      // Divider 1
      setD(GRAY2)
      const divTop = statsLabelY - 2
      const divBot = statsValueY + 2
      doc.line(mx + statsColW - 4, divTop, mx + statsColW - 4, divBot)

      // Metric 2: Avg MSRP
      const m2x = mx + statsColW
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(6.5)
      setC(GRAY4)
      doc.text('AVG MSRP', m2x, statsLabelY)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(16)
      setC(DARK)
      doc.text(`$${avgMsrp.toFixed(2)}`, m2x, statsValueY)

      // Divider 2
      doc.line(mx + statsColW * 2 - 4, divTop, mx + statsColW * 2 - 4, divBot)

      // Metric 3: Condition
      const m3x = mx + statsColW * 2
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(6.5)
      setC(GRAY4)
      doc.text('CONDITION', m3x, statsLabelY)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(16)
      setC(DARK)
      const condText = hasNWT && hasNWOT ? 'NWT' : hasNWT ? 'NWT' : hasNWOT ? 'NWOT' : 'Mixed'
      doc.text(condText, m3x, statsValueY)
      if (hasNWT && hasNWOT) {
        const nwtW = doc.getTextWidth('NWT')
        doc.setFontSize(12)
        setC(GRAY3)
        doc.text(' + ', m3x + nwtW, statsValueY)
        const plusW = doc.getTextWidth(' + ')
        doc.setFontSize(16)
        setC(DARK)
        doc.text('NWOT', m3x + nwtW + plusW, statsValueY)
      }

      // Divider 3
      doc.line(mx + statsColW * 3 - 4, divTop, mx + statsColW * 3 - 4, divBot)

      // Metric 4: Retail Value
      const m4x = mx + statsColW * 3
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(6.5)
      setC(GRAY4)
      doc.text('RETAIL VALUE', m4x, statsLabelY)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(16)
      setC(DARK)
      doc.text(fmt(totalMsrp), m4x, statsValueY)

      // YOUR PRICE (right-aligned to same edge as MSRP values below)
      const priceRightEdge = mx + cw - 5  // same as rightX in item rows

      // Right-align all text to priceRightEdge
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(6.5)
      setC(GRAY4)
      doc.text('YOUR PRICE', priceRightEdge, statsLabelY, { align: 'right' })

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(26)
      setC(DARK)
      doc.text(fmt(salePrice), priceRightEdge, statsValueY + 3, { align: 'right' })

      // Teal left border — positioned to left of the price text
      const priceTextW = doc.getTextWidth(fmt(salePrice))
      setF(TEAL)
      doc.rect(priceRightEdge - priceTextW - 6, statsLabelY - 4, 0.8, 20, 'F')

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      setC(GRAY4)
      doc.text(`${fmt2(avgPerItem)} / item`, priceRightEdge, statsValueY + 9, { align: 'right' })

      y = statsValueY + 14

      // ========== DIVIDER ==========
      const contentRight = mx + cw
      setD(GRAY2)
      doc.line(mx, y, contentRight, y)
      y += 4

      // ========== ITEM ROWS ==========
      const photoSize = 14  // mm
      const rowH = isKickstart ? 20 : 16

      items.forEach((item) => {
        needsPage(rowH + 2)

        const brand = isKickstart ? (item.brand || '') : (item.vendor || '')
        const desc = item.description || 'Unknown'
        const category = isKickstart ? (item.notes || '') : (item.category || '')
        const color = item.color || ''
        const size = item.size || ''
        const style = !isKickstart ? (item.style || '') : ''
        const condition = item.condition || ''
        const msrp = item.msrp || 0

        let textX = mx

        // Photo (Kickstart only)
        if (isKickstart) {
          const rowCenterY = y + rowH / 2
          const photo = item.intake_id ? photoMap[item.intake_id] : null
          if (photo) {
            try {
              doc.addImage(`data:image/jpeg;base64,${photo}`, 'JPEG', mx, rowCenterY - photoSize / 2, photoSize, photoSize)
            } catch (e) {
              setF(GRAY0)
              doc.rect(mx, rowCenterY - photoSize / 2, photoSize, photoSize, 'F')
            }
          } else {
            setF(GRAY0)
            doc.rect(mx, rowCenterY - photoSize / 2, photoSize, photoSize, 'F')
          }
          textX = mx + photoSize + 6
        }

        // Brand
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(6)
        setC(TEAL)
        doc.text(brand.toUpperCase(), textX, y + 5)

        // Description
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(9)
        setC(DARK)
        let displayDesc = desc
        const maxW = cw - (textX - mx) - 55
        while (doc.getTextWidth(displayDesc) > maxW && displayDesc.length > 10) {
          displayDesc = displayDesc.slice(0, -1)
        }
        if (displayDesc !== desc) displayDesc += '...'
        doc.text(displayDesc, textX, y + 10)

        // Detail line
        const detailParts = []
        if (size) detailParts.push(`Size ${size}`)
        if (category) detailParts.push(category)
        if (color) detailParts.push(color)
        if (style) detailParts.push(style)
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(7)
        setC(GRAY4)
        doc.text(detailParts.join(' · '), textX, y + 14.5)

        // Right side: Condition badge + MSRP — at right edge
        const rightX = mx + cw - 5

        // MSRP
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(6)
        setC(GRAY4)
        doc.text('MSRP', rightX, y + 5, { align: 'right' })
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(10)
        setC(DARK)
        doc.text(`$${msrp.toFixed(0)}`, rightX, y + 11, { align: 'right' })

        // Condition badge (border-only, to left of MSRP)
        if (condition) {
          doc.setFont('helvetica', 'bold')
          doc.setFontSize(6)
          const isNwt = condition === 'NWT'
          const badgeTextColor = isNwt ? TEAL : GRAY4
          const badgeBorderColor = isNwt ? TEAL : GRAY3
          const bText = condition
          const bw = doc.getTextWidth(bText) + 5
          const bx = rightX - 22 - bw
          const by = y + rowH / 2 - 2.5
          setD(badgeBorderColor)
          doc.rect(bx, by, bw, 5, 'S')
          setC(badgeTextColor)
          doc.text(bText, bx + 2.5, by + 3.5)
        }

        // Bottom border
        setD(GRAY1)
        doc.line(mx, y + rowH, rightX + 2, y + rowH)

        y += rowH + 1
      })

      // ========== FOOTER ==========
      needsPage(12)
      y += 6
      setD(GRAY1)
      doc.line(mx, y, contentRight, y)
      y += 5
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6)
      setC(GRAY3)
      doc.text('Generated by Jumpstart Scanner', mx, y)

      // Save
      const filename = isKickstart
        ? `Kickstart_Bundle_${viewingBox.boxNumber}_Manifest.pdf`
        : `Bundle_${viewingBox.boxNumber}_Manifest.pdf`
      doc.save(filename)

    } catch (err) {
      console.error('PDF generation error:', err)
      alert('Error generating PDF: ' + err.message)
    } finally {
      setGeneratingPdf(false)
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

  const progressPercent = (count, target) => {
    if (target == null || target <= 0) return count > 0 ? 100 : 0
    return Math.min(100, Math.round((count / target) * 100))
  }

  // === SCANNER VIEW ===
  if (activeBox) {
    return (
      <div className="min-h-screen flex flex-col bg-navy">
        {/* Header */}
        <div className="p-3 flex items-center justify-between backdrop-blur-xl bg-white/5 border-b border-white/10">
          <button onClick={closeScanner} className="bg-white/10 hover:bg-white/20 backdrop-blur-lg w-10 h-10 rounded-full border border-white/20 flex items-center justify-center">
            <iconify-icon icon="lucide:chevron-left" class="text-white"></iconify-icon>
          </button>
          <h1 className="text-lg font-bold text-white font-heading">
            {isKickstart && <span className="text-fuchsia-400 text-sm mr-1">KS</span>}
            Box {activeBox}
          </h1>
          <div className="flex items-center gap-2">
            <button onClick={toggleItemList} className="bg-gradient-to-r from-cyan-500/20 to-blue-500/20 backdrop-blur-lg px-3 py-1.5 rounded-full border border-cyan-400/30 active:bg-cyan-500/30">
              <span className="text-cyan-300 font-bold text-sm">{activeBoxTarget != null ? `${scanCount}/${activeBoxTarget}` : `${scanCount} items`}</span>
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-white/5">
          <div className={`h-full transition-all duration-500 ${isKickstart ? 'bg-gradient-to-r from-fuchsia-400 via-pink-500 to-rose-500' : 'bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-500'}`} style={{ width: `${progressPercent(scanCount, activeBoxTarget)}%` }}></div>
        </div>

        {/* Item list overlay */}
        {showItemList ? (
          <div className="flex-1 overflow-y-auto p-4">
            <div className="flex items-center justify-between mb-4">
              <p className="text-white font-bold text-lg">{activeBoxItems.length} items scanned</p>
              <button onClick={() => setShowItemList(false)} className={`px-4 py-2 rounded-full text-white font-semibold text-sm shadow-lg ${isKickstart ? 'bg-cyan-600 hover:bg-cyan-500 shadow-cyan-500/30' : 'bg-cyan-600 hover:bg-cyan-500 shadow-cyan-500/30'}`}>
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
                <h2 className="text-xl font-bold text-white mb-1 mt-2 font-heading">Select Size</h2>
                <p className="text-slate-400 mb-4 text-sm">What size is the item?</p>
                <div className="w-full max-w-sm grid grid-cols-2 gap-3 mb-4">
                  {['XS', 'S', 'M', 'L', 'XL', 'XXL', 'One Size'].map(s => (
                    <button
                      key={s}
                      onClick={() => fetchNoBarcodeItems(s)}
                      className="py-5 rounded-2xl bg-cyan-600 hover:bg-cyan-500 border-2 border-cyan-400/40 text-white font-black text-2xl shadow-xl shadow-cyan-500/20 hover:scale-105 active:scale-95 transition-all"
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
                {activeBoxTarget === null && scanCount > 0 && (
                  <button
                    onClick={() => completeBox(activeBox)}
                    className="w-full max-w-sm py-4 mt-3 rounded-2xl font-bold text-lg bg-gradient-to-r from-emerald-500 to-green-600 text-white shadow-lg shadow-emerald-500/30 border border-emerald-400/50 active:scale-[0.97] transition-all"
                  >
                    Done Scanning ({scanCount} items)
                  </button>
                )}
                <button onClick={isKickstart ? closeScanner : cancelNoBarcode} className="text-white/40 text-sm underline mt-3">Cancel</button>
              </>
            )}
            {noBarcodeStep === 'category' && (
              <>
                <h2 className="text-xl font-bold text-white mb-1 mt-2 font-heading">Select Category</h2>
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
                <h2 className="text-xl font-bold text-white mb-1 mt-2 font-heading">{noBarcodeSize ? `Pick Item — ${noBarcodeSize}` : 'Pick Item'}{noBarcodeCategory ? ` — ${noBarcodeCategory}` : ''}</h2>
                <p className="text-slate-400 mb-2 text-sm">{noBarcodeItems.length} item group{noBarcodeItems.length !== 1 ? 's' : ''}</p>
                <button
                  onClick={() => setNoBarcodeFlaws(f => !f)}
                  className={`mb-4 px-4 py-2 rounded-full font-semibold text-sm transition-all active:scale-95 ${
                    noBarcodeFlaws
                      ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg shadow-amber-500/30 border border-amber-400/50'
                      : 'bg-white/5 text-white/40 border border-white/10'
                  }`}
                >
                  {noBarcodeFlaws ? 'Flaws: Yes' : 'Any Flaws?'}
                </button>
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
                        onClick={() => {
                          if (group.ids.length > 1) {
                            setNoBarcodeSelectedGroup(group)
                            setNoBarcodeQty(1)
                            setNoBarcodeStep('quantity')
                          } else {
                            handlePickNoBarcodeItem(group)
                          }
                        }}
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
            {noBarcodeStep === 'quantity' && noBarcodeSelectedGroup && (() => {
              const remaining = activeBoxTarget != null ? Math.max(1, activeBoxTarget - scanCount) : noBarcodeSelectedGroup.ids.length
              const maxQty = Math.min(noBarcodeSelectedGroup.ids.length, remaining)
              return (
                <>
                  <h2 className="text-xl font-bold text-white mb-1 mt-2 font-heading">How Many?</h2>
                  <p className="text-slate-400 mb-4 text-sm">{noBarcodeSelectedGroup.ids.length} available</p>

                  <div className="w-full max-w-sm flex flex-col items-center gap-4 mb-6">
                    <div className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-2xl p-3 w-full">
                      <LazyPhoto intakeId={noBarcodeSelectedGroup.ids[0]} />
                      <div className="min-w-0 flex-1">
                        <p className="text-white font-semibold text-sm truncate">
                          {[noBarcodeSelectedGroup.description, noBarcodeSelectedGroup.color].filter(Boolean).join(' — ') || 'Unknown'}
                        </p>
                        <p className="text-slate-400 text-xs">
                          {[noBarcodeSelectedGroup.brand, noBarcodeSelectedGroup.size, noBarcodeSelectedGroup.condition].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={() => setNoBarcodeFlaws(f => !f)}
                      className={`px-4 py-2 rounded-full font-semibold text-sm transition-all active:scale-95 ${
                        noBarcodeFlaws
                          ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg shadow-amber-500/30 border border-amber-400/50'
                          : 'bg-white/5 text-white/40 border border-white/10'
                      }`}
                    >
                      {noBarcodeFlaws ? 'Flaws: Yes' : 'Any Flaws?'}
                    </button>

                    <div className="flex items-center gap-6">
                      <button
                        onClick={() => setNoBarcodeQty(q => Math.max(1, q - 1))}
                        disabled={noBarcodeQty <= 1}
                        className="w-14 h-14 rounded-2xl bg-white/10 border border-white/20 text-white font-black text-2xl flex items-center justify-center disabled:opacity-30 active:scale-90 transition-all"
                      >
                        −
                      </button>
                      <span className="text-5xl font-black text-white w-20 text-center tabular-nums">{noBarcodeQty}</span>
                      <button
                        onClick={() => setNoBarcodeQty(q => Math.min(maxQty, q + 1))}
                        disabled={noBarcodeQty >= maxQty}
                        className="w-14 h-14 rounded-2xl bg-white/10 border border-white/20 text-white font-black text-2xl flex items-center justify-center disabled:opacity-30 active:scale-90 transition-all"
                      >
                        +
                      </button>
                    </div>

                    <button
                      onClick={() => handlePickNoBarcodeItem(noBarcodeSelectedGroup, noBarcodeQty)}
                      className="w-full py-4 rounded-2xl font-bold text-lg bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg shadow-cyan-500/30 border border-cyan-400/50 active:scale-[0.97] transition-all"
                    >
                      Add {noBarcodeQty} Item{noBarcodeQty !== 1 ? 's' : ''}
                    </button>
                  </div>

                  <div className="flex gap-3 w-full max-w-sm">
                    <button onClick={() => { setNoBarcodeStep('pickItem'); setNoBarcodeSelectedGroup(null); setNoBarcodeQty(1) }} className="flex-1 py-3 rounded-2xl bg-white/10 border border-white/20 text-white font-semibold text-sm">
                      ← Back
                    </button>
                    <button onClick={cancelNoBarcode} className="flex-1 py-3 rounded-2xl bg-white/10 border border-white/20 text-white/50 font-semibold text-sm">
                      Cancel
                    </button>
                  </div>
                </>
              )
            })()}
          </div>
        ) : (
          <>
            {/* Camera always running */}
            <div className="flex-1 flex flex-col items-center justify-center p-4 relative">
              <div className={`text-center mb-3 ${lastScan ? 'invisible' : ''}`}>
                <h2 className="text-2xl font-bold text-white mb-1 font-heading">Scan Barcode</h2>
              </div>
              <div id="nb-qr-reader" className="w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl shadow-cyan-500/20 border-2 border-cyan-400/30" style={{ maxHeight: '50vh' }}></div>
              {/* Hardware scanner input (Zebra) */}
              <input
                ref={hardwareInputRef}
                value={hardwareInput}
                onChange={e => {
                  const val = e.target.value
                  setHardwareInput(val)
                  clearTimeout(hardwareTimerRef.current)
                  hardwareTimerRef.current = setTimeout(() => {
                    const trimmed = val.trim()
                    setHardwareInput('')
                    if (trimmed.length > 5) onScanSuccessRef.current?.(trimmed)
                  }, 50)
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    clearTimeout(hardwareTimerRef.current)
                    const val = hardwareInput.trim()
                    setHardwareInput('')
                    if (val.length > 5) onScanSuccessRef.current?.(val)
                  }
                }}
                className="absolute opacity-0 w-px h-px top-0 left-0"
                autoComplete="off"
                inputMode="none"
              />
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
                        <h2 className="text-4xl font-black text-white mb-4 font-heading">NOT FOUND</h2>
                        <p className="text-xl text-white/90 font-semibold">No matching item in intake</p>
                        <p className="text-lg text-white/70 mt-2 font-mono">{lastScan.barcode}</p>
                      </>
                    ) : lastScan.error ? (
                      <>
                        <h2 className="text-4xl font-black text-white mb-4 font-heading">ERROR</h2>
                        <p className="text-xl text-white/90 font-semibold">Try again</p>
                      </>
                    ) : (
                      <>
                        <h2 className="text-6xl font-black text-white mb-4 tracking-tight font-heading">
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

            {/* Bottom buttons */}
            {!lastScan && (
              <div className="px-4 pb-4 space-y-2">
                {isKickstart && (
                  <button
                    onClick={handleNoBarcode}
                    className="w-full py-4 rounded-2xl font-bold text-lg bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg shadow-amber-500/30 border border-amber-400/50 active:scale-[0.97] transition-all"
                  >
                    No Barcode
                  </button>
                )}
                {activeBoxTarget === null && (
                  <button
                    onClick={() => completeBox(activeBox)}
                    className="w-full py-4 rounded-2xl font-bold text-lg bg-gradient-to-r from-emerald-500 to-green-600 text-white shadow-lg shadow-emerald-500/30 border border-emerald-400/50 active:scale-[0.97] transition-all"
                  >
                    Done Scanning ({scanCount} items)
                  </button>
                )}
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
    const pct = progressPercent(viewingBox.itemCount, viewingBox.targetQuantity)
    const manifestItems = viewingBox.manifestItems || []

    // Per-item effective cost and price helpers
    const getItemCost = (item) => item.cost_override != null ? item.cost_override : (isKickstart ? (item.cost || 0) : (item.cost_freight || item.cost || 0))
    const totalCost = viewingBox.costOverride || manifestItems.reduce((sum, item) => sum + getItemCost(item), 0)
    const totalMsrp = manifestItems.reduce((sum, item) => sum + (item.msrp || 0), 0)
    const isSold = viewingBox.salePrice != null

    // Pricing differs by channel
    let customerPrice, pricingLabel, pricingParam
    if (isKickstart) {
      pricingParam = viewingBox.markupPercentage || 25
      // Sum per-item price overrides, fall back to box override, fall back to markup calc
      const hasAnyItemPriceOverride = manifestItems.some(i => i.price_override != null)
      pricingLabel = `+${pricingParam}%`
      if (viewingBox.priceOverride) {
        customerPrice = viewingBox.priceOverride
      } else if (hasAnyItemPriceOverride) {
        customerPrice = manifestItems.reduce((sum, item) => {
          if (item.price_override != null) return sum + item.price_override
          return sum + getItemCost(item) * (1 + pricingParam / 100)
        }, 30)
      } else {
        customerPrice = totalCost * (1 + pricingParam / 100)
      }
    } else {
      pricingParam = viewingBox.pricePercentage || 10
      pricingLabel = `${pricingParam}%`
      customerPrice = viewingBox.priceOverride || (totalMsrp * (pricingParam / 100))
    }
    const getItemPrice = (item) => {
      if (item.price_override != null) return item.price_override
      if (isKickstart) return getItemCost(item) * (1 + pricingParam / 100)
      return (item.msrp || 0) * (pricingParam / 100)
    }
    const shippingProfit = (viewingBox.shippingCharged || 0) - (viewingBox.shippingCost || 0)
    const profit = customerPrice - totalCost + shippingProfit
    const totalRevenue = customerPrice + (viewingBox.shippingCharged || 0)
    const margin = totalRevenue > 0 ? (profit / totalRevenue) * 100 : null

    return (
      <div className="min-h-screen flex flex-col bg-navy">
        <div className={`fixed inset-0 bg-gradient-to-br ${isKickstart ? 'from-fuchsia-900/20 via-transparent to-pink-900/10' : 'from-pink-900/20 via-transparent to-fuchsia-900/10'} pointer-events-none`} />
        {/* Header */}
        <div className="p-3 flex items-center justify-between backdrop-blur-xl bg-white/5 border-b border-white/10">
          <button onClick={() => { setViewingBox(null); fetchBoxes() }} className="bg-white/10 hover:bg-white/20 backdrop-blur-lg w-10 h-10 rounded-full border border-white/20 flex items-center justify-center">
            <iconify-icon icon="lucide:chevron-left" class="text-white"></iconify-icon>
          </button>
          <h1 className="text-lg font-bold text-white font-heading">
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
          {(() => {
            const itemCount = viewingBox.itemCount || 1
            const msrpPerItem = totalMsrp / itemCount
            const costPerItem = totalCost / itemCount
            const pricePerItem = customerPrice / itemCount
            const profitPerItem = profit / itemCount
            return (<>
              <div className="grid grid-cols-4 gap-2 mb-2">
                {/* Items */}
                <div className="bg-white/5 rounded-xl p-2.5 text-center border border-white/10">
                  <p className="text-[10px] uppercase tracking-wider text-slate-400 mb-1">Items</p>
                  <p className="text-lg font-bold text-white">{viewingBox.itemCount}</p>
                </div>
                {/* MSRP */}
                <div className="bg-white/5 rounded-xl p-2.5 text-center border border-white/10">
                  <p className="text-[10px] uppercase tracking-wider text-slate-400 mb-1">MSRP</p>
                  <p className="text-lg font-bold text-cyan-400">${totalMsrp.toFixed(0)}</p>
                  <p className="text-sm font-semibold text-cyan-400/60">${msrpPerItem.toFixed(2)}/ea</p>
                </div>
                {/* Cost — tappable */}
                <div
                  className={`rounded-xl p-2.5 text-center border cursor-pointer transition-all ${editingCost ? 'bg-fuchsia-500/15 border-fuchsia-500/40' : 'bg-white/5 border-white/10 hover:border-fuchsia-400/30'}`}
                  onClick={() => { if (!editingCost) { setEditingCost(true); setEditingPrice(false); setEditingPercentage(false); setTempEditCost(totalCost.toFixed(2)); } }}
                >
                  <p className="text-[10px] uppercase tracking-wider text-slate-400 mb-1">Cost {viewingBox.costOverride ? '(edited)' : ''}</p>
                  <p className="text-lg font-bold text-fuchsia-400">${totalCost.toFixed(2)}</p>
                  <p className="text-sm font-semibold text-fuchsia-400/60">${costPerItem.toFixed(2)}/ea</p>
                </div>
                {/* Price — tappable */}
                <div
                  className={`rounded-xl p-2.5 text-center border cursor-pointer transition-all ${editingPrice || editingPercentage ? 'bg-emerald-500/15 border-emerald-500/40' : 'bg-emerald-500/10 border-emerald-500/30 hover:border-emerald-400/50'}`}
                  onClick={() => { if (!editingPrice && !editingPercentage) { setEditingPrice(true); setEditingCost(false); setTempEditPrice(customerPrice.toFixed(2)); } }}
                >
                  <p className="text-[10px] uppercase tracking-wider text-emerald-300/60 mb-1">Price {pricingLabel !== 'custom' ? `(${pricingLabel})` : '(custom)'}</p>
                  <p className="text-lg font-bold text-emerald-400">${customerPrice.toFixed(2)}</p>
                  <p className="text-sm font-semibold text-emerald-400/60">${pricePerItem.toFixed(2)}/ea</p>
                </div>
              </div>
            </>)
          })()}

          {/* Cost editor */}
          {editingCost && (
            <div className="glass-card rounded-xl p-3 mb-2 border border-fuchsia-500/30">
              <p className="text-xs text-slate-400 mb-2">Edit total cost</p>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/50 text-sm">$</span>
                  <input
                    type="number"
                    autoFocus
                    value={tempEditCost}
                    onChange={e => setTempEditCost(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && saveCostOverride(tempEditCost)}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl pl-7 pr-3 py-2.5 text-white text-base font-semibold focus:outline-none focus:border-cyan-500/50 focus:ring-4 focus:ring-cyan-500/10 transition-all"
                    placeholder="0.00"
                  />
                </div>
                <button onClick={() => saveCostOverride(tempEditCost)} className="px-4 py-2.5 rounded-lg bg-fuchsia-500/30 text-fuchsia-300 text-sm font-semibold">Save</button>
                <button onClick={() => setEditingCost(false)} className="px-3 py-2.5 rounded-lg bg-white/10 text-slate-400 text-sm">Cancel</button>
              </div>
              {viewingBox.costOverride && (
                <button onClick={clearCostOverride} className="text-xs text-slate-500 hover:text-slate-300 mt-2">Reset to calculated (${calculatedCost.toFixed(2)})</button>
              )}
            </div>
          )}

          {/* Price editor */}
          {editingPrice && (
            <div className="glass-card rounded-xl p-3 mb-2 border border-emerald-500/30">
              <p className="text-xs text-slate-400 mb-2">Set price directly</p>
              <div className="flex gap-2 mb-3">
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/50 text-sm">$</span>
                  <input
                    type="number"
                    autoFocus
                    value={tempEditPrice}
                    onChange={e => setTempEditPrice(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && saveDirectPrice(tempEditPrice)}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl pl-7 pr-3 py-2.5 text-white text-base font-semibold focus:outline-none focus:border-cyan-500/50 focus:ring-4 focus:ring-cyan-500/10 transition-all"
                    placeholder="0.00"
                  />
                </div>
                <button onClick={() => saveDirectPrice(tempEditPrice)} className="px-4 py-2.5 rounded-lg bg-emerald-500/30 text-emerald-300 text-sm font-semibold">Save</button>
                <button onClick={() => setEditingPrice(false)} className="px-3 py-2.5 rounded-lg bg-white/10 text-slate-400 text-sm">Cancel</button>
              </div>
              <p className="text-xs text-slate-400 mb-2">Or use markup presets</p>
              <div className="flex gap-2">
                {(isKickstart ? [25, 50, 75, 100] : [8, 10, 12, 15]).map(pctVal => (
                  <button
                    key={pctVal}
                    onClick={async () => {
                      const table = isKickstart ? 'kickstart_bundle_boxes' : 'jumpstart_bundle_boxes'
                      const field = isKickstart ? 'markup_percentage' : 'price_percentage'
                      await supabase.from(table).update({ [field]: pctVal, price_override: null }).eq('box_number', viewingBox.boxNumber)
                      setEditingPrice(false)
                      const allBoxes = await fetchBoxes()
                      const updated = allBoxes.find(b => b.boxNumber === viewingBox.boxNumber)
                      if (updated) openBox(updated)
                    }}
                    className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
                      !viewingBox.priceOverride && pricingParam === pctVal
                        ? 'bg-emerald-500 text-white'
                        : 'bg-white/10 text-white hover:bg-white/20'
                    }`}
                  >
                    {isKickstart ? `+${pctVal}%` : `${pctVal}%`}
                  </button>
                ))}
              </div>
              {viewingBox.priceOverride && (
                <button onClick={clearPriceOverride} className="text-xs text-slate-500 hover:text-slate-300 mt-2">Reset to markup calculation</button>
              )}
            </div>
          )}

          {/* Profit preview */}
          <div className={`rounded-xl p-3 mb-3 border ${profit >= 0 ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-400 mb-1">{isSold ? 'SOLD' : 'PROJECTED'} PROFIT</p>
                <p className={`text-xl font-bold ${profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {profit >= 0 ? '+' : ''}${profit.toFixed(2)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm text-slate-400">{margin?.toFixed(1)}% margin</p>
                {(viewingBox.itemCount || 0) > 0 && (
                  <p className={`text-sm font-semibold ${profit >= 0 ? 'text-emerald-400/60' : 'text-red-400/60'}`}>
                    {profit >= 0 ? '+' : ''}${(profit / viewingBox.itemCount).toFixed(2)}/item
                  </p>
                )}
              </div>
            </div>
            {isSold && viewingBox.shippingCharged > 0 && (
              <div className="flex justify-between text-xs text-slate-500 mt-2 pt-2 border-t border-white/5">
                <span>Shipping: charged ${viewingBox.shippingCharged.toFixed(2)} · cost ${viewingBox.shippingCost.toFixed(2)}</span>
                <span className={(viewingBox.shippingCharged - viewingBox.shippingCost) >= 0 ? 'text-emerald-400/60' : 'text-red-400/60'}>
                  {(viewingBox.shippingCharged - viewingBox.shippingCost) >= 0 ? '+' : ''}${(viewingBox.shippingCharged - viewingBox.shippingCost).toFixed(2)}
                </span>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            {!isComplete && (
              <button onClick={() => startScanningBox(viewingBox)} className={`flex-1 py-3 rounded-xl text-white font-bold text-sm shadow-lg active:scale-[0.98] transition-all ${isKickstart ? 'bg-cyan-600 hover:bg-cyan-500 shadow-cyan-500/25' : 'bg-cyan-600 hover:bg-cyan-500 shadow-cyan-500/25'}`}>
                Scan Items
              </button>
            )}
            {isComplete && !isSold && (
              <button onClick={() => setShowSoldModal(true)} className="flex-1 bg-gradient-to-r from-emerald-500 to-green-600 py-3 rounded-xl text-white font-bold text-sm shadow-lg shadow-emerald-500/25 active:scale-[0.98] transition-all">
                Mark as Sold
              </button>
            )}
            {isSold && (
              <button onClick={clearSale} className="flex-1 bg-gradient-to-r from-amber-500 to-orange-600 py-3 rounded-xl text-white font-bold text-sm shadow-lg shadow-amber-500/25 active:scale-[0.98] transition-all">
                Unsell Box
              </button>
            )}
            {isComplete && (
              <button onClick={generatePDF} disabled={generatingPdf} className={`flex-1 bg-cyan-600 hover:bg-cyan-500 py-3 rounded-xl text-white font-bold text-sm shadow-lg shadow-cyan-500/25 transition-all ${generatingPdf ? 'opacity-60' : 'active:scale-[0.98]'}`}>
                {generatingPdf ? 'Generating...' : 'Generate PDF'}
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
                {manifestItems.map((item, i) => {
                  return (
                  <div key={item.scan_id || i} className="bg-white/5 p-3 border border-white/10 rounded-xl">
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
                            <span>${(item.msrp || 0).toFixed(0)} MSRP</span>
                          </div>
                        </div>
                        <div className="flex items-start gap-3 shrink-0">
                          {/* Cost - tappable */}
                          <div className="text-right">
                            {editingItemIdx === i && editingItemField === 'cost' ? (
                              <input
                                type="number"
                                autoFocus
                                value={tempItemValue}
                                onChange={e => setTempItemValue(e.target.value)}
                                onBlur={() => saveItemOverride(item.scan_id, 'cost_override', tempItemValue)}
                                onKeyDown={e => { if (e.key === 'Enter') saveItemOverride(item.scan_id, 'cost_override', tempItemValue); if (e.key === 'Escape') { setEditingItemIdx(null); setEditingItemField(null); } }}
                                className="w-20 bg-fuchsia-500/20 border border-fuchsia-500/40 rounded px-1.5 py-0.5 text-fuchsia-300 text-sm text-right font-semibold"
                              />
                            ) : (
                              <p
                                className="text-fuchsia-400 font-semibold text-sm cursor-pointer hover:text-fuchsia-300 transition-colors"
                                onClick={() => { setEditingItemIdx(i); setEditingItemField('cost'); setTempItemValue(getItemCost(item).toFixed(2)); }}
                              >
                                ${getItemCost(item).toFixed(2)}
                              </p>
                            )}
                            <p className="text-fuchsia-400/40 text-[10px]">Cost{item.cost_override != null ? '*' : ''}</p>
                          </div>
                          {/* Price - tappable */}
                          <div className="text-right">
                            {editingItemIdx === i && editingItemField === 'price' ? (
                              <input
                                type="number"
                                autoFocus
                                value={tempItemValue}
                                onChange={e => setTempItemValue(e.target.value)}
                                onBlur={() => saveItemOverride(item.scan_id, 'price_override', tempItemValue)}
                                onKeyDown={e => { if (e.key === 'Enter') saveItemOverride(item.scan_id, 'price_override', tempItemValue); if (e.key === 'Escape') { setEditingItemIdx(null); setEditingItemField(null); } }}
                                className="w-20 bg-emerald-500/20 border border-emerald-500/40 rounded px-1.5 py-0.5 text-emerald-300 text-sm text-right font-semibold"
                              />
                            ) : (
                              <p
                                className="text-emerald-400 font-semibold text-sm cursor-pointer hover:text-emerald-300 transition-colors"
                                onClick={() => { setEditingItemIdx(i); setEditingItemField('price'); setTempItemValue(getItemPrice(item).toFixed(2)); }}
                              >
                                ${getItemPrice(item).toFixed(2)}
                              </p>
                            )}
                            <p className="text-emerald-400/40 text-[10px]">Price{item.price_override != null ? '*' : ''}</p>
                          </div>
                          {/* Delete button */}
                          <button
                            onClick={() => { if (confirm('Remove this item from the box?')) deleteItemFromBox(item.scan_id) }}
                            className="mt-0.5 w-7 h-7 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center hover:bg-red-500/30 transition-colors"
                          >
                            <span className="text-red-400 text-xs font-bold">X</span>
                          </button>
                        </div>
                      </div>
                  </div>
                  )
                })}
              </div>
            </>
          )}
        </div>

        {/* Mark as Sold Modal */}
        {showSoldModal && (() => {
          const modalShipCharged = parseFloat(shippingCharged) || 0
          const modalShipCost = parseFloat(shippingCost) || 0
          const modalShipProfit = modalShipCharged - modalShipCost
          const modalProfit = customerPrice - totalCost + modalShipProfit
          const modalTotalRevenue = customerPrice + modalShipCharged
          return (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="glass-card rounded-3xl p-6 w-full max-w-sm border border-white/10">
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
                  <span className={`font-semibold ${modalProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {modalProfit >= 0 ? '+' : ''}${modalProfit.toFixed(2)} profit
                  </span>
                </div>
              </div>

              {/* Shipping fields */}
              <div className="space-y-3 mb-4">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Shipping charged to customer</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
                    <input
                      type="number" inputMode="decimal" step="0.01" min="0"
                      value={shippingCharged} onChange={e => setShippingCharged(e.target.value)}
                      placeholder="0.00"
                      className="w-full bg-white/5 border border-white/10 rounded-2xl py-2.5 pl-7 pr-3 text-white text-sm focus:outline-none focus:border-cyan-500/50 focus:ring-4 focus:ring-cyan-500/10 transition-all"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Actual shipping cost</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
                    <input
                      type="number" inputMode="decimal" step="0.01" min="0"
                      value={shippingCost} onChange={e => setShippingCost(e.target.value)}
                      placeholder="0.00"
                      className="w-full bg-white/5 border border-white/10 rounded-2xl py-2.5 pl-7 pr-3 text-white text-sm focus:outline-none focus:border-cyan-500/50 focus:ring-4 focus:ring-cyan-500/10 transition-all"
                    />
                  </div>
                </div>
                {(modalShipCharged > 0 || modalShipCost > 0) && (
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>Shipping profit</span>
                    <span className={modalShipProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                      {modalShipProfit >= 0 ? '+' : ''}${modalShipProfit.toFixed(2)}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => { setShowSoldModal(false); setShippingCharged(''); setShippingCost('') }}
                  className="flex-1 bg-white/10 py-3 rounded-xl text-white font-semibold border border-white/10"
                >
                  Cancel
                </button>
                <button
                  onClick={() => markAsSold(customerPrice)}
                  disabled={savingSale}
                  className="flex-1 bg-gradient-to-r from-emerald-500 to-green-600 py-3 rounded-xl text-white font-bold disabled:opacity-50"
                >
                  {savingSale ? 'Saving...' : 'Confirm Sale'}
                </button>
              </div>
            </div>
          </div>
          )
        })()}
      </div>
    )
  }

  // === BOX LIST ===
  return (
    <div className="min-h-screen flex flex-col bg-navy overflow-x-hidden max-w-full">
      <div className={`fixed inset-0 bg-gradient-to-br ${isKickstart ? 'from-fuchsia-900/20 via-transparent to-pink-900/10' : 'from-pink-900/20 via-transparent to-fuchsia-900/10'} pointer-events-none`} />
      {/* Header */}
      <div className="p-3 backdrop-blur-xl bg-white/5 border-b border-white/10">
        <div className="flex items-center justify-between">
          <button onClick={() => navigate('/')} className="bg-white/10 hover:bg-white/20 backdrop-blur-lg px-4 py-2 rounded-full border border-white/20 text-white font-semibold text-sm shrink-0 flex items-center gap-1">
            <iconify-icon icon="lucide:chevron-left" class="text-white"></iconify-icon> Home
          </button>
          <h1 className="text-lg font-bold text-white shrink-0 font-heading">Bundle Sort</h1>
          <button onClick={createNewBox} className={`px-4 py-2 rounded-full text-white font-semibold text-sm shadow-lg shrink-0 ${isKickstart ? 'bg-cyan-600 hover:bg-cyan-500 shadow-cyan-500/30' : 'bg-cyan-600 hover:bg-cyan-500 shadow-cyan-500/30'}`}>
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
                    ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-500/30'
                    : 'bg-cyan-600 text-white shadow-lg shadow-cyan-500/30')
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
            <div className={`w-12 h-12 border-4 ${isKickstart ? 'border-cyan-400/30 border-t-cyan-400' : 'border-cyan-400/30 border-t-cyan-400'} rounded-full animate-spin mb-4 mx-auto`}></div>
            <p className="text-slate-400">Loading boxes...</p>
          </div>
        )}
        {!loading && boxes.length === 0 && (
          <div className="text-center py-16">
            <p className="text-slate-300 text-lg mb-6">No {channel} boxes yet</p>
            <button onClick={createNewBox} className={`px-8 py-3 rounded-full text-white font-bold text-lg shadow-xl ${isKickstart ? 'bg-cyan-600 hover:bg-cyan-500 shadow-cyan-500/30' : 'bg-cyan-600 hover:bg-cyan-500 shadow-cyan-500/30'}`}>
              ＋ Create Box 1
            </button>
          </div>
        )}
        {/* RDM Bundle Sales (Jumpstart only) */}
        {!isKickstart && rdmBundles.length > 0 && (
          <>
            <div className="flex items-center gap-2 mb-2 mt-1">
              <span className="text-xs font-bold text-purple-400 tracking-widest uppercase">RDM Sales</span>
              <div className="flex-1 h-px bg-purple-500/20" />
            </div>
            {rdmBundles.map(bundle => (
              <div key={bundle.id} className="rounded-3xl bg-gradient-to-r from-purple-500/20 to-fuchsia-500/20 backdrop-blur-lg border border-purple-400/30 overflow-hidden">
                <div className="p-4 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-white font-bold">RDM Bundle</span>
                      <span className="text-xs bg-purple-500/30 text-purple-300 px-2 py-0.5 rounded-full font-semibold">RDM</span>
                    </div>
                    <p className="text-slate-400 text-sm">
                      {bundle.quantity} items · <span className="text-emerald-400 font-semibold">${Number(bundle.sale_price).toFixed(2)}</span>
                      {bundle.buyer_name ? ` · ${bundle.buyer_name}` : ''}
                    </p>
                    <p className="text-slate-500 text-xs mt-0.5">{new Date(bundle.sold_at).toLocaleDateString()}</p>
                  </div>
                  <button
                    onClick={() => generateRdmInvoice(bundle)}
                    className="flex items-center gap-1.5 bg-purple-600/30 hover:bg-purple-600/50 border border-purple-500/30 text-purple-300 text-xs font-semibold px-3 py-2 rounded-xl transition-all active:scale-95"
                  >
                    <iconify-icon icon="lucide:file-text" class="text-sm"></iconify-icon>
                    Invoice
                  </button>
                </div>
              </div>
            ))}
            <div className="h-2" />
          </>
        )}

        {boxes.map(box => {
          const pct = progressPercent(box.itemCount, box.targetQuantity)
          const isSold = box.salePrice != null
          const statusColor = isSold ? 'from-emerald-500/20 to-green-500/20' :
                              box.status === 'complete' ? (isKickstart ? 'from-fuchsia-500/20 to-pink-500/20' : 'from-fuchsia-500/20 to-purple-500/20') :
                              box.status === 'in-progress' ? (isKickstart ? 'from-fuchsia-500/20 to-rose-500/20' : 'from-cyan-500/20 to-blue-500/20') : 'from-slate-500/20 to-slate-600/20'
          const borderColor = isSold ? 'border-emerald-400/30' :
                              box.status === 'complete' ? 'border-fuchsia-400/30' :
                              box.status === 'in-progress' ? (isKickstart ? 'border-fuchsia-400/30' : 'border-cyan-400/30') : 'border-white/10'
          const statusText = isSold ? `Sold · $${box.salePrice.toFixed(2)}${box.shippingCharged > 0 ? ` + $${box.shippingCharged.toFixed(0)} ship` : ''}` :
                             box.status === 'complete' ? 'Complete' : box.status === 'in-progress' ? 'In Progress' : 'Empty'

          return (
            <div key={box.boxNumber} className={`rounded-3xl bg-gradient-to-r ${statusColor} backdrop-blur-lg border ${borderColor} overflow-hidden max-w-full`}>
              <div className="p-4 cursor-pointer active:bg-white/5" onClick={() => openBox(box)}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-white font-bold text-lg">Box {box.boxNumber}</h3>
                    <p className="text-slate-400 text-sm">{box.targetQuantity != null ? `${box.itemCount}/${box.targetQuantity}` : `${box.itemCount}`} items{box.targetQuantity == null ? ' · ∞' : ''} • <span className={isSold ? 'text-emerald-400' : ''}>{statusText}</span></p>
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
                      className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-2xl px-3 py-2 text-white text-base placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 focus:ring-4 focus:ring-cyan-500/10 transition-all"
                      style={{ fontSize: '16px' }}
                      placeholder="Type a note..."
                      autoFocus
                    />
                    <button onClick={() => saveNote(box.boxNumber)} className={`px-3 py-2 rounded-xl text-white text-xs font-semibold shrink-0 ${isKickstart ? 'bg-cyan-600 hover:bg-cyan-500' : 'bg-cyan-600 hover:bg-cyan-500'}`}>
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

      {/* New Box Modal */}
      {showNewBoxModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="glass-card rounded-3xl p-6 w-full max-w-sm border border-white/10">
            <h3 className="text-xl font-bold text-white mb-4 font-heading">New Box</h3>

            {/* Mode toggle */}
            <div className="flex gap-1 bg-white/5 rounded-xl p-1 mb-5">
              <button
                onClick={() => setNewBoxMode('fixed')}
                className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                  newBoxMode === 'fixed' ? 'bg-cyan-600 text-white shadow-lg' : 'text-slate-400'
                }`}
              >
                Fixed Qty
              </button>
              {!isKickstart && (
                <button
                  onClick={() => setNewBoxMode('rdm')}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                    newBoxMode === 'rdm' ? 'bg-purple-600 text-white shadow-lg' : 'text-slate-400'
                  }`}
                >
                  RDM
                </button>
              )}
              <button
                onClick={() => setNewBoxMode('unlimited')}
                className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                  newBoxMode === 'unlimited' ? 'bg-cyan-600 text-white shadow-lg' : 'text-slate-400'
                }`}
              >
                Unlimited
              </button>
            </div>

            {/* Quantity picker (fixed + rdm modes) */}
            {newBoxMode !== 'unlimited' ? (
              <div className="flex flex-col items-center mb-6">
                <p className="text-slate-400 text-sm mb-3">Items per box</p>
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => setNewBoxTargetQty(q => Math.max(1, q - 5))}
                    className="w-12 h-12 rounded-2xl bg-white/10 border border-white/20 text-white font-bold text-xl flex items-center justify-center active:scale-90 transition-all"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    value={newBoxTargetQty}
                    onChange={e => setNewBoxTargetQty(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-20 text-center bg-white/5 border border-white/10 rounded-2xl py-3 text-white text-3xl font-bold focus:outline-none focus:border-cyan-500/50"
                    style={{ fontSize: '16px' }}
                  />
                  <button
                    onClick={() => setNewBoxTargetQty(q => q + 5)}
                    className="w-12 h-12 rounded-2xl bg-white/10 border border-white/20 text-white font-bold text-xl flex items-center justify-center active:scale-90 transition-all"
                  >
                    +
                  </button>
                </div>
                <div className="flex gap-2 mt-3">
                  {[20, 30, 40, 50].map(n => (
                    <button
                      key={n}
                      onClick={() => setNewBoxTargetQty(n)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                        newBoxTargetQty === n ? 'bg-cyan-600 text-white' : 'bg-white/10 text-slate-400'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center mb-6 py-4">
                <p className="text-cyan-400 text-4xl mb-2">∞</p>
                <p className="text-slate-400 text-sm">Scan until you're done</p>
                <p className="text-slate-500 text-xs mt-1">Use "Done Scanning" to complete</p>
              </div>
            )}

            {/* RDM-specific fields */}
            {newBoxMode === 'rdm' && (
              <div className="space-y-3 mb-5">
                <div>
                  <p className="text-slate-400 text-sm mb-1.5">Sale price <span className="text-red-400">*</span></p>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={rdmSalePrice}
                    onChange={e => setRdmSalePrice(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white text-lg font-bold focus:outline-none focus:border-purple-500/50 focus:ring-4 focus:ring-purple-500/10 transition-all"
                    style={{ fontSize: '16px' }}
                  />
                </div>
                <div>
                  <p className="text-slate-400 text-sm mb-1.5">Buyer name</p>
                  <input
                    type="text"
                    value={rdmBuyerName}
                    onChange={e => setRdmBuyerName(e.target.value)}
                    placeholder="Optional"
                    className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-purple-500/50 focus:ring-4 focus:ring-purple-500/10 transition-all"
                    style={{ fontSize: '16px' }}
                  />
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setShowNewBoxModal(false)}
                className="flex-1 bg-white/10 py-3 rounded-xl text-white font-semibold border border-white/10"
              >
                Cancel
              </button>
              <button
                onClick={confirmCreateBox}
                disabled={newBoxMode === 'rdm' && (!rdmSalePrice || parseFloat(rdmSalePrice) <= 0)}
                className={`flex-1 py-3 rounded-xl text-white font-bold shadow-lg active:scale-[0.97] transition-all disabled:opacity-40 ${
                  newBoxMode === 'rdm'
                    ? 'bg-purple-600 hover:bg-purple-500 shadow-purple-500/25'
                    : 'bg-cyan-600 hover:bg-cyan-500 shadow-cyan-500/25'
                }`}
              >
                {newBoxMode === 'rdm' ? 'Save RDM Sale' : 'Create Box'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
