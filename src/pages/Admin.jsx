import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import AdminDashboard from '../components/AdminDashboard'
import AdminInputs from '../components/AdminInputs'
import AdminInventory from '../components/AdminInventory'
import AdminProfitability from '../components/AdminProfitability'
import AdminScans from '../components/AdminScans'
import AdminDataCheck from '../components/AdminDataCheck'
import AdminAnalytics from '../components/AdminAnalytics'
import AdminTargets from '../components/AdminTargets'
import AdminStatements from '../components/AdminStatements'

const ADMIN_PW_KEY = 'jumpstart_admin_auth'
const ADMIN_PW = 'MichaelGaryScott'

const TABS = [
  { id: 'dashboard', path: '/admin', label: 'Dashboard', icon: 'lucide:layout-dashboard' },
  { id: 'targets', path: '/admin/targets', label: 'Targets', icon: 'lucide:target' },
  { id: 'inputs', path: '/admin/inputs', label: 'Inputs', icon: 'lucide:upload' },
  { id: 'inventory', path: '/admin/inventory', label: 'Inventory', icon: 'lucide:package' },
  { id: 'profitability', path: '/admin/profitability', label: 'Profitability', icon: 'lucide:trending-up' },
  { id: 'analytics', path: '/admin/analytics', label: 'Analytics', icon: 'lucide:bar-chart-3' },
  { id: 'scans', path: '/admin/scans', label: 'Scans', icon: 'lucide:scan-line' },
  { id: 'statements', path: '/admin/statements', label: 'Statements', icon: 'lucide:file-text' },
  { id: 'datacheck', path: '/admin/data-check', label: 'Data Check', icon: 'lucide:check-square' },
]

export default function Admin() {
  const navigate = useNavigate()
  const location = useLocation()
  const [authed, setAuthed] = useState(() => localStorage.getItem(ADMIN_PW_KEY) === 'true')
  const [pw, setPw] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState(false)

  const activeTab = TABS.find(t => t.path !== '/admin' && location.pathname.startsWith(t.path))?.id
    || (location.pathname === '/admin' || location.pathname === '/admin/' ? 'dashboard' : 'dashboard')

  function handleLogin(e) {
    e.preventDefault()
    if (pw === ADMIN_PW) {
      localStorage.setItem(ADMIN_PW_KEY, 'true')
      setAuthed(true)
      setError(false)
    } else {
      setError(true)
    }
  }

  if (!authed) {
    return (
      <div className="min-h-screen flex items-center justify-center relative">
        <div className="bg-blob-cyan blob-hide-mobile" />
        <div className="bg-blob-magenta blob-hide-mobile" />
        <form onSubmit={handleLogin} className="glass-card rounded-3xl p-8 w-full max-w-sm relative z-10">
          <div className="flex items-center justify-center mb-6">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-500 to-pink-500 flex items-center justify-center">
              <iconify-icon icon="lucide:lock" width="24" class="text-white"></iconify-icon>
            </div>
          </div>
          <h2 className="text-xl font-bold text-white text-center mb-1 font-heading">Admin Access</h2>
          <p className="text-slate-500 text-sm text-center mb-6">Enter password to continue</p>
          <div className="relative mb-3">
            <input
              type={showPw ? 'text' : 'password'}
              value={pw}
              onChange={e => { setPw(e.target.value); setError(false) }}
              placeholder="Password"
              autoFocus
              className="w-full bg-white/[0.06] border border-white/[0.08] rounded-xl px-4 py-3 pr-11 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50"
            />
            <button
              type="button"
              onClick={() => setShowPw(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
            >
              <iconify-icon icon={showPw ? 'lucide:eye-off' : 'lucide:eye'} width="18"></iconify-icon>
            </button>
          </div>
          {error && <p className="text-red-400 text-sm mb-3 text-center">Wrong password</p>}
          <button
            type="submit"
            className="w-full py-3 rounded-xl bg-cyan-600 text-white font-semibold hover:bg-cyan-500 transition-all shadow-lg shadow-cyan-600/20"
          >
            Enter
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex relative">
      {/* Background blobs — desktop only */}
      <div className="bg-blob-cyan blob-hide-mobile" />
      <div className="bg-blob-magenta blob-hide-mobile" />

      {/* Sidebar - Collapsible on hover */}
      <nav className="group w-16 hover:w-56 flex-shrink-0 border-r border-white/[0.06] backdrop-blur-xl bg-navy/80 transition-all duration-300 ease-in-out overflow-hidden relative z-10">
        {/* Header */}
        <div className="p-4 h-16 flex items-center">
          <button
            onClick={() => navigate('/')}
            className="text-slate-400 hover:text-cyan-400 transition-colors flex items-center gap-2"
          >
            <iconify-icon icon="lucide:chevron-left" class="text-lg flex-shrink-0"></iconify-icon>
            <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 text-sm whitespace-nowrap">
              Home
            </span>
          </button>
        </div>

        {/* Admin Title */}
        <div className="px-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-cyan-500 to-pink-500 flex items-center justify-center flex-shrink-0">
              <span className="text-white text-sm font-bold">J</span>
            </div>
            <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">
              <div className="text-sm font-bold font-heading text-white">Admin</div>
              <div className="text-[10px] text-slate-500">Management & Reports</div>
            </div>
          </div>
        </div>

        {/* Nav Items */}
        <div className="px-2 space-y-1">
          {TABS.map(tab => {
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => navigate(tab.path)}
                className={`group/item w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl transition-all duration-200
                  ${isActive
                    ? 'bg-cyan-500/15 border border-cyan-500/30 text-white shadow-lg shadow-cyan-500/10 glow-cyan'
                    : 'text-slate-400 hover:text-white hover:bg-white/[0.04] border border-transparent'
                  }`}
              >
                <iconify-icon
                  icon={tab.icon}
                  class={`text-lg flex-shrink-0 transition-colors duration-200 ${isActive ? 'text-cyan-400' : ''}`}
                ></iconify-icon>
                <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 text-sm font-medium whitespace-nowrap">
                  {tab.label}
                </span>
              </button>
            )
          })}
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 p-6 md:p-8 overflow-auto relative z-10">
        {activeTab === 'dashboard' && <AdminDashboard />}
        {activeTab === 'targets' && <AdminTargets />}
        {activeTab === 'inputs' && <AdminInputs />}
        {activeTab === 'inventory' && <AdminInventory />}
        {activeTab === 'profitability' && <AdminProfitability />}
        {activeTab === 'scans' && <AdminScans />}
        {activeTab === 'analytics' && <AdminAnalytics />}
        {activeTab === 'statements' && <AdminStatements />}
        {activeTab === 'datacheck' && <AdminDataCheck />}
      </main>
    </div>
  )
}
