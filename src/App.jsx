import { Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import SortingSelect from './pages/SortingSelect'
import GeneralSort from './pages/GeneralSort'
import BundleSort from './pages/BundleSort'
import KickstartSort from './pages/KickstartSort'
import KickstartBuyer from './pages/KickstartBuyer'
import SalesSetup from './pages/SalesSetup'
import SalesScanner from './pages/SalesScanner'
import Admin from './pages/Admin'

export default function App() {
  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/sorting" element={<SortingSelect />} />
        <Route path="/sorting/general" element={<GeneralSort />} />
        <Route path="/kickstart" element={<KickstartSort />} />
            <Route path="/sorting/bundle" element={<BundleSort />} />
        <Route path="/sales" element={<SalesSetup />} />
        <Route path="/sales/:showId" element={<SalesScanner />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/admin/inputs" element={<Admin />} />
        <Route path="/admin/inventory" element={<Admin />} />
        <Route path="/admin/profitability" element={<Admin />} />
        <Route path="/admin/scans" element={<Admin />} />
        <Route path="/admin/kickstart" element={<Admin />} />
        <Route path="/kickstart/buyer" element={<KickstartBuyer />} />
      </Routes>
    </div>
  )
}
