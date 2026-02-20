import { useNavigate, useLocation } from 'react-router-dom'
import AdminDashboard from '../components/AdminDashboard'
import AdminInputs from '../components/AdminInputs'
import AdminInventory from '../components/AdminInventory'
import AdminProfitability from '../components/AdminProfitability'

const TABS = [
  { id: 'dashboard', path: '/admin', label: 'Dashboard', icon: '📊' },
  { id: 'inputs', path: '/admin/inputs', label: 'Inputs', icon: '📤' },
  { id: 'inventory', path: '/admin/inventory', label: 'Inventory', icon: '📦' },
  { id: 'profitability', path: '/admin/profitability', label: 'Profitability', icon: '💰' },
]

export default function Admin() {
  const navigate = useNavigate()
  const location = useLocation()

  const activeTab = TABS.find(t => t.path !== '/admin' && location.pathname.startsWith(t.path))?.id
    || (location.pathname === '/admin' || location.pathname === '/admin/' ? 'dashboard' : 'dashboard')

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-[#0a0f1a]">
      {/* Gradient overlay */}
      <div className="fixed inset-0 bg-gradient-to-br from-purple-900/10 via-transparent to-cyan-900/5 pointer-events-none" />
      
      {/* Sidebar */}
      <nav className="relative z-10 md:w-56 bg-[#080c14] border-b md:border-b-0 md:border-r border-white/[0.06]">
        <div className="p-4">
          <button 
            onClick={() => navigate('/')} 
            className="flex items-center gap-2 text-slate-500 hover:text-white text-sm mb-6 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Home
          </button>
          <h2 className="text-xl font-bold text-white mb-1">Admin</h2>
          <p className="text-slate-600 text-xs">Management & Reports</p>
        </div>
        
        <div className="flex md:flex-col overflow-x-auto md:overflow-visible px-3 pb-3 md:pb-0 gap-1">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => navigate(tab.path)}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium whitespace-nowrap transition-all
                ${activeTab === tab.id
                  ? 'bg-gradient-to-r from-purple-600/20 to-cyan-600/20 text-white border border-purple-500/20'
                  : 'text-slate-500 hover:text-white hover:bg-white/[0.04]'
                }`}
            >
              <span className="text-base">{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </nav>

      {/* Main content */}
      <main className="relative z-10 flex-1 p-4 md:p-6 overflow-auto">
        {activeTab === 'dashboard' && <AdminDashboard />}
        {activeTab === 'inputs' && <AdminInputs />}
        {activeTab === 'inventory' && <AdminInventory />}
        {activeTab === 'profitability' && <AdminProfitability />}
      </main>
    </div>
  )
}
