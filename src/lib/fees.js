/**
 * Whatnot fee calculation for premium seller tier.
 * Commission: 7.2%
 * Processing: 2.9% + $0.30 per item
 */

export function calculateFees(buyerPaid) {
  const bp = Number(buyerPaid) || 0
  const commission = Math.round(bp * 0.072 * 100) / 100
  const processing = Math.round((bp * 0.029 + 0.30) * 100) / 100
  const totalFees = Math.round((commission + processing) * 100) / 100
  const netPayout = Math.round((bp - totalFees) * 100) / 100
  return { commission, processing, totalFees, netPayout }
}

/**
 * Calculate full profit for a single item.
 */
export function calculateProfit(buyerPaid, costFreight) {
  const { netPayout, totalFees } = calculateFees(buyerPaid)
  const cost = Number(costFreight) || 0
  const profit = Math.round((netPayout - cost) * 100) / 100
  const margin = buyerPaid > 0
    ? Math.round(((profit / buyerPaid) * 100) * 10) / 10
    : 0
  return { netPayout, totalFees, profit, margin }
}
