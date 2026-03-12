import { useRef } from 'react'
import { useNavigate } from 'react-router-dom'

const actions = [
  {
    title: 'Sort',
    subtitle: 'Sort incoming inventory',
    icon: 'lucide:package',
    jumpstart: '/sorting/general',
    kickstart: '/kickstart',
  },
  {
    title: 'Sold',
    subtitle: 'Scan items for packing',
    icon: 'lucide:tag',
    jumpstart: { path: '/sales', state: { channel: 'Jumpstart' } },
    kickstart: { path: '/sales', state: { channel: 'Kickstart' } },
  },
  {
    title: 'Bundle',
    subtitle: 'Sort items into boxes',
    icon: 'lucide:boxes',
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
    <div className="h-screen flex flex-col items-center justify-start px-4 py-6 bg-navy overflow-hidden relative">
      {/* Background blobs */}
      <div className="bg-blob-cyan" />
      <div className="bg-blob-magenta" />

      <div className="w-full max-w-md flex flex-col items-center relative z-10">
        {/* Logo / Header — long press to open Item Lookup */}
        <div className="mb-8 text-center">
          <h1
            className="text-5xl font-extrabold font-heading text-white mb-1 tracking-tight select-none cursor-default"
            onTouchStart={handleTitleTouchStart}
            onTouchEnd={handleTitleTouchEnd}
            onTouchCancel={handleTitleTouchEnd}
            onMouseDown={handleTitleTouchStart}
            onMouseUp={handleTitleTouchEnd}
            onMouseLeave={handleTitleTouchEnd}
          >Jumpstart</h1>
          <p className="text-slate-500 text-sm font-medium">Inventory Management</p>
        </div>

        <div className="w-full space-y-4">
          {actions.map((action) => (
            <div
              key={action.title}
              className="glass-card w-full p-6 rounded-3xl"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center shrink-0">
                  <iconify-icon icon={action.icon} class="text-xl text-cyan-400"></iconify-icon>
                </div>
                <div>
                  <h2 className="text-lg font-bold font-heading text-white tracking-tight">{action.title}</h2>
                  <p className="text-slate-500 text-xs">{action.subtitle}</p>
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => go(action.jumpstart)}
                  className="flex-1 py-3 rounded-2xl font-bold text-sm
                             bg-cyan-600 text-white
                             hover:bg-cyan-500 hover:scale-105
                             active:scale-95 transition-all
                             shadow-lg shadow-cyan-600/30"
                >
                  Jumpstart
                </button>
                <button
                  onClick={() => go(action.kickstart)}
                  className="flex-1 py-3 rounded-2xl font-bold text-sm
                             bg-pink-500 text-white
                             hover:bg-pink-400 hover:scale-105
                             active:scale-95 transition-all
                             shadow-lg shadow-pink-500/30 glow-magenta"
                >
                  Kickstart
                </button>
              </div>
            </div>
          ))}

          {/* Admin Button */}
          <button
            onClick={() => navigate('/admin')}
            className="glass-card group w-full p-5 rounded-3xl
                       hover:bg-white/10
                       hover:scale-[1.02] active:scale-[0.98] transition-all duration-200"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
                  <iconify-icon icon="lucide:bar-chart-3" class="text-xl text-slate-400"></iconify-icon>
                </div>
                <div className="text-left">
                  <h2 className="text-base font-bold font-heading text-white tracking-tight">Admin</h2>
                  <p className="text-slate-500 text-xs">Uploads, P&L, reporting</p>
                </div>
              </div>
              <iconify-icon icon="lucide:chevron-right" class="text-slate-500 group-hover:text-slate-400 transition-all"></iconify-icon>
            </div>
          </button>
        </div>
      </div>
    </div>
  )
}
