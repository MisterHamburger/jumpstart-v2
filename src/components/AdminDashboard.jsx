import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function AdminDashboard() {
  const [channel, setChannel] = useState('all')
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadDashboard()
  }, [channel])

  async function loadDashboard() {
    setLoading(true)

    if (channel === 'all') {
      // Use dashboard_summary view for aggregate
      const { data } = await supabase.from('dashboard_summary').select('*')
      if (data && data.length > 0) {
        // Combine channels
        const combined = data.reduce((acc, row) => ({
          items_sold: (acc.items_sold || 0) + (row.items_sold || 0),
          total_net_revenue: (acc.total_net_revenue || 0) + Number(row.total_net_revenue || 0),
          total_profit: (acc.total_profit || 0) + Number(row.total_profit || 0),
          avg_hammer: 0, // recalc below
          avg_margin: 0,
        }), {})
        combined.avg_profit_per_item = combined.items_sold > 0
          ? (combined.total_profit / combined.items_sold) : 0
        combined.avg_margin = combined.total_net_revenue > 0
          ? ((combined.total_profit / combined.total_net_revenue) * 100) : 0
        setSummary({ combined, byChannel: data })
      } else {
        setSummary(null)
      }
    } else {
      const { data } = await supabase.from('dashboard_summary').select('*').eq('channel', channel)
      if (data && data.length > 0) {
        setSummary({ combined: data[0], byChannel: data })
      } else {
        setSummary(null)
      }
    }

    // Also get inventory counts
    const { count: totalItems } = await supabase.from('jumpstart_manifest').select('id', { count: 'exact', head: true })
    const { count: totalScans } = await supabase.from('jumpstart_sold_scans').select('id', { count: 'exact', head: true })
    const { count: totalShows } = await supabase.from('shows').select('id', { count: 'exact', head: true })

    setSummary(prev => ({ ...prev, totalItems, totalScans, totalShows }))
    setLoading(false)
  }

  const s = summary?.combined

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Dashboard</h2>
        <div className="flex gap-2">
          {['all', 'Jumpstart', 'Kickstart'].map(c => (
            <button key={c} onClick={() => setChannel(c)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
                ${channel === c ? 'bg-slate-700 text-white' : 'text-slate-400 hover:bg-slate-700/50'}`}>
              {c === 'all' ? 'Summary' : c}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-slate-400 py-12 text-center">Loading dashboard...</div>
      ) : !s ? (
        <div className="text-slate-400 py-12 text-center">No data yet. Upload manifests and show CSVs in Inputs.</div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <KPI label="Items Sold" value={s.items_sold?.toLocaleString() || '0'} />
            <KPI label="Net Revenue" value={`$${Number(s.total_net_revenue || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}`} />
            <KPI label="Total Profit" value={`$${Number(s.total_profit || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}`}
              color={Number(s.total_profit) >= 0 ? 'text-green-400' : 'text-red-400'} />
            <KPI label="Avg Margin" value={`${Number(s.avg_margin || 0).toFixed(1)}%`}
              color={Number(s.avg_margin) >= 0 ? 'text-green-400' : 'text-red-400'} />
          </div>

          {/* Inventory overview */}
          <div className="grid grid-cols-3 gap-3 mb-6">
            <KPI label="Total Inventory" value={summary?.totalItems?.toLocaleString() || '0'} />
            <KPI label="Items Scanned" value={summary?.totalScans?.toLocaleString() || '0'} />
            <KPI label="Shows" value={summary?.totalShows?.toLocaleString() || '0'} />
          </div>

          {/* Channel breakdown (when viewing summary) */}
          {channel === 'all' && summary?.byChannel?.length > 0 && (
            <div className="bg-slate-800 rounded-xl p-4">
              <h3 className="font-bold mb-3">By Channel</h3>
              <div className="space-y-3">
                {summary.byChannel.map(ch => (
                  <div key={ch.channel} className="flex justify-between items-center py-2 border-b border-slate-700 last:border-0">
                    <span className="font-medium">{ch.channel}</span>
                    <div className="flex gap-6 text-sm">
                      <span>{ch.items_sold} sold</span>
                      <span className="text-slate-400">${Number(ch.total_net_revenue).toLocaleString()}</span>
                      <span className={Number(ch.total_profit) >= 0 ? 'text-green-400' : 'text-red-400'}>
                        ${Number(ch.total_profit).toLocaleString()}
                      </span>
                      <span className="text-slate-400">{Number(ch.avg_margin).toFixed(1)}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function KPI({ label, value, color = 'text-white' }) {
  return (
    <div className="bg-slate-800 rounded-xl p-4">
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
    </div>
  )
}
