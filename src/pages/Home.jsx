import { useRef } from 'react'
import { useNavigate } from 'react-router-dom'

const actions = [
  {
    title: 'Sort',
    subtitle: 'Sort incoming inventory',
    icon: (
      <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
      </svg>
    ),
    jumpstart: '/sorting/general',
    kickstart: '/kickstart',
  },
  {
    title: 'Sold',
    subtitle: 'Scan items for packing',
    icon: (
      <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
      </svg>
    ),
    jumpstart: { path: '/sales', state: { channel: 'Jumpstart' } },
    kickstart: { path: '/sales', state: { channel: 'Kickstart' } },
  },
  {
    title: 'Bundle',
    subtitle: 'Sort items into boxes',
    icon: (
      <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
      </svg>
    ),
    jumpstart: { path: '/sorting/bundle', state: { channel: 'Jumpstart' } },
    kickstart: { path: '/sorting/bundle', state: { channel: 'Kickstart' } },
  },
]

export default function Home() {
  const navigate = useNavigate()
  const longPressTimer = useRef(null)

  const handleTitleTouchStart = () => {
    longPressTimer.current = setTimeout(() => {
      navigate('/lookup')
    }, 500)
  }

  const handleTitleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }

  const go = (target) => {
    if (typeof target === 'string') {
      navigate(target)
    } else {
      navigate(target.path, { state: target.state })
    }
  }

  return (
    <div className="h-screen flex flex-col items-center justify-start px-4 py-6 bg-[#0a0f1a] overflow-hidden">
      {/* Subtle gradient overlay */}
      <div className="fixed inset-0 bg-gradient-to-br from-purple-900/20 via-transparent to-cyan-900/10 pointer-events-none" />

      <div className="w-full max-w-md flex flex-col items-center relative z-10">
        {/* Logo / Header — long press to open Item Lookup */}
        <div className="mb-6 text-center">
          <h1
            className="text-4xl font-extrabold text-white mb-1 tracking-tight select-none cursor-default"
            onTouchStart={handleTitleTouchStart}
            onTouchEnd={handleTitleTouchEnd}
            onTouchCancel={handleTitleTouchEnd}
            onMouseDown={handleTitleTouchStart}
            onMouseUp={handleTitleTouchEnd}
            onMouseLeave={handleTitleTouchEnd}
          >Jumpstart</h1>
          <p className="text-slate-500 text-sm font-medium">Inventory Management</p>
        </div>

        <div className="w-full space-y-3">
          {actions.map((action) => (
            <div
              key={action.title}
              className="w-full p-4 rounded-2xl relative overflow-hidden
                         bg-slate-800/60 backdrop-blur-xl border border-white/[0.08]"
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-white/10 backdrop-blur flex items-center justify-center shrink-0">
                  {action.icon}
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white tracking-tight">{action.title}</h2>
                  <p className="text-slate-500 text-xs">{action.subtitle}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => go(action.jumpstart)}
                  className="flex-1 py-2.5 rounded-xl font-semibold text-sm
                             bg-gradient-to-r from-cyan-600 to-teal-500 text-white
                             hover:from-cyan-500 hover:to-teal-400
                             active:scale-[0.97] transition-all
                             shadow-md shadow-cyan-500/20"
                >
                  Jumpstart
                </button>
                <button
                  onClick={() => go(action.kickstart)}
                  className="flex-1 py-2.5 rounded-xl font-semibold text-sm
                             bg-gradient-to-r from-fuchsia-600 to-pink-500 text-white
                             hover:from-fuchsia-500 hover:to-pink-400
                             active:scale-[0.97] transition-all
                             shadow-md shadow-fuchsia-500/20"
                >
                  Kickstart
                </button>
              </div>
            </div>
          ))}

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
