// Parse an uploaded Whatnot financial statement PDF and return structured JSON.
// Accepts: POST with { pdf_base64: "..." } body.
// Returns: { period_start, period_end, period_label, statement_number,
//            sales, tips, commission, processing, show_boost,
//            seller_shipping, other_adjustments, payouts, raw_text }.
// Does NOT write to DB — the frontend previews the result, lets the user
// tweak dates, then inserts into whatnot_statements itself.

import { PDFParse } from 'pdf-parse'

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9,
  oct: 10, nov: 11, dec: 12
}

const LAST_DAY = (year, month) => new Date(year, month, 0).getDate()

// Extract a dollar-amount value that appears on the same line as (or right after) a label.
function extractAmount(text, label) {
  // Match: "Label $12,345.67" or "Label  $12,345.67" across line breaks
  const pattern = new RegExp(
    label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^\\$\\n]*\\$([\\d,]+\\.\\d{2})',
    'i'
  )
  const m = text.match(pattern)
  return m ? parseFloat(m[1].replace(/,/g, '')) : 0
}

// Try to detect the period from the statement text.
// Handles: "Period: March 2026", "Period: Mar 1 - Mar 7, 2026", "Period: 2026".
function detectPeriod(text) {
  // Grab the value after "Period:" (require literal colon; the word "period"
  // also appears in statement boilerplate without a colon, which we skip).
  const periodMatch = text.match(/Period:\s*([^\n\r]{1,80})/i)
  if (!periodMatch) return { period_start: null, period_end: null, period_label: null }
  const label = periodMatch[1].trim()

  // Monthly: "March 2026"
  const monthYear = label.match(/^([A-Za-z]+)\s+(\d{4})$/)
  if (monthYear) {
    const mName = monthYear[1].toLowerCase()
    const y = parseInt(monthYear[2], 10)
    if (MONTHS[mName]) {
      const m = MONTHS[mName]
      const start = `${y}-${String(m).padStart(2, '0')}-01`
      const end = `${y}-${String(m).padStart(2, '0')}-${String(LAST_DAY(y, m)).padStart(2, '0')}`
      return { period_start: start, period_end: end, period_label: label }
    }
  }

  // Yearly: just "2026"
  const yearOnly = label.match(/^(\d{4})$/)
  if (yearOnly) {
    const y = parseInt(yearOnly[1], 10)
    return { period_start: `${y}-01-01`, period_end: `${y}-12-31`, period_label: label }
  }

  // Weekly / custom range — try to parse "Mar 1 - Mar 7, 2026" or "March 1 - March 7, 2026"
  const range = label.match(/([A-Za-z]+)\s+(\d{1,2})\s*[-–]\s*(?:([A-Za-z]+)\s+)?(\d{1,2}),?\s*(\d{4})/)
  if (range) {
    const m1 = MONTHS[range[1].toLowerCase()]
    const d1 = parseInt(range[2], 10)
    const m2 = range[3] ? MONTHS[range[3].toLowerCase()] : m1
    const d2 = parseInt(range[4], 10)
    const y = parseInt(range[5], 10)
    if (m1 && m2) {
      const start = `${y}-${String(m1).padStart(2, '0')}-${String(d1).padStart(2, '0')}`
      const end = `${y}-${String(m2).padStart(2, '0')}-${String(d2).padStart(2, '0')}`
      return { period_start: start, period_end: end, period_label: label }
    }
  }

  // Fallback: return the label, let the user fill in dates
  return { period_start: null, period_end: null, period_label: label }
}

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST required' }), { status: 405 })
  }

  try {
    const body = await req.json()
    const pdfBase64 = body.pdf_base64
    if (!pdfBase64) {
      return new Response(JSON.stringify({ error: 'pdf_base64 required' }), { status: 400 })
    }

    const pdfBytes = new Uint8Array(Buffer.from(pdfBase64, 'base64'))
    const parser = new PDFParse({ data: pdfBytes })
    let text = ''
    try {
      const parsed = await parser.getText()
      text = parsed.text || ''
    } finally {
      await parser.destroy()
    }

    const { period_start, period_end, period_label } = detectPeriod(text)
    const stmtMatch = text.match(/Statement Number:?\s*([\w-]+)/i)

    const result = {
      period_start,
      period_end,
      period_label,
      statement_number: stmtMatch ? stmtMatch[1] : null,
      sales: extractAmount(text, 'Sales'),
      tips: extractAmount(text, 'Tips'),
      commission: extractAmount(text, 'Commission fees'),
      processing: extractAmount(text, 'Payment processing fees'),
      show_boost: extractAmount(text, 'Show boost and promote'),
      seller_shipping: extractAmount(text, 'Seller Paid Shipping'),
      other_adjustments: extractAmount(text, 'Other adjustments'),
      payouts: extractAmount(text, 'Payouts'),
      raw_text_preview: text.slice(0, 500)
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (err) {
    console.error('PDF parse error:', err)
    return new Response(JSON.stringify({ error: err.message || 'Failed to parse PDF' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}
