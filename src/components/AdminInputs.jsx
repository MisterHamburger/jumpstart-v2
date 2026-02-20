import { useState, useEffect, useRef } from 'react'
import Papa from 'papaparse'
import { supabase } from '../lib/supabase'
import { normalizeBarcode } from '../lib/barcodes'

export default function AdminInputs() {
  const [activeSection, setActiveSection] = useState('manifests')

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Data Inputs</h2>
      <div className="flex gap-2 mb-6 overflow-x-auto">
        {['manifests', 'shows', 'scans', 'expenses'].map(s => (
          <button key={s} onClick={() => setActiveSection(s)}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors
              ${activeSection === s ? 'bg-slate-700 text-white' : 'text-slate-400 hover:bg-slate-700/50'}`}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>
      {activeSection === 'manifests' && <ManifestUpload />}
      {activeSection === 'shows' && <ShowUpload />}
      {activeSection === 'scans' && <ScanImport />}
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
        ${dragging ? 'border-purple-400 bg-purple-900/20' : 'border-slate-600 hover:border-slate-400'}`}
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

// ── MANIFESTS (Combined Load + Upload) ──────────────────────────────────────────
function ManifestUpload() {
  const [loads, setLoads] = useState([])
  const [form, setForm] = useState({ date: '', channel: 'Jumpstart', notes: '' })
  const [status, setStatus] = useState('')
  const [progress, setProgress] = useState(null)
  const [pendingFile, setPendingFile] = useState(null)
  const [pendingRows, setPendingRows] = useState(null)
  const [pendingItemCount, setPendingItemCount] = useState(0)

  useEffect(() => { refreshLoads() }, [])

  async function refreshLoads() {
    const { data } = await supabase.from('loads').select('*').order('id', { ascending: false })
    setLoads(data || [])
  }

  function handleFile(file) {
    setStatus('Parsing CSV...')
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: (results) => {
        const rows = results.data.filter(row => {
          const barcode = getField(row, 'UNIVERSAL ID', 'Unique ID', 'UPC', 'Barcode')
          return barcode && barcode.toString().trim()
        })
        
        // Calculate total items including SCAN QUANTITY
        let totalItems = 0
        for (const row of rows) {
          const qty = parseInt(getField(row, 'SCAN QUANTITY', 'Scan Quantity', 'Quantity', 'Qty')) || 1
          totalItems += qty
        }
        
        setPendingFile(file)
        setPendingRows(rows)
        setPendingItemCount(totalItems)
        setStatus(`Found ${totalItems} items to upload.`)
      },
      error: (err) => {
        setStatus(`❌ Error parsing CSV: ${err.message}`)
      }
    })
  }

  async function handleUpload() {
    if (!form.date) { setStatus('⚠️ Please select Date Paid'); return }
    if (!pendingRows || pendingRows.length === 0) { setStatus('⚠️ No items to upload'); return }

    setStatus('Creating load...')
    
    // Get next load number
    const { data: maxLoad } = await supabase
      .from('loads')
      .select('id')
      .order('id', { ascending: false })
      .limit(1)
    
    const nextId = maxLoad && maxLoad.length > 0 ? String(parseInt(maxLoad[0].id) + 1) : '1'
    
    // Create the load
    const { data: loadData, error: loadError } = await supabase
      .from('loads')
      .insert({
        id: nextId,
        date: form.date,
        channel: form.channel,
        notes: form.notes || null
      })
      .select()
      .single()

    if (loadError) {
      setStatus(`❌ Error creating load: ${loadError.message}`)
      return
    }

    const loadId = loadData.id
    setStatus(`Load #${loadId} created. Uploading ${pendingRows.length} items...`)

    // Process items - handle SCAN QUANTITY for multiples
    const items = []
    for (const row of pendingRows) {
      const barcode = getField(row, 'UNIVERSAL ID', 'Unique ID', 'UPC', 'Barcode') || ''
      const msrp = parseDollar(getField(row, 'Unit Retail', 'MSRP')) || null
      const cogs = parseDollar(getField(row, 'COGS', 'Cost', 'Cost+Freight')) || null
      const category = getField(row, 'Category (Department)', 'Category', 'DEPARTMENT NAME') || ''
      const scanQty = parseInt(getField(row, 'SCAN QUANTITY', 'Scan Quantity', 'Quantity', 'Qty')) || 1
      
      // Zone assignment based on MSRP
      let zone = null
      if (msrp >= 98) zone = 1
      else if (msrp >= 40) zone = 2
      else zone = 3

      const baseItem = {
        barcode: normalizeBarcode(barcode),
        barcode_raw: barcode,
        description: getField(row, 'DESCRIPTION', 'Description', 'Product Name') || '',
        category: category,
        subclass: getField(row, 'Subclass') || '',
        size: getField(row, 'SIZE', 'Size') || '',
        color: getField(row, 'COLOR', 'Color') || '',
        style: getField(row, 'STYLE', 'Style') || '',
        vendor: getField(row, 'Vendor', 'Brand') || '',
        part_number: getField(row, 'Part Number', 'Item') || '',
        gender: getField(row, 'Gender') || '',
        department: getField(row, 'DEPARTMENT NAME') || '',
        msrp: msrp,
        cost_freight: cogs,
        zone: zone,
        load_id: loadId,
        channel: form.channel
      }

      // Create multiple records if SCAN QUANTITY > 1
      for (let i = 0; i < scanQty; i++) {
        items.push({ ...baseItem })
      }
    }

    // Upload in batches
    let uploaded = 0
    let errors = 0

    for (let i = 0; i < items.length; i += 500) {
      const batch = items.slice(i, i + 500)
      const { error } = await supabase.from('items').insert(batch)
      if (error) {
        console.error('Batch error:', error)
        errors += batch.length
      } else {
        uploaded += batch.length
      }
      setProgress(Math.round(((i + batch.length) / items.length) * 100))
    }

    // Update load with item count
    await supabase.from('loads').update({ item_count: uploaded }).eq('id', loadId)

    if (errors > 0) {
      setStatus(`⚠️ Load #${loadId}: ${uploaded} items uploaded, ${errors} failed.`)
    } else {
      setStatus(`✅ Load #${loadId} created with ${uploaded} items`)
    }
    
    setProgress(null)
    setPendingFile(null)
    setPendingRows(null)
    setForm({ date: '', channel: 'Jumpstart', freight_cost: '', notes: '' })
    refreshLoads()
  }

  function formatDate(dateStr) {
    if (!dateStr) return ''
    const d = new Date(dateStr + 'T12:00:00')
    return `${d.getMonth() + 1}.${d.getDate()}.${String(d.getFullYear()).slice(2)}`
  }

  async function deleteLoad(id) {
    if (!confirm(`Delete Load #${id} and all its items?`)) return
    await supabase.from('items').delete().eq('load_id', id)
    await supabase.from('loads').delete().eq('id', id)
    refreshLoads()
  }

  return (
    <div className="space-y-6">
      {/* Upload Section */}
      <div className="bg-slate-800 rounded-xl p-5">
        <h3 className="font-bold mb-4 text-lg">Upload Manifest</h3>
        
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Date Paid *</label>
            <input 
              type="date" 
              value={form.date} 
              onChange={e => setForm({...form, date: e.target.value})} 
              className="w-full bg-slate-700 rounded-lg px-3 py-2.5 text-sm" 
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Channel *</label>
            <select 
              value={form.channel} 
              onChange={e => setForm({...form, channel: e.target.value})}
              className="w-full bg-slate-700 rounded-lg px-3 py-2.5 text-sm"
            >
              <option value="Jumpstart">Jumpstart</option>
              <option value="Kickstart">Kickstart</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Notes</label>
            <input 
              placeholder="e.g., JCrew Rural Hall"
              value={form.notes} 
              onChange={e => setForm({...form, notes: e.target.value})} 
              className="w-full bg-slate-700 rounded-lg px-3 py-2.5 text-sm" 
            />
          </div>
        </div>

        <DropZone onFile={handleFile} label="Drop manifest CSV here or click to browse" />

        {/* Preview / Confirm */}
        {pendingRows && (
          <div className="mt-4 bg-slate-900 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <span className="text-cyan-400 font-bold text-lg">{pendingItemCount}</span>
                <span className="text-slate-400 ml-2">items ready</span>
              </div>
              {form.date && (
                <span className="text-sm text-slate-500">
                  Will create Load #{loads.length > 0 && loads[0].id ? parseInt(loads[0].id) + 1 : 1}
                </span>
              )}
            </div>
            <button 
              onClick={handleUpload}
              className="w-full bg-purple-600 hover:bg-purple-500 py-3 rounded-lg font-semibold transition-colors"
            >
              Upload Manifest
            </button>
          </div>
        )}

        {progress !== null && (
          <div className="w-full bg-slate-700 rounded-full h-2 mt-4">
            <div className="bg-purple-500 h-2 rounded-full transition-all" style={{width: `${progress}%`}} />
          </div>
        )}

        {status && (
          <p className={`text-sm mt-3 ${
            status.includes('❌') ? 'text-red-400' : 
            status.includes('⚠️') ? 'text-amber-400' : 
            status.includes('✅') ? 'text-green-400' : 
            'text-slate-300'
          }`}>{status}</p>
        )}
      </div>

      {/* Existing Loads */}
      <div className="bg-slate-800 rounded-xl p-5">
        <h3 className="font-bold mb-4">Uploaded Loads ({loads.length})</h3>
        {loads.length === 0 ? (
          <p className="text-sm text-slate-400">No loads uploaded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="text-left py-2 px-3 text-slate-400 font-medium">#</th>
                  <th className="text-left py-2 px-3 text-slate-400 font-medium">Date Paid</th>
                  <th className="text-left py-2 px-3 text-slate-400 font-medium">Channel</th>
                  <th className="text-right py-2 px-3 text-slate-400 font-medium">Items</th>
                  <th className="text-right py-2 px-3 text-slate-400 font-medium">Freight</th>
                  <th className="text-left py-2 px-3 text-slate-400 font-medium">Notes</th>
                  <th className="text-right py-2 px-3"></th>
                </tr>
              </thead>
              <tbody>
                {loads.map(l => (
                  <tr key={l.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                    <td className="py-3 px-3 font-bold text-white">{l.id}</td>
                    <td className="py-3 px-3 text-white">{formatDate(l.date)}</td>
                    <td className="py-3 px-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        l.channel === 'Kickstart' ? 'bg-fuchsia-500/20 text-fuchsia-300' : 'bg-cyan-500/20 text-cyan-300'
                      }`}>
                        {l.channel}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right text-slate-300">{l.item_count?.toLocaleString() || '—'}</td>
                    <td className="py-3 px-3 text-right text-slate-300">
                      {l.freight_cost ? `$${Number(l.freight_cost).toLocaleString()}` : '—'}
                    </td>
                    <td className="py-3 px-3 text-slate-400">{l.notes || '—'}</td>
                    <td className="py-3 px-3 text-right">
                      <button 
                        onClick={() => deleteLoad(l.id)}
                        className="text-red-400 hover:text-red-300 text-xs"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}


// ── SHOW CSV UPLOAD (Auto-detect date, manual streamer select) ─────
function ShowUpload() {
  const [channel, setChannel] = useState('Jumpstart')
  const [streamer, setStreamer] = useState('')
  const [status, setStatus] = useState('')
  const [detected, setDetected] = useState(null)
  const [pendingFile, setPendingFile] = useState(null)
  const [existingShows, setExistingShows] = useState([])
  
  // Hardcoded streamers for now - can make this dynamic later
  const streamers = ['Bri', 'Laura', 'Josh', 'Hannah']

  useEffect(() => { refreshShows() }, [])

  async function refreshShows() {
    const { data } = await supabase.from('shows').select('*').order('date', { ascending: false })
    setExistingShows(data || [])
  }

  function handleFile(file) {
    if (!streamer) {
      setStatus('⚠️ Please select a streamer first')
      return
    }
    
    setStatus('Analyzing CSV...')
    setDetected(null)
    setPendingFile(null)

    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: (results) => {
        const rows = results.data
        const timestamps = []
        for (const row of rows) {
          const t = getField(row, 'placed at', 'Placed At')
          if (t) timestamps.push(t)
        }

        if (timestamps.length === 0) {
          setStatus('❌ No timestamps found in CSV. Cannot auto-detect date.')
          return
        }

        // Parse timestamp to get the date
        const firstTsStr = timestamps[0]
        let showDate
        
        // Try to parse date from timestamp string directly
        const dateMatch = firstTsStr.match(/(\d{4})-(\d{2})-(\d{2})/)
        if (dateMatch) {
          const [, year, month, day] = dateMatch
          // Format as MM-DD-YYYY for American reading
          showDate = `${month}-${day}-${year}`
        } else {
          // Fallback to Date parsing
          const parsed = new Date(firstTsStr)
          const month = String(parsed.getMonth() + 1).padStart(2, '0')
          const day = String(parsed.getDate()).padStart(2, '0')
          const year = parsed.getFullYear()
          showDate = `${month}-${day}-${year}`
        }

        // Count valid listings
        let orderCount = 0
        const seen = new Set()
        for (const row of rows) {
          const productName = getField(row, 'product name', 'Product Name') || ''
          const matchNum = productName.match(/#(\d+)/)
          if (!matchNum) continue
          const lowerName = productName.toLowerCase()
          if (lowerName.includes('gift card') || lowerName.includes('account credit') || lowerName.includes('store credit')) continue
          const listing = matchNum[1]
          if (!seen.has(listing)) { seen.add(listing); orderCount++ }
        }

        const showName = `${showDate}-${channel}-${streamer}`
        const alreadyExists = existingShows.some(s => s.name === showName)

        setDetected({ date: showDate, orderCount, showName, alreadyExists })
        setPendingFile({ file, rows })
        setStatus('')
      }
    })
  }

  async function confirmUpload() {
    if (!pendingFile || !detected) return

    const { rows } = pendingFile
    const { date, showName } = detected

    setStatus('Creating show...')
    
    // Parse date back to YYYY-MM-DD for database storage
    const [month, day, year] = date.split('-')
    const dbDate = `${year}-${month}-${day}`

    const { data: showData, error: showError } = await supabase.from('shows').insert({
      name: showName, date: dbDate, streamer: streamer, channel, status: 'pending'
    }).select().single()

    if (showError) {
      setStatus(`❌ Error creating show: ${showError.message}`)
      return
    }

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
    setStreamer('')
    refreshShows()
  }

  return (
    <div className="space-y-4">
      <div className="bg-slate-800 rounded-xl p-4">
        <h3 className="font-bold mb-3">Upload Whatnot Show CSV</h3>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1">Channel</label>
              <select value={channel} onChange={e => setChannel(e.target.value)} className="w-full bg-slate-700 rounded-lg px-3 py-2 text-sm">
                <option value="Jumpstart">Jumpstart</option>
                <option value="Kickstart">Kickstart</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Streamer *</label>
              <select value={streamer} onChange={e => setStreamer(e.target.value)} className="w-full bg-slate-700 rounded-lg px-3 py-2 text-sm">
                <option value="">Select streamer...</option>
                {streamers.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <DropZone onFile={handleFile} label="Drop Whatnot CSV here or click to browse" />

          {detected && (
            <div className={`rounded-xl p-4 ${detected.alreadyExists ? 'bg-red-900/30 border border-red-600' : 'bg-slate-700'}`}>
              <div className="text-sm font-bold mb-2">
                {detected.alreadyExists ? '⚠️ This show already exists!' : '📋 Show info:'}
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                <div><span className="text-slate-400">Date: </span><span className="font-medium">{detected.date}</span></div>
                <div><span className="text-slate-400">Streamer: </span><span className="font-medium">{streamer}</span></div>
                <div><span className="text-slate-400">Channel: </span><span className="font-medium">{channel}</span></div>
                <div><span className="text-slate-400">Listings: </span><span className="font-medium">{detected.orderCount}</span></div>
              </div>
              <div className="text-xs text-slate-500 mb-3">Show name: <span className="font-mono">{detected.showName}</span></div>

              {detected.alreadyExists ? (
                <div className="text-sm text-red-400">This show has already been uploaded. Delete the existing one first if you need to re-upload.</div>
              ) : (
                <div className="flex gap-3">
                  <button onClick={confirmUpload} className="bg-green-600 hover:bg-green-500 px-4 py-2 rounded-lg text-sm font-medium">
                    ✓ Looks right — Upload
                  </button>
                  <button onClick={() => { setDetected(null); setPendingFile(null) }} className="bg-slate-600 hover:bg-slate-500 px-4 py-2 rounded-lg text-sm font-medium">
                    ✗ Cancel
                  </button>
                </div>
              )}
            </div>
          )}

          {status && <p className={`text-sm ${status.includes('❌') ? 'text-red-400' : status.includes('⚠️') ? 'text-amber-400' : 'text-slate-300'}`}>{status}</p>}
        </div>
      </div>

      <div className="bg-slate-800 rounded-xl p-4">
        <h3 className="font-bold mb-3">Uploaded Shows ({existingShows.length})</h3>
        {existingShows.length === 0 ? (
          <p className="text-sm text-slate-400">No shows uploaded yet.</p>
        ) : (
          <div className="space-y-2">
            {existingShows.map(show => (
              <div key={show.id} className="flex justify-between items-center py-2 px-3 rounded-lg bg-slate-700/50">
                <div>
                  <div className="text-sm font-medium">{show.name}</div>
                  <div className="text-xs text-slate-400">{show.channel} · {show.streamer || show.time_of_day || 'unknown'} · {show.total_items || 0} items</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-xs px-2 py-1 rounded ${
                    show.status === 'completed' ? 'bg-green-900 text-green-400' :
                    show.status === 'scanning' ? 'bg-yellow-900 text-yellow-400' :
                    'bg-slate-600 text-slate-300'
                  }`}>
                    {show.scanned_count || 0}/{show.total_items || 0} scanned
                  </span>
                  <button 
                    onClick={async () => {
                      if (confirm(`Delete "${show.name}" and all its data? This cannot be undone.`)) {
                        await supabase.from('scans').delete().eq('show_id', show.id)
                        await supabase.from('show_items').delete().eq('show_id', show.id)
                        await supabase.from('shows').delete().eq('id', show.id)
                        refreshShows()
                      }
                    }}
                    className="text-red-400 hover:text-red-300 text-xs"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── SCAN IMPORT ───────────────────────────────────
function ScanImport() {
  const [status, setStatus] = useState('')
  const [progress, setProgress] = useState(null)

  async function handleFile(file) {
    setStatus('Parsing scan sessions...')
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: async (results) => {
        const rows = results.data
        setStatus(`Parsed ${rows.length} rows. Loading shows...`)

        const { data: shows } = await supabase.from('shows').select('id, name, date, time_of_day, channel')
        if (!shows || shows.length === 0) {
          setStatus('❌ No shows found. Upload show CSVs first.')
          return
        }

        const showByName = {}
        const showByDateTime = {}
        for (const s of shows) {
          showByName[s.name.toLowerCase()] = s
          // Also index by old format for backwards compatibility
          if (s.time_of_day) {
            showByDateTime[`${s.date}-${s.time_of_day}`.toLowerCase()] = s
          }
        }

        const scans = []
        let skipped = 0
        let noShow = 0

        for (const row of rows) {
          const barcode = (row['Barcode'] || '').trim()
          const listing = parseInt(row['Listing Number'])
          const date = (row['Date of show'] || '').trim()
          const time = (row['Time'] || '').trim().toLowerCase()
          if (!barcode || !listing || !date || !time) { skipped++; continue }

          // Try multiple name formats to find the show
          const showNameOld = `${date}-Jumpstart-${time}`.toLowerCase()
          const dateTimeKey = `${date}-${time}`.toLowerCase()
          const show = showByName[showNameOld] || showByDateTime[dateTimeKey]
          if (!show) { noShow++; continue }

          scans.push({ show_id: show.id, barcode: normalizeBarcode(barcode), listing_number: listing, scanned_by: 'migration' })
        }

        if (scans.length === 0) {
          setStatus(`❌ No scans matched. ${noShow} had no matching show, ${skipped} blank rows.`)
          return
        }

        setStatus(`Uploading ${scans.length} scans...`)
        let uploaded = 0
        let dupes = 0

        for (let i = 0; i < scans.length; i += 500) {
          const batch = scans.slice(i, i + 500)
          const { error } = await supabase.from('scans').upsert(batch, { onConflict: 'show_id,listing_number', ignoreDuplicates: true })
          if (error) {
            for (const scan of batch) {
              const { error: rowErr } = await supabase.from('scans').insert(scan)
              if (rowErr) dupes++; else uploaded++
            }
          } else {
            uploaded += batch.length
          }
          setProgress(Math.round(((i + batch.length) / scans.length) * 100))
        }

        setStatus(`✅ ${uploaded} scans imported. ${dupes} duplicates skipped. ${noShow} no matching show. ${skipped} blank rows.`)
        setProgress(null)
      }
    })
  }

  return (
    <div className="bg-slate-800 rounded-xl p-4">
      <h3 className="font-bold mb-3">Import Scan Sessions</h3>
      <p className="text-xs text-slate-400 mb-3">Upload the Scan Sessions CSV from Google Sheets. All shows must be uploaded first.</p>
      <DropZone onFile={handleFile} label="Drop Scan Sessions CSV here or click to browse" />
      {progress !== null && (
        <div className="w-full bg-slate-700 rounded-full h-2 mt-3">
          <div className="bg-blue-500 h-2 rounded-full transition-all" style={{width: `${progress}%`}} />
        </div>
      )}
      {status && <p className="text-sm text-slate-300 mt-2">{status}</p>}
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
