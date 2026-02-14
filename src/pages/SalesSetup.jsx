import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

function formatShowLabel(show) {
  if (!show.date) return show.name
  const d = new Date(show.date + 'T12:00:00')
  const m = d.getMonth() + 1
  const day = d.getDate()
  const time = show.time_of_day === 'morning' ? 'Morning' : 'Evening'
  return `${m}/${day} ${show.channel} ${time}`
}

export default function SalesSetup() {
  const navigate = useNavigate()
  const [shows, setShows] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  useEffect(() => { loadShows() }, [])
  async function loadShows() {
    const { data } = await supabase.from('shows').select('*').in('status', ['pending', 'scanning']).order('date', { ascending: false })
    if (data) {
      const enriched = await Promise.all(data.map(async (show) => {
        const { count: excludedCount } = await supabase.from('show_items').select('id', { count: 'exact', head: true }).eq('show_id', show.id).in('status', ['failed', 'cancelled'])
        return { ...show, scannable_items: (show.total_items || 0) - (excludedCount || 0) }
      }))
      setShows(enriched)
    }
    setLoading(false)
  }
  function handleStart() { if (!selected) return; navigate(`/sales/${selected.id}`) }
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-4 py-6">
      <div className="backdrop-blur-xl bg-white/5 border-b border-white/10 -mx-4 -mt-6 px-4 py-4 mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/')} className="w-10 h-10 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-white hover:bg-white/20 active:scale-[0.98] transition-all">
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 10H5M5 10l5-5M5 10l5 5"/></svg>
          </button>
          <h1 className="text-lg font-bold tracking-tight text-white">Sales Scanner</h1>
        </div>
      </div>
      <p className="text-slate-400 text-sm mb-4">Select a show to start scanning</p>
      {loading ? (<div className="text-center text-slate-400 py-12">Loading shows...</div>
      ) : shows.length === 0 ? (
        <div className="text-center py-12 backdrop-blur-xl bg-white/5 rounded-2xl border border-white/10 p-6">
          <p className="text-slate-400 mb-2">No active shows found.</p>
          <p className="text-slate-500 text-sm">Upload a Whatnot CSV in Admin first.</p>
        </div>
      ) : (
        <>
          <div className="space-y-3 mb-6">
            {shows.map(show => {
              const isSelected = selected?.id === show.id
              const scanned = show.scanned_count || 0
              const total = show.scannable_items || show.total_items || 0
              const remaining = Math.max(0, total - scanned)
              const pct = total > 0 ? (scanned / total) * 100 : 0
              return (
                <button key={show.id} onClick={() => setSelected(show)} className={`w-full rounded-2xl p-4 text-left transition-all active:scale-[0.98] ${isSelected ? 'bg-gradient-to-r from-teal-500/90 via-cyan-500/90 to-blue-500/90 shadow-xl shadow-teal-500/30 border-2 border-teal-400' : 'backdrop-blur-xl bg-white/5 border border-white/10 hover:bg-white/10'}`}>
                  <div className="flex justify-between items-center">
                    <div>
                      <div className="font-bold text-white">{formatShowLabel(show)}</div>
                      <div className={`text-sm ${isSelected ? 'text-white/70' : 'text-slate-400'}`}>{show.channel} · {show.time_of_day}</div>
                    </div>
                    <div className="text-right">
                      <div className="flex items-center gap-1">
                        <span className={`text-lg font-bold ${isSelected ? 'text-white' : 'text-cyan-300'}`}>{scanned}</span>
                        <span className={isSelected ? 'text-white/50' : 'text-slate-500'}>/</span>
                        <span className={`text-lg font-bold ${isSelected ? 'text-white' : 'text-white'}`}>{total}</span>
                      </div>
                      {remaining > 0 && <div className={`text-xs ${isSelected ? 'text-white/60' : 'text-slate-500'}`}>{remaining} remaining</div>}
                    </div>
                  </div>
                  <div className={`mt-3 h-1.5 rounded-full ${isSelected ? 'bg-white/20' : 'bg-white/5'}`}>
                    <div className={`h-1.5 rounded-full transition-all ${pct >= 100 ? 'bg-gradient-to-r from-emerald-400 to-green-500' : 'bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-500'}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                  </div>
                </button>
              )
            })}
          </div>
          {selected && (
            <button onClick={handleStart} className="w-full py-4 rounded-full font-bold text-lg text-white bg-gradient-to-r from-cyan-500 to-blue-600 shadow-xl shadow-cyan-500/25 hover:shadow-2xl hover:shadow-cyan-500/30 active:scale-[0.98] transition-all">Start Scanning</button>
          )}
        </>
      )}
    </div>
  )
}
