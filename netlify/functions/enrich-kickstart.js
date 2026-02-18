export default async (req) => {
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
  const SUPABASE_URL = process.env.SUPABASE_URL
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY

  if (!ANTHROPIC_API_KEY || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return new Response(JSON.stringify({ error: 'Missing environment variables' }), { status: 500 })
  }

  try {
    // Fetch pending items (limit to 5 at a time to avoid timeout)
    const fetchRes = await fetch(`${SUPABASE_URL}/rest/v1/kickstart_items?status=eq.pending_enrichment&limit=5&select=id,photo_data,cost`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      }
    })
    
    const items = await fetchRes.json()
    
    if (!items || items.length === 0) {
      return new Response(JSON.stringify({ message: 'No items pending enrichment', processed: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const results = []

    for (const item of items) {
      if (!item.photo_data) {
        // No photo - mark as needs_manual
        await updateItem(SUPABASE_URL, SUPABASE_ANON_KEY, item.id, { status: 'needs_manual' })
        results.push({ id: item.id, status: 'skipped', reason: 'no photo' })
        continue
      }

      try {
        // Call Claude to read the tag
        const tagData = await readTagWithClaude(ANTHROPIC_API_KEY, item.photo_data)
        
        // Update the item with extracted data
        await updateItem(SUPABASE_URL, SUPABASE_ANON_KEY, item.id, {
          upc: tagData.upc || null,
          style_number: tagData.style_number || null,
          description: tagData.description || null,
          color: tagData.color || null,
          size: tagData.size || null,
          msrp: tagData.msrp ? parseFloat(tagData.msrp) : null,
          status: 'enriched'
        })
        
        results.push({ id: item.id, status: 'enriched', data: tagData })
      } catch (err) {
        console.error(`Error processing item ${item.id}:`, err)
        await updateItem(SUPABASE_URL, SUPABASE_ANON_KEY, item.id, { status: 'enrichment_failed' })
        results.push({ id: item.id, status: 'failed', error: err.message })
      }
    }

    return new Response(JSON.stringify({ processed: results.length, results }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('Enrichment error:', err)
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
            text: `This is a photo of a clothing hang tag from Free People or Free People Movement. Extract the following information and return ONLY a JSON object with no other text:

{"upc": "the UPC/barcode number (digits only)", "style_number": "the style number", "description": "the item name", "color": "the color name", "size": "the size (XS, S, M, L, XL, etc)", "msrp": "the retail price as a number only, no dollar sign"}

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

  // Parse JSON from response
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error('Could not parse JSON from Claude response')
  }
  
  return JSON.parse(jsonMatch[0])
}

async function updateItem(supabaseUrl, supabaseKey, id, updates) {
  const response = await fetch(`${supabaseUrl}/rest/v1/kickstart_items?id=eq.${id}`, {
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
