import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Home() {
  const navigate = useNavigate()

  return (
    <div className="h-screen flex flex-col items-center justify-start px-4 py-6 bg-[#0a0f1a] overflow-hidden">
      {/* Subtle gradient overlay */}
      <div className="fixed inset-0 bg-gradient-to-br from-purple-900/20 via-transparent to-cyan-900/10 pointer-events-none" />
      
      <div className="w-full max-w-md flex flex-col items-center relative z-10">
        {/* Logo / Header */}
        <div className="mb-6 text-center">
          <h1 className="text-4xl font-extrabold text-white mb-1 tracking-tight">Jumpstart</h1>
          <p className="text-slate-500 text-sm font-medium">Inventory Management</p>
        </div>

        <div className="w-full space-y-3">
          {/* Sort Button */}
          <button
            onClick={() => navigate('/sorting/general')}
            className="group w-full p-5 rounded-2xl relative overflow-hidden
                       bg-gradient-to-r from-violet-600 via-purple-600 to-fuchsia-600
                       hover:from-violet-500 hover:via-purple-500 hover:to-fuchsia-500
                       transform hover:scale-[1.02] active:scale-[0.98] transition-all duration-200
                       shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-white/10 backdrop-blur flex items-center justify-center">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                </div>
                <div className="text-left">
                  <h2 className="text-xl font-bold text-white tracking-tight">Sort</h2>
                  <p className="text-white/60 text-sm">Sort incoming inventory</p>
                </div>
              </div>
              <svg className="w-5 h-5 text-white/60 group-hover:text-white group-hover:translate-x-1 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>

          {/* Sold Button */}
          <button
            onClick={() => navigate('/sales')}
            className="group w-full p-5 rounded-2xl relative overflow-hidden
                       bg-gradient-to-r from-cyan-600 via-teal-500 to-emerald-500
                       hover:from-cyan-500 hover:via-teal-400 hover:to-emerald-400
                       transform hover:scale-[1.02] active:scale-[0.98] transition-all duration-200
                       shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-white/10 backdrop-blur flex items-center justify-center">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                  </svg>
                </div>
                <div className="text-left">
                  <h2 className="text-xl font-bold text-white tracking-tight">Sold</h2>
                  <p className="text-white/60 text-sm">Scan items for packing</p>
                </div>
              </div>
              <svg className="w-5 h-5 text-white/60 group-hover:text-white group-hover:translate-x-1 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>

          {/* Bundle Button */}
          <button
            onClick={() => navigate('/sorting/bundle')}
            className="group w-full p-5 rounded-2xl relative overflow-hidden
                       bg-gradient-to-r from-pink-600 via-rose-500 to-fuchsia-500
                       hover:from-pink-500 hover:via-rose-400 hover:to-fuchsia-400
                       transform hover:scale-[1.02] active:scale-[0.98] transition-all duration-200
                       shadow-lg shadow-pink-500/25 hover:shadow-pink-500/40"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-white/10 backdrop-blur flex items-center justify-center">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                </div>
                <div className="text-left">
                  <h2 className="text-xl font-bold text-white tracking-tight">Bundle</h2>
                  <p className="text-white/60 text-sm">Sort bundle items into boxes</p>
                </div>
              </div>
              <svg className="w-5 h-5 text-white/60 group-hover:text-white group-hover:translate-x-1 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>

          {/* Kickstart Button */}
          <button
            onClick={() => navigate('/kickstart')}
            className="group w-full p-5 rounded-2xl relative overflow-hidden
                       bg-gradient-to-r from-fuchsia-600 via-pink-500 to-rose-500
                       hover:from-fuchsia-500 hover:via-pink-400 hover:to-rose-400
                       transform hover:scale-[1.02] active:scale-[0.98] transition-all duration-200
                       shadow-lg shadow-fuchsia-500/25 hover:shadow-fuchsia-500/40"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-white/10 backdrop-blur flex items-center justify-center">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <div className="text-left">
                  <h2 className="text-xl font-bold text-white tracking-tight">Kickstart</h2>
                  <p className="text-white/60 text-sm">Photo intake for Free People</p>
                </div>
              </div>
              <svg className="w-5 h-5 text-white/60 group-hover:text-white group-hover:translate-x-1 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>

          {/* Admin Button - more subtle, glass style */}
          <button
            onClick={() => navigate('/admin')}
            className="group w-full p-4 rounded-2xl relative overflow-hidden
                       bg-slate-800/50 backdrop-blur-xl border border-white/[0.08]
                       hover:bg-slate-700/50 hover:border-white/[0.12]
                       transform hover:scale-[1.02] active:scale-[0.98] transition-all duration-200"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center">
                  <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
                <div className="text-left">
                  <h2 className="text-base font-semibold text-white tracking-tight">Admin</h2>
                  <p className="text-slate-500 text-xs">Uploads, P&L, reporting</p>
                </div>
              </div>
              <svg className="w-4 h-4 text-slate-500 group-hover:text-slate-400 group-hover:translate-x-1 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>
        </div>
      </div>
    </div>
  )
}
