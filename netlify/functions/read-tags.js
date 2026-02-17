export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
  if (!ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: 'API key not configured' }), { status: 500 })
  }

  try {
    const { frontPhoto, backPhoto, frontType, backType } = await req.json()

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: frontType || "image/jpeg", data: frontPhoto }
            },
            {
              type: "image",
              source: { type: "base64", media_type: backType || "image/jpeg", data: backPhoto }
            },
            {
              type: "text",
              text: "These are photos of the front and back hang tags of a clothing item from a reseller called Reclectic. Extract the following information and return ONLY a JSON object with no other text:\n\n{\"upc\": \"the UPC/barcode number\", \"brand\": \"the brand name (e.g. Free People, Free People Movement)\", \"style_number\": \"the style number (e.g. OB1960599)\", \"description\": \"the item name/description\", \"color\": \"the color name\", \"size\": \"the size (e.g. S, M, L, XL)\", \"msrp\": \"the retail price as a number only, no dollar sign\", \"cost\": \"our cost/price paid as a number only, no dollar sign\"}\n\nThe front tag (Reclectic side) typically has: our cost, comparable value/MSRP, UPC, savings percentage.\nThe back tag (original brand side) typically has: brand, style number, color, size, MSRP, barcode.\n\nIf you can't read a field, use an empty string. Return ONLY the JSON object."
            }
          ]
        }]
      })
    })

    const data = await response.json()

    if (!response.ok) {
      return new Response(JSON.stringify({ error: data.error?.message || 'API error' }), { status: 500 })
    }

    const text = data.content
      .filter(item => item.type === 'text')
      .map(item => item.text)
      .join('')

    return new Response(JSON.stringify({ result: text }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
}
