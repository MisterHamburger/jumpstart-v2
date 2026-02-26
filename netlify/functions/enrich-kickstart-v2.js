export default async (req) => {
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
  const SUPABASE_URL = process.env.SUPABASE_URL
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY

  if (!ANTHROPIC_API_KEY || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return new Response(JSON.stringify({ error: 'Missing environment variables' }), { status: 500 })
  }

  try {
    // Optional: scope to a specific trip
    let tripFilter = ''
    try {
      const body = await req.json()
      if (body.trip_id) tripFilter = `&trip_id=eq.${body.trip_id}`
    } catch { /* no body = process all pending */ }

    // Fetch pending tag photos (limit to 5 to avoid timeout)
    const fetchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/kickstart_tag_photos?status=eq.pending_enrichment${tripFilter}&limit=5&select=id,photo_data,trip_id`,
      { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` } }
    )

    const items = await fetchRes.json()

    if (!items || items.length === 0) {
      return new Response(JSON.stringify({ message: 'No tags pending enrichment', processed: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const results = []

    for (const item of items) {
      if (!item.photo_data) {
        await updateTag(SUPABASE_URL, SUPABASE_ANON_KEY, item.id, { status: 'needs_manual' })
        results.push({ id: item.id, status: 'skipped', reason: 'no photo' })
        continue
      }

      try {
        const tagData = await readTagWithClaude(ANTHROPIC_API_KEY, item.photo_data)

        await updateTag(SUPABASE_URL, SUPABASE_ANON_KEY, item.id, {
          upc: tagData.upc || null,
          style_number: tagData.style_number || null,
          brand: tagData.brand || null,
          description: tagData.description || null,
          color: tagData.color || null,
          size: tagData.size || null,
          msrp: tagData.msrp ? parseFloat(tagData.msrp) : null,
          status: 'enriched'
        })

        results.push({ id: item.id, status: 'enriched', data: tagData })
      } catch (err) {
        console.error(`Error processing tag ${item.id}:`, err)
        await updateTag(SUPABASE_URL, SUPABASE_ANON_KEY, item.id, { status: 'enrichment_failed' })
        results.push({ id: item.id, status: 'failed', error: err.message })
      }
    }

    // Check if there are more pending — tell caller to call again
    const moreRes = await fetch(
      `${SUPABASE_URL}/rest/v1/kickstart_tag_photos?status=eq.pending_enrichment${tripFilter}&limit=1&select=id`,
      { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` } }
    )
    const more = await moreRes.json()

    return new Response(JSON.stringify({
      processed: results.length,
      has_more: more && more.length > 0,
      results
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('Enrichment v2 error:', err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
}

async function readTagWithClaude(apiKey, photoBase64) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 500,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/jpeg", data: photoBase64 }
          },
          {
            type: "text",
            text: `This is a photo of a clothing hang tag from Free People, Urban Outfitters, or Anthropologie. Read ALL text on the tag carefully.

Rules for extracting data:
- UPC: the number printed BELOW the barcode lines at the bottom of the tag (usually 12-13 digits). If you cannot see a barcode or numbers below it, return empty string. Do NOT use any S/C/V codes as the UPC.
- Style number: the code starting with OB, C, or CS (e.g. OB1364600, C8130, CS151). On some tags this appears after "S " prefix — use the code WITHOUT the "S " prefix.
- Color: the color NAME written in words (e.g. PP MOTIF, SMOKEY GRAPE, LAPIS, BLACK). This is usually on its own line. NEVER use the C code number (like C 0115) — that is a code, not a color name.
- Size: XS, S, M, L, XL, or ALL
- MSRP: the USD price on the tag (no dollar sign). If both USD and CAD prices are shown, use the USD price. If only one price is shown, use that.
- Brand: if you see "Urban Outfitters" or "Anthropologie" anywhere, use that. Otherwise use "Free People".
- Description: the product name if visible. Often not on the tag — use empty string if not found.

Return ONLY a JSON object with no other text:

{"upc": "the UPC/barcode number (digits only)", "brand": "the brand name", "style_number": "the style number", "description": "the item/product name if visible", "color": "the color name", "size": "the size", "msrp": "the retail price as a number only, no dollar sign"}

If you can't read a field, use an empty string. Return ONLY the JSON object.`
          }
        ]
      }]
    })
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.error?.message || 'Claude API error')
  }

  const text = data.content
    .filter(item => item.type === 'text')
    .map(item => item.text)
    .join('')

  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error('Could not parse JSON from Claude response')
  }

  return JSON.parse(jsonMatch[0])
}

async function updateTag(supabaseUrl, supabaseKey, id, updates) {
  const response = await fetch(`${supabaseUrl}/rest/v1/kickstart_tag_photos?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(updates)
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Supabase update failed: ${err}`)
  }
}
