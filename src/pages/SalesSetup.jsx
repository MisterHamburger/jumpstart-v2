import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function SalesSetup() {
  const navigate = useNavigate()
  const [shows, setShows] = useState([])
  const [selectedShow, setSelectedShow] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [excludedItems, setExcludedItems] = useState(null)
  const [loadingItems, setLoadingItems] = useState(false)

  useEffect(() => {
    fetchActiveShows()
  }, [])

  const fetchActiveShows = async () => {
    try {
      setLoading(true)
      const { data, error: err } = await supabase
        .from('shows')
        .select('*')
        .in('status', ['active', 'in-progress'])
        .order('date', { ascending: false })

      if (err) throw new Error(err.message)

      const formatted = (data || []).map(s => ({
        id: s.id,
        showName: s.name,
        date: s.date,
        channel: s.channel,
        totalItems: s.total_items,
        scanned: s.scanned_count || 0,
        status: s.status,
        timeOfDay: s.time_of_day
      }))

      setShows(formatted)
      setError(null)
    } catch (err) {
      console.error('Error fetching shows:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleSelectShow = async (show) => {
    setSelectedShow(show)
    setExcludedItems(null)
    setLoadingItems(true)
    try {
      // Fetch excluded items (failed/cancelled) for this show
      const { data } = await supabase
        .from('show_items')
        .select('*')
        .eq('show_id', show.id)
        .in('status', ['failed', 'cancelled'])

      if (data && data.length > 0) {
        setExcludedItems({
          items: data.map(d => ({
            listingNum: d.listing_number,
            productName: d.product_name,
            status: d.status
          })),
          count: data.length
        })
      }
    } catch (err) {
      console.error('Error fetching excluded items:', err)
    } finally {
      setLoadingItems(false)
    }
  }

  const handleStart = () => {
    if (!selectedShow) return
    // Navigate to scanner with show data
    navigate(`/sales/${selectedShow.id}`, {
      state: {
        showName: selectedShow.showName,
        showData: selectedShow,
        excludedItems: excludedItems?.items || [],
        sessionId: `${selectedShow.showName}_${Date.now()}`
      }
    })
  }

  return (
    <div className="h-screen flex flex-col bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Header */}
      <div className="p-6 flex items-center backdrop-blur-xl bg-slate-900/30 border-b border-white/5 shrink-0">
        <button
          onClick={() => navigate('/')}
          className="text-white/80 hover:text-white text-3xl mr-4 transition-colors"
        >
          ←
        </button>
        <h1 className="text-2xl font-bold text-white tracking-tight">Sales Scanner Setup</h1>
      </div>

      {/* Scrollable show list */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="w-full max-w-md mx-auto space-y-4">
          
          {loading && (
            <div className="text-center text-white/60">
              Loading shows...
            </div>
          )}

          {error && (
            <div className="bg-red-500/20 border border-red-500/50 rounded-2xl p-4 text-red-200 text-sm">
              {error}
            </div>
          )}

          {!loading && shows.length === 0 && (
            <div className="bg-white/10 border border-white/10 rounded-2xl p-6 text-center">
              <p className="text-white/80 mb-4">No active shows available</p>
              <p className="text-white/60 text-sm">Upload a show CSV in the Inputs section first</p>
            </div>
          )}

          {!loading && shows.length > 0 && (
            <>
              <label className="block text-sm font-semibold text-white/90 mb-1 uppercase tracking-wide">
                Select Show
              </label>
              <div className="space-y-3">
                {shows.map((show) => (
                  <button
                    key={show.id}
                    onClick={() => handleSelectShow(show)}
                    className={`w-full p-5 rounded-2xl text-left transition-all ${
                      selectedShow?.id === show.id
                        ? 'bg-teal-500 text-white shadow-xl shadow-teal-500/50 border-2 border-teal-400'
                        : 'bg-white/10 text-white/80 hover:bg-white/20 border border-white/10'
                    }`}
                  >
                    <div className="font-bold text-lg mb-1">{show.showName}</div>
                    <div className="text-sm opacity-80">
                      {show.channel} • {new Date(show.date + 'T12:00:00').toLocaleDateString()}
                    </div>
                    <div className="text-xs opacity-60 mt-2">
                      {show.scanned} / {show.totalItems} items scanned
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Fixed bottom: start button */}
      {!loading && shows.length > 0 && (
        <div className="shrink-0 p-4 border-t border-white/10 bg-slate-900/80 backdrop-blur-xl">
          <div className="w-full max-w-md mx-auto space-y-3">
            <button
              onClick={handleStart}
              disabled={!selectedShow}
              className={`w-full py-5 px-8 rounded-2xl font-bold text-xl transition-all ${
                selectedShow
                  ? 'bg-gradient-to-r from-teal-500 to-cyan-500 text-white shadow-2xl shadow-teal-500/50 hover:shadow-teal-500/70 hover:scale-[1.02]'
                  : 'bg-white/5 text-white/30 cursor-not-allowed border border-white/10'
              }`}
            >
              Start Scanning
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
