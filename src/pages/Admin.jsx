import { useNavigate, useLocation } from 'react-router-dom'
import AdminDashboard from '../components/AdminDashboard'
import AdminInputs from '../components/AdminInputs'
import AdminInventory from '../components/AdminInventory'
import AdminProfitability from '../components/AdminProfitability'
import AdminScans from '../components/AdminScans'
import AdminKickstartHauls from '../components/AdminKickstartHauls'

const TABS = [
  { id: 'dashboard', path: '/admin', label: 'Dashboard', icon: 'dashboard' },
  { id: 'inputs', path: '/admin/inputs', label: 'Inputs', icon: 'inputs' },
  { id: 'inventory', path: '/admin/inventory', label: 'Inventory', icon: 'inventory' },
  { id: 'profitability', path: '/admin/profitability', label: 'Profitability', icon: 'profitability' },
  { id: 'scans', path: '/admin/scans', label: 'Scans', icon: 'scans' },
  { id: 'kickstart', path: '/admin/kickstart', label: 'Kickstart', icon: 'kickstart' },
]

function NavIcon({ type, active }) {
  const baseClass = `w-5 h-5 flex-shrink-0 transition-colors duration-200`
  const strokeColor = active ? 'stroke-cyan-400' : 'stroke-current'
  
  switch (type) {
    case 'dashboard':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
      )
    case 'inputs':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      )
    case 'inventory':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
          <line x1="12" y1="22.08" x2="12" y2="12" />
        </svg>
      )
    case 'profitability':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
          <polyline points="17 6 23 6 23 12" />
        </svg>
      )
    case 'scans':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 8V6a2 2 0 0 1 2-2h2" />
          <path d="M2 16v2a2 2 0 0 0 2 2h2" />
          <path d="M18 4h2a2 2 0 0 1 2 2v2" />
          <path d="M18 20h2a2 2 0 0 0 2-2v-2" />
          <line x1="6" y1="12" x2="18" y2="12" />
        </svg>
      )
    case 'kickstart':
      return (
        <svg className={baseClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
          <line x1="7" y1="7" x2="7.01" y2="7" />
        </svg>
      )
    default:
      return null
  }
}

export default function Admin() {
  const navigate = useNavigate()
  const location = useLocation()

  const activeTab = TABS.find(t => t.path !== '/admin' && location.pathname.startsWith(t.path))?.id
    || (location.pathname === '/admin' || location.pathname === '/admin/' ? 'dashboard' : 'dashboard')

  return (
    <div className="min-h-screen flex">
      {/* Sidebar - Collapsible on hover */}
      <nav className="group w-16 hover:w-56 flex-shrink-0 border-r border-white/[0.06] backdrop-blur-xl bg-slate-900/60 transition-all duration-300 ease-in-out overflow-hidden">
        {/* Header */}
        <div className="p-4 h-16 flex items-center">
          <button 
            onClick={() => navigate('/')} 
            className="text-slate-400 hover:text-white transition-colors flex items-center gap-2"
          >
            <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 text-sm whitespace-nowrap">
              Home
            </span>
          </button>
        </div>

        {/* Admin Title */}
        <div className="px-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-purple-500 to-cyan-500 flex items-center justify-center flex-shrink-0">
              <span className="text-white text-sm font-bold">J</span>
            </div>
            <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">
              <div className="text-sm font-bold text-white">Admin</div>
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
                className={`group/item w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200
                  ${isActive
                    ? 'bg-gradient-to-r from-purple-500/20 to-cyan-500/20 border border-purple-500/30 text-white shadow-lg shadow-purple-500/10'
                    : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                  }`}
              >
                <NavIcon type={tab.icon} active={isActive} />
                <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 text-sm font-medium whitespace-nowrap">
                  {tab.label}
                </span>
              </button>
            )
          })}
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 p-6 md:p-8 overflow-auto">
        {activeTab === 'dashboard' && <AdminDashboard />}
        {activeTab === 'inputs' && <AdminInputs />}
        {activeTab === 'inventory' && <AdminInventory />}
        {activeTab === 'profitability' && <AdminProfitability />}
        {activeTab === 'scans' && <AdminScans />}
        {activeTab === 'kickstart' && <AdminKickstartHauls />}
      </main>
    </div>
  )
}
