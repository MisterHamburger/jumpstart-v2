import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const TABS = [
  { key: 'jsSort', label: 'JS Sort', color: 'purple' },
  { key: 'jsBundle', label: 'JS Bundle', color: 'teal' },
  { key: 'jsSold', label: 'JS Sold', color: 'cyan' },
  { key: 'ksIntake', label: 'KS Intake', color: 'fuchsia' },
  { key: 'ksBundle', label: 'KS Bundle', color: 'orange' },
  { key: 'ksSold', label: 'KS Sold', color: 'pink' },
]

export default function AdminScans() {
  const [activeTab, setActiveTab] = useState('jsSort')
  const [scanners, setScanners] = useState({
    jsSort: [], jsBundle: [], jsSold: [],
    ksIntake: [], ksBundle: [], ksSold: []
  })
  const [counts, setCounts] = useState({
    jsSort: 0, jsBundle: 0, jsSold: 0,
    ksIntake: 0, ksBundle: 0, ksSold: 0
  })
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    loadLatestScans()
    const interval = setInterval(() => {
      loadLatestScans()
      setNow(new Date())
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  function todayStart() {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d.toISOString()
  }

  async function loadLatestScans() {
    const today = todayStart()
    const [
      sortRes, jsBundleRes, jsSoldRes, ksIntakeRes, ksBundleRes, ksSoldRes,
      sortCount, jsBundleCount, jsSoldCount, ksIntakeCount, ksBundleCount, ksSoldCount
    ] = await Promise.all([
      // Last 10 scans
      supabase.from('jumpstart_sort_log').select('barcode, sorted_at, zone').order('sorted_at', { ascending: false }).limit(10),
      supabase.from('jumpstart_bundle_scans').select('barcode, scanned_at, box_number').order('scanned_at', { ascending: false }).limit(10),
      supabase.from('jumpstart_sold_scans').select('barcode, scanned_at, listing_number').order('scanned_at', { ascending: false }).limit(10),
      supabase.from('kickstart_intake').select('id, created_at, brand, cost, status').order('created_at', { ascending: false }).limit(10),
      supabase.from('kickstart_bundle_scans').select('barcode, scanned_at, box_number').order('scanned_at', { ascending: false }).limit(10),
      supabase.from('kickstart_sold_scans').select('barcode, scanned_at, listing_number').order('scanned_at', { ascending: false }).limit(10),
      // Today counts
      supabase.from('jumpstart_sort_log').select('id', { count: 'exact', head: true }).gte('sorted_at', today),
      supabase.from('jumpstart_bundle_scans').select('id', { count: 'exact', head: true }).gte('scanned_at', today),
      supabase.from('jumpstart_sold_scans').select('id', { count: 'exact', head: true }).gte('scanned_at', today),
      supabase.from('kickstart_intake').select('id', { count: 'exact', head: true }).gte('created_at', today),
      supabase.from('kickstart_bundle_scans').select('id', { count: 'exact', head: true }).gte('scanned_at', today),
      supabase.from('kickstart_sold_scans').select('id', { count: 'exact', head: true }).gte('scanned_at', today),
    ])

    setScanners({
      jsSort: sortRes.data?.map(s => ({
        time: new Date(s.sorted_at),
        label: s.barcode,
        extra: s.zone ? `Zone ${s.zone}` : null
      })) || [],
      jsBundle: jsBundleRes.data?.map(s => ({
        time: new Date(s.scanned_at),
        label: s.barcode,
        extra: s.box_number ? `Box ${s.box_number}` : null
      })) || [],
      jsSold: jsSoldRes.data?.map(s => ({
        time: new Date(s.scanned_at),
        label: s.barcode,
        extra: s.listing_number ? `#${s.listing_number}` : null
      })) || [],
      ksIntake: ksIntakeRes.data?.map(s => ({
        time: new Date(s.created_at),
        label: s.brand || 'Free People',
        extra: s.cost ? `$${s.cost}` : s.status
      })) || [],
      ksBundle: ksBundleRes.data?.map(s => ({
        time: new Date(s.scanned_at),
        label: s.barcode,
        extra: s.box_number ? `Box ${s.box_number}` : null
      })) || [],
      ksSold: ksSoldRes.data?.map(s => ({
        time: new Date(s.scanned_at),
        label: s.barcode,
        extra: s.listing_number ? `#${s.listing_number}` : null
      })) || []
    })

    setCounts({
      jsSort: sortCount.count || 0,
      jsBundle: jsBundleCount.count || 0,
      jsSold: jsSoldCount.count || 0,
      ksIntake: ksIntakeCount.count || 0,
      ksBundle: ksBundleCount.count || 0,
      ksSold: ksSoldCount.count || 0
    })
  }

  function timeAgo(date) {
    if (!date) return ''
    const seconds = Math.floor((now - date) / 1000)
    if (seconds < 5) return 'Just now'
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h`
    const days = Math.floor(hours / 24)
    return `${days}d`
  }

  function isActive(scans) {
    if (!scans || scans.length === 0) return false
    return Math.floor((now - scans[0].time) / 1000) < 30
  }

  function isRecent(scans) {
    if (!scans || scans.length === 0) return false
    return Math.floor((now - scans[0].time) / 1000) < 300
  }

  const activeScans = scanners[activeTab]
  const active = isActive(activeScans)
  const recent = isRecent(activeScans)

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-extrabold tracking-tight text-white">Live Scanners</h2>
        <span className="text-xs text-slate-500">Auto-refresh 5s</span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 overflow-x-auto pb-1 -mx-1 px-1">
        {TABS.map(tab => {
          const tabActive = isActive(scanners[tab.key])
          const tabRecent = isRecent(scanners[tab.key])
          const selected = activeTab === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`relative flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition-all flex-shrink-0 ${
                selected
                  ? 'bg-white/10 border border-white/20 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                tabActive ? 'bg-emerald-500 animate-pulse' : tabRecent ? 'bg-yellow-500' : 'bg-slate-600'
              }`} />
              {tab.label}
              {counts[tab.key] > 0 && (
                <span className="text-[10px] text-slate-500">{counts[tab.key]}</span>
              )}
            </button>
          )
        })}
      </div>

      {/* Stats bar */}
      <div className="flex items-center gap-4 mb-4 px-1">
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${active ? 'bg-emerald-500 animate-pulse' : recent ? 'bg-yellow-500' : 'bg-slate-600'}`} />
          <span className="text-sm text-slate-400">
            {active ? 'Active now' : recent ? 'Recent activity' : 'Idle'}
          </span>
        </div>
        <div className="text-sm text-slate-500">
          {counts[activeTab]} today
        </div>
        {activeScans.length > 0 && (
          <div className="text-sm text-slate-500">
            Last: {timeAgo(activeScans[0].time)} ago
          </div>
        )}
      </div>

      {/* Scan feed */}
      <div className="rounded-2xl bg-gradient-to-b from-slate-800/60 to-slate-900/40 border border-white/[0.08] overflow-hidden">
        {activeScans.length === 0 ? (
          <div className="text-slate-500 text-sm py-8 text-center">No scans yet</div>
        ) : (
          activeScans.map((scan, i) => (
            <div
              key={i}
              className={`flex items-center justify-between px-4 py-3 border-b border-white/5 last:border-0 ${
                i === 0 && active ? 'bg-emerald-500/10' : ''
              }`}
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <span className="text-xs text-slate-500 w-5 text-right flex-shrink-0">{i + 1}</span>
                <span className="font-mono text-sm text-white truncate">{scan.label}</span>
              </div>
              {scan.extra && (
                <span className="text-xs text-cyan-400 mx-3 flex-shrink-0">{scan.extra}</span>
              )}
              <span className={`text-xs flex-shrink-0 ${i === 0 && active ? 'text-emerald-400' : 'text-slate-500'}`}>
                {timeAgo(scan.time)}
              </span>
            </div>
          ))
        )}
      </div>

      <p className="text-[10px] text-slate-600 text-center mt-3">
        Green = active (30s) · Yellow = recent (5m) · Last 10 scans
      </p>
    </div>
  )
}
