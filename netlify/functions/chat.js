export default async (req) => {
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
  const SUPABASE_URL = process.env.SUPABASE_URL
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY

  if (!ANTHROPIC_API_KEY || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return new Response(JSON.stringify({ error: 'Missing environment variables' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST required' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  try {
    const { question, user_name, history } = await req.json()

    if (!question || !user_name) {
      return new Response(JSON.stringify({ error: 'question and user_name required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Pull business data for context
    const businessData = await fetchBusinessData(SUPABASE_URL, SUPABASE_ANON_KEY)

    // Build conversation messages with history for context
    const messages = []

    // Include recent history (last 10 exchanges) for conversational context
    if (history && history.length > 0) {
      const recent = history.slice(-10)
      for (const msg of recent) {
        messages.push({ role: 'user', content: msg.question })
        messages.push({ role: 'assistant', content: msg.answer })
      }
    }

    // Add current question
    messages.push({ role: 'user', content: question })

    const systemPrompt = `You are a business analyst assistant for Jumpstart, a livestream auction resale business that buys liquidation loads (J.Crew, Madewell, Free People, Urban Outfitters, Anthropologie) and sells them through live auctions on Whatnot.

You have access to ALL business data: every sold item with description/category/price/cost/profit, show-level P&L, load purchases with sell-through rates, inventory aging (how long unsold items have been sitting by age bucket/load/category), sort zone assignments, expenses, kickstart (Free People/UO/Anthro) intake and sales, and bundle box data.

Whatnot fee structure: 7.2% commission + 2.9% processing + $0.30 per item.

When answering questions:
- Be concise and direct — lead with the number or answer, then explain
- Use dollar formatting for money values
- Reference specific items, shows, or loads by name when relevant
- You have FULL item-level data — you CAN answer questions about specific items, best sellers, worst sellers, etc.

Charts — only include when the user asks for one OR the answer compares 4+ items where a visual genuinely adds clarity (e.g. "show me profit by category", "how have shows trended"). Do NOT include a chart for simple questions like "what was our best show?" or "how much profit did we make?" — just answer in prose.
- When you DO chart: use "bar" for comparisons/rankings, "line" for trends over time
- Keep chart_data to 15 items max. Shorten long labels (e.g. "W OUTERWEAR JACKET" → "Outerwear Jacket")
- If the user says "graph", "chart", "visualize", or "show me" — that's a chart request

Always respond in this JSON format:
{
  "answer": "your prose response here",
  "chart_type": "bar" | "line" | null,
  "chart_data": [{"label": "...", "value": 123}, ...] | null,
  "chart_config": { "xKey": "label", "yKey": "value", "yLabel": "Profit ($)" } | null
}

Current business data:
${JSON.stringify(businessData, null, 2)}`

    // Call Claude API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system: systemPrompt,
        messages
      })
    })

    const claudeResponse = await response.json()

    if (!response.ok) {
      throw new Error(claudeResponse.error?.message || 'Claude API error')
    }

    const rawText = claudeResponse.content
      .filter(item => item.type === 'text')
      .map(item => item.text)
      .join('')

    // Parse JSON from response
    let parsed
    const jsonMatch = rawText.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0])
      } catch {
        parsed = { answer: rawText, chart_type: null, chart_data: null, chart_config: null }
      }
    } else {
      parsed = { answer: rawText, chart_type: null, chart_data: null, chart_config: null }
    }

    // Save to Supabase
    const saveRes = await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        user_name,
        question,
        answer: parsed.answer,
        chart_data: parsed.chart_data || null,
        chart_type: parsed.chart_type || null,
        chart_config: parsed.chart_config || null,
      })
    })

    if (!saveRes.ok) {
      const err = await saveRes.text()
      console.error('Failed to save chat message:', err)
    }

    const saved = await saveRes.json()

    return new Response(JSON.stringify({
      id: saved[0]?.id,
      answer: parsed.answer,
      chart_type: parsed.chart_type || null,
      chart_data: parsed.chart_data || null,
      chart_config: parsed.chart_config || null,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('Chat error:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}

// Paginate through Supabase REST API (1000 row limit per request)
async function fetchAllPages(url, headers, maxPages = 10) {
  let all = []
  let offset = 0
  const pageSize = 1000
  for (let i = 0; i < maxPages; i++) {
    const sep = url.includes('?') ? '&' : '?'
    const res = await fetch(`${url}${sep}limit=${pageSize}&offset=${offset}`, { headers })
    const data = await res.json()
    if (!data || data.length === 0) break
    all = all.concat(data)
    if (data.length < pageSize) break
    offset += pageSize
  }
  return all
}

async function fetchBusinessData(supabaseUrl, supabaseKey) {
  const headers = {
    'apikey': supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`
  }

  // Safe JSON fetch — returns [] if response is not an array (e.g. table missing or error)
  const safeJson = (promise) => promise.then(r => r.json()).then(d => Array.isArray(d) ? d : []).catch(() => [])

  // Pull ALL data in parallel — every table in the system
  const [profitData, shows, loads, expenses, kickstart, manifestData, soldScans, bundleScans, sortLog, kickstartSoldScans] = await Promise.all([
    fetchAllPages(`${supabaseUrl}/rest/v1/profitability?select=show_name,show_date,buyer_paid,cost_freight,profit,margin,category,description,msrp,zone,is_bundle,barcode&channel=eq.Jumpstart`, headers),
    safeJson(fetch(`${supabaseUrl}/rest/v1/shows?select=id,name,date,channel,total_items,status&order=date.desc&limit=50`, { headers })),
    safeJson(fetch(`${supabaseUrl}/rest/v1/loads?select=id,date,vendor,notes,total_cost,quantity&order=date.desc`, { headers })),
    safeJson(fetch(`${supabaseUrl}/rest/v1/expenses?select=id,description,amount,category,date,notes&order=date.desc`, { headers })),
    fetchAllPages(`${supabaseUrl}/rest/v1/kickstart_intake?select=brand,description,color,size,cost,msrp,status,created_at`, headers, 5),
    fetchAllPages(`${supabaseUrl}/rest/v1/jumpstart_manifest?select=barcode,description,category,cost_freight,msrp,vendor,load_id`, headers, 10),
    fetchAllPages(`${supabaseUrl}/rest/v1/jumpstart_sold_scans?select=barcode,show_id,listing_number`, headers, 10),
    safeJson(fetch(`${supabaseUrl}/rest/v1/jumpstart_bundle_scans?select=barcode,box_number,scanned_at&order=scanned_at.desc&limit=2000`, { headers })),
    safeJson(fetch(`${supabaseUrl}/rest/v1/jumpstart_sort_log?select=barcode,zone,timestamp&order=timestamp.desc&limit=5000`, { headers })),
    fetchAllPages(`${supabaseUrl}/rest/v1/kickstart_sold_scans?select=barcode,show_id,listing_number,intake_id,scanned_at`, headers, 5),
  ])

  // ── SHOW-LEVEL P&L ──
  const showAgg = {}
  for (const item of (profitData || [])) {
    const key = item.show_name || 'Unknown'
    if (!showAgg[key]) showAgg[key] = { name: key, date: item.show_date, items: 0, revenue: 0, cogs: 0, profit: 0, bundles: 0 }
    const s = showAgg[key]
    s.items++
    s.revenue += Number(item.buyer_paid) || 0
    s.cogs += Number(item.cost_freight) || 0
    s.profit += Number(item.profit) || 0
    if (item.is_bundle) s.bundles++
  }

  const showSummaries = Object.values(showAgg).map(s => ({
    name: s.name, date: s.date, items: s.items,
    revenue: +s.revenue.toFixed(2), cogs: +s.cogs.toFixed(2), profit: +s.profit.toFixed(2),
    margin: s.revenue > 0 ? +((s.profit / s.revenue) * 100).toFixed(1) : 0,
    avg_sale: s.items > 0 ? +(s.revenue / s.items).toFixed(2) : 0,
    avg_profit: s.items > 0 ? +(s.profit / s.items).toFixed(2) : 0,
    bundles: s.bundles,
  })).sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))

  const totalRevenue = showSummaries.reduce((s, r) => s + r.revenue, 0)
  const totalProfit = showSummaries.reduce((s, r) => s + r.profit, 0)
  const totalCogs = showSummaries.reduce((s, r) => s + r.cogs, 0)
  const totalItems = showSummaries.reduce((s, r) => s + r.items, 0)

  // ── ITEM-LEVEL AGGREGATION BY DESCRIPTION ──
  const itemAgg = {}
  for (const item of (profitData || [])) {
    const desc = item.description || 'Unknown'
    if (!itemAgg[desc]) itemAgg[desc] = { description: desc, category: item.category, qty_sold: 0, revenue: 0, cogs: 0, profit: 0, avg_msrp: 0, msrp_sum: 0 }
    const a = itemAgg[desc]
    a.qty_sold++
    a.revenue += Number(item.buyer_paid) || 0
    a.cogs += Number(item.cost_freight) || 0
    a.profit += Number(item.profit) || 0
    a.msrp_sum += Number(item.msrp) || 0
  }

  const itemSummaries = Object.values(itemAgg).map(a => ({
    ...a,
    avg_sale: +(a.revenue / a.qty_sold).toFixed(2),
    avg_profit: +(a.profit / a.qty_sold).toFixed(2),
    avg_msrp: +(a.msrp_sum / a.qty_sold).toFixed(2),
    margin: a.revenue > 0 ? +((a.profit / a.revenue) * 100).toFixed(1) : 0,
    revenue: +a.revenue.toFixed(2),
    profit: +a.profit.toFixed(2),
    cogs: +a.cogs.toFixed(2),
  }))
  // Remove temp fields
  itemSummaries.forEach(i => delete i.msrp_sum)

  const topItemsByQty = [...itemSummaries].sort((a, b) => b.qty_sold - a.qty_sold).slice(0, 25)
  const topItemsByRevenue = [...itemSummaries].sort((a, b) => b.revenue - a.revenue).slice(0, 25)
  const topItemsByProfit = [...itemSummaries].sort((a, b) => b.profit - a.profit).slice(0, 25)
  const worstItemsByProfit = [...itemSummaries].filter(i => i.qty_sold >= 3).sort((a, b) => a.profit - b.profit).slice(0, 25)

  // ── CATEGORY BREAKDOWN ──
  const catAgg = {}
  for (const item of (profitData || [])) {
    const cat = item.category || 'Unknown'
    if (!catAgg[cat]) catAgg[cat] = { items: 0, profit: 0, revenue: 0, cogs: 0, profitable: 0 }
    catAgg[cat].items++
    catAgg[cat].profit += Number(item.profit) || 0
    catAgg[cat].revenue += Number(item.buyer_paid) || 0
    catAgg[cat].cogs += Number(item.cost_freight) || 0
    if (Number(item.profit) > 0) catAgg[cat].profitable++
  }
  const categoryBreakdown = Object.entries(catAgg)
    .map(([cat, d]) => ({
      category: cat, items: d.items, revenue: +d.revenue.toFixed(2), profit: +d.profit.toFixed(2),
      cogs: +d.cogs.toFixed(2),
      margin: d.revenue > 0 ? +((d.profit / d.revenue) * 100).toFixed(1) : 0,
      pct_profitable: +((d.profitable / d.items) * 100).toFixed(1),
    }))
    .sort((a, b) => b.profit - a.profit)

  // ── ZONE BREAKDOWN ──
  const zoneAgg = {}
  for (const item of (profitData || [])) {
    let z = item.zone || 'Unknown'
    if (z === '1' || z === 'Zone 1 Pants') z = 'Zone 1'
    if (z === '2' || z === 'Zone 2 Pants') z = 'Zone 2'
    if (z === '3') z = 'Zone 3'
    if (!zoneAgg[z]) zoneAgg[z] = { items: 0, profit: 0, revenue: 0 }
    zoneAgg[z].items++
    zoneAgg[z].profit += Number(item.profit) || 0
    zoneAgg[z].revenue += Number(item.buyer_paid) || 0
  }
  const zoneBreakdown = Object.entries(zoneAgg)
    .map(([zone, d]) => ({ zone, items: d.items, revenue: +d.revenue.toFixed(2), profit: +d.profit.toFixed(2) }))

  // ── UNSOLD INVENTORY + AGING ──
  const soldBarcodes = {}
  for (const scan of (soldScans || [])) {
    soldBarcodes[scan.barcode] = (soldBarcodes[scan.barcode] || 0) + 1
  }

  // Build load date + name lookup
  const loadDates = {}, loadNames = {}
  for (const l of (loads || [])) {
    loadDates[l.id] = l.date ? new Date(l.date) : null
    loadNames[l.id] = l.vendor || l.notes || l.id
  }

  const soldUsed = {}
  let unsoldCount = 0, unsoldCost = 0, unsoldMsrp = 0
  const today = new Date()
  const agingBuckets = { '0-7 days': 0, '8-14 days': 0, '15-21 days': 0, '22-28 days': 0, '29+ days': 0 }
  const agingByLoad = {}
  const agingByCategory = {}
  let totalDaysAll = 0, agingItemsWithDate = 0

  for (const item of (manifestData || [])) {
    const bc = item.barcode
    const used = soldUsed[bc] || 0
    const totalSold = soldBarcodes[bc] || 0
    if (used < totalSold) {
      soldUsed[bc] = used + 1
    } else {
      unsoldCount++
      const cost = Number(item.cost_freight) || 0
      const msrp = Number(item.msrp) || 0
      unsoldCost += cost
      unsoldMsrp += msrp

      // Aging calculation
      const loadDate = loadDates[item.load_id]
      if (loadDate) {
        const daysOld = Math.floor((today - loadDate) / (1000 * 60 * 60 * 24))
        totalDaysAll += daysOld
        agingItemsWithDate++

        if (daysOld <= 7) agingBuckets['0-7 days']++
        else if (daysOld <= 14) agingBuckets['8-14 days']++
        else if (daysOld <= 21) agingBuckets['15-21 days']++
        else if (daysOld <= 28) agingBuckets['22-28 days']++
        else agingBuckets['29+ days']++

        // By load
        const ln = loadNames[item.load_id] || 'Unknown'
        if (!agingByLoad[ln]) agingByLoad[ln] = { items: 0, cost: 0, days_old: daysOld }
        agingByLoad[ln].items++
        agingByLoad[ln].cost += cost
      }

      // By category
      const cat = item.category || 'Unknown'
      if (!agingByCategory[cat]) agingByCategory[cat] = { items: 0, cost: 0 }
      agingByCategory[cat].items++
      agingByCategory[cat].cost += cost
    }
  }

  // ── LOAD SUMMARY ──
  const loadManifestCount = {}
  const loadSoldCount = {}
  for (const item of (manifestData || [])) {
    const lid = item.load_id || 'Unknown'
    loadManifestCount[lid] = (loadManifestCount[lid] || 0) + 1
  }
  // Count sold per load via barcode->load mapping
  const barcodeToLoad = {}
  for (const item of (manifestData || [])) {
    if (!barcodeToLoad[item.barcode]) barcodeToLoad[item.barcode] = item.load_id
  }
  for (const scan of (soldScans || [])) {
    const lid = barcodeToLoad[scan.barcode]
    if (lid) loadSoldCount[lid] = (loadSoldCount[lid] || 0) + 1
  }

  // ── EXPENSES ──
  const totalExpenses = (expenses || []).reduce((s, e) => s + (Number(e.amount) || 0), 0)
  const expensesByCategory = {}
  for (const e of (expenses || [])) {
    const cat = e.category || 'Uncategorized'
    expensesByCategory[cat] = (expensesByCategory[cat] || 0) + (Number(e.amount) || 0)
  }

  // ── KICKSTART SUMMARY ──
  const ksBrands = {}
  for (const k of (kickstart || [])) {
    const b = k.brand || 'Unknown'
    if (!ksBrands[b]) ksBrands[b] = { items: 0, cost: 0, msrp: 0 }
    ksBrands[b].items++
    ksBrands[b].cost += Number(k.cost) || 0
    ksBrands[b].msrp += Number(k.msrp) || 0
  }

  // ── KICKSTART SALES ──
  const ksUniqueListings = new Set()
  for (const scan of (kickstartSoldScans || [])) {
    ksUniqueListings.add(`${scan.show_id}_${scan.listing_number}`)
  }

  // ── SORT LOG ──
  const sortZoneCounts = {}
  for (const s of (sortLog || [])) {
    const z = s.zone || 'Unknown'
    sortZoneCounts[z] = (sortZoneCounts[z] || 0) + 1
  }

  // ── BUNDLES ──
  const bundleBoxes = {}
  for (const b of (bundleScans || [])) {
    bundleBoxes[b.box_number] = (bundleBoxes[b.box_number] || 0) + 1
  }

  return {
    summary: {
      total_shows: showSummaries.length,
      total_items_sold: totalItems,
      total_revenue: +totalRevenue.toFixed(2),
      total_profit: +totalProfit.toFixed(2),
      total_cogs: +totalCogs.toFixed(2),
      overall_margin: totalRevenue > 0 ? +((totalProfit / totalRevenue) * 100).toFixed(1) : 0,
      avg_profit_per_show: showSummaries.length > 0 ? +(totalProfit / showSummaries.length).toFixed(2) : 0,
      avg_profit_per_item: totalItems > 0 ? +(totalProfit / totalItems).toFixed(2) : 0,
      total_manifest_items: (manifestData || []).length,
      unsold_items: unsoldCount,
      unsold_cost: +unsoldCost.toFixed(2),
      unsold_msrp: +unsoldMsrp.toFixed(2),
      sell_through_rate: (manifestData || []).length > 0 ? +(((manifestData.length - unsoldCount) / manifestData.length) * 100).toFixed(1) : 0,
      total_expenses: +totalExpenses.toFixed(2),
      total_sorted: (sortLog || []).length,
      kickstart_items_sold: ksUniqueListings.size,
    },
    shows_by_date: showSummaries,
    top5_shows_by_profit: [...showSummaries].sort((a, b) => b.profit - a.profit).slice(0, 5),
    bottom5_shows_by_profit: [...showSummaries].sort((a, b) => a.profit - b.profit).slice(0, 5),
    items_top25_by_quantity_sold: topItemsByQty,
    items_top25_by_revenue: topItemsByRevenue,
    items_top25_by_profit: topItemsByProfit,
    items_worst25_by_profit: worstItemsByProfit,
    category_breakdown: categoryBreakdown,
    zone_breakdown: zoneBreakdown,
    inventory_aging: {
      avg_days_unsold: agingItemsWithDate > 0 ? Math.round(totalDaysAll / agingItemsWithDate) : null,
      by_age_bucket: Object.entries(agingBuckets).map(([bucket, count]) => ({ bucket, items: count })),
      by_load: Object.entries(agingByLoad)
        .map(([load, d]) => ({ load, items: d.items, cost: +d.cost.toFixed(2), days_old: d.days_old }))
        .sort((a, b) => b.items - a.items).slice(0, 15),
      by_category: Object.entries(agingByCategory)
        .map(([cat, d]) => ({ category: cat, unsold_items: d.items, unsold_cost: +d.cost.toFixed(2) }))
        .sort((a, b) => b.unsold_items - a.unsold_items).slice(0, 15),
    },
    loads: (loads || []).map(l => ({
      id: l.id, vendor: l.vendor, date: l.date, total_cost: l.total_cost, quantity: l.quantity,
      manifest_items: loadManifestCount[l.id] || 0,
      items_sold: loadSoldCount[l.id] || 0,
      items_remaining: (loadManifestCount[l.id] || 0) - (loadSoldCount[l.id] || 0),
      sell_through: loadManifestCount[l.id] > 0 ? +(((loadSoldCount[l.id] || 0) / loadManifestCount[l.id]) * 100).toFixed(1) : 0,
    })),
    sort_zone_counts: Object.entries(sortZoneCounts).map(([zone, count]) => ({ zone, items_sorted: count })),
    expenses_by_category: Object.entries(expensesByCategory).map(([cat, amt]) => ({ category: cat, total: +amt.toFixed(2) })),
    recent_expenses: (expenses || []).slice(0, 20).map(e => ({ description: e.description, amount: e.amount, category: e.category, date: e.date })),
    kickstart_by_brand: Object.entries(ksBrands).map(([brand, d]) => ({
      brand, items: d.items, total_cost: +d.cost.toFixed(2), total_msrp: +d.msrp.toFixed(2),
    })),
    bundles: {
      total_boxes: Object.keys(bundleBoxes).length,
      total_items_bundled: (bundleScans || []).length,
      boxes: Object.entries(bundleBoxes).map(([box, count]) => ({ box_number: +box, items: count })).sort((a, b) => a.box_number - b.box_number),
    },
  }
}
