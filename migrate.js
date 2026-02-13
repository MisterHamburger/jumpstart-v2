/**
 * JUMPSTART V2 — Data Migration Script
 * 
 * Loads existing data from CSV exports into Supabase.
 * Run: node migrate.js
 * 
 * Requires: npm install @supabase/supabase-js papaparse
 */

import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import Papa from 'papaparse'

const SUPABASE_URL = 'https://dqilknhyevkecjnmnumx.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxaWxrbmh5ZXZrZWNqbm1udW14Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5MzUxNjAsImV4cCI6MjA4NjUxMTE2MH0.lV5gZZaDySePekWRqNq_9SGGp0yJ5S2B9VGjGKAhwrw'

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

function parseCSV(filepath) {
  const text = fs.readFileSync(filepath, 'utf-8')
  const result = Papa.parse(text, { header: true, skipEmptyLines: true })
  return result.data
}

function normalizeBarcode(raw) {
  if (!raw) return ''
  return raw.toString().trim().replace(/^['\s]+/, '').replace(/^0+/, '')
}

function parseDollar(val) {
  if (!val) return 0
  return parseFloat(val.toString().replace(/[$,]/g, '')) || 0
}

async function insertBatch(table, rows, batchSize = 500) {
  let inserted = 0
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize)
    const { error } = await supabase.from(table).insert(batch)
    if (error) {
      console.error(`  ERROR at row ${i} in ${table}: ${error.message}`)
      // Try one at a time to find the bad row
      for (const row of batch) {
        const { error: rowErr } = await supabase.from(table).insert(row)
        if (rowErr) {
          console.error(`  Bad row: ${JSON.stringify(row).slice(0, 200)}`)
          console.error(`  Error: ${rowErr.message}`)
        } else {
          inserted++
        }
      }
    } else {
      inserted += batch.length
    }
    process.stdout.write(`  ${inserted}/${rows.length}\r`)
  }
  console.log(`  ✅ ${inserted}/${rows.length} rows inserted into ${table}`)
  return inserted
}

// ─── 1. LOAD ──────────────────────────────────────
async function migrateLoad() {
  console.log('\n🔷 Creating load...')
  const { error } = await supabase.from('loads').upsert({
    id: 'LOAD-2026-01-15-001',
    date: '2026-01-15',
    vendor: 'Madewell/J.Crew Returns',
    quantity: 4637,
    total_cost: 38716,
    freight_per_item: 0.45,
    notes: 'First Madewell/J.Crew liquidation load'
  })
  if (error) console.error('  Error:', error.message)
  else console.log('  ✅ Load created')
}

// ─── 2. MANIFEST → ITEMS ─────────────────────────
async function migrateManifest() {
  console.log('\n🔷 Migrating manifest → items table...')
  const rows = parseCSV('data/Jumpstart_Scans_-_Master_List__1_.csv')
  console.log(`  Parsed ${rows.length} rows`)

  const items = rows.map(row => {
    const zoneStr = (row['Zone'] || '').trim()
    let zone = null
    if (zoneStr.includes('1')) zone = 1
    else if (zoneStr.includes('2')) zone = 2
    else if (zoneStr.includes('3')) zone = 3

    const cost = parseDollar(row['Cost'])
    const costFreight = parseDollar(row['Cost+Freight'])

    return {
      barcode: normalizeBarcode(row['Unique ID']),
      barcode_raw: (row['Unique ID'] || '').trim(),
      description: (row['Description'] || '').trim(),
      category: (row['Category'] || '').trim(),
      subclass: (row['Subclass'] || '').trim(),
      size: (row['Size'] || '').trim(),
      color: (row['Color'] || '').trim(),
      vendor: (row['Vendor'] || '').trim(),
      msrp: parseDollar(row['MSRP']) || null,
      cost: cost || null,
      cost_freight: costFreight || null,
      zone: zone,
      bundle_number: (row['Bundle #'] || '').trim() || null,
      load_id: 'LOAD-2026-01-15-001'
    }
  }).filter(item => item.barcode)

  await insertBatch('items', items)
}

// ─── 3. WHATNOT SHOWS ─────────────────────────────
async function migrateShows() {
  console.log('\n🔷 Migrating Whatnot show CSVs...')

  // Map filenames to show metadata
  const showFiles = [
    { file: 'data/2-7-2026_evening_jumpstart.csv', date: '2026-02-07', time: 'evening', channel: 'Jumpstart' },
    { file: 'data/2-8-2026_evening_jumpstart.csv', date: '2026-02-08', time: 'evening', channel: 'Jumpstart' },
    { file: 'data/2-9-2026_morning_jumpstart.csv', date: '2026-02-09', time: 'morning', channel: 'Jumpstart' },
    { file: 'data/2-9-2026_evening_jumpstart.csv', date: '2026-02-09', time: 'evening', channel: 'Jumpstart' },
    { file: 'data/2-10-2026_morning_jumpstart.csv', date: '2026-02-10', time: 'morning', channel: 'Jumpstart' },
    { file: 'data/2-10-2026_evening_jumpstart.csv', date: '2026-02-10', time: 'evening', channel: 'Jumpstart' },
    { file: 'data/2-11-2026_evening_jumpstart.csv', date: '2026-02-11', time: 'evening', channel: 'Jumpstart' },
    { file: 'data/2-12-2026_morning_jumpstart.csv', date: '2026-02-12', time: 'morning', channel: 'Jumpstart' },
  ]

  for (const show of showFiles) {
    if (!fs.existsSync(show.file)) {
      console.log(`  ⚠️ Skipping ${show.file} (not found)`)
      continue
    }

    const showName = `${show.date}-${show.channel}-${show.time}`
    console.log(`  Processing ${showName}...`)

    const rows = parseCSV(show.file)

    // Group by listing number
    const byListing = {}
    for (const row of rows) {
      const productName = row['product name'] || ''
      const match = productName.match(/#(\d+)/)
      if (!match) continue

      const listingNum = parseInt(match[1])
      const lowerName = productName.toLowerCase()
      if (lowerName.includes('gift card') || lowerName.includes('account credit') || lowerName.includes('store credit')) continue

      if (!byListing[listingNum]) byListing[listingNum] = []
      byListing[listingNum].push(row)
    }

    // Create show record
    const { data: showData, error: showError } = await supabase.from('shows').upsert({
      name: showName,
      date: show.date,
      time_of_day: show.time,
      channel: show.channel,
      status: 'completed'
    }, { onConflict: 'name' }).select().single()

    if (showError) {
      console.log(`  ❌ Error creating show: ${showError.message}`)
      continue
    }

    // Process listings
    const showItems = []
    let validCount = 0

    for (const [listingStr, listingRows] of Object.entries(byListing)) {
      const listing = parseInt(listingStr)

      const statuses = listingRows.map(r => (r['cancelled or failed'] || '').toLowerCase().trim())
      let itemStatus = 'valid'
      if (statuses.every(s => s === 'cancelled')) itemStatus = 'cancelled'
      else if (statuses.every(s => s === 'failed')) itemStatus = 'failed'

      // Pick best row
      const bestRow = listingRows.find(r => {
        const s = (r['cancelled or failed'] || '').toLowerCase()
        return !s || (s !== 'failed' && s !== 'cancelled')
      }) || listingRows[0]

      // CRITICAL: "sold price" is post-coupon (buyer_paid)
      const soldPrice = parseDollar(bestRow['sold price'])
      const couponAmt = parseDollar(bestRow['coupon price'])

      showItems.push({
        show_id: showData.id,
        listing_number: listing,
        product_name: bestRow['product name'] || '',
        buyer_paid: soldPrice,
        coupon_code: bestRow['coupon code'] || null,
        coupon_amount: couponAmt,
        original_hammer: soldPrice + couponAmt,
        status: itemStatus,
        placed_at: bestRow['placed at'] || null,
        whatnot_order_id: bestRow['order id'] || null
      })

      if (itemStatus === 'valid') validCount++
    }

    // Upload show items
    await insertBatch('show_items', showItems)

    // Update show counts
    await supabase.from('shows').update({
      total_items: validCount,
      scanned_count: validCount, // Already completed
    }).eq('id', showData.id)

    console.log(`  ✅ ${showName}: ${validCount} valid, ${showItems.length - validCount} failed/cancelled`)
  }
}

// ─── 4. EXPENSES ──────────────────────────────────
async function migrateExpenses() {
  console.log('\n🔷 Migrating expenses...')

  if (!fs.existsSync('data/transactions__16_.csv')) {
    console.log('  ⚠️ transactions CSV not found, skipping')
    return
  }

  const rows = parseCSV('data/transactions__16_.csv')
  console.log(`  Parsed ${rows.length} rows`)

  // Only include EXPENSES and PAYROLL categories (per Jer's description)
  const expenses = rows
    .filter(row => {
      const cat = (row['category'] || '').toUpperCase()
      return cat === 'EXPENSES' || cat === 'PAYROLL'
    })
    .map(row => ({
      date: row['date'] || null,
      description: row['name'] || '',
      amount: parseDollar(row['amount']),
      category: (row['category'] || 'EXPENSES').toUpperCase()
    }))
    .filter(e => e.date && e.amount)

  if (expenses.length === 0) {
    console.log('  No EXPENSES/PAYROLL rows found')
    return
  }

  await insertBatch('expenses', expenses)
}

// ─── RUN ──────────────────────────────────────────
async function main() {
  console.log('🚀 JUMPSTART V2 — DATA MIGRATION')
  console.log('================================\n')

  // Test connection
  const { error } = await supabase.from('loads').select('id', { count: 'exact', head: true })
  if (error) {
    console.error('❌ Cannot connect to Supabase:', error.message)
    process.exit(1)
  }
  console.log('✅ Supabase connected')

  await migrateLoad()
  await migrateManifest()
  await migrateShows()
  await migrateExpenses()

  console.log('\n================================')
  console.log('🎉 MIGRATION COMPLETE')
  console.log('\nNext: Open your app and check the Admin Dashboard.')
}

main().catch(console.error)
