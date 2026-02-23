import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function SalesSetup() {
  const navigate = useNavigate()
  const [channel, setChannel] = useState(null)
  const [shows, setShows] = useState([])
  const [selectedShow, setSelectedShow] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [excludedItems, setExcludedItems] = useState(null)
  const [loadingItems, setLoadingItems] = useState(false)

  useEffect(() => {
    if (channel) fetchActiveShows()
  }, [channel])

  const fetchActiveShows = async () => {
    try {
      setLoading(true)
      setSelectedShow(null)
      setExcludedItems(null)
      const { data, error: err } = await supabase
        .from('shows')
        .select('*')
        .in('status', ['active', 'in-progress'])
        .eq('channel', channel)
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
    navigate(`/sales/${selectedShow.id}`, {
      state: {
        showName: selectedShow.showName,
        showData: selectedShow,
        channel: channel,
        excludedItems: excludedItems?.items || [],
        sessionId: `${selectedShow.showName}_${Date.now()}`
      }
    })
  }

  // Channel selection screen
  if (!channel) {
    return (
      <div className="h-screen flex flex-col bg-[#0a0f1a] overflow-hidden">
        <div className="fixed inset-0 bg-gradient-to-br from-cyan-900/20 via-transparent to-teal-900/10 pointer-events-none" />
        
        {/* Header - compact */}
        <div className="relative z-10 px-3 py-2 flex items-center border-b border-white/[0.06] shrink-0">
          <button onClick={() => navigate('/')} className="flex items-center gap-2 bg-white/[0.06] hover:bg-white/[0.1] px-3 py-1.5 rounded-xl border border-white/[0.08] transition-all">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <span className="text-white text-sm font-medium">Home</span>
          </button>
          <h1 className="ml-3 text-lg font-semibold text-white">Sales Scanner</h1>
        </div>
        
        {/* Content - starts near top */}
        <div className="relative z-10 flex-1 flex flex-col items-center pt-8 px-4">
          <h2 className="text-xl font-bold text-white mb-1 tracking-tight">Select Channel</h2>
          <p className="text-slate-500 mb-6 text-sm">Which inventory are you scanning?</p>
          
          <div className="w-full max-w-sm space-y-3">
            <button onClick={() => setChannel('Jumpstart')}
              className="group w-full p-5 rounded-2xl bg-gradient-to-r from-cyan-600 via-teal-500 to-emerald-500 hover:from-cyan-500 hover:via-teal-400 hover:to-emerald-400 text-left transform hover:scale-[1.02] active:scale-[0.98] transition-all shadow-lg shadow-cyan-500/25">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-white/10 backdrop-blur flex items-center justify-center">
                  <span className="text-2xl font-bold text-white">J</span>
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white">Jumpstart</h3>
                  <p className="text-white/60 text-sm">J.Crew / Madewell</p>
                </div>
              </div>
            </button>
            
            <button onClick={() => setChannel('Kickstart')}
              className="group w-full p-5 rounded-2xl bg-gradient-to-r from-fuchsia-600 via-pink-500 to-rose-500 hover:from-fuchsia-500 hover:via-pink-400 hover:to-rose-400 text-left transform hover:scale-[1.02] active:scale-[0.98] transition-all shadow-lg shadow-fuchsia-500/25">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-white/10 backdrop-blur flex items-center justify-center">
                  <span className="text-2xl font-bold text-white">K</span>
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white">Kickstart</h3>
                  <p className="text-white/60 text-sm">Free People</p>
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Show selection screen
  return (
    <div className="h-screen flex flex-col bg-[#0a0f1a] overflow-hidden">
      <div className={`fixed inset-0 bg-gradient-to-br ${channel === 'Kickstart' ? 'from-fuchsia-900/20 via-transparent to-pink-900/10' : 'from-cyan-900/20 via-transparent to-teal-900/10'} pointer-events-none`} />
      
      {/* Header - compact */}
      <div className="relative z-10 px-3 py-2 flex items-center border-b border-white/[0.06] shrink-0">
        <button onClick={() => setChannel(null)} className="flex items-center gap-2 bg-white/[0.06] hover:bg-white/[0.1] px-3 py-1.5 rounded-xl border border-white/[0.08] transition-all">
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          <span className="text-white text-sm font-medium">Back</span>
        </button>
        <h1 className="ml-3 text-lg font-semibold text-white">{channel} Shows</h1>
      </div>
      
      {/* Content */}
      <div className="relative z-10 flex-1 overflow-y-auto pt-4 px-4">
        <div className="w-full max-w-md mx-auto space-y-4">
          {loading && <div className="text-center text-slate-500 py-8">Loading shows...</div>}
          {error && <div className="glass-card p-4 text-pink-300 text-sm border-pink-500/30">{error}</div>}
          
          {!loading && shows.length === 0 && (
            <div className="glass-card p-6 text-center">
              <p className="text-white/80 mb-2">No active {channel} shows</p>
              <p className="text-slate-500 text-sm">Upload a show CSV in Admin → Inputs first</p>
            </div>
          )}
          
          {!loading && shows.length > 0 && (
            <>
              <p className="text-slate-500 text-xs uppercase tracking-wider font-semibold">Select Show</p>
              <div className="space-y-2" style={{ maxHeight: "calc(100vh - 280px)", overflowY: "auto" }}>
                {shows.map((show) => (
                  <button key={show.id} onClick={() => handleSelectShow(show)}
                    className={`w-full p-4 rounded-2xl text-left transition-all ${
                      selectedShow?.id === show.id
                        ? channel === 'Kickstart'
                          ? 'bg-gradient-to-r from-fuchsia-600 to-pink-600 text-white shadow-lg shadow-fuchsia-500/30 border border-fuchsia-400/50'
                          : 'bg-gradient-to-r from-cyan-600 to-teal-600 text-white shadow-lg shadow-cyan-500/30 border border-cyan-400/50'
                        : 'glass-card hover:bg-white/[0.08]'
                    }`}>
                    <div className="font-semibold mb-1">{show.showName}</div>
                    
                    <div className="text-xs opacity-50 mt-2">{show.scanned} / {show.totalItems} items scanned</div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      
      {/* Footer button */}
      {!loading && shows.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-20 p-4 border-t border-white/[0.06] bg-[#0a0f1a]/90 backdrop-blur-xl">
          <div className="w-full max-w-md mx-auto">
            <button onClick={handleStart} disabled={!selectedShow}
              className={`w-full py-4 px-8 rounded-2xl font-bold text-lg transition-all ${
                selectedShow
                  ? channel === 'Kickstart'
                    ? 'bg-gradient-to-r from-fuchsia-600 to-pink-600 text-white shadow-lg shadow-fuchsia-500/30 hover:scale-[1.02] active:scale-[0.98]'
                    : 'bg-gradient-to-r from-cyan-600 to-teal-600 text-white shadow-lg shadow-cyan-500/30 hover:scale-[1.02] active:scale-[0.98]'
                  : 'bg-white/[0.04] text-slate-600 cursor-not-allowed border border-white/[0.06]'
              }`}>
              Start Scanning
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
