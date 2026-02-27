-- Create a view of kickstart_intake with Central time timestamps
-- This makes the Supabase web interface much easier to read

CREATE OR REPLACE VIEW kickstart_intake_central AS
SELECT
  id,
  upc,
  style_number,
  brand,
  description,
  color,
  size,
  msrp,
  cost,
  photo_data,
  status,
  -- Convert timestamps from UTC to Central time with MM-DD-YYYY 12-hour format
  TO_CHAR(created_at AT TIME ZONE 'America/Chicago', 'MM-DD-YYYY HH12:MI:SS AM') AS created_at,
  TO_CHAR(enriched_at AT TIME ZONE 'America/Chicago', 'MM-DD-YYYY HH12:MI:SS AM') AS enriched_at
FROM kickstart_intake
ORDER BY created_at DESC;

-- Enable RLS (Row Level Security) for the view
ALTER VIEW kickstart_intake_central SET (security_invoker = true);

-- Add a comment explaining the view
COMMENT ON VIEW kickstart_intake_central IS 'Shows kickstart_intake data with timestamps converted to Central time (America/Chicago) for easier reading in Supabase web interface';
