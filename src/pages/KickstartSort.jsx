import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function KickstartSort() {
  const navigate = useNavigate()
  const [step, setStep] = useState('front') // front, back, processing, review, saved
  const [frontPhoto, setFrontPhoto] = useState(null)
  const [backPhoto, setBackPhoto] = useState(null)
  const [extractedData, setExtractedData] = useState(null)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState(null)
  const [itemCount, setItemCount] = useState(0)
  const [saving, setSaving] = useState(false)
  const frontInputRef = useRef(null)
  const backInputRef = useRef(null)

  // Form fields for editing
  const [formData, setFormData] = useState({
    upc: '',
    brand: 'Free People',
    style_number: '',
    description: '',
    color: '',
    size: '',
    msrp: '',
    cost: ''
  })

  // Fetch count on mount
  useEffect(() => {
    supabase.from('kickstart_items').select('id', { count: 'exact', head: true })
      .then(({ count }) => setItemCount(count || 0))
  }, [])

  const handlePhotoCapture = async (e, side) => {
    const file = e.target.files[0]
    if (!file) return

    // Convert to base64
    const reader = new FileReader()
    reader.onloadend = () => {
      const base64 = reader.result
      if (side === 'front') {
        setFrontPhoto(base64)
        setStep('back')
      } else {
        setBackPhoto(base64)
        processPhotos(frontPhoto, base64)
      }
    }
    reader.readAsDataURL(file)
  }

  const processPhotos = async (front, back) => {
    setStep('processing')
    setProcessing(true)
    setError(null)

    try {
      // Extract base64 data (remove data:image/...;base64, prefix)
      const frontData = front.split(',')[1]
      const backData = back.split(',')[1]
      const frontType = front.split(';')[0].split(':')[1] || 'image/jpeg'
      const backType = back.split(';')[0].split(':')[1] || 'image/jpeg'

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: frontType, data: frontData }
              },
              {
                type: "image",
                source: { type: "base64", media_type: backType, data: backData }
              },
              {
                type: "text",
                text: `These are photos of the front and back hang tags of a clothing item from a reseller called Reclectic. Extract the following information and return ONLY a JSON object with no other text:

{
  "upc": "the UPC/barcode number",
  "brand": "the brand name (e.g. Free People, Free People Movement)",
  "style_number": "the style number (e.g. OB1960599)",
  "description": "the item name/description",
  "color": "the color name",
  "size": "the size (e.g. S, M, L, XL)",
  "msrp": "the retail price as a number only, no dollar sign",
  "cost": "our cost/price paid as a number only, no dollar sign"
}

The front tag (Reclectic side) typically has: our cost, comparable value/MSRP, UPC, savings percentage.
The back tag (original brand side) typically has: brand, style number, color, size, MSRP, barcode.

If you can't read a field, use an empty string. Return ONLY the JSON object.`
              }
            ]
          }]
        })
      })

      const data = await response.json()
      const text = data.content
        .filter(item => item.type === 'text')
        .map(item => item.text)
        .join('')

      // Parse JSON from response
      const cleaned = text.replace(/```json|```/g, '').trim()
      const parsed = JSON.parse(cleaned)

      setExtractedData(parsed)
      setFormData({
        upc: parsed.upc || '',
        brand: parsed.brand || 'Free People',
        style_number: parsed.style_number || '',
        description: parsed.description || '',
        color: parsed.color || '',
        size: parsed.size || '',
        msrp: parsed.msrp || '',
        cost: parsed.cost || ''
      })
      setStep('review')
    } catch (err) {
      console.error('AI extraction error:', err)
      setError('Could not read tags. Please enter details manually.')
      setFormData({
        upc: '', brand: 'Free People', style_number: '',
        description: '', color: '', size: '', msrp: '', cost: ''
      })
      setStep('review')
    } finally {
      setProcessing(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const { error: insertError } = await supabase.from('kickstart_items').insert({
        upc: formData.upc || null,
        brand: formData.brand || 'Free People',
        style_number: formData.style_number || null,
        description: formData.description || null,
        color: formData.color || null,
        size: formData.size || null,
        msrp: formData.msrp ? parseFloat(formData.msrp) : null,
        cost: formData.cost ? parseFloat(formData.cost) : null,
        status: 'intake'
      })

      if (insertError) throw insertError

      setItemCount(prev => prev + 1)
      setStep('saved')

      // Auto-reset after 1.5s
      setTimeout(() => {
        resetForNext()
      }, 1500)
    } catch (err) {
      console.error('Save error:', err)
      setError('Failed to save. Try again.')
    } finally {
      setSaving(false)
    }
  }

  const resetForNext = () => {
    setFrontPhoto(null)
    setBackPhoto(null)
    setExtractedData(null)
    setError(null)
    setFormData({
      upc: '', brand: 'Free People', style_number: '',
      description: '', color: '', size: '', msrp: '', cost: ''
    })
    setStep('front')
  }

  const updateField = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  // === SAVED CONFIRMATION ===
  if (step === 'saved') {
    return (
      <div className="h-screen flex items-center justify-center bg-gradient-to-br from-emerald-500 via-green-500 to-teal-500">
        <div className="text-center">
          <div className="text-9xl mb-6">✓</div>
          <h2 className="text-5xl font-black text-white mb-3">Saved!</h2>
          <p className="text-xl text-white/80">{itemCount} items logged</p>
        </div>
      </div>
    )
  }

  // === PROCESSING ===
  if (step === 'processing') {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-gradient-to-br from-orange-950 via-slate-900 to-amber-950">
        <div className="w-16 h-16 border-4 border-amber-400/30 border-t-amber-400 rounded-full animate-spin mb-6"></div>
        <h2 className="text-2xl font-bold text-white mb-2">Reading Tags...</h2>
        <p className="text-slate-400">AI is extracting item details</p>
      </div>
    )
  }

  // === REVIEW / EDIT FORM ===
  if (step === 'review') {
    return (
      <div className="min-h-screen flex flex-col bg-gradient-to-br from-orange-950 via-slate-900 to-amber-950">
        {/* Header */}
        <div className="p-3 flex items-center justify-between backdrop-blur-xl bg-white/5 border-b border-white/10">
          <button onClick={resetForNext} className="bg-white/10 hover:bg-white/20 backdrop-blur-lg w-10 h-10 rounded-full border border-white/20 text-white font-bold text-lg flex items-center justify-center">
            ←
          </button>
          <h1 className="text-lg font-bold text-white">Confirm Details</h1>
          <div className="bg-gradient-to-r from-amber-500/20 to-orange-500/20 backdrop-blur-lg px-3 py-1.5 rounded-full border border-amber-400/30">
            <span className="text-amber-300 font-bold text-sm">{itemCount} items</span>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="mx-4 mt-3 bg-amber-500/20 border border-amber-500/50 rounded-xl p-3">
            <p className="text-amber-200 text-sm text-center">{error}</p>
          </div>
        )}

        {/* Photo thumbnails */}
        <div className="flex gap-2 px-4 pt-3">
          {frontPhoto && (
            <div className="w-16 h-16 rounded-lg overflow-hidden border border-white/20">
              <img src={frontPhoto} alt="Front" className="w-full h-full object-cover" />
            </div>
          )}
          {backPhoto && (
            <div className="w-16 h-16 rounded-lg overflow-hidden border border-white/20">
              <img src={backPhoto} alt="Back" className="w-full h-full object-cover" />
            </div>
          )}
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto px-4 pt-3 pb-4 space-y-3">
          {[
            { key: 'brand', label: 'Brand' },
            { key: 'description', label: 'Description' },
            { key: 'style_number', label: 'Style #' },
            { key: 'color', label: 'Color' },
            { key: 'size', label: 'Size' },
            { key: 'msrp', label: 'MSRP ($)', type: 'number' },
            { key: 'cost', label: 'Our Cost ($)', type: 'number' },
            { key: 'upc', label: 'UPC' },
          ].map(({ key, label, type }) => (
            <div key={key}>
              <label className="text-xs uppercase tracking-wider font-semibold text-slate-500 block mb-1">{label}</label>
              <input
                type={type || 'text'}
                value={formData[key]}
                onChange={e => updateField(key, e.target.value)}
                className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-amber-400/50"
                style={{ fontSize: '16px' }}
                placeholder={label}
              />
            </div>
          ))}
        </div>

        {/* Save button */}
        <div className="p-4 border-t border-white/10 bg-slate-900/80 backdrop-blur-xl">
          <button
            onClick={handleSave}
            disabled={saving}
            className={`w-full py-4 rounded-2xl font-bold text-lg transition-all ${
              saving
                ? 'bg-white/10 text-white/50 cursor-wait'
                : 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-2xl shadow-amber-500/30 hover:scale-[1.02]'
            }`}
          >
            {saving ? 'Saving...' : 'Save Item'}
          </button>
        </div>
      </div>
    )
  }

  // === CAMERA CAPTURE (front or back) ===
  return (
    <div className="h-screen flex flex-col bg-gradient-to-br from-orange-950 via-slate-900 to-amber-950">
      {/* Header */}
      <div className="p-3 flex items-center justify-between backdrop-blur-xl bg-white/5 border-b border-white/10">
        <button onClick={() => step === 'back' ? setStep('front') : navigate('/')} className="bg-white/10 hover:bg-white/20 backdrop-blur-lg px-4 py-2 rounded-full border border-white/20 text-white font-semibold text-sm">
          {step === 'back' ? '← Retake Front' : '← Home'}
        </button>
        <h1 className="text-lg font-bold text-white">Kickstart Sort</h1>
        <div className="bg-gradient-to-r from-amber-500/20 to-orange-500/20 backdrop-blur-lg px-3 py-1.5 rounded-full border border-amber-400/30">
          <span className="text-amber-300 font-bold text-sm">{itemCount}</span>
        </div>
      </div>

      {/* Main capture area */}
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        {/* Show front photo thumbnail if on back step */}
        {step === 'back' && frontPhoto && (
          <div className="mb-4 flex items-center gap-3">
            <div className="w-14 h-14 rounded-lg overflow-hidden border-2 border-emerald-400/50">
              <img src={frontPhoto} alt="Front captured" className="w-full h-full object-cover" />
            </div>
            <span className="text-emerald-400 text-sm font-semibold">Front ✓</span>
          </div>
        )}

        <div className="text-center mb-8">
          <div className="text-6xl mb-4">
            {step === 'front' ? '🏷️' : '🔄'}
          </div>
          <h2 className="text-3xl font-bold text-white mb-3 tracking-tight">
            {step === 'front' ? 'Photo Side 1' : 'Photo Side 2'}
          </h2>
          <p className="text-slate-400 text-lg">
            {step === 'front'
              ? 'Snap the Reclectic tag (cost + UPC side)'
              : 'Flip the tag — snap the brand side (style + size + color)'}
          </p>
        </div>

        {/* Hidden file inputs */}
        <input
          ref={frontInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={e => handlePhotoCapture(e, 'front')}
          className="hidden"
        />
        <input
          ref={backInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={e => handlePhotoCapture(e, 'back')}
          className="hidden"
        />

        {/* Camera button */}
        <button
          onClick={() => {
            if (step === 'front') frontInputRef.current?.click()
            else backInputRef.current?.click()
          }}
          className="w-24 h-24 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 shadow-2xl shadow-amber-500/40 flex items-center justify-center hover:scale-105 active:scale-95 transition-all"
        >
          <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
        <p className="text-slate-500 text-sm mt-4">Tap to take photo</p>
      </div>

      {/* Skip to manual entry */}
      <div className="p-4 border-t border-white/10">
        <button
          onClick={() => {
            setStep('review')
          }}
          className="w-full py-3 rounded-2xl bg-white/5 border border-white/10 text-white/60 font-semibold text-sm hover:bg-white/10 transition-all"
        >
          Skip Photos — Enter Manually
        </button>
      </div>
    </div>
  )
}
