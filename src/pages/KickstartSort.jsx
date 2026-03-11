import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { compressPhoto, toBase64 } from '../lib/photos'

const PRICE_BINS = [5, 10, 15, 20, 25, 29, 30, 35, 40]
const CATEGORIES = [
  'Accessories - Bags', 'Accessories - Belts', 'Accessories - Jewelry',
  'Accessories - Other', 'Accessories - Socks', 'Dresses', 'Hoodies',
  'Jumpsuits', 'Leggings', 'Long Sleeve Tops', 'Outerwear/Jackets',
  'Pants', 'Rompers', 'Shorts', 'Short Sleeve Tops', 'Skirts',
  'Sleeveless Tops'
]
const COLOR_GROUPS = [
  { label: 'Core Colors', colors: ['Blue', 'Dark Blue', 'Green', 'Light Blue', 'Orange', 'Pink', 'Purple', 'Red', 'Yellow'] },
  { label: 'Neutrals', colors: ['Black', 'Brown', 'Burgundy', 'Denim', 'Gray', 'Ivory / Cream', 'Navy', 'Olive', 'Tan', 'White'] },
  { label: 'Patterns', colors: ['Multi-Color', 'Other Pattern', 'Plaid', 'Stripe'] },
]
const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'One Size']
const CONDITIONS = ['NWT', 'NWOT', 'Pre-loved/Nuuly']

export default function KickstartSort() {
  const navigate = useNavigate()
  const [step, setStep] = useState('bin') // bin, brand, details
  const [selectedBin, setSelectedBin] = useState(null)
  const [selectedBrand, setSelectedBrand] = useState(null)
  const [customPrice, setCustomPrice] = useState('')
  const [showCustom, setShowCustom] = useState(false)
  const [itemPhoto, setItemPhoto] = useState(null)
  const [description, setDescription] = useState('')
  const [condition, setCondition] = useState('')
  const [color, setColor] = useState('')
  const [size, setSize] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [saving, setSaving] = useState(false)
  const [showSaved, setShowSaved] = useState(false)
  const [sessionCount, setSessionCount] = useState(0)
  const [notes, setNotes] = useState('')
  const [msrp, setMsrp] = useState('')
  const itemPhotoRef = useRef(null)

  const getCost = () => {
    if (showCustom) return parseFloat(customPrice) || 0
    return selectedBin || 0
  }

  // --- Bin step ---
  const handleBinSelect = (price) => {
    setSelectedBin(price)
    setShowCustom(false)
    setStep('brand')
  }

  const handleCustomSelect = () => {
    setShowCustom(true)
    setSelectedBin(null)
  }

  const handleCustomConfirm = () => {
    if (parseFloat(customPrice) > 0) {
      setStep('brand')
    }
  }

  // --- Brand step ---
  const handleBrandSelect = (brand) => {
    setSelectedBrand(brand)
    setStep('details')
  }

  // --- Photo capture ---
  const handleItemPhotoCapture = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    try {
      const dataUrl = await compressPhoto(file, { maxWidth: 800, quality: 0.5 })
      setItemPhoto(dataUrl)
    } catch (err) {
      console.error('Photo compression error:', err)
      alert('Failed to process photo')
    }
  }

  // --- Save ---
  const handleSave = async () => {
    setSaving(true)
    try {
      const cost = getCost()
      const itemPhotoData = itemPhoto ? toBase64(itemPhoto) : null

      const baseRow = {
        cost,
        brand: selectedBrand,
        description: description || null,
        color: color || null,
        size: size || null,
        condition: condition || null,
        msrp: msrp ? parseFloat(msrp) : null,
        item_photo_data: itemPhotoData,
        notes: notes || null,
        status: 'enriched',
      }

      const firstRow = { ...baseRow }
      const rows = [firstRow]
      if (quantity > 1) {
        const lightRow = { ...baseRow, item_photo_data: null }
        for (let i = 1; i < quantity; i++) rows.push({ ...lightRow })
      }

      let { error } = await supabase.from('kickstart_intake').insert(rows)
      if (error) throw error

      setSessionCount(prev => prev + quantity)

      setShowSaved(true)
      setTimeout(() => {
        setShowSaved(false)
        resetForNext()
      }, 400)
    } catch (err) {
      console.error('Save error:', err)
      alert('Failed to save: ' + (err?.message || err?.code || JSON.stringify(err)))
    } finally {
      setSaving(false)
    }
  }

  // Keep bin, brand, condition, category — reset item-specific fields
  const resetForNext = () => {
    setColor('')
    setSize('')
    setQuantity(1)
    setNotes('')
    setMsrp('')
    setItemPhoto(null)
    if (itemPhotoRef.current) itemPhotoRef.current.value = ''
  }

  // --- Back navigation ---
  const handleBack = () => {
    switch (step) {
      case 'bin': navigate('/'); break
      case 'brand': setStep('bin'); break
      case 'details':
        setDescription('')
        setCondition('')
        setColor('')
        setSize('')
        setQuantity(1)
        setNotes('')
        setMsrp('')
        setItemPhoto(null)
        if (itemPhotoRef.current) itemPhotoRef.current.value = ''
        setStep('brand')
        break
    }
  }

  const backLabel = () => {
    switch (step) {
      case 'bin': return '← Home'
      case 'brand': return '← Bin'
      case 'details': return '← Brand'
      default: return '← Back'
    }
  }

  // === SAVED FLASH ===
  if (showSaved) {
    return (
      <div className="h-screen flex items-center justify-center bg-gradient-to-br from-cyan-600 via-teal-500 to-emerald-500">
        <div className="text-center">
          <div className="text-9xl mb-4">✓</div>
          <h2 className="text-5xl font-black text-white mb-2">Saved!</h2>
          <p className="text-xl text-white/80">{quantity > 1 ? `${quantity} items` : '1 item'} added</p>
        </div>
      </div>
    )
  }

  const pastBinBrand = step === 'details'
  const brandAbbrev = { 'Free People': 'FP', 'Urban Outfitters': 'UO', 'Anthropologie': 'Anthro' }

  return (
    <div className="flex flex-col bg-[#0a0f1a]" style={{ height: '100dvh', overflow: 'hidden' }}>
      {/* Subtle gradient overlay */}
      <div className="fixed inset-0 bg-gradient-to-br from-fuchsia-900/20 via-transparent to-pink-900/10 pointer-events-none" />

      {/* Header */}
      <div className="relative z-10 px-3 py-2 flex items-center justify-between border-b border-white/10 shrink-0">
        <button
          onClick={handleBack}
          className="bg-white/10 hover:bg-white/20 backdrop-blur-lg px-3 py-1.5 rounded-full border border-white/20 text-white font-semibold text-sm"
        >
          {backLabel()}
        </button>
        <h1 className="text-lg font-bold text-white">Kickstart</h1>
        <div className="bg-gradient-to-r from-fuchsia-500/20 to-pink-500/20 backdrop-blur-lg px-3 py-1.5 rounded-full border border-fuchsia-400/30">
          <span className="text-fuchsia-300 font-bold text-sm">{sessionCount} today</span>
        </div>
      </div>

      {/* Compact bin+brand bar when past those steps */}
      {pastBinBrand && (
        <div className="relative z-10 mx-3 mt-2 bg-fuchsia-500/20 border border-fuchsia-500/30 rounded-xl px-3 py-2 shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-fuchsia-200 text-sm font-semibold">${getCost()}</span>
            <span className="text-white/30">·</span>
            <span className="text-fuchsia-200 text-sm font-semibold">{brandAbbrev[selectedBrand] || selectedBrand}</span>
          </div>
          <button
            onClick={() => setStep('bin')}
            className="text-fuchsia-400 text-xs font-semibold"
          >
            Change
          </button>
        </div>
      )}

      {/* === STEP 1: BIN SELECTION === */}
      {step === 'bin' && (
        <div className="relative z-10 flex-1 flex flex-col items-center pt-4 px-4 overflow-y-auto">
          <h2 className="text-xl font-bold text-white mb-1 tracking-tight">Select Price Bin</h2>
          <p className="text-slate-400 mb-4 text-sm">What did we pay per item?</p>

          <div className="w-full max-w-sm grid grid-cols-2 gap-3 mb-3">
            {PRICE_BINS.map(price => (
              <button
                key={price}
                onClick={() => handleBinSelect(price)}
                className="py-5 rounded-2xl bg-gradient-to-br from-fuchsia-500/80 to-pink-500/80 border-2 border-fuchsia-400/40 text-white font-black text-3xl shadow-xl shadow-fuchsia-500/20 hover:scale-105 active:scale-95 transition-all"
              >
                ${price}
              </button>
            ))}
          </div>

          {/* Custom price */}
          {!showCustom ? (
            <button
              onClick={handleCustomSelect}
              className="w-full max-w-sm py-3 rounded-2xl bg-white/10 border border-white/20 text-white/70 font-semibold text-lg hover:bg-white/20 transition-all"
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
                    className="w-full bg-white/10 border border-white/20 rounded-xl pl-8 pr-4 py-3 text-white text-xl font-bold placeholder-slate-500 focus:outline-none focus:border-fuchsia-400/50"
                  />
                </div>
                <button
                  onClick={handleCustomConfirm}
                  disabled={!customPrice || parseFloat(customPrice) <= 0}
                  className={`px-6 rounded-xl font-bold text-lg transition-all ${
                    customPrice && parseFloat(customPrice) > 0
                      ? 'bg-gradient-to-r from-fuchsia-500 to-pink-500 text-white'
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

      {/* === STEP 2: BRAND SELECTION === */}
      {step === 'brand' && (
        <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-4">
          <h2 className="text-xl font-bold text-white mb-1 tracking-tight">Select Brand</h2>
          <p className="text-slate-400 mb-6 text-sm">Which brand is this item?</p>

          <div className="w-full max-w-sm flex flex-col gap-3">
            {['Free People', 'Urban Outfitters', 'Anthropologie'].map(brand => (
              <button
                key={brand}
                onClick={() => handleBrandSelect(brand)}
                className="py-5 rounded-2xl bg-gradient-to-br from-fuchsia-500/80 to-pink-500/80 border-2 border-fuchsia-400/40 text-white font-black text-2xl shadow-xl shadow-fuchsia-500/20 hover:scale-105 active:scale-95 transition-all"
              >
                {brand}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* === STEP 3: DETAILS FORM === */}
      {step === 'details' && (
        <div className="relative z-10 flex-1 min-h-0 flex flex-col" style={{ WebkitOverflowScrolling: 'touch' }}>
          <div className="flex-1 overflow-y-auto p-4">
            <div className="flex flex-col items-center">

            {/* Item photo — required */}
            <div className="w-full max-w-sm mb-3">
              <label className="text-slate-400 text-xs uppercase tracking-wider mb-1 block">Item Photo *</label>
              <input
                ref={itemPhotoRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleItemPhotoCapture}
                className="hidden"
              />
              {!itemPhoto ? (
                <button
                  onClick={() => itemPhotoRef.current?.click()}
                  className="w-full flex items-center justify-center gap-2 bg-fuchsia-500/20 border-2 border-dashed border-fuchsia-400/40 rounded-xl px-4 py-6 text-fuchsia-300 font-semibold hover:bg-fuchsia-500/30 transition-all"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Take Item Photo
                </button>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="w-16 h-16 rounded-xl overflow-hidden border border-white/20 shrink-0">
                    <img src={itemPhoto} alt="Item" className="w-full h-full object-cover" />
                  </div>
                  <button
                    onClick={() => { setItemPhoto(null); if (itemPhotoRef.current) itemPhotoRef.current.value = '' }}
                    className="text-fuchsia-400 text-sm font-semibold"
                  >
                    Retake
                  </button>
                </div>
              )}
            </div>

            {/* Condition dropdown */}
            <div className="w-full max-w-sm mb-3">
              <label className="text-slate-400 text-xs uppercase tracking-wider mb-1 block">Condition *</label>
              <select
                value={condition}
                onChange={e => setCondition(e.target.value)}
                className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white text-base font-semibold appearance-none focus:outline-none focus:border-fuchsia-400/50"
              >
                <option value="" className="bg-[#1a1f2e]">Select condition...</option>
                {CONDITIONS.map(c => (
                  <option key={c} value={c} className="bg-[#1a1f2e]">{c}</option>
                ))}
              </select>
            </div>

            {/* Category dropdown */}
            <div className="w-full max-w-sm mb-3">
              <label className="text-slate-400 text-xs uppercase tracking-wider mb-1 block">Category *</label>
              <select
                value={description}
                onChange={e => setDescription(e.target.value)}
                className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white text-base font-semibold appearance-none focus:outline-none focus:border-fuchsia-400/50"
              >
                <option value="" className="bg-[#1a1f2e]">Select category...</option>
                {CATEGORIES.map(cat => (
                  <option key={cat} value={cat} className="bg-[#1a1f2e]">{cat}</option>
                ))}
              </select>
            </div>

            {/* Color dropdown */}
            <div className="w-full max-w-sm mb-3">
              <label className="text-slate-400 text-xs uppercase tracking-wider mb-1 block">Color *</label>
              <select
                value={color}
                onChange={e => setColor(e.target.value)}
                className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white text-base font-semibold appearance-none focus:outline-none focus:border-fuchsia-400/50"
              >
                <option value="" className="bg-[#1a1f2e]">Select color...</option>
                {COLOR_GROUPS.map(group => (
                  <optgroup key={group.label} label={group.label} className="bg-[#1a1f2e] text-slate-400">
                    {group.colors.map(c => (
                      <option key={c} value={c} className="bg-[#1a1f2e] text-white">{c}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            {/* Size buttons */}
            <div className="w-full max-w-sm mb-4">
              <label className="text-slate-400 text-xs uppercase tracking-wider mb-2 block">Size *</label>
              <div className="grid grid-cols-4 gap-2">
                {SIZES.map(s => (
                  <button
                    key={s}
                    onClick={() => setSize(size === s ? '' : s)}
                    className={`py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95 ${
                      size === s
                        ? 'bg-fuchsia-500 text-white'
                        : 'bg-white/10 text-white/60 border border-white/10'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* MSRP */}
            <div className="w-full max-w-sm mb-4">
              <label className="text-slate-400 text-xs uppercase tracking-wider mb-1 block">MSRP *</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/50">$</span>
                <input
                  type="number"
                  value={msrp}
                  onChange={e => setMsrp(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-white/10 border border-white/20 rounded-xl pl-8 pr-4 py-3 text-white text-base font-semibold placeholder-slate-500 focus:outline-none focus:border-fuchsia-400/50"
                />
              </div>
            </div>

            {/* Item Description */}
            <div className="w-full max-w-sm mb-3">
              <label className="text-slate-400 text-xs uppercase tracking-wider mb-1 block">Item Description (optional)</label>
              <input
                type="text"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="e.g. Teddy Peacoat, Cargo Joggers..."
                className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-fuchsia-400/50"
              />
            </div>

            {/* Quantity */}
            <div className="flex items-center gap-5 mb-4">
              <button
                onClick={() => setQuantity(q => Math.max(1, q - 1))}
                className="w-11 h-11 rounded-full bg-white/10 border border-white/20 text-white text-2xl font-bold flex items-center justify-center hover:bg-white/20 active:scale-95 transition-all"
              >
                −
              </button>
              <input
                type="number"
                value={quantity}
                onChange={e => { const v = parseInt(e.target.value, 10); setQuantity(v > 0 ? v : 1) }}
                className="w-20 text-center bg-white/10 border border-white/20 rounded-xl py-2 text-3xl font-black text-white focus:outline-none focus:border-fuchsia-400/50"
              />
              <button
                onClick={() => setQuantity(q => q + 1)}
                className="w-11 h-11 rounded-full bg-gradient-to-br from-fuchsia-500 to-pink-500 text-white text-2xl font-bold flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-lg shadow-fuchsia-500/30"
              >
                +
              </button>
            </div>

            {quantity > 1 && (
              <p className="text-slate-400 text-sm mb-2">
                Total: <span className="text-white font-bold">${(getCost() * quantity).toFixed(2)}</span> for {quantity} items
              </p>
            )}
          </div>
          </div>

          {/* Save button — always visible at bottom */}
          <div className="shrink-0 p-4 pt-2">
            <button
              onClick={handleSave}
              disabled={saving || !itemPhoto || !description || !condition || !color || !size || !msrp}
              className={`w-full py-4 rounded-2xl font-bold text-xl transition-all ${
                saving || !itemPhoto || !description || !condition || !color || !size || !msrp
                  ? 'bg-white/10 text-white/50 cursor-not-allowed'
                  : 'bg-gradient-to-r from-fuchsia-500 to-pink-500 text-white shadow-2xl shadow-fuchsia-500/30 hover:scale-[1.02] active:scale-[0.98]'
              }`}
            >
              {saving ? 'Saving...' : quantity > 1 ? `Save ${quantity} Items` : 'Save Item'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
