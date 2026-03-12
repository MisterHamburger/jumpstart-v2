import { useNavigate } from 'react-router-dom'

export default function SortingSelect() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-10 relative">
      <div className="bg-blob-cyan" />
      <div className="bg-blob-magenta" />

      <button
        onClick={() => navigate('/')}
        className="self-start mb-8 text-slate-400 hover:text-cyan-400 transition-colors flex items-center gap-2 relative z-10"
      >
        <iconify-icon icon="lucide:chevron-left"></iconify-icon> Home
      </button>

      <h2 className="text-3xl font-bold font-heading mb-2 relative z-10">Sorting</h2>
      <p className="text-slate-400 mb-10 relative z-10">Choose sorting mode</p>

      <div className="w-full max-w-md space-y-5 relative z-10">
        <button
          onClick={() => navigate('/sorting/general')}
          className="w-full glass-card rounded-3xl p-8 text-left
            hover:bg-white/10
            hover:scale-[1.02] active:scale-[0.98] transition-all group"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
              <iconify-icon icon="lucide:scan-line" class="text-2xl text-cyan-400"></iconify-icon>
            </div>
            <div>
              <div className="text-xl font-bold font-heading">General Sort</div>
              <div className="text-sm text-slate-400">Scan → Zone assignment</div>
            </div>
          </div>
        </button>

        <button
          onClick={() => navigate('/sorting/bundle')}
          className="w-full glass-card rounded-3xl p-8 text-left
            hover:bg-white/10
            hover:scale-[1.02] active:scale-[0.98] transition-all group"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center">
              <iconify-icon icon="lucide:boxes" class="text-2xl text-pink-400"></iconify-icon>
            </div>
            <div>
              <div className="text-xl font-bold font-heading">Bundle Sort</div>
              <div className="text-sm text-slate-400">Scan → Box number</div>
            </div>
          </div>
        </button>
      </div>
    </div>
  )
}
