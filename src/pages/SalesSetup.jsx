import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function SalesSetup() {
  const navigate = useNavigate()
  const [shows, setShows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadShows()
  }, [])

  async function loadShows() {
    const { data, error } = await supabase
      .from('shows')
      .select('*')
      .in('status', ['pending', 'scanning'])
      .order('date', { ascending: false })

    if (data) setShows(data)
    setLoading(false)
  }

  function selectShow(show) {
    navigate(`/sales/${show.id}`)
  }

  return (
    <div className="min-h-screen px-6 py-8">
      <button onClick={() => navigate('/')} className="text-slate-400 hover:text-white mb-6 block">
        ← Home
      </button>

      <h2 className="text-2xl font-bold mb-2">Sales Scanner</h2>
      <p className="text-slate-400 mb-6">Select a show to start scanning</p>

      {loading ? (
        <div className="text-center text-slate-400 py-12">Loading shows...</div>
      ) : shows.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-slate-400 mb-4">No active shows found.</p>
          <p className="text-slate-500 text-sm">Upload a Whatnot CSV in the Admin Dashboard first.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {shows.map(show => (
            <button
              key={show.id}
              onClick={() => selectShow(show)}
              className="w-full rounded-xl p-4 text-left bg-slate-800 hover:bg-slate-700
                active:scale-[0.98] transition-all border border-slate-700"
            >
              <div className="flex justify-between items-center">
                <div>
                  <div className="font-bold">{show.name}</div>
                  <div className="text-sm text-slate-400">
                    {show.channel} · {show.time_of_day}
                  </div>
                </div>
                <div className="text-right">
                  <div className={`text-lg font-bold ${
                    show.status === 'completed' ? 'text-green-400' : 'text-yellow-400'
                  }`}>
                    {show.scanned_count || 0} / {show.total_items || 0}
                  </div>
                  <div className="text-xs text-slate-500">
                    {(show.total_items || 0) - (show.scanned_count || 0)} remaining
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
