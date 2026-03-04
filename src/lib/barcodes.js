/**
 * Normalize a barcode string.
 * Strips leading zeros, apostrophes, and whitespace.
 * Also converts 13-digit EAN-13 starting with '1' to 12-digit UPC-A
 * (fixes the recurring leading-1 mismatch on Kickstart/Free People barcodes).
 * Must match the normalize_barcode_universal() trigger in Supabase exactly.
 */
export function normalizeBarcode(raw) {
  if (!raw) return ''
  let s = raw.toString().trim().replace(/^['\s]+/, '').replace(/^0+/, '')
  // EAN-13 → UPC-A: strip leading 1 from 13-digit all-numeric codes
  if (s.length === 13 && s[0] === '1' && /^\d+$/.test(s)) {
    s = s.slice(1)
  }
  return s
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
