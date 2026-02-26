-- Restore get_profitability_summary function
-- This was dropped when profitability view was recreated with CASCADE
-- Run this in the Supabase SQL Editor

CREATE OR REPLACE FUNCTION get_profitability_summary(
  p_channel TEXT DEFAULT NULL,
  p_show_name TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_date_from DATE DEFAULT NULL,
  p_date_to DATE DEFAULT NULL
)
RETURNS TABLE (
  items_sold BIGINT,
  total_profit NUMERIC,
  total_net_revenue NUMERIC,
  avg_hammer NUMERIC,
  avg_net NUMERIC,
  avg_profit_per_item NUMERIC,
  avg_margin NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT AS items_sold,
    ROUND(SUM(p.profit), 2) AS total_profit,
    ROUND(SUM(p.net_payout), 2) AS total_net_revenue,
    ROUND(AVG(p.buyer_paid), 2) AS avg_hammer,
    ROUND(AVG(p.net_payout), 2) AS avg_net,
    ROUND(AVG(p.profit), 2) AS avg_profit_per_item,
    ROUND(AVG(p.margin), 1) AS avg_margin
  FROM profitability p
  WHERE
    (p_channel IS NULL OR p.channel = p_channel)
    AND (p_show_name IS NULL OR p.show_name = p_show_name)
    AND (p_search IS NULL OR (
      p.description ILIKE '%' || p_search || '%'
      OR p.barcode ILIKE '%' || p_search || '%'
      OR p.category ILIKE '%' || p_search || '%'
      OR p.product_name ILIKE '%' || p_search || '%'
    ))
    AND (p_date_from IS NULL OR p.show_date >= p_date_from)
    AND (p_date_to IS NULL OR p.show_date <= p_date_to);
END;
$$ LANGUAGE plpgsql;
