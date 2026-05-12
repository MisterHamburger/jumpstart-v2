/**
 * Whatnot SKU barcode sticker PDF generator.
 *
 * Produces a multi-page PDF sized for 2" x 1" thermal labels (Rollo etc.) —
 * one page per sticker, one sticker per physical intake unit. All units in
 * the same Whatnot listing group share the same SKU/barcode, so e.g. 5 of
 * the same shirt produces 5 identical stickers.
 *
 * Each sticker:
 *   - Brand + size + condition (small top line)
 *   - Code 128 barcode (center, large)
 *   - Human-readable SKU below barcode
 */

import { jsPDF } from 'jspdf'
import bwipjs from 'bwip-js'

// 2" x 1" in points (jspdf default unit: pt; 1 inch = 72 pt)
const W = 144
const H = 72
const PAD_X = 6
const PAD_Y = 4

function renderBarcodeDataUrl(sku) {
  // Render Code 128 barcode to canvas, return as PNG data URL for embedding.
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

/**
 * Generate the sticker PDF and trigger a browser download.
 *
 * @param {Array} units - one entry per physical sticker to print.
 *   Each: { sku, brand, size, condition }
 * @param {string} filename - PDF filename
 */
export function downloadStickerPdf(units, filename = 'whatnot-stickers.pdf') {
  if (!units.length) return

  // First page sized to label; subsequent pages added with same size.
  const doc = new jsPDF({ unit: 'pt', format: [W, H], orientation: 'landscape' })

  units.forEach((u, i) => {
    if (i > 0) doc.addPage([W, H], 'landscape')

    // Top line: brand · size · condition
    const topParts = [u.brand, u.size, u.condition].filter(Boolean)
    if (topParts.length) {
      doc.setFontSize(7)
      doc.setFont('helvetica', 'normal')
      const top = topParts.join('  ·  ')
      doc.text(top, W / 2, PAD_Y + 6, { align: 'center', baseline: 'middle' })
    }

    // Barcode (Code 128, centered horizontally, occupies middle band)
    const barcodeImg = renderBarcodeDataUrl(u.sku)
    const bcW = W - PAD_X * 2
    const bcH = 30
    const bcY = (H - bcH) / 2 - 2
    doc.addImage(barcodeImg, 'PNG', PAD_X, bcY, bcW, bcH)

    // Human-readable SKU under the barcode (large, monospace-feeling)
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.text(`SKU ${u.sku}`, W / 2, H - PAD_Y - 4, { align: 'center', baseline: 'middle' })
  })

  doc.save(filename)
}

/**
 * Expand a listings array into one sticker entry per quantity unit.
 *   listings: [{ sku, brand, size, condition, quantity }, ...]
 * Returns flat array of { sku, brand, size, condition } repeated quantity times.
 */
export function expandToUnits(listings) {
  const units = []
  for (const l of listings) {
    for (let i = 0; i < l.quantity; i++) units.push({
      sku: l.sku,
      brand: l.brand,
      size: l.size,
      condition: l.condition,
    })
  }
  return units
}
