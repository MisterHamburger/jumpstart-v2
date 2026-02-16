import { useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Home() {
  const navigate = useNavigate()
  const [dbStatus, setDbStatus] = useState('checking')
  useEffect(() => {
    supabase.from('loads').select('id', { count: 'exact', head: true })
      .then(({ error }) => { setDbStatus(error ? 'error' : 'connected') })
      .catch(() => setDbStatus('error'))
  }, [])

  const buttons = [
    { label: 'Sort', sub: 'Sort incoming inventory', path: '/sorting/general', gradient: 'from-purple-500/90 via-purple-600/90 to-blue-600/90', shadow: 'shadow-purple-500/30',
      icon: <svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg> },
    { label: 'Sold', sub: 'Scan items for packing', path: '/sales', gradient: 'from-teal-500/90 via-cyan-500/90 to-blue-500/90', shadow: 'shadow-teal-500/30',
      icon: <svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7V4h16v3M9 20h6M12 4v16"/></svg> },
    { label: 'Bundle', sub: 'Sort bundle items into boxes', path: '/sorting/bundle', gradient: 'from-pink-500/90 via-rose-500/90 to-red-500/90', shadow: 'shadow-pink-500/30',
      icon: <svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></svg> },
    { label: 'Admin', sub: 'Uploads, P&L, reporting', path: '/admin', gradient: 'from-slate-600/90 via-slate-700/90 to-slate-800/90', shadow: 'shadow-slate-500/20', small: true,
      icon: <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg> },
  ]

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex flex-col items-center justify-center px-6 py-10">
      <h1 className="text-4xl font-bold tracking-tight text-white mb-1">Jumpstart</h1>
      <p className="text-slate-400 mb-10">Inventory Management</p>
      <div className="w-full max-w-md space-y-4">
        {buttons.map(btn => (
          <button key={btn.label} onClick={() => navigate(btn.path)}
            className={`w-full rounded-3xl ${btn.small ? 'p-4' : 'p-6'} text-left bg-gradient-to-r ${btn.gradient} shadow-xl ${btn.shadow} hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 flex items-center gap-4`}>
            <div className="w-12 h-12 rounded-full bg-white/10 border border-white/20 flex items-center justify-center flex-shrink-0 text-white">{btn.icon}</div>
            <div className="flex-1">
              <div className={`${btn.small ? 'text-lg' : 'text-xl'} font-bold text-white`}>{btn.label}</div>
              <div className="text-sm text-white/70">{btn.sub}</div>
            </div>
            <svg width="20" height="20" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" className="opacity-50"><path d="M9 5l5 5-5 5"/></svg>
          </button>
        ))}
      </div>
      <div className="mt-8 flex items-center gap-2 text-xs text-slate-500">
        <div className={`w-2 h-2 rounded-full ${dbStatus === 'connected' ? 'bg-green-500' : dbStatus === 'error' ? 'bg-red-500' : 'bg-yellow-500 animate-pulse'}`} />
        {dbStatus === 'connected' ? 'Connected' : dbStatus === 'error' ? 'Database error' : 'Connecting...'}
      </div>
    </div>
  )
}
