/**
 * Normalize a barcode string.
 * Strips leading zeros, apostrophes, and whitespace.
 * Must match the normalize_barcode() function in Supabase exactly.
 */
export function normalizeBarcode(raw) {
  if (!raw) return ''
  return raw
    .toString()
    .trim()
    .replace(/^['\s]+/, '')
    .replace(/^0+/, '')
}

/**
 * Check if a barcode looks like a valid liquidator barcode.
 * Liquidator barcodes start with 099 (or 99 after normalization).
 * SKU barcodes (211...) should be filtered out in scanner modes.
 */
export function isLiquidatorBarcode(raw) {
  const norm = normalizeBarcode(raw)
  return norm.startsWith('99') || norm.startsWith('091')
}
