export default async (req) => {
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
  const SUPABASE_URL = process.env.SUPABASE_URL
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY

  if (!ANTHROPIC_API_KEY || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return new Response(JSON.stringify({ error: 'Missing environment variables' }), { status: 500 })
  }

  try {
    const { trip_id } = await req.json()
    if (!trip_id) {
      return new Response(JSON.stringify({ error: 'trip_id required' }), { status: 400 })
    }

    const headers = { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }

    // Fetch receipt items for this trip
    const receiptRes = await fetch(
      `${SUPABASE_URL}/rest/v1/kickstart_receipt_items?trip_id=eq.${trip_id}&select=id,style_number,description,qty,price_each`,
      { headers }
    )
    const receiptItems = await receiptRes.json()

    // Fetch enriched tag photos for this trip
    const tagsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/kickstart_tag_photos?trip_id=eq.${trip_id}&status=eq.enriched&select=id,style_number,description,color,size,brand,msrp`,
      { headers }
    )
    const tags = await tagsRes.json()

    if (!receiptItems || receiptItems.length === 0) {
      return new Response(JSON.stringify({ error: 'No receipt items found for trip', matched: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    if (!tags || tags.length === 0) {
      return new Response(JSON.stringify({ error: 'No enriched tags found for trip', matched: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Send both lists to Claude for matching
    const matchResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        messages: [{
          role: "user",
          content: `Match receipt line items to scanned clothing tags from a Free People / Urban Outfitters / Anthropologie store trip.

RECEIPT ITEMS (what was purchased — has price paid):
${JSON.stringify(receiptItems, null, 2)}

SCANNED TAGS (from clothing hang tags — has MSRP, description, style):
${JSON.stringify(tags, null, 2)}

INSTRUCTIONS:
- Match each tag to the receipt line item it most likely corresponds to.
- Match by description similarity, style number similarity, or price proximity.
- Receipt style numbers often differ from tag style numbers — match by description when styles don't match exactly.
- A receipt line with qty > 1 can match to multiple tags.
- Some tags may not match any receipt item (buyer may have scanned extra tags).
- Some receipt items may not match any tag (buyer may have missed scanning some).

Return ONLY a JSON array of matches:
[{"tag_id": 123, "receipt_item_id": 456, "confidence": "high"}, ...]

confidence is "high", "medium", or "low".
If a tag has no good match, omit it from the array.
Return ONLY the JSON array.`
        }]
      })
    })

    const matchData = await matchResponse.json()
    if (!matchResponse.ok) {
      throw new Error(matchData.error?.message || 'Claude matching API error')
    }

    const matchText = matchData.content
      .filter(item => item.type === 'text')
      .map(item => item.text)
      .join('')

    const jsonMatch = matchText.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      throw new Error('Could not parse match results from Claude')
    }

    const matches = JSON.parse(jsonMatch[0])

    // Build a lookup of receipt item prices
    const receiptPriceMap = {}
    for (const ri of receiptItems) {
      receiptPriceMap[ri.id] = ri.price_each
    }

    // Update each matched tag with cost and receipt_item_id
    let matchedCount = 0
    for (const match of matches) {
      const cost = receiptPriceMap[match.receipt_item_id]
      if (cost === undefined) continue

      const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/kickstart_tag_photos?id=eq.${match.tag_id}`, {
        method: 'PATCH',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          cost: parseFloat(cost),
          receipt_item_id: match.receipt_item_id
        })
      })

      if (updateRes.ok) matchedCount++
    }

    // Mark receipt items as matched
    const matchedReceiptIds = [...new Set(matches.map(m => m.receipt_item_id))]
    for (const rid of matchedReceiptIds) {
      await fetch(`${SUPABASE_URL}/rest/v1/kickstart_receipt_items?id=eq.${rid}`, {
        method: 'PATCH',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ matched: true })
      })
    }

    // Update trip status
    await fetch(`${SUPABASE_URL}/rest/v1/kickstart_trips?id=eq.${trip_id}`, {
      method: 'PATCH',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ status: 'matched' })
    })

    return new Response(JSON.stringify({
      matched: matchedCount,
      total_tags: tags.length,
      total_receipt_items: receiptItems.length,
      matches
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('Match error:', err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
}
