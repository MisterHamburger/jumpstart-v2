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

    // Fetch trip to get receipt photo
    const tripRes = await fetch(
      `${SUPABASE_URL}/rest/v1/kickstart_trips?id=eq.${trip_id}&select=id,receipt_photo`,
      { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` } }
    )
    const trips = await tripRes.json()
    if (!trips || trips.length === 0) {
      return new Response(JSON.stringify({ error: 'Trip not found' }), { status: 404 })
    }

    const trip = trips[0]
    if (!trip.receipt_photo) {
      return new Response(JSON.stringify({ error: 'No receipt photo on trip' }), { status: 400 })
    }

    // Send receipt to Claude
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        messages: [{
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/jpeg", data: trip.receipt_photo }
            },
            {
              type: "text",
              text: `This is a photo of a retail store receipt from Free People, Urban Outfitters, or Anthropologie. Extract every item purchased.

For each line item, extract:
- style_number: the style/SKU code if visible (may be numbers or alphanumeric)
- description: the product name/description
- qty: quantity purchased (default 1 if not shown)
- price_each: the price paid per item (after any discounts). Use the actual amount charged, not the original price.
- line_total: total for that line (price_each * qty)

IMPORTANT:
- If items show a discount (e.g., 70% off), use the DISCOUNTED price, not the original.
- Include ALL items on the receipt.
- Ignore tax lines, subtotals, and payment method lines.
- If you see "2 @ $5.00" that means qty=2, price_each=5.00, line_total=10.00

Return ONLY a JSON array with no other text:
[{"style_number": "...", "description": "...", "qty": 1, "price_each": 5.00, "line_total": 5.00}, ...]

If you cannot read the receipt at all, return an empty array: []`
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

    // Parse JSON array from response
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      throw new Error('Could not parse JSON array from Claude response')
    }

    const lineItems = JSON.parse(jsonMatch[0])

    // Save to kickstart_receipt_items
    if (lineItems.length > 0) {
      const rows = lineItems.map(item => ({
        trip_id: trip_id,
        style_number: item.style_number || null,
        description: item.description || null,
        qty: item.qty || 1,
        price_each: item.price_each ? parseFloat(item.price_each) : null,
        line_total: item.line_total ? parseFloat(item.line_total) : null
      }))

      const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/kickstart_receipt_items`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(rows)
      })

      if (!insertRes.ok) {
        const err = await insertRes.text()
        throw new Error(`Failed to save receipt items: ${err}`)
      }
    }

    // Update trip total cost
    const totalCost = lineItems.reduce((sum, item) => sum + (parseFloat(item.line_total) || 0), 0)
    await fetch(`${SUPABASE_URL}/rest/v1/kickstart_trips?id=eq.${trip_id}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ total_cost: totalCost })
    })

    return new Response(JSON.stringify({
      parsed: lineItems.length,
      total_cost: totalCost,
      items: lineItems
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('Receipt parse error:', err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
}
