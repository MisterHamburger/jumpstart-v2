import { Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import SortingSelect from './pages/SortingSelect'
import GeneralSort from './pages/GeneralSort'
import BundleSort from './pages/BundleSort'
import SalesSetup from './pages/SalesSetup'
import SalesScanner from './pages/SalesScanner'
import Admin from './pages/Admin'
import ItemLookup from './pages/ItemLookup'

export default function App() {
  return (
    <div className="min-h-screen bg-navy text-white font-body">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/sorting" element={<SortingSelect />} />
        <Route path="/sorting/general" element={<GeneralSort />} />
        <Route path="/sorting/bundle" element={<BundleSort />} />
        <Route path="/sales" element={<SalesSetup />} />
        <Route path="/sales/:showId" element={<SalesScanner />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/admin/targets" element={<Admin />} />
        <Route path="/admin/inputs" element={<Admin />} />
        <Route path="/admin/inventory" element={<Admin />} />
        <Route path="/admin/profitability" element={<Admin />} />
        <Route path="/admin/scans" element={<Admin />} />
        <Route path="/admin/analytics" element={<Admin />} />
        <Route path="/admin/statements" element={<Admin />} />
        <Route path="/admin/data-check" element={<Admin />} />
        <Route path="/lookup" element={<ItemLookup />} />
      </Routes>
    </div>
  )
}
