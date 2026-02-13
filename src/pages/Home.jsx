import { useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Home() {
  const navigate = useNavigate()
  const [dbStatus, setDbStatus] = useState('checking')

  useEffect(() => {
    // Quick health check on mount
    supabase.from('loads').select('id', { count: 'exact', head: true })
      .then(({ error }) => {
        setDbStatus(error ? 'error' : 'connected')
      })
      .catch(() => setDbStatus('error'))
  }, [])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-10">
      <h1 className="text-5xl font-bold italic mb-1">Jumpstart</h1>
      <p className="text-slate-400 mb-10">Inventory Management</p>

      <div className="w-full max-w-md space-y-5">
        {/* Sorting */}
        <button
          onClick={() => navigate('/sorting')}
          className="w-full rounded-2xl p-6 text-left
            bg-gradient-to-r from-purple-500 to-indigo-500
            hover:from-purple-400 hover:to-indigo-400
            active:scale-[0.98] transition-all"
        >
          <div className="text-3xl mb-2">📦</div>
          <div className="text-xl font-bold">Sorting</div>
          <div className="text-sm text-white/70">Sort incoming inventory</div>
        </button>

        {/* Sales Scanner */}
        <button
          onClick={() => navigate('/sales')}
          className="w-full rounded-2xl p-6 text-left
            bg-gradient-to-r from-teal-500 to-cyan-500
            hover:from-teal-400 hover:to-cyan-400
            active:scale-[0.98] transition-all"
        >
          <div className="text-3xl mb-2">🏷️</div>
          <div className="text-xl font-bold">Sales Scanner</div>
          <div className="text-sm text-white/70">Scan items for packing</div>
        </button>

        {/* Admin Dashboard */}
        <button
          onClick={() => navigate('/admin')}
          className="w-full rounded-2xl p-6 text-left
            bg-gradient-to-r from-rose-500 to-pink-500
            hover:from-rose-400 hover:to-pink-400
            active:scale-[0.98] transition-all"
        >
          <div className="text-3xl mb-2">📊</div>
          <div className="text-xl font-bold">Admin Dashboard</div>
          <div className="text-sm text-white/70">Uploads, P&L, reporting</div>
        </button>
      </div>

      {/* DB connection indicator */}
      <div className="mt-8 flex items-center gap-2 text-xs text-slate-500">
        <div className={`w-2 h-2 rounded-full ${
          dbStatus === 'connected' ? 'bg-green-500' :
          dbStatus === 'error' ? 'bg-red-500' :
          'bg-yellow-500 animate-pulse'
        }`} />
        {dbStatus === 'connected' ? 'Database connected' :
         dbStatus === 'error' ? 'Database error — check config' :
         'Connecting...'}
      </div>
    </div>
  )
}
