# Jumpstart Financial Rules

One rulebook for every page that shows money: the Dashboard, the Financials tab, Targets and any export.
The Dashboard is a real-time estimate and the Financials tab is the closed books. Their numbers can differ
while a month is open, but they must never use different definitions. If a rule changes, it changes here first,
then in every page.

## Income statement layout (same order everywhere)

1. **Gross sales**: what buyers paid on Whatnot (statement "total income", the 1099-K basis), plus wholesale
   (QuickBooks Payments deposits) and direct/Venmo sales.
2. **Refunds**: customer refunds (Whatnot order refunds, Venmo refunds) reduce sales.
3. **Whatnot fees**: commission, payment processing, seller-paid shipping (incl. surcharges), show boost/promote.
   Actual statement amounts once the month's statement is in; a calibrated estimate before that.
4. **Revenue net of Whatnot fees** = 1 − 2 − 3.
5. **Cost of goods sold**: inventory cost only (see below).
6. **Gross profit** = 4 − 5.
7. **Labor**: gross wages, employer payroll taxes, payroll processing fees, contract labor (sourcing team, hourly
   Venmo help, consultants), guaranteed payments to partners (Josh, Wesley).
8. **Operating expenses**: everything else, including shipping and freight.
9. **Other income**: interest, card cash-back, bank credits.
10. **Net income**.

## Cost of goods sold and inventory

- A load's cost is **exactly what was paid to the vendor** for the goods (`loads.total_cost`; manifest item
  `cost_freight` scaled so a manifest sums to the vendor payment). If a load is paid in pieces (card + wire,
  deposits), the cost is the sum of the pieces.
- **Never** add freight, freight broker (Widover / "The William System"), forklift (Craneworks), or shipping
  estimates to a load. Those are always operating expenses (Shipping).
- Inventory is valued at that vendor cost: perpetual running average per pool, manifest item cost for manifested
  loads. Damaged/written-off units and shrinkage are cost of goods sold.
- A load that is paid but not yet landed is still inventory (in transit). A load that has landed but isn't paid
  yet is not counted until it's paid (books are cash basis).
- Kickstart: item cost is `cost × 1.08` (sales tax); sourcing-team reimbursements for inventory are inventory.
- Books cost of goods sold = purchases + change in inventory. The Dashboard's item-level cost is the daily
  estimate of the same thing; the gap is shrinkage/write-offs, which the books catch at month end.

## Money in and out that is not profit or loss

- Owner capital contributions → equity. Owner/partner loans → liabilities (Jeremiah note; Josh & Kelsey loan;
  Josh's short-term payroll loans). Loan repayments are never expenses; loan proceeds are never revenue.
- Transfers between our own accounts and credit-card payments are never expenses.

## Timing and data hygiene

- Expenses are recorded when charged/paid (card transaction date), cash basis.
- Bank and card statements are the source of truth. The expense feed is for real-time tracking only:
  pending/pre-authorization amounts are excluded; duplicates across feeds are removed; card refunds/credits count.
- A month is closed in the Financials tab once every account ties to its statement. Closed months are shown
  from the books everywhere, including the Dashboard.
