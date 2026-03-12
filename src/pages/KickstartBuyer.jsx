import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { compressPhoto, toBase64 } from '../lib/photos'

export default function KickstartBuyer() {
  const [step, setStep] = useState('name')  // name | receipt | cost | tags | submitting | done
  const [buyers, setBuyers] = useState([])
  const [selectedBuyer, setSelectedBuyer] = useState(null)
  const [tripId, setTripId] = useState(null)
  const [receiptPhoto, setReceiptPhoto] = useState(null)
  const [costPerItem, setCostPerItem] = useState(null)
  const [customPrice, setCustomPrice] = useState('')
  const [tagCount, setTagCount] = useState(0)
  const [saving, setSaving] = useState(false)
  const receiptInputRef = useRef(null)
  const tagInputRef = useRef(null)

  const PRICE_BINS = [5, 10, 15, 20, 30]

  // Load buyers on mount
  useEffect(() => {
    supabase.from('kickstart_buyers').select('*').order('name')
      .then(({ data }) => { if (data) setBuyers(data) })
  }, [])

  // === Step 1: Pick buyer ===
  const handlePickBuyer = async (buyer) => {
    setSelectedBuyer(buyer)
    // Create trip row
    const { data, error } = await supabase.from('kickstart_trips').insert({
      buyer_id: buyer.id,
      buyer_name: buyer.name,
      status: 'scanning'
    }).select('id').single()
    if (error) { alert('Error creating trip: ' + error.message); return }
    setTripId(data.id)
    setStep('receipt')
  }

  // === Step 2: Receipt photo ===
  const handleReceiptCapture = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setSaving(true)
    try {
      const dataUrl = await compressPhoto(file)
      const base64 = toBase64(dataUrl)
      setReceiptPhoto(dataUrl)
      // Save receipt to trip
      await supabase.from('kickstart_trips').update({ receipt_photo: base64 }).eq('id', tripId)
      setStep('tags')
    } catch (err) {
      alert('Error processing receipt: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleSkipReceipt = () => {
    setStep('cost')
  }

  // === Step 2b: Pick cost per item (no receipt) ===
  const handleBinSelect = (price) => {
    setCostPerItem(price)
    setStep('tags')
  }

  const handleCustomConfirm = () => {
    const price = parseFloat(customPrice)
    if (price > 0) {
      setCostPerItem(price)
      setStep('tags')
    }
  }

  // === Step 3: Tag loop ===
  const handleTagCapture = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setSaving(true)
    try {
      const dataUrl = await compressPhoto(file)
      const base64 = toBase64(dataUrl)
      // Insert tag photo row (include cost if set via bin)
      const tagRow = {
        trip_id: tripId,
        photo_data: base64,
        status: 'pending_enrichment'
      }
      if (costPerItem) tagRow.cost = costPerItem
      const { error } = await supabase.from('kickstart_tag_photos').insert(tagRow)
      if (error) throw error
      setTagCount(prev => prev + 1)
      // Update trip tag count
      await supabase.from('kickstart_trips').update({ tag_count: tagCount + 1 }).eq('id', tripId)
    } catch (err) {
      alert('Error saving tag: ' + err.message)
    } finally {
      setSaving(false)
      // Reset input so same file can be re-selected
      if (tagInputRef.current) tagInputRef.current.value = ''
    }
  }

  // === Step 4: Submit ===
  const handleSubmit = async () => {
    setStep('submitting')
    try {
      // Update trip status
      await supabase.from('kickstart_trips').update({
        status: 'submitted',
        tag_count: tagCount
      }).eq('id', tripId)

      // Fire-and-forget: trigger enrichment + receipt parsing
      fetch('/.netlify/functions/enrich-kickstart-v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trip_id: tripId })
      }).catch(() => {})

      if (receiptPhoto) {
        fetch('/.netlify/functions/parse-receipt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trip_id: tripId })
        }).catch(() => {})
      }

      setStep('done')
    } catch (err) {
      alert('Error submitting: ' + err.message)
      setStep('tags')
    }
  }

  // === Step 5: Done ===
  const handleNewTrip = () => {
    setStep('name')
    setSelectedBuyer(null)
    setTripId(null)
    setReceiptPhoto(null)
    setCostPerItem(null)
    setCustomPrice('')
    setTagCount(0)
  }

  // ========== RENDER ==========

  // Done screen
  if (step === 'done') {
    return (
      <div className="h-screen flex items-center justify-center bg-gradient-to-br from-emerald-600 via-teal-500 to-cyan-500">
        <div className="text-center px-6">
          <div className="text-8xl mb-4">✓</div>
          <h2 className="text-4xl font-black text-white mb-2 font-heading">{tagCount} items scanned</h2>
          <p className="text-xl text-white/80 mb-8">Ship it!</p>
          <button
            onClick={handleNewTrip}
            className="border-2 border-pink-500 text-pink-500 hover:bg-pink-500/10 backdrop-blur-lg px-8 py-3 rounded-2xl font-bold text-lg transition-all"
          >
            New Trip
          </button>
        </div>
      </div>
    )
  }

  // Submitting screen
  if (step === 'submitting') {
    return (
      <div className="h-screen flex items-center justify-center bg-navy">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-white text-lg">Submitting...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-navy overflow-hidden">
      <div className="fixed inset-0 bg-gradient-to-br from-cyan-900/20 via-transparent to-pink-900/10 pointer-events-none" />

      {/* Header */}
      <div className="relative z-10 px-3 py-2 flex items-center justify-between border-b border-white/10 shrink-0">
        <div className="text-lg font-bold text-white">Kickstart Buyer</div>
        {selectedBuyer && (
          <div className="bg-cyan-500/20 px-3 py-1 rounded-full border border-cyan-400/30">
            <span className="text-cyan-300 font-bold text-sm">{selectedBuyer.name}</span>
          </div>
        )}
        {step === 'tags' && (
          <div className="bg-cyan-500/20 px-3 py-1 rounded-full border border-cyan-400/30">
            <span className="text-cyan-300 font-bold text-sm">{tagCount} tags</span>
          </div>
        )}
      </div>

      {/* === STEP 1: Pick Name === */}
      {step === 'name' && (
        <div className="relative z-10 flex-1 flex flex-col items-center pt-8 px-4">
          <h2 className="text-2xl font-bold text-white mb-2 font-heading">Who's shopping?</h2>
          <p className="text-slate-400 mb-6">Tap your name</p>
          <div className="w-full max-w-sm space-y-3">
            {buyers.map(buyer => (
              <button
                key={buyer.id}
                onClick={() => handlePickBuyer(buyer)}
                className="w-full py-5 rounded-3xl bg-cyan-600 hover:bg-cyan-500 text-white font-black text-2xl shadow-xl shadow-cyan-500/20 hover:scale-105 active:scale-95 transition-all"
              >
                {buyer.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* === STEP 2: Receipt Photo === */}
      {step === 'receipt' && (
        <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-4">
          <div className="text-center mb-6">
            <h2 className="text-2xl font-bold text-white mb-2 font-heading">Photo the Receipt</h2>
            <p className="text-slate-400">We'll read it to match prices to tags</p>
          </div>

          <input
            ref={receiptInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleReceiptCapture}
            className="hidden"
          />

          <button
            onClick={() => receiptInputRef.current?.click()}
            disabled={saving}
            className="w-24 h-24 rounded-full bg-cyan-600 hover:bg-cyan-500 shadow-2xl shadow-cyan-500/40 flex items-center justify-center hover:scale-105 active:scale-95 transition-all"
          >
            {saving ? (
              <div className="w-8 h-8 border-3 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <iconify-icon icon="mdi:receipt-text" width="40" height="40" style={{ color: 'white' }} />
            )}
          </button>
          <p className="text-slate-500 text-sm mt-3">Tap to photograph receipt</p>

          <button
            onClick={handleSkipReceipt}
            className="mt-6 text-white/40 text-sm underline"
          >
            Skip receipt (enter costs later)
          </button>
        </div>
      )}

      {/* === STEP 2b: Cost Per Item (no receipt) === */}
      {step === 'cost' && (
        <div className="relative z-10 flex-1 flex flex-col items-center pt-6 px-4">
          <h2 className="text-2xl font-bold text-white mb-1 font-heading">Cost Per Item</h2>
          <p className="text-slate-400 mb-5 text-sm">What did we pay per item?</p>

          <div className="w-full max-w-sm grid grid-cols-2 gap-3 mb-3">
            {PRICE_BINS.map(price => (
              <button
                key={price}
                onClick={() => handleBinSelect(price)}
                className="py-5 rounded-3xl bg-cyan-600 hover:bg-cyan-500 text-white font-black text-3xl shadow-xl shadow-cyan-500/20 hover:scale-105 active:scale-95 transition-all"
              >
                ${price}
              </button>
            ))}
          </div>

          {/* Custom price */}
          <div className="w-full max-w-sm">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/50 text-lg">$</span>
                <input
                  type="number"
                  value={customPrice}
                  onChange={e => setCustomPrice(e.target.value)}
                  placeholder="Other amount"
                  className="w-full bg-white/5 border border-white/10 rounded-2xl pl-8 pr-4 py-3 text-white text-xl font-bold placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 focus:ring-4 focus:ring-cyan-500/10 transition-all"
                />
              </div>
              <button
                onClick={handleCustomConfirm}
                disabled={!customPrice || parseFloat(customPrice) <= 0}
                className={`px-6 rounded-xl font-bold text-lg transition-all ${
                  customPrice && parseFloat(customPrice) > 0
                    ? 'bg-cyan-600 hover:bg-cyan-500 text-white'
                    : 'bg-white/5 text-white/30 cursor-not-allowed'
                }`}
              >
                Go
              </button>
            </div>
          </div>
        </div>
      )}

      {/* === STEP 3: Tag Loop === */}
      {step === 'tags' && (
        <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-4">
          <div className="text-center mb-4">
            <h2 className="text-2xl font-bold text-white mb-1 font-heading">Scan Tags</h2>
            <p className="text-slate-400">Photo each hang tag — rapid fire!</p>
          </div>

          {/* Counter */}
          <div className="mb-6 glass-card rounded-3xl px-8 py-4">
            <div className="text-5xl font-black text-cyan-300 text-center">{tagCount}</div>
            <div className="text-xs text-cyan-400/70 text-center uppercase tracking-wider mt-1">tags scanned</div>
          </div>

          <input
            ref={tagInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleTagCapture}
            className="hidden"
          />

          <button
            onClick={() => tagInputRef.current?.click()}
            disabled={saving}
            className="w-28 h-28 rounded-full bg-cyan-600 hover:bg-cyan-500 shadow-2xl shadow-cyan-500/40 flex items-center justify-center hover:scale-105 active:scale-95 transition-all mb-4"
          >
            {saving ? (
              <div className="w-10 h-10 border-4 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <iconify-icon icon="mdi:camera" width="48" height="48" style={{ color: 'white' }} />
            )}
          </button>
          <p className="text-slate-500 text-sm">Tap to snap next tag</p>

          {/* Done button — only show after at least 1 tag */}
          {tagCount > 0 && (
            <button
              onClick={handleSubmit}
              className="mt-8 w-full max-w-xs py-4 rounded-3xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xl shadow-2xl shadow-cyan-500/30 hover:scale-[1.02] active:scale-[0.98] transition-all"
            >
              Done — Submit {tagCount} Tags
            </button>
          )}
        </div>
      )}
    </div>
  )
}
