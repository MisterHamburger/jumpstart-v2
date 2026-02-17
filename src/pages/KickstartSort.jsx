import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const PRICE_BINS = [5, 10, 15, 20, 30]

export default function KickstartSort() {
  const navigate = useNavigate()
  const [step, setStep] = useState('bin') // bin, capture, confirm
  const [selectedBin, setSelectedBin] = useState(null)
  const [customPrice, setCustomPrice] = useState('')
  const [showCustom, setShowCustom] = useState(false)
  const [photo, setPhoto] = useState(null)
  const [quantity, setQuantity] = useState(1)
  const [saving, setSaving] = useState(false)
  const [showSaved, setShowSaved] = useState(false)
  const [itemCount, setItemCount] = useState(0)
  const [sessionCount, setSessionCount] = useState(0)
  const photoInputRef = useRef(null)

  // Fetch total count on mount
  useEffect(() => {
    supabase.from('kickstart_items').select('id', { count: 'exact', head: true })
      .then(({ count }) => setItemCount(count || 0))
  }, [])

  const getCost = () => {
    if (showCustom) return parseFloat(customPrice) || 0
    return selectedBin || 0
  }

  const handleBinSelect = (price) => {
    setSelectedBin(price)
    setShowCustom(false)
    setStep('capture')
  }

  const handleCustomSelect = () => {
    setShowCustom(true)
    setSelectedBin(null)
  }

  const handleCustomConfirm = () => {
    if (parseFloat(customPrice) > 0) {
      setStep('capture')
    }
  }

  const handlePhotoCapture = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onloadend = () => {
      setPhoto(reader.result)
      setStep('confirm')
    }
    reader.readAsDataURL(file)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const cost = getCost()
      const photoData = photo ? photo.split(',')[1] : null

      // Create array of rows (one per quantity)
      const rows = Array.from({ length: quantity }, () => ({
        cost: cost,
        photo_data: photoData,
        status: 'pending_enrichment',
        brand: 'Free People'
      }))

      const { error } = await supabase.from('kickstart_items').insert(rows)
      if (error) throw error

      const newTotal = itemCount + quantity
      setItemCount(newTotal)
      setSessionCount(prev => prev + quantity)

      // Show saved flash
      setShowSaved(true)
      setTimeout(() => {
        setShowSaved(false)
        // Reset for next item but keep the same bin
        setPhoto(null)
        setQuantity(1)
        setStep('capture')
      }, 800)
    } catch (err) {
      console.error('Save error:', err)
      alert('Failed to save: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleChangeBin = () => {
    setPhoto(null)
    setQuantity(1)
    setStep('bin')
  }

  // === SAVED FLASH ===
  if (showSaved) {
    return (
      <div className="h-screen flex items-center justify-center bg-gradient-to-br from-emerald-500 via-green-500 to-teal-500">
        <div className="text-center">
          <div className="text-9xl mb-4">✓</div>
          <h2 className="text-5xl font-black text-white mb-2">Saved!</h2>
          <p className="text-xl text-white/80">{quantity > 1 ? `${quantity} items` : '1 item'} added</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-gradient-to-br from-orange-950 via-slate-900 to-amber-950">
      {/* Header */}
      <div className="p-3 flex items-center justify-between backdrop-blur-xl bg-white/5 border-b border-white/10 shrink-0">
        <button
          onClick={() => step === 'bin' ? navigate('/') : handleChangeBin()}
          className="bg-white/10 hover:bg-white/20 backdrop-blur-lg px-4 py-2 rounded-full border border-white/20 text-white font-semibold text-sm"
        >
          {step === 'bin' ? '← Home' : '← Change Bin'}
        </button>
        <h1 className="text-lg font-bold text-white">Kickstart</h1>
        <div className="bg-gradient-to-r from-amber-500/20 to-orange-500/20 backdrop-blur-lg px-3 py-1.5 rounded-full border border-amber-400/30">
          <span className="text-amber-300 font-bold text-sm">{sessionCount} today</span>
        </div>
      </div>

      {/* Active bin indicator (when not on bin selection) */}
      {step !== 'bin' && (
        <div className="mx-4 mt-3 bg-amber-500/20 border border-amber-500/30 rounded-xl px-4 py-2 flex items-center justify-between">
          <span className="text-amber-200 text-sm font-semibold">Active Bin</span>
          <span className="text-amber-100 font-bold text-lg">${getCost()}</span>
        </div>
      )}

      {/* === STEP 1: BIN SELECTION === */}
      {step === 'bin' && (
        <div className="flex-1 flex flex-col items-center justify-center p-6">
          <h2 className="text-2xl font-bold text-white mb-2 tracking-tight">Select Price Bin</h2>
          <p className="text-slate-400 mb-8">What did we pay per item?</p>

          <div className="w-full max-w-sm grid grid-cols-2 gap-3 mb-4">
            {PRICE_BINS.map(price => (
              <button
                key={price}
                onClick={() => handleBinSelect(price)}
                className="py-6 rounded-2xl bg-gradient-to-br from-amber-500/80 to-orange-600/80 border-2 border-amber-400/40 text-white font-black text-3xl shadow-xl shadow-amber-500/20 hover:scale-105 active:scale-95 transition-all"
              >
                ${price}
              </button>
            ))}
          </div>

          {/* Custom price */}
          {!showCustom ? (
            <button
              onClick={handleCustomSelect}
              className="w-full max-w-sm py-4 rounded-2xl bg-white/10 border border-white/20 text-white/70 font-semibold text-lg hover:bg-white/20 transition-all"
            >
              Other Amount
            </button>
          ) : (
            <div className="w-full max-w-sm">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/50 text-lg">$</span>
                  <input
                    type="number"
                    value={customPrice}
                    onChange={e => setCustomPrice(e.target.value)}
                    placeholder="0.00"
                    autoFocus
                    className="w-full bg-white/10 border border-white/20 rounded-xl pl-8 pr-4 py-4 text-white text-xl font-bold placeholder-slate-500 focus:outline-none focus:border-amber-400/50"
                    style={{ fontSize: '20px' }}
                  />
                </div>
                <button
                  onClick={handleCustomConfirm}
                  disabled={!customPrice || parseFloat(customPrice) <= 0}
                  className={`px-6 rounded-xl font-bold text-lg transition-all ${
                    customPrice && parseFloat(customPrice) > 0
                      ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-white'
                      : 'bg-white/5 text-white/30 cursor-not-allowed'
                  }`}
                >
                  Go
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* === STEP 2: PHOTO CAPTURE === */}
      {step === 'capture' && (
        <div className="flex-1 flex flex-col items-center justify-center p-6">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold text-white mb-3 tracking-tight">Snap the Tag</h2>
            <p className="text-slate-400 text-lg">Photo the brand tag (MSRP + barcode side)</p>
          </div>

          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handlePhotoCapture}
            className="hidden"
          />

          <button
            onClick={() => photoInputRef.current?.click()}
            className="w-28 h-28 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 shadow-2xl shadow-amber-500/40 flex items-center justify-center hover:scale-105 active:scale-95 transition-all"
          >
            <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
          <p className="text-slate-500 text-sm mt-4">Tap to take photo</p>

          {/* Skip photo option */}
          <button
            onClick={() => { setPhoto(null); setStep('confirm') }}
            className="mt-8 text-white/40 text-sm underline"
          >
            Skip photo (enter data later)
          </button>
        </div>
      )}

      {/* === STEP 3: CONFIRM + QUANTITY === */}
      {step === 'confirm' && (
        <div className="flex-1 flex flex-col p-4 overflow-hidden">
          <div className="flex-1 flex flex-col items-center justify-center">
            {/* Photo preview */}
            {photo && (
              <div className="w-40 h-40 rounded-2xl overflow-hidden border-2 border-white/20 mb-4">
                <img src={photo} alt="Tag" className="w-full h-full object-cover" />
              </div>
            )}

            {/* Retake */}
            {photo && (
              <button
                onClick={() => { setPhoto(null); setStep('capture') }}
                className="text-amber-400 text-sm font-semibold mb-6"
              >
                Retake Photo
              </button>
            )}

            {/* Cost display */}
            <div className="bg-white/10 rounded-2xl px-6 py-3 border border-white/10 mb-6">
              <span className="text-slate-400 text-sm">Cost per item: </span>
              <span className="text-white font-bold text-xl">${getCost()}</span>
            </div>

            {/* Quantity selector */}
            <div className="flex items-center gap-6 mb-8">
              <button
                onClick={() => setQuantity(q => Math.max(1, q - 1))}
                className="w-14 h-14 rounded-full bg-white/10 border border-white/20 text-white text-2xl font-bold flex items-center justify-center hover:bg-white/20 active:scale-95 transition-all"
              >
                −
              </button>
              <div className="text-center">
                <div className="text-5xl font-black text-white">{quantity}</div>
                <div className="text-xs text-slate-500 uppercase tracking-wider mt-1">Quantity</div>
              </div>
              <button
                onClick={() => setQuantity(q => q + 1)}
                className="w-14 h-14 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 text-white text-2xl font-bold flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-lg shadow-amber-500/30"
              >
                +
              </button>
            </div>

            {/* Total */}
            {quantity > 1 && (
              <p className="text-slate-400 text-sm mb-4">
                Total: <span className="text-white font-bold">${(getCost() * quantity).toFixed(2)}</span> for {quantity} items
              </p>
            )}
          </div>

          {/* Save button */}
          <button
            onClick={handleSave}
            disabled={saving}
            className={`w-full py-5 rounded-2xl font-bold text-xl transition-all ${
              saving
                ? 'bg-white/10 text-white/50 cursor-wait'
                : 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-2xl shadow-amber-500/30 hover:scale-[1.02] active:scale-[0.98]'
            }`}
          >
            {saving ? 'Saving...' : quantity > 1 ? `Save ${quantity} Items` : 'Save Item'}
          </button>
        </div>
      )}
    </div>
  )
}
