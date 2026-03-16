export default async (req) => {
  const SERPAPI_KEY = process.env.SERPAPI_KEY

  if (!SERPAPI_KEY) {
    return new Response(JSON.stringify({ error: 'Missing SERPAPI_KEY' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    })
  }

  try {
    const { imageUrl, brand } = await req.json()
    if (!imageUrl) {
      return new Response(JSON.stringify({ error: 'imageUrl is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      })
    }

    const brandName = brand || 'Free People'

    // --- Call SerpAPI Google Lens ---
    const serpUrl = `https://serpapi.com/search.json?engine=google_lens&url=${encodeURIComponent(imageUrl)}&q=${encodeURIComponent(brandName)}&api_key=${SERPAPI_KEY}`
    const serpRes = await fetch(serpUrl)

    if (!serpRes.ok) {
      const serpErr = await serpRes.text()
      console.error('SerpAPI error:', serpRes.status, serpErr)
      return new Response(JSON.stringify({ error: 'Google Lens search failed' }), {
        status: 500, headers: { 'Content-Type': 'application/json' }
      })
    }

    const serpData = await serpRes.json()

    // --- Extract best product match ---
    let productName = ''
    let msrp = 0
    let confidence = 'none'

    const visualMatches = serpData.visual_matches || []
    const knowledgeGraph = serpData.knowledge_graph || null

    const brandKeywords = {
      'Free People': ['free people', 'fp movement', 'fp beach', 'we the free'],
      'Urban Outfitters': ['urban outfitters', 'uo', 'bdg'],
      'Anthropologie': ['anthropologie', 'anthro']
    }
    const acceptedKeywords = brandKeywords[brandName] || [brandName.toLowerCase()]
    const allBrandKeywords = Object.values(brandKeywords).flat()

    const matchesBrand = (title) => {
      if (!title) return false
      const t = title.toLowerCase()
      return acceptedKeywords.some(kw => t.includes(kw))
    }
    const matchesAnyBrand = (title) => {
      if (!title) return false
      const t = title.toLowerCase()
      return allBrandKeywords.some(kw => t.includes(kw))
    }

    if (knowledgeGraph && knowledgeGraph.title && matchesBrand(knowledgeGraph.title)) {
      productName = knowledgeGraph.title
      if (knowledgeGraph.price) {
        msrp = parseFloat(knowledgeGraph.price.replace(/[^0-9.]/g, '')) || 0
      }
      confidence = 'high'
    } else if (visualMatches.length > 0) {
      const exactBrandMatch = visualMatches.find(m => matchesBrand(m.title))
      const anyBrandMatch = !exactBrandMatch ? visualMatches.find(m => matchesAnyBrand(m.title)) : null
      const bestMatch = exactBrandMatch || anyBrandMatch

      if (bestMatch) {
        productName = bestMatch.title || ''
        // Strip website names after | or – or — separators
        productName = productName.replace(/\s*[\|–—]\s*(Free People|Urban Outfitters|Anthropologie|Nordstrom|Poshmark|Mercari|eBay|Depop|ThredUp|Lyst|Zappos|REVOLVE|Bloomingdale|Editorialist|ASOS|Macy|Shopbop|Farfetch|NET-A-PORTER|Neiman|Saks|Verishop|Garmentory|Nuuly).*$/i, '').trim()
        // Strip any remaining text after | – — separators (catch-all for unknown sites)
        productName = productName.replace(/\s*[\|–—]\s*[A-Z].*$/i, '').trim()
        // Strip discount/promo text (e.g. "- 69% Off", "- Up to 50% Off", "- Sale")
        productName = productName.replace(/\s*-\s*\d+%\s*off.*$/i, '').trim()
        productName = productName.replace(/\s*-\s*(up to\s+)?\d+%.*$/i, '').trim()
        productName = productName.replace(/\s*-\s*(sale|on sale|clearance|final sale|last chance).*$/i, '').trim()
        // Strip trailing price text (e.g. "from $49.99", "starting at $29")
        productName = productName.replace(/\s*(from|starting at)\s*\$[\d.]+.*$/i, '').trim()
        // Strip "Combo" suffix that some sites add
        productName = productName.replace(/\s+Combo\s*$/i, '').trim()

        msrp = extractPrice(bestMatch)

        if (msrp === 0) {
          const allBrandMatches = visualMatches.filter(m => matchesBrand(m.title) || matchesAnyBrand(m.title))
          for (const m of allBrandMatches) {
            const p = extractPrice(m)
            if (p > 0) { msrp = p; break }
          }
        }

        confidence = exactBrandMatch ? 'high' : 'medium'
      }
    }

    // Check shopping_results for price
    if (msrp === 0 && serpData.shopping_results && serpData.shopping_results.length > 0) {
      const shopMatch = serpData.shopping_results.find(s => matchesBrand(s.title))
      if (shopMatch && shopMatch.price) {
        msrp = parseFloat(String(shopMatch.price).replace(/[^0-9.]/g, '')) || 0
      }
    }

    // Last resort: check visual matches with brand source
    if (msrp === 0 && visualMatches.length > 0) {
      for (const m of visualMatches) {
        if (m.source && (matchesBrand(m.source) || matchesAnyBrand(m.source))) {
          const p = extractPrice(m)
          if (p > 0) { msrp = p; break }
        }
      }
    }

    const category = guessCategory(productName)
    const color = guessColor(productName)

    return new Response(JSON.stringify({
      product_name: productName,
      msrp,
      category,
      color,
      confidence
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('Identify error:', err)
    return new Response(JSON.stringify({ error: err.message || 'Identification failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}

function extractPrice(match) {
  if (!match) return 0
  if (match.price && match.price.extracted_value) return match.price.extracted_value
  if (match.price && match.price.value) {
    return parseFloat(String(match.price.value).replace(/[^0-9.]/g, '')) || 0
  }
  if (typeof match.price === 'string') {
    return parseFloat(match.price.replace(/[^0-9.]/g, '')) || 0
  }
  return 0
}

function guessColor(name) {
  if (!name) return ''
  const n = name.toLowerCase()

  if (n.includes('ivory') || n.includes('cream') || n.includes('oatmeal') || n.includes('ecru')) return 'Ivory / Cream'
  if (n.includes('navy')) return 'Navy'
  if (n.includes('burgundy') || n.includes('wine') || n.includes('maroon') || n.includes('oxblood')) return 'Burgundy'
  if (n.includes('olive') || n.includes('army')) return 'Olive'
  if (n.includes('dark blue') || n.includes('indigo')) return 'Dark Blue'
  if (n.includes('light blue') || n.includes('sky') || n.includes('chambray') || n.includes('baby blue')) return 'Light Blue'
  if (n.includes('denim')) return 'Denim'
  if (n.includes('plaid') || n.includes('flannel')) return 'Plaid'
  if (n.includes('stripe') || n.includes('striped')) return 'Stripe'
  if (n.includes('multi') || n.includes('floral') || n.includes('print') || n.includes('tie dye') || n.includes('combo') || n.includes('patchwork')) return 'Multi-Color'
  if (n.includes('black')) return 'Black'
  if (n.includes('white') || n.includes('optic')) return 'White'
  if (n.includes('gray') || n.includes('grey') || n.includes('charcoal') || n.includes('heather')) return 'Gray'
  if (n.includes('brown') || n.includes('chocolate') || n.includes('mocha') || n.includes('cocoa')) return 'Brown'
  if (n.includes('tan') || n.includes('khaki') || n.includes('beige') || n.includes('camel') || n.includes('sand')) return 'Tan'
  if (n.includes('pink') || n.includes('rose') || n.includes('blush') || n.includes('mauve') || n.includes('fuchsia')) return 'Pink'
  if (n.includes('red') || n.includes('crimson') || n.includes('scarlet')) return 'Red'
  if (n.includes('orange') || n.includes('rust') || n.includes('terracotta') || n.includes('coral')) return 'Orange'
  if (n.includes('yellow') || n.includes('gold') || n.includes('mustard') || n.includes('lemon')) return 'Yellow'
  if (n.includes('green') || n.includes('sage') || n.includes('emerald') || n.includes('forest') || n.includes('moss') || n.includes('mint')) return 'Green'
  if (n.includes('blue') || n.includes('cobalt') || n.includes('teal') || n.includes('cerulean')) return 'Blue'
  if (n.includes('purple') || n.includes('violet') || n.includes('plum') || n.includes('lavender') || n.includes('lilac')) return 'Purple'

  return ''
}

function guessCategory(name) {
  if (!name) return ''
  const n = name.toLowerCase()

  if (n.includes(' set') || n.includes('set ') || n.includes('matching') || n.includes('two piece') || n.includes('2-piece')) return 'Sets'
  if (n.includes('dress') && !n.includes('undress')) return 'Dresses'
  if (n.includes('hoodie') || n.includes('sweatshirt') || n.includes('pullover')) return 'Hoodies'
  if (n.includes('jacket') || n.includes('coat') || n.includes('blazer') || n.includes('puffer') || n.includes('anorak')) return 'Outerwear/Jackets'
  if (n.includes('jumpsuit')) return 'Jumpsuits'
  if (n.includes('romper')) return 'Rompers'
  if (n.includes('legging') || n.includes('tight')) return 'Leggings'
  if (n.includes('skirt') || n.includes('skort')) return 'Skirts'
  if (n.includes('short') && !n.includes('sleeve')) return 'Shorts'
  if (n.includes('pant') || n.includes('jean') || n.includes('trouser') || n.includes('jogger') || n.includes('wide leg') || n.includes('cargo')) return 'Pants'
  if (n.includes('tank') || n.includes('cami') || n.includes('bralette') || n.includes('crop top') || n.includes('sleeveless')) return 'Sleeveless Tops'
  if (n.includes('long sleeve') || n.includes('henley') || n.includes('thermal') || n.includes('sweater') || n.includes('cardigan') || n.includes('turtleneck')) return 'Long Sleeve Tops'
  if (n.includes('tee') || n.includes('t-shirt') || n.includes('short sleeve') || n.includes('top') || n.includes('blouse') || n.includes('tunic')) return 'Short Sleeve Tops'
  if (n.includes('bag') || n.includes('tote') || n.includes('backpack') || n.includes('purse')) return 'Accessories - Bags'
  if (n.includes('belt')) return 'Accessories - Belts'
  if (n.includes('necklace') || n.includes('earring') || n.includes('bracelet') || n.includes('ring')) return 'Accessories - Jewelry'
  if (n.includes('sock') || n.includes('slipper')) return 'Accessories - Socks'
  if (n.includes('hat') || n.includes('scarf') || n.includes('glove') || n.includes('headband') || n.includes('beanie')) return 'Accessories - Other'

  return ''
}
