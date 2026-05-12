/**
 * Whatnot SKU barcode sticker PDF generator.
 *
 * Produces a multi-page PDF sized for 2" x 1" thermal labels (Rollo etc.) —
 * one page per sticker, one sticker per physical intake unit. All units in
 * the same Whatnot listing group share the same SKU/barcode.
 *
 * Layout (with photo):
 *   ┌─────┬──────────────────────────────┐
 *   │     │ Title (bold)                 │
 *   │ pic │ size · color · condition · $ │
 *   │     │ ████ ███ █████ ████ ██████   │
 *   │     │           SKU 12345           │
 *   └─────┴──────────────────────────────┘
 *
 * No-photo fallback: right column expands to full width.
 */

import { jsPDF } from 'jspdf'
import bwipjs from 'bwip-js'

// 2" x 1" in points (jspdf default unit: pt; 1 inch = 72 pt)
const W = 144
const H = 72
const PAD = 4
const PHOTO_SIZE = 52 // ~0.72" square — leaves ~85pt for the right column

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

// Fetch an image URL and return a grayscale PNG data URL sized for the sticker.
// Returns null on any failure (network, CORS, decode) so the sticker prints
// without the photo rather than failing the whole batch.
async function fetchGrayscalePhoto(url) {
  if (!url) return null
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image()
      i.crossOrigin = 'anonymous'
      i.onload = () => resolve(i)
      i.onerror = reject
      i.src = url
    })
    // Render at ~2x target size for printer crispness, then jsPDF scales down.
    const target = PHOTO_SIZE * 2
    const canvas = document.createElement('canvas')
    canvas.width = target
    canvas.height = target
    const ctx = canvas.getContext('2d')
    // Cover-fit (square crop centered)
    const scale = Math.max(target / img.width, target / img.height)
    const drawW = img.width * scale
    const drawH = img.height * scale
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, target, target)
    ctx.drawImage(img, (target - drawW) / 2, (target - drawH) / 2, drawW, drawH)
    // Grayscale + slight contrast boost for thermal printers
    const px = ctx.getImageData(0, 0, target, target)
    const d = px.data
    for (let i = 0; i < d.length; i += 4) {
      const g = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114
      // Soft S-curve to recover detail when thermal printing
      const v = Math.min(255, Math.max(0, (g - 128) * 1.15 + 128))
      d[i] = d[i + 1] = d[i + 2] = v
    }
    ctx.putImageData(px, 0, 0)
    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}

function fitFontSize(doc, text, startSize, minSize, maxWidth) {
  for (let s = startSize; s >= minSize; s -= 0.5) {
    doc.setFontSize(s)
    if (doc.getTextWidth(text) <= maxWidth) return s
  }
  return minSize
}

function buildSubLine(u) {
  // Size + color + condition + MSRP — the disambiguation row. Size lives
  // here (not in title) so long titles can truncate without dropping the
  // most important matching field.
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
 * @param {Array} units - one entry per physical sticker to print. Each:
 *   { sku, title, brand, size, color, condition, msrp, photo_url }
 * @param {string} filename
 */
export async function downloadStickerPdf(units, filename = 'whatnot-stickers.pdf') {
  if (!units.length) return

  // Pre-fetch + dedupe photos by SKU so 5 units of the same listing share
  // one decode/grayscale pass.
  const photoBySku = new Map()
  const uniqueSkus = new Map()
  for (const u of units) {
    if (!uniqueSkus.has(u.sku) && u.photo_url) uniqueSkus.set(u.sku, u.photo_url)
  }
  await Promise.all(
    Array.from(uniqueSkus.entries()).map(async ([sku, url]) => {
      const dataUrl = await fetchGrayscalePhoto(url)
      if (dataUrl) photoBySku.set(sku, dataUrl)
    })
  )

  const doc = new jsPDF({ unit: 'pt', format: [W, H], orientation: 'landscape' })

  units.forEach((u, i) => {
    if (i > 0) doc.addPage([W, H], 'landscape')

    const photo = photoBySku.get(u.sku)
    const hasPhoto = !!photo

    // Photo (left edge, square, vertically centered)
    if (hasPhoto) {
      const y = (H - PHOTO_SIZE) / 2
      doc.addImage(photo, 'PNG', PAD, y, PHOTO_SIZE, PHOTO_SIZE)
    }

    // Right column layout
    const colX = hasPhoto ? PAD + PHOTO_SIZE + 4 : PAD
    const colW = W - colX - PAD

    // Title — bold, shrinks 8 → 5.5, then ellipsis if still over
    doc.setFont('helvetica', 'bold')
    let title = (u.title || u.brand || '').trim() || 'Untitled'
    const titleSize = fitFontSize(doc, title, 8, 5.5, colW)
    doc.setFontSize(titleSize)
    if (doc.getTextWidth(title) > colW) {
      while (title.length > 4 && doc.getTextWidth(title + '…') > colW) title = title.slice(0, -1)
      title += '…'
    }
    doc.text(title, colX + colW / 2, 9, { align: 'center', baseline: 'middle' })

    // Sub line — size · color · condition · MSRP (bold, shrinks if long)
    const sub = buildSubLine(u)
    if (sub) {
      doc.setFont('helvetica', 'bold')
      const subSize = fitFontSize(doc, sub, 6.5, 5, colW)
      doc.setFontSize(subSize)
      doc.text(sub, colX + colW / 2, 18, { align: 'center', baseline: 'middle' })
    }

    // Barcode (right column width)
    const barcodeImg = renderBarcodeDataUrl(u.sku)
    const bcH = 26
    const bcY = 22
    doc.addImage(barcodeImg, 'PNG', colX, bcY, colW, bcH)

    // SKU
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.text(`SKU ${u.sku}`, colX + colW / 2, H - 6, { align: 'center', baseline: 'middle' })
  })

  doc.save(filename)
}
