import { useState, useEffect, useRef } from 'react'
import Papa from 'papaparse'
import { supabase } from '../lib/supabase'
import { normalizeBarcode } from '../lib/barcodes'

export default function AdminInputs() {
  const [activeSection, setActiveSection] = useState('shows')

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Data Inputs</h2>
      <div className="flex gap-2 mb-6 overflow-x-auto">
        {['shows', 'scans', 'manifests', 'expenses'].map(s => (
          <button key={s} onClick={() => setActiveSection(s)}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors
              ${activeSection === s ? 'bg-slate-700 text-white' : 'text-slate-400 hover:bg-slate-700/50'}`}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>
      {activeSection === 'shows' && <ShowUpload />}
      {activeSection === 'scans' && <ScanMonitor />}
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
      className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors
        ${dragging ? 'border-blue-400 bg-blue-900/20' : 'border-slate-600 hover:border-slate-400'}`}
    >
      <input ref={inputRef} type="file" accept={accept} onChange={handleChange} className="hidden" />
      <div className="text-3xl mb-2">{dragging ? '📂' : '📄'}</div>
      <div className="text-sm text-slate-400">{fileName || label}</div>
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
          {loads.map(l => (
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
                  <div className="font-semibold text-white">{l.id}</div>
                  <div className="text-xs text-slate-500 mt-1">
                    {l.vendor} · {l.date}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-slate-300">{l.item_count.toLocaleString()} items</div>
                  <div className="text-xs text-slate-500">${Number(l.total_cost_actual).toLocaleString(undefined, {minimumFractionDigits: 2})}</div>
                </div>
              </div>
            </div>
          ))}
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

        // Count valid listings (not gift cards)
        let orderCount = 0
        const seen = new Set()
        for (const row of rows) {
          const productName = getField(row, 'product name', 'Product Name') || ''
          const match = productName.match(/#(\d+)/)
          if (!match) continue
          const lowerName = productName.toLowerCase()
          if (lowerName.includes('gift card') || lowerName.includes('account credit') || lowerName.includes('store credit')) continue
          const listing = match[1]
          if (!seen.has(listing)) { seen.add(listing); orderCount++ }
        }

        // Check if this show already exists
        // Format: 02-19-2026-Jumpstart-Bri
        const [year, month, day] = showDate.split('-')
        const showName = `${month}-${day}-${year}-${channel}-${streamer}`
        const alreadyExists = existingShows.some(s => s.name === showName)

        setDetected({ date: showDate, timeOfDay, orderCount, showName, alreadyExists, firstOrder: timestamps[0], lastOrder: timestamps[timestamps.length - 1] })
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
      name: showName, date, time_of_day: timeOfDay, channel, status: 'pending'
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
                <span className="text-slate-500 text-xs block">Listings</span>
                <span className="font-semibold">{detected.orderCount}</span>
              </div>
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
  const [stats, setStats] = useState({ total: 0, today: 0, byShow: [] })
  const [recentScans, setRecentScans] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadStats()
    loadRecentScans()
    // Auto-refresh every 30 seconds
    const interval = setInterval(() => {
      loadStats()
      loadRecentScans()
    }, 30000)
    return () => clearInterval(interval)
  }, [])

  async function loadStats() {
    // Total scans
    const { count: total } = await supabase.from('jumpstart_sold_scans').select('id', { count: 'exact', head: true })
    
    // Today's scans
    const today = new Date().toISOString().split('T')[0]
    const { count: todayCount } = await supabase
      .from('jumpstart_sold_scans')
      .select('id', { count: 'exact', head: true })
      .gte('scanned_at', today)
    
    // Scans by show (recent 10 shows)
    const { data: shows } = await supabase
      .from('shows')
      .select('id, name, date, time_of_day, channel')
      .order('date', { ascending: false })
      .limit(10)
    
    if (shows) {
      const byShow = await Promise.all(shows.map(async (show) => {
        const { count: scanCount } = await supabase
          .from('jumpstart_sold_scans')
          .select('id', { count: 'exact', head: true })
          .eq('show_id', show.id)
        
        const { count: itemCount } = await supabase
          .from('show_items')
          .select('id', { count: 'exact', head: true })
          .eq('show_id', show.id)
          .eq('status', 'valid')
        
        return {
          ...show,
          scanned: scanCount || 0,
          total: itemCount || 0
        }
      }))
      
      setStats({ total: total || 0, today: todayCount || 0, byShow })
    }
    
    setLoading(false)
  }

  async function loadRecentScans() {
    const { data } = await supabase
      .from('jumpstart_sold_scans')
      .select('id, barcode, listing_number, scanned_at, show_id')
      .order('scanned_at', { ascending: false })
      .limit(20)
    
    if (data) {
      // Get show names for these scans
      const showIds = [...new Set(data.map(s => s.show_id))]
      const { data: shows } = await supabase
        .from('shows')
        .select('id, name')
        .in('id', showIds)
      
      const showMap = {}
      shows?.forEach(s => showMap[s.id] = s.name)
      
      setRecentScans(data.map(scan => ({
        ...scan,
        show_name: showMap[scan.show_id] || 'Unknown'
      })))
    }
  }

  function formatShowName(name) {
    if (!name) return 'Unknown'
    // New format: 02-19-2026-Jumpstart-Bri
    const newMatch = name.match(/^(\d{2})-(\d{2})-(\d{4})-(\w+)-(\w+)$/)
    if (newMatch) {
      const [, month, day, year, channel, streamer] = newMatch
      return `${month}/${day} - ${streamer}`
    }
    // Old format: 2026-02-19-Jumpstart-evening
    const oldMatch = name.match(/(\d{4})-(\d{2})-(\d{2})-(\w+)-(\w+)/)
    if (oldMatch) {
      const [, year, month, day, channel, time] = oldMatch
      return `${month}/${day} - ${time}`
    }
    return name
  }

  function formatTime(ts) {
    if (!ts) return '—'
    const d = new Date(ts)
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="relative">
          <div className="w-10 h-10 border-2 border-cyan-500/20 rounded-full" />
          <div className="absolute inset-0 w-10 h-10 border-2 border-transparent border-t-cyan-500 rounded-full animate-spin" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-4">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-b from-slate-800/60 to-slate-900/40 border border-white/[0.08] p-5 shadow-xl shadow-black/30">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
          <div className="text-[10px] uppercase tracking-[0.15em] font-semibold text-slate-500 mb-1">Total Scans</div>
          <div className="text-3xl font-bold text-white">{stats.total.toLocaleString()}</div>
        </div>
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-b from-slate-800/60 to-slate-900/40 border border-white/[0.08] p-5 shadow-xl shadow-black/30">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
          <div className="text-[10px] uppercase tracking-[0.15em] font-semibold text-slate-500 mb-1">Today</div>
          <div className="text-3xl font-bold text-cyan-400">{stats.today.toLocaleString()}</div>
        </div>
      </div>

      {/* Scans by Show */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-b from-slate-800/60 to-slate-900/40 border border-white/[0.08] p-5 shadow-xl shadow-black/30">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
        <h3 className="font-bold text-lg mb-4">Scan Progress by Show</h3>
        <div className="space-y-3">
          {stats.byShow.map(show => {
            const pct = show.total > 0 ? Math.round((show.scanned / show.total) * 100) : 0
            const isComplete = pct >= 100
            return (
              <div key={show.id} className="rounded-xl bg-slate-800/30 border border-white/[0.04] p-3">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-medium text-white">{formatShowName(show.name)}</span>
                  <span className={`text-sm font-semibold ${isComplete ? 'text-emerald-400' : 'text-slate-400'}`}>
                    {show.scanned}/{show.total} ({pct}%)
                  </span>
                </div>
                <div className="h-2 rounded-full bg-slate-700 overflow-hidden">
                  <div 
                    className={`h-full rounded-full transition-all ${isComplete ? 'bg-emerald-500' : 'bg-cyan-500'}`}
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Recent Scans */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-b from-slate-800/60 to-slate-900/40 border border-white/[0.08] p-5 shadow-xl shadow-black/30">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold text-lg">Recent Scans</h3>
          <span className="text-xs text-slate-500">Auto-refreshes every 30s</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.08]">
                <th className="text-left py-2 px-3 text-[11px] uppercase tracking-wider font-semibold text-slate-400">Barcode</th>
                <th className="text-left py-2 px-3 text-[11px] uppercase tracking-wider font-semibold text-slate-400">Listing</th>
                <th className="text-left py-2 px-3 text-[11px] uppercase tracking-wider font-semibold text-slate-400">Show</th>
                <th className="text-left py-2 px-3 text-[11px] uppercase tracking-wider font-semibold text-slate-400">Scanned</th>
              </tr>
            </thead>
            <tbody>
              {recentScans.map(scan => (
                <tr key={scan.id} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                  <td className="py-2 px-3 font-mono text-xs text-slate-300">{scan.barcode}</td>
                  <td className="py-2 px-3 text-cyan-400">#{scan.listing_number}</td>
                  <td className="py-2 px-3 text-slate-400">{formatShowName(scan.show_name)}</td>
                  <td className="py-2 px-3 text-slate-500 text-xs">{formatTime(scan.scanned_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
    <div className="bg-slate-800 rounded-xl p-4">
      <h3 className="font-bold mb-3">Upload Expenses CSV</h3>
      <p className="text-xs text-slate-400 mb-3">Upload Copilot transactions CSV. Only EXPENSES and PAYROLL categories are used in the P&L.</p>
      <DropZone onFile={handleFile} label="Drop expenses CSV here or click to browse" />
      {status && <p className="text-sm text-slate-300 mt-2">{status}</p>}
    </div>
  )
}
