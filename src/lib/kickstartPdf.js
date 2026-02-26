import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

/**
 * Generate a landscape PDF manifest for a Kickstart haul/trip.
 * @param {Object} trip - { buyer_name, created_at, id }
 * @param {Array} items - [{ description, color, size, style_number, brand, msrp, cost }]
 */
export function generateKickstartManifest(trip, items) {
  if (!items || items.length === 0) {
    alert('No items to generate PDF')
    return
  }

  const totalMsrp = items.reduce((sum, item) => sum + (parseFloat(item.msrp) || 0), 0)
  const totalCost = items.reduce((sum, item) => sum + (parseFloat(item.cost) || 0), 0)
  const tripDate = new Date(trip.created_at).toLocaleDateString()

  const doc = new jsPDF({ orientation: 'landscape' })
  const pageWidth = doc.internal.pageSize.getWidth()

  const tableWidth = 250
  const leftMargin = (pageWidth - tableWidth) / 2

  // Header
  doc.setTextColor(0, 0, 0)
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text(`Kickstart Haul — ${trip.buyer_name} — ${tripDate}`, leftMargin, 12)

  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text(`${items.length} Pieces | Free People / UO / Anthropologie`, leftMargin, 18)

  // Table data
  const tableData = items.map((item, i) => [
    i + 1,
    item.description || 'Unknown',
    item.brand || '',
    item.color || '',
    item.size || '',
    item.style_number || '',
    item.msrp ? `$${parseFloat(item.msrp).toFixed(2)}` : '',
    item.cost ? `$${parseFloat(item.cost).toFixed(2)}` : ''
  ])

  autoTable(doc, {
    startY: 22,
    head: [['#', 'Description', 'Brand', 'Color', 'Size', 'Style', 'MSRP', 'Cost']],
    body: tableData,
    theme: 'grid',
    styles: { fontSize: 7, cellPadding: 1, lineWidth: 0.1 },
    headStyles: {
      fillColor: [157, 23, 77], // fuchsia-900ish
      textColor: 255,
      fontStyle: 'bold',
      fontSize: 7,
      cellPadding: 1.5,
      halign: 'left'
    },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' }, // #
      1: { cellWidth: 80 },  // Description
      2: { cellWidth: 32 },  // Brand
      3: { cellWidth: 30 },  // Color
      4: { cellWidth: 15 },  // Size
      5: { cellWidth: 30 },  // Style
      6: { cellWidth: 22, halign: 'right' },  // MSRP
      7: { cellWidth: 22, halign: 'right' }   // Cost
    },
    margin: { left: leftMargin, right: leftMargin, top: 10, bottom: 10 },
    didParseCell: function (data) {
      if (data.section === 'head' && (data.column.index === 6 || data.column.index === 7)) {
        data.cell.styles.halign = 'right'
      }
    }
  })

  // Totals
  const tableRightEdge = leftMargin + tableWidth
  const finalY = doc.lastAutoTable.finalY + 5

  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(80, 80, 80)
  const avgCost = totalCost / items.length
  const detailText = `${items.length} items  •  $${avgCost.toFixed(2)} avg cost  •  Retail Value: $${totalMsrp.toFixed(2)} MSRP`
  doc.text(detailText, tableRightEdge, finalY, { align: 'right' })

  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(157, 23, 77)
  doc.text(`TOTAL COST: $${totalCost.toFixed(2)}`, tableRightEdge, finalY + 6, { align: 'right' })

  doc.save(`Kickstart_Haul_${trip.buyer_name}_${tripDate.replace(/\//g, '-')}.pdf`)
}
