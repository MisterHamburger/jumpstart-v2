// Monthly report function
// Trigger manually: curl https://jumpstartscanner.netlify.app/.netlify/functions/monthly-report
// Scheduled via monthly-report-scheduled.js

export default async (req) => {
  const SUPABASE_URL = process.env.SUPABASE_URL
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
  const RESEND_API_KEY = process.env.RESEND_API_KEY
  const REPORT_TO_EMAIL = process.env.REPORT_TO_EMAIL

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !RESEND_API_KEY || !REPORT_TO_EMAIL) {
    return new Response(JSON.stringify({ error: 'Missing environment variables' }), { status: 500 })
  }

  try {
    // Calculate previous month's date range
    const now = new Date()
    const year = now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear()
    const month = now.getUTCMonth() === 0 ? 12 : now.getUTCMonth() // 1-indexed
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`
    const endDate = `${year}-${String(month).padStart(2, '0')}-${new Date(year, month, 0).getDate()}`
    const monthName = new Date(year, month - 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })

    // Call dashboard RPC for the month
    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_dashboard_summary`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ date_cutoff: startDate, date_end: endDate }),
    })

    if (!rpcRes.ok) {
      const errText = await rpcRes.text()
      return new Response(JSON.stringify({ error: 'RPC failed', detail: errText }), { status: 500 })
    }

    const raw = await rpcRes.json()
    const js = raw.jumpstart || {}
    const ks = raw.kickstart || {}

    // Get inventory counts per channel
    // Jumpstart: total manifest items
    const jsInvRes = await fetch(`${SUPABASE_URL}/rest/v1/jumpstart_manifest?select=id&limit=0`, {
      method: 'HEAD',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Prefer': 'count=exact',
      },
    })
    const jsInventory = parseInt(jsInvRes.headers.get('content-range')?.split('/')[1] || '0')

    // Kickstart: total intake items
    const ksInvRes = await fetch(`${SUPABASE_URL}/rest/v1/kickstart_intake?select=id&limit=0`, {
      method: 'HEAD',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Prefer': 'count=exact',
      },
    })
    const ksInventory = parseInt(ksInvRes.headers.get('content-range')?.split('/')[1] || '0')

    // Get sold counts per channel for the month (from profitability view)
    const jsSoldRes = await fetch(`${SUPABASE_URL}/rest/v1/profitability?channel=eq.Jumpstart&show_date=gte.${startDate}&show_date=lte.${endDate}&select=scan_id&limit=0`, {
      method: 'HEAD',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Prefer': 'count=exact',
      },
    })
    const jsSold = parseInt(jsSoldRes.headers.get('content-range')?.split('/')[1] || '0')

    const ksSoldRes = await fetch(`${SUPABASE_URL}/rest/v1/profitability?channel=eq.Kickstart&show_date=gte.${startDate}&show_date=lte.${endDate}&select=scan_id&limit=0`, {
      method: 'HEAD',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Prefer': 'count=exact',
      },
    })
    const ksSold = parseInt(ksSoldRes.headers.get('content-range')?.split('/')[1] || '0')

    const fmt = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    const num = (n) => Number(n || 0).toLocaleString()

    const jsRevenue = Number(js.revenue) || 0
    const jsFees = Number(js.fees) || 0
    const jsNetRevenue = Number(js.net_revenue) || 0
    const jsCogs = Number(js.cogs) || 0
    const jsGrossProfit = Number(js.gross_profit) || 0

    const ksRevenue = Number(ks.revenue) || 0
    const ksFees = Number(ks.fees) || 0
    const ksNetRevenue = Number(ks.net_revenue) || 0
    const ksCogs = Number(ks.cogs) || 0
    const ksGrossProfit = Number(ks.gross_profit) || 0

    const totalRevenue = jsRevenue + ksRevenue
    const totalCogs = jsCogs + ksCogs
    const totalGrossProfit = jsGrossProfit + ksGrossProfit
    const totalSold = jsSold + ksSold

    // Build HTML email
    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #1a1a2e; background: #f8f9fa;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; padding: 24px; margin-bottom: 24px;">
    <h1 style="color: white; margin: 0; font-size: 22px;">Jumpstart Monthly Report</h1>
    <p style="color: rgba(255,255,255,0.8); margin: 4px 0 0; font-size: 14px;">${monthName}</p>
  </div>

  <!-- Combined Summary -->
  <div style="background: white; border-radius: 12px; padding: 20px; margin-bottom: 16px; border: 1px solid #e2e8f0;">
    <h2 style="margin: 0 0 16px; font-size: 16px; color: #4a5568;">Combined Summary</h2>
    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
      <tr><td style="padding: 8px 0; color: #718096;">Total Revenue</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${fmt(totalRevenue)}</td></tr>
      <tr><td style="padding: 8px 0; color: #718096;">Total COGS</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${fmt(totalCogs)}</td></tr>
      <tr style="border-top: 2px solid #e2e8f0;"><td style="padding: 12px 0 8px; font-weight: 700;">Gross Profit</td><td style="padding: 12px 0 8px; text-align: right; font-weight: 700; color: ${totalGrossProfit >= 0 ? '#38a169' : '#e53e3e'};">${fmt(totalGrossProfit)}</td></tr>
      <tr><td style="padding: 8px 0; color: #718096;">Items Sold</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${num(totalSold)}</td></tr>
    </table>
  </div>

  <!-- Jumpstart -->
  <div style="background: white; border-radius: 12px; padding: 20px; margin-bottom: 16px; border: 1px solid #e2e8f0;">
    <h2 style="margin: 0 0 16px; font-size: 16px; color: #4a5568;">Jumpstart (J.Crew / Madewell)</h2>
    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
      <tr><td style="padding: 8px 0; color: #718096;">Revenue</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${fmt(jsRevenue)}</td></tr>
      <tr><td style="padding: 8px 0; color: #718096;">Whatnot Fees</td><td style="padding: 8px 0; text-align: right; color: #e53e3e;">${fmt(jsFees)}</td></tr>
      <tr><td style="padding: 8px 0; color: #718096;">Net Revenue</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${fmt(jsNetRevenue)}</td></tr>
      <tr><td style="padding: 8px 0; color: #718096;">COGS</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${fmt(jsCogs)}</td></tr>
      <tr style="border-top: 2px solid #e2e8f0;"><td style="padding: 12px 0 8px; font-weight: 700;">Gross Profit</td><td style="padding: 12px 0 8px; text-align: right; font-weight: 700; color: ${jsGrossProfit >= 0 ? '#38a169' : '#e53e3e'};">${fmt(jsGrossProfit)}</td></tr>
      <tr><td style="padding: 8px 0; color: #718096;">Items Sold This Month</td><td style="padding: 8px 0; text-align: right;">${num(jsSold)}</td></tr>
      <tr><td style="padding: 8px 0; color: #718096;">Total Inventory on Hand</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${num(jsInventory)}</td></tr>
    </table>
  </div>

  <!-- Kickstart -->
  <div style="background: white; border-radius: 12px; padding: 20px; margin-bottom: 16px; border: 1px solid #e2e8f0;">
    <h2 style="margin: 0 0 16px; font-size: 16px; color: #4a5568;">Kickstart (FP / UO / Anthro)</h2>
    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
      <tr><td style="padding: 8px 0; color: #718096;">Revenue</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${fmt(ksRevenue)}</td></tr>
      <tr><td style="padding: 8px 0; color: #718096;">Whatnot Fees</td><td style="padding: 8px 0; text-align: right; color: #e53e3e;">${fmt(ksFees)}</td></tr>
      <tr><td style="padding: 8px 0; color: #718096;">Net Revenue</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${fmt(ksNetRevenue)}</td></tr>
      <tr><td style="padding: 8px 0; color: #718096;">COGS</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${fmt(ksCogs)}</td></tr>
      <tr style="border-top: 2px solid #e2e8f0;"><td style="padding: 12px 0 8px; font-weight: 700;">Gross Profit</td><td style="padding: 12px 0 8px; text-align: right; font-weight: 700; color: ${ksGrossProfit >= 0 ? '#38a169' : '#e53e3e'};">${fmt(ksGrossProfit)}</td></tr>
      <tr><td style="padding: 8px 0; color: #718096;">Items Sold This Month</td><td style="padding: 8px 0; text-align: right;">${num(ksSold)}</td></tr>
      <tr><td style="padding: 8px 0; color: #718096;">Total Inventory on Hand</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${num(ksInventory)}</td></tr>
    </table>
  </div>

  <p style="font-size: 12px; color: #a0aec0; text-align: center; margin-top: 24px;">
    Auto-generated by Jumpstart Scanner on ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
  </p>
</body>
</html>`

    // Send via Resend
    const recipients = REPORT_TO_EMAIL.split(',').map(e => e.trim())
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Jumpstart Reports <onboarding@resend.dev>',
        to: recipients,
        subject: `Jumpstart Monthly Report — ${monthName}`,
        html,
      }),
    })

    if (!emailRes.ok) {
      const errText = await emailRes.text()
      return new Response(JSON.stringify({ error: 'Email send failed', detail: errText }), { status: 500 })
    }

    const emailData = await emailRes.json()
    return new Response(JSON.stringify({
      success: true,
      month: monthName,
      emailId: emailData.id,
      sentTo: recipients,
    }), { status: 200 })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
}
