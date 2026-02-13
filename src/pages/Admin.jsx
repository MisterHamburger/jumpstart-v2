import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AdminDashboard from '../components/AdminDashboard'
import AdminInputs from '../components/AdminInputs'
import AdminInventory from '../components/AdminInventory'
import AdminProfitability from '../components/AdminProfitability'

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: '📊' },
  { id: 'inputs', label: 'Inputs', icon: '📤' },
  { id: 'inventory', label: 'Inventory', icon: '📦' },
  { id: 'profitability', label: 'Profitability', icon: '💰' },
]

export default function Admin() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('dashboard')

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      {/* Sidebar / mobile nav */}
      <nav className="md:w-56 bg-slate-800 md:min-h-screen">
        <div className="p-4">
          <button onClick={() => navigate('/')} className="text-slate-400 hover:text-white text-sm mb-4 block">
            ← Home
          </button>
          <h2 className="text-lg font-bold mb-4">Admin</h2>
        </div>
        <div className="flex md:flex-col overflow-x-auto md:overflow-visible px-2 pb-2 md:pb-0 gap-1">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors
                ${activeTab === tab.id
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
                }`}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 p-4 md:p-8 overflow-auto">
        {activeTab === 'dashboard' && <AdminDashboard />}
        {activeTab === 'inputs' && <AdminInputs />}
        {activeTab === 'inventory' && <AdminInventory />}
        {activeTab === 'profitability' && <AdminProfitability />}
      </main>
    </div>
  )
}
