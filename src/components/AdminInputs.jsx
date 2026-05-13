import { useState, useEffect, useRef } from 'react'
import Papa from 'papaparse'
import { supabase, fetchAll } from '../lib/supabase'
import { normalizeBarcode } from '../lib/barcodes'

export default function AdminInputs() {
  const [activeSection, setActiveSection] = useState('shows')

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-extrabold tracking-tight text-white font-heading">Inputs</h2>
      
      {/* Tab pills - below title */}
      <div className="relative p-[1px] rounded-3xl bg-gradient-to-r from-cyan-500/40 via-cyan-500/20 to-cyan-500/40 shadow-lg w-fit">
        <div className="flex gap-1 bg-[#080c14] rounded-3xl p-1.5">
          {['shows', 'manifests', 'expenses'].map(s => (
            <button 
              key={s} 
              onClick={() => setActiveSection(s)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200 ${
                activeSection === s 
                  ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-600/30'
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
      className={`relative overflow-hidden border-2 border-dashed rounded-3xl p-8 text-center cursor-pointer transition-all duration-300
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

// ── Shared: Group show-report rows into per-listing buckets ─────
// mode='n':    group by parsed #N integer. Used for Jumpstart shows where
//              each product is live-typed and gets a globally-unique #N.
// mode='name': group by full product_name (including #N). Used for Kickstart
//              shows where bulk-imported listings let multiple products
//              share the same #N (each product has its own #1..#K).
//
// Returns: [{ key, product_name, n, rows }] in insertion order.
function groupShowRows(rows, mode) {
  const buckets = new Map()
  for (const row of rows) {
    const productName = getField(row, 'product name', 'Product Name') || ''
    if (!productName) continue
    const lowerName = productName.toLowerCase()
    if (lowerName.includes('gift card') || lowerName.includes('account credit') || lowerName.includes('store credit')) continue
    const match = productName.match(/#(\d+)/)
    // Whatnot omits "#1" when a listing has quantity 1, so a row may have no
    // #N at all. Jumpstart-style (mode='n') still keys on #N — drop those
    // rare no-#N rows since live-typed Jumpstart listings always have #N in
    // practice. Kickstart-style (mode='name') keys on the full product_name
    // which is already unique without needing #N.
    const n = match ? parseInt(match[1]) : null
    if (mode === 'n' && n == null) continue
    const key = mode === 'name' ? productName : String(n)
    if (!buckets.has(key)) buckets.set(key, { key, product_name: productName, n, rows: [] })
    buckets.get(key).rows.push(row)
  }
  return Array.from(buckets.values())
}

// ── Shared: Flexible field getter ─────────────────
function getField(row, ...names) {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== '') return row[name]
    const norm = name.toLowerCase().replace(/[_ ]/g, '')
    const key = Object.keys(row).find(k => k.trim().toLowerCase().replace(/[_ ]/g, '') === norm)
    if (key && row[key] !== undefined && row[key] !== '') return row[key]
  }
  return null
}

// ── MANIFEST UPLOAD (Combined with Loads) ────────
function ManifestUpload() {
  const [loads, setLoads] = useState([])
  const [loadId, setLoadId] = useState('')
  const [newLoad, setNewLoad] = useState({ date: '', vendor: '', total_cost: '', quantity: '', notes: '' })
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
      quantity: parseInt(newLoad.quantity) || null,
      notes: newLoad.notes
    })
    
    if (error) {
      setStatus(`❌ Error creating load: ${error.message}`)
      return
    }
    
    setStatus(`✅ Created ${loadIdNew}`)
    setNewLoad({ date: '', vendor: '', total_cost: '', quantity: '', notes: '' })
    setShowNewLoad(false)
    setLoadId(loadIdNew)
    refreshLoads()
  }

  async function deleteLoad(load) {
    if (!confirm(`Are you sure you want to delete Load ${load.id}?\n\nWARNING: This will delete ALL manifest items for this load. This may mess up all of your profitability calculations if these items have been sold.`)) {
      return
    }
    if (!confirm(`FINAL WARNING: This cannot be undone. Delete Load ${load.id} and all its items?`)) {
      return
    }
    setStatus('Deleting load and manifest items...')
    await supabase.from('jumpstart_manifest').delete().eq('load_id', load.id)
    await supabase.from('loads').delete().eq('id', load.id)
    if (loadId === load.id) setLoadId('')
    setStatus('✓ Load deleted')
    refreshLoads()
    setTimeout(() => setStatus(''), 3000)
  }

  async function handleFile(file) {
    if (!loadId) { setStatus('⚠️ Select or create a load first'); return }
    setStatus('Parsing CSV...')
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: async (results) => {
        const rows = results.data
        setStatus(`Parsed ${rows.length} rows. Uploading...`)

        const items = []
        for (const row of rows) {
          const barcode = getField(row, 'UNIVERSAL ID', 'Unique ID', 'Universal ID', 'UPC', 'Barcode') || ''
          if (!barcode) continue
          const msrp = parseDollar(getField(row, 'Unit Retail', 'MSRP')) || null
          const cogs = parseDollar(getField(row, 'COGS', 'Cost', 'Cost+Freight')) || null
          const zoneStr = (getField(row, 'Zone') || '').toString().trim()
          const scanQty = parseInt(getField(row, 'SCAN QUANTITY', 'Scan Quantity', 'Quantity', 'Qty')) || 1

          const baseItem = {
            barcode: normalizeBarcode(barcode), barcode_raw: barcode,
            description: getField(row, 'Description', 'Product Name') || '',
            category: getField(row, 'Category (Department)', 'Category') || '',
            subclass: getField(row, 'Subclass') || '',
            size: getField(row, 'Size') || '', color: getField(row, 'Color') || '',
            vendor: getField(row, 'Vendor', 'Brand') || '',
            part_number: getField(row, 'Part Number', 'Item') || '',
            msrp, cost_freight: cogs,
            zone: zoneStr.replace(/^Zone(\d)/i, 'Zone $1').trim() || null,
            bundle_number: getField(row, 'Bundle #', 'Bundle') || null,
            load_id: loadId
          }
          for (let i = 0; i < scanQty; i++) {
            items.push({ ...baseItem })
          }
        }

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
      <div className="relative overflow-hidden rounded-3xl glass-card p-5 shadow-xl shadow-black/30">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold text-lg font-heading">Loads</h3>
          <button 
            onClick={() => setShowNewLoad(!showNewLoad)}
            className="text-sm text-cyan-400 hover:text-cyan-300 transition-colors"
          >
            {showNewLoad ? 'Cancel' : '+ New Load'}
          </button>
        </div>
        
        {/* New Load Form */}
        {showNewLoad && (
          <form onSubmit={createLoad} className="mb-4 p-4 rounded-2xl bg-white/5 border border-white/10 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <input 
                type="date" 
                value={newLoad.date} 
                onChange={e => setNewLoad({...newLoad, date: e.target.value})} 
                className="bg-white/5 border border-white/10 rounded-2xl px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50 focus:ring-4 focus:ring-cyan-500/10 transition-all" 
                required 
              />
              <input 
                placeholder="Brand (e.g., J.Crew, Madewell)" 
                value={newLoad.vendor} 
                onChange={e => setNewLoad({...newLoad, vendor: e.target.value})} 
                className="bg-white/5 border border-white/10 rounded-2xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 focus:ring-4 focus:ring-cyan-500/10 transition-all" 
                required 
              />
              <input
                placeholder="Total Cost"
                type="number"
                step="0.01"
                value={newLoad.total_cost}
                onChange={e => setNewLoad({...newLoad, total_cost: e.target.value})}
                className="bg-white/5 border border-white/10 rounded-2xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 focus:ring-4 focus:ring-cyan-500/10 transition-all"
              />
              <input
                placeholder="Units Delivered"
                type="number"
                value={newLoad.quantity}
                onChange={e => setNewLoad({...newLoad, quantity: e.target.value})}
                className="bg-white/5 border border-white/10 rounded-2xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 focus:ring-4 focus:ring-cyan-500/10 transition-all"
              />
              <input
                placeholder="Notes"
                value={newLoad.notes}
                onChange={e => setNewLoad({...newLoad, notes: e.target.value})}
                className="bg-white/5 border border-white/10 rounded-2xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 focus:ring-4 focus:ring-cyan-500/10 transition-all"
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
                    <div className="font-semibold text-white">
                      Load {l.id.replace('Load ', '')}
                      {(l.vendor || l.notes) && <span className="text-slate-400 font-normal"> — {l.vendor || l.notes}</span>}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      Date Paid: {formattedDate}
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="text-right">
                      <div className="text-lg font-bold text-slate-300">{(l.item_count || l.quantity || 0).toLocaleString()} items</div>
                      <div className="text-xs text-slate-500">${Number(l.total_cost || l.total_cost_actual || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}</div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteLoad(l) }}
                      className="text-slate-500 hover:text-red-400 hover:bg-red-500/10 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Upload Manifest */}
      <div className="relative overflow-hidden rounded-3xl glass-card p-5 shadow-xl shadow-black/30">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
        <h3 className="font-bold text-lg font-heading mb-4">Upload Manifest</h3>
        
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

      <PhotoUrlEnricher />
    </div>
  )
}

// ── PHOTO URL ENRICHER (CSV-in / CSV-out, no DB writes) ──
// Reads a J.Crew / Madewell manifest CSV and fills column "Photo URL"
// using the vendor's Scene7 image facade pattern. Saves the enriched
// CSV back to the user's downloads so they can spot-check before we
// commit to baking this into the manifest import.
function buildPhotoUrl(vendor, style, color) {
  const s = (style || '').toString().trim().toUpperCase()
  const c = (color || '').toString().trim().toUpperCase()
  if (!s || !c) return ''
  const v = (vendor || '').toLowerCase()
  if (v.includes('madewell')) {
    return `https://www.madewell.com/s7-img-facade/${s}_${c}`
  }
  if (v.includes('crew')) {
    return `https://www.jcrew.com/s7-img-facade/${s}_${c}`
  }
  return ''
}

function PhotoUrlEnricher() {
  const [status, setStatus] = useState('')
  const [progress, setProgress] = useState(null)

  function handleFile(file) {
    setStatus('Parsing CSV…')
    setProgress(0)
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: (results) => {
        const rows = results.data
        if (rows.length === 0) { setStatus('❌ No rows in CSV.'); return }
        // Resolve the Photo URL header key as it appears in the source CSV
        // (might be "Photo URL", "photo url", or absent — append if missing).
        const sample = rows[0]
        const photoKey = Object.keys(sample).find(k => k.trim().toLowerCase() === 'photo url') || 'Photo URL'
        let filled = 0, blank = 0
        for (const row of rows) {
          const vendor = getField(row, 'Vendor', 'Brand') || ''
          const style = getField(row, 'STYLE', 'Style') || ''
          const color = getField(row, 'COLOR', 'Color') || ''
          const url = buildPhotoUrl(vendor, style, color)
          row[photoKey] = url
          if (url) filled++; else blank++
        }
        setProgress(70)
        // Preserve original column order. Papa.unparse will use the first
        // row's keys; ensure Photo URL is included by inserting at end if
        // not already a key.
        const columns = Object.keys(rows[0])
        if (!columns.includes(photoKey)) columns.push(photoKey)
        const csv = Papa.unparse({ fields: columns, data: rows })
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        const inName = (file.name || 'manifest').replace(/\.csv$/i, '')
        a.href = url
        a.download = `${inName} - with photos.csv`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        setTimeout(() => URL.revokeObjectURL(url), 100)
        setProgress(100)
        setStatus(`✅ Enriched ${rows.length} rows — ${filled} URLs filled, ${blank} blank (unknown vendor or missing style/color).`)
        setTimeout(() => setProgress(null), 1500)
      }
    })
  }

  return (
    <div className="relative overflow-hidden rounded-3xl glass-card p-5 shadow-xl shadow-black/30">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      <h3 className="font-bold text-lg font-heading mb-1">Photo URL enricher</h3>
      <p className="text-xs text-slate-500 mb-3">
        Adds a Photo URL to each row using the vendor's Scene7 CDN pattern
        (J.Crew / J.Crew Factory / Madewell). CSV in, enriched CSV out — no
        DB writes. Spot-check the URLs before we bake this into the manifest
        import.
      </p>
      <DropZone onFile={handleFile} label="Drop manifest CSV here or click to browse" />
      {progress !== null && (
        <div className="w-full bg-slate-700 rounded-full h-2 mt-3">
          <div className="bg-cyan-500 h-2 rounded-full transition-all" style={{width: `${progress}%`}} />
        </div>
      )}
      {status && <p className="text-sm text-slate-300 mt-3">{status}</p>}
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

  async function toggleShowComplete(show) {
    const newStatus = show.status === 'completed' ? 'active' : 'completed'
    await supabase.from('shows').update({ status: newStatus }).eq('id', show.id)
    refreshShows()
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

        // Group rows by listing slot.
        // - Jumpstart: live-typed listings, #N is unique per show → group by #N.
        // - Kickstart: bulk-imported listings let multiple products share #N
        //   (each product has its own #1..#K). Group by full product_name
        //   (including "#N" suffix) so each unique listing slot becomes one
        //   show_item.
        const groupingMode = channel === 'Kickstart' ? 'name' : 'n'
        const groups = groupShowRows(rows, groupingMode)

        // Count valid, failed, cancelled
        let validCount = 0
        let failedCount = 0
        let cancelledCount = 0
        for (const g of groups) {
          const statuses = g.rows.map(r => (getField(r, 'cancelled or failed', 'Status') || '').toLowerCase().trim())
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

    // Group rows by listing slot (channel-aware — see groupShowRows comment).
    // For Kickstart we also assign a synthetic sequential listing_number so
    // bulk-imported listings that share #N across products don't collide on
    // (show_id, listing_number).
    const groupingMode = channel === 'Kickstart' ? 'name' : 'n'
    const groups = groupShowRows(rows, groupingMode)

    const showItems = []
    const skuPerListing = []   // { listing_number, sku, placed_at }
    let validCount = 0
    let seq = 1

    for (const g of groups) {
      const statuses = g.rows.map(r => (getField(r, 'cancelled or failed', 'Status') || '').toLowerCase().trim())
      let itemStatus = 'valid'
      if (statuses.every(s => s === 'cancelled')) itemStatus = 'cancelled'
      else if (statuses.every(s => s === 'failed')) itemStatus = 'failed'

      const bestRow = g.rows.find(r => {
        const s = (getField(r, 'cancelled or failed', 'Status') || '').toLowerCase()
        return !s || (s !== 'failed' && s !== 'cancelled')
      }) || g.rows[0]

      const soldPrice = parseDollar(getField(bestRow, 'sold price', 'Sold Price', 'original item price', 'Original Item Price'))
      const couponAmt = parseDollar(getField(bestRow, 'coupon price', 'Coupon Amount'))
      const listingNumber = groupingMode === 'name' ? seq++ : g.n

      showItems.push({
        show_id: showData.id, listing_number: listingNumber,
        product_name: getField(bestRow, 'product name', 'Product Name') || '',
        buyer_paid: soldPrice, coupon_code: getField(bestRow, 'coupon code', 'Coupon Code') || null,
        coupon_amount: couponAmt, original_hammer: soldPrice + couponAmt,
        status: itemStatus, placed_at: getField(bestRow, 'placed at', 'Placed At') || null,
        whatnot_order_id: getField(bestRow, 'order id', 'Order ID') || null
      })
      if (itemStatus === 'valid') validCount++

      if (channel === 'Kickstart' && itemStatus === 'valid') {
        const sku = (getField(bestRow, 'sku', 'SKU') || '').toString().trim()
        if (sku && /^\d+$/.test(sku)) {
          skuPerListing.push({
            listing_number: listingNumber,
            sku,
            placed_at: getField(bestRow, 'placed at', 'Placed At') || null,
          })
        }
      }
    }

    for (let i = 0; i < showItems.length; i += 500) {
      const { error } = await supabase.from('show_items').insert(showItems.slice(i, i + 500))
      if (error) { setStatus(`❌ Error: ${error.message}`); return }
    }

    await supabase.from('shows').update({ total_items: validCount }).eq('id', showData.id)

    // Kickstart: auto-link SKU-bearing rows to kickstart_intake by creating
    // kickstart_sold_scans. The SKU we put in the Whatnot CSV is the
    // group-representative intake.id; every other intake in that group shares
    // the same whatnot_sku. For each sold unit we claim one unsold intake
    // from the group's pool. Anything left unmatched stays as a row the user
    // can still scan in manually post-show.
    let autoLinked = 0
    if (channel === 'Kickstart' && skuPerListing.length > 0) {
      const skus = Array.from(new Set(skuPerListing.map(s => s.sku)))
      const { data: candidates } = await supabase
        .from('kickstart_intake')
        .select('id, whatnot_sku, upc')
        .in('whatnot_sku', skus)
        .order('id', { ascending: true })

      // Filter out intakes already claimed by prior scans (across all shows
      // so we don't double-assign the same physical unit).
      const candIds = (candidates || []).map(c => c.id)
      let claimed = new Set()
      if (candIds.length > 0) {
        const { data: priorScans } = await supabase
          .from('kickstart_sold_scans')
          .select('intake_id')
          .in('intake_id', candIds)
          .not('intake_id', 'is', null)
        claimed = new Set((priorScans || []).map(s => s.intake_id))
      }
      const poolBySku = new Map()
      for (const c of (candidates || [])) {
        if (claimed.has(c.id)) continue
        if (!poolBySku.has(c.whatnot_sku)) poolBySku.set(c.whatnot_sku, [])
        poolBySku.get(c.whatnot_sku).push(c)
      }

      const newScans = []
      for (const s of skuPerListing) {
        const pool = poolBySku.get(s.sku)
        if (!pool || pool.length === 0) continue
        const intake = pool.shift()
        newScans.push({
          show_id: showData.id,
          listing_number: String(s.listing_number),
          barcode: intake.upc || s.sku,
          intake_id: intake.id,
          scanned_at: s.placed_at,
          scanned_by: 'auto-import',
        })
      }

      for (let i = 0; i < newScans.length; i += 500) {
        const batch = newScans.slice(i, i + 500)
        const { error } = await supabase.from('kickstart_sold_scans').insert(batch)
        if (error) {
          console.error('SKU auto-link failed:', error)
          break
        }
        autoLinked += batch.length
      }
      if (autoLinked > 0) {
        await supabase.from('shows').update({ scanned_count: autoLinked }).eq('id', showData.id)
      }
    }

    const failed = showItems.filter(i => i.status === 'failed').length
    const cancelled = showItems.filter(i => i.status === 'cancelled').length
    const autoNote = autoLinked > 0 ? `, ${autoLinked} auto-linked from SKU` : ''
    setStatus(`✅ "${showName}" — ${validCount} scannable, ${failed} failed, ${cancelled} cancelled${autoNote}`)
    setDetected(null)
    setPendingFile(null)
    refreshShows()
  }

  async function deleteShow(show) {
    if (!confirm(`Are you sure you want to delete "${show.name}"?\n\nThis will also delete all items and scans associated with this show.`)) {
      return
    }
    
    setStatus('Deleting show...')
    // Delete scans first — pick the table that matches this show's channel.
    // Falls back to clearing both when channel is unknown so a stray row in
    // the wrong table can never block the show delete.
    if (show.channel === 'Kickstart') {
      await supabase.from('kickstart_sold_scans').delete().eq('show_id', show.id)
    } else if (show.channel === 'Jumpstart') {
      await supabase.from('jumpstart_sold_scans').delete().eq('show_id', show.id)
    } else {
      await supabase.from('kickstart_sold_scans').delete().eq('show_id', show.id)
      await supabase.from('jumpstart_sold_scans').delete().eq('show_id', show.id)
    }
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
      <div className="relative overflow-hidden rounded-3xl glass-card p-5 shadow-xl shadow-black/30">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
        
        <h3 className="font-bold text-lg font-heading mb-4">Upload Whatnot Show CSV</h3>
        
        <div className="flex gap-4 mb-4">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-500 block mb-1.5">Channel</label>
            <select value={channel} onChange={e => setChannel(e.target.value)} 
              className="bg-white/5 border border-white/10 rounded-2xl px-4 py-2.5 text-sm focus:outline-none focus:border-cyan-500/50 focus:ring-4 focus:ring-cyan-500/10 transition-all">
              <option value="Jumpstart">Jumpstart</option>
              <option value="Kickstart">Kickstart</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-500 block mb-1.5">Streamer</label>
            <select value={streamer} onChange={e => setStreamer(e.target.value)} 
              className="bg-white/5 border border-white/10 rounded-2xl px-4 py-2.5 text-sm focus:outline-none focus:border-cyan-500/50 focus:ring-4 focus:ring-cyan-500/10 transition-all">
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
          <div className={`mt-4 rounded-3xl p-4 ${detected.alreadyExists ? 'bg-red-900/20 border border-red-500/30' : 'bg-white/5 border border-white/10'}`}>
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
      <div className="relative overflow-hidden rounded-3xl glass-card p-5 shadow-xl shadow-black/30">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
        
        <h3 className="font-bold text-lg font-heading mb-4">Uploaded Shows <span className="text-slate-500 font-normal">({existingShows.length})</span></h3>
        
        {existingShows.length === 0 ? (
          <p className="text-sm text-slate-500">No shows uploaded yet.</p>
        ) : (
          <div className="space-y-2">
            {existingShows.map(show => {
              const display = formatShowDisplay(show)
              const isComplete = show.status === 'completed' || !!(show.scanned_count && show.total_items && show.scanned_count >= show.total_items)
              const isTest = show.is_test === true || show.date === '2099-12-31'
              return (
                <div key={show.id} className={`flex justify-between items-center py-3 px-4 rounded-xl border transition-colors ${isComplete ? 'bg-emerald-900/20 border-emerald-500/20' : 'bg-slate-800/30 border-white/[0.04] hover:bg-slate-800/50'}`}>
                  <div>
                    <div className="font-medium flex items-center gap-2 flex-wrap">
                      <span
                        className="text-cyan-400 select-none cursor-pointer"
                        onClick={(e) => {
                          if (e.detail === 3) toggleShowComplete(show)
                        }}
                      >{display.date}</span>
                      <span className="text-slate-500">·</span>
                      <span>{display.channel}</span>
                      <span className="text-slate-500">·</span>
                      <span className="text-cyan-400">{display.streamer}</span>
                      {isComplete
                        ? <span className="text-[10px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full">Complete</span>
                        : !isTest && show.total_items > 0 && <span className="text-[10px] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full">Incomplete</span>
                      }
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {show.total_items || 0} items
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
        <h3 className="text-lg font-bold font-heading">Live Scanner Status</h3>
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
    purple: { border: 'border-cyan-500/50', glow: 'shadow-cyan-600/30' },
    teal: { border: 'border-teal-500/50', glow: 'shadow-teal-500/20' },
    cyan: { border: 'border-cyan-500/50', glow: 'shadow-cyan-500/20' },
    pink: { border: 'border-pink-500/50', glow: 'shadow-pink-500/20' }
  }
  const c = colors[color]

  return (
    <div className={`relative overflow-hidden rounded-3xl glass-card ${isActive ? c.border : ''} p-4 ${isActive ? c.glow : ''}`}>
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

// Normalize expense description so trivial formatting differences between feeds
// collide in the dedupe check. Examples:
//   "Amazon.com*by6029c62"  →  "amazon.com"
//   "Same Day Ach Fee  "    →  "same day ach fee"
//   "Netlify"               →  "netlify"
// Does NOT try to match cross-feed variations like "Ups" vs "Ups Uis-us" —
// those are surfaced in the Potential Duplicates review section below.
function normalizeExpenseDesc(s) {
  if (!s) return ''
  return String(s)
    .toLowerCase()
    .replace(/\*[a-z0-9]+/gi, '')    // strip transaction codes like *by6029c62
    .replace(/[.,;:\-_\/\\]+$/g, '') // strip trailing punctuation
    .replace(/\s+/g, ' ')            // collapse whitespace
    .trim()
}

function ExpenseUpload() {
  const [status, setStatus] = useState('')
  const [uploadLog, setUploadLog] = useState([])
  const [logLoading, setLogLoading] = useState(true)
  const [dupeGroups, setDupeGroups] = useState([])
  const [dupeLoading, setDupeLoading] = useState(true)
  const [dupeRange, setDupeRange] = useState('90') // days
  const [deleting, setDeleting] = useState(null) // row id being deleted

  useEffect(() => { fetchLog() }, [])
  useEffect(() => { fetchDupes() }, [dupeRange])

  const fetchDupes = async () => {
    setDupeLoading(true)
    // Pull all expenses in the selected window
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - parseInt(dupeRange, 10))
    const cutoffStr = cutoff.toISOString().slice(0, 10)
    const { data } = await supabase
      .from('expenses')
      .select('id, date, description, amount, category, created_at')
      .gte('date', cutoffStr)
      .order('date', { ascending: false })
    // Group by (date, amount) — any group with ≥2 rows is a potential dupe cluster.
    // Rows that already share normalized description would have been deduped on
    // import; the leftovers here are cross-feed variations that need human review.
    const groups = {}
    for (const r of data || []) {
      const k = `${r.date}|${Number(r.amount).toFixed(2)}`
      if (!groups[k]) groups[k] = []
      groups[k].push(r)
    }
    const list = Object.entries(groups)
      .filter(([, rows]) => rows.length >= 2)
      .map(([k, rows]) => ({ key: k, date: rows[0].date, amount: rows[0].amount, rows }))
      .sort((a, b) => (a.date < b.date ? 1 : -1))
    setDupeGroups(list)
    setDupeLoading(false)
  }

  const deleteRow = async (id) => {
    setDeleting(id)
    const { error } = await supabase.from('expenses').delete().eq('id', id)
    if (error) {
      alert(`Delete failed: ${error.message}`)
    } else {
      await fetchDupes()
    }
    setDeleting(null)
  }

  const fetchLog = async () => {
    const { data } = await supabase
      .from('expense_upload_log')
      .select('*')
      .order('uploaded_at', { ascending: false })
      .limit(10)
    setUploadLog(data || [])
    setLogLoading(false)
  }

  function handleFile(file) {
    const filename = file.name
    setStatus('Parsing expenses...')
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: async (results) => {
        // Only keep EXPENSES, PAYROLL, and sourcing-related rows
        const normalizeCategory = (raw) => {
          const c = (raw || '').toUpperCase().trim()
          // Co-pilot may label sourcing payroll with spaces/dashes — collapse to canonical token
          if (c === 'PAYROLL - SOURCING FEES' || c === 'PAYROLL-SOURCING FEES' || c === 'PAYROLL SOURCING FEES' || c === 'PAYROLL_SOURCING') return 'PAYROLL_SOURCING'
          return c
        }
        const parsed = results.data.map(row => ({
          date: getField(row, 'date', 'Date') || null,
          description: getField(row, 'name', 'Description', 'Vendor') || '',
          amount: parseFloat((getField(row, 'amount', 'Amount') || '0').toString().replace(/[$,]/g, '')) || 0,
          category: normalizeCategory(getField(row, 'category', 'Category'))
        })).filter(e => e.date && e.amount && ['OPEX', 'PAYROLL', 'PAYROLL_SOURCING', 'SOURCING', 'INVENTORY'].includes(e.category))
        .map(e => {
          // Legacy: convert known Kickstart sourcing vendors from INVENTORY to SOURCING
          // (kept for backward compat with old Co-pilot exports; new exports should already use the right category)
          if (e.category === 'INVENTORY') {
            const desc = e.description.toLowerCase()
            const isKickstartSourcing = desc.includes('reclectic') || desc.includes('businessrsor') || desc.includes('dick')
            return isKickstartSourcing ? { ...e, category: 'SOURCING' } : null
          }
          return e
        }).filter(Boolean)

        if (parsed.length === 0) {
          setStatus('⚠️ No OPEX, PAYROLL, PAYROLL_SOURCING, SOURCING, or INVENTORY rows found')
          return
        }

        setStatus(`Found ${parsed.length} expense/payroll rows. Checking for duplicates...`)

        // Fetch all existing records to deduplicate.
        // Key uses normalized description so trivial formatting differences between
        // feeds (transaction codes, whitespace, trailing punctuation) still collide.
        const existing = await fetchAll(() => supabase.from('expenses').select('date, description, amount'))
        const keyFor = (e) => `${e.date}|${normalizeExpenseDesc(e.description)}|${Number(e.amount).toFixed(2)}`
        const existingKeys = new Set(existing.map(keyFor))

        const newRows = parsed.filter(e => !existingKeys.has(keyFor(e)))

        if (newRows.length === 0) {
          setStatus(`✅ All ${parsed.length} rows already exist — nothing to upload`)
          await supabase.from('expense_upload_log').insert({ rows_added: 0, rows_skipped: parsed.length, filename })
          fetchLog()
          return
        }

        const { error } = await supabase.from('expenses').insert(newRows)
        if (error) { setStatus(`❌ Error: ${error.message}`); return }

        const skipped = parsed.length - newRows.length
        setStatus(`✅ Uploaded ${newRows.length} new rows${skipped > 0 ? ` (${skipped} duplicates skipped)` : ''}`)

        await supabase.from('expense_upload_log').insert({ rows_added: newRows.length, rows_skipped: skipped, filename })
        fetchLog()
      }
    })
  }

  return (
    <div className="relative overflow-hidden rounded-3xl glass-card p-5 shadow-xl shadow-black/30">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      <h3 className="font-bold text-lg font-heading mb-2">Upload Expenses CSV</h3>
      <p className="text-sm text-slate-400 mb-4">Upload Copilot transactions CSV. Only OPEX and PAYROLL rows are imported. Everything else is ignored. Duplicates are automatically skipped.</p>
      <DropZone onFile={handleFile} label="Drop expenses CSV here" />
      {status && <p className="text-sm text-slate-300 mt-3">{status}</p>}

      <div className="mt-5 pt-4 border-t border-white/10 flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold text-white/70">Upload History</h4>
        <button
          onClick={async () => {
            if (!window.confirm('⚠️ DELETE ALL EXPENSE DATA?\n\nThis will permanently remove ALL OpEx and Payroll rows from the database. You will need to re-upload your Copilot CSV to restore the data.\n\nAre you sure?')) return
            setStatus('Deleting all expenses...')
            const { error } = await supabase.from('expenses').delete().neq('id', 0)
            if (error) { setStatus(`❌ Delete failed: ${error.message}`); return }
            await supabase.from('expense_upload_log').delete().neq('id', 0)
            setStatus('✅ All expense data deleted. Upload a new CSV to reload.')
            fetchLog()
          }}
          className="text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 px-2 py-1 rounded transition-colors"
        >
          Delete All
        </button>
      </div>
      <div>
        {logLoading ? (
          <p className="text-xs text-slate-500">Loading...</p>
        ) : uploadLog.length === 0 ? (
          <p className="text-xs text-slate-500">No uploads yet</p>
        ) : (
          <div className="space-y-1.5">
            {uploadLog.map(log => (
              <div key={log.id} className="flex items-center justify-between text-xs gap-3">
                <div className="text-slate-400 flex-shrink-0">
                  {new Date(log.uploaded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  {' '}
                  <span className="text-slate-500">{new Date(log.uploaded_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                </div>
                {log.filename && <span className="text-slate-500 truncate min-w-0">{log.filename}</span>}
                <div className="text-right flex-shrink-0">
                  {log.rows_added > 0 && <span className="text-emerald-400 font-medium">+{log.rows_added}</span>}
                  {log.rows_added > 0 && log.rows_skipped > 0 && <span className="text-slate-600 mx-1">·</span>}
                  {log.rows_skipped > 0 && <span className="text-slate-500">{log.rows_skipped} skipped</span>}
                  {log.rows_added === 0 && log.rows_skipped === 0 && <span className="text-slate-500">empty</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Potential duplicates review */}
      <div className="mt-6 pt-4 border-t border-white/10">
        <div className="flex items-center justify-between mb-2 gap-3">
          <div>
            <h4 className="text-sm font-semibold text-white/90">Potential Duplicates</h4>
            <p className="text-xs text-slate-500">Same date + same amount across feeds. Cross-check descriptions and delete dupes one-by-one.</p>
          </div>
          <select
            value={dupeRange}
            onChange={(e) => setDupeRange(e.target.value)}
            className="text-xs bg-white/5 border border-white/10 text-white rounded-lg px-2 py-1 focus:outline-none focus:border-pink-500/50"
          >
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="180">Last 180 days</option>
            <option value="365">Last 365 days</option>
          </select>
        </div>
        {dupeLoading ? (
          <p className="text-xs text-slate-500">Loading...</p>
        ) : dupeGroups.length === 0 ? (
          <p className="text-xs text-emerald-400/80">✓ No suspected duplicates in this window.</p>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {dupeGroups.map(group => (
              <div key={group.key} className="bg-white/[0.03] rounded-2xl p-3 border border-white/5">
                <div className="flex items-center justify-between mb-2 text-xs">
                  <span className="text-slate-400">{group.date}</span>
                  <span className="font-mono text-amber-300 font-bold">${Number(group.amount).toFixed(2)}</span>
                  <span className="text-slate-500">{group.rows.length} rows</span>
                </div>
                <div className="space-y-1">
                  {group.rows.map(r => (
                    <div key={r.id} className="flex items-center gap-2 text-xs">
                      <span className="text-white/70 truncate flex-1">{r.description}</span>
                      <span className="text-slate-600 shrink-0">{r.category}</span>
                      <button
                        onClick={() => {
                          if (!window.confirm(`Delete this row?\n\n${r.date} · $${Number(r.amount).toFixed(2)}\n${r.description}`)) return
                          deleteRow(r.id)
                        }}
                        disabled={deleting === r.id}
                        className="text-red-400/70 hover:text-red-300 hover:bg-red-500/10 rounded px-1.5 py-0.5 text-xs transition-colors disabled:opacity-50"
                        aria-label="Delete"
                      >
                        {deleting === r.id ? '…' : '×'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
