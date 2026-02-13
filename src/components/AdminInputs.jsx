import { useState } from 'react'
import Papa from 'papaparse'
import { supabase } from '../lib/supabase'
import { normalizeBarcode } from '../lib/barcodes'

export default function AdminInputs() {
  const [activeSection, setActiveSection] = useState('loads')

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Data Inputs</h2>

      <div className="flex gap-2 mb-6 overflow-x-auto">
        {['loads', 'manifests', 'shows', 'expenses'].map(s => (
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
      {activeSection === 'expenses' && <ExpenseUpload />}
    </div>
  )
}

// ── LOADS ──────────────────────────────────────────
function LoadsSection() {
  const [loads, setLoads] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ id: '', date: '', vendor: '', quantity: '', total_cost: '', notes: '' })
  const [msg, setMsg] = useState('')

  useState(() => {
    supabase.from('loads').select('*').order('date', { ascending: false })
      .then(({ data }) => { setLoads(data || []); setLoading(false) })
  }, [])

  async function saveLoad(e) {
    e.preventDefault()
    const loadId = form.id || `LOAD-${form.date}-001`
    const { error } = await supabase.from('loads').upsert({
      id: loadId,
      date: form.date,
      vendor: form.vendor,
      quantity: parseInt(form.quantity) || null,
      total_cost: parseFloat(form.total_cost) || null,
      notes: form.notes
    })
    if (error) { setMsg(`Error: ${error.message}`); return }
    setMsg('Load saved!')
    setForm({ id: '', date: '', vendor: '', quantity: '', total_cost: '', notes: '' })
    const { data } = await supabase.from('loads').select('*').order('date', { ascending: false })
    setLoads(data || [])
  }

  return (
    <div>
      <form onSubmit={saveLoad} className="bg-slate-800 rounded-xl p-4 mb-6 space-y-3">
        <h3 className="font-bold mb-2">Add / Edit Load</h3>
        <div className="grid grid-cols-2 gap-3">
          <input placeholder="Load ID (auto)" value={form.id} onChange={e => setForm({...form, id: e.target.value})}
            className="bg-slate-700 rounded-lg px-3 py-2 text-sm" />
          <input type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})}
            className="bg-slate-700 rounded-lg px-3 py-2 text-sm" required />
          <input placeholder="Vendor" value={form.vendor} onChange={e => setForm({...form, vendor: e.target.value})}
            className="bg-slate-700 rounded-lg px-3 py-2 text-sm" required />
          <input placeholder="Quantity" type="number" value={form.quantity} onChange={e => setForm({...form, quantity: e.target.value})}
            className="bg-slate-700 rounded-lg px-3 py-2 text-sm" />
          <input placeholder="Total Cost" type="number" step="0.01" value={form.total_cost} onChange={e => setForm({...form, total_cost: e.target.value})}
            className="bg-slate-700 rounded-lg px-3 py-2 text-sm" />
          <input placeholder="Notes" value={form.notes} onChange={e => setForm({...form, notes: e.target.value})}
            className="bg-slate-700 rounded-lg px-3 py-2 text-sm" />
        </div>
        <button type="submit" className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg text-sm font-medium">
          Save Load
        </button>
        {msg && <p className="text-sm text-green-400">{msg}</p>}
      </form>

      <div className="space-y-2">
        {loads.map(l => (
          <div key={l.id} className="bg-slate-800 rounded-lg p-3 flex justify-between items-center">
            <div>
              <div className="font-medium text-sm">{l.id}</div>
              <div className="text-xs text-slate-400">{l.vendor} · {l.date} · {l.quantity} items · ${Number(l.total_cost).toLocaleString()}</div>
            </div>
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

  useState(() => {
    supabase.from('loads').select('id').order('date', { ascending: false })
      .then(({ data }) => setLoads(data || []))
  }, [])

  function handleFile(e) {
    const file = e.target.files[0]
    if (!file || !loadId) { setStatus('Select a load first'); return }

    setStatus('Parsing CSV...')
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const rows = results.data
        setStatus(`Parsed ${rows.length} rows. Uploading...`)

        // Map CSV columns to items table
        // Flexible column matching (case-insensitive)
        const getField = (row, ...names) => {
          for (const name of names) {
            if (row[name] !== undefined && row[name] !== '') return row[name]
            const key = Object.keys(row).find(k => k.trim().toLowerCase() === name.toLowerCase())
            if (key && row[key] !== undefined && row[key] !== '') return row[key]
          }
          return null
        }

        const items = rows.map(row => {
          const barcode = getField(row, 'Universal ID', 'UPC', 'Barcode', 'barcode', 'universal_id') || ''
          const cost = parseFloat(getField(row, 'Cost', 'Unit Cost', 'cost', 'COST') || 0)
          const msrp = parseFloat(getField(row, 'MSRP', 'Retail', 'msrp', 'retail_price') || 0)

          return {
            barcode: normalizeBarcode(barcode),
            barcode_raw: barcode,
            description: getField(row, 'Description', 'Product Name', 'description', 'product_name') || '',
            category: getField(row, 'Category', 'category', 'CLASS') || '',
            subclass: getField(row, 'Subclass', 'subclass', 'SUB_CLASS') || '',
            size: getField(row, 'Size', 'size', 'SIZE') || '',
            color: getField(row, 'Color', 'color', 'COLOR_NAME') || '',
            color_code: getField(row, 'Color Code', 'color_code', 'COLOR_CD') || '',
            vendor: getField(row, 'Vendor', 'Brand', 'vendor', 'brand') || '',
            part_number: getField(row, 'Part Number', 'Item', 'part_number', 'ITEM') || '',
            msrp: msrp || null,
            cost: cost || null,
            load_id: loadId
          }
        }).filter(item => item.barcode) // Skip rows with no barcode

        // Upload in batches of 500
        const batchSize = 500
        let uploaded = 0
        for (let i = 0; i < items.length; i += batchSize) {
          const batch = items.slice(i, i + batchSize)
          const { error } = await supabase.from('items').insert(batch)
          if (error) {
            setStatus(`Error at row ${i}: ${error.message}`)
            return
          }
          uploaded += batch.length
          setProgress(Math.round((uploaded / items.length) * 100))
        }

        setStatus(`✅ Uploaded ${items.length} items to load ${loadId}`)
        setProgress(null)
      }
    })
  }

  return (
    <div className="bg-slate-800 rounded-xl p-4">
      <h3 className="font-bold mb-3">Upload Manifest CSV</h3>
      <div className="space-y-3">
        <select value={loadId} onChange={e => setLoadId(e.target.value)}
          className="w-full bg-slate-700 rounded-lg px-3 py-2 text-sm">
          <option value="">Select a load...</option>
          {loads.map(l => <option key={l.id} value={l.id}>{l.id}</option>)}
        </select>
        <input type="file" accept=".csv" onChange={handleFile}
          className="block w-full text-sm text-slate-400 file:mr-4 file:py-2 file:px-4
            file:rounded-lg file:border-0 file:text-sm file:font-medium
            file:bg-blue-600 file:text-white hover:file:bg-blue-500" />
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

// ── SHOW CSV UPLOAD ───────────────────────────────
function ShowUpload() {
  const [form, setForm] = useState({ date: '', timeOfDay: 'evening', channel: 'Jumpstart' })
  const [status, setStatus] = useState('')

  function handleFile(e) {
    const file = e.target.files[0]
    if (!file || !form.date) { setStatus('Set date, time, and channel first'); return }

    setStatus('Parsing Whatnot CSV...')
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const rows = results.data

        const getField = (row, ...names) => {
          for (const name of names) {
            if (row[name] !== undefined) return row[name]
            const key = Object.keys(row).find(k => k.trim().toLowerCase() === name.toLowerCase())
            if (key) return row[key]
          }
          return ''
        }

        // Group by listing number
        const byListing = {}
        for (const row of rows) {
          const productName = getField(row, 'Product Name', 'product_name', 'PRODUCT_NAME') || ''
          const match = productName.match(/#(\d+)/)
          if (!match) continue

          const listingNum = parseInt(match[1])

          // Skip gift cards
          const lowerName = productName.toLowerCase()
          if (lowerName.includes('gift card') || lowerName.includes('account credit') || lowerName.includes('store credit')) continue

          if (!byListing[listingNum]) byListing[listingNum] = []
          byListing[listingNum].push(row)
        }

        // Create show name
        const showName = `${form.date}-${form.channel}-${form.timeOfDay}`

        // Create show record
        const { data: showData, error: showError } = await supabase.from('shows').insert({
          name: showName,
          date: form.date,
          time_of_day: form.timeOfDay,
          channel: form.channel,
          status: 'pending'
        }).select().single()

        if (showError) {
          setStatus(`Error creating show: ${showError.message}`)
          return
        }

        // Process each listing
        const showItems = []
        let validCount = 0

        for (const [listingStr, listingRows] of Object.entries(byListing)) {
          const listing = parseInt(listingStr)

          // Determine status
          const statuses = listingRows.map(r => {
            const s = (getField(r, 'Status', 'status', 'STATUS') || '').toLowerCase().trim()
            return s
          })

          let itemStatus = 'valid'
          if (statuses.every(s => s === 'cancelled')) itemStatus = 'cancelled'
          else if (statuses.every(s => s === 'failed')) itemStatus = 'failed'

          // Pick best row (prefer non-failed)
          const bestRow = listingRows.find(r => {
            const s = (getField(r, 'Status', 'status', 'STATUS') || '').toLowerCase()
            return s !== 'failed' && s !== 'cancelled'
          }) || listingRows[0]

          // CRITICAL: "Sold Price" is post-coupon (buyer_paid), NOT the hammer price
          const soldPrice = parseFloat(getField(bestRow, 'Sold Price', 'sold_price', 'SOLD_PRICE') || 0)
          const couponAmt = parseFloat(getField(bestRow, 'Coupon Amount', 'coupon_amount', 'COUPON_AMOUNT') || 0)

          const showItem = {
            show_id: showData.id,
            listing_number: listing,
            product_name: getField(bestRow, 'Product Name', 'product_name') || '',
            buyer_paid: soldPrice,                    // Post-coupon = what buyer actually paid
            coupon_code: getField(bestRow, 'Coupon Code', 'coupon_code') || null,
            coupon_amount: couponAmt,
            original_hammer: soldPrice + couponAmt,   // Reconstruct hammer price
            status: itemStatus,
            placed_at: getField(bestRow, 'Placed At', 'placed_at', 'ORDER_PLACED_AT_UTC') || null,
            whatnot_order_id: getField(bestRow, 'Order ID', 'order_id', 'ORDER_ID') || null
          }

          showItems.push(showItem)
          if (itemStatus === 'valid') validCount++
        }

        // Upload show items in batches
        const batchSize = 500
        for (let i = 0; i < showItems.length; i += batchSize) {
          const batch = showItems.slice(i, i + batchSize)
          const { error } = await supabase.from('show_items').insert(batch)
          if (error) {
            setStatus(`Error uploading items: ${error.message}`)
            return
          }
        }

        // Update show with total scannable items
        await supabase.from('shows').update({ total_items: validCount }).eq('id', showData.id)

        const failed = showItems.filter(i => i.status === 'failed').length
        const cancelled = showItems.filter(i => i.status === 'cancelled').length
        setStatus(`✅ Show "${showName}" created: ${validCount} scannable, ${failed} failed, ${cancelled} cancelled`)
      }
    })
  }

  return (
    <div className="bg-slate-800 rounded-xl p-4">
      <h3 className="font-bold mb-3">Upload Whatnot Show CSV</h3>
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <input type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})}
            className="bg-slate-700 rounded-lg px-3 py-2 text-sm" required />
          <select value={form.timeOfDay} onChange={e => setForm({...form, timeOfDay: e.target.value})}
            className="bg-slate-700 rounded-lg px-3 py-2 text-sm">
            <option value="morning">Morning</option>
            <option value="evening">Evening</option>
          </select>
          <select value={form.channel} onChange={e => setForm({...form, channel: e.target.value})}
            className="bg-slate-700 rounded-lg px-3 py-2 text-sm">
            <option value="Jumpstart">Jumpstart</option>
            <option value="Kickstart">Kickstart</option>
          </select>
        </div>
        <input type="file" accept=".csv" onChange={handleFile}
          className="block w-full text-sm text-slate-400 file:mr-4 file:py-2 file:px-4
            file:rounded-lg file:border-0 file:text-sm file:font-medium
            file:bg-blue-600 file:text-white hover:file:bg-blue-500" />
        {status && <p className="text-sm text-slate-300 mt-2">{status}</p>}
      </div>
    </div>
  )
}

// ── EXPENSE UPLOAD ────────────────────────────────
function ExpenseUpload() {
  const [status, setStatus] = useState('')

  function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return

    setStatus('Parsing expenses...')
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const getField = (row, ...names) => {
          for (const name of names) {
            if (row[name] !== undefined) return row[name]
            const key = Object.keys(row).find(k => k.trim().toLowerCase() === name.toLowerCase())
            if (key) return row[key]
          }
          return ''
        }

        const expenses = results.data.map(row => ({
          date: getField(row, 'Date', 'date', 'DATE') || null,
          description: getField(row, 'Description', 'Vendor', 'description', 'vendor') || '',
          amount: parseFloat(getField(row, 'Amount', 'amount', 'AMOUNT') || 0),
          category: getField(row, 'Category', 'category', 'CATEGORY') || 'EXPENSES'
        })).filter(e => e.date && e.amount)

        const { error } = await supabase.from('expenses').insert(expenses)
        if (error) { setStatus(`Error: ${error.message}`); return }
        setStatus(`✅ Uploaded ${expenses.length} expenses`)
      }
    })
  }

  return (
    <div className="bg-slate-800 rounded-xl p-4">
      <h3 className="font-bold mb-3">Upload Expenses CSV</h3>
      <input type="file" accept=".csv" onChange={handleFile}
        className="block w-full text-sm text-slate-400 file:mr-4 file:py-2 file:px-4
          file:rounded-lg file:border-0 file:text-sm file:font-medium
          file:bg-blue-600 file:text-white hover:file:bg-blue-500" />
      {status && <p className="text-sm text-slate-300 mt-2">{status}</p>}
    </div>
  )
}
