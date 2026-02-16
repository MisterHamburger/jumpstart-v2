import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Home() {
  const navigate = useNavigate()
  const [dbStatus, setDbStatus] = useState('checking')

  useEffect(() => {
    supabase.from('loads').select('id', { count: 'exact', head: true })
      .then(({ error }) => { setDbStatus(error ? 'error' : 'connected') })
      .catch(() => setDbStatus('error'))
  }, [])

  return (
    <div className="h-screen max-h-screen overflow-hidden flex flex-col items-center justify-center p-4 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <div className="w-full max-w-md flex flex-col items-center justify-center flex-shrink-0">
        <div className="mb-6 text-center">
          <h1 className="text-4xl font-bold text-white mb-2 tracking-tight">Jumpstart</h1>
          <p className="text-slate-400">Inventory Management</p>
        </div>

        <div className="w-full space-y-3">
          {/* Sort Button */}
          <button
            onClick={() => navigate('/sorting/general')}
            className="group w-full p-6 rounded-3xl bg-gradient-to-br from-purple-500/90 via-purple-600/90 to-blue-600/90 
                       backdrop-blur-xl border border-white/10
                       hover:from-purple-600/90 hover:via-purple-700/90 hover:to-blue-700/90
                       transform hover:scale-[1.02] transition-all duration-200
                       shadow-2xl shadow-purple-500/30"
          >
            <div className="flex items-center justify-between">
              <div className="text-left">
                <svg className="w-12 h-12 mb-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
                <h2 className="text-2xl font-bold text-white mb-1 tracking-tight">Sort</h2>
                <p className="text-purple-100/80 text-sm">Sort incoming inventory</p>
              </div>
              <div className="text-white/80 text-3xl">→</div>
            </div>
          </button>

          {/* Sold Button */}
          <button
            onClick={() => navigate('/sales')}
            className="group w-full p-6 rounded-3xl bg-gradient-to-br from-teal-500/90 via-cyan-500/90 to-blue-500/90
                       backdrop-blur-xl border border-white/10
                       hover:from-teal-600/90 hover:via-cyan-600/90 hover:to-blue-600/90
                       transform hover:scale-[1.02] transition-all duration-200
                       shadow-2xl shadow-teal-500/30"
          >
            <div className="flex items-center justify-between">
              <div className="text-left">
                <svg className="w-12 h-12 mb-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                </svg>
                <h2 className="text-2xl font-bold text-white mb-1 tracking-tight">Sold</h2>
                <p className="text-teal-100/80 text-sm">Scan items for packing</p>
              </div>
              <div className="text-white/80 text-3xl">→</div>
            </div>
          </button>

          {/* Bundle Button */}
          <button
            onClick={() => navigate('/sorting/bundle')}
            className="group w-full p-6 rounded-3xl bg-gradient-to-br from-pink-500/90 via-rose-500/90 to-red-500/90
                       backdrop-blur-xl border border-white/10
                       hover:from-pink-600/90 hover:via-rose-600/90 hover:to-red-600/90
                       transform hover:scale-[1.02] transition-all duration-200
                       shadow-2xl shadow-pink-500/30"
          >
            <div className="flex items-center justify-between">
              <div className="text-left">
                <svg className="w-12 h-12 mb-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
                <h2 className="text-2xl font-bold text-white mb-1 tracking-tight">Bundle</h2>
                <p className="text-pink-100/80 text-sm">Sort bundle items into boxes</p>
              </div>
              <div className="text-white/80 text-3xl">→</div>
            </div>
          </button>

          {/* Admin Button */}
          <button
            onClick={() => navigate('/admin')}
            className="group w-full p-4 rounded-3xl bg-gradient-to-br from-slate-600/90 via-slate-700/90 to-slate-800/90
                       backdrop-blur-xl border border-white/10
                       hover:from-slate-500/90 hover:via-slate-600/90 hover:to-slate-700/90
                       transform hover:scale-[1.02] transition-all duration-200
                       shadow-2xl shadow-slate-500/20"
          >
            <div className="flex items-center justify-between">
              <div className="text-left">
                <svg className="w-8 h-8 mb-1 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                <h2 className="text-lg font-bold text-white tracking-tight">Admin</h2>
                <p className="text-slate-300/80 text-xs">Uploads, P&L, reporting</p>
              </div>
              <div className="text-white/80 text-2xl">→</div>
            </div>
          </button>
        </div>

        {/* DB status */}
        <div className="mt-6 flex items-center gap-2 text-xs text-slate-500">
          <div className={`w-2 h-2 rounded-full ${dbStatus === 'connected' ? 'bg-green-500' : dbStatus === 'error' ? 'bg-red-500' : 'bg-yellow-500 animate-pulse'}`} />
          {dbStatus === 'connected' ? 'Connected' : dbStatus === 'error' ? 'Database error' : 'Connecting...'}
        </div>
      </div>
    </div>
  )
}
