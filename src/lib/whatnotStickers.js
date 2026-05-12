/**
 * Whatnot SKU barcode sticker PDF generator.
 *
 * Produces a multi-page PDF sized for 2" x 1" thermal labels (Rollo etc.) —
 * one page per sticker, one sticker per physical intake unit. All units in
 * the same Whatnot listing group share the same SKU/barcode.
 *
 * Each sticker:
 *   - Title (top, bold) — truncates with … if it overflows
 *   - Size · Color · Condition · $MSRP (bold sub-line)
 *   - Code 128 barcode (center band)
 *   - Human-readable SKU (bottom)
 *
 * Photos were tried and dropped — at thermal printer DPI / 0.7" sq they
 * weren't readable enough to be worth the print time.
 */

import { jsPDF } from 'jspdf'
import bwipjs from 'bwip-js'

// 2" x 1" in points (jspdf default unit: pt; 1 inch = 72 pt)
const W = 144
const H = 72
const PAD_X = 6

function renderBarcodeDataUrl(sku) {
  const canvas = document.createElement('canvas')
  bwipjs.toCanvas(canvas, {
    bcid: 'code128',
    text: String(sku),
    scale: 3,
    height: 12,
    includetext: false,
    backgroundcolor: 'FFFFFF',
  })
  return canvas.toDataURL('image/png')
}

function fitFontSize(doc, text, startSize, minSize, maxWidth) {
  for (let s = startSize; s >= minSize; s -= 0.5) {
    doc.setFontSize(s)
    if (doc.getTextWidth(text) <= maxWidth) return s
  }
  return minSize
}

function buildSubLine(u) {
  // Size lives here (not in title) so a long title can truncate without
  // dropping the most important matching field.
  const parts = []
  if (u.size && u.size !== 'One Size') parts.push(u.size)
  if (u.color) parts.push(u.color)
  if (u.condition) parts.push(u.condition)
  const msrp = Number(u.msrp || 0)
  if (msrp > 0) parts.push(`$${msrp.toFixed(0)}`)
  return parts.join('  ·  ')
}

/**
 * Generate the sticker PDF and trigger a browser download.
 *
 * @param {Array} units - one entry per physical sticker to print.
 *   Each: { sku, title, brand, size, color, condition, msrp }
 * @param {string} filename
 */
export function downloadStickerPdf(units, filename = 'whatnot-stickers.pdf') {
  if (!units.length) return

  const doc = new jsPDF({ unit: 'pt', format: [W, H], orientation: 'landscape' })
  const innerW = W - PAD_X * 2

  units.forEach((u, i) => {
    if (i > 0) doc.addPage([W, H], 'landscape')

    // Title — bold, shrinks 8 → 5.5, then ellipsis if still over
    doc.setFont('helvetica', 'bold')
    let title = (u.title || u.brand || '').trim() || 'Untitled'
    const titleSize = fitFontSize(doc, title, 8, 5.5, innerW)
    doc.setFontSize(titleSize)
    if (doc.getTextWidth(title) > innerW) {
      while (title.length > 4 && doc.getTextWidth(title + '…') > innerW) title = title.slice(0, -1)
      title += '…'
    }
    doc.text(title, W / 2, 10, { align: 'center', baseline: 'middle' })

    // Sub line — size · color · condition · $MSRP (bold, shrinks if long)
    const sub = buildSubLine(u)
    if (sub) {
      doc.setFont('helvetica', 'bold')
      const subSize = fitFontSize(doc, sub, 6.5, 5, innerW)
      doc.setFontSize(subSize)
      doc.text(sub, W / 2, 19, { align: 'center', baseline: 'middle' })
    }

    // Barcode (full inner width)
    const barcodeImg = renderBarcodeDataUrl(u.sku)
    const bcH = 28
    const bcY = 24
    doc.addImage(barcodeImg, 'PNG', PAD_X, bcY, innerW, bcH)

    // SKU — bottom, bold
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.text(`SKU ${u.sku}`, W / 2, H - 8, { align: 'center', baseline: 'middle' })
  })

  doc.save(filename)
}
