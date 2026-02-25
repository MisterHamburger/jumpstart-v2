import { useState, useEffect, useRef } from 'react'
import Papa from 'papaparse'
import { supabase } from '../lib/supabase'
import { normalizeBarcode } from '../lib/barcodes'

export default function AdminInputs() {
  const [activeSection, setActiveSection] = useState('shows')

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-extrabold tracking-tight text-white">Inputs</h2>
      
      {/* Tab pills - below title */}
      <div className="relative p-[1px] rounded-2xl bg-gradient-to-r from-cyan-500/40 via-purple-500/40 to-pink-500/40 shadow-lg w-fit">
        <div className="flex gap-1 bg-[#080c14] rounded-2xl p-1.5">
          {['shows', 'manifests', 'expenses'].map(s => (
            <button 
              key={s} 
              onClick={() => setActiveSection(s)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200 ${
                activeSection === s 
                  ? 'bg-gradient-to-r from-cyan-600 via-purple-600 to-cyan-600 text-white shadow-lg shadow-purple-500/20' 
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {activeSection === 'shows' && <ShowUpload />}
      {activeSection === 'manifests' && <ManifestUpload />}
      {activeSection === 'expenses' && <ExpenseUpload />}
    </div>
  )
}

// ── Shared: Drag & Drop File Zone ─────────────────
function DropZone({ onFile, accept = '.csv', label = 'Drop CSV here or click to browse' }) {
  const [dragging, setDragging] = useState(false)
  const [fileName, setFileName] = useState('')
  const inputRef = useRef(null)

  function handleDrop(e) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) { setFileName(file.name); onFile(file) }
  }

  function handleClick() { inputRef.current?.click() }

  function handleChange(e) {
    const file = e.target.files[0]
    if (file) { setFileName(file.name); onFile(file) }
  }

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={handleClick}
      className={`relative overflow-hidden border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all duration-300
        ${dragging 
          ? 'border-cyan-400 bg-cyan-500/10 shadow-lg shadow-cyan-500/20' 
          : 'border-white/[0.15] hover:border-cyan-500/50 hover:bg-white/[0.02]'}`}
    >
      <input ref={inputRef} type="file" accept={accept} onChange={handleChange} className="hidden" />
      <div className={`text-4xl mb-3 transition-transform duration-300 ${dragging ? 'scale-110' : ''}`}>
        {dragging ? '📂' : '📄'}
      </div>
      <div className={`text-sm font-medium ${fileName ? 'text-cyan-400' : 'text-slate-400'}`}>
        {fileName || label}
      </div>
      {!fileName && (
        <div className="text-xs text-slate-500 mt-2">or click to browse</div>
      )}
    </div>
  )
}

// ── Shared: Dollar parser ─────────────────────────
function parseDollar(val) {
  if (!val) return 0
  return parseFloat(val.toString().replace(/[$,]/g, '')) || 0
}

// ── Shared: Flexible field getter ─────────────────
function getField(row, ...names) {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== '') return row[name]
    const key = Object.keys(row).find(k => k.trim().toLowerCase() === name.toLowerCase())
    if (key && row[key] !== undefined && row[key] !== '') return row[key]
  }
  return null
}

// ── MANIFEST UPLOAD (Combined with Loads) ────────
function ManifestUpload() {
  const [loads, setLoads] = useState([])
  const [loadId, setLoadId] = useState('')
  const [newLoad, setNewLoad] = useState({ date: '', vendor: '', total_cost: '', notes: '' })
  const [showNewLoad, setShowNewLoad] = useState(false)
  const [status, setStatus] = useState('')
  const [progress, setProgress] = useState(null)

  useEffect(() => { refreshLoads() }, [])

  async function refreshLoads() {
    // Get loads with item counts from load_summary view
    const { data: loadData } = await supabase.from('load_summary').select('*')
    // Also get load details
    const { data: loadsInfo } = await supabase.from('loads').select('*').order('date', { ascending: false })
    
    // Merge the data
    const merged = loadsInfo?.map(l => {
      const summary = loadData?.find(s => s.load_id === l.id)
      return {
        ...l,
        item_count: summary?.item_count || 0,
        total_cost_actual: summary?.total_cost || 0
      }
    }) || []
    
    setLoads(merged)
  }

  async function createLoad(e) {
    e.preventDefault()
    const nextId = loads.length + 1
    const loadIdNew = `Load ${nextId}`
    
    const { error } = await supabase.from('loads').insert({
      id: loadIdNew,
      date: newLoad.date,
      vendor: newLoad.vendor,
      total_cost: parseFloat(newLoad.total_cost) || null,
      notes: newLoad.notes
    })
    
    if (error) {
      setStatus(`❌ Error creating load: ${error.message}`)
      return
    }
    
    setStatus(`✅ Created ${loadIdNew}`)
    setNewLoad({ date: '', vendor: '', total_cost: '', notes: '' })
    setShowNewLoad(false)
    setLoadId(loadIdNew)
    refreshLoads()
  }

  async function handleFile(file) {
    if (!loadId) { setStatus('⚠️ Select or create a load first'); return }
    setStatus('Parsing CSV...')
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: async (results) => {
        const rows = results.data
        setStatus(`Parsed ${rows.length} rows. Uploading...`)

        const items = rows.map(row => {
          const barcode = getField(row, 'Unique ID', 'Universal ID', 'UPC', 'Barcode') || ''
          const zoneStr = (getField(row, 'Zone') || '').toString()
          let zone = null
          if (zoneStr.includes('1')) zone = 1
          else if (zoneStr.includes('2')) zone = 2
          else if (zoneStr.includes('3')) zone = 3

          return {
            barcode: normalizeBarcode(barcode), barcode_raw: barcode,
            description: getField(row, 'Description', 'Product Name') || '',
            category: getField(row, 'Category') || '', subclass: getField(row, 'Subclass') || '',
            size: getField(row, 'Size') || '', color: getField(row, 'Color') || '',
            vendor: getField(row, 'Vendor', 'Brand') || '', part_number: getField(row, 'Part Number', 'Item') || '',
            msrp: parseDollar(getField(row, 'MSRP')) || null,
            cost: parseDollar(getField(row, 'Cost')) || null,
            cost_freight: parseDollar(getField(row, 'Cost+Freight')) || null,
            zone, bundle_number: getField(row, 'Bundle #', 'Bundle') || null, load_id: loadId
          }
        }).filter(item => item.barcode)

        let uploaded = 0
        for (let i = 0; i < items.length; i += 500) {
          const batch = items.slice(i, i + 500)
          const { error } = await supabase.from('jumpstart_manifest').insert(batch)
          if (error) { setStatus(`❌ Error at row ${i}: ${error.message}`); return }
          uploaded += batch.length
          setProgress(Math.round((uploaded / items.length) * 100))
        }
        setStatus(`✅ Uploaded ${items.length} items to ${loadId}`)
        setProgress(null)
        refreshLoads()
      }
    })
  }

  return (
    <div className="space-y-6">
      {/* Existing Loads */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-b from-slate-800/60 to-slate-900/40 border border-white/[0.08] p-5 shadow-xl shadow-black/30">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold text-lg">Loads</h3>
          <button 
            onClick={() => setShowNewLoad(!showNewLoad)}
            className="text-sm text-cyan-400 hover:text-cyan-300 transition-colors"
          >
            {showNewLoad ? 'Cancel' : '+ New Load'}
          </button>
        </div>
        
        {/* New Load Form */}
        {showNewLoad && (
          <form onSubmit={createLoad} className="mb-4 p-4 rounded-xl bg-slate-800/50 border border-white/[0.04] space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <input 
                type="date" 
                value={newLoad.date} 
                onChange={e => setNewLoad({...newLoad, date: e.target.value})} 
                className="bg-slate-700/50 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:border-cyan-500/50 focus:outline-none" 
                required 
              />
              <input 
                placeholder="Vendor (e.g., J.Crew)" 
                value={newLoad.vendor} 
                onChange={e => setNewLoad({...newLoad, vendor: e.target.value})} 
                className="bg-slate-700/50 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-500/50 focus:outline-none" 
                required 
              />
              <input 
                placeholder="Total Cost" 
                type="number" 
                step="0.01" 
                value={newLoad.total_cost} 
                onChange={e => setNewLoad({...newLoad, total_cost: e.target.value})} 
                className="bg-slate-700/50 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-500/50 focus:outline-none" 
              />
              <input 
                placeholder="Notes" 
                value={newLoad.notes} 
                onChange={e => setNewLoad({...newLoad, notes: e.target.value})} 
                className="bg-slate-700/50 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-500/50 focus:outline-none" 
              />
            </div>
            <button type="submit" className="bg-cyan-600 hover:bg-cyan-500 px-4 py-2 rounded-lg text-sm font-medium transition-colors">
              Create Load
            </button>
          </form>
        )}
        
        {/* Load List */}
        <div className="space-y-2">
          {loads.map((l, index) => {
            // Format date as MM-DD-YYYY
            const dateParts = l.date ? l.date.split('-') : null
            const formattedDate = dateParts ? `${dateParts[1]}-${dateParts[2]}-${dateParts[0]}` : '—'
            
            return (
              <div 
                key={l.id} 
                onClick={() => setLoadId(l.id)}
                className={`rounded-xl p-4 cursor-pointer transition-all ${
                  loadId === l.id 
                    ? 'bg-cyan-600/20 border border-cyan-500/50' 
                    : 'bg-slate-800/30 border border-white/[0.04] hover:bg-slate-800/50'
                }`}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-semibold text-white">Load {l.id.replace('Load ', '')}</div>
                    <div className="text-xs text-slate-500 mt-1">
                      Date Paid: {formattedDate}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-slate-300">{l.item_count.toLocaleString()} items</div>
                    <div className="text-xs text-slate-500">${Number(l.total_cost_actual).toLocaleString(undefined, {minimumFractionDigits: 2})}</div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Upload Manifest */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-b from-slate-800/60 to-slate-900/40 border border-white/[0.08] p-5 shadow-xl shadow-black/30">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
        <h3 className="font-bold text-lg mb-4">Upload Manifest</h3>
        
        {loadId ? (
          <div className="space-y-3">
            <div className="text-sm text-slate-400">
              Uploading to: <span className="text-cyan-400 font-medium">{loadId}</span>
            </div>
            <DropZone onFile={handleFile} label="Drop manifest CSV here or click to browse" />
            {progress !== null && (
              <div className="w-full bg-slate-700 rounded-full h-2">
                <div className="bg-cyan-500 h-2 rounded-full transition-all" style={{width: `${progress}%`}} />
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm text-slate-500 text-center py-4">
            Select a load above or create a new one
          </div>
        )}
        
        {status && <p className="text-sm text-slate-300 mt-3">{status}</p>}
      </div>
    </div>
  )
}

// ── SHOW CSV UPLOAD (Auto-detect date & time) ─────
function ShowUpload() {
  const [channel, setChannel] = useState('Jumpstart')
  const [streamer, setStreamer] = useState('Bri')
  const [status, setStatus] = useState('')
  const [detected, setDetected] = useState(null) // { date, timeOfDay, orderCount }
  const [pendingFile, setPendingFile] = useState(null)
  const [existingShows, setExistingShows] = useState([])

  useEffect(() => { refreshShows() }, [])

  async function refreshShows() {
    const { data } = await supabase.from('shows').select('*').order('date', { ascending: false })
    setExistingShows(data || [])
  }

  function handleFile(file) {
    setStatus('Analyzing CSV...')
    setDetected(null)
    setPendingFile(null)

    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: (results) => {
        const rows = results.data

        // Collect all timestamps
        const timestamps = []
        for (const row of rows) {
          const t = getField(row, 'placed at', 'Placed At')
          if (t) timestamps.push(t)
        }

        if (timestamps.length === 0) {
          setStatus('❌ No timestamps found in CSV. Cannot auto-detect date/time.')
          return
        }

        // Parse first timestamp and convert to Central Time
        // Timestamps from Whatnot are UTC but don't have 'Z' suffix
        // Append 'Z' to force UTC parsing, then subtract 6 hours for Central
        const rawTs = timestamps[0].trim()
        const utcTs = rawTs.includes('Z') ? rawTs : rawTs.replace(' ', 'T') + 'Z'
        const firstTs = new Date(utcTs)
        
        // Create a new date adjusted to Central Time (UTC - 6 hours)
        const centralTime = new Date(firstTs.getTime() - (6 * 60 * 60 * 1000))
        
        // Get the date and hour in Central Time
        const showDate = centralTime.toISOString().split('T')[0]
        const centralHour = centralTime.getUTCHours()

        // Morning shows: ~6am-5pm Central
        // Evening shows: ~5pm-6am Central
        let timeOfDay
        if (centralHour >= 6 && centralHour < 17) {
          timeOfDay = 'morning'
        } else {
          timeOfDay = 'evening'
        }

        // Group by listing to properly count valid vs failed/cancelled
        const byListing = {}
        for (const row of rows) {
          const productName = getField(row, 'product name', 'Product Name') || ''
          const match = productName.match(/#(\d+)/)
          if (!match) continue
          const lowerName = productName.toLowerCase()
          if (lowerName.includes('gift card') || lowerName.includes('account credit') || lowerName.includes('store credit')) continue
          const listing = match[1]
          if (!byListing[listing]) byListing[listing] = []
          byListing[listing].push(row)
        }

        // Count valid, failed, cancelled
        let validCount = 0
        let failedCount = 0
        let cancelledCount = 0
        for (const [listing, listingRows] of Object.entries(byListing)) {
          const statuses = listingRows.map(r => (getField(r, 'cancelled or failed', 'Status') || '').toLowerCase().trim())
          if (statuses.every(s => s === 'cancelled')) cancelledCount++
          else if (statuses.every(s => s === 'failed')) failedCount++
          else validCount++
        }

        // Check if this show already exists
        // Format: 02-19-2026-Jumpstart-Bri
        const [year, month, day] = showDate.split('-')
        const showName = `${month}-${day}-${year}-${channel}-${streamer}`
        const alreadyExists = existingShows.some(s => s.name === showName)

        setDetected({ date: showDate, timeOfDay, orderCount: validCount, failedCount, cancelledCount, showName, alreadyExists, firstOrder: timestamps[0], lastOrder: timestamps[timestamps.length - 1] })
        setPendingFile({ file, rows })
        setStatus('')
      }
    })
  }

  async function confirmUpload() {
    if (!pendingFile || !detected) return

    const { file, rows } = pendingFile
    const { date, timeOfDay, showName } = detected

    setStatus('Creating show...')

    // Create show record
    const { data: showData, error: showError } = await supabase.from('shows').insert({
      name: showName, date, time_of_day: timeOfDay, channel, status: 'active'
    }).select().single()

    if (showError) {
      setStatus(`❌ Error creating show: ${showError.message}`)
      return
    }

    // Group by listing number
    const byListing = {}
    for (const row of rows) {
      const productName = getField(row, 'product name', 'Product Name') || ''
      const match = productName.match(/#(\d+)/)
      if (!match) continue
      const listingNum = parseInt(match[1])
      const lowerName = productName.toLowerCase()
      if (lowerName.includes('gift card') || lowerName.includes('account credit') || lowerName.includes('store credit')) continue
      if (!byListing[listingNum]) byListing[listingNum] = []
      byListing[listingNum].push(row)
    }

    const showItems = []
    let validCount = 0

    for (const [listingStr, listingRows] of Object.entries(byListing)) {
      const listing = parseInt(listingStr)
      const statuses = listingRows.map(r => (getField(r, 'cancelled or failed', 'Status') || '').toLowerCase().trim())
      let itemStatus = 'valid'
      if (statuses.every(s => s === 'cancelled')) itemStatus = 'cancelled'
      else if (statuses.every(s => s === 'failed')) itemStatus = 'failed'

      const bestRow = listingRows.find(r => {
        const s = (getField(r, 'cancelled or failed', 'Status') || '').toLowerCase()
        return !s || (s !== 'failed' && s !== 'cancelled')
      }) || listingRows[0]

      const soldPrice = parseDollar(getField(bestRow, 'sold price', 'Sold Price'))
      const couponAmt = parseDollar(getField(bestRow, 'coupon price', 'Coupon Amount'))

      showItems.push({
        show_id: showData.id, listing_number: listing,
        product_name: getField(bestRow, 'product name', 'Product Name') || '',
        buyer_paid: soldPrice, coupon_code: getField(bestRow, 'coupon code', 'Coupon Code') || null,
        coupon_amount: couponAmt, original_hammer: soldPrice + couponAmt,
        status: itemStatus, placed_at: getField(bestRow, 'placed at', 'Placed At') || null,
        whatnot_order_id: getField(bestRow, 'order id', 'Order ID') || null
      })
      if (itemStatus === 'valid') validCount++
    }

    for (let i = 0; i < showItems.length; i += 500) {
      const { error } = await supabase.from('show_items').insert(showItems.slice(i, i + 500))
      if (error) { setStatus(`❌ Error: ${error.message}`); return }
    }

    await supabase.from('shows').update({ total_items: validCount }).eq('id', showData.id)
    const failed = showItems.filter(i => i.status === 'failed').length
    const cancelled = showItems.filter(i => i.status === 'cancelled').length
    setStatus(`✅ "${showName}" — ${validCount} scannable, ${failed} failed, ${cancelled} cancelled`)
    setDetected(null)
    setPendingFile(null)
    refreshShows()
  }

  async function deleteShow(show) {
    if (!confirm(`Are you sure you want to delete "${show.name}"?\n\nThis will also delete all items and scans associated with this show.`)) {
      return
    }
    
    setStatus('Deleting show...')
    // Delete scans first
    await supabase.from('jumpstart_sold_scans').delete().eq('show_id', show.id)
    // Delete show items
    await supabase.from('show_items').delete().eq('show_id', show.id)
    // Delete the show
    await supabase.from('shows').delete().eq('id', show.id)
    setStatus('✓ Show deleted')
    refreshShows()
    setTimeout(() => setStatus(''), 2000)
  }

  // Format show name for display: "02-19-2026-Jumpstart-Bri"
  function formatShowDisplay(show) {
    // Try to parse from the name if it's in the new format
    const match = show.name.match(/^(\d{2})-(\d{2})-(\d{4})-(\w+)-(\w+)$/)
    if (match) {
      const [, month, day, year, ch, streamer] = match
      return { date: `${month}-${day}-${year}`, channel: ch, streamer }
    }
    // Old format: 2026-02-19-Jumpstart-evening
    const oldMatch = show.name.match(/^(\d{4})-(\d{2})-(\d{2})-(\w+)-(\w+)$/)
    if (oldMatch) {
      const [, year, month, day, ch, timeOrStreamer] = oldMatch
      return { date: `${month}-${day}-${year}`, channel: ch, streamer: timeOrStreamer }
    }
    return { date: show.date, channel: show.channel, streamer: show.time_of_day || '—' }
  }

  // Format detected date for display
  function formatDateDisplay(isoDate) {
    const [year, month, day] = isoDate.split('-')
    return `${month}-${day}-${year}`
  }

  return (
    <div className="space-y-6">
      {/* Upload Section */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-b from-slate-800/60 to-slate-900/40 border border-white/[0.08] p-5 shadow-xl shadow-black/30">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
        
        <h3 className="font-bold text-lg mb-4">Upload Whatnot Show CSV</h3>
        
        <div className="flex gap-4 mb-4">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-500 block mb-1.5">Channel</label>
            <select value={channel} onChange={e => setChannel(e.target.value)} 
              className="bg-slate-800/50 border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm focus:border-cyan-500/50 focus:outline-none transition-colors">
              <option value="Jumpstart">Jumpstart</option>
              <option value="Kickstart">Kickstart</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-500 block mb-1.5">Streamer</label>
            <select value={streamer} onChange={e => setStreamer(e.target.value)} 
              className="bg-slate-800/50 border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm focus:border-cyan-500/50 focus:outline-none transition-colors">
              <option value="Bri">Bri</option>
              <option value="Laura">Laura</option>
              <option value="Hannah">Hannah</option>
              <option value="Josh">Josh</option>
            </select>
          </div>
        </div>

        <DropZone onFile={handleFile} label="Drop Whatnot CSV here or click to browse" />

        {/* Auto-detection confirmation - simplified */}
        {detected && (
          <div className={`mt-4 rounded-2xl p-4 ${detected.alreadyExists ? 'bg-red-900/20 border border-red-500/30' : 'bg-slate-800/50 border border-white/[0.08]'}`}>
            <div className="text-sm font-semibold mb-3">
              {detected.alreadyExists ? '⚠️ Show already exists' : '📋 Show info:'}
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-slate-500 text-xs block">Date</span>
                <span className="font-semibold">{formatDateDisplay(detected.date)}</span>
              </div>
              <div>
                <span className="text-slate-500 text-xs block">Channel</span>
                <span className="font-semibold">{channel}</span>
              </div>
              <div>
                <span className="text-slate-500 text-xs block">Streamer</span>
                <span className="font-semibold">{streamer}</span>
              </div>
              <div>
                <span className="text-slate-500 text-xs block">Scannable</span>
                <span className="font-semibold text-emerald-400">{detected.orderCount}</span>
              </div>
              {(detected.failedCount > 0 || detected.cancelledCount > 0) && (
                <div>
                  <span className="text-slate-500 text-xs block">Excluded</span>
                  <span className="font-semibold text-red-400">
                    {detected.failedCount > 0 && `${detected.failedCount} failed`}
                    {detected.failedCount > 0 && detected.cancelledCount > 0 && ', '}
                    {detected.cancelledCount > 0 && `${detected.cancelledCount} cancelled`}
                  </span>
                </div>
              )}
            </div>

            {detected.alreadyExists ? (
              <p className="text-sm text-red-400 mt-3">Delete the existing show first to re-upload.</p>
            ) : (
              <div className="flex gap-3 mt-4">
                <button onClick={confirmUpload}
                  className="bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 px-5 py-2.5 rounded-xl text-sm font-semibold shadow-lg shadow-emerald-500/20 transition-all">
                  ✓ Upload
                </button>
                <button onClick={() => { setDetected(null); setPendingFile(null) }}
                  className="bg-slate-700/50 hover:bg-slate-600/50 px-5 py-2.5 rounded-xl text-sm font-medium border border-white/[0.08] transition-colors">
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}

        {status && <p className="text-sm text-slate-400 mt-3">{status}</p>}
      </div>

      {/* Existing Shows List */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-b from-slate-800/60 to-slate-900/40 border border-white/[0.08] p-5 shadow-xl shadow-black/30">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
        
        <h3 className="font-bold text-lg mb-4">Uploaded Shows <span className="text-slate-500 font-normal">({existingShows.length})</span></h3>
        
        {existingShows.length === 0 ? (
          <p className="text-sm text-slate-500">No shows uploaded yet.</p>
        ) : (
          <div className="space-y-2">
            {existingShows.map(show => {
              const display = formatShowDisplay(show)
              return (
                <div key={show.id} className="flex justify-between items-center py-3 px-4 rounded-xl bg-slate-800/30 border border-white/[0.04] hover:bg-slate-800/50 transition-colors">
                  <div>
                    <div className="font-medium">
                      <span className="text-cyan-400">{display.date}</span>
                      <span className="text-slate-500 mx-2">·</span>
                      <span>{display.channel}</span>
                      <span className="text-slate-500 mx-2">·</span>
                      <span className="text-purple-400">{display.streamer}</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {show.total_items || 0} items · {show.scanned_count || 0} scanned
                    </div>
                  </div>
                  <button 
                    onClick={() => deleteShow(show)}
                    className="text-slate-500 hover:text-red-400 hover:bg-red-500/10 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                  >
                    Delete
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ── SCAN MONITOR ─────────────────────────────────
function ScanMonitor() {
  const [scanners, setScanners] = useState({
    jumpstartSort: [],
    jumpstartBundle: [],
    jumpstartSales: [],
    kickstartSales: []
  })
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    loadLatestScans()
    // Refresh every 5 seconds
    const interval = setInterval(() => {
      loadLatestScans()
      setNow(new Date())
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  async function loadLatestScans() {
    // Jumpstart Sort - last 10 from sort_log
    const { data: sortData } = await supabase
      .from('jumpstart_sort_log')
      .select('barcode, sorted_at, zone')
      .order('sorted_at', { ascending: false })
      .limit(10)
    
    // Jumpstart Bundle - last 10 from bundle_scans
    const { data: bundleData } = await supabase
      .from('jumpstart_bundle_scans')
      .select('barcode, scanned_at, box_number')
      .order('scanned_at', { ascending: false })
      .limit(10)
    
    // Jumpstart Sales - last 10 from jumpstart_sold_scans
    const { data: jumpstartData } = await supabase
      .from('jumpstart_sold_scans')
      .select('barcode, scanned_at, listing_number')
      .order('scanned_at', { ascending: false })
      .limit(10)
    
    // Kickstart Sales - last 10 from kickstart_sold_scans
    const { data: kickstartData } = await supabase
      .from('kickstart_sold_scans')
      .select('barcode, scanned_at, listing_number')
      .order('scanned_at', { ascending: false })
      .limit(10)
    
    setScanners({
      jumpstartSort: sortData?.map(s => ({
        time: new Date(s.sorted_at),
        barcode: s.barcode,
        extra: s.zone ? `Z${s.zone}` : null
      })) || [],
      jumpstartBundle: bundleData?.map(s => ({
        time: new Date(s.scanned_at),
        barcode: s.barcode,
        extra: s.box_number ? `Box ${s.box_number}` : null
      })) || [],
      jumpstartSales: jumpstartData?.map(s => ({
        time: new Date(s.scanned_at),
        barcode: s.barcode,
        extra: s.listing_number ? `#${s.listing_number}` : null
      })) || [],
      kickstartSales: kickstartData?.map(s => ({
        time: new Date(s.scanned_at),
        barcode: s.barcode,
        extra: s.listing_number ? `#${s.listing_number}` : null
      })) || []
    })
  }

  function timeAgo(date) {
    if (!date) return ''
    const seconds = Math.floor((now - date) / 1000)
    if (seconds < 5) return 'Just now'
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h`
    const days = Math.floor(hours / 24)
    return `${days}d`
  }

  function isActive(scans) {
    if (!scans || scans.length === 0) return false
    const seconds = Math.floor((now - scans[0].time) / 1000)
    return seconds < 30
  }

  function isRecent(scans) {
    if (!scans || scans.length === 0) return false
    const seconds = Math.floor((now - scans[0].time) / 1000)
    return seconds < 300
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold">Live Scanner Status</h3>
        <span className="text-xs text-slate-500">Auto-refreshes every 5s</span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <ScannerFeed
          title="Jumpstart Sort"
          subtitle="Zone sorting"
          scans={scanners.jumpstartSort}
          timeAgo={timeAgo}
          isActive={isActive(scanners.jumpstartSort)}
          isRecent={isRecent(scanners.jumpstartSort)}
          color="purple"
        />
        <ScannerFeed
          title="Jumpstart Bundle"
          subtitle="Bundle packing"
          scans={scanners.jumpstartBundle}
          timeAgo={timeAgo}
          isActive={isActive(scanners.jumpstartBundle)}
          isRecent={isRecent(scanners.jumpstartBundle)}
          color="teal"
        />
        <ScannerFeed
          title="Jumpstart Sales"
          subtitle="J.Crew / Madewell"
          scans={scanners.jumpstartSales}
          timeAgo={timeAgo}
          isActive={isActive(scanners.jumpstartSales)}
          isRecent={isRecent(scanners.jumpstartSales)}
          color="cyan"
        />
        <ScannerFeed
          title="Kickstart Sales"
          subtitle="Free People"
          scans={scanners.kickstartSales}
          timeAgo={timeAgo}
          isActive={isActive(scanners.kickstartSales)}
          isRecent={isRecent(scanners.kickstartSales)}
          color="pink"
        />
      </div>

      <p className="text-xs text-slate-500 text-center">
        Green dot = active (last 30s) · Yellow = recent (last 5m) · Shows last 10 scans per scanner
      </p>
    </div>
  )
}

function ScannerFeed({ title, subtitle, scans, timeAgo, isActive, isRecent, color }) {
  const colors = {
    purple: { border: 'border-purple-500/50', glow: 'shadow-purple-500/20' },
    teal: { border: 'border-teal-500/50', glow: 'shadow-teal-500/20' },
    cyan: { border: 'border-cyan-500/50', glow: 'shadow-cyan-500/20' },
    pink: { border: 'border-pink-500/50', glow: 'shadow-pink-500/20' }
  }
  const c = colors[color]

  return (
    <div className={`relative overflow-hidden rounded-2xl bg-gradient-to-b from-slate-800/60 to-slate-900/40 border ${isActive ? c.border : 'border-white/[0.08]'} p-4 shadow-xl shadow-black/30 ${isActive ? c.glow : ''}`}>
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      
      {/* Header with status dot */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-sm font-semibold text-white">{title}</div>
          <div className="text-xs text-slate-500">{subtitle}</div>
        </div>
        <div className={`w-3 h-3 rounded-full ${isActive ? 'bg-emerald-500 animate-pulse' : isRecent ? 'bg-yellow-500' : 'bg-slate-600'}`} />
      </div>

      {/* Scan feed */}
      <div className="space-y-1 max-h-48 overflow-y-auto">
        {scans.length === 0 ? (
          <div className="text-slate-500 text-sm py-2">No scans yet</div>
        ) : (
          scans.map((scan, i) => (
            <div 
              key={i} 
              className={`flex items-center justify-between text-xs py-1.5 px-2 rounded-lg ${i === 0 && isActive ? 'bg-emerald-500/10' : 'bg-slate-800/30'}`}
            >
              <span className="font-mono text-slate-300 truncate flex-1">{scan.barcode}</span>
              {scan.extra && <span className="text-cyan-400 mx-2">{scan.extra}</span>}
              <span className={`${i === 0 && isActive ? 'text-emerald-400' : 'text-slate-500'} ml-2 whitespace-nowrap`}>
                {timeAgo(scan.time)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ── EXPENSE UPLOAD ────────────────────────────────
function ExpenseUpload() {
  const [status, setStatus] = useState('')

  function handleFile(file) {
    setStatus('Parsing expenses...')
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: async (results) => {
        const expenses = results.data.map(row => ({
          date: getField(row, 'date', 'Date') || null,
          description: getField(row, 'name', 'Description', 'Vendor') || '',
          amount: parseFloat((getField(row, 'amount', 'Amount') || '0').toString().replace(/[$,]/g, '')) || 0,
          category: (getField(row, 'category', 'Category') || 'EXPENSES').toUpperCase()
        })).filter(e => e.date && e.amount)

        const { error } = await supabase.from('expenses').insert(expenses)
        if (error) { setStatus(`❌ Error: ${error.message}`); return }
        setStatus(`✅ Uploaded ${expenses.length} expenses`)
      }
    })
  }

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-b from-slate-800/60 to-slate-900/40 border border-white/[0.08] p-5 shadow-xl shadow-black/30">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      <h3 className="font-bold text-lg mb-2">Upload Expenses CSV</h3>
      <p className="text-sm text-slate-400 mb-4">Upload Copilot transactions CSV. Only EXPENSES and PAYROLL categories are used in the P&L.</p>
      <DropZone onFile={handleFile} label="Drop expenses CSV here" />
      {status && <p className="text-sm text-slate-300 mt-3">{status}</p>}
    </div>
  )
}
