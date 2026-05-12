/**
 * Whatnot bulk-listing CSV export.
 *
 * Maps `kickstart_intake` rows to Whatnot's seller-hub CSV format and triggers
 * a browser download. Schema mapping is in MAPPINGS below.
 */

// Internal Kickstart category → Whatnot { Category (parent group), Sub Category (leaf) }
// Whatnot's CSV uses inverted terminology vs their UI:
//   CSV Category = Values-tab "subcategory categories" (parent group)
//   CSV Sub Category = Values-tab "subcategories" (leaf)
const CATEGORY_MAP = {
  'Tops':         { category: "Women's Fashion",     sub: "Women's Contemporary" },
  'Bottoms':      { category: "Women's Fashion",     sub: "Women's Contemporary" },
  'Sweaters':     { category: "Women's Fashion",     sub: "Women's Contemporary" },
  'Outerwear':    { category: "Women's Fashion",     sub: "Women's Contemporary" },
  'Dresses':      { category: "Women's Fashion",     sub: "Women's Contemporary" },
  'Jumpsuits':    { category: "Women's Fashion",     sub: "Women's Contemporary" },
  'Sets':         { category: "Women's Fashion",     sub: "Women's Contemporary" },
  'Accessories':  { category: 'Bags & Accessories',  sub: 'Other Accessories' },
  'Bags':         { category: 'Bags & Accessories',  sub: 'Midrange & Fashion Bags' },
  'Jewelry':      { category: 'Jewelry',             sub: 'Contemporary Costume' },
}

// Internal condition → Whatnot Condition
const CONDITION_MAP = {
  'NWT': 'New With Tags',
  'NWOT': 'New Without Tags',
  'Pre-loved/Nuuly': 'Pre-owned - Good',
}

const SHIPPING_PROFILE = 'Bundle 7 items per box (11.4oz weight)'

const HEADERS = [
  'Category', 'Sub Category', 'Title', 'Description', 'Quantity', 'Type',
  'Price', 'Shipping Profile', 'Offerable', 'Hazmat', 'Condition',
  'Cost Per Item', 'SKU',
  'Image URL 1', 'Image URL 2', 'Image URL 3', 'Image URL 4',
  'Image URL 5', 'Image URL 6', 'Image URL 7', 'Image URL 8',
]

function escapeCsvField(value) {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`
  return str
}

/**
 * Group key: identical-attribute units become one listing.
 * Returns null if the row can't be mapped (skip it).
 */
function groupKey(intake) {
  const mapping = CATEGORY_MAP[intake.description]
  const condition = CONDITION_MAP[intake.condition]
  if (!mapping || !condition) return null
  return [
    intake.description || '',
    (intake.title || '').trim(),
    (intake.notes || '').trim(),
    (intake.color || '').trim(),
    (intake.size || '').trim(),
    (intake.brand || '').trim(),
    intake.condition || '',
    Number(intake.msrp || 0).toFixed(2),
    Number(intake.true_cost || 0).toFixed(2),
  ].join('|||')
}

/**
 * Title format: "Free People Cardi - M - $128 MSRP". Size and MSRP are
 * appended so buyers see them on Whatnot at a glance and the streamer can
 * read them off without opening the listing. Size suffix is dropped for
 * "One Size"; MSRP suffix is dropped when missing or 0.
 */
function buildTitle(intake) {
  const baseTitle = intake.title || 'Free People'
  const sizeSuffix = intake.size && intake.size !== 'One Size' ? ` - ${intake.size}` : ''
  const msrp = Number(intake.msrp || 0)
  const msrpSuffix = msrp > 0 ? ` - $${msrp.toFixed(0)} MSRP` : ''
  return `${baseTitle}${sizeSuffix}${msrpSuffix}`
}

/**
 * Build one CSV row (array of strings) for a group of identical intakes.
 * The first intake's id becomes the SKU (representative); Quantity = group size.
 */
function buildRow(group) {
  const first = group[0]
  const mapping = CATEGORY_MAP[first.description]
  const condition = CONDITION_MAP[first.condition]
  const title = buildTitle(first)

  return [
    mapping.category,                                  // Category (parent group)
    mapping.sub,                                       // Sub Category (leaf)
    title,                                             // Title (with size suffix)
    first.notes || first.title || 'Free People',       // Description
    group.length,                                      // Quantity
    'Auction',                                         // Type
    1,                                                  // Price (starting bid)
    SHIPPING_PROFILE,                                  // Shipping Profile
    'FALSE',                                           // Offerable
    'Not Hazmat',                                      // Hazmat
    condition,                                         // Condition
    Number(first.true_cost || 0).toFixed(2),           // Cost Per Item
    String(first.id),                                  // SKU (representative)
    first.photo_url || '',                             // Image URL 1
    '', '', '', '', '', '', '',                        // Image URL 2-8
  ]
}

/**
 * Generate a CSV string from a list of intake rows.
 * Identical units (same title/desc/color/size/condition/etc.) collapse to one
 * Whatnot listing with Quantity = count, SKU = first unit's intake.id.
 * Returns `{ csv, included, skipped, groups, skuByIntakeId, listings }`.
 *   skuByIntakeId: Map(intake.id -> sku) for every unit in any group
 *                  (every unit in a group shares the group's SKU).
 *   listings:      Array of { sku, title, brand, size, condition, quantity }
 *                  — one entry per Whatnot listing, useful for sticker print.
 */
export function generateWhatnotCsv(intakeRows) {
  const groups = new Map()
  let skipped = 0
  for (const r of intakeRows) {
    const key = groupKey(r)
    if (!key) { skipped++; continue }
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }

  const lines = [HEADERS.join(',')]
  const skuByIntakeId = new Map()
  const listings = []
  for (const group of groups.values()) {
    group.sort((a, b) => a.id - b.id)
    const sku = String(group[0].id)
    for (const u of group) skuByIntakeId.set(u.id, sku)
    const first = group[0]
    listings.push({
      sku,
      title: buildTitle(first),
      brand: first.brand || '',
      size: first.size || '',
      condition: first.condition || '',
      quantity: group.length,
    })
    lines.push(buildRow(group).map(escapeCsvField).join(','))
  }

  return {
    csv: lines.join('\n'),
    included: intakeRows.length - skipped,
    skipped,
    groups: groups.size,
    skuByIntakeId,
    listings,
  }
}

/**
 * Trigger a browser download of a CSV string.
 */
export function downloadCsv(csv, filename) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 100)
}
