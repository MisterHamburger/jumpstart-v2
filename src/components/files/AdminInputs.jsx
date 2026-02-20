import { useState, useEffect, useRef } from 'react'
import Papa from 'papaparse'
import { supabase } from '../lib/supabase'
import { normalizeBarcode } from '../lib/barcodes'

export default function AdminInputs() {
  const [activeSection, setActiveSection] = useState('loads')

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Data Inputs</h2>
      <div className="flex gap-2 mb-6 overflow-x-auto">
        {['loads', 'manifests', 'shows', 'scans', 'expenses'].map(s => (
          <button key={s} onClick={() => setActiveSection(s)}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors
              ${activeSection === s ? 'bg-slate-700 text-white' : 'text-slate-400 hover:bg-slate-700/50'}`}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>
      {activeSection === 'loads' && <LoadsSection />}
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

// ── LOADS ──────────────────────────────────────────
function LoadsSection() {
  const [loads, setLoads] = useState([])
  const [form, setForm] = useState({ id: '', date: '', vendor: '', quantity: '', total_cost: '', notes: '' })
  const [msg, setMsg] = useState('')

  useEffect(() => { refreshLoads() }, [])

  async function refreshLoads() {
    const { data } = await supabase.from('loads').select('*').order('date', { ascending: false })
    setLoads(data || [])
  }

  async function saveLoad(e) {
    e.preventDefault()
    const loadId = form.id || `LOAD-${form.date}-001`
    const { error } = await supabase.from('loads').upsert({
      id: loadId, date: form.date, vendor: form.vendor,
      quantity: parseInt(form.quantity) || null,
      total_cost: parseFloat(form.total_cost) || null,
      notes: form.notes
    })
    if (error) { setMsg(`Error: ${error.message}`); return }
    setMsg('Load saved!')
    setForm({ id: '', date: '', vendor: '', quantity: '', total_cost: '', notes: '' })
    refreshLoads()
  }

  return (
    <div>
      <form onSubmit={saveLoad} className="bg-slate-800 rounded-xl p-4 mb-6 space-y-3">
        <h3 className="font-bold mb-2">Add / Edit Load</h3>
        <div className="grid grid-cols-2 gap-3">
          <input placeholder="Load ID (auto)" value={form.id} onChange={e => setForm({...form, id: e.target.value})} className="bg-slate-700 rounded-lg px-3 py-2 text-sm" />
          <input type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})} className="bg-slate-700 rounded-lg px-3 py-2 text-sm" required />
          <input placeholder="Vendor" value={form.vendor} onChange={e => setForm({...form, vendor: e.target.value})} className="bg-slate-700 rounded-lg px-3 py-2 text-sm" required />
          <input placeholder="Quantity" type="number" value={form.quantity} onChange={e => setForm({...form, quantity: e.target.value})} className="bg-slate-700 rounded-lg px-3 py-2 text-sm" />
          <input placeholder="Total Cost" type="number" step="0.01" value={form.total_cost} onChange={e => setForm({...form, total_cost: e.target.value})} className="bg-slate-700 rounded-lg px-3 py-2 text-sm" />
          <input placeholder="Notes" value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} className="bg-slate-700 rounded-lg px-3 py-2 text-sm" />
        </div>
        <button type="submit" className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg text-sm font-medium">Save Load</button>
        {msg && <p className="text-sm text-green-400">{msg}</p>}
      </form>
      <div className="space-y-2">
        {loads.map(l => (
          <div key={l.id} className="bg-slate-800 rounded-lg p-3">
            <div className="font-medium text-sm">{l.id}</div>
            <div className="text-xs text-slate-400">{l.vendor} · {l.date} · {l.quantity} items · ${Number(l.total_cost).toLocaleString()}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── MANIFEST UPLOAD ───────────────────────────────
function ManifestUpload() {
  const [loadId, setLoadId] = useState('')
  const [loads, setLoads] = useState([])
  const [status, setStatus] = useState('')
  const [progress, setProgress] = useState(null)

  useEffect(() => {
    supabase.from('loads').select('id').order('date', { ascending: false })
      .then(({ data }) => setLoads(data || []))
  }, [])

  async function handleFile(file) {
    if (!loadId) { setStatus('⚠️ Select a load first'); return }
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
      }
    })
  }

  return (
    <div className="bg-slate-800 rounded-xl p-4">
      <h3 className="font-bold mb-3">Upload Manifest CSV</h3>
      <div className="space-y-3">
        <select value={loadId} onChange={e => setLoadId(e.target.value)} className="w-full bg-slate-700 rounded-lg px-3 py-2 text-sm">
          <option value="">Select a load...</option>
          {loads.map(l => <option key={l.id} value={l.id}>{l.id}</option>)}
        </select>
        <DropZone onFile={handleFile} label="Drop manifest CSV here or click to browse" />
        {progress !== null && (
          <div className="w-full bg-slate-700 rounded-full h-2">
            <div className="bg-blue-500 h-2 rounded-full transition-all" style={{width: `${progress}%`}} />
          </div>
        )}
        {status && <p className="text-sm text-slate-300">{status}</p>}
      </div>
    </div>
  )
}

// ── SHOW CSV UPLOAD (Auto-detect date & time) ─────
function ShowUpload() {
  const [channel, setChannel] = useState('Jumpstart')
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

        // Parse first timestamp to determine date and time of day
        // Timestamps are UTC. Central Time = UTC - 6
        const firstTs = new Date(timestamps[0])
        const centralHour = (firstTs.getUTCHours() - 6 + 24) % 24

        // Morning shows: orders placed ~10am-2pm Central (16:00-20:00 UTC)
        // Evening shows: orders placed ~7pm-11pm Central (01:00-05:00 UTC next day)
        let timeOfDay
        if (centralHour >= 8 && centralHour < 17) {
          timeOfDay = 'morning'
        } else {
          timeOfDay = 'evening'
        }

        // For evening shows, the UTC date is the next day, so the actual show date is UTC date - 1
        let showDate
        if (timeOfDay === 'evening') {
          const d = new Date(firstTs)
          d.setUTCDate(d.getUTCDate() - 1)
          showDate = d.toISOString().split('T')[0]
        } else {
          showDate = firstTs.toISOString().split('T')[0]
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
        const showName = `${showDate}-${channel}-${timeOfDay}`
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

  return (
    <div className="space-y-4">
      <div className="bg-slate-800 rounded-xl p-4">
        <h3 className="font-bold mb-3">Upload Whatnot Show CSV</h3>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-400 block mb-1">Channel</label>
            <select value={channel} onChange={e => setChannel(e.target.value)} className="w-full bg-slate-700 rounded-lg px-3 py-2 text-sm max-w-xs">
              <option value="Jumpstart">Jumpstart</option>
              <option value="Kickstart">Kickstart</option>
            </select>
          </div>

          <DropZone onFile={handleFile} label="Drop Whatnot CSV here or click to browse" />

          {/* Auto-detection confirmation */}
          {detected && (
            <div className={`rounded-xl p-4 ${detected.alreadyExists ? 'bg-red-900/30 border border-red-600' : 'bg-slate-700'}`}>
              <div className="text-sm font-bold mb-2">
                {detected.alreadyExists ? '⚠️ This show already exists!' : '📋 Auto-detected show info:'}
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                <div>
                  <span className="text-slate-400">Date: </span>
                  <span className="font-medium">{detected.date}</span>
                </div>
                <div>
                  <span className="text-slate-400">Time: </span>
                  <span className={`font-medium px-2 py-0.5 rounded text-xs ${detected.timeOfDay === 'morning' ? 'bg-yellow-600' : 'bg-indigo-600'}`}>
                    {detected.timeOfDay.toUpperCase()}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400">Channel: </span>
                  <span className="font-medium">{channel}</span>
                </div>
                <div>
                  <span className="text-slate-400">Listings: </span>
                  <span className="font-medium">{detected.orderCount}</span>
                </div>
              </div>
              <div className="text-xs text-slate-500 mb-3">
                Show name: <span className="font-mono">{detected.showName}</span>
              </div>

              {detected.alreadyExists ? (
                <div className="text-sm text-red-400">
                  This show has already been uploaded. If you need to re-upload, delete the existing show first.
                </div>
              ) : (
                <div className="flex gap-3">
                  <button onClick={confirmUpload}
                    className="bg-green-600 hover:bg-green-500 px-4 py-2 rounded-lg text-sm font-medium">
                    ✓ Looks right — Upload
                  </button>
                  <button onClick={() => { setDetected(null); setPendingFile(null) }}
                    className="bg-slate-600 hover:bg-slate-500 px-4 py-2 rounded-lg text-sm font-medium">
                    ✗ Cancel
                  </button>
                </div>
              )}
            </div>
          )}

          {status && <p className="text-sm text-slate-300">{status}</p>}
        </div>
      </div>

      {/* Existing shows list */}
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
                  <div className="text-xs text-slate-400">
                    {show.channel} · {show.time_of_day} · {show.total_items || 0} items
                  </div>
                </div>
                <div className="text-right">
                  <span className={`text-xs px-2 py-1 rounded ${
                    show.status === 'completed' ? 'bg-green-900 text-green-400' :
                    show.status === 'scanning' ? 'bg-yellow-900 text-yellow-400' :
                    'bg-slate-600 text-slate-300'
                  }`}>
                    {show.scanned_count || 0}/{show.total_items || 0} scanned
                  </span>
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
          showByDateTime[`${s.date}-${s.time_of_day}`.toLowerCase()] = s
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

          const showName = `${date}-Jumpstart-${time}`.toLowerCase()
          const dateTimeKey = `${date}-${time}`.toLowerCase()
          const show = showByName[showName] || showByDateTime[dateTimeKey]
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
          const { error } = await supabase.from('jumpstart_sold_scans').upsert(batch, { onConflict: 'show_id,listing_number', ignoreDuplicates: true })
          if (error) {
            for (const scan of batch) {
              const { error: rowErr } = await supabase.from('jumpstart_sold_scans').insert(scan)
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
