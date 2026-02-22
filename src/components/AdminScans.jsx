import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function AdminScans() {
  const [scanners, setScanners] = useState({
    jumpstartSort: [],
    jumpstartBundle: [],
    jumpstartSales: [],
    kickstartSales: []
  })
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    loadLatestScans()
    // Refresh every 5 seconds
    const interval = setInterval(() => {
      loadLatestScans()
      setNow(new Date())
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  async function loadLatestScans() {
    // Jumpstart Sort - last 10 from sort_log
    const { data: sortData } = await supabase
      .from('jumpstart_sort_log')
      .select('barcode, sorted_at, zone')
      .order('sorted_at', { ascending: false })
      .limit(10)
    
    // Jumpstart Bundle - last 10 from bundle_scans
    const { data: bundleData } = await supabase
      .from('jumpstart_bundle_scans')
      .select('barcode, scanned_at, box_number')
      .order('scanned_at', { ascending: false })
      .limit(10)
    
    // Jumpstart Sales - last 10 from jumpstart_sold_scans
    const { data: jumpstartData } = await supabase
      .from('jumpstart_sold_scans')
      .select('barcode, scanned_at, listing_number')
      .order('scanned_at', { ascending: false })
      .limit(10)
    
    // Kickstart Sales - last 10 from kickstart_sold_scans
    const { data: kickstartData } = await supabase
      .from('kickstart_sold_scans')
      .select('barcode, scanned_at, listing_number')
      .order('scanned_at', { ascending: false })
      .limit(10)
    
    setScanners({
      jumpstartSort: sortData?.map(s => ({
        time: new Date(s.sorted_at),
        barcode: s.barcode,
        extra: s.zone ? `Z${s.zone}` : null
      })) || [],
      jumpstartBundle: bundleData?.map(s => ({
        time: new Date(s.scanned_at),
        barcode: s.barcode,
        extra: s.box_number ? `Box ${s.box_number}` : null
      })) || [],
      jumpstartSales: jumpstartData?.map(s => ({
        time: new Date(s.scanned_at),
        barcode: s.barcode,
        extra: s.listing_number ? `#${s.listing_number}` : null
      })) || [],
      kickstartSales: kickstartData?.map(s => ({
        time: new Date(s.scanned_at),
        barcode: s.barcode,
        extra: s.listing_number ? `#${s.listing_number}` : null
      })) || []
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
    const seconds = Math.floor((now - scans[0].time) / 1000)
    return seconds < 30
  }

  function isRecent(scans) {
    if (!scans || scans.length === 0) return false
    const seconds = Math.floor((now - scans[0].time) / 1000)
    return seconds < 300
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-extrabold tracking-tight text-white">Live Scanners</h2>
        <span className="text-xs text-slate-500">Auto-refreshes every 5s</span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <ScannerFeed
          title="Jumpstart Sort"
          subtitle="Zone sorting"
          scans={scanners.jumpstartSort}
          timeAgo={timeAgo}
          isActive={isActive(scanners.jumpstartSort)}
          isRecent={isRecent(scanners.jumpstartSort)}
          color="purple"
        />
        <ScannerFeed
          title="Jumpstart Bundle"
          subtitle="Bundle packing"
          scans={scanners.jumpstartBundle}
          timeAgo={timeAgo}
          isActive={isActive(scanners.jumpstartBundle)}
          isRecent={isRecent(scanners.jumpstartBundle)}
          color="teal"
        />
        <ScannerFeed
          title="Jumpstart Sales"
          subtitle="J.Crew / Madewell"
          scans={scanners.jumpstartSales}
          timeAgo={timeAgo}
          isActive={isActive(scanners.jumpstartSales)}
          isRecent={isRecent(scanners.jumpstartSales)}
          color="cyan"
        />
        <ScannerFeed
          title="Kickstart Sales"
          subtitle="Free People"
          scans={scanners.kickstartSales}
          timeAgo={timeAgo}
          isActive={isActive(scanners.kickstartSales)}
          isRecent={isRecent(scanners.kickstartSales)}
          color="pink"
        />
      </div>

      <p className="text-xs text-slate-500 text-center">
        Green dot = active (last 30s) · Yellow = recent (last 5m) · Shows last 10 scans per scanner
      </p>
    </div>
  )
}

function ScannerFeed({ title, subtitle, scans, timeAgo, isActive, isRecent, color }) {
  const colors = {
    purple: { border: 'border-purple-500/50', glow: 'shadow-purple-500/20' },
    teal: { border: 'border-teal-500/50', glow: 'shadow-teal-500/20' },
    cyan: { border: 'border-cyan-500/50', glow: 'shadow-cyan-500/20' },
    pink: { border: 'border-pink-500/50', glow: 'shadow-pink-500/20' }
  }
  const c = colors[color]

  return (
    <div className={`relative overflow-hidden rounded-2xl bg-gradient-to-b from-slate-800/60 to-slate-900/40 border ${isActive ? c.border : 'border-white/[0.08]'} p-4 shadow-xl shadow-black/30 ${isActive ? c.glow : ''}`}>
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      
      {/* Header with status dot */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-sm font-semibold text-white">{title}</div>
          <div className="text-xs text-slate-500">{subtitle}</div>
        </div>
        <div className={`w-3 h-3 rounded-full ${isActive ? 'bg-emerald-500 animate-pulse' : isRecent ? 'bg-yellow-500' : 'bg-slate-600'}`} />
      </div>

      {/* Scan feed */}
      <div className="space-y-1 max-h-48 overflow-y-auto">
        {scans.length === 0 ? (
          <div className="text-slate-500 text-sm py-2">No scans yet</div>
        ) : (
          scans.map((scan, i) => (
            <div 
              key={i} 
              className={`flex items-center justify-between text-xs py-1.5 px-2 rounded-lg ${i === 0 && isActive ? 'bg-emerald-500/10' : 'bg-slate-800/30'}`}
            >
              <span className="font-mono text-slate-300 truncate flex-1">{scan.barcode}</span>
              {scan.extra && <span className="text-cyan-400 mx-2">{scan.extra}</span>}
              <span className={`${i === 0 && isActive ? 'text-emerald-400' : 'text-slate-500'} ml-2 whitespace-nowrap`}>
                {timeAgo(scan.time)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
